/**
 * Physical State Tracker — models a guest's body across the stay, so reactions
 * depend on biology, not just sensation deltas. A tired, jetlagged honeymooner
 * at 1 am reacts differently to a slow check-in than a well-rested one at noon.
 *
 * Six dimensions, all 0–100 where higher = more intense bodily signal:
 *   fatigue                  how physically tired right now
 *   hunger                   how empty the stomach is
 *   jetlag_severity          body clock misalignment
 *   hangover                 day-after residue from alcohol
 *   intoxication             current-stage alcohol effect
 *   sleep_quality_last_night roll result (low = rough night)
 *
 * The module is pure math + data; it does NOT call the LLM. The narrative
 * engine reads the state (via describeForPrompt) and is told how to let it
 * shape the stage narrative.
 */

// ─── Timezone / distance from Menorca (UTC+1/+2) in hours ───────────────
const TIMEZONE_HOURS_FROM_MENORCA = {
  // Europe — same/adjacent
  GB: 1, IE: 1, PT: 1,
  DE: 0, FR: 0, ES: 0, IT: 0, NL: 0, BE: 0, AT: 0, CH: 0, DK: 0,
  SE: 0, NO: 0, FI: 1, PL: 0, CZ: 0, HU: 0,
  // Mid
  GR: 1, TR: 1, IL: 1, AE: 3, SA: 2, EG: 1,
  RU: 2, UA: 1,
  // Far
  US_EAST: 6, US_WEST: 9, CA: 6, MX: 7, BR: 4, AR: 4, CL: 5,
  JP: 7, CN: 7, HK: 7, SG: 7, KR: 7, IN: 4.5, AU: 9, NZ: 11,
  // Default for unknown
  _default: 2,
};

function hoursFromMenorca(originCountryIso) {
  if (!originCountryIso) return TIMEZONE_HOURS_FROM_MENORCA._default;
  const iso = String(originCountryIso).toUpperCase();
  if (TIMEZONE_HOURS_FROM_MENORCA[iso] != null) return TIMEZONE_HOURS_FROM_MENORCA[iso];
  // US handled generically (no east/west from 2-letter iso)
  if (iso === 'US') return 7;
  return TIMEZONE_HOURS_FROM_MENORCA._default;
}

function clamp(n, min = 0, max = 100) { return Math.max(min, Math.min(max, n)); }

// ─── Affliction catalog — small body afflictions that can onset during stay ─
// Each flag, once active, persists and modulates stages. Severity 0-1.
const AFFLICTION_CATALOG = {
  sunburn:         { trigger: 'outdoor_activity_no_protection', sensation_drag: { comfort_physical: -10, aesthetic: -4 }, decay_per_stage: 0.08, narrative_hint: 'shoulders / nose tender; aversion to sun' },
  blister:         { trigger: 'heavy_walking',                  sensation_drag: { comfort_physical: -8 },                  decay_per_stage: 0.06, narrative_hint: 'heel raw; changes shoes / limps slightly' },
  stomach_upset:   { trigger: 'rich_food_plus_alcohol',         sensation_drag: { culinary: -12, comfort_physical: -8 },   decay_per_stage: 0.12, narrative_hint: 'queasy; avoiding heavy food; bathroom trips' },
  headache:        { trigger: 'dehydration_or_hangover',        sensation_drag: { comfort_physical: -10, amenity_usability: -4 }, decay_per_stage: 0.18, narrative_hint: 'throbbing temples; bright light hits harder' },
  menstrual:       { trigger: 'probabilistic_female_18_50',     sensation_drag: { comfort_physical: -6, personalization: -2 }, decay_per_stage: 0.04, narrative_hint: 'cramps / fatigue; more reliant on room downtime' },
  minor_cold:      { trigger: 'climate_shift_or_aircon_chill',  sensation_drag: { comfort_physical: -9, service_quality: -2 }, decay_per_stage: 0.05, narrative_hint: 'sniffles / scratchy throat; craves hot drinks' },
  allergy_flare:   { trigger: 'seasonal_pollen_or_dust',        sensation_drag: { comfort_physical: -6, amenity_usability: -3 }, decay_per_stage: 0.08, narrative_hint: 'sneezing / itchy eyes; sensitive to scented products' },
  back_pain:       { trigger: 'long_flight_or_bed_too_soft',    sensation_drag: { comfort_physical: -8 },                    decay_per_stage: 0.05, narrative_hint: 'lower back stiff; avoiding certain positions' },
};


