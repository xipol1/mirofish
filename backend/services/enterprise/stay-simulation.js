/**
 * Stay Simulation Orchestrator — runs N synthetic guests through a full stay at a property.
 *
 * Pipeline:
 *   1. Load property + historical review aggregation as calibration
 *   2. Decompose audience → generate archetypal personas (hospitality pack)
 *   3. For each persona in parallel (respecting concurrency):
 *      a. Run guest-journey (stage-by-stage narrative simulation)
 *      b. Run review-predictor (produces predicted review + NPS)
 *      c. Persist the stay record + predicted review
 *   4. Aggregate: conversion-to-repeat, predicted NPS distribution, spend totals,
 *      top positive/negative predicted themes, social-share probability
 *
 * Result feeds the enterprise results page with property-specific intelligence.
 */

const { generatePersonas } = require('../personaGenerator');
const { decomposeAudience } = require('../audienceDecomposer');
const { runStay } = require('./guest-journey');
const { predictReview } = require('./review-predictor');
const { aggregateReviews, toCalibrationSignals } = require('../data/review-parser');
const db = require('../../db/pg');
const { getProvider } = require('../ai');

const CONCURRENCY = parseInt(process.env.PLAYWRIGHT_CONCURRENCY, 10) || 3;

async function runStaySimulation({
  orgId,
  simulationId,
  property,            // loaded from DB: { id, name, data_json, ...reviews aggregations }
  audience,            // free-text description
  agent_count = 10,
  stay_length_nights = null,
  goal = null,
  onProgress,
}) {
  const emit = onProgress || (() => {});

  emit({ type: 'sim_start', phase: 'starting', payload: { message: 'Starting stay simulation', property_name: property?.name } });

  // Phase 1: audience decomposition
  emit({ type: 'phase_start', phase: 'decomposing_audience', phase_index: 1 });
  const audienceVector = await decomposeAudience(audience);
  audienceVector.vertical = 'hospitality'; // override — force sector

  // Phase 2: Load calibration from property reviews
  emit({ type: 'phase_start', phase: 'loading_calibration', phase_index: 2 });
  const calibration = await buildCalibrationSignals(property);

  // Phase 3: Generate personas (hospitality archetypes)
  emit({ type: 'phase_start', phase: 'generating_personas', phase_index: 3, payload: { message: `Generating ${agent_count} guest personas` } });
  const personas = await generatePersonas({
    taskType: 'landing_page',   // triggers hospitality archetype set
    audienceVector,
    count: agent_count,
    industrySlug: 'hospitality',
    onProgress: (p) => emit({ type: 'phase_progress', phase: 'generating_personas', payload: p }),
  });

  // Phase 4: Run each guest's full stay + predicted review
  emit({ type: 'phase_start', phase: 'running_stays', phase_index: 4, payload: { message: `Running ${personas.length} complete stay simulations`, total: personas.length } });
  const stays = new Array(personas.length);
  let nextIdx = 0;
  let completed = 0;

  async function worker(workerId) {
    while (true) {
      const myIdx = nextIdx++;
      if (myIdx >= personas.length) return;
      const persona = personas[myIdx];

      try {
        // Derive stay length per archetype if not explicitly specified
        const behavior = require('./narrative-engine').getArchetypeBehavior(persona.archetype_id || persona._archetype_id);
        const lenRange = behavior?.typical_stay_length_nights || [2, 4];
        const stayLen = stay_length_nights || (Math.floor(Math.random() * (lenRange[1] - lenRange[0] + 1)) + lenRange[0]);
        const tripPurpose = inferTripPurpose(persona);

        emit({
          type: 'stay_start',
          payload: { slot: myIdx, persona_name: persona.name, archetype: persona.archetype_label, length_nights: stayLen, trip_purpose: tripPurpose, total: personas.length },
        });

        const stay = await runStay({
          persona,
          property,
          calibration,
          stay_length_nights: stayLen,
          trip_purpose: tripPurpose,
          arrival_context: {},
          onStage: (stage) => emit({ type: 'stay_stage', payload: { slot: myIdx, persona_name: persona.name, stage } }),
        });

        const predictedReview = await predictReview({ stay, persona, property });

        const stayRecord = {
          ...stay,
          persona_full: persona,
          predicted_review: predictedReview,
          total_spend_eur: stay.expense_summary?.total_spend_eur || 0,
          property_id: property?.id || null,
          property_name: property?.name || null,
        };
        stays[myIdx] = stayRecord;

        // Persist to DB if available
        if (db.PG_AVAILABLE && orgId && simulationId) {
          try {
            await db.query(
              `INSERT INTO stays (simulation_id, org_id, property_id, persona, archetype_id, length_nights, trip_purpose,
                                  stages_json, sensation_history_json, expenses_json, total_spend_eur, final_sensation_json,
                                  predicted_nps, predicted_star_rating, predicted_review_platform, predicted_review_body,
                                  predicted_review_title, predicted_review_themes_json, would_repeat_boolean, would_recommend_boolean, completed_at)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20, now())`,
              [
                simulationId, orgId, property?.id || null,
                JSON.stringify(persona),
                persona.archetype_id || persona._archetype_id,
                stayLen, tripPurpose,
                JSON.stringify(stay.stages || []),
                JSON.stringify(stay.sensation_history || []),
                JSON.stringify(stay.expense_summary?.itemized || []),
                stay.expense_summary?.total_spend_eur || 0,
                JSON.stringify(stay.final_sensation_state || {}),
                stay.sensation_summary?.nps ?? null,
                stay.sensation_summary?.stars ?? null,
                predictedReview?.platform ?? null,
                predictedReview?.body ?? null,
                predictedReview?.title ?? null,
                JSON.stringify(predictedReview?.themes || []),
                predictedReview?.would_repeat ?? null,
                predictedReview?.would_recommend ?? null,
              ]
            );
          } catch (err) {
            console.error('[stay-sim] DB insert failed:', err.message.substring(0, 150));
          }
        }

        completed++;
        emit({
          type: 'stay_complete',
          payload: {
            slot: myIdx,
            persona_name: persona.name,
            stars: stay.sensation_summary?.stars,
            nps: stay.sensation_summary?.nps,
            total_spend_eur: stay.expense_summary?.total_spend_eur,
            will_review: predictedReview?.will_write_review,
            platform: predictedReview?.platform,
            completed, total: personas.length,
          },
        });
      } catch (err) {
        console.error(`[stay-sim] Stay ${myIdx} failed:`, err.message.substring(0, 150));
        stays[myIdx] = {
          error: err.message.substring(0, 200),
          persona_full: persona,
          predicted_review: null,
        };
        completed++;
      }
    }
  }

  const workers = Array.from({ length: Math.min(CONCURRENCY, personas.length) }, (_, i) => worker(i + 1));
  await Promise.all(workers);

  // Phase 5: Aggregate results
  emit({ type: 'phase_start', phase: 'aggregating', phase_index: 5 });
  const summary = summarizeStays(stays, property);

  emit({ type: 'sim_complete', payload: summary });

  return {
    mode: 'HOSPITALITY_STAY',
    provider: getProvider(),
    industry: 'hospitality',
    property: property ? { id: property.id, name: property.name, brand: property.brand } : null,
    audience_vector: audienceVector,
    personas,
    stays,
    calibration,
    summary,
  };
}

