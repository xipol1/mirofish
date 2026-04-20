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

  // Per-archetype booking response
  let aggregateBookingDelta = 0;
  let aggregateReviewDelta = 0;
  const segments = [];
  for (const [archId, archW] of Object.entries(archMix)) {
    if (archW === 0) continue;
    if (scope.type === 'archetype' && scope.value !== archId) continue;
    const coef = ARCHETYPE_COEFS[archId];
    if (!coef) continue;

    // booking delta = elasticity × relative_price_change. Cultural cushion is a
    // dampener proportional to price change magnitude — no price change → 0 impact.
    const priceDelta = magnitude_pct / 100;
    const elasticityEffect = coef.elasticity * priceDelta;
    const culturalCushion = culturalBookDelta * Math.abs(priceDelta) * 2;
    const bookingDelta = elasticityEffect + culturalCushion;
    aggregateBookingDelta += archW * bookingDelta;

    // Review delta: rate hikes hurt value perception. Scales with magnitude
    // and inversely with the archetype's review_resilience.
    const reviewDelta = -Math.abs(priceDelta) * (1 - coef.review_resilience) * culturalReviewImpact * Math.sign(priceDelta);
    // (negative when price up, positive when price down)
    const effectiveReviewDelta = priceDelta > 0 ? reviewDelta : -reviewDelta * 0.3; // downward pricing helps less than upward hurts
    aggregateReviewDelta += archW * effectiveReviewDelta;

    segments.push({
      segment: archId,
      delta_pct: Math.round(bookingDelta * 1000) / 10,
      review_delta: Math.round(effectiveReviewDelta * 100) / 100,
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
  result.elapsed_ms = Date.now() - t0;
  result.baseline_annual_revenue_eur = Math.round(baselineAnnualRevenue(property));
  return result;
}

module.exports = {
  computeScenarioPreview,
  ALL_ARCHETYPES,
  ALL_CLUSTERS,
  ARCHETYPE_COEFS,
  CLUSTER_COEFS,
};
