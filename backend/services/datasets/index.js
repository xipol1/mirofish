/**
 * Dataset Registry & Loader — unified access to external datasets
 * (Kaggle TripAdvisor reviews, GoEmotions, Inside Airbnb, Booking demand, behavioral studies).
 *
 * On boot, discovers datasets in `backend/data/datasets/`, parses any raw CSVs into the
 * standard schemas defined in `manifest.json`, caches results in memory, and exposes
 * typed query APIs:
 *
 *   reviews.query({ city, tier, archetype, rating }) -> [Review]
 *   emotions.lookupSensationMapping(dim, direction) -> [emotion_label]
 *   emotions.queryPhrases({ emotion, sentiment, sample_size }) -> [text]
 *   listings.benchmarkPrice({ city, neighborhood }) -> { p25, p50, p75 }
 *   bookings.leadTimeDistribution({ market_segment }) -> { p10, p50, p90 }
 *   behavioral.getExpensePattern(archetype) -> object
 *   behavioral.getLengthOfStay(archetype) -> {p10, p50, p90}
 */

const path = require('path');
const fs = require('fs');

const DATASETS_ROOT = path.join(__dirname, '..', '..', 'data', 'datasets');
const MANIFEST_PATH = path.join(DATASETS_ROOT, 'manifest.json');

let _manifest = null;
const _cache = {};

function getManifest() {
  if (_manifest) return _manifest;
  _manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf-8'));
  return _manifest;
}

function listFilesInDir(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter(f => !f.startsWith('.'));
}

/**
 * Parse a CSV file with a simple reader (no external dep).
 * Handles quoted fields and comma escapes.
 */
function parseCsv(csvContent) {
  const lines = csvContent.split(/\r?\n/).filter(l => l.length > 0);
  if (lines.length === 0) return [];
  const headerLine = lines[0];
  const headers = splitCsvLine(headerLine);
  return lines.slice(1).map(line => {
    const cells = splitCsvLine(line);
    const row = {};
    headers.forEach((h, i) => { row[h] = cells[i] ?? ''; });
    return row;
  });
}

function splitCsvLine(line) {
  const out = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (quoted && line[i + 1] === '"') { cur += '"'; i++; }
      else quoted = !quoted;
    } else if (c === ',' && !quoted) {
      out.push(cur); cur = '';
    } else {
      cur += c;
    }
  }
  out.push(cur);
  return out;
}

// ─────────────────────────────────────────────────────────────
// TRIPADVISOR REVIEWS LOADER
// ─────────────────────────────────────────────────────────────

function loadTripAdvisorReviews() {
  if (_cache.tripadvisor_reviews) return _cache.tripadvisor_reviews;
  const dir = path.join(DATASETS_ROOT, 'tripadvisor_reviews');
  const files = listFilesInDir(dir);
  const reviews = [];

  for (const file of files) {
    const full = path.join(dir, file);
    if (file.endsWith('.json')) {
      try {
        const data = JSON.parse(fs.readFileSync(full, 'utf-8'));
        if (Array.isArray(data)) reviews.push(...data);
      } catch (e) { console.error(`[datasets] failed to parse ${file}: ${e.message}`); }
    } else if (file.endsWith('.csv')) {
      try {
        const content = fs.readFileSync(full, 'utf-8');
        const rows = parseCsv(content);
        for (const row of rows) {
          reviews.push(mapTripAdvisorCsvRow(row));
        }
      } catch (e) { console.error(`[datasets] failed to parse ${file}: ${e.message}`); }
    }
  }

  _cache.tripadvisor_reviews = reviews;
  console.log(`[datasets] TripAdvisor reviews loaded: ${reviews.length} entries`);
  return reviews;
}

function mapTripAdvisorCsvRow(row) {
  // Handle common column name variants from different Kaggle TA datasets
  const rating = parseFloat(row.Rating || row.rating || row.Score || row.score || row['Reviewer Score'] || 0);
  const body = String(row.Review || row.review || row.Body || row.body || row['Negative_Review'] || row['Positive_Review'] || row['Comment'] || '').substring(0, 4000);
  return {
    id: row.id || `ta-${Math.random().toString(36).slice(2, 10)}`,
    source: 'tripadvisor_kaggle',
    hotel_name: row.Hotel_Name || row.hotel_name || row.Hotel || row.Name || '',
    hotel_tier: inferTier(row.Hotel_Name || row.Name || '', rating),
    city: row.City || row.city || row.Hotel_Address || '',
    country: row.Country || row.country || '',
    rating,
    rating_scale: rating <= 5 ? 5 : 10,
    title: String(row.Title || row.title || row.Review_Title || '').substring(0, 200),
    body,
    trip_type: row['Trip Type'] || row.trip_type || null,
    language: row.Language || row.language || inferLanguage(body),
    reviewer_origin: row['Reviewer Nationality'] || row.reviewer_origin || null,
    stay_month: row['Review Date'] || row.review_date || null,
    themes: extractThemesFromBody(body),
    sentiment_score: rating >= 4 ? 0.6 : rating <= 2 ? -0.6 : 0.0,
  };
}

