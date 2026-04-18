/**
 * Review Imperfection — post-processor for LLM-generated review bodies.
 *
 * Raw LLM output reads too clean: no typos, no fragmented sentences, no
 * clichéd openers, no place-name errors. Real reviews carry these signals of
 * being human-written. This module injects calibrated imperfections by
 * (platform × culture × identity × language), deterministically enough to be
 * predictable and subtle enough to not break coherence.
 *
 * What it does:
 *   - Injects typos at a calibrated rate (keyboard-adjacent swap)
 *   - Prepends a cultural / archetype-appropriate opener ~30% of the time
 *   - Injects mid-sentence filler like "honestly," "I mean," "to be fair"
 *   - Occasionally truncates with "..." (trailing thoughts)
 *   - Allows place-name variants typical of non-native writers
 *   - Platform-specific post-processing (Google: drop title→inline bold,
 *     Booking: pros/cons split, Xiaohongshu: emoji sprinkle)
 *
 * All behaviour driven by rates so totals stay predictable across N=20+
 * simulations. No LLM call.
 */

// ─── Typo injection ──────────────────────────────────────────────────────
// Keyboard-adjacent swaps for QWERTY; used for Latin-alphabet languages only.
const ADJACENT_KEYS = {
  a: 'sqzw', b: 'vghn', c: 'xdfv', d: 'sfcexr', e: 'wrsd', f: 'dgcvtr',
  g: 'fhvbty', h: 'gjbnyu', i: 'uokj', j: 'hkumni', k: 'jlmio', l: 'kopm',
  m: 'njk', n: 'bhjm', o: 'iplk', p: 'ol', q: 'aw', r: 'etdf',
  s: 'adwxze', t: 'ryfg', u: 'yihj', v: 'cfbg', w: 'qeas', x: 'zcsd',
  y: 'tuhg', z: 'asx',
};

const LATIN_LANGS = new Set(['en', 'es', 'de', 'fr', 'it', 'pt', 'nl', 'pl', 'sv', 'da', 'no', 'fi']);

function injectTypos(text, { rate = 0.003, lang = 'en' } = {}) {
  if (!LATIN_LANGS.has(String(lang).toLowerCase().slice(0, 2))) return text;
  if (!text) return text;
  const chars = [...text];
  let changed = 0;
  const maxChanges = Math.max(1, Math.floor(text.length * rate) + 1);
  for (let i = 0; i < chars.length && changed < maxChanges; i++) {
    if (Math.random() > rate) continue;
    const c = chars[i];
    const lower = c.toLowerCase();
    if (!ADJACENT_KEYS[lower]) continue;
    const adj = ADJACENT_KEYS[lower];
    const newChar = adj[Math.floor(Math.random() * adj.length)];
    chars[i] = c === lower ? newChar : newChar.toUpperCase();
    changed++;
  }
  return chars.join('');
}

// ─── Opener clichés by culture + archetype ────────────────────────────────
const OPENER_BANK_BY_CULTURE = {
  anglo_uk_ireland: [
    'Just got back from',
    'Can\'t believe I\'m back to reality.',
    'Right, where to start.',
    'Absolutely brilliant stay at',
    'From the moment we arrived,',
  ],
  anglo_us_canada: [
    'WOW. Just wow.',
    'We had an ABSOLUTELY AMAZING stay!!!',
    'Let me start by saying',
    'From the moment we walked in,',
    'This place is a HIDDEN GEM.',
  ],
  german_dach: [
    'Gerade zurück vom Urlaub.',
    'Wir haben fünf Nächte verbracht in',
    'Positiv zu erwähnen:',
    'Grundsätzlich ein schöner Aufenthalt, jedoch',
  ],
  french: [
    'Nous sommes rentrés de',
    'Un séjour de quelques nuits à',
    'Globalement correct, mais',
    'À la hauteur des attentes, en partie.',
  ],
  latin_spain_italy: [
    'Volvemos encantados de',
    'Acabamos de llegar de',
    'Una experiencia maravillosa en',
    'Hemos pasado unos días en',
  ],
  latin_american: [
    'Volvemos encantados de',
    'Hicimos una escapada a',
    'Una experiencia inolvidable',
  ],
  nordic: [
    'Just returned from',
    'Spent a few nights at',
    'Overall a good stay at',
  ],
  east_asian: [
    '清潔で快適な滞在でした。',
    'Thank you for the nice stay.',
    'Good location and clean room.',
  ],
  chinese_mainland: [
    '环境真的很美 ✨',
    '打卡了这家酒店',
    '这次出行住的是',
    '姐妹们推荐',
  ],
  middle_east_gcc: [
    'A truly luxurious experience at',
    'Stayed with family at',
    'Excellent hospitality.',
  ],
  _default: [
    'Just back from',
    'We stayed at',
    'Great stay at',
  ],
};

