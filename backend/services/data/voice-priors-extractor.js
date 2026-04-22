/**
 * Voice Priors Extractor — turns a corpus of real reviews into
 * per-cluster statistical signatures. Each signature (archetype × sentiment ×
 * language × star_bucket) becomes a "voice prior" that the persona
 * generator injects so every synthetic user inherits real-person vocabulary,
 * sentence length, emotional intensity, and complaint/praise patterns.
 *
 * Output shape (saved as voice_priors_from_reviews.json):
 *   {
 *     _source: "huggingface_nhull_v2 + scraped_reviews/*",
 *     _generated_at: ISO,
 *     _review_count: int,
 *     clusters: {
 *        "<archetype>.<sentiment>.<lang>.<star>": {
 *           n: int,
 *           top_unigrams: [["concierge", 0.034], ...],     // [term, relative_freq]
 *           top_bigrams:  [["the staff", 0.012], ...],
 *           sentence_starters: [["we had", 4], ...],
 *           sentence_length: { mean, p25, p50, p75, max },
 *           emotional_intensity: { exclaim_mean, superlative_mean, caps_word_mean },
 *           complaint_phrases: [string, string, ...],      // for negative clusters
 *           praise_phrases:    [string, string, ...],      // for positive clusters
 *           example_quotes:    [short_quote, short_quote, ...]
 *        }
 *     }
 *   }
 */

const { inferArchetypes, detectLanguage } = require('./calibration-filters');
const { detectSentimentBucket } = require('./review-parser');

// ─── Stopwords (multi-lingual; small footprint, good enough for TF filtering) ─
const STOP = new Set([
  // EN
  'the','a','an','and','or','but','if','of','on','in','at','to','for','with','as','is','was','were','be','been','being','have','has','had','do','does','did','can','could','would','should','may','might','will','shall','this','that','these','those','it','its','i','we','you','they','he','she','them','us','me','my','our','your','their','his','her','so','than','then','too','very','just','not','no','yes','also','here','there','when','where','what','who','why','how','from','up','down','out','about','after','before','into','over','under','again','more','most','some','any','all','each','other','another','one','two','three',
  // ES
  'el','la','los','las','un','una','unos','unas','y','o','pero','si','de','del','a','al','en','con','por','para','que','es','son','fue','fueron','ha','han','hemos','hay','este','esta','estos','estas','eso','esa','esos','esas','yo','tú','usted','nosotros','ellos','lo','le','se','mi','mío','tu','su','nuestros','muy','más','menos','también','sólo','solo','sí','no',
  // DE
  'der','die','das','ein','eine','einen','und','oder','aber','von','zu','in','im','auf','mit','für','ist','sind','war','waren','ich','wir','sie','er','es','mich','mir','uns','mein','sehr','auch','nicht','ja','nein','als','so','sehr',
  // FR
  'le','la','les','un','une','des','et','ou','mais','de','du','à','au','aux','en','avec','pour','que','est','sont','était','étaient','je','nous','vous','ils','elles','mon','notre','très','aussi','ne','pas','oui','non','si',
]);

function tokenize(text) {
  if (!text) return [];
  return String(text)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s']/gu, ' ')
    .split(/\s+/)
    .filter(t => t.length >= 3 && t.length <= 20 && !STOP.has(t) && !/^\d+$/.test(t));
}

function splitSentences(text) {
  if (!text) return [];
  return String(text)
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?])\s+(?=[A-ZÁÉÍÓÚÑ])/)
    .map(s => s.trim())
    .filter(s => s.length > 4);
}

function countSuperlatives(text) {
  if (!text) return 0;
  const re = /\b(amazing|incredible|perfect|flawless|exceptional|extraordinary|best|worst|terrible|horrible|awful|outstanding|magnificent|stunning|gorgeous|disgusting|superb|impeccable|deplorable|absolut|parfait|ausgezeich|maravillos|increíbl|espectacul)\w*\b/gi;
  return (text.match(re) || []).length;
}

function countAllcapsWords(text) {
  if (!text) return 0;
  const tokens = String(text).split(/\s+/);
  return tokens.filter(t => /^[A-Z]{3,}$/.test(t)).length;
}

function countExclaims(text) {
  return ((text || '').match(/!/g) || []).length;
}

