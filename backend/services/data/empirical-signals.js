/**
 * Empirical Signals Helper — single source of truth for reading
 * voice_priors_from_reviews.json aggregate signals per (archetype[, culture]).
 *
 * Consumed by:
 *   - enterprise/scenario-preview.js   (price elasticity override)
 *   - enterprise/staffing-engine.js    (service-expectation-adjusted ratios + NPS penalty)
 *   - enterprise/adversarial-events.js (per-archetype complaint-trigger weighting)
 *   - enterprise/revenue-engine.js     (family_orientation / luxury_benchmark upsell modifiers)
 *
 * Load is lazy and cached. The file is refreshed by
 * `node scripts/build_voice_priors.js`, so the cache is invalidated on process
 * restart (acceptable — voice priors are rebuilt rarely, not per request).
 */

const fs = require('fs');
const path = require('path');

const VP_PATH = path.join(__dirname, '..', '..', 'data', 'industries', 'hospitality', 'voice_priors_from_reviews.json');

let _vpCache = null;
let _byArchCache = null;
let _byArchCultureCache = null;

function load() {
  if (_vpCache !== null) return _vpCache;
  try {
    _vpCache = fs.existsSync(VP_PATH) ? JSON.parse(fs.readFileSync(VP_PATH, 'utf8')) : { clusters: {} };
  } catch (err) {
    console.warn('[empirical-signals] load error:', err.message);
    _vpCache = { clusters: {} };
  }
  return _vpCache;
}

/**
 * Weighted-average signals across all clusters for an archetype.
 * Empty return if archetype has no data. Fast, cached.
 */
function byArchetype(archetypeId) {
  if (_byArchCache) return _byArchCache[archetypeId] || null;
  const vp = load();
  const acc = {};
  const accKeys = ['price_sensitivity', 'service_expectation', 'cleanliness_threshold', 'loyalty_sensitivity', 'luxury_benchmark_score', 'family_orientation', 'emotional_intensity', 'decision_latency_proxy'];
  const complaintCounter = {};    // archetype → { trigger: count }
  const amenityCounter = {};      // archetype → { amenity: count }
  for (const [key, c] of Object.entries(vp.clusters || {})) {
    if (!c.signals) continue;
    const a = c.archetype || key.split('.')[0];
    if (a === 'unclassified') continue;
    const w = c.n || 1;
    if (!acc[a]) { acc[a] = { n: 0 }; for (const k of accKeys) acc[a][k] = 0; }
    acc[a].n += w;
    for (const k of accKeys) acc[a][k] += w * (c.signals[k] || 0);
    if (!complaintCounter[a]) complaintCounter[a] = {};
    for (const t of (c.complaint_triggers || [])) complaintCounter[a][t] = (complaintCounter[a][t] || 0) + w;
    if (!amenityCounter[a]) amenityCounter[a] = {};
    for (const t of (c.amenity_focus || [])) amenityCounter[a][t] = (amenityCounter[a][t] || 0) + w;
  }
  _byArchCache = {};
  for (const [a, row] of Object.entries(acc)) {
    if (row.n === 0) continue;
    const avgs = {};
    for (const k of accKeys) avgs[k] = row[k] / row.n;
    _byArchCache[a] = {
      ...avgs,
      n_reviews_behind: row.n,
      top_complaint_triggers: Object.entries(complaintCounter[a] || {}).sort((x, y) => y[1] - x[1]).slice(0, 5).map(([t, n]) => ({ trigger: t, weight: n })),
      top_amenity_focus: Object.entries(amenityCounter[a] || {}).sort((x, y) => y[1] - x[1]).slice(0, 5).map(([t, n]) => ({ amenity: t, weight: n })),
    };
  }
  return _byArchCache[archetypeId] || null;
}

/**
 * Culture-specific signals per archetype. Returns null if no culture cluster
 * exists; callers should fall back to byArchetype().
 */
