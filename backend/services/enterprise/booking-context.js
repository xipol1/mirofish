/**
 * Booking Context Module
 *
 * Computes the expectation-shaping context from: room rate paid, booking channel,
 * rate plan, lead time, pre-booked upsells. Returns:
 *   - A sensation baseline modifier dict (applied on top of archetype baseline)
 *   - An expectation_pressure_multiplier (shifts delta magnitudes)
 *   - A narrative prompt block describing the booking context
 *
 * Design principle: a guest who paid €800/night expects dramatically more than one
 * who paid €220. Skipping this makes the whole value dimension float.
 */

const path = require('path');
const fs = require('fs');

const CTX_PATH = path.join(__dirname, '..', '..', 'data', 'industries', 'hospitality', 'booking_context.json');
let _cfg = null;
function getConfig() {
  if (_cfg) return _cfg;
  _cfg = JSON.parse(fs.readFileSync(CTX_PATH, 'utf-8'));
  return _cfg;
}

function getPriceTier(roomRateEur) {
  const tiers = getConfig().price_anchor_cents;
  const order = ['economy', 'upscale', 'premium', 'luxury', 'ultra_luxury'];
  for (const key of order) {
    if (roomRateEur <= tiers[key].rate_max_eur) return { key, ...tiers[key] };
  }
  return { key: 'ultra_luxury', ...tiers.ultra_luxury };
}

function getLeadTimeSegment(daysOut) {
  const segs = getConfig().lead_time_segments;
  const order = ['last_minute', 'short', 'medium', 'long', 'very_long'];
  for (const key of order) {
    if (daysOut <= segs[key].days_max) return { key, ...segs[key] };
  }
  return { key: 'very_long', ...segs.very_long };
}

function mergeModifiers(...mods) {
  const out = {};
  for (const m of mods) {
    if (!m) continue;
    for (const [k, v] of Object.entries(m)) {
      if (typeof v === 'number') out[k] = (out[k] || 0) + v;
    }
  }
  return out;
}

function pickRandomChannel() {
  const cs = getConfig().channels;
  const entries = Object.entries(cs);
  const total = entries.reduce((s, [, v]) => s + (v.typical_share_pct || 0), 0) || 100;
  let r = Math.random() * total;
  for (const [k, v] of entries) {
    r -= v.typical_share_pct || 0;
    if (r <= 0) return k;
  }
  return entries[entries.length - 1][0];
}

/**
 * Build the full booking context object for a stay.
 *
 * @param {Object} input
 * @param {number} input.room_rate_paid_eur    Per night. REQUIRED to calibrate value.
 * @param {string} input.booking_channel       Key from booking_context.channels. Sampled if omitted.
 * @param {string} input.rate_plan_type        Key from rate_plans. Defaults to flexible_refundable.
 * @param {number} input.days_between_booking_and_arrival  Lead time. Defaults sampled.
 * @param {string[]} input.pre_booked_upsells  Array of upsell keys already accepted.
 * @param {string[]} input.package_inclusions  ['breakfast','hb','all_inclusive','spa_credit'].
 * @param {number} input.discount_applied_pct  0-50. Defaults 0.
 *
 * @returns {Object} Enriched context:
 *   { room_rate_paid_eur, booking_channel, rate_plan_type, lead_time_days,
 *     lead_time_segment, price_tier, expectation_pressure_multiplier,
 *     aggregated_baseline_modifiers, narrative_block }
 */
