/**
 * Unit tests for physical-state tracker.
 * Run: node backend/tests/physical-state.test.js
 */

const test = require('node:test');
const assert = require('node:assert');
const ps = require('../services/enterprise/physical-state');

test('initialState: European guest arrives fresh, US/JP guest arrives jetlagged', () => {
  const gb = ps.initialState({ persona: { age: 35 }, culturalContext: { origin_country_iso: 'GB' } });
  const jp = ps.initialState({ persona: { age: 35 }, culturalContext: { origin_country_iso: 'JP' } });
  const us = ps.initialState({ persona: { age: 35 }, culturalContext: { origin_country_iso: 'US' } });

  assert.ok(gb.jetlag_severity < 20, `GB jetlag should be small, got ${gb.jetlag_severity}`);
  assert.ok(jp.jetlag_severity >= 70, `JP jetlag should be high, got ${jp.jetlag_severity}`);
  assert.ok(us.jetlag_severity >= 60, `US jetlag should be substantial, got ${us.jetlag_severity}`);
  assert.strictEqual(gb.hangover, 0);
  assert.strictEqual(gb.intoxication, 0);
});

test('initialState: older guests jetlag worse than younger', () => {
  const young = ps.initialState({ persona: { age: 28 }, culturalContext: { origin_country_iso: 'JP' } });
  const old = ps.initialState({ persona: { age: 62 }, culturalContext: { origin_country_iso: 'JP' } });
  assert.ok(old.jetlag_severity > young.jetlag_severity);
});

test('applyStage: dinner drops hunger, evening adds fatigue', () => {
  let s = ps.initialState({ persona: { age: 40 }, culturalContext: { origin_country_iso: 'GB' } });
  s.hunger = 70;
  const before = s.hunger;
  s = ps.applyStage(s, { stageLabel: 'dinner' });
  assert.ok(s.hunger < before, `hunger should drop after dinner (before ${before}, after ${s.hunger})`);
  const f0 = s.fatigue;
  s = ps.applyStage(s, { stageLabel: 'evening_leisure' });
  assert.ok(s.fatigue > f0);
});

test('applyStage: drinking at dinner bumps intoxication', () => {
  let s = ps.initialState({ persona: {}, culturalContext: { origin_country_iso: 'ES' } });
  s = ps.applyStage(s, {
    stageLabel: 'dinner',
    expenses: [
      { category: 'bar', amount_eur: 14, item: 'Wine glass' },
      { category: 'bar', amount_eur: 16, item: 'Cocktail' },
      { category: 'dinner', amount_eur: 85, item: 'Tasting menu' },
    ],
  });
  assert.ok(s.intoxication >= 20, `should have intoxication after drinking, got ${s.intoxication}`);
});

test('applyStage: morning_routine rolls sleep quality and restores fatigue', () => {
  let s = ps.initialState({ persona: {}, culturalContext: { origin_country_iso: 'GB' } });
  s.fatigue = 80;
  s.intoxication = 55;
  s = ps.applyStage(s, {
    stageLabel: 'morning_routine',
    sensationSnapshot: { comfort_physical: 75, cleanliness: 75, crowd: 60, safety: 80 },
  });
  assert.ok(typeof s.sleep_quality_last_night === 'number');
  assert.ok(s.fatigue < 80, 'fatigue should drop after sleep');
  assert.strictEqual(s.intoxication, 0, 'intoxication resets overnight');
  assert.ok(s.hangover > 0, 'heavy drinking carries into hangover');
});

test('applySensationModifiers: tired+hungry guest magnifies negatives', () => {
  const rested = { fatigue: 20, hunger: 20, hangover: 0, sleep_quality_last_night: 80, intoxication: 0 };
  const wrecked = { fatigue: 80, hunger: 75, hangover: 50, sleep_quality_last_night: 30, intoxication: 0 };
  const deltas = { comfort_physical: -10, cleanliness: -8, service_quality: 5 };

  const rOut = ps.applySensationModifiers(deltas, rested);
  const wOut = ps.applySensationModifiers(deltas, wrecked);

  assert.ok(wOut.comfort_physical < rOut.comfort_physical, `wrecked negative should be more severe: ${wOut.comfort_physical} vs ${rOut.comfort_physical}`);
  assert.ok(wOut.cleanliness < rOut.cleanliness);
  assert.ok(wOut.service_quality <= rOut.service_quality);
});

test('describeForPrompt: includes all critical dims + guidance', () => {
  const s = { fatigue: 75, hunger: 65, jetlag_severity: 55, hangover: 45, intoxication: 5, sleep_quality_last_night: 35, _timezone_hours_diff: 7 };
  const p = ps.describeForPrompt(s);
  assert.match(p, /YOUR BODY RIGHT NOW/);
  assert.match(p, /quite tired|exhausted/i);
  assert.match(p, /very hungry|ravenous/i);
  assert.match(p, /hangover/i);
  assert.match(p, /HOW THIS SHAPES YOUR REACTIONS/);
});

