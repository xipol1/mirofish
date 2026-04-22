/**
 * Calibration filters — the guardrail layer between raw Dignus data and the
 * review corpus that feeds the simulation. Every review that lands in
 * `reviews_ingested` (or in a property calibration file) goes through these
 * filters first so a bad batch cannot descalibrate a property overnight.
 *
 * Stateless, synchronous, pure. Returns `{ accepted, rejected }` where each
 * rejected row carries a `_reject_reason` tag.
 *
 * Pipeline (ordered, fail-fast per review):
 *   1. shape      — required fields present
 *   2. length     — body long enough to be signal, not spam
 *   3. dedup      — content-hash against already-seen within the batch
 *   4. rating     — numeric + within declared scale
 *   5. language   — detect; drop/tag if outside expected set
 *   6. outlier    — reviewer floods (N identical ratings from same author)
 *   7. bot_like   — near-duplicate bodies, stopword stuffing, all-caps
 *   8. recency    — drop if older than max_age_years (optional)
 *   9. themes     — run detectThemes; reject if zero themes AND zero keywords
 *  10. archetype  — tag with inferred archetype(s); reject if unclassifiable
 *                   AND the batch exceeds `max_unclassified_pct`
 */

const crypto = require('crypto');
const { detectThemes, detectSentimentBucket } = require('./review-parser');

const DEFAULT_OPTS = {
  min_body_chars: 25,
  max_body_chars: 6000,
  allowed_languages: null,  // null = any; otherwise array of ISO codes
  max_age_years: 7,
  allow_unclassified: true,
  max_unclassified_pct: 15,
  drop_all_caps_ratio: 0.6,
  max_per_reviewer: 8,
  expected_rating_scale: null,  // null = auto-detect per row; else force
  reject_zero_theme: false,
  tag_only: false,              // if true, keep all rows but still tag reasons
};

// ── Cheap language detection (no dep) ────────────────────────────────────────
// Covers the ~15 languages Dignus clients see most. Returns ISO-639-1 or 'und'.
const LANG_SIGNAL_WORDS = {
  en: ['the','and','was','were','very','great','amazing','our','staff','room','hotel','breakfast','bed','service','pool','nice','good','bad'],
  es: ['el','la','los','las','fue','muy','personal','habitación','hotel','desayuno','piscina','buenísimo','bueno','malo','excelente','increíble','cama'],
  de: ['der','die','das','war','sehr','gut','schlecht','personal','zimmer','hotel','frühstück','pool','bett','service'],
  fr: ['le','la','les','était','très','bien','mauvais','chambre','hôtel','petit','déjeuner','piscine','service','personnel'],
  it: ['il','la','i','le','era','molto','buono','male','camera','hotel','colazione','piscina','servizio','personale'],
  pt: ['o','a','os','as','foi','muito','bom','mau','quarto','hotel','café','piscina','serviço','pessoal'],
  nl: ['de','het','een','was','zeer','goed','slecht','kamer','hotel','ontbijt','zwembad','personeel'],
  sv: ['och','det','var','mycket','bra','dåligt','rum','hotell','frukost','pool','personal'],
  no: ['og','det','var','veldig','bra','dårlig','rom','hotell','frokost','basseng'],
  ru: ['и','в','не','на','очень','хорошо','плохо','номер','отель','завтрак','бассейн','персонал'],
  pl: ['i','w','na','bardzo','dobry','zły','pokój','hotel','śniadanie','basen','personel'],
  tr: ['ve','çok','iyi','kötü','oda','otel','kahvaltı','havuz','personel'],
  ja: ['の','は','と','が','を','ホテル','部屋','スタッフ','朝食','プール','サービス'],
  zh: ['的','和','是','在','很','好','不','酒店','房间','员工','服务','早餐'],
  ar: ['و','في','من','على','الفندق','الغرفة','الموظفين','جيد','سيء','الإفطار'],
};