async function buildCalibrationSignals(property) {
  if (!db.PG_AVAILABLE || !property?.id) {
    return {};
  }
  try {
    const { rows } = await db.query(
      `SELECT * FROM reviews_ingested WHERE property_id = $1 ORDER BY scraped_at DESC LIMIT 500`,
      [property.id]
    );
    if (rows.length === 0) return {};
    const agg = aggregateReviews(rows);
    return toCalibrationSignals(agg);
  } catch (err) {
    console.error('[stay-sim] calibration load failed:', err.message);
    return {};
  }
}

function inferTripPurpose(persona) {
  const arch = persona.archetype_id || persona._archetype_id;
  const map = {
    business_traveler: 'business',
    family_vacationer: 'leisure_family',
    luxury_seeker: 'leisure_couples',
    honeymooner: 'leisure_couples',
    digital_nomad: 'remote_work',
    budget_optimizer: 'leisure_solo',
    loyalty_maximizer: 'business',
    event_attendee: 'event',
  };
  return map[arch] || 'leisure_solo';
}

function summarizeStays(stays, property) {
  const valid = stays.filter(s => s && !s.error);
  const n = valid.length;
  if (n === 0) {
    return { total_stays: 0, avg_stars: null, avg_nps: null, avg_spend_eur: null, predicted_review_platform_mix: {}, top_themes: {}, would_repeat_pct: 0, would_recommend_pct: 0, reviews_generated: 0 };
  }

  const avgStars = valid.reduce((s, x) => s + (x.sensation_summary?.stars || 0), 0) / n;
  const avgNps = valid.reduce((s, x) => s + (x.sensation_summary?.nps ?? 0), 0) / n;
  const avgSpend = valid.reduce((s, x) => s + (x.expense_summary?.total_spend_eur || 0), 0) / n;
  const willReview = valid.filter(x => x.predicted_review?.will_write_review).length;
  const wouldRepeat = valid.filter(x => x.predicted_review?.would_repeat).length;
  const wouldRecommend = valid.filter(x => x.predicted_review?.would_recommend).length;

  const platformMix = {};
  const themeCounts = {};
  for (const s of valid) {
    const pr = s.predicted_review;
    if (pr?.platform) platformMix[pr.platform] = (platformMix[pr.platform] || 0) + 1;
    for (const theme of (pr?.themes || [])) themeCounts[theme] = (themeCounts[theme] || 0) + 1;
  }

  // Promoter/passive/detractor
  const promoters = valid.filter(x => (x.sensation_summary?.nps ?? 0) >= 50).length;
  const detractors = valid.filter(x => (x.sensation_summary?.nps ?? 0) < 0).length;
  const netPromoterScore = Math.round(((promoters - detractors) / n) * 100);

  // Aggregate expense by category
  const spendByCategory = {};
  for (const s of valid) {
    for (const [cat, val] of Object.entries(s.expense_summary?.by_category || {})) {
      spendByCategory[cat] = (spendByCategory[cat] || 0) + val;
    }
  }
  for (const k of Object.keys(spendByCategory)) {
    spendByCategory[k] = Math.round((spendByCategory[k] / n) * 100) / 100;
  }

  return {
    total_stays: n,
    avg_stars: Math.round(avgStars * 10) / 10,
    avg_nps: Math.round(avgNps),
    net_promoter_score: netPromoterScore,
    avg_spend_eur: Math.round(avgSpend * 100) / 100,
    avg_spend_by_category: spendByCategory,
    would_repeat_pct: Math.round((wouldRepeat / n) * 100),
    would_recommend_pct: Math.round((wouldRecommend / n) * 100),
    reviews_generated: willReview,
    predicted_review_platform_mix: platformMix,
    top_predicted_themes: Object.entries(themeCounts).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([theme, count]) => ({ theme, count })),
  };
}

module.exports = { runStaySimulation, summarizeStays };
