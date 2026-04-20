/**
 * Scenario Preview — deterministic, formula-based impact forecast.
 *
 * Runs in <50ms (no LLM, no sim loop). Used by the scenario editor to give
 * consultants a live preview of the decision they are composing. When the
 * consultant is happy, they click "Run full sim + report" which spawns
 * n=1000 agents through the real simulation.
 *
 * Produces the same shape of output as the simulation (short-term €, long-
 * term LTV €, ΔNPS, segment ranking, anticipated complaints) so the preview
 * and the full report tell a coherent story.
 *
 * Calibrated against our benchmark files (hotel_elasticity_benchmarks.json,
 * egatur_2024_spending.json). Same coefficients as the full sim.
 */

// Benchmark files are bundled at build time via direct require() so that
// Vercel's serverless function bundler picks them up automatically. No
// filesystem access at runtime — this keeps the route cold-start fast.
const ELASTICITY_BENCHMARKS = require('./benchmarks/hotel_elasticity_benchmarks.json');
const EGATUR_BENCHMARKS = require('./benchmarks/egatur_2024_spending.json');
function loadBenchmarks() {
  return { elasticity: ELASTICITY_BENCHMARKS, egatur: EGATUR_BENCHMARKS };
}

// Per-archetype coefficients used by the formula engine. Mirror the
// deterministic synth in ai_claude_synth.js so preview ≈ full-sim output.
const ARCHETYPE_COEFS = {
  luxury_seeker:     { sweet: 1200, elasticity: -0.45, spend_coef: 0.65, repeat_base: 0.42, viral: 0.18, review_resilience: 0.75 },
  honeymooner:       { sweet: 1000, elasticity: -0.85, spend_coef: 0.45, repeat_base: 0.18, viral: 0.45, review_resilience: 0.50 },
  family_vacationer: { sweet: 700,  elasticity: -1.01, spend_coef: 0.55, repeat_base: 0.35, viral: 0.22, review_resilience: 0.55 },
  business_traveler: { sweet: 500,  elasticity: -0.70, spend_coef: 0.30, repeat_base: 0.60, viral: 0.08, review_resilience: 0.65 },
  digital_nomad:     { sweet: 300,  elasticity: -1.30, spend_coef: 0.20, repeat_base: 0.25, viral: 0.30, review_resilience: 0.40 },
  budget_optimizer:  { sweet: 200,  elasticity: -1.57, spend_coef: 0.15, repeat_base: 0.15, viral: 0.15, review_resilience: 0.35 },
  loyalty_maximizer: { sweet: 600,  elasticity: -0.55, spend_coef: 0.35, repeat_base: 0.75, viral: 0.20, review_resilience: 0.80 },
  event_attendee:    { sweet: 450,  elasticity: -1.20, spend_coef: 0.25, repeat_base: 0.20, viral: 0.12, review_resilience: 0.45 },
};

// Cultural cluster modifiers.
const CLUSTER_COEFS = {
  anglo_uk_ireland:   { book_delta: +0.00, walk_bias: 1.00, spend_mult: 1.00, review_impact: 1.00 },
  german_dach:        { book_delta: -0.06, walk_bias: 1.15, spend_mult: 0.95, review_impact: 1.15 }, // Germans review harsher
  anglo_us_canada:    { book_delta: +0.05, walk_bias: 0.90, spend_mult: 1.15, review_impact: 0.85 },
  french:             { book_delta: +0.03, walk_bias: 0.95, spend_mult: 0.72, review_impact: 1.00 },
  latin_spain_italy:  { book_delta: +0.08, walk_bias: 0.85, spend_mult: 0.78, review_impact: 0.90 },
  nordic:             { book_delta: +0.02, walk_bias: 0.95, spend_mult: 0.88, review_impact: 1.05 },
  latin_american:     { book_delta: +0.04, walk_bias: 0.90, spend_mult: 0.90, review_impact: 0.90 },
  middle_east_gcc:    { book_delta: +0.07, walk_bias: 0.80, spend_mult: 1.20, review_impact: 0.85 },
  east_asian:         { book_delta: +0.01, walk_bias: 1.05, spend_mult: 0.95, review_impact: 1.10 },
  chinese_mainland:   { book_delta: +0.03, walk_bias: 0.95, spend_mult: 1.05, review_impact: 1.05 },
};

const ALL_ARCHETYPES = Object.keys(ARCHETYPE_COEFS);
const ALL_CLUSTERS = Object.keys(CLUSTER_COEFS);

const TIMING_MONTHS = {
  peak:     ['jul', 'aug'],
  shoulder: ['may', 'jun', 'sep'],
  off:      ['apr', 'oct'],
  all:      ['apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct'],
};

function monthsFromTiming(timing) {
  if (Array.isArray(timing)) return timing;
  return TIMING_MONTHS[timing] || TIMING_MONTHS.all;
}

// ══════════════════════ helpers ══════════════════════

function normalizeMix(mix) {
  const total = Object.values(mix).reduce((s, v) => s + Number(v || 0), 0);
  if (total === 0) return Object.fromEntries(Object.keys(mix).map(k => [k, 0]));
  return Object.fromEntries(Object.entries(mix).map(([k, v]) => [k, Number(v || 0) / total]));
}

function baselineAnnualRevenue(property) {
  const adr = property.adr_curve_monthly || {};
  const occ = property.occupancy_curve_monthly || {};
  const rooms = property.rooms || 159;
  let rev = 0;
  const months = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
  for (const m of months) {
    const daysInMonth = 30;
    const rate = Number(adr[m] || 0);
    const occupancyPct = Number(occ[m] || 0) / 100;
    if (rate > 0 && occupancyPct > 0) rev += rate * daysInMonth * rooms * occupancyPct;
  }
  return rev || 40_000_000; // fallback for default Villa Le Blanc sized
}

function timingRevenueShare(property, timing) {
  const adr = property.adr_curve_monthly || {};
  const occ = property.occupancy_curve_monthly || {};
  const months = monthsFromTiming(timing);
  const allMonths = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
  let timingRev = 0, totalRev = 0;
  for (const m of allMonths) {
    const v = Number(adr[m] || 0) * Number(occ[m] || 0);
    totalRev += v;
    if (months.includes(m)) timingRev += v;
  }
  return totalRev > 0 ? timingRev / totalRev : 1;
}

function verdictFromNetLtv(netEur) {
  if (netEur >=  500_000) return 'HIGH_PRIORITY';
  if (netEur >= -100_000) return 'PROCEED';
  if (netEur >= -500_000) return 'CAUTION';
  return 'NOT_RECOMMENDED';
}

// ══════════════════════ 6 decision type handlers ══════════════════════

