/**
 * Modality: Rate Strategy Test
 *
 * Simulates N prospects facing a set of rate variants (pricing tests,
 * cancellation policies, package vs room-only, discount schemes) to
 * estimate the revenue-optimum strategy per market and segment.
 *
 * Stages: price_exposure → comparison → decision → (if booked) spend_intent.
 *
 * Output: demand curve per segment, revenue projection per variant,
 * walk-away thresholds, package vs à-la-carte preference.
 */

const { callAIJSON } = require('../../ai');
const culturalProfiles = require('../cultural-profiles');
const bookingContextSvc = require('../booking-context');
const marketPacks = require('../market-packs');

const REQUIRED = ['property', 'audience', 'rate_variants'];
const OPTIONAL = [
  'agent_count', 'market_pack_ids', 'competitive_set', 'property_country',
  'cancellation_policies_to_test',
];

const STAGES = ['price_exposure', 'comparison_with_alternatives', 'decision', 'spend_intent'];

function validateInputs(raw) {
  const errors = [];
  if (!raw.property || !raw.property.name) errors.push('property.name is required');
  if (!raw.audience) errors.push('audience is required');
  if (!Array.isArray(raw.rate_variants) || raw.rate_variants.length === 0) {
    errors.push('rate_variants is required — array of { label, rate_eur, inclusions: [], cancellation_policy }');
  }
  if (raw.rate_variants && raw.rate_variants.length > 8) {
    errors.push('rate_variants cannot exceed 8 (too many variants dilute statistical power)');
  }
  return { ok: errors.length === 0, errors, normalized: raw };
}

function buildAgentContext({ persona, globalCtx }) {
  const archetypeId = persona.archetype_id || persona._archetype_id || 'business_traveler';

  const marketPackId = (globalCtx.market_pack_ids && globalCtx.market_pack_ids.length > 0)
    ? globalCtx.market_pack_ids[Math.floor(Math.random() * globalCtx.market_pack_ids.length)]
    : null;
  const pack = marketPackId ? marketPacks.get(marketPackId) : null;

  const clusterId = pack?.cultural_cluster_mapping || culturalProfiles.sampleClusterForMenorca();
  const cultural_context = culturalProfiles.buildCulturalContext({
    clusterId,
    propertyCountry: globalCtx.property_country || 'ES',
  });

  const booking_context = bookingContextSvc.sampleBookingContext({
    archetypeId,
    propertyTier: globalCtx.property?.data_json?.identity?.tier || globalCtx.property?.tier || 'luxury',
  });

  // Randomly assign one of the rate variants to this agent (stratified)
  const rate_variant = globalCtx.rate_variants[Math.floor(Math.random() * globalCtx.rate_variants.length)];

  return {
    archetype_id: archetypeId,
    cultural_context,
    booking_context,
    market_pack: pack ? { id: pack.market_id, label: pack.label } : null,
    rate_variant,
    competitive_set: globalCtx.competitive_set || [],
  };
}

async function runForAgent({ persona, agentCtx, globalCtx, onStage }) {
  const stageOutputs = [];
  const state = {
    accepted_rate: null,
    comparison_winner: null,
    would_book: null,
    walk_away_triggered: false,
    walk_away_reason: null,
    estimated_spend_if_booked_eur: 0,
  };

  for (const stageLabel of STAGES) {
    onStage({ stage: stageLabel, state: { ...state } });

    let result;
    try {
      result = await runRateStage({
        stageLabel,
        persona,
        agentCtx,
        globalCtx,
        state,
        previousOutputs: stageOutputs,
      });
    } catch (err) {
      console.error(`[rate-strategy] Stage ${stageLabel} failed:`, err.message.substring(0, 150));
      result = { stage: stageLabel, narrative: '(error)', decision: 'abandon' };
    }

    // Update state
    if (result.would_book != null) state.would_book = result.would_book;
    if (result.walk_away) {
      state.walk_away_triggered = true;
      state.walk_away_reason = result.walk_away_reason;
    }
    if (result.comparison_winner) state.comparison_winner = result.comparison_winner;
    if (typeof result.estimated_spend_if_booked_eur === 'number') {
      state.estimated_spend_if_booked_eur = result.estimated_spend_if_booked_eur;
    }

    stageOutputs.push(result);

    // If the agent walked away early, skip remaining stages except spend_intent
    if (state.walk_away_triggered && stageLabel !== 'spend_intent') break;
  }

  const booked = state.would_book === true && !state.walk_away_triggered;

  return {
    archetype_id: agentCtx.archetype_id,
    persona: { name: persona.name, archetype_label: persona.archetype_label },
    persona_full: persona,
    cultural_context: agentCtx.cultural_context ? {
      culture_cluster: agentCtx.cultural_context.culture_cluster,
      origin_country_iso: agentCtx.cultural_context.origin_country_iso,
    } : null,
    market_pack: agentCtx.market_pack,
    rate_variant: agentCtx.rate_variant,
    stages: stageOutputs,
    booked,
    would_book: state.would_book,
    walk_away_triggered: state.walk_away_triggered,
    walk_away_reason: state.walk_away_reason,
    comparison_winner: state.comparison_winner,
    estimated_spend_if_booked_eur: state.estimated_spend_if_booked_eur,
    revenue_contribution_eur: booked
      ? (agentCtx.rate_variant.rate_eur * (persona.typical_stay_length_nights || 3) + state.estimated_spend_if_booked_eur)
      : 0,
    completed_at: Date.now(),
  };
}

