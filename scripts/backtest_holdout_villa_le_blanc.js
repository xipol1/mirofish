#!/usr/bin/env node
/**
 * Blind Holdout Backtest — Villa Le Blanc
 *
 * Methodology (ML-style cross-validation, not temporal):
 *   1. Deterministic stratified split of the review corpus (60% train / 40% test),
 *      seeded for reproducibility.
 *   2. Rebuild calibration signals from the TRAIN split only.
 *   3. Run the full stay simulation with that reduced calibration (synth mode
 *      for deterministic, offline execution — no Anthropic call, no network).
 *   4. Score the predicted review distribution against the held-out TEST split.
 *
 * Outputs:
 *   - backend/data/backtest_runs/villa_le_blanc_holdout_<ts>.json   (machine-readable)
 *   - backend/data/backtest_runs/villa_le_blanc_holdout_<ts>.md     (pitch artifact)
 *
 * Usage:
 *   USE_SYNTH=true node scripts/backtest_holdout_villa_le_blanc.js
 *
 * Env:
 *   USE_SYNTH=true       (default set inside — forces deterministic synth provider)
 *   AGENT_COUNT=60       (override n_agents)
 *   TRAIN_RATIO=0.6
 *   SEED=villa-2026-04-19
 */

process.env.USE_SYNTH = process.env.USE_SYNTH || 'true';

const fs = require('fs');
const path = require('path');
const { runBacktest } = require('../backend/services/enterprise/backtest-engine');

const REVIEWS_PATH = path.join(__dirname, '..', 'backend', 'data', 'industries', 'hospitality', 'sample_reviews_villa_le_blanc.json');
const CALIBRATION_PATH = path.join(__dirname, '..', 'backend', 'data', 'industries', 'hospitality', 'villa_le_blanc_calibration.json');
const OUT_DIR = path.join(__dirname, '..', 'backend', 'data', 'backtest_runs');

const AGENT_COUNT = parseInt(process.env.AGENT_COUNT, 10) || 60;
const TRAIN_RATIO = parseFloat(process.env.TRAIN_RATIO) || 0.6;
const SEED = process.env.SEED || 'villa-le-blanc-2026-04-19';

async function main() {
  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

  const reviewsFile = JSON.parse(fs.readFileSync(REVIEWS_PATH, 'utf-8'));
  const baseCalibration = JSON.parse(fs.readFileSync(CALIBRATION_PATH, 'utf-8'));
  const reviews = reviewsFile.reviews || [];

  const property = {
    name: baseCalibration.property_name || 'Gran Meliá Villa Le Blanc',
    brand: 'Gran Meliá',
    slug: baseCalibration.property_slug || 'gran-melia-villa-le-blanc',
    data_json: {
      identity: {
        tier: 'luxury',
        stars: 5,
        brand: 'Gran Meliá',
        location: 'Menorca, Spain',
      },
    },
  };

  const audience = 'luxury couples, honeymooners, and affluent leisure travelers visiting Menorca for a design-led 5-star resort experience';

  console.log('─'.repeat(72));
  console.log('Blind Holdout Backtest — Villa Le Blanc');
  console.log('─'.repeat(72));
  console.log(`reviews       : ${reviews.length} from ${path.basename(REVIEWS_PATH)}`);
  console.log(`train ratio   : ${TRAIN_RATIO}`);
  console.log(`agent count   : ${AGENT_COUNT}`);
  console.log(`seed          : ${SEED}`);
  console.log(`provider      : ${process.env.USE_SYNTH === 'true' ? 'synth (deterministic, offline)' : 'default'}`);
  console.log('─'.repeat(72));

  const t0 = Date.now();
  const report = await runBacktest({
    reviews,
    property,
    baseCalibration,
    audience,
    trainRatio: TRAIN_RATIO,
    agentCount: AGENT_COUNT,
    seed: SEED,
    onProgress: (e) => {
      if (e.message) console.log(`[${e.phase}] ${e.message}`);
    },
  });

  const elapsed_s = ((Date.now() - t0) / 1000).toFixed(1);

  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const jsonOut = path.join(OUT_DIR, `villa_le_blanc_holdout_${ts}.json`);
  const mdOut = path.join(OUT_DIR, `villa_le_blanc_holdout_${ts}.md`);

  fs.writeFileSync(jsonOut, JSON.stringify(report, null, 2));
  fs.writeFileSync(mdOut, buildMarkdown(report, { jsonPath: jsonOut, elapsed_s }));

  console.log('');
  console.log('─'.repeat(72));
  console.log('RESULT');
  console.log('─'.repeat(72));
  console.log(`composite accuracy : ${report.scores.composite.accuracy_pct}%   → ${report.scores.verdict}`);
  console.log(`  star distribution   : ${(report.scores.star_distribution.similarity * 100).toFixed(1)}%   (L1=${report.scores.star_distribution.l1_distance_pct})`);
  console.log(`  avg rating          : ${(report.scores.avg_rating.similarity * 100).toFixed(1)}%   (Δ=${report.scores.avg_rating.abs_delta})`);
  console.log(`  top +themes F1      : ${(report.scores.top_positive_themes.f1 * 100).toFixed(1)}%   (${report.scores.top_positive_themes.matched.length} matched)`);
  console.log(`  top −themes F1      : ${(report.scores.top_negative_themes.f1 * 100).toFixed(1)}%   (${report.scores.top_negative_themes.matched.length} matched)`);
  console.log(`  sentiment           : ${(report.scores.sentiment_distribution.similarity * 100).toFixed(1)}%`);
  console.log('');
  console.log(`wrote: ${path.relative(process.cwd(), jsonOut)}`);
  console.log(`wrote: ${path.relative(process.cwd(), mdOut)}`);
  console.log(`elapsed: ${elapsed_s}s`);
}