function computeRateChange({ magnitude_pct = 0, timing = 'peak', scope = { type: 'all' } }, { property, audience }) {
  // Softcap extreme magnitudes. Real-world rate decisions rarely exceed ±40%.
  // Anything beyond is likely a typo or test; we cap to avoid nonsense €M figures.
  const cappedMagnitude = Math.max(-60, Math.min(60, Number(magnitude_pct) || 0));
  magnitude_pct = cappedMagnitude;

  const archMix = normalizeMix(audience.archetype_mix || {});
  const clusterMix = normalizeMix(audience.cultural_mix || {});

  // Empty audience guard — returns a neutral error-style response rather than
  // computing garbage. Sums total weight before normalization.
  const archTotal = Object.values(audience.archetype_mix || {}).reduce((s, v) => s + Number(v || 0), 0);
  if (archTotal === 0) {
    return {
      short_term_eur: 0, long_term_eur: 0, net_eur: 0,
      nps_delta: 0, star_delta: 0, booking_delta_pct: 0,
      segments: [],
      complaints: ['audience is empty — add archetype weights to compute impact'],
      verdict: 'PROCEED',
      short_term_label: 'no audience configured',
      long_term_label: 'no audience configured',
    };
  }

  const baselineRev = baselineAnnualRevenue(property);
  const timingShare = timingRevenueShare(property, timing);

  // Cultural-weighted book_delta for the cohort
  let culturalBookDelta = 0;
  let culturalReviewImpact = 0;
  for (const [clusterId, clusterW] of Object.entries(clusterMix)) {
    if (scope.type === 'cluster' && scope.value !== clusterId) continue;
    const coef = CLUSTER_COEFS[clusterId] || CLUSTER_COEFS.anglo_uk_ireland;
    culturalBookDelta += clusterW * coef.book_delta;
    culturalReviewImpact += clusterW * coef.review_impact;
  }

  // Per-archetype booking response + explain trace
  let aggregateBookingDelta = 0;
  let aggregateReviewDelta = 0;
  const segments = [];
  const explainSteps = [];
  for (const [archId, archW] of Object.entries(archMix)) {
    if (archW === 0) continue;
    if (scope.type === 'archetype' && scope.value !== archId) continue;
    const coef = ARCHETYPE_COEFS[archId];
    if (!coef) continue;

    const priceDelta = magnitude_pct / 100;
    const elasticityEffect = coef.elasticity * priceDelta;
    const culturalCushion = culturalBookDelta * Math.abs(priceDelta) * 2;
    const bookingDelta = elasticityEffect + culturalCushion;
    aggregateBookingDelta += archW * bookingDelta;

    const reviewDelta = -Math.abs(priceDelta) * (1 - coef.review_resilience) * culturalReviewImpact * Math.sign(priceDelta);
    const effectiveReviewDelta = priceDelta > 0 ? reviewDelta : -reviewDelta * 0.3;
    aggregateReviewDelta += archW * effectiveReviewDelta;

    // Build sample narratives for this segment
    const sample_narratives = buildSegmentNarratives({
      archId, clusterMix, bookingDelta, magnitude_pct, decision_type: 'rate_change',
    });

    segments.push({
      segment: archId,
      weight_pct: Math.round(archW * 1000) / 10,
      delta_pct: Math.round(bookingDelta * 1000) / 10,
      review_delta: Math.round(effectiveReviewDelta * 100) / 100,
      sample_narratives,
      // Per-archetype explain line
      explain: {
        weight_pct: Math.round(archW * 1000) / 10,
        elasticity: coef.elasticity,
        price_delta_pct: magnitude_pct,
        elasticity_effect_pct: Math.round(elasticityEffect * 1000) / 10,
        cultural_cushion_pct: Math.round(culturalCushion * 1000) / 10,
        booking_delta_pct: Math.round(bookingDelta * 1000) / 10,
        contribution_to_aggregate_pct: Math.round(archW * bookingDelta * 1000) / 10,
      },
    });

    explainSteps.push({
      archetype: archId,
      weight: Math.round(archW * 1000) / 10 + '%',
      elasticity: coef.elasticity,
      formula: `${(archW*100).toFixed(1)}% × ε(${coef.elasticity.toFixed(2)}) × ${magnitude_pct >= 0 ? '+' : ''}${magnitude_pct}% + cultural(${(culturalBookDelta*100).toFixed(1)}%×|Δp|×2)`,
      result_pct: Math.round(archW * bookingDelta * 1000) / 10,
    });
  }

  // Short-term revenue: new_rate × new_bookings − old_rate × old_bookings
  const newRate = 1 + (magnitude_pct / 100);
  const newBookings = 1 + aggregateBookingDelta;
  const revenueChangePct = (newRate * newBookings) - 1;
  const shortTermEur = baselineRev * timingShare * revenueChangePct;

  // Long-term: review shift → repeat rate shift → LTV impact (3-yr horizon)
  const weightedRepeatBase = Object.entries(archMix).reduce((s, [id, w]) => s + w * (ARCHETYPE_COEFS[id]?.repeat_base || 0.3), 0);
  const npsDelta = aggregateReviewDelta * 40;
  const repeatRateDelta = aggregateReviewDelta * 1.2;
  const annualLtvImpact = baselineRev * weightedRepeatBase * repeatRateDelta;
  const threeYearLtvImpact = annualLtvImpact * 2.4; // attenuated over 3 years

  // Viral share: hurts more for viral-high archetypes (honeymooner, nomad)
  const weightedViral = Object.entries(archMix).reduce((s, [id, w]) => s + w * (ARCHETYPE_COEFS[id]?.viral || 0.15), 0);
  const viralLtvImpact = baselineRev * weightedViral * aggregateReviewDelta * 0.8;

  const longTermEur = threeYearLtvImpact + viralLtvImpact;
  const netEur = shortTermEur + longTermEur;

  const complaints = buildComplaintsForRateChange(magnitude_pct, segments);

  const explain = {
    inputs: {
      magnitude_pct,
      timing,
      scope,
      baseline_annual_revenue_eur: Math.round(baselineRev),
      timing_revenue_share_pct: Math.round(timingShare * 1000) / 10,
      cultural_book_delta_pct: Math.round(culturalBookDelta * 1000) / 10,
      cultural_review_impact: Math.round(culturalReviewImpact * 100) / 100,
    },
    archetype_steps: explainSteps,
    aggregate: {
      aggregate_booking_delta_pct: Math.round(aggregateBookingDelta * 1000) / 10,
      aggregate_review_delta: Math.round(aggregateReviewDelta * 100) / 100,
    },
    short_term_derivation: {
      formula: 'baseline_rev × timing_share × ((1+Δp) × (1+ΔbookingAggregate) − 1)',
      new_rate_factor: Math.round(newRate * 1000) / 1000,
      new_bookings_factor: Math.round(newBookings * 1000) / 1000,
      revenue_change_pct: Math.round(revenueChangePct * 1000) / 10,
      result_eur: Math.round(shortTermEur),
    },
    long_term_derivation: {
      weighted_repeat_base_pct: Math.round(weightedRepeatBase * 1000) / 10,
      weighted_viral_pct: Math.round(weightedViral * 1000) / 10,
      nps_delta: Math.round(npsDelta * 10) / 10,
      repeat_rate_delta_pct: Math.round(repeatRateDelta * 1000) / 10,
      three_year_ltv_via_repeat_eur: Math.round(threeYearLtvImpact),
      viral_ltv_eur: Math.round(viralLtvImpact),
      result_eur: Math.round(longTermEur),
    },
    final: {
      formula: 'Net LTV = short_term + long_term',
      short_term_eur: Math.round(shortTermEur),
      long_term_eur: Math.round(longTermEur),
      net_eur: Math.round(netEur),
    },
  };

  return {
    short_term_eur: Math.round(shortTermEur),
    long_term_eur: Math.round(longTermEur),
    net_eur: Math.round(netEur),
    nps_delta: Math.round(npsDelta * 10) / 10,
    star_delta: Math.round(aggregateReviewDelta * 10) / 10,
    booking_delta_pct: Math.round(aggregateBookingDelta * 1000) / 10,
    segments: segments.sort((a, b) => Math.abs(b.delta_pct) - Math.abs(a.delta_pct)).slice(0, 5),
    complaints,
    verdict: verdictFromNetLtv(netEur),
    short_term_label: magnitude_pct > 0 ? 'Revenue from higher rate' : 'Revenue give-up',
    long_term_label: 'LTV via review & repeat shift',
    explain,
  };
}

// Parse an inclusion string like "spa credit €120" or "breakfast" and return
// its EUR value. If no "€" is found, fall back to a generic €80 per inclusion
// so the user still sees impact from adding/removing items.
function parseInclusionValueEur(text) {
  if (!text || typeof text !== 'string') return 80;
  const m = text.match(/(?:€|eur\s*|\$)\s*(\d[\d.,]*)/i) || text.match(/(\d[\d.,]*)\s*(?:€|eur|euros?)/i);
  if (m) {
    const n = Number(String(m[1]).replace(/[^\d.]/g, ''));
    if (Number.isFinite(n) && n > 0) return n;
  }
  return 80;
}

function computePackageChange({ inclusions_added = [], inclusions_removed = [], price_delta_eur = 0, timing = 'all', scope = { type: 'all' } }, { property, audience }) {
  // Value shift in EUR: parse "€120" etc. from each inclusion string; fall back
  // to €80 default per inclusion when no price is given. Removed inclusions
  // subtract. Price delta adds cost (paying more = value down).
  const addedValue = inclusions_added.reduce((s, x) => s + parseInclusionValueEur(x), 0);
  const removedValue = inclusions_removed.reduce((s, x) => s + parseInclusionValueEur(x), 0);
  const valueShiftEur = addedValue - removedValue - (Number(price_delta_eur) || 0);
  // Anchor against total stay value (rate × nights), not nightly rate alone,
  // because packages are priced relative to the full stay economics.
  const avgRate = 800;
  const avgNights = 4;
  const stayValueAnchor = avgRate * avgNights; // €3,200 typical luxury stay
  const equivalentPriceDeltaPct = -(valueShiftEur / stayValueAnchor) * 100;
  const rate = computeRateChange({ magnitude_pct: equivalentPriceDeltaPct, timing, scope }, { property, audience });
  return {
    ...rate,
    short_term_label: 'Direct margin on package',
    long_term_label: 'LTV via value perception',
    complaints: buildComplaintsForPackage(inclusions_added, inclusions_removed),
    _package_value_shift_eur: Math.round(valueShiftEur),
    _equivalent_rate_delta_pct: Math.round(equivalentPriceDeltaPct * 10) / 10,
  };
}

