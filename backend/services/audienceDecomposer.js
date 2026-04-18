/**
 * Audience Decomposer — turns a free-text audience description into a structured vector.
 *
 * This vector drives pain-library retrieval, archetype selection, and prompt conditioning.
 */

const { callAIJSON } = require('./ai');

const VERTICALS = ['saas', 'b2c', 'ecommerce', 'fintech', 'healthcare', 'education', 'b2b_marketing', 'dev_tools', 'agency', 'media', 'hospitality', 'other'];
const BUYING_STAGES = ['unaware', 'problem_aware', 'solution_aware', 'evaluating', 'ready_to_buy'];
const BUDGET_AUTHORITIES = ['none', 'team', 'department', 'executive'];

const HOSPITALITY_KEYWORDS = [
  'hotel', 'resort', 'hospitality', 'guest', 'stay', 'room', 'travellers',
  'travelers', 'vacationers', 'honeymoon', 'couples', 'families',
  'business traveller', 'leisure', 'weekend', 'getaway', 'retreat', 'beach',
  'menorca', 'balearic', 'mediterranean', 'riviera', 'spa', 'bnb', 'b&b',
  'boutique', 'villa', 'villas', 'check-in', 'nights', 'tourism',
  'turista', 'viajero', 'huésped', 'huespedes', 'huéspedes', 'parejas',
  'familias', 'vacaciones', 'estancia', 'noches',
];

function looksLikeHospitality(text) {
  if (!text) return false;
  const lower = text.toLowerCase();
  return HOSPITALITY_KEYWORDS.some(k => lower.includes(k));
}

async function decomposeAudience(audienceText, opts = {}) {
  if (!audienceText || audienceText.trim().length === 0) {
    return opts.vertical_hint === 'hospitality' ? hospitalityDefault() : defaultVector();
  }

  // Short-circuit: if caller hints hospitality OR text contains hospitality signals,
  // use the hospitality-specific schema. Avoids the LLM dropping guest-type audiences
  // into SaaS fields (role_level=manager, buying_stage=evaluating, etc.).
  const isHospitality = opts.vertical_hint === 'hospitality' || looksLikeHospitality(audienceText);
  if (isHospitality) {
    return decomposeHospitalityAudience(audienceText);
  }

  const prompt = `Parse this target audience description into a structured vector.

AUDIENCE: "${audienceText}"

Return JSON with these fields (use the enums strictly):

{
  "vertical": "one of: ${VERTICALS.join(', ')}",
  "role_archetype": "free-text but concise, e.g. 'VP of Product at mid-market SaaS'",
  "role_level": "one of: ic, manager, director, vp, executive, founder, consumer",
  "company_size": "one of: solo, 2-10, 10-50, 50-200, 200-1000, 1000+, not_applicable",
  "buying_stage": "one of: ${BUYING_STAGES.join(', ')}",
  "budget_authority": "one of: ${BUDGET_AUTHORITIES.join(', ')}",
  "geography": "region if mentioned, else 'unspecified'",
  "primary_pain_themes": ["2-4 concise pain themes this audience likely has"],
  "inferred_constraints": ["list of likely budget/time/tech constraints"],
  "key_signals_they_look_for": ["list of trust signals this audience will explicitly seek"]
}`;

  try {
    const result = await callAIJSON(prompt, { maxTokens: 800, temperature: 0.3 });
    // Guard against missing fields
    return {
      vertical: VERTICALS.includes(result.vertical) ? result.vertical : 'saas',
      role_archetype: result.role_archetype || 'unspecified',
      role_level: result.role_level || 'manager',
      company_size: result.company_size || 'unspecified',
      buying_stage: BUYING_STAGES.includes(result.buying_stage) ? result.buying_stage : 'evaluating',
      budget_authority: BUDGET_AUTHORITIES.includes(result.budget_authority) ? result.budget_authority : 'team',
      geography: result.geography || 'unspecified',
      primary_pain_themes: Array.isArray(result.primary_pain_themes) ? result.primary_pain_themes.slice(0, 5) : [],
      inferred_constraints: Array.isArray(result.inferred_constraints) ? result.inferred_constraints.slice(0, 5) : [],
      key_signals_they_look_for: Array.isArray(result.key_signals_they_look_for) ? result.key_signals_they_look_for.slice(0, 5) : [],
    };
  } catch (err) {
    console.error('[decomposer] fallback:', err.message.substring(0, 100));
    return defaultVector();
  }
}