function buildBookingContext(input = {}) {
  const cfg = getConfig();

  const channelKey = input.booking_channel || pickRandomChannel();
  const channel = cfg.channels[channelKey] || cfg.channels.direct_web;

  const ratePlanKey = input.rate_plan_type || 'flexible_refundable';
  const ratePlan = cfg.rate_plans[ratePlanKey] || cfg.rate_plans.flexible_refundable;

  const leadTimeDays = input.days_between_booking_and_arrival ?? Math.floor(Math.random() * 90) + 3;
  const leadSeg = getLeadTimeSegment(leadTimeDays);

  const roomRate = Number(input.room_rate_paid_eur) || 300;
  const tier = getPriceTier(roomRate);

  const upsells = Array.isArray(input.pre_booked_upsells) ? input.pre_booked_upsells : [];
  const packages = Array.isArray(input.package_inclusions) ? input.package_inclusions : [];
  const discount = Number(input.discount_applied_pct) || 0;

  const baselineMods = mergeModifiers(
    channel.expectation_modifier,
    ratePlan.expectation_modifier,
    leadSeg.expectation_modifier
  );

  // Total value-awareness multiplier: leadSeg × discount awareness
  const valueAwareness = (leadSeg.value_awareness_multiplier || 1.0) * (1 + discount / 100);

  // Narrative block for the LLM
  const upsellList = upsells.length ? upsells.map(u => u.replace(/_/g, ' ')).join(', ') : 'none';
  const packageList = packages.length ? packages.join(', ') : 'room-only';
  const narrative_block = [
    `=== BOOKING CONTEXT (shapes expectation BEFORE arrival) ===`,
    `Room rate paid: €${roomRate}/night (${tier.key.replace('_', ' ')} tier, expectation pressure ${tier.expectation_pressure_multiplier.toFixed(2)}×)`,
    `Booking channel: ${channel.label}`,
    `Rate plan: ${ratePlan.label} (${ratePlan.typical_premium_pct >= 0 ? '+' : ''}${ratePlan.typical_premium_pct}% vs flex)`,
    `Lead time: ${leadTimeDays} days (${leadSeg.key.replace('_', ' ')})`,
    `Package inclusions: ${packageList}`,
    `Pre-booked upsells: ${upsellList}`,
    `Discount applied: ${discount}%`,
    `Loyalty recognition expected: ${channel.loyalty_recognition_likely ? 'YES' : 'NO'}`,
    `Hotel's data on this guest: ${channel.data_known_to_hotel}`,
    ``,
    `Narrative implications for you, the guest:`,
    `- At €${roomRate}/night you are judging ${tier.expectation_pressure_multiplier >= 1.3 ? 'extremely strictly' : tier.expectation_pressure_multiplier >= 1.1 ? 'strictly' : 'fairly'}.`,
    `- ${channel.label} booking means ${channel.loyalty_recognition_likely ? 'you expect recognition' : 'you may feel anonymous to the hotel'}.`,
    `- ${leadTimeDays < 7 ? 'Late booking: you are less price-sensitive but more execution-focused' : leadTimeDays > 60 ? 'Booked far in advance: your mental picture of this stay has had months to build' : 'Booked with reasonable planning'}.`,
    `- ${upsells.length > 0 ? 'You paid extra for ' + upsellList + ' — execution of these items matters doubly' : 'No pre-booked upsells — base expectations apply'}.`,
    ``,
  ].join('\n');

  return {
    room_rate_paid_eur: roomRate,
    booking_channel: channelKey,
    booking_channel_label: channel.label,
    rate_plan_type: ratePlanKey,
    rate_plan_label: ratePlan.label,
    lead_time_days: leadTimeDays,
    lead_time_segment: leadSeg.key,
    package_inclusions: packages,
    pre_booked_upsells: upsells,
    discount_applied_pct: discount,
    price_tier: tier.key,
    expectation_pressure_multiplier: tier.expectation_pressure_multiplier,
    value_awareness_multiplier: valueAwareness,
    loyalty_recognition_expected: channel.loyalty_recognition_likely,
    data_known_to_hotel: channel.data_known_to_hotel,
    aggregated_baseline_modifiers: baselineMods,
    narrative_block,
  };
}

/**
 * Sample a realistic booking context for a persona (used when caller doesn't specify).
 * Takes archetype into account (Luxury Seeker paying €200 is implausible).
 */
function sampleBookingContext({ archetypeId, propertyTier = 'luxury' }) {
  const archetypePriceAnchors = {
    luxury_seeker: [500, 1200],
    honeymooner: [450, 900],
    loyalty_maximizer: [350, 700],
    family_vacationer: [300, 600],
    event_attendee: [300, 550],
    business_traveler: [280, 500],
    digital_nomad: [200, 400],
    budget_optimizer: [180, 350],
  };
  const range = archetypePriceAnchors[archetypeId] || [300, 600];
  const rate = Math.round(range[0] + Math.random() * (range[1] - range[0]));

  const archetypeChannelBias = {
    luxury_seeker: ['direct_web', 'travel_agency', 'direct_app'],
    honeymooner: ['direct_web', 'booking_com', 'travel_agency'],
    loyalty_maximizer: ['loyalty_redemption', 'direct_web', 'direct_app'],
    business_traveler: ['corporate', 'direct_app', 'booking_com'],
    digital_nomad: ['booking_com', 'direct_app', 'expedia'],
    family_vacationer: ['booking_com', 'direct_web', 'expedia'],
    budget_optimizer: ['booking_com', 'expedia', 'meta'],
    event_attendee: ['group_mice', 'corporate', 'direct_web'],
  };
  const channels = archetypeChannelBias[archetypeId] || ['booking_com', 'direct_web'];
  const channel = channels[Math.floor(Math.random() * channels.length)];

  return buildBookingContext({
    room_rate_paid_eur: rate,
    booking_channel: channel,
    rate_plan_type: Math.random() < 0.3 ? 'advance_purchase_nonref' : 'flexible_refundable',
    days_between_booking_and_arrival: Math.floor(Math.random() * 75) + 5,
    pre_booked_upsells: [],
  });
}

module.exports = { buildBookingContext, sampleBookingContext, getConfig, getPriceTier, getLeadTimeSegment };
