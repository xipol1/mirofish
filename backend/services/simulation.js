/**
 * Simulation Orchestrator — executes the 10-phase pipeline:
 *
 *   1. Scrape (if URL)
 *   2. Classify task type
 *   3. Decompose audience
 *   4. Retrieve pain points (inside personaGenerator)
 *   5. Select archetypes (inside personaGenerator)
 *   6. Generate personas
 *   7. Parse scenario
 *   8. Run agents (Chain-of-Thought x 3)
 *   9. Compute metrics (JS)
 *  10. Generate insights (LLM over metrics)
 *  11. Generate recommendations (templates + LLM validation)
 */

const { callAIJSON, getProvider, getCohortSize } = require('./ai');
const { scrapeUrl, isUrl, parseScrapeAuthEnv } = require('./scraper');
const { classifyTask } = require('./taskClassifier');
const { decomposeAudience } = require('./audienceDecomposer');
const { generatePersonas } = require('./personaGenerator');
const { runAgent } = require('./agents');
const { computeMetrics } = require('./metrics');
const { generateInsights } = require('./insights');
const { generateRecommendations } = require('./recommendations');

// ─────────────────────────────────────────────────────────────
// Scenario parsing (combines scraped data + user-provided content)
// ─────────────────────────────────────────────────────────────

async function parseScenario({ scrapedData, content, url }) {
  // Build the input text for the LLM — prefer scraped, fall back to content
  let contextBlob = '';

  if (scrapedData) {
    contextBlob += `URL: ${scrapedData.url}\n`;
    if (scrapedData.title) contextBlob += `Title: ${scrapedData.title}\n`;
    if (scrapedData.description) contextBlob += `Description: ${scrapedData.description}\n\n`;
    if (scrapedData.headings?.h1?.length) contextBlob += `H1s: ${scrapedData.headings.h1.join(' || ')}\n`;
    if (scrapedData.headings?.h2?.length) contextBlob += `H2s: ${scrapedData.headings.h2.join(' || ')}\n`;
    if (scrapedData.headings?.h3?.length) contextBlob += `H3s: ${scrapedData.headings.h3.join(' || ')}\n\n`;
    if (scrapedData.features_detected?.length) {
      contextBlob += `Features:\n${scrapedData.features_detected.map(f => `- ${f.name}: ${f.description}`).join('\n')}\n\n`;
    }
    if (scrapedData.pricing_signals?.length) {
      contextBlob += `Pricing signals:\n${scrapedData.pricing_signals.slice(0, 10).join('\n')}\n\n`;
    }
    if (scrapedData.ctas?.length) contextBlob += `CTA buttons: ${scrapedData.ctas.join(' | ')}\n`;
    if (scrapedData.trust_markers) {
      contextBlob += `Trust markers: testimonials=${scrapedData.trust_markers.testimonials_present}, logos=${scrapedData.trust_markers.logos_present}, compliance=${(scrapedData.trust_markers.compliance_mentions || []).join(',') || 'none'}\n`;
      if (scrapedData.trust_markers.stats_claims?.length) {
        contextBlob += `Stats claims: ${scrapedData.trust_markers.stats_claims.slice(0, 5).join(' | ')}\n`;
      }
    }
    contextBlob += `\nVisible text sample: ${scrapedData.visible_text_sample?.substring(0, 1500) || ''}`;
  }

  if (content) {
    contextBlob = contextBlob + (contextBlob ? '\n\n---USER-PROVIDED CONTENT---\n' : '') + content;
  }

  if (!contextBlob.trim()) {
    throw new Error('No content to analyze (no URL, no pasted content)');
  }

  const prompt = `Structure this landing page / content into a JSON schema. Extract EXACTLY what's present — if a section doesn't exist, set it to null or false.

=== INPUT ===
${contextBlob.substring(0, 5000)}

=== SCHEMA ===
{
  "url": ${url ? `"${url}"` : null},
  "title": "page title or null",
  "meta_description": "description or null",
  "site_name": "brand/product name or null",

  "hero": {
    "headline": "exact headline text or null",
    "subheadline": "exact subheadline or null",
    "cta_text": "primary CTA text or null"
  },

  "value_propositions": ["distinct value claims made on the page"],

  "features": [{"name": "feature", "description": "what it does"}],

  "pricing": {
    "visible": true or false,
    "model": "free_trial" | "freemium" | "paid_only" | "contact_sales" | "not_shown",
    "tiers": [{"name": "tier", "price": "price text", "features": ["included"]}]
  },

  "social_proof": {
    "present": true or false,
    "elements": ["testimonials", "logos", "stats", "case_studies"],
    "details": "what specific proof exists"
  },

  "trust_signals": ["compliance badges, guarantees, team info, security mentions"],
  "calls_to_action": [{"text": "CTA", "position": "above_fold|below_fold", "prominence": "high|medium|low"}],
  "has_faq": true or false,
  "missing_elements": ["critical things NOT present"],
  "overall_impression": "one sentence"
}`;

  const parsed = await callAIJSON(prompt, { maxTokens: 2000, temperature: 0.2 });

  // Attach raw text sample for agents to reference
  if (scrapedData?.visible_text_sample) {
    parsed.raw_text_sample = scrapedData.visible_text_sample.substring(0, 2000);
  }
  if (scrapedData?.trust_markers) {
    parsed.trust_markers = scrapedData.trust_markers;
  }

  return parsed;
}

