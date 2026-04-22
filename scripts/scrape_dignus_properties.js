#!/usr/bin/env node
/**
 * Dignus per-property scraper.
 *
 * Reads the list of properties calibrated on disk (backend/data/industries/hospitality/*_calibration.json),
 * grabs their public source URLs, runs the Playwright scraper, passes every batch through
 * calibration-filters, and either:
 *   - merges the accepted reviews into the existing calibration file
 *     (union — never overwrites the aggregate_public anchor), or
 *   - writes a `.blocked.json` variant if the drift gate fails.
 *
 * Usage:
 *   node scripts/scrape_dignus_properties.js [--slug=<slug>] [--limit=<N>] [--only=tripadvisor|booking|google] [--dry-run]
 *
 * Notes:
 *   - TripAdvisor and Booking anti-bot is aggressive. Expect partial success.
 *   - The script is idempotent: duplicates are caught by calibration-filters.contentHash.
 *   - Reviews persist into the calibration file under `scraped_reviews[]`.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const HOSPITALITY_DIR = path.join(ROOT, 'backend', 'data', 'industries', 'hospitality');
const AUDIT_DIR = path.join(ROOT, 'backend', 'data', 'dignus_corpus', 'scrape_audit');

const argv = Object.fromEntries(process.argv.slice(2).map(a => {
  if (a.startsWith('--') && a.includes('=')) { const [k, v] = a.slice(2).split('='); return [k, v]; }
  if (a.startsWith('--')) return [a.slice(2), true];
  return [a, true];
}));

const scraper = require(path.join(ROOT, 'backend', 'services', 'data', 'review-scraper'));
const { filterReviews } = require(path.join(ROOT, 'backend', 'services', 'data', 'calibration-filters'));
const { runDriftGate, buildCandidate } = require(path.join(ROOT, 'backend', 'services', 'data', 'calibration-guard'));
const { aggregateReviews, toCalibrationSignals } = require(path.join(ROOT, 'backend', 'services', 'data', 'review-parser'));

function listCalibrationFiles() {
  return fs.readdirSync(HOSPITALITY_DIR)
    .filter(f => f.endsWith('_calibration.json') && !f.startsWith('review_calibration'))
    .map(f => ({ file: f, slug: f.replace(/_calibration\.json$/, '').replace(/_/g, '-'), fullPath: path.join(HOSPITALITY_DIR, f) }))
    .map(x => {
      try {
        const raw = JSON.parse(fs.readFileSync(x.fullPath, 'utf8'));
        // Normalise slug from the _property block if present
        const slug = raw._property?.slug || x.slug;
        return { ...x, slug, raw };
      } catch { return x; }
    });
}

function pickSourceUrls(raw, only) {
  const urls = [];
  const ag = raw.aggregate_public || raw._aggregate_public || {};
  const direct = raw._property?.source_urls || [];
  const fromAgg = ag.source_urls || [];
  const all = [...direct, ...fromAgg].filter(Boolean);
  for (const u of all) {
    const host = u.toLowerCase();
    if (only === 'tripadvisor' && !host.includes('tripadvisor.')) continue;
    if (only === 'booking' && !host.includes('booking.com')) continue;
    if (only === 'google' && !host.includes('google.')) continue;
    urls.push(u);
  }
  return urls;
}

async function scrapeOneUrl(url, limit) {
  const t0 = Date.now();
  try {
    const reviews = await scraper.scrape(url, { limit });
    return { url, elapsed_ms: Date.now() - t0, count: reviews.length, reviews };
  } catch (err) {
    return { url, elapsed_ms: Date.now() - t0, error: err.message.slice(0, 300), count: 0, reviews: [] };
  }
}

async function scrapeProperty(prop, opts) {
  const { limit, only, dryRun } = opts;
  const urls = pickSourceUrls(prop.raw, only);
  if (urls.length === 0) {
    console.log(`  [${prop.slug}] no source URLs matching filter "${only || 'any'}" — skip`);
    return { slug: prop.slug, skipped: true, reason: 'no_urls' };
  }

  console.log(`\n─── ${prop.slug} ────────`);
  console.log(`  URLs (${urls.length}):`, urls.map(u => u.split('/')[2]).join(', '));

  const sourceResults = [];
  let allRaw = [];
  for (const url of urls) {
    console.log(`  scraping ${url.split('/')[2]}… (limit ${limit})`);
    const res = await scrapeOneUrl(url, limit);
    sourceResults.push({ url: res.url, count: res.count, elapsed_ms: res.elapsed_ms, error: res.error || null });
    console.log(`    → ${res.count} reviews in ${res.elapsed_ms}ms${res.error ? ' · ERROR: ' + res.error : ''}`);
    for (const r of res.reviews) allRaw.push({ ...r, _property_slug: prop.slug });
  }

  if (allRaw.length === 0) {
    console.log(`  [${prop.slug}] 0 reviews scraped — property untouched`);
    return { slug: prop.slug, scraped: 0, kept: 0, source_results: sourceResults };
  }

  // Attach existing scraped reviews so dedup hash rejects repeats.
  const existing = Array.isArray(prop.raw.scraped_reviews) ? prop.raw.scraped_reviews : [];
  const combinedForFilter = [...existing, ...allRaw];

  const filterRes = filterReviews(combinedForFilter);
  // Keep only the *new* accepted ones (those not already in `existing` by hash)
  const existingHashes = new Set(existing.map(e => e._content_hash).filter(Boolean));
  const newlyAccepted = filterRes.accepted.filter(r => !existingHashes.has(r._content_hash));
  console.log(`  filtered: ${filterRes.accepted.length} accepted / ${filterRes.rejected.length} rejected · new rows: ${newlyAccepted.length}`);

  // Re-aggregate all accepted (existing + new) to recompute calibration headline
  const reviewerCounts = {};
  for (const r of filterRes.accepted) {
    const who = (r.reviewer_display_name || r.source_review_id || '').toLowerCase();
    if (who) reviewerCounts[who] = (reviewerCounts[who] || 0) + 1;
  }
  const agg = aggregateReviews(filterRes.accepted);
  const signals = toCalibrationSignals(agg);
  const candidate = buildCandidate({ aggregation: agg, filterStats: filterRes.stats, reviewerCounts });

  // Use the *current* calibration file as baseline for drift gate
  const baseline = prop.raw;
  const gate = runDriftGate(candidate, baseline, {}, {
    major_archetypes: baseline._property?.major_archetypes,
    single_culture_property: Boolean(baseline._property?.single_culture_property),
  });
  console.log(`  drift gate verdict: ${gate.verdict}`);

  const auditRecord = {
    slug: prop.slug,
    scraped_at: new Date().toISOString(),
    source_results: sourceResults,
    scraped_total: allRaw.length,
    new_accepted: newlyAccepted.length,
    filter_stats: filterRes.stats,
    drift_gate: gate,
  };

  if (!dryRun) {
    // Persist: merge scraped reviews into calibration file
    const updated = { ...prop.raw };
    updated.scraped_reviews = [...existing, ...newlyAccepted];
    // Refresh the aggregate headline IF the drift gate allows
    if (gate.verdict !== 'BLOCK') {
      updated.avg_rating = signals.avg_rating ?? updated.avg_rating;
      updated.review_count = (existing.length + newlyAccepted.length) || updated.review_count;
      updated.star_distribution_pct = signals.star_distribution_pct || updated.star_distribution_pct;
      updated.sentiment_distribution = signals.sentiment_distribution || updated.sentiment_distribution;
      updated.theme_top_10 = signals.theme_top_10 || updated.theme_top_10;
    }
    updated._last_scrape_audit = auditRecord;
    updated._drift_gate = gate;

    const outPath = gate.verdict === 'BLOCK'
      ? path.join(HOSPITALITY_DIR, `${prop.slug.replace(/-/g, '_')}_calibration.blocked.json`)
      : prop.fullPath;
    fs.writeFileSync(outPath, JSON.stringify(updated, null, 2));
    console.log(`  → wrote ${path.basename(outPath)}`);
  }

  if (!fs.existsSync(AUDIT_DIR)) fs.mkdirSync(AUDIT_DIR, { recursive: true });
  const auditPath = path.join(AUDIT_DIR, `${prop.slug}-${Date.now()}.json`);
  fs.writeFileSync(auditPath, JSON.stringify(auditRecord, null, 2));

  return auditRecord;
}

async function main() {
  const limit = Math.min(parseInt(argv.limit, 10) || 60, 300);
  const only = argv.only || null;
  const dryRun = Boolean(argv['dry-run']);
  const slugFilter = argv.slug || null;

  const all = listCalibrationFiles().filter(p => p.raw && p.raw._property);
  const targets = slugFilter ? all.filter(p => p.slug === slugFilter) : all;
  if (targets.length === 0) {
    console.error(`No matching calibration files ${slugFilter ? `for slug="${slugFilter}"` : ''}`);
    process.exit(1);
  }

  console.log(`Scraping ${targets.length} properties · limit=${limit}/url · only=${only || 'any'} · dry_run=${dryRun}`);

  const report = [];
  for (const prop of targets) {
    try {
      const res = await scrapeProperty(prop, { limit, only, dryRun });
      report.push(res);
    } catch (err) {
      console.error(`  [${prop.slug}] FATAL:`, err.message);
      report.push({ slug: prop.slug, error: err.message });
    }
  }

  console.log('\n══ Summary ══');
  for (const r of report) {
    console.log(`  ${r.slug}: scraped=${r.scraped_total || 0} new_accepted=${r.new_accepted || 0} verdict=${r.drift_gate?.verdict || r.reason || 'n/a'}`);
  }
}

main().catch(err => { console.error('FATAL:', err.stack || err.message); process.exit(1); });
