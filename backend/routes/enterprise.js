/**
 * Enterprise routes — Playwright-driven simulations with authenticated navigation,
 * multi-agent cohorts, evidence capture, and audit trails.
 */

const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { runEnterpriseSimulation } = require('../services/enterprise/launch-simulation');
const db = require('../db/pg');
const storage = require('../services/storage');

const router = express.Router();

// In-memory simulation cache (always up-to-date progress)
const simulations = new Map();

/**
 * POST /api/enterprise/simulate
 * Body: {
 *   target_url, audience, goal?, task_type?, agent_count?,
 *   auth_config?: { mode: 'env_credentials'|'stored_cookies'|'none',
 *                   site_slug, role?, login_url?, cookies? },
 *   project_id?
 * }
 */
router.post('/enterprise/simulate', async (req, res) => {
  const { target_url, audience, goal, task_type, agent_count, auth_config, project_id, industry } = req.body;
  if (!target_url) return res.status(400).json({ error: 'target_url is required' });
  if (!audience) return res.status(400).json({ error: 'audience is required' });

  const simulationId = uuidv4();
  const orgId = await db.ensureDefaultOrg().catch(() => null);

  // Persist initial (if PG available)
  if (db.PG_AVAILABLE && orgId) {
    try {
      const id = await db.createSimulation({
        orgId,
        projectId: project_id,
        taskType: task_type || 'landing_page',
        goal,
        targetUrl: target_url,
        audienceDescription: audience,
        audienceVector: {},
        scenarioContent: null,
        config: { agent_count: agent_count, auth_config: auth_config ? { mode: auth_config.mode, site_slug: auth_config.site_slug, role: auth_config.role } : null },
        requestedAgentCount: agent_count || 10,
      });
      // Use the PG-assigned id for persistence; keep simulationId for response stable
      // (they can match for simplicity — reuse the db id as the returned id).
      simulations.set(id, {
        status: 'running',
        input: req.body,
        createdAt: new Date().toISOString(),
        result: null,
        error: null,
        progress: { phase: 'starting', phase_index: 0, agents_done: 0, agents_total: agent_count || 10, events: [] },
      });
      startSimulation(id, orgId, req.body);
      return res.json({ simulationId: id, status: 'running', mode: 'enterprise' });
    } catch (err) {
      console.error('[enterprise] create simulation failed:', err);
    }
  }

  // Fallback: no DB mode — in-memory only
  simulations.set(simulationId, {
    status: 'running',
    input: req.body,
    createdAt: new Date().toISOString(),
    result: null,
    error: null,
    progress: { phase: 'starting', phase_index: 0, agents_done: 0, agents_total: agent_count || 10, events: [] },
  });
  startSimulation(simulationId, orgId, req.body);
  res.json({ simulationId, status: 'running', mode: 'enterprise' });
});

function startSimulation(simulationId, orgId, body) {
  const sim = simulations.get(simulationId);
  const progress = sim.progress;

  const onProgress = (e) => {
    if (e.phase) progress.phase = e.phase;
    if (e.phase_index != null) progress.phase_index = e.phase_index;
    if (e.payload?.completed != null) progress.agents_done = e.payload.completed;
    if (e.payload?.total != null) progress.agents_total = e.payload.total;
    if (e.type === 'agent_completed') progress.agents_done = (progress.agents_done || 0) + 1;

    // Keep last 50 events for live stream
    const evt = {
      t: Date.now(),
      type: e.type,
      phase: e.phase || progress.phase,
      payload: e.payload || {},
    };
    progress.events = [...(progress.events || []).slice(-49), evt];

    // Audit log (async, non-blocking)
    if (db.PG_AVAILABLE && orgId) {
      db.recordEvent({
        orgId, simulationId,
        agentRunId: e.agent_run_id || null,
        type: e.type || 'generic',
        payload: e.payload || e,
      }).catch(() => {});
    }
  };

  runEnterpriseSimulation({
    orgId,
    simulationId,
    input: {
      target_url: body.target_url,
      audience: body.audience,
      goal: body.goal,
      task_type: body.task_type,
      agent_count: body.agent_count,
      auth_config: body.auth_config,
      starting_url: body.starting_url,
      industry: body.industry,
    },
    onProgress,
  })
    .then(result => {
      sim.status = 'completed';
      sim.result = result;
      sim.completedAt = new Date().toISOString();
      progress.phase = 'done';
    })
    .catch(err => {
      console.error(`[enterprise sim ${simulationId}] FAILED:`, err);
      sim.status = 'failed';
      sim.error = err.message;
      if (db.PG_AVAILABLE) {
        db.updateSimulation(simulationId, {
          status: 'failed',
          completed_at: new Date(),
          error_message: err.message,
        }).catch(() => {});
      }
    });
}

