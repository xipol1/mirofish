/**
 * Narrative Engine — simulates a physical hotel stay stage-by-stage.
 *
 * For each stage (arrival, room_first_impression, evening_1, morning_routine, ...):
 *   1. LLM generates the agent's experience based on:
 *      - Their persona + archetype behavior pattern
 *      - The property's actual data (amenities, SOPs, brand standards, known_weaknesses)
 *      - Historical review signals (calibrates expectations)
 *      - Current sensation state (how they feel right now)
 *   2. Returns: narrative text + sensation deltas + expenses + moments (positive/negative)
 *
 * The output of each stage feeds into the next (state persists across the stay).
 */

const { callAIJSON } = require('../ai');
const datasets = require('../datasets');
const path = require('path');
const fs = require('fs');

const BEHAVIORS_PATH = path.join(__dirname, '..', '..', 'data', 'industries', 'hospitality', 'stay_behaviors.json');
const SENSATION_PATH = path.join(__dirname, '..', '..', 'data', 'industries', 'hospitality', 'sensation_dimensions.json');

let _behaviors = null, _sensations = null;
function behaviors() { if (!_behaviors) _behaviors = JSON.parse(fs.readFileSync(BEHAVIORS_PATH, 'utf-8')); return _behaviors; }
function sensations() { if (!_sensations) _sensations = JSON.parse(fs.readFileSync(SENSATION_PATH, 'utf-8')); return _sensations; }

function getArchetypeBehavior(archetypeId) {
  return behaviors().archetypes[archetypeId] || null;
}

/**
 * Simulates one stage of the stay.
 *
 * @param {Object} ctx - {
 *   stage_label, persona, archetype_behavior, property, sensation_state, previous_stages,
 *   stay_context: { night_number, trip_purpose, arrival_context, stay_length_nights }
 * }
 * @returns {Promise<Object>} - {
 *   narrative: string, sensation_deltas: {dim: delta},
 *   expenses: [{category, item, amount_eur, included}],
 *   moments: { positive: [{description}], negative: [{description}] },
 *   decisions: { dining, activities, upsells_accepted, ... },
 *   internal_thoughts: string,
 *   abandonment_signal: boolean
 * }
 */
async function simulateStage(ctx) {
  const {
    stage_label,
    persona,
    archetype_behavior,
    property,
    sensation_state,
    previous_stages = [],
    stay_context = {},
    calibration_signals = {},
    injected_event = null,
    cultural_context = null,
    booking_context = null,
    staff_in_play = [],
    stage_external_block = '',
  } = ctx;

  const prompt = buildStagePrompt({
    stage_label,
    persona,
    archetype_behavior,
    property,
    sensation_state,
    previous_stages,
    stay_context,
    calibration_signals,
    injected_event,
    cultural_context,
    booking_context,
    staff_in_play,
    stage_external_block,
  });

  const result = await callAIJSON(prompt, { maxTokens: 1400, temperature: 0.8 });
  return normalizeStageOutput(result, stage_label);
}