// ─── Main extractor ──────────────────────────────────────────────────────────
function extractVoicePriors(reviews, opts = {}) {
  const {
    top_unigrams = 30,
    top_bigrams = 20,
    top_starters = 10,
    max_examples = 6,
  } = opts;

  // First pass: tag each review. We re-run inferArchetypes because the cue
  // dictionary gets updated with new multilingual regexes and we want cached
  // pulls to benefit without re-pulling. Tagging on 10K reviews is <1s.
  const tagged = reviews.map(r => {
    const body = r.body || r.review || '';
    const title = r.title || '';
    const text = `${title} ${body}`;
    const arches = inferArchetypes(text);
    const lang = r._detected_language || detectLanguage(text);
    const scale = r.rating_scale || 5;
    const ratingNum = r.rating_numeric != null ? Number(r.rating_numeric) : null;
    const star = ratingNum != null ? Math.max(1, Math.min(5, Math.round(ratingNum / scale * 5))) : 3;
    const sentiment = detectSentimentBucket(ratingNum, scale);
    return { ...r, _body: body, _title: title, _text: text, _arches: arches.length ? arches : ['unclassified'], _lang: lang || 'und', _star: star, _sent: sentiment };
  });

  // Build clusters. Each review can land in multiple archetype clusters AND,
  // when reviewer_origin is known (e.g. from 515K Europe nationality tag),
  // in an additional culture-specific cluster keyed as
  // `<arch>.<sent>.<lang>.<star>.<culture>`. Persona-enricher tries the
  // culture-specific cluster first and falls back to the culture-agnostic one.
  const clusters = new Map();
  const ensureCluster = (key) => {
    if (!clusters.has(key)) clusters.set(key, { n: 0, unigramFreq: new Map(), bigramFreq: new Map(), starterFreq: new Map(), sentLens: [], exclaims: [], caps: [], supers: [], examples: [] });
    return clusters.get(key);
  };

  const accumulateIntoCluster = (c, r, tokens, sentences, sentenceLens) => {
    c.n++;
    for (const t of tokens) c.unigramFreq.set(t, (c.unigramFreq.get(t) || 0) + 1);
    for (let i = 0; i < tokens.length - 1; i++) {
      const bg = `${tokens[i]} ${tokens[i + 1]}`;
      c.bigramFreq.set(bg, (c.bigramFreq.get(bg) || 0) + 1);
    }
    for (const s of sentences) {
      const words = s.split(/\s+/).slice(0, 3).join(' ').toLowerCase().replace(/[^\p{L}\s']/gu, '').trim();
      if (words.split(/\s+/).length >= 2) c.starterFreq.set(words, (c.starterFreq.get(words) || 0) + 1);
    }
    c.sentLens.push(...sentenceLens);
    c.exclaims.push(countExclaims(r._body));
    c.caps.push(countAllcapsWords(r._body));
    c.supers.push(countSuperlatives(r._body));
    if (c.examples.length < max_examples) {
      const firstSent = sentences[0] || r._body.slice(0, 140);
      if (firstSent.length >= 20 && firstSent.length <= 180) c.examples.push(firstSent);
    }
  };

  for (const r of tagged) {
    const culture = r.reviewer_origin || null;  // e.g. 'german_dach'
    const tokens = tokenize(r._text);
    const sentences = splitSentences(r._body);
    const sentenceLens = sentences.map(s => s.split(/\s+/).length).filter(l => l > 0);

    for (const arch of r._arches) {
      // Primary cluster: culture-agnostic (always written — union of all cultures)
      const baseKey = `${arch}.${r._sent}.${r._lang}.${r._star}`;
      accumulateIntoCluster(ensureCluster(baseKey), r, tokens, sentences, sentenceLens);

      // Secondary cluster: culture-specific (only when reviewer_origin is tagged)
      if (culture) {
        const culturalKey = `${arch}.${r._sent}.${r._lang}.${r._star}.${culture}`;
        accumulateIntoCluster(ensureCluster(culturalKey), r, tokens, sentences, sentenceLens);
      }
    }
  }

  // Compute global unigram frequencies for IDF-style distinctiveness scoring
  const globalUnigramFreq = new Map();
  let globalTokens = 0;
  for (const c of clusters.values()) {
    for (const [t, n] of c.unigramFreq.entries()) {
      globalUnigramFreq.set(t, (globalUnigramFreq.get(t) || 0) + n);
      globalTokens += n;
    }
  }

  // Finalise each cluster
  const out = {};
  const quartile = (arr, q) => {
    if (arr.length === 0) return 0;
    const sorted = [...arr].sort((a, b) => a - b);
    const idx = Math.max(0, Math.min(sorted.length - 1, Math.floor(q * sorted.length)));
    return sorted[idx];
  };
  const mean = (arr) => arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : 0;

  for (const [key, c] of clusters.entries()) {
    if (c.n < 3) continue;  // too thin, skip

    // Distinctiveness: term_freq_cluster / term_freq_global. We require:
    //   - n >= 4 (appears at least 4x in this cluster to be a pattern)
    //   - global >= 6 (appears at least 6x total so we know it's a real word,
    //     not a rare proper noun or typo)
    // This filters out "jamel" / "charlene" / "uhl" style noise.
    const unigramScored = [...c.unigramFreq.entries()]
      .filter(([t, n]) => n >= 4 && (globalUnigramFreq.get(t) || 0) >= 6)
      .map(([t, n]) => {
        const global = globalUnigramFreq.get(t) || 1;
        const localRate = n / Math.max(1, c.sentLens.length + c.n);
        const globalRate = global / Math.max(1, globalTokens);
        const distinctiveness = localRate / globalRate;
        // Weight: distinctiveness × log(n), penalise hapax-like rarities.
        return { term: t, n, distinctiveness, score: distinctiveness * Math.log(1 + n) };
      })
      .sort((a, b) => b.score - a.score);

    const topU = unigramScored.slice(0, top_unigrams).map(u => [u.term, Math.round(u.distinctiveness * 100) / 100]);
    const topB = [...c.bigramFreq.entries()].filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1]).slice(0, top_bigrams).map(([t, n]) => [t, n]);
    const topS = [...c.starterFreq.entries()].sort((a, b) => b[1] - a[1]).slice(0, top_starters).map(([t, n]) => [t, n]);

    const parts = key.split('.');
    out[key] = {
      n: c.n,
      archetype: parts[0],
      sentiment: parts[1],
      language: parts[2],
      star: Number(parts[3]),
      culture: parts[4] || null,
      top_unigrams: topU,
      top_bigrams: topB,
      sentence_starters: topS,
      sentence_length: {
        mean: Math.round(mean(c.sentLens) * 10) / 10,
        p25: quartile(c.sentLens, 0.25),
        p50: quartile(c.sentLens, 0.5),
        p75: quartile(c.sentLens, 0.75),
        max: Math.max(...c.sentLens, 0),
      },
      emotional_intensity: {
        exclaim_mean: Math.round(mean(c.exclaims) * 100) / 100,
        caps_word_mean: Math.round(mean(c.caps) * 100) / 100,
        superlative_mean: Math.round(mean(c.supers) * 100) / 100,
      },
      example_quotes: c.examples.slice(0, max_examples),
    };
  }

  return {
    clusters: out,
    _cluster_count: Object.keys(out).length,
    _total_reviews_in: reviews.length,
    _generated_at: new Date().toISOString(),
  };
}

