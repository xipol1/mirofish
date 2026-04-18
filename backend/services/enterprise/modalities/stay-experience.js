/**
 * Modality: Stay Experience
 *
 * The "what we had before". Full hotel stay simulation: arrival → room →
 * F&B → amenities → checkout, with post-stay review writing, word-of-mouth,
 * return intent.
 *
 * Best for: hospitality operators wanting to understand guest satisfaction,
 * NPS drivers, friction points, ancillary revenue patterns per segment.
 */

const { runStay } = require('../guest-journey');
const { predictReview } = require('../review-predictor');
const culturalProfiles = require('../cultural-profiles');
const bookingContextSvc = require('../booking-context');
const externalContextSvc = require('../external-context');
const starSampler = require('../star-sampler');
const personaEnricher = require('../persona-enricher');

const REQUIRED = ['property', 'audience'];
const OPTIONAL = [
  'agent_count', 'stay_length_nights', 'calibration',
  'season', 'weather_array', 'local_events', 'occupancy_pct',
  'property_country', 'origin_mix_override', 'market_pack_ids',
];

function validateInputs(raw) {
  const errors = [];
  if (!raw.property || !raw.property.name) errors.push('property.name is required');
  if (!raw.audience) errors.push('audience is required');
  return { ok: errors.length === 0, errors, normalized: raw };
}

function buildAgentContext({ persona, globalCtx, targetStars }) {
  const archetypeId = persona.archetype_id || persona._archetype_id || 'business_traveler';
  const propertyTier = globalCtx.property?.data_json?.identity?.tier || globalCtx.property?.tier || 'luxury';

  const clusterId = globalCtx.origin_mix_override
    ? sampleFromMix(globalCtx.origin_mix_override)
    : culturalProfiles.sampleClusterForMenorca();
  const cultural_context = culturalProfiles.buildCulturalContext({
    clusterId,
    propertyCountry: globalCtx.property_country || 'ES',
  });

  const booking_context = bookingContextSvc.sampleBookingContext({
    archetypeId,
    propertyTier,
  });

  // Per-agent stay length (could be overridden)
  const behavior = require('../narrative-engine').getArchetypeBehavior(archetypeId);
  const lenRange = behavior?.typical_stay_length_nights || [2, 4];
  const stay_length_nights = globalCtx.stay_length_nights
    || (Math.floor(Math.random() * (lenRange[1] - lenRange[0] + 1)) + lenRange[0]);

  const external_context = externalContextSvc.buildExternalContext({
    season: globalCtx.season || 'mid',
    nights: stay_length_nights,
    weather_array: globalCtx.weather_array,
    local_events: globalCtx.local_events,
    occupancy_pct: globalCtx.occupancy_pct,
  });

  return {
    archetype_id: archetypeId,
    cultural_context,
    booking_context,
    external_context,
    stay_length_nights,
    trip_purpose: inferTripPurpose(persona),
    target_star_rating: targetStars,
  };
}

async function runForAgent({ persona, agentCtx, globalCtx, onStage }) {
  // Enrich the persona with psychographics, consumption, room prefs, travel
  // history, review behavior, life context, and financial behavior.
  const enrichedPersona = personaEnricher.enrich({
    persona,
    culturalContext: agentCtx.cultural_context,
    bookingContext: agentCtx.booking_context,
  });

  const stay = await runStay({
    persona: enrichedPersona,
    property: globalCtx.property,
    calibration: globalCtx.calibration || {},
    stay_length_nights: agentCtx.stay_length_nights,
    trip_purpose: agentCtx.trip_purpose,
    arrival_context: {},
    target_star_rating: agentCtx.target_star_rating,
    cultural_context: agentCtx.cultural_context,
    booking_context: agentCtx.booking_context,
    external_context: agentCtx.external_context,
    onStage,
  });

  const predictedReview = await predictReview({
    stay,
    persona: enrichedPersona,
    property: globalCtx.property,
    cultural_context: agentCtx.cultural_context,
  });

  return {
    ...stay,
    persona_full: enrichedPersona,
    predicted_review: predictedReview,
    total_spend_eur: stay.expense_summary?.total_spend_eur || 0,
    property_id: globalCtx.property?.id || null,
    property_name: globalCtx.property?.name || null,
  };
}

