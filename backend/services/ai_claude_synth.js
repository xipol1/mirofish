/**
 * AI Claude Synth — deterministic LLM stub designed by Claude.
 *
 * Replaces the LLM provider entirely. For each prompt (stage or review), it:
 *   1. Parses the relevant context fields from the prompt text
 *   2. Generates a structured JSON response that is calibration-aligned,
 *      archetype-aware, stage-appropriate, and target-star-consistent
 *
 * Purpose: run simulations without hitting rate-limited external providers.
 * The output is not as varied as a full LLM but is calibrated to reality and
 * exercises all six humanness layers downstream.
 *
 * Signature: exports { callAIJSON, callAI, getProvider } to match ai.js.
 */

const path = require('path');
const fs = require('fs');

function _readJSON(p, fallback) {
  try {
    if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf-8'));
  } catch (e) {
    console.warn(`[synth] failed to read ${path.basename(p)}: ${e.message}`);
  }
  return fallback;
}

let _calib = null;
function getCalibration() {
  if (_calib) return _calib;
  const p = path.join(__dirname, '..', 'data', 'industries', 'hospitality', 'villa_le_blanc_calibration.json');
  _calib = _readJSON(p, { top_positive_themes: ['location', 'service'], top_negative_themes: ['value'] });
  return _calib;
}

// Real public datasets — loaded once, used to ground the stub in observed reality.
// If any file is missing, the stub falls back to hardcoded ranges (current behavior).
let _datasets = null;
function getDatasets() {
  if (_datasets) return _datasets;
  const srcDir = path.join(__dirname, '..', 'data', 'sources');
  _datasets = {
    europeReviews: _readJSON(path.join(srcDir, 'reviews_europe_calibrated.json'), null),
    spendProfiles: _readJSON(path.join(srcDir, 'guest_spend_profiles.json'), null),
    incidentRates: _readJSON(path.join(srcDir, 'ops_incident_rates.json'), null),
    occupancyPricing: _readJSON(path.join(srcDir, 'occupancy_pricing_menorca.json'), null),
  };
  const loaded = Object.entries(_datasets).filter(([, v]) => v).map(([k]) => k);
  console.log(`[synth] datasets loaded: ${loaded.join(', ') || '(none — using hardcoded fallbacks)'}`);
  return _datasets;
}

// Review pool — Claude-authored bodies/titles per cluster×stars.
// Missing pool file → composeReviewBody/Title fall back to template composition.
let _reviewPool = null;
function getReviewPool() {
  if (_reviewPool) return _reviewPool;
  const poolDir = path.join(__dirname, '..', 'data', 'synth_pools');
  const bodies = _readJSON(path.join(poolDir, 'review_bodies.json'), null);
  const titles = _readJSON(path.join(poolDir, 'review_titles.json'), null);
  _reviewPool = {
    bodies: bodies?.bodies || {},
    titles: titles?.titles || {},
    loaded: !!(bodies && titles),
  };
  if (_reviewPool.loaded) {
    const bodyCount = Object.values(_reviewPool.bodies).reduce((n, arr) => n + (arr?.length || 0), 0);
    const titleCount = Object.values(_reviewPool.titles).reduce((n, arr) => n + (arr?.length || 0), 0);
    console.log(`[synth] review pool loaded: ${bodyCount} bodies, ${titleCount} titles across ${Object.keys(_reviewPool.bodies).length} buckets`);
  } else {
    console.log(`[synth] review pool NOT loaded — falling back to template composition`);
  }
  return _reviewPool;
}

// Stage narrative pool — Claude-authored first-person narratives per stage×stars.
// Missing file → buildNarrative falls back to single-template lookup.
let _stageNarrativePool = null;
function getStageNarrativePool() {
  if (_stageNarrativePool) return _stageNarrativePool;
  const p = path.join(__dirname, '..', 'data', 'synth_pools', 'stage_narratives.json');
  const raw = _readJSON(p, null);
  _stageNarrativePool = { narratives: raw?.narratives || {}, loaded: !!raw };
  if (_stageNarrativePool.loaded) {
    const n = Object.values(_stageNarrativePool.narratives).reduce((acc, arr) => acc + (arr?.length || 0), 0);
    console.log(`[synth] stage narrative pool loaded: ${n} narratives across ${Object.keys(_stageNarrativePool.narratives).length} buckets`);
  } else {
    console.log(`[synth] stage narrative pool NOT loaded — falling back to single template per stage`);
  }
  return _stageNarrativePool;
}

function parseField(text, label) {
  const re = new RegExp(label + '[:\\s]+([^\\n]+)', 'i');
  const m = text.match(re);
  return m ? m[1].trim() : null;
}

function parseStage(prompt) {
  const m = prompt.match(/^Stage:\s*([a-z_0-9]+)/m)
        || prompt.match(/STAGE LABEL:\s*([a-z_0-9]+)/i)
        || prompt.match(/AT THIS STAGE \(([a-z_0-9]+)\)/i)
        || prompt.match(/=== STAGE ===\s*\n?([a-z_0-9]+)/i);
  return m ? m[1] : null;
}

function parseTargetStars(prompt) {
  const m = prompt.match(/This will be a (\d)-star/i)
        || prompt.match(/(\d)-star experience/i)
        || prompt.match(/target.{0,20}?(\d)\s*★/i);
  return m ? parseInt(m[1], 10) : null;
}

function parseArchetype(prompt) {
  const m = prompt.match(/Archetype:\s*([^\n]+)/);
  return m ? m[1].toLowerCase().replace(/[^a-z_]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '') : null;
}

function parseArchetypeId(prompt) {
  // archetype ids are snake_case in the injected_event block or stage_behaviors
  const labels = {
    'honeymooner': 'honeymooner', 'honeymoon': 'honeymooner', 'romantic_couple': 'honeymooner',
    'luxury_seeker': 'luxury_seeker', 'luxury': 'luxury_seeker',
    'family_vacationer': 'family_vacationer', 'family': 'family_vacationer',
    'business_traveler': 'business_traveler', 'business': 'business_traveler',
    'digital_nomad': 'digital_nomad', 'remote_worker': 'digital_nomad',
    'budget_optimizer': 'budget_optimizer', 'budget': 'budget_optimizer',
    'loyalty_maximizer': 'loyalty_maximizer', 'loyalty': 'loyalty_maximizer',
    'event_attendee': 'event_attendee',
  };
  const arch = parseArchetype(prompt) || '';
  for (const [k, v] of Object.entries(labels)) {
    if (arch.includes(k)) return v;
  }
  return 'luxury_seeker';
}

function parseCulturalCluster(prompt) {
  const m = prompt.match(/Culture cluster:\s*([^\n]+)/i);
  if (!m) return null;
  const label = m[1].toLowerCase();
  if (label.includes('germany') || label.includes('austria')) return 'german_dach';
  if (label.includes('uk') || label.includes('ireland')) return 'anglo_uk_ireland';
  if (label.includes('usa') || label.includes('canada')) return 'anglo_us_canada';
  if (label.includes('france')) return 'french';
  if (label.includes('spain') || label.includes('italy')) return 'latin_spain_italy';
  if (label.includes('nordic')) return 'nordic';
  if (label.includes('japan') || label.includes('korea')) return 'east_asian';
  if (label.includes('chinese')) return 'chinese_mainland';
  if (label.includes('gcc') || label.includes('middle east')) return 'middle_east_gcc';
  if (label.includes('latin american') || label.includes('mexico') || label.includes('brazil')) return 'latin_american';
  return 'anglo_uk_ireland';
}

function parseMandatoryIncident(prompt) {
  // Only fire when the REAL adversarial-events.buildEventPromptBlock is
  // present. The string "MANDATORY INCIDENT" also appears in descriptive
  // guidance text (luxury calibration prose); we must not treat that as an
  // actual event. Require: section header + both Incident and Staff
  // resolution quality fields present.
  const idx = prompt.indexOf('=== MANDATORY INCIDENT THIS STAGE ===');
  if (idx < 0) return null;
  const block = prompt.slice(idx, idx + 1200);
  const labelMatch = block.match(/Incident:\s*([^\n]+)/);
  const resMatch = block.match(/Staff resolution quality:\s*([^\n—]+)/i);
  if (!labelMatch || !resMatch) return null;
  return {
    label: labelMatch[1].trim(),
    resolution: resMatch[1].trim(),
  };
}

function parsePersonaName(prompt) {
  const m = prompt.match(/^Name:\s*([^\n]+)/m);
  return m ? m[1].trim() : 'Guest';
}

// ─── Stage output generation ────────────────────────────────────────────

// Stage-appropriate positive/negative moment pools, drawn from Villa Le Blanc's
// top themes (location, design, staff warmth, breakfast, sustainability, dining).
const STAGE_POSITIVE_MOMENTS = {
  arrival: [
    'Núria greeted us by name at the entrance, remembering our arrival flight',
    'the lobby opened onto a breathtaking view of the Mediterranean — we stopped for a moment',
    'welcome drink of local vermouth served in handblown glass',
    'seamless valet; bags appeared in the suite within minutes',
    'the check-in was effortless — three questions, a handwritten welcome card, and we were in the room',
  ],
  room_first_impression: [
    'the suite was stunning — travertine bath, linen curtains, sea-facing terrace larger than expected',
    'amenity selection felt personal: local honey, fig soap, noise-cancelling pillows on request',
    'a handwritten note from the GM with two champagne flutes was waiting on the table',
    'the room smelled of figs and sea salt; the lighting felt like dusk even at 3pm',
    'the blackout curtains worked beautifully and the bed was exactly the right firmness',
  ],
  evening_1: [
    'aperitivo at Cru — the sushi was outstanding; tuna was the best we\'ve had outside Tokyo',
    'rooftop pool at sunset, adults-only, absolutely quiet except for the cicadas',
    'bartender Alejandro made us a custom cocktail when we described our flavor profile',
    'sommelier recommendation paired a Menorca rosé with dinner; inspired pairing',
  ],
  morning_routine: [
    'breakfast buffet was spectacular — tomatoes on salty bread, local cheeses, fresh pastries',
    'eggs cooked to order; barista remembered our coffee preference from yesterday',
    'morning light through the linen curtains made the room glow gold',
    'slow, lingering breakfast on the terrace with no one rushing us',
  ],
  daytime_activity: [
    'private cabana by the adult pool with chilled rosé and cold towels every 20 min',
    'concierge arranged a sailing trip to Cala Galdana at short notice',
    'beach access below the property is pristine — no crowds, just white sand',
    'pool attendant Marco proactively adjusted our umbrella as the sun moved',
  ],
  lunch: [
    'lunch at SAmardor — grilled squid over black rice, exceptional',
    'the open kitchen concept is lovely; you watch the chef work',
    'paella lunch with a chilled albariño, poolside',
  ],
  afternoon_activity: [
    'Thai spa session with hydrothermal circuit — the best spa facility on the island',
    'therapist Lin was technically superb and intuitive about pressure',
    'post-spa, they left an infusion of lavender and honey in the relaxation room',
  ],
  dinner: [
    'tasting menu at La Sal — 7 courses, each better than the last',
    'the chef came out to explain the Menorcan provenance of the langoustines',
    'wine pairing included a biodynamic local rosé we\'d never have ordered on our own',
    'candle-lit terrace, sea breeze, attentive but invisible service',
  ],
  evening_leisure: [
    'post-dinner limoncello on the terrace, stars visible, silence',
    'the bartender remembered we liked amaro digestivos and made a split recommendation',
  ],
  last_morning: [
    'last breakfast was as perfect as the first — consistency through the stay',
    'the GM stopped by to thank us personally and asked about our return',
    'picnic box for the airport thoughtfully prepared with our favorite pastries',
  ],
  checkout: [
    'checkout was frictionless; the bill matched exactly what we expected',
    'bellman Javi brought our bags to a waiting transfer car, handed over a bottle of local olive oil',
    'a handwritten thank-you note from the concierge was slipped into the luggage',
  ],
};

