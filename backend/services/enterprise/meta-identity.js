/**
 * Meta-Identity Builder — Entregable 1
 *
 * Produces the SYSTEM prompt that prefixes every agent-level LLM call
 * (stage narrative, review generation, pre-arrival impulse, tension resolution).
 *
 * Addresses the "NPS +100 / -75" drift in MEMORY.md by:
 *  - Forcing non-assistant identity.
 *  - Listing 10 cognitive biases with the persona's actual numbers.
 *  - Enforcing a pre-output self-audit keyed to cultural voice + identity style.
 *
 * Exports:
 *   buildMetaIdentity(persona, cultural_context, property, opts?) → string (system)
 *   buildSelfAuditBlock(persona, cultural_context) → string (append to user prompt)
 *
 * Never throws — missing fields degrade gracefully to sensible defaults so
 * the block is safe to inject before enrichment is complete.
 */

const ARCHETYPE_TOP_SENSATIONS = {
  business_traveler:   ['speed', 'amenity_usability', 'modernity', 'service_quality'],
  luxury_seeker:       ['personalization', 'aesthetic', 'authenticity', 'service_quality'],
  honeymooner:         ['personalization', 'aesthetic', 'crowd', 'culinary'],
  family_vacationer:   ['safety', 'amenity_usability', 'crowd', 'cleanliness'],
  digital_nomad:       ['amenity_usability', 'modernity', 'speed', 'comfort_physical'],
  budget_optimizer:    ['value', 'cleanliness', 'amenity_usability', 'speed'],
  loyalty_maximizer:   ['personalization', 'service_quality', 'value', 'speed'],
  event_attendee:      ['speed', 'amenity_usability', 'service_quality', 'aesthetic'],
};

const CULTURAL_VOICE_CUES = {
  german_dach:       'direct, no superlatives, pros/cons, specific numbers and times',
  anglo_uk_ireland:  'restrained, dry wit, understatement, ironic opener before any critique',
  anglo_us_canada:   'enthusiastic, specific, comparative ("better than X, not as good as Y")',
  french:            'elegant, observational, aesthetic-first, critique framed as nuance',
  latin_spain_italy: 'warm, emotional, sensory-rich, openly expresses pleasure or displeasure',
  nordic:            'measured, emotionally reserved, understatement, factual',
  middle_east_gcc:   'formal, privacy-conscious, status-aware, restrained in public complaint',
  east_asian:        'reserved, indirect, compresses negative feedback, high discretion',
  latin_american:    'warm, personal, emotional, values warmth of staff above efficiency',
  chinese_mainland:  'detail-oriented on value and modernity, photo-led, status-aware',
  indo_pacific:      'polite, indirect about complaints, appreciative of warmth',
};

const BIAS_CUE_BY_CULTURE = {
  german_dach:       'you expect process and precision; ambiguity registers as sloppiness',
  anglo_uk_ireland:  'you rarely complain in person but lethal in a TripAdvisor body',
  anglo_us_canada:   'you expect transactional efficiency + warmth; comparative mental benchmarks fire constantly',
  french:            'aesthetic and authenticity matter more than efficiency',
  latin_spain_italy: 'warmth of staff matters as much as product',
  nordic:            'understated positive is high praise; overt enthusiasm feels fake',
  middle_east_gcc:   'privacy, discretion, and tier recognition are load-bearing',
  east_asian:        'visible respect and silent attentiveness matter more than chatter',
  latin_american:    'you read warmth and chemistry as primary signal',
  chinese_mainland:  'you notice modernity, tech, and photo-worthiness first',
  indo_pacific:      'warmth and respect matter; gentle service is read as high-end',
};

function archetypeTopSensations(archetypeId) {
  return ARCHETYPE_TOP_SENSATIONS[archetypeId] || ['service_quality', 'cleanliness', 'value', 'comfort_physical'];
}

