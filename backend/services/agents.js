/**
 * Agent Simulation — Chain-of-Thought reasoning in 2 separate LLM calls.
 *
 * Step 1 (PROSE): The agent reasons freely in first-person, 200-400 words.
 * Step 2 (STRUCTURE): A focused LLM call extracts a clean JSON from the prose.
 *
 * Why 2 calls? Small models fail when asked to reason + format JSON in one shot.
 * Even large models (Llama 3.3 70B via Groq) produce much better reasoning when they
 * don't have to also enforce schema in the same breath.
 */

const { callAI, callAIJSON } = require('./ai');

// ──────────────────────────────────────────────────────────────
// STEP 1: Free-form reasoning (prose)
// ──────────────────────────────────────────────────────────────

async function reasoningPass({ persona, scenario, taskType, goal }) {
  const painQuotes = (persona.pain_quotes_in_voice || []).map(q => `"${q}"`).join(' | ');
  const objections = (persona.top_objections || []).join(' | ');
  const dealBreakers = (persona.deal_breakers || []).join(' | ');
  const hotButtons = (persona.hot_buttons || []).join(' | ');

  const sceneDescription = formatScenario(scenario);

  const system = `You are a behavioral simulation engine. You must fully inhabit the persona described below and narrate their experience evaluating the content. Write in first-person, present tense. Do NOT produce JSON. Do NOT break character. Be honest — including thoughts that contradict the product's marketing.`;

  const prompt = `I am ${persona.name}, ${persona.age}, ${persona.role}.
My company: ${persona.company_description}.
Archetype: ${persona.archetype_label} — ${persona._coverage_purpose || ''}

How I approach decisions: ${persona.decision_style}.
My traits on a 0-1 scale: patience=${persona.traits?.patience}, trust_baseline=${persona.traits?.trust_baseline}, price_sensitivity=${persona.traits?.price_sensitivity}, tech_savviness=${persona.traits?.tech_savviness}.
My monthly approval budget: $${persona.budget_monthly_usd}.

What I'm looking for: ${(persona.goals_for_this_visit || []).join('; ')}
What I currently use: ${(persona.current_alternatives || []).join(', ')}
Language and voice of my pain: ${painQuotes}
Objections that will stop me: ${objections}
Deal breakers: ${dealBreakers}
Hot buttons that would excite me: ${hotButtons}

I have just arrived at this ${describeTaskType(taskType)}:

${sceneDescription}

${goal ? `The owner of this page told me their goal is: "${goal}". I will evaluate it through that lens — but I'll be honest if it fails me.` : ''}

I will now narrate my experience. I will:
1. Describe what catches my eye first and what I ignore.
2. React honestly to each section I pay attention to — what works, what doesn't, what I'm thinking.
3. Cross-reference claims against my skepticism, my budget, and my current alternatives.
4. Call out specific friction, missing information, or broken trust moments.
5. Make a final decision: do I sign up / click / convert / bounce / bookmark?

Begin my stream of consciousness now. Be specific. Reference exact sections, headlines, or phrases I see on the page. Between 250 and 400 words.`;

  const prose = await callAI(prompt, { system, maxTokens: 1500, temperature: 0.85 });
  return prose.trim();
}

// ──────────────────────────────────────────────────────────────
// STEP 2: Structured extraction (JSON)
// ──────────────────────────────────────────────────────────────

async function extractionPass({ prose, persona, scenario }) {
  const sceneSections = getSceneSections(scenario);

  const prompt = `A synthetic persona has just narrated their experience evaluating a landing page / product. Extract a structured record from their narration. Be FAITHFUL to what they actually said — do not invent.

=== PERSONA ===
Name: ${persona.name}
Archetype: ${persona.archetype_label}

=== THEIR FIRST-PERSON NARRATION ===
${prose}

=== SECTIONS IN THE SCENARIO (for reference) ===
${sceneSections.join(', ')}

=== EXTRACT THIS JSON ===
{
  "attention_path": ["ordered list of sections/elements they actually noticed, using names from the scenario sections"],
  "sections_ignored": ["sections they skipped or dismissed"],
  "friction_points": [
    {"where": "which section", "what": "what caused friction", "severity": "high|medium|low"}
  ],
  "trust_signals_found": ["concrete trust-building elements they noticed"],
  "trust_signals_missing": ["specific trust elements they looked for and didn't find"],
  "objections_triggered": ["objections from their profile that THIS page triggered"],
  "objections_resolved": ["objections the page addressed well"],
  "hot_buttons_hit": ["things on the page that excited them"],

  "outcome": "converted" | "bounced" | "interested",
  "outcome_reason": "1 sentence quoting or paraphrasing their final decision",
  "decision_latency_seconds": number (their estimated time to decide, e.g. 3, 30, 120, 300),
  "would_return": true | false,
  "would_share": true | false,
  "confidence_in_decision": 0.0 to 1.0,
  "emotional_arc": "one short phrase like 'cautious → interested → dissatisfied' summarizing their journey"
}`;

  const structured = await callAIJSON(prompt, { maxTokens: 1500, temperature: 0.2 });

  // Guard and normalize
  return {
    reasoning: prose,
    attention_path: Array.isArray(structured.attention_path) ? structured.attention_path : [],
    sections_ignored: Array.isArray(structured.sections_ignored) ? structured.sections_ignored : [],
    friction_points: Array.isArray(structured.friction_points) ? structured.friction_points : [],
    trust_signals_found: Array.isArray(structured.trust_signals_found) ? structured.trust_signals_found : [],
    trust_signals_missing: Array.isArray(structured.trust_signals_missing) ? structured.trust_signals_missing : [],
    objections_triggered: Array.isArray(structured.objections_triggered) ? structured.objections_triggered : [],
    objections_resolved: Array.isArray(structured.objections_resolved) ? structured.objections_resolved : [],
    hot_buttons_hit: Array.isArray(structured.hot_buttons_hit) ? structured.hot_buttons_hit : [],
    outcome: ['converted', 'bounced', 'interested'].includes(structured.outcome) ? structured.outcome : 'bounced',
    outcome_reason: structured.outcome_reason || 'No clear reason given.',
    decision_latency_seconds: Number(structured.decision_latency_seconds) || 60,
    would_return: Boolean(structured.would_return),
    would_share: Boolean(structured.would_share),
    confidence_in_decision: typeof structured.confidence_in_decision === 'number' ? structured.confidence_in_decision : 0.6,
    emotional_arc: structured.emotional_arc || '',
  };
}

// ──────────────────────────────────────────────────────────────
// Composer
// ──────────────────────────────────────────────────────────────

async function runAgent({ persona, scenario, taskType, goal }) {
  const prose = await reasoningPass({ persona, scenario, taskType, goal });
  const extracted = await extractionPass({ prose, persona, scenario });
  return extracted;
}

// ──────────────────────────────────────────────────────────────
// Scenario formatting helpers
// ──────────────────────────────────────────────────────────────

function describeTaskType(t) {
  const labels = {
    landing_page: 'landing page',
    pricing: 'pricing page',
    marketing_campaign: 'marketing campaign asset (ad / email / post)',
    feature_validation: 'feature description / pitch',
    onboarding: 'onboarding / signup flow',
  };
  return labels[t] || 'page';
}

function formatScenario(scenario) {
  if (!scenario) return '(no content available)';

  const lines = [];
  if (scenario.url) lines.push(`URL: ${scenario.url}`);
  if (scenario.title) lines.push(`Page title: ${scenario.title}`);
  if (scenario.meta_description) lines.push(`Meta description: ${scenario.meta_description}`);

  if (scenario.hero) {
    lines.push('');
    lines.push('[HERO SECTION]');
    if (scenario.hero.headline) lines.push(`Headline: ${scenario.hero.headline}`);
    if (scenario.hero.subheadline) lines.push(`Subheadline: ${scenario.hero.subheadline}`);
    if (scenario.hero.cta_text) lines.push(`Primary CTA: "${scenario.hero.cta_text}"`);
  }

  if (Array.isArray(scenario.value_propositions) && scenario.value_propositions.length) {
    lines.push('');
    lines.push('[VALUE PROPS]');
    scenario.value_propositions.forEach(v => lines.push(`• ${v}`));
  }

  if (Array.isArray(scenario.features) && scenario.features.length) {
    lines.push('');
    lines.push('[FEATURES]');
    scenario.features.forEach(f => lines.push(`• ${f.name}${f.description ? ': ' + f.description : ''}`));
  }

  if (scenario.pricing) {
    lines.push('');
    lines.push('[PRICING]');
    if (scenario.pricing.visible === false) {
      lines.push('(no pricing visible on the page)');
    } else if (Array.isArray(scenario.pricing.tiers)) {
      scenario.pricing.tiers.forEach(t => lines.push(`• ${t.name}: ${t.price}${t.features && t.features.length ? ' — ' + t.features.slice(0, 4).join(', ') : ''}`));
    }
  }

  if (scenario.social_proof) {
    lines.push('');
    lines.push('[SOCIAL PROOF]');
    lines.push(scenario.social_proof.present ? (scenario.social_proof.details || 'present but unspecified') : '(no social proof visible)');
  }

  if (Array.isArray(scenario.trust_signals) && scenario.trust_signals.length) {
    lines.push('');
    lines.push('[TRUST SIGNALS]');
    scenario.trust_signals.forEach(t => lines.push(`• ${t}`));
  }

  if (Array.isArray(scenario.missing_elements) && scenario.missing_elements.length) {
    lines.push('');
    lines.push('[NOTABLY MISSING]');
    scenario.missing_elements.forEach(m => lines.push(`• ${m}`));
  }

  if (scenario.raw_text_sample) {
    lines.push('');
    lines.push('[ADDITIONAL VISIBLE TEXT]');
    lines.push(String(scenario.raw_text_sample).substring(0, 1500));
  }

  return lines.join('\n');
}

function getSceneSections(scenario) {
  const sections = [];
  if (scenario?.hero) sections.push('hero');
  if (Array.isArray(scenario?.value_propositions) && scenario.value_propositions.length) sections.push('value_propositions');
  if (Array.isArray(scenario?.features) && scenario.features.length) sections.push('features');
  if (scenario?.pricing) sections.push('pricing');
  if (scenario?.social_proof) sections.push('social_proof');
  if (Array.isArray(scenario?.trust_signals) && scenario.trust_signals.length) sections.push('trust_signals');
  if (scenario?.has_faq) sections.push('faq');
  if (Array.isArray(scenario?.calls_to_action) && scenario.calls_to_action.length) sections.push('ctas');
  return sections;
}

module.exports = { runAgent, formatScenario };
