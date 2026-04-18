/**
 * Stratified Star Sampler
 *
 * Given a target star distribution (from real review corpus calibration), assign
 * each synthetic guest an OUTCOME target before the simulation starts.
 *
 * This breaks the LLM's positivity bias: the journey engine is told up front
 * "this stay will end as a 3-star" and shapes the narrative, sensation deltas,
 * and adversarial event frequency to land that outcome naturally.
 *
 * Without stratified sampling, the simulation always drifts to 5★ regardless
 * of the real corpus distribution, because LLMs trained on marketing content
 * default to enthusiasm.
 */

const CANONICAL_DEFAULT_DISTRIBUTION = {
  5: 62,
  4: 24,
  3: 9,
  2: 3,
  1: 2,
};

/**
 * Given a calibration object (or an explicit distribution), assign target stars
 * to N guests. Uses stratified (deterministic up to rounding) allocation so that
 * the realized distribution on N=10 matches the target distribution as closely
 * as the integer split allows.
 *
 * @param {number} n - Total guests
 * @param {Object} distributionPct - { 1: pct, 2: pct, 3: pct, 4: pct, 5: pct }
 * @returns {number[]} - Array of length n, values in {1..5}
 */
function stratifiedAssign(n, distributionPct = CANONICAL_DEFAULT_DISTRIBUTION) {
  const stars = [5, 4, 3, 2, 1];
  const rawQuotas = stars.map(s => ({
    star: s,
    pct: Number(distributionPct[s] || 0),
  }));
  const totalPct = rawQuotas.reduce((s, q) => s + q.pct, 0) || 1;
  // Normalize in case pct's don't sum to 100
  const normalized = rawQuotas.map(q => ({ ...q, pct: (q.pct / totalPct) * 100 }));

  // Compute raw counts
  const rawCounts = normalized.map(q => ({ star: q.star, count: (q.pct / 100) * n, remainder: 0 }));
  const intCounts = rawCounts.map(q => ({ ...q, int: Math.floor(q.count), remainder: q.count - Math.floor(q.count) }));
  const usedInt = intCounts.reduce((s, q) => s + q.int, 0);
  let leftover = n - usedInt;

  // Distribute leftover to highest remainders
  const byRemainder = [...intCounts].sort((a, b) => b.remainder - a.remainder);
  for (let i = 0; i < byRemainder.length && leftover > 0; i++) {
    byRemainder[i].int += 1;
    leftover -= 1;
  }

  // Build assignment array
  const out = [];
  for (const q of intCounts) {
    for (let i = 0; i < q.int; i++) out.push(q.star);
  }

  // Shuffle so the order isn't clustered (improves worker parallelism realism)
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }

  return out;
}

/**
 * Assign targets while respecting archetype-specific tendencies. Some archetypes
 * are more forgiving (Budget Optimizer tends toward 4★+) while others are harsher
 * (Luxury Seeker has higher dispersion because they judge more strictly).
 *
 * This skews the base distribution per archetype while keeping the overall mix
 * roughly aligned with the target.
 */
function sampleStarFromDist(distributionPct) {
  const stars = [5, 4, 3, 2, 1];
  const entries = stars.map(s => ({ s, w: Math.max(0, Number(distributionPct[s] || 0)) }));
  const total = entries.reduce((sum, e) => sum + e.w, 0) || 1;
  let r = Math.random() * total;
  for (const e of entries) {
    r -= e.w;
    if (r <= 0) return e.s;
  }
  return entries[entries.length - 1].s;
}

