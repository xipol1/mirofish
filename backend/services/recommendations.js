/**
 * Recommendation Engine — converts insights into specific, actionable changes.
 *
 * Pipeline:
 *   1. Match insights+metrics against recommendation_templates.json (pattern matching)
 *   2. Instantiate matching templates with specifics (fills in {placeholders})
 *   3. LLM validation pass: specificity, dedup, ranking
 */

const path = require('path');
const fs = require('fs');
const { callAIJSON } = require('./ai');
const industries = require('./industries');

function loadTemplates(industrySlug = 'default') {
  return industries.getRecommendationTemplates(industrySlug) || {};
}

// ──────────────────────────────────────────────────────────────
// STEP 1: Match templates to insights+metrics
// ──────────────────────────────────────────────────────────────

function matchTemplates({ metrics, insights, scenario, audienceVector, taskType, industrySlug = 'default' }) {
  const templates = loadTemplates(industrySlug);
  const matched = [];

  // --- trust_gap_no_social_proof ---
  if (metrics.trust_score < 0.5 ||
      (insights.trust_summary?.top_missing_signals || []).some(s => /social proof|testimonial|logo|review|case study/i.test(s))) {
    matched.push({ key: 'trust_gap_no_social_proof', template: templates.trust_gap_no_social_proof });
  }

  // --- trust_gap_no_security_compliance ---
  const isEnterprise = audienceVector.budget_authority === 'executive' || audienceVector.budget_authority === 'department';
  const needsCompliance = ['saas', 'fintech', 'healthcare'].includes(audienceVector.vertical);
  const noCompliance = !(scenario?.trust_markers?.compliance_mentions || []).length &&
                       !(scenario?.trust_signals || []).some(s => /soc|gdpr|hipaa|iso/i.test(s));
  if (needsCompliance && isEnterprise && noCompliance) {
    matched.push({ key: 'trust_gap_no_security_compliance', template: templates.trust_gap_no_security_compliance });
  }

  // --- pricing_paralysis ---
  const pricingFriction = Object.entries(metrics.friction_density || {})
    .find(([k]) => /pricing/i.test(k));
  if ((pricingFriction && pricingFriction[1] > 1.0) ||
      (insights.patterns || []).some(p => /choice.{1,10}paralysis|confus|middle.{1,10}tier|decoy/i.test(p.pattern || ''))) {
    matched.push({ key: 'pricing_paralysis', template: templates.pricing_paralysis });
  }

  // --- pricing_hidden_or_contact_sales ---
  if (scenario?.pricing?.visible === false ||
      (scenario?.pricing?.tiers || []).some(t => /contact|call|talk/i.test(t.price || ''))) {
    matched.push({ key: 'pricing_hidden_or_contact_sales', template: templates.pricing_hidden_or_contact_sales });
  }

  // --- clarity_gap_hero ---
  const heroRetention = (metrics.attention_decay || []).find(a => a.section === 'hero')?.retention ?? 1;
  if (heroRetention < 0.7 ||
      (insights.patterns || []).some(p => /generic|vague|abstract.{1,15}hero|transformation/i.test(p.pattern || ''))) {
    matched.push({ key: 'clarity_gap_hero', template: templates.clarity_gap_hero });
  }

  // --- clarity_gap_features_generic ---
  const featureFriction = Object.entries(metrics.friction_density || {})
    .find(([k]) => /feature/i.test(k));
  if ((featureFriction && featureFriction[1] > 0.7) ||
      (insights.patterns || []).some(p => /vague.{1,10}value|generic.{1,10}feature|unclear.{1,10}benefit/i.test(p.pattern || ''))) {
    matched.push({ key: 'clarity_gap_features_generic', template: templates.clarity_gap_features_generic });
  }

  // --- cta_friction ---
  const ctaRetention = (metrics.attention_decay || []).find(a => /cta/i.test(a.section))?.retention ?? 1;
  if (ctaRetention < 0.5 ||
      (insights.patterns || []).some(p => /cta.{1,10}unclear|call.{1,10}action.{1,10}miss/i.test(p.pattern || ''))) {
    matched.push({ key: 'cta_friction', template: templates.cta_friction });
  }

  // --- objection_unhandled ---
  if (metrics.objection_coverage < 0.6 && (metrics.top_objections || []).length > 0) {
    matched.push({ key: 'objection_unhandled', template: templates.objection_unhandled });
  }

  // --- message_mismatch_ad_to_page (marketing_campaign specific) ---
  if (taskType === 'marketing_campaign') {
    const adjacent = (metrics.segment_outcomes || {}).adjacent_curious;
    if (adjacent && adjacent.total > 0 && adjacent.bounced / adjacent.total > 0.5) {
      matched.push({ key: 'message_mismatch_ad_to_page', template: templates.message_mismatch_ad_to_page });
    }
  }

  // --- onboarding_forced_friction ---
  if (taskType === 'onboarding' &&
      (insights.patterns || []).some(p => /forced|credit.{1,10}card|too many.{1,10}steps/i.test(p.pattern || ''))) {
    matched.push({ key: 'onboarding_forced_friction', template: templates.onboarding_forced_friction });
  }

  // --- feature_switching_cost_unaddressed ---
  if (taskType === 'feature_validation' &&
      (insights.patterns || []).some(p => /switching.{1,10}cost|migration|already.{1,10}use/i.test(p.pattern || ''))) {
    matched.push({ key: 'feature_switching_cost_unaddressed', template: templates.feature_switching_cost_unaddressed });
  }

  // ─────────── HOSPITALITY-specific triggers ───────────
  if (industrySlug === 'hospitality') {
    const patternText = (insights.patterns || []).map(p => p.pattern || '').join(' ').toLowerCase();

    // Hidden fees (resort/parking/breakfast)
    if (/resort fee|parking|hidden|surprise charge|surcharge|nightly fee/i.test(patternText) ||
        (metrics.top_objections || []).some(o => /fee|charge|surprise|tax/i.test(o.objection || ''))) {
      matched.push({ key: 'hosp_hidden_fees', template: templates.hosp_hidden_fees });
    }

    // Loyalty rate not auto-applied
    if (/member rate|loyalty|not logged|rewards/i.test(patternText)) {
      matched.push({ key: 'hosp_member_rate_not_auto_applied', template: templates.hosp_member_rate_not_auto_applied });
    }

    // Family room clarity
    if (/family|connecting room|bed config|kids club/i.test(patternText)) {
      matched.push({ key: 'hosp_family_room_clarity', template: templates.hosp_family_room_clarity });
    }

    // Mobile booking friction
    if ((metrics.mobile_vs_desktop_conversion && metrics.mobile_vs_desktop_conversion < 0.6) ||
        /mobile|calendar|tiny/i.test(patternText)) {
      matched.push({ key: 'hosp_mobile_booking_friction', template: templates.hosp_mobile_booking_friction });
    }

    // Rate parity
    if (/ota|rate parity|booking\.com|expedia|direct cheaper/i.test(patternText)) {
      matched.push({ key: 'hosp_rate_parity', template: templates.hosp_rate_parity });
    }

    // Brand dilution (luxury)
    if (/brand|dilute|cheapen|premium|mixing/i.test(patternText)) {
      matched.push({ key: 'hosp_luxury_brand_dilution', template: templates.hosp_luxury_brand_dilution });
    }

    // WiFi/workspace disclosure
    if (/wifi|workspace|desk|remote work/i.test(patternText)) {
      matched.push({ key: 'hosp_wifi_workspace_disclosure', template: templates.hosp_wifi_workspace_disclosure });
    }

    // Cancellation timezone
    if (/cancellation|timezone|deadline/i.test(patternText)) {
      matched.push({ key: 'hosp_cancellation_timezone_clarity', template: templates.hosp_cancellation_timezone_clarity });
    }

    // Upsell cadence
    if (/upsell|spam|too many emails/i.test(patternText)) {
      matched.push({ key: 'hosp_upsell_cadence', template: templates.hosp_upsell_cadence });
    }

    // Portfolio navigation (sub-brand confusion)
    if (/sub.?brand|portfolio|meliá.{0,40}vs|gran meliá|paradisus/i.test(patternText)) {
      matched.push({ key: 'hosp_portfolio_navigation', template: templates.hosp_portfolio_navigation });
    }
  }

  // Filter out any matches whose template doesn't exist in the active industry pack
  return matched.filter(m => m.template != null);
}

