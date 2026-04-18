/**
 * Attribution Engine — decomposes an agent's final NPS into its per-dimension
 * and per-stage contributions, using the sensation-tracker history that was
 * already captured during the simulation.
 *
 * For each agent we know:
 *   • sensation_history: [{ stage, deltas, snapshot }], stage-by-stage deltas
 *   • adversarial_events: per incident with resolution_quality
 *   • archetype sensation_weights (how much each dim matters to this archetype)
 *
 * The decomposition computes (per stage and per adverse event):
 *   dim_delta × archetype_weight × score_to_nps_slope
 * and attributes the points to the dimension that produced them. No LLM — this
 * is pure math reusing the calibrated coefficients from sensation_dimensions.json.
 */

const path = require('path');
const fs = require('fs');
const sensationTracker = require('./sensation-tracker');
const { getArchetypeBehavior } = require('./narrative-engine');

const SENSATION_PATH = path.join(__dirname, '..', '..', 'data', 'industries', 'hospitality', 'sensation_dimensions.json');
let _sensCfg = null;
function sensCfg() {
  if (!_sensCfg) _sensCfg = JSON.parse(fs.readFileSync(SENSATION_PATH, 'utf-8'));
  return _sensCfg;
}

// Approx slope: 1 raw-score point ≈ 3 NPS points in the promoter/passive regions
// (matches scoreToNpsAndStars: nps = f(score) with slope ~3 in the middle).
const SCORE_TO_NPS_SLOPE = 3;

function getArchetypeWeights(archetypeId) {
  const behavior = getArchetypeBehavior(archetypeId) || {};
  const w = behavior.sensation_weights || {};
  const dims = Object.keys(sensCfg().dimensions);
  const fallback = 1 / dims.length * 0.3;
  const norm = {};
  let total = 0;
  for (const d of dims) {
    norm[d] = (typeof w[d] === 'number' ? w[d] : fallback);
    total += norm[d];
  }
  // normalise so sum = 1 for cleaner attribution
  if (total > 0) for (const d of dims) norm[d] = norm[d] / total;
  return norm;
}

function exampleMomentForDim(stay, dim) {
  const needle = (dim || '').replace(/_/g, ' ').toLowerCase();
  const stages = stay.stages || [];
  for (const stg of stages) {
    const allMoments = [
      ...(stg.moments_positive || []).map(m => ({ kind: '+', text: typeof m === 'string' ? m : (m.description || m.note || '') })),
      ...(stg.moments_negative || []).map(m => ({ kind: '−', text: typeof m === 'string' ? m : (m.description || m.note || '') })),
    ];
    for (const m of allMoments) {
      if (m.text && m.text.toLowerCase().includes(needle)) {
        return `${m.kind} ${m.text.slice(0, 140)} (${stg.stage})`;
      }
    }
  }
  // Fallback: first delta mention in history
  const hist = stay.sensation_history || [];
  for (const h of hist) {
    if (h.deltas && Object.prototype.hasOwnProperty.call(h.deltas, dim) && h.deltas[dim] !== 0) {
      const sign = h.deltas[dim] > 0 ? '+' : '−';
      return `${sign} ${Math.abs(h.deltas[dim])}pts at ${h.stage}`;
    }
  }
  return null;
}

/**
 * Decompose one agent's NPS into per-dimension + per-stage contributions.
 */
