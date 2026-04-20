/**
 * Confidence Scorer — Entregable 6
 *
 * Scores individual insights (insight-level trust). Distinct from
 * confidence-intervals.js, which bootstraps CIs for cohort metrics.
 *
 *   confidenceScore(insight, ctx)  → { score, base, multiplier, label, gate }
 *   scoreConsistency(cluster)      → calls LLM, returns consistency_score 0-1
 *   scoreHomogenization(reviews)   → calls LLM, returns homogenization_score 0-1
 *
 * Formula:
 *   base = segment_pct*0.35 + reasoning_consistency*0.20 +
 *          (log(n)/log(50))*0.15 + calibration_match*0.30
 *   multiplier penalties:
 *     single archetype           ×0.85
 *     single cultural cluster    ×0.90
 *     mild homogenization (>0.6) ×0.90
 *     severe homogenization(>0.85) ×0.80
 *     adversarial contradicts    ×0.80
 *     n<5  ×0.75, n<3 ×0.60
 *     calibration drift >15pp ×0.80, >25pp ×0.60
 *
 *   gate: "show_to_client" if score >= 0.55 else "internal_only".
 */

const { callAIJSON } = require('../ai');

function confidenceScore(insight) {
  const m = insight?.metrics || {};
  const segment_pct          = clamp01(m.segment_pct);
  const reasoning_consistency= clamp01(m.reasoning_consistency);
  const n                    = Math.max(0, Number(m.n) || 0);
  const calibration_match    = clamp01(m.calibration_match);
  const cluster_breadth      = Math.max(1, Number(m.cluster_breadth) || 1);
  const cultural_breadth     = Math.max(1, Number(m.cultural_breadth) || 1);
  const homogenization_score = clamp01(m.homogenization_score);
  const adversarial_contradicts = !!m.adversarial_contradicts;
  const calibration_drift_pp = Math.max(0, Number(m.calibration_drift_pp) || 0);

  const nFactor = n > 0 ? Math.log(Math.max(n, 1)) / Math.log(50) : 0;

  const base = segment_pct * 0.35
             + reasoning_consistency * 0.20
             + nFactor * 0.15
             + calibration_match * 0.30;

  let multiplier = 1.0;
  if (cluster_breadth <= 1)            multiplier *= 0.85;
  if (cultural_breadth <= 1)           multiplier *= 0.90;
  if (homogenization_score > 0.6)      multiplier *= 0.90;
  if (homogenization_score > 0.85)     multiplier *= 0.80;
  if (adversarial_contradicts)         multiplier *= 0.80;
  if (n < 5)                           multiplier *= 0.75;
  if (n < 3)                           multiplier *= 0.60;
  if (calibration_drift_pp > 15)       multiplier *= 0.80;
  if (calibration_drift_pp > 25)       multiplier *= 0.60;

  const score = Math.max(0, Math.min(1, base * multiplier));

  return {
    score: Number(score.toFixed(3)),
    base: Number(base.toFixed(3)),
    multiplier: Number(multiplier.toFixed(3)),
    label: score >= 0.75 ? 'high'
         : score >= 0.55 ? 'medium'
         : score >= 0.35 ? 'low'
         : 'reject',
    gate: score >= 0.55 ? 'show_to_client' : 'internal_only',
  };
}