function computeServiceIntervention({ moment = 'day_2', intervention = 'butler + note', target_archetype = 'honeymooner', cost_per_stay_eur = 35, timing = 'all' }, { property, audience }) {
  const archMix = normalizeMix(audience.archetype_mix || {});
  const targetWeight = Number(archMix[target_archetype] || 0);
  if (targetWeight === 0) {
    return {
      short_term_eur: 0, long_term_eur: 0, net_eur: 0,
      nps_delta: 0, star_delta: 0, booking_delta_pct: 0,
      segments: [],
      complaints: [`target archetype "${target_archetype}" is not present in the audience — zero impact`],
      verdict: 'NOT_RECOMMENDED',
      short_term_label: 'Cost of intervention',
      long_term_label: 'LTV impact (none)',
    };
  }
  const baselineRev = baselineAnnualRevenue(property);
  const stays = (property.rooms || 159) * 365 * ((property.baseline_occupancy_pct || 75) / 100) / 4; // avg stay 4 nights
  const targetStays = stays * targetWeight;
  const shortTermCost = -(targetStays * cost_per_stay_eur);

  // NPS lift for target segment (service interventions are high-leverage)
  const coef = ARCHETYPE_COEFS[target_archetype];
  const segmentNpsLift = 18; // typical lift for a well-placed intervention
  const aggregateNpsDelta = targetWeight * segmentNpsLift;

  // Long-term: repeat + viral uplift for the target
  const repeatUplift = 0.08 * coef.repeat_base; // 8% of repeat base
  const viralUplift = 0.15 * coef.viral;
  const targetRev = baselineRev * targetWeight;
  const longTermEur = targetRev * (repeatUplift + viralUplift) * 2.4;

  const netEur = shortTermCost + longTermEur;

  return {
    short_term_eur: Math.round(shortTermCost),
    long_term_eur: Math.round(longTermEur),
    net_eur: Math.round(netEur),
    nps_delta: Math.round(aggregateNpsDelta * 10) / 10,
    star_delta: Math.round(aggregateNpsDelta / 40 * 10) / 10,
    booking_delta_pct: 0,
    segments: [
      { segment: target_archetype, delta_pct: segmentNpsLift, review_delta: segmentNpsLift / 40 },
      ...Object.entries(archMix)
        .filter(([id]) => id !== target_archetype)
        .map(([id, w]) => ({ segment: id, delta_pct: 0, review_delta: 0 }))
        .slice(0, 4),
    ],
    complaints: [`without this intervention: day-${moment.replace(/_/g, ' ')} sentiment plateau`, 'no anticipated complaints from intervention itself'],
    verdict: verdictFromNetLtv(netEur),
    short_term_label: 'Operational cost',
    long_term_label: 'LTV via NPS + viral + repeat',
  };
}

function computeStaffChange({ department = 'fb', ratio_delta_pct = 0, annual_saving_eur = null, timing = 'all' }, { property, audience }) {
  // Staff reductions hit F&B reviews particularly for luxury/honeymoon archetypes.
  const archMix = normalizeMix(audience.archetype_mix || {});
  const baselineRev = baselineAnnualRevenue(property);

  // Default saving: -15% F&B ratio ≈ €480K annual saving for a 159-room luxury hotel.
  const computedSaving = annual_saving_eur != null ? -annual_saving_eur : -(Math.abs(ratio_delta_pct) / 15) * 480_000;
  const shortTermEur = ratio_delta_pct < 0 ? -computedSaving : computedSaving; // negative ratio → positive saving

  // Review impact: F&B quality drops when understaffed. Affects archetypes
  // that care about F&B (luxury, honeymoon, family).
  const fbSensitiveWeight = (archMix.luxury_seeker || 0) + (archMix.honeymooner || 0) + (archMix.family_vacationer || 0);
  const reviewImpactBase = ratio_delta_pct < 0 ? (ratio_delta_pct / 15) * 0.12 : -(ratio_delta_pct / 15) * 0.03;
  const aggregateReviewDelta = fbSensitiveWeight * reviewImpactBase;
  const npsDelta = aggregateReviewDelta * 40;
  const repeatRateDelta = aggregateReviewDelta * 1.3;
  const longTermEur = baselineRev * 0.35 * repeatRateDelta * 2.4;

  const netEur = shortTermEur + longTermEur;

  const segments = Object.entries(archMix)
    .map(([id, w]) => {
      const isSensitive = ['luxury_seeker', 'honeymooner', 'family_vacationer'].includes(id);
      return { segment: id, delta_pct: isSensitive ? reviewImpactBase * 100 : 0, review_delta: isSensitive ? reviewImpactBase * 10 : 0 };
    })
    .filter(s => Math.abs(s.delta_pct) > 0 || archMix[s.segment] > 0)
    .slice(0, 5);

  return {
    short_term_eur: Math.round(shortTermEur),
    long_term_eur: Math.round(longTermEur),
    net_eur: Math.round(netEur),
    nps_delta: Math.round(npsDelta * 10) / 10,
    star_delta: Math.round(aggregateReviewDelta * 10) / 10,
    booking_delta_pct: 0,
    segments,
    complaints: buildComplaintsForStaff(department, ratio_delta_pct),
    verdict: verdictFromNetLtv(netEur),
    short_term_label: ratio_delta_pct < 0 ? 'Annual labour saving' : 'Additional labour cost',
    long_term_label: 'LTV via review impact',
  };
}

function computeLoyalty({ tier = 'gold', benefit = 'upgrade_free', cost_per_member_eur = 120, membership_pct_of_guests = 18, timing = 'all' }, { property, audience }) {
  const archMix = normalizeMix(audience.archetype_mix || {});
  const baselineRev = baselineAnnualRevenue(property);
  const loyaltyWeight = Number(archMix.loyalty_maximizer || 0);

  const stays = (property.rooms || 159) * 365 * ((property.baseline_occupancy_pct || 75) / 100) / 4;
  const memberStays = stays * (membership_pct_of_guests / 100);
  const shortTermCost = -(memberStays * cost_per_member_eur);

  // Loyalty programs increase repeat + viral specifically for loyalty_maximizer + honeymooner
  const loyaltyRevenueShare = loyaltyWeight + 0.5 * (archMix.honeymooner || 0);
  const repeatUplift = 0.18; // loyalty members repeat ~18% more when benefit is tangible
  const longTermEur = baselineRev * loyaltyRevenueShare * repeatUplift * 2.4;
  const netEur = shortTermCost + longTermEur;

  const npsDelta = 6 * loyaltyRevenueShare;

  return {
    short_term_eur: Math.round(shortTermCost),
    long_term_eur: Math.round(longTermEur),
    net_eur: Math.round(netEur),
    nps_delta: Math.round(npsDelta * 10) / 10,
    star_delta: Math.round(npsDelta / 40 * 10) / 10,
    booking_delta_pct: 0,
    segments: [
      { segment: 'loyalty_maximizer', delta_pct: repeatUplift * 100, review_delta: 0.4 },
      { segment: 'honeymooner', delta_pct: repeatUplift * 50, review_delta: 0.2 },
    ],
    complaints: ['non-members may perceive favouritism if benefit is highly visible'],
    verdict: verdictFromNetLtv(netEur),
    short_term_label: 'Annual programme cost',
    long_term_label: 'LTV via repeat uplift',
  };
}

function computePromo({ discount_pct = 0, channel = 'direct', timing = 'shoulder', target_cluster = null }, { property, audience }) {
  // Promos lift short-term volume but can anchor next-year ADR down.
  const baselineRev = baselineAnnualRevenue(property);
  const timingShare = timingRevenueShare(property, timing);
  const archMix = normalizeMix(audience.archetype_mix || {});
  const clusterMix = normalizeMix(audience.cultural_mix || {});

  // Demand elasticity: use weighted avg elasticity + cluster uplift
  let weightedEps = 0;
  for (const [id, w] of Object.entries(archMix)) {
    weightedEps += w * (ARCHETYPE_COEFS[id]?.elasticity || -1.0);
  }
  const volumeLift = -weightedEps * (discount_pct / 100); // promo -20% × ε=-1 → +20% volume

  const netRate = 1 - Math.abs(discount_pct) / 100;
  const netVolume = 1 + volumeLift;
  const revenueChangePct = (netRate * netVolume) - 1;
  const shortTermEur = baselineRev * timingShare * revenueChangePct;

  // Long-term: anchoring effect — next year, 40% of the volume lift stays and wants the same price.
  // That compresses next-year ADR.
  const anchoredShare = 0.40;
  const nextYearAdrCompression = (discount_pct / 100) * anchoredShare;
  const longTermEur = baselineRev * timingShare * nextYearAdrCompression * 2; // 2 seasons to recover

  const netEur = shortTermEur + longTermEur;

  return {
    short_term_eur: Math.round(shortTermEur),
    long_term_eur: Math.round(longTermEur),
    net_eur: Math.round(netEur),
    nps_delta: 0,
    star_delta: 0,
    booking_delta_pct: Math.round(volumeLift * 1000) / 10,
    segments: Object.entries(archMix).slice(0, 5).map(([id, w]) => ({
      segment: id, delta_pct: Math.round(-ARCHETYPE_COEFS[id].elasticity * (discount_pct / 100) * 1000) / 10, review_delta: 0,
    })),
    complaints: buildComplaintsForPromo(discount_pct, channel),
    verdict: verdictFromNetLtv(netEur),
    short_term_label: 'Immediate revenue impact',
    long_term_label: 'ADR anchoring over 2 seasons',
  };
}

// ══════════════════════ complaint pools ══════════════════════