function defaultVector() {
  return {
    vertical: 'saas',
    role_archetype: 'general SaaS buyer',
    role_level: 'manager',
    company_size: 'unspecified',
    buying_stage: 'evaluating',
    budget_authority: 'team',
    geography: 'unspecified',
    primary_pain_themes: ['need a better tool', 'cost concern', 'integration fit'],
    inferred_constraints: [],
    key_signals_they_look_for: ['pricing', 'social proof'],
  };
}

async function decomposeHospitalityAudience(audienceText) {
  const prompt = `Parse this hotel guest audience description into a structured vector.

AUDIENCE: "${audienceText}"

Return JSON with these fields:
{
  "vertical": "hospitality",
  "guest_mix": "free text, e.g. 'European leisure couples 30-55, skew luxury'",
  "trip_purpose_primary": "one of: leisure_couples, leisure_family, leisure_solo, business, remote_work, event, wellness, honeymoon",
  "price_sensitivity": "one of: budget, value, premium, luxury",
  "origin_geography": "region/nationality if mentioned, else 'international_mix'",
  "typical_stay_length_nights": [min, max],
  "typical_channels": ["direct_web", "booking_com", "expedia", "corporate", "direct_app"],
  "primary_drivers": ["2-4 concise value drivers this audience prioritises, e.g. 'sea view', 'service quality', 'spa', 'wifi reliability'"],
  "inferred_constraints": ["list of likely constraints, e.g. 'school holiday dates', 'EU flight routes', 'allergy-friendly dining'"],
  "key_signals_they_look_for": ["list of trust signals, e.g. 'Michelin-starred restaurant', 'adults-only', 'Leading Hotels of the World']"
}`;

  try {
    const result = await callAIJSON(prompt, { maxTokens: 800, temperature: 0.3 });
    return {
      vertical: 'hospitality',
      guest_mix: result.guest_mix || audienceText.slice(0, 120),
      trip_purpose_primary: result.trip_purpose_primary || 'leisure_couples',
      price_sensitivity: result.price_sensitivity || 'premium',
      origin_geography: result.origin_geography || 'international_mix',
      typical_stay_length_nights: Array.isArray(result.typical_stay_length_nights) ? result.typical_stay_length_nights : [2, 5],
      typical_channels: Array.isArray(result.typical_channels) ? result.typical_channels : ['direct_web', 'booking_com'],
      primary_drivers: Array.isArray(result.primary_drivers) ? result.primary_drivers.slice(0, 5) : [],
      inferred_constraints: Array.isArray(result.inferred_constraints) ? result.inferred_constraints.slice(0, 5) : [],
      key_signals_they_look_for: Array.isArray(result.key_signals_they_look_for) ? result.key_signals_they_look_for.slice(0, 5) : [],
      // Back-compat: older code paths look for these fields. Keep them but point to hospitality-appropriate values.
      role_archetype: result.guest_mix || 'hospitality guest',
      role_level: 'consumer',
      company_size: 'not_applicable',
      buying_stage: 'ready_to_buy',
      budget_authority: 'executive',
      geography: result.origin_geography || 'international_mix',
    };
  } catch (err) {
    console.error('[decomposer:hospitality] fallback:', err.message.substring(0, 100));
    return hospitalityDefault();
  }
}

function hospitalityDefault() {
  return {
    vertical: 'hospitality',
    guest_mix: 'international leisure mix',
    trip_purpose_primary: 'leisure_couples',
    price_sensitivity: 'premium',
    origin_geography: 'international_mix',
    typical_stay_length_nights: [2, 5],
    typical_channels: ['direct_web', 'booking_com'],
    primary_drivers: ['service quality', 'room experience', 'value'],
    inferred_constraints: [],
    key_signals_they_look_for: ['reviews', 'photos'],
    role_archetype: 'hospitality guest',
    role_level: 'consumer',
    company_size: 'not_applicable',
    buying_stage: 'ready_to_buy',
    budget_authority: 'executive',
    geography: 'international_mix',
  };
}

module.exports = { decomposeAudience, decomposeHospitalityAudience, hospitalityDefault, looksLikeHospitality, VERTICALS, BUYING_STAGES };
