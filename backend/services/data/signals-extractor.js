/**
 * Signals Extractor — turns a voice-prior cluster into a structured decision
 * fingerprint the simulation can reason over (not just narrate).
 *
 * Each cluster gets 8 normalised signals in [0, 1] plus a handful of
 * categorical tags. The simulation uses these to:
 *   - adjust persona trait priors at runtime (price_sensitivity override)
 *   - decide amenity focus (pull suite/spa/kids-club mentions)
 *   - drive scenario-preview impact math (price hike hurts more at 0.9 sens)
 *   - rank complaint triggers (what will blow up a stay for this cluster?)
 *
 * Multilingual-aware: the cue dictionaries map (en, es, de, fr) per signal,
 * so the extractor works the same way on any corpus subset.
 *
 * Output per cluster:
 * {
 *   signals: {
 *     price_sensitivity:        0..1,
 *     service_expectation:      0..1,
 *     cleanliness_threshold:    0..1,
 *     loyalty_sensitivity:      0..1,
 *     emotional_intensity:      0..1,
 *     luxury_benchmark_count:   0..N (absolute) + 0..1 (normalised),
 *     family_orientation:       0..1,
 *     decision_latency_proxy:   0..1
 *   },
 *   amenity_focus: ['spa', 'concierge', 'dining'],         // top 3
 *   complaint_triggers: ['wifi', 'noise', 'hidden_fee'],   // top 3
 *   review_len_band: 'short' | 'medium' | 'long',
 *   bands: { emotional_intensity: 'high', ... },
 *   language_coverage: ['en', 'es']
 * }
 */

// ─── Multilingual cue dictionaries ───────────────────────────────────────────
// Each signal has a regex array per language. We score a cluster by counting
// cue hits across its example_quotes + top_bigrams + top_unigrams.