function detectLanguage(text) {
  if (!text || text.length < 20) return 'und';
  const t = String(text).toLowerCase();
  const scores = {};
  for (const [lang, words] of Object.entries(LANG_SIGNAL_WORDS)) {
    let hits = 0;
    for (const w of words) {
      // Word boundary for latin; substring for CJK/Arabic (no boundaries)
      const isCJK = /[\u3040-\u30ff\u4e00-\u9fff\u0600-\u06ff]/.test(w);
      if (isCJK) { if (t.includes(w)) hits++; }
      else { const re = new RegExp(`(^|\\W)${w}(\\W|$)`, 'i'); if (re.test(t)) hits++; }
    }
    if (hits > 0) scores[lang] = hits;
  }
  const ranked = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  if (ranked.length === 0) return 'und';
  const [top, topScore] = ranked[0];
  const [, second] = ranked[1] || [null, 0];
  // Need a clear winner — if top and second are within 1 hit, call it 'und'.
  if (topScore - (second || 0) < 1 && topScore < 3) return 'und';
  return top;
}

// ── Content hash for dedup ───────────────────────────────────────────────────
function contentHash(title, body) {
  const norm = `${(title || '').trim()}\n${(body || '').trim()}`.toLowerCase().replace(/\s+/g, ' ');
  return crypto.createHash('sha1').update(norm).digest('hex').slice(0, 16);
}

