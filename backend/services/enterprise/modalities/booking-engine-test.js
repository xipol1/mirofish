/**
 * Modality: Booking Engine Test
 *
 * Simulates the booking funnel: where do prospects from different markets
 * drop off? Which friction points block conversion?
 *
 * Stages: landing → rate_browser → rate_selection → hesitation → cart →
 *          payment → confirmation (or abandonment).
 *
 * Best for: CRO / e-commerce / revenue managers optimizing the direct
 * booking funnel and competitor parity experience.
 */

const { callAIJSON } = require('../../ai');
const culturalProfiles = require('../cultural-profiles');
const bookingContextSvc = require('../booking-context');
const marketPacks = require('../market-packs');

const REQUIRED = ['property', 'audience', 'booking_flow_spec'];
const OPTIONAL = [
  'agent_count', 'market_pack_ids', 'competitive_set', 'price_variants',
  'rate_plan_mix', 'property_country',
];

const STAGES = [
  'landing_page',
  'rate_browser',
  'rate_selection',
  'hesitation_point',
  'cart_review',
  'payment_page',
  'confirmation_or_abandonment',
];

// Archetypes that realistically use a booking engine (vs. travel agents, groups, etc.)
const APPLICABLE_ARCHETYPES = new Set([
  'business_traveler', 'family_vacationer', 'luxury_seeker', 'honeymooner',
  'digital_nomad', 'budget_optimizer', 'loyalty_maximizer', 'event_attendee',
]);

function validateInputs(raw) {
  const errors = [];
  if (!raw.property || !raw.property.name) errors.push('property.name is required');
  if (!raw.audience) errors.push('audience is required');
  if (!raw.booking_flow_spec) {
    errors.push('booking_flow_spec is required — describe the booking engine UX: number of steps, visible elements, rate plans, hidden fees policy, cancellation visibility at each step, mobile vs desktop design quality, etc.');
  }
  return { ok: errors.length === 0, errors, normalized: raw };
}

function buildAgentContext({ persona, globalCtx }) {
  const archetypeId = persona.archetype_id || persona._archetype_id || 'business_traveler';

  // Cultural context with market-pack override if provided
  const marketPackId = (globalCtx.market_pack_ids && globalCtx.market_pack_ids.length > 0)
    ? globalCtx.market_pack_ids[Math.floor(Math.random() * globalCtx.market_pack_ids.length)]
    : null;
  const pack = marketPackId ? marketPacks.get(marketPackId) : null;
  const clusterId = pack?.cultural_cluster_mapping || culturalProfiles.sampleClusterForMenorca();
  const cultural_context = culturalProfiles.buildCulturalContext({
    clusterId,
    propertyCountry: globalCtx.property_country || 'ES',
  });

  // Booking context — use the market pack's channel distribution if available
  const booking_context = bookingContextSvc.sampleBookingContext({
    archetypeId,
    propertyTier: globalCtx.property?.data_json?.identity?.tier || globalCtx.property?.tier || 'luxury',
  });
  if (pack?.channel_share_pct) {
    // Re-sample the channel from the market pack's distribution
    const channel = marketPacks.sampleChannel(pack);
    booking_context.booking_channel = channel;
  }

  // Device — sampled from market pack if available
  const device = pack?.device_share_pct
    ? marketPacks.sampleDevice(pack)
    : (Math.random() < 0.55 ? 'mobile' : Math.random() < 0.85 ? 'desktop' : 'tablet');

  // Price shown to the agent — if price variants are defined, pick one; otherwise use the booking context's rate
  const price_variant = (globalCtx.price_variants && globalCtx.price_variants.length > 0)
    ? globalCtx.price_variants[Math.floor(Math.random() * globalCtx.price_variants.length)]
    : { label: 'default', rate_eur: booking_context.room_rate_paid_eur };

  return {
    archetype_id: archetypeId,
    cultural_context,
    booking_context,
    market_pack: pack ? { id: pack.market_id, label: pack.label } : null,
    device,
    price_variant,
    competitive_set: globalCtx.competitive_set || [],
  };
}

