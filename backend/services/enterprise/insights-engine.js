/**
 * Insights Engine — Entregable 5
 *
 * Four-pass analysis over the full cohort of agent records. Runs AFTER
 * aggregation (phase 6 of the orchestrator). Each pass feeds the next — we
 * do NOT re-send the full cohort through every pass, which keeps n=1000 runs
 * affordable.
 *
 *   PASS 1 — AGGREGATE    : group by archetype × cultural cluster × star bucket,
 *                           extract dominant decision chain.
 *   PASS 2 — DIVERGE      : find points where two comparable segments split.
 *   PASS 3 — ANOMALY      : find traces whose outcome doesn't match profile
 *                           prediction; classify as edge-case vs model-drift.
 *   PASS 4 — ADVERSARIAL  : attack every insight against property calibration
 *                           (top_positive_themes / top_negative_themes /
 *                           star_distribution_pct / archetype_mix_expected_pct).
 *
 * Gated by ENABLE_INSIGHTS_V2=true. Fail-open: any pass failure returns an
 * empty report for that pass without blocking the rest.
 */

const { callAIJSON } = require('../ai');

const MIN_CLUSTER_SIZE = 3;
const MAX_TRACES_PER_PASS = 60;

async function runInsightsEngine({ records, calibration, property, audience_vector }) {
  const valid = (records || []).filter(r => r && !r.error);
  if (valid.length === 0) {
    return { enabled: true, passes: {}, ready_for_client: false, reason: 'no_valid_records' };
  }

  const traces = valid.map(toCompactTrace);

  let aggregate = null, diverge = null, anomaly = null, adversarial = null;
  try {
    aggregate = await passAggregate(traces);
  } catch (err) {
    console.error('[insights-engine] PASS 1 failed:', err.message?.substring(0, 140));
    aggregate = { clusters: [], sparse_clusters: [], cross_cluster_universal_patterns: [], _error: err.message?.substring(0, 120) };
  }
  try {
    diverge = await passDiverge(aggregate);
  } catch (err) {
    console.error('[insights-engine] PASS 2 failed:', err.message?.substring(0, 140));
    diverge = { divergence_points: [], irreducible_cultural_divergences: [], _error: err.message?.substring(0, 120) };
  }
  try {
    anomaly = await passAnomaly(traces, aggregate);
  } catch (err) {
    console.error('[insights-engine] PASS 3 failed:', err.message?.substring(0, 140));
    anomaly = { anomalies: [], model_drift_rate: 0, calibration_miss_rate: 0, recommended_regens: [], _error: err.message?.substring(0, 120) };
  }
  try {
    adversarial = await passAdversarial({ aggregate, diverge, anomaly, calibration, property });
  } catch (err) {
    console.error('[insights-engine] PASS 4 failed:', err.message?.substring(0, 140));
    adversarial = { audited_insights: [], calibration_drift_detected: false, blocked_insights: [], overall_report_trustworthiness: 0.5, _error: err.message?.substring(0, 120) };
  }

  const readyForClient = (adversarial?.overall_report_trustworthiness ?? 0) >= 0.6
    && (anomaly?.model_drift_rate ?? 0) <= 0.08
    && (anomaly?.calibration_miss_rate ?? 0) <= 0.05;

  return {
    enabled: true,
    passes: { aggregate, diverge, anomaly, adversarial },
    ready_for_client: readyForClient,
    reason: readyForClient ? 'passes_thresholds' : 'failed_audit_or_drift',
  };
}

// ────────────────────────────── PASS 1 ──────────────────────────────

