/**
 * Dignus Ingest Orchestrator — the single entry point for loading multi-
 * property, multi-source review corpora. Dignus drops a manifest in,
 * this module pushes everything through the calibration filters + drift
 * gate, then persists to DB (if available) and writes an audit trail on disk.
 *
 * Manifest shape (either inline or .json on disk):
 *
 * {
 *   "corpus_id": "dignus_q2_2026",
 *   "created_at": "2026-04-22",
 *   "properties": [
 *     {
 *       "slug": "four-seasons-george-v-paris",
 *       "name": "Four Seasons Hotel George V, Paris",
 *       "brand": "Four Seasons",
 *       "tier": "5",
 *       "country": "FR",
 *       "single_culture_property": false,
 *       "expected_cultural_mix": { "anglo_us_canada": 35, "french": 25, ... },
 *       "major_archetypes": ["luxury_seeker","honeymooner","culinary_tourist"],
 *       "sources": [
 *         { "type": "url", "url": "https://www.tripadvisor.com/...", "limit": 200 },
 *         { "type": "file", "path": "./corpora/george-v-booking.json" },
 *         { "type": "inline", "reviews": [ {title, body, rating_numeric, ...} ] },
 *         { "type": "aggregate_public", "data": { avg_rating: 4.8, review_count: 2100, ... } }
 *       ]
 *     }
 *   ]
 * }
 *
 * Behaviour:
 *   - Filters each batch via calibration-filters.filterReviews
 *   - Runs drift gate per property (if baseline exists) via calibration-guard
 *   - In dry_run mode: returns the full report without writing
 *   - In persist mode: inserts into DB (if PG_AVAILABLE) + writes
 *     backend/data/industries/hospitality/{slug}_calibration.json +
 *     backend/data/dignus_corpus/{corpus_id}/manifest-report.json
 */

const fs = require('fs');
const path = require('path');
const { filterReviews } = require('./calibration-filters');
const { runDriftGate, buildCandidate } = require('./calibration-guard');
const { aggregateReviews, toCalibrationSignals } = require('./review-parser');

const HOSPITALITY_DIR = path.join(__dirname, '..', '..', 'data', 'industries', 'hospitality');
const CORPUS_DIR = path.join(__dirname, '..', '..', 'data', 'dignus_corpus');

// ─── Source loaders ──────────────────────────────────────────────────────────

async function loadFromFile(srcPath) {
  const abs = path.isAbsolute(srcPath) ? srcPath : path.join(__dirname, '..', '..', '..', srcPath);
  const raw = JSON.parse(fs.readFileSync(abs, 'utf8'));
  if (Array.isArray(raw)) return raw;
  if (Array.isArray(raw.reviews)) return raw.reviews;
  if (Array.isArray(raw.items)) return raw.items;
  throw new Error(`file ${srcPath} has no recognisable reviews array`);
}

async function loadFromUrl(url, { limit = 100 } = {}) {
  // Delegates to the existing Playwright scraper. Best-effort — if blocked,
  // returns []. The caller decides what to do with an empty batch.
  try {
    const scraper = require('./review-scraper');
    return await scraper.scrape(url, { limit });
  } catch (err) {
    console.warn(`[dignus-ingest] scrape failed for ${url}: ${err.message}`);
    return [];
  }
}

function loadFromInline(reviews) {
  return Array.isArray(reviews) ? reviews : [];
}

/**
 * An "aggregate_public" source carries property-level aggregated signals
 * instead of individual reviews. It is added straight to the calibration
 * file as a fallback anchor (same pattern as Villa Le Blanc's real_corpus).
 */
function loadAggregatePublic(data) {
  return { _aggregate_public: data };
}

// ─── Per-property ingest ─────────────────────────────────────────────────────

