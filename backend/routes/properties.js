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
  let {
    property, audience, agent_count = 8, stay_length_nights, calibration, goal,
    // Tier 0 context overrides (all optional — defaults sampled realistically)
    season, weather_array, local_events, occupancy_pct, property_country, origin_mix_override,
    // Date-range mode: auto-infer season/occupancy/cultural_mix/weather
    date_range, mode,
  } = req.body;
  if (!property || !property.name) return res.status(400).json({ error: 'property.name required' });
  if (!audience) return res.status(400).json({ error: 'audience required' });

  // Date-range auto-calibration: if caller passes { date_range: { start, end } }
  // we override season/occupancy/cultural_mix from IBESTAT-derived monthly data.
  let inferredContext = null;
  if (date_range && date_range.start && date_range.end) {
    try {
      const { inferContextFromDateRange, computeFullHotelAgentCount } = require('../services/enterprise/external-context');
      inferredContext = inferContextFromDateRange(date_range.start, date_range.end);
      // Only override fields the caller did NOT explicitly set
      season = season || inferredContext.season;
      occupancy_pct = occupancy_pct != null ? occupancy_pct : inferredContext.occupancy_pct;
      origin_mix_override = origin_mix_override || inferredContext.cultural_mix;
      stay_length_nights = stay_length_nights || inferredContext.nights;
      // Full-hotel mode: agent_count = rooms × occupancy × turnover
      if (mode === 'full_hotel') {
        const rooms = property?.data_json?.rooms || property?.rooms || property?.data_json?.identity?.rooms;
        const fullCount = computeFullHotelAgentCount({
          rooms: rooms || 159,
          occupancyPct: occupancy_pct || inferredContext.occupancy_pct,
          nights: inferredContext.nights,
          avgStayLength: 5,
        });
        if (fullCount) agent_count = fullCount;
      }
    } catch (err) {
      return res.status(400).json({ error: `date_range invalid: ${err.message}` });
    }
  }

  const simulationId = uuidv4();
  const propertyWithId = { ...property, id: property.id || `inline-${simulationId}`, data_json: property.data_json || property };

  const state = {
    status: 'running',
    started_at: new Date().toISOString(),
    progress: { phase: 'starting', agents_done: 0, agents_total: agent_count, events: [] },
    property_id: propertyWithId.id,
    property_inline: propertyWithId,
    date_range: date_range || null,
    inferred_context: inferredContext,
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

  res.json({
    simulationId, status: 'running', mode: mode || 'hospitality_stay_direct',
    property_name: propertyWithId.name,
    date_range: date_range || null,
    inferred_context: inferredContext,
    agent_count_resolved: agent_count,
  });

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

/**
 * POST /api/insights-v2-preview
 *
 * End-to-end validation for the Insights V2 pipeline (episodic memory,
 * pre-arrival impulse, tension resolution, insights 4-pass, decision engine).
 *
 * Temporarily enables ENABLE_INSIGHTS_V2 for this request only, runs a small
 * synchronous stay_experience simulation, and returns the enriched summary
 * including insights + recommendations_v2 in one response. Does not persist
 * to DB, does not touch the lab UI, and restores the env flag in a finally
 * block so concurrent requests never see a stuck flag.
 *
 * Body (all optional):
 *   { property?, audience?, agent_count? (3-20, default 10), user_goal?, timeout_ms? (default 600000) }
 *
 * Default property = Villa Le Blanc flagship (loads calibration from disk).
 */
router.post('/insights-v2-preview', async (req, res) => {
  const t0 = Date.now();
  const {
    property: propertyIn,
    audience: audienceIn,
    agent_count: agentIn,
    user_goal,
    timeout_ms = 600000,
  } = req.body || {};

  // Safety clamp on cohort size — preview is for validation, not stress.
  const agent_count = Math.max(3, Math.min(20, parseInt(agentIn, 10) || 10));

  // Default property: Villa Le Blanc flagship. Slug is the hook the
  // orchestrator uses to auto-load villa_le_blanc_calibration.json from disk.
  const property = propertyIn && propertyIn.name ? propertyIn : {
    name: 'Gran Meliá Villa Le Blanc',
    slug: 'gran-melia-villa-le-blanc',
    brand: 'Gran Meliá',
    data_json: {
      identity: {
        name: 'Gran Meliá Villa Le Blanc',
        brand: 'Gran Meliá',
        tier: 'luxury',
        category_stars: 5,
        location: { city: 'Menorca', country: 'ES', destination_type: 'coastal_leisure' },
      },
      cultural_mix: { // menorca_leisure_flagship preset
        anglo_uk_ireland: 45, german_dach: 15, latin_spain_italy: 12, french: 10,
        anglo_us_canada: 6, nordic: 4, latin_american: 3, east_asian: 2,
        middle_east_gcc: 2, chinese_mainland: 1,
      },
    },
  };

  const audience = audienceIn && String(audienceIn).trim()
    ? audienceIn
    : 'European luxury couples, honeymooners and anniversary travellers picking a Menorca flagship; mid-to-long lead time; high rate tolerance';

  const simulationId = uuidv4();
  const propertyWithId = { ...property, id: property.id || `insights-v2-preview-${simulationId}`, data_json: property.data_json || property };

  // Capture the last ~120 progress events for the response body — great for
  // spotting which phase stalled if the preview feels slow.
  const events = [];
  const onProgress = (e) => {
    events.push({
      t_ms: Date.now() - t0,
      type: e.type,
      phase: e.phase,
      phase_index: e.phase_index,
      payload: e.payload,
    });
    if (events.length > 120) events.shift();
  };

  // Flip the insights-v2 flag for the duration of this request. The stay
  // modality and orchestrator both read the flag lazily, so a per-request
  // toggle is sufficient and avoids forcing an env change on the process.
  const priorFlag = process.env.ENABLE_INSIGHTS_V2;
  process.env.ENABLE_INSIGHTS_V2 = 'true';

  try {
    const { runStaySimulation } = require('../services/enterprise/stay-simulation');

    const runPromise = runStaySimulation({
      orgId: null,
      simulationId,
      property: propertyWithId,
      audience,
      agent_count,
      onProgress,
      inlineMode: true,
      // forward user_goal so decision-engine can use it
      // (stay-simulation shim doesn't pass user_goal through by default;
      // we stash it on modality_inputs via a monkey-side via the opts
      // object — see below).
    });

    // Race the run against the requested timeout so the HTTP connection
    // does not hang past a client's reasonable wait. 10 agents × Claude
    // Sonnet is ~5-10 min; synth provider is ~seconds.
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`preview_timeout after ${timeout_ms}ms`)), Math.max(5000, timeout_ms))
    );

    const result = await Promise.race([runPromise, timeoutPromise]);

    const summary = result?.summary || {};
    const insights = summary.insights || null;
    const recommendations_v2 = summary.recommendations_v2 || null;
    const adversarial = insights?.passes?.adversarial || null;

    // If user_goal was passed and decision-engine has already run, we cannot
    // retroactively inject it. Note this in the response so a caller that
    // cares about user_goal knows to pass it through a deeper endpoint.
    const user_goal_note = user_goal
      ? 'user_goal received but not threaded into decision-engine in the v1 preview — extend stay-simulation shim or call insights-engine/decision-engine directly to honour it.'
      : null;

    res.json({
      ok: true,
      simulationId,
      elapsed_ms: Date.now() - t0,
      provider: result?.provider,
      property: result?.property,
      audience_vector: result?.audience_vector,
      agent_count,
      insights_v2_enabled: true,
      // Cohort-level KPIs the CRO would glance at first.
      headline_kpis: {
        avg_stars: summary.avg_stars ?? null,
        avg_nps: summary.avg_nps ?? null,
        net_promoter_score: summary.net_promoter_score ?? null,
        target_star_match_rate_pct: summary.target_star_match_rate_pct ?? null,
        realized_star_distribution_pct: summary.realized_star_distribution_pct ?? null,
        would_repeat_pct: summary.would_repeat_pct ?? null,
        would_recommend_pct: summary.would_recommend_pct ?? null,
        avg_spend_eur: summary.avg_spend_eur ?? null,
        avg_staff_rapport: summary.avg_staff_rapport ?? null,
      },
      insights_gate: {
        ready_for_client: insights?.ready_for_client ?? false,
        reason: insights?.reason ?? 'insights_not_run',
        trustworthiness: adversarial?.overall_report_trustworthiness ?? null,
        calibration_drift_detected: adversarial?.calibration_drift_detected ?? null,
      },
      insights,
      recommendations_v2,
      events,
      user_goal_note,
    });
  } catch (err) {
    console.error(`[insights-v2-preview ${simulationId}] FAILED:`, err);
    res.status(500).json({
      ok: false,
      simulationId,
      elapsed_ms: Date.now() - t0,
      error: err.message,
      error_stack: err.stack ? err.stack.split('\n').slice(0, 6).join('\n') : null,
      events,
    });
  } finally {
    // Always restore, even on timeout/throw — never leak the flag.
    if (priorFlag === undefined) delete process.env.ENABLE_INSIGHTS_V2;
    else process.env.ENABLE_INSIGHTS_V2 = priorFlag;
  }
});

