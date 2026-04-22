/**
 * Dignus routes — multi-property, multi-source ingest + audit endpoints.
 * Mounted at /api/dignus/* by server.js.
 *
 *   POST /api/dignus/ingest       run an ingest manifest (dry_run by default)
 *   POST /api/dignus/filter       stateless filter preview — paste rows, see stats
 *   GET  /api/dignus/corpus       list corpus audit reports on disk
 *   GET  /api/dignus/corpus/:id   full manifest report for a corpus run
 *   GET  /api/dignus/properties   list calibrated properties (from disk)
 *   GET  /api/dignus/health       returns module status + filter defaults
 */

const express = require('express');
const fs = require('fs');
const path = require('path');

const router = express.Router();

const HOSPITALITY_DIR = path.join(__dirname, '..', 'data', 'industries', 'hospitality');
const CORPUS_DIR = path.join(__dirname, '..', 'data', 'dignus_corpus');

let ingest = null, filtersMod = null, guardMod = null, db = null;
try { ingest = require('../services/data/dignus-ingest'); } catch (e) { /* optional at boot */ }
try { filtersMod = require('../services/data/calibration-filters'); } catch (e) { /* */ }
try { guardMod = require('../services/data/calibration-guard'); } catch (e) { /* */ }
try { db = require('../db/pg'); } catch (e) { /* */ }

// ─── Health ─────────────────────────────────────────────────────────────────
router.get('/health', (req, res) => {
  res.json({
    ok: true,
    modules: {
      dignus_ingest: Boolean(ingest),
      calibration_filters: Boolean(filtersMod),
      calibration_guard: Boolean(guardMod),
      pg: Boolean(db?.PG_AVAILABLE),
    },
    filter_defaults: filtersMod?.DEFAULT_OPTS || null,
    guard_defaults: guardMod?.DEFAULT_BANDS || null,
  });
});