function pickOpener(culturalCluster) {
  const bank = OPENER_BANK_BY_CULTURE[culturalCluster] || OPENER_BANK_BY_CULTURE._default;
  return bank[Math.floor(Math.random() * bank.length)];
}

// ─── Place-name variants (non-native reviewer error patterns) ─────────────
const PLACE_NAME_VARIANTS = {
  Menorca: {
    german_dach: 'Menorka',
    french: 'Minorque',
    anglo_us_canada: 'Minorca',
    anglo_uk_ireland: 'Menorca',
    east_asian: 'メノルカ',
    chinese_mainland: '梅诺卡',
  },
  Mallorca: {
    anglo_us_canada: 'Majorca',
    anglo_uk_ireland: 'Majorca',
    german_dach: 'Mallorca',
  },
  Ibiza: {
    german_dach: 'Ibiza',
    french: 'Ibiza',
  },
  Mahón: {
    anglo_uk_ireland: 'Mahon',
    anglo_us_canada: 'Mahon',
    german_dach: 'Mahón',
  },
};

function applyPlaceNameVariants(text, culturalCluster) {
  let out = text;
  for (const [canonical, variants] of Object.entries(PLACE_NAME_VARIANTS)) {
    const variant = variants[culturalCluster];
    if (variant && variant !== canonical) {
      // 50% chance to swap to the variant (mimics some reviewers getting it right)
      if (Math.random() < 0.5) {
        out = out.split(canonical).join(variant);
      }
    }
  }
  return out;
}

// ─── Trailing ellipsis / fragmented thought (occasional) ──────────────────
function maybeTrailOff(text) {
  if (text.length < 200) return text;
  if (Math.random() > 0.12) return text;
  // Pick a mid-to-late sentence and replace its period with "..."
  const sentences = text.match(/[^.!?]+[.!?]+/g);
  if (!sentences || sentences.length < 3) return text;
  const idx = Math.floor(sentences.length * 0.6) + Math.floor(Math.random() * Math.min(2, sentences.length - Math.floor(sentences.length * 0.6)));
  sentences[idx] = sentences[idx].replace(/[.!?]+$/, '…');
  return sentences.join('').concat(text.replace(sentences.join(''), ''));
}

// ─── Filler injection mid-review ──────────────────────────────────────────
const FILLER_BY_LANG = {
  en: [' honestly,', ' I mean,', ' to be fair,', ' mind you,', ' that said,'],
  es: [' la verdad,', ' eso sí,', ' a decir verdad,'],
  de: [' ehrlich gesagt,', ' zugegeben,', ' allerdings,'],
  fr: [' honnêtement,', ' cela dit,', ' à vrai dire,'],
  it: [' sinceramente,', ' devo dire,'],
  pt: [' honestamente,', ' para ser justo,'],
  nl: [' eerlijk gezegd,'],
};

function injectFiller(text, lang) {
  const bank = FILLER_BY_LANG[String(lang).toLowerCase().slice(0, 2)];
  if (!bank) return text;
  if (Math.random() > 0.35) return text;
  // Pick a sentence boundary roughly in the middle and insert a filler at the start of the next sentence
  const sentences = text.match(/[^.!?]+[.!?]+\s*/g);
  if (!sentences || sentences.length < 4) return text;
  const insertAt = Math.floor(sentences.length / 2);
  const filler = bank[Math.floor(Math.random() * bank.length)];
  // Insert at the very start of the target sentence: capitalize check
  const target = sentences[insertAt];
  const first = target.charAt(0);
  sentences[insertAt] = `${filler.trimStart().replace(/^./, c => c.toLowerCase()).replace(/,$/, '')}, ${first.toLowerCase()}${target.slice(1)}`;
  return sentences.join('');
}