// ─────────────────────────────────────────────────────────────
// Main orchestrator
// ─────────────────────────────────────────────────────────────

async function runFullSimulation(input) {
  const defaultSize = getCohortSize();
  const requested = parseInt(input.agentCount, 10);
  const cohortSize = Number.isFinite(requested) && requested > 0 ? Math.min(requested, 200) : defaultSize;
  const provider = getProvider();
  const mode = provider === 'groq' ? 'REALISTIC (Groq)' :
               provider === 'claude' ? 'REALISTIC (Claude)' :
               'DEMO (Ollama)';

  console.log(`[SIM] Mode: ${mode} | Cohort size: ${cohortSize}`);
  const onProgress = input.onProgress || (() => {});

  const startedAt = Date.now();
  onProgress({ phase: 'starting', phase_index: 0, agents_total: cohortSize, message: `Starting ${mode} simulation with ${cohortSize} agents` });

  // ───── Phase 1: Scrape if URL ─────
  let scrapedData = null;
  const urlFromContent = isUrl((input.content || '').trim()) ? input.content.trim() : null;
  const explicitUrl = isUrl(input.url) ? input.url : null;
  const effectiveUrl = explicitUrl || urlFromContent;

  if (effectiveUrl) {
    // Resolve auth entries: caller-provided wins, else env fallback keyed by domain
    let authEntries = Array.isArray(input.scrapeAuth) ? input.scrapeAuth : [];
    if (authEntries.length === 0) {
      const host = (new URL(effectiveUrl)).hostname.replace(/^www\./, '').split('.')[0].toUpperCase();
      authEntries = parseScrapeAuthEnv(process.env[`SCRAPE_AUTH_${host}`]);
    }
    onProgress({ phase: 'scraping', phase_index: 1, message: `Scraping ${effectiveUrl}${authEntries.length ? ` (+ ${authEntries.length} auth views)` : ''}` });
    console.log(`[SIM] Phase 1/11: Scraping URL${authEntries.length ? ` + ${authEntries.length} auth views` : ''}...`);
    try {
      scrapedData = await scrapeUrl(effectiveUrl, { auth: authEntries });
      const authSummary = (scrapedData.auth_views || []).map(v => `${v.role}=${v.ok ? 'ok' : 'fail'}`).join(', ');
      console.log(`[SIM]   ✓ Scraped ${scrapedData.url} (${(scrapedData.visible_text_sample || '').length} chars${authSummary ? `; ${authSummary}` : ''})`);
      onProgress({ message: `Scraped ${(scrapedData.visible_text_sample || '').length} chars${authSummary ? ` · auth: ${authSummary}` : ''}` });
    } catch (err) {
      console.error(`[SIM]   ✗ Scrape failed: ${err.message}. Proceeding with any provided content.`);
      onProgress({ message: `Scrape failed: ${err.message.substring(0, 80)}` });
    }
  }

  // ───── Phase 2: Classify task ─────
  onProgress({ phase: 'classifying', phase_index: 2, message: 'Classifying test type' });
  console.log('[SIM] Phase 2/11: Classifying task type...');
  const taskClassification = await classifyTask({
    content: input.content,
    url: effectiveUrl,
    audience: input.audience,
    explicitType: input.taskType,
  });
  const taskType = taskClassification.task_type;
  console.log(`[SIM]   ✓ Task: ${taskType} (confidence ${taskClassification.confidence})`);
  onProgress({ message: `Task type: ${taskType}` });

  // ───── Phase 3: Decompose audience ─────
  onProgress({ phase: 'decomposing_audience', phase_index: 3, message: 'Parsing audience' });
  console.log('[SIM] Phase 3/11: Decomposing audience...');
  const audienceVector = await decomposeAudience(input.audience);
  console.log(`[SIM]   ✓ Audience: ${audienceVector.role_archetype} (${audienceVector.vertical}, ${audienceVector.company_size})`);
  onProgress({ message: `Audience: ${audienceVector.role_archetype} (${audienceVector.vertical})` });

  // ───── Phase 4-6: Generate task-adaptive personas ─────
  onProgress({ phase: 'generating_personas', phase_index: 4, message: `Generating ${cohortSize} personas...` });
  console.log(`[SIM] Phase 4-6/11: Generating ${cohortSize} task-adaptive personas...`);
  const personas = await generatePersonas({ taskType, audienceVector, count: cohortSize, onProgress, seedPersonas: input.seedPersonas });
  console.log(`[SIM]   ✓ Personas: ${personas.length} generated`);
  onProgress({ message: `${personas.length} personas generated` });

  // ───── Phase 7: Parse scenario ─────
  onProgress({ phase: 'parsing_scenario', phase_index: 7, message: 'Parsing scenario structure' });
  console.log('[SIM] Phase 7/11: Parsing scenario into structured form...');
  const scenario = await parseScenario({ scrapedData, content: input.content, url: effectiveUrl });
  console.log(`[SIM]   ✓ Scenario parsed: ${scenario.hero?.headline ? 'hero found' : 'no hero'}, pricing visible=${scenario.pricing?.visible}, social_proof=${scenario.social_proof?.present}`);
  onProgress({ message: 'Scenario parsed' });

  // ───── Phase 8: Run agents (CoT) ─────
  const concurrency = parseInt(process.env.GROQ_CONCURRENCY, 10) || 4;
  onProgress({ phase: 'running_agents', phase_index: 8, message: `Running ${personas.length} agents (concurrency ${concurrency})...`, agents_done: 0, agents_total: personas.length });
  console.log(`[SIM] Phase 8/11: Running ${personas.length} agents (CoT x2 each, concurrency=${concurrency})...`);
  const runs = await runConcurrent(personas, scenario, taskType, input.goal, concurrency, onProgress);

  const agentResults = runs.map((r, i) => ({
    ...r,
    _persona_name: personas[i].name,
    _persona_archetype_label: personas[i].archetype_label,
    _archetype_id: personas[i]._archetype_id || personas[i].archetype_id,
  }));
  console.log(`[SIM]   ✓ All ${agentResults.length} agents complete`);

  // ───── Phase 9: Compute metrics (JS) ─────
  onProgress({ phase: 'computing_metrics', phase_index: 9, message: 'Computing quantitative metrics' });
  console.log('[SIM] Phase 9/11: Computing quantitative metrics...');
  const metrics = computeMetrics(agentResults, scenario);
  console.log(`[SIM]   ✓ conversion_rate=${metrics.conversion_rate}%, trust_score=${metrics.trust_score}, divergence=${metrics.segment_divergence}, confidence=${metrics.confidence_score}`);
  onProgress({ message: `Conversion ${metrics.conversion_rate}% · Trust ${metrics.trust_score} · Divergence ${metrics.segment_divergence}` });

  // ───── Phase 10: Generate insights ─────
  onProgress({ phase: 'synthesizing_insights', phase_index: 10, message: 'Synthesizing insights' });
  console.log('[SIM] Phase 10/11: Synthesizing insights...');
  const insights = await generateInsights({ metrics, agentResults, scenario, taskType, personas });
  console.log(`[SIM]   ✓ Headline: ${insights.headline?.substring(0, 100) || '(none)'}`);
  onProgress({ message: 'Insights ready' });

  // ───── Phase 11: Generate recommendations ─────
  onProgress({ phase: 'generating_recommendations', phase_index: 11, message: 'Generating recommendations' });
  console.log('[SIM] Phase 11/11: Generating recommendations...');
  const recommendations = await generateRecommendations({
    insights, metrics, scenario, audienceVector, taskType, goal: input.goal
  });
  console.log(`[SIM]   ✓ ${recommendations.length} recommendations`);
  onProgress({ phase: 'done', message: `${recommendations.length} recommendations ready` });

  const elapsedMs = Date.now() - startedAt;
  console.log(`[SIM] ✅ Complete in ${Math.round(elapsedMs / 1000)}s`);

  return {
    mode,
    provider,
    task_type: taskType,
    task_classification: taskClassification,
    audience_vector: audienceVector,
    scenario_summary: scenario,
    personas,
    agent_results: agentResults,
    metrics,
    insights,
    recommendations,
    // Legacy shape for backward-compat with existing frontend
    headline: insights.headline,
    outcomes: {
      total: metrics.total_agents,
      converted: metrics.converted,
      bounced: metrics.bounced,
      interested: metrics.interested,
      conversion_rate: metrics.conversion_rate,
    },
    friction_points: (insights.patterns || []).slice(0, 3).map(p => ({
      location: (p.affected_archetypes || []).join(',') || 'unknown',
      description: p.pattern,
      users_affected: Array.isArray(p.affected_archetypes) ? p.affected_archetypes.length : 1,
      blocks_conversion: p.severity === 'high',
    })),
    trust_analysis: {
      signals_present: (scenario?.trust_signals || []),
      signals_missing: (metrics.top_missing_signals || []).map(s => s.signal),
      trust_impact: insights.trust_summary?.impact_sentence || '',
    },
    segment_analysis: (insights.segment_divergence_summary?.per_archetype || []).map(a => ({
      segment: a.archetype,
      size: metrics.segment_outcomes?.[a.archetype]?.total || 1,
      behavior: a.read,
      conversion_rate: metrics.segment_outcomes?.[a.archetype]
        ? `${Math.round((metrics.segment_outcomes[a.archetype].converted / metrics.segment_outcomes[a.archetype].total) * 100)}%`
        : '0%',
    })),
    elapsed_ms: elapsedMs,
  };
}

