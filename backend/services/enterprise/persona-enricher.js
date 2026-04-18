/**
 * Persona Enricher — fills a generated persona with ~25 richer traits that
 * move it from "archetype + name + age" to a three-dimensional human.
 *
 * Five enrichment dimensions:
 *   1. Psychographics   Big Five (OCEAN) + trait optimism
 *   2. Consumption      dietary, alcohol, caffeine, adventurousness, chronotype
 *   3. Room prefs       bed firmness, pillows, temp, scent, noise sensitivity, blackout
 *   4. Travel history   lifetime stays band, loyalty tier, frequent traveler status
 *   5. Life context     recent major event, occasion, relationship length, stress
 *
 * Enrichment is DETERMINISTIC (no LLM call), seeded by archetype priors +
 * cultural cluster adjustments + light randomness. The output is merged into
 * the persona object so downstream code (narrative engine, sensation tracker,
 * review predictor, post-stay) can read the same structure.
 *
 * Causal hooks exposed:
 *   describeForStage(persona, stageLabel) returns only the relevant block for
 *     each stage (dining stages get dietary; arrival gets loyalty; etc.).
 *   applyTraitSensationModifiers(deltas, persona) adjusts sensation deltas
 *     based on neuroticism, optimism, noise sensitivity, and mismatches.
 */

// ─── Archetype priors ─────────────────────────────────────────────────
// Each field has a default distribution; archetype can override with a skew.

