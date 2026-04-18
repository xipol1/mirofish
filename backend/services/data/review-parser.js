/**
 * Review Parser — aggregates ingested reviews into property signals.
 *
 * Given raw reviews (scraped or uploaded), extracts:
 *   - Top positive and negative themes (by frequency × sentiment)
 *   - Average rating per source
 *   - Theme frequency distribution
 *   - Sentiment distribution per rating bucket
 *
 * Output feeds property.historical_performance and narrative-engine calibration.
 */

const THEME_REGEX = {
  cleanliness: /\b(clean|dirty|dust|hair|spotless|mold|mildew|sanitiz)\w*/i,
  service: /\b(staff|service|concierge|receptionist|friendly|rude|attentive|indifferent|butler)\w*/i,
  location: /\b(location|walk|distance|central|metro|beach|airport|transport)\w*/i,
  value: /\b(price|value|worth|overpriced|expensive|cheap|fair|rate|bargain)\w*/i,
  food: /\b(breakfast|dinner|restaurant|buffet|menu|chef|food|meal|cuisine)\w*/i,
  wifi: /\b(wifi|wi-fi|internet|connection|mbps|bandwidth|online)\w*/i,
  noise: /\b(noise|noisy|quiet|loud|soundproof)\w*/i,
  bed_comfort: /\b(bed|mattress|pillow|sleep|linen|comforter)\w*/i,
  pool: /\b(pool|swim|spa|jacuzzi|hot tub)\w*/i,
  spa: /\b(spa|massage|treatment|wellness|facial)\w*/i,
  check_in: /\b(check.?in|reception|arrival|front desk)\w*/i,
  check_out: /\b(check.?out|departure|bill|express)\w*/i,
  parking: /\b(parking|garage|valet|car park)\w*/i,
  hidden_fees: /\b(resort fee|hidden|surcharge|extra charge|surprise)\w*/i,
  loyalty_recognition: /\b(platinum|gold|silver|bonvoy|honors|rewards|elite|status)\w*/i,
  family_friendly: /\b(kids|children|family|baby|stroller|crib)\w*/i,
  romantic: /\b(romantic|honeymoon|anniversary|couple|intimate)\w*/i,
  view: /\b(view|overlook|balcony|panorama|scenery)\w*/i,
  room_size: /\b(small|tiny|spacious|cramped|big room|large room|square feet|square meters|m²|sq)\w*/i,
  modernity: /\b(modern|dated|old|outdated|renovated|90s|renovation)\w*/i,
  brand: /\b(chain|brand|meliá|marriott|hilton|hyatt|four seasons|accor|ihg)\w*/i,
};

function detectThemes(text) {
  const t = String(text || '').toLowerCase();
  const themes = [];
  for (const [theme, regex] of Object.entries(THEME_REGEX)) {
    if (regex.test(t)) themes.push(theme);
  }
  return themes;
}

function detectSentimentBucket(rating, ratingScale) {
  if (rating == null) return 'neutral';
  const normalized = rating / (ratingScale || 5);
  if (normalized >= 0.75) return 'positive';
  if (normalized >= 0.5) return 'mixed';
  return 'negative';
}