async function ingestProperty(propManifest, opts = {}) {
  const {
    dry_run = false,
    filter_opts = {},
    guard_bands = {},
    baselinePath = null,
    logger = console,
  } = opts;

  const slug = propManifest.slug;
  if (!slug) throw new Error('property.slug required');

  logger.log(`\n─── ${slug} (${propManifest.name || ''}) ────────`);
  const rawReviews = [];
  let aggregatePublic = null;
  const sourceReport = [];

  for (const src of propManifest.sources || []) {
    const t0 = Date.now();
    try {
      let batch = [];
      if (src.type === 'file') batch = await loadFromFile(src.path);
      else if (src.type === 'url') batch = await loadFromUrl(src.url, { limit: src.limit || 100 });
      else if (src.type === 'inline') batch = loadFromInline(src.reviews);
      else if (src.type === 'aggregate_public') {
        aggregatePublic = loadAggregatePublic(src.data)._aggregate_public;
        sourceReport.push({ type: src.type, url: src.url || src.path || null, loaded: 1, elapsed_ms: Date.now() - t0, note: 'aggregate_signals_only' });
        continue;
      }
      else throw new Error(`unknown source type: ${src.type}`);

      for (const r of batch) rawReviews.push({ ...r, _source_entry: src.type, _property_slug: slug });
      sourceReport.push({ type: src.type, url: src.url || src.path || null, loaded: batch.length, elapsed_ms: Date.now() - t0 });
    } catch (err) {
      sourceReport.push({ type: src.type, url: src.url || src.path || null, error: err.message.slice(0, 200), elapsed_ms: Date.now() - t0 });
    }
  }

  logger.log(`  Loaded ${rawReviews.length} raw rows across ${sourceReport.length} sources`);

  // ── Filter pass ──────────────────────────────────────────────────────────
  const filterResult = filterReviews(rawReviews, filter_opts);
  logger.log(`  Filtered: ${filterResult.accepted.length} accepted / ${filterResult.rejected.length} rejected`);

  // Build reviewer concentration counts (guard input)
  const reviewerCounts = {};
  for (const r of filterResult.accepted) {
    const who = (r.reviewer_display_name || r.source_review_id || '').toLowerCase();
    if (who) reviewerCounts[who] = (reviewerCounts[who] || 0) + 1;
  }

  // ── Aggregate ────────────────────────────────────────────────────────────
  const aggregation = aggregateReviews(filterResult.accepted);
  const signals = toCalibrationSignals(aggregation);
  const candidate = buildCandidate({ aggregation, filterStats: filterResult.stats, reviewerCounts });

  // ── Drift gate ───────────────────────────────────────────────────────────
  let baseline = null;
  const baselinePathResolved = baselinePath || path.join(HOSPITALITY_DIR, `${slug}_calibration.json`);
  if (fs.existsSync(baselinePathResolved)) {
    try { baseline = JSON.parse(fs.readFileSync(baselinePathResolved, 'utf8')); }
    catch (err) { logger.warn(`  baseline read error: ${err.message}`); }
  }

  const guardCtx = {
    major_archetypes: propManifest.major_archetypes || undefined,
    single_culture_property: propManifest.single_culture_property === true,
  };
  const gate = runDriftGate(candidate, baseline, guard_bands, guardCtx);
  logger.log(`  Drift gate verdict: ${gate.verdict} (${gate.reasons.length} BLOCK, ${gate.warnings.length} WATCH)`);

  // ── Build the calibration file body ──────────────────────────────────────
  const calibrationDoc = {
    _property: {
      slug,
      name: propManifest.name,
      brand: propManifest.brand,
      tier: propManifest.tier,
      country: propManifest.country,
      source_urls: (propManifest.sources || []).map(s => s.url).filter(Boolean),
    },
    _corpus_id: propManifest._corpus_id || null,
    _generated_at: new Date().toISOString(),
    _drift_gate: { verdict: gate.verdict, reasons: gate.reasons, warnings: gate.warnings, summary: gate.summary },

    // Canonical fields consumed by simulation-orchestrator.loadPrebuiltCalibration
    avg_rating: signals.avg_rating,
    review_count: signals.review_count,
    star_distribution_pct: signals.star_distribution_pct,
    sentiment_distribution: signals.sentiment_distribution,
    theme_top_10: signals.theme_top_10,
    top_positive_themes: signals.top_positive_themes,
    top_negative_themes: signals.top_negative_themes,
    positive_negative_moment_ratio: signals.positive_negative_moment_ratio,

    // Multi-source / multi-property extras
    archetype_coverage_counts: filterResult.stats.archetype_coverage_counts,
    language_counts: filterResult.stats.language_counts,
    filter_stats: filterResult.stats,
    source_report: sourceReport,

    // Public aggregate signals (when supplied as a source)
    aggregate_public: aggregatePublic,
  };

  // If the batch yielded too little data AND we have an aggregate_public,
  // upgrade the headline metrics from the aggregate so the file is still usable.
  const usableReviewCount = calibrationDoc.review_count || 0;
  if (aggregatePublic && usableReviewCount < 30) {
    calibrationDoc.avg_rating = calibrationDoc.avg_rating || aggregatePublic.avg_rating || null;
    calibrationDoc.review_count = Math.max(usableReviewCount, aggregatePublic.review_count || 0);
    calibrationDoc.star_distribution_pct = calibrationDoc.star_distribution_pct && Object.values(calibrationDoc.star_distribution_pct).some(v => v) ? calibrationDoc.star_distribution_pct : aggregatePublic.star_distribution_pct || null;
    calibrationDoc._fallback_from_aggregate_public = true;
  }

  return {
    slug,
    verdict: gate.verdict,
    doc: calibrationDoc,
    filterResult,
    aggregation,
    gate,
    sourceReport,
  };
}

// ─── Top-level orchestrator ──────────────────────────────────────────────────

