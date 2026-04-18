/**
 * Post-Stay Telling Loop — simulates the 3-14 day period between checkout and
 * review-writing, during which the guest RE-TELLS the story to partner,
 * friends, and social media. The narrative consolidates: some moments get
 * amplified through retelling, others fade, a few get dramatized.
 *
 * Empirical basis:
 *   - Bartlett (1932) and subsequent memory research: retelling reshapes the
 *     original memory. Each retelling is reconstructive.
 *   - Pennebaker (1997): talking about experiences with others reduces the
 *     emotional intensity of negatives and amplifies the identity-congruent
 *     positives.
 *   - Instagram/social feedback: moments that got "likes" or comments are
 *     remembered as more central; moments ignored fade.
 *
 * Output feeds review-predictor so the review reflects the CONSOLIDATED
 * narrative, not the raw in-stay experience.
 *
 * This is DETERMINISTIC (no LLM call). Keeps cost/latency flat.
 */

function clamp(n, min = 0, max = 3) { return Math.max(min, Math.min(max, n)); }

function pickN(arr, n) {
  const out = [];
  const pool = [...arr];
  for (let i = 0; i < n && pool.length; i++) {
    const idx = Math.floor(Math.random() * pool.length);
    out.push(pool.splice(idx, 1)[0]);
  }
  return out;
}

function emotionalIntensity(moment) {
  const desc = String(moment?.description || '').toLowerCase();
  let score = 1.0;
  // Strong emotion keywords that indicate a "story" moment (English + Spanish)
  const high = ['amazing', 'incredible', 'terrible', 'worst', 'best', 'magical', 'disgust', 'rude',
                'stunning', 'perfect', 'awful', 'horrible', 'increíble', 'horrible', 'maravill', 'pésim',
                'unforgettable', 'nightmare', 'dream', 'upset', 'furious', 'delighted'];
  for (const k of high) if (desc.includes(k)) { score += 0.6; break; }
  // Specific concrete detail — stories travel better with specifics
  if (/\b(chef|manager|concierge|waiter|butler|spa|pool|suite|view|balcony|terrace|infinity)\b/.test(desc)) score += 0.3;
  // Incident markers have built-in narrative weight
  if (desc.startsWith('[incident')) score += 0.5;
  return score;
}

/**
 * Simulate an IG/social-media post + reaction cycle.
 * Returns which moments got validated (→ amplified in retelling) and the
 * amplification magnitude.
 */
function simulateSocialValidation({ moments, womSocialPostMade, archetypeId, stars }) {
  if (!womSocialPostMade || moments.length === 0) return { validated: [], amplification: {} };

  // Instagram posts almost always highlight the 1-2 most photogenic moments
  const candidates = moments
    .map(m => ({ m, score: emotionalIntensity(m) + (/(view|pool|sunset|spa|terrace|aesthetic|breakfast|dessert)/i.test(m.description || '') ? 0.5 : 0) }))
    .sort((a, b) => b.score - a.score);

  const posted = candidates.slice(0, Math.min(2, candidates.length)).map(x => x.m);
  const amplification = {};
  const validated = [];

  // Engagement rate depends on archetype's social propensity and stars
  // honeymooner 5★ on IG gets ~60 likes; a 3★ budget_optimizer gets ~8
  const engagementMultiplier = (stars >= 5 ? 1.5 : stars >= 4 ? 1.0 : 0.5)
    * ({ honeymooner: 1.4, family_vacationer: 1.1, luxury_seeker: 1.2, event_attendee: 1.0 }[archetypeId] || 0.8);

  for (const m of posted) {
    const gotTraction = Math.random() < (0.55 * engagementMultiplier);
    if (gotTraction) {
      validated.push(m);
      amplification[m.description || ''] = 1.35; // +35% narrative weight
    }
  }
  return { validated, posted, amplification };
}

/**
 * Simulate retelling to partner/friends/colleagues. Each retelling:
 *   - Reinforces the 1-2 most emotionally charged moments (+15% each round)
 *   - Fades mundane moments (-10% each round)
 *   - Rarely DRAMATIZES a moment (narrative drift; becomes the anchor memory)
 */
