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

function record(state, { stage, category, item, amount_eur, included = false, satisfaction = null, note = null }) {
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

module.exports = { initial, record, summarize, sampleFromRange };