async function runForAgent({ persona, agentCtx, globalCtx, onStage }) {
  const stageOutputs = [];
  const sessionState = {
    current_step: 'landing_page',
    abandoned: false,
    abandonment_reason: null,
    conversion_achieved: false,
    friction_events: [],
    time_on_step_seconds: {},
    perception_of_price: null,
    perception_of_trust: 50, // 0-100 scale
  };

  for (const stageLabel of STAGES) {
    if (sessionState.abandoned) break;

    onStage({ stage: stageLabel, session_state: { ...sessionState } });

    let stageResult;
    try {
      stageResult = await runBookingStage({
        stageLabel,
        persona,
        agentCtx,
        globalCtx,
        sessionState,
        previousOutputs: stageOutputs,
      });
    } catch (err) {
      console.error(`[booking-engine] Stage ${stageLabel} failed for ${persona.name}:`, err.message.substring(0, 150));
      stageResult = {
        stage: stageLabel,
        narrative: `(stage error: ${err.message.substring(0, 100)})`,
        decision: 'abandoned',
        abandonment_reason: 'system_error',
        frictions: [],
        time_on_step_seconds: 0,
      };
    }

    // Update session state based on stage result
    sessionState.current_step = stageLabel;
    sessionState.time_on_step_seconds[stageLabel] = stageResult.time_on_step_seconds || 0;
    for (const f of (stageResult.frictions || [])) {
      sessionState.friction_events.push({ stage: stageLabel, friction: f });
    }
    if (typeof stageResult.trust_delta === 'number') {
      sessionState.perception_of_trust = Math.max(0, Math.min(100, sessionState.perception_of_trust + stageResult.trust_delta));
    }
    if (stageResult.decision === 'abandoned') {
      sessionState.abandoned = true;
      sessionState.abandonment_reason = stageResult.abandonment_reason || 'unspecified';
    }
    if (stageResult.decision === 'converted' && stageLabel === 'confirmation_or_abandonment') {
      sessionState.conversion_achieved = true;
    }

    stageOutputs.push(stageResult);
  }

  // Assemble agent record
  return {
    archetype_id: agentCtx.archetype_id,
    persona: { name: persona.name, archetype_label: persona.archetype_label, role: persona.role },
    persona_full: persona,
    cultural_context: agentCtx.cultural_context ? {
      origin_country_iso: agentCtx.cultural_context.origin_country_iso,
      culture_cluster: agentCtx.cultural_context.culture_cluster,
      native_language: agentCtx.cultural_context.native_language,
    } : null,
    market_pack: agentCtx.market_pack,
    booking_context: {
      room_rate_paid_eur: agentCtx.booking_context?.room_rate_paid_eur,
      booking_channel: agentCtx.booking_context?.booking_channel,
      price_tier: agentCtx.booking_context?.price_tier,
    },
    device: agentCtx.device,
    price_variant: agentCtx.price_variant,
    stages: stageOutputs,
    session_state: sessionState,
    converted: sessionState.conversion_achieved,
    abandoned: sessionState.abandoned,
    abandonment_stage: sessionState.abandoned ? sessionState.current_step : null,
    abandonment_reason: sessionState.abandonment_reason,
    friction_count: sessionState.friction_events.length,
    final_trust_score: sessionState.perception_of_trust,
    completed_at: Date.now(),
  };
}

async function runBookingStage({ stageLabel, persona, agentCtx, globalCtx, sessionState, previousOutputs }) {
  const prompt = buildBookingStagePrompt({ stageLabel, persona, agentCtx, globalCtx, sessionState, previousOutputs });
  const raw = await callAIJSON(prompt, { maxTokens: 900, temperature: 0.7 });
  return normalizeBookingStageOutput(raw, stageLabel);
}

