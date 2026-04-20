/**
 * Temperature Mapper — Entregable 4
 *
 * Replaces the hardcoded temperature: 0.8 in narrative-engine and the 0.75 in
 * review-predictor with a per-persona, per-stage temperature derived from the
 * agent's traits. A disciplined German business_traveler (low openness, high
 * conscientiousness) generates around 0.55 — a Latin honeymooner (high
 * openness, high neuroticism, high optimism) around 0.95. Both are bounded
 * to [0.55, 1.02] so voice coherence survives.
 *
 * Attacks the "homogeneización" failure mode: identical temperature → similar
 * rhetorical structure across 50 agents.
 *
 * Reads persona.ocean, persona.trait_optimism, persona.archetype_id, and the
 * cultural cluster (optional) to shape the output.
 */

const ARCHETYPE_SHIFT = {
  business_traveler: -0.06,
  budget_optimizer:  -0.08,
  loyalty_maximizer: -0.05,
  luxury_seeker:     -0.04,
  family_vacationer:  0,
  event_attendee:     0,
  digital_nomad:     +0.02,
  honeymooner:       +0.05,
};

const CULTURAL_SHIFT = {
  german_dach:       -0.05,
  nordic:            -0.04,
  east_asian:        -0.04,
  chinese_mainland:  -0.03,
  anglo_uk_ireland:  -0.02,
  anglo_us_canada:    0,
  french:             0,
  indo_pacific:       0,
  middle_east_gcc:   +0.01,
  latin_spain_italy: +0.04,
  latin_american:    +0.05,
  latam:             +0.05, // alias compatibility
};

const STAGE_SHIFT = {
  pre_arrival:     0,
  primer_impulso:  0,
  perceive:        0,
  evaluate:       -0.05,
  feel:            0,
  tension:        -0.02,
  tension_resolution: -0.02,
  decide:          0,
  review_writing: +0.03,
  // narrative-engine stages — all process perceive+evaluate+feel in one call
  arrival: 0,
  room_first_impression: 0,
  evening_1: 0,
  morning_routine: 0,
  daytime_activity: 0,
  lunch: 0,
  afternoon_activity: 0,
  dinner: 0,
  evening_leisure: 0,
  last_morning: 0,
  checkout: -0.02,
};

const CLAMP_MIN = 0.55;
const CLAMP_MAX = 1.02;
const BASE = 0.72;

function temperatureForAgent(persona, stage = 'perceive') {
  const ocean = persona?.ocean || {};
  const openness = Number.isFinite(ocean.openness) ? ocean.openness : 50;
  const neuroticism = Number.isFinite(ocean.neuroticism) ? ocean.neuroticism : 50;
  const conscientiousness = Number.isFinite(ocean.conscientiousness) ? ocean.conscientiousness : 50;
  const optimism = Number.isFinite(persona?.trait_optimism) ? persona.trait_optimism : 50;

  const traitDelta =
      (openness - 50) / 500
    + (neuroticism - 50) / 625
    - (conscientiousness - 50) / 500
    + (optimism - 50) / 1000;

  const archetypeId = persona?.archetype_id || persona?._archetype_id;
  const archShift = ARCHETYPE_SHIFT[archetypeId] ?? 0;

  const cluster = persona?.cultural_cluster
    || persona?.cultural_context?.culture_cluster
    || null;
  const cultShift = CULTURAL_SHIFT[cluster] ?? 0;

  const stageKey = String(stage || 'perceive').toLowerCase();
  const stageShift = STAGE_SHIFT[stageKey] ?? 0;

  const raw = BASE + traitDelta + archShift + cultShift + stageShift;
  const clamped = Math.max(CLAMP_MIN, Math.min(CLAMP_MAX, raw));
  return Number(clamped.toFixed(3));
}

/**
 * Attach an explanation of which knobs moved the temperature — useful when
 * debugging homogenization complaints.
 */
function temperatureBreakdown(persona, stage = 'perceive') {
  const ocean = persona?.ocean || {};
  const openness = ocean.openness ?? 50;
  const neuroticism = ocean.neuroticism ?? 50;
  const conscientiousness = ocean.conscientiousness ?? 50;
  const optimism = persona?.trait_optimism ?? 50;
  const traitDelta = (openness - 50) / 500 + (neuroticism - 50) / 625 - (conscientiousness - 50) / 500 + (optimism - 50) / 1000;
  const archShift = ARCHETYPE_SHIFT[persona?.archetype_id || persona?._archetype_id] ?? 0;
  const cluster = persona?.cultural_cluster || persona?.cultural_context?.culture_cluster || null;
  const cultShift = CULTURAL_SHIFT[cluster] ?? 0;
  const stageKey = String(stage || 'perceive').toLowerCase();
  const stageShift = STAGE_SHIFT[stageKey] ?? 0;
  return {
    base: BASE,
    trait_delta: Number(traitDelta.toFixed(3)),
    archetype_shift: archShift,
    cultural_shift: cultShift,
    stage_shift: stageShift,
    final: temperatureForAgent(persona, stage),
  };
}

module.exports = {
  temperatureForAgent,
  temperatureBreakdown,
  ARCHETYPE_SHIFT,
  CULTURAL_SHIFT,
  STAGE_SHIFT,
};
