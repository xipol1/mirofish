/**
 * Post-Stay Journey
 *
 * Models what happens after physical departure:
 *   - checkout experience (express / full / delayed / disputed)
 *   - billing accuracy and disputes
 *   - departure transport arrangement quality
 *   - pre-departure gesture (picnic, gift, farewell)
 *   - post-stay email timing and personalization
 *   - review writing delay in days (reviews written at day 1 are different
 *     from day 14 — emotion stabilizes, some issues loom larger, others fade)
 *   - word-of-mouth amplification (shared with friends, social media, blog)
 *   - loyalty points crediting speed
 *   - likelihood of returning with stated offer
 *
 * Critical insight: the review is written POST-STAY, not at checkout. Our old
 * model simulated only the in-stay experience. Real-world: reviewers have 3-14
 * days for emotions to settle. This module models that decay/amplification.
 */

const { generateTellingArc } = require('./post-stay-telling');

function clamp(n, min = -100, max = 100) { return Math.max(min, Math.min(max, n)); }

/**
 * Sample the checkout experience parameters.
 */
function sampleCheckoutExperience({ cultureCluster = null, archetypeId = null, stayIncidents = 0 } = {}) {
  // Archetype preferences for checkout style
  const stylePref = {
    business_traveler: ['express_mobile', 'express_mobile', 'front_desk_quick'],
    budget_optimizer: ['front_desk_quick', 'front_desk_full', 'express_mobile'],
    luxury_seeker: ['front_desk_full', 'bell_service', 'express_mobile'],
    honeymooner: ['front_desk_full', 'bell_service'],
    loyalty_maximizer: ['express_mobile', 'front_desk_quick'],
    digital_nomad: ['express_mobile', 'express_mobile', 'front_desk_quick'],
    family_vacationer: ['front_desk_full', 'bell_service'],
    event_attendee: ['group_billing', 'front_desk_quick'],
  };
  const styles = stylePref[archetypeId] || ['front_desk_full', 'express_mobile'];
  const style = styles[Math.floor(Math.random() * styles.length)];

  // Bill accuracy: drops if there were many incidents during stay
  const hadIncidents = stayIncidents > 1;
  const billDisputeProb = hadIncidents ? 0.35 : 0.08;
  const hadBillDispute = Math.random() < billDisputeProb;

  // Duration
  const duration = {
    express_mobile: 1,
    front_desk_quick: 4,
    front_desk_full: 12,
    bell_service: 10,
    group_billing: 18,
  }[style] || 10;
  const actualDuration = duration + (hadBillDispute ? Math.floor(Math.random() * 20) + 10 : Math.floor(Math.random() * 4));

  return {
    checkout_style: style,
    checkout_duration_minutes: actualDuration,
    had_bill_dispute: hadBillDispute,
    dispute_resolved: hadBillDispute ? Math.random() < 0.75 : null,
    dispute_amount_eur: hadBillDispute ? Math.floor(Math.random() * 80) + 15 : 0,
  };
}

/**
 * Sample departure transport and pre-departure gesture.
 */
function sampleDepartureContext({ bookingContext = {}, archetypeId = null } = {}) {
  const preBookedTransfer = (bookingContext.pre_booked_upsells || []).includes('airport_transfer');

  let arranged;
  if (preBookedTransfer) arranged = 'pre_booked_private_transfer';
  else {
    const options = ['own_car', 'taxi', 'shared_shuttle', 'rental_return', 'private_driver_booked_at_desk'];
    arranged = options[Math.floor(Math.random() * options.length)];
  }

  // Pre-departure amenity (proactive gesture at the end)
  const gestureProb = {
    luxury_seeker: 0.55,
    honeymooner: 0.60,
    loyalty_maximizer: 0.50,
    family_vacationer: 0.20,
    event_attendee: 0.15,
    business_traveler: 0.10,
    digital_nomad: 0.08,
    budget_optimizer: 0.05,
  }[archetypeId] || 0.2;

  const gesture_offered = Math.random() < gestureProb;
  const gestureTypes = ['picnic_box_for_airport', 'farewell_gift_local_product', 'handwritten_note', 'champagne_on_departure', 'return_offer_card'];
  const gesture_type = gesture_offered ? gestureTypes[Math.floor(Math.random() * gestureTypes.length)] : null;

  return {
    transport_arranged: arranged,
    transport_pre_booked: preBookedTransfer,
    departure_gesture_offered: gesture_offered,
    departure_gesture_type: gesture_type,
  };
}

/**
 * Post-stay email: timing and personalization.
 */
