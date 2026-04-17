/**
 * Metrics Engine — computes quantitative behavioral metrics from agent results.
 *
 * ALL metrics here are computed in JavaScript. The LLM is NOT involved. This gives
 * deterministic, audit-friendly numbers that the Insight Synthesizer then reads.
 */

function computeMetrics(agentResults, scenario) {
  const total = agentResults.length || 1;

  // ───────── Basic outcome distribution ─────────
  const converted = agentResults.filter(r => r.outcome === 'converted').length;
  const bounced = agentResults.filter(r => r.outcome === 'bounced').length;
  const interested = agentResults.filter(r => r.outcome === 'interested').length;

  const conversion_rate = Math.round((converted / total) * 1000) / 10; // 1 decimal percent
  const retention_rate = Math.round(((converted + interested) / total) * 1000) / 10;

  // Intent score: converted=1, interested=0.5, bounced=0
  const intent_score = agentResults.reduce((sum, r) =>
    sum + (r.outcome === 'converted' ? 1 : r.outcome === 'interested' ? 0.5 : 0), 0) / total;

  // ───────── Attention decay curve ─────────
  // For each canonical section, what fraction of agents noticed it?
  const canonicalSections = deriveSections(scenario, agentResults);
  const attention_decay = canonicalSections.map(section => {
    const noticed = agentResults.filter(r =>
      (r.attention_path || []).some(ap => matchesSection(ap, section))
    ).length;
    return { section, retention: Math.round((noticed / total) * 100) / 100 };
  });

  // ───────── Trust score ─────────
  // signals_found - 1.5 * signals_missing, normalized to 0-1
  let trust_delta_sum = 0;
  let trust_max_possible = 0;
  agentResults.forEach(r => {
    const found = (r.trust_signals_found || []).length;
    const missing = (r.trust_signals_missing || []).length;
    trust_delta_sum += found - 1.5 * missing;
    trust_max_possible += Math.max(found, 1);
  });
  // Map to 0-1 range — clamp
  const trust_score = clamp(
    0.5 + (trust_delta_sum / Math.max(total * 4, 1)),
    0,
    1
  );

  // ───────── Friction density (per section) ─────────
  const friction_density = {};
  agentResults.forEach(r => {
    (r.friction_points || []).forEach(fp => {
      const key = normalizeSectionName(fp.where || 'unknown');
      friction_density[key] = (friction_density[key] || 0) + severityWeight(fp.severity);
    });
  });
  Object.keys(friction_density).forEach(k => {
    friction_density[k] = Math.round((friction_density[k] / total) * 100) / 100;
  });

  // ───────── Decision latency ─────────
  const latencies = agentResults.map(r => r.decision_latency_seconds || 60);
  const latency_p50 = median(latencies);
  const latency_p90 = percentile(latencies, 90);
  const latency_mean = Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length);

  // ───────── Objection coverage ─────────
  // What % of total triggered objections were also resolved?
  let triggered = 0, resolved = 0;
  agentResults.forEach(r => {
    triggered += (r.objections_triggered || []).length;
    resolved += (r.objections_resolved || []).length;
  });
  const objection_coverage = triggered > 0
    ? Math.round((resolved / triggered) * 100) / 100
    : 1.0;

  // ───────── Segment divergence ─────────
  // How much do the 3 archetypes diverge in their outcomes? Higher = more disagreement.
  const segment_outcomes = {};
  agentResults.forEach(r => {
    const a = r._archetype_id || 'unknown';
    if (!segment_outcomes[a]) segment_outcomes[a] = { converted: 0, bounced: 0, interested: 0, total: 0 };
    segment_outcomes[a][r.outcome] = (segment_outcomes[a][r.outcome] || 0) + 1;
    segment_outcomes[a].total += 1;
  });
  const segment_intent_scores = Object.values(segment_outcomes).map(s =>
    s.total > 0 ? (s.converted + 0.5 * s.interested) / s.total : 0
  );
  const segment_divergence = segment_intent_scores.length > 1
    ? Math.round(standardDeviation(segment_intent_scores) * 100) / 100
    : 0;

  // ───────── Confidence score ─────────
  // Based on coherence: do agents agree on key frictions/trust signals?
  const frictionKeys = agentResults.flatMap(r => (r.friction_points || []).map(f => normalizeSectionName(f.where)));
  const repeatedFrictions = countRepeats(frictionKeys);
  const signal_missing_keys = agentResults.flatMap(r => (r.trust_signals_missing || []).map(normalizeSectionName));
  const repeatedMissing = countRepeats(signal_missing_keys);

  const coherence = Math.min(1, (repeatedFrictions + repeatedMissing) / 6);
  const confidence_score = Math.round((0.5 + 0.5 * coherence) * 100) / 100;

  // ───────── Top objections (aggregated) ─────────
  const objectionCount = {};
  agentResults.forEach(r => (r.objections_triggered || []).forEach(o => {
    const key = String(o).toLowerCase().trim();
    if (key) objectionCount[key] = (objectionCount[key] || 0) + 1;
  }));
  const top_objections = Object.entries(objectionCount)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([objection, count]) => ({ objection, count }));

  // ───────── Aggregated missing trust signals ─────────
  const missingCount = {};
  agentResults.forEach(r => (r.trust_signals_missing || []).forEach(s => {
    const key = String(s).toLowerCase().trim();
    if (key) missingCount[key] = (missingCount[key] || 0) + 1;
  }));
  const top_missing_signals = Object.entries(missingCount)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([signal, count]) => ({ signal, count }));

  return {
    // Top-line
    total_agents: total,
    converted,
    bounced,
    interested,
    conversion_rate,
    retention_rate,
    intent_score: Math.round(intent_score * 100) / 100,

    // Attention
    attention_decay,

    // Trust
    trust_score: Math.round(trust_score * 100) / 100,

    // Friction
    friction_density,

    // Decisions
    decision_latency: {
      mean_seconds: latency_mean,
      p50_seconds: latency_p50,
      p90_seconds: latency_p90,
    },

    // Objections
    objection_coverage,
    top_objections,

    // Trust gaps
    top_missing_signals,

    // Variance between archetypes
    segment_divergence,
    segment_outcomes,

    // Meta
    confidence_score,
  };
}

