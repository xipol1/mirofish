/**
 * Guest Journey Orchestrator — drives an agent through a complete multi-stage hotel stay.
 *
 * Integrates 6 layers of context:
 *   1. Persona + archetype
 *   2. Property + property calibration (real review corpus)
 *   3. Cultural cluster (origin country, language, expectations)
 *   4. Booking context (room rate, channel, lead time, rate plan, upsells)
 *   5. External context (season, weather per night, local events, occupancy)
 *   6. Staff registry (named entities persisting across stages)
 *
 * Stages executed in order (configurable per stay_length), with adversarial
 * event injection and target-star landing. After stages complete, post-stay
 * module runs (checkout, billing, email, review delay, WoM, return intent).
 */

const { simulateStage, getArchetypeBehavior } = require('./narrative-engine');
const sensationTracker = require('./sensation-tracker');
const expenseTracker = require('./expense-tracker');
const adversarialEvents = require('./adversarial-events');
const staffRegistry = require('./staff-registry');
const externalContext = require('./external-context');
const physicalState = require('./physical-state');
const companion = require('./companion');
const personaEnricher = require('./persona-enricher');
const { runPostStay } = require('./post-stay-journey');

const DEFAULT_STAGES_FOR_SHORT_STAY = [
  'arrival',
  'room_first_impression',
  'evening_1',
  'morning_routine',
  'daytime_activity',
  'dinner',
  'last_morning',
  'checkout',
];

const DEFAULT_STAGES_FOR_LEISURE_STAY = [
  'arrival',
  'room_first_impression',
  'evening_1',
  'morning_routine',
  'daytime_activity',
  'lunch',
  'afternoon_activity',
  'dinner',
  'evening_leisure',
  'morning_routine',
  'daytime_activity',
  'lunch',
  'afternoon_activity',
  'dinner',
  'last_morning',
  'checkout',
];

function pickStages(stayLengthNights, archetypeId) {
  if (stayLengthNights <= 2) return DEFAULT_STAGES_FOR_SHORT_STAY;
  if (['family_vacationer', 'honeymooner', 'luxury_seeker'].includes(archetypeId)) {
    return DEFAULT_STAGES_FOR_LEISURE_STAY;
  }
  return DEFAULT_STAGES_FOR_SHORT_STAY;
}

/**
 * Run a full stay simulation for one agent.
 *
 * @param {Object} ctx
 * @param {Object} ctx.persona
 * @param {Object} ctx.property
 * @param {Object} ctx.calibration
 * @param {number} ctx.stay_length_nights
 * @param {string} ctx.trip_purpose
 * @param {Object} ctx.arrival_context
 * @param {number} ctx.target_star_rating
 * @param {Object} ctx.cultural_context     — from cultural-profiles.buildCulturalContext
 * @param {Object} ctx.booking_context      — from booking-context.buildBookingContext
 * @param {Object} ctx.external_context     — from external-context.buildExternalContext
 * @param {Function} ctx.onStage
 */
