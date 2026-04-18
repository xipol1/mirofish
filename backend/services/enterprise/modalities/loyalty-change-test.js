/**
 * Modality: Loyalty Change Test
 *
 * Simulates how a proposed change to a loyalty program (tier thresholds,
 * benefit modifications, earning rate changes, partnership additions)
 * affects retention and brand affinity across tiers and markets.
 *
 * Stages: review_current_status → exposure_to_change → emotional_reaction →
 *          reconsider_alternatives → final_intent.
 *
 * Output: retention risk by tier, tier migration patterns, likelihood of
 * switching to competitor programs, communication sensitivities.
 */

const { callAIJSON } = require('../../ai');
const culturalProfiles = require('../cultural-profiles');
const marketPacks = require('../market-packs');

const REQUIRED = ['program_current_state', 'program_proposed_change', 'audience'];
const OPTIONAL = [
  'agent_count', 'market_pack_ids', 'competitor_programs', 'property_country',
  'communication_channel',
];

const STAGES = [
  'review_current_status',
  'exposure_to_change',
  'emotional_reaction',
  'reconsider_alternatives',
  'final_intent',
];

const TIER_DISTRIBUTION = {
  none: 0.40,
  basic: 0.30,
  silver: 0.15,
  gold: 0.10,
  platinum: 0.04,
  ambassador: 0.01,
};

function validateInputs(raw) {
  const errors = [];
  if (!raw.program_current_state) errors.push('program_current_state is required — describe tiers, benefits, earning rate today');
  if (!raw.program_proposed_change) errors.push('program_proposed_change is required — describe the specific change being tested');
  if (!raw.audience) errors.push('audience is required');
  return { ok: errors.length === 0, errors, normalized: raw };
}

function sampleTier() {
  const entries = Object.entries(TIER_DISTRIBUTION);
  const total = entries.reduce((s, [, v]) => s + v, 0) || 1;
  let r = Math.random() * total;
  for (const [k, v] of entries) { r -= v; if (r <= 0) return k; }
  return entries[0][0];
}

function buildAgentContext({ persona, globalCtx }) {
  const archetypeId = persona.archetype_id || persona._archetype_id || 'business_traveler';

  // Higher archetype affinity toward loyalty programs = higher tier bias
  const tier_bias = {
    loyalty_maximizer: 3,
    business_traveler: 2,
    luxury_seeker: 2,
    honeymooner: 1,
    family_vacationer: 1,
    digital_nomad: 0,
    budget_optimizer: 0,
    event_attendee: 0,
  }[archetypeId] || 0;

  // Upgrade tier assignment with bias
  let currentTier = sampleTier();
  for (let i = 0; i < tier_bias; i++) {
    if (Math.random() < 0.55) currentTier = upgradeTier(currentTier);
  }

  const marketPackId = (globalCtx.market_pack_ids && globalCtx.market_pack_ids.length > 0)
    ? globalCtx.market_pack_ids[Math.floor(Math.random() * globalCtx.market_pack_ids.length)]
    : null;
  const pack = marketPackId ? marketPacks.get(marketPackId) : null;
  const clusterId = pack?.cultural_cluster_mapping || culturalProfiles.sampleClusterForMenorca();
  const cultural_context = culturalProfiles.buildCulturalContext({ clusterId, propertyCountry: globalCtx.property_country || 'ES' });

  // Stays per year at brand — correlates with tier
  const typical_stays_per_year = {
    none: Math.floor(Math.random() * 2),           // 0-1
    basic: Math.floor(Math.random() * 3) + 1,      // 1-3
    silver: Math.floor(Math.random() * 5) + 3,     // 3-7
    gold: Math.floor(Math.random() * 7) + 7,       // 7-13
    platinum: Math.floor(Math.random() * 10) + 15, // 15-24
    ambassador: Math.floor(Math.random() * 15) + 25, // 25-39
  }[currentTier];

  const years_as_member = Math.floor(Math.random() * (currentTier === 'ambassador' ? 12 : currentTier === 'platinum' ? 8 : 5)) + 1;

  const lifetime_points_balance = typical_stays_per_year * years_as_member * (800 + Math.random() * 1200);

  return {
    archetype_id: archetypeId,
    current_tier: currentTier,
    typical_stays_per_year,
    years_as_member,
    lifetime_points_balance: Math.round(lifetime_points_balance),
    cultural_context,
    market_pack: pack ? { id: pack.market_id, label: pack.label } : null,
  };
}

