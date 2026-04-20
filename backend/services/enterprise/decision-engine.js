/**
 * Decision Engine — Entregable 7
 *
 * Converts audited insights into actionable recommendation cards. Runs after
 * insights-engine (phase 7 of the orchestrator). Classifies each insight into
 * one of five hospitality levers, generates 2-3 actions per insight at
 * different effort levels, ranks by impact × confidence × reversibility, and
 * surfaces conflicts as explicit "forks" with trade-off resolution.
 *
 * Output schema matches the recommendation card UI.
 * Gated by ENABLE_INSIGHTS_V2=true (since it depends on insights-engine output).
 * Fail-open: returns { recommendations: [], forks: [] } on error.
 */

const { callAIJSON } = require('../ai');

async function runDecisionEngine({ insights, calibration, property, audience_vector, user_goal }) {
  try {
    if (!insights || insights.ready_for_client === false) {
      return {
        enabled: true,
        ready: false,
        reason: 'insights_not_ready_for_client',
        recommendations: [],
        forks: [],
      };
    }

    const auditedSurviving = (insights?.passes?.adversarial?.audited_insights || [])
      .filter(a => a.survives_audit !== false);

    if (auditedSurviving.length === 0) {
      return {
        enabled: true,
        ready: false,
        reason: 'no_surviving_insights',
        recommendations: [],
        forks: [],
      };
    }

    const clusters = insights?.passes?.aggregate?.clusters || [];
    const divergences = insights?.passes?.diverge?.divergence_points || [];

    const prompt = buildPrompt({ auditedSurviving, clusters, divergences, calibration, property, user_goal });
    const result = await callAIJSON(prompt, { maxTokens: 3000, temperature: 0.5 });
    return normalize(result);
  } catch (err) {
    console.error('[decision-engine] failed:', err.message?.substring(0, 140));
    return { enabled: true, ready: false, reason: err.message?.substring(0, 120), recommendations: [], forks: [] };
  }
}

function buildPrompt({ auditedSurviving, clusters, divergences, calibration, property, user_goal }) {
  const propertyName = property?.name || property?.data_json?.identity?.name || 'this property';
  const propertyTier = (property?.data_json?.identity?.tier || property?.tier || 'luxury').toLowerCase();
  const topPositive = (calibration?.top_positive_themes || []).slice(0, 8);
  const topNegative = (calibration?.top_negative_themes || []).slice(0, 8);
  const avgRating = calibration?.avg_rating ?? null;

  return `You are turning audited cohort insights into actionable hospitality recommendations. The client is ${propertyName} (${propertyTier}${avgRating ? `, ${avgRating}★ real` : ''}). The user goal is: "${user_goal || 'improve NPS, star rating, and ancillary revenue'}".

Hospitality levers (choose exactly ONE per recommendation):
- operational_sop      — staff timing, coordination, sensors, process
- product_physical     — fixture, amenity, room design, F&B menu
- loyalty_program      — tier recognition, points crediting, ambassador touches
- pricing_revenue      — rate parity, resort fees, upsell framing
- marketing_positioning — segmentation, platform choice, expectation-setting

Effort levels: quick_fix_30d (SOP/training only), moderate_90d (low-mid capex, 1-2 depts), strategic_6mo (high capex, cross-dept or cross-property).

Ranking = impact × confidence × reversibility × (1 / effort_months_equivalent).

CALIBRATION ANCHOR (all recommendations must echo real review reality):
- Top POSITIVE themes in real reviews: ${JSON.stringify(topPositive)}
- Top NEGATIVE / friction themes: ${JSON.stringify(topNegative)}

AUDITED INSIGHTS (already survived adversarial pass):
${auditedSurviving.map((a, i) => `[${i}] ${a.original_insight_id} | framing: "${a.recommended_framing || '(none)'}" | attacks_passed: ${JSON.stringify(a.attacks_passed || [])} | attacks_failed: ${JSON.stringify((a.attacks_failed || []).map(f => f.attack))}`).join('\n')}

CLUSTER CONTEXT (for verbatim evidence — you MUST cite a quote from here per recommendation):
${clusters.slice(0, 10).map(c => `[${c.cluster_id}] n=${c.n} avg_nps=${c.avg_nps}
   pos: ${JSON.stringify((c.top_positive_verbatim || []).slice(0, 2))}
   neg: ${JSON.stringify((c.top_negative_verbatim || []).slice(0, 2))}`).join('\n')}

DIVERGENCES (for fork detection):
${divergences.slice(0, 6).map(d => `${d.cluster_a} vs ${d.cluster_b}: ${d.divergence_trigger} (actionable=${d.actionable})`).join('\n')}

Generate recommendations. For each audited insight, produce 2-3 actions across different effort_levels. EVERY recommendation MUST include at least one verbatim quote from the clusters above (evidence.verbatim_quote) AND one calibration_echo referencing a theme from top_positive_themes or top_negative_themes. If neither exists, SKIP that recommendation — do not fabricate evidence.

Detect forks: two top-ranked recommendations whose effects compete for the same resource or neutralize each other. Resolve explicitly.

OUTPUT JSON (exact recommendation-card schema):
{
  "recommendations": [
    {
      "action": "imperative, <= 15 words",
      "confidence": 0-1,
      "confidence_label": "high | medium | low",
      "evidence": [
        {"type": "insight_ref", "insight_id": "..."},
        {"type": "verbatim_quote", "text": "exact quote", "persona_segment": "archetype|cultural"},
        {"type": "calibration_echo", "theme": "aligns with top_negative_themes[fb_slow_service]"}
      ],
      "expected_impact": {
        "primary_kpi": "avg_star | nps | repeat_intent | adr_upsell | complaint_rate",
        "delta": "+0.15★ | +11 NPS | etc.",
        "affected_segment": {"archetype": "...", "cultural_cluster": "...", "size_pct": number}
      },
      "lever": "operational_sop | product_physical | loyalty_program | pricing_revenue | marketing_positioning",
      "effort_level": "quick_fix_30d | moderate_90d | strategic_6mo",
      "effort_estimate": {"cost_eur_band": "<5k | 5k-30k | 30k-150k | >150k", "departments": ["front_office", "F&B", "housekeeping", "revenue"]},
      "tradeoff": "what you sacrifice — if truly none, say 'none detected' but check twice",
      "alternatives": [{"alt_action": "...", "when_to_prefer": "condition"}],
      "reversibility": 0-1,
      "conflicts_with_recommendation_ids": [],
      "client_facing_rationale": "1-2 sentences a hotel manager can read aloud to the team",
      "internal_risks": ["2-3 concrete ways it can go wrong"]
    }
  ],
  "forks": [
    {
      "fork_id": "...",
      "recommendation_a_id": "...", "recommendation_b_id": "...",
      "resource_or_effect_in_tension": "e.g. crowd_reduction_at_pool vs fb_revenue",
      "segments_affected_differently": [
        {"segment": "luxury_seeker|anglo_uk_ireland", "prefers": "A"},
        {"segment": "family_vacationer|latam", "prefers": "B"}
      ],
      "recommended_resolution": "A | B | hybrid | sequential(A_then_B)",
      "resolution_rationale": "1-3 sentences"
    }
  ],
  "top_3_by_impact_confidence": ["rec_id", "rec_id", "rec_id"],
  "top_3_quickest_wins": ["rec_id", "rec_id", "rec_id"]
}`;
}

