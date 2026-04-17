/**
 * PostgreSQL client with connection pool + migration runner.
 * Falls back gracefully if Postgres isn't configured — enterprise features disabled.
 */

const fs = require('fs');
const path = require('path');

let Pool = null;
try { Pool = require('pg').Pool; } catch (e) { /* pg not installed yet */ }

const DATABASE_URL = process.env.DATABASE_URL;
const PG_AVAILABLE = !!(DATABASE_URL && Pool);

let pool = null;

function getPool() {
  if (!PG_AVAILABLE) return null;
  if (pool) return pool;
  pool = new Pool({
    connectionString: DATABASE_URL,
    max: parseInt(process.env.PG_POOL_MAX, 10) || 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
    ssl: DATABASE_URL.includes('sslmode=require') ? { rejectUnauthorized: false } : undefined,
  });
  pool.on('error', (err) => console.error('[pg] pool error', err.message));
  return pool;
}

async function query(text, params = []) {
  const p = getPool();
  if (!p) throw new Error('PostgreSQL not configured (set DATABASE_URL)');
  const res = await p.query(text, params);
  return res;
}

async function tx(fn) {
  const p = getPool();
  if (!p) throw new Error('PostgreSQL not configured');
  const client = await p.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function migrate() {
  if (!PG_AVAILABLE) {
    console.log('[pg] DATABASE_URL not set — skipping migrations (running SQLite-only mode)');
    return;
  }
  const schemaPath = path.join(__dirname, 'schema.sql');
  const sql = fs.readFileSync(schemaPath, 'utf-8');
  await query(sql);
  console.log('[pg] Schema migration applied.');
}

async function ping() {
  if (!PG_AVAILABLE) return { ok: false, reason: 'DATABASE_URL not configured' };
  try {
    const r = await query('SELECT 1 as ok');
    return { ok: r.rows[0].ok === 1 };
  } catch (err) {
    return { ok: false, reason: err.message };
  }
}

// ── Higher-level helpers ─────────────────────────────────────

async function ensureDefaultOrg() {
  if (!PG_AVAILABLE) return null;
  const existing = await query(`SELECT id FROM orgs WHERE name = 'default' LIMIT 1`);
  if (existing.rows.length > 0) return existing.rows[0].id;
  const { rows } = await query(`INSERT INTO orgs (name, plan) VALUES ('default', 'enterprise') RETURNING id`);
  console.log(`[pg] Created default org ${rows[0].id}`);
  return rows[0].id;
}

async function createSimulation({ orgId, projectId, taskType, goal, targetUrl, audienceDescription, audienceVector, scenarioContent, config, requestedAgentCount }) {
  const { rows } = await query(
    `INSERT INTO simulations
       (org_id, project_id, task_type, goal, target_url, audience_description, audience_vector, scenario_content, config, requested_agent_count, status, started_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'running', now())
     RETURNING id`,
    [orgId, projectId || null, taskType, goal || null, targetUrl || null, audienceDescription || null, audienceVector || {}, scenarioContent || null, config || {}, requestedAgentCount || 25]
  );
  return rows[0].id;
}

async function updateSimulation(id, patch) {
  const keys = Object.keys(patch);
  if (keys.length === 0) return;
  const sets = keys.map((k, i) => `${k} = $${i + 2}`).join(', ');
  const values = keys.map(k => {
    const v = patch[k];
    // Auto-stringify JSON fields
    if (v && typeof v === 'object' && ['audience_vector', 'config', 'metrics', 'insights', 'recommendations'].includes(k)) {
      return JSON.stringify(v);
    }
    return v;
  });
  await query(`UPDATE simulations SET ${sets} WHERE id = $1`, [id, ...values]);
}

async function getSimulation(id) {
  const { rows } = await query(`SELECT * FROM simulations WHERE id = $1`, [id]);
  return rows[0] || null;
}

async function createAgentRun({ simulationId, orgId, slotIndex, persona, archetypeId, startingUrl }) {
  const { rows } = await query(
    `INSERT INTO agent_runs (simulation_id, org_id, slot_index, persona, archetype_id, starting_url, status, started_at)
     VALUES ($1,$2,$3,$4,$5,$6,'running', now()) RETURNING id`,
    [simulationId, orgId, slotIndex, persona, archetypeId, startingUrl || null]
  );
  return rows[0].id;
}

async function completeAgentRun(id, patch) {
  const keys = Object.keys(patch);
  const sets = keys.map((k, i) => `${k} = $${i + 2}`).join(', ');
  const values = keys.map(k => {
    const v = patch[k];
    if (v && typeof v === 'object' && ['journey_steps', 'final_state', 'persona'].includes(k)) return JSON.stringify(v);
    return v;
  });
  await query(`UPDATE agent_runs SET ${sets}, completed_at = now() WHERE id = $1`, [id, ...values]);
}

async function recordEvidence({ agentRunId, simulationId, orgId, kind, stepIndex, storageKey, mimeType, sizeBytes, metadata }) {
  const { rows } = await query(
    `INSERT INTO evidence (agent_run_id, simulation_id, org_id, kind, step_index, storage_key, mime_type, size_bytes, metadata)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
    [agentRunId, simulationId, orgId, kind, stepIndex, storageKey, mimeType, sizeBytes, metadata || {}]
  );
  return rows[0].id;
}

async function recordEvent({ orgId, simulationId, agentRunId, type, payload }) {
  try {
    await query(
      `INSERT INTO events (org_id, simulation_id, agent_run_id, type, payload) VALUES ($1,$2,$3,$4,$5)`,
      [orgId, simulationId || null, agentRunId || null, type, payload || {}]
    );
  } catch (err) {
    // Don't let event logging break execution
    console.error('[pg] event log failed:', err.message);
  }
}

async function getRecentEvents(simulationId, { limit = 100, sinceId = 0 } = {}) {
  const { rows } = await query(
    `SELECT id, type, payload, created_at FROM events
     WHERE simulation_id = $1 AND id > $2
     ORDER BY id ASC LIMIT $3`,
    [simulationId, sinceId, limit]
  );
  return rows;
}

async function listAgentRuns(simulationId) {
  const { rows } = await query(
    `SELECT * FROM agent_runs WHERE simulation_id = $1 ORDER BY slot_index ASC`,
    [simulationId]
  );
  return rows;
}

async function listEvidenceForRun(agentRunId) {
  const { rows } = await query(
    `SELECT * FROM evidence WHERE agent_run_id = $1 ORDER BY step_index ASC, created_at ASC`,
    [agentRunId]
  );
  return rows;
}

module.exports = {
  PG_AVAILABLE,
  getPool,
  query,
  tx,
  migrate,
  ping,
  ensureDefaultOrg,
  createSimulation,
  updateSimulation,
  getSimulation,
  createAgentRun,
  completeAgentRun,
  recordEvidence,
  recordEvent,
  getRecentEvents,
  listAgentRuns,
  listEvidenceForRun,
};