function samplePostStayEmail({ cultureCluster = null, bookingContext = {} } = {}) {
  // Channels with loyalty recognition send more personalized emails
  const hasLoyalty = bookingContext.loyalty_recognition_expected;
  const daysUntilEmail = hasLoyalty
    ? Math.floor(Math.random() * 3) + 1  // 1-3 days for loyal
    : Math.floor(Math.random() * 7) + 2; // 2-8 days for transient

  const personalizationLevel = hasLoyalty
    ? (Math.random() < 0.55 ? 'highly_personalized' : 'moderately_personalized')
    : (Math.random() < 0.3 ? 'moderately_personalized' : 'generic_template');

  const includesReviewCTA = Math.random() < 0.8;
  const includesReturnOffer = hasLoyalty ? Math.random() < 0.4 : Math.random() < 0.15;

  return {
    post_stay_email_sent: true,
    days_until_email: daysUntilEmail,
    email_personalization: personalizationLevel,
    includes_review_cta: includesReviewCTA,
    includes_return_offer: includesReturnOffer,
  };
}

/**
 * Review writing delay. Reviews written at day 1 vs day 14 have different
 * emotional weight. This function ALSO applies a delay-based emotional
 * correction to the predicted NPS/star rating.
 */
function sampleReviewDelayAndCorrection({ culturalContext = null, archetypeId = null, postStayEmail = null, stayNPS = 0 }) {
  // Review writing probability already determined upstream; this models WHEN
  const archetypeDelay = {
    business_traveler: [1, 3],
    budget_optimizer: [1, 4],
    luxury_seeker: [3, 10],
    honeymooner: [7, 21],
    family_vacationer: [3, 14],
    event_attendee: [2, 7],
    loyalty_maximizer: [1, 3],
    digital_nomad: [5, 14],
  };
  const [minD, maxD] = archetypeDelay[archetypeId] || [2, 10];
  // Delay is shorter if a review CTA was received
  const emailBoost = postStayEmail?.includes_review_cta ? -2 : 0;
  const days_until_review_written = Math.max(0, Math.floor(Math.random() * (maxD - minD + 1)) + minD + emailBoost);

  // Emotional correction: over time, moderate experiences stabilize to mean.
  // Extreme positives fade; extreme negatives fade slower (negativity bias).
  let nps_correction = 0;
  if (stayNPS > 50) {
    // Positive experiences: slight cooling over time
    nps_correction = -Math.min(15, days_until_review_written * 1.5);
  } else if (stayNPS < -20) {
    // Negative experiences: some cooling but less — negativity bias
    nps_correction = Math.min(8, days_until_review_written * 0.8);
  } else {
    // Neutral/mixed: drift toward middle
    nps_correction = stayNPS > 0 ? -2 : 2;
  }

  // If cultural complaint_style is 'rarely_complain_but_never_return',
  // written review is harsher than in-person indicated
  if (culturalContext?.complaint_style === 'rarely_complain_but_never_return') {
    nps_correction -= 10;
  }
  // 'reserved_then_public_review' also harsher in writing
  if (culturalContext?.complaint_style === 'reserved_then_public_review') {
    nps_correction -= 5;
  }

  return {
    days_until_review_written,
    post_stay_nps_correction: Math.round(nps_correction),
    corrected_nps: Math.round(clamp(stayNPS + nps_correction, -100, 100)),
  };
}

/**
 * Word-of-mouth amplification: did the guest tell friends? Social post? Blog?
 */
function sampleWordOfMouth({ stayStars = 3, archetypeId = null, bookingContext = {} } = {}) {
  // Probability of sharing with friends/family
  const shareBaseProb = stayStars >= 5 ? 0.85 : stayStars >= 4 ? 0.55 : stayStars >= 3 ? 0.25 : stayStars >= 2 ? 0.3 : 0.5; // bad experiences also get shared
  const sharePositive = stayStars >= 4;

  const archetypeSocialBias = {
    honeymooner: 0.7,
    family_vacationer: 0.5,
    event_attendee: 0.55,
    luxury_seeker: 0.45,
    digital_nomad: 0.4,
    budget_optimizer: 0.3,
    business_traveler: 0.15,
    loyalty_maximizer: 0.2,
  };
  const socialBias = archetypeSocialBias[archetypeId] || 0.3;

  const shared_with_friends = Math.random() < shareBaseProb;
  const social_post_made = shared_with_friends && Math.random() < socialBias;
  const instagram_post = social_post_made && Math.random() < 0.6;
  const tiktok_post = social_post_made && Math.random() < 0.25;
  const xiaohongshu_post = socialBias > 0.3 && Math.random() < 0.05;

  const amplification_count_estimated = shared_with_friends
    ? Math.floor((sharePositive ? 3 : 6) * (social_post_made ? 15 : 1) * (1 + Math.random()))
    : 0;

  return {
    shared_with_friends,
    shared_sentiment: sharePositive ? 'positive' : 'negative',
    social_post_made,
    platforms_posted: [
      instagram_post ? 'instagram' : null,
      tiktok_post ? 'tiktok' : null,
      xiaohongshu_post ? 'xiaohongshu' : null,
    ].filter(Boolean),
    amplification_count_estimated,
  };
}