// ─── Platform-specific tweaks ─────────────────────────────────────────────
function applyPlatformTweaks(body, platform, culturalCluster) {
  let out = body;
  const p = String(platform || '').toLowerCase();

  if (p === 'xiaohongshu' || p === 'douyin') {
    // Emoji sprinkle for photo-led platforms
    const emojis = ['✨', '💕', '🌊', '☀️', '🏖️', '🍽️', '📸', '💎'];
    // Insert 2-4 emojis at sentence breaks
    const count = 2 + Math.floor(Math.random() * 3);
    const sentences = out.split(/([.!?。！？]\s*)/);
    for (let i = 0; i < count && sentences.length > 2; i++) {
      const idx = 1 + 2 * Math.floor(Math.random() * Math.floor((sentences.length - 1) / 2));
      sentences[idx] = sentences[idx] + ' ' + emojis[Math.floor(Math.random() * emojis.length)];
    }
    out = sentences.join('');
  }

  if (p === 'google') {
    // Google reviews are punchier — if over 300 words, cut to ~60% length by
    // keeping first 3 sentences + last sentence.
    const words = out.split(/\s+/);
    if (words.length > 320) {
      const sentences = out.match(/[^.!?]+[.!?]+/g) || [out];
      if (sentences.length >= 5) {
        out = [...sentences.slice(0, 3), sentences[sentences.length - 1]].join(' ');
      }
    }
  }

  if (p === 'booking.com' || p === 'booking') {
    // Booking reviews are often written with a pros/cons split already visible.
    // If the LLM returned a single paragraph and the stay is mixed, split on
    // the first conjunction suggesting transition.
    if (!/\n/.test(out) && /\b(however|but|although|sin embargo|allerdings|cependant|tuttavia)\b/i.test(out)) {
      const split = out.split(/\b(however|but|although|sin embargo|allerdings|cependant|tuttavia)\b/i);
      if (split.length >= 3) {
        out = split[0].trim() + '\n\n' + split.slice(1).join('').trim();
      }
    }
  }

  return out;
}

/**
 * Main entrypoint. Applies the full post-processing stack in a deterministic
 * order. Any step may be skipped per the random rates within.
 *
 * @param {Object} params
 * @param {string} params.body
 * @param {string} params.platform
 * @param {string} params.language           ISO-2 code
 * @param {string} params.culturalCluster
 * @param {string} params.identityStyleKey
 * @returns {string}
 */
function injectImperfections({ body, platform, language = 'en', culturalCluster = '_default', identityStyleKey = null } = {}) {
  if (!body || typeof body !== 'string') return body;
  let out = body;

  // Opener cliché: only prepend if LLM didn't already start with one.
  // Suppress for cultures that prefer neutral factual opens (east_asian, nordic).
  const neutralOpenerCultures = new Set(['east_asian', 'nordic']);
  if (!neutralOpenerCultures.has(culturalCluster) && Math.random() < 0.35) {
    const opener = pickOpener(culturalCluster);
    // Only add if the current start doesn't already look like an opener
    const first30 = out.slice(0, 30).toLowerCase();
    if (!/^(from|just|wow|absolutely|we|i|nous|gerade|acabamos|volvemos)/.test(first30)) {
      out = `${opener} ${out.charAt(0).toLowerCase() + out.slice(1)}`;
    }
  }

  // Place name variants for non-native reviewers
  out = applyPlaceNameVariants(out, culturalCluster);

  // Filler injection
  out = injectFiller(out, language);

  // Typo rate varies by culture + identity:
  // - value_auditor, practical_reviewer, brand_insider → very low (they re-read)
  // - wide_eyed_newcomer, storyteller, family_reviewer → moderate
  // - german_dach and east_asian → very low (precision cultures)
  let typoRate = 0.0025;
  if (['value_auditor', 'practical_reviewer', 'brand_insider', 'food_expert'].includes(identityStyleKey)) typoRate = 0.001;
  if (['wide_eyed_newcomer', 'storyteller', 'family_reviewer'].includes(identityStyleKey)) typoRate = 0.004;
  if (['german_dach', 'east_asian'].includes(culturalCluster)) typoRate *= 0.5;
  if (['anglo_us_canada'].includes(culturalCluster)) typoRate *= 1.15;
  out = injectTypos(out, { rate: typoRate, lang: language });

  // Trailing thought
  out = maybeTrailOff(out);

  // Platform tweaks
  out = applyPlatformTweaks(out, platform, culturalCluster);

  return out;
}

module.exports = {
  injectImperfections,
  injectTypos,
  pickOpener,
  applyPlaceNameVariants,
  OPENER_BANK_BY_CULTURE,
};