async function passAggregate(traces) {
  const sample = sampleTraces(traces, MAX_TRACES_PER_PASS);
  const prompt = `You are analyzing ${sample.length} hotel stay traces from a synthetic cohort. Group by (archetype_id × cultural_cluster × star_bucket) and extract the DOMINANT decision chain for each cluster. Require n>=${MIN_CLUSTER_SIZE} for a cluster to be reported; otherwise mark it sparse.

TRACES (compact, one line each):
${sample.map((t, i) => `[${i}] ${t.archetype_id}|${t.cultural_cluster}|${t.final_star}★ nps=${t.nps} key_deltas=${JSON.stringify(t.top_deltas)} posMoments=${JSON.stringify((t.pos || []).slice(0,2))} negMoments=${JSON.stringify((t.neg || []).slice(0,2))} advEvents=${JSON.stringify(t.adv_events)} complaintCh=${t.complaint_channel} actionChosen=${t.action_chosen || 'n/a'}`).join('\n')}

Extract:
- The causal sequence (NOT just correlation) — which stage-or-moment led to which sensation shift, and which led to outcome.
- Top 3 positive verbatim moments per cluster (copy the exact text from traces — do NOT summarize).
- Top 3 negative verbatim moments per cluster.
- Adversarial event rate per cluster.
- If a cluster cannot produce a dominant chain (fragmented, no shared moments), flag it — do not fabricate.

OUTPUT JSON:
{
  "clusters": [
    {
      "cluster_id": "archetype|cultural|starbucket",
      "archetype_id": "...", "cultural_cluster": "...", "star_bucket": "5|4|3|2|1",
      "n": number,
      "avg_nps": number,
      "dominant_chain": [
        {"stage_or_moment": "...", "sensation_shift": {"dim": "avg_delta"}, "frequency_in_cluster": 0-1, "example_verbatim": "quote"}
      ],
      "chain_confidence": 0-1,
      "top_positive_verbatim": ["quote", "quote", "quote"],
      "top_negative_verbatim": ["quote", "quote", "quote"],
      "adversarial_event_rate": 0-1,
      "culturally_typical_review_closing": "typical final sentence for this cluster"
    }
  ],
  "sparse_clusters": [{"cluster_id": "...", "n": number}],
  "cross_cluster_universal_patterns": ["patterns present in >=60% of clusters"]
}

Do not invent chains. Silence is information — if the cluster doesn't cohere, mark chain_confidence below 0.3 and leave dominant_chain thin.`;
  return await callAIJSON(prompt, { maxTokens: 2400, temperature: 0.4 });
}

// ────────────────────────────── PASS 2 ──────────────────────────────

async function passDiverge(aggregate) {
  const clusters = Array.isArray(aggregate?.clusters) ? aggregate.clusters : [];
  if (clusters.length < 2) return { divergence_points: [], irreducible_cultural_divergences: [] };

  const prompt = `You are looking for EXACT divergence points between pairs of clusters that share at least two of {archetype, cultural_cluster, star_bucket}. Ignore pairs with no overlap — those are not comparable.

CLUSTERS:
${clusters.map((c, i) => `[${i}] ${c.cluster_id} (n=${c.n}, nps=${c.avg_nps}): chain=${JSON.stringify((c.dominant_chain || []).map(s => s.stage_or_moment).slice(0, 6))} | advRate=${c.adversarial_event_rate}`).join('\n')}

For each divergent pair, identify:
- At which stage or moment the shared path breaks.
- Which sensation axis carries the divergence.
- Whether the split is actionable (operational SOP, product, pricing — fixable) or irreducible (cultural preference, not fixable by the property).

OUTPUT JSON:
{
  "divergence_points": [
    {
      "cluster_a": "...", "cluster_b": "...",
      "shared_path_until": "stage_or_moment",
      "divergence_trigger": "concrete description",
      "dimension_of_divergence": "sensation_axis",
      "a_outcome_delta": number, "b_outcome_delta": number,
      "interpretation": "mechanism, not description",
      "actionable": true/false,
      "affected_agents_pct_a": number, "affected_agents_pct_b": number
    }
  ],
  "irreducible_cultural_divergences": ["divergences driven by culture that the property cannot fix — these go to marketing segmentation, not ops"]
}`;
  return await callAIJSON(prompt, { maxTokens: 1800, temperature: 0.4 });
}

// ────────────────────────────── PASS 3 ──────────────────────────────