const STAGE_NEGATIVE_MOMENTS = {
  arrival: [
    'room wasn\'t ready at 15:00 check-in despite advance notice; waited 40 min',
    'the welcome drink was nice but the lobby was understaffed on arrival',
  ],
  room_first_impression: [
    'the in-room Wi-Fi dropped out twice while unpacking',
    'the minibar was understocked on our preferred sparkling water',
  ],
  evening_1: [
    'restaurant reservation took 25 min to seat despite booking; slight friction',
    'a nearby table was loud enough that we asked to be moved',
  ],
  morning_routine: [
    'coffee at breakfast was slow to refill; had to ask twice',
  ],
  daytime_activity: [
    'pool area reached capacity by 11am and felt crowded for a supposed adults-only',
    'towel refresh took 45 min despite the pool attendant visible at the stand',
  ],
  lunch: [
    'service at the poolside restaurant was noticeably slower than the main restaurants',
  ],
  afternoon_activity: [
    'the spa locker room hair dryers were older models and struggled',
  ],
  dinner: [
    'the menu was more limited than we expected for a property of this tier',
    'we were seated closer to the kitchen than advertised for the tasting menu experience',
  ],
  evening_leisure: [
    'the rooftop bar closed earlier than posted — 23:00 instead of the 00:00 we\'d planned around',
  ],
  last_morning: [
    'checkout was delayed by a queue at the front desk',
  ],
  checkout: [
    'a €45 resort fee per night surfaced at checkout that wasn\'t explained at booking',
    'local tax line item was slightly higher than what was quoted',
  ],
};

// Archetype-specific amplifiers — what each archetype will MOST LIKELY notice
const ARCHETYPE_MOMENT_FILTERS = {
  honeymooner:       { boost: ['aesthetic', 'personalization', 'authenticity', 'romantic'], dampen: [] },
  luxury_seeker:     { boost: ['aesthetic', 'culinary', 'personalization', 'service_quality'], dampen: [] },
  family_vacationer: { boost: ['cleanliness', 'safety', 'amenity_usability'], dampen: [] },
  business_traveler: { boost: ['speed', 'service_quality', 'amenity_usability'], dampen: [] },
  digital_nomad:     { boost: ['amenity_usability', 'modernity', 'speed'], dampen: [] },
  budget_optimizer:  { boost: ['value', 'cleanliness'], dampen: [] },
  loyalty_maximizer: { boost: ['personalization', 'service_quality'], dampen: [] },
  event_attendee:    { boost: ['amenity_usability', 'service_quality'], dampen: [] },
};

// Delta templates per stage — calibrated to land at a 4.65★ avg across n=20.
// For 5★ stays we push deltas heavier because downstream forces (adversarial
// events, surprise charges, hedonic adaptation, peak-end weighting of any
// negatives) subtract meaningful amounts. Templates target: final_state
// aggregate in the 70-88 range for 5★ (matching Villa Le Blanc subcategory
// anchors 90-98 after saturation clamping at 100).
// 5★ template — tuned to land scores in the 85-92 range (NPS 70-95 band),
// NOT saturated at 100. Previous values saturated too aggressively, pushing
// almost all NPS to the ceiling (100) which is unrealistic — real 5★ reviews
// cluster NPS 70-95, with ~20% hitting 100. Halved the deltas and the
// downstream sqrt-bonus brings us into that band.
const STAGE_DELTA_TEMPLATE_5STAR = {
  arrival:               { service_quality: 11, personalization: 10, speed: 7, aesthetic: 9, cleanliness: 6, comfort_physical: 5 },
  room_first_impression: { aesthetic: 12, comfort_physical: 10, cleanliness: 9, personalization: 8, amenity_usability: 6, modernity: 4 },
  evening_1:             { culinary: 10, service_quality: 9, authenticity: 7, aesthetic: 6, value: 4 },
  morning_routine:       { culinary: 9, service_quality: 8, comfort_physical: 6, cleanliness: 4 },
  daytime_activity:      { amenity_usability: 9, aesthetic: 7, comfort_physical: 6, service_quality: 6, safety: 3 },
  lunch:                 { culinary: 8, service_quality: 6, value: 3 },
  afternoon_activity:    { amenity_usability: 9, service_quality: 8, comfort_physical: 6, aesthetic: 5 },
  dinner:                { culinary: 11, service_quality: 9, authenticity: 7, aesthetic: 6 },
  evening_leisure:       { aesthetic: 6, service_quality: 5, comfort_physical: 4 },
  last_morning:          { culinary: 8, personalization: 7, service_quality: 4 },
  checkout:              { service_quality: 11, personalization: 10, value: 6 },
};

const STAGE_DELTA_TEMPLATE_4STAR = {
  arrival:               { service_quality: 4, personalization: 2, speed: 2 },
  room_first_impression: { aesthetic: 5, comfort_physical: 4, cleanliness: 4 },
  evening_1:             { culinary: 4, service_quality: 3, authenticity: 2 },
  morning_routine:       { culinary: 3, service_quality: 2 },
  daytime_activity:      { amenity_usability: 3, aesthetic: 3 },
  lunch:                 { culinary: 2, service_quality: 2 },
  afternoon_activity:    { amenity_usability: 3, service_quality: 2 },
  dinner:                { culinary: 4, service_quality: 3, aesthetic: 2 },
  evening_leisure:       { aesthetic: 2 },
  last_morning:          { culinary: 3 },
  checkout:              { service_quality: 3 },
};

const STAGE_DELTA_TEMPLATE_3STAR = {
  arrival:               { service_quality: 1, speed: -2 },
  room_first_impression: { aesthetic: 3, cleanliness: 2, amenity_usability: -2 },
  evening_1:             { culinary: 2, service_quality: 1 },
  morning_routine:       { culinary: 1 },
  daytime_activity:      { amenity_usability: 0, crowd: -3 },
  lunch:                 { culinary: 1 },
  afternoon_activity:    { amenity_usability: 1 },
  dinner:                { culinary: 2, service_quality: 0 },
  evening_leisure:       {},
  last_morning:          { culinary: 1 },
  checkout:              { service_quality: -1, value: -3 },
};

const STAGE_DELTA_TEMPLATE_2STAR = {
  arrival:               { service_quality: -3, speed: -5, personalization: -4 },
  room_first_impression: { comfort_physical: -4, cleanliness: -3, amenity_usability: -5 },
  evening_1:             { culinary: -2, service_quality: -4 },
  morning_routine:       { culinary: -1, service_quality: -3 },
  daytime_activity:      { amenity_usability: -3, crowd: -5 },
  lunch:                 { culinary: -3, service_quality: -4 },
  afternoon_activity:    { amenity_usability: -2, service_quality: -3 },
  dinner:                { culinary: -3, service_quality: -5 },
  evening_leisure:       { crowd: -3 },
  last_morning:          { culinary: -2 },
  checkout:              { value: -8, service_quality: -4 },
};

const STAGE_DELTA_TEMPLATE_1STAR = {
  arrival:               { service_quality: -8, speed: -10, personalization: -7 },
  room_first_impression: { comfort_physical: -7, cleanliness: -6, amenity_usability: -8 },
  evening_1:             { culinary: -5, service_quality: -7, value: -5 },
  morning_routine:       { culinary: -4, service_quality: -6 },
  daytime_activity:      { amenity_usability: -5, crowd: -8, safety: -3 },
  lunch:                 { culinary: -6, service_quality: -7 },
  afternoon_activity:    { amenity_usability: -5, service_quality: -6 },
  dinner:                { culinary: -6, service_quality: -8 },
  evening_leisure:       { crowd: -5 },
  last_morning:          { culinary: -4 },
  checkout:              { value: -14, service_quality: -7 },
};

function pickTemplateByTarget(stars) {
  if (stars >= 5) return STAGE_DELTA_TEMPLATE_5STAR;
  if (stars === 4) return STAGE_DELTA_TEMPLATE_4STAR;
  if (stars === 3) return STAGE_DELTA_TEMPLATE_3STAR;
  if (stars === 2) return STAGE_DELTA_TEMPLATE_2STAR;
  return STAGE_DELTA_TEMPLATE_1STAR;
}

function hash(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
  return h;
}

function pick(arr, salt) {
  if (!arr || arr.length === 0) return null;
  const idx = salt % arr.length;
  return arr[idx];
}

