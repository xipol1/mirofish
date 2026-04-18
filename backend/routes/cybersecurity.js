/**
 * Cybersecurity routes — Cyber Swarm (500 adversary agents).
 *
 * Modes:
 *   - 'demo' (default): cinematic simulation with scripted findings. Makes no HTTP requests to the target.
 *   - 'real': bounded, non-destructive, authorized-only probes (see real-engine.js for safety contract).
 */

const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { runCyberSimulation } = require('../services/cybersecurity/cyber-simulation');
const { listPersonas } = require('../services/cybersecurity/attack-personas');
const { OWASP_CATEGORIES } = require('../services/cybersecurity/owasp-catalog');

const router = express.Router();

// In-memory run cache
const runs = new Map();

// POST /api/cybersecurity/simulate
router.post('/cybersecurity/simulate', async (req, res) => {
  const { target_url, mode = 'demo', total_agents = 500, authorized, acknowledgement, duration_ms } = req.body || {};
  if (!target_url) return res.status(400).json({ error: 'target_url is required' });
  try { new URL(target_url); } catch { return res.status(400).json({ error: 'target_url must be a valid URL' }); }

  if (mode === 'real' && (!authorized || !acknowledgement || acknowledgement.length < 20)) {
    return res.status(400).json({
      error: 'Real mode requires `authorized: true` and `acknowledgement` (≥20 chars citing written authorization). Use mode:"demo" for pitch visualizations.',
    });
  }

  const runId = uuidv4();
  runs.set(runId, {
    status: 'running',
    mode,
    target: target_url,
    createdAt: new Date().toISOString(),
    result: null,
    error: null,
    progress: {
      phase: 'starting',
      events: [],
      findings_count: 0,
      findings: [],
    },
  });

  startRun(runId, { targetUrl: target_url, mode, totalAgents: total_agents, authorized, acknowledgement, durationMs: duration_ms });

  res.json({ runId, status: 'running', mode });
});

function startRun(runId, opts) {
  const run = runs.get(runId);
  const progress = run.progress;

  const onProgress = (e) => {
    if (e.phase) progress.phase = e.phase;
    if (e.type === 'finding' && e.payload) {
      progress.findings.push(e.payload);
      progress.findings_count = progress.findings.length;
    }
    const evt = { t: Date.now(), type: e.type, phase: e.phase || progress.phase, payload: e.payload || {} };
    progress.events = [...(progress.events || []).slice(-99), evt];
  };

  runCyberSimulation({ ...opts, onProgress })
    .then(result => {
      run.status = 'completed';
      run.result = result;
      run.completedAt = new Date().toISOString();
      progress.phase = 'done';
    })
    .catch(err => {
      console.error(`[cyber run ${runId}] FAILED:`, err);
      run.status = 'failed';
      run.error = err.message;
    });
}

// GET /api/cybersecurity/run/:id
router.get('/cybersecurity/run/:id', (req, res) => {
  const run = runs.get(req.params.id);
  if (!run) return res.status(404).json({ error: 'run not found' });
  if (run.status === 'running') {
    return res.json({ status: 'running', mode: run.mode, target: run.target, progress: run.progress, startedAt: run.createdAt });
  }
  if (run.status === 'failed') {
    return res.json({ status: 'failed', mode: run.mode, target: run.target, error: run.error, progress: run.progress });
  }
  return res.json({
    status: 'completed',
    mode: run.mode,
    target: run.target,
    result: run.result,
    progress: run.progress,
    startedAt: run.createdAt,
    completedAt: run.completedAt,
  });
});

// GET /api/cybersecurity/personas — catalog
router.get('/cybersecurity/personas', (_req, res) => {
  res.json({ personas: listPersonas() });
});

// GET /api/cybersecurity/owasp — categories
router.get('/cybersecurity/owasp', (_req, res) => {
  res.json({ categories: OWASP_CATEGORIES });
});

// GET /api/cybersecurity/health
router.get('/cybersecurity/health', (_req, res) => {
  res.json({ ok: true, active_runs: runs.size, modes: ['demo', 'real'] });
});

module.exports = router;
