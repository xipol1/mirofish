/**
 * Adversarial Event Injector
 *
 * Breaks the LLM's "everything is wonderful" bias by injecting realistic
 * hospitality incidents into a subset of stays. Events are stage-scoped,
 * archetype-sensitive, and carry both a baseline negative delta AND a
 * conditional positive recovery delta (good staff can partially redeem).
 *
 * Usage:
 *   const inj = planInjections({ archetypeId, stages, seed });
 *   → returns { events: [{stage, event, resolution_quality}] }
 *
 * Then in guest-journey.js before each stage, check if an event is planned
 * for that stage and pass it to the LLM prompt + apply its deltas.
 */

const path = require('path');
const fs = require('fs');

const EVENTS_PATH = path.join(__dirname, '..', '..', 'data', 'industries', 'hospitality', 'adversarial_events.json');
const REAL_RATES_PATH = path.join(__dirname, '..', '..', 'data', 'sources', 'ops_incident_rates.json');

let _cfg = null;
let _realRates = null;
function getConfig() {
  if (_cfg) return _cfg;
  _cfg = JSON.parse(fs.readFileSync(EVENTS_PATH, 'utf-8'));
  return _cfg;
}
function getRealRates() {
  if (_realRates !== null) return _realRates;
  try {
    _realRates = fs.existsSync(REAL_RATES_PATH) ? JSON.parse(fs.readFileSync(REAL_RATES_PATH, 'utf-8')) : null;
  } catch (e) { _realRates = null; }
  return _realRates;
}

// Research-backed per-stay frequency (Cornell HQ, STR, AHLA). When the
// real_rates file is present, event weighting biases toward empirical rates
// instead of equal-probability sampling.
function realFrequencyMultiplier(eventId, tier) {
  const rates = getRealRates();
  if (!rates) return 1.0;
  const tierRates = rates.real_frequency_pct_per_stay_by_tier?.[tier];
  if (!tierRates || typeof tierRates[eventId] !== 'number') return 1.0;
  // Scale: baseline at 5% rate = 1.0 multiplier. Higher rates boost the weight.
  return Math.max(0.2, Math.min(3.0, tierRates[eventId] / 0.05));
}

function weightedPick(items, weightFn) {
  const total = items.reduce((s, it) => s + Math.max(0, weightFn(it)), 0);
  if (total <= 0) return items[Math.floor(Math.random() * items.length)];
  let r = Math.random() * total;
  for (const it of items) {
    r -= Math.max(0, weightFn(it));
    if (r <= 0) return it;
  }
  return items[items.length - 1];
}

function pickResolution(propertyTier = null) {
  const cfg = getConfig();
  const byTier = cfg.injection_config.resolution_quality_distribution_by_tier || {};
  const dist = (propertyTier && byTier[propertyTier]) || cfg.injection_config.resolution_quality_distribution;
  const entries = Object.entries(dist);
  const total = entries.reduce((s, [, p]) => s + p, 0);
  let r = Math.random() * total;
  for (const [k, p] of entries) {
    r -= p;
    if (r <= 0) return k;
  }
  return entries[entries.length - 1][0];
}

/**
 * Plan adversarial events for a stay up front.
 *
 * @returns {{events: Array<{stage: string, event: Object, resolution_quality: string}>}}
 */
