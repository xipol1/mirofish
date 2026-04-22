#!/usr/bin/env node
/**
 * Dignus corpus CLI ingest.
 *
 * Usage:
 *   node scripts/ingest_dignus_corpus.js --manifest=path/to/manifest.json [--dry-run] [--no-db]
 *   node scripts/ingest_dignus_corpus.js --directory=./corpora         (auto-discovers *.manifest.json)
 *
 * Flags:
 *   --manifest=<path>   single manifest to run
 *   --directory=<path>  directory containing *.manifest.json files
 *   --dry-run           do not persist to DB or overwrite calibration files
 *   --no-db             skip DB persistence even if PG_AVAILABLE
 *   --verbose           extra per-property logs
 *
 * Exit codes:
 *   0 — at least one property ingested with verdict OK/WATCH
 *   1 — hard fatal (manifest missing, schema broken)
 *   2 — all properties returned BLOCK
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const argv = Object.fromEntries(process.argv.slice(2).map(a => {
  if (a.startsWith('--') && a.includes('=')) { const [k, v] = a.slice(2).split('='); return [k, v]; }
  if (a.startsWith('--')) return [a.slice(2), true];
  return [a, true];
}));

async function main() {
  const manifestPath = argv.manifest;
  const dirPath = argv.directory;
  if (!manifestPath && !dirPath) {
    console.error('Error: pass --manifest=<path> or --directory=<dir>');
    process.exit(1);
  }

  // Lazy-require to get helpful error if module path wrong
  const { ingestManifest } = require(path.join(ROOT, 'backend', 'services', 'data', 'dignus-ingest'));
  let db = null;
  if (!argv['no-db']) {
    try { db = require(path.join(ROOT, 'backend', 'db', 'pg')); } catch (e) { /* optional */ }
  }

  const manifests = [];
  if (manifestPath) {
    const abs = path.isAbsolute(manifestPath) ? manifestPath : path.join(process.cwd(), manifestPath);
    manifests.push({ path: abs, data: JSON.parse(fs.readFileSync(abs, 'utf8')) });
  } else {
    const abs = path.isAbsolute(dirPath) ? dirPath : path.join(process.cwd(), dirPath);
    if (!fs.existsSync(abs)) { console.error(`Directory not found: ${abs}`); process.exit(1); }
    const files = fs.readdirSync(abs).filter(f => f.endsWith('.manifest.json'));
    if (files.length === 0) { console.error(`No *.manifest.json found in ${abs}`); process.exit(1); }
    for (const f of files) {
      const p = path.join(abs, f);
      manifests.push({ path: p, data: JSON.parse(fs.readFileSync(p, 'utf8')) });
    }
  }

  const allVerdicts = [];
  for (const { path: p, data } of manifests) {
    console.log(`\n▶ Running ${path.basename(p)} (${data.properties?.length || 0} properties)`);
    const report = await ingestManifest(data, {
      dry_run: Boolean(argv['dry-run']),
      db: db?.PG_AVAILABLE ? db : null,
      logger: argv.verbose ? console : { log: (...a) => process.stdout.write(a.join(' ') + '\n'), warn: console.warn },
    });
    console.log(`   Verdict counts:`, report.verdict_counts);
    for (const p of report.properties) {
      console.log(`     - ${p.slug}: ${p.verdict} · ${p.review_count} reviews · avg ${p.avg_rating ?? '—'}★`);
      allVerdicts.push(p.verdict);
    }
  }

  if (allVerdicts.length === 0) { console.error('No properties processed.'); process.exit(1); }
  if (allVerdicts.every(v => v === 'BLOCK')) { console.error('All properties BLOCKED by drift gate.'); process.exit(2); }
  console.log('\nDone.');
}

main().catch(err => {
  console.error('FATAL:', err.stack || err.message);
  process.exit(1);
});