function buildComplaintsForRateChange(magnitude_pct, segments) {
  const out = [];
  if (magnitude_pct > 8) {
    out.push('perceived overpricing vs prior stay');
    out.push('value-vs-price complaints in post-stay reviews');
  }
  if (magnitude_pct > 15) out.push('loss of "worth returning" sentiment');
  if (magnitude_pct < -10) out.push('suspicion about quality / why so cheap');
  const worst = segments.find(s => s.delta_pct < -5);
  if (worst) out.push(`${worst.segment.replace(/_/g, ' ')} most likely to walk away`);
  return out.slice(0, 4);
}

function buildComplaintsForPackage(added, removed) {
  const out = [];
  if (removed.length) out.push(`removal of "${removed[0]}" will be noted in reviews`);
  if (added.length) out.push(`positive mention of "${added[0]}" expected`);
  if (!added.length && !removed.length) out.push('no meaningful value shift detected');
  return out;
}

function buildComplaintsForStaff(dept, delta) {
  if (delta < 0) {
    return [
      `${dept.replace(/_/g, ' ')} service speed concerns`,
      'staff attentiveness drop flagged in reviews',
      `${dept} quality inconsistency`,
    ];
  }
  if (delta > 0) return ['improved service cited as a positive'];
  return [];
}

function buildComplaintsForPromo(discount, channel) {
  const out = [];
  if (Math.abs(discount) > 15) {
    out.push('price-anchoring: guests expect same or lower next season');
    out.push('brand perception pressure in luxury tier');
  }
  if (channel === 'ota') out.push('cannibalisation of direct bookings');
  return out.slice(0, 3);
}

// ══════════════════════ entry point ══════════════════════

const DECISION_HANDLERS = {
  rate_change:          computeRateChange,
  package_change:       computePackageChange,
  service_intervention: computeServiceIntervention,
  staff_change:         computeStaffChange,
  loyalty:              computeLoyalty,
  promo:                computePromo,
};

/**
 * Main entry: compute preview for a scenario.
 *
 * @param {Object} scenario
 * @param {Object} scenario.property    - { adr_curve_monthly, occupancy_curve_monthly, rooms, baseline_nps, baseline_star }
 * @param {Object} scenario.audience    - { archetype_mix: {id: pct}, cultural_mix: {id: pct} }
 * @param {Object} scenario.decision    - { type, ...type-specific-fields }
 * @returns preview object { short_term_eur, long_term_eur, net_eur, nps_delta, segments, complaints, verdict }
 */
function computeScenarioPreview(scenario) {
  const t0 = Date.now();
  if (!scenario || !scenario.decision || !scenario.decision.type) {
    return { error: 'decision.type is required', elapsed_ms: Date.now() - t0 };
  }
  const handler = DECISION_HANDLERS[scenario.decision.type];
  if (!handler) return { error: `unknown decision type: ${scenario.decision.type}`, elapsed_ms: Date.now() - t0 };

  const property = scenario.property || {};
  const audience = scenario.audience || { archetype_mix: {}, cultural_mix: {} };

  const result = handler(scenario.decision, { property, audience });
  // Always attach a review forecast so consultants can cite in client reports.
  try {
    result.review_forecast = generateReviewForecast({
      scenario, preview: result, property, audience, decision: scenario.decision,
    });
  } catch (err) {
    result.review_forecast = { error: err.message?.substring(0, 140) };
  }
  result.elapsed_ms = Date.now() - t0;
  result.baseline_annual_revenue_eur = Math.round(baselineAnnualRevenue(property));
  return result;
}

// ══════════════════════ Narrative generator ══════════════════════════
//
// Deterministic template-based narratives per archetype × cluster × decision.
// Used by the scenario editor's "expand segment" feature so consultants can
// paste concrete citable quotes into their client-facing reports.

const CLUSTER_LABEL = {
  anglo_uk_ireland: 'UK',
  german_dach: 'German',
  anglo_us_canada: 'US',
  french: 'French',
  latin_spain_italy: 'Spanish/Italian',
  nordic: 'Nordic',
  latin_american: 'Latin American',
  middle_east_gcc: 'GCC',
  east_asian: 'East Asian',
  chinese_mainland: 'Chinese',
};

const NAMES_BY_CLUSTER = {
  anglo_uk_ireland: [['Oliver', 'Mitchell'], ['Emma', 'Wilson'], ['James', 'Brown'], ['Sophie', 'Taylor'], ['Harry', 'Davies']],
  german_dach: [['Lukas', 'Weber'], ['Marie', 'Schmidt'], ['Leon', 'Fischer'], ['Hannah', 'Bauer'], ['Felix', 'Müller']],
  anglo_us_canada: [['Ethan', 'Parker'], ['Ava', 'Johnson'], ['Mason', 'Clark'], ['Mia', 'Anderson'], ['Logan', 'Wright']],
  french: [['Gabriel', 'Martin'], ['Chloé', 'Dubois'], ['Arthur', 'Moreau'], ['Alice', 'Laurent'], ['Louis', 'Bernard']],
  latin_spain_italy: [['Marco', 'Rossi'], ['Sofia', 'Bianchi'], ['Pablo', 'García'], ['Lucía', 'Fernández'], ['Alessandro', 'Ricci']],
  nordic: [['Emil', 'Andersson'], ['Freja', 'Jensen'], ['Oscar', 'Lindström'], ['Alva', 'Berg'], ['William', 'Nilsen']],
  latin_american: [['Santiago', 'Ramírez'], ['Valentina', 'Silva'], ['Mateo', 'Torres'], ['Camila', 'Morales']],
  middle_east_gcc: [['Mohammed', 'Al-Saud'], ['Fatima', 'Al-Mansouri'], ['Ali', 'Al-Nahyan']],
  east_asian: [['Haru', 'Tanaka'], ['Yui', 'Sato'], ['Minjun', 'Kim']],
  chinese_mainland: [['Wei', 'Zhang'], ['Yan', 'Chen'], ['Ming', 'Li']],
};

const ARCHETYPE_CONTEXT = {
  luxury_seeker: { party: 'couple', age_range: [35, 58], context: 'design-led luxury' },
  honeymooner: { party: 'couple', age_range: [28, 38], context: 'honeymoon' },
  family_vacationer: { party: 'family', age_range: [34, 48], context: 'family holiday' },
  business_traveler: { party: 'solo', age_range: [30, 52], context: 'business trip' },
  digital_nomad: { party: 'solo', age_range: [26, 38], context: 'remote work stay' },
  budget_optimizer: { party: 'solo/couple', age_range: [24, 42], context: 'value-conscious break' },
  loyalty_maximizer: { party: 'couple', age_range: [40, 62], context: 'Platinum-tier return guest' },
  event_attendee: { party: 'solo', age_range: [32, 50], context: 'event attendance' },
};

// Rival / reference properties the archetype might compare against.
const RIVAL_REFERENCES = {
  luxury_seeker: ['Aman Kyoto', 'Four Seasons Bora Bora', 'Cap Juluca', 'Belmond Splendido'],
  honeymooner: ['Ikos Dassia Corfu', 'Santorini Grace', 'Amanzoe', 'Anassa Cyprus'],
  family_vacationer: ['Grecotel Kos', 'Ikos Aria', 'Camp de Mar Mallorca', 'Forte Village Sardinia'],
  business_traveler: ['Hyatt Regency Barcelona', 'Palácio do Governador Lisbon'],
  digital_nomad: ['Selina Medellín', 'Outsite Lisbon', 'Mondrian Ibiza'],
  budget_optimizer: ['Riu Palace Benidorm', 'Iberostar Málaga', 'Meliá Costa del Sol'],
  loyalty_maximizer: ['Gran Meliá Don Pepe', 'Marriott Bonvoy Palma', 'Paradisus Cancún'],
  event_attendee: ['W Barcelona', 'NH Collection Paseo del Prado'],
};

function seeded(seed) {
  let x = seed >>> 0;
  x = Math.imul(x, 2654435761) >>> 0;
  x ^= x >>> 16;
  x = Math.imul(x, 2246822507) >>> 0;
  return (x >>> 0) / 0x100000000;
}

function pickSeeded(arr, seed) {
  if (!arr || arr.length === 0) return null;
  const idx = Math.floor(seeded(seed) * arr.length) % arr.length;
  return arr[idx];
}

function hashString(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return h;
}

function buildSegmentNarratives({ archId, clusterMix, bookingDelta, magnitude_pct, decision_type }) {
  // Pick the top 3 clusters by weight for this segment (that's who they are)
  const topClusters = Object.entries(clusterMix)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([id]) => id);

  const ctx = ARCHETYPE_CONTEXT[archId] || { party: 'solo', age_range: [30, 50], context: 'leisure' };

  // Generate one narrative per top cluster (up to 3)
  return topClusters.map((clusterId, i) => {
    const seed = Math.abs(hashString(`${archId}_${clusterId}_${magnitude_pct}_${i}`));
    const name = pickSeeded(NAMES_BY_CLUSTER[clusterId] || NAMES_BY_CLUSTER.anglo_uk_ireland, seed);
    const nameStr = name ? `${name[0]} ${name[1]}` : 'Anonymous';
    const age = ctx.age_range[0] + Math.floor(seeded(seed + 7) * (ctx.age_range[1] - ctx.age_range[0]));
    const clusterLabel = CLUSTER_LABEL[clusterId] || clusterId;
    const rival = pickSeeded(RIVAL_REFERENCES[archId] || ['Four Seasons'], seed + 13);

    return narrativeForDecision({
      name: nameStr, age, archId, clusterLabel, bookingDelta, magnitude_pct, decision_type, rival, seed,
    });
  });
}