function simulateRetellings({ moments, archetypeId, stars, daysUntilReview, hasPartner }) {
  const roundsPartner = hasPartner ? clamp(Math.floor(daysUntilReview / 2) + 1, 1, 3) : 0;
  const roundsFriends = clamp(Math.floor(daysUntilReview / 3), 0, 3);
  const roundsWork    = archetypeId === 'business_traveler' ? 0 : clamp(Math.floor(daysUntilReview / 5), 0, 2);
  const totalRounds = roundsPartner + roundsFriends + roundsWork;
  if (totalRounds === 0 || moments.length === 0) {
    return { rounds_total: 0, amplified: [], faded: [], dramatized: null, consolidation: {} };
  }

  // Rank moments by initial intensity
  const ranked = moments
    .map(m => ({ m, score: emotionalIntensity(m) }))
    .sort((a, b) => b.score - a.score);

  const consolidation = {}; // description -> weight multiplier
  const amplified = [];
  const faded = [];

  // Top 20% of moments get amplified each retelling round
  const topK = Math.max(1, Math.ceil(ranked.length * 0.2));
  for (const { m } of ranked.slice(0, topK)) {
    const mult = 1 + (totalRounds * 0.12); // 3 rounds → +36%
    consolidation[m.description || ''] = mult;
    amplified.push({ description: m.description, consolidation_mult: Math.round(mult * 100) / 100 });
  }

  // Bottom 40% fade
  const bottomK = Math.floor(ranked.length * 0.4);
  for (const { m } of ranked.slice(-bottomK)) {
    const mult = Math.max(0.4, 1 - (totalRounds * 0.08));
    consolidation[m.description || ''] = Math.min(consolidation[m.description || ''] || 1, mult);
    faded.push({ description: m.description, consolidation_mult: Math.round(mult * 100) / 100 });
  }

  // Narrative drift: ~15% chance a single moment becomes dramatized
  // (stronger version than reality). Most common with honeymooners and
  // family_vacationers (story culture). Never for business_traveler.
  let dramatized = null;
  const dramaProb = { honeymooner: 0.25, family_vacationer: 0.20, luxury_seeker: 0.18, event_attendee: 0.15 }[archetypeId] ?? 0.10;
  if (archetypeId !== 'business_traveler' && Math.random() < dramaProb && ranked.length >= 2) {
    const pick = ranked[Math.floor(Math.random() * Math.min(3, ranked.length))];
    const dramaMult = 1.5 + Math.random() * 0.4;
    consolidation[pick.m.description || ''] = Math.max(consolidation[pick.m.description || ''] || 1, dramaMult);
    dramatized = { description: pick.m.description, consolidation_mult: Math.round(dramaMult * 100) / 100 };
  }

  return {
    rounds_total: totalRounds,
    rounds_partner: roundsPartner,
    rounds_friends: roundsFriends,
    rounds_work: roundsWork,
    amplified,
    faded,
    dramatized,
    consolidation,
  };
}

/**
 * Compute the SHIFT between raw in-stay memory and post-telling consolidated
 * narrative. This shift is what the review reflects.
 *
 * @param {Object} params
 * @param {Array} params.positiveMoments
 * @param {Array} params.negativeMoments
 * @param {Object} params.postStay          output of post-stay-journey.runPostStay
 * @param {Object} params.persona           enriched persona
 * @param {string} params.archetypeId
 * @param {number} params.stars
 * @returns {Object} telling_arc block for review-predictor consumption.
 */
function generateTellingArc({ positiveMoments = [], negativeMoments = [], postStay = {}, persona = {}, archetypeId, stars = 3 }) {
  const daysUntilReview = postStay?.review_delay?.days_until_review_written ?? 5;
  const womSocialPostMade = !!postStay?.word_of_mouth?.social_post_made;
  const hasPartner = !!persona?.life_context?.relationship_length_years
    || ['honeymooner', 'family_vacationer'].includes(archetypeId);

  // Positive moments: both retelling and social amplification apply
  const posRetell = simulateRetellings({ moments: positiveMoments, archetypeId, stars, daysUntilReview, hasPartner });
  const posSocial = simulateSocialValidation({ moments: positiveMoments, womSocialPostMade, archetypeId, stars });

  // Negatives: retelling amplifies the "story" ones (incident, rudeness) but
  // also fades after partner processing. Social rarely posts negatives.
  const negRetell = simulateRetellings({ moments: negativeMoments, archetypeId, stars, daysUntilReview, hasPartner });

  // Build a single lookup by description → consolidation multiplier (for review-predictor)
  const consolidation_multipliers = { ...posRetell.consolidation, ...negRetell.consolidation };
  for (const [desc, mult] of Object.entries(posSocial.amplification || {})) {
    consolidation_multipliers[desc] = Math.max(consolidation_multipliers[desc] || 1, mult);
  }

  // Choose the dominant "anchor moment" — what this stay is ABOUT in the
  // guest's head by the time they write the review.
  let anchor = null;
  const amplifiedPool = [
    ...posRetell.amplified.map(x => ({ ...x, kind: 'positive' })),
    ...(posRetell.dramatized ? [{ ...posRetell.dramatized, kind: 'positive', dramatized: true }] : []),
    ...negRetell.amplified.map(x => ({ ...x, kind: 'negative' })),
    ...(negRetell.dramatized ? [{ ...negRetell.dramatized, kind: 'negative', dramatized: true }] : []),
  ].sort((a, b) => (b.consolidation_mult || 0) - (a.consolidation_mult || 0));
  if (amplifiedPool.length > 0) anchor = amplifiedPool[0];

  // One-line summary useful for the review prompt
  const summaryLines = [];
  summaryLines.push(`Over ${daysUntilReview} day(s), the guest retold this stay ${posRetell.rounds_total + negRetell.rounds_total} time(s) total${hasPartner ? ' including to their partner' : ''}${womSocialPostMade ? ' and posted to social media' : ''}.`);
  if (anchor) {
    const label = anchor.dramatized ? 'DRAMATIZED' : (anchor.consolidation_mult >= 1.3 ? 'AMPLIFIED' : 'faded');
    summaryLines.push(`Anchor memory (${label}, ×${anchor.consolidation_mult} weight): ${anchor.kind} — "${String(anchor.description || '').slice(0, 140)}".`);
  }
  if (posSocial.posted?.length) {
    summaryLines.push(`Social-posted moments: ${posSocial.posted.map(m => `"${String(m.description || '').slice(0, 60)}"`).join('; ')}.`);
  }

  return {
    days_until_review_written: daysUntilReview,
    retelling_rounds_total: posRetell.rounds_total + negRetell.rounds_total,
    had_partner_to_tell: hasPartner,
    social_post_made: womSocialPostMade,
    positive_consolidation: posRetell,
    negative_consolidation: negRetell,
    social_validation: posSocial,
    consolidation_multipliers,
    anchor_moment: anchor,
    narrative_consolidation_summary: summaryLines.join(' '),
  };
}

module.exports = { generateTellingArc, emotionalIntensity };