const CUES = {
  price_sensitivity: {
    en: [/\bprice\b/i, /\bexpensive\b/i, /\boverpriced\b/i, /\bvalue\b/i, /\bworth\b/i, /\bcheap(er)?\b/i, /\bresort fee\b/i, /\bhidden (charge|fee)\b/i, /\brip.?off\b/i, /\bbook(ing)?\.com\b/i],
    es: [/\bprecio\b/i, /\bcaro\b/i, /\bbarato\b/i, /\brelación calidad.?precio\b/i, /\bvale la pena\b/i, /\btarifa\b/i, /\bsobrecost\w*/i],
    de: [/\bpreis\b/i, /\bteuer\b/i, /\bgünstig\b/i, /\bpreis.?leistung\b/i, /\blohnt sich\b/i, /\bzusatz(kosten|gebühr)\b/i],
    fr: [/\bprix\b/i, /\bcher\b/i, /\bbon marché\b/i, /\brapport qualité.?prix\b/i, /\bsupplément\b/i, /\bfrais cachés\b/i],
  },
  service_expectation: {
    en: [/\bconcierge\b/i, /\bbutler\b/i, /\bstaff\b/i, /\bservice\b/i, /\battentive\b/i, /\bpersonali[sz]ed\b/i, /\bturndown\b/i, /\babove and beyond\b/i, /\brude\b/i, /\bindifferent\b/i],
    es: [/\bconserje\b/i, /\bmayordomo\b/i, /\bpersonal\b/i, /\bservicio\b/i, /\batento\b/i, /\bpersonalizad\w+/i, /\bgrosero\b/i, /\bindiferent\w+/i],
    de: [/\bkonzierge|concierge\b/i, /\bbutler\b/i, /\bpersonal\b/i, /\bservice\b/i, /\baufmerksam\b/i, /\bunhöflich\b/i, /\bindifferent\b/i],
    fr: [/\bconcierge\b/i, /\bmajordome\b/i, /\bpersonnel\b/i, /\bservice\b/i, /\battentionné\b/i, /\bimpoli\b/i, /\bindifférent\b/i],
  },
  cleanliness_threshold: {
    en: [/\bclean\b/i, /\bspotless\b/i, /\bimmaculate\b/i, /\bdirty\b/i, /\bdust\b/i, /\bhair\b/i, /\bmo(u)?ldy?\b/i, /\bstain(ed)?\b/i, /\bdisgust\w+/i],
    es: [/\blimpi\w+/i, /\bimpecabl\w+/i, /\bsuci\w+/i, /\bpolvo\b/i, /\bpelo\b/i, /\bmanch\w+/i],
    de: [/\bsauber\b/i, /\bmakellos\b/i, /\bschmutzig\b/i, /\bstaub\b/i, /\bhaar\b/i, /\bfleck\w+/i, /\bekelhaft\b/i],
    fr: [/\bpropre\b/i, /\bimpeccabl\w+/i, /\bsale\b/i, /\bpoussière\b/i, /\btache\b/i, /\bdégoût\w+/i],
  },
  loyalty_sensitivity: {
    en: [/\bbonvoy\b/i, /\bmelia ?rewards\b/i, /\bhonors\b/i, /\bglobalist\b/i, /\bdiamond\b/i, /\bplatinum\b/i, /\bgold status\b/i, /\belite\b/i, /\bmember (rate|price)\b/i, /\bpoints?\b/i, /\bredemption\b/i],
    es: [/\bsocio\b/i, /\boro\b/i, /\bplatino\b/i, /\bpuntos?\b/i, /\bnivel élite\b/i],
    de: [/\bstatus\b/i, /\bgold\b/i, /\bplatin\b/i, /\bpunkte\b/i, /\bmitglied\w*/i, /\belite\b/i],
    fr: [/\bmembre\b/i, /\bor\b/i, /\bplatinum\b/i, /\bpoints?\b/i, /\bélite\b/i],
  },
  luxury_benchmarks: {
    en: [/\bfour seasons\b/i, /\baman\b/i, /\bbelmond\b/i, /\bsix senses\b/i, /\bmandarin oriental\b/i, /\brosewood\b/i, /\bbulgari\b/i, /\bone&only\b/i, /\bpark hyatt\b/i, /\bcheval blanc\b/i, /\brits?.?carlton\b/i, /\bconrad\b/i, /\bst\.? regis\b/i, /\bbelmondo\b/i, /\bmichelin\b/i],
    es: [/\bfour seasons\b/i, /\baman\b/i, /\bbelmond\b/i, /\bsix senses\b/i, /\bmandarin\b/i, /\brosewood\b/i, /\britz\b/i, /\bmichelin\b/i],
    de: [/\bfour seasons\b/i, /\baman\b/i, /\bbelmond\b/i, /\bsix senses\b/i, /\bmichelin\b/i, /\bluxus\b/i],
    fr: [/\bfour seasons\b/i, /\baman\b/i, /\bbelmond\b/i, /\bsix senses\b/i, /\bmichelin\b/i, /\bluxe\b/i],
  },
  family_orientation: {
    en: [/\bkids? club\b/i, /\bchildren\b/i, /\bfamily\b/i, /\bstroller\b/i, /\bcrib\b/i, /\bcot\b/i, /\bchildcare\b/i, /\bconnecting rooms?\b/i, /\bbabysit\w*/i],
    es: [/\bniñ\w+/i, /\bhij\w+/i, /\bfamilia\b/i, /\bcuna\b/i, /\bclub infantil\b/i, /\bhabitación comunicad\w+/i],
    de: [/\bkind(er)?\b/i, /\bfamilie\b/i, /\bfamilien\w*/i, /\bkinderbett\b/i, /\bverbindungstür\b/i, /\bkinderbetreuung\b/i],
    fr: [/\benfant\w*/i, /\bfamille\b/i, /\blit bébé\b/i, /\bchambre communicant\w+/i, /\bgarderie\b/i],
  },
  amenity_themes: {
    // These produce the amenity_focus list, not a signal directly
    en: {
      spa:       [/\bspa\b/i, /\bmassage\b/i, /\bhammam\b/i, /\bhydrothermal\b/i, /\bfacial\b/i, /\bhot tub\b/i, /\bsauna\b/i, /\btreatment\b/i],
      pool:      [/\bpool\b/i, /\bswim\b/i, /\binfinity pool\b/i, /\brooftop pool\b/i],
      dining:    [/\brestaurant\b/i, /\bchef\b/i, /\bmenu\b/i, /\btasting\b/i, /\bbreakfast\b/i, /\bdinner\b/i, /\bbuffet\b/i, /\bwine\b/i, /\bmichelin\b/i],
      concierge: [/\bconcierge\b/i, /\bbutler\b/i, /\bpersonali[sz]ed\b/i],
      wifi:      [/\bwifi\b/i, /\bwi.?fi\b/i, /\binternet\b/i, /\bmbps\b/i],
      bed:       [/\bbed\b/i, /\bmattress\b/i, /\bpillow\b/i, /\blinen\b/i],
      kids_club: [/\bkids club\b/i, /\bchildcare\b/i, /\bcrib\b/i],
      beach:     [/\bbeach\b/i, /\bprivate beach\b/i, /\bseafront\b/i],
      design:    [/\bdesign\b/i, /\barchitect\w*/i, /\baesthetic\b/i, /\bdécor\b/i],
      loyalty:   [/\bbonvoy\b/i, /\brewards\b/i, /\bhonors\b/i, /\belite\b/i, /\bpoints\b/i],
      location:  [/\blocation\b/i, /\bwalk(ing)? distance\b/i, /\bcentral\b/i, /\bmetro\b/i],
      business:  [/\bdesk\b/i, /\bbusiness center\b/i, /\bmeeting room\b/i, /\bconference\b/i],
    },
    es: {
      spa:       [/\bspa\b/i, /\bmasaje\b/i, /\bhammam\b/i, /\bsauna\b/i],
      pool:      [/\bpiscina\b/i, /\balberca\b/i],
      dining:    [/\brestaurante\b/i, /\bchef\b/i, /\bmenú\b/i, /\bdesayuno\b/i, /\bcena\b/i, /\bvino\b/i, /\bmichelin\b/i],
      concierge: [/\bconserje\b/i, /\bmayordomo\b/i],
      wifi:      [/\bwifi\b/i, /\binternet\b/i],
      bed:       [/\bcama\b/i, /\bcolchón\b/i, /\balmohada\b/i, /\bsábanas?\b/i],
      kids_club: [/\bclub infantil\b/i, /\bcuna\b/i],
      beach:     [/\bplaya\b/i, /\bprimera línea\b/i],
      design:    [/\bdiseño\b/i, /\barquitect\w*/i, /\bestética\b/i],
      loyalty:   [/\bsocio\b/i, /\bpuntos\b/i, /\bélite\b/i],
      location:  [/\bubicación\b/i, /\bcéntrico\b/i, /\bmetro\b/i],
      business:  [/\bescritorio\b/i, /\bsala de reuniones\b/i, /\bcongreso\b/i],
    },
    de: {
      spa:       [/\bspa\b/i, /\bmassage\b/i, /\bhammam\b/i, /\bsauna\b/i, /\bwellness\b/i],
      pool:      [/\bpool\b/i, /\bschwimm\w*/i],
      dining:    [/\brestaurant\b/i, /\bküche\b/i, /\bmenü\b/i, /\bfrühstück\b/i, /\babendessen\b/i, /\bwein\b/i, /\bmichelin\b/i],
      concierge: [/\bkonzierge\b/i, /\bbutler\b/i],
      wifi:      [/\bwlan\b/i, /\bwifi\b/i, /\binternet\b/i],
      bed:       [/\bbett\b/i, /\bmatratze\b/i, /\bkissen\b/i],
      kids_club: [/\bkinderclub\b/i, /\bkinderbett\b/i],
      beach:     [/\bstrand\b/i],
      design:    [/\bdesign\b/i, /\barchitektur\b/i, /\bästhetik\b/i],
      loyalty:   [/\bmitglied\w*/i, /\bpunkte\b/i, /\belite\b/i],
      location:  [/\blage\b/i, /\bzentrum\b/i, /\bfußweg\b/i],
      business:  [/\bschreibtisch\b/i, /\bkonferenz\b/i, /\btagung\b/i],
    },
    fr: {
      spa:       [/\bspa\b/i, /\bmassage\b/i, /\bhammam\b/i, /\bsauna\b/i, /\bbien.?être\b/i],
      pool:      [/\bpiscine\b/i, /\bnage\b/i],
      dining:    [/\brestaurant\b/i, /\bchef\b/i, /\bmenu\b/i, /\bpetit.?déjeuner\b/i, /\bdîner\b/i, /\bvin\b/i, /\bmichelin\b/i],
      concierge: [/\bconcierge\b/i, /\bmajordome\b/i],
      wifi:      [/\bwifi\b/i, /\binternet\b/i],
      bed:       [/\blit\b/i, /\bmatelas\b/i, /\boreiller\b/i, /\bdraps?\b/i],
      kids_club: [/\bclub enfants\b/i, /\blit bébé\b/i],
      beach:     [/\bplage\b/i, /\bbord de mer\b/i],
      design:    [/\bdesign\b/i, /\barchitecture\b/i, /\besthétique\b/i],
      loyalty:   [/\bmembre\b/i, /\bpoints\b/i, /\bélite\b/i],
      location:  [/\bemplacement\b/i, /\bcentre\b/i, /\bmétro\b/i],
      business:  [/\bbureau\b/i, /\bsalle de réunion\b/i, /\bcongrès\b/i],
    },
  },
  complaint_triggers: {
    en: {
      wifi:         [/\bwifi\b.*\b(slow|bad|broken|drop|down|unusable)\b/i, /\b(slow|bad|weak) wifi\b/i],
      noise:        [/\bnoisy?\b/i, /\bloud\b/i, /\bsoundproof\b/i, /\bneighbou?rs?\b/i, /\bthin walls?\b/i],
      hidden_fee:   [/\bhidden (fee|charge)\b/i, /\bresort fee\b/i, /\bsurprise charge\b/i],
      cleanliness:  [/\bdirty\b/i, /\bdusty\b/i, /\bhair on\b/i, /\bstain\b/i],
      slow_service: [/\bslow\b/i, /\btook forever\b/i, /\bhad to wait\b/i, /\bqueue\b/i],
      rude_staff:   [/\brude\b/i, /\bindifferent\b/i, /\bdismissive\b/i],
      broken:       [/\bbroken\b/i, /\bout of order\b/i, /\bnot working\b/i],
      smell:        [/\bsmell\w*\b/i, /\bodor\b/i, /\bstench\b/i],
    },
    es: {
      wifi:        [/\bwifi\b.*\b(lento|malo|cae|no funciona)\b/i, /\binternet malo\b/i],
      noise:       [/\bruidoso\b/i, /\bruido\b/i, /\bpared(es)? finas?\b/i, /\bvecinos\b/i],
      hidden_fee:  [/\bcargo extra\b/i, /\bsobrecost\w+/i, /\bcobro sorpresa\b/i],
      cleanliness: [/\bsucio\b/i, /\bpolvoriento\b/i, /\bmancha\b/i, /\bpelo en\b/i],
      slow_service:[/\blento\b/i, /\btardó\b/i, /\bcola\b/i],
      rude_staff:  [/\bgrosero\b/i, /\bborde\b/i, /\bindiferent\w+/i],
      broken:      [/\broto\b/i, /\bfuera de servicio\b/i, /\bno funciona\b/i],
      smell:       [/\bolor\b/i, /\bmal olor\b/i],
    },
    de: {
      wifi:        [/\bwlan\b.*\b(langsam|schlecht|funktioniert nicht)\b/i],
      noise:       [/\blaut\b/i, /\blärm\b/i, /\bdünne wände\b/i, /\bnachbarn\b/i],
      hidden_fee:  [/\bzusatz(gebühr|kosten)\b/i, /\bversteckte gebühr\b/i],
      cleanliness: [/\bschmutzig\b/i, /\bhaare\b/i, /\bfleck\w+/i],
      slow_service:[/\blangsam\b/i, /\bwarten\b/i, /\bschlange\b/i],
      rude_staff:  [/\bunhöflich\b/i, /\barrogant\b/i],
      broken:      [/\bkaputt\b/i, /\bdefekt\b/i, /\bfunktioniert nicht\b/i],
      smell:       [/\bgeruch\b/i, /\bgestank\b/i],
    },
    fr: {
      wifi:        [/\bwifi\b.*\b(lent|mauvais|ne fonctionne pas)\b/i],
      noise:       [/\bbruyant\b/i, /\bbruit\b/i, /\bmurs fins\b/i, /\bvoisins?\b/i],
      hidden_fee:  [/\bfrais cachés\b/i, /\bsupplément surprise\b/i],
      cleanliness: [/\bsale\b/i, /\bpoussière\b/i, /\btache\b/i, /\bcheveux sur\b/i],
      slow_service:[/\blent\b/i, /\battendre\b/i, /\bqueue\b/i, /\bfile d'attente\b/i],
      rude_staff:  [/\bimpoli\b/i, /\bhautain\b/i],
      broken:      [/\bcassé\b/i, /\ben panne\b/i, /\bne fonctionne pas\b/i],
      smell:       [/\bodeur\b/i, /\bpuanteur\b/i],
    },
  },
  decision_latency_cues: {
    // Words that indicate fast vs slow decision — for latency proxy
    fast: {
      en: [/\bimpulse\b/i, /\bquick\b/i, /\binstant\w*/i, /\bgut\b/i, /\bknew immediately\b/i, /\bno brainer\b/i, /\blast.minute\b/i, /\bspur of the moment\b/i],
      es: [/\bimpulso\b/i, /\brápid\w+/i, /\binstant\w+/i, /\bal momento\b/i],
      de: [/\bimpuls\b/i, /\bschnell\b/i, /\bsofort\b/i],
      fr: [/\bimpulsion\b/i, /\brapide\b/i, /\binstantan\w+/i, /\bdernière minute\b/i],
    },
    slow: {
      en: [/\bresearch\w*\b/i, /\bcompared\b/i, /\bagonized\b/i, /\bweeks of\b/i, /\banalysis\b/i, /\bdeliberation\b/i, /\bevaluat\w+/i, /\bcross.referenc\w+/i],
      es: [/\binvestigu\w+/i, /\banalic\w+/i, /\bcompar\w+/i, /\bdeliber\w+/i],
      de: [/\brecherchier\w+/i, /\bvergleich\w+/i, /\banaly\w+/i],
      fr: [/\brecherch\w+/i, /\bcompar\w+/i, /\banalys\w+/i, /\bévalu\w+/i],
    },
  },
};

// ─── Helpers ────────────────────────────────────────────────────────────────
function countHits(text, regexes) {
  if (!text) return 0;
  let n = 0;
  for (const re of regexes) {
    const m = text.match(re);
    if (m) n += 1;  // count presence per regex, not every occurrence, to avoid one flood
  }
  return n;
}

function clamp01(x) { return Math.max(0, Math.min(1, x)); }

function collectText(cluster) {
  // Concatenate the most data-rich bits of the cluster for cue matching
  const unigrams = (cluster.top_unigrams || []).map(u => u[0] || u).join(' ');
  const bigrams = (cluster.top_bigrams || []).map(b => b[0] || b).join(' ');
  const quotes = (cluster.example_quotes || []).join(' ');
  const starters = (cluster.sentence_starters || []).map(s => s[0] || s).join(' ');
  return `${unigrams} ${bigrams} ${starters} ${quotes}`;
}

function bestLanguage(cluster, fallback) {
  // Prefer cluster.language; else fallback to 'en'. Signals dictionaries exist
  // in en/es/de/fr; other languages fall back to en cues.
  const lang = cluster.language || fallback || 'en';
  if (['en', 'es', 'de', 'fr'].includes(lang)) return lang;
  return 'en';
}

// ─── Signal functions ───────────────────────────────────────────────────────

function extractSignalsForCluster(cluster, opts = {}) {
  const lang = bestLanguage(cluster, opts.defaultLang);
  const text = collectText(cluster);
  const n = cluster.n || 0;

  // price_sensitivity: hits / sqrt(n), clamped. We use sqrt so clusters with
  // large n aren't falsely rewarded; it's density-ish.
  const priceHits = countHits(text, CUES.price_sensitivity[lang] || CUES.price_sensitivity.en);
  const priceNorm = clamp01(priceHits / 6);

  const serviceHits = countHits(text, CUES.service_expectation[lang] || CUES.service_expectation.en);
  const serviceNorm = clamp01(serviceHits / 6);

  const cleanHits = countHits(text, CUES.cleanliness_threshold[lang] || CUES.cleanliness_threshold.en);
  const cleanNorm = clamp01(cleanHits / 5);

  const loyaltyHits = countHits(text, CUES.loyalty_sensitivity[lang] || CUES.loyalty_sensitivity.en);
  const loyaltyNorm = clamp01(loyaltyHits / 5);

  const luxHits = countHits(text, CUES.luxury_benchmarks[lang] || CUES.luxury_benchmarks.en);
  const luxNorm = clamp01(luxHits / 4);

  const familyHits = countHits(text, CUES.family_orientation[lang] || CUES.family_orientation.en);
  const familyNorm = clamp01(familyHits / 5);

  // Emotional intensity: normalised blend of exclaim_mean and superlative_mean
  const emo = cluster.emotional_intensity || {};
  const emoRaw = (emo.exclaim_mean || 0) * 0.4 + (emo.superlative_mean || 0) * 0.6 + (emo.caps_word_mean || 0) * 0.2;
  const emoNorm = clamp01(emoRaw / 3);

  // Decision latency proxy — fast cues push toward 0, slow cues toward 1
  const fastCues = CUES.decision_latency_cues.fast[lang] || CUES.decision_latency_cues.fast.en;
  const slowCues = CUES.decision_latency_cues.slow[lang] || CUES.decision_latency_cues.slow.en;
  const fastHits = countHits(text, fastCues);
  const slowHits = countHits(text, slowCues);
  const latencyRaw = (slowHits - fastHits) / Math.max(1, fastHits + slowHits);
  const latencyNorm = clamp01((latencyRaw + 1) / 2);  // map [-1,1] → [0,1]

  // Amenity focus — top 3 amenity themes by hit count
  const amenityThemes = CUES.amenity_themes[lang] || CUES.amenity_themes.en;
  const amenityScores = Object.entries(amenityThemes).map(([theme, regs]) => [theme, countHits(text, regs)]);
  const amenityFocus = amenityScores.filter(([, h]) => h > 0).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([t]) => t);

  // Complaint triggers — only meaningful for negative / mixed sentiment clusters
  const isNegative = cluster.sentiment === 'negative' || cluster.sentiment === 'mixed';
  let complaintTriggers = [];
  if (isNegative) {
    const ctThemes = CUES.complaint_triggers[lang] || CUES.complaint_triggers.en;
    const ctScores = Object.entries(ctThemes).map(([theme, regs]) => [theme, countHits(text, regs)]);
    complaintTriggers = ctScores.filter(([, h]) => h > 0).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([t]) => t);
  }

  // Review length band from sentence_length.p50 × average review sentence count
  const slen = cluster.sentence_length || {};
  const typicalLen = (slen.mean || 15) * 5;  // rough: 5 sentences per review
  const reviewLenBand = typicalLen >= 120 ? 'long' : typicalLen >= 60 ? 'medium' : 'short';

  // Emotional intensity band
  const emoBand = emoNorm >= 0.66 ? 'high' : emoNorm >= 0.33 ? 'medium' : 'low';

  return {
    language_detected: lang,
    signals: {
      price_sensitivity:     Math.round(priceNorm * 100) / 100,
      service_expectation:   Math.round(serviceNorm * 100) / 100,
      cleanliness_threshold: Math.round(cleanNorm * 100) / 100,
      loyalty_sensitivity:   Math.round(loyaltyNorm * 100) / 100,
      luxury_benchmark_score: Math.round(luxNorm * 100) / 100,
      family_orientation:    Math.round(familyNorm * 100) / 100,
      emotional_intensity:   Math.round(emoNorm * 100) / 100,
      decision_latency_proxy: Math.round(latencyNorm * 100) / 100,
    },
    amenity_focus: amenityFocus,
    complaint_triggers: complaintTriggers,
    review_len_band: reviewLenBand,
    bands: {
      emotional_intensity: emoBand,
      review_length: reviewLenBand,
      decision_latency: latencyNorm >= 0.6 ? 'deliberate' : latencyNorm <= 0.4 ? 'impulsive' : 'balanced',
    },
  };
}

/**
 * Walk every cluster in a voice-priors document and attach signals{}.
 * Does not mutate the input; returns a new object.
 */
function enrichClustersWithSignals(voicePriorsDoc, opts = {}) {
  if (!voicePriorsDoc?.clusters) return voicePriorsDoc;
  const out = { ...voicePriorsDoc, clusters: {} };
  for (const [key, cluster] of Object.entries(voicePriorsDoc.clusters)) {
    const sig = extractSignalsForCluster(cluster, opts);
    out.clusters[key] = { ...cluster, ...sig };
  }
  out._signals_extracted_at = new Date().toISOString();
  out._signals_schema_version = '1.0.0';
  return out;
}

module.exports = {
  extractSignalsForCluster,
  enrichClustersWithSignals,
  CUES,
};
