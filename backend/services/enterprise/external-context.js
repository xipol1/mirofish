/**
 * External Context Service
 *
 * Models the non-hotel-controlled factors that shape a stay: weather per night,
 * season, local events, property occupancy at the time of stay, staff:guest ratio.
 *
 * Feeds the narrative engine so stages produce context-aware outputs. A rainy day
 * at a beach resort is a fundamentally different experience from a sunny one.
 */

const path = require('path');
const fs = require('fs');

const EXT_PATH = path.join(__dirname, '..', '..', 'data', 'industries', 'hospitality', 'external_context.json');
let _cfg = null;
function getConfig() {
  if (_cfg) return _cfg;
  _cfg = JSON.parse(fs.readFileSync(EXT_PATH, 'utf-8'));
  return _cfg;
}

function pickWeightedKey(weights) {
  const entries = Object.entries(weights);
  const total = entries.reduce((s, [, v]) => s + v, 0) || 1;
  let r = Math.random() * total;
  for (const [k, v] of entries) {
    r -= v;
    if (r <= 0) return k;
  }
  return entries[0][0];
}

/**
 * Sample a weather array for N nights, using Menorca-typical seasonal probabilities.
 */
function sampleWeatherArray(nights = 5, season = 'mid') {
  const weatherWeights = {
    high: { sunny_calm: 50, sunny_heatwave: 20, overcast: 10, rainy_light: 8, windy: 8, rainy_storm: 3, cold_snap: 1 },
    mid: { sunny_calm: 40, sunny_heatwave: 5, overcast: 20, rainy_light: 15, windy: 12, rainy_storm: 5, cold_snap: 3 },
    low: { sunny_calm: 25, sunny_heatwave: 0, overcast: 30, rainy_light: 22, windy: 15, rainy_storm: 6, cold_snap: 2 },
    holiday_surge: { sunny_calm: 35, sunny_heatwave: 5, overcast: 25, rainy_light: 15, windy: 12, rainy_storm: 5, cold_snap: 3 },
  };
  const weights = weatherWeights[season] || weatherWeights.mid;
  return Array.from({ length: nights }, () => pickWeightedKey(weights));
}

function getWeatherInfo(weatherKey) {
  const cfg = getConfig();
  return cfg.weather_types[weatherKey] || cfg.weather_types.sunny_calm;
}

function getSeasonInfo(seasonKey) {
  const cfg = getConfig();
  return cfg.seasons[seasonKey] || cfg.seasons.mid;
}

function getOccupancyBucket(pct) {
  const cfg = getConfig();
  const buckets = cfg.occupancy_buckets;
  const order = ['very_low', 'low', 'medium', 'high', 'near_full'];
  for (const key of order) {
    if (pct <= buckets[key].pct_max) return { key, ...buckets[key] };
  }
  return { key: 'near_full', ...buckets.near_full };
}

function getLocalEventInfo(eventKey) {
  const cfg = getConfig();
  return cfg.local_events[eventKey] || cfg.local_events.none;
}

function mergeModifiers(...mods) {
  const out = {};
  for (const m of mods) {
    if (!m) continue;
    for (const [k, v] of Object.entries(m)) {
      if (typeof v === 'number') out[k] = (out[k] || 0) + v;
    }
  }
  return out;
}

/**
 * Build full external context for a stay. Can be called with full specification
 * or sample realistic defaults for Menorca.
 *
 * @param {Object} input
 * @param {string} input.season            'high' | 'mid' | 'low' | 'holiday_surge'
 * @param {number} input.nights            Number of nights (for weather array)
 * @param {string[]} input.weather_array   Pre-specified weather per night, overrides sampling
 * @param {string[]} input.local_events    Pre-specified local events during the stay
 * @param {number} input.occupancy_pct     0-100. If omitted, inferred from season.
 */
