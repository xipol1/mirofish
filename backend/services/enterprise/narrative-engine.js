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
  });

  const result = await callAIJSON(prompt, { maxTokens: 1200, temperature: 0.8 });
  return normalizeStageOutput(result, stage_label);
}

function buildStagePrompt(ctx) {
  const {
    stage_label,
    persona,
    archetype_behavior,
    property,
    sensation_state,
    previous_stages,
    stay_context,
    calibration_signals,
  } = ctx;

  const stageBehavior = archetype_behavior?.daily_routine?.[stage_label] || null;
  const spendingRanges = archetype_behavior?.daily_spending_eur_range || {};
  const sensationWeights = archetype_behavior?.sensation_weights || {};
  const upsellProbs = archetype_behavior?.upsell_acceptance_probability || {};
  const memorableTriggers = archetype_behavior?.memorable_moment_triggers || {};

  const currentSensations = Object.fromEntries(
    Object.keys(sensations().dimensions).map(d => [d, sensation_state[d] ?? 50])
  );

  const previousNarrative = previous_stages.slice(-3).map(p =>
    `[${p.stage}] ${p.narrative?.substring(0, 260) || '(no narrative)'}`
  ).join('\n') || '(this is the first stage)';

  const propertySummary = buildPropertySummary(property);
  const calibrationSummary = buildCalibrationSummary(calibration_signals);

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

Write what happens in this stage AS THIS GUEST. Be honest. If the persona would be disappointed, say so. If they'd be delighted, say so. Include specific sensory details.

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
    {"category": "breakfast|lunch|dinner|bar|spa|activities|room_service|laundry|parking|transfer|upsell|other", "item": "specific item description", "amount_eur": number, "included": boolean, "satisfaction": integer 0-100}
  ],
  "concerns_voiced_to_staff": ["any complaints or questions raised with staff"],
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
  if (calibration.avg_rating != null) lines.push(`Historical avg rating: ${calibration.avg_rating}`);
  if (Array.isArray(calibration.top_positive_themes) && calibration.top_positive_themes.length) {
    lines.push(`Top positive themes in reviews: ${calibration.top_positive_themes.slice(0, 6).join(' | ')}`);
  }
  if (Array.isArray(calibration.top_negative_themes) && calibration.top_negative_themes.length) {
    lines.push(`Top negative themes in reviews: ${calibration.top_negative_themes.slice(0, 6).join(' | ')}`);
  }
  if (calibration.review_count != null) lines.push(`Based on ${calibration.review_count} real reviews`);
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