const ARCHETYPE_PRIORS = {
  business_traveler: {
    ocean:          { openness: 50, conscientiousness: 75, extraversion: 60, agreeableness: 45, neuroticism: 50 },
    alcohol:        { weights: { teetotal: 0.1, occasional: 0.35, wine_focused: 0.30, cocktail_enthusiast: 0.20, heavy: 0.05 } },
    caffeine:       { mean: 75, std: 15 },
    food_adventurousness: { mean: 55, std: 20 },
    chronotype:     { weights: { morning: 0.55, intermediate: 0.35, evening: 0.10 } },
    noise_sensitivity: { mean: 65, std: 20 },
    lifetime_stays: { weights: { '<5': 0.02, '5-20': 0.08, '20-50': 0.25, '50-200': 0.45, '200+': 0.20 } },
    loyalty_tier_any_brand: { weights: { none: 0.05, silver: 0.15, gold: 0.30, platinum: 0.35, ambassador: 0.15 } },
    review_style:   { weights: { detailed: 0.15, balanced: 0.45, terse: 0.35, non_writer: 0.05 } },
    complaint_channel: { weights: { in_person: 0.40, email_manager: 0.25, public_review: 0.20, silent: 0.15 } },
    staff_escalation_threshold: { mean: 45, std: 20 },
    trait_optimism: { mean: 55, std: 20 },
    life_stress:    { mean: 65, std: 20 },
  },
  luxury_seeker: {
    ocean:          { openness: 75, conscientiousness: 65, extraversion: 55, agreeableness: 60, neuroticism: 55 },
    alcohol:        { weights: { teetotal: 0.05, occasional: 0.20, wine_focused: 0.50, cocktail_enthusiast: 0.20, heavy: 0.05 } },
    caffeine:       { mean: 60, std: 20 },
    food_adventurousness: { mean: 75, std: 15 },
    chronotype:     { weights: { morning: 0.35, intermediate: 0.45, evening: 0.20 } },
    noise_sensitivity: { mean: 70, std: 18 },
    lifetime_stays: { weights: { '<5': 0.02, '5-20': 0.15, '20-50': 0.35, '50-200': 0.35, '200+': 0.13 } },
    loyalty_tier_any_brand: { weights: { none: 0.15, silver: 0.15, gold: 0.30, platinum: 0.30, ambassador: 0.10 } },
    review_style:   { weights: { detailed: 0.45, balanced: 0.35, terse: 0.15, non_writer: 0.05 } },
    complaint_channel: { weights: { in_person: 0.35, email_manager: 0.30, public_review: 0.30, silent: 0.05 } },
    staff_escalation_threshold: { mean: 35, std: 20 },
    trait_optimism: { mean: 65, std: 20 },
    life_stress:    { mean: 40, std: 25 },
  },
  honeymooner: {
    ocean:          { openness: 70, conscientiousness: 60, extraversion: 60, agreeableness: 70, neuroticism: 45 },
    alcohol:        { weights: { teetotal: 0.08, occasional: 0.25, wine_focused: 0.40, cocktail_enthusiast: 0.22, heavy: 0.05 } },
    caffeine:       { mean: 55, std: 20 },
    food_adventurousness: { mean: 70, std: 18 },
    chronotype:     { weights: { morning: 0.25, intermediate: 0.50, evening: 0.25 } },
    noise_sensitivity: { mean: 65, std: 18 },
    lifetime_stays: { weights: { '<5': 0.20, '5-20': 0.45, '20-50': 0.25, '50-200': 0.08, '200+': 0.02 } },
    loyalty_tier_any_brand: { weights: { none: 0.55, silver: 0.20, gold: 0.15, platinum: 0.08, ambassador: 0.02 } },
    review_style:   { weights: { detailed: 0.40, balanced: 0.35, terse: 0.15, non_writer: 0.10 } },
    complaint_channel: { weights: { in_person: 0.25, email_manager: 0.20, public_review: 0.40, silent: 0.15 } },
    staff_escalation_threshold: { mean: 50, std: 22 },
    trait_optimism: { mean: 75, std: 15 },
    life_stress:    { mean: 35, std: 20 },
  },
  family_vacationer: {
    ocean:          { openness: 55, conscientiousness: 70, extraversion: 60, agreeableness: 65, neuroticism: 55 },
    alcohol:        { weights: { teetotal: 0.25, occasional: 0.45, wine_focused: 0.20, cocktail_enthusiast: 0.08, heavy: 0.02 } },
    caffeine:       { mean: 70, std: 15 },
    food_adventurousness: { mean: 45, std: 20 },
    chronotype:     { weights: { morning: 0.65, intermediate: 0.30, evening: 0.05 } },
    noise_sensitivity: { mean: 55, std: 20 },
    lifetime_stays: { weights: { '<5': 0.15, '5-20': 0.40, '20-50': 0.30, '50-200': 0.13, '200+': 0.02 } },
    loyalty_tier_any_brand: { weights: { none: 0.45, silver: 0.25, gold: 0.18, platinum: 0.10, ambassador: 0.02 } },
    review_style:   { weights: { detailed: 0.30, balanced: 0.45, terse: 0.20, non_writer: 0.05 } },
    complaint_channel: { weights: { in_person: 0.45, email_manager: 0.25, public_review: 0.25, silent: 0.05 } },
    staff_escalation_threshold: { mean: 40, std: 20 },
    trait_optimism: { mean: 60, std: 20 },
    life_stress:    { mean: 60, std: 20 },
  },
  digital_nomad: {
    ocean:          { openness: 80, conscientiousness: 55, extraversion: 50, agreeableness: 50, neuroticism: 50 },
    alcohol:        { weights: { teetotal: 0.20, occasional: 0.35, wine_focused: 0.20, cocktail_enthusiast: 0.20, heavy: 0.05 } },
    caffeine:       { mean: 85, std: 10 },
    food_adventurousness: { mean: 70, std: 20 },
    chronotype:     { weights: { morning: 0.25, intermediate: 0.45, evening: 0.30 } },
    noise_sensitivity: { mean: 70, std: 18 },
    lifetime_stays: { weights: { '<5': 0.05, '5-20': 0.20, '20-50': 0.35, '50-200': 0.30, '200+': 0.10 } },
    loyalty_tier_any_brand: { weights: { none: 0.50, silver: 0.20, gold: 0.18, platinum: 0.10, ambassador: 0.02 } },
    review_style:   { weights: { detailed: 0.50, balanced: 0.30, terse: 0.15, non_writer: 0.05 } },
    complaint_channel: { weights: { in_person: 0.20, email_manager: 0.30, public_review: 0.45, silent: 0.05 } },
    staff_escalation_threshold: { mean: 50, std: 20 },
    trait_optimism: { mean: 55, std: 20 },
    life_stress:    { mean: 50, std: 20 },
  },
  budget_optimizer: {
    ocean:          { openness: 50, conscientiousness: 60, extraversion: 45, agreeableness: 45, neuroticism: 60 },
    alcohol:        { weights: { teetotal: 0.20, occasional: 0.50, wine_focused: 0.15, cocktail_enthusiast: 0.10, heavy: 0.05 } },
    caffeine:       { mean: 70, std: 15 },
    food_adventurousness: { mean: 45, std: 20 },
    chronotype:     { weights: { morning: 0.40, intermediate: 0.40, evening: 0.20 } },
    noise_sensitivity: { mean: 50, std: 20 },
    lifetime_stays: { weights: { '<5': 0.20, '5-20': 0.45, '20-50': 0.25, '50-200': 0.08, '200+': 0.02 } },
    loyalty_tier_any_brand: { weights: { none: 0.65, silver: 0.20, gold: 0.10, platinum: 0.04, ambassador: 0.01 } },
    review_style:   { weights: { detailed: 0.40, balanced: 0.35, terse: 0.20, non_writer: 0.05 } },
    complaint_channel: { weights: { in_person: 0.30, email_manager: 0.25, public_review: 0.40, silent: 0.05 } },
    staff_escalation_threshold: { mean: 35, std: 18 },
    trait_optimism: { mean: 50, std: 20 },
    life_stress:    { mean: 55, std: 20 },
  },
  loyalty_maximizer: {
    ocean:          { openness: 55, conscientiousness: 75, extraversion: 60, agreeableness: 55, neuroticism: 50 },
    alcohol:        { weights: { teetotal: 0.15, occasional: 0.35, wine_focused: 0.30, cocktail_enthusiast: 0.15, heavy: 0.05 } },
    caffeine:       { mean: 70, std: 15 },
    food_adventurousness: { mean: 60, std: 18 },
    chronotype:     { weights: { morning: 0.50, intermediate: 0.40, evening: 0.10 } },
    noise_sensitivity: { mean: 60, std: 18 },
    lifetime_stays: { weights: { '<5': 0.01, '5-20': 0.05, '20-50': 0.20, '50-200': 0.45, '200+': 0.29 } },
    loyalty_tier_any_brand: { weights: { none: 0.00, silver: 0.05, gold: 0.15, platinum: 0.45, ambassador: 0.35 } },
    review_style:   { weights: { detailed: 0.35, balanced: 0.40, terse: 0.20, non_writer: 0.05 } },
    complaint_channel: { weights: { in_person: 0.50, email_manager: 0.30, public_review: 0.15, silent: 0.05 } },
    staff_escalation_threshold: { mean: 40, std: 20 },
    trait_optimism: { mean: 60, std: 18 },
    life_stress:    { mean: 55, std: 20 },
  },
  event_attendee: {
    ocean:          { openness: 60, conscientiousness: 60, extraversion: 70, agreeableness: 55, neuroticism: 50 },
    alcohol:        { weights: { teetotal: 0.10, occasional: 0.30, wine_focused: 0.20, cocktail_enthusiast: 0.30, heavy: 0.10 } },
    caffeine:       { mean: 70, std: 15 },
    food_adventurousness: { mean: 55, std: 20 },
    chronotype:     { weights: { morning: 0.30, intermediate: 0.40, evening: 0.30 } },
    noise_sensitivity: { mean: 55, std: 20 },
    lifetime_stays: { weights: { '<5': 0.10, '5-20': 0.35, '20-50': 0.30, '50-200': 0.20, '200+': 0.05 } },
    loyalty_tier_any_brand: { weights: { none: 0.30, silver: 0.25, gold: 0.25, platinum: 0.15, ambassador: 0.05 } },
    review_style:   { weights: { detailed: 0.25, balanced: 0.45, terse: 0.25, non_writer: 0.05 } },
    complaint_channel: { weights: { in_person: 0.35, email_manager: 0.20, public_review: 0.35, silent: 0.10 } },
    staff_escalation_threshold: { mean: 50, std: 20 },
    trait_optimism: { mean: 60, std: 20 },
    life_stress:    { mean: 50, std: 20 },
  },
};