function upgradeTier(current) {
  const order = ['none', 'basic', 'silver', 'gold', 'platinum', 'ambassador'];
  const i = order.indexOf(current);
  return i >= 0 && i < order.length - 1 ? order[i + 1] : current;
}

async function runForAgent({ persona, agentCtx, globalCtx, onStage }) {
  const outputs = [];
  const state = {
    favorability_score: null,
    switch_intent_to_competitor: null,
    retention_intent_12m: null,
    tier_migration_signal: null,
  };

  for (const stageLabel of STAGES) {
    onStage({ stage: stageLabel, state: { ...state } });

    let result;
    try {
      result = await runLoyaltyStage({ stageLabel, persona, agentCtx, globalCtx, state, outputs });
    } catch (err) {
      console.error(`[loyalty-change] Stage ${stageLabel} failed:`, err.message.substring(0, 150));
      result = { stage: stageLabel, narrative: '(error)' };
    }

    if (result.favorability_score_0_100 != null) state.favorability_score = result.favorability_score_0_100;
    if (result.switch_intent != null) state.switch_intent_to_competitor = result.switch_intent;
    if (result.retention_intent_12m != null) state.retention_intent_12m = result.retention_intent_12m;
    if (result.tier_migration_signal) state.tier_migration_signal = result.tier_migration_signal;

    outputs.push(result);
  }

  return {
    archetype_id: agentCtx.archetype_id,
    persona: { name: persona.name, archetype_label: persona.archetype_label },
    persona_full: persona,
    current_tier: agentCtx.current_tier,
    typical_stays_per_year: agentCtx.typical_stays_per_year,
    years_as_member: agentCtx.years_as_member,
    lifetime_points_balance: agentCtx.lifetime_points_balance,
    cultural_context: agentCtx.cultural_context ? {
      culture_cluster: agentCtx.cultural_context.culture_cluster,
      origin_country_iso: agentCtx.cultural_context.origin_country_iso,
    } : null,
    market_pack: agentCtx.market_pack,
    stages: outputs,
    final_favorability_0_100: state.favorability_score,
    switch_intent_to_competitor_pct: state.switch_intent_to_competitor,
    retention_intent_12m_pct: state.retention_intent_12m,
    tier_migration_signal: state.tier_migration_signal,
    churn_risk: state.switch_intent_to_competitor != null ? state.switch_intent_to_competitor > 50 : null,
    completed_at: Date.now(),
  };
}

async function runLoyaltyStage({ stageLabel, persona, agentCtx, globalCtx, state, outputs }) {
  const prompt = buildLoyaltyStagePrompt({ stageLabel, persona, agentCtx, globalCtx, state, outputs });
  const raw = await callAIJSON(prompt, { maxTokens: 700, temperature: 0.7 });
  return normalizeLoyaltyStageOutput(raw, stageLabel);
}