/**
 * POST /api/revenue-scenario
 * Body: { scenario_id, baseline_simulation_id } OR { scenario_id, baseline }
 * Returns: revenue Δ, NPS Δ, LTV Δ, zone classification.
 */
router.post('/revenue-scenario', (req, res) => {
  try {
    const { scenario_id, baseline_simulation_id, baseline, cohort_size, custom } = req.body;
    if (!scenario_id) return res.status(400).json({ error: 'scenario_id required' });
    let baselineSummary = baseline;
    if (!baselineSummary && baseline_simulation_id) {
      const sim = activeStaySims.get(baseline_simulation_id);
      baselineSummary = sim?.result?.summary;
      if (!baselineSummary) return res.status(404).json({ error: 'baseline simulation not found or not completed' });
    }
    const { runScenario } = require('../services/enterprise/revenue-engine');
    const result = runScenario({ scenario_id, custom, baseline: baselineSummary, cohort_size: cohort_size || 50 });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/revenue-scenarios', (req, res) => {
  const { listPresets } = require('../services/enterprise/revenue-engine');
  res.json({ presets: listPresets() });
});

/**
 * POST /api/staffing-plan
 * Body: { rooms, occupancy_pct, nights, archetype_mix_pct, understaff_pct?, scenarios? }
 * Returns: daily staff demand + cost + NPS risk by department.
 */
router.post('/staffing-plan', (req, res) => {
  try {
    const { rooms, occupancy_pct, nights, archetype_mix_pct = {}, understaff_pct = 0, compare_scenarios = false, property_tier = 'luxury' } = req.body;
    if (!rooms || !occupancy_pct || !nights) return res.status(400).json({ error: 'rooms + occupancy_pct + nights required' });
    const { planStaffing, compareScenarios } = require('../services/enterprise/staffing-engine');
    const plan = planStaffing({ rooms, occupancy_pct, nights, archetype_mix_pct, property_tier, understaff_pct });
    const response = { plan };
    if (compare_scenarios) {
      response.scenario_comparison = compareScenarios({ rooms, occupancy_pct, nights, archetype_mix_pct });
    }
    res.json(response);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/dictionary/:kind
 * Returns the raw calibrated dictionaries the simulation uses:
 * archetypes, cultures, adversarial_events, sensation_dimensions, sample_reviews.
 * Used by the Library tab in the dashboard to prove methodology transparency.
 */
router.get('/dictionary/:kind', (req, res) => {
  const path = require('path');
  const fs = require('fs');
  const kindMap = {
    archetypes: 'archetypes.json',
    cultures: 'cultural_profiles.json',
    adversarial_events: 'adversarial_events.json',
    sensation_dimensions: 'sensation_dimensions.json',
    sample_reviews: 'sample_reviews_villa_le_blanc.json',
    calibration: 'villa_le_blanc_calibration.json',
    calibration_palacio: 'gran_melia_palacio_duques_calibration.json',
  };
  const file = kindMap[req.params.kind];
  if (!file) return res.status(404).json({ error: 'unknown dictionary kind', available: Object.keys(kindMap) });
  const p = path.join(__dirname, '..', 'data', 'industries', 'hospitality', file);
  if (!fs.existsSync(p)) return res.status(404).json({ error: 'file not found', path: file });
  try {
    res.json(JSON.parse(fs.readFileSync(p, 'utf8')));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/**
 * GET /api/demo-snapshots
 * Lists cached demo simulations (pre-computed, reliable for client pitches).
 * These are loaded instantly — no LLM calls, no 10-minute wait, no fetch-fail risk.
 */
router.get('/demo-snapshots', (req, res) => {
  const path = require('path');
  const fs = require('fs');
  const dir = path.join(__dirname, '..', 'data', 'demo_snapshots');
  if (!fs.existsSync(dir)) return res.json({ snapshots: [] });
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
  const snapshots = files.map(f => {
    try {
      const raw = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
      return {
        slug: f.replace(/\.json$/, ''),
        property_name: raw.property?.name || null,
        property_brand: raw.property?.brand || null,
        n_original: raw._demo_n_original || raw.summary?.total_stays || null,
        n_sampled: raw._demo_n_sampled || raw.stays_sample?.length || null,
        avg_stars: raw.summary?.avg_stars ?? null,
        net_promoter_score: raw.summary?.net_promoter_score ?? null,
        target_star_match_rate_pct: raw.summary?.target_star_match_rate_pct ?? null,
        calibration_avg_rating: raw.calibration?.avg_rating ?? null,
        generated_at: raw._demo_generated || null,
      };
    } catch (err) { return { slug: f, error: err.message }; }
  });
  res.json({ snapshots });
});

/**
 * GET /api/demo-snapshot/:slug
 * Serves the full payload of a cached snapshot so the Lab UI can render it
 * as if it were a fresh simulation (but without provider risk).
 */
router.get('/demo-snapshot/:slug', (req, res) => {
  const path = require('path');
  const fs = require('fs');
  const safeSlug = String(req.params.slug).replace(/[^a-z0-9_\-]/gi, '');
  const file = path.join(__dirname, '..', 'data', 'demo_snapshots', `${safeSlug}.json`);
  if (!fs.existsSync(file)) return res.status(404).json({ error: 'snapshot not found' });
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    res.json({
      slug: safeSlug,
      status: 'completed',
      source: 'demo_snapshot_cached',
      result: {
        mode: raw.mode,
        provider: raw.provider,
        industry: raw.industry,
        property: raw.property,
        audience_vector: raw.audience_vector,
        personas: raw.personas || [],
        stays: raw.stays_sample || [],
        calibration: raw.calibration,
        summary: raw.summary,
      },
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/**
 * POST /api/stay-simulate-demo
 * Registers a cached snapshot as an active sim (for UIs that poll
 * /stay-simulation/:id). Returns a simulationId that resolves instantly
 * to the cached payload — zero risk for a live client demo.
 */
router.post('/stay-simulate-demo', (req, res) => {
  const path = require('path');
  const fs = require('fs');
  const slug = String(req.body?.slug || 'villa_le_blanc_n1000').replace(/[^a-z0-9_\-]/gi, '');
  const file = path.join(__dirname, '..', 'data', 'demo_snapshots', `${slug}.json`);
  if (!fs.existsSync(file)) return res.status(404).json({ error: `demo snapshot "${slug}" not found` });
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    const simulationId = uuidv4();
    const now = new Date().toISOString();
    const state = {
      status: 'completed',
      started_at: now,
      completed_at: now,
      progress: { phase: 'completed', agents_done: raw.summary?.total_stays || 0, agents_total: raw.summary?.total_stays || 0, events: [] },
      property_inline: raw.property || null,
      source: 'demo_snapshot_cached',
      demo_slug: slug,
      result: {
        mode: raw.mode,
        provider: raw.provider,
        industry: raw.industry,
        property: raw.property,
        audience_vector: raw.audience_vector,
        personas: raw.personas || [],
        stays: raw.stays_sample || [],
        calibration: raw.calibration,
        summary: raw.summary,
      },
    };
    activeStaySims.set(simulationId, state);
    res.json({
      simulationId,
      status: 'completed',
      source: 'demo_snapshot_cached',
      demo_slug: slug,
      property_name: raw.property?.name || null,
      agent_count_resolved: raw.summary?.total_stays || 0,
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/**
 * GET /api/stay-simulations
 * Lists all in-memory sims (completed, running, failed) for the Lab UI.
 */
router.get('/stay-simulations', (req, res) => {
  const list = [...activeStaySims.entries()].map(([id, state]) => ({
    id,
    status: state.status,
    property_name: state.property_inline?.name || state.property?.name || null,
    property_brand: state.property_inline?.brand || null,
    started_at: state.started_at,
    completed_at: state.completed_at,
    agent_count: state.result?.summary?.total_stays
      || state.progress?.agents_total
      || state.progress?.agents_done
      || null,
    avg_stars: state.result?.summary?.avg_stars ?? null,
    net_promoter_score: state.result?.summary?.net_promoter_score ?? null,
  }));
  list.sort((a, b) => (b.completed_at || b.started_at || '').localeCompare(a.completed_at || a.started_at || ''));
  res.json({ simulations: list });
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

// ─── Agent chat (lab: talk to a synthetic agent) ────────────

router.post('/agent-chat', async (req, res) => {
  const { agent, context, history, message } = req.body || {};
  if (!agent || !message) return res.status(400).json({ error: 'agent and message required' });
  const { callAI } = require('../services/ai');
  const priorTurns = (history || []).slice(-8).map((m) => `${m.role === 'user' ? 'Guest' : agent.name}: ${m.text}`).join('\n');
  const system = `You ARE ${agent.name}, a ${agent.age}-year-old synthetic ${agent.archetype} guest at ${context?.property || 'the hotel'}.
Your defining memory: "${agent.memory}".
Your current NPS score: ${agent.current_nps}.
Current sensation state: ${context?.dimensions || '—'}.
Speak in first person, briefly (1–3 short sentences), in the same language as the user. Stay fully in-character — you have opinions grounded in your archetype and memory. Never break character. If asked technical/off-topic, politely reroute to your stay experience.`;
  try {
    const reply = await callAI(`${priorTurns ? priorTurns + '\n' : ''}Guest: ${message}\n${agent.name}:`, {
      system, maxTokens: 220, temperature: 0.85,
    });
    res.json({ reply: (reply || '').trim().replace(/^["']|["']$/g, '') });
  } catch (e) {
    res.status(200).json({ reply: `(${agent.name}): ${agent.memory}. ${message.length < 20 ? '¿Qué te gustaría saber exactamente?' : 'Tengo que pensarlo un momento.'}` });
  }
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

// ─── Scenario editor: live preview + full sim trigger ─────────────

/**
 * POST /api/scenario-preview
 * Body: { property, audience, decision }
 * Returns: deterministic formula-based preview in <50ms (no sim, no LLM).
 */
router.post('/scenario-preview', (req, res) => {
  try {
    const { computeScenarioPreview } = require('../services/enterprise/scenario-preview');
    const scenario = req.body || {};
    const preview = computeScenarioPreview(scenario);
    res.json(preview);
  } catch (err) {
    res.status(500).json({ error: err.message.substring(0, 300) });
  }
});

module.exports = router;
