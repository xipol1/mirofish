/**
 * Episodic Memory Generator — Entregable 3
 *
 * Before the journey loop runs, this module generates 3-4 "episodic anchors"
 * for the agent: past travel memories, fears, and hopes, rooted in the
 * persona's lifetime stays band, loyalty tier, recent life event, occasion,
 * and cultural cluster. These anchors are cached on the persona and injected
 * as a prompt block in every downstream call so the agent compares against
 * concrete memories, not a platonic ideal of "a luxury hotel".
 *
 * Fail-open: if the LLM call fails, we return an empty memory set — the
 * downstream prompts tolerate absence.
 */

const { callAIJSON } = require('../ai');
const { temperatureForAgent } = require('./temperature-mapper');
const { buildMetaIdentity } = require('./meta-identity');

async function generateEpisodicMemories({ persona, cultural_context, property }) {
  try {
    const system = buildMetaIdentity(persona, cultural_context, property);
    const prompt = buildMemoryPrompt({ persona, cultural_context, property });
    const temperature = temperatureForAgent(persona, 'pre_arrival');
    const result = await callAIJSON(prompt, { system, maxTokens: 900, temperature });
    return normalizeMemories(result);
  } catch (err) {
    console.error('[episodic-memory] generation failed:', err.message?.substring(0, 140));
    return { episodic_memories: [], active_fears: [], active_hopes: [], _error: err.message?.substring(0, 120) };
  }
}

function buildMemoryPrompt({ persona, cultural_context, property }) {
  const cluster = cultural_context?.culture_cluster || 'global_brand_mix';
  const clusterLabel = cultural_context?.culture_cluster_label || cluster;
  const alternatives = Array.isArray(persona?.current_alternatives) && persona.current_alternatives.length
    ? persona.current_alternatives.slice(0, 4).join(', ')
    : '(none specified)';
  const pains = Array.isArray(persona?.pain_quotes_in_voice) && persona.pain_quotes_in_voice.length
    ? persona.pain_quotes_in_voice.slice(0, 3).map(q => `  "${q}"`).join('\n')
    : '  (none)';
  const propertyName = property?.name || property?.data_json?.identity?.name || 'this property';
  const propertyTier = (property?.data_json?.identity?.tier || property?.tier || 'luxury').toLowerCase();

  return `You are ${persona?.name || 'this guest'}. Before the taxi even pulls up to ${propertyName}, your brain has already cached 3-4 past travel memories that will silently shape how you judge every moment of this stay. These are YOUR memories — specific, sensory, not "a luxury hotel experience" in the abstract.

=== YOU ===
Archetype: ${persona?.archetype_label || persona?.archetype_id || 'guest'}
Cultural cluster: ${clusterLabel}
Occasion this trip: ${persona?.occasion_this_trip || 'no_special'}
Loyalty tier at any brand: ${persona?.loyalty_tier_any_brand || 'none'}
Lifetime hotel stays band: ${persona?.lifetime_hotel_stays_band || '20-50'}
Recent major life event: ${persona?.recent_major_life_event || 'none'}
Reference class: ${persona?.reference_class || '(unspecified)'}
Current alternatives / properties you mentally compare to: ${alternatives}
Pain quotes you've said aloud before:
${pains}

=== CONSTRAINTS ON THE MEMORIES YOU GENERATE ===
- At least ONE positive reference memory (the bar you're implicitly holding this stay to).
- At least ONE negative memory that creates active fear / suspicion.
- If occasion is honeymoon/anniversary/milestone → one partner/relationship memory.
- If loyalty_tier ≠ none → one tier-recognition memory (good OR bad).
- If recent_major_life_event ≠ none → let that colour the emotional tone of one memory.
- If lifetime_stays_band = "<5" → memories are Airbnb / budget hotels / family houses, NOT Four Seasons.
- Cultural cluster ${clusterLabel} shapes WHAT you remember: ${cluster === 'german_dach' ? 'process details, wait times, temperature, cleanliness specifics' : cluster === 'anglo_uk_ireland' ? 'staff warmth or coldness, weather, a specific meal' : cluster === 'latin_spain_italy' || cluster === 'latin_american' ? 'warmth of a specific person, a sensory moment, a meal shared' : cluster === 'east_asian' ? 'discretion of service, visual elegance, silence of spaces' : cluster === 'middle_east_gcc' ? 'privacy, tier acknowledgment, quality of amenities' : 'specific sensory anchors'}.

=== OUTPUT — EPISODIC JSON (inject into every later call) ===
{
  "episodic_memories": [
    {
      "memory_id": "m1",
      "property_name": "specific property name, real-sounding or plausible (NEVER 'a hotel in Paris')",
      "when": "e.g. 'two years ago', '8 months ago'",
      "context": "2-8 word why-you-went",
      "anchor_type": "positive_reference | negative_trauma | tier_experience | partner_memory | first_time",
      "vivid_detail": "ONE sentence with ONE sensory detail you STILL remember — not a summary, not an adjective-evaluation",
      "emotional_valence": -100 to +100,
      "tied_sensation_dimensions": ["1-3 from: comfort_physical, cleanliness, service_quality, speed, personalization, value, authenticity, modernity, amenity_usability, crowd, culinary, safety, aesthetic, sustainability_awareness"],
      "comparison_salience": 0-100,
      "trigger_conditions": ["1-3 elements of THIS stay that will re-activate this memory"]
    }
  ],
  "active_fears": ["2-3 concrete fears this trip carries from the negative memory"],
  "active_hopes": ["2-3 concrete hopes this trip carries from the positive memory"]
}

CRITICAL: memories must SOUND LIKE MEMORIES, not reviews. "The marble floor felt warm under my feet after the shower" is a memory. "Excellent spa facilities" is a review word. Sensory detail stays; evaluative adjectives fade. Write in your voice as ${persona?.name || 'this guest'}.`;
}