// Expense profiles by archetype × stage type (rough ranges in EUR)
const EXPENSE_BY_STAGE_ARCH = {
  dinner: {
    honeymooner:       { category: 'dinner', item: 'tasting menu with wine pairing', range: [180, 320] },
    luxury_seeker:     { category: 'dinner', item: 'tasting menu with wine pairing', range: [200, 380] },
    family_vacationer: { category: 'dinner', item: 'family table, three courses', range: [140, 220] },
    business_traveler: { category: 'dinner', item: 'steak + wine', range: [90, 140] },
    digital_nomad:     { category: 'dinner', item: 'small plates + local wine', range: [70, 110] },
    budget_optimizer:  { category: 'dinner', item: 'main course + house wine', range: [50, 80] },
    loyalty_maximizer: { category: 'dinner', item: 'tasting menu', range: [150, 250] },
    event_attendee:    { category: 'dinner', item: 'shared plates + cocktails', range: [100, 160] },
  },
  lunch: {
    honeymooner:       { category: 'lunch', item: 'poolside lunch with wine', range: [70, 130] },
    luxury_seeker:     { category: 'lunch', item: 'grilled fish with white wine', range: [90, 140] },
    family_vacationer: { category: 'lunch', item: 'family lunch', range: [80, 140] },
    business_traveler: { category: 'lunch', item: 'quick lunch', range: [30, 55] },
    budget_optimizer:  { category: 'lunch', item: 'light lunch', range: [25, 45] },
  },
  evening_1: {
    honeymooner:       { category: 'bar', item: 'cocktails at sunset', range: [40, 80] },
    luxury_seeker:     { category: 'bar', item: 'champagne flute + snacks', range: [50, 95] },
    family_vacationer: { category: 'bar', item: 'aperitifs', range: [30, 55] },
  },
  afternoon_activity: {
    honeymooner:       { category: 'spa', item: 'couples massage', range: [220, 380] },
    luxury_seeker:     { category: 'spa', item: 'signature treatment', range: [180, 320] },
    family_vacationer: { category: 'activities', item: 'kids club afternoon', range: [0, 60] },
  },
  daytime_activity: {
    honeymooner:       { category: 'activities', item: 'private cabana rental', range: [60, 140] },
    luxury_seeker:     { category: 'activities', item: 'sailing charter half-day', range: [280, 450] },
    family_vacationer: { category: 'activities', item: 'family sailing', range: [120, 200] },
  },
  checkout: {
    // surprise resort fee at checkout — triggers loss aversion
    _surprise: { category: 'resort_fee', item: 'resort fee per night', range: [30, 50] },
  },
};

// Cultural multipliers from guest_spend_profiles.json._cultural_multipliers —
// applied to amount_eur when the dataset is loaded.
function _culturalMultiplier(culturalCluster, category) {
  const ds = getDatasets();
  const multipliers = ds.spendProfiles?._cultural_multipliers?.[culturalCluster];
  if (!multipliers) return 1;
  // category in stub is 'dinner'/'lunch'/'bar'/'spa'/'activities'/'resort_fee' —
  // map to dataset keys 'dining'/'bar'/'spa'/'activities'/'upsell'.
  const catMap = { dinner: 'dining', lunch: 'dining', bar: 'bar', spa: 'spa', activities: 'activities' };
  const dsCat = catMap[category] || category;
  return multipliers[dsCat] || 1;
}

// Real surprise_fee_at_checkout rate from ops_incident_rates.json (luxury tier).
// Fallback to 12% (previous hardcode) if dataset missing.
function _surpriseFeeRate() {
  const ds = getDatasets();
  return ds.incidentRates?.real_frequency_pct_per_stay_by_tier?.luxury?.surprise_fee_at_checkout ?? 0.12;
}

function sampleExpense(stage, archetypeId, salt, culturalCluster = null) {
  const stageExps = EXPENSE_BY_STAGE_ARCH[stage];
  if (!stageExps) return [];

  const out = [];
  const archExp = stageExps[archetypeId];
  if (archExp) {
    const [lo, hi] = archExp.range;
    const base = lo + (salt % (hi - lo + 1));
    const mult = culturalCluster ? _culturalMultiplier(culturalCluster, archExp.category) : 1;
    const amt = Math.round(base * mult);
    out.push({ category: archExp.category, item: archExp.item, amount_eur: amt, included: false, satisfaction: 70 + (salt % 25) });
  }

  // Surprise resort fee at checkout — rate calibrated to real luxury-tier data.
  if (stage === 'checkout' && stageExps._surprise) {
    const rate = _surpriseFeeRate();
    const rollBase = (salt % 1000) / 1000; // 0..1 deterministic
    if (rollBase < rate) {
      const [lo, hi] = stageExps._surprise.range;
      const amt = lo + (salt % (hi - lo + 1));
      out.push({ category: stageExps._surprise.category, item: stageExps._surprise.item, amount_eur: amt, included: false, note: 'surprise charge not mentioned at booking' });
    }
  }
  return out;
}

function generateStageResponse(prompt) {
  const stage = parseStage(prompt) || 'evening_leisure';
  const archetypeId = parseArchetypeId(prompt);
  const targetStars = parseTargetStars(prompt) || 5;
  const incident = parseMandatoryIncident(prompt);
  const personaName = parsePersonaName(prompt);
  const culturalCluster = parseCulturalCluster(prompt);
  const nightMatch = prompt.match(/Current night:\s*(\d+)/);
  const night = nightMatch ? parseInt(nightMatch[1], 10) : 1;
  // Salt includes night_number so a stage repeated across nights produces
  // different moment picks (avoids hedonic adaptation decaying them).
  const salt = hash(personaName + stage + ':' + night);

  const deltaTemplate = pickTemplateByTarget(targetStars);
  const baseDeltas = { ...(deltaTemplate[stage] || {}) };

  // Inject some variance around the template (±2 per dim)
  const sensation_deltas = {};
  for (const [k, v] of Object.entries(baseDeltas)) {
    const jitter = ((salt >> Object.keys(sensation_deltas).length) % 5) - 2;
    sensation_deltas[k] = Math.max(-20, Math.min(20, v + jitter));
  }

  // Archetype boost on their preferred dimensions if target is 4-5
  const amplifier = ARCHETYPE_MOMENT_FILTERS[archetypeId] || ARCHETYPE_MOMENT_FILTERS.luxury_seeker;
  if (targetStars >= 4) {
    for (const dim of amplifier.boost) {
      if (dim in sensation_deltas) sensation_deltas[dim] = Math.min(20, (sensation_deltas[dim] || 0) + 2);
    }
  }

  // Pick positive/negative moments
  const posPool = STAGE_POSITIVE_MOMENTS[stage] || [];
  const negPool = STAGE_NEGATIVE_MOMENTS[stage] || [];

  const moments_positive = [];
  const moments_negative = [];

  // Positive count: calibrated so the sqrt-bonus lands NPS in 75-95 band
  // for 5★ (not 100 ceiling). 2 per stage × ~11 stages = 22 moments,
  // bonus ≈ 3.5 × sqrt(15 weighted) ≈ 13.6 — pairs with base ~78 to give
  // score ~90 → NPS ~85.
  const posCount = targetStars === 5 ? (2 + (salt % 10 < 3 ? 1 : 0))
               : targetStars === 4 ? (1 + (salt % 10 < 4 ? 1 : 0))
               : targetStars === 3 ? 1
               : targetStars === 2 ? (salt % 10 < 3 ? 1 : 0)
               : 0;
  for (let i = 0; i < posCount && i < posPool.length; i++) {
    // Rotate through the pool using different salt offsets to avoid within-stay
    // repetition triggering hedonic adaptation decay.
    moments_positive.push(pick(posPool, salt + i * 7 + Math.floor(salt / 13) * 3));
  }

  // Negative count: 5★ includes 1 small friction in ~10% of stages (so
  // ~1 minor gripe total per stay on average — slow elevator, pricing note),
  // which keeps NPS in the 75-95 band instead of ceiling 100.
  const negCount = targetStars === 5 ? (salt % 10 < 1 ? 1 : 0)
               : targetStars === 4 ? (salt % 10 < 3 ? 1 : 0)
               : targetStars === 3 ? 1
               : targetStars === 2 ? (salt % 10 < 5 ? 2 : 1)
               : 2;
  for (let i = 0; i < negCount && i < negPool.length; i++) {
    moments_negative.push(pick(negPool, salt + i * 11));
  }

  // If MANDATORY INCIDENT is present, ensure a negative moment references it
  if (incident) {
    moments_negative.unshift(`${incident.label} — resolution: ${incident.resolution}`);
    // Compensate sensation slightly based on resolution
    if (/excellent/i.test(incident.resolution)) {
      sensation_deltas.service_quality = (sensation_deltas.service_quality || 0) + 4;
    }
  }

  // Narrative: stage-specific 3-5 sentence first-person. Salt rotates the pool
  // deterministically per (persona, stage, night).
  const narrative = buildNarrative({ stage, personaName, archetypeId, targetStars, incident, hasPositive: posCount > 0, salt });

  // Staff interactions (deterministic, rapport scaled by target stars)
  const staff_interactions_outcome = [];
  if (targetStars >= 4 && salt % 10 < 7) {
    staff_interactions_outcome.push({
      staff_name: 'Núria',
      was_positive: true,
      was_negative: false,
      rapport_delta: targetStars === 5 ? 3 : 2,
      note: stage === 'arrival' ? 'warm and personal welcome' : 'remembered our preferences',
    });
  } else if (targetStars <= 2) {
    staff_interactions_outcome.push({
      staff_name: 'front desk',
      was_positive: false,
      was_negative: true,
      rapport_delta: -1,
      note: 'interaction was transactional at best',
    });
  }

  return {
    narrative,
    internal_thoughts: targetStars >= 4 ? 'this is what we came for.' : targetStars === 3 ? 'fine, not memorable.' : 'not what I expected for the price.',
    sensation_deltas,
    moments_positive,
    moments_negative,
    decisions: {
      dining_choice: stage === 'dinner' ? 'hotel_restaurant' : (stage === 'lunch' ? 'hotel_restaurant' : null),
      upsells_accepted: [],
      upsells_declined: [],
      activities: [],
    },
    expenses: sampleExpense(stage, archetypeId, salt, culturalCluster),
    concerns_voiced_to_staff: moments_negative.length > 0 && targetStars <= 3 ? [moments_negative[0]] : [],
    staff_interactions_outcome,
    physical_state_delta: null,
    abandonment_signal: false,
  };
}