// ──────────────────────────────────────────────────────────────
// STEP 2: Instantiate templates with specifics
// ──────────────────────────────────────────────────────────────

function instantiate({ matched, metrics, scenario, audienceVector, insights }) {
  const instantiated = [];

  const topObjection = metrics.top_objections?.[0]?.objection || 'their primary concern';
  const topObjections = (metrics.top_objections || []).slice(0, 3).map(o => o.objection).join(', ') || 'top objections';
  const currentHeadline = scenario?.hero?.headline || '(current headline)';
  const currentCTA = scenario?.hero?.cta_text || '(current CTA)';
  const tierCount = (scenario?.pricing?.tiers || []).length || 3;
  const competitor = '(top competitor)';
  const productName = scenario?.site_name || scenario?.title?.split(/[|—\-]/)[0]?.trim() || 'your product';
  const currentSteps = '(current number of)';

  const replacements = {
    '{vertical}': audienceVector.vertical,
    '{company_size}': audienceVector.company_size,
    '{top_objection}': topObjection,
    '{top_objections}': topObjections,
    '{current_headline}': currentHeadline,
    '{current_cta}': currentCTA,
    '{current_tier_count}': String(tierCount),
    '{competitor}': competitor,
    '{your_product}': productName,
    '{current_steps}': currentSteps,
  };

  for (const { key, template } of matched) {
    for (const action of template.actions) {
      const filledAction = fillPlaceholders(action.action, replacements);
      instantiated.push({
        problem_key: key,
        severity: template.severity_default,
        action: filledAction,
        effort: action.effort,
        impact_range: action.impact_range,
        tradeoff: fillPlaceholders(action.tradeoff, replacements),
        evidence_hook: buildEvidence(key, metrics, insights),
      });
    }
  }

  return instantiated;
}