function byArchetypeAndCulture(archetypeId, cultureCluster) {
  if (!cultureCluster) return null;
  if (_byArchCultureCache && _byArchCultureCache[`${archetypeId}.${cultureCluster}`]) return _byArchCultureCache[`${archetypeId}.${cultureCluster}`];
  const vp = load();
  const acc = { n: 0, price_sensitivity: 0, service_expectation: 0, cleanliness_threshold: 0, loyalty_sensitivity: 0, luxury_benchmark_score: 0, family_orientation: 0, emotional_intensity: 0, decision_latency_proxy: 0 };
  const complaintCounter = {};
  const amenityCounter = {};
  let found = false;
  for (const [key, c] of Object.entries(vp.clusters || {})) {
    if (!c.signals) continue;
    if (!key.endsWith(`.${cultureCluster}`)) continue;
    if (c.archetype !== archetypeId && !key.startsWith(`${archetypeId}.`)) continue;
    const w = c.n || 1;
    acc.n += w; found = true;
    for (const k of Object.keys(acc)) if (k !== 'n') acc[k] += w * (c.signals[k] || 0);
    for (const t of (c.complaint_triggers || [])) complaintCounter[t] = (complaintCounter[t] || 0) + w;
    for (const t of (c.amenity_focus || [])) amenityCounter[t] = (amenityCounter[t] || 0) + w;
  }
  if (!found) return null;
  const avgs = {};
  for (const k of Object.keys(acc)) if (k !== 'n') avgs[k] = acc[k] / acc.n;
  const result = {
    ...avgs,
    n_reviews_behind: acc.n,
    top_complaint_triggers: Object.entries(complaintCounter).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([t, n]) => ({ trigger: t, weight: n })),
    top_amenity_focus: Object.entries(amenityCounter).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([t, n]) => ({ amenity: t, weight: n })),
  };
  _byArchCultureCache = _byArchCultureCache || {};
  _byArchCultureCache[`${archetypeId}.${cultureCluster}`] = result;
  return result;
}

/**
 * Preferred accessor: tries culture-specific first, falls back to archetype.
 */
function forArchetype(archetypeId, { culture = null } = {}) {
  const culturalRow = byArchetypeAndCulture(archetypeId, culture);
  if (culturalRow) return { ...culturalRow, _source: `archetype+culture:${archetypeId}.${culture}` };
  const row = byArchetype(archetypeId);
  if (row) return { ...row, _source: `archetype:${archetypeId}` };
  return null;
}

/**
 * Weighted-average a signal across an archetype mix. Returns the map of signal
 * names → expected value, given `archetype_mix_pct = { luxury_seeker: 40, ... }`.
 */
function weightedAcrossMix(archetype_mix_pct = {}, { culture = null } = {}) {
  const out = {
    price_sensitivity: 0, service_expectation: 0, cleanliness_threshold: 0,
    loyalty_sensitivity: 0, luxury_benchmark_score: 0, family_orientation: 0,
    emotional_intensity: 0, decision_latency_proxy: 0,
    _n_reviews_backing: 0, _sources: [],
  };
  const totalW = Object.values(archetype_mix_pct).reduce((s, w) => s + (w || 0), 0) || 1;
  for (const [arch, w] of Object.entries(archetype_mix_pct)) {
    if (!w) continue;
    const row = forArchetype(arch, { culture });
    if (!row) continue;
    const share = w / totalW;
    for (const k of Object.keys(out)) {
      if (k.startsWith('_')) continue;
      out[k] += share * (row[k] || 0);
    }
    out._n_reviews_backing += row.n_reviews_behind || 0;
    out._sources.push({ archetype: arch, weight: w, n_behind: row.n_reviews_behind, source: row._source });
  }
  return out;
}

/**
 * Complaint triggers a cohort is most sensitive to, given an archetype mix.
 * Returns a ranked list with aggregated weights.
 */
function topComplaintTriggersForMix(archetype_mix_pct = {}) {
  const agg = {};
  const totalW = Object.values(archetype_mix_pct).reduce((s, w) => s + (w || 0), 0) || 1;
  for (const [arch, w] of Object.entries(archetype_mix_pct)) {
    const row = byArchetype(arch);
    if (!row) continue;
    for (const { trigger, weight } of row.top_complaint_triggers || []) {
      agg[trigger] = (agg[trigger] || 0) + (w / totalW) * weight;
    }
  }
  return Object.entries(agg).sort((a, b) => b[1] - a[1]).map(([trigger, weight]) => ({ trigger, weight: Math.round(weight * 100) / 100 }));
}

function clearCache() {
  _vpCache = null;
  _byArchCache = null;
  _byArchCultureCache = null;
}

module.exports = {
  load,
  byArchetype,
  byArchetypeAndCulture,
  forArchetype,
  weightedAcrossMix,
  topComplaintTriggersForMix,
  clearCache,
};
