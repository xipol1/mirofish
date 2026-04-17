/**
 * Affect Tracker — maintains emotional state across a journey.
 *
 * State variables (all 0..1):
 *   energy       — decays over time and with friction
 *   patience     — decays with waits, failures, and confusion
 *   trust        — up with social proof / compliance / clarity; down with red flags
 *   frustration  — rises on errors, dead ends, broken UI
 *   confusion    — rises when mental model breaks
 *   excitement   — rises on delight moments / hot buttons
 *
 * Every action updates these. Abandonment logic reads frustration vs patience.
 */

function clamp(n, min = 0, max = 1) { return Math.max(min, Math.min(max, n)); }

function initialState(persona) {
  const t = persona?.traits || {};
  return {
    energy: 1.0,
    patience: clamp(t.patience ?? 0.5, 0.05, 1),
    trust: clamp(t.trust_baseline ?? 0.5, 0.05, 1),
    frustration: 0.0,
    confusion: 0.0,
    excitement: 0.1,
    step: 0,
    last_event: 'spawned',
  };
}

/**
 * Apply a delta to the state based on an event.
 *
 * events: 'scroll' | 'click_success' | 'click_deadend' | 'page_load_slow' | 'page_load_ok'
 *         | 'form_error' | 'form_ok' | 'trust_signal_found' | 'trust_signal_missing'
 *         | 'objection_hit' | 'hot_button_hit' | 'confusion_moment' | 'time_elapsed_step'
 *         | 'navigation' | 'error_modal' | 'success_event'
 */
function applyEvent(state, event, magnitude = 1) {
  const m = magnitude;
  const s = { ...state };
  s.step += 1;
  s.last_event = event;

  switch (event) {
    case 'scroll':
      s.energy -= 0.01 * m; break;

    case 'click_success':
      s.energy -= 0.015 * m;
      s.excitement += 0.05 * m;
      break;

    case 'click_deadend':
      s.frustration += 0.12 * m;
      s.trust -= 0.05 * m;
      s.energy -= 0.04 * m;
      break;

    case 'page_load_slow':
      s.patience -= 0.08 * m;
      s.frustration += 0.05 * m;
      break;

    case 'page_load_ok':
      s.patience = clamp(s.patience + 0.01 * m);
      break;

    case 'form_error':
      s.frustration += 0.15 * m;
      s.confusion += 0.05 * m;
      s.trust -= 0.04 * m;
      break;

    case 'form_ok':
      s.excitement += 0.08 * m;
      s.trust += 0.04 * m;
      break;

    case 'trust_signal_found':
      s.trust += 0.08 * m;
      s.frustration -= 0.02 * m;
      break;

    case 'trust_signal_missing':
      s.trust -= 0.05 * m;
      break;

    case 'objection_hit':
      s.trust -= 0.1 * m;
      s.frustration += 0.08 * m;
      break;

    case 'hot_button_hit':
      s.excitement += 0.15 * m;
      s.trust += 0.05 * m;
      break;

    case 'confusion_moment':
      s.confusion += 0.15 * m;
      s.energy -= 0.04 * m;
      break;

    case 'time_elapsed_step':
      s.energy -= 0.02 * m;
      s.patience -= 0.005 * m;
      break;

    case 'navigation':
      s.energy -= 0.015 * m;
      break;

    case 'error_modal':
      s.frustration += 0.25 * m;
      s.confusion += 0.1 * m;
      s.trust -= 0.08 * m;
      break;

    case 'success_event':
      s.excitement += 0.2 * m;
      s.trust += 0.1 * m;
      break;

    default:
      // Generic elapsed time
      s.energy -= 0.005 * m;
  }

  s.energy = clamp(s.energy);
  s.patience = clamp(s.patience);
  s.trust = clamp(s.trust);
  s.frustration = clamp(s.frustration);
  s.confusion = clamp(s.confusion);
  s.excitement = clamp(s.excitement);

  return s;
}

/**
 * Returns true if the agent would plausibly abandon at this point.
 * Pure function — deterministic given the inputs.
 */
function shouldAbandon(state, persona) {
  const patience = persona?.traits?.patience ?? 0.5;
  // Core formula: frustration vs patience, modulated by energy and confusion
  const pressure = state.frustration + state.confusion * 0.5 - patience * 1.2;
  const energyFactor = state.energy < 0.2 ? 0.2 : 0;
  const score = pressure + energyFactor;
  return score > 0.3;
}

function journeyEmotionalArc(history) {
  if (!history || history.length < 2) return 'n/a';
  const first = history[0];
  const last = history[history.length - 1];
  const deltaTrust = last.trust - first.trust;
  const deltaFrust = last.frustration - first.frustration;
  const phases = [];
  if (deltaTrust > 0.2) phases.push('trust_built');
  else if (deltaTrust < -0.2) phases.push('trust_eroded');
  if (deltaFrust > 0.3) phases.push('frustrated');
  if (last.excitement > 0.5) phases.push('excited_out');
  if (last.confusion > 0.5) phases.push('left_confused');
  return phases.join(' → ') || 'neutral';
}

module.exports = { initialState, applyEvent, shouldAbandon, journeyEmotionalArc };
