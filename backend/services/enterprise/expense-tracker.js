/**
 * Expense Tracker — records itemized spending across the stay.
 *
 * Used by the narrative engine to accumulate ancillary revenue per guest.
 * Output feeds the stay record (total_spend_eur) and enterprise metrics (ABV, attach rate).
 *
 * LOSS AVERSION (Kahneman & Tversky 1979): surprise charges hurt emotionally
 * ~2.0-2.5× more than equivalent voluntary spend. A €15 "resort fee" at
 * checkout lands harder than €15 happily spent on a cocktail. We classify
 * each expense as surprise vs voluntary and compute a "perceived_value_impact"
 * that the review predictor uses to colour the value theme.
 */

// Categories that almost always read as SURPRISE when charged (loss-aversion weight)
const SURPRISE_CATEGORIES = new Set([
  'resort_fee',
  'service_charge',
  'mandatory_tip',
  'parking_mandatory',
  'parking',
  'wifi_premium',
  'wifi_upgrade',
  'late_checkout_fee',
  'early_checkin_fee',
  'minibar',
  'corkage',
  'city_tax',
  'tourist_tax',
  'tax_surprise',
  'cancellation_fee',
  'damage_fee',
  'cleaning_surcharge',
  'pet_fee',
  'luggage_storage_fee',
  'safe_usage_fee',
  'gym_access_fee',
]);

// Categories that are clearly VOLUNTARY — emotional weight 1×
const VOLUNTARY_CATEGORIES = new Set([
  'spa',
  'dining',
  'restaurant',
  'wine',
  'wine_pairing',
  'cocktails',
  'bar',
  'room_service_voluntary',
  'activity',
  'activities',
  'excursion',
  'tour',
  'gift_shop',
  'boutique',
  'room_upgrade',
  'view_upgrade',
  'laundry',
  'spa_treatment',
  'class',
  'workshop',
  'kids_club',
  'babysitting',
]);

// How heavily a surprise charge is felt vs a voluntary spend of the same
// amount. Empirically backed at 2.0-2.5× (Kahneman & Tversky loss aversion
// λ ≈ 2.25). Use 2.2 as midpoint.
const LOSS_AVERSION_MULTIPLIER = 2.2;

/**
 * Classify an expense as surprise / voluntary / neutral.
 *   surprise  → counted at LOSS_AVERSION_MULTIPLIER × amount in perceived impact
 *   voluntary → counted at 1× and may GENERATE perceived value (positive moment)
 *   neutral   → 1× (room rate, expected charges already known from booking)
 */
function classifyExpense({ category, item, included = false, note = null }) {
  if (included) return 'complimentary';
  const cat = String(category || '').toLowerCase().trim();
  const itm = String(item || '').toLowerCase();
  const noteText = String(note || '').toLowerCase();

  // Narrative hints that override category
  if (/surprise|unexpected|charged|added to|not told|hidden|mandatory/.test(noteText + ' ' + itm)) return 'surprise';
  if (/complimentary|on the house|comp|gift|included/.test(noteText + ' ' + itm)) return 'complimentary';

  if (SURPRISE_CATEGORIES.has(cat)) return 'surprise';
  if (VOLUNTARY_CATEGORIES.has(cat)) return 'voluntary';

  // Heuristic fallbacks based on item text
  if (/\bfee\b|\bcharge\b|\bsurcharge\b|\btax\b/.test(itm)) return 'surprise';
  if (/\btreatment\b|\bmassage\b|\bwine\b|\bbottle\b|\bdinner\b|\blunch\b|\bcocktail\b|\bmenu\b/.test(itm)) return 'voluntary';

  return 'neutral';
}

function initial() {
  return {
    items: [],
    totals_by_category: {},
    total_eur: 0,
  };
}

function record(state, { stage, category, item, amount_eur, included = false, satisfaction = null, note = null, source = null, confidence = null, proposed_amount = null, was_clamped = false, range_used = null }) {
  // Guard: LLM sometimes emits negative amount_eur to represent comp'd items,
  // discounts, or "refund" narrative beats (e.g. "Champagne gift €-15"). The
  // schema is additive-only — items that were complimentary should set
  // `included: true` with the retail value (or be omitted entirely). Coerce
  // negatives to 0 so the total can't go below zero.
  const raw = Number(amount_eur);
  const safeAmount = Number.isFinite(raw) ? Math.max(0, raw) : 0;
  const coercedFromNegative = Number.isFinite(raw) && raw < 0;

  const classification = classifyExpense({ category, item, included, note });
  const is_surprise = classification === 'surprise';
  const is_voluntary = classification === 'voluntary';

  const entry = {
    stage,
    category,
    item,
    amount_eur: safeAmount,
    included: !!included,
    satisfaction: satisfaction != null ? Number(satisfaction) : null,
    note,
    expense_classification: classification,
    is_surprise,
    is_voluntary,
    ...(source ? { source, confidence } : {}),
    ...(was_clamped ? { was_clamped: true, proposed_amount, range_used } : {}),
    ts: Date.now(),
    ...(coercedFromNegative ? { _coerced_from_negative_eur: raw } : {}),
  };
  if (coercedFromNegative) {
    console.warn(`[expense-tracker] coerced negative amount: ${raw}€ → 0 at ${stage}/${category}/${item}`);
  }
  const nextTotals = { ...state.totals_by_category };
  if (!included) {
    nextTotals[category] = (nextTotals[category] || 0) + entry.amount_eur;
  }
  return {
    items: [...state.items, entry],
    totals_by_category: nextTotals,
    total_eur: state.total_eur + (included ? 0 : entry.amount_eur),
  };
}

