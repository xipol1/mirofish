/**
 * Unit tests for confidence-intervals (bootstrap).
 * Run: node backend/tests/confidence-intervals.test.js
 */

const test = require('node:test');
const assert = require('node:assert');
const { bootstrap, addConfidenceIntervalsToSummary } = require('../services/enterprise/confidence-intervals');

test('bootstrap returns mean, ci_low, ci_high, std_dev, n', () => {
  const r = bootstrap([10, 12, 14, 16, 18, 20, 22, 24], null, { nResamples: 500, seed: 42 });
  assert.ok(r.mean >= 15 && r.mean <= 18);
  assert.ok(r.ci_low < r.mean);
  assert.ok(r.ci_high > r.mean);
  assert.ok(r.std_dev > 0);
  assert.strictEqual(r.n, 8);
});

test('bootstrap is reproducible with the same seed', () => {
  const s = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  const a = bootstrap(s, null, { nResamples: 200, seed: 7 });
  const b = bootstrap(s, null, { nResamples: 200, seed: 7 });
  assert.strictEqual(a.mean, b.mean);
  assert.strictEqual(a.ci_low, b.ci_low);
  assert.strictEqual(a.ci_high, b.ci_high);
});

test('bootstrap handles n=0 and n=1', () => {
  assert.strictEqual(bootstrap([]).mean, null);
  const one = bootstrap([42]);
  assert.strictEqual(one.mean, 42);
  assert.strictEqual(one.ci_low, 42);
  assert.strictEqual(one.ci_high, 42);
});

test('addConfidenceIntervalsToSummary decorates summary with CI shapes', () => {
  const stays = Array.from({ length: 20 }, (_, i) => ({
    sensation_summary: { nps: Math.round(Math.sin(i) * 40 + 40), stars: 3 + (i % 3) },
    expense_summary: { total_spend_eur: 100 + i * 5 },
    predicted_review: { would_repeat: i % 2 === 0, would_recommend: i % 3 === 0 },
    booking_context: { room_rate_paid_eur: 200 + i * 3 },
    post_stay: { return_intent: { return_intent_12m_probability: 0.5 + (i % 5) / 10 } },
  }));
  const summary = { avg_nps: 45, avg_stars: 4, avg_spend_eur: 150 };
  const result = addConfidenceIntervalsToSummary(summary, stays, { seed: 1 });

  assert.ok(result.avg_nps_ci);
  assert.ok(typeof result.avg_nps_ci.value === 'number');
  assert.ok(typeof result.avg_nps_ci.ci_low === 'number');
  assert.ok(typeof result.avg_nps_ci.ci_high === 'number');
  assert.ok(result.avg_nps_ci.ci_low <= result.avg_nps_ci.value);
  assert.ok(result.avg_nps_ci.ci_high >= result.avg_nps_ci.value);

  assert.ok(result.avg_spend_eur_ci);
  assert.ok(result.would_repeat_pct_ci);
  assert.ok(result.realized_star_distribution_pct_ci[3]);
});

test('addConfidenceIntervalsToSummary is a no-op with 0 stays', () => {
  const summary = { avg_nps: 0 };
  const r = addConfidenceIntervalsToSummary(summary, []);
  assert.strictEqual(r.avg_nps_ci, undefined);
});