/**
 * Given a persona's (archetype, cultural_cluster → language proxy, sentiment_lean,
 * target_star), return the best-matching voice prior (falls back through
 * hierarchy: exact → drop star → drop language → drop sentiment → archetype only).
 */
function lookupVoicePrior(priors, { archetype, language, sentiment, star, culture = null }) {
  if (!priors?.clusters) return null;
  const minN = 3;
  const starHi = Math.min(5, star + 1);
  const starLo = Math.max(1, star - 1);

  // Candidate chain. Preferring order:
  //   A) exact archetype + sentiment + lang + star + CULTURE  (best)
  //   B) archetype + sentiment + lang + star (culture-agnostic)
  //   C) drop sentiment / star / language progressively
  //   D) unclassified in same language (big Spanish anchor)
  //   E) English fallbacks
  //
  // If `culture` is null we skip the culture-specific rows and go straight
  // to the culture-agnostic chain.
  const culturalHead = culture ? [
    `${archetype}.${sentiment}.${language}.${star}.${culture}`,
    `${archetype}.${sentiment}.${language}.${starHi}.${culture}`,
    `${archetype}.${sentiment}.${language}.${starLo}.${culture}`,
    `${archetype}.positive.${language}.${star}.${culture}`,
    `${archetype}.positive.en.${star}.${culture}`,
    `${archetype}.positive.en.5.${culture}`,
  ] : [];
  const candidates = [
    ...culturalHead,
    `${archetype}.${sentiment}.${language}.${star}`,
    `${archetype}.${sentiment}.${language}.${starHi}`,
    `${archetype}.${sentiment}.${language}.${starLo}`,
    `${archetype}.positive.${language}.${star}`,
    `${archetype}.mixed.${language}.${star}`,
    `unclassified.${sentiment}.${language}.${star}`,
    `unclassified.${sentiment}.${language}.${starHi}`,
    `unclassified.positive.${language}.${star}`,
    `${archetype}.${sentiment}.en.${star}`,
    `${archetype}.${sentiment}.en.${starHi}`,
    `${archetype}.positive.en.${star}`,
    `${archetype}.positive.en.5`,
    `${archetype}.positive.en.4`,
  ];
  for (const k of candidates) if (priors.clusters[k] && priors.clusters[k].n >= minN) return { key: k, ...priors.clusters[k] };

  // Fallback: any cluster for this archetype (any language)
  const archFallback = Object.entries(priors.clusters).find(([k, v]) => k.startsWith(`${archetype}.`) && v.n >= minN);
  if (archFallback) return { key: archFallback[0], ...archFallback[1] };

  // Last resort: any cluster in target language at the right star
  const langFallback = Object.entries(priors.clusters).find(([k, v]) => {
    const p = k.split('.');
    return p[2] === language && Number(p[3]) === star && v.n >= minN;
  });
  return langFallback ? { key: langFallback[0], ...langFallback[1] } : null;
}

module.exports = {
  extractVoicePriors,
  lookupVoicePrior,
  tokenize,
  splitSentences,
};
