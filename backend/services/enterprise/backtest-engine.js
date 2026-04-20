/**
 * Backtest Engine — Blind Holdout Validation
 *
 * Problem: the review corpus has no timestamps, so a true temporal backtest
 * (train pre-T → predict post-T) is not possible. Instead, we run a standard
 * ML-style cross-validation: deterministically partition the reviews into
 * train / test splits, rebuild the calibration from the train split only,
 * run the simulation with that reduced calibration, and compare the
 * predicted review distribution against the held-out test set.
 *
 * What this measures: given only a fraction of the evidence, does the
 * simulation reconstruct the same guest-experience shape — top themes,
 * star distribution, sentiment ratio — as the held-out portion?
 *
 * What it does NOT measure: forward temporal prediction, nor transfer to
 * a different property. Those are separate modules (planned).
 *
 * Usage:
 *   const { runBacktest } = require('./backtest-engine');
 *   const report = await runBacktest({
 *     reviews,          // raw review array (review-parser input shape)
 *     property,         // property inline spec
 *     baseCalibration,  // full calibration (subcategory anchors kept constant)
 *     audience,         // audience description for the sim
 *     trainRatio: 0.6,
 *     agentCount: 60,
 *     seed: 'villa-le-blanc-2026-04-19',
 *     onProgress: fn,
 *   });
 */

const { aggregateReviews, toCalibrationSignals } = require('../data/review-parser');
const { runStaySimulation } = require('./stay-simulation');
const { scoreBacktest } = require('./backtest-scoring');

const DEFAULT_TRAIN_RATIO = 0.6;
const DEFAULT_AGENT_COUNT = 60;
const MIN_TRAIN_SIZE = 15;
const MIN_TEST_SIZE = 10;

/**
 * FNV-1a 32-bit hash. Deterministic, no dependencies.
 */
function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/**
 * Stratified split by `source` (tripadvisor, booking, google, …) with
 * deterministic ordering based on FNV(seed + review_id). Guarantees the same
 * split across runs for reproducibility in the pitch artifact.
 */
function stratifiedSplit(reviews, { trainRatio = DEFAULT_TRAIN_RATIO, seed = 'default' } = {}) {
  const bySource = {};
  for (const r of reviews) {
    const src = r.source || 'unknown';
    const id = r.source_review_id || r.review_id || `${src}-${Math.random()}`;
    (bySource[src] = bySource[src] || []).push({ review: r, _key: fnv1a(`${seed}|${id}`) });
  }

  const train = [];
  const test = [];
  for (const src of Object.keys(bySource)) {
    const group = bySource[src].sort((a, b) => a._key - b._key);
    const cut = Math.max(1, Math.round(group.length * trainRatio));
    for (let i = 0; i < group.length; i++) {
      (i < cut ? train : test).push(group[i].review);
    }
  }

  return {
    train,
    test,
    split_summary: Object.fromEntries(
      Object.keys(bySource).map(s => [
        s,
        {
          total: bySource[s].length,
          train: Math.max(1, Math.round(bySource[s].length * trainRatio)),
          test: bySource[s].length - Math.max(1, Math.round(bySource[s].length * trainRatio)),
        },
      ])
    ),
  };
}

/**
 * Build a calibration object suitable as calibrationOverride from the train
 * split alone. Subcategory anchors (aesthetic/service/value on 100 scale) are
 * carried over from `baseCalibration` unchanged — those anchors come from
 * TripAdvisor sub-scores in the real pipeline and are not reconstructable
 * from individual review bodies.
 */
function buildTrainCalibration({ trainReviews, baseCalibration, property }) {
  const aggregation = aggregateReviews(trainReviews);
  const signals = toCalibrationSignals(aggregation);

  return {
    ...signals,
    // Pitch-relevant anchors preserved from full calibration, since they're
    // an independent data source (TripAdvisor sub-scores) and the backtest
    // is scoped to review-level predictions, not anchor reconstruction.
    subcategory_anchors_100_scale: baseCalibration?.subcategory_anchors_100_scale || null,
    property_name: property?.name || baseCalibration?.property_name,
    property_slug: property?.slug || baseCalibration?.property_slug,
    calibration_version: `${baseCalibration?.calibration_version || '2.0'}-backtest-train`,
    _source: 'backtest_train_split',
    _train_review_count: trainReviews.length,
  };
}

/**
 * Convert sim-produced predicted_review objects into the shape that
 * review-parser.aggregateReviews consumes. This lets us score predicted vs
 * actual using the same aggregation pipeline.
 */
function simStaysToReviews(stays) {
  const out = [];
  for (const stay of stays || []) {
    if (!stay || stay.error) continue;
    const pr = stay.predicted_review;
    if (!pr || !pr.will_write_review) continue;
    out.push({
      source: pr.platform || 'sim',
      source_review_id: `sim-${stay.persona_full?.id || stay.persona?.id || Math.random()}`,
      rating_numeric: pr.star_rating,
      rating_scale: 5,
      title: pr.title || null,
      body: pr.body || '',
      themes_json: Array.isArray(pr.themes) ? pr.themes : null,
      trip_type: stay.persona_full?.archetype_id || stay.persona?.archetype_id || null,
      language: pr.language || 'en',
    });
  }
  return out;
}