function buildStagePrompt(ctx) {
  const {
    stage_label,
    persona,
    archetype_behavior,
    property,
    sensation_state,
    physical_state = null,
    companions = [],
    previous_stages,
    stay_context,
    calibration_signals,
    injected_event = null,
    cultural_context = null,
    booking_context = null,
    staff_in_play = [],
    stage_external_block = '',
  } = ctx;

  const stageBehavior = archetype_behavior?.daily_routine?.[stage_label] || null;
  const spendingRanges = archetype_behavior?.daily_spending_eur_range || {};
  const sensationWeights = archetype_behavior?.sensation_weights || {};
  const upsellProbs = archetype_behavior?.upsell_acceptance_probability || {};
  const memorableTriggers = archetype_behavior?.memorable_moment_triggers || {};
  const themeScope = archetype_behavior?.theme_scope || null;

  const currentSensations = Object.fromEntries(
    Object.keys(sensations().dimensions).map(d => [d, sensation_state[d] ?? 50])
  );

  const previousNarrative = previous_stages.slice(-3).map(p =>
    `[${p.stage}] ${p.narrative?.substring(0, 260) || '(no narrative)'}`
  ).join('\n') || '(this is the first stage)';

  const propertySummary = buildPropertySummary(property);
  const calibrationSummary = buildCalibrationSummary(calibration_signals);

  // Tier-specific moment ratio guidance — empirical luxury review corpora show
  // far higher positive:negative than the generic 3:1 rule-of-thumb.
  const propertyTier = (property?.data_json?.identity?.tier || property?.data_json?.tier || property?.tier || '').toLowerCase();
  const tierMomentGuidance = ({
    luxury:   'For THIS luxury property, real Booking/TripAdvisor 9.2+ reviews show a positive:negative ratio of 8:1 to 12:1. Aim for 1-2 positive moments per stage and 0 negatives by default. Only include a negative when there is a MANDATORY INCIDENT this stage or the narrative genuinely produced friction a privileged guest would write about (hidden fee, staff mistake, noisy neighbor). Do NOT pad negatives to feel balanced.',
    premium:  'For this premium property, real reviews show a positive:negative ratio of 5:1 to 8:1. Aim for 1-2 positives per stage, 0-1 negative. Negatives only when narrative-justified.',
    upscale:  'For this upscale property, real reviews show a positive:negative ratio of 3:1 to 5:1. Balanced moments.',
    midscale: 'For this midscale property, 2:1 to 3:1 positive:negative. Balanced.',
    economy:  'For this economy property, 1:1 to 2:1. Friction is common and worth naming.',
  }[propertyTier]) || '';

  // Adversarial event block: forces the LLM to actually incorporate incidents
  // rather than sliding into marketing-speak
  const eventBlock = injected_event
    ? require('./adversarial-events').buildEventPromptBlock(injected_event)
    : '';

  // Cultural + booking + staff prompts (Tier 0 additions)
  const culturalBlock = cultural_context?.narrative_block || '';
  const bookingBlock = booking_context?.narrative_block || '';
  const staffBlock = staff_in_play?.length
    ? require('./staff-registry').buildStaffPromptBlock(staff_in_play)
    : '';

  // Physical state block — fatigue, hunger, jetlag, hangover, sleep quality.
  // Makes the guest's body a first-class input to the narrative.
  const physicalBlock = physical_state
    ? require('./physical-state').describeForPrompt(physical_state)
    : '';

  // Companion block — partner/children whose moods shape the primary guest's experience.
  const companionBlock = companions?.length > 0
    ? require('./companion').buildCompanionPrompt(companions)
    : '';

  // Enriched persona block — Big Five, dietary, chronotype, room prefs, review style.
  // Only emits the fields relevant for this stage.
  const personaTraitsBlock = persona?.enriched
    ? require('./persona-enricher').describeForStage(persona, stage_label)
    : '';

  // Theme scope block — restricts what topics this archetype talks about.
  // Fixes backtest v2 per-segment precision issue (was 17-29%; target: 50%+).
  const themeScopeBlock = themeScope ? `
=== THEME SCOPE (CRITICAL — respect these constraints) ===
Your archetype, ${persona.archetype_label}, has a specific set of topics it cares about.
PRIMARY topics this guest discusses naturally: ${(themeScope.primary_themes || []).join(', ')}
RARELY mentioned by this guest: ${(themeScope.rarely_mentioned || []).join(', ')}
NEVER mentioned by this guest: ${(themeScope.never_mentioned || []).join(', ')}

When writing moments_positive and moments_negative, STICK TO the primary topics.
Do NOT invent moments about topics in the NEVER list.
Only mention RARELY topics if the incident or property feature directly forces them.
A business traveler does not comment on the kids club. A honeymooner does not obsess over wifi speed. A budget optimizer does not write about Thai spa treatments. Respect the archetype.
` : '';

  // Target star outcome for this stay — shapes the narrative tone so the
  // simulation produces a realistic mix of outcomes instead of all-5-star
  const targetStars = stay_context.target_star_rating;
  const targetBlock = targetStars
    ? `
=== TARGET OUTCOME FOR THIS STAY ===
${require('./star-sampler').buildStarTargetPromptBlock(targetStars)}
Your stage output must be consistent with this overall target. Over the course of this stay, the accumulated sensation_deltas, moments, and adversarial events should ADD UP to a ${targetStars}-star experience — not automatically default to 5-star.
`
    : '';

  // ── DATASET ENRICHMENT ──
  // Pull real review phrases matching the archetype's current state + relevant emotional vocabulary
  const enrichmentBlock = buildDatasetEnrichment({
    archetype_id: persona.archetype_id || persona._archetype_id,
    stage_label,
    sensation_state,
    property,
  });

  const system = `You are simulating a real hotel guest's experience. You must stay in character as this persona and describe what they actually experience in first-person present tense. Be specific about sensory details, staff interactions, decisions made, and money spent. Do not break character.`;

  return `${system}

=== PERSONA (you ARE this guest) ===
Name: ${persona.name}
Age: ${persona.age}
Role: ${persona.role} at ${persona.company_description || 'their company'}
Archetype: ${persona.archetype_label}
Trip purpose: ${stay_context.trip_purpose || 'leisure'}

=== WHY YOU'RE HERE ===
${(persona.goals_for_this_visit || []).join('; ')}

=== YOUR OBJECTIONS / DEAL-BREAKERS ===
${(persona.top_objections || []).join(' | ')}
${(persona.deal_breakers || []).join(' | ')}

=== STAY CONTEXT ===
Property: ${property?.name || 'this hotel'} (${property?.brand || 'unbranded'}, ${property?.tier || 'unknown tier'})
Stay length: ${stay_context.stay_length_nights || 3} nights
Current night: ${stay_context.night_number || 1}
${stage_external_block || ''}
${culturalBlock || ''}
${bookingBlock || ''}
${staffBlock || ''}
${physicalBlock || ''}
${companionBlock || ''}
${personaTraitsBlock || ''}
${themeScopeBlock || ''}
=== PROPERTY DATA (real info about this hotel) ===
${propertySummary}

=== CALIBRATION FROM REAL REVIEWS ===
${calibrationSummary}

=== DATASET ENRICHMENT (real review phrases + emotion vocabulary) ===
${enrichmentBlock}

=== YOUR ARCHETYPE'S TYPICAL PATTERN AT THIS STAGE (${stage_label}) ===
${stageBehavior ? JSON.stringify(stageBehavior, null, 2) : '(no specific pattern defined — improvise based on archetype)'}

Sensation priorities for ${persona.archetype_label}: ${JSON.stringify(sensationWeights)}

Memorable-moment triggers for this archetype:
  Positive examples: ${(memorableTriggers.positive || []).slice(0, 5).join(' | ')}
  Negative examples: ${(memorableTriggers.negative || []).slice(0, 5).join(' | ')}

Upsell acceptance probabilities (0-1): ${JSON.stringify(upsellProbs)}

Typical spending ranges in EUR for this archetype (min-max): ${JSON.stringify(spendingRanges)}

=== YOUR CURRENT SENSATION STATE (0-100) ===
${JSON.stringify(currentSensations, null, 2)}

=== RECENT PREVIOUS STAGES ===
${previousNarrative}

=== CURRENT STAGE TO SIMULATE ===
Stage: ${stage_label}
${targetBlock}${eventBlock}
Write what happens in this stage AS THIS GUEST. Be honest. If the persona would be disappointed, say so. If they'd be delighted, say so. Include specific sensory details. Let YOUR BODY RIGHT NOW shape what you notice and how you react — a tired, jetlagged guest at 11pm processes the room differently than a fresh one at noon, and that should bleed into the narrative (heavy eyes, slower speech, craving the pillow, or conversely alert and hungry for the next thing).

IMPORTANT CALIBRATION RULES (fight marketing-speak bias):
${tierMomentGuidance ? '- ' + tierMomentGuidance : '- Real 5-star hotel reviews on Booking/TripAdvisor have a positive:negative ratio of roughly 3:1, not 10:1. Aim for 1-2 positive moments AND 0-1 negative moment per stage on average, not "fill both arrays".'}
- Not every stage produces a memorable moment. If the stage is unremarkable ("shower was fine, got dressed"), return EMPTY arrays for moments_positive and moments_negative. That is a valid and common output.
- Avoid generic phrases ("breathtaking view", "stunning design", "exceptional service"). If you use a sensory claim, ground it in a specific concrete detail (the exact material, sound, smell, wait time, or staff behavior).
${propertyTier === 'luxury' || propertyTier === 'premium'
  ? '- For luxury/premium properties, DO NOT fabricate friction to feel realistic. A 5-star stay at a Gran Meliá can genuinely have zero negative moments across a 3-night journey — most real 9.5+ reviewers describe an uninterrupted positive arc. Only introduce a negative if there is a MANDATORY INCIDENT this stage OR the narrative naturally produced one.'
  : '- A rating of 5-star at a luxury hotel still includes friction. Include it when it is plausible — even privileged guests notice hidden fees, slow elevators, a junior staff mistake.'}

Return this JSON:
{
  "narrative": "3-5 sentence first-person narrative of what happens in this stage. Specific. Visceral.",
  "internal_thoughts": "1 sentence of emotional subtext (skepticism, delight, confusion, resignation)",
  "sensation_deltas": {
    "comfort_physical": integer between -20 and +20,
    "cleanliness": integer between -20 and +20,
    "service_quality": integer between -20 and +20,
    "speed": integer between -20 and +20,
    "personalization": integer between -20 and +20,
    "value": integer between -20 and +20,
    "authenticity": integer between -20 and +20,
    "modernity": integer between -20 and +20,
    "amenity_usability": integer between -20 and +20,
    "crowd": integer between -20 and +20,
    "culinary": integer between -20 and +20,
    "safety": integer between -20 and +20,
    "aesthetic": integer between -20 and +20
  },
  "moments_positive": ["up to 2 specific positive moments that would be mentioned in a review, or empty array"],
  "moments_negative": ["up to 2 specific negative moments that would be mentioned in a review, or empty array"],
  "decisions": {
    "dining_choice": "e.g. hotel_restaurant | room_service | external | skipped | breakfast_buffet | null",
    "upsells_accepted": ["list of upsells accepted this stage"],
    "upsells_declined": ["list of upsells declined this stage"],
    "activities": ["what they did"]
  },
  "expenses": [
    {"category": "breakfast|lunch|dinner|bar|spa|activities|room_service|laundry|parking|transfer|upsell|other", "item": "specific item description", "amount_eur": positive number (MUST be >= 0, never negative), "included": boolean (true if comp'd / already paid via rate plan or loyalty), "satisfaction": integer 0-100}
  ],
  "_expense_rules": "amount_eur is the retail value of the item. If the item was complimentary, a loyalty comp, a refund, or a welcome gift, set included: true with the RETAIL value (not a negative number). Never emit a negative amount_eur. Discounts and refunds are NOT tracked here — if the narrative mentions one, omit that line from expenses.",
  "concerns_voiced_to_staff": ["any complaints or questions raised with staff"],
  "staff_interactions_outcome": [
    {"staff_id": "id of a staff member from STAFF IN THIS STAGE block", "staff_name": "their name", "was_positive": boolean, "was_negative": boolean, "rapport_delta": "integer from -3 to +3 — for luxury/premium properties with warm/veteran staff, a competent positive interaction is +2 and a memorable delightful one is +3; only use +0/+1 when the interaction was merely transactional", "note": "1 short sentence on what happened"}
  ],
  "_staff_interaction_rules": "If STAFF IN THIS STAGE contains warm_proactive, veteran_senior or charismatic_memorable personalities AND the narrative is positive, rapport_delta must be +2 or +3 (not +0). Always include at least one entry per stage when staff is in play — do not emit empty array.",
  "physical_state_delta": {
    "_note": "OPTIONAL. Only emit keys the narrative changed materially. Omit dimensions not affected this stage — do NOT reiterate the starting values from YOUR BODY RIGHT NOW.",
    "fatigue": "integer, only if this stage was particularly tiring (+) or restorative (-). Typical range -20 to +20.",
    "hunger": "integer, only if you ate heavily (negative) or went far past a meal (positive). Typical -60 to +30.",
    "intoxication": "integer, only if you drank. +20 per wine/cocktail, cumulative.",
    "hangover": "integer, only if this is a morning stage and previous night was heavy. 0-50.",
    "jetlag_severity": "integer, only if mid-stay and you feel recovered. -5 to -15."
  },
  "abandonment_signal": boolean (true only if they'd leave the hotel early — rare)
}

Only include sensation_deltas for dimensions that change during this stage. Zero out or omit others. Be calibrated — most stages produce deltas of 3-8, not 20.`;
}

