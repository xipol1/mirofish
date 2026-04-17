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

function selectPlatform(archetypeId) {
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

async function predictReview({ stay, persona, property = null, dataset_phrase_bank = null }) {
  const archetypeId = stay.archetype_id;

  // Auto-pull dataset phrases if no explicit bank passed — uses Kaggle TripAdvisor samples
  if (!dataset_phrase_bank) {
    const stars = stay.sensation_summary?.stars || 3;
    const tone = stars >= 4 ? 'positive' : stars <= 2 ? 'negative' : 'mixed';
    dataset_phrase_bank = datasets.samplePhrasesForPredictor({ target_sentiment: tone, limit: 10 });
  }
  const archetype = behaviors().archetypes[archetypeId];
  const platform = selectPlatform(archetypeId);
  const [lenMin, lenMax] = getTypicalLength(archetypeId, platform);

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

  // Build prompt
  const positiveMoments = (stay.moments_positive || []).map(m => `• ${m.description || m}`).join('\n') || '(none)';
  const negativeMoments = (stay.moments_negative || []).map(m => `• ${m.description || m}`).join('\n') || '(none)';
  const finalSensations = stay.final_sensation_state || {};
  const expenses = stay.expense_summary || {};
  const tone = archetype?.review_behavior?.tone || 'balanced';

  const samplePhrases = [...positivePhrases.slice(0, 3), ...negativePhrases.slice(0, 3), ...datasetPhrases.slice(0, 5)];

  const prompt = `You are writing a realistic hotel review from the perspective of a guest who just completed their stay. Match the platform's conventions (${platform}) and the archetype's voice (${archetype?.label || archetypeId}).

=== GUEST ===
Name: ${persona.name}
Archetype: ${archetype?.label}
Tone: ${tone}
Trip purpose: ${stay.trip_purpose || 'leisure'}

=== STAY SUMMARY ===
Length: ${stay.stay_length_nights} nights
Property: ${property?.name || stay.property_name || 'this hotel'} (${property?.brand || ''})
Final sensation state (0-100): ${JSON.stringify(finalSensations, null, 2)}
Calculated star rating: ${stars}/5
Predicted NPS: ${nps}
Total ancillary spend: €${expenses.total_spend_eur || 0}

=== POSITIVE MOMENTS THAT STOOD OUT ===
${positiveMoments}

=== NEGATIVE MOMENTS THAT STOOD OUT ===
${negativeMoments}

=== PLATFORM: ${platform} ===
Typical length: ${lenMin}-${lenMax} words.
Platform conventions: ${JSON.stringify(calibration().review_structure_by_platform?.[platform] || {})}

=== REAL REVIEW PHRASES FROM ARCHETYPE (reference — do not copy verbatim, adapt) ===
${samplePhrases.join('\n')}

=== YOUR TASK ===
Write the review in first person, past tense, matching the platform and archetype tone. Be specific about the moments above. Include:
- A title (if platform uses titles)
- A body that reflects the actual experience (don't invent things that didn't happen)
- Star rating: ${stars}
- Themes/tags relevant to this review

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
  "language": "en|es|pt|fr|de|it"
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

  return {
    will_write_review: true,
    platform,
    star_rating: result.star_rating || stars,
    nps: result.nps ?? nps,
    title: result.title || null,
    body: result.body || '',
    themes: Array.isArray(result.themes) ? result.themes : [],
    would_recommend: !!result.would_recommend,
    would_repeat: !!result.would_repeat_stay,
    mentioned_staff_name: !!result.mentioned_staff_name,
    mentioned_competitor: !!result.mentioned_competitor,
    mentioned_price_or_fees: !!result.mentioned_price_or_fees,
    language: result.language || 'en',
    social_media_share_probability: computeSocialProbability(archetype, stars),
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