// ── Archetype inference from themes + phrases ────────────────────────────────
// Lightweight heuristic classifier that tags each review with one or more
// of the hospitality archetypes. Used both to reject unclassifiable batches
// and to measure coverage (every major archetype should have N reviews).
const ARCHETYPE_CUES = {
  business_traveler: [
    /\b(business trip|work trip|conference|client meeting|corporate rate|expense|amex|concur|wifi call|video call|zoom|early breakfast|late checkout for meetings?)\b/i,
    /\b(check.?in.*(fast|quick|minutes?)|hvac|AC (was|cycled)|resort fee)\b/i,
    // ES: viaje de trabajo / negocios / tarifa corporativa
    /\b(viaje de (negocios|trabajo)|congreso|reunión|tarifa corporativa|gastos de empresa|llamada (de )?trabajo|desayuno temprano|salida tardía)\b/i,
    // DE: Geschäftsreise / Tagung / Firmenrate
    /\b(geschäftsreise|tagung|firmenrate|spesen|arbeitsreise)\b/i,
    // FR: voyage d'affaires / réunion / tarif corporate
    /\b(voyage d'affaires|réunion professionnelle|tarif corporate|réunion client|petit.?déjeuner tôt)\b/i,
  ],
  family_vacationer: [
    /\b(kids club|children|babysit|stroller|connecting rooms?|family room|cot|crib|family friendly)\b/i,
    /\b(our (son|daughter|boys|girls|children)|kid.?friendly|picky eater)\b/i,
    // ES
    /\b(con niñ[oa]s?|nuestros? (hij[oa]s?|niñ[oa]s?)|familia|cuna|habitación comunicad|club infantil|para familias)\b/i,
    // DE
    /\b(mit kinder[nm]?|unsere? (sohn|tochter|kinder)|familie|kinderbett|verbindungstür|kinderclub|familien(freundlich|zimmer))\b/i,
    // FR
    /\b(avec (les )?enfants?|notre fils|notre fille|famille|lit bébé|chambre communicante|club enfants|en famille)\b/i,
  ],
  luxury_seeker: [
    /\b(five star|5-star|concierge|butler|michelin|aman|four seasons|belmond|six senses|mandarin oriental|quiet luxury)\b/i,
    /\b(turndown|handwritten note|bespoke|personali[sz]ed service|attention to detail)\b/i,
    // ES
    /\b(cinco estrellas|de lujo|conserje|mayordomo|atención al detalle|servicio personalizado|hotel de lujo)\b/i,
    // DE
    /\b(fünf.?sterne|luxus|konzierge|butler|aufmerksam(e|er) service|liebevoll(e|er) detail)\b/i,
    // FR
    /\b(cinq étoiles|luxe|luxueux|concierge|majordome|service personnalisé|attention aux détails)\b/i,
  ],
  honeymooner: [
    /\b(honeymoon|anniversary|proposal|we just got married|just got engaged|romantic getaway|intimate)\b/i,
    /\b(rose petals|champagne (in )?room|couples.{1,6}spa|adults only|no kids)\b/i,
    // ES
    /\b(luna de miel|aniversario|propuesta|recién casados|escapada romántica|pareja|romántico)\b/i,
    /\b(pétalos de rosa|champagne|spa de parejas|solo adultos)\b/i,
    // DE
    /\b(flitterwochen|hochzeitsreise|jahrestag|romantischer? (kurzurlaub|wochenende)|paar)\b/i,
    // FR
    /\b(lune de miel|anniversaire|fiançailles|jeunes mariés|escapade romantique|couple|romantique)\b/i,
  ],
  digital_nomad: [
    /\b(remote work|work from|wifi speed|mbps|fiber|zoom.+call|video call|desk in room|coworking|co-working|long stay|monthly rate)\b/i,
    /\b(digital nomad|workation)\b/i,
    // ES
    /\b(trabajo remoto|velocidad (de )?wifi|escritorio en la habitación|tarifa mensual|nómada digital|estancia larga)\b/i,
    // DE
    /\b(remote.?arbeit|wlan.?geschwindigkeit|schreibtisch im zimmer|langzeit(aufenthalt)?|digital(e|er) nomad)\b/i,
    // FR
    /\b(télétravail|vitesse (du )?wifi|bureau dans la chambre|tarif mensuel|nomade numérique|long séjour)\b/i,
  ],
  budget_optimizer: [
    /\b(overpriced|value for money|not worth|for the price|expensive|resort fee|hidden fee|surcharge)\b/i,
    /\b(booking\.com|cheaper on|rate parity|best price)\b/i,
    // ES
    /\b(sobrecost\w+|relación calidad precio|no vale|por el precio|caro|tarifa resort|cargo oculto|recargo)\b/i,
    // DE
    /\b(überteuert|preis.?leistung|nicht wert|für den preis|teuer|zusatz(gebühr|kosten)|versteckt(e|er) gebühr)\b/i,
    // FR
    /\b(surfacturé|rapport qualité.?prix|pas valable|pour ce prix|cher|frais cachés|supplément)\b/i,
  ],
  loyalty_maximizer: [
    /\b(bonvoy|melia.?rewards|honors|hyatt globalist|diamond|platinum|gold status|elite status|member rate|upgrade to suite|points|redemption)\b/i,
    // ES
    /\b(socio|nivel oro|nivel platino|nivel élite|tarifa socio|puntos|canje)\b/i,
    // DE
    /\b(status|platin(status)?|gold(status)?|elite(status)?|mitglied|mitgliedspreis|punkte)\b/i,
    // FR
    /\b(statut|platinum|or|élite|membre|tarif membre|points|échange)\b/i,
  ],
  event_attendee: [
    /\b(for the wedding|for the conference|for the sports|congreso|maratón|marathon|trade show|event|mwc|nba|concert|festival)\b/i,
    /\b(venue (was |is )?close|walking distance to)\b/i,
    // ES
    /\b(para la boda|para el congreso|para el evento|maratón|feria|concierto|festival)\b/i,
    /\b(cerca del recinto|a pie al?)\b/i,
    // DE
    /\b(für die hochzeit|für die konferenz|für das event|marathon|messe|konzert|festival)\b/i,
    // FR
    /\b(pour le mariage|pour la conférence|pour l'événement|marathon|salon|concert|festival)\b/i,
  ],
  wellness_retreat_seeker: [
    /\b(yoga|detox|retreat|hydrothermal|hammam|spa treatment|massage|wellness|ayurveda|silent retreat|meditation)\b/i,
  ],
  multigenerational_family: [
    /\b(grandparents?|grandma|grandpa|three generations|multi.?generation|grandchildren)\b/i,
  ],
  solo_female_traveler: [
    /\b(solo female|travelling alone|felt safe|as a woman|solo trip)\b/i,
  ],
  lgbtq_couple: [
    /\b(my (husband|wife) and i .*(same.?sex|gay|lesbian)|queer couple|lgbtq|pride)\b/i,
  ],
  bleisure_extender: [
    /\b(bleisure|extended my trip|stayed on after the conference|work.?vacation|combined business and leisure)\b/i,
  ],
  accessibility_needs: [
    /\b(wheelchair|accessible room|ADA|mobility|ramp|hearing impaired|service animal|bathroom grab bars?)\b/i,
  ],
  sustainability_conscious: [
    /\b(sustainab|eco.?friendly|carbon neutral|net zero|locally sourced|plastic.?free|biomass|solar panels?|greenwash)\b/i,
  ],
  influencer_content_creator: [
    /\b(instagram|instagrammable|tiktok|for the 'gram|photo shoot|content creator|youtuber|vlogger|press trip)\b/i,
  ],
  culinary_tourist: [
    /\b(tasting menu|chef's table|michelin|wine pairing|sommelier|gastronomy|local cuisine|farm to table|truffle|omakase)\b/i,
  ],
  silver_nomad: [
    /\b(retired|we are retired|slow travel|long winter stay|snowbird|seniors? discount|quiet atmosphere)\b/i,
  ],
};

function inferArchetypes(text) {
  const hay = String(text || '');
  const hits = [];
  for (const [arch, regexes] of Object.entries(ARCHETYPE_CUES)) {
    for (const re of regexes) {
      if (re.test(hay)) { hits.push(arch); break; }
    }
  }
  return [...new Set(hits)];
}

// ── Bot / spam heuristics ────────────────────────────────────────────────────
function looksBotLike(text, opts) {
  if (!text) return false;
  const t = String(text);
  const letters = t.replace(/[^A-Za-zÀ-ÿ]/g, '');
  if (letters.length >= 20) {
    const upperRatio = letters.replace(/[^A-Z]/g, '').length / letters.length;
    if (upperRatio >= opts.drop_all_caps_ratio) return 'all_caps';
  }
  // Repeated char runs — "Amazingggggggg hotellll!"
  if (/(.)\1{6,}/.test(t)) return 'character_flooding';
  // Sentence-only stopwords (e.g. "Good hotel" × many)
  if (t.split(/\s+/).filter(Boolean).length < 4 && t.length < 30) return 'too_terse';
  return false;
}

// ── Main filter ──────────────────────────────────────────────────────────────
/**
 * @param {Array} reviews  Raw rows in the `reviews_ingested` shape.
 * @param {Object} userOpts See DEFAULT_OPTS.
 * @returns {{ accepted: Array, rejected: Array, stats: Object }}
 */
function filterReviews(reviews, userOpts = {}) {
  const opts = { ...DEFAULT_OPTS, ...userOpts };
  const seenHash = new Set();
  const reviewerCount = new Map();
  const accepted = [];
  const rejected = [];
  const reasonCounts = {};
  const archetypeCoverage = {};
  const languageCounts = {};

  const now = Date.now();

  for (const raw of reviews) {
    const r = { ...raw };
    const body = r.body || r.review || '';
    const title = r.title || '';
    const reasons = [];

    // 1. Shape
    if (typeof body !== 'string' || !body.trim()) reasons.push('missing_body');

    // 2. Length
    if (body.length < opts.min_body_chars) reasons.push('too_short');
    if (body.length > opts.max_body_chars) reasons.push('too_long');

    // 3. Dedup (content hash)
    const hash = contentHash(title, body);
    if (seenHash.has(hash)) reasons.push('duplicate');
    else seenHash.add(hash);
    r._content_hash = hash;

    // 4. Rating sanity
    const scale = r.rating_scale || opts.expected_rating_scale || (r.rating_numeric > 5 ? 10 : 5);
    const ratingNum = r.rating_numeric != null ? Number(r.rating_numeric) : null;
    if (ratingNum != null) {
      if (Number.isNaN(ratingNum) || ratingNum < 0 || ratingNum > scale) reasons.push('rating_out_of_range');
    }

    // 5. Language
    const lang = r.language || detectLanguage(`${title} ${body}`);
    r._detected_language = lang;
    languageCounts[lang] = (languageCounts[lang] || 0) + 1;
    if (opts.allowed_languages && Array.isArray(opts.allowed_languages) && lang !== 'und' && !opts.allowed_languages.includes(lang)) {
      reasons.push('language_excluded');
    }

    // 6. Outlier reviewer floods
    const who = (r.reviewer_display_name || r.source_review_id || '').toLowerCase();
    if (who) {
      const n = (reviewerCount.get(who) || 0) + 1;
      reviewerCount.set(who, n);
      if (n > opts.max_per_reviewer) reasons.push('reviewer_flood');
    }

    // 7. Bot-like
    const bot = looksBotLike(`${title} ${body}`, opts);
    if (bot) reasons.push(`bot_like:${bot}`);

    // 8. Recency
    const stay = r.stay_month || r.created_at || r.scraped_at;
    if (stay && opts.max_age_years) {
      const t = new Date(stay).getTime();
      if (!Number.isNaN(t)) {
        const ageYears = (now - t) / (365.25 * 24 * 3600 * 1000);
        if (ageYears > opts.max_age_years) reasons.push('too_old');
      }
    }

    // 9. Themes
    const themes = Array.isArray(r.themes_json) && r.themes_json.length
      ? r.themes_json
      : detectThemes(`${title} ${body}`);
    r._themes = themes;
    if (opts.reject_zero_theme && themes.length === 0) reasons.push('no_themes');

    // 10. Archetype inference + tagging
    const arches = inferArchetypes(`${title} ${body}`);
    r._inferred_archetypes = arches;
    for (const a of arches) archetypeCoverage[a] = (archetypeCoverage[a] || 0) + 1;

    r._sentiment_bucket = detectSentimentBucket(ratingNum, scale);

    if (reasons.length === 0 || opts.tag_only) {
      if (opts.tag_only && reasons.length > 0) r._reject_reasons = reasons;
      accepted.push(r);
    } else {
      r._reject_reasons = reasons;
      rejected.push(r);
      for (const reason of reasons) reasonCounts[reason] = (reasonCounts[reason] || 0) + 1;
    }
  }

  // Second-pass: unclassifiable gate. If a large share of the batch is
  // unclassifiable (no archetype cues), we keep them only if configured.
  const unclassifiedCount = accepted.filter(r => (r._inferred_archetypes || []).length === 0).length;
  const unclassifiedPct = accepted.length ? (unclassifiedCount / accepted.length) * 100 : 0;
  let unclassifiedFlag = null;
  if (unclassifiedPct > opts.max_unclassified_pct) {
    unclassifiedFlag = { pct: Math.round(unclassifiedPct * 10) / 10, threshold: opts.max_unclassified_pct };
    if (!opts.allow_unclassified) {
      // Move unclassifiables to rejected
      for (let i = accepted.length - 1; i >= 0; i--) {
        if ((accepted[i]._inferred_archetypes || []).length === 0) {
          accepted[i]._reject_reasons = ['unclassified_over_threshold'];
          rejected.push(accepted[i]);
          accepted.splice(i, 1);
          reasonCounts.unclassified_over_threshold = (reasonCounts.unclassified_over_threshold || 0) + 1;
        }
      }
    }
  }

  return {
    accepted,
    rejected,
    stats: {
      total_in: reviews.length,
      accepted: accepted.length,
      rejected: rejected.length,
      unique_hashes: seenHash.size,
      reject_reason_counts: reasonCounts,
      archetype_coverage_counts: archetypeCoverage,
      language_counts: languageCounts,
      unclassified_pct: Math.round(unclassifiedPct * 10) / 10,
      unclassified_flag: unclassifiedFlag,
    },
  };
}

module.exports = {
  filterReviews,
  detectLanguage,
  inferArchetypes,
  contentHash,
  DEFAULT_OPTS,
};
