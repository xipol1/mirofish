#!/usr/bin/env node
/**
 * Archetype Price Elasticity Backtest
 *
 * Validates the simulated per-archetype price elasticity of demand against
 * a published benchmark compiled from:
 *   - Vives & Jacob (2023) — Spanish resort hotels (JHTT, Emerald)
 *   - Vives & Jacob (2021) — Dynamic pricing (SAGE Tourism Economics)
 *   - Garín-Muñoz — German demand for tourism in Spain
 *   - Singh & Corsun (2023) — Cornell Hospitality Quarterly
 *   - Xuan Tran (2011) — U.S. luxury hotel price sensitivity
 *   - Industry consensus (Rateboard, Hotel Tech Report)
 *
 * Output artifacts:
 *   - backend/data/backtest_runs/elasticity_archetypes_<ts>.json
 *   - backend/data/backtest_runs/elasticity_archetypes_<ts>.md
 *
 * Usage:
 *   USE_SYNTH=true node scripts/elasticity_backtest_archetypes.js
 */

process.env.USE_SYNTH = process.env.USE_SYNTH || 'true';

const fs = require('fs');
const path = require('path');
const { runElasticityBacktest } = require('../backend/services/enterprise/elasticity-backtest-engine');

const BENCH_PATH = path.join(__dirname, '..', 'backend', 'data', 'benchmarks', 'hotel_elasticity_benchmarks.json');
const OUT_DIR = path.join(__dirname, '..', 'backend', 'data', 'backtest_runs');
const N_PER_RATE = parseInt(process.env.N_PER_RATE, 10) || 40;
const SEED = process.env.SEED || 'villa-le-blanc-elasticity';

async function main() {
  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });
  const benchmarks = JSON.parse(fs.readFileSync(BENCH_PATH, 'utf-8'));

  const property = {
    name: 'Gran Meliá Villa Le Blanc',
    brand: 'Gran Meliá',
    slug: 'gran-melia-villa-le-blanc',
    data_json: {
      identity: { tier: 'luxury', stars: 5, brand: 'Gran Meliá', location: 'Menorca, Spain' },
    },
  };

  console.log('─'.repeat(72));
  console.log('Archetype Price Elasticity Backtest');
  console.log('─'.repeat(72));
  console.log(`property       : ${property.name}`);
  console.log(`provider       : ${process.env.USE_SYNTH === 'true' ? 'synth (deterministic, offline)' : 'default'}`);
  console.log(`agents/rate    : ${N_PER_RATE}`);
  console.log(`archetypes     : 8`);
  console.log(`benchmark file : ${path.basename(BENCH_PATH)}`);
  console.log('─'.repeat(72));

  const t0 = Date.now();
  const report = await runElasticityBacktest({
    property,
    benchmarks,
    n_per_rate: N_PER_RATE,
    seed: SEED,
    onProgress: (e) => {
      if (e.phase === 'archetype_start') console.log(`[${e.archetypeId}] low=€${e.p_low}, high=€${e.p_high}, n=${e.n}`);
      if (e.phase === 'archetype_done') console.log(`[${e.archetypeId}] → ε = ${e.empirical_elasticity}`);
    },
  });

  const elapsed_s = ((Date.now() - t0) / 1000).toFixed(1);
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const jsonOut = path.join(OUT_DIR, `elasticity_archetypes_${ts}.json`);
  const mdOut = path.join(OUT_DIR, `elasticity_archetypes_${ts}.md`);

  fs.writeFileSync(jsonOut, JSON.stringify(report, null, 2));
  fs.writeFileSync(mdOut, buildMarkdown(report, { benchmarks, jsonPath: jsonOut, elapsed_s }));

  const s = report.summary;
  console.log('');
  console.log('─'.repeat(72));
  console.log('RESULT');
  console.log('─'.repeat(72));
  console.log(`pass_rate           : ${s.pass_rate_pct}%   → ${s.verdict}`);
  console.log(`  strict in range   : ${s.strict_match_rate_pct}%`);
  console.log(`  mean abs error    : ${s.mean_abs_error}`);
  console.log(`  passed / anchored : ${s.passed_within_tolerance}/${s.archetypes_with_anchor}`);
  console.log('');
  for (const a of report.per_archetype) {
    const bench = a.benchmark_value ?? 'n/a';
    const mark = a.verdict === 'in_range' ? '✅' : a.verdict === 'within_tolerance' ? '≈' : '❌';
    console.log(`  ${mark} ${a.archetype.padEnd(20)} sim=${String(a.empirical_elasticity ?? 'n/a').padStart(7)}  bench=${String(bench).padStart(6)}  Δ=${a.abs_delta ?? 'n/a'}`);
  }
  console.log('');
  console.log(`wrote: ${path.relative(process.cwd(), jsonOut)}`);
  console.log(`wrote: ${path.relative(process.cwd(), mdOut)}`);
  console.log(`elapsed: ${elapsed_s}s`);
}