function inferTier(name, rating) {
  if (/gran |paradisus|ritz|four seasons|mandarin|aman|rosewood|st\. regis|bulgari/i.test(name)) return 'luxury';
  if (/boutique|hôtel|kimpton|edition|innside|sofitel/i.test(name)) return 'upscale';
  if (/sol |tryp |ibis |holiday inn/i.test(name)) return 'midscale';
  if (rating >= 4.5) return 'upscale';
  return 'midscale';
}

function inferLanguage(text) {
  if (!text) return 'en';
  if (/[áéíóúñ]/i.test(text) && /(muy|gracias|hotel|habitación|estuve|servicio)/i.test(text)) return 'es';
  if (/(très|merci|séjour|chambre)/i.test(text)) return 'fr';
  if (/(sehr|zimmer|danke|aufenthalt)/i.test(text)) return 'de';
  if (/(molto|grazie|camera|soggiorno)/i.test(text)) return 'it';
  if (/(muito|obrigad|quarto)/i.test(text)) return 'pt';
  return 'en';
}

function extractThemesFromBody(body) {
  const text = String(body || '').toLowerCase();
  const themes = [];
  const map = {
    cleanliness: /clean|dirty|spotless|hair|dust/,
    service: /staff|service|concierge|receptionist|friendly|rude/,
    location: /location|nearby|walk|distance|central/,
    value: /price|value|worth|overpriced|cheap|expensive/,
    food: /breakfast|dinner|restaurant|buffet|food|chef/,
    wifi: /wifi|internet|connection/,
    noise: /noise|noisy|quiet|loud/,
    bed_comfort: /bed|mattress|pillow|sleep/,
    pool: /pool|swim/,
    spa: /spa|massage|treatment/,
    check_in: /check.?in|reception|arrival/,
    check_out: /check.?out|departure|bill/,
    parking: /parking|garage|valet/,
    hidden_fees: /resort fee|hidden|surprise charge|extra charge/,
    loyalty_recognition: /platinum|gold|bonvoy|honors|ambassador|status/,
    family_friendly: /kids|children|family|baby/,
    romantic: /romantic|honeymoon|anniversary|couple/,
    view: /view|overlook|balcony/,
    brand_consistency: /chain|brand|expectation|consistent/,
  };
  for (const [theme, re] of Object.entries(map)) {
    if (re.test(text)) themes.push(theme);
  }
  return themes;
}

function queryReviews({ city, country, tier, rating_min, rating_max, theme, language, limit = 20 } = {}) {
  const all = loadTripAdvisorReviews();
  return all
    .filter(r => (!city || (r.city || '').toLowerCase().includes(city.toLowerCase())))
    .filter(r => (!country || (r.country || '').toLowerCase().includes(country.toLowerCase())))
    .filter(r => (!tier || r.hotel_tier === tier))
    .filter(r => (rating_min == null || r.rating >= rating_min))
    .filter(r => (rating_max == null || r.rating <= rating_max))
    .filter(r => (!theme || (r.themes || []).includes(theme)))
    .filter(r => (!language || r.language === language))
    .slice(0, limit);
}

function samplePhrasesForPredictor({ target_sentiment = 'mixed', limit = 8, theme = null } = {}) {
  const all = loadTripAdvisorReviews();
  let filtered = all;
  if (target_sentiment === 'positive') filtered = filtered.filter(r => r.rating >= 4);
  else if (target_sentiment === 'negative') filtered = filtered.filter(r => r.rating <= 2);
  if (theme) filtered = filtered.filter(r => (r.themes || []).includes(theme));
  return filtered.slice(0, limit).map(r => ({ text: r.body, rating: r.rating, archetype_hint: null, source: r.source }));
}

// ─────────────────────────────────────────────────────────────
// GOEMOTIONS LOADER
// ─────────────────────────────────────────────────────────────

