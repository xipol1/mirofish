/**
 * Unit tests for attribution-engine.
 * Run: node backend/tests/attribution-engine.test.js
 */

const test = require('node:test');
const assert = require('node:assert');

const attr = require('../services/enterprise/attribution-engine');

function fakeStay(overrides = {}) {
  return {
    archetype_id: 'digital_nomad',
    sensation_summary: { stars: 2, nps: -45 },
    moments_positive: [{ description: 'friendly staff at breakfast' }],
    moments_negative: [
      { description: 'wifi dropped every 30 minutes' },
      { description: 'noisy neighbors above room' },
    ],
    sensation_history: [
      { stage: 'arrival', deltas: { personalization: +5, comfort_physical: +2 } },
      { stage: 'room_first_impression', deltas: { comfort_physical: +4, value: -6 } },
      { stage: 'evening_1', deltas: { amenity_usability: -18, comfort_physical: -4 } },
      { stage: 'morning_routine', deltas: { culinary: +6, amenity_usability: -10 } },
    ],
    adversarial_events: [
      { event_id: 'wifi_intermittent', stage: 'evening_1', resolution_quality: 'adequate' },
    ],
    stages: [
      { stage: 'evening_1', moments_negative: [{ description: 'wifi intermittently dropped, couldn\'t take my call' }] },
    ],
    ...overrides,
  };
}

test('decomposeAgentNPS returns per-stage and per-dim contributions', () => {
  const d = attr.decomposeAgentNPS(fakeStay());
  assert.strictEqual(d.final_nps, -45);
  assert.ok(Array.isArray(d.per_stage_nps_delta));
  assert.ok(d.per_stage_nps_delta.length >= 3);
  assert.ok(typeof d.dimension_total_contribution === 'object');
  assert.ok(Array.isArray(d.top_negative_drivers));
  // Amenity usability (wifi) should surface as a negative driver (-28 delta across stages)
  const hasAmenity = d.top_negative_drivers.some(x => x.dim === 'amenity_usability');
  assert.ok(hasAmenity, 'amenity_usability should appear as a negative driver');
});

test('adversarial events are recorded in decomposition', () => {
  const d = attr.decomposeAgentNPS(fakeStay());
  assert.strictEqual(d.adversarial_event_nps_impact.length, 1);
  assert.strictEqual(d.adversarial_event_nps_impact[0].event_id, 'wifi_intermittent');
  assert.ok(typeof d.adversarial_event_nps_impact[0].nps_impact === 'number');
});

test('decomposeAgentNPS handles missing or errored stay', () => {
  const d = attr.decomposeAgentNPS(null);
  assert.ok(d.error);
});

test('decomposeCohortNPS aggregates per-archetype drivers', () => {
  const sim = {
    records: [
      fakeStay(),
      { ...fakeStay(), archetype_id: 'luxury_seeker', sensation_summary: { stars: 5, nps: 85 }, sensation_history: [{ stage: 'arrival', deltas: { aesthetic: +15, personalization: +10 } }] },
      fakeStay(),
    ],
  };
  const cohort = attr.decomposeCohortNPS(sim);
  assert.strictEqual(cohort.n, 3);
  assert.ok(cohort.top_drivers_cohort_level.length > 0);
  assert.ok(Object.keys(cohort.segment_drivers).length >= 2);
});

test('top 3 positive/negative drivers include example_moment', () => {
  const d = attr.decomposeAgentNPS(fakeStay());
  for (const dr of d.top_3_negative_drivers) {
    assert.ok('example_moment' in dr);
  }
});
