/**
 * Simulation Orchestrator — modality-agnostic.
 *
 * Runs any modality (stay_experience, booking_engine_test, rate_strategy_test,
 * loyalty_change_test) through a common pipeline:
 *   1. Validate inputs for the chosen modality
 *   2. Decompose audience → audience vector
 *   3. Load calibration (real review corpus anchor)
 *   4. Generate personas
 *   5. If the modality uses target star sampling, assign targets
 *   6. For each persona: build agent context (via modality) + run (via modality)
 *   7. Aggregate results (via modality)
 *   8. Emit progress events throughout
 *
 * The orchestrator knows NOTHING about stages, prompts, or output schemas.
 * Those live in the modality.
 */

const { generatePersonas } = require('../personaGenerator');
const { decomposeAudience } = require('../audienceDecomposer');
const { aggregateReviews, toCalibrationSignals } = require('../data/review-parser');
const db = require('../../db/pg');
const { getProvider } = require('../ai');
const modalityRegistry = require('./modalities');
const cohortEnforcer = require('./cohort-enforcer');

const CONCURRENCY = parseInt(process.env.PLAYWRIGHT_CONCURRENCY, 10) || 3;

/**
 * @param {Object} opts
 * @param {string} opts.modality                   Modality id (required)
 * @param {string} opts.orgId
 * @param {string} opts.simulationId
 * @param {Object} opts.property                   For property-based modalities
 * @param {string} opts.audience                   Free-text audience description
 * @param {number} opts.agent_count                Default 10
 * @param {Function} opts.onProgress
 * @param {boolean} opts.inlineMode                true = skip DB persistence
 * @param {Object} opts.calibrationOverride        For inline mode
 * @param {Object} opts.modality_inputs            Modality-specific additional inputs
 *                                                 (booking_flow_spec, rate_variants,
 *                                                 program_current_state, etc.)
 */