function buildPropertySummary(property) {
  if (!property) return '(no property data available — simulate a generic mid-tier hotel)';
  const p = property.data_json || property;
  const identity = p.identity || {};
  const amenities = p.amenities || {};
  const pricing = p.pricing_model || {};
  const marketing = p.marketing || {};
  const operations = p.operations_and_sops || {};
  const capacity = p.capacity || {};

  const lines = [];
  if (identity.name) lines.push(`Name: ${identity.name}`);
  if (identity.brand) lines.push(`Brand: ${identity.brand} (${identity.tier || 'tier unknown'})`);
  if (identity.category_stars) lines.push(`Stars: ${identity.category_stars}`);
  if (identity.location) lines.push(`Location: ${identity.location.city || ''}, ${identity.location.country || ''} (${identity.location.destination_type || 'urban'})`);
  if (capacity.total_rooms) lines.push(`Size: ${capacity.total_rooms} rooms, ${capacity.restaurants_count || 0} restaurants, ${capacity.pool_count || 0} pools, spa=${capacity.spa}, gym=${capacity.gym}`);
  if (amenities.wifi_advertised_mbps) lines.push(`WiFi advertised: ${amenities.wifi_advertised_mbps}Mbps (actual measured: ${amenities.wifi_actual_measured_mbps || 'unknown'})`);
  if (amenities.parking) lines.push(`Parking: ${amenities.parking.available ? `available @ €${amenities.parking.rate_eur_per_day}/day` : 'none'}`);
  if (amenities.kids_club?.present) lines.push(`Kids club: ages ${amenities.kids_club.ages_accepted?.join('-')}, ${amenities.kids_club.free ? 'free' : `€${amenities.kids_club.price_per_day_eur}/day`}`);
  if (pricing.resort_fee_eur_per_night) lines.push(`Resort fee: €${pricing.resort_fee_eur_per_night}/night`);
  if (pricing.city_tax_eur_per_night) lines.push(`City tax: €${pricing.city_tax_eur_per_night}/night`);
  if (operations.checkin_time) lines.push(`Check-in from ${operations.checkin_time}, checkout by ${operations.checkout_time}`);
  if (marketing.primary_positioning) lines.push(`Positioning: ${marketing.primary_positioning}`);
  if (Array.isArray(marketing.known_weaknesses) && marketing.known_weaknesses.length) {
    lines.push(`Known weaknesses: ${marketing.known_weaknesses.join('; ')}`);
  }
  if (Array.isArray(marketing.known_strengths) && marketing.known_strengths.length) {
    lines.push(`Known strengths: ${marketing.known_strengths.join('; ')}`);
  }
  if (Array.isArray(operations.brand_service_standards) && operations.brand_service_standards.length) {
    lines.push(`Brand service standards: ${operations.brand_service_standards.slice(0, 5).join('; ')}`);
  }
  return lines.join('\n') || '(minimal property data)';
}

