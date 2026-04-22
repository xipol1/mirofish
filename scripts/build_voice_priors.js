#!/usr/bin/env node
/**
 * Builds voice_priors_from_reviews.json by merging every review we have on
 * disk (HF cache + each property's scraped_reviews[]) and running the
 * voice-priors extractor over the union.
 *
 * Output:
 *   backend/data/industries/hospitality/voice_priors_from_reviews.json
 *
 * Usage:
 *   node scripts/build_voice_priors.js
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const HOSPITALITY_DIR = path.join(ROOT, 'backend', 'data', 'industries', 'hospitality');
const SOURCES_DIR = path.join(ROOT, 'backend', 'data', 'sources');
const HF_CACHE_SOURCES = [
  path.join(SOURCES_DIR, 'hf_nhull_tripadvisor_tagged.json'),      // EN generic TripAdvisor (nhull)
  path.join(SOURCES_DIR, 'hf_karpacious_es_tagged.json'),          // ES native (Karpacious)
  path.join(SOURCES_DIR, 'hf_515k_europe_sampled.json'),           // EN with cultural cluster from nationality (Dricz)
];
const OUT = path.join(HOSPITALITY_DIR, 'voice_priors_from_reviews.json');

const { extractVoicePriors } = require(path.join(ROOT, 'backend', 'services', 'data', 'voice-priors-extractor'));
const { enrichClustersWithSignals } = require(path.join(ROOT, 'backend', 'services', 'data', 'signals-extractor'));

function loadHfCache() {
  const rows = [];
  for (const src of HF_CACHE_SOURCES) {
    if (!fs.existsSync(src)) { continue; }
    try {
      const d = JSON.parse(fs.readFileSync(src, 'utf8'));
      const r = d.reviews || [];
      console.log(`  loaded ${path.basename(src)}: ${r.length} reviews`);
      for (const row of r) rows.push({ ...row, _corpus_source: d._source || path.basename(src) });
    } catch (err) { console.warn(`  cache unreadable: ${path.basename(src)}: ${err.message}`); }
  }
  return rows;
}

function loadScrapedFromProperties() {
  if (!fs.existsSync(HOSPITALITY_DIR)) return [];
  const files = fs.readdirSync(HOSPITALITY_DIR).filter(f => f.endsWith('_calibration.json') && !f.startsWith('review_calibration') && !f.startsWith('voice_priors'));
  const rows = [];
  for (const f of files) {
    try {
      const raw = JSON.parse(fs.readFileSync(path.join(HOSPITALITY_DIR, f), 'utf8'));
      for (const r of raw.scraped_reviews || []) {
        rows.push({ ...r, _property_slug: raw._property?.slug || f.replace(/_calibration\.json$/, '') });
      }
    } catch { /* skip malformed */ }
  }
  return rows;
}

function main() {
  const hfRows = loadHfCache();
  const scrapedRows = loadScrapedFromProperties();
  console.log(`Loading corpora: HF cache=${hfRows.length} · scraped_reviews across properties=${scrapedRows.length}`);

  // Union by content_hash (or source_review_id)
  const seen = new Set();
  const all = [];
  for (const r of [...hfRows, ...scrapedRows]) {
    const key = r._content_hash || r.source_review_id || (r.body || '').slice(0, 80);
    if (seen.has(key)) continue;
    seen.add(key);
    all.push(r);
  }
  console.log(`Merged unique reviews: ${all.length}`);

  const priorsRaw = extractVoicePriors(all, { top_unigrams: 30, top_bigrams: 20, top_starters: 10 });
  priorsRaw._source = 'huggingface_nhull_v2 + scraped_reviews (all properties)';

  // Second pass: attach structured signals per cluster (the decision-level
  // fingerprint: price_sensitivity, service_expectation, amenity_focus, …)
  const priors = enrichClustersWithSignals(priorsRaw);

  fs.writeFileSync(OUT, JSON.stringify(priors, null, 2));
  console.log(`\n✓ Wrote ${OUT}`);
  console.log(`  clusters: ${priors._cluster_count} · signals attached: ${Object.values(priors.clusters).filter(c => c.signals).length}`);

  // Print the top clusters with their signals for eyeball verification
  const topClusters = Object.entries(priors.clusters).sort((a, b) => b[1].n - a[1].n).slice(0, 10);
  console.log('\nTop clusters (showing signals + amenity focus):');
  for (const [k, v] of topClusters) {
    const s = v.signals || {};
    const brief = `price=${s.price_sensitivity ?? '—'} svc=${s.service_expectation ?? '—'} lux=${s.luxury_benchmark_score ?? '—'} emo=${s.emotional_intensity ?? '—'}`;
    const amen = (v.amenity_focus || []).slice(0, 3).join(',') || '—';
    const comp = (v.complaint_triggers || []).slice(0, 3).join(',') || '—';
    console.log(`  ${k.padEnd(48)} n=${String(v.n).padStart(4)} · ${brief} · amen:${amen} · comp:${comp}`);
  }
}

main();