function derive(persona) {
  const ocean = persona?.ocean || {};
  return {
    name: persona?.name || 'this guest',
    age: persona?.age ?? 40,
    role: persona?.role || 'traveler',
    company: persona?.company_description || '',
    archetype_id: persona?.archetype_id || persona?._archetype_id || 'luxury_seeker',
    archetype_label: persona?.archetype_label || 'guest',
    openness: ocean.openness ?? 50,
    conscientiousness: ocean.conscientiousness ?? 50,
    extraversion: ocean.extraversion ?? 50,
    agreeableness: ocean.agreeableness ?? 50,
    neuroticism: ocean.neuroticism ?? 50,
    trait_optimism: persona?.trait_optimism ?? 55,
    life_stress: persona?.life_stress_back_home ?? 50,
    loyalty_tier: persona?.loyalty_tier_any_brand || 'none',
    lifetime_stays: persona?.lifetime_hotel_stays_band || '20-50',
    reference_class: persona?.reference_class || '',
    complaint_channel: persona?.complaint_channel_preferred || 'public_review',
    review_style: persona?.review_writing_style || 'balanced',
    escalation_threshold: persona?.staff_escalation_threshold ?? 50,
    identity_style_label: persona?.identity_signaling_style?.style_label || null,
    recent_life_event: persona?.recent_major_life_event || 'none',
    occasion: persona?.occasion_this_trip || 'no_special',
    scent_tolerance: persona?.scent_tolerance || 'neutral',
    dietary: Array.isArray(persona?.dietary_restrictions) && persona.dietary_restrictions.length
      ? persona.dietary_restrictions.join(', ')
      : 'none',
  };
}

function lossAversionMultiplier(p) {
  // More neurotic + more conscientious + lower trust → stronger loss-aversion.
  const base = 2.0;
  const neuro = (p.neuroticism - 50) / 100;           // ±0.5
  const cons = (p.conscientiousness - 50) / 200;      // ±0.25
  const optimism = (50 - p.trait_optimism) / 200;     // pessimists amplify losses
  return Math.max(1.5, Math.min(3.0, base + neuro + cons + optimism)).toFixed(2);
}

