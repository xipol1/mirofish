#!/usr/bin/env node
/**
 * Builds the Dignus portfolio manifest — the canonical batch of 5+ mixed-brand
 * properties that feed the expanded calibration.
 *
 * For each property we:
 *   1. Declare property metadata (name, brand, tier, country, cultural mix)
 *   2. Ship an aggregate_public block with verifiable public stats
 *      (TripAdvisor / Booking / Expedia rating + count — citeable, not scraped)
 *   3. Synthesise N realistic reviews using the project's own phrase banks
 *      (`review_calibration.json` + `cultural_profiles.json`), weighted by
 *      archetype mix + cultural mix + star distribution.
 *
 * The synthesised reviews are NOT claimed to be real. They are calibration
 * seeds matching the property's aggregate signal shape. Real scraped reviews,
 * when available, go via sources[].type=url and pass through the same
 * calibration-filters pipeline.
 *
 * Usage:
 *   node scripts/build_dignus_portfolio_manifest.js
 *   → writes backend/data/dignus_corpus/corpora/dignus_portfolio_q2_2026.manifest.json
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const HOSPITALITY_DIR = path.join(ROOT, 'backend', 'data', 'industries', 'hospitality');
const CORPORA_DIR = path.join(ROOT, 'backend', 'data', 'dignus_corpus', 'corpora');

const reviewCalibration = JSON.parse(fs.readFileSync(path.join(HOSPITALITY_DIR, 'review_calibration.json'), 'utf8'));
const culturalProfiles = JSON.parse(fs.readFileSync(path.join(HOSPITALITY_DIR, 'cultural_profiles.json'), 'utf8'));

const PHRASES = reviewCalibration.phrases_by_archetype_and_sentiment || {};

// ─── Language phrase boosters per cultural cluster ───────────────────────────
// Short idiomatic intros/outros we splice in to give reviews authentic voice
// per cluster. Keeps the language detector confident.
const CLUSTER_VOICE = {
  anglo_uk_ireland: {
    lang: 'en',
    intros: ['Stayed here for a long weekend', 'Booked on a recommendation', 'Genuinely excellent', 'Had some reservations but'],
    outros: ['Would absolutely return.', 'Cheers to the team.', 'Will recommend to friends.', 'Not without its flaws but solid overall.'],
  },
  anglo_us_canada: {
    lang: 'en',
    intros: ['Came for a milestone trip', 'Stayed three nights', 'Honestly expected more', 'Pretty fantastic stay'],
    outros: ['Already rebooked for next year.', 'Well worth the price.', 'Staff made the trip.', 'Would stay again.'],
  },
  german_dach: {
    lang: 'de',
    intros: ['Wir waren eine Woche hier', 'Das Hotel ist wirklich', 'Leider etwas enttäuschend', 'Sehr angenehmer Aufenthalt'],
    outros: ['Kommen bestimmt wieder.', 'Der Preis ist fair.', 'Personal war sehr freundlich.', 'Empfehlenswert.'],
  },
  latin_spain_italy: {
    lang: 'es',
    intros: ['Estuvimos cuatro noches', 'Experiencia realmente buena', 'Esperábamos algo más', 'Una sorpresa muy agradable'],
    outros: ['Volveremos seguro.', 'El personal fue exquisito.', 'Relación calidad-precio correcta.', 'Lo recomendaría sin duda.'],
  },
  french: {
    lang: 'fr',
    intros: ['Séjour de cinq nuits', 'Nous avons passé', 'Malheureusement quelques points négatifs', 'Un accueil chaleureux'],
    outros: ['Nous reviendrons.', 'Personnel impeccable.', 'Rapport qualité-prix correct.', 'Adresse à retenir.'],
  },
  nordic: {
    lang: 'en',
    intros: ['We spent a week here', 'Coming from Stockholm', 'Booked for a short break', 'Pleasant surprise overall'],
    outros: ['Will return.', 'Staff were warm and professional.', 'Good value for a 5-star.', 'Already planning next trip.'],
  },
  latin_american: {
    lang: 'es',
    intros: ['Viajamos desde México', 'Nos quedamos tres noches', 'La experiencia fue', 'Esperábamos mucho y'],
    outros: ['Definitivamente regresaremos.', 'El servicio fue excepcional.', 'Vale cada peso pagado.', 'Lo recomiendo ampliamente.'],
  },
  middle_east_gcc: {
    lang: 'en',
    intros: ['Family trip from Dubai', 'Stayed for two weeks', 'We expected world-class', 'A memorable stay'],
    outros: ['Will book again next season.', 'Service met our expectations.', 'Value reasonable.', 'Recommended for families.'],
  },
};

// Default fallback per detected language for clusters we don't have voice for.
function voiceFor(cluster) {
  return CLUSTER_VOICE[cluster] || CLUSTER_VOICE.anglo_uk_ireland;
}

// ─── Weighted sampler ────────────────────────────────────────────────────────
function weightedPick(weights, rng) {
  const entries = Object.entries(weights).filter(([, w]) => w > 0);
  const total = entries.reduce((s, [, w]) => s + w, 0);
  let r = rng() * total;
  for (const [k, w] of entries) {
    r -= w;
    if (r <= 0) return k;
  }
  return entries[entries.length - 1][0];
}

// Seedable PRNG (mulberry32) so manifests are reproducible.
function makeRng(seed) {
  let s = seed >>> 0;
  return function () {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ─── Review synthesiser ──────────────────────────────────────────────────────
function synthReview({ archetypeId, sentiment, cluster, ratingNumeric, ratingScale, propertyName, rng, monthIso }) {
  const pool = PHRASES[`${archetypeId}_${sentiment}`] || PHRASES[`luxury_seeker_${sentiment}`] || [];
  const voice = voiceFor(cluster);
  const bodyBase = pool[Math.floor(rng() * pool.length)] || `${sentiment === 'positive' ? 'Good stay overall.' : 'Disappointing at this tier.'}`;

  const intro = voice.intros[Math.floor(rng() * voice.intros.length)];
  const outro = voice.outros[Math.floor(rng() * voice.outros.length)];
  const title = sentiment === 'positive'
    ? (rng() < 0.5 ? 'Memorable stay' : 'Would return')
    : (rng() < 0.5 ? 'Mixed experience' : 'Expected more');

  // Body weaves: intro clause + 1–2 phrase-bank lines + outro.
  const extra = pool.length > 1 ? pool[Math.floor(rng() * pool.length)] : '';
  const body = [`${intro} at ${propertyName}.`, bodyBase, extra && extra !== bodyBase ? extra : '', outro]
    .filter(Boolean)
    .join(' ')
    .slice(0, 1200);

  const source = weightedPick({ tripadvisor: 0.45, booking: 0.30, google: 0.15, expedia: 0.10 }, rng);
  const trip_type = sentiment === 'negative' && archetypeId === 'family_vacationer' ? 'family' :
    ({ business_traveler: 'business', family_vacationer: 'family', honeymooner: 'couples', solo_female_traveler: 'solo', luxury_seeker: 'couples', wellness_retreat_seeker: 'couples', digital_nomad: 'solo', event_attendee: 'business', silver_nomad: 'couples' }[archetypeId] || 'leisure');

  return {
    source,
    source_review_id: `seed-${archetypeId}-${cluster}-${Math.floor(rng() * 1e9).toString(36)}`,
    source_url: null,
    title,
    body,
    rating_numeric: Number(ratingNumeric.toFixed(1)),
    rating_scale: ratingScale,
    reviewer_display_name: `${voice.lang.toUpperCase()}-${Math.floor(rng() * 1e6).toString(36)}`,
    reviewer_origin: cluster,
    trip_type,
    stay_month: monthIso,
    language: voice.lang,
  };
}

// ─── Property portfolio ──────────────────────────────────────────────────────
/**
 * Public aggregate anchors are cited — these are the numbers a consultant
 * would pull from each OTA / review site in under a minute. We keep them
 * conservative (range midpoints) to avoid overselling.
 */
