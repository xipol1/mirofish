/**
 * Insights Synthesizer — converts quantitative metrics + qualitative prose into
 * human-readable narrative insights.
 *
 * Numbers come from metrics.js (deterministic JS). The LLM's only job is to write
 * clear insight narratives that REFERENCE those numbers accurately.
 */

const { callAIJSON } = require('./ai');

async function generateInsights({ metrics, agentResults, scenario, taskType, personas }) {
  const personaSummaries = personas.map(p => ({
    name: p.name,
    archetype: p.archetype_label,
    outcome: agentResults.find(r => r._persona_name === p.name)?.outcome || 'unknown',
  }));

  const agentQuotes = agentResults.map(r => ({
    persona: r._persona_name,
    archetype: r._archetype_id,
    outcome: r.outcome,
    reason: r.outcome_reason,
    emotional_arc: r.emotional_arc,
    top_frictions: (r.friction_points || []).slice(0, 3),
    signals_missing: (r.trust_signals_missing || []).slice(0, 3),
  }));

  const prompt = `You are a senior UX researcher synthesizing behavioral insights from a targeted 3-archetype simulation.

=== GROUND-TRUTH METRICS (computed deterministically) ===
${JSON.stringify(metrics, null, 2)}

=== AGENT SUMMARIES ===
${JSON.stringify(agentQuotes, null, 2)}

=== TASK TYPE ===
${taskType}

=== SCENARIO SUMMARY ===
${(scenario?.hero?.headline) ? 'Hero: ' + scenario.hero.headline : ''}
Pricing visible: ${scenario?.pricing?.visible !== false}
Social proof present: ${scenario?.social_proof?.present !== false}

=== YOUR JOB ===
Write the insights narrative. Numbers MUST be cited accurately from the metrics above.

Rules:
- HEADLINE must quote a real metric.
- Each pattern must reference at least one specific metric value.
- DO NOT invent percentages; use the ones from the metrics object.
- When you say "X of 3 agents", check the actual count.

Return this JSON:
{
  "headline": "one punchy sentence with exact numbers from metrics (e.g., '2 of 3 archetypes bounced; the blocker is not price — it's missing social proof, as trust_score=0.32')",

  "patterns": [
    {
      "pattern": "description of what multiple agents experienced",
      "evidence": "reference specific metrics or quotes",
      "severity": "high" | "medium" | "low",
      "affected_archetypes": ["archetype ids that showed this"],
      "root_cause": "why it happened"
    }
  ],

  "friction_summary": {
    "total_friction_points": number (sum across agents),
    "worst_section": "section name with highest friction_density value",
    "description": "one sentence summary of where on the page things break"
  },

  "trust_summary": {
    "trust_score": number (copy from metrics),
    "top_missing_signals": ["list the top 3 from metrics.top_missing_signals"],
    "impact_sentence": "one sentence: how trust affected outcomes"
  },

  "segment_divergence_summary": {
    "divergence_score": number (copy from metrics.segment_divergence),
    "interpretation": "one sentence: do the archetypes agree or disagree, and what does that mean?",
    "per_archetype": [
      {"archetype": "archetype_id", "read": "one phrase about what this segment revealed"}
    ]
  },

  "top_objections_with_context": [
    {"objection": "copy from metrics", "count": number, "suggested_handling": "one concrete fix idea"}
  ],

  "confidence_note": "one sentence on confidence of these findings (reference metrics.confidence_score)"
}`;

  const result = await callAIJSON(prompt, { maxTokens: 3000, temperature: 0.25 });
  return result;
}

module.exports = { generateInsights };