// ─── Filter preview (stateless) ─────────────────────────────────────────────
router.post('/filter', (req, res) => {
  try {
    const { reviews, filter_opts } = req.body || {};
    if (!Array.isArray(reviews)) return res.status(400).json({ error: 'reviews[] required' });
    const result = filtersMod.filterReviews(reviews, filter_opts || {});
    res.json(result);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── Ingest manifest ────────────────────────────────────────────────────────
/**
 * Body:
 *   { manifest: {...}, dry_run?: boolean, filter_opts?: {}, guard_bands?: {} }
 * or:
 *   { manifest_path: "relative/or/absolute.json", dry_run?: true }
 */
router.post('/ingest', async (req, res) => {
  const { manifest: inlineManifest, manifest_path, dry_run = true, filter_opts = {}, guard_bands = {} } = req.body || {};
  try {
    let manifest = inlineManifest;
    if (!manifest && manifest_path) {
      const abs = path.isAbsolute(manifest_path)
        ? manifest_path
        : path.join(__dirname, '..', '..', manifest_path);
      manifest = JSON.parse(fs.readFileSync(abs, 'utf8'));
    }
    if (!manifest || !Array.isArray(manifest.properties)) {
      return res.status(400).json({ error: 'manifest.properties[] required' });
    }
    const report = await ingest.ingestManifest(manifest, {
      dry_run: Boolean(dry_run),
      filter_opts,
      guard_bands,
      db: db?.PG_AVAILABLE ? db : null,
      logger: {
        log: (...a) => console.log('[dignus-ingest]', ...a),
        warn: (...a) => console.warn('[dignus-ingest]', ...a),
      },
    });
    res.json(report);
  } catch (err) {
    console.error('[dignus-ingest] fatal:', err);
    res.status(500).json({ error: err.message });
  }
});

// ─── List corpus audit reports ──────────────────────────────────────────────
router.get('/corpus', (req, res) => {
  if (!fs.existsSync(CORPUS_DIR)) return res.json({ corpora: [] });
  const dirs = fs.readdirSync(CORPUS_DIR, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => {
      const report = path.join(CORPUS_DIR, d.name, 'manifest-report.json');
      let meta = null;
      try { meta = fs.existsSync(report) ? JSON.parse(fs.readFileSync(report, 'utf8')) : null; } catch (e) { /* */ }
      return {
        corpus_id: d.name,
        generated_at: meta?.generated_at || null,
        property_count: meta?.properties?.length || 0,
        verdict_counts: (meta?.properties || []).reduce((acc, p) => {
          acc[p.verdict] = (acc[p.verdict] || 0) + 1; return acc;
        }, {}),
      };
    });
  res.json({ corpora: dirs.sort((a, b) => (b.generated_at || '').localeCompare(a.generated_at || '')) });
});

router.get('/corpus/:id', (req, res) => {
  const safe = String(req.params.id).replace(/[^a-zA-Z0-9_\-]/g, '');
  const report = path.join(CORPUS_DIR, safe, 'manifest-report.json');
  if (!fs.existsSync(report)) return res.status(404).json({ error: 'corpus not found' });
  try { res.json(JSON.parse(fs.readFileSync(report, 'utf8'))); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── List calibrated properties on disk ─────────────────────────────────────
router.get('/properties', (req, res) => {
  if (!fs.existsSync(HOSPITALITY_DIR)) return res.json({ properties: [] });
  const files = fs.readdirSync(HOSPITALITY_DIR)
    .filter(f => f.endsWith('_calibration.json') || f.endsWith('_calibration.blocked.json'))
    .filter(f => !f.startsWith('review_calibration'));
  const out = files.map(f => {
    try {
      const raw = JSON.parse(fs.readFileSync(path.join(HOSPITALITY_DIR, f), 'utf8'));
      return {
        file: f,
        slug: f.replace(/_calibration(\.blocked)?\.json$/, '').replace(/_/g, '-'),
        blocked: f.endsWith('.blocked.json'),
        name: raw._property?.name || raw.property?.name || null,
        brand: raw._property?.brand || raw.property?.brand || null,
        country: raw._property?.country || raw.property?.location?.country || null,
        tier: raw._property?.tier || raw.property?.tier || null,
        avg_rating: raw.avg_rating || raw._combined_rating_normalized_5 || raw._inferred_star_distribution_pct?._combined_rating_normalized_5 || null,
        review_count: raw.review_count || null,
        generated_at: raw._generated_at || null,
        drift_gate: raw._drift_gate || null,
      };
    } catch (err) { return { file: f, error: err.message.slice(0, 200) }; }
  });
  res.json({ properties: out });
});

// ─── Voice priors (empirical per-archetype × sentiment × lang × star) ──────
router.get('/voice-priors', (req, res) => {
  const file = path.join(HOSPITALITY_DIR, 'voice_priors_from_reviews.json');
  if (!fs.existsSync(file)) return res.status(404).json({ error: 'voice_priors_from_reviews.json not found — run scripts/build_voice_priors.js' });
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    const mode = String(req.query.mode || 'summary');
    if (mode === 'full') return res.json(raw);
    // Summary: cluster key + n + top-5 unigrams only
    const summary = Object.entries(raw.clusters || {}).map(([k, v]) => ({
      cluster_key: k,
      n: v.n,
      archetype: v.archetype,
      sentiment: v.sentiment,
      language: v.language,
      star: v.star,
      top_5_unigrams: (v.top_unigrams || []).slice(0, 5).map(u => u[0]),
      sentence_length_mean: v.sentence_length?.mean ?? null,
      exclaim_mean: v.emotional_intensity?.exclaim_mean ?? null,
    })).sort((a, b) => b.n - a.n);
    res.json({
      _cluster_count: raw._cluster_count,
      _total_reviews_in: raw._total_reviews_in,
      _generated_at: raw._generated_at,
      _source: raw._source,
      summary,
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/voice-priors/:cluster_key', (req, res) => {
  const file = path.join(HOSPITALITY_DIR, 'voice_priors_from_reviews.json');
  if (!fs.existsSync(file)) return res.status(404).json({ error: 'voice priors not built' });
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    const entry = raw.clusters?.[req.params.cluster_key];
    if (!entry) return res.status(404).json({ error: 'cluster_key not found', available_count: Object.keys(raw.clusters || {}).length });
    res.json({ cluster_key: req.params.cluster_key, ...entry });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── Drift monitoring (ENISA-grade audit layer) ────────────────────────────
let driftMod = null;
try { driftMod = require('../services/data/drift-monitor'); } catch (e) { /* optional */ }

router.get('/drift', (req, res) => {
  if (!driftMod) return res.status(500).json({ error: 'drift-monitor module not loaded' });
  try {
    const baselineLabel = req.query.baseline || 'baseline';
    const result = driftMod.runCheck({
      baselineLabel,
      triggered_by: 'api',
      actor: req.headers['x-actor'] || 'anonymous',
    });
    res.json(result);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/drift/snapshots', (req, res) => {
  if (!driftMod) return res.status(500).json({ error: 'drift-monitor module not loaded' });
  try { res.json({ snapshots: driftMod.listSnapshots() }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/drift/snapshots', (req, res) => {
  if (!driftMod) return res.status(500).json({ error: 'drift-monitor module not loaded' });
  try {
    const { label = 'manual', note = null } = req.body || {};
    const { snapshot, file } = driftMod.captureSnapshot({ label, note });
    res.json({
      ok: true,
      file: path.basename(file),
      captured_at: snapshot._captured_at,
      label: snapshot._label,
      cluster_count: snapshot._corpus.cluster_count,
      archetypes: Object.keys(snapshot.archetypes).length,
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/drift/audit', (req, res) => {
  if (!driftMod) return res.status(500).json({ error: 'drift-monitor module not loaded' });
  try {
    const limit = Math.min(Number(req.query.limit) || 20, 100);
    res.json({ audit_records: driftMod.listAuditRecords({ limit }) });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── Promote a BLOCKED calibration (after consultant review) ────────────────
router.post('/properties/:slug/promote', (req, res) => {
  const safe = String(req.params.slug).replace(/[^a-zA-Z0-9_\-]/g, '');
  const blocked = path.join(HOSPITALITY_DIR, `${safe}_calibration.blocked.json`);
  const target = path.join(HOSPITALITY_DIR, `${safe}_calibration.json`);
  if (!fs.existsSync(blocked)) return res.status(404).json({ error: 'no blocked calibration found' });
  try {
    fs.renameSync(blocked, target);
    res.json({ ok: true, promoted_from: path.basename(blocked), promoted_to: path.basename(target) });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