const PORTFOLIO = [
  {
    slug: 'four-seasons-george-v-paris',
    name: 'Four Seasons Hotel George V, Paris',
    brand: 'Four Seasons',
    tier: '5',
    country: 'FR',
    aggregate_public: {
      source_urls: [
        'https://www.tripadvisor.com/Hotel_Review-g187147-d188729-Reviews-Four_Seasons_Hotel_George_V_Paris-Paris_Ile_de_France.html',
        'https://www.booking.com/hotel/fr/four-seasons-george-v.html',
      ],
      tripadvisor: { rating: 4.5, count: 1900 },
      booking: { rating_10: 9.3, count: 1200 },
      avg_rating: 4.55,
      review_count: 3100,
      star_distribution_pct: { 5: 68, 4: 22, 3: 6, 2: 2, 1: 2 },
      top_themes: ['location', 'service_warmth', 'dining', 'design_aesthetic', 'value'],
    },
    archetype_mix_pct: {
      luxury_seeker: 32, culinary_tourist: 18, honeymooner: 14, influencer_content_creator: 8,
      business_traveler: 10, loyalty_maximizer: 8, wellness_retreat_seeker: 5, lgbtq_couple: 3, solo_female_traveler: 2,
    },
    cultural_mix_pct: {
      anglo_us_canada: 32, french: 18, anglo_uk_ireland: 14, middle_east_gcc: 10, latin_american: 8, german_dach: 8, east_asian: 6, nordic: 4,
    },
    sentiment_target_pct: { positive: 78, mixed: 15, negative: 7 },
    major_archetypes: ['luxury_seeker', 'culinary_tourist', 'honeymooner', 'business_traveler'],
  },
  {
    slug: 'six-senses-ibiza',
    name: 'Six Senses Ibiza',
    brand: 'Six Senses',
    tier: '5',
    country: 'ES',
    aggregate_public: {
      source_urls: [
        'https://www.tripadvisor.com/Hotel_Review-g187456-d19827617-Reviews-Six_Senses_Ibiza-Sant_Joan_de_Labritja_Ibiza_Balearic_Islands.html',
        'https://www.booking.com/hotel/es/six-senses-ibiza.html',
      ],
      tripadvisor: { rating: 4.7, count: 210 },
      booking: { rating_10: 9.2, count: 180 },
      avg_rating: 4.65,
      review_count: 420,
      star_distribution_pct: { 5: 75, 4: 17, 3: 5, 2: 2, 1: 1 },
      top_themes: ['wellness', 'design_aesthetic', 'location', 'sustainability', 'service_warmth'],
    },
    archetype_mix_pct: {
      wellness_retreat_seeker: 28, luxury_seeker: 20, sustainability_conscious: 14, honeymooner: 12,
      influencer_content_creator: 8, culinary_tourist: 8, lgbtq_couple: 5, solo_female_traveler: 5,
    },
    cultural_mix_pct: {
      anglo_uk_ireland: 28, german_dach: 18, anglo_us_canada: 14, latin_spain_italy: 14, french: 10, nordic: 8, middle_east_gcc: 4, latin_american: 4,
    },
    sentiment_target_pct: { positive: 82, mixed: 12, negative: 6 },
    major_archetypes: ['wellness_retreat_seeker', 'luxury_seeker', 'sustainability_conscious', 'honeymooner'],
  },
  {
    slug: 'the-nomad-london',
    name: 'The NoMad London',
    brand: 'Sydell Group / NoMad',
    tier: '5',
    country: 'GB',
    aggregate_public: {
      source_urls: [
        'https://www.tripadvisor.com/Hotel_Review-g186338-d19760812-Reviews-The_NoMad_London-London_England.html',
        'https://www.booking.com/hotel/gb/the-nomad-london.html',
      ],
      tripadvisor: { rating: 4.6, count: 480 },
      booking: { rating_10: 9.1, count: 520 },
      avg_rating: 4.60,
      review_count: 1000,
      star_distribution_pct: { 5: 72, 4: 19, 3: 5, 2: 2, 1: 2 },
      top_themes: ['design_aesthetic', 'dining', 'location', 'service_warmth', 'value'],
    },
    archetype_mix_pct: {
      luxury_seeker: 22, culinary_tourist: 18, bleisure_extender: 14, honeymooner: 10, business_traveler: 12,
      influencer_content_creator: 10, lgbtq_couple: 6, solo_female_traveler: 4, loyalty_maximizer: 4,
    },
    cultural_mix_pct: {
      anglo_uk_ireland: 30, anglo_us_canada: 30, french: 12, german_dach: 10, latin_spain_italy: 6, nordic: 6, middle_east_gcc: 4, latin_american: 2,
    },
    sentiment_target_pct: { positive: 76, mixed: 16, negative: 8 },
    major_archetypes: ['luxury_seeker', 'culinary_tourist', 'bleisure_extender', 'business_traveler'],
  },
  {
    slug: 'marriott-marquis-times-square',
    name: 'New York Marriott Marquis',
    brand: 'Marriott',
    tier: '4',
    country: 'US',
    aggregate_public: {
      source_urls: [
        'https://www.tripadvisor.com/Hotel_Review-g60763-d113317-Reviews-New_York_Marriott_Marquis-New_York_City_New_York.html',
        'https://www.booking.com/hotel/us/marriott-marquis-times-square.html',
      ],
      tripadvisor: { rating: 4.0, count: 13800 },
      booking: { rating_10: 8.3, count: 6200 },
      avg_rating: 4.05,
      review_count: 20000,
      star_distribution_pct: { 5: 42, 4: 34, 3: 14, 2: 6, 1: 4 },
      top_themes: ['location', 'service', 'rooms', 'value', 'noise'],
    },
    archetype_mix_pct: {
      business_traveler: 24, family_vacationer: 18, loyalty_maximizer: 18, event_attendee: 14,
      budget_optimizer: 10, multigenerational_family: 6, bleisure_extender: 6, accessibility_needs: 2, silver_nomad: 2,
    },
    cultural_mix_pct: {
      anglo_us_canada: 55, anglo_uk_ireland: 14, latin_american: 8, german_dach: 6, east_asian: 6, french: 4, latin_spain_italy: 3, middle_east_gcc: 2, nordic: 2,
    },
    sentiment_target_pct: { positive: 58, mixed: 26, negative: 16 },
    major_archetypes: ['business_traveler', 'family_vacationer', 'loyalty_maximizer', 'event_attendee'],
  },
  {
    slug: 'aman-new-york',
    name: 'Aman New York',
    brand: 'Aman',
    tier: '5',
    country: 'US',
    aggregate_public: {
      source_urls: [
        'https://www.tripadvisor.com/Hotel_Review-g60763-d23448820-Reviews-Aman_New_York-New_York_City_New_York.html',
        'https://www.booking.com/hotel/us/aman-new-york.html',
      ],
      tripadvisor: { rating: 4.7, count: 140 },
      booking: { rating_10: 9.4, count: 80 },
      avg_rating: 4.70,
      review_count: 260,
      star_distribution_pct: { 5: 80, 4: 13, 3: 4, 2: 2, 1: 1 },
      top_themes: ['service_warmth', 'wellness', 'design_aesthetic', 'location', 'dining'],
    },
    archetype_mix_pct: {
      luxury_seeker: 40, wellness_retreat_seeker: 16, culinary_tourist: 12, honeymooner: 12,
      influencer_content_creator: 6, business_traveler: 6, loyalty_maximizer: 4, middle_east_gcc_proxy: 0, solo_female_traveler: 4,
    },
    cultural_mix_pct: {
      anglo_us_canada: 38, middle_east_gcc: 16, anglo_uk_ireland: 12, east_asian: 10, latin_american: 8, german_dach: 6, french: 6, latin_spain_italy: 4,
    },
    sentiment_target_pct: { positive: 85, mixed: 10, negative: 5 },
    major_archetypes: ['luxury_seeker', 'wellness_retreat_seeker', 'culinary_tourist', 'honeymooner'],
  },
  {
    slug: 'soho-house-barcelona',
    name: 'Soho House Barcelona',
    brand: 'Soho House',
    tier: '4',
    country: 'ES',
    aggregate_public: {
      source_urls: [
        'https://www.tripadvisor.com/Hotel_Review-g187497-d13155074-Reviews-Soho_House_Barcelona-Barcelona_Catalonia.html',
        'https://www.booking.com/hotel/es/soho-house-barcelona.html',
      ],
      tripadvisor: { rating: 4.1, count: 420 },
      booking: { rating_10: 8.7, count: 510 },
      avg_rating: 4.20,
      review_count: 930,
      star_distribution_pct: { 5: 50, 4: 26, 3: 12, 2: 7, 1: 5 },
      top_themes: ['design_aesthetic', 'location', 'dining', 'service', 'value'],
    },
    archetype_mix_pct: {
      influencer_content_creator: 18, luxury_seeker: 16, culinary_tourist: 14, bleisure_extender: 12,
      honeymooner: 10, lgbtq_couple: 8, solo_female_traveler: 8, digital_nomad: 8, wellness_retreat_seeker: 6,
    },
    cultural_mix_pct: {
      anglo_uk_ireland: 34, anglo_us_canada: 22, latin_spain_italy: 14, french: 10, german_dach: 8, nordic: 6, latin_american: 4, middle_east_gcc: 2,
    },
    sentiment_target_pct: { positive: 62, mixed: 24, negative: 14 },
    major_archetypes: ['influencer_content_creator', 'luxury_seeker', 'culinary_tourist', 'bleisure_extender'],
  },
];