function buildNarrative({ stage, personaName, archetypeId, targetStars, incident, hasPositive, salt = 0 }) {
  // Pool-first path: rotate through Claude-authored variants for this stage×stars.
  // If an incident was injected, append a short reference so the narrative
  // reflects the specific event the orchestrator assigned to this persona.
  const pool = getStageNarrativePool();
  if (pool.loaded) {
    const key = `${stage}_${targetStars}`;
    const arr = pool.narratives[key];
    if (arr && arr.length) {
      let narrative = arr[salt % arr.length];
      if (incident) {
        const suffix = /excellent/i.test(incident.resolution)
          ? ` A small incident surfaced — ${incident.label} — but the staff handled it with real care.`
          : /mediocre|unresolved/i.test(incident.resolution)
            ? ` An incident surfaced mid-stage — ${incident.label} — and the response was less than we'd hoped.`
            : ` ${incident.label} surfaced mid-stage; resolution was adequate.`;
        narrative += suffix;
      }
      return narrative;
    }
  }

  const firstName = personaName.split(' ')[0];
  const toneWord = targetStars >= 5 ? 'magical' : targetStars === 4 ? 'lovely' : targetStars === 3 ? 'fine' : 'disappointing';
  const stageText = {
    arrival: `We arrived at the property just after 3pm. ${targetStars >= 4 ? 'The check-in was ' + toneWord + ' — warm, unhurried.' : 'The check-in felt ' + toneWord + '.'} ${incident ? incident.label + ' surfaced within minutes.' : 'Our bags were in the suite before we\'d finished the welcome drink.'}`,
    room_first_impression: `Walking into the room, ${targetStars >= 4 ? 'I could tell the design team actually cared — the natural materials and the sea-facing terrace immediately told me we\'d chosen well.' : 'the room was fine but less than I\'d imagined from the website.'} ${incident ? incident.label + ' took some shine off.' : 'I took a photo of the view; this is what Instagram never captures.'}`,
    evening_1: `For our first evening we ${targetStars >= 4 ? 'stayed on property — aperitifs at the rooftop bar watching the sun slip into the Mediterranean, then a late dinner downstairs.' : 'had a quieter first night in; we were tired from travel and the restaurant didn\'t excite us.'}`,
    morning_routine: `Breakfast ${targetStars >= 4 ? 'was the highlight of the day so far — fresh tomatoes on salty bread, eggs cooked to order, locally-roasted coffee.' : 'was OK. The buffet had the basics but nothing memorable.'}`,
    daytime_activity: `Spent the day ${targetStars >= 4 ? 'by the adults-only pool — cabanas, cold towels every 20 minutes, rosé on ice. Exactly the reset we came here for.' : 'by the pool, which was more crowded than expected.'}`,
    lunch: `Lunch ${targetStars >= 4 ? 'at the poolside restaurant was excellent — grilled fish, chilled white wine, sea view.' : 'was adequate. Nothing stood out.'}`,
    afternoon_activity: `${targetStars >= 4 ? 'The spa session was the high point of the stay for me. Hydrothermal circuit, then a signature treatment. Left feeling completely reset.' : 'The afternoon dragged. We\'d hoped for more.'}`,
    dinner: `Dinner ${targetStars >= 4 ? 'at the signature restaurant was exceptional — seven courses, each with a story, wine pairing that educated without lecturing.' : 'was fine. The menu was more limited than we\'d hoped.'}`,
    evening_leisure: `${targetStars >= 4 ? 'Limoncello on the terrace afterward, stars out, silence. I could feel the day ending properly.' : 'A quiet end to a so-so day.'}`,
    last_morning: `${targetStars >= 4 ? 'Last breakfast was as perfect as the first. Consistency matters at this level.' : 'Breakfast was a repeat of the same. Already thinking about leaving.'}`,
    checkout: `${targetStars >= 4 ? 'Checkout was effortless. The bill matched the quote, the bellman walked us to the car with our luggage and a bottle of local olive oil.' : 'Checkout dragged. A €45 resort fee per night appeared on the bill that I don\'t remember seeing at booking — not a good way to close out the stay.'}`,
  };
  return stageText[stage] || `${firstName} continued through ${stage.replace(/_/g, ' ')}. ${targetStars >= 4 ? 'The pace felt right.' : 'Mixed feelings.'}`;
}

// ─── Review generation ─────────────────────────────────────────────────

function generateReviewResponse(prompt) {
  // Parse signals from the review prompt
  const starsMatch = prompt.match(/Calculated star rating:\s*(\d)/);
  const stars = starsMatch ? parseInt(starsMatch[1], 10) : 4;
  const npsMatch = prompt.match(/Predicted NPS:\s*(-?\d+)/);
  const nps = npsMatch ? parseInt(npsMatch[1], 10) : 0;
  const platform = (parseField(prompt, '=== PLATFORM:') || 'google').toLowerCase().replace(/[^a-z.]/g, '').split('=')[0] || 'google';
  const lenMatch = prompt.match(/Typical length:\s*(\d+)-(\d+)\s*words/);
  const lenMin = lenMatch ? parseInt(lenMatch[1], 10) : 120;
  const lenMax = lenMatch ? parseInt(lenMatch[2], 10) : 280;
  const personaName = parsePersonaName(prompt);
  const archetypeId = parseArchetypeId(prompt);
  const culturalCluster = parseCulturalCluster(prompt) || 'anglo_uk_ireland';
  const langMatch = prompt.match(/ISO code:\s*([a-z]{2})/);
  const lang = langMatch ? langMatch[1] : 'en';

  // Count moments in prompt for content richness
  const posMomentsBlock = extractBlock(prompt, 'POSITIVE MOMENTS', 'NEGATIVE MOMENTS') || '';
  const negMomentsBlock = extractBlock(prompt, 'NEGATIVE MOMENTS', 'PLATFORM') || '';
  const posMoments = (posMomentsBlock.match(/^[•*-]\s*(.+)$/gm) || []).slice(0, 5).map(l => l.replace(/^[•*-]\s*/, ''));
  const negMoments = (negMomentsBlock.match(/^[•*-]\s*(.+)$/gm) || []).slice(0, 3).map(l => l.replace(/^[•*-]\s*/, ''));

  // Detect identity style from the prompt
  const idStyleMatch = prompt.match(/Style:\s*([^\n]+)/);
  const idStyleLabel = idStyleMatch ? idStyleMatch[1].trim() : 'warm-tone generalist review';

  // Deterministic salt per-persona so the pool rotates without producing
  // identical bodies for two different guests in the same cluster×stars bucket.
  const reviewSalt = hash(personaName + ':' + stars + ':' + culturalCluster + ':' + (archetypeId || ''));

  // Generate body by cultural cluster + stars
  const body = composeReviewBody({ stars, nps, posMoments, negMoments, culturalCluster, idStyleLabel, archetypeId, lang, lenMin, lenMax, salt: reviewSalt });
  const title = composeReviewTitle({ stars, culturalCluster, archetypeId, salt: reviewSalt });
  const themes = inferThemes({ posMoments, negMoments });

  return {
    title,
    body,
    star_rating: stars,
    nps,
    themes,
    would_recommend: nps >= 0,
    would_repeat_stay: nps >= 20,
    mentioned_staff_name: /Núria|Alejandro|Marco|Javi|Lin|chef|concierge/i.test(body),
    mentioned_competitor: false,
    mentioned_price_or_fees: /€|resort fee|price|value/i.test(body),
    language: lang,
  };
}

function extractBlock(text, startLabel, endLabel) {
  const s = text.indexOf(startLabel);
  if (s < 0) return '';
  const e = text.indexOf(endLabel, s + 1);
  return e > 0 ? text.slice(s, e) : text.slice(s);
}

function composeReviewTitle({ stars, culturalCluster, archetypeId, salt = 0 }) {
  // Prefer the pool if loaded — gives per-cluster×stars variety instead of
  // a single hardcoded title per bucket.
  const pool = getReviewPool();
  if (pool.loaded) {
    const key = `${culturalCluster}_${stars}`;
    const fallbackKey = `anglo_uk_ireland_${stars}`;
    const arr = pool.titles[key] || pool.titles[fallbackKey];
    if (arr && arr.length) return arr[salt % arr.length];
  }
  const byStars = {
    5: {
      german_dach: 'Perfekter Aufenthalt — sehr empfehlenswert',
      anglo_uk_ireland: 'An absolute gem',
      anglo_us_canada: 'BEST Hotel We\'ve EVER Stayed At!!!',
      french: 'Un séjour d\'exception',
      latin_spain_italy: 'Una experiencia inolvidable',
      nordic: 'Exceptional stay — highly recommend',
      east_asian: '素晴らしい滞在でした',
      chinese_mainland: '超级推荐！出片率满分',
      middle_east_gcc: 'A truly luxurious experience',
      latin_american: 'Simplemente maravilloso',
    },
    4: {
      german_dach: 'Schöner Aufenthalt mit kleinen Abstrichen',
      anglo_uk_ireland: 'Very good stay with minor quibbles',
      anglo_us_canada: 'Great stay, would recommend',
      french: 'Un séjour très agréable',
      latin_spain_italy: 'Muy buen hotel',
      nordic: 'Great stay overall',
      east_asian: '快適な滞在',
      chinese_mainland: '体验不错',
      middle_east_gcc: 'Excellent stay',
      latin_american: 'Muy recomendable',
    },
    3: {
      german_dach: 'Durchschnittlich für den Preis',
      anglo_uk_ireland: 'A little disappointing',
      anglo_us_canada: 'OK but not great',
      french: 'Correct sans plus',
      latin_spain_italy: 'Ni fu ni fa',
      nordic: 'Mixed experience',
      east_asian: 'まあまあ',
      chinese_mainland: '一般般',
      middle_east_gcc: 'Average',
      latin_american: 'Regular',
    },
    2: {
      german_dach: 'Enttäuschend für 5-Sterne-Anspruch',
      anglo_uk_ireland: 'Rather disappointing',
      anglo_us_canada: 'Not worth the money',
      french: 'Déception à ce prix',
      latin_spain_italy: 'Decepcionante',
      nordic: 'Underwhelming',
      east_asian: '期待外れでした',
      chinese_mainland: '没有达到预期',
      middle_east_gcc: 'Below expectations',
      latin_american: 'Decepcionante',
    },
    1: {
      german_dach: 'Nie wieder!',
      anglo_uk_ireland: 'Would not return',
      anglo_us_canada: 'Avoid!',
      french: 'À éviter',
      latin_spain_italy: 'No recomendado',
      nordic: 'Would not stay again',
      east_asian: '残念',
      chinese_mainland: '不推荐',
      middle_east_gcc: 'Very poor',
      latin_american: 'No lo recomiendo',
    },
  };
  return byStars[stars]?.[culturalCluster] || byStars[stars]?.anglo_uk_ireland || `${stars}-star stay`;
}

