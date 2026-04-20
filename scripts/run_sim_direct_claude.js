#!/usr/bin/env node
/**
 * Direct in-process simulation run — no HTTP, no tunnel, no API layer.
 *
 * Forces Claude Sonnet 4.6 (better JSON adherence + richer humanness output
 * than Groq 8B or Ollama 3B). Concurrency raised to 6.
 *
 * Usage: node scripts/run_sim_direct_claude.js
 */

// --- env overrides BEFORE loading ai.js ---
require('dotenv').config({ path: require('path').join(__dirname, '..', 'backend', '.env') });
process.env.PLAYWRIGHT_CONCURRENCY = process.env.PLAYWRIGHT_CONCURRENCY || '12';
const AGENT_COUNT_OVERRIDE = parseInt(process.env.AGENT_COUNT || '0', 10) || null;

const path = require('path');
const fs = require('fs');

// Swap ai.js → deterministic Claude-designed stub before loading orchestrator.
const Module = require('module');
const origResolve = Module._resolveFilename;
const stubPath = path.resolve(__dirname, '..', 'backend', 'services', 'ai_claude_synth.js');
Module._resolveFilename = function(request, parent, ...rest) {
  if ((request === './ai' || request === '../ai' || request.endsWith('/services/ai'))
      && parent && parent.filename && parent.filename.includes('backend')) {
    return stubPath;
  }
  return origResolve.call(this, request, parent, ...rest);
};

const { runSimulation } = require(path.join(__dirname, '..', 'backend', 'services', 'enterprise', 'simulation-orchestrator'));

const REQUEST = JSON.parse(fs.readFileSync(path.join(__dirname, 'villa_le_blanc_sim_request.json'), 'utf-8'));
REQUEST.property.id = `inline-direct-${Date.now()}`;
REQUEST.property.data_json = REQUEST.property.data_json || REQUEST.property;
if (AGENT_COUNT_OVERRIDE) REQUEST.agent_count = AGENT_COUNT_OVERRIDE;

const LOG_PATH = path.join(__dirname, '..', 'sim_snapshots', `sim_claude_${Date.now()}.json`);
const started = Date.now();

let agentsDone = 0;
const onProgress = (e) => {
  if (e.type === 'phase_start') {
    console.log(`[${new Date().toISOString().slice(11,19)}] PHASE: ${e.phase}`);
  } else if (e.type === 'agent_start') {
    console.log(`[${new Date().toISOString().slice(11,19)}] START slot=${e.payload.slot} ${e.payload.persona_name} (${e.payload.archetype})`);
  } else if (e.type === 'agent_complete') {
    agentsDone++;
    const s = e.payload.summary || {};
    console.log(`[${new Date().toISOString().slice(11,19)}] DONE  slot=${e.payload.slot} ${e.payload.persona_name} → ${s.stars}★  NPS=${s.nps}  €${s.total_spend_eur}  platform=${s.platform}  (${agentsDone}/${REQUEST.agent_count})`);
  } else if (e.type === 'sim_complete') {
    console.log(`[${new Date().toISOString().slice(11,19)}] SIM_COMPLETE`);
  } else if (e.type === 'calibration_loaded') {
    console.log(`[${new Date().toISOString().slice(11,19)}] CALIB: ${e.payload.review_count} reviews, avg ${e.payload.avg_rating}★, dist ${JSON.stringify(e.payload.star_distribution_pct)}`);
  }
};

(async () => {
  console.log(`[script] starting direct sim: property=${REQUEST.property.name}, agents=${REQUEST.agent_count}, stay_nights=${REQUEST.stay_length_nights}`);
  console.log(`[script] provider: claude-synth-deterministic (in-process), concurrency=${process.env.PLAYWRIGHT_CONCURRENCY}`);
  try {
    const result = await runSimulation({
      modality: 'stay_experience',
      orgId: null,
      simulationId: `direct-${Date.now()}`,
      property: REQUEST.property,
      audience: REQUEST.audience,
      agent_count: REQUEST.agent_count,
      onProgress,
      inlineMode: true,
      modality_inputs: {
        stay_length_nights: REQUEST.stay_length_nights,
      },
    });

    const elapsed = ((Date.now() - started) / 1000).toFixed(1);
    const s = result.summary || {};
    console.log(`\n=== FINAL RESULT (${elapsed}s elapsed) ===`);
    console.log(`avg_stars: ${s.avg_stars}  |  NPS: ${s.net_promoter_score}  |  avg_spend: €${s.avg_spend_eur}`);
    console.log(`star distribution: ${JSON.stringify(s.realized_star_distribution_pct)}`);
    console.log(`target_star_match: ${s.target_star_match_rate_pct}%`);
    console.log(`staff rapport: ${s.avg_staff_rapport}  |  adversarial events: ${s.adversarial_events_total}/${s.total_stays}`);
    console.log(`will_review: ${s.reviews_generated}, would_recommend_pct: ${s.would_recommend_pct}, would_repeat_pct: ${s.would_repeat_pct}`);
    console.log(`culture distribution: ${JSON.stringify(s.culture_distribution)}`);
    console.log(`platform mix: ${JSON.stringify(s.predicted_review_platform_mix)}`);

    fs.mkdirSync(path.dirname(LOG_PATH), { recursive: true });
    fs.writeFileSync(LOG_PATH, JSON.stringify(result, null, 2));
    console.log(`\nFull result saved: ${LOG_PATH}`);

    // Sample reviews for quality inspection
    const samples = (result.records || []).filter(r => r?.predicted_review?.body).slice(0, 2);
    console.log(`\n=== SAMPLE REVIEWS (quality check) ===`);
    for (const r of samples) {
      const pr = r.predicted_review;
      console.log(`\n--- ${r.persona?.name || 'Unknown'} | ${pr.star_rating}★ | ${pr.platform} | ${pr.language} | identity=${pr.identity_style_key} ---`);
      console.log(`title: ${pr.title}`);
      console.log(`body: ${(pr.body || '').slice(0, 700)}`);
    }
    process.exit(0);
  } catch (err) {
    console.error(`[script] FATAL:`, err);
    process.exit(1);
  }
})();