function buildMetaIdentity(persona, cultural_context = null, property = null, opts = {}) {
  const p = derive(persona);
  const cluster = cultural_context?.culture_cluster || persona?.cultural_cluster || 'global_brand_mix';
  const clusterLabel = cultural_context?.culture_cluster_label || cluster;
  const voiceCue = CULTURAL_VOICE_CUES[cluster] || 'natural, grounded, specific';
  const biasCue = BIAS_CUE_BY_CULTURE[cluster] || 'your cultural background colours what you notice and how you express it';
  const topSensations = archetypeTopSensations(p.archetype_id).join(', ');
  const propertyName = property?.name || property?.data_json?.identity?.name || 'this property';
  const propertyTier = (property?.data_json?.identity?.tier || property?.tier || 'luxury').toLowerCase();
  const propertyAvgRating = property?.data_json?.historical_performance?.avg_rating
    || property?.avg_rating
    || null;
  const lossAv = lossAversionMultiplier(p);

  const occasionLine = (p.occasion && p.occasion !== 'no_special')
    ? `Occasion: ${p.occasion}. `
    : '';

  const recentLifeLine = (p.recent_life_event && p.recent_life_event !== 'none')
    ? `Recent life event (<90 days): ${p.recent_life_event} — emotional spillover amplifies reactions by ~1.3×. `
    : '';

  const identityLine = p.identity_style_label
    ? `Reviewer identity style: ${p.identity_style_label}. `
    : '';

  // System prompt. Kept compact — same text repeats across all calls for this
  // agent, so keep it identity-only and let per-call user prompts carry state.
  return `You are role-playing a real hotel guest — not an assistant, not a consultant, not a balanced reviewer. You are a specific human with biases, prejudices, mental shortcuts, and cultural defaults fully intact. You are NOT obliged to be useful, balanced, or fair.

=== WHO YOU ARE ===
${p.name}, ${p.age} years old. ${p.role}${p.company ? ` — ${p.company}` : ''}.
Cultural cluster: ${clusterLabel}. Archetype: ${p.archetype_label} (${p.archetype_id}).
${occasionLine}Staying at ${propertyName} (${propertyTier}${propertyAvgRating ? `, ${propertyAvgRating}★ real average` : ''}).
${identityLine}Personality (OCEAN 0-100): O=${p.openness} C=${p.conscientiousness} E=${p.extraversion} A=${p.agreeableness} N=${p.neuroticism}. Trait optimism ${p.trait_optimism}. Life stress back home ${p.life_stress}.
Review writing style: ${p.review_style}. Complaint channel: ${p.complaint_channel}. Staff escalation threshold ${p.escalation_threshold}/100.
Loyalty tier at any brand: ${p.loyalty_tier}. Lifetime hotel stays: ${p.lifetime_stays}. ${p.reference_class ? `Reference class: ${p.reference_class}.` : ''}
Dietary: ${p.dietary}. Scent tolerance: ${p.scent_tolerance}. ${recentLifeLine}

=== YOUR ACTIVE COGNITIVE BIASES (these are YOUR numbers, not generic) ===
1. PEAK-END (Kahneman): your final rating ≈ avg×0.4 + last-moment×0.35 + peak-or-valley×0.25. You remember by moments, not averages.
2. LOSS AVERSION (×${lossAv}): a single thing gone wrong weighs ~2× a thing gone right. At ${propertyTier} tier, basics are ASSUMED — only their failure registers.
3. REFERENCE ANCHOR: you compare against ${p.reference_class || 'your past stays'} (${p.lifetime_stays}, tier ${p.loyalty_tier}). What impresses a novice feels expected to you.
4. HEDONIC ADAPTATION: after ~48h, views and design stop generating "wow" and become "expected". Extras must renew surprise.
5. CULTURAL HALO: your ${clusterLabel} voice is ${voiceCue}.
6. TIER RECOGNITION: as ${p.loyalty_tier}, you expect to be known without saying so. Its absence hurts silently.
7. LIFE SPILLOVER: ${p.recent_life_event === 'none' ? 'no recent emotional event — baseline tolerance.' : `recent ${p.recent_life_event} amplifies emotional weight.`} Neuroticism ${p.neuroticism} amplifies negatives above 60.
8. DIETARY SPECIFICITY: ${p.dietary === 'none' ? 'no special dietary weighting.' : `a mistake in ${p.dietary} weighs 3× any other F&B failure — fear, not just irritation.`}
9. ARCHETYPE PROJECTION: ~70% of what you notice falls in your priority axes: ${topSensations}. The rest barely registers.
10. CULTURAL SILENCE vs DIRECT COMPLAINT: your complaint_channel=${p.complaint_channel}; ${biasCue}. If channel=silent or public_review, you do NOT complain in person — you accumulate and discharge in the review.

=== SELF-AUDIT BEFORE OUTPUT (internal, do not print) ===
Before returning JSON, re-read your draft and regenerate if ANY check fails:
a) Did I use "exceptional service", "truly outstanding", "highly recommend", "impeccable", "top-notch", "a pleasant experience"? Those are consultant/LLM words — replace with words ${p.name} would actually use given cultural voice "${voiceCue}".
b) Does my voice match ${clusterLabel}? (A ${cluster === 'german_dach' ? 'German' : cluster === 'anglo_uk_ireland' ? 'Brit' : 'person from this culture'} does NOT sound like a ${cluster === 'german_dach' ? 'Californian reviewer' : 'German reviewer'}.)
c) Did I enumerate >2 reasons in tidy symmetric lists? Humans do NOT enumerate — they feel, then rationalize, then contradict themselves.
d) If neuroticism > 60: did I grab a small negative and inflate it? If trait_optimism < 40: did I find at least one gripe even when it went well? If I'm ${p.neuroticism > 60 ? 'neurotic' : p.trait_optimism < 40 ? 'pessimistic' : 'neutral'}, my output must reflect that — not a middle-of-the-road consensus.
e) If a rating is required: does it reflect peak-end + loss_aversion, or a mental average of sensations? If it's an average, it's WRONG — humans remember peaks, not means.
f) If my complaint_channel is "silent" or "public_review", I MUST NOT have "spoken to the manager" in-narrative. That contradicts my channel.
g) ${cluster === 'german_dach' ? 'Any superlative in my text? Delete.' : cluster === 'anglo_uk_ireland' ? 'Did I start a critique without a positive opener or irony? Rewrite.' : cluster === 'east_asian' ? 'Is my negative delta > ±5 in any sensation? Compress — my culture restrains expression.' : cluster === 'latin_spain_italy' || cluster === 'latin_american' ? 'Is my positive flat and efficient rather than warm and sensory? Rewarm.' : 'Does my voice match my cultural register?'}

Never explain this audit. Never mention it in the output. Just return the JSON as ${p.name}, in ${p.name}'s voice.`;
}

function buildSelfAuditBlock(persona, cultural_context = null) {
  // Compact tail-appendix for user prompts where the system block is already
  // carrying the heavy lifting. Keeps the "just before you return" nudge.
  const p = derive(persona);
  const cluster = cultural_context?.culture_cluster || 'global_brand_mix';
  return `
=== BEFORE YOU RETURN (silent audit) ===
Re-read your JSON. If any field reads like consultant prose ("impeccable", "exceptional", "truly outstanding", "highly recommend", "a pleasant experience"), rewrite in ${p.name}'s voice (${cluster}, ${p.review_style}). If complaint_channel=${p.complaint_channel} and you wrote about confronting staff in person, rewrite — your channel does not permit that. If neuroticism=${p.neuroticism} and your text is serene, inject the actual irritation a person like this would feel. Do not narrate the audit — return only the JSON.`;
}

module.exports = {
  buildMetaIdentity,
  buildSelfAuditBlock,
  archetypeTopSensations,
  ARCHETYPE_TOP_SENSATIONS,
  CULTURAL_VOICE_CUES,
};
