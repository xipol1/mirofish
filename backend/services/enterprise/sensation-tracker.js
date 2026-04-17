/**
 * Sensation Tracker — maintains per-guest sensation state across 12 dimensions.
 *
 * Each stage of the stay produces sensation deltas. The final state + history
 * feeds the review predictor and NPS calculation.
 */

const path = require('path');
const fs = require('fs');

const SENSATION_PATH = path.join(__dirname, '..', '..', 'data', 'industries', 'hospitality', 'sensation_dimensions.json');

let _config = null;
function getConfig() {
  if (_config) return _config;
  _config = JSON.parse(fs.readFileSync(SENSATION_PATH, 'utf-8'));
  return _config;
}

function clamp(n, min = 0, max = 100) { return Math.max(min, Math.min(max, n)); }

/**
 * Initialize a sensation vector for a guest + property.
 * Starts from the property's historical baseline (if reviews aggregated) or default.
 */
function initialState({ propertyBaseline = null } = {}) {
  const config = getConfig();
  const base = propertyBaseline || config.default_starting_values;
  return { ...base, _history: [], _moments: { positive: [], negative: [] }, _ts_start: Date.now() };
}

/**
 * Apply a stage outcome to the sensation state.
 * Each outcome is a map of dimension -> delta (positive or negative).
 *
 * e.g. applyStage(state, { comfort_physical: +8, cleanliness: -3, personalization: +15 }, 'arrival_checkin')
 */
function applyStageDeltas(state, deltas = {}, stageLabel = null) {
  const config = getConfig();
  const dims = Object.keys(config.dimensions);
  const next = { ...state };

  for (const dim of dims) {
    if (deltas[dim] != null) {
      next[dim] = clamp(next[dim] + deltas[dim]);
    }
  }

  next._history = [
    ...(state._history || []),
    {
      stage: stageLabel,
      deltas,
      snapshot: Object.fromEntries(dims.map(d => [d, next[d]])),
      ts: Date.now(),
    },
  ];
  return next;
}

/**
 * Record a memorable moment (positive or negative) that will surface in the review.
 */
function recordMoment(state, { kind, stage, description }) {
  const next = { ...state, _moments: {
    positive: [...(state._moments?.positive || [])],
    negative: [...(state._moments?.negative || [])],
  }};
  const entry = { stage, description, ts: Date.now() };
  if (kind === 'positive') next._moments.positive.push(entry);
  else if (kind === 'negative') next._moments.negative.push(entry);
  return next;
}

/**
 * Compute the overall weighted score for a given archetype's sensation weights.
 */
function computeWeightedScore(state, archetypeBehavior) {
  const weights = archetypeBehavior?.sensation_weights || {};
  const config = getConfig();
  const dims = Object.keys(config.dimensions);

  let weightSum = 0;
  let weightedValue = 0;
  for (const dim of dims) {
    const w = weights[dim] || (1 / dims.length) * 0.3; // fallback even weight
    weightSum += w;
    weightedValue += w * (state[dim] || 0);
  }
  if (weightSum === 0) return 0;
  return weightedValue / weightSum;
}

/**
 * Apply memorable-moment bonuses/penalties to a weighted score.
 */
function computeFinalScore(state, archetypeBehavior) {
  const base = computeWeightedScore(state, archetypeBehavior);
  const positives = (state._moments?.positive || []).length;
  const negatives = (state._moments?.negative || []).length;
  const bonus = positives * 2.5;
  const penalty = negatives * 4.0;
  return clamp(base + bonus - penalty);
}

/**
 * Convert a final score to predicted NPS (-100..100) and star rating (1..5).
 */
function scoreToNpsAndStars(finalScore) {
  const config = getConfig();
  const npsThreshold = config.nps_calculation.thresholds;
  const starBuckets = config.star_rating_bucket;

  let nps;
  if (finalScore >= npsThreshold.promoter_above) nps = 40 + (finalScore - npsThreshold.promoter_above) * 3;
  else if (finalScore >= npsThreshold.passive_range[0]) nps = -20 + (finalScore - npsThreshold.passive_range[0]) * 3;
  else nps = -60 + (finalScore - npsThreshold.detractor_below) * 2;
  nps = Math.max(-100, Math.min(100, Math.round(nps)));

  let stars;
  if (finalScore >= starBuckets['5_star_above_score']) stars = 5;
  else if (finalScore >= starBuckets['4_star_range'][0]) stars = 4;
  else if (finalScore >= starBuckets['3_star_range'][0]) stars = 3;
  else if (finalScore >= starBuckets['2_star_range'][0]) stars = 2;
  else stars = 1;

  return { nps, stars, raw_score: Math.round(finalScore * 10) / 10 };
}

/**
 * Produce a compact summary for insertion in the stay record.
 */
function summarize(state, archetypeBehavior) {
  const config = getConfig();
  const dims = Object.keys(config.dimensions);
  const finalSnapshot = Object.fromEntries(dims.map(d => [d, Math.round(state[d] || 0)]));

  const finalScore = computeFinalScore(state, archetypeBehavior);
  const { nps, stars, raw_score } = scoreToNpsAndStars(finalScore);

  return {
    final_state: finalSnapshot,
    raw_score,
    nps,
    stars,
    moments: {
      positive: state._moments?.positive || [],
      negative: state._moments?.negative || [],
    },
    history_steps: (state._history || []).length,
  };
}

module.exports = {
  initialState,
  applyStageDeltas,
  recordMoment,
  computeWeightedScore,
  computeFinalScore,
  scoreToNpsAndStars,
  summarize,
  getConfig,
};