function narrativeForDecision({ name, age, archId, clusterLabel, bookingDelta, magnitude_pct, decision_type, rival, seed }) {
  const deltaAbs = Math.abs(magnitude_pct);
  const up = magnitude_pct > 0;
  const bookingAbs = Math.abs(bookingDelta);

  // RATE CHANGE narratives
  if (decision_type === 'rate_change') {
    if (up && bookingDelta < -0.10) {
      const pool = [
        `${name}, ${age}, ${clusterLabel} ${archId.replace(/_/g, ' ')} — at +${deltaAbs}% this jumps above my budget ceiling. ${rival} offers comparable product for less; I'd book there.`,
        `${name}, ${age}, ${clusterLabel} ${archId.replace(/_/g, ' ')} — +${deltaAbs}% without added value feels like a cash grab. Last year's price justified the stay; this doesn't.`,
        `${name}, ${age}, ${clusterLabel} ${archId.replace(/_/g, ' ')} — at this new price I'd expect butler service and private beach. If neither is included, I'll look at ${rival}.`,
      ];
      return pool[Math.floor(seeded(seed) * pool.length)];
    }
    if (up && bookingDelta < -0.03) {
      const pool = [
        `${name}, ${age}, ${clusterLabel} ${archId.replace(/_/g, ' ')} — +${deltaAbs}% is a stretch but I'd still book if the value narrative holds. I'll watch closely for any service drops.`,
        `${name}, ${age}, ${clusterLabel} ${archId.replace(/_/g, ' ')} — I notice the increase. I'd compare harder against ${rival} this time before committing.`,
        `${name}, ${age}, ${clusterLabel} ${archId.replace(/_/g, ' ')} — the price hurts but I've stayed here before and trust the experience. Borderline decision.`,
      ];
      return pool[Math.floor(seeded(seed) * pool.length)];
    }
    if (up && bookingDelta >= -0.03) {
      return `${name}, ${age}, ${clusterLabel} ${archId.replace(/_/g, ' ')} — +${deltaAbs}% is absorbed comfortably. I'd book as planned; price is not the deciding factor for my profile.`;
    }
    if (!up && deltaAbs >= 15) {
      return `${name}, ${age}, ${clusterLabel} ${archId.replace(/_/g, ' ')} — −${deltaAbs}% feels suspicious for a 5-star. I'd Google why it dropped before booking; might doubt quality.`;
    }
    if (!up) {
      return `${name}, ${age}, ${clusterLabel} ${archId.replace(/_/g, ' ')} — −${deltaAbs}% makes this a clear value pick; I'd book and probably extend by 1-2 nights.`;
    }
  }

  // SERVICE INTERVENTION
  if (decision_type === 'service_intervention') {
    return `${name}, ${age}, ${clusterLabel} ${archId.replace(/_/g, ' ')} — a thoughtful day-2 intervention would push my review from 4★ to 5★ and I'd recommend to 3 friends. That's where NPS breaks.`;
  }

  // STAFF CHANGE (cuts)
  if (decision_type === 'staff_change' && magnitude_pct < 0) {
    return `${name}, ${age}, ${clusterLabel} ${archId.replace(/_/g, ' ')} — at peak season slower F&B service means a 45-min wait. The stay becomes "beautiful but poorly staffed" in my review, and I don't come back.`;
  }

  // PACKAGE CHANGE
  if (decision_type === 'package_change') {
    return `${name}, ${age}, ${clusterLabel} ${archId.replace(/_/g, ' ')} — the package shift changes the value equation. I'd re-evaluate whether this still matches my expectation vs ${rival}.`;
  }

  // LOYALTY
  if (decision_type === 'loyalty') {
    return `${name}, ${age}, ${clusterLabel} ${archId.replace(/_/g, ' ')} — tangible loyalty benefit moves me from occasional to repeat. If it feels real (not token), I extend by one stay a year.`;
  }

  // PROMO
  if (decision_type === 'promo') {
    return `${name}, ${age}, ${clusterLabel} ${archId.replace(/_/g, ' ')} — the promo gets me through the door, but if I got it once I'll wait for it next year. Locks in price expectations.`;
  }

  return `${name}, ${age}, ${clusterLabel} ${archId.replace(/_/g, ' ')} — evaluating this decision based on my archetype's typical preferences.`;
}

// ══════════════════════ Sensitivity sweep ══════════════════════════════
//
// Varies one parameter of the decision (magnitude or discount) across a
// range and returns { points, optimal } so the UI can plot the curve and
// highlight the inflection point.

function runSensitivitySweep(scenario, { range = 'auto', steps = 13 } = {}) {
  if (!scenario || !scenario.decision || !scenario.decision.type) {
    return { error: 'decision.type required' };
  }
  const decision = scenario.decision;
  // Which parameter to sweep per type
  const sweepParam = {
    rate_change: 'magnitude_pct',
    package_change: 'price_delta_eur',
    service_intervention: 'cost_per_stay_eur',
    staff_change: 'ratio_delta_pct',
    loyalty: 'cost_per_member_eur',
    promo: 'discount_pct',
  }[decision.type];

  if (!sweepParam) return { error: 'unsweepable decision type' };

  // Determine range for this parameter
  const defaultRange = {
    magnitude_pct: [-30, 30],
    price_delta_eur: [-300, 300],
    cost_per_stay_eur: [0, 150],
    ratio_delta_pct: [-30, 30],
    cost_per_member_eur: [0, 400],
    discount_pct: [0, 40],
  }[sweepParam] || [-30, 30];
  const [minV, maxV] = range === 'auto' ? defaultRange : range;
  const stepSize = (maxV - minV) / (steps - 1);

  const points = [];
  for (let i = 0; i < steps; i++) {
    const v = Math.round((minV + i * stepSize) * 10) / 10;
    const mutatedDecision = { ...decision, [sweepParam]: v };
    const result = computeScenarioPreview({ ...scenario, decision: mutatedDecision });
    points.push({
      x: v,
      short_term_eur: result.short_term_eur,
      long_term_eur: result.long_term_eur,
      net_eur: result.net_eur,
      verdict: result.verdict,
    });
  }

  // Find optimal (max net_eur)
  const optimal = points.reduce((best, p) => (p.net_eur > best.net_eur ? p : best), points[0]);
  // Find "breaking point" (first point where net crosses from positive to negative)
  let breakPoint = null;
  for (let i = 1; i < points.length; i++) {
    if (points[i - 1].net_eur > 0 && points[i].net_eur <= 0) {
      breakPoint = { between: [points[i - 1].x, points[i].x], estimated: Math.round(((points[i - 1].x + points[i].x) / 2) * 10) / 10 };
      break;
    }
    if (points[i - 1].net_eur < 0 && points[i].net_eur >= 0) {
      breakPoint = { between: [points[i - 1].x, points[i].x], estimated: Math.round(((points[i - 1].x + points[i].x) / 2) * 10) / 10 };
      break;
    }
  }

  return {
    sweep_param: sweepParam,
    range: [minV, maxV],
    steps,
    points,
    optimal,
    break_point: breakPoint,
    current_value: decision[sweepParam],
  };
}

// ══════════════════════ Agent interview (offline Q&A pool) ═════════════
//
// Pool-based. Matches the consultant's question against keyword categories
// and picks a response in-character for the target archetype × cluster.
// Deterministic (seeded) so the same question always gets the same answer —
// good for demoing live.

const QA_CATEGORIES = [
  { id: 'price',     keywords: /price|rate|expensive|cost|cheap|pago|precio|tarifa|caro/i },
  { id: 'value',     keywords: /value|worth|worthwhile|justifies|merece|vale la pena/i },
  { id: 'service',   keywords: /service|staff|concierge|butler|personal/i },
  { id: 'food',      keywords: /food|restaurant|breakfast|dinner|comida|desayuno/i },
  { id: 'location',  keywords: /location|beach|pool|ubicación|playa|piscina/i },
  { id: 'family',    keywords: /family|kids|children|niños|familia/i },
  { id: 'compare',   keywords: /compare|alternative|other|competitor|comparar|alternativa/i },
  { id: 'recommend', keywords: /recommend|return|repeat|recomiendo|volver/i },
];

