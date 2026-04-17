/**
 * Launch Simulation — enterprise orchestrator for full multi-agent Playwright runs.
 *
 * Steps:
 *   1. Classify task type + decompose audience (reuses existing modules)
 *   2. Generate N task-adaptive personas (reuses existing personaGenerator)
 *   3. Launch 1 shared Chromium browser (sessions are per-agent contexts)
 *   4. Run N agent journeys concurrently (up to PLAYWRIGHT_CONCURRENCY)
 *   5. Compute enterprise journey metrics (funnel, drop-off, segment analysis)
 *   6. Synthesize insights + recommendations (existing modules)
 *   7. Persist all evidence + results to Postgres + storage
 */

const navigator = require('../../workers/navigator');
const { runAgentJourney } = require('./agent-journey');
const { classifyTask } = require('../taskClassifier');
const { decomposeAudience } = require('../audienceDecomposer');
const { generatePersonas } = require('../personaGenerator');
const { computeEnterpriseMetrics } = require('./enterprise-metrics');
const { generateInsights } = require('../insights');
const { generateRecommendations } = require('../recommendations');
const db = require('../../db/pg');
const { getCohortSize, getProvider } = require('../ai');

const CONCURRENCY = parseInt(process.env.PLAYWRIGHT_CONCURRENCY, 10) || 4;

