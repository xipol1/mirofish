const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { runFullSimulation } = require('../services/simulation');
const { getProvider, getCohortSize } = require('../services/ai');
const db = require('../services/db');

const router = express.Router();

// In-memory cache for live polling + DB for durable storage
const simulations = new Map();

// GET /api/config
router.get('/config', (req, res) => {
  const provider = getProvider();
  res.json({
    mode: provider === 'ollama' ? 'demo' : 'full',
    provider,
    agents: getCohortSize(),
  });
});

// POST /api/simulate
router.post('/simulate', (req, res) => {
  const { url, content, audience, goal, taskType, agentCount, seedPersonas, scrapeAuth } = req.body;

  if (!audience || audience.trim().length === 0) {
    return res.status(400).json({ error: 'audience is required' });
  }
  if (!url && !content) {
    return res.status(400).json({ error: 'Either url or content is required' });
  }

  const simulationId = uuidv4();

  // In-memory
  const simState = {
    status: 'running',
    input: { url, content, audience, goal, taskType, agentCount },
    createdAt: new Date().toISOString(),
    result: null,
    error: null,
    progress: {
      phase: 'starting',
      phase_index: 0,
      total_phases: 11,
      agents_done: 0,
      agents_total: 0,
      messages: [],
    },
  };
  simulations.set(simulationId, simState);

  const onProgress = (update) => {
    Object.assign(simState.progress, update);
    if (update.message) {
      simState.progress.messages = [...(simState.progress.messages || []).slice(-19), {
        t: Date.now(),
        text: update.message,
      }];
    }
  };

  // Persist initial
  try { db.createSimulation(simulationId, url, audience); } catch (e) { console.error('[db] create fail', e.message); }

  res.json({ simulationId, status: 'running' });

  runFullSimulation({ url, content, audience, goal, taskType, agentCount, seedPersonas, scrapeAuth, onProgress })
    .then((result) => {
      const sim = simulations.get(simulationId);
      if (sim) {
        sim.status = 'completed';
        sim.result = result;
        sim.completedAt = new Date().toISOString();
      }
      try { db.completeSimulation(simulationId, result); } catch (e) { console.error('[db] complete fail', e.message); }
    })
    .catch((err) => {
      console.error(`[ERROR] Simulation ${simulationId} failed:`, err);
      const sim = simulations.get(simulationId);
      if (sim) {
        sim.status = 'failed';
        sim.error = err.message;
      }
      try { db.failSimulation(simulationId, err); } catch (e) { console.error('[db] fail fail', e.message); }
    });
});

// GET /api/simulation/:id
router.get('/simulation/:id', (req, res) => {
  const sim = simulations.get(req.params.id);

  if (sim) {
    if (sim.status === 'running') return res.json({
      status: 'running',
      startedAt: sim.createdAt,
      progress: sim.progress,
    });
    if (sim.status === 'failed') return res.json({ status: 'failed', error: sim.error });
    return res.json({
      status: 'completed',
      result: sim.result,
      startedAt: sim.createdAt,
      completedAt: sim.completedAt,
    });
  }

  // Fallback to DB
  const fromDb = db.getSimulation(req.params.id);
  if (!fromDb) return res.status(404).json({ error: 'Simulation not found' });

  if (fromDb.status === 'running') return res.json({ status: 'running' });
  if (fromDb.status === 'failed') return res.json({ status: 'failed', error: 'Simulation failed' });

  return res.json({
    status: 'completed',
    result: fromDb.full_result,
    startedAt: new Date(fromDb.created_at).toISOString(),
    completedAt: fromDb.completed_at ? new Date(fromDb.completed_at).toISOString() : null,
  });
});

// GET /api/simulations (list)
router.get('/simulations', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit, 10) || 20, 100);
  res.json({ simulations: db.listSimulations(limit) });
});

module.exports = router;