// Dietary distribution (independent of archetype, lightly culture-skewed)
const DIETARY_WEIGHTS_DEFAULT = {
  none: 0.60, vegetarian: 0.12, pescatarian: 0.06, vegan: 0.03,
  gluten_free: 0.04, lactose_intolerant: 0.05, halal: 0.02, kosher: 0.01,
  keto: 0.03, nut_allergy: 0.02, shellfish_allergy: 0.02,
};
const DIETARY_CULTURE_SKEW = {
  german_dach:     { vegetarian: 1.5, vegan: 1.7 },
  anglo_uk_ireland:{ vegetarian: 1.3, gluten_free: 1.3 },
  anglo_us_canada: { gluten_free: 1.5, keto: 1.8, lactose_intolerant: 1.3 },
  middle_east_gcc: { halal: 120.0, vegetarian: 0.4, vegan: 0.3, keto: 0.5 }, // halal dominates (>90% real)
  east_asian:      { vegan: 0.7, lactose_intolerant: 2.5 },
  latin_spain_italy:{ vegan: 0.6, vegetarian: 0.8 },
  latam:           { vegan: 0.6 },
  nordic:          { vegetarian: 1.6, vegan: 1.8, gluten_free: 1.4 },
  french:          { vegan: 0.5, vegetarian: 0.8 },
};

// ─── Helpers ──────────────────────────────────────────────────────────

function rollFromWeights(weights) {
  const entries = Object.entries(weights);
  const total = entries.reduce((s, [, w]) => s + w, 0);
  let r = Math.random() * total;
  for (const [k, w] of entries) { r -= w; if (r <= 0) return k; }
  return entries[0][0];
}

function rollNormal(mean, std, min = 0, max = 100) {
  // Box-Muller
  const u1 = Math.random() || 1e-9, u2 = Math.random();
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  return Math.max(min, Math.min(max, Math.round(mean + z * std)));
}

function rollBigFive(priors) {
  return {
    openness:          rollNormal(priors.openness, 15),
    conscientiousness: rollNormal(priors.conscientiousness, 15),
    extraversion:      rollNormal(priors.extraversion, 15),
    agreeableness:     rollNormal(priors.agreeableness, 15),
    neuroticism:       rollNormal(priors.neuroticism, 15),
  };
}

function rollDietary(cluster) {
  const base = { ...DIETARY_WEIGHTS_DEFAULT };
  const skew = DIETARY_CULTURE_SKEW[cluster] || {};
  const weighted = {};
  for (const [k, v] of Object.entries(base)) weighted[k] = v * (skew[k] || 1);
  const primary = rollFromWeights(weighted);
  // 15% chance of secondary allergy on top of primary
  const restrictions = primary === 'none' ? [] : [primary];
  if (Math.random() < 0.15) {
    const add = rollFromWeights({ nut_allergy: 0.3, shellfish_allergy: 0.3, gluten_free: 0.2, lactose_intolerant: 0.2 });
    if (!restrictions.includes(add)) restrictions.push(add);
  }
  return restrictions.length === 0 ? ['none'] : restrictions;
}