const QA_RESPONSES_BY_ARCHETYPE = {
  luxury_seeker: {
    price: [
      'Price is contextual for me — I look at what the rate buys versus what ${rival} charges. If the design and service are genuinely uncompromised, I pay.',
      'I notice the number but I don\'t lead with it. I lead with whether the property delivers the story I came for.',
    ],
    value: [
      'Value isn\'t cheap — it\'s whether the experience leaves a memory worth the price. A €1,600 night that doesn\'t move me is expensive. A €1,200 night that does is a bargain.',
    ],
    service: [
      'Service is the entire product for me at this tier. If the bellman doesn\'t remember my name on night 2, the whole thesis collapses.',
    ],
    compare: [
      'My reference set is Aman, Belmond, LHW. If ${rival} delivers that narrative cheaper, I switch. If you do it better, I stay loyal.',
    ],
  },
  honeymooner: {
    price: [
      'Price matters but the occasion matters more. I\'d rather pay extra for a stay I\'ll remember than save €200 on a forgettable one.',
    ],
    service: [
      'A handwritten note on day 1, champagne without asking, remembering we\'re newlyweds — those are the moments I post on Instagram. Miss them and I feel invisible.',
    ],
    recommend: [
      'If day-2 is magic I tell 20 friends. If it\'s cold I don\'t come back and write a lukewarm review. The middle days are where the hotel wins or loses.',
    ],
  },
  family_vacationer: {
    price: [
      'With two kids and 10 nights I calculate every €. If breakfast isn\'t included I need to add €200/day to my mental budget. Packaging matters.',
    ],
    family: [
      'Kids club quality and pool safety are non-negotiable. I\'ll pay more for a place that actually has trained staff, not just a painted room.',
    ],
    food: [
      'Buffet quality + kids menu variety defines whether we come back. Day 4 the kids are tired of the same pasta — that\'s when a mediocre operation shows.',
    ],
  },
  business_traveler: {
    price: [
      'I\'m on per diem. Within policy, price is almost invisible. Over policy, I need explicit approval — friction I avoid.',
    ],
    service: [
      'Wi-Fi speed, late check-out, quiet room — that\'s my stack. If those three work, the rest is bonus.',
    ],
  },
  digital_nomad: {
    price: [
      'I stay 2-4 weeks — per-night price matters less than cumulative. A €250 spot with reliable coworking beats a €150 spot where Wi-Fi dies at 3pm.',
    ],
  },
  budget_optimizer: {
    price: [
      'Every € above expectation requires justification. I\'ll book the €120 room over the €180 one unless the €180 includes something I actually use.',
    ],
    compare: [
      'I run 3-4 comparisons before booking. If your property is 15% more than ${rival} and the offer isn\'t 15% better, I go with the competitor.',
    ],
  },
  loyalty_maximizer: {
    service: [
      'Status recognition is what keeps me. If I\'m Platinum and check-in treats me like anyone else, I stop caring about the tier. Then I shop on price like everyone else.',
    ],
    recommend: [
      'Loyalty is brand, not property. If Gran Meliá delivers at any of their hotels, I book the chain. If one property fails, the whole chain feels suspect.',
    ],
  },
  event_attendee: {
    price: [
      'Event dates dictate — I pay what the market demands for proximity. But if it\'s 30% over normal peak I grumble in the post-stay review.',
    ],
  },
};

function generateInterviewAnswer({ question, archId, clusterId }) {
  if (!question || typeof question !== 'string') return { error: 'question required' };
  // Match first category
  let matchedCategory = 'compare';
  for (const cat of QA_CATEGORIES) {
    if (cat.keywords.test(question)) {
      matchedCategory = cat.id;
      break;
    }
  }
  const archPool = QA_RESPONSES_BY_ARCHETYPE[archId] || QA_RESPONSES_BY_ARCHETYPE.luxury_seeker;
  const poolForCategory = archPool[matchedCategory] || archPool.price || ['I\'d need to think about that in context of my specific trip needs.'];
  const seed = hashString(`${archId}_${clusterId}_${question}`);
  const rawAnswer = poolForCategory[Math.abs(seed) % poolForCategory.length];

  // Generate a matching name/age
  const names = NAMES_BY_CLUSTER[clusterId] || NAMES_BY_CLUSTER.anglo_uk_ireland;
  const name = names[Math.abs(seed) % names.length];
  const nameStr = name ? `${name[0]} ${name[1]}` : 'Guest';
  const ctx = ARCHETYPE_CONTEXT[archId] || { age_range: [30, 50] };
  const age = ctx.age_range[0] + (Math.abs(seed) % (ctx.age_range[1] - ctx.age_range[0]));
  const rival = pickSeeded(RIVAL_REFERENCES[archId] || ['Four Seasons'], seed);

  // Replace ${rival} placeholder
  const answer = rawAnswer.replace(/\$\{rival\}/g, rival);

  return {
    name: nameStr,
    age,
    archetype: archId,
    cluster: clusterId,
    cluster_label: CLUSTER_LABEL[clusterId] || clusterId,
    question,
    matched_category: matchedCategory,
    answer,
  };
}

// ══════════════════════ Review Forecaster ═════════════════════════════
//
// Given a preview + scenario, generates 6-8 realistic reviews that would
// plausibly appear on TripAdvisor / Booking.com / Google in the 90 days
// after shipping the decision. Used by the consultant to SHOW the client
// what the review wall will look like — not just an abstract star delta.

const COUNTRY_BY_CLUSTER = {
  anglo_uk_ireland: [{ code: 'GB', label: 'United Kingdom' }, { code: 'IE', label: 'Ireland' }],
  german_dach: [{ code: 'DE', label: 'Germany' }, { code: 'AT', label: 'Austria' }, { code: 'CH', label: 'Switzerland' }],
  anglo_us_canada: [{ code: 'US', label: 'United States' }, { code: 'CA', label: 'Canada' }],
  french: [{ code: 'FR', label: 'France' }, { code: 'BE', label: 'Belgium' }],
  latin_spain_italy: [{ code: 'ES', label: 'Spain' }, { code: 'IT', label: 'Italy' }],
  nordic: [{ code: 'SE', label: 'Sweden' }, { code: 'NO', label: 'Norway' }, { code: 'DK', label: 'Denmark' }, { code: 'FI', label: 'Finland' }],
  latin_american: [{ code: 'MX', label: 'Mexico' }, { code: 'BR', label: 'Brazil' }, { code: 'AR', label: 'Argentina' }],
  middle_east_gcc: [{ code: 'AE', label: 'UAE' }, { code: 'SA', label: 'Saudi Arabia' }, { code: 'QA', label: 'Qatar' }],
  east_asian: [{ code: 'JP', label: 'Japan' }, { code: 'KR', label: 'South Korea' }],
  chinese_mainland: [{ code: 'CN', label: 'China' }],
};

const TRIP_TYPE_BY_ARCHETYPE = {
  luxury_seeker: 'couple',
  honeymooner: 'couple',
  family_vacationer: 'family',
  business_traveler: 'business',
  digital_nomad: 'solo',
  budget_optimizer: 'solo',
  loyalty_maximizer: 'couple',
  event_attendee: 'business',
};

