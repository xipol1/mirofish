/**
 * Spend Backtest Engine — Per-Cluster Ancillary Spend Validation
 *
 * For each cultural cluster, run a homogeneous cohort at a fixed peak rate
 * and measure the simulated per-day ancillary spend. Compare against the
 * EGATUR 2024 benchmark (INE Spain) scaled by a published luxury-tier
 * uplift factor (2.5×).
 *
 * Per-day ancillary spend:
 *   sim_daily_ancillary_eur = mean(estimated_spend_if_booked_eur) / avg_stay_nights_by_cluster
 * Benchmark:
 *   egatur_daily_eur × ancillary_share_pct × luxury_uplift
 *
 * A cluster PASSES if sim value falls within ±tolerance_pct of benchmark
 * (default ±25%). Tolerance is wide because EGATUR is nationally-averaged
 * and the luxury uplift is a published but coarse multiplier.
 *
 * Why this matters for the Meliá pitch: revenue = rate + ancillary. A
 * synthetic guest that correctly predicts booking decisions but wrongly
 * predicts ancillary spend is useless for full-revenue forecasting. The
 * pitch claim is that our cohort's ancillary spend matches the national
 * stats plus luxury uplift — a claim no competitor can easily verify.
 */

const { runSimulation } = require('./simulation-orchestrator');

const DEFAULT_N_PER_CLUSTER = 50;
const DEFAULT_PEAK_RATE_EUR = 1000;
const DEFAULT_CLUSTERS = [
  'anglo_uk_ireland',
  'german_dach',
  'french',
  'latin_spain_italy',
  'nordic',
];

function buildOriginMixForCluster(clusterId) {
  // origin_mix_override expected shape: { cluster_key: pct } that sum to 100.
  // We force a single-cluster cohort at 100%.
  return { [clusterId]: 100 };
}

function buildRateVariant(rate_eur) {
  return {
    label: 'Peak summer standard rate',
    rate_eur,
    inclusions: ['Breakfast', 'WiFi', 'Taxes'],
    cancellation_policy: 'flexible_48h',
    terms: 'Base room',
  };
}

async function runClusterSpend({
  clusterId,
  property,
  rate_eur,
  n_agents,
  avg_stay_nights,
  seed = 'spend-backtest',
  onProgress = () => {},
}) {
  const origin_mix_override = buildOriginMixForCluster(clusterId);
  const audience = `Luxury leisure travelers from ${clusterId.replace(/_/g, ' ')} cluster, peak-season 5-star Mediterranean resort stay.`;

  const baseProperty = {
    ...property,
    id: property.id || `spend-${clusterId}`,
    data_json: { ...(property.data_json || {}) },
  };

  onProgress({ phase: 'cluster_start', clusterId, rate_eur, n_agents });

  const result = await runSimulation({
    modality: 'rate_strategy_test',
    orgId: null,
    simulationId: `spend-${clusterId}-${Date.now()}`,
    property: baseProperty,
    audience,
    agent_count: n_agents,
    inlineMode: true,
    onProgress: () => {},
    modality_inputs: {
      rate_variants: [buildRateVariant(rate_eur)],
      property_country: 'ES',
      origin_mix_override,
    },
  });

  const records = (result?.records || []).filter(r => r && !r.error);
  const booked = records.filter(r => r.booked);

  // Ancillary spend (estimated_spend_if_booked_eur) is set ONLY on booked
  // prospects. We average over booked agents (the only ones who spend).
  const ancillary_values = booked.map(r => Number(r.estimated_spend_if_booked_eur || 0)).filter(v => v > 0);
  const mean_ancillary_total_eur = ancillary_values.length
    ? ancillary_values.reduce((a, b) => a + b, 0) / ancillary_values.length
    : 0;
  const median_ancillary_total_eur = ancillary_values.length
    ? ancillary_values.sort((a, b) => a - b)[Math.floor(ancillary_values.length / 2)]
    : 0;
  const stay_nights = avg_stay_nights || 5;
  const sim_daily_ancillary_eur = mean_ancillary_total_eur / stay_nights;

  onProgress({
    phase: 'cluster_done', clusterId,
    acceptance_pct: Number(result?.summary?.overall_acceptance_rate_pct ?? 0),
    sim_daily_ancillary_eur: Math.round(sim_daily_ancillary_eur),
  });

  return {
    cluster: clusterId,
    rate_eur,
    n_agents_ran: records.length,
    n_booked: booked.length,
    acceptance_pct: Number(result?.summary?.overall_acceptance_rate_pct ?? 0),
    avg_stay_nights,
    mean_ancillary_total_eur: Math.round(mean_ancillary_total_eur),
    median_ancillary_total_eur: Math.round(median_ancillary_total_eur),
    sim_daily_ancillary_eur: Math.round(sim_daily_ancillary_eur),
  };
}