function rollChronotype(priors) {
  const type = rollFromWeights(priors.chronotype.weights);
  const wake = type === 'morning' ? rollNormal(6.5, 0.8, 5, 9)
            : type === 'intermediate' ? rollNormal(8, 0.8, 6, 10)
            : rollNormal(10, 1.2, 8, 12);
  const sleep = type === 'morning' ? rollNormal(22.5, 0.7, 21, 24)
              : type === 'intermediate' ? rollNormal(23.5, 0.8, 22, 26)
              : rollNormal(25.5, 1.0, 24, 28);
  return { chronotype: type, typical_wake_hour: Math.round(wake * 10) / 10, typical_sleep_hour: Math.round((sleep % 24) * 10) / 10 };
}

function rollRoomPreferences() {
  return {
    bed_firmness_preferred: rollFromWeights({ firm: 0.30, medium: 0.50, soft: 0.20 }),
    pillow_count_preferred: rollFromWeights({ '1': 0.15, '2': 0.50, '3': 0.25, '4': 0.10 }),
    room_temp_preferred_c: rollNormal(20, 1.5, 17, 24),
    scent_tolerance: rollFromWeights({ avoids: 0.20, neutral: 0.55, enjoys: 0.25 }),
    blackout_need: rollFromWeights({ essential: 0.30, preferred: 0.45, none: 0.25 }),
    shower_preference: rollFromWeights({ shower_only: 0.55, bath_preferred: 0.25, both_value: 0.20 }),
  };
}

function rollLifeContext(archetypeId) {
  // Recent major event — rarely used as story beat; most guests have 'none'.
  const recentEvent = rollFromWeights({
    none: 0.70, promotion: 0.06, milestone_birthday: 0.05, engagement: 0.03,
    redundancy: 0.03, bereavement: 0.03, baby: 0.02, divorce: 0.02, anniversary_milestone: 0.06,
  });
  // Occasion for this specific trip
  let occasion;
  if (archetypeId === 'honeymooner') occasion = 'honeymoon';
  else if (archetypeId === 'business_traveler' || archetypeId === 'loyalty_maximizer') occasion = rollFromWeights({ business: 0.70, no_special: 0.30 });
  else if (archetypeId === 'family_vacationer') occasion = rollFromWeights({ no_special: 0.50, school_holiday: 0.30, birthday: 0.10, anniversary: 0.05, milestone: 0.05 });
  else occasion = rollFromWeights({ no_special: 0.55, anniversary: 0.15, birthday: 0.12, escape: 0.10, milestone: 0.08 });

  return {
    recent_major_life_event: recentEvent,
    occasion_this_trip: occasion,
    relationship_length_years: ['honeymooner', 'family_vacationer'].includes(archetypeId)
      ? Math.max(0, Math.round(rollNormal(8, 7, 0, 40)))
      : null,
  };
}

function rollFinancialBehavior(archetypeId, priors) {
  const scrutiny = archetypeId === 'budget_optimizer' ? 85
                  : archetypeId === 'business_traveler' ? 70
                  : archetypeId === 'loyalty_maximizer' ? 50
                  : archetypeId === 'luxury_seeker' ? 25
                  : archetypeId === 'honeymooner' ? 30
                  : 50;
  return {
    receipt_scrutiny: rollNormal(scrutiny, 15),
    upsell_receptivity: {
      dining:       rollNormal(archetypeId === 'luxury_seeker' || archetypeId === 'honeymooner' ? 70 : 50, 20),
      spa:          rollNormal(archetypeId === 'luxury_seeker' || archetypeId === 'honeymooner' ? 65 : archetypeId === 'business_traveler' ? 25 : 40, 20),
      activities:   rollNormal(archetypeId === 'family_vacationer' || archetypeId === 'honeymooner' ? 65 : 45, 20),
      room_upgrade: rollNormal(archetypeId === 'loyalty_maximizer' ? 75 : archetypeId === 'luxury_seeker' ? 60 : 35, 20),
      minibar:      rollNormal(archetypeId === 'business_traveler' ? 55 : 25, 20),
    },
  };
}

// ─── Public API ────────────────────────────────────────────────────────

/**
 * Enrich a persona with ~25 additional fields. Pure function (except RNG).
 */
