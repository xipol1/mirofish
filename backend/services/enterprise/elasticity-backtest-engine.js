/**
 * Elasticity Backtest Engine — Archetype-Level Price Elasticity Validation
 *
 * For each hospitality archetype, run a homogeneous cohort at two rate
 * levels straddling the archetype's sweet-spot, measure the empirical
 * own-price elasticity of demand, and compare against a published benchmark
 * compiled from peer-reviewed research (Vives & Jacob 2023, Garín-Muñoz,
 * Singh & Corsun 2023, Xuan Tran 2011, Rateboard industry consensus).
 *
 * Empirical elasticity: ε = ln(q2/q1) / ln(p2/p1)
 *   q = acceptance_rate (share of prospects who book)
 *   p = rate_eur
 *
 * An archetype PASSES the backtest if its simulated elasticity falls within
 * the ±tolerance band of the published benchmark.
 *
 * Why this matters for the Meliá pitch: revenue-management credibility
 * requires that the model's elasticity per segment matches the published
 * academic consensus. If a CRO asks "does your luxury_seeker have the
 * expected ε ≈ -0.4?", we answer with a measured number, not a claim.
 */

const { runSimulation } = require('./simulation-orchestrator');

const DEFAULT_N_PER_RATE = 40;

/** Archetype sweet-spot for Menorca luxury 5★ peer set — same anchors used
 *  in ai_claude_synth.js rate-stage model. Low rate = 0.75× sweet, high
 *  rate = 1.25× sweet. A single archetype cohort is forced via override. */
const ARCHETYPE_SWEET_SPOT_EUR = {
  luxury_seeker: 1200,
  honeymooner: 1000,
  family_vacationer: 700,
  business_traveler: 500,
  digital_nomad: 300,
  budget_optimizer: 200,
  loyalty_maximizer: 600,
  event_attendee: 450,
};

const ALL_ARCHETYPES = Object.keys(ARCHETYPE_SWEET_SPOT_EUR);

function buildSingleArchetypeOverride(archetypeId) {
  const out = {};
  for (const id of ALL_ARCHETYPES) out[id] = id === archetypeId ? 1.0 : 0;
  return out;
}

function buildRateVariant(label, rate_eur) {
  return {
    label,
    rate_eur,
    inclusions: ['Breakfast', 'WiFi', 'Taxes'],
    cancellation_policy: 'flexible_48h',
    terms: 'Base room',
  };
}

function computeElasticity(q1, q2, p1, p2) {
  // ε = d(ln q)/d(ln p) ≈ ln(q2/q1) / ln(p2/p1)
  if (q1 <= 0 || q2 <= 0 || p1 <= 0 || p2 <= 0) return null;
  const num = Math.log(q2 / q1);
  const den = Math.log(p2 / p1);
  if (den === 0) return null;
  return num / den;
}

async function runArchetypeElasticity({ archetypeId, property, n_per_rate, seed = 'elasticity-backtest', onProgress = () => {} }) {
  const sweet = ARCHETYPE_SWEET_SPOT_EUR[archetypeId];
  if (!sweet) throw new Error(`No sweet-spot anchor for archetype ${archetypeId}`);

  const p_low = Math.round(sweet * 0.75);
  const p_high = Math.round(sweet * 1.25);
  const archetype_mix_override = buildSingleArchetypeOverride(archetypeId);

  onProgress({ phase: 'archetype_start', archetypeId, p_low, p_high, n: n_per_rate });

  const baseProperty = {
    ...property,
    id: property.id || `elasticity-${archetypeId}`,
    data_json: {
      ...(property.data_json || {}),
      archetype_mix_override,
    },
  };

  const audience = `Prospects of archetype ${archetypeId} evaluating a single rate offer for ${property.name}.`;

  const runAtRate = async (label, rate_eur) => {
    const result = await runSimulation({
      modality: 'rate_strategy_test',
      orgId: null,
      simulationId: `elasticity-${archetypeId}-${label}-${Date.now()}`,
      property: baseProperty,
      audience,
      agent_count: n_per_rate,
      inlineMode: true,
      onProgress: () => {},
      modality_inputs: {
        rate_variants: [buildRateVariant(label, rate_eur)],
        property_country: 'ES',
      },
    });
    const acceptance_pct = Number(result?.summary?.overall_acceptance_rate_pct ?? 0);
    const walk_away_pct = result?.summary?.variant_performance
      ? Object.values(result.summary.variant_performance)[0]?.walk_away_rate_pct ?? null
      : null;
    return { rate_eur, acceptance_pct, walk_away_pct, actual_cohort: result?.records?.length || 0 };
  };

  const low = await runAtRate('low', p_low);
  onProgress({ phase: 'archetype_progress', archetypeId, rate_eur: p_low, acceptance_pct: low.acceptance_pct });

  const high = await runAtRate('high', p_high);
  onProgress({ phase: 'archetype_progress', archetypeId, rate_eur: p_high, acceptance_pct: high.acceptance_pct });

  const q1 = low.acceptance_pct / 100;
  const q2 = high.acceptance_pct / 100;
  const empirical_elasticity = computeElasticity(q1, q2, p_low, p_high);

  onProgress({ phase: 'archetype_done', archetypeId, empirical_elasticity });

  return {
    archetype: archetypeId,
    sweet_spot_eur: sweet,
    p_low, p_high,
    rate_increase_pct: Math.round(((p_high - p_low) / p_low) * 1000) / 10,
    low_rate: low,
    high_rate: high,
    empirical_elasticity: empirical_elasticity != null ? Math.round(empirical_elasticity * 1000) / 1000 : null,
  };
}

