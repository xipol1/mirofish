/**
 * Modality Registry — central lookup for all simulation modalities.
 *
 * To add a new modality:
 *   1. Create ./{modality_id}.js exposing the Modality contract (see _interface.js)
 *   2. Require it below and add to REGISTRY
 */

const stayExperience = require('./stay-experience');
const bookingEngineTest = require('./booking-engine-test');
const rateStrategyTest = require('./rate-strategy-test');
const loyaltyChangeTest = require('./loyalty-change-test');

const REGISTRY = {
  [stayExperience.id]: stayExperience,
  [bookingEngineTest.id]: bookingEngineTest,
  [rateStrategyTest.id]: rateStrategyTest,
  [loyaltyChangeTest.id]: loyaltyChangeTest,
};

function get(modalityId) {
  const mod = REGISTRY[modalityId];
  if (!mod) throw new Error(`Unknown modality: ${modalityId}. Available: ${list().join(', ')}`);
  return mod;
}

function list() {
  return Object.keys(REGISTRY);
}

function describe() {
  return Object.values(REGISTRY).map(m => ({
    id: m.id,
    label: m.label,
    description: m.description,
    required_inputs: m.required_inputs,
    optional_inputs: m.optional_inputs,
  }));
}

module.exports = { get, list, describe, REGISTRY };