function enrich({ persona, culturalContext, bookingContext }) {
  if (!persona) return persona;
  const archetypeId = persona.archetype_id || persona._archetype_id || 'business_traveler';
  const priors = ARCHETYPE_PRIORS[archetypeId] || ARCHETYPE_PRIORS.business_traveler;
  const cluster = culturalContext?.culture_cluster || '_default';

  const psychographics = {
    ocean: rollBigFive(priors.ocean),
    trait_optimism: rollNormal(priors.trait_optimism.mean, priors.trait_optimism.std),
    life_stress_back_home: rollNormal(priors.life_stress.mean, priors.life_stress.std),
  };

  const consumption = {
    dietary_restrictions: rollDietary(cluster),
    alcohol_pattern: rollFromWeights(priors.alcohol.weights),
    caffeine_dependency: rollNormal(priors.caffeine.mean, priors.caffeine.std),
    food_adventurousness: rollNormal(priors.food_adventurousness.mean, priors.food_adventurousness.std),
    ...rollChronotype(priors),
  };

  const roomPrefs = rollRoomPreferences();

  const travelHistory = {
    lifetime_hotel_stays_band: rollFromWeights(priors.lifetime_stays.weights),
    loyalty_tier_any_brand: rollFromWeights(priors.loyalty_tier_any_brand.weights),
    reference_class: null, // filled below
  };
  // Build a rough "reference class" string used to compare this property to past experience
  travelHistory.reference_class = ({
    '<5':     'has stayed at a hotel only a handful of times; easily impressed but also uncertain what to expect',
    '5-20':   'has stayed at several hotels; some sense of what good service looks like',
    '20-50':  'regular traveler; clear mental map of what a good hotel delivers',
    '50-200': 'seasoned traveler; calibrated against many 4-5★ properties; hard to impress with basics',
    '200+':   'hyper-frequent traveler; has seen it all; every small detail is noted and compared',
  })[travelHistory.lifetime_hotel_stays_band];

  const reviewBehavior = {
    review_writing_style: rollFromWeights(priors.review_style.weights),
    complaint_channel_preferred: rollFromWeights(priors.complaint_channel.weights),
    staff_escalation_threshold: rollNormal(priors.staff_escalation_threshold.mean, priors.staff_escalation_threshold.std),
  };

  const lifeContext = rollLifeContext(archetypeId);
  const financial = rollFinancialBehavior(archetypeId, priors);

  // Sensitivity numbers derived from OCEAN
  const noise_sensitivity = rollNormal(priors.noise_sensitivity.mean, priors.noise_sensitivity.std);

  // Identity-signaling style — how this guest signals "who they are" in the
  // review. Rolled deterministically from archetype + travel history +
  // psychographics + consumption. Drives the review's vocabulary, references,
  // and the details they choose to highlight. Without this, reviews sound
  // archetype-generic ("a luxury traveler would say X") instead of
  // identity-specific ("a 200+-stay ambassador-tier connoisseur says X").
  const identitySignalingStyle = rollIdentitySignalingStyle({
    archetypeId,
    travelHistory,
    psychographics,
    consumption,
    financial,
    reviewBehavior,
  });

  const enriched = {
    ...persona,
    enriched: true,
    psychographics,
    consumption,
    room_preferences: roomPrefs,
    noise_sensitivity_0_100: noise_sensitivity,
    travel_history: travelHistory,
    review_behavior: reviewBehavior,
    life_context: lifeContext,
    financial_behavior: financial,
    identity_signaling_style: identitySignalingStyle,
  };
  return enriched;
}

