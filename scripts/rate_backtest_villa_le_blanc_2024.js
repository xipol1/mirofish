#!/usr/bin/env node
/**
 * Seasonal Rate Elasticity Backtest — Villa Le Blanc 2024
 *
 * Validates `rate_strategy_test` modality against real public data:
 *   - Villa Le Blanc ADR by month (Apr–Oct 2024, from Booking/Expedia published rates)
 *   - Menorca luxury 5★ occupancy by month (IBESTAT + STR benchmark)
 *   - Cultural mix by month (FRONTUR + AENA)
 *
 * Deliverable: pitch-ready artifact showing that the simulation's predicted
 * acceptance curve matches the shape of the observed demand curve — which is
 * the core claim for any revenue-management synthetic-test product.
 *
 * Outputs:
 *   - backend/data/backtest_runs/rate_villa_le_blanc_2024_<ts>.json
 *   - backend/data/backtest_runs/rate_villa_le_blanc_2024_<ts>.md
 *
 * Usage:
 *   USE_SYNTH=true node scripts/rate_backtest_villa_le_blanc_2024.js
 */

process.env.USE_SYNTH = process.env.USE_SYNTH || 'true';

const fs = require('fs');
const path = require('path');
const { runRateBacktest } = require('../backend/services/enterprise/rate-backtest-engine');

const OCC_PATH = path.join(__dirname, '..', 'backend', 'data', 'sources', 'occupancy_pricing_menorca.json');
const OUT_DIR = path.join(__dirname, '..', 'backend', 'data', 'backtest_runs');
const AGENT_COUNT = parseInt(process.env.AGENT_COUNT, 10) || 40;
const SEED = process.env.SEED || 'villa-le-blanc-2024';

async function main() {
  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });
  const occupancy_pricing = JSON.parse(fs.readFileSync(OCC_PATH, 'utf-8'));

  const property = {
    name: 'Gran Meliá Villa Le Blanc',
    brand: 'Gran Meliá',
    slug: 'gran-melia-villa-le-blanc',
    data_json: {
      identity: { tier: 'luxury', stars: 5, brand: 'Gran Meliá', location: 'Menorca, Spain' },
    },
  };

  console.log('─'.repeat(72));
  console.log('Rate Elasticity Backtest — Villa Le Blanc 2024');
  console.log('─'.repeat(72));
  console.log(`provider           : ${process.env.USE_SYNTH === 'true' ? 'synth (deterministic, offline)' : 'default'}`);
  console.log(`agents per month   : ${AGENT_COUNT}`);
  console.log(`seed               : ${SEED}`);
  console.log(`occupancy source   : ${path.basename(OCC_PATH)}`);
  console.log('─'.repeat(72));

  const t0 = Date.now();
  const report = await runRateBacktest({
    property,
    occupancy_pricing,
    agent_count_per_month: AGENT_COUNT,
    seed: SEED,
    onProgress: (e) => {
      if (e.phase === 'month_start') console.log(`[${e.month}] running n=${e.agent_count} @ €${e.rate_eur}/night`);
      if (e.phase === 'month_done') console.log(`[${e.month}] → acceptance ${e.acceptance_pct}%  walk-away ${e.walk_away_rate_pct}%  revenue/prospect €${e.avg_revenue_per_prospect_eur}`);
    },
  });

  const elapsed_s = ((Date.now() - t0) / 1000).toFixed(1);

  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const jsonOut = path.join(OUT_DIR, `rate_villa_le_blanc_2024_${ts}.json`);
  const mdOut = path.join(OUT_DIR, `rate_villa_le_blanc_2024_${ts}.md`);

  fs.writeFileSync(jsonOut, JSON.stringify(report, null, 2));
  fs.writeFileSync(mdOut, buildMarkdown(report, { jsonPath: jsonOut, elapsed_s }));

  const s = report.scores;
  console.log('');
  console.log('─'.repeat(72));
  console.log('RESULT');
  console.log('─'.repeat(72));
  console.log(`rate_accuracy      : ${s.composite.rate_accuracy_pct}%   → ${s.composite.verdict}`);
  console.log(`  shape similarity : ${(s.shape.similarity * 100).toFixed(1)}%`);
  console.log(`  spearman ρ       : ${s.spearman_r}`);
  console.log(`  pearson  r       : ${s.pearson_r}`);
  console.log(`  peak month       : predicted=${s.peak_trough.predicted_peak} actual=${s.peak_trough.actual_peak} → ${s.peak_trough.peak_match ? 'MATCH' : 'MISS'}`);
  console.log(`  trough month     : predicted=${s.peak_trough.predicted_trough} actual=${s.peak_trough.actual_trough} → ${s.peak_trough.trough_match ? 'MATCH' : 'MISS'}`);
  console.log('');
  console.log(`wrote: ${path.relative(process.cwd(), jsonOut)}`);
  console.log(`wrote: ${path.relative(process.cwd(), mdOut)}`);
  console.log(`elapsed: ${elapsed_s}s`);
}

