/**
 * Sensation Tracker — maintains per-guest sensation state across 12 dimensions.
 *
 * Each stage of the stay produces sensation deltas. The final state + history
 * feeds the review predictor and NPS calculation.
 */

const path = require('path');
const fs = require('fs');

const SENSATION_PATH = path.join(__dirname, '..', '..', 'data', 'industries', 'hospitality', 'sensation_dimensions.json');

let _config = null;
function getConfig() {
  if (_config) return _config;
  _config = JSON.parse(fs.readFileSync(SENSATION_PATH, 'utf-8'));
  return _config;
}

function clamp(n, min = 0, max = 100) { return Math.max(min, Math.min(max, n)); }

/**
 * Tier-archetype sensation boost — when a guest arrives at a luxury/premium
 * property, their baseline expectations in the dimensions they CARE about get
 * a head-start (positive priming). Without this, archetypes whose baselines
 * are intentionally low (business_traveler has personalization=32 because
 * they're hard to impress) can't take advantage of the property tier and
 * end up landing in 2-3★ territory in a 5★ hotel regardless of narrative.
 *
 * Values are additive boosts applied on top of defaults + archetype override.
 * Only applies the archetype's high-weight dimensions so each archetype
 * benefits according to what it actually measures against.
 */
const TIER_ARCHETYPE_BOOSTS = {
  luxury: {
    business_traveler: { speed: 18, service_quality: 18, cleanliness: 10, amenity_usability: 12, modernity: 8 },
    family_vacationer: { cleanliness: 12, safety: 10, amenity_usability: 12, service_quality: 10 },
    luxury_seeker:     { personalization: 15, aesthetic: 15, culinary: 12, service_quality: 12, authenticity: 8 },
    honeymooner:       { personalization: 18, aesthetic: 15, authenticity: 10, culinary: 10, service_quality: 8 },
    digital_nomad:     { amenity_usability: 12, modernity: 10, speed: 10, comfort_physical: 8 },
    budget_optimizer:  { value: 12, cleanliness: 10, service_quality: 8 },
    loyalty_maximizer: { personalization: 15, service_quality: 12, speed: 10 },
    event_attendee:    { amenity_usability: 12, service_quality: 10, crowd: 8 },
  },
  premium: {
    business_traveler: { speed: 10, service_quality: 10, amenity_usability: 8 },
    family_vacationer: { cleanliness: 8, safety: 6, amenity_usability: 6 },
    luxury_seeker:     { personalization: 8, aesthetic: 8, service_quality: 6 },
    honeymooner:       { personalization: 10, aesthetic: 8, authenticity: 6 },
    digital_nomad:     { amenity_usability: 8, modernity: 6 },
    budget_optimizer:  { value: 8, cleanliness: 6 },
    loyalty_maximizer: { personalization: 8, service_quality: 6 },
    event_attendee:    { amenity_usability: 8, service_quality: 6 },
  },
  upscale: {},
  midscale: {},
  economy: {},
};

function getTierArchetypeBoost(propertyTier, archetypeId) {
  if (!propertyTier || !archetypeId) return null;
  return TIER_ARCHETYPE_BOOSTS[propertyTier]?.[archetypeId] || null;
}

/**
 * Initialize a sensation vector for a guest + property.
 * Blends SIX layers (in priority order, later overrides earlier):
 *   1. defaults (neutral)
 *   2. archetype override
 *   3. cultural cluster modifiers
 *   4. booking channel + rate plan + lead time modifiers
 *   5. external context (season + weather + events + occupancy)
 *   6. property calibration scaling (review-anchored)
 */
function initialState({ propertyBaseline = null, archetypeId = null, culturalModifiers = null, bookingModifiers = null, externalModifiers = null, propertyTier = null } = {}) {
  const config = getConfig();
  const defaults = config.default_starting_values;
  const archOverride = (archetypeId && config.starting_sensations_override_by_archetype?.[archetypeId]) || {};

  // Start from defaults, layer in archetype override
  const merged = { ...defaults, ...archOverride };

  // Tier-archetype boost — applied BEFORE cultural/booking modifiers so later
  // layers can still tighten or loosen further.
  const tierBoost = getTierArchetypeBoost(propertyTier, archetypeId);
  if (tierBoost) {
    for (const [k, v] of Object.entries(tierBoost)) {
      if (k in merged && typeof v === 'number') merged[k] = clamp(merged[k] + v);
    }
  }

  // Apply cultural modifiers additively (these tighten/loosen expectations)
  if (culturalModifiers && typeof culturalModifiers === 'object') {
    for (const [k, v] of Object.entries(culturalModifiers)) {
      if (k in merged && typeof v === 'number') merged[k] = clamp(merged[k] + v);
    }
  }
  // Booking modifiers (channel + rate plan + lead time)
  if (bookingModifiers && typeof bookingModifiers === 'object') {
    for (const [k, v] of Object.entries(bookingModifiers)) {
      if (k in merged && typeof v === 'number') merged[k] = clamp(merged[k] + v);
    }
  }
  // External context modifiers (season/weather/events/occupancy)
  if (externalModifiers && typeof externalModifiers === 'object') {
    for (const [k, v] of Object.entries(externalModifiers)) {
      if (k in merged && typeof v === 'number') merged[k] = clamp(merged[k] + v);
    }
  }

  if (propertyBaseline) {
    const scale = propertyBaseline._scale;
    if (scale && typeof scale === 'number') {
      for (const k of Object.keys(merged)) {
        merged[k] = clamp(Math.round(merged[k] * scale));
      }
    } else {
      for (const k of Object.keys(propertyBaseline)) {
        if (k.startsWith('_')) continue;
        if (typeof propertyBaseline[k] === 'number') merged[k] = clamp(propertyBaseline[k]);
      }
    }
  }

  return {
    ...merged,
    _archetype_id: archetypeId,
    _history: [],
    _moments: { positive: [], negative: [] },
    _ts_start: Date.now(),
  };
}