function fillPlaceholders(str, replacements) {
  if (!str) return str;
  let result = str;
  for (const [k, v] of Object.entries(replacements)) {
    result = result.split(k).join(v);
  }
  return result;
}

function buildEvidence(problemKey, metrics, insights) {
  const evidenceMap = {
    trust_gap_no_social_proof: `trust_score=${metrics.trust_score}; ${(insights.trust_summary?.top_missing_signals || []).slice(0, 2).join(' + ')}`,
    trust_gap_no_security_compliance: `Enterprise buyers in this segment require visible compliance badges; none detected.`,
    pricing_paralysis: `friction_density.pricing=${metrics.friction_density?.pricing || 'N/A'}; ${metrics.segment_divergence ? `segment_divergence=${metrics.segment_divergence}` : ''}`,
    pricing_hidden_or_contact_sales: `Pricing not visible on page; ${metrics.bounced}/${metrics.total_agents} agents bounced citing price opacity.`,
    clarity_gap_hero: `Hero retention: ${Math.round(((metrics.attention_decay || []).find(a => a.section === 'hero')?.retention || 1) * 100)}%.`,
    clarity_gap_features_generic: `Agents described features as too generic; friction_density in features section present.`,
    cta_friction: `CTA retention below 50%; conversion_rate=${metrics.conversion_rate}%.`,
    objection_unhandled: `objection_coverage=${metrics.objection_coverage}; top unresolved: ${(metrics.top_objections || []).slice(0, 2).map(o => o.objection).join(', ')}.`,
    message_mismatch_ad_to_page: `Adjacent-curious archetype bouncing at above-average rate.`,
    onboarding_forced_friction: `Agents flagged forced setup / card requirement as friction.`,
    feature_switching_cost_unaddressed: `Current-tool-defender archetype did not convert; migration path not addressed.`,
  };
  return evidenceMap[problemKey] || 'See insights for evidence.';
}

