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

module.exports = router;