function summarize(state) {
  const safeTotal = Math.max(0, state.total_eur);
  const surpriseItems = state.items.filter(i => i.is_surprise && !i.included);
  const voluntaryItems = state.items.filter(i => i.is_voluntary && !i.included);
  const surpriseTotal = surpriseItems.reduce((s, i) => s + (i.amount_eur || 0), 0);
  const voluntaryTotal = voluntaryItems.reduce((s, i) => s + (i.amount_eur || 0), 0);
  // Perceived value impact: surprise charges weight 2.2×, voluntary 1×.
  // This is the amount the guest feels emotionally, not the accounting total.
  const perceivedImpact = (surpriseTotal * LOSS_AVERSION_MULTIPLIER) + voluntaryTotal;

  return {
    total_spend_eur: Math.round(safeTotal * 100) / 100,
    by_category: Object.fromEntries(
      Object.entries(state.totals_by_category).map(([k, v]) => [k, Math.round(Math.max(0, v) * 100) / 100])
    ),
    itemized: state.items,
    item_count: state.items.length,
    ancillary_item_count: state.items.filter(i => !i.included).length,
    complimentary_item_count: state.items.filter(i => i.included).length,
    surprise_charges_total_eur: Math.round(surpriseTotal * 100) / 100,
    voluntary_spend_total_eur: Math.round(voluntaryTotal * 100) / 100,
    perceived_value_impact_eur: Math.round(perceivedImpact * 100) / 100,
    loss_aversion_multiplier: LOSS_AVERSION_MULTIPLIER,
    surprise_item_count: surpriseItems.length,
  };
}

// ─── Public-data spend profiles (BLS + Eurostat + Virtuoso 2024) ───
const path = require('path');
const fs = require('fs');
const SPEND_PROFILES_PATH = path.join(__dirname, '..', '..', 'data', 'sources', 'guest_spend_profiles.json');
let _spendProfiles = null;
function getSpendProfiles() {
  if (_spendProfiles !== null) return _spendProfiles;
  try {
    _spendProfiles = fs.existsSync(SPEND_PROFILES_PATH) ? JSON.parse(fs.readFileSync(SPEND_PROFILES_PATH, 'utf-8')) : null;
  } catch (e) { _spendProfiles = null; }
  return _spendProfiles;
}

/**
 * Public-data spend range for an archetype × category, culturally-adjusted.
 * Returns { min, median, max } or null if profile not available.
 */
function getResearchBackedSpendRange({ archetypeId, category, culturalCluster = null }) {
  const profiles = getSpendProfiles();
  if (!profiles) return null;
  const band = profiles.by_archetype_5night_stay_eur?.[archetypeId]?.[category];
  if (!band) return null;
  const mult = culturalCluster ? (profiles._cultural_multipliers?.[culturalCluster]?.[category] || 1.0) : 1.0;
  return {
    min: Math.round(band.min * mult),
    median: Math.round(band.median * mult),
    max: Math.round(band.max * mult),
  };
}

/**
 * Right-skewed sample from a (min, median, max) range. Uses triangular
 * distribution — realistic for consumer spending where most cluster around
 * the median, fewer pay premium outliers.
 */
function sampleSkewed(range) {
  if (!range) return 0;
  const { min, median, max } = range;
  if (max <= min) return min;
  const u = Math.random();
  const F_median = (median - min) / (max - min);
  if (u < F_median) {
    return min + Math.sqrt(u * (max - min) * (median - min));
  } else {
    return max - Math.sqrt((1 - u) * (max - min) * (max - median));
  }
}