// ─── Identity-signaling style ──────────────────────────────────────────
// Each style is a recognizable "voice" in reviews. The review-predictor
// reads this block and shifts vocabulary / references / detail focus
// accordingly. Catalog mirrors actual recurring reviewer personas on
// TripAdvisor / Booking corpora.
const IDENTITY_STYLE_CATALOG = {
  connoisseur_comparing: {
    label: 'connoisseur comparing against other luxury properties',
    vocab_cues: ['compared to the Aman', 'akin to the Cheval Blanc', 'not quite the level of', 'reminiscent of'],
    detail_focus: ['materials quality', 'service micro-moments', 'room aesthetic', 'menu execution'],
    signature_move: 'names 2-3 peer properties by name and ranks this stay against them',
  },
  seasoned_comparator: {
    label: 'frequent traveler with a clear mental benchmark',
    vocab_cues: ['in my 20+ years of staying at', 'as a platinum member of', 'we travel a lot and'],
    detail_focus: ['what this property does better/worse than average', 'consistency', 'loyalty recognition'],
    signature_move: 'opens with travel credentials, then rates against mental benchmark',
  },
  wide_eyed_newcomer: {
    label: 'first-time luxury traveler, effusive wonder',
    vocab_cues: ['we had never experienced', 'I did not know hotels could be like this', 'felt like a dream'],
    detail_focus: ['everything novel', 'staff kindness', 'view', 'unexpected luxuries'],
    signature_move: 'uses superlatives freely, describes small details as magical',
  },
  food_expert: {
    label: 'culinary-focused guest with technical vocabulary',
    vocab_cues: ['the sauce had', 'perfectly rendered', 'reduction was', 'sommelier recommended', 'al dente'],
    detail_focus: ['individual dishes by name', 'wine pairings', 'chef interaction', 'breakfast spread'],
    signature_move: 'devotes 40%+ of the review to F&B detail regardless of stay length',
  },
  value_auditor: {
    label: 'price/value scrutinizer with receipts',
    vocab_cues: ['at €X per night', 'the breakfast was not worth', 'for the price', 'value-for-money'],
    detail_focus: ['itemized spend', 'what was included vs extra', 'surprise fees', 'loyalty benefits'],
    signature_move: 'always mentions exact price paid and computes cost per key moment',
  },
  brand_insider: {
    label: 'loyalty program insider who speaks brand fluently',
    vocab_cues: ['as a Bonvoy/MeliáRewards/Accor Plus member', 'my tier benefits included', 'cat 6 points booking'],
    detail_focus: ['tier recognition', 'welcome gift', 'lounge access', 'upgrade offered', 'points earned'],
    signature_move: 'frames the stay as a brand interaction, not a property-only experience',
  },
  practical_reviewer: {
    label: 'logistics-and-infrastructure-first reviewer',
    vocab_cues: ['wifi measured', 'desk setup was', 'outlet placement', 'noise level in the room'],
    detail_focus: ['wifi speed', 'work ergonomics', 'quiet', 'transport access'],
    signature_move: 'leads with functional facts before any emotional colour',
  },
  storyteller: {
    label: 'narrative-driven reviewer who writes a mini story',
    vocab_cues: ['on our third morning', 'the moment that stayed with me', 'looking back'],
    detail_focus: ['specific scenes', 'staff names', 'small gestures', 'the arc of the trip'],
    signature_move: 'structures the review chronologically with a clear emotional arc',
  },
  aesthetic_purist: {
    label: 'design and aesthetics obsessive',
    vocab_cues: ['the palette', 'volumes', 'natural materials', 'sightlines', 'choreography of spaces'],
    detail_focus: ['architecture', 'lighting', 'textures', 'landscaping', 'photographability'],
    signature_move: 'describes physical environment in architectural-review vocabulary',
  },
  family_reviewer: {
    label: 'parent reviewing from the kids\' experience',
    vocab_cues: ['our 6-year-old', 'the kids loved', 'as parents', 'for families'],
    detail_focus: ['kids club', 'pool depth', 'kid menu', 'family room layout', 'safety'],
    signature_move: 'leads with how the kids reacted, parent enjoyment second',
  },
  warm_generalist: {
    label: 'warm-tone generalist review, no specific signature',
    vocab_cues: ['we had a lovely time', 'highly recommend', 'wonderful stay'],
    detail_focus: ['overall feel', 'staff', 'location'],
    signature_move: 'positive, emotional, few specifics',
  },
};

function rollIdentitySignalingStyle({ archetypeId, travelHistory, psychographics, consumption, financial, reviewBehavior }) {
  const stays = travelHistory?.lifetime_hotel_stays_band;
  const loyalty = travelHistory?.loyalty_tier_any_brand;
  const openness = psychographics?.ocean?.openness ?? 50;
  const conscientiousness = psychographics?.ocean?.conscientiousness ?? 50;
  const alcohol = consumption?.alcohol_pattern;
  const foodAdv = consumption?.food_adventurousness ?? 50;
  const scrutiny = financial?.receipt_scrutiny ?? 50;
  const reviewStyle = reviewBehavior?.review_writing_style;

  // Weighted candidate scoring — pick the top, but allow some randomness
  const scores = {
    connoisseur_comparing: 0,
    seasoned_comparator: 0,
    wide_eyed_newcomer: 0,
    food_expert: 0,
    value_auditor: 0,
    brand_insider: 0,
    practical_reviewer: 0,
    storyteller: 0,
    aesthetic_purist: 0,
    family_reviewer: 0,
    warm_generalist: 1.0, // baseline fallback
  };

  // Travel history signals
  if (stays === '200+') { scores.connoisseur_comparing += 3.0; scores.seasoned_comparator += 2.5; scores.practical_reviewer += 1.0; }
  else if (stays === '50-200') { scores.seasoned_comparator += 2.5; scores.connoisseur_comparing += 1.2; }
  else if (stays === '<5') { scores.wide_eyed_newcomer += 3.5; scores.storyteller += 0.8; }
  else if (stays === '5-20') { scores.storyteller += 1.0; scores.warm_generalist += 0.6; }

  // Loyalty tier
  if (['platinum', 'ambassador'].includes(loyalty)) scores.brand_insider += 3.0;
  else if (loyalty === 'gold') scores.brand_insider += 1.2;

  // Food signals
  if (foodAdv >= 75 && (alcohol === 'wine_focused' || alcohol === 'cocktail_enthusiast')) scores.food_expert += 3.0;
  else if (foodAdv >= 70) scores.food_expert += 1.5;

  // Money signals
  if (scrutiny >= 75) scores.value_auditor += 3.0;
  else if (scrutiny >= 65) scores.value_auditor += 1.2;

  // Openness → aesthetics or storytelling
  if (openness >= 75) { scores.aesthetic_purist += 1.8; scores.storyteller += 1.2; }

  // Conscientiousness → practical/value
  if (conscientiousness >= 75) { scores.practical_reviewer += 1.5; scores.value_auditor += 0.8; }

  // Review style signal
  if (reviewStyle === 'detailed') { scores.food_expert += 0.8; scores.aesthetic_purist += 0.6; scores.storyteller += 0.6; }
  else if (reviewStyle === 'terse') { scores.practical_reviewer += 1.2; scores.warm_generalist += 1.0; }

  // Archetype floors
  if (archetypeId === 'business_traveler') { scores.practical_reviewer += 2.0; scores.seasoned_comparator += 1.0; }
  if (archetypeId === 'luxury_seeker') { scores.connoisseur_comparing += 1.8; scores.aesthetic_purist += 1.2; }
  if (archetypeId === 'honeymooner') { scores.storyteller += 2.0; scores.aesthetic_purist += 0.8; }
  if (archetypeId === 'family_vacationer') scores.family_reviewer += 3.0;
  if (archetypeId === 'digital_nomad') scores.practical_reviewer += 2.5;
  if (archetypeId === 'budget_optimizer') scores.value_auditor += 2.5;
  if (archetypeId === 'loyalty_maximizer') { scores.brand_insider += 2.5; scores.seasoned_comparator += 1.2; }

  // Softmax-ish pick (temperature 1.8 — weighted but some randomness)
  const T = 1.8;
  const entries = Object.entries(scores);
  const weighted = entries.map(([k, s]) => [k, Math.exp(s / T)]);
  const total = weighted.reduce((sum, [, w]) => sum + w, 0);
  let r = Math.random() * total;
  let chosen = weighted[0][0];
  for (const [k, w] of weighted) { r -= w; if (r <= 0) { chosen = k; break; } }

  const def = IDENTITY_STYLE_CATALOG[chosen];
  return {
    style_key: chosen,
    style_label: def.label,
    vocab_cues: def.vocab_cues,
    detail_focus: def.detail_focus,
    signature_move: def.signature_move,
  };
}