async function ingestManifest(manifest, opts = {}) {
  const {
    dry_run = false,
    filter_opts = {},
    guard_bands = {},
    db = null,
    logger = console,
  } = opts;

  if (!manifest || !Array.isArray(manifest.properties)) {
    throw new Error('manifest.properties (array) required');
  }

  const corpusId = manifest.corpus_id || `corpus-${Date.now()}`;
  logger.log(`\n══ Dignus ingest: ${corpusId} · ${manifest.properties.length} properties · dry_run=${dry_run} ══`);

  const perProperty = [];
  for (const prop of manifest.properties) {
    const propWithCorpus = { ...prop, _corpus_id: corpusId };
    const res = await ingestProperty(propWithCorpus, { dry_run, filter_opts, guard_bands, logger });
    perProperty.push(res);
  }

  // ── Persist phase (skipped in dry_run) ────────────────────────────────────
  const persistReport = [];
  if (!dry_run) {
    if (!fs.existsSync(HOSPITALITY_DIR)) fs.mkdirSync(HOSPITALITY_DIR, { recursive: true });
    const corpusOutDir = path.join(CORPUS_DIR, corpusId);
    if (!fs.existsSync(corpusOutDir)) fs.mkdirSync(corpusOutDir, { recursive: true });

    for (const res of perProperty) {
      // BLOCKED properties: write to a `.blocked.json` variant so they don't
      // overwrite a trusted baseline. Consultant reviews, then manually promotes.
      const outName = res.verdict === 'BLOCK'
        ? `${res.slug}_calibration.blocked.json`
        : `${res.slug}_calibration.json`;
      const outPath = path.join(HOSPITALITY_DIR, outName);
      fs.writeFileSync(outPath, JSON.stringify(res.doc, null, 2));
      persistReport.push({ slug: res.slug, verdict: res.verdict, path: outPath });

      // DB persistence (optional) — one row per accepted review, same shape
      // as the existing /reviews/upload route.
      if (db && db.PG_AVAILABLE) {
        try {
          await persistReviewsToDb(db, res, { corpusId });
        } catch (err) {
          logger.warn(`  [${res.slug}] DB persist failed: ${err.message}`);
        }
      }
    }

    // Write corpus-level audit report
    const report = {
      corpus_id: corpusId,
      generated_at: new Date().toISOString(),
      properties: perProperty.map(r => ({
        slug: r.slug,
        verdict: r.verdict,
        review_count_in: r.filterResult.stats.total_in,
        review_count_accepted: r.filterResult.stats.accepted,
        review_count_rejected: r.filterResult.stats.rejected,
        reject_reason_counts: r.filterResult.stats.reject_reason_counts,
        archetype_coverage_counts: r.filterResult.stats.archetype_coverage_counts,
        language_counts: r.filterResult.stats.language_counts,
        avg_rating: r.doc.avg_rating,
        star_distribution_pct: r.doc.star_distribution_pct,
        source_report: r.sourceReport,
        drift_gate: r.doc._drift_gate,
      })),
    };
    const reportPath = path.join(corpusOutDir, 'manifest-report.json');
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
    logger.log(`\n  📝 Corpus report written: ${reportPath}`);
  }

  // Aggregate summary
  const verdictCounts = perProperty.reduce((acc, r) => { acc[r.verdict] = (acc[r.verdict] || 0) + 1; return acc; }, {});
  return {
    corpus_id: corpusId,
    dry_run,
    property_count: perProperty.length,
    verdict_counts: verdictCounts,
    properties: perProperty.map(r => ({
      slug: r.slug,
      verdict: r.verdict,
      avg_rating: r.doc.avg_rating,
      review_count: r.doc.review_count,
      archetype_coverage_counts: r.doc.archetype_coverage_counts,
      language_counts: r.doc.language_counts,
      drift_gate: r.doc._drift_gate,
    })),
    persist_report: persistReport,
  };
}

// ─── DB persistence helper ───────────────────────────────────────────────────
async function persistReviewsToDb(db, res, { corpusId }) {
  const accepted = res.filterResult.accepted;
  if (!accepted.length) return 0;

  const orgId = await db.ensureDefaultOrg().catch(() => null);
  let inserted = 0;
  // Lazy insert — relies on ON CONFLICT DO NOTHING for idempotency.
  for (const r of accepted) {
    try {
      await db.query(
        `INSERT INTO reviews_ingested (org_id, property_id, source, source_review_id, source_url, rating_numeric, rating_scale, title, body, reviewer_display_name, reviewer_origin, trip_type, stay_month, language, themes_json, sentiment_score)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
         ON CONFLICT (source, source_review_id) DO NOTHING`,
        [
          orgId,
          r._property_slug || null,
          r.source || r._source_entry || 'dignus',
          r.source_review_id || `dignus-${corpusId}-${r._content_hash}`,
          r.source_url || null,
          r.rating_numeric ?? null,
          r.rating_scale || 5,
          r.title || null,
          r.body || '',
          r.reviewer_display_name || null,
          r.reviewer_origin || null,
          r.trip_type || null,
          r.stay_month || null,
          r._detected_language || r.language || null,
          JSON.stringify(r._themes || []),
          r.sentiment_score ?? null,
        ]
      );
      inserted++;
    } catch (err) { /* ignore dup */ }
  }
  return inserted;
}

module.exports = {
  ingestManifest,
  ingestProperty,
};