async function passAnomaly(traces, aggregate) {
  // Identify candidate anomalies with quick numeric filter before asking LLM.
  const clusterAverages = {};
  for (const c of (aggregate?.clusters || [])) {
    clusterAverages[c.cluster_id] = { n: c.n, nps: c.avg_nps };
  }

  const candidates = [];
  for (const t of traces) {
    const clusterId = `${t.archetype_id}|${t.cultural_cluster}|${t.final_star}`;
    const stats = clusterAverages[clusterId];
    if (!stats) continue;
    const deviation = Math.abs((t.nps ?? 0) - (stats.nps ?? 0));
    if (deviation >= 40) candidates.push({ ...t, clusterId, deviation });
  }

  if (candidates.length === 0) {
    return { anomalies: [], model_drift_rate: 0, calibration_miss_rate: 0, recommended_regens: [] };
  }

  const sample = candidates.slice(0, Math.min(30, candidates.length));
  const prompt = `Classify each candidate anomaly trace as either:
- "legitimate_edge_case": real recovery, real emotional spillover, real rare combination.
- "model_drift": voice in the trace is inconsistent with its archetype+cultural profile — sounds like a different persona ventriloquized.
- "calibration_miss": star rating does NOT match the sentiment of the review body (internal incoherence).

CANDIDATES:
${sample.map((c, i) => `[${i}] persona=${c.persona_id} archetype=${c.archetype_id} cluster=${c.cultural_cluster} final_star=${c.final_star} nps=${c.nps} (deviation ${c.deviation} from cluster avg) | review_title="${(c.review_title || '').substring(0,80)}" review_body_head="${(c.review_body || '').substring(0, 200).replace(/\n/g, ' ')}"`).join('\n')}

OUTPUT JSON:
{
  "anomalies": [
    {
      "persona_id": "...",
      "expected_star_band": "...",
      "actual_star": number,
      "classification": "legitimate_edge_case | model_drift | calibration_miss",
      "evidence": ["1-3 quotes from the review/trace that justify the classification"],
      "action": "include_as_signal | flag_for_regen | downweight_in_aggregates"
    }
  ],
  "model_drift_rate": 0-1,
  "calibration_miss_rate": 0-1,
  "recommended_regens": ["persona_id list where a regen is recommended"]
}

If model_drift_rate > 0.08 or calibration_miss_rate > 0.05, the orchestrator will block client release. Be honest — these are not decorative numbers.`;
  return await callAIJSON(prompt, { maxTokens: 1800, temperature: 0.3 });
}

// ────────────────────────────── PASS 4 ──────────────────────────────

async function passAdversarial({ aggregate, diverge, anomaly, calibration, property }) {
  const topPositive = calibration?.top_positive_themes || [];
  const topNegative = calibration?.top_negative_themes || [];
  const realDist = calibration?.star_distribution_pct || {};
  const expectedMix = property?.data_json?.archetype_mix_expected_pct
    || calibration?.archetype_mix_expected_pct
    || {};
  const realAvg = calibration?.avg_rating ?? null;

  const insightsToAudit = [];
  for (const c of (aggregate?.clusters || []).slice(0, 20)) {
    insightsToAudit.push({
      id: `cluster_${c.cluster_id}`,
      kind: 'cluster_chain',
      text: `Cluster ${c.cluster_id} (n=${c.n}, nps=${c.avg_nps}): chain ${(c.dominant_chain || []).map(s => s.stage_or_moment).join(' → ')}. Confidence ${c.chain_confidence}.`,
      top_positive: c.top_positive_verbatim || [],
      top_negative: c.top_negative_verbatim || [],
    });
  }
  for (const d of (diverge?.divergence_points || []).slice(0, 10)) {
    insightsToAudit.push({
      id: `diverge_${d.cluster_a}_vs_${d.cluster_b}`,
      kind: 'divergence',
      text: `${d.cluster_a} vs ${d.cluster_b}: splits at ${d.shared_path_until} on ${d.dimension_of_divergence}. ${d.interpretation}`,
      actionable: !!d.actionable,
    });
  }

  if (insightsToAudit.length === 0) {
    return { audited_insights: [], calibration_drift_detected: false, blocked_insights: [], overall_report_trustworthiness: 0.5 };
  }

  const prompt = `You are a hostile Meliá CRO analyst. Your job is to find reasons NOT to trust each insight. Apply these six attacks and report which pass/fail:

A) ECHO IN REALITY: does the theme appear in property.top_positive_themes (${JSON.stringify(topPositive.slice(0, 8))}) or top_negative_themes (${JSON.stringify(topNegative.slice(0, 8))})? If absent, simulation artifact — reduce.
B) EXPECTED MIX: is the segment over-represented vs archetype_mix_expected_pct (${JSON.stringify(expectedMix)})? If cluster is 40% of reviews but real mix is 14%, inflated.
C) INTERNAL COUNTER-EVIDENCE: any internal traces contradict the insight? If >20% of cluster traces don't support it, weak.
D) MECHANISM vs CORRELATION: does the insight name a concrete mechanism (SOP/timing/fixture) or just a pattern? Without mechanism, not actionable.
E) CULTURAL DIAGONAL: would the same insight hold if a different cultural cluster experienced the same adversarial event? If not, probably model voice artifact.
F) CALIBRATION DEVIATION: does the insight push outcome away from real star_distribution_pct (${JSON.stringify(realDist)}) or real avg_rating (${realAvg}★) by more than 15pp/0.5★? If yes, drift risk.

INSIGHTS TO AUDIT:
${insightsToAudit.map(i => `[${i.id}] (${i.kind}) ${i.text}${i.top_positive ? ` | pos: ${JSON.stringify(i.top_positive)}` : ''}${i.top_negative ? ` | neg: ${JSON.stringify(i.top_negative)}` : ''}`).join('\n')}

ANOMALY SIGNALS (feed forward): model_drift_rate=${anomaly?.model_drift_rate ?? 0}, calibration_miss_rate=${anomaly?.calibration_miss_rate ?? 0}.

OUTPUT JSON:
{
  "audited_insights": [
    {
      "original_insight_id": "...",
      "attacks_passed": ["A", "B", ...],
      "attacks_failed": [{"attack": "...", "detail": "..."}],
      "confidence_adjustment": -1 to +0.1,
      "survives_audit": true/false,
      "recommended_framing": "how to present to client (hedge if partial survival)"
    }
  ],
  "calibration_drift_detected": true/false,
  "calibration_drift_magnitude_pp": number,
  "blocked_insights": ["ids that should NOT ship to client"],
  "overall_report_trustworthiness": 0-1
}

If overall_report_trustworthiness < 0.6, the orchestrator blocks client release. Do not inflate — a Meliá CRO will spot NPS+100 or fabricated friction rates in 30 seconds.`;
  return await callAIJSON(prompt, { maxTokens: 2400, temperature: 0.3 });
}