test('rollSleepQuality: good comfort+peace gives restful sleep; bad gives poor', () => {
  const good = ps.rollSleepQuality({ comfort_physical: 85, cleanliness: 80, crowd: 70, safety: 85 }, { hangover: 0, intoxication: 0 });
  const bad = ps.rollSleepQuality({ comfort_physical: 30, cleanliness: 40, crowd: 25, safety: 50 }, { hangover: 70, intoxication: 65 });
  assert.ok(good > bad + 20);
});

test('summary: returns compact structure', () => {
  let s = ps.initialState({ persona: { age: 40 }, culturalContext: { origin_country_iso: 'US' } });
  s = ps.applyStage(s, { stageLabel: 'arrival' });
  const sum = ps.summary(s);
  assert.ok('final_fatigue' in sum);
  assert.ok('arrival_jetlag_severity' in sum);
  assert.ok('origin_country' in sum);
  assert.ok('final_thirst' in sum);
  assert.ok('final_caffeine_need' in sum);
  assert.ok('afflictions_experienced' in sum);
  assert.ok(Array.isArray(sum.history));
});

test('thirst + sun_exposure: hot outdoor stage accelerates both', () => {
  let s = ps.initialState({ persona: { age: 40 }, culturalContext: { origin_country_iso: 'GB' } });
  const before = { thirst: s.thirst, sun: s.sun_exposure_fatigue };
  s = ps.applyStage(s, {
    stageLabel: 'afternoon_activity',
    externalContext: { weather_array: [{ temp_c: 32, condition: 'sunny' }], night_number: 1 },
  });
  assert.ok(s.thirst > before.thirst + 25, `thirst should spike in hot outdoor, got ${s.thirst} (was ${before.thirst})`);
  assert.ok(s.sun_exposure_fatigue > before.sun + 20, `sun exposure should spike, got ${s.sun_exposure_fatigue}`);
});

test('caffeine: morning coffee drops need; no coffee → need climbs', () => {
  let sWithCoffee = ps.initialState({ persona: {}, culturalContext: { origin_country_iso: 'IT' } });
  sWithCoffee.caffeine_need = 70;
  sWithCoffee = ps.applyStage(sWithCoffee, {
    stageLabel: 'morning_routine',
    expenses: [{ category: 'breakfast', item: 'Espresso + croissant', amount_eur: 8 }],
    sensationSnapshot: { comfort_physical: 70, cleanliness: 70, crowd: 60, safety: 80 },
  });
  assert.ok(sWithCoffee.caffeine_need < 30, `caffeine need should drop after coffee, got ${sWithCoffee.caffeine_need}`);

  let sNoCoffee = ps.initialState({ persona: {}, culturalContext: { origin_country_iso: 'IT' } });
  sNoCoffee.caffeine_need = 70;
  sNoCoffee = ps.applyStage(sNoCoffee, {
    stageLabel: 'morning_routine',
    expenses: [],
    sensationSnapshot: { comfort_physical: 70, cleanliness: 70, crowd: 60, safety: 80 },
  });
  // No explicit coffee + morning applies -40 caffeine_need baseline. Still drops.
  // Crucially: someone with heavy coffee drops MORE.
  assert.ok(sNoCoffee.caffeine_need > sWithCoffee.caffeine_need);
});

test('afflictions: sunburn can trigger on outdoor stage with accumulated sun', () => {
  let s = ps.initialState({ persona: { age: 35 }, culturalContext: { origin_country_iso: 'GB' } });
  s.sun_exposure_fatigue = 60;
  // Force the RNG threshold: run many trials
  let gotSunburn = false;
  for (let i = 0; i < 30; i++) {
    const fresh = { ...s, active_afflictions: [] };
    const out = ps.applyStage(fresh, {
      stageLabel: 'afternoon_activity',
      externalContext: { weather_array: [{ temp_c: 32, condition: 'sunny' }], night_number: 1 },
    });
    if (out.active_afflictions.some(a => a.kind === 'sunburn')) { gotSunburn = true; break; }
  }
  assert.ok(gotSunburn, 'sunburn should be triggerable on high-sun stage');
});

test('afflictions: decay across stages', () => {
  let s = ps.initialState({ persona: { age: 35 }, culturalContext: { origin_country_iso: 'GB' } });
  s.active_afflictions = [{ kind: 'headache', severity: 0.6, onset_stage: 'arrival', description: 'test' }];
  for (let i = 0; i < 6; i++) {
    s = ps.applyStage(s, { stageLabel: 'evening_leisure' });
  }
  // Headache decays at 0.18/stage × 6 = 1.08, so severity drops below 0.04 and is pruned.
  assert.ok(!s.active_afflictions.some(a => a.kind === 'headache'), 'headache should decay away');
});

test('afflictions: drag applies to sensation deltas', () => {
  const base = { comfort_physical: 0, culinary: 0 };
  const withAfflict = { active_afflictions: [{ kind: 'stomach_upset', severity: 0.6, onset_stage: 'dinner', description: '' }] };
  const out = ps.applySensationModifiers(base, { ...withAfflict, fatigue: 30, hunger: 30, hangover: 0 });
  assert.ok(out.culinary < 0, `stomach upset should drag culinary negative, got ${out.culinary}`);
  assert.ok(out.comfort_physical < 0, `stomach upset should drag comfort negative, got ${out.comfort_physical}`);
});