function buildExternalContext({ season = 'mid', nights = 5, weather_array = null, local_events = null, occupancy_pct = null } = {}) {
  const seasonInfo = getSeasonInfo(season);

  const weather = weather_array && weather_array.length === nights
    ? weather_array
    : sampleWeatherArray(nights, season);

  const events = Array.isArray(local_events) ? local_events : (Math.random() < 0.25 ? [weightedLocalEvent()] : []);

  const occ = occupancy_pct != null
    ? Math.max(0, Math.min(100, occupancy_pct))
    : Math.max(20, Math.min(100, Math.round((seasonInfo.typical_occupancy_pct || 70) + (Math.random() * 20 - 10))));
  const occBucket = getOccupancyBucket(occ);

  // Aggregate the sensation modifiers (season + occupancy + events + average weather)
  const weatherMods = weather.map(w => getWeatherInfo(w).sensation_modifiers || {});
  const avgWeatherMod = averageModifiers(weatherMods);
  const eventMods = events.map(e => getLocalEventInfo(e).sensation_modifiers || {});

  const aggregated_baseline_modifiers = mergeModifiers(
    seasonInfo.sensation_modifiers,
    avgWeatherMod,
    occBucket.sensation_modifiers,
    ...eventMods
  );

  const narrative_block = [
    `=== EXTERNAL CONTEXT (shapes every stage) ===`,
    `Season: ${seasonInfo.label} (typical occupancy ${seasonInfo.typical_occupancy_pct}%, price vs annual avg ${seasonInfo.typical_price_vs_annual_avg_pct}%)`,
    `Property occupancy during this stay: ${occ}% (${occBucket.key.replace('_', ' ')})`,
    `Weather per night:`,
    ...weather.map((w, i) => `  Night ${i + 1}: ${getWeatherInfo(w).label}`),
    `Local events: ${events.length > 0 ? events.map(e => getLocalEventInfo(e).label).join(' | ') : 'none'}`,
    ``,
    `Narrative hints for the stay overall:`,
    `  - ${seasonInfo.narrative_hint || ''}`,
    ...weather.slice(0, 2).map(w => `  - ${getWeatherInfo(w).narrative_hint || ''}`),
    ...events.map(e => `  - ${getLocalEventInfo(e).narrative_hint || ''}`),
  ].filter(Boolean).join('\n');

  return {
    season,
    season_label: seasonInfo.label,
    occupancy_pct: occ,
    occupancy_bucket: occBucket.key,
    weather_array: weather,
    weather_labels: weather.map(w => getWeatherInfo(w).label),
    local_events: events,
    local_events_labels: events.map(e => getLocalEventInfo(e).label),
    aggregated_baseline_modifiers,
    narrative_block,
  };
}

function averageModifiers(modList) {
  if (!modList.length) return {};
  const sum = {};
  for (const m of modList) {
    for (const [k, v] of Object.entries(m)) {
      if (typeof v === 'number') sum[k] = (sum[k] || 0) + v;
    }
  }
  return Object.fromEntries(Object.entries(sum).map(([k, v]) => [k, Math.round((v / modList.length) * 10) / 10]));
}

function weightedLocalEvent() {
  const events = getConfig().local_events;
  // Exclude 'none' from random sampling (that's already handled upstream)
  const candidates = Object.keys(events).filter(k => k !== 'none');
  return candidates[Math.floor(Math.random() * candidates.length)];
}

/**
 * Return a per-stage narrative add-on based on that day's weather + events.
 * Called by the narrative engine so each stage picks up the day-specific context.
 */
function getStageContextBlock({ externalContext, nightNumber = 1 }) {
  const night = Math.max(1, Math.min(nightNumber, (externalContext.weather_array || []).length));
  const weatherKey = (externalContext.weather_array || [])[night - 1];
  const wInfo = weatherKey ? getWeatherInfo(weatherKey) : null;

  const lines = [];
  if (wInfo) {
    lines.push(`Today's weather (night ${night}): ${wInfo.label}`);
    if (wInfo.narrative_hint) lines.push(`  → ${wInfo.narrative_hint}`);
  }
  if ((externalContext.local_events || []).length > 0) {
    for (const e of externalContext.local_events) {
      const info = getLocalEventInfo(e);
      if (info.narrative_hint) lines.push(`Local event: ${info.narrative_hint}`);
    }
  }
  if (lines.length === 0) return '';
  return `\n--- Stage context ---\n${lines.join('\n')}\n`;
}

module.exports = {
  buildExternalContext,
  getStageContextBlock,
  sampleWeatherArray,
  getWeatherInfo,
  getSeasonInfo,
  getOccupancyBucket,
  getConfig,
};
