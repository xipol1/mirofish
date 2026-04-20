/**
 * Rate Backtest Scoring
 *
 * Compares two ordered series over a shared time axis (months):
 *   - predicted: simulated acceptance rate per month
 *   - actual:    observed luxury occupancy per month (STR/IBESTAT proxy)
 *
 * Core metrics:
 *   - Pearson correlation (linear relationship)
 *   - Spearman rank correlation (ordinal agreement — does the sim rank months correctly?)
 *   - L1 distance on MIN/MAX-normalized curves (shape similarity independent of level)
 *   - Peak/trough month agreement (boolean)
 *
 * Composite rate_accuracy_score is weighted for a pitch headline:
 *   - Shape similarity (L1 normalized):  0.40
 *   - Rank correlation (Spearman):       0.35
 *   - Linear correlation (Pearson):      0.20
 *   - Peak month match:                  0.05
 *
 * Rationale: for revenue-management credibility, the *shape* of the demand
 * curve matters more than absolute acceptance levels. A CRO will not trust
 * the model unless peaks and troughs align with their known seasonality.
 */

function pearson(xs, ys) {
  if (!Array.isArray(xs) || !Array.isArray(ys) || xs.length !== ys.length || xs.length < 3) return null;
  const n = xs.length;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0, dxs = 0, dys = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx;
    const dy = ys[i] - my;
    num += dx * dy;
    dxs += dx * dx;
    dys += dy * dy;
  }
  const denom = Math.sqrt(dxs * dys);
  return denom > 0 ? num / denom : 0;
}

function rank(values) {
  // Fractional ranks for ties (average method)
  const indexed = values.map((v, i) => ({ v, i }));
  indexed.sort((a, b) => a.v - b.v);
  const ranks = new Array(values.length);
  let i = 0;
  while (i < indexed.length) {
    let j = i;
    while (j + 1 < indexed.length && indexed[j + 1].v === indexed[i].v) j++;
    const avgRank = (i + j) / 2 + 1; // 1-based
    for (let k = i; k <= j; k++) ranks[indexed[k].i] = avgRank;
    i = j + 1;
  }
  return ranks;
}

function spearman(xs, ys) {
  if (!Array.isArray(xs) || !Array.isArray(ys) || xs.length !== ys.length || xs.length < 3) return null;
  return pearson(rank(xs), rank(ys));
}

function minMaxNormalize(arr) {
  const min = Math.min(...arr);
  const max = Math.max(...arr);
  const range = max - min;
  if (range === 0) return arr.map(() => 0.5);
  return arr.map(v => (v - min) / range);
}

function l1NormalizedShapeDistance(predicted, actual) {
  const p = minMaxNormalize(predicted);
  const a = minMaxNormalize(actual);
  let l1 = 0;
  for (let i = 0; i < p.length; i++) l1 += Math.abs(p[i] - a[i]);
  // Max L1 when curves are anti-correlated min-max normalized: roughly n (each term up to 1)
  const similarity = Math.max(0, 1 - l1 / p.length);
  return { l1_distance: round3(l1), similarity: round3(similarity), normalized_predicted: p.map(round3), normalized_actual: a.map(round3) };
}

function peakTroughAgreement(predicted, actual, labels) {
  const iPmax = predicted.indexOf(Math.max(...predicted));
  const iAmax = actual.indexOf(Math.max(...actual));
  const iPmin = predicted.indexOf(Math.min(...predicted));
  const iAmin = actual.indexOf(Math.min(...actual));
  return {
    predicted_peak: labels[iPmax],
    actual_peak: labels[iAmax],
    peak_match: iPmax === iAmax,
    predicted_trough: labels[iPmin],
    actual_trough: labels[iAmin],
    trough_match: iPmin === iAmin,
  };
}

function compositeRateAccuracy({ shape, spearman_r, pearson_r, peak_trough }) {
  const shapeScore = shape?.similarity ?? 0;
  const spearmanScore = Math.max(0, spearman_r ?? 0); // negative correlation is failure
  const pearsonScore = Math.max(0, pearson_r ?? 0);
  const peakScore = peak_trough?.peak_match ? 1 : 0;

  const weights = { shape: 0.40, spearman: 0.35, pearson: 0.20, peak: 0.05 };
  const total = weights.shape * shapeScore
              + weights.spearman * spearmanScore
              + weights.pearson * pearsonScore
              + weights.peak * peakScore;

  const verdict = total >= 0.85 ? 'STRONG_MATCH'
    : total >= 0.70 ? 'CLOSE_MATCH'
    : total >= 0.55 ? 'PARTIAL_MATCH'
    : 'DRIFT';

  return {
    rate_accuracy_score: round3(total),
    rate_accuracy_pct: round1(total * 100),
    verdict,
    weights,
    component_scores: {
      shape: round3(shapeScore),
      spearman: round3(spearmanScore),
      pearson: round3(pearsonScore),
      peak: peakScore,
    },
  };
}

/**
 * @param {Object} args
 * @param {string[]} args.labels            e.g. ['apr','may','jun','jul','aug','sep','oct']
 * @param {number[]} args.predicted_pct     predicted acceptance rate per period (0-100)
 * @param {number[]} args.actual_pct        observed occupancy per period (0-100)
 */
function scoreRateBacktest({ labels, predicted_pct, actual_pct }) {
  if (!labels || predicted_pct.length !== actual_pct.length || predicted_pct.length !== labels.length) {
    throw new Error('labels / predicted_pct / actual_pct must be same length');
  }
  const pearson_r = pearson(predicted_pct, actual_pct);
  const spearman_r = spearman(predicted_pct, actual_pct);
  const shape = l1NormalizedShapeDistance(predicted_pct, actual_pct);
  const peak_trough = peakTroughAgreement(predicted_pct, actual_pct, labels);
  const composite = compositeRateAccuracy({ shape, spearman_r, pearson_r, peak_trough });

  return {
    composite,
    pearson_r: round3(pearson_r),
    spearman_r: round3(spearman_r),
    shape,
    peak_trough,
    per_period: labels.map((m, i) => ({
      period: m,
      predicted_pct: round1(predicted_pct[i]),
      actual_pct: round1(actual_pct[i]),
      abs_delta_pp: round1(Math.abs(predicted_pct[i] - actual_pct[i])),
      normalized_predicted: shape.normalized_predicted[i],
      normalized_actual: shape.normalized_actual[i],
    })),
  };
}

// helpers
function round1(n) { return n == null ? null : Math.round(n * 10) / 10; }
function round3(n) { return n == null ? null : Math.round(n * 1000) / 1000; }

module.exports = {
  scoreRateBacktest,
  pearson,
  spearman,
  l1NormalizedShapeDistance,
  peakTroughAgreement,
  compositeRateAccuracy,
  minMaxNormalize,
  rank,
};