// GET /api/enterprise/simulation/:id
router.get('/enterprise/simulation/:id', async (req, res) => {
  const sim = simulations.get(req.params.id);
  if (sim) {
    if (sim.status === 'running') {
      return res.json({ status: 'running', progress: sim.progress, startedAt: sim.createdAt });
    }
    if (sim.status === 'failed') return res.json({ status: 'failed', error: sim.error, progress: sim.progress });
    return res.json({ status: 'completed', result: sim.result, startedAt: sim.createdAt, completedAt: sim.completedAt, progress: sim.progress });
  }

  // Try DB
  if (db.PG_AVAILABLE) {
    try {
      const fromDb = await db.getSimulation(req.params.id);
      if (!fromDb) return res.status(404).json({ error: 'Simulation not found' });
      return res.json({
        status: fromDb.status,
        result: fromDb.status === 'completed' ? {
          mode: 'ENTERPRISE',
          task_type: fromDb.task_type,
          audience_vector: fromDb.audience_vector,
          metrics: fromDb.metrics,
          insights: fromDb.insights,
          recommendations: fromDb.recommendations,
          headline: fromDb.insights?.headline,
          outcomes: fromDb.metrics ? {
            total: fromDb.metrics.total_agents,
            converted: fromDb.metrics.converted,
            bounced: fromDb.metrics.bounced,
            interested: fromDb.metrics.interested,
            conversion_rate: fromDb.metrics.conversion_rate,
          } : null,
        } : null,
        error: fromDb.error_message,
      });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  return res.status(404).json({ error: 'Simulation not found' });
});

// GET /api/enterprise/simulation/:id/agents — list agent runs with evidence counts
router.get('/enterprise/simulation/:id/agents', async (req, res) => {
  if (!db.PG_AVAILABLE) {
    const sim = simulations.get(req.params.id);
    if (!sim?.result) return res.status(404).json({ error: 'not found' });
    return res.json({ agents: sim.result.agent_results || [] });
  }

  try {
    const runs = await db.listAgentRuns(req.params.id);
    return res.json({ agents: runs });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/enterprise/agent/:id/evidence — list screenshots + DOM for an agent run
router.get('/enterprise/agent/:id/evidence', async (req, res) => {
  if (!db.PG_AVAILABLE) return res.json({ evidence: [] });
  try {
    const rows = await db.listEvidenceForRun(req.params.id);
    const withUrls = await Promise.all(rows.map(async (r) => ({
      ...r,
      url: await storage.getPresignedUrl(r.storage_key, { expiresIn: 3600 }).catch(() => null),
    })));
    res.json({ evidence: withUrls });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/evidence/local?key=...&t=... — serve local filesystem evidence (dev mode)
router.get('/evidence/local', (req, res) => {
  const { key, t } = req.query;
  if (!key || !t) return res.status(400).send('bad request');
  if (!storage.verifyLocalSignature(key, t)) return res.status(403).send('forbidden');
  const fs = require('fs');
  const path = require('path');
  const full = storage.localPath(key);
  if (!fs.existsSync(full)) return res.status(404).send('not found');
  const ext = path.extname(key).toLowerCase();
  const ct = ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : ext === '.png' ? 'image/png' : 'application/octet-stream';
  res.setHeader('Content-Type', ct);
  res.setHeader('Cache-Control', 'private, max-age=3600');
  fs.createReadStream(full).pipe(res);
});

// GET /api/enterprise/simulation/:id/report.pdf
router.get('/enterprise/simulation/:id/report.pdf', async (req, res) => {
  const simId = req.params.id;
  const sim = simulations.get(simId);
  let simData = null;
  if (sim && sim.status === 'completed') {
    simData = { id: simId, input: sim.input, result: sim.result };
  } else if (db.PG_AVAILABLE) {
    const fromDb = await db.getSimulation(simId);
    if (fromDb) {
      simData = {
        id: simId,
        input: { target_url: fromDb.target_url, audience: fromDb.audience_description, goal: fromDb.goal },
        result: {
          mode: 'ENTERPRISE',
          task_type: fromDb.task_type,
          metrics: fromDb.metrics,
          insights: fromDb.insights,
          recommendations: fromDb.recommendations,
          headline: fromDb.insights?.headline,
          personas: [],
          agent_results: [],
          scenario_summary: { site_name: new URL(fromDb.target_url || 'https://example.com').hostname },
          outcomes: fromDb.metrics ? {
            total: fromDb.metrics.total_agents,
            converted: fromDb.metrics.converted,
            bounced: fromDb.metrics.bounced,
            interested: fromDb.metrics.interested,
            conversion_rate: fromDb.metrics.conversion_rate,
          } : {},
        },
      };
    }
  }

  if (!simData) return res.status(404).send('simulation not found or still running');

  try {
    const path = require('path');
    const fs = require('fs');
    const { generateReport } = require('../services/enterprise/pdf-report');

    const outDir = path.join(__dirname, '..', 'data', 'reports');
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
    const outputPath = path.join(outDir, `report-${simId}.pdf`);

    await generateReport({ simulation: simData, outputPath });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="launch-validation-report-${simId.substring(0, 8)}.pdf"`);
    fs.createReadStream(outputPath).pipe(res);
  } catch (err) {
    console.error('[pdf] generation error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/enterprise/industries — list available industry packs
router.get('/enterprise/industries', (req, res) => {
  const industries = require('../services/industries');
  res.json({ industries: industries.listAvailableIndustries() });
});

// GET /api/enterprise/health
router.get('/enterprise/health', async (req, res) => {
  const pg = await db.ping();
  res.json({
    pg: pg.ok,
    pg_reason: pg.reason,
    storage: storage.S3_ENABLED ? 's3' : 'local',
    queue: require('../services/queue').QUEUE_MODE,
    active_simulations: simulations.size,
  });
});

module.exports = router;
