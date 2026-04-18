/**
 * Unit tests for persona-enricher.
 * Run: node backend/tests/persona-enricher.test.js
 */

const test = require('node:test');
const assert = require('node:assert');
const pe = require('../services/enterprise/persona-enricher');

function basePersona(archetypeId = 'honeymooner') {
  return { name: 'Elena', age: 32, gender: 'f', archetype_id: archetypeId };
}

test('enrich: adds all five groups + marker', () => {
  const out = pe.enrich({
    persona: basePersona('honeymooner'),
    culturalContext: { culture_cluster: 'german_dach' },
    bookingContext: { price_tier: 'luxury' },
  });
  assert.strictEqual(out.enriched, true);
  assert.ok(out.psychographics?.ocean);
  assert.ok(out.consumption?.dietary_restrictions);
  assert.ok(out.room_preferences?.bed_firmness_preferred);
  assert.ok(out.travel_history?.lifetime_hotel_stays_band);
  assert.ok(out.review_behavior?.review_writing_style);
  assert.ok(out.life_context?.occasion_this_trip);
  assert.ok(out.financial_behavior?.receipt_scrutiny != null);
});

test('enrich: honeymooner occasion is forced to honeymoon', () => {
  for (let i = 0; i < 10; i++) {
    const out = pe.enrich({ persona: basePersona('honeymooner'), culturalContext: {}, bookingContext: {} });
    assert.strictEqual(out.life_context.occasion_this_trip, 'honeymoon');
  }
});

test('enrich: business_traveler has high caffeine dependency on average', () => {
  const samples = [];
  for (let i = 0; i < 50; i++) {
    const out = pe.enrich({ persona: basePersona('business_traveler'), culturalContext: {}, bookingContext: {} });
    samples.push(out.consumption.caffeine_dependency);
  }
  const avg = samples.reduce((s, v) => s + v, 0) / samples.length;
  assert.ok(avg >= 65, `BT caffeine avg should be high, got ${avg}`);
});

test('enrich: budget_optimizer has high receipt_scrutiny', () => {
  const samples = [];
  for (let i = 0; i < 30; i++) {
    const out = pe.enrich({ persona: basePersona('budget_optimizer'), culturalContext: {}, bookingContext: {} });
    samples.push(out.financial_behavior.receipt_scrutiny);
  }
  const avg = samples.reduce((s, v) => s + v, 0) / samples.length;
  assert.ok(avg >= 75, `budget_optimizer scrutiny avg should be high, got ${avg}`);
});

test('enrich: loyalty_maximizer heavily weighted to platinum/ambassador', () => {
  let eliteCount = 0;
  for (let i = 0; i < 60; i++) {
    const out = pe.enrich({ persona: basePersona('loyalty_maximizer'), culturalContext: {}, bookingContext: {} });
    if (['platinum', 'ambassador'].includes(out.travel_history.loyalty_tier_any_brand)) eliteCount++;
  }
  assert.ok(eliteCount >= 40, `loyalty_maximizer elite tier should be >=66%, got ${eliteCount}/60`);
});

test('enrich: culture skew — middle_east_gcc dietary skews halal', () => {
  let halal = 0;
  for (let i = 0; i < 40; i++) {
    const out = pe.enrich({
      persona: basePersona('luxury_seeker'),
      culturalContext: { culture_cluster: 'middle_east_gcc' },
      bookingContext: {},
    });
    if (out.consumption.dietary_restrictions.includes('halal')) halal++;
  }
  assert.ok(halal >= 25, `middle_east_gcc halal should dominate, got ${halal}/40`);
});

test('describeForStage: dining stage surfaces dietary + alcohol', () => {
  const p = pe.enrich({ persona: basePersona('luxury_seeker'), culturalContext: {}, bookingContext: {} });
  p.consumption.dietary_restrictions = ['vegan'];
  p.consumption.alcohol_pattern = 'wine_focused';
  p.consumption.caffeine_dependency = 80;
  const s = pe.describeForStage(p, 'dinner');
  assert.match(s, /vegan/);
  assert.match(s, /wine focused/);
});

test('describeForStage: room stage surfaces room preferences', () => {
  const p = pe.enrich({ persona: basePersona('luxury_seeker'), culturalContext: {}, bookingContext: {} });
  p.room_preferences.bed_firmness_preferred = 'firm';
  p.room_preferences.pillow_count_preferred = '3';
  const s = pe.describeForStage(p, 'room_first_impression');
  assert.match(s, /firm bed/);
  assert.match(s, /3 pillows/);
});

test('describeForStage: non-enriched persona returns empty', () => {
  const s = pe.describeForStage(basePersona(), 'arrival');
  assert.strictEqual(s, '');
});

test('applyTraitSensationModifiers: high neuroticism magnifies negatives', () => {
  const deltas = { comfort_physical: -10, cleanliness: 10 };
  const calm = { enriched: true, psychographics: { ocean: { neuroticism: 25 }, trait_optimism: 55 }, noise_sensitivity_0_100: 50 };
  const anxious = { enriched: true, psychographics: { ocean: { neuroticism: 80 }, trait_optimism: 55 }, noise_sensitivity_0_100: 50 };
  const cOut = pe.applyTraitSensationModifiers(deltas, calm);
  const aOut = pe.applyTraitSensationModifiers(deltas, anxious);
  assert.ok(aOut.comfort_physical < cOut.comfort_physical, `neurotic should magnify negative: ${aOut.comfort_physical} vs ${cOut.comfort_physical}`);
});

test('applyTraitSensationModifiers: high optimism boosts positives', () => {
  const deltas = { aesthetic: 10, cleanliness: 10 };
  const pessimist = { enriched: true, psychographics: { ocean: { neuroticism: 50 }, trait_optimism: 25 }, noise_sensitivity_0_100: 50 };
  const optimist = { enriched: true, psychographics: { ocean: { neuroticism: 50 }, trait_optimism: 85 }, noise_sensitivity_0_100: 50 };
  const pOut = pe.applyTraitSensationModifiers(deltas, pessimist);
  const oOut = pe.applyTraitSensationModifiers(deltas, optimist);
  assert.ok(oOut.aesthetic > pOut.aesthetic);
  assert.ok(oOut.cleanliness > pOut.cleanliness);
});

test('applyTraitSensationModifiers: noise-sensitive amplifies crowd negatives', () => {
  const deltas = { crowd: -8 };
  const normal = { enriched: true, psychographics: { ocean: { neuroticism: 50 }, trait_optimism: 55 }, noise_sensitivity_0_100: 40 };
  const sensitive = { enriched: true, psychographics: { ocean: { neuroticism: 50 }, trait_optimism: 55 }, noise_sensitivity_0_100: 85 };
  const n = pe.applyTraitSensationModifiers(deltas, normal);
  const s = pe.applyTraitSensationModifiers(deltas, sensitive);
  assert.ok(s.crowd < n.crowd);
});

test('applyTraitSensationModifiers: non-enriched persona → no-op', () => {
  const deltas = { comfort_physical: -10 };
  const out = pe.applyTraitSensationModifiers(deltas, basePersona());
  assert.deepStrictEqual(out, deltas);
});
