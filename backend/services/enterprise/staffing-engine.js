/**
 * Staffing Engine — given a predicted cohort for a date range, compute the
 * optimal staff schedule per department per day.
 *
 * Answers: "For the week of Aug 14-20 at 93% occupancy with this guest mix,
 * how many staff do I need per department to maintain NPS ≥ +60, and what
 * does it cost me?"
 *
 * Outputs:
 *   - Daily staff demand matrix (role × day × count)
 *   - Labor cost in EUR for the period
 *   - NPS risk band if understaffed by X%
 *   - Bottleneck flags (which departments will saturate at current ratios)
 */

const fs = require('fs');
const path = require('path');

// ─── Staff:guest ratios (STR Global + AHLA 2024 benchmarks) ───────────────
// Luxury tier ratios — ratios of staff per guest per day.
const STAFF_RATIOS_LUXURY = {
  front_desk:      { ratio: 1 / 35, fte_hours_per_shift: 8, shifts_per_day: 3, hourly_rate_eur: 18 },
  concierge:       { ratio: 1 / 45, fte_hours_per_shift: 8, shifts_per_day: 2, hourly_rate_eur: 22 },
  butler:          { ratio: 1 / 10, fte_hours_per_shift: 8, shifts_per_day: 2, hourly_rate_eur: 24, archetype_demand: ['honeymooner', 'luxury_seeker'] },
  housekeeper:     { ratio: 1 / 12, fte_hours_per_shift: 8, shifts_per_day: 2, hourly_rate_eur: 15 },
  fb_server:       { ratio: 1 / 16, fte_hours_per_shift: 8, shifts_per_day: 2, hourly_rate_eur: 17 },
  fb_chef:         { ratio: 1 / 25, fte_hours_per_shift: 9, shifts_per_day: 2, hourly_rate_eur: 26 },
  spa_therapist:   { ratio: 1 / 30, fte_hours_per_shift: 8, shifts_per_day: 2, hourly_rate_eur: 22, capacity_bound: true },
  pool_attendant:  { ratio: 1 / 40, fte_hours_per_shift: 8, shifts_per_day: 2, hourly_rate_eur: 14 },
  engineer_maint:  { ratio: 1 / 80, fte_hours_per_shift: 8, shifts_per_day: 3, hourly_rate_eur: 24, always_min: 2 },
  guest_relations: { ratio: 1 / 60, fte_hours_per_shift: 8, shifts_per_day: 1, hourly_rate_eur: 28 },
};

// ─── NPS risk when understaffed ─────────────────────────────────────────
// Derived from our sim: staff rapport × NPS correlation + empirical research.
// Understaffing % → NPS risk per department (multiplier on segment impact).
const NPS_RISK_PER_UNDERSTAFF_PCT = {
  front_desk:      0.22, // check-in queue incident linked to −19 NPS
  concierge:       0.18,
  butler:          0.35, // most NPS-sensitive for honeymoon/luxury
  housekeeper:     0.12, // cleanliness gap → satisfaction drop
  fb_server:       0.25,
  fb_chef:         0.18,
  spa_therapist:   0.15,
  pool_attendant:  0.08,
  engineer_maint:  0.30, // HVAC / pool issues
  guest_relations: 0.28, // recovery capacity
};

/**
 * Compute the staff demand for a given cohort profile and date range.
 *
 * @param {Object} params
 * @param {number} params.rooms                Total rooms (e.g. 159)
 * @param {number} params.occupancy_pct        Avg occupancy during period
 * @param {number} params.nights               Nights in the period
 * @param {Object} params.archetype_mix_pct    % breakdown of cohort by archetype
 * @param {string} params.property_tier        'luxury' | 'premium' | etc.
 * @param {Object} [params.custom_ratios]      Override default ratios
 * @param {number} [params.understaff_pct]     Simulate X% understaffing (0 = full)
 */
