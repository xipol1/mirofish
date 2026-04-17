/**
 * Guest Journey Orchestrator — drives an agent through a complete multi-stage hotel stay.
 *
 * Stages executed in order (configurable per stay_length):
 *   arrival → room_first_impression → evening_1 → night_1 →
 *   morning_routine → daytime_activity → lunch → afternoon_activity →
 *   dinner → evening_leisure → (repeat subsequent_nights) →
 *   last_morning → checkout → post_stay
 *
 * At each stage:
 *   - narrative-engine generates experience (LLM)
 *   - sensation-tracker applies deltas + records moments
 *   - expense-tracker records spending
 *   - optional dataset-enrichment hooks inject calibration context
 *
 * Final output feeds review-predictor.
 */

const { simulateStage, getArchetypeBehavior } = require('./narrative-engine');
const sensationTracker = require('./sensation-tracker');
const expenseTracker = require('./expense-tracker');

const DEFAULT_STAGES_FOR_SHORT_STAY = [
  'arrival',
  'room_first_impression',
  'evening_1',
  'morning_routine',
  'daytime_activity',
  'dinner',
  'last_morning',
  'checkout',
];

const DEFAULT_STAGES_FOR_LEISURE_STAY = [
  'arrival',
  'room_first_impression',
  'evening_1',
  'morning_routine',
  'daytime_activity',
  'lunch',
  'afternoon_activity',
  'dinner',
  'evening_leisure',
  'morning_routine',
  'daytime_activity',
  'lunch',
  'afternoon_activity',
  'dinner',
  'last_morning',
  'checkout',
];

function pickStages(stayLengthNights, archetypeId) {
  if (stayLengthNights <= 2) return DEFAULT_STAGES_FOR_SHORT_STAY;
  if (['family_vacationer', 'honeymooner', 'luxury_seeker'].includes(archetypeId)) {
    // Extend leisure stays
    return DEFAULT_STAGES_FOR_LEISURE_STAY;
  }
  return DEFAULT_STAGES_FOR_SHORT_STAY;
}

/**
 * Run a full stay simulation for one agent.
 *
 * @param {Object} ctx
 * @param {Object} ctx.persona
 * @param {Object} ctx.property - full property object from DB (with data_json)
 * @param {Object} ctx.calibration - aggregated review signals (optional)
 * @param {number} ctx.stay_length_nights
 * @param {string} ctx.trip_purpose
 * @param {Object} ctx.arrival_context - {origin, delay, mood, etc.}
 * @param {Function} ctx.onStage - optional callback invoked after each stage
 */
