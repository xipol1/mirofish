/**
 * Cognition — LLM-driven decision loop for a Playwright agent.
 *
 * Each step:
 *   1. Receive perception snapshot
 *   2. Receive persona + goal + current affect state + recent history
 *   3. Output next action as structured JSON
 *
 * Action schema:
 *   { action: 'scroll'|'click'|'type'|'submit'|'back'|'wait'|'abandon'|'goal_achieved',
 *     target_index: number (for click/type),  // index into interactables
 *     value: string (for type),
 *     direction: 'up'|'down' (for scroll),
 *     reasoning: string (why this action),
 *     affect_updates: { trust_signal_found?, objection_hit?, hot_button_hit?, confusion_moment?, ... }
 *   }
 */

const { callAIJSON } = require('../services/ai');
const { perceptionToPrompt } = require('./perception');

const VALID_ACTIONS = ['scroll', 'click', 'type', 'submit', 'back', 'wait', 'abandon', 'goal_achieved'];

function historyToPrompt(history, max = 8) {
  if (!history || history.length === 0) return '(this is the first step)';
  return history.slice(-max).map((h, i) => {
    const label = h.action || '?';
    const url = h.url ? ` on ${h.url.substring(0, 60)}` : '';
    const result = h.result_ok === true ? 'OK' : h.result_ok === false ? 'FAIL' : '';
    const note = h.reasoning ? ` — "${h.reasoning.substring(0, 100)}"` : '';
    return `  step ${h.step_index ?? i + 1}: ${label}${url} ${result}${note}`;
  }).join('\n');
}

async function decideNextAction({ persona, goal, taskType, perception, affect, history, stepIndex, maxSteps }) {
  const goalsFromPersona = (persona.goals_for_this_visit || []).join('; ');
  const objections = (persona.top_objections || []).join(' | ');
  const hotButtons = (persona.hot_buttons || []).join(' | ');
  const dealBreakers = (persona.deal_breakers || []).join(' | ');

  const pageSummary = perceptionToPrompt(perception);

  const affectSummary = `energy=${affect.energy.toFixed(2)} patience=${affect.patience.toFixed(2)} trust=${affect.trust.toFixed(2)} frustration=${affect.frustration.toFixed(2)} confusion=${affect.confusion.toFixed(2)} excitement=${affect.excitement.toFixed(2)}`;

  const historySummary = historyToPrompt(history);

  const stepsLeft = Math.max(1, (maxSteps || 15) - stepIndex);

  const system = `You are a behavioral simulation engine controlling ONE synthetic user's decisions as they navigate a real website. You inhabit this persona and decide THEIR next action authentically. Do not break character. Do not "help" the page. If frustrated or off-goal, be willing to abandon like a real human would.`;

  const prompt = `PERSONA (you ARE this person):
Name: ${persona.name}
Role: ${persona.role}
Company: ${persona.company_description}
Archetype: ${persona.archetype_label}
Decision style: ${persona.decision_style}

YOUR CURRENT GOALS ON THIS VISIT:
${goalsFromPersona}

YOUR TRAITS (0..1 scale):
patience=${persona.traits?.patience?.toFixed(2)} trust_baseline=${persona.traits?.trust_baseline?.toFixed(2)} price_sensitivity=${persona.traits?.price_sensitivity?.toFixed(2)} tech_savviness=${persona.traits?.tech_savviness?.toFixed(2)}

YOUR CURRENT EMOTIONAL STATE:
${affectSummary}

YOUR OBJECTIONS (things that would stop you):
${objections}

YOUR HOT BUTTONS (things that would excite you):
${hotButtons}

YOUR DEAL-BREAKERS (instant-bounce triggers):
${dealBreakers}

TASK CONTEXT: This is a ${taskType} test. ${goal ? `The owner's stated goal: "${goal}"` : ''}

RECENT HISTORY (your last actions on this journey):
${historySummary}

CURRENT PAGE (what you see right now):
${pageSummary}

STEP ${stepIndex + 1} of max ${maxSteps}. You have ~${stepsLeft} steps left before you naturally end this session.

YOUR DECISION:
Based on your persona, your goals, your current emotional state, and what you see — what do you do NEXT?

VALID ACTIONS:
- "scroll": scroll the page (specify direction "up" or "down")
- "click": click an interactive element (specify target_index — MUST match an index from INTERACTIVE ELEMENTS list)
- "type": type into a form field (specify target_index AND value). Only use if the target is an input.
- "submit": press Enter to submit a focused input
- "back": go back
- "wait": do nothing this step (reading/thinking)
- "abandon": leave the site (you've had enough / you're frustrated / not for you)
- "goal_achieved": you accomplished what you came for — signup/purchase/info/etc.

RULES:
- Be honest to your persona. Impatient personas abandon fast. Skeptical personas need trust signals.
- If trust is very low AND you see red flags, it's fine to abandon.
- If you see hot buttons that match your goals, excitement should rise and you should engage deeper.
- Don't invent selectors — only reference target_index values that exist.
- If there's NO interactive element that matches your intent, scroll or abandon — don't hallucinate.

Return this JSON:
{
  "action": "one of the valid actions",
  "target_index": number | null,
  "value": "string or null (only for type action)",
  "direction": "up" | "down" | null,
  "reasoning": "1-3 sentences in FIRST PERSON about why you're doing this — what you noticed, what you felt, what you decided",
  "internal_thoughts": "optional: 1 sentence of emotional subtext (skepticism, delight, confusion)",
  "affect_updates": {
    "trust_signal_found": 0 | 1,
    "trust_signal_missing": 0 | 1,
    "objection_hit": 0 | 1,
    "hot_button_hit": 0 | 1,
    "confusion_moment": 0 | 1
  }
}`;

  const decision = await callAIJSON(prompt, { maxTokens: 600, temperature: 0.75, system });

  // Validate and sanitize
  if (!VALID_ACTIONS.includes(decision.action)) {
    decision.action = 'wait';
    decision.reasoning = (decision.reasoning || '') + ' [sanitized: invalid action]';
  }
  if (decision.action === 'click' || decision.action === 'type') {
    const idx = Number(decision.target_index);
    if (!Number.isInteger(idx) || idx < 0 || idx >= (perception.interactables?.length || 0)) {
      // Can't click invalid index — fallback to scroll
      decision.action = 'scroll';
      decision.direction = 'down';
      decision.target_index = null;
      decision.reasoning = (decision.reasoning || '') + ' [sanitized: invalid target_index]';
    }
  }
  if (decision.action === 'type' && !decision.value) {
    decision.action = 'click';
  }
  if (decision.action === 'scroll' && !decision.direction) {
    decision.direction = 'down';
  }
  if (!decision.affect_updates) decision.affect_updates = {};

  return decision;
}

module.exports = { decideNextAction, VALID_ACTIONS };
