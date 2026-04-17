/**
 * Journey Recorder — captures every step of an agent's journey as structured events.
 *
 * Each step stores:
 *   - action taken + reasoning
 *   - perception snapshot summary
 *   - affect state before/after
 *   - URL before/after
 *   - result (ok/fail)
 *   - screenshot reference
 *   - timing data
 */

class JourneyRecorder {
  constructor({ agentRunId, simulationId, orgId, onEvent } = {}) {
    this.agentRunId = agentRunId;
    this.simulationId = simulationId;
    this.orgId = orgId;
    this.steps = [];
    this.startedAt = Date.now();
    this.onEvent = onEvent || (() => {});
  }

  recordStep({ stepIndex, action, reasoning, internal_thoughts, urlBefore, urlAfter, perceptionSummary, affectBefore, affectAfter, result, screenshotKey, actionDurationMs, affectUpdates }) {
    const step = {
      step_index: stepIndex,
      ts: Date.now(),
      action: action.action,
      target_index: action.target_index ?? null,
      target_label: perceptionSummary?.clicked_label || null,
      value: action.value || null,
      direction: action.direction || null,
      reasoning: reasoning || action.reasoning || '',
      internal_thoughts: internal_thoughts || null,
      url_before: urlBefore,
      url_after: urlAfter,
      result_ok: result?.ok ?? null,
      result_error: result?.error || null,
      screenshot_key: screenshotKey || null,
      action_duration_ms: actionDurationMs,
      affect_before: affectBefore,
      affect_after: affectAfter,
      affect_updates: affectUpdates || {},
      perception_summary: {
        headings_count: perceptionSummary?.headings?.length || 0,
        interactables_count: perceptionSummary?.interactables?.length || 0,
        scroll_pct: perceptionSummary?.scroll_pct || 0,
        trust_signals: perceptionSummary?.trust_signals || {},
      },
    };
    this.steps.push(step);

    this.onEvent({
      type: 'agent_step',
      agent_run_id: this.agentRunId,
      simulation_id: this.simulationId,
      payload: {
        step_index: stepIndex,
        action: step.action,
        reasoning: step.reasoning.substring(0, 280),
        url: urlAfter || urlBefore,
        result_ok: step.result_ok,
      },
    });

    return step;
  }

  setFinal({ outcome, outcomeReason, finalState, reasoningTrace }) {
    this.outcome = outcome;
    this.outcomeReason = outcomeReason;
    this.finalState = finalState;
    this.reasoningTrace = reasoningTrace;
    this.completedAt = Date.now();
  }

  getSummary() {
    return {
      agent_run_id: this.agentRunId,
      total_steps: this.steps.length,
      total_duration_ms: (this.completedAt || Date.now()) - this.startedAt,
      outcome: this.outcome,
      outcome_reason: this.outcomeReason,
      final_state: this.finalState,
      steps: this.steps,
      reasoning_trace: this.reasoningTrace || null,
      started_at: this.startedAt,
      completed_at: this.completedAt,
    };
  }
}

module.exports = { JourneyRecorder };