function buildLoyaltyStagePrompt({ stageLabel, persona, agentCtx, globalCtx, state, outputs }) {
  const culturalBlock = agentCtx.cultural_context?.narrative_block || '';
  const competitors = (globalCtx.competitor_programs || []).map((c, i) => `  ${i + 1}. ${c}`).join('\n') || '(no specific competitor programs listed)';
  const commChannel = globalCtx.communication_channel || 'email notification';

  const stagePrompts = {
    review_current_status: `You are a loyalty program member. Reflect on your current relationship with the program. You're ${agentCtx.current_tier} tier with ${agentCtx.typical_stays_per_year} stays/year for ${agentCtx.years_as_member} years. Lifetime points: ${agentCtx.lifetime_points_balance}. What do you value? What frustrates you?`,
    exposure_to_change: `The program just announced this change (via ${commChannel}):\n\n---\n${JSON.stringify(globalCtx.program_proposed_change, null, 2)}\n---\n\nRead it as this persona would read an actual email/app notification. First impression?`,
    emotional_reaction: `Process the emotional impact. Does it feel like a devaluation, an upgrade, or neutral? How does it affect your sense of being valued as a ${agentCtx.current_tier} member?`,
    reconsider_alternatives: `Given the change, would you consider shifting your loyalty? Think about competitor programs and generic OTA booking.`,
    final_intent: `Your final position. Over the next 12 months: stay loyal, reduce stays, shift to competitor, or unclear?`,
  };

  return `You are a loyalty program member reacting to a proposed change. Stay in character.

=== YOU ARE ===
Name: ${persona.name}
Archetype: ${persona.archetype_label}
Loyalty tier: ${agentCtx.current_tier.toUpperCase()}
Stays per year: ${agentCtx.typical_stays_per_year}
Years as member: ${agentCtx.years_as_member}
Lifetime points balance: ${agentCtx.lifetime_points_balance}

${culturalBlock}

=== CURRENT PROGRAM (today) ===
${JSON.stringify(globalCtx.program_current_state, null, 2)}

=== PROPOSED CHANGE ===
${JSON.stringify(globalCtx.program_proposed_change, null, 2)}

=== COMPETITOR PROGRAMS YOU KNOW ===
${competitors}

=== PREVIOUS STAGES ===
${outputs.map(o => `[${o.stage}] ${o.narrative?.substring(0, 180)}`).join('\n') || '(first stage)'}

=== CURRENT STAGE: ${stageLabel} ===
${stagePrompts[stageLabel]}

Return JSON:
{
  "narrative": "2-4 sentences first-person.",
  "favorability_score_0_100": "your current favorability toward the program (0-100). Track how this shifts across stages.",
  "switch_intent": "0-100 probability you\'d switch to a competitor program in next 12 months. Null if not yet decided.",
  "retention_intent_12m": "0-100 probability you\'ll stay loyal with this program next 12m. Null if not yet decided.",
  "tier_migration_signal": "stay_current_tier | upgrade_interest | downgrade_risk | churn_risk | null",
  "key_concern": "1 short sentence — what about the change bothers you most, or null",
  "key_attraction": "1 short sentence — what you still like about the program, or null",
  "would_share_with_peers": "boolean — would you mention this change in conversation with traveling peers",
  "communication_tone_reaction": "positive | neutral | defensive | angry | confused"
}`;
}

function normalizeLoyaltyStageOutput(raw, stageLabel) {
  return {
    stage: stageLabel,
    narrative: String(raw?.narrative || '').substring(0, 900),
    favorability_score_0_100: raw?.favorability_score_0_100 != null ? Math.max(0, Math.min(100, Number(raw.favorability_score_0_100))) : null,
    switch_intent: raw?.switch_intent != null ? Math.max(0, Math.min(100, Number(raw.switch_intent))) : null,
    retention_intent_12m: raw?.retention_intent_12m != null ? Math.max(0, Math.min(100, Number(raw.retention_intent_12m))) : null,
    tier_migration_signal: raw?.tier_migration_signal || null,
    key_concern: raw?.key_concern || null,
    key_attraction: raw?.key_attraction || null,
    would_share_with_peers: !!raw?.would_share_with_peers,
    communication_tone_reaction: raw?.communication_tone_reaction || null,
  };
}