/**
 * Apply a stage outcome to the sensation state.
 * Each outcome is a map of dimension -> delta (positive or negative).
 *
 * e.g. applyStage(state, { comfort_physical: +8, cleanliness: -3, personalization: +15 }, 'arrival_checkin')
 */
function applyStageDeltas(state, deltas = {}, stageLabel = null) {
  const config = getConfig();
  const dims = Object.keys(config.dimensions);
  const next = { ...state };

  for (const dim of dims) {
    if (deltas[dim] != null) {
      next[dim] = clamp(next[dim] + deltas[dim]);
    }
  }

  next._history = [
    ...(state._history || []),
    {
      stage: stageLabel,
      deltas,
      snapshot: Object.fromEntries(dims.map(d => [d, next[d]])),
      ts: Date.now(),
    },
  ];
  return next;
}

/**
 * Record a memorable moment (positive or negative) that will surface in the review.
 */
function recordMoment(state, { kind, stage, description }) {
  const next = { ...state, _moments: {
    positive: [...(state._moments?.positive || [])],
    negative: [...(state._moments?.negative || [])],
  }};
  const entry = { stage, description, ts: Date.now() };
  if (kind === 'positive') next._moments.positive.push(entry);
  else if (kind === 'negative') next._moments.negative.push(entry);
  return next;
}

/**
 * Compute the overall weighted score for a given archetype's sensation weights.
 */
function computeWeightedScore(state, archetypeBehavior) {
  const weights = archetypeBehavior?.sensation_weights || {};
  const config = getConfig();
  const dims = Object.keys(config.dimensions);

  let weightSum = 0;
  let weightedValue = 0;
  for (const dim of dims) {
    const w = weights[dim] || (1 / dims.length) * 0.3; // fallback even weight
    weightSum += w;
    weightedValue += w * (state[dim] || 0);
  }
  if (weightSum === 0) return 0;
  return weightedValue / weightSum;
}

/**
 * Apply memorable-moment bonuses/penalties to a weighted score.
 *
 * CALIBRATION (2026-04-18):
 *   Targets based on Kahneman's peak-end rule + negativity bias research
 *   (Baumeister et al. 2001: "Bad is Stronger than Good") + hotel review corpus
 *   empirical analysis (Booking.com / TripAdvisor 5-star Mediterranean 2024):
 *     - Typical great stay: 8-12 positive moments, 0-2 negative. Expected → 72-80.
 *     - Typical good stay: 5-8 positive, 1-3 negative. Expected → 60-70.
 *     - Typical mixed:     3-6 positive, 3-6 negative. Expected → 48-58.
 *     - Typical bad:       1-3 positive, 4-8 negative. Expected → 25-40.
 *
 *   sqrt scaling on weighted positives: diminishing returns (15th "nice view"
 *   comment adds less than 1st). Coefficient 3.5 calibrated so 10 raw
 *   positives → ~+11 bonus.
 *
 *   Linear penalty on weighted negatives: negativity bias. Research shows a
 *   single serious complaint has 2-4x the emotional weight of a single
 *   positive. Coefficient 4.5 calibrated so 3 negatives → -13.5.
 *
 * PEAK-END (Kahneman 1993): the last stage and the most-intense stage are
 * weighted 1.5-1.6× — the memory of the stay crystallizes around them, not
 * around the average. Without this, a great checkout gets buried by a
 * mediocre mid-stay; or a rough last-morning silently collapses an otherwise
 * strong stay into passive territory.
 *
 * HEDONIC ADAPTATION (Frederick & Loewenstein 1999): repeated moments about
 * the same topic fade. The 5th time "the view" appears as a positive, it
 * adds less than the 1st. Detected via description overlap; decayed to ~0.45
 * weight when similarity > 0.55 with any prior same-kind moment.
 */
function tokenize(desc) {
  if (!desc) return [];
  return String(desc).toLowerCase().replace(/[^\p{L}\p{N}\s]+/gu, ' ').split(/\s+/).filter(t => t.length > 3);
}

