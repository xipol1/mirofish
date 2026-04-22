#!/usr/bin/env node
/**
 * Pulls real TripAdvisor reviews from the public HuggingFace datasets-server
 * and distributes them per-property according to each property's archetype mix.
 *
 * Source: nhull/tripadvisor-split-dataset-v2 (public, no auth).
 *   https://huggingface.co/datasets/nhull/tripadvisor-split-dataset-v2
 * Fields: { review: string, label: float (1–5) }
 *
 * Pipeline:
 *   1. HTTP-page through the datasets-server (default split) until we have N.
 *   2. Tag every review via calibration-filters.inferArchetypes + detectLanguage.
 *   3. For each Dignus property, distribute K reviews sampled by the property's
 *      archetype_mix_pct (weighted). Headline calibration (avg_rating,
 *      star_distribution_pct) is NOT touched — those come from aggregate_public.
 *   4. Merge into each property's `scraped_reviews[]` with _source='huggingface_nhull_v2'.
 *   5. Persist via the calibration-guard drift gate; BLOCKED writes to .blocked.json.
 *
 * Usage:
 *   node scripts/pull_huggingface_reviews.js [--target=1500] [--per-property=150] [--dry-run]
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

const ROOT = path.join(__dirname, '..');
const HOSPITALITY_DIR = path.join(ROOT, 'backend', 'data', 'industries', 'hospitality');
const SOURCES_DIR = path.join(ROOT, 'backend', 'data', 'sources');
const CORPUS_CACHE = path.join(SOURCES_DIR, 'hf_nhull_tripadvisor_tagged.json');

const argv = Object.fromEntries(process.argv.slice(2).map(a => {
  if (a.startsWith('--') && a.includes('=')) { const [k, v] = a.slice(2).split('='); return [k, v]; }
  if (a.startsWith('--')) return [a.slice(2), true];
  return [a, true];
}));

const TARGET_REVIEWS = parseInt(argv.target, 10) || 1500;
const PER_PROPERTY = parseInt(argv['per-property'], 10) || 150;
const DRY_RUN = Boolean(argv['dry-run']);

const {
  filterReviews,
  inferArchetypes,
  detectLanguage,
  contentHash,
} = require(path.join(ROOT, 'backend', 'services', 'data', 'calibration-filters'));
const { runDriftGate, buildCandidate } = require(path.join(ROOT, 'backend', 'services', 'data', 'calibration-guard'));
const { aggregateReviews, toCalibrationSignals } = require(path.join(ROOT, 'backend', 'services', 'data', 'review-parser'));

// ─── HTTP: HuggingFace datasets-server pagination ────────────────────────────
function fetchJson(url, { timeout = 30000 } = {}) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { timeout, headers: { 'User-Agent': 'MiroFish-SyntheticUsers/1.0' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return resolve(fetchJson(res.headers.location, { timeout }));
      }
      if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode} on ${url.slice(0, 80)}`));
      let raw = '';
      res.on('data', (c) => raw += c);
      res.on('end', () => {
        try { resolve(JSON.parse(raw)); } catch (e) { reject(new Error(`JSON parse fail on ${url.slice(0, 80)}: ${e.message}`)); }
      });
    });
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    req.on('error', reject);
  });
}

async function pullHf({ target, dataset = 'nhull/tripadvisor-split-dataset-v2', split = 'train', pageSize = 100 }) {
  const encoded = encodeURIComponent(dataset);
  const rows = [];
  let offset = 0;
  while (rows.length < target) {
    const url = `https://datasets-server.huggingface.co/rows?dataset=${encoded}&config=default&split=${split}&offset=${offset}&length=${pageSize}`;
    try {
      const page = await fetchJson(url);
      const pageRows = Array.isArray(page.rows) ? page.rows : [];
      if (pageRows.length === 0) break;
      for (const entry of pageRows) {
        const body = entry.row?.review;
        const label = entry.row?.label;
        if (!body || typeof body !== 'string') continue;
        rows.push({
          source: 'huggingface_nhull_v2',
          source_review_id: `hf-nhull-${offset + entry.row_idx}`,
          source_url: 'https://huggingface.co/datasets/nhull/tripadvisor-split-dataset-v2',
          title: body.split(/\r?\n/, 1)[0].slice(0, 180),
          body: body.slice(0, 5000),
          rating_numeric: typeof label === 'number' ? Math.round(label * 10) / 10 : null,
          rating_scale: 5,
          language: null,
          scraped_at: new Date().toISOString(),
        });
      }
      offset += pageSize;
      process.stdout.write(`\r  HF pulled ${rows.length}/${target}`);
      if (rows.length >= target) break;
    } catch (err) {
      console.error(`\n  HF page error at offset=${offset}: ${err.message}`);
      break;
    }
  }
  process.stdout.write('\n');
  return rows;
}

// ─── Tag + cache ─────────────────────────────────────────────────────────────
function tagReviews(rows) {
  const tagged = [];
  for (const r of rows) {
    const text = `${r.title} ${r.body}`;
    const arches = inferArchetypes(text);
    const lang = detectLanguage(text);
    const hash = contentHash(r.title, r.body);
    tagged.push({
      ...r,
      _inferred_archetypes: arches,
      _detected_language: lang,
      _content_hash: hash,
    });
  }
  return tagged;
}

// ─── Weighted sampling by archetype mix ──────────────────────────────────────
function weightedPickKey(weights, rng) {
  const entries = Object.entries(weights).filter(([, w]) => w > 0);
  const total = entries.reduce((s, [, w]) => s + w, 0);
  let r = rng() * total;
  for (const [k, w] of entries) {
    r -= w;
    if (r <= 0) return k;
  }
  return entries[entries.length - 1][0];
}

function distributeToProperty({ prop, corpus, count, rng, existingHashes }) {
  const archMix = prop.raw?._property?.expected_archetype_mix
    || prop.raw?._property?.expected_archetype_mix_pct
    || null;
  const starTarget = prop.raw?.star_distribution_pct
    || prop.raw?.aggregate_public?.star_distribution_pct
    || null;

  // Index corpus by archetype AND by star bucket. A review can appear in
  // multiple archetype pools (multi-tagged) and in exactly one star bucket.
  const byArch = new Map();
  const byStar = { 1: [], 2: [], 3: [], 4: [], 5: [] };
  for (const r of corpus) {
    const starBucket = Math.max(1, Math.min(5, Math.round(r.rating_numeric || 3)));
    byStar[starBucket].push(r);
    for (const a of r._inferred_archetypes || []) {
      if (!byArch.has(a)) byArch.set(a, []);
      byArch.get(a).push(r);
    }
  }

  // Picking strategy: first decide star bucket (property target), then
  // archetype within that bucket (property mix, filtered to the bucket).
  const picked = [];
  const pickedIds = new Set();
  let attempts = 0, maxAttempts = count * 30;
  while (picked.length < count && attempts < maxAttempts) {
    attempts++;
    const starBucket = starTarget ? weightedPickKey(starTarget, rng) : String(Math.floor(rng() * 5) + 1);
    const starPool = byStar[starBucket];
    if (!starPool || starPool.length === 0) continue;

    // Weight archetypes we care about; if the star bucket pool doesn't contain
    // the preferred archetype, pick uniformly within the bucket.
    let cand = null;
    if (archMix) {
      const targetArch = weightedPickKey(archMix, rng);
      const archPool = byArch.get(targetArch) || [];
      // Intersection of archetype pool and star bucket
      const intersect = archPool.filter(r => Math.max(1, Math.min(5, Math.round(r.rating_numeric || 3))) === Number(starBucket));
      if (intersect.length > 0) cand = intersect[Math.floor(rng() * intersect.length)];
    }
    if (!cand) cand = starPool[Math.floor(rng() * starPool.length)];

    if (!cand || pickedIds.has(cand.source_review_id)) continue;
    if (existingHashes.has(cand._content_hash)) continue;
    pickedIds.add(cand.source_review_id);
    picked.push(cand);
  }
  return picked;
}

// ─── Seedable PRNG ───────────────────────────────────────────────────────────
function makeRng(seed) {
  let s = seed >>> 0;
  return function () {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ─── Per-property merge ──────────────────────────────────────────────────────
function listCalibrationFiles() {
  return fs.readdirSync(HOSPITALITY_DIR)
    .filter(f => f.endsWith('_calibration.json') && !f.startsWith('review_calibration'))
    .map(f => {
      const fullPath = path.join(HOSPITALITY_DIR, f);
      try {
        const raw = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
        return { file: f, fullPath, slug: raw._property?.slug || f.replace(/_calibration\.json$/, '').replace(/_/g, '-'), raw };
      } catch { return null; }
    })
    .filter(Boolean)
    .filter(p => p.raw._property);  // skip baseline files without _property metadata
}

async function mergeIntoProperty({ prop, corpus, count, rng, dryRun }) {
  const existing = Array.isArray(prop.raw.scraped_reviews) ? prop.raw.scraped_reviews : [];
  const existingHashes = new Set(existing.map(e => e._content_hash).filter(Boolean));

  const picks = distributeToProperty({ prop, corpus, count, rng, existingHashes });
  if (picks.length === 0) {
    console.log(`  [${prop.slug}] 0 picks — skip`);
    return { slug: prop.slug, new_added: 0, verdict: 'SKIP' };
  }

  const combined = [...existing, ...picks];
  const filterRes = filterReviews(combined);
  const agg = aggregateReviews(filterRes.accepted);
  const signals = toCalibrationSignals(agg);

  const reviewerCounts = {};
  for (const r of filterRes.accepted) {
    const who = (r.reviewer_display_name || r.source_review_id || '').toLowerCase();
    if (who) reviewerCounts[who] = (reviewerCounts[who] || 0) + 1;
  }
  const candidate = buildCandidate({ aggregation: agg, filterStats: filterRes.stats, reviewerCounts });
  // Enrichment pulls are *not* the headline calibration signal — aggregate_public
  // stays the anchor. We relax the per-bucket band so a luxury property can
  // accept a generic HF pull without hitting BLOCK just because the HF corpus
  // is balanced 20/20/20/20/20 and the property is skewed 80% 5★.
  const enrichmentBands = {
    star_distribution_pct_delta_any_bucket: 30,
    star_distribution_pct_delta_watch: 15,
    avg_rating_abs_delta: 0.5,
    avg_rating_watch_delta: 0.25,
  };
  const gate = runDriftGate(candidate, prop.raw, enrichmentBands, {
    major_archetypes: prop.raw._property?.major_archetypes,
  });

  console.log(`  [${prop.slug}] +${picks.length} · filter ${filterRes.accepted.length}/${filterRes.rejected.length} · gate ${gate.verdict}`);

  if (!dryRun) {
    const updated = { ...prop.raw };
    updated.scraped_reviews = filterRes.accepted;
    updated._external_corpus_note = 'Reviews under scraped_reviews[] sourced from HuggingFace dataset nhull/tripadvisor-split-dataset-v2, weighted by this property\'s archetype_mix. Headline calibration (avg_rating, star_distribution_pct) still anchors to aggregate_public.';
    updated._last_hf_pull = {
      pulled_at: new Date().toISOString(),
      pulled_count: picks.length,
      total_scraped_reviews: filterRes.accepted.length,
      drift_gate: gate,
    };
    // Do NOT overwrite aggregate headline if the gate blocks
    const outPath = gate.verdict === 'BLOCK'
      ? path.join(HOSPITALITY_DIR, path.basename(prop.fullPath).replace(/_calibration\.json$/, '_calibration.blocked.json'))
      : prop.fullPath;
    fs.writeFileSync(outPath, JSON.stringify(updated, null, 2));
  }

  return {
    slug: prop.slug,
    new_added: picks.length,
    total_after: filterRes.accepted.length,
    verdict: gate.verdict,
    languages: filterRes.stats.language_counts,
    archetypes: filterRes.stats.archetype_coverage_counts,
  };
}

// ─── Main ────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`Pulling ~${TARGET_REVIEWS} reviews from HuggingFace (nhull/tripadvisor-split-dataset-v2)…`);

  // Use cache if fresh enough
  let corpus = null;
  if (fs.existsSync(CORPUS_CACHE)) {
    try {
      const cached = JSON.parse(fs.readFileSync(CORPUS_CACHE, 'utf8'));
      const ageHours = (Date.now() - new Date(cached._pulled_at).getTime()) / (3600 * 1000);
      if (ageHours < 48 && cached.reviews?.length >= TARGET_REVIEWS) {
        corpus = cached.reviews;
        console.log(`  using cache (${corpus.length} rows, ${Math.round(ageHours)}h old)`);
      }
    } catch { /* fall through */ }
  }

  if (!corpus) {
    const raw = await pullHf({ target: TARGET_REVIEWS });
    console.log(`  tagging ${raw.length} reviews…`);
    corpus = tagReviews(raw);
    if (!fs.existsSync(SOURCES_DIR)) fs.mkdirSync(SOURCES_DIR, { recursive: true });
    fs.writeFileSync(CORPUS_CACHE, JSON.stringify({
      _pulled_at: new Date().toISOString(),
      _source: 'huggingface_nhull_v2',
      _count: corpus.length,
      reviews: corpus,
    }, null, 2));
    console.log(`  wrote ${CORPUS_CACHE}`);
  }

  const langDist = corpus.reduce((a, r) => { const l = r._detected_language || 'und'; a[l] = (a[l] || 0) + 1; return a; }, {});
  const archDist = corpus.reduce((a, r) => { for (const x of r._inferred_archetypes || []) a[x] = (a[x] || 0) + 1; return a; }, {});
  console.log('  corpus languages:', langDist);
  console.log('  corpus archetypes (top 10):', Object.entries(archDist).sort((a,b)=>b[1]-a[1]).slice(0,10));

  const props = listCalibrationFiles();
  console.log(`\nDistributing ${PER_PROPERTY} reviews/property across ${props.length} properties…`);
  const rng = makeRng(0xCAFEF00D);
  const report = [];
  for (const prop of props) {
    report.push(await mergeIntoProperty({ prop, corpus, count: PER_PROPERTY, rng, dryRun: DRY_RUN }));
  }

  console.log('\n══ Summary ══');
  for (const r of report) {
    console.log(`  ${r.slug}: +${r.new_added} · total=${r.total_after || 0} · verdict=${r.verdict}`);
  }
}

main().catch(err => { console.error('FATAL:', err.stack || err.message); process.exit(1); });
