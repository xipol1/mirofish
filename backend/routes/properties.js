/**
 * Properties + Stays routes — CRUD for hotels, review ingestion, full-stay simulations.
 */

const express = require('express');
const { v4: uuidv4 } = require('uuid');
const db = require('../db/pg');
const reviewParser = require('../services/data/review-parser');
const datasets = require('../services/datasets');

const router = express.Router();

// In-memory cache for live polling of stay sims
const activeStaySims = new Map();

// ─── Property CRUD ───────────────────────────────────────────

router.get('/properties', async (req, res) => {
  const orgId = await db.ensureDefaultOrg().catch(() => null);
  if (!db.PG_AVAILABLE) return res.json({ properties: [], warning: 'PG not configured' });
  try {
    const { rows } = await db.query(`SELECT id, name, brand, slug, website_url, historical_avg_rating, created_at FROM properties WHERE org_id = $1 ORDER BY created_at DESC`, [orgId]);
    res.json({ properties: rows });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/properties/:id', async (req, res) => {
  if (!db.PG_AVAILABLE) return res.status(404).json({ error: 'PG not configured' });
  try {
    const { rows } = await db.query(`SELECT * FROM properties WHERE id = $1 LIMIT 1`, [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ error: 'not found' });
    const reviewsCount = await db.query(`SELECT COUNT(*) as n FROM reviews_ingested WHERE property_id = $1`, [req.params.id]);
    res.json({ property: rows[0], reviews_count: parseInt(reviewsCount.rows[0].n, 10) });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/properties', async (req, res) => {
  const orgId = await db.ensureDefaultOrg().catch(() => null);
  if (!db.PG_AVAILABLE) return res.status(400).json({ error: 'PG not configured — cannot persist property' });

  const { name, brand, slug, website_url, booking_url, data_json, marketing_json, operations_json, loyalty_json } = req.body;
  if (!name) return res.status(400).json({ error: 'name required' });

  try {
    const safeSlug = slug || name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const { rows } = await db.query(
      `INSERT INTO properties (org_id, name, brand, slug, website_url, booking_url, data_json, marketing_json, operations_json, loyalty_json)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [orgId, name, brand || null, safeSlug, website_url || null, booking_url || null,
       data_json || {}, marketing_json || {}, operations_json || {}, loyalty_json || {}]
    );
    res.json({ property: rows[0] });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/properties/:id', async (req, res) => {
  if (!db.PG_AVAILABLE) return res.status(400).json({ error: 'PG not configured' });
  const patch = req.body;
  const allowed = ['name', 'brand', 'website_url', 'booking_url', 'data_json', 'marketing_json', 'operations_json', 'loyalty_json'];
  const keys = Object.keys(patch).filter(k => allowed.includes(k));
  if (keys.length === 0) return res.status(400).json({ error: 'no valid fields to update' });
  try {
    const setClauses = keys.map((k, i) => `${k} = $${i + 2}`).join(', ');
    const values = keys.map(k => ['data_json', 'marketing_json', 'operations_json', 'loyalty_json'].includes(k) ? JSON.stringify(patch[k]) : patch[k]);
    const { rows } = await db.query(`UPDATE properties SET ${setClauses}, updated_at = now() WHERE id = $1 RETURNING *`, [req.params.id, ...values]);
    if (rows.length === 0) return res.status(404).json({ error: 'not found' });
    res.json({ property: rows[0] });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── Reviews ─────────────────────────────────────────────────

router.get('/properties/:id/reviews', async (req, res) => {
  if (!db.PG_AVAILABLE) return res.json({ reviews: [], aggregation: null });
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 50, 500);
    const { rows } = await db.query(`SELECT * FROM reviews_ingested WHERE property_id = $1 ORDER BY scraped_at DESC LIMIT $2`, [req.params.id, limit]);
    const agg = reviewParser.aggregateReviews(rows);
    res.json({ reviews: rows, aggregation: agg });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/properties/:id/reviews/upload', async (req, res) => {
  if (!db.PG_AVAILABLE) return res.status(400).json({ error: 'PG not configured' });
  const { reviews } = req.body;
  if (!Array.isArray(reviews) || reviews.length === 0) return res.status(400).json({ error: 'reviews array required' });

  const orgId = await db.ensureDefaultOrg().catch(() => null);
  let inserted = 0, skipped = 0;
  for (const r of reviews) {
    try {
      await db.query(
        `INSERT INTO reviews_ingested (org_id, property_id, source, source_review_id, source_url, rating_numeric, rating_scale, title, body, reviewer_display_name, reviewer_origin, trip_type, stay_month, language, themes_json, sentiment_score)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
         ON CONFLICT (source, source_review_id) DO NOTHING`,
        [
          orgId, req.params.id,
          r.source || 'upload',
          r.source_review_id || `upload-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          r.source_url || null,
          r.rating_numeric ?? r.rating ?? null,
          r.rating_scale || 5,
          r.title || null,
          r.body || r.review || '',
          r.reviewer_display_name || null,
          r.reviewer_origin || null,
          r.trip_type || null,
          r.stay_month || null,
          r.language || null,
          JSON.stringify(reviewParser.detectThemes(`${r.title || ''} ${r.body || r.review || ''}`)),
          r.sentiment_score ?? null,
        ]
      );
      inserted++;
    } catch (err) { skipped++; }
  }
  res.json({ inserted, skipped, total_submitted: reviews.length });
});