/**
 * Loyalty points crediting
 */
function sampleLoyaltyCrediting({ bookingContext = {} }) {
  if (!bookingContext.loyalty_recognition_expected) {
    return { loyalty_points_earned: 0, points_credited_days: null, tier_progress_visible: false };
  }
  const points = Math.floor((bookingContext.room_rate_paid_eur || 300) * 5 * (1 + Math.random() * 0.2));
  const credited_days = Math.floor(Math.random() * 5) + 1;
  return {
    loyalty_points_earned: points,
    points_credited_days: credited_days,
    tier_progress_visible: credited_days <= 3,
  };
}

/**
 * Return visit intent: given everything above, will they come back?
 */
function sampleReturnIntent({ correctedNps = 0, archetypeId = null, bookingContext = {}, departureContext = {} }) {
  let baseIntent = 0;
  if (correctedNps >= 50) baseIntent = 0.8;
  else if (correctedNps >= 20) baseIntent = 0.55;
  else if (correctedNps >= 0) baseIntent = 0.35;
  else if (correctedNps >= -30) baseIntent = 0.15;
  else baseIntent = 0.05;

  // Archetype loyalty propensity
  const archLoyalty = {
    loyalty_maximizer: 0.2,
    luxury_seeker: 0.1,
    honeymooner: -0.15, // honeymoon is once
    family_vacationer: 0.15,
    business_traveler: 0.1,
    digital_nomad: 0.05,
    budget_optimizer: -0.1,
    event_attendee: -0.2,
  };
  baseIntent += (archLoyalty[archetypeId] || 0);

  // Departure gesture boosts intent
  if (departureContext.departure_gesture_offered) baseIntent += 0.1;

  baseIntent = Math.max(0, Math.min(1, baseIntent));

  return {
    return_intent_12m_probability: Math.round(baseIntent * 100) / 100,
    would_book_same_hotel_again: baseIntent > 0.35,
    would_book_same_brand_different_property: baseIntent > 0.25,
  };
}

/**
 * Orchestrate the full post-stay module. Called AFTER runStay completes.
 */
function runPostStay({ stay, persona, culturalContext, bookingContext, archetypeId }) {
  const nps = stay.sensation_summary?.nps ?? 0;
  const stars = stay.sensation_summary?.stars ?? 3;
  const stayIncidents = (stay.adversarial_events || []).length;

  const checkout = sampleCheckoutExperience({ cultureCluster: culturalContext?.culture_cluster, archetypeId, stayIncidents });
  const departure = sampleDepartureContext({ bookingContext, archetypeId });
  const email = samplePostStayEmail({ cultureCluster: culturalContext?.culture_cluster, bookingContext });
  const reviewDelay = sampleReviewDelayAndCorrection({ culturalContext, archetypeId, postStayEmail: email, stayNPS: nps });
  const wom = sampleWordOfMouth({ stayStars: stars, archetypeId, bookingContext });
  const loyalty = sampleLoyaltyCrediting({ bookingContext });
  const returnIntent = sampleReturnIntent({ correctedNps: reviewDelay.corrected_nps, archetypeId, bookingContext, departureContext: departure });

  // Post-stay telling loop — simulates 3-14 days of retelling to partner,
  // friends, colleagues, + social media posts. The narrative consolidates;
  // some moments amplify, others fade, rarely one dramatizes. The review
  // writer reads this, not the raw in-stay memory.
  const tellingArc = generateTellingArc({
    positiveMoments: stay.moments_positive || stay.sensation_summary?.moments?.positive || [],
    negativeMoments: stay.moments_negative || stay.sensation_summary?.moments?.negative || [],
    postStay: { review_delay: reviewDelay, word_of_mouth: wom },
    persona,
    archetypeId,
    stars,
  });

  return {
    checkout,
    departure,
    post_stay_email: email,
    review_delay: reviewDelay,
    word_of_mouth: wom,
    loyalty_crediting: loyalty,
    return_intent: returnIntent,
    telling_arc: tellingArc,
    corrected_final_nps: reviewDelay.corrected_nps,
    raw_in_stay_nps: nps,
    nps_delta_from_in_stay: reviewDelay.corrected_nps - nps,
  };
}

module.exports = { runPostStay };