function buildMarkdown(r, { jsonPath, elapsed_s }) {
  const s = r.scores;
  const lines = [];

  lines.push(`# Blind Holdout Backtest — ${r.meta.property_name}`);
  lines.push('');
  lines.push(`**Verdict:** \`${s.verdict}\` (composite accuracy **${s.composite.accuracy_pct}%**)`);
  lines.push('');
  lines.push(`Generated ${r.meta.generated_at} · seed \`${r.meta.seed}\` · elapsed ${elapsed_s}s`);
  lines.push('');
  lines.push('## Methodology');
  lines.push('');
  lines.push(`This is a **cross-validation style holdout test**, not a temporal forecast. The review corpus (${r.split.total_reviews} reviews) was deterministically split ${Math.round(r.meta.train_ratio * 100)}/${Math.round((1 - r.meta.train_ratio) * 100)} stratified by source (TripAdvisor / Booking / Google). The simulation was then run using calibration signals derived **only from the training split** (${r.split.train_size} reviews). The predicted review distribution was compared against the held-out test split (${r.split.test_size} reviews) on five axes.`);
  lines.push('');
  lines.push('**What this proves:** given partial evidence, the simulation reconstructs the same guest-experience shape as the held-out reviews.');
  lines.push('');
  lines.push('**What this does not prove:** forward temporal prediction (reviews lack timestamps) nor cross-property transfer (separate module).');
  lines.push('');
  lines.push('## Headline metrics');
  lines.push('');
  lines.push('| Axis | Accuracy | Detail |');
  lines.push('|---|---|---|');
  lines.push(`| Star distribution | **${(s.star_distribution.similarity * 100).toFixed(1)}%** | L1 distance ${s.star_distribution.l1_distance_pct} pp |`);
  lines.push(`| Average rating | **${(s.avg_rating.similarity * 100).toFixed(1)}%** | predicted ${s.avg_rating.predicted} vs actual ${s.avg_rating.actual} (Δ ${s.avg_rating.abs_delta}) |`);
  lines.push(`| Top positive themes F1 | **${(s.top_positive_themes.f1 * 100).toFixed(1)}%** | P=${(s.top_positive_themes.precision * 100).toFixed(0)}% R=${(s.top_positive_themes.recall * 100).toFixed(0)}% |`);
  lines.push(`| Top negative themes F1 | **${(s.top_negative_themes.f1 * 100).toFixed(1)}%** | P=${(s.top_negative_themes.precision * 100).toFixed(0)}% R=${(s.top_negative_themes.recall * 100).toFixed(0)}% |`);
  lines.push(`| Sentiment distribution | **${(s.sentiment_distribution.similarity * 100).toFixed(1)}%** | L1 ${s.sentiment_distribution.l1_distance_pct ?? 'n/a'} pp |`);
  lines.push(`| **Composite** | **${s.composite.accuracy_pct}%** | weighted (star .30, rating .20, +themes .20, −themes .20, sentiment .10) |`);
  lines.push('');
  lines.push('## Star distribution — predicted vs held-out');
  lines.push('');
  lines.push('| Stars | Predicted % | Actual % | Δ |');
  lines.push('|---|---|---|---|');
  for (const k of ['5', '4', '3', '2', '1']) {
    const p = r.predicted_aggregation.star_distribution_pct?.[k] ?? 0;
    const a = r.actual_aggregation.star_distribution_pct?.[k] ?? 0;
    const d = s.star_distribution.per_bucket_abs_delta_pct[k];
    lines.push(`| ${k}★ | ${p}% | ${a}% | ${d} pp |`);
  }
  lines.push('');
  lines.push('## Top positive themes');
  lines.push('');
  lines.push(`- **Matched (correctly predicted):** ${fmt(s.top_positive_themes.matched)}`);
  lines.push(`- **Missed (in test, not predicted):** ${fmt(s.top_positive_themes.missed)}`);
  lines.push(`- **Extra (predicted, not in test):** ${fmt(s.top_positive_themes.extra)}`);
  lines.push('');
  lines.push('## Top negative themes');
  lines.push('');
  lines.push(`- **Matched (complaints we correctly predicted):** ${fmt(s.top_negative_themes.matched)}`);
  lines.push(`- **Missed (complaints in test, not predicted):** ${fmt(s.top_negative_themes.missed)}`);
  lines.push(`- **Extra (predicted complaints not in test):** ${fmt(s.top_negative_themes.extra)}`);
  lines.push('');
  lines.push('## Sentiment distribution');
  lines.push('');
  if (s.sentiment_distribution.predicted_pct) {
    lines.push('| Bucket | Predicted % | Actual % |');
    lines.push('|---|---|---|');
    for (const k of ['positive', 'mixed', 'negative']) {
      lines.push(`| ${k} | ${s.sentiment_distribution.predicted_pct[k]}% | ${s.sentiment_distribution.actual_pct[k]}% |`);
    }
  } else {
    lines.push('_sentiment distribution unavailable (insufficient predicted reviews)_');
  }
  lines.push('');
  lines.push('## Split audit');
  lines.push('');
  lines.push('| Source | Total | Train | Test |');
  lines.push('|---|---|---|---|');
  for (const [src, cnt] of Object.entries(r.split.stratification)) {
    lines.push(`| ${src} | ${cnt.total} | ${cnt.train} | ${cnt.test} |`);
  }
  lines.push('');
  lines.push('## Simulation summary');
  lines.push('');
  lines.push(`- Provider: \`${r.sim_summary.provider}\``);
  lines.push(`- Total stays: ${r.sim_summary.total_stays}`);
  lines.push(`- Review writers: ${r.sim_summary.review_writers} (write rate ${r.sim_summary.write_rate_pct}%)`);
  lines.push(`- Avg predicted stars: ${r.sim_summary.avg_stars}`);
  lines.push(`- Avg predicted NPS: ${r.sim_summary.avg_nps}`);
  lines.push('');
  lines.push('## Reproducibility');
  lines.push('');
  lines.push('```bash');
  lines.push(`USE_SYNTH=true SEED=${r.meta.seed} TRAIN_RATIO=${r.meta.train_ratio} AGENT_COUNT=${r.meta.agent_count} \\`);
  lines.push('  node scripts/backtest_holdout_villa_le_blanc.js');
  lines.push('```');
  lines.push('');
  lines.push(`Machine-readable report: \`${path.relative(path.join(__dirname, '..'), jsonPath)}\``);
  lines.push('');
  return lines.join('\n');
}

function fmt(arr) {
  if (!arr || arr.length === 0) return '_(none)_';
  return arr.map(t => `\`${t}\``).join(', ');
}

main().catch(err => {
  console.error('Backtest failed:', err);
  process.exit(1);
});
