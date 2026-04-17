/**
 * SQLite persistence layer using better-sqlite3 (sync, fast, zero-config).
 *
 * Tables:
 *   - simulations       : every simulation run
 *   - calibration       : actual-vs-predicted feedback from users
 */

const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const DB_PATH = path.join(__dirname, '..', 'data', 'synthetic_users.db');

// Ensure data dir exists
const dataDir = path.dirname(DB_PATH);
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS simulations (
    id TEXT PRIMARY KEY,
    created_at INTEGER NOT NULL,
    completed_at INTEGER,
    status TEXT NOT NULL,
    task_type TEXT,
    input_url TEXT,
    input_audience TEXT,
    audience_vector_json TEXT,
    personas_json TEXT,
    metrics_json TEXT,
    insights_json TEXT,
    recommendations_json TEXT,
    full_result_json TEXT
  );

  CREATE TABLE IF NOT EXISTS calibration (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    simulation_id TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    metric_key TEXT NOT NULL,
    predicted_value REAL,
    actual_value REAL,
    change_implemented TEXT,
    notes TEXT,
    FOREIGN KEY(simulation_id) REFERENCES simulations(id)
  );

  CREATE INDEX IF NOT EXISTS idx_simulations_created_at ON simulations(created_at);
  CREATE INDEX IF NOT EXISTS idx_calibration_sim ON calibration(simulation_id);
`);

// ─────────────────────────────────────────────────────────────
// SIMULATION HELPERS
// ─────────────────────────────────────────────────────────────

const createStmt = db.prepare(`
  INSERT INTO simulations (id, created_at, status, input_url, input_audience)
  VALUES (?, ?, 'running', ?, ?)
`);

const completeStmt = db.prepare(`
  UPDATE simulations
  SET completed_at = ?, status = 'completed', task_type = ?, audience_vector_json = ?,
      personas_json = ?, metrics_json = ?, insights_json = ?, recommendations_json = ?,
      full_result_json = ?
  WHERE id = ?
`);

const failStmt = db.prepare(`UPDATE simulations SET status = 'failed', completed_at = ? WHERE id = ?`);

const getStmt = db.prepare(`SELECT * FROM simulations WHERE id = ?`);

const listStmt = db.prepare(`
  SELECT id, created_at, completed_at, status, task_type, input_url, input_audience
  FROM simulations ORDER BY created_at DESC LIMIT ?
`);

function createSimulation(id, url, audience) {
  createStmt.run(id, Date.now(), url || null, audience || null);
}

function completeSimulation(id, result) {
  completeStmt.run(
    Date.now(),
    result.task_type || null,
    JSON.stringify(result.audience_vector || {}),
    JSON.stringify(result.personas || []),
    JSON.stringify(result.metrics || {}),
    JSON.stringify(result.insights || []),
    JSON.stringify(result.recommendations || []),
    JSON.stringify(result),
    id
  );
}

function failSimulation(id, error) {
  failStmt.run(Date.now(), id);
}

function getSimulation(id) {
  const row = getStmt.get(id);
  if (!row) return null;
  return {
    id: row.id,
    status: row.status,
    created_at: row.created_at,
    completed_at: row.completed_at,
    task_type: row.task_type,
    full_result: row.full_result_json ? JSON.parse(row.full_result_json) : null,
  };
}

function listSimulations(limit = 20) {
  return listStmt.all(limit);
}

// ─────────────────────────────────────────────────────────────
// CALIBRATION HELPERS
// ─────────────────────────────────────────────────────────────

const calInsertStmt = db.prepare(`
  INSERT INTO calibration (simulation_id, created_at, metric_key, predicted_value, actual_value, change_implemented, notes)
  VALUES (?, ?, ?, ?, ?, ?, ?)
`);

const calListStmt = db.prepare(`SELECT * FROM calibration WHERE simulation_id = ? ORDER BY created_at DESC`);

const calStatsStmt = db.prepare(`
  SELECT metric_key,
         COUNT(*) as n,
         AVG(predicted_value) as avg_predicted,
         AVG(actual_value) as avg_actual,
         AVG(ABS(predicted_value - actual_value)) as mae
  FROM calibration
  WHERE predicted_value IS NOT NULL AND actual_value IS NOT NULL
  GROUP BY metric_key
`);

function addCalibration({ simulationId, metricKey, predictedValue, actualValue, changeImplemented, notes }) {
  calInsertStmt.run(
    simulationId,
    Date.now(),
    metricKey,
    predictedValue != null ? Number(predictedValue) : null,
    actualValue != null ? Number(actualValue) : null,
    changeImplemented || null,
    notes || null
  );
}

function getCalibrationsForSim(simulationId) {
  return calListStmt.all(simulationId);
}

function getCalibrationStats() {
  return calStatsStmt.all();
}

module.exports = {
  createSimulation,
  completeSimulation,
  failSimulation,
  getSimulation,
  listSimulations,
  addCalibration,
  getCalibrationsForSim,
  getCalibrationStats,
};
