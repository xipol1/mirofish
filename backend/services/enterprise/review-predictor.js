/**
 * Review Predictor — turns a simulated stay into a realistic predicted review.
 *
 * Inputs:
 *   - stay result (narrative, sensations, moments, expenses)
 *   - archetype behavior (review_behavior block)
 *   - property info (brand, tier, location)
 *   - calibration from real reviews (dataset-enriched phrase bank if available)
 *
 * Outputs:
 *   - platform selection (TripAdvisor / Booking / Google / etc.) based on archetype probabilities
 *   - star rating (from sensation score)
 *   - title + body text written in the archetype's voice
 *   - tagged themes
 *   - predicted repeat/recommend booleans
 *   - predicted social-share probability
 */

const { callAIJSON } = require('../ai');
const datasets = require('../datasets');
const { injectImperfections } = require('./review-imperfection');
const path = require('path');
const fs = require('fs');

const CALIBRATION_PATH = path.join(__dirname, '..', '..', 'data', 'industries', 'hospitality', 'review_calibration.json');
const BEHAVIORS_PATH = path.join(__dirname, '..', '..', 'data', 'industries', 'hospitality', 'stay_behaviors.json');

let _calib = null, _behaviors = null;
function calibration() { if (!_calib) _calib = JSON.parse(fs.readFileSync(CALIBRATION_PATH, 'utf-8')); return _calib; }
function behaviors() { if (!_behaviors) _behaviors = JSON.parse(fs.readFileSync(BEHAVIORS_PATH, 'utf-8')); return _behaviors; }

function weightedPick(probMap) {
  const entries = Object.entries(probMap);
  const total = entries.reduce((s, [, p]) => s + p, 0) || 1;
  let r = Math.random() * total;
  for (const [key, p] of entries) {
    r -= p;
    if (r <= 0) return key;
  }
  return entries[entries.length - 1][0];
}

function selectPlatform(archetypeId, culturalContext = null) {
  // Culture-first platform selection: nationality dominates platform choice
  // empirically. Fall back to archetype preference only when no cultural
  // context is available or the culture has no explicit platform prefs.
  const culturalPrefs = culturalContext?.review_platform_preference;
  if (culturalPrefs && Object.keys(culturalPrefs).length > 0) {
    return weightedPick(culturalPrefs);
  }
  const archetype = behaviors().archetypes[archetypeId];
  const prefs = archetype?.review_behavior?.platform_preference || { google: 1 };
  return weightedPick(prefs);
}

function shouldWriteReview(archetypeId) {
  const archetype = behaviors().archetypes[archetypeId];
  const prob = archetype?.review_behavior?.write_review_probability ?? 0.3;
  return Math.random() < prob;
}

function getTypicalLength(archetypeId, platform) {
  const archetype = behaviors().archetypes[archetypeId];
  const base = archetype?.review_behavior?.typical_length_words || [100, 300];
  const platformOverride = calibration().review_structure_by_platform?.[platform]?.typical_length_words;
  return platformOverride || base;
}

const LANGUAGE_NAMES = {
  en: 'English', es: 'Spanish', de: 'German', fr: 'French', it: 'Italian',
  pt: 'Portuguese', nl: 'Dutch', pl: 'Polish', ru: 'Russian', sv: 'Swedish', da: 'Danish',
  no: 'Norwegian', fi: 'Finnish', ja: 'Japanese', zh: 'Chinese', ar: 'Arabic',
};

function deriveReviewLanguage({ culturalContext, persona, platform }) {
  const nativeLang = culturalContext?.native_language
    || culturalContext?.language
    || persona?.native_language
    || 'en';
  // Platform norms: US-centric platforms still see some natives write in English,
  // but for synthetic coherence we prefer native.
  return String(nativeLang).toLowerCase().split('-')[0].slice(0, 2) || 'en';
}