function normalizeMemories(result) {
  if (!result || typeof result !== 'object') {
    return { episodic_memories: [], active_fears: [], active_hopes: [] };
  }
  const memories = Array.isArray(result.episodic_memories) ? result.episodic_memories : [];
  return {
    episodic_memories: memories.slice(0, 4).map((m, i) => ({
      memory_id: String(m.memory_id || `m${i + 1}`),
      property_name: String(m.property_name || '').substring(0, 140),
      when: String(m.when || '').substring(0, 40),
      context: String(m.context || '').substring(0, 80),
      anchor_type: ['positive_reference', 'negative_trauma', 'tier_experience', 'partner_memory', 'first_time']
        .includes(m.anchor_type) ? m.anchor_type : 'positive_reference',
      vivid_detail: String(m.vivid_detail || '').substring(0, 240),
      emotional_valence: Math.max(-100, Math.min(100, Number(m.emotional_valence) || 0)),
      tied_sensation_dimensions: Array.isArray(m.tied_sensation_dimensions)
        ? m.tied_sensation_dimensions.slice(0, 3).map(String)
        : [],
      comparison_salience: Math.max(0, Math.min(100, Number(m.comparison_salience) || 50)),
      trigger_conditions: Array.isArray(m.trigger_conditions)
        ? m.trigger_conditions.slice(0, 3).map(t => String(t).substring(0, 120))
        : [],
    })),
    active_fears: Array.isArray(result.active_fears)
      ? result.active_fears.slice(0, 3).map(f => String(f).substring(0, 120))
      : [],
    active_hopes: Array.isArray(result.active_hopes)
      ? result.active_hopes.slice(0, 3).map(h => String(h).substring(0, 120))
      : [],
  };
}

/**
 * Render the episodic memory block for injection into later stage/review
 * prompts. Keep it short — ~200 tokens — so it doesn't bloat prompts.
 */
function renderMemoryBlock(memoryRecord) {
  if (!memoryRecord || !Array.isArray(memoryRecord.episodic_memories) || memoryRecord.episodic_memories.length === 0) {
    return '';
  }
  const lines = ['=== EPISODIC MEMORIES YOU CARRY (silent biases, activate when triggered) ==='];
  for (const m of memoryRecord.episodic_memories) {
    const valenceTag = m.emotional_valence >= 50 ? '+' : m.emotional_valence <= -50 ? '−' : '~';
    lines.push(`[${valenceTag}] ${m.property_name} (${m.when}, ${m.context}): "${m.vivid_detail}" — reactivates on: ${m.trigger_conditions.join(' / ') || '(ambient)'}`);
  }
  if (memoryRecord.active_fears?.length) {
    lines.push(`Active fears: ${memoryRecord.active_fears.join(' | ')}`);
  }
  if (memoryRecord.active_hopes?.length) {
    lines.push(`Active hopes: ${memoryRecord.active_hopes.join(' | ')}`);
  }
  return lines.join('\n');
}

module.exports = {
  generateEpisodicMemories,
  renderMemoryBlock,
};