const REVIEW_TEMPLATES = {
  // ★★★★★ / 5 — strong positive
  love: {
    title: [
      'Exceeded every expectation',
      'Best stay in years',
      'Worth every euro',
      'We will be back',
      'Unforgettable',
      'A genuine 5-star experience',
    ],
    openers: [
      'Stayed {nights} nights for our {occasion} and {property} delivered from arrival to checkout.',
      'This was our {times_there} time here and somehow it keeps getting better.',
      'Booked on short notice and glad we did — the experience lived up to the price tag.',
    ],
    middles_pos: [
      'The {positive_theme} was exceptional. Staff remembered our names by day two.',
      'Design, food, location — all at a level you rarely find at this price point.',
      'Quiet attention to detail everywhere: the amenity kit, the handwritten note, the silent cortesy.',
      'Food at the main restaurant is genuinely a destination, not a hotel dining room.',
    ],
    endings: [
      'Already booked our return for next summer. Easy 5 stars.',
      'Rare that a hotel lives up to its instagram feed — this one does.',
      'Worth every cent and would recommend without hesitation.',
    ],
  },
  // ★★★★ / 4 — fine with reservations
  fine: {
    title: [
      'Beautiful property, some quirks',
      'Mostly great with caveats',
      'Lovely but pricey',
      'Good but not perfect',
      'Solid, room for improvement',
    ],
    openers: [
      'Spent {nights} nights here for {occasion}. Mixed feelings overall.',
      'Booked based on the reviews. Mostly met expectations, some gaps.',
      'Returning guest so I can compare — still good, but noticed the edges.',
    ],
    middles_pos: [
      '{positive_theme} remained a highlight.',
      'Check-in and housekeeping were smooth throughout.',
    ],
    middles_neg: [
      'However, the {negative_theme} felt below the tier you pay for.',
      'Small things added up: service inconsistency, long waits at F&B, WiFi drops at the pool.',
      'The price jump from last year is hard to justify if the amenities haven\'t visibly improved.',
    ],
    endings: [
      'Would consider returning if the value equation improves.',
      'Good stay, but the price-value gap is widening.',
      'Solid 4 stars for now, not 5 anymore.',
    ],
  },
  // ★★★ / 3 — clearly disappointed
  bad: {
    title: [
      'Expected more for the price',
      'Beautiful but overpriced',
      'Decline from previous stay',
      'Not what it used to be',
      'Left with a bitter taste',
    ],
    openers: [
      'Booked {nights} nights expecting something closer to what was advertised.',
      'At {rate}€ per night I had specific expectations — most were not met.',
      'This is my {times_there} stay and the gap is growing.',
    ],
    middles_neg: [
      'The {negative_theme} was the main let-down. Not what I pay luxury pricing for.',
      'Service felt rushed, impersonal, and inconsistent across shifts.',
      'The F&B is understaffed at peak — watched the bar team drown during cocktail hour.',
      'Pool music far too loud for the "adults-only sanctuary" they sell on the website.',
    ],
    middles_pos: [
      'The {positive_theme} was the one thing that saved it.',
      'Housekeeping did their best despite everything else.',
    ],
    endings: [
      'Considering alternatives for next year — {competitor} looks sharper for the money.',
      'Will not be rushing back at current pricing.',
      'Would not recommend without a serious rate adjustment.',
    ],
  },
  // ★★ / 2 — angry
  angry: {
    title: [
      'A €{rate}/night mistake',
      'Overpriced and overconfident',
      'Won\'t be coming back',
      'Massive disappointment',
      'Brand-damaging pricing',
    ],
    openers: [
      'Paid {rate}€ a night and left regretting it within 48 hours.',
      'After years of being a loyal guest, this visit broke the relationship.',
      'Stayed {nights} nights. Writing this so you can decide better than I did.',
    ],
    middles_neg: [
      'The {negative_theme} was openly unacceptable at this price point.',
      'I counted four different guests complaining at reception in one 30-minute period.',
      'When we raised the issue, the front desk response was a shrug and a €20 voucher.',
      'At these rates the hotel should be competing with {competitor} — instead it feels like it\'s resting on old reviews.',
    ],
    endings: [
      'Book {competitor} instead and save yourself the frustration.',
      'This hotel has forgotten how luxury-tier service works. Avoid.',
      'Last visit. Writing this for other travellers to reconsider.',
    ],
  },
};

function pickReviewTier(bookingDelta, verdict, rand) {
  // Distribution depends on decision verdict; rand ∈ [0,1] picks which tier
  // each reviewer sits in. Calibrated to produce a believable mix.
  let probs;
  if (verdict === 'HIGH_PRIORITY') probs = { love: 0.75, fine: 0.20, bad: 0.04, angry: 0.01 };
  else if (verdict === 'PROCEED') probs = { love: 0.60, fine: 0.30, bad: 0.08, angry: 0.02 };
  else if (verdict === 'CAUTION') probs = { love: 0.35, fine: 0.35, bad: 0.22, angry: 0.08 };
  else if (verdict === 'NOT_RECOMMENDED') probs = { love: 0.20, fine: 0.25, bad: 0.35, angry: 0.20 };
  else probs = { love: 0.50, fine: 0.30, bad: 0.15, angry: 0.05 };

  let cum = 0;
  for (const tier of ['love', 'fine', 'bad', 'angry']) {
    cum += probs[tier];
    if (rand <= cum) return tier;
  }
  return 'fine';
}

function starsForTier(tier) {
  return { love: 5, fine: 4, bad: 3, angry: 2 }[tier] || 3;
}

function ratingFor(tier, platform) {
  if (platform === 'booking') {
    return { love: 9.6, fine: 8.4, bad: 6.8, angry: 4.2 }[tier] || 7.5;
  }
  return starsForTier(tier);
}

function futureDateIso(daysAhead, seed) {
  const d = new Date();
  d.setDate(d.getDate() + daysAhead);
  return d.toISOString().slice(0, 10);
}

function templateFill(str, vars) {
  return str.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? k);
}

function generateReviewForecast({ scenario, preview, property, audience, decision }) {
  const archMix = normalizeMix(audience.archetype_mix || {});
  const clusterMix = normalizeMix(audience.cultural_mix || {});
  const verdict = preview?.verdict || 'PROCEED';
  const segments = preview?.segments || [];

  // We want 7 reviews total. Distribute across top 5 archetypes by audience
  // weight, and top 5 clusters by audience weight, in a realistic spread.
  const topArch = Object.entries(archMix)
    .filter(([id, w]) => w > 0.02)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([id]) => id);
  const topClusters = Object.entries(clusterMix)
    .filter(([id, w]) => w > 0.02)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([id]) => id);

  if (topArch.length === 0 || topClusters.length === 0) {
    return { reviews: [], expected_avg_star: null, volume_forecast_pct: null, note: 'audience empty' };
  }

  const PLATFORMS = ['tripadvisor', 'booking', 'google', 'tripadvisor', 'booking', 'google', 'tripadvisor'];
  const N = 7;
  const reviews = [];

  for (let i = 0; i < N; i++) {
    const archId = topArch[i % topArch.length];
    const clusterId = topClusters[i % topClusters.length];
    const platform = PLATFORMS[i];

    const seed = Math.abs(hashString(`${archId}|${clusterId}|${decision.type}|${decision.magnitude_pct ?? decision.discount_pct ?? i}|${i}`));
    const rand = seeded(seed);
    const rand2 = seeded(seed + 17);
    const rand3 = seeded(seed + 31);

    // Map archetype booking delta to likely tier distribution shift
    const segData = segments.find((s) => s.segment === archId);
    const archBookingDelta = segData?.delta_pct != null ? segData.delta_pct / 100 : 0;
    // Shift rand based on booking delta (more negative delta → bias toward bad tiers)
    const shiftedRand = Math.max(0, Math.min(1, rand - archBookingDelta * 1.5));
    const tier = pickReviewTier(archBookingDelta, verdict, shiftedRand);

    // Name + origin
    const namePair = pickSeeded(NAMES_BY_CLUSTER[clusterId] || NAMES_BY_CLUSTER.anglo_uk_ireland, seed);
    const firstInit = namePair ? namePair[0] : 'Guest';
    const lastInit = namePair ? namePair[1].charAt(0) + '.' : 'X.';
    const fullName = `${firstInit} ${lastInit}`;
    const country = pickSeeded(COUNTRY_BY_CLUSTER[clusterId] || COUNTRY_BY_CLUSTER.anglo_uk_ireland, seed + 5);
    const tripType = TRIP_TYPE_BY_ARCHETYPE[archId] || 'couple';

    // Build review body
    const tmpl = REVIEW_TEMPLATES[tier];
    const title = pickSeeded(tmpl.title, seed + 11);
    const opener = pickSeeded(tmpl.openers, seed + 21);
    const pos = pickSeeded(tmpl.middles_pos || tmpl.middles_neg, seed + 31);
    const neg = pickSeeded(tmpl.middles_neg || tmpl.middles_pos, seed + 41);
    const ending = pickSeeded(tmpl.endings, seed + 51);

    const positive_theme = pickSeeded(['design', 'breakfast', 'spa', 'pool setting', 'staff warmth', 'location'], seed + 7) || 'service';
    const negative_theme = pickSeeded(['value-for-money', 'F&B pricing', 'service speed', 'noise level', 'pool crowding', 'resort-fee surprise'], seed + 17) || 'value';
    const competitor = pickSeeded(RIVAL_REFERENCES[archId] || ['Aman Venice', 'Four Seasons Lisbon'], seed + 27);
    const rateDisplay = Math.round((property?.adr_curve_monthly?.aug || property?.adr_curve_monthly?.jul || 800)) ;

    const vars = {
      nights: 3 + Math.floor(rand3 * 6),
      occasion: tripType === 'couple' ? (archId === 'honeymooner' ? 'honeymoon' : 'anniversary')
        : tripType === 'family' ? 'summer holiday with kids' : tripType === 'business' ? 'conference' : 'short escape',
      property: property?.name || 'the property',
      positive_theme, negative_theme,
      times_there: archId === 'loyalty_maximizer' ? 'fourth' : archId === 'luxury_seeker' ? 'second' : 'first',
      rate: rateDisplay,
      competitor,
    };

    // Tier body composition
    const body = tier === 'love'
      ? `${templateFill(opener, vars)} ${templateFill(pos, vars)} ${templateFill(pickSeeded(tmpl.middles_pos, seed + 33), vars)} ${templateFill(ending, vars)}`
      : tier === 'fine'
      ? `${templateFill(opener, vars)} ${templateFill(pos, vars)} ${templateFill(neg, vars)} ${templateFill(ending, vars)}`
      : tier === 'bad'
      ? `${templateFill(opener, vars)} ${templateFill(neg, vars)} ${templateFill(pos, vars)} ${templateFill(ending, vars)}`
      : `${templateFill(opener, vars)} ${templateFill(neg, vars)} ${templateFill(pickSeeded(tmpl.middles_neg, seed + 43), vars)} ${templateFill(ending, vars)}`;

    const stars = starsForTier(tier);
    const bookingScore = ratingFor(tier, 'booking');
    const daysAhead = 5 + Math.floor((i / N) * 85) + Math.floor(rand2 * 10);

    reviews.push({
      platform,
      rating: platform === 'booking' ? bookingScore : stars,
      rating_scale: platform === 'booking' ? 10 : 5,
      stars,
      date: futureDateIso(daysAhead),
      days_ahead: daysAhead,
      reviewer_first_name: firstInit,
      reviewer_name: fullName,
      country_code: country?.code || 'XX',
      country_label: country?.label || '',
      trip_type: tripType,
      archetype: archId,
      cluster: clusterId,
      title: templateFill(title, vars),
      body,
      tier,
      is_positive: stars >= 4,
    });
  }

  // Sort by days_ahead so reviews appear chronologically
  reviews.sort((a, b) => a.days_ahead - b.days_ahead);

  // Aggregate
  const avgStar = reviews.reduce((s, r) => s + r.stars, 0) / reviews.length;
  const loveN = reviews.filter(r => r.tier === 'love').length;
  const fineN = reviews.filter(r => r.tier === 'fine').length;
  const badN = reviews.filter(r => r.tier === 'bad').length;
  const angryN = reviews.filter(r => r.tier === 'angry').length;

  // Volume forecast — negative decisions reduce review volume, positive boost
  const baselineStar = property?.baseline_star || 4.5;
  const starDelta = avgStar - baselineStar;
  const volumeDeltaPct = Math.round(starDelta * 10 * 10) / 10; // +0.1 star ≈ +1% volume

  return {
    reviews,
    expected_avg_star: Math.round(avgStar * 100) / 100,
    baseline_star: Math.round(baselineStar * 100) / 100,
    star_delta: Math.round(starDelta * 100) / 100,
    volume_forecast_pct: volumeDeltaPct,
    tier_breakdown: { love: loveN, fine: fineN, bad: badN, angry: angryN },
    period_days: 90,
  };
}