function aggregateResults(agentRecords, globalCtx) {
  const valid = agentRecords.filter(s => s && !s.error);
  const n = valid.length;
  if (n === 0) {
    return {
      modality: 'stay_experience',
      total_stays: 0,
      avg_stars: null, avg_nps: null, avg_spend_eur: null,
    };
  }

  const avgStars = valid.reduce((s, x) => s + (x.sensation_summary?.stars || 0), 0) / n;
  const avgNps = valid.reduce((s, x) => s + (x.sensation_summary?.nps ?? 0), 0) / n;
  const avgSpend = valid.reduce((s, x) => s + (x.expense_summary?.total_spend_eur || 0), 0) / n;
  const willReview = valid.filter(x => x.predicted_review?.will_write_review).length;
  const wouldRepeat = valid.filter(x => x.predicted_review?.would_repeat).length;
  const wouldRecommend = valid.filter(x => x.predicted_review?.would_recommend).length;

  // Star distribution
  const starDist = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  for (const s of valid) {
    const st = s.sensation_summary?.stars;
    if (st >= 1 && st <= 5) starDist[st]++;
  }
  const starDistPct = Object.fromEntries(
    Object.entries(starDist).map(([k, v]) => [k, Math.round((v / n) * 1000) / 10])
  );

  const targetHit = valid.filter(s => s.target_star_rating && s.sensation_summary?.stars === s.target_star_rating).length;

  // Adversarial events
  const eventsSummary = {};
  for (const s of valid) {
    for (const ev of (s.adversarial_events || [])) {
      eventsSummary[ev.event_id] = (eventsSummary[ev.event_id] || 0) + 1;
    }
  }

  // Platform + theme mix
  const platformMix = {};
  const themeCounts = {};
  for (const s of valid) {
    const pr = s.predicted_review;
    if (pr?.platform) platformMix[pr.platform] = (platformMix[pr.platform] || 0) + 1;
    for (const theme of (pr?.themes || [])) themeCounts[theme] = (themeCounts[theme] || 0) + 1;
  }

  const promoters = valid.filter(x => (x.sensation_summary?.nps ?? 0) >= 50).length;
  const detractors = valid.filter(x => (x.sensation_summary?.nps ?? 0) < 0).length;
  const netPromoterScore = Math.round(((promoters - detractors) / n) * 100);

  // Spend by category
  const spendByCategory = {};
  for (const s of valid) {
    for (const [cat, val] of Object.entries(s.expense_summary?.by_category || {})) {
      spendByCategory[cat] = (spendByCategory[cat] || 0) + val;
    }
  }
  for (const k of Object.keys(spendByCategory)) {
    spendByCategory[k] = Math.round((spendByCategory[k] / n) * 100) / 100;
  }

  // Tier 0 aggregations
  const cultureDist = {}, channelDist = {}, priceTierDist = {}, checkoutStyleDist = {};
  const postStayNpsDeltas = [], reviewWriteDelays = [], returnIntentProbs = [];
  let loyaltyRecognitionExpectedCount = 0, womSocialPostCount = 0, womSharedCount = 0;
  let checkoutDisputeCount = 0, departureGestureCount = 0;

  for (const s of valid) {
    if (s.cultural_context?.culture_cluster) cultureDist[s.cultural_context.culture_cluster] = (cultureDist[s.cultural_context.culture_cluster] || 0) + 1;
    if (s.booking_context?.booking_channel) channelDist[s.booking_context.booking_channel] = (channelDist[s.booking_context.booking_channel] || 0) + 1;
    if (s.booking_context?.price_tier) priceTierDist[s.booking_context.price_tier] = (priceTierDist[s.booking_context.price_tier] || 0) + 1;
    if (s.booking_context?.loyalty_recognition_expected) loyaltyRecognitionExpectedCount++;

    const ps = s.post_stay;
    if (ps) {
      if (ps.checkout?.checkout_style) checkoutStyleDist[ps.checkout.checkout_style] = (checkoutStyleDist[ps.checkout.checkout_style] || 0) + 1;
      if (ps.checkout?.had_bill_dispute) checkoutDisputeCount++;
      if (ps.departure?.departure_gesture_offered) departureGestureCount++;
      if (ps.word_of_mouth?.shared_with_friends) womSharedCount++;
      if (ps.word_of_mouth?.social_post_made) womSocialPostCount++;
      if (typeof ps.nps_delta_from_in_stay === 'number') postStayNpsDeltas.push(ps.nps_delta_from_in_stay);
      if (typeof ps.review_delay?.days_until_review_written === 'number') reviewWriteDelays.push(ps.review_delay.days_until_review_written);
      if (typeof ps.return_intent?.return_intent_12m_probability === 'number') returnIntentProbs.push(ps.return_intent.return_intent_12m_probability);
    }
  }

  const avg = (arr) => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null;
  const avgPostStayNpsDelta = avg(postStayNpsDeltas);
  const avgReviewWriteDelay = avg(reviewWriteDelays);
  const avgReturnIntent = avg(returnIntentProbs);
  const avgAdr = valid.reduce((s, x) => s + (x.booking_context?.room_rate_paid_eur || 0), 0) / n;

  const avgStaffRapport = valid.length ? (
    valid.reduce((s, x) => {
      const ents = x.staff_registry || [];
      if (ents.length === 0) return s;
      return s + (ents.reduce((a, e) => a + (e.rapport_score || 0), 0) / ents.length);
    }, 0) / valid.length
  ) : 0;

  return {
    modality: 'stay_experience',
    total_stays: n,
    avg_stars: Math.round(avgStars * 10) / 10,
    avg_nps: Math.round(avgNps),
    net_promoter_score: netPromoterScore,
    avg_spend_eur: Math.round(avgSpend * 100) / 100,
    avg_spend_by_category: spendByCategory,
    would_repeat_pct: Math.round((wouldRepeat / n) * 100),
    would_recommend_pct: Math.round((wouldRecommend / n) * 100),
    reviews_generated: willReview,
    predicted_review_platform_mix: platformMix,
    top_predicted_themes: Object.entries(themeCounts).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([theme, count]) => ({ theme, count })),
    realized_star_distribution: starDist,
    realized_star_distribution_pct: starDistPct,
    target_star_match_rate_pct: valid.length ? Math.round((targetHit / valid.length) * 100) : null,
    adversarial_events_triggered: eventsSummary,
    adversarial_events_total: Object.values(eventsSummary).reduce((a, b) => a + b, 0),
    avg_room_rate_paid_eur: Math.round(avgAdr),
    culture_distribution: cultureDist,
    booking_channel_distribution: channelDist,
    price_tier_distribution: priceTierDist,
    loyalty_recognition_expected_pct: Math.round((loyaltyRecognitionExpectedCount / n) * 100),
    post_stay: {
      checkout_style_distribution: checkoutStyleDist,
      checkout_bill_dispute_pct: Math.round((checkoutDisputeCount / n) * 100),
      departure_gesture_offered_pct: Math.round((departureGestureCount / n) * 100),
      avg_post_stay_nps_delta: avgPostStayNpsDelta != null ? Math.round(avgPostStayNpsDelta) : null,
      avg_review_write_delay_days: avgReviewWriteDelay != null ? Math.round(avgReviewWriteDelay * 10) / 10 : null,
      avg_return_intent_12m: avgReturnIntent != null ? Math.round(avgReturnIntent * 100) / 100 : null,
      word_of_mouth_shared_pct: Math.round((womSharedCount / n) * 100),
      word_of_mouth_social_post_pct: Math.round((womSocialPostCount / n) * 100),
    },
    avg_staff_rapport: Math.round(avgStaffRapport * 10) / 10,
  };
}