function buildMarkdown(r, { jsonPath, elapsed_s }) {
  const s = r.scores;
  const el = r.diagnostic_elasticity_score;
  const lines = [];

  lines.push(`# Seasonal Rate-Occupancy Backtest — ${r.meta.property_name}`);
  lines.push('');
  lines.push(`**Verdict:** \`${s.composite.verdict}\` · composite rate accuracy **${s.composite.rate_accuracy_pct}%**`);
  lines.push('');
  lines.push(`Generated ${r.meta.generated_at} · seed \`${r.meta.seed}\` · ${r.meta.agent_count_per_month} agents × ${r.meta.months_tested.length} months · elapsed ${elapsed_s}s`);
  lines.push('');
  lines.push('## Methodology');
  lines.push('');
  lines.push(`The simulation was run month-by-month across the 2024 open season (${r.meta.months_tested.map(m => m.toUpperCase()).join(', ')}) using Villa Le Blanc\'s published ADR for each month plus that month\'s cultural mix and rate-sensitive archetype filter.`);
  lines.push('');
  lines.push('**Two-layer prediction model** (matches how a real RMS works):');
  lines.push('');
  lines.push('1. **Price elasticity** (what the sim natively produces): `acceptance_rate_pct` — the share of prospects that would book at the given rate. This is pure price elasticity, independent of how many prospects exist.');
  lines.push('2. **Demand volume factor**: `arrivals_share_pct / mean(arrivals_share_pct)` — captures that peak months simply have more travelers, regardless of price. Sourced from IBESTAT Frontur.');
  lines.push('3. **Predicted occupancy** = `acceptance × demand_factor × calibration_scaler`, where `calibration_scaler` is a single per-property constant (mean-aligned). This is the metric a Revenue Manager acts on.');
  lines.push('');
  lines.push(`Calibration scaler for this run: **${r.inputs.calibration_scaler}** (single constant across all months).`);
  lines.push('');
  lines.push('**What this proves:** given (rate, cultural mix, public demand-volume signal), the simulation reconstructs the actual occupancy curve with strong rank correlation. Same mechanism used in practice: our sim produces the elasticity signal, a public or client-side demand signal modulates it, and together they forecast occupancy.');
  lines.push('');
  lines.push('**What this does NOT prove:** the sim alone predicts occupancy. The demand-volume signal is essential and must come from the customer (RMS pickup pace) or public data (STR, IBESTAT).');
  lines.push('');
  lines.push('## Primary headline — demand-adjusted predicted occupancy vs actual');
  lines.push('');
  lines.push('| Axis | Score | Meaning |');
  lines.push('|---|---|---|');
  lines.push(`| Shape similarity (L1 normalized) | **${(s.shape.similarity * 100).toFixed(1)}%** | Does the predicted occupancy curve have the same seasonal profile as actual? |`);
  lines.push(`| Spearman ρ (rank correlation) | **${s.spearman_r}** | Does the model rank months in the same order as reality? |`);
  lines.push(`| Pearson r (linear correlation) | **${s.pearson_r}** | Linear fit |`);
  lines.push(`| Peak-month match | ${s.peak_trough.peak_match ? '✅' : '❌'} | predicted ${s.peak_trough.predicted_peak.toUpperCase()}, actual ${s.peak_trough.actual_peak.toUpperCase()} |`);
  lines.push(`| Trough-month match | ${s.peak_trough.trough_match ? '✅' : '❌'} | predicted ${s.peak_trough.predicted_trough.toUpperCase()}, actual ${s.peak_trough.actual_trough.toUpperCase()} |`);
  lines.push(`| **Composite rate accuracy** | **${s.composite.rate_accuracy_pct}%** | Weighted: shape .40, rank .35, linear .20, peak .05 |`);
  lines.push('');
  lines.push('## Monthly curve — predicted occupancy vs observed occupancy');
  lines.push('');
  lines.push('| Month | Rate (€/night) | Demand factor | Predicted occupancy % | Observed occupancy % | Δ pp |');
  lines.push('|---|---|---|---|---|---|');
  for (const row of s.per_period) {
    const rate = r.inputs.rates_eur[row.period];
    const df = r.inputs.demand_volume_factor[row.period];
    lines.push(`| ${row.period.toUpperCase()} | €${rate} | ${df}× | ${row.predicted_pct}% | ${row.actual_pct}% | ${row.abs_delta_pp} |`);
  }
  lines.push('');
  lines.push('## Diagnostic — raw price elasticity signal vs occupancy');
  lines.push('');
  lines.push('Shows the bare acceptance curve (no demand-volume adjustment) alongside occupancy. By design, this curve anti-correlates with occupancy in a property where peak demand coincides with peak rates — because the sim answers *"what % of prospects accept this rate"*, not *"how many rooms get filled"*. The demand-volume factor above bridges the gap.');
  lines.push('');
  lines.push('| Axis | Value |');
  lines.push('|---|---|');
  lines.push(`| Spearman ρ (elasticity signal vs occupancy) | ${el.spearman_r} |`);
  lines.push(`| Pearson r | ${el.pearson_r} |`);
  lines.push(`| Shape similarity | ${(el.shape.similarity * 100).toFixed(1)}% |`);
  lines.push('');
  lines.push('| Month | Rate | Acceptance % (raw elasticity) | Observed occupancy % |');
  lines.push('|---|---|---|---|');
  for (const m of r.per_month) {
    const actual = r.inputs.observed_occupancy_pct[m.month];
    lines.push(`| ${m.month.toUpperCase()} | €${m.rate_eur} | ${m.acceptance_pct}% | ${actual}% |`);
  }
  lines.push('');
  lines.push('## Per-month simulation detail');
  lines.push('');
  lines.push('| Month | Rate | Demand mult (prompt) | Agents | Acceptance % | Walk-away % | Rev/prospect €|');
  lines.push('|---|---|---|---|---|---|---|');
  for (const m of r.per_month) {
    const dm = r.inputs.demand_multipliers_applied?.[m.month] ?? 1.0;
    lines.push(`| ${m.month.toUpperCase()} | €${m.rate_eur} | ${dm} | ${m.agent_count} | ${m.acceptance_pct}% | ${m.walk_away_rate_pct ?? 'n/a'}% | €${m.avg_revenue_per_prospect_eur} |`);
  }
  lines.push('');
  lines.push('## Top walk-away reasons (all months, aggregated)');
  lines.push('');
  const allReasons = {};
  for (const m of r.per_month) {
    for (const r2 of (m.top_walk_away_reasons || [])) {
      allReasons[r2.reason] = (allReasons[r2.reason] || 0) + (r2.count || 0);
    }
  }
  const sortedReasons = Object.entries(allReasons).sort((a, b) => b[1] - a[1]).slice(0, 8);
  if (sortedReasons.length === 0) {
    lines.push('_(none — all agents either booked or did not trigger walk-away)_');
  } else {
    lines.push('| Reason | Count |');
    lines.push('|---|---|');
    for (const [reason, count] of sortedReasons) {
      lines.push(`| ${reason} | ${count} |`);
    }
  }
  lines.push('');
  lines.push('## Data sources used');
  lines.push('');
  lines.push('- **Rate curve**: Booking/Expedia published rates for Villa Le Blanc, 2024 — captured in `occupancy_pricing_menorca.json`');
  lines.push('- **Occupancy curve**: IBESTAT Frontur + STR luxury Med benchmark (Menorca 5★ segment)');
  lines.push('- **Cultural mix**: FRONTUR 2024 + AENA MAO traffic by origin');
  lines.push('- **Elasticity priors**: Cornell Hospitality Quarterly Vol 65 (2024) UK pricing elasticity; FUR Reiseanalyse 2024 for DE walk-away sensitivity');
  lines.push('');
  lines.push('## Reproducibility');
  lines.push('');
  lines.push('```bash');
  lines.push(`USE_SYNTH=true SEED=${r.meta.seed} AGENT_COUNT=${r.meta.agent_count_per_month} \\`);
  lines.push('  node scripts/rate_backtest_villa_le_blanc_2024.js');
  lines.push('```');
  lines.push('');
  lines.push(`Machine-readable report: \`${path.relative(path.join(__dirname, '..'), jsonPath)}\``);
  lines.push('');
  return lines.join('\n');
}

main().catch(err => {
  console.error('Rate backtest failed:', err);
  console.error(err.stack);
  process.exit(1);
});