async function runStay({
  persona,
  property,
  calibration = {},
  stay_length_nights = 3,
  trip_purpose = 'leisure',
  arrival_context = {},
  target_star_rating = null,
  cultural_context = null,
  booking_context = null,
  external_context: extCtx = null,
  onStage = () => {},
}) {
  const archetypeId = persona.archetype_id || persona._archetype_id || 'business_traveler';
  const archetypeBehavior = getArchetypeBehavior(archetypeId);

  // Build sensation state with all 6 layers
  const propertyBaseline = extractBaselineFromCalibration(calibration);
  const tierForBoost = property?.data_json?.identity?.tier
    || property?.data_json?.tier
    || property?.tier
    || booking_context?.price_tier
    || null;
  let sensationState = sensationTracker.initialState({
    propertyBaseline,
    archetypeId,
    culturalModifiers: cultural_context?.sensation_baseline_modifiers || null,
    bookingModifiers: booking_context?.aggregated_baseline_modifiers || null,
    externalModifiers: extCtx?.aggregated_baseline_modifiers || null,
    propertyTier: tierForBoost,
  });
  let expenseState = expenseTracker.initial();

  // Physical state — models body (fatigue, hunger, jetlag, sleep quality, alcohol)
  // across the stay so the LLM can reason about biology, not just sensations.
  const arrivalHourLocal = typeof arrival_context?.arrival_hour_local === 'number'
    ? arrival_context.arrival_hour_local
    : null;
  let physState = physicalState.initialState({
    persona,
    culturalContext: cultural_context,
    bookingContext: booking_context,
    arrivalHourLocal,
  });

  // Companion dynamics — generate partner/spouse/children whose independent
  // moods cross-contaminate the primary guest's experience.
  let companions = companion.generateCompanions({
    persona,
    archetypeId,
    tripPurpose: trip_purpose,
    culturalContext: cultural_context,
  });
  const companionMomentsLog = [];

  // Staff registry — persists across stages so rapport can form
  const staffRegistryEntities = [];

  const stageHistory = [];
  const stages = pickStages(stay_length_nights, archetypeId);

  // Adversarial event planning — probability scales with target star AND occupancy.
  // High occupancy increases baseline event probability (stressed operations).
  //
  // CALIBRATION 2026-04-18: reduced 5★ and 4★ event probability after backtest v2 showed
  // sim avg 2.8★ vs real 4.65★ for Villa Le Blanc. Target 5★ stays should mostly NOT have
  // incidents (real 5★ empirical reviews have ~15-20% mention of any friction).
  const occPct = extCtx?.occupancy_pct || 70;
  const occBoost = occPct >= 90 ? 0.10 : occPct >= 75 ? 0.05 : 0;

  const eventProbByTargetStars = { 5: 0.20, 4: 0.40, 3: 0.70, 2: 0.95, 1: 1.0 };
  const forcedEventProb = target_star_rating
    ? Math.min(1.0, (eventProbByTargetStars[target_star_rating] || 0.55) + occBoost)
    : null;
  const propertyTier = property?.data_json?.identity?.tier
    || property?.data_json?.tier
    || property?.tier
    || booking_context?.price_tier
    || null;
  const plannedEvents = adversarialEvents.planInjections({
    archetypeId,
    stages,
    forceProbabilityAtLeastOne: forcedEventProb,
    propertyTier,
  });
  const eventsByStage = {};
  for (const ev of plannedEvents.events) {
    eventsByStage[ev.stage] = eventsByStage[ev.stage] || [];
    eventsByStage[ev.stage].push(ev);
  }

  // Staffing quality hint: high occupancy erodes, low occupancy + luxury tier elevates.
  // Luxury properties run tighter staffing standards so even mid-occupancy defaults to senior-skewed.
  let staffingQualityHint;
  if (occPct >= 90) staffingQualityHint = 'under-trained';
  else if (tierForBoost === 'luxury' && occPct <= 85) staffingQualityHint = 'senior';
  else if (tierForBoost === 'premium' && occPct <= 75) staffingQualityHint = 'senior';
  else if (occPct <= 40) staffingQualityHint = 'senior';
  else staffingQualityHint = null;

  for (let i = 0; i < stages.length; i++) {
    const stageLabel = stages[i];
    const nightNumber = inferNightNumber(stages, i);
    const injectedEvent = eventsByStage[stageLabel]?.[0] || null;

    // Pick staff for this stage (mix of returning and new)
    const staffInPlay = staffRegistry.pickStaffForStage({
      registry: staffRegistryEntities,
      stageLabel,
      stayLengthNights: stay_length_nights,
      stageIndex: i,
      staffingQualityHint,
    });

    // Per-stage external context snippet (weather today + events today)
    const stageExternalBlock = extCtx
      ? externalContext.getStageContextBlock({ externalContext: extCtx, nightNumber })
      : '';

    let stageResult;
    try {
      stageResult = await simulateStage({
        stage_label: stageLabel,
        persona,
        archetype_behavior: archetypeBehavior,
        property,
        sensation_state: sensationState,
        physical_state: physState,
        companions,
        previous_stages: stageHistory,
        stay_context: {
          night_number: nightNumber,
          trip_purpose,
          arrival_context,
          stay_length_nights,
          target_star_rating,
        },
        calibration_signals: calibration,
        injected_event: injectedEvent,
        cultural_context,
        booking_context,
        staff_in_play: staffInPlay,
        stage_external_block: stageExternalBlock,
      });
    } catch (err) {
      console.error(`[guest-journey] Stage ${stageLabel} failed for ${persona.name}:`, err.message.substring(0, 150));
      stageResult = {
        stage: stageLabel,
        narrative: `(stage simulation error: ${err.message.substring(0, 100)})`,
        internal_thoughts: '',
        sensation_deltas: {},
        moments_positive: [],
        moments_negative: [],
        decisions: {},
        expenses: [],
        abandonment_signal: false,
      };
    }

    // Apply sensation deltas from the LLM, modulated through three layers:
    //   1. Physical state — tired/hungry/hungover guests feel negatives more
    //   2. Companion mood — a grumpy partner drags your reading down
    //   3. Personality traits — neurotics magnify negatives, optimists boost positives
    const modulatedByBody = physicalState.applySensationModifiers(stageResult.sensation_deltas, physState);
    const modulatedByCompanions = companion.applyCompanionMoodToSensations(modulatedByBody, companions);
    const modulatedByTraits = personaEnricher.applyTraitSensationModifiers(modulatedByCompanions, persona);
    sensationState = sensationTracker.applyStageDeltas(sensationState, modulatedByTraits, stageLabel);

    // Apply adversarial event deltas (guarantee impact even if LLM softened it)
    if (injectedEvent) {
      const evDeltas = adversarialEvents.computeEventDeltas(injectedEvent.event, injectedEvent.resolution_quality, archetypeId);
      sensationState = sensationTracker.applyStageDeltas(sensationState, evDeltas, `${stageLabel}__event:${injectedEvent.event.id}`);
      sensationState = sensationTracker.recordMoment(sensationState, {
        kind: 'negative',
        stage: stageLabel,
        description: `[incident: ${injectedEvent.event.label}] resolution=${injectedEvent.resolution_quality}`,
      });
    }

    // Record moments
    for (const pos of stageResult.moments_positive || []) {
      sensationState = sensationTracker.recordMoment(sensationState, { kind: 'positive', stage: stageLabel, description: typeof pos === 'string' ? pos : (pos?.description || '') });
    }
    for (const neg of stageResult.moments_negative || []) {
      sensationState = sensationTracker.recordMoment(sensationState, { kind: 'negative', stage: stageLabel, description: typeof neg === 'string' ? neg : (neg?.description || '') });
    }

    // Update staff rapport from this stage's interactions (LLM may flag specific staff in output)
    if (Array.isArray(stageResult.staff_interactions_outcome)) {
      for (const outcome of stageResult.staff_interactions_outcome) {
        if (outcome?.staff_id) {
          staffRegistry.recordInteraction({
            registry: staffRegistryEntities,
            staffId: outcome.staff_id,
            stage: stageLabel,
            outcome,
          });
        }
      }
    } else {
      // Fallback: any staff in play that was featured this stage gets a neutral rapport update
      // based on the stage's overall positive/negative balance
      const posCount = (stageResult.moments_positive || []).length;
      const negCount = (stageResult.moments_negative || []).length;
      for (const s of staffInPlay) {
        const entity = staffRegistryEntities.find(x => x.id === s.id);
        if (entity) {
          const delta = posCount - negCount;
          staffRegistry.recordInteraction({
            registry: staffRegistryEntities,
            staffId: entity.id,
            stage: stageLabel,
            outcome: { rapport_delta: Math.max(-2, Math.min(2, delta)), was_positive: delta > 0, was_negative: delta < 0 },
          });
        }
      }
    }

    // Record expenses
    for (const exp of stageResult.expenses || []) {
      const before = expenseState.items.length;
      expenseState = expenseTracker.record(expenseState, {
        stage: stageLabel,
        category: exp.category || 'other',
        item: exp.item || 'unspecified',
        amount_eur: exp.amount_eur || 0,
        included: !!exp.included,
        satisfaction: exp.satisfaction,
        note: exp.note || null,
      });
      // Loss-aversion hit: surprise charges apply a negative value + service
      // penalty proportional to magnitude, and auto-record a negative moment.
      // Calibrated so a €25 resort fee at checkout costs ~1 negative moment
      // plus a ~5pp hit on value + ~3pp on service_quality.
      const recorded = expenseState.items[before];
      if (recorded?.is_surprise && !recorded.included && recorded.amount_eur > 0) {
        const magnitude = Math.min(12, Math.max(2, Math.round(recorded.amount_eur / 5)));
        const deltas = { value: -magnitude, service_quality: -Math.round(magnitude * 0.6) };
        sensationState = sensationTracker.applyStageDeltas(sensationState, deltas, `${stageLabel}__surprise_charge:${recorded.category}`);
        sensationState = sensationTracker.recordMoment(sensationState, {
          kind: 'negative',
          stage: stageLabel,
          description: `[surprise charge] €${recorded.amount_eur} ${recorded.item} (${recorded.category}) — not expected`,
        });
      }
    }

    // Update physical state. Fed with post-stage sensation snapshot (for night
    // sleep quality rolls) + this stage's expenses (for alcohol inference) +
    // an optional LLM-supplied physical_state_delta (LLM can self-report
    // e.g. "drank four cocktails → intoxication +50").
    physState = physicalState.applyStage(physState, {
      stageLabel,
      sensationSnapshot: snapshotDimensions(sensationState),
      expenses: stageResult.expenses || [],
      llmDelta: stageResult.physical_state_delta || null,
      externalContext: extCtx ? { ...extCtx, night_number: nightNumber } : null,
    });

    // Update companion moods based on stage valence; surface their independent
    // moments so the stay record has traceable companion-driven events.
    if (companions.length > 0) {
      const upd = companion.updateCompanionsFromStage(companions, {
        stageLabel,
        stageResult,
      });
      companions = upd.companions;
      for (const m of upd.companion_moments) companionMomentsLog.push(m);
      // Record positive/negative companion moments in sensation state too
      for (const m of upd.companion_moments) {
        sensationState = sensationTracker.recordMoment(sensationState, {
          kind: m.kind,
          stage: stageLabel,
          description: m.description,
        });
      }
    }

    stageHistory.push({
      index: i,
      stage: stageLabel,
      night: nightNumber,
      narrative: stageResult.narrative,
      internal_thoughts: stageResult.internal_thoughts,
      decisions: stageResult.decisions,
      moments_positive: stageResult.moments_positive,
      moments_negative: stageResult.moments_negative,
      concerns_voiced: stageResult.concerns_voiced_to_staff,
      expenses_this_stage: stageResult.expenses,
      staff_in_play: staffInPlay.map(s => ({ id: s.id, name: s.name, role: s.role, rapport_score: s.rapport_score })),
      sensation_snapshot: snapshotDimensions(sensationState),
      physical_state_snapshot: {
        fatigue: physState.fatigue,
        hunger: physState.hunger,
        thirst: physState.thirst,
        caffeine_need: physState.caffeine_need,
        sun_exposure_fatigue: physState.sun_exposure_fatigue,
        temperature_discomfort: physState.temperature_discomfort,
        temperature_skew: physState.temperature_skew,
        jetlag_severity: physState.jetlag_severity,
        hangover: physState.hangover,
        intoxication: physState.intoxication,
        sleep_quality_last_night: physState.sleep_quality_last_night,
        active_afflictions: physState.active_afflictions.map(a => ({ kind: a.kind, severity: Math.round(a.severity * 100) / 100 })),
      },
      companion_snapshot: companions.length > 0
        ? companions.map(c => ({ name: c.name, relationship: c.relationship, mood: c.mood_0_100 }))
        : null,
      ts: Date.now(),
    });

    onStage({
      index: i,
      total: stages.length,
      stage: stageLabel,
      persona_name: persona.name,
      narrative: stageResult.narrative,
      sensation_snapshot: snapshotDimensions(sensationState),
      moments_positive: stageResult.moments_positive,
      moments_negative: stageResult.moments_negative,
      expenses: stageResult.expenses,
    });

    // Rare early-departure signal
    if (stageResult.abandonment_signal && i < stages.length - 2) {
      stageHistory.push({
        index: i + 0.5,
        stage: 'early_departure',
        note: 'Guest departed the property before the end of stay',
        narrative: '(guest left early due to dissatisfaction)',
      });
      break;
    }
  }

  // Final in-stay summary
  const sensationSummary = sensationTracker.summarize(sensationState, archetypeBehavior);
  const expenseSummary = expenseTracker.summarize(expenseState);

  // Post-stay module: checkout detailed, billing, departure, email, review delay, WoM, return intent
  const stayForPostStay = {
    sensation_summary: sensationSummary,
    adversarial_events: plannedEvents.events,
  };
  const postStay = runPostStay({
    stay: stayForPostStay,
    persona,
    culturalContext: cultural_context,
    bookingContext: booking_context,
    archetypeId,
  });

  return {
    archetype_id: archetypeId,
    persona: { name: persona.name, archetype_label: persona.archetype_label, role: persona.role },
    stay_length_nights,
    trip_purpose,
    target_star_rating,
    cultural_context: cultural_context ? {
      origin_country_iso: cultural_context.origin_country_iso,
      culture_cluster: cultural_context.culture_cluster,
      native_language: cultural_context.native_language,
      language_match_with_staff: cultural_context.language_match_with_staff,
    } : null,
    booking_context: booking_context ? {
      room_rate_paid_eur: booking_context.room_rate_paid_eur,
      booking_channel: booking_context.booking_channel,
      rate_plan_type: booking_context.rate_plan_type,
      lead_time_days: booking_context.lead_time_days,
      price_tier: booking_context.price_tier,
      pre_booked_upsells: booking_context.pre_booked_upsells,
      loyalty_recognition_expected: booking_context.loyalty_recognition_expected,
    } : null,
    external_context: extCtx ? {
      season: extCtx.season,
      occupancy_pct: extCtx.occupancy_pct,
      weather_array: extCtx.weather_array,
      weather_labels: extCtx.weather_labels,
      local_events: extCtx.local_events,
    } : null,
    stages: stageHistory,
    sensation_history: sensationState._history || [],
    final_sensation_state: snapshotDimensions(sensationState),
    sensation_summary: sensationSummary,
    expense_summary: expenseSummary,
    moments_positive: sensationState._moments?.positive || [],
    moments_negative: sensationState._moments?.negative || [],
    adversarial_events: plannedEvents.events.map(e => ({
      stage: e.stage,
      event_id: e.event.id,
      event_label: e.event.label,
      resolution_quality: e.resolution_quality,
    })),
    staff_registry: staffRegistryEntities.map(s => ({
      id: s.id,
      name: s.name,
      role: s.role,
      personality_key: s.personality_key,
      rapport_score: s.rapport_score,
      interactions_count: s.interactions.length,
    })),
    post_stay: postStay,
    physical_state_summary: physicalState.summary(physState),
    companion_summary: companion.summarize(companions),
    companion_moments: companionMomentsLog,
    completed_at: Date.now(),
  };
}

function extractBaselineFromCalibration(calibration) {
  if (!calibration || !calibration.avg_rating) return null;
  // 2026-04-18: previous slope (0.85→1.15) was too gentle — a 4.65★ flagship only got
  // +12% baseline, insufficient to offset archetype negatives + LLM's default
  // "generate at least one negative per stage" bias. New slope (0.70→1.30) gives
  // 4.65★ → 1.27 (+27% baseline), aligning initial sensations with the peaks a
  // guest arriving to a Gran Meliá actually expects.
  const m = 0.70 + ((calibration.avg_rating - 1) / 4) * 0.60; // 1★→0.70, 5★→1.30
  return { _scale: m };
}

function snapshotDimensions(state) {
  const out = {};
  for (const k of Object.keys(state)) {
    if (!k.startsWith('_') && typeof state[k] === 'number') out[k] = Math.round(state[k]);
  }
  return out;
}

function inferNightNumber(stages, index) {
  const priorMornings = stages.slice(0, index).filter(s => s === 'morning_routine').length;
  const thisIsMorning = stages[index] === 'morning_routine' ? 1 : 0;
  return priorMornings + thisIsMorning + 1;
}

module.exports = { runStay, pickStages };