async function runSimulation(opts) {
  const {
    modality: modalityId,
    orgId, simulationId, property, audience,
    agent_count = 10,
    onProgress,
    inlineMode = false,
    calibrationOverride = null,
    modality_inputs = {},
  } = opts;

  const emit = onProgress || (() => {});

  if (!modalityId) throw new Error('modality is required');
  const modality = modalityRegistry.get(modalityId);

  emit({
    type: 'sim_start',
    phase: 'starting',
    payload: {
      modality: modality.id,
      modality_label: modality.label,
      property_name: property?.name,
      provider: getProvider(),
    },
  });

  // Validate modality-specific inputs
  const validationInput = {
    property,
    audience,
    ...modality_inputs,
  };
  const validation = modality.validateInputs(validationInput);
  if (!validation.ok) {
    const err = new Error(`Modality '${modality.id}' input validation failed: ${validation.errors.join('; ')}`);
    err.validation_errors = validation.errors;
    throw err;
  }
  const globalCtx = validation.normalized;

  // Phase 1: audience decomposition
  // Pass the hospitality vertical hint upfront so the decomposer uses the
  // hospitality schema instead of forcing guest-type audiences into SaaS fields.
  emit({ type: 'phase_start', phase: 'decomposing_audience', phase_index: 1 });
  const audienceVector = await decomposeAudience(audience, { vertical_hint: 'hospitality' });
  audienceVector.vertical = 'hospitality';

  // Phase 2: Load calibration (if property-based modality)
  emit({ type: 'phase_start', phase: 'loading_calibration', phase_index: 2 });
  let calibration = {};
  if (property) {
    if (inlineMode) {
      calibration = calibrationOverride
        || property?.data_json?.historical_performance
        || loadPrebuiltCalibration(property)
        || {};
    } else {
      calibration = await buildCalibrationSignals(property);
    }
  }
  globalCtx.calibration = calibration;
  emit({
    type: 'calibration_loaded',
    payload: {
      review_count: calibration.review_count || 0,
      avg_rating: calibration.avg_rating,
      star_distribution_pct: calibration.star_distribution_pct,
    },
  });

  // Phase 3: Generate personas (or reuse frozen ones for counterfactual pairing)
  emit({ type: 'phase_start', phase: 'generating_personas', phase_index: 3, payload: { message: `Generating ${agent_count} personas` } });
  const frozenPersonas = modality_inputs._frozen_personas;
  const frozenContexts = modality_inputs._frozen_contexts;
  const personas = Array.isArray(frozenPersonas) && frozenPersonas.length === agent_count
    ? frozenPersonas
    : await generatePersonas({
        taskType: 'landing_page',
        audienceVector,
        count: agent_count,
        industrySlug: 'hospitality',
        seedPersonas: Array.isArray(frozenPersonas) ? frozenPersonas : undefined,
        onProgress: (p) => emit({ type: 'phase_progress', phase: 'generating_personas', payload: p }),
      });

  // Phase 3.5: If modality uses target star sampling, assign targets
  let targetStars = new Array(personas.length).fill(null);
  if (modality.uses_target_star_sampling && typeof modality.assignTargetStars === 'function') {
    targetStars = modality.assignTargetStars(personas, calibration);
    emit({
      type: 'phase_start',
      phase: 'target_stars_assigned',
      phase_index: 3.5,
      payload: {
        assigned: personas.map((p, i) => ({
          persona: p.name,
          archetype: p.archetype_id || p._archetype_id,
          target_stars: targetStars[i],
        })),
      },
    });
  }

  // Phase 3.6: Per-persona agent context (delegated to modality, or reuse frozen)
  emit({ type: 'phase_start', phase: 'building_agent_contexts', phase_index: 3.6 });
  const agentContexts = Array.isArray(frozenContexts) && frozenContexts.length === personas.length
    ? frozenContexts
    : personas.map((persona, i) =>
        modality.buildAgentContext({
          persona,
          globalCtx,
          targetStars: targetStars[i],
        })
      );

  // Phase 3.7: Cohort-level distribution enforcement
  //   Audits the generated cohort vs the market pack(s) and rebalances
  //   where empirical distributions drift > tolerance_pp.
  let cohortEnforcementAudit = null;
  const enforcementPacks = globalCtx.market_pack_ids || globalCtx.modality_inputs?.market_pack_ids || [];
  if (enforcementPacks.length > 0) {
    emit({ type: 'phase_start', phase: 'enforcing_distributions', phase_index: 3.7 });
    cohortEnforcementAudit = cohortEnforcer.enforceDistributions({
      agentContexts,
      marketPackIds: enforcementPacks,
      tolerance_pp: globalCtx.cohort_tolerance_pp || 5,
      onProgress: (p) => emit({ type: 'cohort_enforcement_progress', payload: p }),
    });
    emit({
      type: 'cohort_enforced',
      payload: {
        fidelity_score_pct: cohortEnforcementAudit.fidelity_score_pct,
        fidelity_passed: cohortEnforcementAudit.fidelity_passed,
        total_reassignments: cohortEnforcementAudit.total_reassignments,
        reassignment_rate_pct: cohortEnforcementAudit.reassignment_rate_pct,
        dimensions_checked: cohortEnforcementAudit.dimensions_checked,
      },
    });
  } else {
    emit({ type: 'cohort_enforcement_skipped', payload: { reason: 'no market packs specified' } });
  }

  // Phase 4: Run each agent through the modality
  emit({
    type: 'phase_start',
    phase: 'running_agents',
    phase_index: 4,
    payload: { message: `Running ${personas.length} agents through ${modality.label}`, total: personas.length },
  });
  const records = new Array(personas.length);
  let nextIdx = 0;
  let completed = 0;

  async function worker() {
    while (true) {
      const myIdx = nextIdx++;
      if (myIdx >= personas.length) return;
      const persona = personas[myIdx];
      const agentCtx = agentContexts[myIdx];

      emit({
        type: 'agent_start',
        payload: {
          slot: myIdx,
          persona_name: persona.name,
          archetype: persona.archetype_label,
          total: personas.length,
        },
      });

      try {
        const record = await modality.runForAgent({
          persona,
          agentCtx,
          globalCtx,
          onStage: (stage) => emit({
            type: 'agent_stage',
            payload: { slot: myIdx, persona_name: persona.name, stage },
          }),
        });
        records[myIdx] = record;

        // Persist to DB if applicable (only for stay_experience currently)
        if (modality.id === 'stay_experience' && db.PG_AVAILABLE && orgId && simulationId) {
          try {
            await persistStayRecord({ simulationId, orgId, property, persona, record });
          } catch (err) {
            console.error('[orchestrator] DB insert failed:', err.message.substring(0, 150));
          }
        }

        completed++;
        emit({
          type: 'agent_complete',
          payload: {
            slot: myIdx,
            persona_name: persona.name,
            completed,
            total: personas.length,
            summary: extractAgentSummary(modality.id, record),
          },
        });
      } catch (err) {
        console.error(`[orchestrator] Agent ${myIdx} failed:`, err.message.substring(0, 150));
        records[myIdx] = {
          error: err.message.substring(0, 200),
          persona_full: persona,
        };
        completed++;
      }
    }
  }

  const workers = Array.from({ length: Math.min(CONCURRENCY, personas.length) }, () => worker());
  await Promise.all(workers);

  // Phase 5: Aggregate
  emit({ type: 'phase_start', phase: 'aggregating', phase_index: 5 });
  const summary = modality.aggregateResults(records, globalCtx);

  // Phase 5.1: Confidence intervals (stay_experience only — safe additive)
  if (modality.id === 'stay_experience') {
    try {
      const { addConfidenceIntervalsToSummary } = require('./confidence-intervals');
      addConfidenceIntervalsToSummary(summary, records);
    } catch (err) {
      console.error('[orchestrator] CI computation failed:', err.message.substring(0, 150));
    }
  }

  // Phase 5.2: Longitudinal persistence (opt-in, no-op if PG unavailable)
  if (modality.id === 'stay_experience' && db.PG_AVAILABLE && simulationId) {
    try {
      const agentPersist = require('./agent-persistence');
      await agentPersist.persistSimulationAgents({
        simulationId,
        personas,
        records,
        property,
      });
    } catch (err) {
      console.error('[orchestrator] agent persist failed:', err.message.substring(0, 150));
    }
  }

  emit({ type: 'sim_complete', payload: summary });

  return {
    modality: modality.id,
    modality_label: modality.label,
    provider: getProvider(),
    industry: 'hospitality',
    property: property ? { id: property.id, name: property.name, brand: property.brand } : null,
    audience_vector: audienceVector,
    personas,
    agent_contexts: agentContexts,
    records,
    calibration,
    cohort_enforcement: cohortEnforcementAudit,
    summary,
  };
}