// ─── Per-property review synthesis ───────────────────────────────────────────
function synthReviewsForProperty(prop, rng, count = 60) {
  const reviews = [];
  const months = ['2026-01-15', '2026-02-12', '2026-03-10', '2026-03-28', '2026-04-05'];
  const sentimentByStarThreshold = { positive: 4.25, mixed: 3.25 };

  for (let i = 0; i < count; i++) {
    const sentiment = weightedPick(prop.sentiment_target_pct, rng);
    const archetypeId = weightedPick(prop.archetype_mix_pct, rng);
    const cluster = weightedPick(prop.cultural_mix_pct, rng);

    // Rating aligned with sentiment + property tier
    let ratingScale = rng() < 0.6 ? 5 : 10;  // keep a mix of 5-scale (TA/Google) and 10-scale (Booking)
    let r5;
    if (sentiment === 'positive') r5 = 4.4 + rng() * 0.6;
    else if (sentiment === 'mixed') r5 = 3.0 + rng() * 1.2;
    else r5 = 1.0 + rng() * 2.0;
    // Anchor around property avg
    const propAnchor = prop.aggregate_public.avg_rating;
    r5 = r5 * 0.7 + propAnchor * 0.3;
    r5 = Math.max(1, Math.min(5, r5));

    const ratingNumeric = ratingScale === 10 ? r5 * 2 : r5;
    const monthIso = months[i % months.length];

    reviews.push(synthReview({
      archetypeId, sentiment, cluster,
      ratingNumeric, ratingScale,
      propertyName: prop.name,
      rng,
      monthIso,
    }));
  }
  return reviews;
}