// ─── Stage-type → typical physical deltas ─────────────────────────────
// Positive number = that dimension increases (worse fatigue/hunger/etc.)
const STAGE_PHYSICAL_DELTAS = {
  arrival:                 { fatigue: 5,  hunger: 8,   thirst: 15, caffeine_need: 5,  intoxication: -20 },
  room_first_impression:   { fatigue: 2,  hunger: 5,   thirst: 3 },
  evening_1:               { fatigue: 6,  hunger: 18,  thirst: 10 },
  morning_routine:         { fatigue: -15, hunger: 20, thirst: 8, caffeine_need: -40, hangover: -20 },
  daytime_activity:        { fatigue: 12, hunger: 15,  thirst: 22, sun_exposure_fatigue: 18 },
  lunch:                   { fatigue: 3,  hunger: -55, thirst: -30 },
  afternoon_activity:      { fatigue: 14, hunger: 20,  thirst: 24, sun_exposure_fatigue: 16 },
  dinner:                  { fatigue: 5,  hunger: -60, thirst: -25 },
  evening_leisure:         { fatigue: 9,  thirst: 5 },
  last_morning:            { fatigue: -10, hunger: 18, thirst: 8, caffeine_need: -35, hangover: -15 },
  checkout:                { fatigue: 3,  hunger: 5,   thirst: 5 },
};

const OUTDOOR_STAGES = new Set(['daytime_activity', 'afternoon_activity']);
const WALKING_STAGES = new Set(['daytime_activity', 'afternoon_activity', 'evening_leisure']);

// Stage triggers a "night roll" — sleep quality computed from sensation state
const NIGHT_BOUNDARY_STAGES = new Set(['morning_routine', 'last_morning']);

// ─── Public API ────────────────────────────────────────────────────────

/**
 * Seed physical state for a guest arriving at the property.
 */
function initialState({ persona = {}, culturalContext = null, bookingContext = null, arrivalHourLocal = null } = {}) {
  const origin = culturalContext?.origin_country_iso || persona?.origin_country_iso || null;
  const tzDiff = hoursFromMenorca(origin);

  // Jetlag roughly proportional to timezone diff; capped at 100.
  // Also scaled by direction ambiguity and persona.age (older guests jetlag worse).
  const age = typeof persona.age === 'number' ? persona.age : 40;
  const ageMultiplier = age >= 55 ? 1.25 : age >= 40 ? 1.05 : 0.9;
  const jetlag = clamp(Math.abs(tzDiff) * 15 * ageMultiplier);

  // Fatigue from travel: far origin = more fatigue. Also lead_time short means rushed.
  const travelBase = Math.min(60, Math.abs(tzDiff) * 8);
  const leadTime = bookingContext?.lead_time_days ?? 14;
  const rushBonus = leadTime <= 3 ? 15 : leadTime <= 7 ? 8 : 0;
  const fatigue = clamp(18 + travelBase + rushBonus);

  // Hunger on arrival — depends on arrival hour. If unknown, mid-afternoon ~40.
  const h = typeof arrivalHourLocal === 'number' ? arrivalHourLocal : 14;
  // Hunger peaks 4h after a typical meal (8am, 1pm, 8pm).
  const lastMealHour = h >= 20 ? 20 : h >= 13 ? 13 : h >= 8 ? 8 : 20;
  const hoursSinceMeal = ((h + 24) - lastMealHour) % 24;
  const hunger = clamp(20 + hoursSinceMeal * 10);

  // Seed additional physiological dimensions
  const sex = persona?.gender || persona?.sex || null;
  const isMenstrualCandidate = (sex === 'female' || sex === 'f' || sex === 'F')
    && typeof age === 'number' && age >= 18 && age <= 50;
  const longFlight = Math.abs(tzDiff) >= 4;

  const initialAfflictions = [];
  // Back pain seed — 15% prob for long flights, 5% otherwise
  if (Math.random() < (longFlight ? 0.15 : 0.05)) {
    initialAfflictions.push({
      kind: 'back_pain',
      severity: 0.2 + Math.random() * 0.2,
      onset_stage: 'arrival',
      description: AFFLICTION_CATALOG.back_pain.narrative_hint,
    });
  }
  // Menstrual — ~18% probability (realistic baseline for a random 3-night window on candidates)
  if (isMenstrualCandidate && Math.random() < 0.18) {
    initialAfflictions.push({
      kind: 'menstrual',
      severity: 0.2 + Math.random() * 0.4,
      onset_stage: 'arrival',
      description: AFFLICTION_CATALOG.menstrual.narrative_hint,
    });
  }

  return {
    fatigue: Math.round(fatigue),
    hunger: Math.round(hunger),
    thirst: 30,  // baseline dry-after-travel
    caffeine_need: 20,
    sun_exposure_fatigue: 0,
    temperature_discomfort: 0,
    temperature_skew: null, // 'cold' | 'hot' | null
    jetlag_severity: Math.round(jetlag),
    hangover: 0,
    intoxication: 0,
    sleep_quality_last_night: null, // unknown until first night boundary
    active_afflictions: initialAfflictions,
    _origin_country: origin,
    _timezone_hours_diff: tzDiff,
    _gender: sex,
    _age: age,
    _history: [],
    _seed_snapshot: {
      fatigue: Math.round(fatigue),
      jetlag_severity: Math.round(jetlag),
      hunger: Math.round(hunger),
      initial_afflictions: initialAfflictions.map(a => a.kind),
    },
  };
}