function composeReviewBody({ stars, nps, posMoments, negMoments, culturalCluster, idStyleLabel, archetypeId, lang, lenMin, lenMax, salt = 0 }) {
  // Pool-first path: if Claude-authored variants exist for this bucket, use one
  // as the base and let downstream identity-style flourishes still layer on.
  const pool = getReviewPool();
  if (pool.loaded) {
    const key = `${culturalCluster}_${stars}`;
    const fallbackKey = `anglo_uk_ireland_${stars}`;
    const arr = pool.bodies[key] || pool.bodies[fallbackKey];
    if (arr && arr.length) {
      let body = arr[salt % arr.length];
      // Identity-style flourish (kept from template path for continuity)
      if (/seasoned_comparator|connoisseur/i.test(idStyleLabel || '') && stars >= 4 && !/top tier/i.test(body)) {
        body = `In my 30+ years of travel, this one sits in the top tier. ` + body;
      } else if (/food_expert/i.test(idStyleLabel || '') && stars >= 4) {
        body += ` On the F&B side: the sauce work at the main restaurant was particularly accomplished — proper reductions, no shortcuts.`;
      } else if (/value_auditor/i.test(idStyleLabel || '')) {
        body += ` For €${400 + ((stars >= 4) ? 200 : 0)}/night, the value proposition is ${stars >= 4 ? 'defensible' : 'questionable'}.`;
      } else if (/wide_eyed/i.test(idStyleLabel || '') && stars === 5 && !/never stayed/i.test(body)) {
        body = `We had never stayed anywhere like this before and genuinely did not know hotels could be this good. ` + body;
      }
      // Trim to target length, identical to template path
      const words = body.split(/\s+/);
      if (words.length > lenMax) body = words.slice(0, lenMax).join(' ') + '.';
      return body.trim();
    }
  }

  // Culture-specific voice: directness, superlatives, understatement, etc.
  const voice = getReviewVoice(culturalCluster);

  const pos = posMoments.slice(0, stars >= 4 ? 3 : 1);
  const neg = negMoments.slice(0, stars >= 4 ? 1 : 2);

  // Opener per cluster + stars
  const openers = {
    anglo_uk_ireland: {
      5: 'Right, where to start. ',
      4: 'Just back from a few nights here — overall rather good. ',
      3: 'Stayed here last week. A little disappointing, if I\'m honest. ',
      2: 'Afraid this one didn\'t quite live up to the billing. ',
      1: 'Not great. Would struggle to recommend. ',
    },
    anglo_us_canada: {
      5: 'WOW. We just got back and I\'m still thinking about it. ',
      4: 'Had a really great stay here — would definitely come back. ',
      3: 'Mixed feelings about this one. Some hits, some misses. ',
      2: 'Expected way more for the price. ',
      1: 'Really not worth the money. ',
    },
    german_dach: {
      5: 'Fünf Nächte in diesem Hotel verbracht — absolut empfehlenswert. ',
      4: 'Insgesamt ein schöner Aufenthalt, mit kleinen Abstrichen. ',
      3: 'Durchwachsener Aufenthalt. Positiv: ',
      2: 'Zum gezahlten Preis enttäuschend. ',
      1: 'Für ein Haus dieser Kategorie inakzeptabel. ',
    },
    french: {
      5: 'Nous sommes rentrés enchantés de ce séjour. ',
      4: 'Un séjour agréable, dans l\'ensemble. ',
      3: 'Séjour correct, sans plus. ',
      2: 'À ce prix, on pouvait s\'attendre à mieux. ',
      1: 'Déception totale. ',
    },
    latin_spain_italy: {
      5: 'Hemos pasado unos días maravillosos en este hotel. ',
      4: 'Muy buen hotel, con pequeños detalles a mejorar. ',
      3: 'La experiencia fue regular. ',
      2: 'Para un 5 estrellas, esperábamos más. ',
      1: 'No recomendable en absoluto. ',
    },
    latin_american: {
      5: 'Volvemos encantados de este hotel. ',
      4: 'Muy buena experiencia. ',
      3: 'Estancia regular, nada destacable. ',
      2: 'Esperábamos más para el precio pagado. ',
      1: 'No cumple con lo prometido. ',
    },
    nordic: {
      5: 'Exceptional stay overall. ',
      4: 'Very good stay. ',
      3: 'Overall a mixed stay. ',
      2: 'Below our expectations. ',
      1: 'Would not stay again. ',
    },
    east_asian: {
      5: '素晴らしい滞在でした。',
      4: 'Good stay overall. ',
      3: 'An average stay. ',
      2: 'Disappointing. ',
      1: 'Very poor. ',
    },
    chinese_mainland: {
      5: '环境真的很美 ✨ 强烈推荐！',
      4: '整体体验不错。',
      3: '一般般。',
      2: '与期待有差距。',
      1: '不推荐。',
    },
    middle_east_gcc: {
      5: 'A truly extraordinary experience at this property. ',
      4: 'Excellent stay with generous service. ',
      3: 'Average stay. ',
      2: 'Below standards expected at this tier. ',
      1: 'Very poor. Not recommended. ',
    },
  };

  const opener = (openers[culturalCluster] || openers.anglo_uk_ireland)[stars];
  const parts = [opener];

  // Positive content
  if (pos.length > 0) {
    if (voice.superlative_use === 'abundant') {
      parts.push(`The highlights were genuinely excellent. ${pos.map(p => p.replace(/\[AMPLIFIED.*?\]|\[reinforced.*?\]|\[FADED.*?\]|\[faded.*?\]|\[DRAMATIZED.*?\]/g, '').trim()).join('. ')}. `);
    } else if (voice.understatement_tendency === 'high') {
      parts.push(`There was quite a lot to like. ${pos.slice(0,2).map(p => p.replace(/\[AMPLIFIED.*?\]|\[reinforced.*?\]|\[FADED.*?\]|\[faded.*?\]|\[DRAMATIZED.*?\]/g, '').trim()).join('. ')}. `);
    } else {
      parts.push(`Highlights included: ${pos.map(p => p.replace(/\[AMPLIFIED.*?\]|\[reinforced.*?\]|\[FADED.*?\]|\[faded.*?\]|\[DRAMATIZED.*?\]/g, '').trim()).join('; ')}. `);
    }
  }

  // Negative content
  if (neg.length > 0) {
    if (voice.complaint_framing.includes('ironic')) {
      parts.push(`On the other side of the ledger, ${neg[0].replace(/\[.*?\]/g, '').trim()}. Nothing ruinous. `);
    } else if (voice.complaint_framing.includes('direct')) {
      parts.push(`Was gibt's zu kritisieren: ${neg.map(n => n.replace(/\[.*?\]/g, '').trim()).join('. ')}. `);
      // keep German if cluster is german_dach; otherwise fall back
      if (culturalCluster !== 'german_dach') parts[parts.length - 1] = `On the flip side: ${neg.map(n => n.replace(/\[.*?\]/g, '').trim()).join('. ')}. `;
    } else if (voice.complaint_framing.includes('emotional')) {
      parts.push(`Lo único a mejorar: ${neg.map(n => n.replace(/\[.*?\]/g, '').trim()).join('. ')}. `);
    } else {
      parts.push(`Not perfect: ${neg.map(n => n.replace(/\[.*?\]/g, '').trim()).join('; ')}. `);
    }
  }

  // Closer — recommendation + return intent
  if (stars >= 4) {
    parts.push(closerPositive(culturalCluster, stars));
  } else if (stars === 3) {
    parts.push(closerMixed(culturalCluster));
  } else {
    parts.push(closerNegative(culturalCluster));
  }

  // Assemble, then optionally add identity-signaling flourish
  let body = parts.join('');

  // Identity signaling: prepend a phrase if specific style
  if (/seasoned_comparator|connoisseur/i.test(idStyleLabel) && stars >= 4) {
    body = `In my 30+ years of travel, this one sits in the top tier. ` + body;
  } else if (/food_expert/i.test(idStyleLabel) && stars >= 4) {
    body += ` On the F&B side: the sauce work at the main restaurant was particularly accomplished — proper reductions, no shortcuts. `;
  } else if (/value_auditor/i.test(idStyleLabel)) {
    body += ` For €${400 + ((stars >= 4) ? 200 : 0)}/night, the value proposition is ${stars >= 4 ? 'defensible' : 'questionable'}. `;
  } else if (/wide_eyed/i.test(idStyleLabel) && stars === 5) {
    body = `We had never stayed anywhere like this before and genuinely did not know hotels could be this good. ` + body;
  }

  // Trim to target length
  const words = body.split(/\s+/);
  if (words.length > lenMax) body = words.slice(0, lenMax).join(' ') + '.';
  return body.trim();
}

function getReviewVoice(cluster) {
  const voices = {
    german_dach: { superlative_use: 'restrained', understatement_tendency: 'none', complaint_framing: 'direct_fact_with_evidence' },
    anglo_uk_ireland: { superlative_use: 'restrained_with_dry_wit', understatement_tendency: 'high', complaint_framing: 'ironic_understated' },
    anglo_us_canada: { superlative_use: 'abundant', understatement_tendency: 'none', complaint_framing: 'direct_to_manager' },
    french: { superlative_use: 'restrained', understatement_tendency: 'medium', complaint_framing: 'articulate_sometimes_sarcastic' },
    latin_spain_italy: { superlative_use: 'abundant_warm', understatement_tendency: 'none', complaint_framing: 'warm_resolution_seeking' },
    latin_american: { superlative_use: 'abundant_warm', understatement_tendency: 'none', complaint_framing: 'warm_resolution_seeking' },
    nordic: { superlative_use: 'restrained', understatement_tendency: 'medium', complaint_framing: 'formal_balanced' },
    east_asian: { superlative_use: 'restrained_polite', understatement_tendency: 'very_high', complaint_framing: 'conflict_avoidant_omissive' },
    chinese_mainland: { superlative_use: 'abundant_with_emoji', understatement_tendency: 'low', complaint_framing: 'public_detailed' },
    middle_east_gcc: { superlative_use: 'abundant_luxury_anchored', understatement_tendency: 'none', complaint_framing: 'management_expected_to_fix' },
  };
  return voices[cluster] || voices.anglo_uk_ireland;
}