// ══════════════════════ Competitor Reaction Simulator ══════════════════
//
// Game-theory-lite: run the same rate decision under 3 different competitor
// reactions (don't follow / match / undercut) × 3 of YOUR rate options, and
// return a 3×3 matrix of net LTVs. Identify dominant strategy + Nash point.

// Comparison sensitivity per archetype — how much a 10% relative-price gap
// with the comp-set shifts booking. Higher = more defection.
const ARCHETYPE_COMPARISON_SENSITIVITY = {
  luxury_seeker:     0.4,   // low — brand over price
  honeymooner:       0.7,
  family_vacationer: 1.2,
  business_traveler: 0.3,
  digital_nomad:     1.4,
  budget_optimizer:  2.2,   // high — shops harder
  loyalty_maximizer: 0.4,
  event_attendee:    0.9,
};

function computeRateChangeWithCompetitor(decision, context, competitor_rate_delta_pct = 0) {
  // Modifies computeRateChange to factor in a competitor rate change. The
  // relative price gap (your_change − competitor_change) drives extra
  // defection weighted by each archetype's comparison sensitivity.
  const baseRate = computeRateChange(decision, context);
  if (!competitor_rate_delta_pct) return baseRate;

  const { audience, property } = context;
  const archMix = normalizeMix(audience.archetype_mix || {});
  const yourMagnitude = Number(decision.magnitude_pct) || 0;
  const gap = yourMagnitude - competitor_rate_delta_pct; // positive = you more expensive than comp
  if (gap === 0) return baseRate;

  const baselineRev = baselineAnnualRevenue(property);
  const timingShare = timingRevenueShare(property, decision.timing || 'all');

  // Extra defection from the gap
  let extraDefectionPct = 0;
  for (const [id, w] of Object.entries(archMix)) {
    const sensitivity = ARCHETYPE_COMPARISON_SENSITIVITY[id] || 1.0;
    extraDefectionPct += w * sensitivity * (gap / 100) * 0.5;
  }

  const extraRevenueHitEur = -baselineRev * timingShare * extraDefectionPct;
  // Reviews also affected: when you're visibly more expensive, value-for-money
  // reviews drop. Roughly 20% of the extra defection translates into review impact.
  const extraReviewDelta = -extraDefectionPct * 0.2;
  const extraLtvEur = baselineRev * 0.35 * extraReviewDelta * 2.4;

  const newNet = baseRate.net_eur + extraRevenueHitEur + extraLtvEur;
  return {
    ...baseRate,
    short_term_eur: baseRate.short_term_eur + Math.round(extraRevenueHitEur),
    long_term_eur: baseRate.long_term_eur + Math.round(extraLtvEur),
    net_eur: Math.round(newNet),
    verdict: verdictFromNetLtv(newNet),
    competitor_gap_pct: Math.round(gap * 10) / 10,
    extra_defection_pct: Math.round(extraDefectionPct * 1000) / 10,
  };
}

/**
 * Runs a 3×3 competitor reaction matrix.
 *
 * @param {Object} scenario                 full scenario
 * @param {number[]} yourOptions            3 magnitudes to test (default: [0, current, current*1.5])
 * @param {number[]} competitorReactions    3 competitor deltas (default: [0, current, current - 10])
 */
function runCompetitorMatrix(scenario, { yourOptions = null, competitorReactions = null } = {}) {
  if (!scenario || !scenario.decision || !scenario.decision.type) {
    return { error: 'decision.type required' };
  }
  if (scenario.decision.type !== 'rate_change') {
    return { error: 'competitor matrix only applies to rate_change decisions right now' };
  }

  const current = Number(scenario.decision.magnitude_pct) || 0;
  const youOpts = yourOptions || [
    { label: 'Hold steady', magnitude: 0 },
    { label: `Your plan (+${current}%)`, magnitude: current },
    { label: `Aggressive (+${Math.max(current + 5, 12)}%)`, magnitude: Math.max(current + 5, 12) },
  ];
  const compOpts = competitorReactions || [
    { label: "Don't follow (they hold)", delta: 0 },
    { label: 'Match your move', delta: current },
    { label: 'Undercut by 10%', delta: current - 10 },
  ];

  const property = scenario.property || {};
  const audience = scenario.audience || {};

  const matrix = youOpts.map((you) => compOpts.map((comp) => {
    const r = computeRateChangeWithCompetitor(
      { ...scenario.decision, magnitude_pct: you.magnitude },
      { property, audience },
      comp.delta,
    );
    return {
      you_label: you.label,
      you_magnitude: you.magnitude,
      comp_label: comp.label,
      comp_delta: comp.delta,
      short_term_eur: r.short_term_eur,
      long_term_eur: r.long_term_eur,
      net_eur: r.net_eur,
      verdict: r.verdict,
      gap_pct: r.competitor_gap_pct ?? (you.magnitude - comp.delta),
    };
  }));

  // Dominant strategy: your row whose worst outcome is best (maximin)
  const minOfEachRow = matrix.map((row) => Math.min(...row.map((c) => c.net_eur)));
  const maxOfMins = Math.max(...minOfEachRow);
  const dominantIdx = minOfEachRow.indexOf(maxOfMins);
  const dominantStrategy = youOpts[dominantIdx];

  // Nash equilibrium (simple): for each row (your choice), find the comp's best response.
  // For each col (comp's response), find your best response. Intersection = Nash.
  // Simplified: we assume comp wants to MINIMIZE your net (adversarial).
  const compBestResponse = matrix.map((row) => {
    const minIdx = row.reduce((best, c, i) => (c.net_eur < row[best].net_eur ? i : best), 0);
    return minIdx;
  });
  const yourBestResponse = compOpts.map((_, colIdx) => {
    const col = matrix.map((row) => row[colIdx]);
    const maxIdx = col.reduce((best, c, i) => (c.net_eur > col[best].net_eur ? i : best), 0);
    return maxIdx;
  });
  let nash = null;
  for (let r = 0; r < matrix.length; r++) {
    const c = compBestResponse[r];
    if (yourBestResponse[c] === r) { nash = { row: r, col: c, cell: matrix[r][c] }; break; }
  }

  // Worst case on your plan (current)
  const worstOnCurrent = Math.min(...matrix[1].map((c) => c.net_eur));

  return {
    your_options: youOpts,
    competitor_reactions: compOpts,
    matrix,
    dominant_strategy: {
      row_idx: dominantIdx,
      label: dominantStrategy.label,
      magnitude: dominantStrategy.magnitude,
      min_guaranteed_net_eur: maxOfMins,
    },
    nash_equilibrium: nash,
    current_plan_worst_case_eur: worstOnCurrent,
  };
}

module.exports = {
  computeScenarioPreview,
  runSensitivitySweep,
  runCompetitorMatrix,
  generateInterviewAnswer,
  generateReviewForecast,
  ALL_ARCHETYPES,
  ALL_CLUSTERS,
  ARCHETYPE_COEFS,
  CLUSTER_COEFS,
};
