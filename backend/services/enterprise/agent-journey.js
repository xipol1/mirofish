/**
 * Agent Journey Runner — runs ONE agent's complete navigation journey.
 *
 * Lifecycle:
 *   1. Launch browser session (Chromium with anti-detection)
 *   2. Optional: auth pre-journey (login)
 *   3. Goto starting URL
 *   4. Loop up to max_steps:
 *      a. Capture perception (DOM, screenshot, interactables)
 *      b. LLM decides next action
 *      c. Execute action (scroll/click/type/...)
 *      d. Update affect state
 *      e. Check abandon conditions
 *   5. Finalize: capture outcome, emotional arc, reasoning trace
 */

const navigator = require('../../workers/navigator');
const perception = require('../../workers/perception');
const cognition = require('../../workers/cognition');
const affect = require('../../workers/affect');
const human = require('../../workers/human');
const { JourneyRecorder } = require('../../workers/journey-recorder');
const { doAuthPrejourney } = require('../../workers/auth');
const storage = require('../storage');
const db = require('../../db/pg');

const DEFAULT_MAX_STEPS = parseInt(process.env.JOURNEY_MAX_STEPS, 10) || 15;

async function runAgentJourney({
  browser,
  persona,
  orgId,
  simulationId,
  agentRunId,
  startingUrl,
  goal,
  taskType,
  authConfig,
  maxSteps = DEFAULT_MAX_STEPS,
  onProgress,
}) {
  const emit = onProgress || (() => {});
  emit({ type: 'agent_start', agent_run_id: agentRunId, persona_name: persona.name });

  const recorder = new JourneyRecorder({
    agentRunId, simulationId, orgId,
    onEvent: (e) => emit(e),
  });

  let session = null;
  let affectState = affect.initialState(persona);
  const affectHistory = [{ ...affectState }];
  const history = [];
  let finalOutcome = 'abandoned';
  let outcomeReason = '';
  const reasoningParts = [];

  try {
    session = await navigator.createSession(browser, persona);
    const { page } = session;

    // ── Optional auth pre-journey ──
    if (authConfig && authConfig.mode && authConfig.mode !== 'none') {
      emit({ type: 'auth_start', agent_run_id: agentRunId });
      const authRes = await doAuthPrejourney({ page, authConfig, persona });
      emit({ type: 'auth_result', agent_run_id: agentRunId, payload: authRes });
    }

    // ── Initial navigation ──
    const navStartedAt = Date.now();
    const navResult = await navigator.goto(page, startingUrl, persona);
    const navDuration = Date.now() - navStartedAt;

    affectState = affect.applyEvent(affectState, navResult.elapsed_ms > 4000 ? 'page_load_slow' : 'page_load_ok');

    // Screenshot + evidence
    const initialShot = await navigator.screenshot(page);
    let shotKey = null;
    if (initialShot) {
      shotKey = storage.buildKey({ orgId, simulationId, agentRunId, kind: 'screenshot', stepIndex: 0, ext: 'jpg' });
      await storage.putObject({ key: shotKey, body: initialShot, contentType: 'image/jpeg' });
      if (db.PG_AVAILABLE) {
        await db.recordEvidence({ agentRunId, simulationId, orgId, kind: 'screenshot', stepIndex: 0, storageKey: shotKey, mimeType: 'image/jpeg', sizeBytes: initialShot.length });
      }
    }

    // Initial perception
    let currentPerception = await perception.capturePage(page);
    recorder.recordStep({
      stepIndex: 0,
      action: { action: 'goto', reasoning: `Starting journey at ${startingUrl}` },
      reasoning: `Landed on ${currentPerception.title || startingUrl}`,
      urlBefore: startingUrl,
      urlAfter: page.url(),
      perceptionSummary: currentPerception,
      affectBefore: affectHistory[affectHistory.length - 1],
      affectAfter: affectState,
      result: { ok: navResult.ok },
      screenshotKey: shotKey,
      actionDurationMs: navDuration,
    });
    history.push({ step_index: 0, action: 'goto', url: startingUrl, result_ok: navResult.ok });
    affectHistory.push({ ...affectState });

    // ── Main decision loop ──
    for (let step = 1; step <= maxSteps; step++) {
      emit({ type: 'step_start', agent_run_id: agentRunId, payload: { step_index: step } });

      // Check abandonment pre-decision
      if (affect.shouldAbandon(affectState, persona) && step > 2) {
        finalOutcome = 'abandoned';
        outcomeReason = `Frustration exceeded patience after step ${step - 1}`;
        break;
      }

      // Decide
      let decision;
      try {
        decision = await cognition.decideNextAction({
          persona, goal, taskType,
          perception: currentPerception,
          affect: affectState,
          history,
          stepIndex: step - 1,
          maxSteps,
        });
      } catch (err) {
        console.error(`[journey ${agentRunId}] cognition error:`, err.message.substring(0, 200));
        finalOutcome = 'error';
        outcomeReason = `Cognition failed: ${err.message.substring(0, 100)}`;
        break;
      }

      reasoningParts.push(`[Step ${step}] ${decision.reasoning}${decision.internal_thoughts ? ' — (internal: ' + decision.internal_thoughts + ')' : ''}`);

      if (decision.action === 'goal_achieved') {
        finalOutcome = 'converted';
        outcomeReason = decision.reasoning;
        // Still record this final step
        recorder.recordStep({
          stepIndex: step,
          action: decision,
          reasoning: decision.reasoning,
          internal_thoughts: decision.internal_thoughts,
          urlBefore: page.url(),
          urlAfter: page.url(),
          perceptionSummary: currentPerception,
          affectBefore: affectState,
          affectAfter: affectState,
          result: { ok: true },
          actionDurationMs: 0,
          affectUpdates: decision.affect_updates,
        });
        break;
      }

      if (decision.action === 'abandon') {
        finalOutcome = 'abandoned';
        outcomeReason = decision.reasoning;
        recorder.recordStep({
          stepIndex: step,
          action: decision,
          reasoning: decision.reasoning,
          internal_thoughts: decision.internal_thoughts,
          urlBefore: page.url(),
          urlAfter: page.url(),
          perceptionSummary: currentPerception,
          affectBefore: affectState,
          affectAfter: affectState,
          result: { ok: true },
          actionDurationMs: 0,
          affectUpdates: decision.affect_updates,
        });
        break;
      }

      // Apply affect updates from cognition
      const affectBefore = { ...affectState };
      const updates = decision.affect_updates || {};
      if (updates.trust_signal_found) affectState = affect.applyEvent(affectState, 'trust_signal_found');
      if (updates.trust_signal_missing) affectState = affect.applyEvent(affectState, 'trust_signal_missing');
      if (updates.objection_hit) affectState = affect.applyEvent(affectState, 'objection_hit');
      if (updates.hot_button_hit) affectState = affect.applyEvent(affectState, 'hot_button_hit');
      if (updates.confusion_moment) affectState = affect.applyEvent(affectState, 'confusion_moment');

      // Execute action
      const urlBefore = page.url();
      const actionStart = Date.now();
      let result = { ok: false };

      if (decision.action === 'scroll') {
        await navigator.scroll(page, persona, decision.direction || 'down');
        result = { ok: true };
        affectState = affect.applyEvent(affectState, 'scroll');
      } else if (decision.action === 'click') {
        result = await navigator.clickByIndex(page, currentPerception.interactables, decision.target_index, persona);
        affectState = affect.applyEvent(affectState, result.ok ? 'click_success' : 'click_deadend');
      } else if (decision.action === 'type') {
        const el = currentPerception.interactables[decision.target_index];
        if (el && el.selector) {
          result = await navigator.typeText(page, el.selector, decision.value || '', persona);
        } else {
          result = { ok: false, error: 'no selector for type action' };
        }
      } else if (decision.action === 'submit') {
        result = await navigator.pressKey(page, 'Enter', persona);
      } else if (decision.action === 'back') {
        result = await navigator.goBack(page, persona);
        affectState = affect.applyEvent(affectState, 'navigation');
      } else if (decision.action === 'wait') {
        await human.sleep(human.randRange(1500, 4000));
        result = { ok: true };
        affectState = affect.applyEvent(affectState, 'time_elapsed_step');
      }

      const actionDuration = Date.now() - actionStart;

      // Re-perceive after action
      currentPerception = await perception.capturePage(page);

      // Capture screenshot for this step
      const stepShot = await navigator.screenshot(page);
      let stepShotKey = null;
      if (stepShot) {
        stepShotKey = storage.buildKey({ orgId, simulationId, agentRunId, kind: 'screenshot', stepIndex: step, ext: 'jpg' });
        await storage.putObject({ key: stepShotKey, body: stepShot, contentType: 'image/jpeg' });
        if (db.PG_AVAILABLE) {
          await db.recordEvidence({ agentRunId, simulationId, orgId, kind: 'screenshot', stepIndex: step, storageKey: stepShotKey, mimeType: 'image/jpeg', sizeBytes: stepShot.length });
        }
      }

      recorder.recordStep({
        stepIndex: step,
        action: decision,
        reasoning: decision.reasoning,
        internal_thoughts: decision.internal_thoughts,
        urlBefore,
        urlAfter: page.url(),
        perceptionSummary: currentPerception,
        affectBefore,
        affectAfter: affectState,
        result,
        screenshotKey: stepShotKey,
        actionDurationMs: actionDuration,
        affectUpdates: updates,
      });
      history.push({
        step_index: step, action: decision.action,
        url: page.url(), result_ok: result.ok,
        reasoning: decision.reasoning,
      });
      affectHistory.push({ ...affectState });
    }

    // If loop ended naturally without decision
    if (!['converted', 'abandoned', 'error'].includes(finalOutcome)) {
      const trustFinal = affectState.trust;
      const excFinal = affectState.excitement;
      if (trustFinal > 0.7 && excFinal > 0.5) { finalOutcome = 'interested'; outcomeReason = 'High trust and interest at step limit, but did not convert.'; }
      else if (trustFinal > 0.5) { finalOutcome = 'interested'; outcomeReason = 'Moderately interested at step limit.'; }
      else { finalOutcome = 'bounced'; outcomeReason = 'Ran out of steps without meaningful engagement.'; }
    }

  } catch (err) {
    console.error(`[journey ${agentRunId}] runtime error:`, err.message);
    finalOutcome = 'error';
    outcomeReason = `Runtime error: ${err.message.substring(0, 200)}`;
  } finally {
    if (session) await navigator.closeSession(session).catch(() => {});
  }

  recorder.setFinal({
    outcome: finalOutcome,
    outcomeReason,
    finalState: affectState,
    reasoningTrace: reasoningParts.join('\n'),
  });

  const summary = recorder.getSummary();
  summary.emotional_arc = affect.journeyEmotionalArc(affectHistory);
  summary.persona = persona;

  emit({
    type: 'agent_complete',
    agent_run_id: agentRunId,
    payload: { outcome: finalOutcome, steps: summary.total_steps, duration_ms: summary.total_duration_ms },
  });

  return summary;
}

module.exports = { runAgentJourney };
