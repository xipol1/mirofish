/**
 * Pain Library — retrieves top-K real pain points matching an audience + archetype.
 *
 * Uses the industry adapter when `industrySlug` is provided; otherwise falls
 * back to the legacy default library. Scoring: weighted match on vertical,
 * role, archetype affinity, and concern overlap.
 */

const industries = require('./industries');

function normalizeStr(s) { return String(s || '').toLowerCase().trim(); }

function scoreEntry(entry, { archetypeId, audienceVector }) {
  let score = 0;

  if (Array.isArray(entry.archetype_affinity) && entry.archetype_affinity.includes(archetypeId)) {
    score += 5;
  }

  const audVertical = normalizeStr(audienceVector?.vertical);
  const entryVertical = normalizeStr(entry.vertical);
  if (audVertical && entryVertical && audVertical === entryVertical) score += 3;
  if (audVertical && entryVertical && (audVertical.includes(entryVertical.split('_')[0]) || entryVertical.includes(audVertical.split('_')[0]))) {
    score += 1;
  }

  const audRoleArchetype = normalizeStr(audienceVector?.role_archetype);
  const audRoleLevel = normalizeStr(audienceVector?.role_level);
  const entryRole = normalizeStr(entry.role);
  if (audRoleArchetype && entryRole && (audRoleArchetype.includes(entryRole) || entryRole.includes(audRoleArchetype))) {
    score += 2;
  }
  if (audRoleLevel && entryRole && entryRole.includes(audRoleLevel)) score += 1;

  const audThemes = (audienceVector?.primary_pain_themes || []).map(normalizeStr);
  const audSignals = (audienceVector?.key_signals_they_look_for || []).map(normalizeStr);
  const entryConcerns = (entry.concerns || []).map(normalizeStr);

  for (const c of entryConcerns) {
    for (const t of audThemes) {
      if (c && t && (c.includes(t) || t.includes(c) || sharesToken(c, t))) score += 1.5;
    }
    for (const s of audSignals) {
      if (c && s && (c.includes(s) || s.includes(c) || sharesToken(c, s))) score += 1;
    }
  }

  return score;
}

function sharesToken(a, b) {
  const tokensA = new Set(a.split(/\W+/).filter(x => x.length > 3));
  const tokensB = new Set(b.split(/\W+/).filter(x => x.length > 3));
  for (const t of tokensA) if (tokensB.has(t)) return true;
  return false;
}

function seededNoise(seed) {
  const x = Math.sin((seed + 1) * 12.9898) * 43758.5453;
  return Math.abs(x - Math.floor(x));
}

function retrievePainPoints({ archetypeId, audienceVector, k = 3, seed = 0, industrySlug = 'default' }) {
  const lib = industries.loadIndustryPack(industrySlug).pain_library || [];
  let scored = lib.map((e, idx) => ({
    entry: e,
    score: scoreEntry(e, { archetypeId, audienceVector }),
    _idx: idx,
  }));

  if (seed > 0) {
    scored = scored.map(s => ({
      ...s,
      score: s.score + seededNoise(seed * 37 + s._idx) * 2.5,
    }));
  }

  scored.sort((a, b) => b.score - a.score);

  const top = scored.slice(0, k).filter(s => s.score > 0).map(s => ({
    pain_quote: s.entry.pain_quote,
    language_markers: s.entry.language_markers,
    concerns: s.entry.concerns,
    source_type: s.entry.source_type,
    touchpoint: s.entry.touchpoint || null,
    relevance_score: Math.round(s.score * 10) / 10,
  }));

  if (top.length === 0) {
    const byArchetype = lib
      .filter(e => Array.isArray(e.archetype_affinity) && e.archetype_affinity.includes(archetypeId))
      .slice(0, k)
      .map(e => ({
        pain_quote: e.pain_quote,
        language_markers: e.language_markers,
        concerns: e.concerns,
        source_type: e.source_type,
        touchpoint: e.touchpoint || null,
        relevance_score: 1.0,
      }));
    return byArchetype;
  }

  return top;
}

function loadLibrary(industrySlug = 'default') {
  return industries.loadIndustryPack(industrySlug).pain_library || [];
}

module.exports = { retrievePainPoints, loadLibrary };