function buildCalibrationSummary(calibration) {
  if (!calibration || Object.keys(calibration).length === 0) {
    return '(no review calibration available — rely on archetype patterns only)';
  }
  const lines = [];
  if (calibration.avg_rating != null) lines.push(`Historical avg rating: ${calibration.avg_rating}/5`);
  if (calibration.review_count != null) lines.push(`Based on ${calibration.review_count} real reviews`);
  if (calibration.star_distribution_pct) {
    const sd = calibration.star_distribution_pct;
    lines.push(`Star distribution in real reviews: 5★ ${sd[5]||0}% | 4★ ${sd[4]||0}% | 3★ ${sd[3]||0}% | 2★ ${sd[2]||0}% | 1★ ${sd[1]||0}%`);
  }
  if (Array.isArray(calibration.top_positive_themes) && calibration.top_positive_themes.length) {
    lines.push(`Top POSITIVE themes in real reviews: ${calibration.top_positive_themes.slice(0, 6).join(' | ')}`);
  }
  if (Array.isArray(calibration.top_negative_themes) && calibration.top_negative_themes.length) {
    lines.push(`Top NEGATIVE / friction themes in real reviews: ${calibration.top_negative_themes.slice(0, 6).join(' | ')}`);
  }
  if (Array.isArray(calibration.theme_top_10) && calibration.theme_top_10.length) {
    const themeLine = calibration.theme_top_10
      .slice(0, 8)
      .map(t => `${t.theme}(${t.positive_pct}%+ / ${t.negative_pct}%-)`)
      .join(' | ');
    lines.push(`Theme sentiment mix: ${themeLine}`);
  }
  if (calibration.positive_negative_moment_ratio != null) {
    lines.push(`Empirical positive:negative moment ratio in real reviews of THIS property: ${calibration.positive_negative_moment_ratio}:1 — calibrate your output close to this ratio.`);
  }
  return lines.join('\n');
}