function closerPositive(cluster, stars) {
  const bank = {
    anglo_uk_ireland: stars === 5 ? 'All things considered, rather lovely. Would return in a heartbeat.' : 'Very good — would return.',
    anglo_us_canada: stars === 5 ? ' We WILL be back. 100%.' : ' Would stay again.',
    german_dach: stars === 5 ? ' Sehr empfehlenswert.' : ' Empfehlenswert.',
    french: stars === 5 ? ' À recommander sans hésitation.' : ' À recommander.',
    latin_spain_italy: stars === 5 ? ' Volveremos sin duda.' : ' Recomendable.',
    latin_american: stars === 5 ? ' Recomendado 100%.' : ' Volveríamos.',
    nordic: ' Recommended.',
    east_asian: ' おすすめ致します。',
    chinese_mainland: ' 推荐给姐妹们 💕',
    middle_east_gcc: ' Highly recommended.',
  };
  return bank[cluster] || bank.anglo_uk_ireland;
}

function closerMixed(cluster) {
  const bank = {
    anglo_uk_ireland: ' Bit of a mixed bag, but not without charm.',
    anglo_us_canada: ' Not sure if I\'d come back.',
    german_dach: ' Für den Preis befriedigend.',
    french: ' Honnêtement, en attendait plus.',
    latin_spain_italy: ' Para el precio, esperábamos más.',
    latin_american: ' Regular, esperábamos más.',
    nordic: ' Mixed. Would probably try elsewhere next time.',
    east_asian: ' 普通でした。',
    chinese_mainland: ' 一般，不一定再来。',
    middle_east_gcc: ' Average.',
  };
  return bank[cluster] || bank.anglo_uk_ireland;
}

function closerNegative(cluster) {
  const bank = {
    anglo_uk_ireland: ' Would struggle to go back.',
    anglo_us_canada: ' Hard pass on a return visit.',
    german_dach: ' Kein erneuter Besuch.',
    french: ' On n\'y reviendra pas.',
    latin_spain_italy: ' No volveríamos.',
    latin_american: ' No lo recomiendo.',
    nordic: ' Would not return.',
    east_asian: '残念。',
    chinese_mainland: ' 不推荐。',
    middle_east_gcc: ' Would not return.',
  };
  return bank[cluster] || bank.anglo_uk_ireland;
}

function inferThemes({ posMoments, negMoments }) {
  const all = [...(posMoments || []), ...(negMoments || [])].join(' ').toLowerCase();
  const themes = [];
  if (/clean/.test(all)) themes.push('cleanliness');
  if (/staff|concierge|warm|service/.test(all)) themes.push('service');
  if (/view|sea|mediterranean|terrace/.test(all)) themes.push('view');
  if (/breakfast|buffet|coffee|pastr/.test(all)) themes.push('breakfast');
  if (/dinner|tasting|chef|wine|menu|food/.test(all)) themes.push('food');
  if (/wifi|internet|speed/.test(all)) themes.push('wifi');
  if (/pool|cabana|lounger/.test(all)) themes.push('pool');
  if (/spa|massage|thermal/.test(all)) themes.push('spa');
  if (/location|beach|island/.test(all)) themes.push('location');
  if (/fee|resort|charge|price/.test(all)) themes.push('hidden_fees');
  if (/room|suite|terrace|bed/.test(all)) themes.push('room_size');
  if (/design|aesthet|mater/.test(all)) themes.push('bed_comfort');
  return Array.from(new Set(themes)).slice(0, 8);
}

// ─── Persona generation (audience/persona fallback) ────────────────────

function generatePersonaResponse(prompt) {
  // This handles the persona generator's LLM calls, audience decomposer, etc.
  // For hospitality vertical the decomposer already has a deterministic path,
  // but personaGenerator calls the LLM to flesh out names + traits.
  // Since the actual persona generator has a fallback, we just return a
  // minimal valid object that the fallback logic can work with.
  const audienceMatch = prompt.match(/AUDIENCE:\s*"([^"]+)"/);
  if (audienceMatch) {
    return {
      vertical: 'hospitality',
      guest_mix: audienceMatch[1].slice(0, 120),
      trip_purpose_primary: 'leisure_couples',
      price_sensitivity: 'luxury',
      origin_geography: 'international_mix',
      typical_stay_length_nights: [3, 7],
      typical_channels: ['direct_web', 'booking_com'],
      primary_drivers: ['service quality', 'design', 'dining', 'location'],
      inferred_constraints: ['EU flight routes', 'summer high season'],
      key_signals_they_look_for: ['Leading Hotels of the World', 'Michelin-starred dining', 'adults-only'],
    };
  }
  // Generic persona fallback — return empty/default so caller's fallback takes over
  return {};
}

// First-name pools per cultural cluster (short, diverse, realistic). Used by
// the synth persona generator so cohorts have unique names for seed variance.
const SYNTH_NAME_POOLS = {
  anglo_uk_ireland: ['Oliver', 'Emma', 'James', 'Sophie', 'Harry', 'Charlotte', 'Jack', 'Amelia', 'George', 'Olivia', 'Henry', 'Isabella', 'Noah', 'Ava', 'Leo'],
  anglo_us_canada: ['Ethan', 'Ava', 'Mason', 'Mia', 'Logan', 'Harper', 'Lucas', 'Evelyn', 'Jackson', 'Abigail', 'Ryan', 'Chloe'],
  german_dach: ['Lukas', 'Marie', 'Noah', 'Sophia', 'Leon', 'Emilia', 'Elias', 'Hannah', 'Paul', 'Anna', 'Jonas', 'Laura', 'Felix'],
  french: ['Gabriel', 'Louise', 'Léo', 'Alice', 'Raphaël', 'Emma', 'Arthur', 'Chloé', 'Louis', 'Jade', 'Hugo', 'Camille'],
  latin_spain_italy: ['Marco', 'Sofia', 'Alessandro', 'Giulia', 'Pablo', 'Lucía', 'Diego', 'Martina', 'Mateo', 'Chiara', 'Leonardo', 'Isabella'],
  nordic: ['Emil', 'Freja', 'Oscar', 'Alva', 'Lucas', 'Maja', 'William', 'Ella', 'Liam', 'Saga'],
  middle_east_gcc: ['Mohammed', 'Fatima', 'Ali', 'Aisha', 'Khalid', 'Layla', 'Omar', 'Noor'],
  east_asian: ['Haru', 'Yui', 'Ren', 'Sakura', 'Minjun', 'Jiwoo', 'Seoyun', 'Haruto'],
  chinese_mainland: ['Wei', 'Yan', 'Ming', 'Fang', 'Lei', 'Xia', 'Tao', 'Hui'],
  latin_american: ['Santiago', 'Valentina', 'Mateo', 'Camila', 'Sebastián', 'Isabella', 'Diego', 'Sofía'],
  _default: ['Alex', 'Sam', 'Jamie', 'Casey', 'Robin', 'Taylor', 'Jordan', 'Morgan'],
};

function _guessClusterFromAudience(prompt) {
  const p = prompt.toLowerCase();
  if (/uk|british|england|ireland/.test(p)) return 'anglo_uk_ireland';
  if (/german|austria/.test(p)) return 'german_dach';
  if (/french/.test(p)) return 'french';
  if (/spanish|spain|italian|italy/.test(p)) return 'latin_spain_italy';
  if (/nordic|swedish|norwegian|danish/.test(p)) return 'nordic';
  if (/gcc|middle east|arab/.test(p)) return 'middle_east_gcc';
  if (/japan|korea/.test(p)) return 'east_asian';
  if (/chinese/.test(p)) return 'chinese_mainland';
  if (/americas|latin american|mexico|brazil/.test(p)) return 'latin_american';
  if (/us\b|american|canada/.test(p)) return 'anglo_us_canada';
  return 'anglo_uk_ireland';
}

/**
 * Generate a minimally-valid persona for the synth provider. This is what
 * the persona generator LLM calls would otherwise produce. Critically, each
 * call MUST return a unique name so downstream seed-based determinism works
 * (the rate-stage synth uses persona.name as part of its seed).
 */
function generatePersonaSynth(prompt) {
  const archetypeLabelMatch = prompt.match(/Label:\s*([^\n]+)/);
  const archetypeIdMatch = prompt.match(/archetype_id[^"]*"\s*:\s*"([^"]+)"/);
  const variantMatch = prompt.match(/VARIANT\s+(\d+)/i);
  const slotHint = prompt.length; // varies per call due to injected pain samples / slot index
  const cluster = _guessClusterFromAudience(prompt);
  const names = SYNTH_NAME_POOLS[cluster] || SYNTH_NAME_POOLS._default;
  const lastNames = ['Smith', 'Weber', 'Müller', 'Rossi', 'García', 'Dubois', 'Andersen', 'Khan', 'Tanaka', 'Chen', 'Silva', 'Martínez', 'Jensen', 'Bianchi', 'Schneider', 'Brown', 'Wilson'];
  // Incorporate variant + slot + prompt length + time nonce so names don't collide in a batch
  const nonce = (Date.now() + Math.floor(Math.random() * 100000)) >>> 0;
  const firstIdx = (nonce + slotHint + (variantMatch ? parseInt(variantMatch[1], 10) : 0)) % names.length;
  const lastIdx = (nonce >>> 3) % lastNames.length;
  const first = names[firstIdx];
  const last = lastNames[lastIdx];

  // Cluster-specific typical stay length (from IBESTAT avg_stay_nights_by_cluster).
  // Critical for the spend backtest: synth's spend_intent = rate × coef × nights,
  // so nights must reflect real-world stay length or short-stay clusters overshoot.
  const clusterStayRange = {
    anglo_uk_ireland: [6, 9],
    anglo_us_canada: [4, 7],
    german_dach: [7, 11],
    french: [5, 8],
    latin_spain_italy: [3, 6],
    nordic: [5, 9],
    latin_american: [4, 7],
    middle_east_gcc: [5, 8],
    east_asian: [4, 6],
    chinese_mainland: [4, 6],
  }[cluster] || [3, 7];

  return {
    name: `${first} ${last}`,
    age: 28 + Math.floor(Math.random() * 30),
    role: 'Traveler',
    company_description: 'International leisure traveler',
    archetype_id: archetypeIdMatch?.[1] || 'luxury_seeker',
    archetype_label: archetypeLabelMatch?.[1]?.trim() || 'The Luxury Seeker',
    goals_for_this_visit: ['disconnect and rest', 'celebrate special occasion'],
    current_alternatives: ['Four Seasons', 'Aman'],
    pain_quotes_in_voice: ['wifi that works everywhere on the property', 'staff remembering our preferences'],
    top_objections: ['resort fee transparency', 'room assignment', 'noise'],
    budget_monthly_usd: 2500,
    hot_buttons: ['private terrace', 'sea view', 'late checkout'],
    deal_breakers: ['hidden fees', 'unresponsive staff'],
    behavioral_markers_activated: ['review-writer', 'loyalty member', 'repeat visitor'],
    typical_stay_length_nights: clusterStayRange,
  };
}