/**
 * Roll sleep quality from a sensation snapshot. Good comfort + quiet + safe →
 * restorative sleep; opposite → rough night. Also penalized by current hangover.
 */
function rollSleepQuality(sensationSnapshot, currentState) {
  if (!sensationSnapshot) return 60;
  const comfort = sensationSnapshot.comfort_physical ?? 55;
  const cleanliness = sensationSnapshot.cleanliness ?? 60;
  const crowd = sensationSnapshot.crowd ?? 55; // "crowd" low = overcrowded/noisy
  const safety = sensationSnapshot.safety ?? 65;
  const hangover = currentState?.hangover ?? 0;
  const intoxication = currentState?.intoxication ?? 0;

  // Weighted combo — high is restorative
  let sleep = 0.40 * comfort + 0.25 * crowd + 0.20 * cleanliness + 0.15 * safety;
  // Hangover reduces restoration. Intoxication above 60 actually fragments sleep.
  sleep -= Math.min(20, hangover * 0.3);
  sleep -= intoxication > 60 ? 15 : 0;
  // A bit of natural variance so identical states don't produce identical sleep.
  sleep += (Math.random() - 0.5) * 10;
  return Math.round(clamp(sleep));
}

/**
 * Apply the deterministic physical deltas of a stage transition, plus any
 * optional LLM-reported overrides (e.g. guest drank heavily → intoxication +40).
 *
 * @param {Object} state             current physical state
 * @param {Object} opts
 * @param {string} opts.stageLabel   e.g. 'dinner'
 * @param {Object} opts.sensationSnapshot  post-stage sensations, used for night roll
 * @param {Array}  opts.expenses     this stage's expenses (to infer alcohol intake)
 * @param {Object} opts.llmDelta     optional LLM-reported physical_state_delta
 */
