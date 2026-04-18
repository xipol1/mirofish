/**
 * Longitudinal Agent Persistence — lets the CRO reuse synthetic agents across
 * simulations, trackng how the same guest would evolve over repeated stays.
 *
 * Tables (created on demand if PG is available):
 *   synthetic_agents         agent_id PK, persona snapshot, archetype, culture, created_at
 *   agent_stay_history       (agent_id, simulation_id) PK → stay record snapshot
 *
 * When a simulation completes, `persistSimulationAgents` upserts every agent
 * and appends the stay to `agent_stay_history`.
 *
 * The narrative engine can then pull a prior-stay summary for any agent via
 * `priorStayContextFor(agentId)` and inject it into future stage prompts.
 */

const db = require('../../db/pg');

const TABLE_SQL = `
CREATE TABLE IF NOT EXISTS synthetic_agents (
  agent_id          TEXT PRIMARY KEY,
  persona_json      JSONB NOT NULL,
  archetype_id      TEXT,
  culture_cluster   TEXT,
  first_simulation  TEXT,
  created_at        TIMESTAMPTZ DEFAULT now(),
  updated_at        TIMESTAMPTZ DEFAULT now()
);
CREATE TABLE IF NOT EXISTS agent_stay_history (
  agent_id         TEXT NOT NULL,
  simulation_id    TEXT NOT NULL,
  stay_record_json JSONB NOT NULL,
  property_name    TEXT,
  nps              INTEGER,
  stars            INTEGER,
  completed_at     TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (agent_id, simulation_id)
);
CREATE INDEX IF NOT EXISTS idx_agent_stay_history_agent ON agent_stay_history (agent_id, completed_at DESC);
`;

let _migrated = false;
async function ensureTables() {
  if (_migrated) return true;
  if (!db.PG_AVAILABLE) return false;
  try {
    await db.query(TABLE_SQL);
    _migrated = true;
    return true;
  } catch (err) {
    console.error('[agent-persistence] migration failed:', err.message.substring(0, 150));
    return false;
  }
}

function buildAgentId(persona) {
  return persona?.agent_id
    || persona?.id
    || persona?._agent_id
    || `agent-${persona?.archetype_id || 'x'}-${(persona?.name || 'anon').toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${Math.random().toString(36).slice(2, 8)}`;
}

async function persistSimulationAgents({ simulationId, personas = [], records = [], property = null }) {
  const ok = await ensureTables();
  if (!ok) return { persisted: 0, skipped: personas.length };

  let persisted = 0;
  for (let i = 0; i < personas.length; i++) {
    const persona = personas[i];
    const record = records[i];
    if (!persona || !record || record.error) continue;

    const agentId = buildAgentId(persona);
    const archetypeId = persona.archetype_id || persona._archetype_id || null;
    const cultureCluster = record.cultural_context?.culture_cluster || null;

    try {
      await db.query(
        `INSERT INTO synthetic_agents (agent_id, persona_json, archetype_id, culture_cluster, first_simulation)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (agent_id) DO UPDATE SET
           persona_json = EXCLUDED.persona_json,
           archetype_id = EXCLUDED.archetype_id,
           culture_cluster = EXCLUDED.culture_cluster,
           updated_at = now()`,
        [agentId, JSON.stringify(persona), archetypeId, cultureCluster, simulationId]
      );
      await db.query(
        `INSERT INTO agent_stay_history (agent_id, simulation_id, stay_record_json, property_name, nps, stars)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (agent_id, simulation_id) DO UPDATE SET
           stay_record_json = EXCLUDED.stay_record_json,
           nps = EXCLUDED.nps,
           stars = EXCLUDED.stars`,
        [agentId, simulationId, JSON.stringify(record), property?.name || record.property_name || null, record.sensation_summary?.nps ?? null, record.sensation_summary?.stars ?? null]
      );
      persisted++;
    } catch (err) {
      console.error('[agent-persistence] row failed:', err.message.substring(0, 150));
    }
  }
  return { persisted, skipped: personas.length - persisted };
}

async function getAgentHistory(agentId) {
  const ok = await ensureTables();
  if (!ok) return null;
  try {
    const agent = await db.query(`SELECT * FROM synthetic_agents WHERE agent_id = $1`, [agentId]);
    if (agent.rows.length === 0) return null;
    const history = await db.query(
      `SELECT simulation_id, property_name, nps, stars, completed_at, stay_record_json
       FROM agent_stay_history WHERE agent_id = $1 ORDER BY completed_at DESC LIMIT 50`,
      [agentId]
    );
    return {
      agent_id: agentId,
      persona: agent.rows[0].persona_json,
      archetype_id: agent.rows[0].archetype_id,
      culture_cluster: agent.rows[0].culture_cluster,
      first_simulation: agent.rows[0].first_simulation,
      created_at: agent.rows[0].created_at,
      history: history.rows,
    };
  } catch (err) {
    console.error('[agent-persistence] history failed:', err.message.substring(0, 150));
    return null;
  }
}

/**
 * Build a compact "prior experience" block that can be injected into a future
 * stay's narrative prompt so the agent remembers their last visit.
 */
async function priorStayContextFor(agentId) {
  const h = await getAgentHistory(agentId);
  if (!h || !h.history?.length) return null;
  const last = h.history[0];
  const rec = typeof last.stay_record_json === 'string' ? JSON.parse(last.stay_record_json) : last.stay_record_json;
  const topPos = (rec.moments_positive || []).slice(0, 2).map(m => typeof m === 'string' ? m : m.description || '').filter(Boolean);
  const topNeg = (rec.moments_negative || []).slice(0, 2).map(m => typeof m === 'string' ? m : m.description || '').filter(Boolean);
  return {
    last_property: last.property_name,
    last_nps: last.nps,
    last_stars: last.stars,
    last_stayed_at: last.completed_at,
    memory_positive: topPos,
    memory_negative: topNeg,
    total_prior_stays: h.history.length,
  };
}

async function listAgents({ archetypeId = null, limit = 100 } = {}) {
  const ok = await ensureTables();
  if (!ok) return [];
  const where = archetypeId ? `WHERE archetype_id = $1` : '';
  const params = archetypeId ? [archetypeId, limit] : [limit];
  try {
    const { rows } = await db.query(
      `SELECT agent_id, archetype_id, culture_cluster, created_at,
              (SELECT COUNT(*) FROM agent_stay_history h WHERE h.agent_id = a.agent_id) as stay_count
       FROM synthetic_agents a
       ${where}
       ORDER BY created_at DESC
       LIMIT ${archetypeId ? '$2' : '$1'}`,
      params
    );
    return rows;
  } catch (err) {
    console.error('[agent-persistence] list failed:', err.message.substring(0, 150));
    return [];
  }
}

module.exports = { persistSimulationAgents, getAgentHistory, priorStayContextFor, listAgents, ensureTables, buildAgentId };
