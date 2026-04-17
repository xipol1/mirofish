/**
 * Audience Decomposer — turns a free-text audience description into a structured vector.
 *
 * This vector drives pain-library retrieval, archetype selection, and prompt conditioning.
 */

const { callAIJSON } = require('./ai');

const VERTICALS = ['saas', 'b2c', 'ecommerce', 'fintech', 'healthcare', 'education', 'b2b_marketing', 'dev_tools', 'agency', 'media', 'other'];
const BUYING_STAGES = ['unaware', 'problem_aware', 'solution_aware', 'evaluating', 'ready_to_buy'];
const BUDGET_AUTHORITIES = ['none', 'team', 'department', 'executive'];

async function decomposeAudience(audienceText) {
  if (!audienceText || audienceText.trim().length === 0) {
    return defaultVector();
  }

  const prompt = `Parse this target audience description into a structured vector.

AUDIENCE: "${audienceText}"

Return JSON with these fields (use the enums strictly):

{
  "vertical": "one of: ${VERTICALS.join(', ')}",
  "role_archetype": "free-text but concise, e.g. 'VP of Product at mid-market SaaS'",
  "role_level": "one of: ic, manager, director, vp, executive, founder, consumer",
  "company_size": "one of: solo, 2-10, 10-50, 50-200, 200-1000, 1000+, not_applicable",
  "buying_stage": "one of: ${BUYING_STAGES.join(', ')}",
  "budget_authority": "one of: ${BUDGET_AUTHORITIES.join(', ')}",
  "geography": "region if mentioned, else 'unspecified'",
  "primary_pain_themes": ["2-4 concise pain themes this audience likely has"],
  "inferred_constraints": ["list of likely budget/time/tech constraints"],
  "key_signals_they_look_for": ["list of trust signals this audience will explicitly seek"]
}`;

  try {
    const result = await callAIJSON(prompt, { maxTokens: 800, temperature: 0.3 });
    // Guard against missing fields
    return {
      vertical: VERTICALS.includes(result.vertical) ? result.vertical : 'saas',
      role_archetype: result.role_archetype || 'unspecified',
      role_level: result.role_level || 'manager',
      company_size: result.company_size || 'unspecified',
      buying_stage: BUYING_STAGES.includes(result.buying_stage) ? result.buying_stage : 'evaluating',
      budget_authority: BUDGET_AUTHORITIES.includes(result.budget_authority) ? result.budget_authority : 'team',
      geography: result.geography || 'unspecified',
      primary_pain_themes: Array.isArray(result.primary_pain_themes) ? result.primary_pain_themes.slice(0, 5) : [],
      inferred_constraints: Array.isArray(result.inferred_constraints) ? result.inferred_constraints.slice(0, 5) : [],
      key_signals_they_look_for: Array.isArray(result.key_signals_they_look_for) ? result.key_signals_they_look_for.slice(0, 5) : [],
    };
  } catch (err) {
    console.error('[decomposer] fallback:', err.message.substring(0, 100));
    return defaultVector();
  }
}

function defaultVector() {
  return {
    vertical: 'saas',
    role_archetype: 'general SaaS buyer',
    role_level: 'manager',
    company_size: 'unspecified',
    buying_stage: 'evaluating',
    budget_authority: 'team',
    geography: 'unspecified',
    primary_pain_themes: ['need a better tool', 'cost concern', 'integration fit'],
    inferred_constraints: [],
    key_signals_they_look_for: ['pricing', 'social proof'],
  };
}

module.exports = { decomposeAudience, VERTICALS, BUYING_STAGES };