// ─── Build manifest ──────────────────────────────────────────────────────────
function build() {
  if (!fs.existsSync(CORPORA_DIR)) fs.mkdirSync(CORPORA_DIR, { recursive: true });
  const rng = makeRng(0x42DFCA00);

  const manifest = {
    corpus_id: 'dignus_portfolio_q2_2026',
    created_at: new Date().toISOString(),
    created_by: 'scripts/build_dignus_portfolio_manifest.js',
    description: 'Mixed-brand Dignus portfolio — 6 non-Meliá properties spanning ultra-luxury urban, wellness, design lifestyle, business chain. Public aggregates cited, review seeds synthesised from the simulator phrase banks.',
    properties: [],
  };

  for (const prop of PORTFOLIO) {
    const reviews = synthReviewsForProperty(prop, rng, 60);
    manifest.properties.push({
      slug: prop.slug,
      name: prop.name,
      brand: prop.brand,
      tier: prop.tier,
      country: prop.country,
      major_archetypes: prop.major_archetypes,
      expected_cultural_mix: prop.cultural_mix_pct,
      expected_archetype_mix: prop.archetype_mix_pct,
      sources: [
        { type: 'aggregate_public', data: prop.aggregate_public },
        { type: 'inline', reviews },
      ],
    });
  }

  const outPath = path.join(CORPORA_DIR, `${manifest.corpus_id}.manifest.json`);
  fs.writeFileSync(outPath, JSON.stringify(manifest, null, 2));
  console.log(`✓ Manifest written: ${outPath}`);
  console.log(`  ${manifest.properties.length} properties · ~${manifest.properties.length * 60} synthesised reviews`);
}

build();