router.post('/properties/:id/reviews/scrape', async (req, res) => {
  const { url, limit = 50 } = req.body;
  if (!url) return res.status(400).json({ error: 'url required' });

  res.json({ status: 'queued', message: `Scrape started — poll /api/properties/${req.params.id}/reviews for results` });

  // Background scrape
  (async () => {
    try {
      const reviewScraper = require('../services/data/review-scraper');
      const orgId = await db.ensureDefaultOrg().catch(() => null);
      const scraped = await reviewScraper.scrape(url, { limit });
      for (const r of scraped) {
        try {
          await db.query(
            `INSERT INTO reviews_ingested (org_id, property_id, source, source_url, rating_numeric, rating_scale, title, body, themes_json, sentiment_score)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
             ON CONFLICT DO NOTHING`,
            [
              orgId, req.params.id, r.source, r.source_url, r.rating_numeric, r.rating_scale,
              r.title, r.body,
              JSON.stringify(reviewParser.detectThemes(`${r.title || ''} ${r.body || ''}`)),
              null,
            ]
          );
        } catch (e) { /* ignore dup */ }
      }
      console.log(`[properties] Scraped ${scraped.length} reviews for property ${req.params.id}`);
    } catch (err) {
      console.error('[properties] scrape failed:', err.message);
    }
  })();
});

// ─── Stay simulation ────────────────────────────────────────

