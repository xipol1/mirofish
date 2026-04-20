/**
 * Backtest Scoring
 *
 * Compares two aggregation objects (output of review-parser.aggregateReviews):
 *   - predicted: sim-generated reviews, aggregated
 *   - actual:    held-out ground-truth reviews, aggregated
 *
 * Produces precision/recall/F1 on theme sets, L1 distance on star distribution,
 * and deltas on average rating + sentiment. All scores are 0..1 (higher is better)
 * plus a composite accuracy_score suitable for pitch decks.
 *
 * No LLM, no network. Deterministic given inputs.
 */

function themeSetScore(predictedArr, actualArr) {
  const predicted = new Set((predictedArr || []).map(s => String(s).toLowerCase()));
  const actual = new Set((actualArr || []).map(s => String(s).toLowerCase()));

  if (predicted.size === 0 && actual.size === 0) {
    return { precision: 1, recall: 1, f1: 1, matched: [], missed: [], extra: [] };
  }

  const matched = [...predicted].filter(t => actual.has(t));
  const missed = [...actual].filter(t => !predicted.has(t));
  const extra = [...predicted].filter(t => !actual.has(t));

  const precision = predicted.size > 0 ? matched.length / predicted.size : 0;
  const recall = actual.size > 0 ? matched.length / actual.size : 0;
  const f1 = (precision + recall) > 0 ? (2 * precision * recall) / (precision + recall) : 0;

  return {
    precision: round3(precision),
    recall: round3(recall),
    f1: round3(f1),
    matched,
    missed,
    extra,
  };
}

/**
 * L1 distance between two star distributions (as percentages).
 * Returned both as raw distance (sum of abs deltas, 0..200) and normalized
 * similarity (0..1 where 1 means identical).
 */
function starDistributionScore(predictedPct, actualPct) {
  const keys = ['1', '2', '3', '4', '5'];
  const deltas = {};
  let l1 = 0;
  for (const k of keys) {
    const p = Number(predictedPct?.[k] ?? 0);
    const a = Number(actualPct?.[k] ?? 0);
    const d = Math.abs(p - a);
    deltas[k] = round1(d);
    l1 += d;
  }
  // Max L1 between two percent distributions is 200 (fully disjoint).
  // Similarity = 1 - l1 / 200.
  const similarity = Math.max(0, 1 - l1 / 200);
  return { l1_distance_pct: round1(l1), similarity: round3(similarity), per_bucket_abs_delta_pct: deltas };
}

/**
 * Absolute delta + normalized similarity for a 0..5 rating.
 */
function avgRatingScore(predicted, actual) {
  if (predicted == null || actual == null) {
    return { predicted, actual, abs_delta: null, similarity: null };
  }
  const delta = Math.abs(predicted - actual);
  // Over a 4-point realistic range (ratings rarely below 1), |delta|/4 is a fair normalization.
  const similarity = Math.max(0, 1 - delta / 4);
  return {
    predicted: round2(predicted),
    actual: round2(actual),
    abs_delta: round2(delta),
    similarity: round3(similarity),
  };
}

/**
 * Sentiment distribution comparison (positive/mixed/negative %).
 */
function sentimentScore(predictedDist, actualDist) {
  const predTotal = sumDist(predictedDist);
  const actTotal = sumDist(actualDist);
  if (predTotal === 0 || actTotal === 0) {
    return { predicted_pct: null, actual_pct: null, l1_distance_pct: null, similarity: null };
  }
  const predPct = toPct(predictedDist, predTotal);
  const actPct = toPct(actualDist, actTotal);
  let l1 = 0;
  for (const k of ['positive', 'mixed', 'negative']) {
    l1 += Math.abs((predPct[k] || 0) - (actPct[k] || 0));
  }
  const similarity = Math.max(0, 1 - l1 / 200);
  return {
    predicted_pct: predPct,
    actual_pct: actPct,
    l1_distance_pct: round1(l1),
    similarity: round3(similarity),
  };
}

/**
 * Composite accuracy score, weighted for a pitch-facing headline.
 * - Star distribution match: 0.30
 * - Avg rating match: 0.20
 * - Top positive themes F1: 0.20
 * - Top negative themes F1: 0.20  (extra weight bc "what will they complain about" is the demo claim)
 * - Sentiment distribution match: 0.10
 */
function compositeAccuracy({ starScore, ratingScore, posThemes, negThemes, sentimentScore: sentScore }) {
  const weights = {
    star: 0.30,
    rating: 0.20,
    pos_themes: 0.20,
    neg_themes: 0.20,
    sentiment: 0.10,
  };
  const parts = {
    star: starScore?.similarity ?? 0,
    rating: ratingScore?.similarity ?? 0,
    pos_themes: posThemes?.f1 ?? 0,
    neg_themes: negThemes?.f1 ?? 0,
    sentiment: sentScore?.similarity ?? 0,
  };
  let total = 0;
  for (const k of Object.keys(weights)) total += weights[k] * parts[k];
  return {
    accuracy_score: round3(total),
    accuracy_pct: round1(total * 100),
    weights,
    component_scores: parts,
  };
}

function scoreBacktest({ predicted_aggregation, actual_aggregation }) {
  const posThemes = themeSetScore(
    predicted_aggregation.top_positive_themes,
    actual_aggregation.top_positive_themes
  );
  const negThemes = themeSetScore(
    predicted_aggregation.top_negative_themes,
    actual_aggregation.top_negative_themes
  );
  const starScore = starDistributionScore(
    predicted_aggregation.star_distribution_pct,
    actual_aggregation.star_distribution_pct
  );
  const ratingScore = avgRatingScore(
    predicted_aggregation.avg_rating_normalized_5,
    actual_aggregation.avg_rating_normalized_5
  );
  const sentScore = sentimentScore(
    predicted_aggregation.sentiment_distribution,
    actual_aggregation.sentiment_distribution
  );
  const composite = compositeAccuracy({ starScore, ratingScore, posThemes, negThemes, sentimentScore: sentScore });

  // Qualitative verdict for the pitch artifact
  const verdict = composite.accuracy_score >= 0.80 ? 'STRONG_MATCH'
    : composite.accuracy_score >= 0.65 ? 'CLOSE_MATCH'
    : composite.accuracy_score >= 0.50 ? 'PARTIAL_MATCH'
    : 'DRIFT';

  return {
    composite,
    verdict,
    top_positive_themes: posThemes,
    top_negative_themes: negThemes,
    star_distribution: starScore,
    avg_rating: ratingScore,
    sentiment_distribution: sentScore,
    sample_sizes: {
      predicted_reviews: predicted_aggregation.review_count,
      actual_reviews: actual_aggregation.review_count,
    },
  };
}

// ───── helpers ─────

function sumDist(d) {
  return ['positive', 'mixed', 'negative'].reduce((s, k) => s + Number(d?.[k] || 0), 0);
}
function toPct(d, total) {
  return {
    positive: round1((Number(d.positive || 0) / total) * 100),
    mixed: round1((Number(d.mixed || 0) / total) * 100),
    negative: round1((Number(d.negative || 0) / total) * 100),
  };
}
function round1(n) { return Math.round(n * 10) / 10; }
function round2(n) { return Math.round(n * 100) / 100; }
function round3(n) { return Math.round(n * 1000) / 1000; }

module.exports = {
  scoreBacktest,
  themeSetScore,
  starDistributionScore,
  avgRatingScore,
  sentimentScore,
  compositeAccuracy,
};