/**
 * Return only the enrichment fields relevant to this stage. Keeps prompts
 * focused and token-budget sane.
 */
function describeForStage(persona, stageLabel) {
  if (!persona?.enriched) return '';

  const o = persona.psychographics?.ocean || {};
  const lines = ['=== WHO YOU ARE (deep traits) ==='];

  // Big Five compact description — always relevant
  const traitLabels = [];
  if (o.openness >= 70) traitLabels.push('open to new experiences');
  else if (o.openness <= 30) traitLabels.push('prefers the familiar');
  if (o.conscientiousness >= 70) traitLabels.push('detail-oriented, plans ahead');
  else if (o.conscientiousness <= 30) traitLabels.push('spontaneous, lets things unfold');
  if (o.extraversion >= 70) traitLabels.push('social, energized by people');
  else if (o.extraversion <= 30) traitLabels.push('reserved, recharges alone');
  if (o.agreeableness >= 70) traitLabels.push('warm, gives benefit of the doubt');
  else if (o.agreeableness <= 30) traitLabels.push('critical, less patient with service hiccups');
  if (o.neuroticism >= 70) traitLabels.push('anxious baseline, notices what could go wrong');
  else if (o.neuroticism <= 30) traitLabels.push('emotionally steady');
  lines.push(`Personality: ${traitLabels.join('; ') || 'balanced across traits'}.`);

  if (persona.psychographics?.trait_optimism != null) {
    const opt = persona.psychographics.trait_optimism;
    const label = opt >= 70 ? 'glass-half-full; expects things to go well'
                : opt <= 30 ? 'glass-half-empty; primed to notice disappointment'
                : 'realistic; takes things as they come';
    lines.push(`Baseline mood: ${label}.`);
  }
  if (persona.psychographics?.life_stress_back_home >= 65) {
    lines.push(`Life context: carrying significant stress from back home (${persona.psychographics.life_stress_back_home}/100) — this holiday is also an escape.`);
  }

  // Travel history — always relevant for reference class
  if (persona.travel_history?.reference_class) {
    lines.push(`Travel reference class: ${persona.travel_history.reference_class}.`);
    if (persona.travel_history.loyalty_tier_any_brand && persona.travel_history.loyalty_tier_any_brand !== 'none') {
      lines.push(`Holds ${persona.travel_history.loyalty_tier_any_brand} tier at a hotel loyalty program (not necessarily this brand).`);
    }
  }

  // Life context — anchor for story beats
  if (persona.life_context?.recent_major_life_event && persona.life_context.recent_major_life_event !== 'none') {
    lines.push(`Recent life event colouring this trip: ${persona.life_context.recent_major_life_event.replace(/_/g, ' ')}.`);
  }
  if (persona.life_context?.occasion_this_trip && persona.life_context.occasion_this_trip !== 'no_special') {
    lines.push(`Occasion for this trip: ${persona.life_context.occasion_this_trip.replace(/_/g, ' ')}.`);
  }
  if (persona.life_context?.relationship_length_years != null) {
    lines.push(`Relationship length (with partner): ${persona.life_context.relationship_length_years} years.`);
  }

  // Stage-specific fields
  const mealStages = new Set(['evening_1', 'lunch', 'dinner', 'morning_routine', 'last_morning']);
  if (mealStages.has(stageLabel) && persona.consumption) {
    const con = persona.consumption;
    const dietary = (con.dietary_restrictions || ['none']).filter(d => d !== 'none');
    if (dietary.length) lines.push(`Dietary: ${dietary.join(', ')}. The restaurant MUST accommodate or the meal is spoiled.`);
    if (con.alcohol_pattern && con.alcohol_pattern !== 'teetotal') lines.push(`Drinks ${con.alcohol_pattern.replace(/_/g, ' ')}.`);
    if (con.alcohol_pattern === 'teetotal') lines.push(`Teetotal — does not drink alcohol; notice if staff pushes wine pairings.`);
    if (con.caffeine_dependency >= 70) lines.push(`Caffeine dependent (${con.caffeine_dependency}/100) — morning coffee is non-negotiable.`);
    if (con.food_adventurousness <= 35) lines.push(`Conservative eater (adventurousness ${con.food_adventurousness}/100) — sticks to familiar dishes.`);
    if (con.food_adventurousness >= 75) lines.push(`Adventurous eater (${con.food_adventurousness}/100) — actively seeks local specialties.`);
  }

  const morningStages = new Set(['morning_routine', 'last_morning']);
  if (morningStages.has(stageLabel) && persona.consumption?.chronotype) {
    const c = persona.consumption;
    lines.push(`Chronotype: ${c.chronotype} person (wakes ~${c.typical_wake_hour}h, sleeps ~${c.typical_sleep_hour}h). ${c.chronotype === 'evening' ? 'Morning stages feel early and groggy.' : c.chronotype === 'morning' ? 'Morning is prime time; energetic.' : 'Neutral.'}`);
  }

  const roomStages = new Set(['room_first_impression', 'morning_routine', 'last_morning']);
  if (roomStages.has(stageLabel) && persona.room_preferences) {
    const rp = persona.room_preferences;
    lines.push(`Room preferences: ${rp.bed_firmness_preferred} bed, ${rp.pillow_count_preferred} pillows, ${rp.room_temp_preferred_c}°C ideal, ${rp.blackout_need} blackout, scent ${rp.scent_tolerance}, ${rp.shower_preference.replace(/_/g, ' ')}. Mismatches register as friction.`);
  }
  if (persona.noise_sensitivity_0_100 >= 70) {
    lines.push(`Noise sensitivity: ${persona.noise_sensitivity_0_100}/100 — notices sounds others would miss; AC hum, neighbor TV, corridor chatter matter.`);
  }

  const checkinStages = new Set(['arrival', 'checkout']);
  if (checkinStages.has(stageLabel) && persona.review_behavior) {
    const rb = persona.review_behavior;
    lines.push(`Communication style: complaints via ${rb.complaint_channel_preferred.replace(/_/g, ' ')}; escalates at ${rb.staff_escalation_threshold}/100 friction threshold; review style when they write: ${rb.review_writing_style}.`);
  }

  const financialStages = new Set(['checkout', 'arrival']);
  if (financialStages.has(stageLabel) && persona.financial_behavior) {
    lines.push(`Receipt scrutiny: ${persona.financial_behavior.receipt_scrutiny}/100 — ${persona.financial_behavior.receipt_scrutiny >= 70 ? 'checks every line' : persona.financial_behavior.receipt_scrutiny <= 30 ? 'barely glances' : 'scans for big items'}.`);
  }

  return lines.join('\n');
}