function normalizeStageOutput(result, stageLabel) {
  return {
    stage: stageLabel,
    narrative: String(result?.narrative || '').substring(0, 2000),
    internal_thoughts: String(result?.internal_thoughts || '').substring(0, 500),
    sensation_deltas: typeof result?.sensation_deltas === 'object' ? result.sensation_deltas : {},
    moments_positive: Array.isArray(result?.moments_positive) ? result.moments_positive.slice(0, 3) : [],
    moments_negative: Array.isArray(result?.moments_negative) ? result.moments_negative.slice(0, 3) : [],
    decisions: result?.decisions || {},
    expenses: Array.isArray(result?.expenses) ? result.expenses.slice(0, 10) : [],
    concerns_voiced_to_staff: Array.isArray(result?.concerns_voiced_to_staff) ? result.concerns_voiced_to_staff.slice(0, 5) : [],
    staff_interactions_outcome: Array.isArray(result?.staff_interactions_outcome) ? result.staff_interactions_outcome.slice(0, 4) : [],
    physical_state_delta: (result?.physical_state_delta && typeof result.physical_state_delta === 'object')
      ? Object.fromEntries(
          Object.entries(result.physical_state_delta)
            .filter(([k, v]) => ['fatigue', 'hunger', 'intoxication', 'hangover', 'jetlag_severity'].includes(k) && typeof v === 'number')
            .map(([k, v]) => [k, Math.max(-80, Math.min(80, v))])
        )
      : null,
    abandonment_signal: !!result?.abandonment_signal,
  };
}