router.post('/properties/:id/stay-simulate', async (req, res) => {
  if (!db.PG_AVAILABLE) return res.status(400).json({ error: 'PG required for stay simulations' });
  const { audience, agent_count = 8, stay_length_nights, goal } = req.body;
  if (!audience) return res.status(400).json({ error: 'audience required' });

  try {
    const { rows } = await db.query(`SELECT * FROM properties WHERE id = $1 LIMIT 1`, [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ error: 'property not found' });
    const property = rows[0];

    const orgId = property.org_id;
    const simulationId = await db.createSimulation({
      orgId, projectId: null,
      taskType: 'stay_experience',
      goal,
      targetUrl: property.website_url,
      audienceDescription: audience,
      audienceVector: {},
      scenarioContent: null,
      config: { industry: 'hospitality', agent_count, stay_length_nights, property_id: property.id },
      requestedAgentCount: agent_count,
    });

    const state = {
      status: 'running',
      started_at: new Date().toISOString(),
      progress: { phase: 'starting', agents_done: 0, agents_total: agent_count, events: [] },
      property_id: property.id,
      result: null,
    };
    activeStaySims.set(simulationId, state);

    const onProgress = (e) => {
      if (e.phase) state.progress.phase = e.phase;
      if (e.type === 'stay_complete') state.progress.agents_done = (state.progress.agents_done || 0) + 1;
      state.progress.events = [...(state.progress.events || []).slice(-39), { t: Date.now(), type: e.type, payload: e.payload || {} }];
    };

    res.json({ simulationId, status: 'running', mode: 'hospitality_stay' });

    const { runStaySimulation } = require('../services/enterprise/stay-simulation');
    runStaySimulation({
      orgId,
      simulationId,
      property: { ...property, id: property.id, data_json: property.data_json },
      audience,
      agent_count,
      stay_length_nights,
      goal,
      onProgress,
    })
      .then(result => {
        state.status = 'completed';
        state.result = result;
        state.completed_at = new Date().toISOString();
        db.updateSimulation(simulationId, {
          status: 'completed', completed_at: new Date(),
          metrics: result.summary, insights: { calibration: result.calibration }, recommendations: [],
        }).catch(() => {});
      })
      .catch(err => {
        console.error(`[stay-sim ${simulationId}] FAILED:`, err);
        state.status = 'failed';
        state.error = err.message;
      });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/stay-simulate-direct
 * No-PG-required endpoint. Accepts property inline — great for demos without
 * having to persist property first.
 * Body: { property: {name, brand, data_json}, audience, agent_count, stay_length_nights?, calibration? }
 */
router.post('/stay-simulate-direct', (req, res) => {
  const {
    property, audience, agent_count = 8, stay_length_nights, calibration, goal,
    // Tier 0 context overrides (all optional — defaults sampled realistically)
    season, weather_array, local_events, occupancy_pct, property_country, origin_mix_override,
  } = req.body;
  if (!property || !property.name) return res.status(400).json({ error: 'property.name required' });
  if (!audience) return res.status(400).json({ error: 'audience required' });

  const simulationId = uuidv4();
  const propertyWithId = { ...property, id: property.id || `inline-${simulationId}`, data_json: property.data_json || property };

  const state = {
    status: 'running',
    started_at: new Date().toISOString(),
    progress: { phase: 'starting', agents_done: 0, agents_total: agent_count, events: [] },
    property_id: propertyWithId.id,
    property_inline: propertyWithId,
    result: null,
  };
  activeStaySims.set(simulationId, state);

  const onProgress = (e) => {
    if (e.phase) state.progress.phase = e.phase;
    if (e.type === 'stay_complete' || e.type === 'agent_complete') {
      state.progress.agents_done = (state.progress.agents_done || 0) + 1;
    }
    state.progress.events = [...(state.progress.events || []).slice(-59), { t: Date.now(), type: e.type, payload: e.payload || {} }];
  };

  res.json({ simulationId, status: 'running', mode: 'hospitality_stay_direct', property_name: propertyWithId.name });

  const { runStaySimulation } = require('../services/enterprise/stay-simulation');
  runStaySimulation({
    orgId: null,
    simulationId,
    property: propertyWithId,
    audience,
    agent_count,
    stay_length_nights,
    goal,
    onProgress,
    inlineMode: true,
    // Tier 0
    season,
    weather_array,
    local_events,
    occupancy_pct,
    property_country,
    origin_mix_override,
  })
    .then(result => {
      state.status = 'completed';
      state.result = result;
      state.completed_at = new Date().toISOString();
    })
    .catch(err => {
      console.error(`[stay-sim ${simulationId}] FAILED:`, err);
      state.status = 'failed';
      state.error = err.message;
    });
});

router.get('/stay-simulation/:id', async (req, res) => {
  const state = activeStaySims.get(req.params.id);
  if (state) {
    return res.json({
      status: state.status,
      progress: state.progress,
      started_at: state.started_at,
      completed_at: state.completed_at,
      result: state.status === 'completed' ? state.result : null,
      error: state.error,
    });
  }
  if (!db.PG_AVAILABLE) return res.status(404).json({ error: 'not found' });
  try {
    const { rows } = await db.query(`SELECT * FROM stays WHERE simulation_id = $1`, [req.params.id]);
    const sim = await db.getSimulation(req.params.id);
    if (!sim) return res.status(404).json({ error: 'not found' });
    res.json({ status: sim.status, stays: rows, metrics: sim.full_result?.summary || sim.metrics });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── Modality-aware simulation endpoint (new) ─────────────────────
// POST /api/simulate — accepts any modality (stay_experience, booking_engine_test,
// rate_strategy_test, loyalty_change_test). Same in-memory cache as stay sims.

router.post('/simulate', (req, res) => {
  const {
    modality, audience, agent_count = 10, property,
    // Modality-specific inputs go nested here
    modality_inputs = {},
    // Convenience: allow passing pack IDs at top level
    market_pack_ids,
  } = req.body;

  if (!modality) return res.status(400).json({ error: 'modality is required (stay_experience | booking_engine_test | rate_strategy_test | loyalty_change_test)' });
  if (!audience) return res.status(400).json({ error: 'audience is required' });

  const modalityRegistry = require('../services/enterprise/modalities');
  let modalitySpec;
  try {
    modalitySpec = modalityRegistry.get(modality);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  const simulationId = uuidv4();
  const propertyWithId = property
    ? { ...property, id: property.id || `inline-${simulationId}`, data_json: property.data_json || property }
    : null;

  // Merge convenience market_pack_ids into modality_inputs
  const normalizedModalityInputs = { ...modality_inputs };
  if (market_pack_ids) normalizedModalityInputs.market_pack_ids = market_pack_ids;

  const state = {
    status: 'running',
    modality: modalitySpec.id,
    modality_label: modalitySpec.label,
    started_at: new Date().toISOString(),
    progress: { phase: 'starting', agents_done: 0, agents_total: agent_count, events: [] },
    property_id: propertyWithId?.id || null,
    property_inline: propertyWithId,
    result: null,
  };
  activeStaySims.set(simulationId, state);

  const onProgress = (e) => {
    if (e.phase) state.progress.phase = e.phase;
    if (e.type === 'agent_complete') state.progress.agents_done = (state.progress.agents_done || 0) + 1;
    state.progress.events = [...(state.progress.events || []).slice(-79), { t: Date.now(), type: e.type, payload: e.payload || {} }];
  };

  res.json({
    simulationId,
    status: 'running',
    modality: modalitySpec.id,
    modality_label: modalitySpec.label,
    property_name: propertyWithId?.name || null,
  });

  const { runSimulation } = require('../services/enterprise/simulation-orchestrator');
  runSimulation({
    modality: modalitySpec.id,
    orgId: null,
    simulationId,
    property: propertyWithId,
    audience,
    agent_count,
    inlineMode: true,
    onProgress,
    modality_inputs: normalizedModalityInputs,
  })
    .then(result => {
      state.status = 'completed';
      state.result = result;
      state.completed_at = new Date().toISOString();
    })
    .catch(err => {
      console.error(`[simulate ${simulationId}] FAILED:`, err);
      state.status = 'failed';
      state.error = err.message;
      state.validation_errors = err.validation_errors || null;
    });
});

// GET /api/simulation/:id — modality-agnostic getter (same cache as stay-simulation)
router.get('/simulation/:id', (req, res) => {
  const state = activeStaySims.get(req.params.id);
  if (!state) return res.status(404).json({ error: 'not found' });
  res.json({
    status: state.status,
    modality: state.modality,
    modality_label: state.modality_label,
    progress: state.progress,
    started_at: state.started_at,
    completed_at: state.completed_at,
    result: state.status === 'completed' ? state.result : null,
    error: state.error,
    validation_errors: state.validation_errors,
  });
});

// ─── Modality + Market Pack discovery endpoints ───────────────────

router.get('/modalities', (req, res) => {
  const modalityRegistry = require('../services/enterprise/modalities');
  res.json({ modalities: modalityRegistry.describe() });
});

router.get('/market-packs', (req, res) => {
  const marketPacks = require('../services/enterprise/market-packs');
  res.json({ market_packs: marketPacks.list() });
});

router.get('/market-packs/:id', (req, res) => {
  const marketPacks = require('../services/enterprise/market-packs');
  try {
    res.json(marketPacks.get(req.params.id));
  } catch (err) {
    res.status(404).json({ error: err.message });
  }
});

// Return a pack stripped of provenance wrappers (downstream-friendly values)
router.get('/market-packs/:id/values', (req, res) => {
  const marketPacks = require('../services/enterprise/market-packs');
  try {
    const pack = marketPacks.get(req.params.id);
    res.json(marketPacks.unwrapNode(pack));
  } catch (err) {
    res.status(404).json({ error: err.message });
  }
});

// Return only the provenance audit for a pack
router.get('/market-packs/:id/provenance', (req, res) => {
  const marketPacks = require('../services/enterprise/market-packs');
  try {
    const pack = marketPacks.get(req.params.id);
    const validation = marketPacks.validatePack(pack);
    const distSumIssues = marketPacks.validateDistributionSums(pack);
    const confidence = marketPacks.computePackConfidence(pack);
    const provenance = marketPacks.getAllProvenance(pack);
    res.json({
      market_id: pack.market_id,
      label: pack.label,
      pack_version: pack.pack_version,
      schema_version: pack.schema_version || '0.1.0',
      validation,
      distribution_sum_issues: distSumIssues,
      confidence,
      provenance_per_field: provenance,
    });
  } catch (err) {
    res.status(404).json({ error: err.message });
  }
});

// Sources catalog
router.get('/sources', (req, res) => {
  const marketPacks = require('../services/enterprise/market-packs');
  const cat = marketPacks.loadSources();
  res.json(cat);
});

router.get('/sources/:id', (req, res) => {
  const marketPacks = require('../services/enterprise/market-packs');
  const cat = marketPacks.loadSources();
  const src = cat.sources?.[req.params.id];
  if (!src) return res.status(404).json({ error: 'source not found' });
  res.json(src);
});

// ─── Datasets status ─────────────────────────────────────────

router.get('/enterprise/datasets/status', (req, res) => {
  res.json(datasets.status());
});

router.post('/enterprise/datasets/reload', (req, res) => {
  // Invalidate cache by re-requiring (simpler: reset cache)
  const ds = require('../services/datasets');
  // Force cache clear by clearing require cache for the module
  try {
    const key = require.resolve('../services/datasets');
    delete require.cache[key];
  } catch (e) { /* ignore */ }
  const fresh = require('../services/datasets');
  res.json(fresh.preloadAll());
});

// ═══════════════════════════════════════════════════════════════════
// ENTERPRISE CAPABILITIES (additive — does not alter existing endpoints)
// ═══════════════════════════════════════════════════════════════════

function _getSimState(simulationId) {
  return activeStaySims.get(simulationId);
}
function _getCompletedSimOrRespond(simulationId, res) {
  const state = _getSimState(simulationId);
  if (!state) { res.status(404).json({ error: 'simulation not found' }); return null; }
  if (state.status !== 'completed') { res.status(409).json({ error: `simulation is ${state.status}; results not yet available`, status: state.status }); return null; }
  if (!state.result) { res.status(409).json({ error: 'simulation completed but result missing' }); return null; }
  return state.result;
}
function _getRecordAtSlot(result, slot) {
  const records = result.records || result.stays || [];
  const idx = parseInt(slot, 10);
  if (!Number.isFinite(idx) || idx < 0 || idx >= records.length) return null;
  const rec = records[idx];
  if (!rec || rec.error) return null;
  return { record: rec, persona: rec.persona_full || rec.persona || result.personas?.[idx] || {}, booking_context: rec.booking_context || result.agent_contexts?.[idx]?.booking_context, cultural_context: rec.cultural_context || result.agent_contexts?.[idx]?.cultural_context };
}

// ─── CAPABILITY A: Agent interview ─────────────────────────────────

router.post('/simulation/:simulationId/agent/:agentSlot/interview', async (req, res) => {
  const result = _getCompletedSimOrRespond(req.params.simulationId, res);
  if (!result) return;
  const slotCtx = _getRecordAtSlot(result, req.params.agentSlot);
  if (!slotCtx) return res.status(404).json({ error: 'agent slot not found or failed' });
  const { question, previous_qa = [] } = req.body || {};
  if (!question || !String(question).trim()) return res.status(400).json({ error: 'question is required' });

  try {
    const { interviewAgent } = require('../services/enterprise/agent-interviewer');
    const timeoutMs = 60000;
    const answer = await Promise.race([
      interviewAgent({ stayRecord: slotCtx.record, persona: slotCtx.persona, bookingContext: slotCtx.booking_context, culturalContext: slotCtx.cultural_context, question, previousQA: Array.isArray(previous_qa) ? previous_qa : [] }),
      new Promise((_, rej) => setTimeout(() => rej(new Error('interview timeout (60s)')), timeoutMs)),
    ]);
    res.json(answer);
  } catch (err) {
    res.status(500).json({ error: err.message.substring(0, 200) });
  }
});

router.post('/simulation/:simulationId/interview-cohort', async (req, res) => {
  const result = _getCompletedSimOrRespond(req.params.simulationId, res);
  if (!result) return;
  const { question, filters = {}, max_agents = 10 } = req.body || {};
  if (!question) return res.status(400).json({ error: 'question is required' });

  try {
    const agentRetrieval = require('../services/enterprise/agent-retrieval');
    const { interviewMultipleAgents } = require('../services/enterprise/agent-interviewer');
    const matched = agentRetrieval.queryAgents(result, filters).slice(0, Math.min(Number(max_agents) || 10, 25));
    const items = matched.map(m => {
      const ctx = _getRecordAtSlot(result, m.slot);
      if (!ctx) return null;
      return { agent_slot: m.slot, stayRecord: ctx.record, persona: ctx.persona, bookingContext: ctx.booking_context, culturalContext: ctx.cultural_context, question };
    }).filter(Boolean);
    const answers = await interviewMultipleAgents(items);
    res.json({ question, n_agents: answers.length, filters, answers });
  } catch (err) {
    res.status(500).json({ error: err.message.substring(0, 200) });
  }
});

// ─── CAPABILITY B: Cohort retrieval ────────────────────────────────

router.post('/simulation/:simulationId/agents/query', (req, res) => {
  const result = _getCompletedSimOrRespond(req.params.simulationId, res);
  if (!result) return;
  try {
    const agentRetrieval = require('../services/enterprise/agent-retrieval');
    const criteria = req.body?.criteria || req.body || {};
    const matched = agentRetrieval.queryAgents(result, criteria);
    const summary = agentRetrieval.summarizeCohortQuery(matched, result);
    res.json({ count: matched.length, matched, summary });
  } catch (err) {
    res.status(500).json({ error: err.message.substring(0, 200) });
  }
});

// ─── CAPABILITY C: Attribution ─────────────────────────────────────

router.get('/simulation/:simulationId/agent/:agentSlot/attribution', (req, res) => {
  const result = _getCompletedSimOrRespond(req.params.simulationId, res);
  if (!result) return;
  const slotCtx = _getRecordAtSlot(result, req.params.agentSlot);
  if (!slotCtx) return res.status(404).json({ error: 'agent slot not found or failed' });
  try {
    const attr = require('../services/enterprise/attribution-engine');
    res.json(attr.decomposeAgentNPS(slotCtx.record));
  } catch (err) {
    res.status(500).json({ error: err.message.substring(0, 200) });
  }
});

router.get('/simulation/:simulationId/attribution', (req, res) => {
  const result = _getCompletedSimOrRespond(req.params.simulationId, res);
  if (!result) return;
  try {
    const attr = require('../services/enterprise/attribution-engine');
    res.json(attr.decomposeCohortNPS(result));
  } catch (err) {
    res.status(500).json({ error: err.message.substring(0, 200) });
  }
});

// ─── CAPABILITY D: Counterfactual ──────────────────────────────────

router.post('/counterfactual', (req, res) => {
  const {
    modality = 'stay_experience',
    audience,
    agent_count = 6,
    property,
    baseline_inputs = {},
    variant_inputs = {},
    variant_label = 'variant',
  } = req.body || {};
  if (!audience) return res.status(400).json({ error: 'audience is required' });
  if (!property?.name) return res.status(400).json({ error: 'property.name is required' });

  const simulationId = uuidv4();
  const propertyWithId = { ...property, id: property.id || `inline-${simulationId}`, data_json: property.data_json || property };

  const state = {
    status: 'running',
    modality,
    kind: 'counterfactual',
    variant_label,
    started_at: new Date().toISOString(),
    progress: { phase: 'starting', events: [] },
    property_inline: propertyWithId,
    result: null,
  };
  activeStaySims.set(simulationId, state);
  res.json({ simulationId, status: 'running', kind: 'counterfactual', variant_label });

  const onProgress = (e) => {
    if (e.phase) state.progress.phase = e.phase;
    state.progress.events = [...(state.progress.events || []).slice(-79), { t: Date.now(), ...e }];
  };

  const { runCounterfactual } = require('../services/enterprise/counterfactual-engine');
  runCounterfactual({ modality, audience, agent_count, property: propertyWithId, baseline_inputs, variant_inputs, variant_label, onProgress })
    .then(result => {
      state.status = 'completed';
      state.result = {
        modality,
        kind: 'counterfactual',
        variant_label,
        baseline_summary: result.baseline_result.summary,
        variant_summary: result.variant_result.summary,
        delta: result.delta,
        baseline_records: result.baseline_result.records,
        variant_records: result.variant_result.records,
        property: result.baseline_result.property,
      };
      state.completed_at = new Date().toISOString();
    })
    .catch(err => {
      console.error(`[counterfactual ${simulationId}] FAILED:`, err.message);
      state.status = 'failed';
      state.error = err.message.substring(0, 300);
    });
});

// ─── CAPABILITY F: Revenue playbook ────────────────────────────────

router.get('/simulation/:simulationId/playbook', async (req, res) => {
  const result = _getCompletedSimOrRespond(req.params.simulationId, res);
  if (!result) return;
  const format = String(req.query.format || 'md').toLowerCase();
  const language = String(req.query.language || 'es').toLowerCase();
  try {
    const { generateRevenuePlaybook } = require('../services/enterprise/revenue-playbook');
    const out = await generateRevenuePlaybook({ simulationResult: result, format, language });
    const filename = `revenue-playbook-${req.params.simulationId.slice(0, 8)}.${out.extension}`;
    res.setHeader('Content-Type', out.mime);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(out.buffer);
  } catch (err) {
    res.status(500).json({ error: err.message.substring(0, 300) });
  }
});

// ─── CAPABILITY H: Longitudinal persistence ────────────────────────

router.get('/agent/:agentId/history', async (req, res) => {
  try {
    const persist = require('../services/enterprise/agent-persistence');
    const h = await persist.getAgentHistory(req.params.agentId);
    if (!h) return res.status(404).json({ error: 'agent not found or no history available' });
    res.json(h);
  } catch (err) {
    res.status(500).json({ error: err.message.substring(0, 200) });
  }
});

router.get('/agents', async (req, res) => {
  try {
    const persist = require('../services/enterprise/agent-persistence');
    const rows = await persist.listAgents({ archetypeId: req.query.archetype || null, limit: Math.min(parseInt(req.query.limit, 10) || 100, 500) });
    res.json({ agents: rows });
  } catch (err) {
    res.status(500).json({ error: err.message.substring(0, 200) });
  }
});

module.exports = router;