function loadGoEmotions() {
  if (_cache.goemotions) return _cache.goemotions;
  const dir = path.join(DATASETS_ROOT, 'goemotions');
  const files = listFilesInDir(dir);
  let data = { taxonomy: [], sensation_mapping: {}, samples: [] };

  for (const file of files) {
    const full = path.join(dir, file);
    if (file.endsWith('.json')) {
      try {
        const content = JSON.parse(fs.readFileSync(full, 'utf-8'));
        if (Array.isArray(content.samples)) data.samples.push(...content.samples);
        if (content.sensation_to_emotion_mapping) Object.assign(data.sensation_mapping, content.sensation_to_emotion_mapping);
        if (Array.isArray(content._emotion_taxonomy_27)) data.taxonomy = content._emotion_taxonomy_27;
      } catch (e) { /* ignore */ }
    } else if (file.endsWith('.csv')) {
      try {
        const content = fs.readFileSync(full, 'utf-8');
        const rows = parseCsv(content);
        for (const row of rows) {
          const labels = Object.keys(row).filter(k => row[k] === '1' || row[k] === 1);
          data.samples.push({
            text: row.text || '',
            emotion_labels: labels,
            emotion_scores: labels.map(() => 1),
            source_origin: 'goemotions_reddit',
          });
        }
      } catch (e) { /* ignore */ }
    }
  }

  _cache.goemotions = data;
  console.log(`[datasets] GoEmotions loaded: ${data.samples.length} samples, ${data.taxonomy.length} taxonomy`);
  return data;
}

function lookupSensationToEmotions(sensationDim, direction = 'high') {
  const data = loadGoEmotions();
  const key = `${sensationDim}_${direction}`;
  return data.sensation_mapping[key] || [];
}

function samplePhrasesByEmotion(emotion, limit = 5) {
  const data = loadGoEmotions();
  return data.samples
    .filter(s => (s.emotion_labels || []).includes(emotion))
    .slice(0, limit)
    .map(s => s.text);
}

// ─────────────────────────────────────────────────────────────
// AIRBNB LISTINGS LOADER
// ─────────────────────────────────────────────────────────────

function loadAirbnbListings() {
  if (_cache.airbnb_listings) return _cache.airbnb_listings;
  const dir = path.join(DATASETS_ROOT, 'airbnb_listings');
  const files = listFilesInDir(dir);
  const listings = [];

  for (const file of files) {
    if (!file.endsWith('.csv') && !file.endsWith('.json')) continue;
    const full = path.join(dir, file);
    try {
      if (file.endsWith('.json')) {
        const data = JSON.parse(fs.readFileSync(full, 'utf-8'));
        if (Array.isArray(data)) listings.push(...data);
      } else {
        const content = fs.readFileSync(full, 'utf-8');
        const rows = parseCsv(content);
        for (const row of rows) {
          listings.push({
            id: row.id || row.listing_id,
            name: row.name || row.title || '',
            city: row.city || extractCityFromFilename(file),
            neighborhood: row.neighbourhood || row.neighborhood || '',
            room_type: row.room_type || row.roomType || '',
            price_per_night_eur: parsePrice(row.price || row.price_per_night || 0),
            amenities: row.amenities || '',
            review_score: parseFloat(row.review_scores_rating || row.review_score || 0),
            number_of_reviews: parseInt(row.number_of_reviews || 0, 10),
          });
        }
      }
    } catch (e) { /* ignore */ }
  }

  _cache.airbnb_listings = listings;
  console.log(`[datasets] Airbnb listings loaded: ${listings.length} entries`);
  return listings;
}