function applyStage(state, { stageLabel, sensationSnapshot = null, expenses = [], llmDelta = null, externalContext = null } = {}) {
  const next = { ...state, active_afflictions: [...(state.active_afflictions || [])] };
  const deltas = { ...(STAGE_PHYSICAL_DELTAS[stageLabel] || { fatigue: 4, hunger: 8, thirst: 5 }) };

  // Weather modulates thirst, sun exposure, and temperature discomfort
  const nightNum = Math.max(1, externalContext?.night_number || 1);
  const stageWeather = externalContext?.weather_array?.[nightNum - 1] || externalContext?.weather || null;
  if (stageWeather) {
    const tempC = stageWeather.temp_c ?? stageWeather.temperature_c ?? 22;
    const condition = (stageWeather.condition || '').toLowerCase();
    // Hot, sunny outdoor stage → amplify thirst + sun fatigue
    if (OUTDOOR_STAGES.has(stageLabel)) {
      if (tempC >= 30) { deltas.thirst = (deltas.thirst || 0) + 12; deltas.sun_exposure_fatigue = (deltas.sun_exposure_fatigue || 0) + 10; }
      else if (tempC >= 25) { deltas.thirst = (deltas.thirst || 0) + 6; deltas.sun_exposure_fatigue = (deltas.sun_exposure_fatigue || 0) + 4; }
      if (condition.includes('sun') || condition.includes('clear')) {
        deltas.sun_exposure_fatigue = (deltas.sun_exposure_fatigue || 0) + 6;
      }
    }
    // Temperature discomfort vs guest expectation (assume 22°C optimal)
    const tempDeviation = Math.abs(tempC - 22);
    if (tempDeviation > 5) {
      const skew = tempC > 22 ? 'hot' : 'cold';
      next.temperature_skew = skew;
      next.temperature_discomfort = clamp((state.temperature_discomfort || 0) + (tempDeviation - 5) * 3);
    }
  }

  // Caffeine cue: hotel coffee this stage? (any "breakfast" or "coffee" expense implies yes)
  const hadCoffee = (expenses || []).some(e => {
    const it = ((e.item || '') + ' ' + (e.category || '')).toLowerCase();
    return it.includes('coffee') || it.includes('espresso') || it.includes('cappuccino') || it.includes('breakfast');
  });
  if (hadCoffee) deltas.caffeine_need = (deltas.caffeine_need || 0) - 50;

  // Drinking water from minibar / restaurant counts toward thirst relief
  const hadWater = (expenses || []).some(e => {
    const it = ((e.item || '') + ' ' + (e.category || '')).toLowerCase();
    return it.includes('water') || it.includes('juice') || (e.category === 'lunch' || e.category === 'dinner' || e.category === 'breakfast');
  });
  if (hadWater && !deltas.thirst) deltas.thirst = -15;

  // Alcohol intake inference: any bar/dinner category with amount >= 8 → +intox
  const drinkValue = (expenses || []).reduce((s, e) => {
    const cat = (e.category || '').toLowerCase();
    const amt = Number(e.amount_eur) || 0;
    if ((cat === 'bar' || cat.includes('wine') || cat.includes('cocktail') || cat === 'dinner') && amt >= 8) {
      // Rough proxy: €8 ≈ 1 drink. Age / BMI ignored.
      return s + Math.min(3, amt / 12);
    }
    return s;
  }, 0);
  const intoxDelta = Math.round(drinkValue * 18);
  if (intoxDelta > 0) deltas.intoxication = (deltas.intoxication || 0) + intoxDelta;

  // If we cross a "morning after" boundary, roll sleep + apply consequences
  let sleepQualityThisRoll = null;
  if (NIGHT_BOUNDARY_STAGES.has(stageLabel)) {
    sleepQualityThisRoll = rollSleepQuality(sensationSnapshot, state);
    next.sleep_quality_last_night = sleepQualityThisRoll;
    // Sleep restoration: 85-good → fatigue -35. 40-bad → fatigue -10 only.
    const fatigueRestore = -(sleepQualityThisRoll * 0.4 + 5);
    deltas.fatigue = Math.round(fatigueRestore);
    // Hangover decays in the morning regardless of whether we drank
    deltas.hangover = (deltas.hangover || 0);
    // If previous night had heavy intoxication, convert to hangover
    if (state.intoxication >= 40) {
      const hangoverGain = Math.round((state.intoxication - 30) * 0.8);
      deltas.hangover = Math.max(deltas.hangover || 0, hangoverGain);
    }
    // Intoxication resets overnight
    next.intoxication = 0;
  } else {
    // Non-night stages decay intoxication organically
    deltas.intoxication = (deltas.intoxication || 0) - 10;
  }

  // Jetlag decays per stage (rough: ~1 day recovered per day; 3-4 stages/day)
  deltas.jetlag_severity = (deltas.jetlag_severity || 0) - 5;

  // LLM-reported overrides win for the dimensions it chose to address
  if (llmDelta && typeof llmDelta === 'object') {
    for (const k of Object.keys(llmDelta)) {
      if (k in next && typeof llmDelta[k] === 'number') {
        deltas[k] = (deltas[k] || 0) + Math.round(llmDelta[k]);
      }
    }
  }

  // Apply
  for (const [k, v] of Object.entries(deltas)) {
    if (typeof v !== 'number') continue;
    if (k === 'sleep_quality_last_night') continue;
    if (!(k in next) || typeof next[k] !== 'number') continue;
    next[k] = clamp(next[k] + v);
  }

  // Probabilistic onset of new afflictions based on stage context
  const triggeredAfflictions = [];
  const hasAffliction = (kind) => next.active_afflictions.some(a => a.kind === kind);

  // Sunburn: outdoor + high sun_exposure_fatigue, no prior sunburn
  if (OUTDOOR_STAGES.has(stageLabel) && next.sun_exposure_fatigue >= 45 && !hasAffliction('sunburn') && Math.random() < 0.35) {
    triggeredAfflictions.push({
      kind: 'sunburn',
      severity: 0.25 + Math.random() * 0.35,
      onset_stage: stageLabel,
      description: AFFLICTION_CATALOG.sunburn.narrative_hint,
    });
  }
  // Blister: heavy walking stages cumulative
  if (WALKING_STAGES.has(stageLabel) && !hasAffliction('blister') && Math.random() < 0.12) {
    triggeredAfflictions.push({
      kind: 'blister',
      severity: 0.15 + Math.random() * 0.25,
      onset_stage: stageLabel,
      description: AFFLICTION_CATALOG.blister.narrative_hint,
    });
  }
  // Stomach upset: heavy dinner + heavy drinks, post-dinner/morning
  if ((stageLabel === 'dinner' || stageLabel === 'morning_routine' || stageLabel === 'last_morning')
      && state.intoxication >= 40 && !hasAffliction('stomach_upset') && Math.random() < 0.15) {
    triggeredAfflictions.push({
      kind: 'stomach_upset',
      severity: 0.3 + Math.random() * 0.3,
      onset_stage: stageLabel,
      description: AFFLICTION_CATALOG.stomach_upset.narrative_hint,
    });
  }
  // Headache: dehydration or severe hangover or severe jetlag
  const dehydrationPct = next.thirst >= 75 ? 0.25 : 0;
  const hangoverPct = next.hangover >= 55 ? 0.40 : 0;
  const jetlagPct = next.jetlag_severity >= 70 ? 0.15 : 0;
  const headacheProb = Math.max(dehydrationPct, hangoverPct, jetlagPct);
  if (headacheProb > 0 && !hasAffliction('headache') && Math.random() < headacheProb) {
    triggeredAfflictions.push({
      kind: 'headache',
      severity: 0.25 + Math.random() * 0.35,
      onset_stage: stageLabel,
      description: AFFLICTION_CATALOG.headache.narrative_hint,
    });
  }

  next.active_afflictions.push(...triggeredAfflictions);

  // Decay existing afflictions per stage
  next.active_afflictions = next.active_afflictions
    .map(a => {
      const decay = AFFLICTION_CATALOG[a.kind]?.decay_per_stage || 0.10;
      const newSev = Math.max(0, a.severity - decay);
      return { ...a, severity: newSev };
    })
    .filter(a => a.severity > 0.04);

  next._history = [...(state._history || []), {
    stage: stageLabel,
    deltas,
    triggered_afflictions: triggeredAfflictions.map(a => a.kind),
    snapshot: {
      fatigue: next.fatigue,
      hunger: next.hunger,
      thirst: next.thirst,
      caffeine_need: next.caffeine_need,
      sun_exposure_fatigue: next.sun_exposure_fatigue,
      temperature_discomfort: next.temperature_discomfort,
      temperature_skew: next.temperature_skew,
      jetlag_severity: next.jetlag_severity,
      hangover: next.hangover,
      intoxication: next.intoxication,
      sleep_quality_last_night: next.sleep_quality_last_night,
      active_afflictions: next.active_afflictions.map(a => ({ kind: a.kind, severity: Math.round(a.severity * 100) / 100 })),
    },
    ts: Date.now(),
  }];
  return next;
}

