/**
 * Unit tests for agent-interviewer.
 * Pure prompt-shape tests; LLM is NOT called (we monkey-patch callAIJSON).
 *
 * Run: node backend/tests/agent-interviewer.test.js
 */

const test = require('node:test');
const assert = require('node:assert');
const path = require('path');

// Inject a stub LLM before requiring the module under test.
const aiPath = path.join(__dirname, '..', 'services', 'ai.js');
require.cache[require.resolve(aiPath)] = {
  id: aiPath,
  filename: aiPath,
  loaded: true,
  exports: {
    callAI: async () => '',
    callAIJSON: async () => ({
      answer: 'La vista al mar fue lo mejor, me desperté con el amanecer sobre las rocas.',
      emotional_tone: 'satisfied',
      cited_stage_indices: [1, 3],
      memory_confidence_0_1: 0.8,
      mentioned_themes: ['view', 'room'],
    }),
    getProvider: () => 'stub',
    getCohortSize: () => 1,
    extractJSON: (x) => (typeof x === 'string' ? JSON.parse(x) : x),
  },
};

const interviewer = require('../services/enterprise/agent-interviewer');

const fakeStay = () => ({
  property_name: 'Villa Le Blanc',
  stay_length_nights: 3,
  trip_purpose: 'leisure_couples',
  sensation_summary: { stars: 5, nps: 80 },
  stages: [
    { stage: 'arrival', night: 1, narrative: 'Check-in impecable.', moments_positive: ['quick welcome'], moments_negative: [] },
    { stage: 'room_first_impression', night: 1, narrative: 'La vista al mar me dejó sin palabras.', moments_positive: ['sea view'], moments_negative: [] },
    { stage: 'morning_routine', night: 2, narrative: 'Desayuno impecable.', moments_positive: ['local pastries'], moments_negative: [] },
    { stage: 'checkout', night: 3, narrative: 'Despedida calurosa.', moments_positive: [], moments_negative: [] },
  ],
  predicted_review: { will_write_review: true, platform: 'tripadvisor', would_repeat: true, would_recommend: true, body: 'Amazing stay.' },
  post_stay: { return_intent: { return_intent_12m_probability: 0.8 } },
  adversarial_events: [],
  staff_registry: [{ name: 'Ana', role: 'front_desk', rapport_score: 18 }],
});

const fakePersona = () => ({
  name: 'Helga Schmidt', archetype_id: 'luxury_seeker', archetype_label: 'Luxury Seeker',
  age: 54, role: 'executive', goals: ['privacy', 'scenic views'], deal_breakers: ['noise'],
});

const fakeBookingCtx = () => ({ booking_channel: 'direct', rate_plan: 'BAR', lead_time_days: 45, room_rate_paid_eur: 620, price_tier: 'premium', pre_booked_upsells: ['spa'] });
const fakeCultureCtx = () => ({ culture_cluster: 'german_dach', native_language: 'de', complaint_style: 'direct', nationality: 'German' });

test('buildInterviewPrompt includes persona, stage indices, and question', () => {
  const prompt = interviewer.buildInterviewPrompt({
    stayRecord: fakeStay(),
    persona: fakePersona(),
    bookingContext: fakeBookingCtx(),
    culturalContext: fakeCultureCtx(),
    question: '¿Qué fue lo mejor de tu estancia?',
  });
  assert.match(prompt, /Helga Schmidt/);
  assert.match(prompt, /\[0\] ARRIVAL/);
  assert.match(prompt, /Qué fue lo mejor de tu estancia/);
  assert.match(prompt, /Villa Le Blanc/);
  assert.match(prompt, /first person/i);
});

test('interviewAgent returns well-shaped response', async () => {
  const r = await interviewer.interviewAgent({
    stayRecord: fakeStay(),
    persona: fakePersona(),
    bookingContext: fakeBookingCtx(),
    culturalContext: fakeCultureCtx(),
    question: '¿Qué fue lo mejor de tu estancia?',
  });
  assert.ok(typeof r.answer === 'string' && r.answer.length > 5, 'answer should be a non-trivial string');
  assert.ok(['delighted', 'satisfied', 'neutral', 'frustrated', 'angry', 'disappointed', 'nostalgic'].includes(r.emotional_tone));
  assert.ok(Array.isArray(r.cited_stage_indices) && r.cited_stage_indices.length > 0);
  assert.ok(r.memory_confidence_0_1 >= 0 && r.memory_confidence_0_1 <= 1);
  assert.strictEqual(r.persona_name, 'Helga Schmidt');
});

test('interviewAgent handles missing stay gracefully', async () => {
  const r = await interviewer.interviewAgent({ stayRecord: null, persona: fakePersona(), question: '?' });
  assert.strictEqual(r.answer, null);
  assert.match(r.error, /missing|failed/);
});

test('interviewMultipleAgents runs concurrently and preserves order', async () => {
  const items = [0, 1, 2].map(slot => ({
    agent_slot: slot,
    stayRecord: fakeStay(),
    persona: fakePersona(),
    bookingContext: fakeBookingCtx(),
    culturalContext: fakeCultureCtx(),
    question: `test ${slot}`,
  }));
  const res = await interviewer.interviewMultipleAgents(items);
  assert.strictEqual(res.length, 3);
  res.forEach((r, i) => assert.strictEqual(r.agent_slot, i));
});
