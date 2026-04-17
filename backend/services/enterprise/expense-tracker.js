/**
 * Expense Tracker — records itemized spending across the stay.
 *
 * Used by the narrative engine to accumulate ancillary revenue per guest.
 * Output feeds the stay record (total_spend_eur) and enterprise metrics (ABV, attach rate).
 */

function initial() {
  return {
    items: [],
    totals_by_category: {},
    total_eur: 0,
  };
}

function record(state, { stage, category, item, amount_eur, included = false, satisfaction = null, note = null }) {
  const entry = {
    stage,
    category,
    item,
    amount_eur: Number(amount_eur) || 0,
    included: !!included,
    satisfaction: satisfaction != null ? Number(satisfaction) : null,
    note,
    ts: Date.now(),
  };
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
  return {
    total_spend_eur: Math.round(state.total_eur * 100) / 100,
    by_category: Object.fromEntries(
      Object.entries(state.totals_by_category).map(([k, v]) => [k, Math.round(v * 100) / 100])
    ),
    itemized: state.items,
    item_count: state.items.length,
    ancillary_item_count: state.items.filter(i => !i.included).length,
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