function jaccardSim(aTokens, bTokens) {
  if (!aTokens.length || !bTokens.length) return 0;
  const aSet = new Set(aTokens);
  const bSet = new Set(bTokens);
  let inter = 0;
  for (const t of aSet) if (bSet.has(t)) inter++;
  const uni = new Set([...aSet, ...bSet]).size;
  return uni === 0 ? 0 : inter / uni;
}

/**
 * Apply peak-end weighting + hedonic adaptation to a list of moments.
 * Returns the weighted sum of moment counts (float), for use with the
 * existing sqrt / linear coefficients.
 */
function weightedMomentSum(moments, history) {
  if (!moments || moments.length === 0) return 0;

  const stageOrder = [];
  const stageMagnitude = {};
  for (const h of (history || [])) {
    if (!h.stage) continue;
    if (!stageMagnitude.hasOwnProperty(h.stage)) stageOrder.push(h.stage);
    const absDelta = Object.values(h.deltas || {}).reduce((s, v) => s + Math.abs(Number(v) || 0), 0);
    stageMagnitude[h.stage] = (stageMagnitude[h.stage] || 0) + absDelta;
  }
  const lastStage = stageOrder[stageOrder.length - 1];
  const peakStage = Object.entries(stageMagnitude).sort((a, b) => b[1] - a[1])[0]?.[0];
  const rankedMag = Object.entries(stageMagnitude).sort((a, b) => b[1] - a[1]).map(([s]) => s);
  const top3Mag = new Set(rankedMag.slice(0, 3));

  const sortedMoments = [...moments].sort((a, b) => {
    const ai = stageOrder.indexOf(a.stage), bi = stageOrder.indexOf(b.stage);
    if (ai !== bi) return ai - bi;
    return (a.ts || 0) - (b.ts || 0);
  });

  let weightedSum = 0;
  const priorTokens = [];

  for (const m of sortedMoments) {
    let w;
    if (m.stage && m.stage === lastStage) w = 1.6;
    else if (m.stage && m.stage === peakStage) w = 1.5;
    else if (m.stage && top3Mag.has(m.stage)) w = 1.2;
    else w = 1.0;

    const toks = tokenize(m.description);
    let maxSim = 0;
    for (const prev of priorTokens) {
      const s = jaccardSim(toks, prev);
      if (s > maxSim) maxSim = s;
    }
    if (maxSim > 0.55) w *= 0.45;
    else if (maxSim > 0.35) w *= 0.75;

    priorTokens.push(toks);
    weightedSum += w;
  }
  return weightedSum;
}

function computeFinalScore(state, archetypeBehavior) {
  const base = computeWeightedScore(state, archetypeBehavior);
  const positives = state._moments?.positive || [];
  const negatives = state._moments?.negative || [];
  const wPos = weightedMomentSum(positives, state._history);
  const wNeg = weightedMomentSum(negatives, state._history);
  const bonus = 3.5 * Math.sqrt(Math.max(0, wPos));
  const penalty = 4.5 * wNeg;
  return clamp(base + bonus - penalty);
}

/**
 * Convert a final score to predicted NPS (-100..100) and star rating (1..5).
 */
function scoreToNpsAndStars(finalScore) {
  const config = getConfig();
  const npsThreshold = config.nps_calculation.thresholds;
  const starBuckets = config.star_rating_bucket;

  let nps;
  if (finalScore >= npsThreshold.promoter_above) nps = 40 + (finalScore - npsThreshold.promoter_above) * 3;
  else if (finalScore >= npsThreshold.passive_range[0]) nps = -20 + (finalScore - npsThreshold.passive_range[0]) * 3;
  else nps = -60 + (finalScore - npsThreshold.detractor_below) * 2;
  nps = Math.max(-100, Math.min(100, Math.round(nps)));

  let stars;
  if (finalScore >= starBuckets['5_star_above_score']) stars = 5;
  else if (finalScore >= starBuckets['4_star_range'][0]) stars = 4;
  else if (finalScore >= starBuckets['3_star_range'][0]) stars = 3;
  else if (finalScore >= starBuckets['2_star_range'][0]) stars = 2;
  else stars = 1;

  return { nps, stars, raw_score: Math.round(finalScore * 10) / 10 };
}

/**
 * Produce a compact summary for insertion in the stay record.
 */
function summarize(state, archetypeBehavior) {
  const config = getConfig();
  const dims = Object.keys(config.dimensions);
  const finalSnapshot = Object.fromEntries(dims.map(d => [d, Math.round(state[d] || 0)]));

  const finalScore = computeFinalScore(state, archetypeBehavior);
  const { nps, stars, raw_score } = scoreToNpsAndStars(finalScore);

  return {
    final_state: finalSnapshot,
    raw_score,
    nps,
    stars,
    moments: {
      positive: state._moments?.positive || [],
      negative: state._moments?.negative || [],
    },
    history_steps: (state._history || []).length,
  };
}

module.exports = {
  initialState,
  applyStageDeltas,
  recordMoment,
  computeWeightedScore,
  computeFinalScore,
  scoreToNpsAndStars,
  summarize,
  getConfig,
};
