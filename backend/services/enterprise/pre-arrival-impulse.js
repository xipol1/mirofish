/**
 * Pre-Arrival Impulse — Entregable 2, PASO 0
 *
 * Called once per agent, after enrichment + episodic memory, before the first
 * stage. Produces the guest's internal monologue in the taxi/AVE approaching
 * the property — a concrete hope, a concrete fear, a mental benchmark, an
 * emotional state, and a tolerance budget for the day.
 *
 * The output is stored in the stay record so post-hoc analysis can correlate
 * pre-arrival mindset with eventual star rating (attribution-engine hook).
 */

const { callAIJSON } = require('../ai');
const { temperatureForAgent } = require('./temperature-mapper');
const { buildMetaIdentity } = require('./meta-identity');
const { renderMemoryBlock } = require('./episodic-memory');

async function generatePreArrivalImpulse({ persona, cultural_context, property, booking_context, episodic_memory = null }) {
  try {
    const system = buildMetaIdentity(persona, cultural_context, property);
    const prompt = buildImpulsePrompt({ persona, cultural_context, property, booking_context, episodic_memory });
    const temperature = temperatureForAgent(persona, 'primer_impulso');
    const result = await callAIJSON(prompt, { system, maxTokens: 500, temperature });
    return normalizeImpulse(result);
  } catch (err) {
    console.error('[pre-arrival-impulse] failed:', err.message?.substring(0, 140));
    return fallbackImpulse(persona);
  }
}

function buildImpulsePrompt({ persona, cultural_context, property, booking_context, episodic_memory }) {
  const propertyName = property?.name || property?.data_json?.identity?.name || 'this property';
  const bookingWindowDays = booking_context?.booking_window_days ?? booking_context?.days_before_arrival ?? null;
  const occasion = persona?.occasion_this_trip || 'no_special';
  const memoryBlock = renderMemoryBlock(episodic_memory);
  const alternatives = Array.isArray(persona?.current_alternatives) && persona.current_alternatives.length
    ? persona.current_alternatives.slice(0, 3).join(', ')
    : '';

  return `You are in the taxi / AVE / arrival shuttle approaching ${propertyName}. ${bookingWindowDays != null ? `You booked ${bookingWindowDays} day(s) ago.` : ''} The reason for this trip is ${occasion}.

In your inner voice — not spoken aloud, not to anyone — answer three things honestly:
1. What do you SPECIFICALLY hope to find? (concrete, not generic.)
2. What are you afraid of / suspicious about? (loss aversion is always active — there's always something.)
3. What property or past experience are you mentally benchmarking this against? ${alternatives ? `(Your declared alternatives: ${alternatives}.)` : ''}

${memoryBlock}

=== OUTPUT JSON ===
{
  "anticipation_hope": "≤ 18 words, in your voice",
  "anticipation_fear": "≤ 18 words, in your voice",
  "mental_benchmark": {
    "property_or_experience": "specific name, not 'a 5-star hotel'",
    "trait_you_expect_matched_or_beaten": "specific sensation/detail"
  },
  "emotional_state_entry": {"valence": -100 to 100, "arousal": 0 to 100},
  "tolerance_budget_today": 0-100
}

Rules: a German business_traveler does not say "breathtaking"; a Brit on honeymoon does not say "amazing"; a Latin honeymooner does not list three symmetric bullets. Use your actual voice.`;
}

function normalizeImpulse(result) {
  if (!result || typeof result !== 'object') return null;
  return {
    anticipation_hope: String(result.anticipation_hope || '').substring(0, 200),
    anticipation_fear: String(result.anticipation_fear || '').substring(0, 200),
    mental_benchmark: result.mental_benchmark && typeof result.mental_benchmark === 'object'
      ? {
          property_or_experience: String(result.mental_benchmark.property_or_experience || '').substring(0, 140),
          trait_you_expect_matched_or_beaten: String(result.mental_benchmark.trait_you_expect_matched_or_beaten || '').substring(0, 180),
        }
      : null,
    emotional_state_entry: {
      valence: Math.max(-100, Math.min(100, Number(result.emotional_state_entry?.valence) || 0)),
      arousal: Math.max(0, Math.min(100, Number(result.emotional_state_entry?.arousal) || 50)),
    },
    tolerance_budget_today: Math.max(0, Math.min(100, Number(result.tolerance_budget_today) || 60)),
  };
}

function fallbackImpulse(persona) {
  const neuro = persona?.ocean?.neuroticism ?? 50;
  const optimism = persona?.trait_optimism ?? 55;
  return {
    anticipation_hope: 'that the stay matches what was promised',
    anticipation_fear: 'hidden fees or misrepresented photos',
    mental_benchmark: null,
    emotional_state_entry: { valence: Math.round((optimism - neuro) / 2), arousal: 50 },
    tolerance_budget_today: Math.round(70 - (neuro - 50) / 2),
    _fallback: true,
  };
}

function renderImpulseBlock(impulse) {
  if (!impulse) return '';
  const benchName = impulse.mental_benchmark?.property_or_experience;
  const benchTrait = impulse.mental_benchmark?.trait_you_expect_matched_or_beaten;
  return `=== YOUR MINDSET AS YOU ARRIVED ===
Hope: ${impulse.anticipation_hope || '(none stated)'}
Fear: ${impulse.anticipation_fear || '(none stated)'}
${benchName ? `Mental benchmark: ${benchName}${benchTrait ? ` — expecting ${benchTrait}` : ''}` : ''}
Emotional entry: valence=${impulse.emotional_state_entry?.valence ?? 0}, arousal=${impulse.emotional_state_entry?.arousal ?? 50}
Tolerance budget today: ${impulse.tolerance_budget_today ?? 60}/100 (low = you'll snap at small things)`;
}

module.exports = {
  generatePreArrivalImpulse,
  renderImpulseBlock,
};