function decomposeAgentNPS(stayRecord) {
  if (!stayRecord || stayRecord.error) {
    return { error: 'stay record missing or failed', final_nps: null };
  }

  const archetypeId = stayRecord.archetype_id
    || stayRecord.persona_full?.archetype_id
    || stayRecord.persona?.archetype_id;

  const weights = getArchetypeWeights(archetypeId);
  const history = stayRecord.sensation_history || [];
  const finalNps = stayRecord.sensation_summary?.nps ?? null;
  const finalStars = stayRecord.sensation_summary?.stars ?? null;

  // Per-dimension total contribution across all stages (in NPS points)
  const dimContribution = {};
  for (const d of Object.keys(weights)) dimContribution[d] = 0;

  // Per-stage breakdown
  const perStage = [];
  for (const h of history) {
    const deltas = h.deltas || {};
    let stageNpsDelta = 0;
    const contributors = {};
    for (const [dim, delta] of Object.entries(deltas)) {
      if (typeof delta !== 'number' || delta === 0) continue;
      const w = weights[dim] ?? 0;
      const contrib = delta * w * SCORE_TO_NPS_SLOPE;
      stageNpsDelta += contrib;
      contributors[dim] = Math.round(contrib * 10) / 10;
      dimContribution[dim] = (dimContribution[dim] || 0) + contrib;
    }
    perStage.push({
      stage: h.stage,
      delta_nps: Math.round(stageNpsDelta * 10) / 10,
      contributors,
    });
  }

  // Moments bonus/penalty → pure additive; assign to a 'peak_experience' virtual dim
  const posCount = (stayRecord.moments_positive || []).length;
  const negCount = (stayRecord.moments_negative || []).length;
  const momentsBonus = 3.5 * Math.sqrt(Math.max(0, posCount)) * SCORE_TO_NPS_SLOPE;
  const momentsPenalty = 4.5 * negCount * SCORE_TO_NPS_SLOPE;
  dimContribution['_peak_experience_positive'] = Math.round(momentsBonus * 10) / 10;
  dimContribution['_peak_experience_negative'] = -Math.round(momentsPenalty * 10) / 10;

  // Adversarial event impact
  const adverseContrib = [];
  for (const ev of (stayRecord.adversarial_events || [])) {
    const d = ev.nps_impact ?? ev.impact_nps;
    const impact = typeof d === 'number'
      ? d
      : (ev.resolution_quality === 'good' ? -6 : ev.resolution_quality === 'adequate' ? -12 : -22);
    adverseContrib.push({
      event_id: ev.event_id,
      stage: ev.stage || null,
      resolution_quality: ev.resolution_quality || 'unknown',
      nps_impact: Math.round(impact * 10) / 10,
    });
  }

  // Rank drivers
  const ranked = Object.entries(dimContribution)
    .map(([dim, pts]) => ({ dim, points: Math.round(pts * 10) / 10 }))
    .filter(x => Math.abs(x.points) >= 0.1);

  const positives = ranked.filter(x => x.points > 0).sort((a, b) => b.points - a.points).slice(0, 5);
  const negatives = ranked.filter(x => x.points < 0).sort((a, b) => a.points - b.points).slice(0, 5);

  const top3Pos = positives.slice(0, 3).map(x => ({
    ...x,
    example_moment: exampleMomentForDim(stayRecord, x.dim),
  }));
  const top3Neg = negatives.slice(0, 3).map(x => ({
    ...x,
    example_moment: exampleMomentForDim(stayRecord, x.dim),
  }));

  return {
    archetype_id: archetypeId,
    final_nps: finalNps,
    final_stars: finalStars,
    per_stage_nps_delta: perStage,
    adversarial_event_nps_impact: adverseContrib,
    dimension_total_contribution: Object.fromEntries(ranked.map(r => [r.dim, r.points])),
    top_positive_drivers: positives,
    top_negative_drivers: negatives,
    top_3_positive_drivers: top3Pos,
    top_3_negative_drivers: top3Neg,
    weights_used: weights,
  };
}

/**
 * Cohort-level decomposition — aggregates per-agent decomposition.
 */
function decomposeCohortNPS(simulationResult) {
  const stays = simulationResult?.records || simulationResult?.stays || [];
  const valid = stays.filter(s => s && !s.error);
  if (valid.length === 0) {
    return { cohort_avg_nps: null, n: 0, top_drivers_cohort_level: [], segment_drivers: {} };
  }

  const perAgent = valid.map(decomposeAgentNPS);
  const cohortDimSum = {};

  for (const d of perAgent) {
    for (const [dim, pts] of Object.entries(d.dimension_total_contribution || {})) {
      cohortDimSum[dim] = (cohortDimSum[dim] || 0) + pts;
    }
  }
  const n = perAgent.length;
  const cohortDimAvg = Object.fromEntries(Object.entries(cohortDimSum).map(([k, v]) => [k, Math.round((v / n) * 10) / 10]));

  const cohortRanked = Object.entries(cohortDimAvg)
    .map(([dim, pts]) => ({ dim, avg_points: pts }))
    .sort((a, b) => Math.abs(b.avg_points) - Math.abs(a.avg_points))
    .slice(0, 10);

  // Per-archetype segmentation
  const byArch = {};
  perAgent.forEach((d, i) => {
    const arch = d.archetype_id || 'unknown';
    (byArch[arch] = byArch[arch] || []).push(d);
  });
  const segmentDrivers = {};
  for (const [arch, list] of Object.entries(byArch)) {
    const sum = {};
    for (const d of list) for (const [dim, pts] of Object.entries(d.dimension_total_contribution || {})) {
      sum[dim] = (sum[dim] || 0) + pts;
    }
    const avg = Object.fromEntries(Object.entries(sum).map(([k, v]) => [k, Math.round((v / list.length) * 10) / 10]));
    const top = Object.entries(avg).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])).slice(0, 5).map(([dim, points]) => ({ dim, avg_points: points }));
    segmentDrivers[arch] = {
      n: list.length,
      avg_nps: Math.round(list.reduce((s, d) => s + (d.final_nps || 0), 0) / list.length),
      top_drivers: top,
    };
  }

  const avgNps = Math.round(perAgent.reduce((s, d) => s + (d.final_nps || 0), 0) / n);

  return {
    n,
    cohort_avg_nps: avgNps,
    top_drivers_cohort_level: cohortRanked,
    segment_drivers: segmentDrivers,
  };
}

module.exports = { decomposeAgentNPS, decomposeCohortNPS };