function aggregateReviews(reviews) {
  if (!Array.isArray(reviews) || reviews.length === 0) {
    return {
      review_count: 0,
      avg_rating_normalized_5: null,
      sentiment_distribution: { positive: 0, mixed: 0, negative: 0 },
      star_distribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
      star_distribution_pct: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
      top_positive_themes: [],
      top_negative_themes: [],
      theme_frequencies: {},
      positive_negative_moment_ratio: null,
    };
  }

  const themeFreq = {}; // theme -> { positive, mixed, negative }
  const sentimentDist = { positive: 0, mixed: 0, negative: 0 };
  const starDist = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  let ratingSum = 0;
  let ratingCount = 0;

  for (const r of reviews) {
    // Normalize rating to 0-5
    const scale = r.rating_scale || (r.rating_numeric && r.rating_numeric > 5 ? 10 : 5);
    const rating = r.rating_numeric != null ? (r.rating_numeric / scale) * 5 : null;
    if (rating != null) {
      ratingSum += rating;
      ratingCount++;
      const starBucket = Math.max(1, Math.min(5, Math.round(rating)));
      starDist[starBucket]++;
    }

    const bucket = detectSentimentBucket(r.rating_numeric, scale);
    sentimentDist[bucket] = (sentimentDist[bucket] || 0) + 1;

    const themes = r.themes_json && r.themes_json.length ? r.themes_json : detectThemes(`${r.title || ''} ${r.body || ''}`);
    for (const theme of themes) {
      if (!themeFreq[theme]) themeFreq[theme] = { positive: 0, mixed: 0, negative: 0, total: 0 };
      themeFreq[theme][bucket]++;
      themeFreq[theme].total++;
    }
  }

  // Rank themes
  const themeScores = Object.entries(themeFreq).map(([theme, counts]) => ({
    theme,
    counts,
    positive_ratio: counts.total > 0 ? counts.positive / counts.total : 0,
    negative_ratio: counts.total > 0 ? counts.negative / counts.total : 0,
  }));

  themeScores.sort((a, b) => b.counts.total - a.counts.total);

  const topPositiveThemes = themeScores
    .filter(t => t.counts.positive > 0 && t.positive_ratio >= 0.55)
    .sort((a, b) => b.counts.positive - a.counts.positive)
    .slice(0, 6)
    .map(t => t.theme);

  const topNegativeThemes = themeScores
    .filter(t => t.counts.negative > 0 && t.negative_ratio >= 0.35)
    .sort((a, b) => b.counts.negative - a.counts.negative)
    .slice(0, 6)
    .map(t => t.theme);

  // Star distribution as percentages (used by stratified sampler)
  const totalStars = Object.values(starDist).reduce((a, b) => a + b, 0) || 1;
  const starDistPct = Object.fromEntries(
    Object.entries(starDist).map(([s, n]) => [s, Math.round((n / totalStars) * 1000) / 10])
  );

  // Positive:negative moment ratio estimate (for prompt tuning)
  const posTotal = Object.values(themeFreq).reduce((s, t) => s + t.positive, 0);
  const negTotal = Object.values(themeFreq).reduce((s, t) => s + t.negative, 0);
  const pnRatio = negTotal > 0 ? Math.round((posTotal / negTotal) * 10) / 10 : null;

  return {
    review_count: reviews.length,
    avg_rating_normalized_5: ratingCount > 0 ? Math.round((ratingSum / ratingCount) * 100) / 100 : null,
    sentiment_distribution: sentimentDist,
    star_distribution: starDist,
    star_distribution_pct: starDistPct,
    top_positive_themes: topPositiveThemes,
    top_negative_themes: topNegativeThemes,
    theme_frequencies: themeFreq,
    positive_negative_moment_ratio: pnRatio,
  };
}

/**
 * Format the aggregation as the `calibration_signals` object consumed by narrative-engine.
 */
function toCalibrationSignals(aggregation) {
  return {
    avg_rating: aggregation.avg_rating_normalized_5,
    review_count: aggregation.review_count,
    top_positive_themes: aggregation.top_positive_themes,
    top_negative_themes: aggregation.top_negative_themes,
    sentiment_distribution: aggregation.sentiment_distribution,
    star_distribution_pct: aggregation.star_distribution_pct,
    positive_negative_moment_ratio: aggregation.positive_negative_moment_ratio,
    theme_top_10: Object.entries(aggregation.theme_frequencies || {})
      .map(([theme, counts]) => ({
        theme,
        total: counts.total,
        positive_pct: counts.total > 0 ? Math.round((counts.positive / counts.total) * 100) : 0,
        negative_pct: counts.total > 0 ? Math.round((counts.negative / counts.total) * 100) : 0,
      }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 10),
  };
}

module.exports = { aggregateReviews, detectThemes, detectSentimentBucket, toCalibrationSignals };
