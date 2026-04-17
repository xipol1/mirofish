/**
 * Task Classifier — determines WHICH type of test the user wants to run.
 *
 * Output: one of: landing_page | pricing | marketing_campaign | feature_validation | onboarding
 * Plus a confidence score and a brief rationale.
 */

const { callAIJSON } = require('./ai');

const VALID_TYPES = ['landing_page', 'pricing', 'marketing_campaign', 'feature_validation', 'onboarding'];

async function classifyTask({ content, url, audience, explicitType }) {
  // Honor explicit user choice first
  if (explicitType && VALID_TYPES.includes(explicitType)) {
    return { task_type: explicitType, confidence: 1.0, rationale: 'User explicitly selected.' };
  }

  const contentSample = (content || '').substring(0, 2000);
  const urlHint = url || '(no url provided)';
  const audienceHint = audience || '(no audience)';

  const prompt = `You are a test-type classifier for a user-simulation platform. Classify what kind of test the user wants to run.

VALID TYPES (choose EXACTLY one):
- "landing_page": testing a landing page, homepage, or general conversion page
- "pricing": testing pricing strategy (tiers, amounts, structure)
- "marketing_campaign": testing an ad, email, or campaign message for attention/engagement
- "feature_validation": testing whether a specific feature would be adopted
- "onboarding": testing a signup flow, first-run experience, or setup journey

USER INPUT:
URL: ${urlHint}
Audience: ${audienceHint}
Content sample: ${contentSample}

Classify. Return JSON:
{
  "task_type": "one of the five values above",
  "confidence": 0.0 to 1.0,
  "rationale": "one sentence explaining why"
}`;

  try {
    const result = await callAIJSON(prompt, { maxTokens: 300, temperature: 0.2 });
    if (!VALID_TYPES.includes(result.task_type)) {
      return { task_type: 'landing_page', confidence: 0.4, rationale: 'Fallback: unclear signal, defaulting to landing_page.' };
    }
    return result;
  } catch (err) {
    return { task_type: 'landing_page', confidence: 0.3, rationale: `Classification failed (${err.message.substring(0, 80)}), defaulting to landing_page.` };
  }
}

module.exports = { classifyTask, VALID_TYPES };