/**
 * Human-readable physical state block for insertion into the narrative prompt.
 * Maps raw 0-100 values into plain-English bands the LLM can reason about.
 */
function describeForPrompt(state) {
  if (!state) return '';

  const band = (val, labels) => {
    if (val == null) return null;
    if (val >= 80) return labels[4];
    if (val >= 60) return labels[3];
    if (val >= 40) return labels[2];
    if (val >= 20) return labels[1];
    return labels[0];
  };

  const fatigueLabels = ['fresh and energetic', 'mildly tired', 'moderately tired', 'quite tired', 'exhausted'];
  const hungerLabels = ['satiated', 'mildly peckish', 'notably hungry', 'very hungry', 'ravenous'];
  const thirstLabels = ['well-hydrated', 'slightly thirsty', 'thirsty', 'very thirsty', 'parched'];
  const caffeineLabels = ['caffeinated', 'fine', 'starting to want coffee', 'craving coffee', 'desperate for caffeine'];
  const sunFatigueLabels = ['none', 'mild warmth', 'sun-tired', 'heat-drained', 'sun-exhausted / risk of heatstroke'];
  const jetlagLabels = ['on local time', 'slight jetlag', 'moderate jetlag', 'strong jetlag', 'severe jetlag / body clock wrecked'];
  const hangoverLabels = ['none', 'trace', 'noticeable headache', 'real hangover', 'bedbound hangover'];
  const intoxLabels = ['sober', 'a glass in', 'pleasant buzz', 'tipsy', 'drunk'];
  const sleepLabels = ['terrible sleep (1-2h broken)', 'poor sleep', 'average sleep', 'restful sleep', 'extraordinary sleep'];

  const lines = ['=== YOUR BODY RIGHT NOW ==='];
  lines.push(`Fatigue: ${band(state.fatigue, fatigueLabels)} (${state.fatigue}/100)`);
  lines.push(`Hunger: ${band(state.hunger, hungerLabels)} (${state.hunger}/100)`);
  if (state.thirst > 20) lines.push(`Thirst: ${band(state.thirst, thirstLabels)} (${state.thirst}/100)`);
  if (state.caffeine_need > 30) lines.push(`Caffeine: ${band(state.caffeine_need, caffeineLabels)} (${state.caffeine_need}/100)`);
  if (state.sun_exposure_fatigue > 20) lines.push(`Sun exposure: ${band(state.sun_exposure_fatigue, sunFatigueLabels)} (${state.sun_exposure_fatigue}/100)`);
  if (state.temperature_discomfort > 15) {
    lines.push(`Temperature discomfort: ${state.temperature_discomfort}/100 — feels too ${state.temperature_skew || 'extreme'}`);
  }
  if (state.jetlag_severity > 10) {
    lines.push(`Jetlag: ${band(state.jetlag_severity, jetlagLabels)} (${state.jetlag_severity}/100)${state._timezone_hours_diff ? ` — ${Math.abs(state._timezone_hours_diff)}h offset from origin` : ''}`);
  }
  if (state.hangover > 10) lines.push(`Hangover: ${band(state.hangover, hangoverLabels)} (${state.hangover}/100)`);
  if (state.intoxication > 10) lines.push(`Alcohol in system: ${band(state.intoxication, intoxLabels)} (${state.intoxication}/100)`);
  if (typeof state.sleep_quality_last_night === 'number') {
    lines.push(`Last night you had: ${band(state.sleep_quality_last_night, sleepLabels)} (${state.sleep_quality_last_night}/100)`);
  }

  // Active afflictions
  if (state.active_afflictions && state.active_afflictions.length > 0) {
    lines.push('');
    lines.push('ACTIVE BODILY AFFLICTIONS (persistent, colour this stage):');
    for (const a of state.active_afflictions) {
      const sevLabel = a.severity >= 0.55 ? 'significant' : a.severity >= 0.30 ? 'moderate' : 'mild';
      lines.push(`• ${a.kind.replace(/_/g, ' ')} — ${sevLabel} (${a.description})`);
    }
  }

  lines.push('');
  lines.push('HOW THIS SHAPES YOUR REACTIONS THIS STAGE:');
  const guidance = [];
  if (state.fatigue >= 70) guidance.push('• Tired: noise feels 1.4× louder, waits feel longer, small details you would normally enjoy feel like friction.');
  if (state.fatigue >= 85) guidance.push('• Exhausted: your tolerance is near zero; any hiccup becomes a grievance; even delight is muted.');
  if (state.hunger >= 60) guidance.push('• Hungry: you are less patient; meal speed and quality matter disproportionately; you may cut conversations short.');
  if (state.thirst >= 70) guidance.push('• Very thirsty: your throat is dry, you scan for water, you rate drink availability highly.');
  if (state.caffeine_need >= 60) guidance.push('• Coffee-starved: before coffee, you are irritable and monosyllabic; the first sip is disproportionately pleasurable.');
  if (state.sun_exposure_fatigue >= 55) guidance.push('• Sun-drained: you seek shade, crave cold water, step out of the pool even though you were enjoying it.');
  if (state.temperature_discomfort >= 40) guidance.push(`• Temperature is wrong (too ${state.temperature_skew}): you fidget, adjust clothing, mention it if asked.`);
  if (state.jetlag_severity >= 50) guidance.push('• Jetlag: mornings feel surreal, evenings you crash early; your internal clock is off — note the dissonance.');
  if (state.hangover >= 40) guidance.push('• Hangover: headache, dry mouth, coffee and water matter more than food; bright light and noise hit harder; you regret last night.');
  if (state.intoxication >= 40 && state.intoxication < 70) guidance.push('• Tipsy: emotions amplified, positives land more vividly, judgment loosens; you talk more.');
  if (state.intoxication >= 70) guidance.push('• Drunk: time feels fuzzy; decisions impulsive; service quality hardly registers; memory of this stage will be spotty.');
  if (typeof state.sleep_quality_last_night === 'number' && state.sleep_quality_last_night < 40) guidance.push('• Rough night: you are irritable and foggy; this colours the whole morning.');
  if (typeof state.sleep_quality_last_night === 'number' && state.sleep_quality_last_night >= 75) guidance.push('• Restorative sleep: you feel reset; even small delights register strongly.');

  // Affliction-specific guidance
  for (const a of (state.active_afflictions || [])) {
    if (a.kind === 'sunburn' && a.severity >= 0.3) guidance.push('• Sunburn: aversion to more sun; cotton fabric sting; cool shower feels amazing.');
    if (a.kind === 'headache' && a.severity >= 0.3) guidance.push('• Headache: bright light and noise hit harder; you move more carefully.');
    if (a.kind === 'stomach_upset' && a.severity >= 0.3) guidance.push('• Stomach upset: avoiding rich food; simple bread/soup sounds good; bathroom proximity matters.');
    if (a.kind === 'menstrual' && a.severity >= 0.3) guidance.push('• Menstrual discomfort: cramps make you want the room to yourself for a bit; hot water bottle / chocolate is a treat.');
    if (a.kind === 'back_pain' && a.severity >= 0.3) guidance.push('• Back pain: bed firmness registers sharply; shifting in chairs, the right pillow is the difference between comfort and misery.');
    if (a.kind === 'blister' && a.severity >= 0.3) guidance.push('• Blister: limp slightly, change shoes, complain about distance to amenities.');
    if (a.kind === 'minor_cold' && a.severity >= 0.3) guidance.push('• Minor cold: sniffles, prefer indoor/warm, hot tea matters, voice slightly off.');
    if (a.kind === 'allergy_flare' && a.severity >= 0.3) guidance.push('• Allergy flare: sensitive to scented toiletries / cleaning products; eyes itchy; tissue usage up.');
  }

  if (guidance.length === 0) guidance.push('• Your body is in reasonable shape; physical state is not dominant this stage.');
  lines.push(guidance.join('\n'));
  return lines.join('\n');
}