async function runAgentSafe(persona, scenario, taskType, goal) {
  try {
    return await runAgent({ persona, scenario, taskType, goal });
  } catch (err) {
    console.error(`[agent] ${persona.name} failed: ${err.message.substring(0, 120)}`);
    return fallbackAgentResult(err);
  }
}

async function runSequential(personas, scenario, taskType, goal) {
  const results = [];
  for (const p of personas) {
    console.log(`[SIM]   Running agent: ${p.name} (${p.archetype_label})...`);
    results.push(await runAgentSafe(p, scenario, taskType, goal));
  }
  return results;
}

/**
 * Concurrent worker pool — caps parallel LLM calls to `concurrency` workers.
 * Each worker pulls the next persona off a queue until all are done.
 * Respects Groq rate limits via the retry logic in ai.js.
 */
async function runConcurrent(personas, scenario, taskType, goal, concurrency, onProgress = () => {}) {
  const results = new Array(personas.length);
  let nextIdx = 0;
  let completed = 0;
  const total = personas.length;

  async function worker(workerId) {
    while (true) {
      const myIdx = nextIdx++;
      if (myIdx >= total) break;
      const persona = personas[myIdx];
      const label = `${myIdx + 1}/${total} ${persona.name} (${persona.archetype_label})`;
      console.log(`[SIM]   [w${workerId}] → Agent ${label}`);
      try {
        results[myIdx] = await runAgentSafe(persona, scenario, taskType, goal);
        completed++;
        console.log(`[SIM]   [w${workerId}] ✓ ${label} → ${results[myIdx].outcome} (${completed}/${total} done)`);
        onProgress({ agents_done: completed, agents_total: total, message: `${completed}/${total}: ${persona.name} → ${results[myIdx].outcome}` });
      } catch (err) {
        console.error(`[SIM]   [w${workerId}] ✗ ${label}: ${err.message.substring(0, 120)}`);
        results[myIdx] = fallbackAgentResult(err);
        completed++;
        onProgress({ agents_done: completed, agents_total: total, message: `${completed}/${total}: ${persona.name} failed` });
      }
    }
  }

  const workers = Array.from({ length: concurrency }, (_, i) => worker(i + 1));
  await Promise.all(workers);
  return results;
}

function fallbackAgentResult(err) {
  return {
    reasoning: `Simulation error: ${err.message.substring(0, 200)}`,
    attention_path: [],
    sections_ignored: [],
    friction_points: [],
    trust_signals_found: [],
    trust_signals_missing: [],
    objections_triggered: [],
    objections_resolved: [],
    hot_buttons_hit: [],
    outcome: 'bounced',
    outcome_reason: 'Agent simulation error',
    decision_latency_seconds: 5,
    would_return: false,
    would_share: false,
    confidence_in_decision: 0,
    emotional_arc: 'error',
  };
}

module.exports = { runFullSimulation };