// ─── Helpers ──
function sampleFromMix(mixPct) {
  const entries = Object.entries(mixPct);
  const total = entries.reduce((s, [, v]) => s + v, 0) || 100;
  let r = Math.random() * total;
  for (const [k, v] of entries) { r -= v; if (r <= 0) return k; }
  return entries[0][0];
}
function inferTripPurpose(persona) {
  const arch = persona.archetype_id || persona._archetype_id;
  const map = {
    business_traveler: 'business', family_vacationer: 'leisure_family', luxury_seeker: 'leisure_couples',
    honeymooner: 'leisure_couples', digital_nomad: 'remote_work', budget_optimizer: 'leisure_solo',
    loyalty_maximizer: 'business', event_attendee: 'event',
  };
  return map[arch] || 'leisure_solo';
}

/**
 * Target star assignment is part of the orchestrator (stratified sampling),
 * but this modality exposes the helper so the orchestrator can delegate when
 * needed.
 */
function assignTargetStars(personas, calibration) {
  const targetDist = calibration?.star_distribution_pct || starSampler.CANONICAL_DEFAULT_DISTRIBUTION;
  return starSampler.assignWithArchetypeSkew(personas, targetDist);
}

module.exports = {
  id: 'stay_experience',
  label: 'Stay Experience',
  description: 'Full hotel stay simulation (arrival to post-stay review). Best for measuring NPS, friction points, ancillary revenue, and segment differences.',
  required_inputs: REQUIRED,
  optional_inputs: OPTIONAL,
  uses_target_star_sampling: true,

  validateInputs,
  buildAgentContext,
  runForAgent,
  aggregateResults,
  assignTargetStars,
};