// ─── Rate-strategy-test stage response ──────────────────────────────────
//
// Anchored to Villa Le Blanc / Menorca luxury 5★ context. Sweet-spot rates
// are the archetype's internal reference price; deviation from sweet_spot
// drives price_perception. Cultural cluster modifies walk-away propensity
// and book probability. Deterministic enough for backtests (seeded off
// rate + archetype + cultural cluster via hash).
//
// Sources anchoring the numbers:
//   - Cornell HQ 2024 UK elasticity (cultural modifier shape)
//   - FUR Reiseanalyse 2024 (DE walk-away sensitivity)
//   - IBESTAT occupancy + STR luxury Med benchmarks (rate/sweet-spot ratios)
//   - Internal expert synthesis 2026 (archetype sweet spots, flagged
//     for replacement once Meliá internal data arrives)

const RATE_ARCHETYPE_CURVE = {
  // sweet_spot is EUR/night for Menorca luxury 5★ peer set
  luxury_seeker:     { floor: 600, sweet: 1200, ceiling: 2500, spend_coef: 0.65 },
  honeymooner:       { floor: 500, sweet: 1000, ceiling: 2000, spend_coef: 0.45 },
  family_vacationer: { floor: 400, sweet: 700,  ceiling: 1400, spend_coef: 0.55 },
  business_traveler: { floor: 300, sweet: 500,  ceiling: 1000, spend_coef: 0.30 },
  digital_nomad:     { floor: 150, sweet: 300,  ceiling: 600,  spend_coef: 0.20 },
  budget_optimizer:  { floor: 100, sweet: 200,  ceiling: 400,  spend_coef: 0.15 },
  loyalty_maximizer: { floor: 350, sweet: 600,  ceiling: 1200, spend_coef: 0.35 },
  event_attendee:    { floor: 250, sweet: 450,  ceiling: 900,  spend_coef: 0.25 },
};

const RATE_CULTURAL_MODIFIER = {
  // book_delta: additive modifier to base book prob after price perception
  // walk_bias : multiplier on walk-away propensity when slightly_high or above
  // spend_mult: multiplier on archetype spend_coef, reflecting EGATUR 2024
  //             per-origin daily spending ratios (UK baseline = 1.00).
  //             Derived from INE Aug 2024 EGATUR: UK €189, DE €176 (0.93),
  //             IT €180 (0.95), FR €135 (0.71), Nordic ~€170 avg (0.90).
  german_dach:        { book_delta: -0.06, walk_bias: 1.15, vfm_delta: -4, spend_mult: 0.95 },
  anglo_uk_ireland:   { book_delta: +0.00, walk_bias: 1.00, vfm_delta: +0, spend_mult: 1.00 },
  anglo_us_canada:    { book_delta: +0.05, walk_bias: 0.90, vfm_delta: +3, spend_mult: 1.15 },
  french:             { book_delta: +0.03, walk_bias: 0.95, vfm_delta: +2, spend_mult: 0.72 },
  latin_spain_italy:  { book_delta: +0.08, walk_bias: 0.85, vfm_delta: +5, spend_mult: 0.78 },
  nordic:             { book_delta: +0.02, walk_bias: 0.95, vfm_delta: +0, spend_mult: 0.88 },
  latin_american:     { book_delta: +0.04, walk_bias: 0.90, vfm_delta: +2, spend_mult: 0.90 },
  middle_east_gcc:    { book_delta: +0.07, walk_bias: 0.80, vfm_delta: +4, spend_mult: 1.20 },
  east_asian:         { book_delta: +0.01, walk_bias: 1.05, vfm_delta: -1, spend_mult: 0.95 },
  chinese_mainland:   { book_delta: +0.03, walk_bias: 0.95, vfm_delta: +1, spend_mult: 1.05 },
};

function parseRateOffer(prompt) {
  const label = (prompt.match(/Label:\s*([^\n]+)/) || [])[1]?.trim() || 'Standard';
  const rateMatch = prompt.match(/Price:\s*€\s*(\d[\d\.,]*)/) || prompt.match(/€\s*(\d[\d\.,]*)\s*\/night/);
  const rate_eur = rateMatch ? parseFloat(rateMatch[1].replace(/[^\d.]/g, '')) : 0;
  const inclusionsLine = (prompt.match(/Inclusions:\s*([^\n]+)/) || [])[1]?.trim() || 'room only';
  const cancellation = (prompt.match(/Cancellation policy:\s*([^\n]+)/) || [])[1]?.trim() || 'standard';
  return { label, rate_eur, inclusions_line: inclusionsLine, cancellation };
}

function parseRateStage(prompt) {
  const m = prompt.match(/=== CURRENT STAGE:\s*([a-z_0-9]+)/i);
  return m ? m[1].toLowerCase() : null;
}

// Parses "Demand strength: X.XX" emitted by the rate backtest so the synth
// shifts the archetype sweet-spot in peak-demand periods. In real RMS, price
// elasticity is conditioned on demand signals (pickup pace, STR demand index);
// this is the equivalent knob.
function parseDemandMultiplier(prompt) {
  const m = prompt.match(/Demand strength:\s*([0-9]+\.?[0-9]*)/i);
  if (!m) return 1.0;
  const v = parseFloat(m[1]);
  if (!Number.isFinite(v)) return 1.0;
  return Math.max(0.5, Math.min(2.0, v));
}

// Fast non-cryptographic hash for seeded determinism per (archetype × rate × stage)
function hash32(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}
function seededUnit(seed) {
  // Two-stage mixing via Math.imul (32-bit int multiply) + xorshift to avoid
  // the float precision loss of `seed * prime` for large seeds, which biases
  // the resulting "uniform" value toward certain ranges. Test: for 10k
  // uniformly-distributed seeds, mean(seededUnit) ≈ 0.5, std ≈ 0.29.
  let x = seed >>> 0;
  x = Math.imul(x, 2654435761) >>> 0;
  x ^= x >>> 16;
  x = Math.imul(x, 2246822507) >>> 0;
  x ^= x >>> 13;
  x = Math.imul(x, 3266489917) >>> 0;
  x ^= x >>> 16;
  return (x >>> 0) / 0x100000000;
}

function pricePerception(rate_eur, archetype_curve) {
  const ratio = rate_eur / Math.max(1, archetype_curve.sweet);
  if (ratio < 0.5) return 'too_low_suspicious';
  if (ratio < 0.85) return 'fair';
  if (ratio < 1.15) return 'fair';
  if (ratio < 1.4) return 'slightly_high';
  if (ratio < 1.8) return 'too_high';
  return 'refuse_to_pay';
}

// Baseline book probability at the "fair" perception band (common to all
// archetypes). Other perceptions derive from archetype-specific elasticity
// targets below.
const FAIR_BOOK_PROB = 0.72;

// Per-archetype target own-price elasticity, calibrated to published
// benchmarks (Vives & Jacob 2023, Garín-Muñoz, Singh & Corsun, Xuan Tran,
// Rateboard). Lower (more negative) = more price-sensitive.
//   target_eps_band_fair_to_slightly_high applies to the 0.75× → 1.25×
//   sweet-spot transition (ln(1.25/0.75) = 0.511).
const RATE_ARCHETYPE_TARGET_ELASTICITY = {
  luxury_seeker:     -0.45,   // published: luxury hotels are inelastic
  honeymooner:       -0.85,   // couple segment, Vives & Jacob
  family_vacationer: -1.00,   // -1.008 in Vives & Jacob
  business_traveler: -0.70,   // corporate budgets, price-tolerant
  digital_nomad:     -1.30,   // general leisure sensitivity
  budget_optimizer:  -1.57,   // solo budget segment, most sensitive
  loyalty_maximizer: -0.55,   // loyalty benefits offset price variance
  event_attendee:    -1.20,   // event-constrained, slightly sensitive
};

/**
 * Book probability at a given perception for a given archetype, derived
 * from target elasticity. ε = ln(q_slight/q_fair) / ln(p_slight/p_fair).
 * We anchor q_fair at FAIR_BOOK_PROB and solve for q_slight (and other bands)
 * using fixed price ratios implied by the perception boundaries.
 */
function bookProbForPerception(perception, archetypeId) {
  if (perception === 'fair') return FAIR_BOOK_PROB;
  const eps = RATE_ARCHETYPE_TARGET_ELASTICITY[archetypeId] ?? -1.00;
  // Price ratios relative to fair midpoint (~0.85× sweet treated as fair):
  // too_low_suspicious: ~0.4× sweet    → ratio vs fair ~0.47 → +ve elasticity effect
  // slightly_high: ~1.25× sweet        → ratio vs fair ~1.47
  // too_high: ~1.55× sweet             → ratio vs fair ~1.82
  // refuse_to_pay: ~1.9× sweet         → ratio vs fair ~2.24
  const priceRatio = {
    too_low_suspicious: 0.47,
    slightly_high: 1.47,
    too_high: 1.82,
    refuse_to_pay: 2.24,
  }[perception] ?? 1;
  const qBand = FAIR_BOOK_PROB * Math.pow(priceRatio, eps);
  return Math.max(0.02, Math.min(0.95, qBand));
}

const BASE_WALK_RATE = {
  // P(walk away) evaluated ONCE at price_exposure stage only (not compounded).
  // Walk-away is a separate signal from "would_book=false at decision"; it
  // represents the agent rejecting the offer before even evaluating fit.
  // Kept small except for too_high / refuse to avoid double-counting with
  // the archetype elasticity-driven book probability.
  too_low_suspicious: 0.05,
  fair: 0.00,
  slightly_high: 0.05,
  too_high: 0.35,
  refuse_to_pay: 0.80,
};

