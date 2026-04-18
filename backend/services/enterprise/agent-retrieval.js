/**
 * Agent Retrieval — filters + summarises synthetic agents inside a completed
 * simulation. Lets a CRO answer questions like "show me all German couples
 * with NPS<0 who mentioned wifi" in one call.
 *
 * Works off the in-memory simulation result (records) + the attached personas.
 * Pure function, no LLM, no DB.
 */

function toArray(v) {
  if (v == null) return null;
  if (Array.isArray(v)) return v.length ? v : null;
  return [v];
}

function lower(s) { return typeof s === 'string' ? s.toLowerCase() : ''; }

function extractStayThemes(stay) {
  const themes = new Set();
  // From predicted review
  for (const t of (stay.predicted_review?.themes || [])) themes.add(lower(t));
  // From moments (scan text for common theme keywords)
  const text = [];
  for (const stg of (stay.stages || [])) {
    text.push(stg.narrative || '');
    for (const m of (stg.moments_positive || [])) text.push(typeof m === 'string' ? m : (m.description || m.note || ''));
    for (const m of (stg.moments_negative || [])) text.push(typeof m === 'string' ? m : (m.description || m.note || ''));
  }
  const joined = text.join(' ').toLowerCase();
  const themeLexicon = ['wifi', 'noise', 'noisy', 'staff', 'service', 'breakfast', 'pool', 'spa',
    'bed', 'clean', 'cleanliness', 'view', 'room', 'check-in', 'check in', 'checkout',
    'check-out', 'value', 'price', 'fee', 'food', 'restaurant', 'dinner', 'location',
    'parking', 'kids', 'family', 'loyalty', 'shower', 'bathroom', 'ac', 'air conditioning',
    'elevator', 'lift', 'gym', 'towels', 'linens'];
  for (const kw of themeLexicon) {
    if (joined.includes(kw)) themes.add(kw.replace(/\s+/g, '_'));
  }
  return Array.from(themes);
}

function extractKeyMoment(stay) {
  const neg = stay.moments_negative || [];
  const pos = stay.moments_positive || [];
  const pickDesc = (m) => typeof m === 'string' ? m : (m?.description || m?.note || '');
  if ((stay.sensation_summary?.nps ?? 0) < 0 && neg.length) return `− ${pickDesc(neg[0])}`;
  if ((stay.sensation_summary?.nps ?? 0) >= 50 && pos.length) return `+ ${pickDesc(pos[0])}`;
  if (neg.length) return `− ${pickDesc(neg[0])}`;
  if (pos.length) return `+ ${pickDesc(pos[0])}`;
  return '—';
}

function matches(stay, criteria) {
  if (!stay || stay.error) return false;

  const persona = stay.persona_full || stay.persona || {};
  const arch = persona.archetype_id || persona._archetype_id;
  const culture = stay.cultural_context?.culture_cluster || stay.cultural_context?.cluster_id;
  const marketPack = stay.cultural_context?.market_pack || stay.booking_context?.market_pack;
  const priceTier = stay.booking_context?.price_tier;
  const channel = stay.booking_context?.booking_channel;
  const nps = stay.sensation_summary?.nps;
  const stars = stay.sensation_summary?.stars;
  const spend = stay.expense_summary?.total_spend_eur;
  const willRepeat = stay.predicted_review?.would_repeat;
  const willRecommend = stay.predicted_review?.would_recommend;
  const adverseIds = (stay.adversarial_events || []).map(e => e.event_id);

  const inList = (val, list) => list.some(x => lower(x) === lower(val));

  const c = criteria || {};
  const arches = toArray(c.archetype);
  if (arches && !inList(arch, arches)) return false;

  const cultures = toArray(c.culture_cluster);
  if (cultures && !inList(culture, cultures)) return false;

  const packs = toArray(c.market_pack);
  if (packs && !inList(marketPack, packs)) return false;

  if (typeof c.nps_min === 'number' && (nps == null || nps < c.nps_min)) return false;
  if (typeof c.nps_max === 'number' && (nps == null || nps > c.nps_max)) return false;
  if (typeof c.stars_min === 'number' && (stars == null || stars < c.stars_min)) return false;
  if (typeof c.stars_max === 'number' && (stars == null || stars > c.stars_max)) return false;
  if (typeof c.spend_min === 'number' && (spend == null || spend < c.spend_min)) return false;
  if (typeof c.spend_max === 'number' && (spend == null || spend > c.spend_max)) return false;

  if (typeof c.would_repeat === 'boolean' && willRepeat !== c.would_repeat) return false;
  if (typeof c.would_recommend === 'boolean' && willRecommend !== c.would_recommend) return false;

  const tiers = toArray(c.price_tier);
  if (tiers && !inList(priceTier, tiers)) return false;
  const channels = toArray(c.booking_channel);
  if (channels && !inList(channel, channels)) return false;

  if (c.has_adversarial_event === true && adverseIds.length === 0) return false;
  if (c.has_adversarial_event === false && adverseIds.length > 0) return false;
  if (typeof c.has_adversarial_event === 'string' && !inList(c.has_adversarial_event, adverseIds)) return false;

  const themes = toArray(c.mentioned_theme);
  if (themes) {
    const stayThemes = extractStayThemes(stay);
    const wanted = themes.map(t => lower(t).replace(/\s+/g, '_'));
    if (!wanted.some(w => stayThemes.includes(w))) return false;
  }

  return true;
}

