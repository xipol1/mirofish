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
  operational_context = null,
  onStage = () => {},
}) {
  // Operational feedback loop — when the caller passes understaffing /
  // revenue-scenario context, translate it into per-stage sensation drags
  // so a "raise dinner 15%" or "understaff 30%" scenario actually changes
  // the guest narrative, not just the post-hoc revenue math.
  const opStressByStage = _buildOperationalStressDeltas(operational_context);
  const archetypeId = persona.archetype_id || persona._archetype_id || 'business_traveler';
  const archetypeBehavior = getArchetypeBehavior(archetypeId);

  // Build sensation state with all 6 layers
  const propertyBaseline = extractBaselineFromCalibration(calibration);
  const tierForBoost = property?.data_json?.identity?.tier
    || property?.data_json?.tier
    || property?.tier
    || booking_context?.price_tier
    || null;
  // Loyalty expectation modifier: MeliáRewards tier × brand match.
  // Platinum/Ambassador members of Meliá portfolio expect recognition by
  // name and tier on arrival. If the property is a Meliá brand, they start
  // with HIGHER expectations (i.e., lower personalization/service_quality
  // baselines) — staff has to earn the top of the scale through explicit
  // tier recognition. Non-Meliá loyalty or lower tiers: no effect.
  const loyaltyModifiers = computeLoyaltyExpectationModifier({ persona, property, bookingContext: booking_context });
  let sensationState = sensationTracker.initialState({
    propertyBaseline,
    archetypeId,
    culturalModifiers: cultural_context?.sensation_baseline_modifiers || null,
    bookingModifiers: booking_context?.aggregated_baseline_modifiers || null,
    externalModifiers: extCtx?.aggregated_baseline_modifiers || null,
    propertyTier: tierForBoost,
    loyaltyModifiers,
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
    const withOperationalStress = _applyOperationalStress(modulatedByTraits, opStressByStage, stageLabel);
    sensationState = sensationTracker.applyStageDeltas(sensationState, withOperationalStress, stageLabel);

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
      // Fallback: staff featured this stage gets rapport update based on the
      // stage's positive/negative moment balance. 2026-04-19: formula tuned
      // for real-LLM runs where 8B often forgets to emit
      // staff_interactions_outcome — the old ±2 cap left rapport stuck near 0
      // for the whole stay. Now scales with moment count and tier quality:
      //   luxury + positive stage → +3 per positive moment (capped at +5)
      //   luxury + mixed stage   → +1 net
      //   non-luxury             → old ±2 cap
      const posCount = (stageResult.moments_positive || []).length;
      const negCount = (stageResult.moments_negative || []).length;
      const isLuxuryStage = tierForBoost === 'luxury' || tierForBoost === 'premium';
      for (const s of staffInPlay) {
        const entity = staffRegistryEntities.find(x => x.id === s.id);
        if (!entity) continue;
        let delta;
        if (isLuxuryStage) {
          if (posCount > negCount) delta = Math.min(5, posCount * 2 - negCount);
          else if (posCount < negCount) delta = Math.max(-3, posCount - negCount);
          else delta = 0;
        } else {
          delta = Math.max(-2, Math.min(2, posCount - negCount));
        }
        staffRegistry.recordInteraction({
          registry: staffRegistryEntities,
          staffId: entity.id,
          stage: stageLabel,
          outcome: { rapport_delta: delta, was_positive: delta > 0, was_negative: delta < 0 },
        });
      }
    }

    // Record expenses (calibrated + annotated with research source)
    const occForCalibration = extCtx?.occupancy_pct || null;
    const clusterForCalibration = cultural_context?.culture_cluster || null;
    // Stage experience quality (0-1) — proxy for "was this stage good?"
    // Used to couple spend ↔ perception: expensive spend + bad stage penalizes
    // value/culinary harder ("too expensive for what it was" in real reviews).
    const stageExpQuality = (() => {
      const pos = (stageResult.moments_positive || []).length;
      const neg = (stageResult.moments_negative || []).length;
      if (pos + neg === 0) return 0.5;
      return pos / (pos + neg);
    })();
    const declinedItems = [];
    for (const exp of stageResult.expenses || []) {
      const before = expenseState.items.length;
      const calibrated = expenseTracker.calibrateExpense({
        proposedAmount: exp.amount_eur || 0,
        stage: stageLabel,
        category: exp.category || 'other',
        archetypeId,
        culturalCluster: clusterForCalibration,
        occupancyPct: occForCalibration,
      });
      // C. Decision conditioning — skip_purchase for budget-sensitive personas
      // when calibrated amount exceeds comfort threshold.
      const declineCheck = shouldDeclinePurchase(persona, archetypeId, calibrated);
      if (declineCheck.decline) {
        declinedItems.push({
          stage: stageLabel, category: exp.category || 'other', item: exp.item || 'unspecified',
          proposed_amount: calibrated.amount_eur, reason: declineCheck.reason,
        });
        continue;
      }
      expenseState = expenseTracker.record(expenseState, {
        stage: stageLabel,
        category: exp.category || 'other',
        item: exp.item || 'unspecified',
        amount_eur: calibrated.amount_eur,
        included: !!exp.included,
        satisfaction: exp.satisfaction,
        note: exp.note || null,
        source: calibrated.source,
        confidence: calibrated.confidence,
        proposed_amount: calibrated.proposed_amount,
        was_clamped: calibrated.was_clamped,
        range_used: calibrated.range_used,
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
      // A + B: spend ↔ perception causal coupling.
      //  - Expensive + great stage → "worth every euro" (value +, catDim +)
      //  - Expensive + bad stage   → "too expensive for what it was" (value −)
      //  - Cheap + great stage     → "great value" (value ++)
      const couplingDeltas = computeSpendPerceptionDeltas(calibrated, stageExpQuality, exp.category || 'other');
      if (Object.keys(couplingDeltas).length > 0) {
        sensationState = sensationTracker.applyStageDeltas(sensationState, couplingDeltas, `${stageLabel}__spend_coupling:${exp.category}`);
      }
    }
    // Attach declined items to the stageResult for surfacing in stage history
    if (declinedItems.length > 0) {
      stageResult.declined_purchases = declinedItems;
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

// ─── Spend ↔ perception coupling (A + B) ───
// Map spend category → sensation dim it most directly affects
const CATEGORY_TO_SENSATION_DIM = {
  dining: 'culinary', dinner: 'culinary', lunch: 'culinary', breakfast: 'culinary', room_service: 'culinary',
  bar: 'culinary', cocktails: 'culinary', wine: 'culinary',
  spa: 'service_quality', spa_treatment: 'service_quality',
  activities: 'amenity_usability', activity: 'amenity_usability', excursion: 'amenity_usability', tour: 'amenity_usability',
  upsell: 'personalization', room_upgrade: 'personalization', view_upgrade: 'personalization',
  gift_shop: 'aesthetic', boutique: 'aesthetic',
};

function computeSpendPerceptionDeltas(calibrated, expQuality, category) {
  const deltas = {};
  if (!calibrated.range_used || !calibrated.range_used.median) return deltas;
  const amt = calibrated.amount_eur;
  const median = calibrated.range_used.median || 1;
  const position = amt / median;   // 1.0 = at median, 1.5 = 50% premium, 0.6 = 40% below
  const catDim = CATEGORY_TO_SENSATION_DIM[category] || null;

  if (position > 1.15) {
    // EXPENSIVE
    if (expQuality >= 0.7) {            // expensive + great → justified
      deltas.value = 3;
      if (catDim) deltas[catDim] = 2;
    } else if (expQuality <= 0.4) {     // expensive + bad → loss aversion flash
      deltas.value = -5;
      if (catDim) deltas[catDim] = -3;
    } else {
      deltas.value = -1;
    }
  } else if (position < 0.85) {
    // CHEAP relative to expectation
    if (expQuality >= 0.7) deltas.value = 4; // "great value"
    // cheap + bad: no delta (expected failure mode)
  } else {
    // AT MEDIAN
    if (expQuality >= 0.7) deltas.value = 1;
    else if (expQuality <= 0.4) deltas.value = -1;
  }
  return deltas;
}

// ─── Purchase decision conditioning (C) ───
function shouldDeclinePurchase(persona, archetypeId, calibrated) {
  if (!calibrated.range_used) return { decline: false };
  const scrutiny = persona?.financial_behavior?.receipt_scrutiny || 50;
  const amt = calibrated.amount_eur;
  const { median, max } = calibrated.range_used;
  if (!median || amt <= 0) return { decline: false };

  // Budget_optimizer: decline 40% of items that cost > 130% of median
  if (archetypeId === 'budget_optimizer' && amt > median * 1.3 && Math.random() < 0.40) {
    return { decline: true, reason: 'budget_optimizer_threshold' };
  }
  // High receipt_scrutiny (≥75) + amount above max: decline 35%
  if (scrutiny >= 75 && max > 0 && amt > max * 1.05 && Math.random() < 0.35) {
    return { decline: true, reason: 'high_scrutiny_out_of_band' };
  }
  // Moderate scrutiny (60-75) + amount well above max: decline 20%
  if (scrutiny >= 60 && scrutiny < 75 && max > 0 && amt > max * 1.2 && Math.random() < 0.20) {
    return { decline: true, reason: 'moderate_scrutiny_outlier' };
  }
  return { decline: false };
}

// MeliáRewards tier × brand-match expectation table. Values are initial-state
// deltas applied on top of baselines (negative = higher expectation, so
// starting score is lower and staff must earn the top).
const MELIA_BRANDS = /meli[aá]|gran meli[aá]|paradisus|innside|sol\b|affiliated/i;
const MR_TIER_EXPECTATION = {
  ambassador: { personalization: -12, service_quality: -6, value: -4 },
  platinum:   { personalization: -9,  service_quality: -5, value: -2 },
  gold:       { personalization: -5,  service_quality: -2 },
  silver:     { personalization: -2 },
  none:       {},
};

function computeLoyaltyExpectationModifier({ persona, property, bookingContext }) {
  const tier = persona?.travel_history?.loyalty_tier_any_brand
    || persona?.loyalty_tier
    || 'none';
  const brand = String(property?.brand || property?.data_json?.brand || '');
  const isMeliaBrand = MELIA_BRANDS.test(brand);
  if (!isMeliaBrand) return null;
  // Only applies if the booking context signals loyalty recognition was expected
  if (!bookingContext?.loyalty_recognition_expected && tier === 'none') return null;
  return MR_TIER_EXPECTATION[tier] || null;
}

/**
 * Translate an operational_context (understaffing, rate scenario, F&B price hike)
 * into per-stage sensation drags so downstream narrative + reviews reflect the
 * stress. Keeps impacts bounded — this is a post-modulation correction, not a
 * replacement for the primary sensation deltas.
 *
 * operational_context shape (all optional):
 *   - understaff_pct_by_department: { front_desk: 20, fb_server: 30, ... }
 *   - revenue_scenario: { dinner_price_pct_delta, resort_fee_eur_delta, ... }
 *   - occupancy_stress_pct (0-100)
 */
function _buildOperationalStressDeltas(opCtx) {
  if (!opCtx) return null;
  const understaff = opCtx.understaff_pct_by_department || {};
  const rev = opCtx.revenue_scenario || {};
  const occ = typeof opCtx.occupancy_stress_pct === 'number' ? opCtx.occupancy_stress_pct : 0;

  const STAGE_DEPT_SENSITIVITY = {
    arrival:               { front_desk: { speed: -0.25, service_quality: -0.15, personalization: -0.10 }, guest_relations: { personalization: -0.15, service_quality: -0.10 } },
    room_first_impression: { housekeeper: { cleanliness: -0.20, aesthetic: -0.08 }, butler: { personalization: -0.15, service_quality: -0.10 } },
    morning_routine:       { fb_server: { speed: -0.18, service_quality: -0.12 }, fb_chef: { culinary: -0.10 }, housekeeper: { cleanliness: -0.08 } },
    daytime_activity:      { pool_attendant: { service_quality: -0.12, comfort_physical: -0.10 }, engineer_maint: { amenity_usability: -0.10, safety: -0.05 } },
    lunch:                 { fb_server: { speed: -0.15, service_quality: -0.10 }, fb_chef: { culinary: -0.08 } },
    afternoon_activity:    { spa_therapist: { service_quality: -0.18, amenity_usability: -0.10 } },
    dinner:                { fb_server: { speed: -0.20, service_quality: -0.18, personalization: -0.12 }, fb_chef: { culinary: -0.15 } },
    evening_leisure:       { fb_server: { service_quality: -0.10 }, concierge: { personalization: -0.10 } },
    last_morning:          { fb_server: { speed: -0.10 }, housekeeper: { cleanliness: -0.06 } },
    checkout:              { front_desk: { speed: -0.22, service_quality: -0.15, value: -0.08 } },
  };

  const byStage = {};
  for (const [stage, deptMap] of Object.entries(STAGE_DEPT_SENSITIVITY)) {
    const deltas = {};
    for (const [dept, sensMap] of Object.entries(deptMap)) {
      const stressPct = Math.max(0, understaff[dept] || 0) + occ * 0.25;
      if (stressPct < 1) continue;
      const scale = Math.min(1.0, stressPct / 30);
      for (const [dim, coef] of Object.entries(sensMap)) {
        deltas[dim] = (deltas[dim] || 0) + coef * stressPct * scale;
      }
    }
    if (typeof rev.dinner_price_pct_delta === 'number' && stage === 'dinner') {
      const hike = rev.dinner_price_pct_delta;
      deltas.value = (deltas.value || 0) - hike * 0.4;
      deltas.culinary = (deltas.culinary || 0) - Math.max(0, hike - 10) * 0.05;
    }
    if (typeof rev.resort_fee_eur_delta === 'number' && stage === 'checkout') {
      deltas.value = (deltas.value || 0) - rev.resort_fee_eur_delta * 0.12;
      deltas.service_quality = (deltas.service_quality || 0) - Math.max(0, rev.resort_fee_eur_delta) * 0.04;
    }
    for (const k of Object.keys(deltas)) deltas[k] = Math.round(Math.max(-12, Math.min(6, deltas[k])) * 10) / 10;
    if (Object.keys(deltas).length > 0) byStage[stage] = deltas;
  }
  return byStage;
}

function _applyOperationalStress(inputDeltas, opStressByStage, stageLabel) {
  if (!opStressByStage) return inputDeltas;
  const stressDeltas = opStressByStage[stageLabel];
  if (!stressDeltas) return inputDeltas;
  const out = { ...(inputDeltas || {}) };
  for (const [dim, v] of Object.entries(stressDeltas)) {
    out[dim] = (out[dim] || 0) + v;
  }
  return out;
}

module.exports = { runStay, pickStages, computeLoyaltyExpectationModifier };
