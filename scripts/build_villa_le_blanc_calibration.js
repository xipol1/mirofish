/**
 * Build calibration signals for Gran Meliá Villa Le Blanc from the sample review corpus.
 *
 * Output: backend/data/industries/hospitality/villa_le_blanc_calibration.json
 *
 * This file is consumed by stay-simulation (inlineMode) as calibrationOverride, giving
 * the simulation real-ish anchors without needing a PG database.
 *
 * Usage: node scripts/build_villa_le_blanc_calibration.js
 */

const fs = require('fs');
const path = require('path');
const reviewParser = require('../backend/services/data/review-parser');

const CORPUS_PATH = path.join(__dirname, '..', 'backend', 'data', 'industries', 'hospitality', 'sample_reviews_villa_le_blanc.json');
const OUTPUT_PATH = path.join(__dirname, '..', 'backend', 'data', 'industries', 'hospitality', 'villa_le_blanc_calibration.json');

const corpus = JSON.parse(fs.readFileSync(CORPUS_PATH, 'utf-8'));

// Apply detectThemes to each review so the aggregation has them
const reviews = corpus.reviews.map(r => ({
  ...r,
  themes_json: reviewParser.detectThemes(`${r.title || ''} ${r.body || ''}`),
}));

const aggregation = reviewParser.aggregateReviews(reviews);
const calibration = reviewParser.toCalibrationSignals(aggregation);

// Enrich with property-specific additional signals that wouldn't be in reviews alone
const enriched = {
  property_name: 'Gran Meliá Villa Le Blanc',
  property_slug: corpus.property_slug,
  sourced_from: 'Curated realistic corpus (TripAdvisor + Booking.com + Google public anchors)',
  generated_at: new Date().toISOString(),
  ...calibration,
  full_aggregation: aggregation,
  notes: [
    'Real public anchors: TripAdvisor ~4.5/5, Booking.com ~9.0/10',
    'Star distribution reflects empirical distribution for 5-star design resorts in Menorca',
    'Theme sentiment ratios derived from the corpus, NOT from LLM generation',
    'This calibration should be regenerated whenever Meliá provides their actual review export',
  ],
};

fs.writeFileSync(OUTPUT_PATH, JSON.stringify(enriched, null, 2));

console.log('=== Villa Le Blanc Calibration ===');
console.log('Reviews ingested:', aggregation.review_count);
console.log('Avg rating (5-scale):', aggregation.avg_rating_normalized_5);
console.log('Star distribution %:', aggregation.star_distribution_pct);
console.log('Sentiment distribution:', aggregation.sentiment_distribution);
console.log('Top positive themes:', aggregation.top_positive_themes);
console.log('Top negative themes:', aggregation.top_negative_themes);
console.log('Positive:negative moment ratio:', aggregation.positive_negative_moment_ratio + ':1');
console.log('');
console.log('Wrote', OUTPUT_PATH);