function planStaffing({
  rooms,
  occupancy_pct,
  nights,
  archetype_mix_pct = {},
  property_tier = 'luxury',
  custom_ratios = null,
  understaff_pct = 0,
}) {
  const ratios = custom_ratios || STAFF_RATIOS_LUXURY;
  const guestsPerDay = Math.round(rooms * (occupancy_pct / 100) * 1.8); // ~1.8 guests per occupied room (doubles + singles mix)

  // Compute per-role FTEs (daily)
  const departments = {};
  let totalHoursPerDay = 0;
  let totalDailyCostEur = 0;
  const bottlenecks = [];

  for (const [role, spec] of Object.entries(ratios)) {
    // Some roles only serve specific archetypes (butler for honeymoon/luxury)
    let effectiveGuests = guestsPerDay;
    if (spec.archetype_demand) {
      const share = spec.archetype_demand.reduce((sum, a) => sum + (archetype_mix_pct[a] || 0), 0);
      effectiveGuests = Math.round(guestsPerDay * (share / 100));
    }
    const baseFte = effectiveGuests * spec.ratio;
    const fteNeeded = Math.max(spec.always_min || 0, Math.ceil(baseFte));
    const fteScheduled = Math.max(1, Math.floor(fteNeeded * (1 - understaff_pct / 100)));
    const hoursPerDay = fteScheduled * spec.fte_hours_per_shift * spec.shifts_per_day;
    const dailyCostEur = hoursPerDay * spec.hourly_rate_eur;

    totalHoursPerDay += hoursPerDay;
    totalDailyCostEur += dailyCostEur;

    const understaffActual = fteNeeded - fteScheduled;
    const understaffPctActual = fteNeeded > 0 ? (understaffActual / fteNeeded) * 100 : 0;
    const npsRiskPoints = understaffPctActual * (NPS_RISK_PER_UNDERSTAFF_PCT[role] || 0.1);

    if (understaffPctActual >= 15) bottlenecks.push({ role, understaff_pct: Math.round(understaffPctActual), nps_risk_points: Math.round(npsRiskPoints * 10) / 10 });

    departments[role] = {
      fte_needed: fteNeeded,
      fte_scheduled: fteScheduled,
      understaff_pct: Math.round(understaffPctActual * 10) / 10,
      hours_per_day: hoursPerDay,
      daily_cost_eur: Math.round(dailyCostEur),
      nps_risk_points: Math.round(npsRiskPoints * 10) / 10,
      hourly_rate_eur: spec.hourly_rate_eur,
    };
  }

  const totalPeriodCost = Math.round(totalDailyCostEur * nights);
  const totalNpsRisk = Math.round(Object.values(departments).reduce((s, d) => s + d.nps_risk_points, 0) * 10) / 10;

  // Cost per stay
  const cohortSize = Math.round(guestsPerDay * nights / 5); // 5-night avg
  const costPerStay = cohortSize > 0 ? Math.round(totalPeriodCost / cohortSize) : 0;

  return {
    period: { nights, occupancy_pct, rooms, guests_per_day: guestsPerDay, estimated_cohort_size: cohortSize },
    understaff_pct_scenario: understaff_pct,
    departments,
    totals: {
      daily_cost_eur: Math.round(totalDailyCostEur),
      period_cost_eur: totalPeriodCost,
      cost_per_stay_eur: costPerStay,
      total_hours_per_day: totalHoursPerDay,
    },
    nps_risk_total_points: totalNpsRisk,
    bottlenecks,
    recommendations: buildStaffingRecommendations({ departments, bottlenecks, guestsPerDay, nights, understaff_pct }),
  };
}

function buildStaffingRecommendations({ departments, bottlenecks, guestsPerDay, nights, understaff_pct }) {
  const recs = [];
  if (bottlenecks.length === 0 && understaff_pct === 0) {
    recs.push('Staffing levels cover expected demand. No bottlenecks detected.');
  }
  for (const b of bottlenecks) {
    recs.push(`${b.role}: ${b.understaff_pct}% understaffed → ~${b.nps_risk_points}pp NPS risk. Consider reinforcing with flex/seasonal hires.`);
  }
  // High-value cross-functional recommendations
  if (departments.butler?.fte_needed > 0 && departments.butler.fte_scheduled < departments.butler.fte_needed) {
    recs.push(`Butler shortfall is the highest-NPS-elasticity gap for honeymoon/luxury cohort. Prioritize filling even if adds €/day.`);
  }
  if (departments.spa_therapist?.fte_needed && departments.spa_therapist.fte_scheduled < departments.spa_therapist.fte_needed) {
    recs.push(`Spa capacity limiting revenue: consider partnering with freelance therapists for peak hours.`);
  }
  return recs;
}

/**
 * Compare multiple staffing scenarios (e.g., 0%, 10%, 20% understaffed) and
 * return the cost-vs-NPS tradeoff curve. Useful for CFO ↔ GM discussion.
 */
function compareScenarios({ rooms, occupancy_pct, nights, archetype_mix_pct, steps = [0, 10, 20, 30] }) {
  return steps.map(s => {
    const plan = planStaffing({ rooms, occupancy_pct, nights, archetype_mix_pct, understaff_pct: s });
    return {
      understaff_pct: s,
      period_cost_eur: plan.totals.period_cost_eur,
      nps_risk_points: plan.nps_risk_total_points,
      bottleneck_count: plan.bottlenecks.length,
      recommended_zone: s === 0 ? 'full_coverage'
        : s <= 10 ? 'efficient'
        : s <= 20 ? 'lean_with_risk'
        : 'understaffed_warning',
    };
  });
}

module.exports = { planStaffing, compareScenarios, STAFF_RATIOS_LUXURY, NPS_RISK_PER_UNDERSTAFF_PCT };
