/**
 * Confidence Intervals — bootstrap CIs for aggregated cohort metrics.
 *
 * A CRO looking at "NPS = 45, n=20" needs to know whether that's ±5 or ±25.
 * We bootstrap (non-parametric, 1000 resamples by default) every numeric
 * cohort metric the orchestrator emits so the frontend can render "45 ± 7".
 */

function seededRng(seed) {
  // Mulberry32 — small, deterministic PRNG for reproducible bootstraps.
  let t = (seed | 0);
  return function() {
    t = (t + 0x6D2B79F5) | 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r = r + Math.imul(r ^ (r >>> 7), 61 | r) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function percentile(sortedArr, p) {
  if (!sortedArr.length) return null;
  const idx = Math.max(0, Math.min(sortedArr.length - 1, Math.floor((p / 100) * sortedArr.length)));
  return sortedArr[idx];
}

/**
 * Bootstrap a metric.
 * @param {Array} samples       raw observations
 * @param {Function} metricFn   reducer, defaults to mean
 * @param {Object} opts         { nResamples=1000, seed=null, ci=95 }
 */
function bootstrap(samples, metricFn = null, opts = {}) {
  const reducer = metricFn || ((arr) => arr.reduce((s, v) => s + v, 0) / arr.length);
  const n = samples.length;
  const nResamples = opts.nResamples || 1000;
  const ci = opts.ci || 95;
  const lowP = (100 - ci) / 2;
  const highP = 100 - lowP;

  if (n === 0) return { mean: null, ci_low: null, ci_high: null, std_dev: null, n: 0 };
  if (n === 1) return { mean: reducer(samples), ci_low: reducer(samples), ci_high: reducer(samples), std_dev: 0, n: 1 };

  const rnd = opts.seed != null ? seededRng(opts.seed) : Math.random;

  const observedMean = reducer(samples);
  const boot = new Array(nResamples);
  for (let b = 0; b < nResamples; b++) {
    const resample = new Array(n);
    for (let i = 0; i < n; i++) resample[i] = samples[Math.floor(rnd() * n)];
    boot[b] = reducer(resample);
  }
  boot.sort((a, b) => a - b);
  const ciLow = percentile(boot, lowP);
  const ciHigh = percentile(boot, highP);

  // Std dev of bootstrap distribution
  const meanOfBoot = boot.reduce((s, v) => s + v, 0) / nResamples;
  const variance = boot.reduce((s, v) => s + (v - meanOfBoot) ** 2, 0) / nResamples;
  const std = Math.sqrt(variance);

  return {
    mean: Math.round(observedMean * 100) / 100,
    ci_low: Math.round(ciLow * 100) / 100,
    ci_high: Math.round(ciHigh * 100) / 100,
    std_dev: Math.round(std * 100) / 100,
    n,
  };
}

/**
 * Wrap a scalar metric into a CI shape given the per-agent sample array.
 */
function wrap(metricFn, samples, opts = {}) {
  return bootstrap(samples, metricFn, opts);
}

/**
 * Attach confidence intervals to a stay-experience summary object.
 * Mutates + returns the summary. The numeric fields are replaced with
 * { value, ci_low, ci_high, std, n } shapes.
 */
function addConfidenceIntervalsToSummary(summary, stays, opts = {}) {
  if (!summary || !Array.isArray(stays)) return summary;
  const valid = stays.filter(s => s && !s.error);
  const n = valid.length;
  if (n === 0) return summary;

  const seed = opts.seed || null;

  // Helper: CI shape
  const ci = (samples, scaleFn = null) => {
    const arr = scaleFn ? samples.map(scaleFn) : samples;
    const b = bootstrap(arr, null, { nResamples: opts.nResamples || 1000, seed });
    return { value: b.mean, ci_low: b.ci_low, ci_high: b.ci_high, std: b.std_dev, n: b.n };
  };

  // stars, nps, spend
  const starArr = valid.map(s => s.sensation_summary?.stars || 0);
  const npsArr = valid.map(s => s.sensation_summary?.nps ?? 0);
  const spendArr = valid.map(s => s.expense_summary?.total_spend_eur || 0);
  const adrArr = valid.map(s => s.booking_context?.room_rate_paid_eur || 0);

  summary.avg_stars_ci = ci(starArr);
  summary.avg_nps_ci = ci(npsArr);
  summary.avg_spend_eur_ci = ci(spendArr);
  summary.avg_room_rate_paid_eur_ci = ci(adrArr);

  // Binary proportions
  summary.would_repeat_pct_ci = ci(valid.map(s => s.predicted_review?.would_repeat ? 1 : 0), v => v * 100);
  summary.would_recommend_pct_ci = ci(valid.map(s => s.predicted_review?.would_recommend ? 1 : 0), v => v * 100);

  // NPS net promoter score CI (promoters - detractors) / n
  summary.net_promoter_score_ci = ci(npsArr, (nps) => {
    if (nps >= 50) return 100;
    if (nps < 0) return -100;
    return 0;
  });

  // Star distribution per bucket — each bucket is a proportion
  const starDistCi = {};
  for (let bucket = 1; bucket <= 5; bucket++) {
    starDistCi[bucket] = ci(valid.map(s => (s.sensation_summary?.stars === bucket ? 1 : 0)), v => v * 100);
  }
  summary.realized_star_distribution_pct_ci = starDistCi;

  // Post-stay
  const returnIntentArr = valid.map(s => s.post_stay?.return_intent?.return_intent_12m_probability).filter(x => typeof x === 'number');
  if (returnIntentArr.length) summary.avg_return_intent_12m_ci = ci(returnIntentArr);

  return summary;
}

module.exports = { bootstrap, wrap, addConfidenceIntervalsToSummary };