/**
 * Pull relevant phrases from Kaggle TripAdvisor sample + GoEmotions sample
 * based on the guest's current sensation state. Feeds the LLM with real language
 * so output sounds natural, not AI-bland.
 */
function buildDatasetEnrichment({ archetype_id, stage_label, sensation_state, property }) {
  const lines = [];
  try {
    // Reviews: pull mixed positive + negative phrases relevant to the property's city/tier
    const city = property?.data_json?.identity?.location?.city || property?.identity?.location?.city || null;
    const tier = property?.data_json?.identity?.tier || property?.identity?.tier || null;

    const positivePhrases = datasets.samplePhrasesForPredictor({ target_sentiment: 'positive', limit: 3 });
    const negativePhrases = datasets.samplePhrasesForPredictor({ target_sentiment: 'negative', limit: 3 });

    if (positivePhrases.length > 0) {
      lines.push('Positive review phrases (real TripAdvisor data — adapt voice, do not copy):');
      positivePhrases.forEach(p => lines.push(`  "${(p.text || '').substring(0, 180)}"`));
    }
    if (negativePhrases.length > 0) {
      lines.push('Negative review phrases (real TripAdvisor data — adapt voice, do not copy):');
      negativePhrases.forEach(p => lines.push(`  "${(p.text || '').substring(0, 180)}"`));
    }

    // Emotions: for dominant low/high dimensions right now, surface matching emotion labels
    const dominantHigh = [];
    const dominantLow = [];
    for (const [dim, val] of Object.entries(sensation_state || {})) {
      if (dim.startsWith('_') || typeof val !== 'number') continue;
      if (val >= 75) dominantHigh.push(dim);
      else if (val <= 40) dominantLow.push(dim);
    }

    if (dominantHigh.length > 0) {
      const emos = new Set();
      dominantHigh.slice(0, 3).forEach(dim => {
        datasets.lookupSensationToEmotions(dim, 'high').forEach(e => emos.add(e));
      });
      if (emos.size > 0) lines.push(`Emotional vocabulary matching guest's current highs: ${[...emos].slice(0, 5).join(', ')}`);
    }
    if (dominantLow.length > 0) {
      const emos = new Set();
      dominantLow.slice(0, 3).forEach(dim => {
        datasets.lookupSensationToEmotions(dim, 'low').forEach(e => emos.add(e));
      });
      if (emos.size > 0) lines.push(`Emotional vocabulary matching guest's current lows: ${[...emos].slice(0, 5).join(', ')}`);
    }

    // Behavioral anchor: empirical spending
    const expensePattern = datasets.getExpensePattern(archetype_id);
    if (expensePattern) {
      const keys = Object.keys(expensePattern).filter(k => k.includes('mean_eur')).slice(0, 4);
      if (keys.length > 0) {
        lines.push(`Empirical ${archetype_id} spend anchors (from public studies): ${keys.map(k => `${k}=€${expensePattern[k]}`).join(', ')}`);
      }
    }
  } catch (err) {
    console.error('[narrative-engine] dataset enrichment failed:', err.message);
  }
  return lines.length > 0 ? lines.join('\n') : '(no dataset enrichment available)';
}

module.exports = { simulateStage, getArchetypeBehavior, buildPropertySummary, buildCalibrationSummary, buildDatasetEnrichment };