async function runRateStage({ stageLabel, persona, agentCtx, globalCtx, state, previousOutputs }) {
  const prompt = buildRateStagePrompt({ stageLabel, persona, agentCtx, globalCtx, state, previousOutputs });
  const raw = await callAIJSON(prompt, { maxTokens: 700, temperature: 0.7 });
  return normalizeRateStageOutput(raw, stageLabel);
}

function buildRateStagePrompt({ stageLabel, persona, agentCtx, globalCtx, state, previousOutputs }) {
  const rv = agentCtx.rate_variant;
  const culturalBlock = agentCtx.cultural_context?.narrative_block || '';
  const packSignals = agentCtx.market_pack
    ? JSON.stringify(marketPacks.getBehaviorSignals(agentCtx.market_pack.id), null, 2)
    : '(no market pack)';

  const inclusionsLine = (rv.inclusions || []).join(', ') || 'room only';
  const competitorLine = (globalCtx.competitive_set || []).map((c, i) => `  ${i + 1}. ${c}`).join('\n') || '(no specific competitors in mind)';

  const stagePrompts = {
    price_exposure: `You see a rate offer: €${rv.rate_eur}/night for "${rv.label}". Inclusions: ${inclusionsLine}. Cancellation: ${rv.cancellation_policy || 'standard'}. Is this price reasonable for what\'s offered? What\'s your first reaction?`,
    comparison_with_alternatives: 'You compare this offer to your alternatives (competitive set). Which wins and why?',
    decision: 'Final decision: would you book this rate at this price? If not, what change would flip it?',
    spend_intent: 'If you did book this stay: what would you spend beyond the room rate (F&B, spa, activities)? Be realistic based on your archetype + inclusions.',
  };

  return `You are simulating a prospective hotel booker evaluating a specific rate offer. Stay in character.

=== YOU ARE ===
Name: ${persona.name}
Archetype: ${persona.archetype_label}
Your typical booking behavior: ${agentCtx.booking_context?.booking_channel_label || 'standard direct or OTA'}

${culturalBlock}

=== PROPERTY ===
${globalCtx.property?.name} (${globalCtx.property?.brand || 'unbranded'})

=== YOUR MARKET BEHAVIORAL SIGNALS ===
${packSignals}

=== THE RATE OFFER YOU ARE EVALUATING ===
Label: ${rv.label}
Price: €${rv.rate_eur}/night
Inclusions: ${inclusionsLine}
Cancellation policy: ${rv.cancellation_policy || 'standard'}
Additional terms: ${rv.terms || 'none'}

=== YOUR ALTERNATIVES (competitive set) ===
${competitorLine}

=== PREVIOUS STAGES ===
${previousOutputs.map(p => `[${p.stage}] ${p.narrative?.substring(0, 160)}`).join('\n') || '(first stage)'}

=== CURRENT STAGE: ${stageLabel} ===
${stagePrompts[stageLabel]}

Return JSON:
{
  "narrative": "2-4 sentences first-person.",
  "would_book": ${stageLabel === 'decision' ? 'true | false' : 'null if not yet deciding'},
  "walk_away": "boolean — if yes, you rejected this variant",
  "walk_away_reason": "if walk_away, specific reason",
  "comparison_winner": "if stage is comparison: which wins and why. else null",
  "estimated_spend_if_booked_eur": "if stage is spend_intent: your expected ancillary spend for the full stay. else 0",
  "price_perception": "too_low_suspicious | fair | slightly_high | too_high | refuse_to_pay",
  "cancellation_acceptability": "acceptable | tolerable | dealbreaker",
  "value_for_money_score_0_100": "integer"
}`;
}

function normalizeRateStageOutput(raw, stageLabel) {
  return {
    stage: stageLabel,
    narrative: String(raw?.narrative || '').substring(0, 1000),
    would_book: raw?.would_book ?? null,
    walk_away: !!raw?.walk_away,
    walk_away_reason: raw?.walk_away_reason || null,
    comparison_winner: raw?.comparison_winner || null,
    estimated_spend_if_booked_eur: Number(raw?.estimated_spend_if_booked_eur) || 0,
    price_perception: raw?.price_perception || null,
    cancellation_acceptability: raw?.cancellation_acceptability || null,
    value_for_money_score: Math.max(0, Math.min(100, Number(raw?.value_for_money_score_0_100) || 50)),
  };
}