function normalize(result) {
  if (!result || typeof result !== 'object') {
    return { enabled: true, ready: false, reason: 'empty_llm_result', recommendations: [], forks: [] };
  }
  const validLevers = ['operational_sop', 'product_physical', 'loyalty_program', 'pricing_revenue', 'marketing_positioning'];
  const validEffort = ['quick_fix_30d', 'moderate_90d', 'strategic_6mo'];

  const recommendations = Array.isArray(result.recommendations)
    ? result.recommendations.map((r, i) => ({
        rec_id: String(r.rec_id || `rec_${i}`),
        action: String(r.action || '').substring(0, 180),
        confidence: clamp01(r.confidence),
        confidence_label: ['high', 'medium', 'low'].includes(r.confidence_label) ? r.confidence_label : 'medium',
        evidence: Array.isArray(r.evidence) ? r.evidence.slice(0, 6) : [],
        expected_impact: r.expected_impact && typeof r.expected_impact === 'object' ? r.expected_impact : null,
        lever: validLevers.includes(r.lever) ? r.lever : 'operational_sop',
        effort_level: validEffort.includes(r.effort_level) ? r.effort_level : 'moderate_90d',
        effort_estimate: r.effort_estimate && typeof r.effort_estimate === 'object' ? r.effort_estimate : null,
        tradeoff: String(r.tradeoff || '').substring(0, 300),
        alternatives: Array.isArray(r.alternatives) ? r.alternatives.slice(0, 3) : [],
        reversibility: clamp01(r.reversibility),
        conflicts_with_recommendation_ids: Array.isArray(r.conflicts_with_recommendation_ids)
          ? r.conflicts_with_recommendation_ids.slice(0, 3).map(String)
          : [],
        client_facing_rationale: String(r.client_facing_rationale || '').substring(0, 400),
        internal_risks: Array.isArray(r.internal_risks) ? r.internal_risks.slice(0, 4).map(String) : [],
      }))
    : [];

  const forks = Array.isArray(result.forks)
    ? result.forks.slice(0, 5).map(f => ({
        fork_id: String(f.fork_id || 'fork'),
        recommendation_a_id: String(f.recommendation_a_id || ''),
        recommendation_b_id: String(f.recommendation_b_id || ''),
        resource_or_effect_in_tension: String(f.resource_or_effect_in_tension || '').substring(0, 200),
        segments_affected_differently: Array.isArray(f.segments_affected_differently)
          ? f.segments_affected_differently.slice(0, 4)
          : [],
        recommended_resolution: String(f.recommended_resolution || 'hybrid').substring(0, 60),
        resolution_rationale: String(f.resolution_rationale || '').substring(0, 400),
      }))
    : [];

  return {
    enabled: true,
    ready: true,
    recommendations,
    forks,
    top_3_by_impact_confidence: Array.isArray(result.top_3_by_impact_confidence)
      ? result.top_3_by_impact_confidence.slice(0, 3).map(String)
      : [],
    top_3_quickest_wins: Array.isArray(result.top_3_quickest_wins)
      ? result.top_3_quickest_wins.slice(0, 3).map(String)
      : [],
  };
}

function clamp01(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0.5;
  return Math.max(0, Math.min(1, n));
}

module.exports = {
  runDecisionEngine,
};
