/**
 * Tension Resolution — Entregable 2, PASO 4a
 *
 * Called ONCE per agent, after all stages finish and before review prediction.
 * Forces a forced-commitment decision: what does the guest do with the
 * accumulated friction? (complain_in_person / email_after / review_only /
 * silent / combo). This decision is made BEFORE the star rating so the
 * rating cannot contradict the chosen channel.
 *
 * This closes the "post-hoc reasoning" failure mode — without it, the LLM
 * decides the rating first and invents a consistent justification. With it,
 * the channel is committed, and downstream review generation must respect
 * "silent" or "public_review" behavior.
 */

const { callAIJSON } = require('../ai');
const { temperatureForAgent } = require('./temperature-mapper');
const { buildMetaIdentity } = require('./meta-identity');

async function resolveTension({ stay, persona, cultural_context, property }) {
  try {
    const system = buildMetaIdentity(persona, cultural_context, property);
    const prompt = buildTensionPrompt({ stay, persona, cultural_context });
    const temperature = temperatureForAgent(persona, 'tension');
    const result = await callAIJSON(prompt, { system, maxTokens: 700, temperature });
    return normalizeTension(result);
  } catch (err) {
    console.error('[tension-resolution] failed:', err.message?.substring(0, 140));
    return fallbackTension(persona);
  }
}

function buildTensionPrompt({ stay, persona, cultural_context }) {
  const cluster = cultural_context?.culture_cluster || 'global_brand_mix';
  const stages = Array.isArray(stay?.stages) ? stay.stages : [];
  const stageCount = stages.length;

  const negatives = [];
  const positives = [];
  for (const s of stages) {
    for (const m of (s.moments_negative || [])) {
      const desc = typeof m === 'string' ? m : (m?.description || '');
      if (desc) negatives.push({ stage: s.stage, text: String(desc).substring(0, 180) });
    }
    for (const m of (s.moments_positive || [])) {
      const desc = typeof m === 'string' ? m : (m?.description || '');
      if (desc) positives.push({ stage: s.stage, text: String(desc).substring(0, 180) });
    }
  }

  const finalSensations = stay?.final_sensation_state || {};
  const rawBalance = Object.entries(finalSensations)
    .filter(([k, v]) => !k.startsWith('_') && typeof v === 'number')
    .map(([k, v]) => `${k}=${Math.round(v)}`)
    .join(', ');

  const negList = negatives.slice(0, 8).map(n => `  • [${n.stage}] ${n.text}`).join('\n') || '  (none recorded)';
  const posList = positives.slice(0, 5).map(p => `  • [${p.stage}] ${p.text}`).join('\n') || '  (none recorded)';

  return `The stay is effectively over. You are finishing checkout / in the lobby / heading out the door. You have ${stageCount} stage(s) of experience behind you. Before you leave the property mentally, you must decide what you're going to DO with the friction you experienced. This decision is made NOW and does not change in the review.

=== YOUR COMPLAINT PROFILE ===
Complaint channel preferred: ${persona?.complaint_channel_preferred || 'public_review'}
Staff escalation threshold: ${persona?.staff_escalation_threshold ?? 50}/100 (higher = more tolerant before escalating)
Cultural cluster: ${cluster}
Review writing style: ${persona?.review_writing_style || 'balanced'}

=== FRICTION CAPTURED DURING STAY ===
Negative moments:
${negList}

Positive moments (for balance):
${posList}

Final sensation state (0-100): ${rawBalance}

=== RULES ===
- german_dach + direct_written_detailed → email_after with surgical detail; no scene at checkout.
- anglo_uk_ireland + reserved_then_public_review → review_only, ALWAYS. Never complains in person. Smiles and stabs on TripAdvisor.
- latam / middle_east_gcc → in_person if extraversion > 50, formally.
- east_asian → silent + slightly lower rating without verbal complaint.
- escalation_threshold > 80 → probably silent even when warranted.

=== OUTPUT JSON ===
{
  "friction_points_ranked": [
    {"point": "short description", "intensity": 0-100, "stage_id": "stage where it originated"}
  ],
  "action_chosen": "complain_in_person | email_after | review_only | silent | combo",
  "action_target": "frontdesk | manager | concierge | public_platform | none",
  "what_you_will_say_verbatim": "exact text in your voice (empty string or null if silent/review_only)",
  "emotional_release_achieved": 0-100,
  "will_affect_final_rating_by_stars": -2 to +1,
  "expected_public_review_will_mention": true/false
}

If there was no real friction (final sensations balanced, no negative moments), return:
  friction_points_ranked: [], action_chosen: "silent", action_target: "none", what_you_will_say_verbatim: null, emotional_release_achieved: 0, will_affect_final_rating_by_stars: 0.

Remember: if your channel is "silent" or "public_review", you did NOT say anything in person — do not contradict your own profile.`;
}

function normalizeTension(result) {
  if (!result || typeof result !== 'object') return null;
  const validActions = ['complain_in_person', 'email_after', 'review_only', 'silent', 'combo'];
  const validTargets = ['frontdesk', 'manager', 'concierge', 'public_platform', 'none'];
  const action = validActions.includes(result.action_chosen) ? result.action_chosen : 'silent';
  return {
    friction_points_ranked: Array.isArray(result.friction_points_ranked)
      ? result.friction_points_ranked.slice(0, 6).map(f => ({
          point: String(f?.point || '').substring(0, 160),
          intensity: Math.max(0, Math.min(100, Number(f?.intensity) || 0)),
          stage_id: String(f?.stage_id || '').substring(0, 40),
        }))
      : [],
    action_chosen: action,
    action_target: validTargets.includes(result.action_target) ? result.action_target : 'none',
    what_you_will_say_verbatim: result.what_you_will_say_verbatim
      ? String(result.what_you_will_say_verbatim).substring(0, 400)
      : null,
    emotional_release_achieved: Math.max(0, Math.min(100, Number(result.emotional_release_achieved) || 0)),
    will_affect_final_rating_by_stars: Math.max(-2, Math.min(1, Number(result.will_affect_final_rating_by_stars) || 0)),
    expected_public_review_will_mention: !!result.expected_public_review_will_mention,
  };
}

function fallbackTension(persona) {
  const channel = persona?.complaint_channel_preferred || 'public_review';
  return {
    friction_points_ranked: [],
    action_chosen: channel === 'in_person' ? 'complain_in_person'
                 : channel === 'email_manager' ? 'email_after'
                 : channel === 'public_review' ? 'review_only'
                 : 'silent',
    action_target: channel === 'public_review' ? 'public_platform' : 'none',
    what_you_will_say_verbatim: null,
    emotional_release_achieved: 0,
    will_affect_final_rating_by_stars: 0,
    expected_public_review_will_mention: channel === 'public_review',
    _fallback: true,
  };
}

module.exports = {
  resolveTension,
};