function aggregateResults(agentRecords, globalCtx) {
  const valid = agentRecords.filter(r => r && !r.error);
  const n = valid.length;
  if (n === 0) return { modality: 'rate_strategy_test', total: 0 };

  // Results by rate variant (the core output)
  const byVariant = {};
  for (const r of valid) {
    const label = r.rate_variant?.label || 'unknown';
    if (!byVariant[label]) byVariant[label] = {
      label,
      rate_eur: r.rate_variant?.rate_eur,
      total: 0, booked: 0, walked_away: 0,
      total_revenue_eur: 0,
      avg_value_for_money: [],
    };
    byVariant[label].total++;
    if (r.booked) byVariant[label].booked++;
    if (r.walk_away_triggered) byVariant[label].walked_away++;
    byVariant[label].total_revenue_eur += r.revenue_contribution_eur || 0;
    // Average VfM from the decision stage
    const decisionStage = (r.stages || []).find(s => s.stage === 'decision');
    if (decisionStage?.value_for_money_score != null) byVariant[label].avg_value_for_money.push(decisionStage.value_for_money_score);
  }

  for (const v of Object.values(byVariant)) {
    v.acceptance_rate_pct = Math.round((v.booked / v.total) * 1000) / 10;
    v.walk_away_rate_pct = Math.round((v.walked_away / v.total) * 1000) / 10;
    v.avg_revenue_per_prospect_eur = Math.round((v.total_revenue_eur / v.total) * 100) / 100;
    v.avg_value_for_money_score = v.avg_value_for_money.length
      ? Math.round((v.avg_value_for_money.reduce((a, b) => a + b, 0) / v.avg_value_for_money.length) * 10) / 10
      : null;
    delete v.avg_value_for_money;
  }

  // Winner variant by revenue per prospect
  const variants = Object.values(byVariant).sort((a, b) => b.avg_revenue_per_prospect_eur - a.avg_revenue_per_prospect_eur);
  const winner_variant = variants[0]?.label || null;

  // Acceptance by market × variant (elasticity by market)
  const byMarketVariant = {};
  for (const r of valid) {
    const mk = r.market_pack?.id || 'unknown_market';
    const lbl = r.rate_variant?.label || 'unknown';
    const key = `${mk}::${lbl}`;
    if (!byMarketVariant[key]) byMarketVariant[key] = { market: mk, variant: lbl, total: 0, booked: 0 };
    byMarketVariant[key].total++;
    if (r.booked) byMarketVariant[key].booked++;
  }
  for (const v of Object.values(byMarketVariant)) {
    v.acceptance_rate_pct = Math.round((v.booked / v.total) * 1000) / 10;
  }

  // Acceptance by archetype × variant
  const byArchVariant = {};
  for (const r of valid) {
    const ar = r.archetype_id || 'unknown';
    const lbl = r.rate_variant?.label || 'unknown';
    const key = `${ar}::${lbl}`;
    if (!byArchVariant[key]) byArchVariant[key] = { archetype: ar, variant: lbl, total: 0, booked: 0 };
    byArchVariant[key].total++;
    if (r.booked) byArchVariant[key].booked++;
  }
  for (const v of Object.values(byArchVariant)) {
    v.acceptance_rate_pct = Math.round((v.booked / v.total) * 1000) / 10;
  }

  // Walk-away reason catalog
  const walkAwayReasons = {};
  for (const r of valid) {
    if (r.walk_away_reason) walkAwayReasons[r.walk_away_reason] = (walkAwayReasons[r.walk_away_reason] || 0) + 1;
  }

  // Overall metrics
  const bookedCount = valid.filter(r => r.booked).length;
  const totalRevenue = valid.reduce((s, r) => s + (r.revenue_contribution_eur || 0), 0);
  const avgRevenuePerProspect = totalRevenue / n;

  return {
    modality: 'rate_strategy_test',
    total_prospects: n,
    overall_acceptance_rate_pct: Math.round((bookedCount / n) * 1000) / 10,
    avg_revenue_per_prospect_eur: Math.round(avgRevenuePerProspect * 100) / 100,
    total_simulated_revenue_eur: Math.round(totalRevenue * 100) / 100,
    variants_ranked_by_revenue: variants,
    winner_variant_by_revenue: winner_variant,
    variant_performance: byVariant,
    acceptance_by_market_variant: Object.values(byMarketVariant),
    acceptance_by_archetype_variant: Object.values(byArchVariant),
    top_walk_away_reasons: Object.entries(walkAwayReasons).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([reason, count]) => ({ reason, count })),
  };
}

module.exports = {
  id: 'rate_strategy_test',
  label: 'Rate Strategy Test',
  description: 'Simulates N prospects facing different rate variants to estimate revenue-optimum strategy by market and segment.',
  required_inputs: REQUIRED,
  optional_inputs: OPTIONAL,
  uses_target_star_sampling: false,

  validateInputs,
  buildAgentContext,
  runForAgent,
  aggregateResults,
  STAGES,
};