function aggregateResults(agentRecords, globalCtx) {
  const valid = agentRecords.filter(r => r && !r.error);
  const n = valid.length;
  if (n === 0) return { modality: 'loyalty_change_test', total: 0 };

  // Retention vs churn risk by tier
  const byTier = {};
  for (const r of valid) {
    const tier = r.current_tier || 'unknown';
    if (!byTier[tier]) byTier[tier] = { tier, total: 0, retention_scores: [], switch_scores: [], churn_risk_count: 0, favorability_scores: [] };
    byTier[tier].total++;
    if (typeof r.retention_intent_12m_pct === 'number') byTier[tier].retention_scores.push(r.retention_intent_12m_pct);
    if (typeof r.switch_intent_to_competitor_pct === 'number') byTier[tier].switch_scores.push(r.switch_intent_to_competitor_pct);
    if (r.churn_risk) byTier[tier].churn_risk_count++;
    if (typeof r.final_favorability_0_100 === 'number') byTier[tier].favorability_scores.push(r.final_favorability_0_100);
  }
  for (const v of Object.values(byTier)) {
    v.avg_retention_intent = avg(v.retention_scores);
    v.avg_switch_intent = avg(v.switch_scores);
    v.avg_favorability = avg(v.favorability_scores);
    v.churn_risk_pct = Math.round((v.churn_risk_count / v.total) * 1000) / 10;
    delete v.retention_scores;
    delete v.switch_scores;
    delete v.favorability_scores;
  }

  // Migration signals
  const migrationSignals = {};
  for (const r of valid) {
    const s = r.tier_migration_signal || 'unknown';
    migrationSignals[s] = (migrationSignals[s] || 0) + 1;
  }

  // Communication tone reactions (from exposure_to_change stage)
  const toneMix = {};
  for (const r of valid) {
    const exposureStage = (r.stages || []).find(s => s.stage === 'exposure_to_change');
    const tone = exposureStage?.communication_tone_reaction || 'unknown';
    toneMix[tone] = (toneMix[tone] || 0) + 1;
  }

  // Concerns ranked
  const concernCatalog = {};
  for (const r of valid) {
    for (const st of (r.stages || [])) {
      if (st.key_concern) {
        const k = st.key_concern.toLowerCase().substring(0, 80);
        concernCatalog[k] = (concernCatalog[k] || 0) + 1;
      }
    }
  }

  // Favorability shift — from first stage to final
  const favShifts = valid.map(r => {
    const first = (r.stages || []).find(s => s.favorability_score_0_100 != null)?.favorability_score_0_100;
    const last = r.final_favorability_0_100;
    if (first == null || last == null) return null;
    return { archetype: r.archetype_id, tier: r.current_tier, shift: last - first };
  }).filter(x => x != null);

  const avgFavShift = favShifts.length ? avg(favShifts.map(f => f.shift)) : null;

  // Overall
  const overallChurn = valid.filter(r => r.churn_risk).length;
  const overallRetention = avg(valid.map(r => r.retention_intent_12m_pct).filter(x => typeof x === 'number'));

  // By market
  const byMarket = {};
  for (const r of valid) {
    const mk = r.market_pack?.id || 'unknown';
    if (!byMarket[mk]) byMarket[mk] = { market: mk, total: 0, churn_count: 0, retention_scores: [] };
    byMarket[mk].total++;
    if (r.churn_risk) byMarket[mk].churn_count++;
    if (typeof r.retention_intent_12m_pct === 'number') byMarket[mk].retention_scores.push(r.retention_intent_12m_pct);
  }
  for (const v of Object.values(byMarket)) {
    v.avg_retention = avg(v.retention_scores);
    v.churn_risk_pct = Math.round((v.churn_count / v.total) * 1000) / 10;
    delete v.retention_scores;
  }

  return {
    modality: 'loyalty_change_test',
    total_members: n,
    overall_churn_risk_pct: Math.round((overallChurn / n) * 1000) / 10,
    overall_avg_retention_intent: overallRetention != null ? Math.round(overallRetention * 10) / 10 : null,
    avg_favorability_shift_from_exposure: avgFavShift != null ? Math.round(avgFavShift * 10) / 10 : null,
    by_tier: Object.values(byTier),
    tier_migration_signals: migrationSignals,
    communication_tone_reactions: toneMix,
    top_concerns: Object.entries(concernCatalog).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([concern, count]) => ({ concern, count })),
    by_market: Object.values(byMarket),
  };
}

function avg(arr) {
  if (!arr || arr.length === 0) return null;
  return Math.round((arr.reduce((a, b) => a + b, 0) / arr.length) * 10) / 10;
}

module.exports = {
  id: 'loyalty_change_test',
  label: 'Loyalty Change Test',
  description: 'Simulates how a proposed change to a loyalty program affects retention, churn risk, and tier migration across markets and archetypes.',
  required_inputs: REQUIRED,
  optional_inputs: OPTIONAL,
  uses_target_star_sampling: false,

  validateInputs,
  buildAgentContext,
  runForAgent,
  aggregateResults,
  STAGES,
  TIER_DISTRIBUTION,
};