/**
 * Adjust LLM sensation deltas based on personality traits.
 * Neurotic guests magnify negatives; optimistic guests boost positives.
 * Noise-sensitive guests take bigger comfort hits from crowd/amenity-usability negatives.
 * Dietary/room mismatches (signaled via moment keywords) aren't handled here — they
 * come from the narrative side.
 */
function applyTraitSensationModifiers(sensationDeltas, persona) {
  if (!sensationDeltas || !persona?.enriched) return sensationDeltas;
  const o = persona.psychographics?.ocean || {};
  const optimism = persona.psychographics?.trait_optimism || 55;
  const noise = persona.noise_sensitivity_0_100 || 50;

  const neuroticBoost = o.neuroticism >= 70 ? 1.30 : o.neuroticism >= 55 ? 1.12 : 1.0;
  const lowNeuroDampener = o.neuroticism <= 30 ? 0.80 : 1.0;
  const optimismBoost = optimism >= 70 ? 1.20 : optimism >= 55 ? 1.08 : 1.0;
  const pessimismDrag = optimism <= 30 ? 0.80 : 1.0;

  const out = { ...sensationDeltas };
  for (const k of Object.keys(out)) {
    const v = out[k];
    if (typeof v !== 'number') continue;
    if (v < 0) {
      out[k] = Math.round(v * neuroticBoost * lowNeuroDampener);
      // Noise-sensitive guests take extra hit on crowd/amenity related negatives
      if (noise >= 70 && (k === 'crowd' || k === 'amenity_usability')) {
        out[k] = Math.round(out[k] * 1.25);
      }
    } else if (v > 0) {
      out[k] = Math.round(v * optimismBoost * pessimismDrag);
    }
  }
  return out;
}

module.exports = {
  enrich,
  describeForStage,
  applyTraitSensationModifiers,
  ARCHETYPE_PRIORS,
  DIETARY_WEIGHTS_DEFAULT,
};