/**
 * Post-process the sensation deltas that the LLM produced, applying physical
 * state modifiers. Tired/hungry/jetlagged/hungover guests produce more
 * negative deltas per unit of friction, and dampened positives.
 *
 * Called AFTER the LLM returns sensation_deltas for a stage.
 */
function applySensationModifiers(sensationDeltas, state) {
  if (!sensationDeltas || !state) return sensationDeltas;
  const out = { ...sensationDeltas };

  const negativeMultiplier = 1
    + (state.fatigue >= 70 ? 0.35 : state.fatigue >= 50 ? 0.15 : 0)
    + (state.hunger >= 70 ? 0.25 : state.hunger >= 50 ? 0.10 : 0)
    + (state.thirst >= 70 ? 0.15 : state.thirst >= 55 ? 0.08 : 0)
    + (state.caffeine_need >= 70 ? 0.10 : 0)
    + (state.sun_exposure_fatigue >= 60 ? 0.15 : 0)
    + (state.temperature_discomfort >= 50 ? 0.15 : state.temperature_discomfort >= 30 ? 0.08 : 0)
    + (state.hangover >= 50 ? 0.40 : state.hangover >= 30 ? 0.20 : 0)
    + ((state.sleep_quality_last_night != null && state.sleep_quality_last_night < 40) ? 0.25 : 0);

  const positiveMultiplier = 1
    - (state.fatigue >= 80 ? 0.25 : state.fatigue >= 60 ? 0.10 : 0)
    - (state.hangover >= 40 ? 0.20 : 0)
    - (state.sun_exposure_fatigue >= 70 ? 0.15 : 0)
    + ((state.sleep_quality_last_night != null && state.sleep_quality_last_night >= 75) ? 0.15 : 0)
    + (state.intoxication >= 30 && state.intoxication < 70 ? 0.10 : 0);

  // Affliction drag: each active affliction adds a small, dimension-specific pull
  const afflictionDrag = {};
  for (const a of (state.active_afflictions || [])) {
    const cat = AFFLICTION_CATALOG[a.kind];
    if (!cat) continue;
    for (const [dim, base] of Object.entries(cat.sensation_drag || {})) {
      afflictionDrag[dim] = (afflictionDrag[dim] || 0) + base * a.severity;
    }
  }

  for (const k of Object.keys(out)) {
    const v = out[k];
    if (typeof v !== 'number') continue;
    if (v < 0) out[k] = Math.round(v * negativeMultiplier);
    else if (v > 0) out[k] = Math.round(v * positiveMultiplier);
  }
  // Add affliction drag on top (these dims may not be in LLM output; we merge)
  for (const [dim, drag] of Object.entries(afflictionDrag)) {
    const rounded = Math.round(drag);
    if (rounded === 0) continue;
    out[dim] = (out[dim] || 0) + rounded;
  }
  return out;
}