function parsePrice(raw) {
  if (typeof raw === 'number') return raw;
  const n = parseFloat(String(raw).replace(/[^\d.]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

function extractCityFromFilename(filename) {
  const m = filename.match(/^([a-z]+)_listings\.csv$/i);
  return m ? m[1].charAt(0).toUpperCase() + m[1].slice(1) : '';
}

function benchmarkPrice({ city, neighborhood, room_type = null } = {}) {
  const all = loadAirbnbListings();
  const filtered = all
    .filter(l => !city || (l.city || '').toLowerCase().includes(city.toLowerCase()))
    .filter(l => !neighborhood || (l.neighborhood || '').toLowerCase().includes(neighborhood.toLowerCase()))
    .filter(l => !room_type || l.room_type === room_type)
    .map(l => l.price_per_night_eur)
    .filter(p => p > 0)
    .sort((a, b) => a - b);
  if (filtered.length === 0) return null;
  return {
    n: filtered.length,
    p25: filtered[Math.floor(filtered.length * 0.25)],
    p50: filtered[Math.floor(filtered.length * 0.5)],
    p75: filtered[Math.floor(filtered.length * 0.75)],
  };
}

// ─────────────────────────────────────────────────────────────
// BOOKING DEMAND LOADER
// ─────────────────────────────────────────────────────────────

function loadBookingDemand() {
  if (_cache.booking_hotels) return _cache.booking_hotels;
  const dir = path.join(DATASETS_ROOT, 'booking_hotels');
  const files = listFilesInDir(dir);
  const bookings = [];

  for (const file of files) {
    if (!file.endsWith('.csv') && !file.endsWith('.json')) continue;
    const full = path.join(dir, file);
    try {
      if (file.endsWith('.json')) {
        const data = JSON.parse(fs.readFileSync(full, 'utf-8'));
        if (Array.isArray(data)) bookings.push(...data);
      } else {
        const content = fs.readFileSync(full, 'utf-8');
        const rows = parseCsv(content);
        for (const row of rows) {
          bookings.push({
            hotel_category: row.hotel || row.hotel_category || null,
            lead_time_days: parseInt(row.lead_time || 0, 10),
            stays_in_weekend_nights: parseInt(row.stays_in_weekend_nights || 0, 10),
            stays_in_weekday_nights: parseInt(row.stays_in_week_nights || row.stays_in_weekday_nights || 0, 10),
            adults: parseInt(row.adults || 0, 10),
            children: parseInt(row.children || 0, 10),
            meal_plan: row.meal || row.meal_plan || null,
            country_origin: row.country || null,
            market_segment: row.market_segment || null,
            adr_eur: parseFloat(row.adr || 0),
            cancellation_flag: row.is_canceled === '1' || row.is_canceled === 1,
          });
        }
      }
    } catch (e) { /* ignore */ }
  }

  _cache.booking_hotels = bookings;
  console.log(`[datasets] Booking demand rows loaded: ${bookings.length}`);
  return bookings;
}

function leadTimeDistribution({ market_segment = null } = {}) {
  const all = loadBookingDemand();
  let filtered = all;
  if (market_segment) filtered = filtered.filter(b => b.market_segment === market_segment);
  const leads = filtered.map(b => b.lead_time_days).filter(n => n > 0).sort((a, b) => a - b);
  if (leads.length === 0) return null;
  return {
    n: leads.length,
    p10: leads[Math.floor(leads.length * 0.10)],
    p50: leads[Math.floor(leads.length * 0.50)],
    p90: leads[Math.floor(leads.length * 0.90)],
  };
}

// ─────────────────────────────────────────────────────────────
// BEHAVIORAL STUDIES LOADER
// ─────────────────────────────────────────────────────────────

function loadBehavioralStudies() {
  if (_cache.behavioral) return _cache.behavioral;
  const dir = path.join(DATASETS_ROOT, 'behavioral_studies');
  const files = listFilesInDir(dir);
  let merged = {};
  for (const file of files) {
    if (!file.endsWith('.json')) continue;
    try {
      const content = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf-8'));
      merged = { ...merged, ...content };
    } catch (e) { /* ignore */ }
  }
  _cache.behavioral = merged;
  console.log(`[datasets] Behavioral studies loaded: ${Object.keys(merged).length} top-level keys`);
  return merged;
}

function getExpensePattern(archetypeId) {
  const data = loadBehavioralStudies();
  return data?.daily_spending_empirical_eur?.[archetypeId] || null;
}

function getLengthOfStayDistribution(archetypeId) {
  const data = loadBehavioralStudies();
  return data?.length_of_stay_distribution_nights?.[archetypeId] || null;
}

function getLeadTimeDistribution(archetypeId) {
  const data = loadBehavioralStudies();
  return data?.booking_lead_time_distribution_days?.[archetypeId] || null;
}

function getAmenityUsageRate(amenity, archetypeOrTier = null) {
  const data = loadBehavioralStudies();
  const rates = data?.amenity_usage_rates;
  if (!rates) return null;
  return rates[amenity] || null;
}

// ─────────────────────────────────────────────────────────────
// STATUS & LOAD ALL
// ─────────────────────────────────────────────────────────────

function status() {
  return {
    manifest: getManifest()?.datasets || {},
    cache_sizes: {
      tripadvisor_reviews: (_cache.tripadvisor_reviews || []).length,
      goemotions: (_cache.goemotions?.samples || []).length,
      airbnb_listings: (_cache.airbnb_listings || []).length,
      booking_hotels: (_cache.booking_hotels || []).length,
      behavioral_studies: Object.keys(_cache.behavioral || {}).length,
    },
  };
}

function preloadAll() {
  loadTripAdvisorReviews();
  loadGoEmotions();
  loadAirbnbListings();
  loadBookingDemand();
  loadBehavioralStudies();
  return status();
}

module.exports = {
  getManifest,
  preloadAll,
  status,

  // Reviews
  loadTripAdvisorReviews,
  queryReviews,
  samplePhrasesForPredictor,

  // Emotions
  loadGoEmotions,
  lookupSensationToEmotions,
  samplePhrasesByEmotion,

  // Listings
  loadAirbnbListings,
  benchmarkPrice,

  // Bookings
  loadBookingDemand,
  leadTimeDistribution,

  // Behavioral
  loadBehavioralStudies,
  getExpensePattern,
  getLengthOfStayDistribution,
  getLeadTimeDistribution,
  getAmenityUsageRate,
};