function buildBookingStagePrompt({ stageLabel, persona, agentCtx, globalCtx, sessionState, previousOutputs }) {
  const flowSpec = globalCtx.booking_flow_spec || {};
  const culturalBlock = agentCtx.cultural_context?.narrative_block || '';
  const previous = previousOutputs.slice(-2).map(p => `[${p.stage}] decision=${p.decision} | narrative: ${(p.narrative || '').substring(0, 180)}`).join('\n') || '(first stage)';

  const packBlock = agentCtx.market_pack
    ? `Your outbound market profile (Market Pack: ${agentCtx.market_pack.label}):\n${JSON.stringify(marketPacks.getBehaviorSignals(agentCtx.market_pack.id), null, 2)}`
    : '(no specific market pack)';

  const stagePrompts = {
    landing_page: 'You land on the hotel\'s booking page. First impression: loading speed, visual design, credibility signals, CTA visibility, rate visibility.',
    rate_browser: 'You browse available rates / room types. How many options, filtering, comparison with competitive set, clarity of what\'s included.',
    rate_selection: 'You select a rate. Cancellation policy visibility, breakfast/extras clarity, total price transparency.',
    hesitation_point: 'You pause before committing. What\'s making you hesitate? Compare to booking.com in another tab? Check reviews? Competitive price check?',
    cart_review: 'You review your cart summary. Any surprises on price, fees, upsell prompts, trust signals.',
    payment_page: 'You enter payment details. Form length, mobile optimization, security signals, mandatory fields, newsletter checkbox default.',
    confirmation_or_abandonment: 'Moment of truth: do you convert or abandon? If converting, your confirmation experience. If abandoning, the exact reason.',
  };

  return `You are simulating a real prospective booker evaluating a direct-booking engine. Stay in character.

=== YOU ARE ===
Name: ${persona.name}
Archetype: ${persona.archetype_label || 'traveler'}
Age: ${persona.age || '35'}
Device: ${agentCtx.device}
Booking channel you usually prefer: ${agentCtx.booking_context?.booking_channel}
Rate you\'re seeing: €${agentCtx.price_variant?.rate_eur}/night (variant: ${agentCtx.price_variant?.label})

${culturalBlock}

=== PROPERTY BEING BOOKED ===
${globalCtx.property?.name} (${globalCtx.property?.brand || 'no brand'})

=== BOOKING FLOW SPEC (the UX you\'re experiencing) ===
${JSON.stringify(flowSpec, null, 2)}

=== YOUR ALTERNATIVE OPTIONS (competitive set) ===
${(globalCtx.competitive_set || []).map((c, i) => `  ${i + 1}. ${c}`).join('\n') || '(no specific competitors in mind)'}

=== ${packBlock}

=== SESSION SO FAR ===
Current trust score (0-100): ${sessionState.perception_of_trust}
Frictions experienced so far: ${sessionState.friction_events.length}
Previous stages:
${previous}

=== CURRENT STAGE: ${stageLabel} ===
${stagePrompts[stageLabel] || 'Proceed realistically.'}

Return JSON:
{
  "narrative": "2-4 sentences first-person, what you see and think at this step.",
  "decision": "continue | abandoned | converted",
  "abandonment_reason": "if abandoned, ONE specific reason (e.g., 'cancellation policy not visible before payment', 'resort fee surprise in cart', 'mobile form too long on phone', 'cheaper on booking.com', 'trust signal missing', 'flow requires login I do not have')",
  "frictions": ["list of 0-3 specific friction events at this step"],
  "trust_delta": "integer between -20 and +15, how your trust in the brand moved",
  "time_on_step_seconds": "integer, realistic time spent at this step",
  "comparison_to_alternative": "if you mentally compared to an alternative this step, name it and say why — else null",
  "conversion_probability": "0.0 to 1.0 — probability you'd complete at this moment"
}`;
}

function normalizeBookingStageOutput(raw, stageLabel) {
  return {
    stage: stageLabel,
    narrative: String(raw?.narrative || '').substring(0, 1200),
    decision: raw?.decision || 'continue',
    abandonment_reason: raw?.abandonment_reason || null,
    frictions: Array.isArray(raw?.frictions) ? raw.frictions.slice(0, 4) : [],
    trust_delta: Number(raw?.trust_delta) || 0,
    time_on_step_seconds: Math.max(0, Math.round(Number(raw?.time_on_step_seconds) || 10)),
    comparison_to_alternative: raw?.comparison_to_alternative || null,
    conversion_probability: Math.max(0, Math.min(1, Number(raw?.conversion_probability) || 0.5)),
  };
}