async function runElasticityBacktest({
  property,
  benchmarks,
  archetypes = ALL_ARCHETYPES,
  n_per_rate = DEFAULT_N_PER_RATE,
  seed = 'elasticity-backtest',
  onProgress = () => {},
}) {
  if (!benchmarks) throw new Error('benchmarks required');
  if (!property || !property.name) throw new Error('property.name required');

  const t0 = Date.now();
  const perArchetype = [];

  for (const archetypeId of archetypes) {
    const result = await runArchetypeElasticity({ archetypeId, property, n_per_rate, seed, onProgress });
    perArchetype.push(result);
  }

  // Score
  const scored = perArchetype.map(r => {
    const bench = benchmarks.archetype_benchmark_elasticity?.[r.archetype];
    if (!bench || r.empirical_elasticity == null) {
      return {
        ...r,
        benchmark_value: bench?.value ?? null,
        benchmark_range: bench?.range ?? null,
        within_range: null,
        abs_delta: null,
        verdict: 'no_anchor',
      };
    }
    const [low, high] = bench.range;
    const within_range = r.empirical_elasticity >= low && r.empirical_elasticity <= high;
    const tolerance_band = benchmarks.archetype_benchmark_elasticity._tolerance_band_pp || 0.35;
    const abs_delta = Math.abs(r.empirical_elasticity - bench.value);
    const within_tolerance = abs_delta <= tolerance_band;
    let verdict = 'fail';
    if (within_range) verdict = 'in_range';
    else if (within_tolerance) verdict = 'within_tolerance';
    return {
      ...r,
      benchmark_value: bench.value,
      benchmark_range: bench.range,
      abs_delta: Math.round(abs_delta * 1000) / 1000,
      within_range,
      within_tolerance,
      verdict,
      primary_source: bench.primary_source,
    };
  });

  const nAnchored = scored.filter(s => s.verdict !== 'no_anchor').length;
  const nInRange = scored.filter(s => s.verdict === 'in_range').length;
  const nPassed = scored.filter(s => s.verdict === 'in_range' || s.verdict === 'within_tolerance').length;
  const pass_rate_pct = nAnchored > 0 ? Math.round((nPassed / nAnchored) * 1000) / 10 : 0;
  const strict_match_rate_pct = nAnchored > 0 ? Math.round((nInRange / nAnchored) * 1000) / 10 : 0;
  const mean_abs_error = scored
    .filter(s => typeof s.abs_delta === 'number')
    .reduce((s, x) => s + x.abs_delta, 0) / Math.max(1, nAnchored);

  const composite = pass_rate_pct >= 85 ? 'STRONG_MATCH'
    : pass_rate_pct >= 70 ? 'CLOSE_MATCH'
    : pass_rate_pct >= 50 ? 'PARTIAL_MATCH'
    : 'DRIFT';

  return {
    meta: {
      property_name: property.name,
      seed,
      n_per_rate,
      archetypes_tested: archetypes,
      elapsed_ms: Date.now() - t0,
      generated_at: new Date().toISOString(),
      benchmark_sources: Object.keys(benchmarks.sources || {}),
    },
    per_archetype: scored,
    summary: {
      archetypes_with_anchor: nAnchored,
      strict_in_range: nInRange,
      passed_within_tolerance: nPassed,
      pass_rate_pct,
      strict_match_rate_pct,
      mean_abs_error: Math.round(mean_abs_error * 1000) / 1000,
      verdict: composite,
    },
  };
}

module.exports = {
  runElasticityBacktest,
  runArchetypeElasticity,
  computeElasticity,
  ARCHETYPE_SWEET_SPOT_EUR,
};
