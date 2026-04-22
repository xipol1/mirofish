#!/usr/bin/env node
/**
 * Pulls multilingual hotel reviews from public HuggingFace datasets.
 *
 * Sources:
 *   1. Karpacious/hotel-reviews-es — native Spanish, fields: hotel, ciudad,
 *      fecha, texto, rating, sentimiento. ~50K rows.
 *   2. Dricz/515k-Hotel-Reviews-In-Europe — English-language with
 *      Reviewer_Nationality. We use nationality as a cultural cluster
 *      signal (e.g. reviewer_nationality=France → cultural cluster=french)
 *      so voice priors can reflect French vs German reviewing style even
 *      when the text is English.
 *
 * Writes:
 *   backend/data/sources/hf_karpacious_es_tagged.json
 *   backend/data/sources/hf_515k_europe_sampled.json
 *
 * After a pull, re-run `node scripts/build_voice_priors.js` so the fresh
 * corpora feed the voice-priors + signals-extractor pipeline.
 *
 * Usage:
 *   node scripts/pull_multilingual_reviews.js [--es=1500] [--europe=3000] [--dry-run]
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

const ROOT = path.join(__dirname, '..');
const SOURCES_DIR = path.join(ROOT, 'backend', 'data', 'sources');
const OUT_ES = path.join(SOURCES_DIR, 'hf_karpacious_es_tagged.json');
const OUT_EU = path.join(SOURCES_DIR, 'hf_515k_europe_sampled.json');

const {
  inferArchetypes,
  detectLanguage,
  contentHash,
} = require(path.join(ROOT, 'backend', 'services', 'data', 'calibration-filters'));

const argv = Object.fromEntries(process.argv.slice(2).map(a => {
  if (a.startsWith('--') && a.includes('=')) { const [k, v] = a.slice(2).split('='); return [k, v]; }
  if (a.startsWith('--')) return [a.slice(2), true];
  return [a, true];
}));

const TARGET_ES = parseInt(argv.es, 10) || 1500;
const TARGET_EU = parseInt(argv.europe, 10) || 3000;
const DRY = Boolean(argv['dry-run']);

function fetchJson(url, { timeout = 30000 } = {}) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { timeout, headers: { 'User-Agent': 'MiroFish-SyntheticUsers/1.0' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) return resolve(fetchJson(res.headers.location, { timeout }));
      if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode} on ${url.slice(0, 80)}`));
      let raw = '';
      res.on('data', (c) => raw += c);
      res.on('end', () => { try { resolve(JSON.parse(raw)); } catch (e) { reject(new Error(e.message)); } });
    });
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    req.on('error', reject);
  });
}

async function pullDataset({ dataset, split = 'train', target, pageSize = 100, normaliseRow }) {
  const encoded = encodeURIComponent(dataset);
  const rows = [];
  let offset = 0;
  while (rows.length < target) {
    const url = `https://datasets-server.huggingface.co/rows?dataset=${encoded}&config=default&split=${split}&offset=${offset}&length=${pageSize}`;
    try {
      const page = await fetchJson(url);
      const pageRows = Array.isArray(page.rows) ? page.rows : [];
      if (pageRows.length === 0) break;
      for (const r of pageRows) {
        const norm = normaliseRow(r.row, offset + r.row_idx);
        if (norm) rows.push(norm);
      }
      offset += pageSize;
      process.stdout.write(`\r    ${dataset}: ${rows.length}/${target}`);
      if (rows.length >= target) break;
    } catch (err) {
      console.error(`\n    error at offset=${offset}: ${err.message}`);
      break;
    }
  }
  process.stdout.write('\n');
  return rows;
}

// ─── Spanish: Karpacious/hotel-reviews-es ────────────────────────────────────
const SENTIMIENTO_TO_STAR = { positivo: 5, positive: 5, neutral: 3, mixto: 3, negativo: 1, negative: 1 };

async function pullSpanish() {
  console.log('Pulling Karpacious/hotel-reviews-es (Spanish hotel reviews)…');
  return pullDataset({
    dataset: 'Karpacious/hotel-reviews-es',
    target: TARGET_ES,
    normaliseRow: (row, idx) => {
      const body = row.texto || row.review || '';
      if (!body || typeof body !== 'string' || body.length < 25) return null;
      const hotel = row.hotel || row.hotel_name || null;
      const ciudad = row.ciudad || row.city || null;
      const rating = row.rating != null ? Number(row.rating) : (SENTIMIENTO_TO_STAR[String(row.sentimiento || '').toLowerCase()] || null);
      return {
        source: 'hf_karpacious_es',
        source_review_id: `karpacious-${idx}`,
        source_url: 'https://huggingface.co/datasets/Karpacious/hotel-reviews-es',
        title: hotel ? `${hotel}${ciudad ? ' · ' + ciudad : ''}` : '',
        body: body.slice(0, 5000),
        rating_numeric: rating,
        rating_scale: 5,
        language: 'es',
        reviewer_origin: ciudad ? 'latin_spain_italy' : null,
        scraped_at: new Date().toISOString(),
      };
    },
  });
}

// ─── Europe 515K: tag by reviewer nationality ───────────────────────────────
const NATIONALITY_TO_CLUSTER = {
  'United Kingdom': 'anglo_uk_ireland', 'Ireland': 'anglo_uk_ireland',
  'Germany': 'german_dach', 'Austria': 'german_dach', 'Switzerland': 'german_dach',
  'France': 'french', 'Belgium': 'french',
  'Spain': 'latin_spain_italy', 'Italy': 'latin_spain_italy', 'Portugal': 'latin_spain_italy',
  'Netherlands': 'nordic', 'Sweden': 'nordic', 'Norway': 'nordic', 'Denmark': 'nordic', 'Finland': 'nordic',
  'United States': 'anglo_us_canada', 'Canada': 'anglo_us_canada',
  'United Arab Emirates': 'middle_east_gcc', 'Saudi Arabia': 'middle_east_gcc', 'Kuwait': 'middle_east_gcc', 'Qatar': 'middle_east_gcc', 'Bahrain': 'middle_east_gcc', 'Oman': 'middle_east_gcc',
  'Russia': 'eastern_european',
  'China': 'chinese_mainland', 'Japan': 'east_asian', 'South Korea': 'east_asian',
  'Brazil': 'latin_american', 'Mexico': 'latin_american', 'Argentina': 'latin_american',
};

async function pullEurope515K() {
  console.log('\nPulling Dricz/515k-Hotel-Reviews-In-Europe (nationality-tagged English)…');
  return pullDataset({
    dataset: 'Dricz/515k-Hotel-Reviews-In-Europe',
    target: TARGET_EU,
    normaliseRow: (row, idx) => {
      // This dataset splits reviews into Positive_Review and Negative_Review
      // fields. We output ONE synthetic review per raw row, combining both.
      const pos = String(row.Positive_Review || '').trim();
      const neg = String(row.Negative_Review || '').trim();
      const hasPos = pos && pos !== 'No Positive';
      const hasNeg = neg && neg !== 'No Negative';
      if (!hasPos && !hasNeg) return null;
      const body = [hasPos ? `Liked: ${pos}` : '', hasNeg ? `Disliked: ${neg}` : ''].filter(Boolean).join(' · ');
      if (body.length < 25) return null;
      const score10 = row.Reviewer_Score != null ? Number(row.Reviewer_Score) : null;
      const nat = String(row.Reviewer_Nationality || '').trim();
      const cluster = NATIONALITY_TO_CLUSTER[nat] || null;
      return {
        source: 'hf_dricz_515k_europe',
        source_review_id: `dricz-${idx}`,
        source_url: 'https://huggingface.co/datasets/Dricz/515k-Hotel-Reviews-In-Europe',
        title: row.Hotel_Name || '',
        body: body.slice(0, 5000),
        rating_numeric: score10,
        rating_scale: 10,
        language: 'en',
        reviewer_origin: cluster,
        reviewer_nationality_raw: nat,
        scraped_at: new Date().toISOString(),
      };
    },
  });
}

// ─── Tagging ────────────────────────────────────────────────────────────────
function tagReviews(rows) {
  return rows.map(r => {
    const text = `${r.title || ''} ${r.body || ''}`;
    const arches = inferArchetypes(text);
    const lang = r.language || detectLanguage(text);
    const hash = contentHash(r.title, r.body);
    return {
      ...r,
      _inferred_archetypes: arches,
      _detected_language: lang,
      _content_hash: hash,
    };
  });
}

async function main() {
  if (!fs.existsSync(SOURCES_DIR)) fs.mkdirSync(SOURCES_DIR, { recursive: true });

  // Parallel pulls
  const [rawEs, rawEu] = await Promise.all([pullSpanish(), pullEurope515K()]);
  console.log(`\nPulled: ES=${rawEs.length} · Europe=${rawEu.length}`);

  console.log('Tagging…');
  const taggedEs = tagReviews(rawEs);
  const taggedEu = tagReviews(rawEu);

  // Quick breakdowns for sanity
  const esArches = taggedEs.reduce((a, r) => { for (const x of r._inferred_archetypes) a[x] = (a[x] || 0) + 1; return a; }, {});
  const euClusters = taggedEu.reduce((a, r) => { if (r.reviewer_origin) a[r.reviewer_origin] = (a[r.reviewer_origin] || 0) + 1; return a; }, {});

  console.log('\nSpanish archetype coverage:');
  Object.entries(esArches).sort((a, b) => b[1] - a[1]).slice(0, 10).forEach(([a, n]) => console.log('  ', a.padEnd(30), n));
  console.log('\nEurope 515K cluster distribution:');
  Object.entries(euClusters).sort((a, b) => b[1] - a[1]).slice(0, 10).forEach(([c, n]) => console.log('  ', c.padEnd(22), n));

  if (!DRY) {
    fs.writeFileSync(OUT_ES, JSON.stringify({ _pulled_at: new Date().toISOString(), _source: 'Karpacious/hotel-reviews-es', _count: taggedEs.length, reviews: taggedEs }, null, 2));
    fs.writeFileSync(OUT_EU, JSON.stringify({ _pulled_at: new Date().toISOString(), _source: 'Dricz/515k-Hotel-Reviews-In-Europe', _count: taggedEu.length, reviews: taggedEu }, null, 2));
    console.log(`\n✓ Wrote ${OUT_ES}`);
    console.log(`✓ Wrote ${OUT_EU}`);
    console.log('\nNext: node scripts/build_voice_priors.js   (will now include ES + cluster-tagged EN)');
  }
}

main().catch(err => { console.error('FATAL:', err.stack || err.message); process.exit(1); });
