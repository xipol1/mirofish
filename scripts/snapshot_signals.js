#!/usr/bin/env node
/**
 * Capture a named snapshot of the current empirical signals state.
 *
 * Usage:
 *   node scripts/snapshot_signals.js --label=baseline [--note="post-HF-ingest"]
 *
 * Call this after every major corpus refresh (new HF pull, new scrape, or
 * signals extractor logic change). The `baseline` label is the canonical
 * reference for drift checks.
 */

const path = require('path');
const ROOT = path.join(__dirname, '..');
const { captureSnapshot } = require(path.join(ROOT, 'backend', 'services', 'data', 'drift-monitor'));

const argv = Object.fromEntries(process.argv.slice(2).map(a => {
  if (a.startsWith('--') && a.includes('=')) { const [k, v] = a.slice(2).split('='); return [k, v]; }
  if (a.startsWith('--')) return [a.slice(2), true];
  return [a, true];
}));

const label = argv.label || 'manual';
const note = argv.note || null;

const { snapshot, file } = captureSnapshot({ label, note });
console.log(`✓ Snapshot captured: ${file}`);
console.log(`  label:          ${snapshot._label}`);
console.log(`  captured_at:    ${snapshot._captured_at}`);
console.log(`  cluster_count:  ${snapshot._corpus.cluster_count}`);
console.log(`  reviews_in:     ${snapshot._corpus.total_reviews_in}`);
console.log(`  archetypes:     ${Object.keys(snapshot.archetypes).length}`);