function clamp01(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

// ────────────────────────────── LLM helpers ──────────────────────────────

async function scoreConsistency({ clusterId, traces }) {
  if (!Array.isArray(traces) || traces.length < 2) {
    return { consistency_score: 0.5, verdict: 'insufficient_n', _n: traces?.length || 0 };
  }
  try {
    const sample = traces.slice(0, 12);
    const prompt = `Evaluate whether the following traces tell THE SAME STORY or merely arrive at the same outcome through incompatible paths. Accidental agreement is not a consistent cluster.

CLUSTER ID: ${clusterId}

TRACES:
${sample.map((t, i) => `[${i}] persona=${t.persona_id} nps=${t.nps} final=${t.final_star}★
   positives: ${JSON.stringify((t.pos || []).slice(0, 3))}
   negatives: ${JSON.stringify((t.neg || []).slice(0, 3))}
   top_deltas: ${JSON.stringify(t.top_deltas || {})}
   review_head: "${(t.review_body || '').substring(0, 160)}"`).join('\n')}

Assess:
1. Shared critical moments: do >=60% of traces cite the same 1-3 peak/valley moments?
2. Sensation trajectory: do the dominant moving dimensions match in sign + magnitude order in >=60%?
3. Narrative coherence: do the review bodies express compatible stories (even with different vocabulary)?
4. Causal sequence: does the order of sensation changes roughly align?

OUTPUT JSON:
{
  "consistency_score": 0-1,
  "shared_critical_moments": ["moments present in >=60% of traces"],
  "dissonant_subgroup": {"n": number, "reason": "..."} | null,
  "narrative_coherence": "high | mixed | incoherent",
  "causal_sequence_alignment": 0-1,
  "verdict": "consistent_cluster | heterogeneous_cluster | accidental_grouping"
}`;
    const r = await callAIJSON(prompt, { maxTokens: 900, temperature: 0.3 });
    return r;
  } catch (err) {
    console.error('[confidence-scorer] consistency failed:', err.message?.substring(0, 140));
    return { consistency_score: 0.5, verdict: 'error', _error: err.message?.substring(0, 120) };
  }
}

async function scoreHomogenization({ reviews }) {
  if (!Array.isArray(reviews) || reviews.length < 3) {
    return { homogenization_score: 0, verdict: 'insufficient_n' };
  }
  try {
    const sample = reviews.slice(0, 24);
    const prompt = `Detect whether these reviews sound like N different people writing, or ONE voice ventriloquizing N labels. The product's value depends on voice diversity — homogenization is a critical failure.

REVIEWS (title + head):
${sample.map((r, i) => `[${i}] cluster=${r.cultural_cluster || '?'} style=${r.identity_style || '?'} platform=${r.platform || '?'} (${(r.body || '').split(/\s+/).length} words)
   title: "${(r.title || '').substring(0, 90)}"
   head:  "${(r.body || '').substring(0, 220).replace(/\n/g, ' ')}"`).join('\n')}

Heuristics to check:
1. Bigram/trigram overlap across pairs — high overlap = low voice diversity.
2. Word-count variance — if σ/μ < 0.25 the cohort is suspiciously uniform.
3. Opening and closing phrase distribution — do most start with "Great stay" / "Wonderful experience"?
4. Cultural signature presence — do german_dach reviews read different from latin? If not, culture isn't landing.
5. Identity-style signature — did value_auditor cite prices? Did connoisseur_comparing name a peer property?
6. Human imperfections — are there ANY typos, half-retracts, natural hedges?

OUTPUT JSON:
{
  "homogenization_score": 0-1,
  "bigram_jaccard_avg_est": 0-1,
  "length_cv": number,
  "opening_phrase_hotspots": ["phrase", ...],
  "closing_phrase_hotspots": ["phrase", ...],
  "cultural_signature_presence_rate": 0-1,
  "identity_style_signature_rate": 0-1,
  "imperfection_rate": 0-1,
  "verdict": "diverse_voices | mild_homogenization | severe_collapse",
  "worst_offender_indices": [index numbers from the list above]
}

If severe_collapse (score > 0.85), the orchestrator relaunches worst_offenders with temperature +0.12.`;
    const r = await callAIJSON(prompt, { maxTokens: 900, temperature: 0.3 });
    return r;
  } catch (err) {
    console.error('[confidence-scorer] homogenization failed:', err.message?.substring(0, 140));
    return { homogenization_score: 0, verdict: 'error', _error: err.message?.substring(0, 120) };
  }
}

/**
 * Compute a simple calibration_match score comparing a cluster's themes
 * against the property calibration's top_positive_themes / top_negative_themes.
 * Returns 0-1 (Jaccard-like, lenient normalization).
 */
function calibrationMatchScore(clusterThemes, calibration) {
  const topPos = new Set((calibration?.top_positive_themes || []).map(normalizeTheme));
  const topNeg = new Set((calibration?.top_negative_themes || []).map(normalizeTheme));
  const total = topPos.size + topNeg.size;
  if (!total) return 0.5;
  const cluster = (clusterThemes || []).map(normalizeTheme);
  let hits = 0;
  for (const t of cluster) if (topPos.has(t) || topNeg.has(t)) hits += 1;
  const denom = Math.max(1, Math.min(cluster.length, total));
  return Math.max(0, Math.min(1, hits / denom));
}

function normalizeTheme(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '');
}

module.exports = {
  confidenceScore,
  scoreConsistency,
  scoreHomogenization,
  calibrationMatchScore,
};