const BASE_VFM = {
  too_low_suspicious: 58,
  fair: 76,
  slightly_high: 54,
  too_high: 34,
  refuse_to_pay: 14,
};

function rateStageNarrative({ stage, perception, archetype, rate_eur, inclusions_line, would_book, walk_away_reason, cluster }) {
  const eur = rate_eur ? `€${Math.round(rate_eur)}` : 'the rate';
  switch (stage) {
    case 'price_exposure': {
      const pool = {
        too_low_suspicious: [`${eur} for this tier feels suspiciously low — I'd wonder what the catch is.`, `${eur}/night at a 5★ in Menorca? I'd check if this is real.`],
        fair: [`${eur}/night feels about right for what's on offer — I'd take it as a starting point.`, `${eur} is within my mental bracket for this kind of stay.`],
        slightly_high: [`${eur} is pushing the upper edge of what I'd comfortably pay for this stay.`, `${eur}/night stings a bit; I'd want the inclusions to justify it.`],
        too_high: [`${eur}/night is frankly too much for us — out of bracket.`, `${eur} is well above what I'd budget; I'd look elsewhere.`],
        refuse_to_pay: [`${eur}? No chance. That's not a rate I'd even consider.`, `${eur}/night is out of the question for me — not even a discussion.`],
      };
      const arr = pool[perception] || pool.fair;
      return arr[hash32(`${archetype}|${rate_eur}|exp`) % arr.length];
    }
    case 'comparison_with_alternatives': {
      const altCompare = {
        too_low_suspicious: `Compared to what similar 5★ properties ask, this is the cheapest by a margin — almost a red flag.`,
        fair: `Against my alternatives in Menorca / Mallorca / Ibiza, this sits in the expected band; the ${inclusions_line} tilts it slightly in favor.`,
        slightly_high: `Two comparable properties are quoting ~10-15% less for the same week. It's tight.`,
        too_high: `Competitors come in materially cheaper; only a very strong inclusions package would rescue this.`,
        refuse_to_pay: `Every reasonable alternative is dramatically cheaper; no justification at this price.`,
      };
      return altCompare[perception] || altCompare.fair;
    }
    case 'decision': {
      if (would_book) return `I'd book — the value-for-money on this variant works for us. ${inclusions_line} seals it.`;
      if (walk_away_reason) return `Passing. ${walk_away_reason}`;
      return `On reflection, not this variant — I'd want a change on price or inclusions first.`;
    }
    case 'spend_intent': {
      const c = RATE_ARCHETYPE_CURVE[archetype] || RATE_ARCHETYPE_CURVE.luxury_seeker;
      return `Beyond the room I'd likely spend on F&B, spa, and activities — roughly ${Math.round(c.spend_coef * 100)}% of the nightly rate times the stay length.`;
    }
    default:
      return `(${stage}) considering the offer.`;
  }
}

function generateRateStageResponse(prompt) {
  const stage = parseRateStage(prompt) || 'price_exposure';
  const archetype = parseArchetypeId(prompt);
  const cluster = parseCulturalCluster(prompt) || 'anglo_uk_ireland';
  const offer = parseRateOffer(prompt);
  const demandMult = parseDemandMultiplier(prompt);
  const baseCurve = RATE_ARCHETYPE_CURVE[archetype] || RATE_ARCHETYPE_CURVE.luxury_seeker;
  // Apply seasonal demand multiplier to willingness-to-pay envelope. In peak
  // demand, the audience that actually shows up is pre-filtered for higher
  // budgets, so sweet_spot shifts up (and so do floor/ceiling).
  const curve = {
    floor: baseCurve.floor * demandMult,
    sweet: baseCurve.sweet * demandMult,
    ceiling: baseCurve.ceiling * demandMult,
    spend_coef: baseCurve.spend_coef,
  };
  const cultMod = RATE_CULTURAL_MODIFIER[cluster] || RATE_CULTURAL_MODIFIER.anglo_uk_ireland;

  const perception = pricePerception(offer.rate_eur, curve);
  const baseBook = bookProbForPerception(perception, archetype);
  const bookProb = Math.max(0, Math.min(1, baseBook + cultMod.book_delta));

  if (process.env.DEBUG_RATE_ARCHETYPE) {
    const archMatch = prompt.match(/Archetype:\s*([^\n]+)/);
    const rawArch = archMatch?.[1] || '';
    if (rawArch.toLowerCase().includes(process.env.DEBUG_RATE_ARCHETYPE.toLowerCase())) {
      const name = parsePersonaName(prompt);
      console.log(`[DBG] stage=${stage} name="${name}" arch=${archetype} cluster=${cluster} rate=${offer.rate_eur} perception=${perception} bookProb=${bookProb.toFixed(2)}`);
    }
  }

  // Agent-level determinism: seed is AGENT-SPECIFIC (persona name + archetype
  // + cluster + rate), so (a) different agents within the same cluster roll
  // independently — critical for within-cohort variance — and (b) the same
  // agent gets consistent walk / book decisions across the price_exposure,
  // comparison, decision, spend_intent stages (no cross-stage compounding).
  const personaName = parsePersonaName(prompt) || 'anon';
  const agentSeedKey = `${personaName}|${archetype}|${cluster}|${offer.rate_eur}`;
  const u = seededUnit(hash32(agentSeedKey));
  // Secondary roll for book given not-walked (avoid correlation with walk-away)
  const u2 = seededUnit(hash32(`${agentSeedKey}|book`));

  // Walk-away: evaluated ONLY at price_exposure to avoid cross-stage compounding.
  // Subsequent stages in the same sim run will still consume the same agent
  // seed via the orchestrator's state, so the walk decision remains consistent.
  let walk_away = false;
  let walk_away_reason = null;
  const walkRate = (BASE_WALK_RATE[perception] ?? 0) * cultMod.walk_bias;
  if (stage === 'price_exposure' && u < walkRate) {
    walk_away = true;
    if (perception === 'refuse_to_pay') walk_away_reason = 'price outside acceptable range';
    else if (perception === 'too_high') walk_away_reason = 'price too high for perceived value';
    else if (perception === 'slightly_high') walk_away_reason = 'price marginally above comfort, alternatives more competitive';
    else if (perception === 'too_low_suspicious') walk_away_reason = 'price seemed suspiciously low, questioned quality';
  }

  const would_book = stage === 'decision' ? (u2 < bookProb) : null;

  const vfm = Math.max(0, Math.min(100, (BASE_VFM[perception] ?? 50) + cultMod.vfm_delta + Math.floor((u - 0.5) * 10)));

  const cancellationAcceptability = /non.?refundable/i.test(offer.cancellation)
    ? (cluster === 'german_dach' ? 'dealbreaker' : (cluster === 'latin_spain_italy' ? 'tolerable' : 'tolerable'))
    : /flex/i.test(offer.cancellation) ? 'acceptable' : 'tolerable';

  const narrative = rateStageNarrative({
    stage, perception, archetype, rate_eur: offer.rate_eur,
    inclusions_line: offer.inclusions_line, would_book, walk_away_reason, cluster,
  });

  // Comparison winner — picked only on that stage
  let comparison_winner = null;
  if (stage === 'comparison_with_alternatives') {
    comparison_winner = (perception === 'fair' || perception === 'too_low_suspicious')
      ? 'this_offer'
      : (perception === 'slightly_high' ? 'tied' : 'competitor');
  }

  // Spend intent: only on that stage; scales with rate × archetype coef × jitter.
  // Stay length is parsed from the persona block where possible, so the spend
  // calc reflects the cluster's typical length. Falls back to the rough 4-night
  // default when length isn't exposed in the prompt.
  let estimated_spend_if_booked_eur = 0;
  if (stage === 'spend_intent') {
    const jitter = 0.75 + u * 0.5; // 0.75 – 1.25
    const nightsMatch = prompt.match(/typical_stay_length_nights[^\d]*(\d+)[^\d]+(\d+)?/i)
      || prompt.match(/Preferred stay length \(nights\):\s*(\d+)/i);
    const nights = nightsMatch
      ? (nightsMatch[2] ? (Number(nightsMatch[1]) + Number(nightsMatch[2])) / 2 : Number(nightsMatch[1]))
      : 4;
    const spendMult = cultMod.spend_mult ?? 1.0;
    estimated_spend_if_booked_eur = Math.round(offer.rate_eur * curve.spend_coef * nights * jitter * spendMult);
  }

  return {
    narrative,
    would_book: stage === 'decision' ? would_book : null,
    walk_away,
    walk_away_reason,
    comparison_winner,
    estimated_spend_if_booked_eur,
    price_perception: perception,
    cancellation_acceptability: cancellationAcceptability,
    value_for_money_score_0_100: vfm,
  };
}

// ─── Main dispatcher ────────────────────────────────────────────────────

async function callAIJSON(prompt, opts = {}) {
  // Add small synthetic delay to not melt the CPU; also makes logs readable
  await new Promise(r => setTimeout(r, 5 + Math.floor(Math.random() * 20)));

  if (/hotel review/i.test(prompt) && /Return this JSON:/i.test(prompt) && /body.*words/i.test(prompt)) {
    return generateReviewResponse(prompt);
  }
  if (/=== THE RATE OFFER YOU ARE EVALUATING ===/i.test(prompt)) {
    return generateRateStageResponse(prompt);
  }
  if (/simulating a real hotel guest/i.test(prompt) || /=== PERSONA \(you ARE this guest\) ===/i.test(prompt)) {
    return generateStageResponse(prompt);
  }
  if (/AUDIENCE:/i.test(prompt) && /vertical/i.test(prompt)) {
    return generatePersonaResponse(prompt);
  }
  // Persona generator (name + traits). Detect by presence of the structured
  // persona prompt signature — it asks for a JSON with "name" and traits.
  if (/Instantiate ONE concrete/i.test(prompt) || (/"name":/.test(prompt) && /archetype_id/.test(prompt))) {
    return generatePersonaSynth(prompt);
  }
  return {};
}

async function callAI(prompt, opts = {}) {
  const obj = await callAIJSON(prompt, opts);
  return typeof obj === 'string' ? obj : JSON.stringify(obj);
}

function getProvider() { return 'claude-synth-deterministic'; }

module.exports = { callAIJSON, callAI, getProvider };
