/**
 * Modality Contract — every modality MUST expose this shape.
 *
 * A modality defines WHAT question the simulation answers:
 *   - stay_experience: "how satisfied are guests with a full stay?"
 *   - booking_engine_test: "where does the booking funnel break?"
 *   - rate_strategy_test: "what pricing maximizes revenue?"
 *   - loyalty_change_test: "how does this tier change affect retention?"
 *
 * Modalities SHARE:
 *   - Persona generation (from audience + archetypes)
 *   - Cultural context layer (per-agent)
 *   - Orchestration / concurrency / progress events
 *
 * Modalities DIVERGE in:
 *   - Required inputs
 *   - Stage graph (what an agent "goes through")
 *   - Prompts + output schema per stage
 *   - Aggregation logic (what metrics matter for the summary)
 *
 * Contract:
 *
 * {
 *   id: string,                   // machine-readable key
 *   label: string,                // human-readable name
 *   description: string,          // what this modality does
 *
 *   required_inputs: string[],    // top-level inputs that MUST be present
 *   optional_inputs: string[],    // optional inputs with defaults
 *
 *   // Called ONCE per simulation run to validate + normalize inputs
 *   validateInputs(rawInputs) -> { ok: boolean, errors?: string[], normalized: object }
 *
 *   // Called per-agent to build the agent-specific context (booking, cultural, etc.)
 *   // before the agent journey starts.
 *   buildAgentContext({ persona, globalCtx }) -> object
 *
 *   // Run the full agent journey: the modality decides how many stages,
 *   // what prompts, what services to call.
 *   // Returns the agent record.
 *   async runForAgent({ persona, agentCtx, globalCtx, onStage }) -> agentRecord
 *
 *   // Aggregate N agentRecords into a summary object.
 *   aggregateResults(agentRecords, globalCtx) -> summary
 * }
 */

module.exports = {};
