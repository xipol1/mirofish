#!/usr/bin/env node
/**
 * Check empirical signals for drift vs. a baseline snapshot.
 *
 * Exit codes:
 *   0 — OK
 *   1 — WATCH (soft — ship, but CI should log)
 *   2 — ALERT (hard — block deploys, page compliance)
 *
 * Usage:
 *   node scripts/check_drift.js [--baseline=baseline] [--fail-on-watch]
 *
 * The `--fail-on-watch` flag treats WATCH as a hard fail (useful in
 * stricter CI branches). Default is only ALERT breaks the build.
 *
 * Writes an immutable audit record to
 * backend/data/dignus_corpus/drift_audit/ on every run.
 */

const path = require('path');
const ROOT = path.join(__dirname, '..');
const { runCheck } = require(path.join(ROOT, 'backend', 'services', 'data', 'drift-monitor'));

const argv = Object.fromEntries(process.argv.slice(2).map(a => {
  if (a.startsWith('--') && a.includes('=')) { const [k, v] = a.slice(2).split('='); return [k, v]; }
  if (a.startsWith('--')) return [a.slice(2), true];
  return [a, true];
}));

const result = runCheck({
  baselineLabel: argv.baseline || 'baseline',
  triggered_by: argv.ci ? 'ci' : 'cli',
  actor: process.env.USER || process.env.USERNAME || 'unknown',
});

const icon = { OK: '✓', WATCH: '⚠', ALERT: '✗' }[result.verdict] || '?';
console.log(`\n${icon} Drift verdict: ${result.verdict}`);
console.log(`  baseline_file:  ${result.baseline_file || '(none yet — capture baseline first)'}`);
console.log(`  audit_file:     ${result.audit_file}`);
console.log(`  findings:       ${result.summary.findings_count} (${result.summary.alert_count} ALERT, ${result.summary.watch_count} WATCH)`);
console.log(`  archetypes compared: ${result.summary.archetypes_compared || 0}`);

if (result.findings.length > 0) {
  console.log('\nFindings:');
  for (const f of result.findings.slice(0, 10)) {
    const line = f.kind === 'signal_drift'
      ? `  [${f.severity}] ${f.archetype}.${f.signal}: ${f.baseline?.toFixed(3)} → ${f.candidate?.toFixed(3)} (Δ=${f.delta_pp}pp, th=${f.threshold_pp}pp)`
      : `  [${f.severity}] ${f.kind}: ${JSON.stringify(f).slice(0, 160)}`;
    console.log(line);
  }
  if (result.findings.length > 10) console.log(`  … (${result.findings.length - 10} more in the audit file)`);
}

const code = result.verdict === 'ALERT' ? 2
  : (result.verdict === 'WATCH' && argv['fail-on-watch']) ? 1
  : 0;
process.exit(code);