// ──────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────

function clamp(n, min, max) { return Math.max(min, Math.min(max, n)); }

function median(arr) {
  if (!arr.length) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function percentile(arr, p) {
  if (!arr.length) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

function standardDeviation(arr) {
  if (arr.length < 2) return 0;
  const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
  const variance = arr.reduce((acc, x) => acc + (x - mean) ** 2, 0) / arr.length;
  return Math.sqrt(variance);
}

function severityWeight(s) {
  if (s === 'high') return 3;
  if (s === 'medium') return 2;
  return 1;
}

function normalizeSectionName(s) {
  return String(s || 'unknown').toLowerCase().trim().replace(/\s+/g, '_');
}

function matchesSection(attentionItem, canonicalSection) {
  const a = normalizeSectionName(attentionItem);
  const b = normalizeSectionName(canonicalSection);
  return a === b || a.includes(b) || b.includes(a);
}

function deriveSections(scenario, agentResults) {
  const s = new Set();
  if (scenario?.hero) s.add('hero');
  if (Array.isArray(scenario?.value_propositions) && scenario.value_propositions.length) s.add('value_propositions');
  if (Array.isArray(scenario?.features) && scenario.features.length) s.add('features');
  if (scenario?.pricing) s.add('pricing');
  if (scenario?.social_proof) s.add('social_proof');
  if (Array.isArray(scenario?.trust_signals) && scenario.trust_signals.length) s.add('trust_signals');
  if (scenario?.has_faq) s.add('faq');
  if (Array.isArray(scenario?.calls_to_action) && scenario.calls_to_action.length) s.add('ctas');
  // Also include sections from attention paths
  agentResults.forEach(r => (r.attention_path || []).forEach(ap => s.add(normalizeSectionName(ap))));
  return [...s].slice(0, 12);
}

function countRepeats(arr) {
  const counts = {};
  arr.forEach(x => { counts[x] = (counts[x] || 0) + 1; });
  return Object.values(counts).filter(c => c >= 2).length;
}

module.exports = { computeMetrics };
