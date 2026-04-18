/**
 * Backward-compat shim.
 *
 * The original stay-simulation.js has been refactored into:
 *   - simulation-orchestrator.js (modality-agnostic)
 *   - modalities/stay-experience.js (the logic specific to stay experience)
 *
 * This file preserves the old public API (runStaySimulation, summarizeStays)
 * so existing routes keep working without change. New code should use
 * simulation-orchestrator.runSimulation({ modality: 'stay_experience', ... }).
 */

const { runSimulation } = require('./simulation-orchestrator');
const stayExperience = require('./modalities/stay-experience');

/**
 * Legacy interface: always runs the stay_experience modality.
 */
async function runStaySimulation(opts) {
  const {
    orgId, simulationId, property, audience, agent_count, stay_length_nights,
    goal, onProgress, inlineMode, calibrationOverride,
    season, weather_array, local_events, occupancy_pct,
    property_country, origin_mix_override, rate_plan_default,
  } = opts;

  const result = await runSimulation({
    modality: 'stay_experience',
    orgId,
    simulationId,
    property,
    audience,
    agent_count,
    onProgress,
    inlineMode,
    calibrationOverride,
    modality_inputs: {
      stay_length_nights,
      goal,
      season,
      weather_array,
      local_events,
      occupancy_pct,
      property_country,
      origin_mix_override,
      rate_plan_default,
    },
  });

  // Legacy shape: records are called "stays"
  return {
    mode: 'HOSPITALITY_STAY',
    provider: result.provider,
    industry: result.industry,
    property: result.property,
    audience_vector: result.audience_vector,
    personas: result.personas,
    stays: result.records,
    calibration: result.calibration,
    summary: result.summary,
  };
}

// Legacy summarize function — delegate to modality
function summarizeStays(stays, property) {
  return stayExperience.aggregateResults(stays, { property });
}

module.exports = { runStaySimulation, summarizeStays };