function planInjections({ archetypeId, stages, forceProbabilityAtLeastOne = null, propertyTier = null }) {
  const cfg = getConfig();
  const basePOne = forceProbabilityAtLeastOne ?? cfg.injection_config.probability_at_least_one_event_per_stay;
  const tierMult = propertyTier
    ? (cfg.injection_config.trigger_probability_by_tier?.[propertyTier] ?? 1.0)
    : 1.0;
  const pOne = Math.max(0, Math.min(1, basePOne * tierMult));
  const pTwo = Math.max(0, Math.min(pOne, cfg.injection_config.probability_two_events_per_stay * tierMult));

  const roll = Math.random();
  let eventCount = 0;
  if (roll < pTwo) eventCount = 2;
  else if (roll < pOne) eventCount = 1;
  else eventCount = 0;

  if (eventCount === 0) return { events: [] };

  const stageSet = new Set(stages);
  const candidateEvents = cfg.events.filter(ev =>
    ev.stages_where_relevant.some(s => stageSet.has(s))
  );
  if (candidateEvents.length === 0) return { events: [] };

  // Bias toward events this archetype is most sensitive to AND events that
  // actually happen more often per research (Cornell HQ / STR) at this tier.
  const picked = [];
  const usedIds = new Set();
  for (let i = 0; i < eventCount; i++) {
    const pool = candidateEvents.filter(e => !usedIds.has(e.id));
    if (pool.length === 0) break;
    const ev = weightedPick(pool, e =>
      (e.archetype_sensitivity_multiplier?.[archetypeId] || 1.0)
      * realFrequencyMultiplier(e.id, propertyTier || 'luxury')
    );
    const validStages = ev.stages_where_relevant.filter(s => stageSet.has(s));
    const stage = validStages[Math.floor(Math.random() * validStages.length)];
    const resolution_quality = pickResolution(propertyTier);
    picked.push({ stage, event: ev, resolution_quality });
    usedIds.add(ev.id);
  }

  return { events: picked };
}

/**
 * Compute the net sensation deltas for an event given its resolution quality.
 * Applied AFTER the LLM has produced its narrative/deltas for the stage.
 */
function computeEventDeltas(event, resolution_quality, archetypeId) {
  const mult = event.archetype_sensitivity_multiplier?.[archetypeId] || 1.0;
  const baseline = event.baseline_sensation_deltas || {};
  const recovery = event.positive_if_resolved_well || {};

  const resolutionWeight = {
    excellent_recovery: { negative: 0.35, positive: 1.0 },
    adequate_recovery: { negative: 0.65, positive: 0.5 },
    mediocre_recovery: { negative: 1.0, positive: 0.1 },
    unresolved_or_escalated: { negative: 1.4, positive: 0 },
  }[resolution_quality] || { negative: 1.0, positive: 0 };

  const out = {};
  for (const [dim, val] of Object.entries(baseline)) {
    out[dim] = (out[dim] || 0) + val * resolutionWeight.negative * mult;
  }
  for (const [dim, val] of Object.entries(recovery)) {
    out[dim] = (out[dim] || 0) + val * resolutionWeight.positive;
  }
  // Round and clamp per-dim to reasonable range
  for (const k of Object.keys(out)) {
    out[k] = Math.round(Math.max(-35, Math.min(25, out[k])));
  }
  return out;
}

/**
 * Build the prompt snippet describing the injected event for the LLM to
 * weave into its narrative. Without this, the LLM still writes a marketing
 * narrative and ignores the delta.
 */
function buildEventPromptBlock(plannedEvent) {
  if (!plannedEvent) return '';
  const { event, resolution_quality } = plannedEvent;
  const resolutionMap = {
    excellent_recovery: 'Staff handled it proactively and exceeded expectations in recovery. Remember: even excellent recovery does not fully erase the frustration, but it shifts the emotional tone meaningfully.',
    adequate_recovery: 'Staff handled it reasonably but without exceptional empathy or proactive ownership. Guest notices the competence but not the care.',
    mediocre_recovery: 'Staff handled it transactionally. Minimum was done, no extra mile. Guest feels the friction and it colours the rest of the stay.',
    unresolved_or_escalated: 'The issue was not resolved to the guest\u2019s satisfaction — or got worse because of poor staff response. This becomes the defining moment of the stay.',
  };

  return `
=== MANDATORY INCIDENT THIS STAGE ===
You MUST incorporate the following real-world incident into the narrative for this stage. Do not omit it. It is the single most important constraint on this stage's output.

Incident: ${event.label}
Narrative guidance: ${event.narrative_hint}
Staff resolution quality: ${resolution_quality.replace(/_/g, ' ')} — ${resolutionMap[resolution_quality]}

Write the narrative honestly reflecting this incident. The guest's moments_negative array for this stage MUST include at least one specific mention of this incident (not generic). The moments_positive array MAY include the recovery if resolution was excellent/adequate.
Your sensation_deltas for this stage should reflect the negative impact — do not sugar-coat.
`;
}

module.exports = {
  planInjections,
  computeEventDeltas,
  buildEventPromptBlock,
  getConfig,
};