async function runSpendBacktest({
  property,
  egatur_benchmarks,
  avg_stay_nights_by_cluster,
  clusters = DEFAULT_CLUSTERS,
  peak_rate_eur = DEFAULT_PEAK_RATE_EUR,
  benchmark_month = 'aug_2024',
  n_per_cluster = DEFAULT_N_PER_CLUSTER,
  seed = 'spend-backtest',
  onProgress = () => {},
}) {
  if (!egatur_benchmarks) throw new Error('egatur_benchmarks required');
  if (!property || !property.name) throw new Error('property.name required');

  const t0 = Date.now();
  const expectedByCluster = egatur_benchmarks.expected_ancillary_daily_eur_luxury_5star?.[benchmark_month] || {};
  const tolerancePct = egatur_benchmarks.tolerance_band?.tolerance_pct ?? 25;

  const perCluster = [];
  for (const clusterId of clusters) {
    const avg_stay_nights = avg_stay_nights_by_cluster?.[clusterId] || 6;
    const result = await runClusterSpend({
      clusterId, property, rate_eur: peak_rate_eur, n_agents: n_per_cluster,
      avg_stay_nights, seed, onProgress,
    });
    perCluster.push(result);
  }

  // Score per cluster
  const scored = perCluster.map(r => {
    const benchmark_daily_eur = expectedByCluster[r.cluster];
    if (!benchmark_daily_eur) {
      return { ...r, benchmark_daily_eur: null, abs_delta: null, rel_delta_pct: null, within_tolerance: null, verdict: 'no_anchor' };
    }
    const abs_delta = Math.abs(r.sim_daily_ancillary_eur - benchmark_daily_eur);
    const rel_delta_pct = benchmark_daily_eur > 0 ? (abs_delta / benchmark_daily_eur) * 100 : 0;
    const within_tolerance = rel_delta_pct <= tolerancePct;
    return {
      ...r,
      benchmark_daily_eur,
      abs_delta_eur: Math.round(abs_delta),
      rel_delta_pct: Math.round(rel_delta_pct * 10) / 10,
      within_tolerance,
      verdict: within_tolerance ? 'match' : 'drift',
    };
  });

  const nAnchored = scored.filter(s => s.verdict !== 'no_anchor').length;
  const nPassed = scored.filter(s => s.verdict === 'match').length;
  const pass_rate_pct = nAnchored > 0 ? Math.round((nPassed / nAnchored) * 1000) / 10 : 0;
  const mean_rel_error_pct = nAnchored > 0
    ? scored.filter(s => s.verdict !== 'no_anchor').reduce((s, x) => s + x.rel_delta_pct, 0) / nAnchored
    : null;

  // Correlation between sim curve and benchmark curve
  const simVals = scored.filter(s => s.verdict !== 'no_anchor').map(s => s.sim_daily_ancillary_eur);
  const benchVals = scored.filter(s => s.verdict !== 'no_anchor').map(s => s.benchmark_daily_eur);
  const pearson_r = _pearson(simVals, benchVals);
  const spearman_r = _pearson(_rank(simVals), _rank(benchVals));

  const verdict = pass_rate_pct >= 80 ? 'STRONG_MATCH'
    : pass_rate_pct >= 60 ? 'CLOSE_MATCH'
    : pass_rate_pct >= 40 ? 'PARTIAL_MATCH'
    : 'DRIFT';

  return {
    meta: {
      property_name: property.name,
      seed,
      n_per_cluster,
      clusters_tested: clusters,
      peak_rate_eur,
      benchmark_month,
      elapsed_ms: Date.now() - t0,
      generated_at: new Date().toISOString(),
      benchmark_source: 'EGATUR 2024 (INE España) × luxury uplift 2.5×',
    },
    per_cluster: scored,
    summary: {
      clusters_with_anchor: nAnchored,
      clusters_passed: nPassed,
      pass_rate_pct,
      mean_rel_error_pct: mean_rel_error_pct != null ? Math.round(mean_rel_error_pct * 10) / 10 : null,
      pearson_r: pearson_r != null ? Math.round(pearson_r * 1000) / 1000 : null,
      spearman_r: spearman_r != null ? Math.round(spearman_r * 1000) / 1000 : null,
      verdict,
    },
  };
}

// ── helpers (pearson + rank, local to avoid tight coupling with rate-backtest-scoring) ──
function _pearson(xs, ys) {
  if (!Array.isArray(xs) || xs.length !== ys.length || xs.length < 3) return null;
  const n = xs.length;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0, dxs = 0, dys = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx;
    const dy = ys[i] - my;
    num += dx * dy; dxs += dx * dx; dys += dy * dy;
  }
  const d = Math.sqrt(dxs * dys);
  return d > 0 ? num / d : 0;
}

function _rank(arr) {
  const indexed = arr.map((v, i) => ({ v, i }));
  indexed.sort((a, b) => a.v - b.v);
  const ranks = new Array(arr.length);
  let i = 0;
  while (i < indexed.length) {
    let j = i;
    while (j + 1 < indexed.length && indexed[j + 1].v === indexed[i].v) j++;
    const avgRank = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) ranks[indexed[k].i] = avgRank;
    i = j + 1;
  }
  return ranks;
}

module.exports = {
  runSpendBacktest,
  runClusterSpend,
};