/**
 * Compact summary for the stay record.
 */
function summary(state) {
  if (!state) return null;
  const allAfflictionsSeen = new Set();
  for (const h of (state._history || [])) {
    for (const k of (h.triggered_afflictions || [])) allAfflictionsSeen.add(k);
  }
  for (const a of (state._seed_snapshot?.initial_afflictions || [])) allAfflictionsSeen.add(a);
  return {
    final_fatigue: state.fatigue,
    final_hunger: state.hunger,
    final_thirst: state.thirst,
    final_caffeine_need: state.caffeine_need,
    final_sun_exposure_fatigue: state.sun_exposure_fatigue,
    final_temperature_discomfort: state.temperature_discomfort,
    final_temperature_skew: state.temperature_skew,
    final_jetlag_severity: state.jetlag_severity,
    final_hangover: state.hangover,
    arrival_jetlag_severity: state._seed_snapshot?.jetlag_severity ?? null,
    arrival_fatigue: state._seed_snapshot?.fatigue ?? null,
    timezone_hours_diff_from_property: state._timezone_hours_diff ?? null,
    origin_country: state._origin_country ?? null,
    gender: state._gender ?? null,
    age: state._age ?? null,
    n_night_rolls: (state._history || []).filter(h => h.snapshot.sleep_quality_last_night != null).length,
    last_night_sleep_quality: state.sleep_quality_last_night,
    afflictions_experienced: Array.from(allAfflictionsSeen),
    afflictions_active_at_checkout: (state.active_afflictions || []).map(a => ({ kind: a.kind, severity: Math.round(a.severity * 100) / 100 })),
    history: state._history,
  };
}

module.exports = {
  initialState,
  applyStage,
  describeForPrompt,
  applySensationModifiers,
  rollSleepQuality,
  summary,
  hoursFromMenorca,
  TIMEZONE_HOURS_FROM_MENORCA,
  STAGE_PHYSICAL_DELTAS,
  AFFLICTION_CATALOG,
};