// ────────────────────────────── helpers ──────────────────────────────

function toCompactTrace(record) {
  const persona = record.persona_full || record.persona || {};
  const cultural = record.cultural_context || {};
  const sensation = record.sensation_summary || {};
  const review = record.predicted_review || {};
  const tension = record.tension_resolution || null;

  // Compact top deltas — only non-zero aggregate deltas.
  const final = record.final_sensation_state || {};
  const topDeltas = Object.entries(final)
    .filter(([k, v]) => !k.startsWith('_') && typeof v === 'number')
    .sort((a, b) => Math.abs(b[1] - 50) - Math.abs(a[1] - 50))
    .slice(0, 5)
    .reduce((acc, [k, v]) => { acc[k] = Math.round(v); return acc; }, {});

  const posMoments = [];
  const negMoments = [];
  for (const s of (record.stages || [])) {
    for (const m of (s.moments_positive || [])) posMoments.push(typeof m === 'string' ? m : (m.description || ''));
    for (const m of (s.moments_negative || [])) negMoments.push(typeof m === 'string' ? m : (m.description || ''));
  }

  return {
    persona_id: persona.name || record.persona_id || 'anon',
    archetype_id: persona.archetype_id || persona._archetype_id || 'unknown',
    cultural_cluster: cultural.culture_cluster || 'unknown',
    final_star: sensation.stars ?? null,
    nps: sensation.nps ?? null,
    top_deltas: topDeltas,
    pos: posMoments.slice(0, 3).map(m => String(m).substring(0, 140)),
    neg: negMoments.slice(0, 3).map(m => String(m).substring(0, 140)),
    adv_events: (record.adversarial_events || []).map(e => e.event_id || e.id).filter(Boolean).slice(0, 4),
    complaint_channel: persona.complaint_channel_preferred || 'unknown',
    action_chosen: tension?.action_chosen || null,
    review_title: review.title || null,
    review_body: review.body || null,
  };
}

function sampleTraces(traces, max) {
  if (traces.length <= max) return traces;
  // Stratified sample across cluster keys so each cluster sends at least one.
  const buckets = {};
  for (const t of traces) {
    const k = `${t.archetype_id}|${t.cultural_cluster}|${t.final_star}`;
    if (!buckets[k]) buckets[k] = [];
    buckets[k].push(t);
  }
  const out = [];
  const keys = Object.keys(buckets);
  const perBucket = Math.max(1, Math.floor(max / keys.length));
  for (const k of keys) {
    for (const t of buckets[k].slice(0, perBucket)) out.push(t);
    if (out.length >= max) break;
  }
  return out.slice(0, max);
}

module.exports = {
  runInsightsEngine,
};