async function runEnterpriseSimulation({
  orgId,
  simulationId,
  input,          // { target_url, audience, goal, task_type?, agent_count?, auth_config?, starting_url?, industry? }
  onProgress,
}) {
  const emit = onProgress || (() => {});
  emit({ type: 'sim_start', phase: 'starting', payload: { message: 'Starting enterprise simulation' } });

  const requestedCount = parseInt(input.agent_count, 10);
  const cohortSize = Number.isFinite(requestedCount) && requestedCount > 0 ? Math.min(requestedCount, 500) : getCohortSize();
  const targetUrl = input.starting_url || input.target_url;
  if (!targetUrl) throw new Error('target_url or starting_url is required for enterprise simulation');

  const industrySlug = (input.industry || 'default').toLowerCase();
  emit({ type: 'industry_resolved', payload: { industry: industrySlug } });

  // ── Phase 1: task classification ──
  emit({ type: 'phase_start', phase: 'classifying', phase_index: 1, payload: { message: 'Classifying task type' } });
  const classification = await classifyTask({ url: targetUrl, audience: input.audience, explicitType: input.task_type });
  const taskType = classification.task_type;

  // ── Phase 2: audience decomposition ──
  emit({ type: 'phase_start', phase: 'decomposing_audience', phase_index: 2, payload: { message: 'Parsing audience' } });
  const audienceVector = await decomposeAudience(input.audience);

  // ── Phase 3: personas ──
  emit({ type: 'phase_start', phase: 'generating_personas', phase_index: 3, payload: { message: `Generating ${cohortSize} personas (industry: ${industrySlug})` } });
  const personas = await generatePersonas({
    taskType,
    audienceVector,
    count: cohortSize,
    industrySlug,
    onProgress: (p) => emit({ type: 'phase_progress', phase: 'generating_personas', payload: p }),
  });

  // Persist personas + create agent runs
  if (db.PG_AVAILABLE && orgId && simulationId) {
    await db.updateSimulation(simulationId, {
      task_type: taskType,
      audience_vector: audienceVector,
    });
  }

  // ── Phase 4: Launch shared browser ──
  emit({ type: 'phase_start', phase: 'launching_browser', phase_index: 4, payload: { message: 'Launching Chromium cluster' } });
  const browser = await navigator.launchBrowser();

  // ── Phase 5: Agent journeys (concurrent) ──
  emit({ type: 'phase_start', phase: 'running_agents', phase_index: 5, payload: { message: `Running ${personas.length} agent journeys`, total: personas.length } });

  const journeys = new Array(personas.length);
  let nextIdx = 0;
  let completed = 0;

  async function worker(workerId) {
    while (true) {
      const myIdx = nextIdx++;
      if (myIdx >= personas.length) return;
      const persona = personas[myIdx];

      // Create agent run in DB
      let agentRunId = `local-${myIdx}`;
      if (db.PG_AVAILABLE && orgId && simulationId) {
        try {
          agentRunId = await db.createAgentRun({
            simulationId, orgId, slotIndex: myIdx, persona, archetypeId: persona.archetype_id || persona._archetype_id,
            startingUrl: targetUrl,
          });
        } catch (e) { console.error('[sim] createAgentRun failed', e.message); }
      }

      emit({
        type: 'agent_picked',
        payload: { worker_id: workerId, slot: myIdx, persona_name: persona.name, archetype: persona.archetype_label, total: personas.length },
      });

      try {
        const journey = await runAgentJourney({
          browser,
          persona,
          orgId,
          simulationId,
          agentRunId,
          startingUrl: targetUrl,
          goal: input.goal,
          taskType,
          authConfig: input.auth_config,
          onProgress: (e) => emit(e),
        });
        journey._persona_name = persona.name;
        journey._persona_archetype_label = persona.archetype_label;
        journey._archetype_id = persona.archetype_id || persona._archetype_id;
        journeys[myIdx] = journey;

        if (db.PG_AVAILABLE) {
          try {
            await db.completeAgentRun(agentRunId, {
              status: 'completed',
              journey_steps: journey.steps,
              final_state: journey.final_state,
              outcome: journey.outcome,
              outcome_reason: journey.outcome_reason,
              reasoning_trace: journey.reasoning_trace,
              steps_completed: journey.total_steps,
              total_duration_ms: journey.total_duration_ms,
            });
          } catch (e) { console.error('[sim] completeAgentRun failed', e.message); }
        }

        completed++;
        emit({ type: 'agent_completed', payload: { slot: myIdx, persona_name: persona.name, outcome: journey.outcome, completed, total: personas.length } });
      } catch (err) {
        console.error(`[sim] agent ${myIdx} failed:`, err.message);
        journeys[myIdx] = {
          _persona_name: persona.name,
          _persona_archetype_label: persona.archetype_label,
          _archetype_id: persona.archetype_id || persona._archetype_id,
          outcome: 'error',
          outcome_reason: err.message.substring(0, 200),
          steps: [],
          final_state: {},
        };
        completed++;
      }
    }
  }

  const workers = Array.from({ length: Math.min(CONCURRENCY, personas.length) }, (_, i) => worker(i + 1));
  await Promise.all(workers);

  try { await browser.close(); } catch (e) { /* ignore */ }

  // ── Phase 6: Metrics ──
  emit({ type: 'phase_start', phase: 'computing_metrics', phase_index: 6, payload: { message: 'Computing journey metrics' } });
  const metrics = computeEnterpriseMetrics(journeys, personas);

  // ── Phase 7: Insights ──
  emit({ type: 'phase_start', phase: 'synthesizing_insights', phase_index: 7, payload: { message: 'Synthesizing insights' } });
  const agentResultsForInsights = journeys.map(j => ({
    ...j,
    reasoning: j.reasoning_trace || '',
    outcome: j.outcome,
    outcome_reason: j.outcome_reason,
    friction_points: extractFrictionPoints(j),
    trust_signals_found: extractTrustFound(j),
    trust_signals_missing: extractTrustMissing(j),
    attention_path: (j.steps || []).map(s => s.url_after).filter(Boolean).slice(0, 8),
  }));

  const scenarioApprox = { url: targetUrl, hero: null, pricing: { visible: metrics.pricing_reached > 0 } };
  const insights = await generateInsights({
    metrics, agentResults: agentResultsForInsights, scenario: scenarioApprox, taskType, personas,
  }).catch(err => ({ headline: `Simulation completed. ${metrics.conversion_rate}% converted.`, patterns: [], _error: err.message }));

  // ── Phase 8: Recommendations ──
  emit({ type: 'phase_start', phase: 'generating_recommendations', phase_index: 8, payload: { message: 'Generating recommendations' } });
  const recommendations = await generateRecommendations({
    insights, metrics, scenario: scenarioApprox, audienceVector, taskType, goal: input.goal, industrySlug,
  }).catch(err => [{ priority: 1, action: 'Review the journey data manually.', evidence: `Recommendation engine failed: ${err.message.substring(0, 100)}`, confidence: 'low', effort: 'medium', expected_impact: 'N/A' }]);

  if (db.PG_AVAILABLE && simulationId) {
    await db.updateSimulation(simulationId, {
      status: 'completed',
      completed_at: new Date(),
      metrics,
      insights,
      recommendations,
    });
  }

  emit({ type: 'sim_complete', payload: { agents: journeys.length, conversion_rate: metrics.conversion_rate } });

  return {
    mode: 'ENTERPRISE',
    provider: getProvider(),
    industry: industrySlug,
    task_type: taskType,
    task_classification: classification,
    audience_vector: audienceVector,
    personas,
    agent_results: journeys,
    metrics,
    insights,
    recommendations,
    headline: insights.headline,
    outcomes: {
      total: metrics.total_agents,
      converted: metrics.converted,
      bounced: metrics.bounced,
      interested: metrics.interested,
      abandoned: metrics.abandoned,
      conversion_rate: metrics.conversion_rate,
    },
  };
}

// Helper extractors
function extractFrictionPoints(journey) {
  if (!journey.steps) return [];
  return journey.steps
    .filter(s => s.result_ok === false || s.affect_updates?.confusion_moment || s.affect_updates?.objection_hit)
    .map(s => ({
      where: s.url_after || s.url_before || 'unknown',
      what: s.reasoning ? s.reasoning.substring(0, 160) : 'friction detected',
      severity: s.affect_updates?.objection_hit ? 'high' : 'medium',
    }))
    .slice(0, 5);
}

function extractTrustFound(journey) {
  if (!journey.steps) return [];
  return journey.steps
    .filter(s => s.affect_updates?.trust_signal_found)
    .map(s => (s.reasoning || '').substring(0, 120))
    .slice(0, 5);
}

function extractTrustMissing(journey) {
  if (!journey.steps) return [];
  return journey.steps
    .filter(s => s.affect_updates?.trust_signal_missing)
    .map(s => (s.reasoning || '').substring(0, 120))
    .slice(0, 5);
}

module.exports = { runEnterpriseSimulation };