// ─── Helpers ──────────────────────────────────────────────────────

/**
 * Extract a compact summary for the agent_complete event based on modality.
 */
function extractAgentSummary(modalityId, record) {
  if (!record || record.error) return { error: record?.error };

  switch (modalityId) {
    case 'stay_experience':
      return {
        stars: record.sensation_summary?.stars,
        nps: record.sensation_summary?.nps,
        total_spend_eur: record.expense_summary?.total_spend_eur,
        will_review: record.predicted_review?.will_write_review,
        platform: record.predicted_review?.platform,
      };
    case 'booking_engine_test':
      return {
        converted: record.converted,
        abandoned: record.abandoned,
        abandonment_stage: record.abandonment_stage,
        final_trust_score: record.final_trust_score,
      };
    case 'rate_strategy_test':
      return {
        variant: record.rate_variant?.label,
        booked: record.booked,
        walk_away: record.walk_away_triggered,
        revenue_eur: record.revenue_contribution_eur,
      };
    case 'loyalty_change_test':
      return {
        tier: record.current_tier,
        churn_risk: record.churn_risk,
        retention_intent: record.retention_intent_12m_pct,
        favorability: record.final_favorability_0_100,
      };
    default:
      return {};
  }
}

function loadPrebuiltCalibration(property) {
  if (!property) return null;
  const path = require('path');
  const fs = require('fs');
  const slug = property.slug
    || (property.name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  if (!slug) return null;

  const candidatePaths = [
    path.join(__dirname, '..', '..', 'data', 'industries', 'hospitality', `${slug}_calibration.json`),
    slug.includes('villa-le-blanc') ? path.join(__dirname, '..', '..', 'data', 'industries', 'hospitality', 'villa_le_blanc_calibration.json') : null,
  ].filter(Boolean);

  for (const p of candidatePaths) {
    try {
      if (fs.existsSync(p)) {
        const content = JSON.parse(fs.readFileSync(p, 'utf-8'));
        console.log(`[orchestrator] Loaded prebuilt calibration: ${path.basename(p)} (${content.review_count} reviews, ${content.avg_rating}★)`);
        return content;
      }
    } catch (err) {
      console.error('[orchestrator] Prebuilt calibration load error:', err.message);
    }
  }
  return null;
}

async function buildCalibrationSignals(property) {
  if (!db.PG_AVAILABLE || !property?.id) return {};
  try {
    const { rows } = await db.query(
      `SELECT * FROM reviews_ingested WHERE property_id = $1 ORDER BY scraped_at DESC LIMIT 500`,
      [property.id]
    );
    if (rows.length === 0) return {};
    const agg = aggregateReviews(rows);
    return toCalibrationSignals(agg);
  } catch (err) {
    console.error('[orchestrator] calibration load failed:', err.message);
    return {};
  }
}

async function persistStayRecord({ simulationId, orgId, property, persona, record }) {
  await db.query(
    `INSERT INTO stays (simulation_id, org_id, property_id, persona, archetype_id, length_nights, trip_purpose,
                        stages_json, sensation_history_json, expenses_json, total_spend_eur, final_sensation_json,
                        predicted_nps, predicted_star_rating, predicted_review_platform, predicted_review_body,
                        predicted_review_title, predicted_review_themes_json, would_repeat_boolean, would_recommend_boolean, completed_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20, now())`,
    [
      simulationId, orgId, property?.id || null,
      JSON.stringify(persona),
      persona.archetype_id || persona._archetype_id,
      record.stay_length_nights, record.trip_purpose,
      JSON.stringify(record.stages || []),
      JSON.stringify(record.sensation_history || []),
      JSON.stringify(record.expense_summary?.itemized || []),
      record.expense_summary?.total_spend_eur || 0,
      JSON.stringify(record.final_sensation_state || {}),
      record.sensation_summary?.nps ?? null,
      record.sensation_summary?.stars ?? null,
      record.predicted_review?.platform ?? null,
      record.predicted_review?.body ?? null,
      record.predicted_review?.title ?? null,
      JSON.stringify(record.predicted_review?.themes || []),
      record.predicted_review?.would_repeat ?? null,
      record.predicted_review?.would_recommend ?? null,
    ]
  );
}

module.exports = { runSimulation };