async function predictReview({ stay, persona, property = null, dataset_phrase_bank = null, cultural_context = null }) {
  const archetypeId = stay.archetype_id;

  // Auto-pull dataset phrases if no explicit bank passed — uses Kaggle TripAdvisor samples
  if (!dataset_phrase_bank) {
    const stars = stay.sensation_summary?.stars || 3;
    const tone = stars >= 4 ? 'positive' : stars <= 2 ? 'negative' : 'mixed';
    dataset_phrase_bank = datasets.samplePhrasesForPredictor({ target_sentiment: tone, limit: 10 });
  }
  const archetype = behaviors().archetypes[archetypeId];

  // Cultural-aware platform selection: the culture's review_platform_preference
  // overrides the archetype default, since real-world platform mix is primarily
  // driven by nationality (Germans → Booking, Brits → TripAdvisor, Chinese →
  // Xiaohongshu), not archetype.
  const ctxCulture = cultural_context || stay.cultural_context || null;
  const platform = selectPlatform(archetypeId, ctxCulture);
  const [lenMinBase, lenMaxBase] = getTypicalLength(archetypeId, platform);
  const lenMult = ctxCulture?.review_length_multiplier || 1.0;
  const lenMin = Math.round(lenMinBase * lenMult);
  const lenMax = Math.round(lenMaxBase * lenMult);

  // Pick native language — used for both the LLM instruction and the output metadata
  const reviewLangCode = deriveReviewLanguage({ culturalContext: ctxCulture, persona, platform });
  const reviewLangName = LANGUAGE_NAMES[reviewLangCode] || 'English';
  const nationality = ctxCulture?.nationality || ctxCulture?.culture_cluster || 'international';

  const willWrite = shouldWriteReview(archetypeId);
  const sensationSummary = stay.sensation_summary || {};
  const stars = sensationSummary.stars || 3;
  const nps = sensationSummary.nps ?? 0;

  const positiveCalibrationKey = `${archetypeId}_positive`;
  const negativeCalibrationKey = `${archetypeId}_negative`;
  const positivePhrases = calibration().phrases_by_archetype_and_sentiment[positiveCalibrationKey] || [];
  const negativePhrases = calibration().phrases_by_archetype_and_sentiment[negativeCalibrationKey] || [];

  const datasetPhrases = dataset_phrase_bank ? extractRelevantDatasetPhrases(dataset_phrase_bank, { archetypeId, stars }) : [];

  if (!willWrite) {
    return {
      will_write_review: false,
      platform: null,
      star_rating: stars,
      nps,
      title: null,
      body: null,
      themes: [],
      would_recommend: nps >= 0,
      would_repeat: nps >= 20,
      social_media_share_probability: computeSocialProbability(archetype, stars),
      reason_not_writing: 'Archetype probability not met — guest departed without writing.',
    };
  }

  // Consolidation multipliers from the post-stay telling loop — moments that
  // were retold / posted / dramatized get weighted higher in the review.
  const tellingArc = stay.post_stay?.telling_arc || null;
  const consolidationMap = tellingArc?.consolidation_multipliers || {};

  function formatMoment(m) {
    const desc = m.description || m;
    const mult = consolidationMap[desc] ?? 1.0;
    let tag = '';
    if (mult >= 1.4) tag = ' [AMPLIFIED THROUGH RETELLING — central to the story]';
    else if (mult >= 1.2) tag = ' [reinforced through retelling]';
    else if (mult <= 0.6) tag = ' [FADED — barely remember]';
    else if (mult <= 0.85) tag = ' [faded]';
    if (tellingArc?.anchor_moment?.description === desc && tellingArc.anchor_moment?.dramatized) {
      tag = ' [DRAMATIZED — became "the story" of the trip, stronger than reality]';
    }
    return `• ${desc}${tag}`;
  }

  const positiveMoments = (stay.moments_positive || []).map(formatMoment).join('\n') || '(none)';
  const negativeMoments = (stay.moments_negative || []).map(formatMoment).join('\n') || '(none)';
  const finalSensations = stay.final_sensation_state || {};
  const expenses = stay.expense_summary || {};
  const tone = archetype?.review_behavior?.tone || 'balanced';

  // Asymmetric spend perception — surprise charges hurt ~2.2× voluntary spend
  const perceivedSpendImpact = expenses.perceived_value_impact_eur != null
    ? expenses.perceived_value_impact_eur
    : null;
  const surpriseItems = (expenses.itemized || []).filter(i => i?.is_surprise);
  const surpriseBlock = surpriseItems.length > 0
    ? `\nSurprise charges (weighted ~2.2× in perception vs voluntary spend):\n${surpriseItems.map(i => `  • ${i.item} — €${i.amount_eur} (${i.category})`).join('\n')}`
    : '';

  const samplePhrases = [...positivePhrases.slice(0, 3), ...negativePhrases.slice(0, 3), ...datasetPhrases.slice(0, 5)];

  // Identity-signaling voice from the enriched persona
  const idStyle = persona?.identity_signaling_style || null;
  const idVoiceBlock = idStyle ? `
=== YOUR REVIEWER IDENTITY (who you are as a reviewer) ===
Style: ${idStyle.style_label}
Vocabulary cues you naturally use: ${idStyle.vocab_cues.join(' | ')}
What you focus on: ${idStyle.detail_focus.join(', ')}
Signature move: ${idStyle.signature_move}
IMPORTANT: your review MUST read as this identity. Do not sound generic.` : '';

  // Cultural review voice
  const culturalVoice = ctxCulture?.review_voice || null;
  const culturalVoiceBlock = culturalVoice ? `
=== YOUR CULTURAL VOICE (how people from ${ctxCulture.culture_cluster_label || nationality} actually write reviews) ===
Directness: ${culturalVoice.directness}
Superlative use: ${culturalVoice.superlative_use}
Understatement tendency: ${culturalVoice.understatement_tendency}
Complaint framing: ${culturalVoice.complaint_framing}
Opener style: ${culturalVoice.opener_style}
Irony: ${culturalVoice.irony_use}
Structure: ${culturalVoice.structure_preference}
Signature phrase patterns you'd naturally use:
${(culturalVoice.signature_phrases_examples || []).map(p => `  • ${p}`).join('\n')}
Voice guidance: ${culturalVoice.voice_guidance}` : '';

  // Post-stay telling arc — the review is written AFTER the retelling loop
  const tellingBlock = tellingArc ? `
=== HOW YOUR MEMORY CONSOLIDATED (post-stay, pre-review) ===
You are writing this review ${tellingArc.days_until_review_written} day(s) after checkout.
In that time you retold the stay ${tellingArc.retelling_rounds_total} time(s)${tellingArc.had_partner_to_tell ? ' (including to your partner)' : ''}${tellingArc.social_post_made ? ' and posted about it on social media' : ''}.
${tellingArc.narrative_consolidation_summary}
Moments marked AMPLIFIED became central through retelling — they dominate the review.
Moments marked FADED receded — mention briefly or omit.
Moments marked DRAMATIZED are stronger in your memory than they were in reality — let that colour your tone.` : '';

  const prompt = `You are writing a realistic hotel review from the perspective of a guest who just completed their stay. Match the platform's conventions (${platform}) and the archetype's voice (${archetype?.label || archetypeId}). IMPORTANT: Write the review in ${reviewLangName} (ISO code: ${reviewLangCode}) using the natural vocabulary, idioms and sentence rhythm a native ${nationality} reviewer would use. Do NOT translate from English — think directly in ${reviewLangName}.

=== GUEST ===
Name: ${persona.name}
Archetype: ${archetype?.label}
Tone: ${tone}
Trip purpose: ${stay.trip_purpose || 'leisure'}
${idVoiceBlock}
${culturalVoiceBlock}
${tellingBlock}

=== STAY SUMMARY ===
Length: ${stay.stay_length_nights} nights
Property: ${property?.name || stay.property_name || 'this hotel'} (${property?.brand || ''})
Final sensation state (0-100): ${JSON.stringify(finalSensations, null, 2)}
Calculated star rating: ${stars}/5
Predicted NPS: ${nps}
Total ancillary spend: €${expenses.total_spend_eur || 0}${perceivedSpendImpact != null ? ` (perceived value impact after loss-aversion on surprises: €${perceivedSpendImpact})` : ''}${surpriseBlock}

=== POSITIVE MOMENTS (weighted by retelling consolidation) ===
${positiveMoments}

=== NEGATIVE MOMENTS (weighted by retelling consolidation) ===
${negativeMoments}

=== PLATFORM: ${platform} ===
Typical length: ${lenMin}-${lenMax} words.
Platform conventions: ${JSON.stringify(calibration().review_structure_by_platform?.[platform] || {})}

=== REAL REVIEW PHRASES FROM ARCHETYPE (reference — do not copy verbatim, adapt) ===
${samplePhrases.join('\n')}

=== YOUR TASK ===
Write the review in first person, past tense, matching the platform + identity + cultural voice. Weight moments by their consolidation tags (AMPLIFIED/FADED/DRAMATIZED). Include:
- A title (if platform uses titles) that matches your cultural opener style
- A body that reflects the CONSOLIDATED narrative, not the raw stay
- Use vocabulary cues and signature phrase patterns of your cultural and identity voice
- Star rating: ${stars}

Return this JSON:
{
  "title": "review title or null if platform doesn't use titles",
  "body": "the review text, ${lenMin}-${lenMax} words, in first person",
  "star_rating": ${stars},
  "nps": ${nps},
  "themes": ["list of theme tags from: cleanliness, service, location, value, food, wifi, noise, bed_comfort, amenities, spa, pool, breakfast, staff, check_in, check_out, parking, hidden_fees, loyalty_recognition, family_friendly, romantic, brand_consistency, room_size, view, kids_club, wifi_speed, cancellation"],
  "would_recommend": ${nps >= 0},
  "would_repeat_stay": ${nps >= 20},
  "mentioned_staff_name": true or false,
  "mentioned_competitor": true or false,
  "mentioned_price_or_fees": true or false,
  "language": "${reviewLangCode}"
}`;

  let result;
  try {
    result = await callAIJSON(prompt, { maxTokens: 900, temperature: 0.75 });
  } catch (err) {
    console.error('[review-predictor] LLM failed:', err.message.substring(0, 120));
    result = {
      title: `${stars}-star stay`,
      body: `Overall a ${stars}-star experience. ${positiveMoments.substring(0, 200)}. ${negativeMoments.substring(0, 200)}`,
      star_rating: stars,
      nps,
      themes: [],
      would_recommend: nps >= 0,
      would_repeat_stay: nps >= 20,
    };
  }

  // Post-process the LLM body with calibrated imperfections (typos, cultural
  // openers, filler, place-name variants, platform tweaks). Makes the review
  // read as human-written instead of LLM-clean.
  const imperfectBody = injectImperfections({
    body: result.body || '',
    platform,
    language: result.language || reviewLangCode,
    culturalCluster: ctxCulture?.culture_cluster || '_default',
    identityStyleKey: idStyle?.style_key || null,
  });

  return {
    will_write_review: true,
    platform,
    star_rating: result.star_rating || stars,
    nps: result.nps ?? nps,
    title: result.title || null,
    body: imperfectBody || result.body || '',
    body_raw_llm: result.body || '',
    themes: Array.isArray(result.themes) ? result.themes : [],
    would_recommend: !!result.would_recommend,
    would_repeat: !!result.would_repeat_stay,
    mentioned_staff_name: !!result.mentioned_staff_name,
    mentioned_competitor: !!result.mentioned_competitor,
    mentioned_price_or_fees: !!result.mentioned_price_or_fees,
    language: result.language || reviewLangCode,
    social_media_share_probability: computeSocialProbability(archetype, stars),
    identity_style_key: idStyle?.style_key || null,
    cultural_voice_applied: !!culturalVoice,
    telling_arc_applied: !!tellingArc,
  };
}

function computeSocialProbability(archetype, stars) {
  const probs = archetype?.social_media_probability || {};
  const max = Object.values(probs).reduce((m, v) => Math.max(m, v), 0);
  // Adjust based on stars (5-star boosts positive share; 1-star boosts complaint)
  const adjustment = stars >= 4 ? 1.0 : stars <= 2 ? 0.8 : 0.5;
  return Math.min(0.95, max * adjustment);
}

function extractRelevantDatasetPhrases(phraseBank, { archetypeId, stars }) {
  if (!Array.isArray(phraseBank)) return [];
  // phraseBank entries: { text, rating, archetype_hint, source }
  const targetTone = stars >= 4 ? 'positive' : stars <= 2 ? 'negative' : 'mixed';
  return phraseBank
    .filter(p => !p.archetype_hint || p.archetype_hint === archetypeId)
    .filter(p => targetTone === 'mixed' || (targetTone === 'positive' && p.rating >= 4) || (targetTone === 'negative' && p.rating <= 2))
    .slice(0, 8)
    .map(p => p.text);
}

module.exports = { predictReview, selectPlatform, shouldWriteReview };