function aggregateResults(agentRecords, globalCtx) {
  const valid = agentRecords.filter(r => r && !r.error);
  const n = valid.length;
  if (n === 0) return { modality: 'booking_engine_test', total_sessions: 0, conversion_rate_pct: 0 };

  // Overall funnel
  const converted = valid.filter(r => r.converted).length;
  const abandoned = valid.filter(r => r.abandoned).length;

  // Dropoff by stage (where did people abandon?)
  const dropoffByStage = {};
  for (const s of STAGES) dropoffByStage[s] = 0;
  for (const r of valid) {
    if (r.abandoned && r.abandonment_stage) dropoffByStage[r.abandonment_stage]++;
  }

  // Conversion funnel: who reached each stage
  const reachedStage = {};
  for (const s of STAGES) reachedStage[s] = 0;
  for (const r of valid) {
    for (const stageOut of (r.stages || [])) reachedStage[stageOut.stage] = (reachedStage[stageOut.stage] || 0) + 1;
  }

  // Abandonment reasons ranked
  const abandonmentReasons = {};
  for (const r of valid) {
    if (r.abandoned && r.abandonment_reason) {
      abandonmentReasons[r.abandonment_reason] = (abandonmentReasons[r.abandonment_reason] || 0) + 1;
    }
  }

  // Conversion rate by market pack, by archetype, by device, by price variant
  const convBy = (fieldGetter) => {
    const buckets = {};
    for (const r of valid) {
      const key = fieldGetter(r) || 'unknown';
      if (!buckets[key]) buckets[key] = { total: 0, converted: 0 };
      buckets[key].total++;
      if (r.converted) buckets[key].converted++;
    }
    const out = {};
    for (const [k, v] of Object.entries(buckets)) {
      out[k] = { total: v.total, converted: v.converted, conversion_rate_pct: Math.round((v.converted / v.total) * 1000) / 10 };
    }
    return out;
  };

  const conversionByMarket = convBy(r => r.market_pack?.id);
  const conversionByArchetype = convBy(r => r.archetype_id);
  const conversionByDevice = convBy(r => r.device);
  const conversionByPriceVariant = convBy(r => r.price_variant?.label);
  const conversionByChannel = convBy(r => r.booking_context?.booking_channel);

  // Friction clustering
  const frictionCatalog = {};
  for (const r of valid) {
    for (const f of (r.session_state?.friction_events || [])) {
      const key = typeof f.friction === 'string' ? f.friction.toLowerCase().substring(0, 80) : 'unknown';
      frictionCatalog[key] = (frictionCatalog[key] || 0) + 1;
    }
  }
  const topFrictions = Object.entries(frictionCatalog).sort((a, b) => b[1] - a[1]).slice(0, 15).map(([friction, count]) => ({ friction, count }));

  // Average time on each stage
  const avgTimeByStage = {};
  for (const s of STAGES) {
    const times = valid.map(r => r.session_state?.time_on_step_seconds?.[s]).filter(t => typeof t === 'number');
    if (times.length > 0) avgTimeByStage[s] = Math.round((times.reduce((a, b) => a + b, 0) / times.length) * 10) / 10;
  }

  // Trust score at conversion/abandonment
  const avgTrustScoreConverted = avg(valid.filter(r => r.converted).map(r => r.final_trust_score));
  const avgTrustScoreAbandoned = avg(valid.filter(r => r.abandoned).map(r => r.final_trust_score));

  return {
    modality: 'booking_engine_test',
    total_sessions: n,
    conversion_rate_pct: Math.round((converted / n) * 1000) / 10,
    abandonment_rate_pct: Math.round((abandoned / n) * 1000) / 10,
    funnel_reached_stage: reachedStage,
    dropoff_by_stage: dropoffByStage,
    top_abandonment_reasons: Object.entries(abandonmentReasons).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([reason, count]) => ({ reason, count })),
    top_frictions: topFrictions,
    avg_time_by_stage_seconds: avgTimeByStage,
    avg_trust_score_at_conversion: avgTrustScoreConverted != null ? Math.round(avgTrustScoreConverted * 10) / 10 : null,
    avg_trust_score_at_abandonment: avgTrustScoreAbandoned != null ? Math.round(avgTrustScoreAbandoned * 10) / 10 : null,
    conversion_rate_by_market: conversionByMarket,
    conversion_rate_by_archetype: conversionByArchetype,
    conversion_rate_by_device: conversionByDevice,
    conversion_rate_by_price_variant: conversionByPriceVariant,
    conversion_rate_by_channel: conversionByChannel,
  };
}

function avg(arr) { return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null; }

module.exports = {
  id: 'booking_engine_test',
  label: 'Booking Engine Test',
  description: 'Simulates N prospects going through a booking funnel. Identifies where conversion breaks by market, archetype, device, and price variant.',
  required_inputs: REQUIRED,
  optional_inputs: OPTIONAL,
  uses_target_star_sampling: false,

  validateInputs,
  buildAgentContext,
  runForAgent,
  aggregateResults,
  STAGES,
};