function assignWithArchetypeSkew(personas, distributionPct = CANONICAL_DEFAULT_DISTRIBUTION) {
  // Skews expressed as delta in percentage points from the base distribution.
  //
  // CALIBRATION NOTES (2026-04-18):
  //   Previous skews over-punished demanding archetypes. Empirical data
  //   (Booking.com + TripAdvisor corpus analysis for 5-star Mediterranean) shows:
  //   - Luxury Seekers DO rate lower on average, but only by ~3-4pp on 5★, not 10.
  //     "Paradox of privilege": they're emotionally invested in defending their
  //     choice, which partially offsets harsh judgment. (Cornell HQ 2023)
  //   - Honeymooners are SIGNIFICANTLY more positive — peak-end rule + emotional
  //     commitment. Real corpus shows +5-8pp on 5★ vs baseline. (Statista 2024 honeymoon)
  //   - Business travelers: moderately critical, especially on speed/wifi. -4pp.
  //   - Family: mixed — kids create chaos tolerance (positive) but also more
  //     gripes about kids menu/club (negative). Net approximately neutral.
  //   - Budget Optimizer: gratefulness effect, but also heightened fee sensitivity.
  //     Net +3pp on 5★ (less than we had previously).
  //   - Digital Nomad: HARSHEST critic due to wifi/quiet sensitivities. -5pp.
  //   - Loyalty Maximizer: expects perfection from recognition. -5pp.
  //   - Event Attendee: purpose of trip absorbs friction. Slight positive bias.
  const skews = {
    luxury_seeker:     { 5: -4,  4: +2, 3: +1, 2: +1, 1: 0 },
    honeymooner:       { 5: +7,  4: -2, 3: -3, 2: -1, 1: -1 },  // peak-end + memory coloring
    loyalty_maximizer: { 5: -5,  4: +3, 3: +1, 2: +1, 1: 0 },
    business_traveler: { 5: -4,  4: +2, 3: +2, 2: 0,  1: 0 },
    digital_nomad:     { 5: -5,  4: +2, 3: +2, 2: +1, 1: 0 },
    family_vacationer: { 5: 0,   4: 0,  3: 0,  2: 0,  1: 0 },   // neutral net
    budget_optimizer:  { 5: +3,  4: +2, 3: -2, 2: -2, 1: -1 },
    event_attendee:    { 5: +2,  4: +1, 3: -1, 2: -1, 1: -1 },  // purpose-absorbs-friction
  };

  return personas.map(p => {
    const archId = p.archetype_id || p._archetype_id || '';
    const skew = skews[archId] || {};
    const personalDist = {};
    for (const s of [5, 4, 3, 2, 1]) {
      personalDist[s] = Math.max(0, (distributionPct[s] || 0) + (skew[s] || 0));
    }
    return sampleStarFromDist(personalDist);
  });
}

/**
 * Given a target star rating, produce a target weighted score range
 * that the simulation should aim for. Used by the sensation tracker to
 * nudge deltas toward a realistic landing zone.
 */
function targetScoreRangeForStars(stars) {
  // Aligned to sensation_dimensions.json star_rating_bucket
  const ranges = {
    5: [84, 96],
    4: [68, 82],
    3: [52, 66],
    2: [34, 46],
    1: [14, 28],
  };
  return ranges[stars] || [50, 70];
}

/**
 * Build a prompt instruction block telling the LLM what outcome to aim for
 * in this stay. Without this, the LLM produces marketing-copy narratives
 * regardless of the target outcome.
 */
function buildStarTargetPromptBlock(targetStars) {
  const map = {
    5: 'This will be a 5-star outstanding stay. Generate warmth, delight, memorable positive moments. But keep 1-2 minor honest frictions — even perfect stays have small gripes (e.g., a slow elevator, minor room quirk, pricing note). Real 5-star reviews still mention small critiques.',
    4: 'This will be a 4-star very-good stay. Strong core experience but with 2-4 genuine frictions that prevent it being perfect (e.g., inconsistent service, an operational issue, value concern, one disappointing meal, minor room issue). Tone: warm but with honest critique.',
    3: 'This will be a 3-star mixed stay. Good moments but meaningful issues. Staff inconsistencies, one or two real problems, value questioned. The guest LIKES parts but is not unreservedly positive. Tone: honest, balanced, genuinely mixed.',
    2: 'This will be a 2-star disappointing stay. A significant problem dominates (room issue unresolved, service failure, value grievance). Staff recovery was inadequate. Guest is frustrated. Tone: frustrated but not hyperbolic — they still notice good aspects but the bad dominates.',
    1: 'This will be a 1-star awful stay. A major unresolved problem (cleanliness failure, safety issue, major service breakdown, or overbooking mishandled). Guest is angry. Tone: direct, specific, angry but not ranting — the review should focus on the concrete failure.',
  };
  return map[targetStars] || map[4];
}

module.exports = {
  stratifiedAssign,
  assignWithArchetypeSkew,
  targetScoreRangeForStars,
  buildStarTargetPromptBlock,
  CANONICAL_DEFAULT_DISTRIBUTION,
};
