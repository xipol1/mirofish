/**
 * Enterprise Journey Metrics — computed from real Playwright agent journeys.
 *
 * Extends the static/landing-page metrics with true-journey measurements:
 *   - Funnel step retention (% of agents reaching each URL in the journey)
 *   - Time-to-first-utility (TTFU): steps until useful action
 *   - Activation rate: % completing goal_achieved
 *   - Rage events: back-back-back patterns, rapid click retries
 *   - Navigation entropy: how "lost" agents got (unique URL diversity)
 *   - Per-segment conversion (by archetype)
 *   - Confidence intervals (bootstrapped from per-agent outcomes)
 */

function computeEnterpriseMetrics(journeys, personas) {
  const total = journeys.length || 1;

  const converted = journeys.filter(j => j.outcome === 'converted').length;
  const bounced = journeys.filter(j => j.outcome === 'bounced').length;
  const interested = journeys.filter(j => j.outcome === 'interested').length;
  const abandoned = journeys.filter(j => j.outcome === 'abandoned').length;
  const errored = journeys.filter(j => j.outcome === 'error').length;
  const effectiveTotal = total - errored;

  const conversion_rate = effectiveTotal > 0
    ? Math.round((converted / effectiveTotal) * 1000) / 10
    : 0;
  const activation_rate = conversion_rate; // alias for enterprise language
  const retention_rate = effectiveTotal > 0
    ? Math.round(((converted + interested) / effectiveTotal) * 1000) / 10
    : 0;
  const abandon_rate = effectiveTotal > 0
    ? Math.round((abandoned / effectiveTotal) * 1000) / 10
    : 0;

  // ── Funnel: unique URL visit counts ──
  const urlCounts = {};
  const urlFirstHits = {}; // url -> first step index it appeared
  for (const j of journeys) {
    if (!j.steps) continue;
    const seen = new Set();
    for (const step of j.steps) {
      const u = normalizeUrl(step.url_after || step.url_before);
      if (!u || seen.has(u)) continue;
      seen.add(u);
      urlCounts[u] = (urlCounts[u] || 0) + 1;
      if (!urlFirstHits[u] || urlFirstHits[u] > step.step_index) urlFirstHits[u] = step.step_index;
    }
  }
  const funnel = Object.entries(urlCounts)
    .map(([url, count]) => ({
      url,
      visitors: count,
      retention: Math.round((count / total) * 100) / 100,
      first_hit_step: urlFirstHits[url] ?? 0,
    }))
    .sort((a, b) => a.first_hit_step - b.first_hit_step)
    .slice(0, 15);

  // ── Time-to-first-utility ──
  const ttfuSteps = [];
  for (const j of journeys) {
    if (!j.steps) continue;
    const hit = j.steps.find(s => s.affect_updates?.hot_button_hit || s.action === 'goal_achieved');
    if (hit) ttfuSteps.push(hit.step_index);
  }
  const ttfu_p50 = median(ttfuSteps);
  const ttfu_mean = ttfuSteps.length ? round(ttfuSteps.reduce((a, b) => a + b, 0) / ttfuSteps.length, 1) : null;

  // ── Rage events ──
  let rage_events = 0;
  for (const j of journeys) {
    if (!j.steps || j.steps.length < 3) continue;
    for (let i = 2; i < j.steps.length; i++) {
      const a = j.steps[i], b = j.steps[i - 1], c = j.steps[i - 2];
      // Three consecutive failed clicks, or back-back-back
      if ((a.action === 'back' && b.action === 'back' && c.action === 'back')
          || (a.result_ok === false && b.result_ok === false && c.result_ok === false)) {
        rage_events++;
      }
    }
  }

  // ── Navigation entropy — unique URLs per agent, averaged ──
  const uniqueUrlsPerAgent = journeys.map(j => {
    if (!j.steps) return 0;
    const s = new Set();
    j.steps.forEach(step => { if (step.url_after) s.add(normalizeUrl(step.url_after)); });
    return s.size;
  });
  const navigation_entropy = uniqueUrlsPerAgent.length
    ? round(uniqueUrlsPerAgent.reduce((a, b) => a + b, 0) / uniqueUrlsPerAgent.length, 1)
    : 0;

  // ── Affect summaries (final state) ──
  const finalStates = journeys.map(j => j.final_state || {}).filter(s => s.trust != null);
  const avg_final_trust = avgOf(finalStates.map(s => s.trust));
  const avg_final_frust = avgOf(finalStates.map(s => s.frustration));
  const avg_final_conf = avgOf(finalStates.map(s => s.confusion));
  const avg_final_excite = avgOf(finalStates.map(s => s.excitement));
  const avg_final_energy = avgOf(finalStates.map(s => s.energy));

  // ── Per-archetype breakdown ──
  const segments = {};
  for (const j of journeys) {
    const arch = j._archetype_id || 'unknown';
    if (!segments[arch]) segments[arch] = { total: 0, converted: 0, bounced: 0, interested: 0, abandoned: 0, errored: 0 };
    segments[arch].total++;
    if (j.outcome === 'converted') segments[arch].converted++;
    else if (j.outcome === 'bounced') segments[arch].bounced++;
    else if (j.outcome === 'interested') segments[arch].interested++;
    else if (j.outcome === 'abandoned') segments[arch].abandoned++;
    else if (j.outcome === 'error') segments[arch].errored++;
  }
  for (const s of Object.values(segments)) {
    const eff = s.total - s.errored;
    s.conversion_rate = eff > 0 ? round((s.converted / eff) * 100, 1) : 0;
  }

  // ── Step duration stats ──
  const allStepDurations = [];
  for (const j of journeys) {
    if (!j.steps) continue;
    for (const s of j.steps) if (s.action_duration_ms) allStepDurations.push(s.action_duration_ms);
  }
  const avg_step_duration_ms = allStepDurations.length ? Math.round(allStepDurations.reduce((a, b) => a + b, 0) / allStepDurations.length) : 0;

  // ── Pricing reach (how many got to a /pricing URL) ──
  let pricing_reached = 0;
  for (const j of journeys) {
    if (!j.steps) continue;
    if (j.steps.some(s => /pricing|precio|plans|planes/i.test(s.url_after || ''))) pricing_reached++;
  }

  // ── Drop-off diagnostics (where did agents leave?) ──
  const dropoffByUrl = {};
  for (const j of journeys) {
    if (j.outcome !== 'abandoned' && j.outcome !== 'bounced') continue;
    const last = j.steps?.[j.steps.length - 1];
    if (!last) continue;
    const u = normalizeUrl(last.url_after || last.url_before) || 'unknown';
    dropoffByUrl[u] = (dropoffByUrl[u] || 0) + 1;
  }
  const top_dropoff_pages = Object.entries(dropoffByUrl)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([url, count]) => ({ url, count }));

  // ── Confidence: based on sample size + outcome variance ──
  // Standard error for a proportion
  const p = effectiveTotal > 0 ? converted / effectiveTotal : 0;
  const se = effectiveTotal > 0 ? Math.sqrt(p * (1 - p) / effectiveTotal) : 0;
  const ci_95_margin = round(se * 1.96 * 100, 1);
  const confidence_score = effectiveTotal >= 30 ? 0.85 : effectiveTotal >= 15 ? 0.7 : 0.55;

  return {
    // Top-line
    total_agents: total,
    effective_total: effectiveTotal,
    converted,
    bounced,
    interested,
    abandoned,
    errored,
    conversion_rate,
    activation_rate,
    retention_rate,
    abandon_rate,

    // Journey intelligence
    funnel,
    top_dropoff_pages,
    ttfu_p50_steps: ttfu_p50,
    ttfu_mean_steps: ttfu_mean,
    rage_events,
    navigation_entropy,
    avg_step_duration_ms,
    pricing_reached,

    // Affect averages
    trust_score: avg_final_trust,
    avg_final_state: {
      trust: avg_final_trust,
      frustration: avg_final_frust,
      confusion: avg_final_conf,
      excitement: avg_final_excite,
      energy: avg_final_energy,
    },

    // Segments
    segment_outcomes: segments,
    segment_divergence: computeSegmentDivergence(segments),

    // Confidence
    confidence_score,
    ci_95_margin_pct: ci_95_margin,
    sample_size_warning: effectiveTotal < 15 ? 'Sample size below 15 — treat predictions as directional.' : null,

    // Extras for downstream
    objection_coverage: 1, // placeholder
    friction_density: {},   // filled by per-URL aggregation if needed
    top_objections: [],
    top_missing_signals: [],
  };
}

// ── helpers ──
function normalizeUrl(u) {
  if (!u) return null;
  try {
    const parsed = new URL(u);
    return `${parsed.origin}${parsed.pathname}`;
  } catch { return u; }
}
function round(n, d = 2) { return Math.round(n * 10 ** d) / 10 ** d; }
function median(arr) {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? (s[m - 1] + s[m]) / 2 : s[m];
}
function avgOf(arr) {
  if (!arr.length) return 0;
  return round(arr.reduce((a, b) => a + b, 0) / arr.length, 2);
}
function computeSegmentDivergence(segments) {
  const values = Object.values(segments).map(s => s.conversion_rate);
  if (values.length < 2) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((acc, x) => acc + (x - mean) ** 2, 0) / values.length;
  return round(Math.sqrt(variance), 2);
}

module.exports = { computeEnterpriseMetrics };