// ──────────────────────────────────────────────────────────────
// STEP 3: Validation + dedup + ranking (LLM pass)
// ──────────────────────────────────────────────────────────────

async function validateAndRank({ instantiated, insights, metrics, goal }) {
  if (!instantiated.length) {
    return fallbackRecommendations(metrics, insights);
  }

  const prompt = `You are a conversion optimization expert. Review, dedupe, and rank these candidate recommendations.

=== CANDIDATE RECOMMENDATIONS ===
${JSON.stringify(instantiated, null, 2)}

=== CONTEXT ===
Headline insight: ${insights.headline || 'n/a'}
Goal stated by owner: ${goal || 'not specified'}
Metrics snapshot: conversion_rate=${metrics.conversion_rate}%, trust_score=${metrics.trust_score}, confidence=${metrics.confidence_score}

=== YOUR JOB ===
1. REMOVE duplicates or near-duplicates (keep the most specific/high-impact version).
2. VERIFY each is specific enough that a developer could ship it today. If vague, rewrite to be specific OR drop it.
3. Compute a numeric "estimated_impact" (midpoint of impact_range, or custom if you can justify).
4. Compute a numeric "confidence" (0-1) based on evidence strength.
5. Return the TOP 5 recommendations (or fewer if fewer justified), ranked by (estimated_impact * confidence) / effort_cost.

Effort cost mapping: quick_fix=1, medium=3, major_change=10.

Return JSON array, exactly ranked (priority 1 first):
[
  {
    "priority": 1,
    "action": "specific action a developer can ship today",
    "evidence": "one sentence referencing specific metrics",
    "expected_impact": "+X-Y% on conversion (or 'N/A: qualitative only')",
    "confidence": "high" | "medium" | "low",
    "confidence_reason": "one sentence justifying the confidence level",
    "effort": "quick_fix" | "medium" | "major_change",
    "tradeoff": "the main downside or risk",
    "alternative": "optional: a lower-effort or lower-risk alternative to this action, or null"
  }
]`;

  try {
    const validated = await callAIJSON(prompt, { maxTokens: 3000, temperature: 0.25 });
    if (!Array.isArray(validated)) throw new Error('Validation output not an array');
    return validated.slice(0, 5);
  } catch (err) {
    console.error('[recommendations] validation failed:', err.message.substring(0, 120));
    // Fallback: return first 5 instantiated, ranked by simple heuristic
    const ranked = instantiated
      .map((r, i) => ({
        priority: i + 1,
        action: r.action,
        evidence: r.evidence_hook,
        expected_impact: `+${r.impact_range[0]}-${r.impact_range[1]}%`,
        confidence: 'medium',
        confidence_reason: 'Pattern match without LLM validation.',
        effort: r.effort,
        tradeoff: r.tradeoff,
        alternative: null,
      }))
      .slice(0, 5);
    return ranked;
  }
}

function fallbackRecommendations(metrics, insights) {
  return [
    {
      priority: 1,
      action: `Review the ${metrics.bounced}/${metrics.total_agents} agent reasonings and identify the most common friction point to address next.`,
      evidence: `No specific template matched current metrics.`,
      expected_impact: 'N/A: qualitative only',
      confidence: 'low',
      confidence_reason: 'No strong pattern triggered.',
      effort: 'medium',
      tradeoff: 'Requires manual interpretation.',
      alternative: null,
    },
  ];
}

// ──────────────────────────────────────────────────────────────
// Entry point
// ──────────────────────────────────────────────────────────────

async function generateRecommendations({ insights, metrics, scenario, audienceVector, taskType, goal, industrySlug = 'default' }) {
  const matched = matchTemplates({ metrics, insights, scenario, audienceVector, taskType, industrySlug });
  const instantiated = instantiate({ matched, metrics, scenario, audienceVector, insights });
  const ranked = await validateAndRank({ instantiated, insights, metrics, goal });
  return ranked;
}

module.exports = { generateRecommendations };