function collectStays(simulationResult) {
  if (!simulationResult) return [];
  return simulationResult.records || simulationResult.stays || [];
}

/**
 * Filter agents inside a completed simulation.
 * Returns an array sorted by NPS desc.
 */
function queryAgents(simulationResult, criteria = {}) {
  const stays = collectStays(simulationResult);
  const out = [];
  stays.forEach((stay, slot) => {
    if (!matches(stay, criteria)) return;
    const persona = stay.persona_full || stay.persona || {};
    const themes = extractStayThemes(stay);
    out.push({
      slot,
      persona_name: persona.name || `agent-${slot}`,
      archetype: persona.archetype_label || persona.archetype_id || persona._archetype_id,
      culture_cluster: stay.cultural_context?.culture_cluster || null,
      market_pack: stay.cultural_context?.market_pack || null,
      stars: stay.sensation_summary?.stars ?? null,
      nps: stay.sensation_summary?.nps ?? null,
      spend_eur: stay.expense_summary?.total_spend_eur ?? 0,
      would_repeat: !!stay.predicted_review?.would_repeat,
      would_recommend: !!stay.predicted_review?.would_recommend,
      matched_themes: themes,
      adversarial_events: (stay.adversarial_events || []).map(e => e.event_id),
      key_moment: extractKeyMoment(stay),
      review_platform: stay.predicted_review?.platform || null,
      review_language: stay.predicted_review?.language || null,
    });
  });
  out.sort((a, b) => (b.nps ?? -999) - (a.nps ?? -999));
  return out;
}

function summarizeCohortQuery(agents, simulationResult) {
  const n = agents.length;
  if (n === 0) {
    return { n: 0, avg_nps: null, avg_stars: null, avg_spend_eur: null, theme_frequency: {}, shared_friction: [], shared_delight: [] };
  }
  const sum = (arr, fn) => arr.reduce((s, x) => s + (fn(x) || 0), 0);
  const avgNps = sum(agents, a => a.nps) / n;
  const avgStars = sum(agents, a => a.stars) / n;
  const avgSpend = sum(agents, a => a.spend_eur) / n;

  const themeFreq = {};
  for (const a of agents) for (const t of (a.matched_themes || [])) themeFreq[t] = (themeFreq[t] || 0) + 1;
  const themeRanked = Object.entries(themeFreq).sort((a, b) => b[1] - a[1]).map(([theme, count]) => ({ theme, count, pct: Math.round((count / n) * 100) }));

  // Surface shared friction / delight by intersecting moments across agents
  const stays = collectStays(simulationResult);
  const frictionCounts = {}, delightCounts = {};
  for (const a of agents) {
    const stay = stays[a.slot];
    if (!stay) continue;
    const negSet = new Set();
    const posSet = new Set();
    for (const m of (stay.moments_negative || [])) {
      const txt = typeof m === 'string' ? m : (m.description || m.note || '');
      if (txt) negSet.add(txt.trim().toLowerCase().slice(0, 80));
    }
    for (const m of (stay.moments_positive || [])) {
      const txt = typeof m === 'string' ? m : (m.description || m.note || '');
      if (txt) posSet.add(txt.trim().toLowerCase().slice(0, 80));
    }
    for (const k of negSet) frictionCounts[k] = (frictionCounts[k] || 0) + 1;
    for (const k of posSet) delightCounts[k] = (delightCounts[k] || 0) + 1;
  }
  const topFriction = Object.entries(frictionCounts).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([txt, count]) => ({ description: txt, mentioned_by: count }));
  const topDelight = Object.entries(delightCounts).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([txt, count]) => ({ description: txt, mentioned_by: count }));

  const archDist = {};
  for (const a of agents) archDist[a.archetype] = (archDist[a.archetype] || 0) + 1;

  return {
    n,
    avg_nps: Math.round(avgNps),
    avg_stars: Math.round(avgStars * 10) / 10,
    avg_spend_eur: Math.round(avgSpend * 100) / 100,
    would_repeat_pct: Math.round((agents.filter(a => a.would_repeat).length / n) * 100),
    would_recommend_pct: Math.round((agents.filter(a => a.would_recommend).length / n) * 100),
    theme_frequency: themeRanked,
    archetype_distribution: archDist,
    shared_friction: topFriction,
    shared_delight: topDelight,
  };
}

module.exports = { queryAgents, summarizeCohortQuery, extractStayThemes };