function buildMarkdown(r, { benchmarks, jsonPath, elapsed_s }) {
  const lines = [];
  const s = r.summary;
  lines.push(`# Archetype Price Elasticity Backtest — ${r.meta.property_name}`);
  lines.push('');
  lines.push(`**Verdict:** \`${s.verdict}\` · pass rate **${s.pass_rate_pct}%** (${s.passed_within_tolerance}/${s.archetypes_with_anchor} archetypes)`);
  lines.push('');
  lines.push(`Generated ${r.meta.generated_at} · seed \`${r.meta.seed}\` · ${r.meta.n_per_rate} agents × 2 rate levels × ${r.meta.archetypes_tested.length} archetypes · elapsed ${elapsed_s}s`);
  lines.push('');
  lines.push('## Methodology');
  lines.push('');
  lines.push('For each archetype, a homogeneous cohort (single-archetype override) was exposed to two rate levels straddling the archetype\'s sweet-spot — low = 0.75× sweet, high = 1.25× sweet. The empirical own-price elasticity was computed as:');
  lines.push('');
  lines.push('```');
  lines.push('ε = ln(q₂/q₁) / ln(p₂/p₁)');
  lines.push('    q = acceptance_rate, p = rate_eur');
  lines.push('```');
  lines.push('');
  lines.push('Each archetype\'s simulated elasticity is compared against a published range (compiled from peer-reviewed research + industry references). Tolerance band: ±' + (benchmarks.archetype_benchmark_elasticity._tolerance_band_pp || 0.35) + '.');
  lines.push('');
  lines.push('**Verdict codes:**');
  lines.push('- `in_range` — empirical ε falls within the published range (strict match)');
  lines.push('- `within_tolerance` — empirical ε outside range but within ±tolerance of midpoint (accepted match)');
  lines.push('- `fail` — outside both');
  lines.push('- `no_anchor` — no benchmark available for this archetype');
  lines.push('');
  lines.push('## Summary');
  lines.push('');
  lines.push('| Metric | Value |');
  lines.push('|---|---|');
  lines.push(`| Archetypes with benchmark anchor | ${s.archetypes_with_anchor} |`);
  lines.push(`| Strict in-range matches | ${s.strict_in_range} (${s.strict_match_rate_pct}%) |`);
  lines.push(`| Passes (in-range + within-tolerance) | ${s.passed_within_tolerance} (${s.pass_rate_pct}%) |`);
  lines.push(`| Mean absolute error (ε units) | ${s.mean_abs_error} |`);
  lines.push(`| **Composite verdict** | **${s.verdict}** |`);
  lines.push('');
  lines.push('## Per-archetype results');
  lines.push('');
  lines.push('| Archetype | Low rate | High rate | Accept@low | Accept@high | Sim ε | Benchmark ε | Range | Δ | Verdict |');
  lines.push('|---|---|---|---|---|---|---|---|---|---|');
  for (const a of r.per_archetype) {
    const mark = a.verdict === 'in_range' ? '✅ in_range'
      : a.verdict === 'within_tolerance' ? '≈ within_tolerance'
      : a.verdict === 'no_anchor' ? '— no_anchor'
      : '❌ fail';
    const range = a.benchmark_range ? `[${a.benchmark_range[0]}, ${a.benchmark_range[1]}]` : 'n/a';
    lines.push(`| ${a.archetype} | €${a.p_low} | €${a.p_high} | ${a.low_rate.acceptance_pct}% | ${a.high_rate.acceptance_pct}% | ${a.empirical_elasticity ?? 'n/a'} | ${a.benchmark_value ?? 'n/a'} | ${range} | ${a.abs_delta ?? 'n/a'} | ${mark} |`);
  }
  lines.push('');
  lines.push('## Benchmark provenance');
  lines.push('');
  for (const [id, s2] of Object.entries(benchmarks.sources || {})) {
    const cls = s2.confidence ? ` · confidence ${s2.confidence}` : '';
    lines.push(`- **${s2.label}**${cls}`);
    if (s2.url) lines.push(`  - ${s2.url}`);
    if (s2.finding) lines.push(`  - Finding: ${s2.finding}`);
  }
  lines.push('');
  lines.push('## Interpretation');
  lines.push('');
  if (s.pass_rate_pct >= 70) {
    lines.push('The simulation\'s per-archetype elasticity coefficients are consistent with the published academic/industry consensus. The model responds to price changes with the expected segment-specific sensitivity — luxury archetypes remain price-inelastic, solo/budget archetypes show the highest elasticity, families sit in the middle.');
  } else if (s.pass_rate_pct >= 50) {
    lines.push('The simulation partially matches the published consensus. Most archetypes are directionally correct but some need tighter calibration. Review the `fail` rows above.');
  } else {
    lines.push('The simulation\'s elasticity profile does not match the published consensus. This indicates systematic miscalibration of the rate-stage model and should be addressed before using for revenue-management decisions.');
  }
  lines.push('');
  lines.push('## Reproducibility');
  lines.push('');
  lines.push('```bash');
  lines.push(`USE_SYNTH=true SEED=${r.meta.seed} N_PER_RATE=${r.meta.n_per_rate} \\`);
  lines.push('  node scripts/elasticity_backtest_archetypes.js');
  lines.push('```');
  lines.push('');
  lines.push(`Machine-readable: \`${path.relative(path.join(__dirname, '..'), jsonPath)}\``);
  lines.push('');
  return lines.join('\n');
}

main().catch(err => {
  console.error('Elasticity backtest failed:', err);
  console.error(err.stack);
  process.exit(1);
});