/**
 * Main entry point.
 */
async function runBacktest({
  reviews,
  property,
  baseCalibration,
  audience,
  trainRatio = DEFAULT_TRAIN_RATIO,
  agentCount = DEFAULT_AGENT_COUNT,
  seed = 'default-backtest-seed',
  onProgress = () => {},
}) {
  if (!Array.isArray(reviews) || reviews.length < (MIN_TRAIN_SIZE + MIN_TEST_SIZE)) {
    throw new Error(`reviews must contain at least ${MIN_TRAIN_SIZE + MIN_TEST_SIZE} items (got ${reviews?.length || 0})`);
  }
  if (!property || !property.name) throw new Error('property.name is required');
  if (!audience) throw new Error('audience is required');

  const t0 = Date.now();
  onProgress({ phase: 'split', message: `Splitting ${reviews.length} reviews (${Math.round(trainRatio * 100)}/${Math.round((1 - trainRatio) * 100)} stratified by source)` });

  const { train, test, split_summary } = stratifiedSplit(reviews, { trainRatio, seed });
  if (train.length < MIN_TRAIN_SIZE) throw new Error(`train split too small (${train.length} < ${MIN_TRAIN_SIZE})`);
  if (test.length < MIN_TEST_SIZE) throw new Error(`test split too small (${test.length} < ${MIN_TEST_SIZE})`);

  onProgress({ phase: 'recalibrate', message: `Rebuilding calibration from ${train.length} train reviews` });
  const trainCalibration = buildTrainCalibration({ trainReviews: train, baseCalibration, property });

  onProgress({ phase: 'simulate', message: `Running simulation with train calibration (n=${agentCount} agents)` });
  const simResult = await runStaySimulation({
    orgId: null,
    simulationId: `backtest-${seed}-${Date.now()}`,
    property: {
      ...property,
      id: property.id || `backtest-${property.slug || 'property'}`,
      data_json: property.data_json || property,
    },
    audience,
    agent_count: agentCount,
    inlineMode: true,
    calibrationOverride: trainCalibration,
    onProgress: (e) => onProgress({ phase: 'simulate', sim_event: e.type, payload_phase: e.phase }),
  });

  const predictedReviews = simStaysToReviews(simResult?.stays || []);
  if (predictedReviews.length === 0) {
    throw new Error('Simulation produced zero predicted reviews — cannot score');
  }

  onProgress({ phase: 'score', message: `Scoring ${predictedReviews.length} predicted vs ${test.length} held-out reviews` });
  const predicted_aggregation = aggregateReviews(predictedReviews);
  const actual_aggregation = aggregateReviews(test);

  const scores = scoreBacktest({ predicted_aggregation, actual_aggregation });

  const elapsed_ms = Date.now() - t0;

  return {
    meta: {
      property_name: property.name,
      property_slug: property.slug || property.id,
      seed,
      train_ratio: trainRatio,
      agent_count: agentCount,
      elapsed_ms,
      generated_at: new Date().toISOString(),
    },
    split: {
      total_reviews: reviews.length,
      train_size: train.length,
      test_size: test.length,
      stratification: split_summary,
    },
    train_calibration: {
      avg_rating: trainCalibration.avg_rating,
      star_distribution_pct: trainCalibration.star_distribution_pct,
      top_positive_themes: trainCalibration.top_positive_themes,
      top_negative_themes: trainCalibration.top_negative_themes,
      sentiment_distribution: trainCalibration.sentiment_distribution,
    },
    predicted_aggregation: {
      review_count: predicted_aggregation.review_count,
      avg_rating: predicted_aggregation.avg_rating_normalized_5,
      star_distribution_pct: predicted_aggregation.star_distribution_pct,
      top_positive_themes: predicted_aggregation.top_positive_themes,
      top_negative_themes: predicted_aggregation.top_negative_themes,
      sentiment_distribution: predicted_aggregation.sentiment_distribution,
    },
    actual_aggregation: {
      review_count: actual_aggregation.review_count,
      avg_rating: actual_aggregation.avg_rating_normalized_5,
      star_distribution_pct: actual_aggregation.star_distribution_pct,
      top_positive_themes: actual_aggregation.top_positive_themes,
      top_negative_themes: actual_aggregation.top_negative_themes,
      sentiment_distribution: actual_aggregation.sentiment_distribution,
    },
    scores,
    sim_summary: {
      provider: simResult?.provider,
      total_stays: simResult?.stays?.length || 0,
      review_writers: predictedReviews.length,
      write_rate_pct: simResult?.stays?.length ? Math.round((predictedReviews.length / simResult.stays.length) * 1000) / 10 : null,
      avg_stars: simResult?.summary?.avg_stars,
      avg_nps: simResult?.summary?.avg_nps,
    },
  };
}

module.exports = {
  runBacktest,
  stratifiedSplit,
  buildTrainCalibration,
  simStaysToReviews,
};