// Per-stage share table (mirrors narrative-engine's STAGE_CATEGORY_SHARE but
// kept here so clamp logic can run without importing from that module).
const STAGE_CATEGORY_SHARE = {
  dining:     { dinner: 0.20, lunch: 0.11, morning_routine: 0.08, evening_1: 0.05, last_morning: 0.04, breakfast: 0.08, afternoon_activity: 0.03 },
  bar:        { evening_1: 0.28, evening_leisure: 0.22, dinner: 0.18, daytime_activity: 0.08, lunch: 0.05, afternoon_activity: 0.05 },
  spa:        { afternoon_activity: 0.45, daytime_activity: 0.10 },
  activities: { daytime_activity: 0.35, afternoon_activity: 0.12, evening_leisure: 0.03 },
  kids_club:  { daytime_activity: 0.30, afternoon_activity: 0.25 },
  upsell:     { arrival: 0.20, room_first_impression: 0.25, dinner: 0.15, checkout: 0.10 },
  room_service: { evening_1: 0.25, evening_leisure: 0.20, morning_routine: 0.15 },
  gift_shop:  { daytime_activity: 0.30, last_morning: 0.30, checkout: 0.20 },
};

// Map LLM-emitted category names → our profile keys
const CATEGORY_NORMALIZATION = {
  breakfast: 'dining', lunch: 'dining', dinner: 'dining', room_service: 'dining',
  bar: 'bar', cocktails: 'bar',
  spa: 'spa', spa_treatment: 'spa',
  activities: 'activities', activity: 'activities', excursion: 'activities', tour: 'activities',
  kids_club: 'kids_club',
  upsell: 'upsell', room_upgrade: 'upsell', view_upgrade: 'upsell',
  gift_shop: 'gift_shop', boutique: 'gift_shop',
  wifi_premium: 'upsell',
};

/**
 * Validate + clamp + annotate an LLM-proposed expense. Produces an
 * auditable entry the sim can defend in a meeting:
 *   - respects the LLM if in-band
 *   - clamps + re-samples if out-of-band
 *   - applies occupancy pricing boost (>85% occ → +15%)
 *   - annotates with source + confidence + original_proposed if altered
 *
 * @returns {Object} { amount_eur, source, confidence, proposed_amount, was_clamped, range_used }
 */
function calibrateExpense({ proposedAmount, stage, category, archetypeId, culturalCluster = null, occupancyPct = null }) {
  const normalized = CATEGORY_NORMALIZATION[category] || category;
  const totalRange = getResearchBackedSpendRange({ archetypeId, category: normalized, culturalCluster });
  if (!totalRange) {
    // No profile: return LLM proposal as-is with low confidence
    return {
      amount_eur: Math.max(0, Number(proposedAmount) || 0),
      source: 'llm_freeform',
      confidence: 0.30,
      proposed_amount: proposedAmount,
      was_clamped: false,
      range_used: null,
    };
  }

  // Scale the total-stay range to this stage
  const share = STAGE_CATEGORY_SHARE[normalized]?.[stage] || 0.15;
  let stageRange = {
    min: Math.max(0, Math.round(totalRange.min * share * 0.5)),
    median: Math.round(totalRange.median * share),
    max: Math.round(totalRange.max * share * 1.4),
  };

  // Occupancy pricing boost: >85% occupancy raises price 15% (peak season)
  if (typeof occupancyPct === 'number' && occupancyPct >= 85) {
    stageRange.min = Math.round(stageRange.min * 1.10);
    stageRange.median = Math.round(stageRange.median * 1.15);
    stageRange.max = Math.round(stageRange.max * 1.20);
  }

  const p = Math.max(0, Number(proposedAmount) || 0);
  let finalAmount = p;
  let wasClamped = false;
  let confidence = 0.85;

  if (p < stageRange.min * 0.5 || p > stageRange.max * 1.3 || p === 0) {
    // Out of plausible band — resample from skewed distribution
    finalAmount = Math.round(sampleSkewed(stageRange));
    wasClamped = true;
    confidence = 0.70;
  } else if (p < stageRange.min) {
    finalAmount = stageRange.min;
    wasClamped = true;
    confidence = 0.75;
  } else if (p > stageRange.max) {
    finalAmount = stageRange.max;
    wasClamped = true;
    confidence = 0.75;
  }

  return {
    amount_eur: finalAmount,
    source: 'Virtuoso Luxe Report 2024 + BLS Consumer Expenditure Survey + Eurostat Tourism',
    confidence,
    proposed_amount: p,
    was_clamped: wasClamped,
    range_used: stageRange,
  };
}

/**
 * Roll an archetype's spending range into a realistic single-stay sample,
 * parametrized by stay length and archetype probabilities.
 * Called by the narrative engine per stage to generate amounts.
 */
function sampleFromRange(minMaxArray, { propensity = 0.7 } = {}) {
  if (!Array.isArray(minMaxArray) || minMaxArray.length !== 2) return 0;
  const [min, max] = minMaxArray;
  if (min === 0 && max === 0) return 0;
  // Propensity 0..1 weights toward max when high
  const u = Math.random();
  const skew = u ** (1 / Math.max(0.1, 1 + propensity));
  return Math.round(min + skew * (max - min));
}

module.exports = {
  initial, record, summarize, sampleFromRange,
  getResearchBackedSpendRange, calibrateExpense, sampleSkewed,
};