async function runStay({ persona, property, calibration = {}, stay_length_nights = 3, trip_purpose = 'leisure', arrival_context = {}, onStage = () => {} }) {
  const archetypeId = persona.archetype_id || persona._archetype_id || 'business_traveler';
  const archetypeBehavior = getArchetypeBehavior(archetypeId);

  // Initial sensation state — start from property baseline if aggregates exist
  const propertyBaseline = extractBaselineFromCalibration(calibration);
  let sensationState = sensationTracker.initialState({ propertyBaseline });
  let expenseState = expenseTracker.initial();

  const stageHistory = [];
  const stages = pickStages(stay_length_nights, archetypeId);

  for (let i = 0; i < stages.length; i++) {
    const stageLabel = stages[i];
    const nightNumber = inferNightNumber(stages, i);

    let stageResult;
    try {
      stageResult = await simulateStage({
        stage_label: stageLabel,
        persona,
        archetype_behavior: archetypeBehavior,
        property,
        sensation_state: sensationState,
        previous_stages: stageHistory,
        stay_context: { night_number: nightNumber, trip_purpose, arrival_context, stay_length_nights },
        calibration_signals: calibration,
      });
    } catch (err) {
      console.error(`[guest-journey] Stage ${stageLabel} failed for ${persona.name}:`, err.message.substring(0, 150));
      stageResult = {
        stage: stageLabel,
        narrative: `(stage simulation error: ${err.message.substring(0, 100)})`,
        internal_thoughts: '',
        sensation_deltas: {},
        moments_positive: [],
        moments_negative: [],
        decisions: {},
        expenses: [],
        abandonment_signal: false,
      };
    }

    // Apply sensation deltas
    sensationState = sensationTracker.applyStageDeltas(sensationState, stageResult.sensation_deltas, stageLabel);

    // Record moments
    for (const pos of stageResult.moments_positive || []) {
      sensationState = sensationTracker.recordMoment(sensationState, { kind: 'positive', stage: stageLabel, description: pos });
    }
    for (const neg of stageResult.moments_negative || []) {
      sensationState = sensationTracker.recordMoment(sensationState, { kind: 'negative', stage: stageLabel, description: neg });
    }

    // Record expenses
    for (const exp of stageResult.expenses || []) {
      expenseState = expenseTracker.record(expenseState, {
        stage: stageLabel,
        category: exp.category || 'other',
        item: exp.item || 'unspecified',
        amount_eur: exp.amount_eur || 0,
        included: !!exp.included,
        satisfaction: exp.satisfaction,
      });
    }

    stageHistory.push({
      index: i,
      stage: stageLabel,
      night: nightNumber,
      narrative: stageResult.narrative,
      internal_thoughts: stageResult.internal_thoughts,
      decisions: stageResult.decisions,
      moments_positive: stageResult.moments_positive,
      moments_negative: stageResult.moments_negative,
      concerns_voiced: stageResult.concerns_voiced_to_staff,
      expenses_this_stage: stageResult.expenses,
      sensation_snapshot: snapshotDimensions(sensationState),
      ts: Date.now(),
    });

    onStage({
      index: i,
      total: stages.length,
      stage: stageLabel,
      persona_name: persona.name,
      narrative: stageResult.narrative,
      sensation_snapshot: snapshotDimensions(sensationState),
      moments_positive: stageResult.moments_positive,
      moments_negative: stageResult.moments_negative,
      expenses: stageResult.expenses,
    });

    // Rare early-departure signal
    if (stageResult.abandonment_signal && i < stages.length - 2) {
      stageHistory.push({
        index: i + 0.5,
        stage: 'early_departure',
        note: 'Guest departed the property before the end of stay',
        narrative: '(guest left early due to dissatisfaction)',
      });
      break;
    }
  }

  // Final summary
  const sensationSummary = sensationTracker.summarize(sensationState, archetypeBehavior);
  const expenseSummary = expenseTracker.summarize(expenseState);

  return {
    archetype_id: archetypeId,
    persona: { name: persona.name, archetype_label: persona.archetype_label, role: persona.role },
    stay_length_nights,
    trip_purpose,
    stages: stageHistory,
    sensation_history: sensationState._history || [],
    final_sensation_state: snapshotDimensions(sensationState),
    sensation_summary: sensationSummary,
    expense_summary: expenseSummary,
    moments_positive: sensationState._moments?.positive || [],
    moments_negative: sensationState._moments?.negative || [],
    completed_at: Date.now(),
  };
}

function extractBaselineFromCalibration(calibration) {
  // If property has historical review data, nudge baseline up/down from defaults
  if (!calibration || !calibration.avg_rating) return null;
  const config = require('./sensation-tracker').getConfig();
  const defaults = config.default_starting_values;
  // Map 1-5 rating to a multiplier 0.85..1.15
  const m = 0.85 + ((calibration.avg_rating - 1) / 4) * 0.30;
  return Object.fromEntries(Object.entries(defaults).map(([k, v]) => [k, Math.round(v * m)]));
}

function snapshotDimensions(state) {
  const out = {};
  for (const k of Object.keys(state)) {
    if (!k.startsWith('_') && typeof state[k] === 'number') out[k] = Math.round(state[k]);
  }
  return out;
}

function inferNightNumber(stages, index) {
  // Count how many morning_routine entries have preceded this step (rough night counter)
  const priorMornings = stages.slice(0, index).filter(s => s === 'morning_routine').length;
  const thisIsMorning = stages[index] === 'morning_routine' ? 1 : 0;
  return priorMornings + thisIsMorning + 1;
}

module.exports = { runStay, pickStages };
