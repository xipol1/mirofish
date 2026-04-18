/**
 * Cohort Enforcer — distribution-level validation and rebalancing.
 *
 * Problem solved: after personaGenerator + buildAgentContext, the cohort's
 * aggregate characteristics (channel mix, booking window mix, device mix,
 * cancellation preference mix, tier mix) often drift from the market pack's
 * empirical distributions due to sampling noise with small-n and
 * archetype-specific biases in the context builders.
 *
 * This module:
 *   1. Audits the generated cohort against 1-N market packs
 *   2. Identifies dimensions that drift beyond tolerance
 *   3. Rebalances by probabilistic reassignment (preserving personas)
 *   4. Emits an audit log that can be shown to clients as proof of
 *      empirical discipline ("distributions honored within ±5pp")
 *
 * Philosophy: this is the "symbolic" half of neuro-symbolic. The LLM
 * handles narrative; we guarantee statistical fidelity at cohort level.
 */

const marketPacks = require('./market-packs');

const DEFAULT_TOLERANCE_PP = 5;

/**
 * Dimensions we track. Each is a function that extracts the bucket the agent
 * falls into, and a reference to the market pack field with the target distribution.
 *
 * CATEGORICAL dimensions (single bucket per agent):
 *   - booking_channel      → pack.channel_share_pct
 *   - device               → pack.device_share_pct
 *   - booking_window       → pack.booking_window_distribution_days
 *   - cancellation_pref    → pack.cancellation_patterns (derived)
 *
 * Each dimension definition:
 *   { key, label, extractor(agentCtx), reassign(agentCtx, newBucket), packField }
 */
const DIMENSIONS = {
  booking_channel: {
    label: 'Booking channel',
    packField: 'channel_share_pct',
    extract: (ctx) => ctx.booking_context?.booking_channel || null,
    reassign: (ctx, newBucket) => {
      if (ctx.booking_context) ctx.booking_context.booking_channel = newBucket;
    },
  },
  device: {
    label: 'Device',
    packField: 'device_share_pct',
    extract: (ctx) => ctx.device || null,
    reassign: (ctx, newBucket) => { ctx.device = newBucket; },
  },
  booking_window: {
    label: 'Booking window',
    packField: 'booking_window_distribution_days',
    extract: (ctx) => {
      const days = ctx.booking_context?.lead_time_days;
      if (days == null) return null;
      if (days <= 3) return 'last_minute_0_3';
      if (days <= 14) return 'short_4_14';
      if (days <= 45) return 'medium_15_45';
      if (days <= 90) return 'long_46_90';
      return 'very_long_91_plus';
    },
    reassign: (ctx, newBucket) => {
      if (!ctx.booking_context) return;
      const ranges = {
        last_minute_0_3: [0, 3],
        short_4_14: [4, 14],
        medium_15_45: [15, 45],
        long_46_90: [46, 90],
        very_long_91_plus: [91, 150],
      };
      const [min, max] = ranges[newBucket] || [15, 45];
      ctx.booking_context.lead_time_days = Math.floor(Math.random() * (max - min + 1)) + min;
      ctx.booking_context.lead_time_segment = newBucket;
    },
  },
  cancellation_pref: {
    label: 'Cancellation preference',
    packField: '_derived_cancellation_preference',
    extract: (ctx) => {
      const rp = ctx.booking_context?.rate_plan_type;
      if (!rp) return null;
      return rp === 'advance_purchase_nonref' ? 'nonrefundable' : 'refundable';
    },
    reassign: (ctx, newBucket) => {
      if (!ctx.booking_context) return;
      ctx.booking_context.rate_plan_type = newBucket === 'nonrefundable' ? 'advance_purchase_nonref' : 'flexible_refundable';
    },
    // Derived distribution from cancellation_patterns (v0.2-aware: uses getValue to unwrap)
    getDistribution: (pack) => {
      return {
        refundable: marketPacks.getValue(pack, 'cancellation_patterns.refundable_rate_preference_pct'),
        nonrefundable: marketPacks.getValue(pack, 'cancellation_patterns.nonrefundable_rate_preference_pct'),
      };
    },
  },
};

/**
 * Compute the empirical distribution from the cohort.
 * Returns { bucket: pct } as percentages.
 */
function computeEmpiricalDistribution(agentContexts, dimKey) {
  const dim = DIMENSIONS[dimKey];
  if (!dim) return null;

  const counts = {};
  let total = 0;
  for (const ctx of agentContexts) {
    const bucket = dim.extract(ctx);
    if (bucket == null) continue;
    counts[bucket] = (counts[bucket] || 0) + 1;
    total++;
  }
  if (total === 0) return null;

  const pct = {};
  for (const [b, c] of Object.entries(counts)) pct[b] = (c / total) * 100;
  return pct;
}

/**
 * Get the target distribution from a market pack for a dimension.
 */
function getTargetDistribution(pack, dimKey) {
  const dim = DIMENSIONS[dimKey];
  if (!dim) return null;

  if (typeof dim.getDistribution === 'function') return dim.getDistribution(pack);

  // Unwrap value if v0.2 schema
  const raw = pack[dim.packField];
  if (!raw) return null;
  // Strip _provenance key if present (v0.2 schema)
  const out = {};
  for (const [k, v] of Object.entries(raw)) {
    if (k === '_provenance') continue;
    // v0.2 per-key wrapped: { value, source_id, ... }
    if (v && typeof v === 'object' && 'value' in v) out[k] = v.value;
    else out[k] = v;
  }
  return out;
}

/**
 * Compute per-bucket gap between empirical and target.
 * Returns array of { bucket, target_pct, empirical_pct, gap_pp, action }
 */
function computeGaps(empirical, target, tolerancePp) {
  if (!empirical || !target) return [];

  // If target values are 0-1 fractions, scale to percentages
  const targetScaled = {};
  const targetSum = Object.values(target).reduce((s, v) => s + Number(v || 0), 0);
  const scale = targetSum <= 1.5 ? 100 : 1; // heuristic: 0-1 fractions vs 0-100 percentages
  for (const [k, v] of Object.entries(target)) targetScaled[k] = Number(v || 0) * scale;

  const allKeys = new Set([...Object.keys(empirical), ...Object.keys(targetScaled)]);
  const gaps = [];
  for (const k of allKeys) {
    const tgt = Number(targetScaled[k] || 0);
    const emp = Number(empirical[k] || 0);
    const gapPp = emp - tgt;
    const within = Math.abs(gapPp) <= tolerancePp;
    gaps.push({
      bucket: k,
      target_pct: Math.round(tgt * 10) / 10,
      empirical_pct: Math.round(emp * 10) / 10,
      gap_pp: Math.round(gapPp * 10) / 10,
      within_tolerance: within,
    });
  }
  return gaps.sort((a, b) => Math.abs(b.gap_pp) - Math.abs(a.gap_pp));
}

/**
 * Rebalance a dimension by reassigning the minimum number of agents to
 * reduce the largest-abs gap bucket toward the target.
 *
 * Algorithm: for each bucket over-represented, pick random agents in that
 * bucket, reassign them to the most under-represented bucket, until either
 * the max gap falls below tolerance or we've exhausted attempts.
 */
function rebalanceDimension(agentContexts, dimKey, target, tolerancePp, maxReassignments = null) {
  const dim = DIMENSIONS[dimKey];
  if (!dim) return { reassignments: [], final_gaps: [] };

  const n = agentContexts.length;
  const maxReassign = maxReassignments || Math.ceil(n * 0.6);
  const reassignments = [];

  for (let attempt = 0; attempt < maxReassign; attempt++) {
    const empirical = computeEmpiricalDistribution(agentContexts, dimKey);
    if (!empirical) break;
    const gaps = computeGaps(empirical, target, tolerancePp);
    // Break only when ALL buckets are in tolerance
    if (gaps.every(g => g.within_tolerance)) break;

    // Anchor the move on the WORST gap (largest absolute) that's out of tolerance.
    // If it's over: send it to the most-under (even if that one is within tolerance).
    // If it's under: pull from the most-over (even if that one is within tolerance).
    const worst = gaps[0]; // largest abs
    let sourceBucket, targetBucketName, sourceGap, targetGap;
    if (worst.gap_pp > 0) {
      sourceBucket = worst.bucket;
      sourceGap = worst.gap_pp;
      // Find any under bucket — prefer most-under
      const mostUnder = gaps.filter(g => g.gap_pp < 0).sort((a, b) => a.gap_pp - b.gap_pp)[0];
      if (!mostUnder) break;
      targetBucketName = mostUnder.bucket;
      targetGap = mostUnder.gap_pp;
    } else {
      targetBucketName = worst.bucket;
      targetGap = worst.gap_pp;
      const mostOver = gaps.filter(g => g.gap_pp > 0).sort((a, b) => b.gap_pp - a.gap_pp)[0];
      if (!mostOver) break;
      sourceBucket = mostOver.bucket;
      sourceGap = mostOver.gap_pp;
    }

    // Find an agent in sourceBucket and reassign
    const candidates = agentContexts
      .map((ctx, idx) => ({ ctx, idx, bucket: dim.extract(ctx) }))
      .filter(x => x.bucket === sourceBucket);
    if (candidates.length === 0) break;

    const victim = candidates[Math.floor(Math.random() * candidates.length)];
    const oldBucket = victim.bucket;
    dim.reassign(victim.ctx, targetBucketName);

    reassignments.push({
      agent_index: victim.idx,
      dimension: dimKey,
      from: oldBucket,
      to: targetBucketName,
      rationale: `${oldBucket} (${sourceGap > 0 ? '+' : ''}${sourceGap.toFixed(1)}pp) → ${targetBucketName} (${targetGap > 0 ? '+' : ''}${targetGap.toFixed(1)}pp)`,
    });
  }

  const finalEmpirical = computeEmpiricalDistribution(agentContexts, dimKey);
  const finalGaps = computeGaps(finalEmpirical, target, tolerancePp);
  return { reassignments, final_gaps: finalGaps };
}

/**
 * Main entry point. Audits + rebalances a cohort against 1-N market packs.
 *
 * @param {Object} opts
 * @param {Array} opts.agentContexts         Array of agent contexts (mutated in place)
 * @param {Array<string>} opts.marketPackIds The packs whose distributions to enforce
 * @param {Array<string>} opts.dimensions    Which dims to enforce (default: all)
 * @param {number} opts.tolerance_pp         Max allowed gap before rebalancing (default: 5)
 * @param {Function} opts.onProgress         Progress callback
 *
 * @returns {Object} audit log: { packs_used, dimensions_checked, gaps_before, gaps_after,
 *                                total_reassignments, fidelity_score, reassignments[] }
 */
function enforceDistributions({
  agentContexts,
  marketPackIds = [],
  dimensions = Object.keys(DIMENSIONS),
  tolerance_pp = DEFAULT_TOLERANCE_PP,
  onProgress = () => {},
}) {
  if (!Array.isArray(agentContexts) || agentContexts.length === 0) {
    return { skipped: true, reason: 'no agent contexts' };
  }
  if (!Array.isArray(marketPackIds) || marketPackIds.length === 0) {
    return { skipped: true, reason: 'no market packs specified' };
  }

  // Build weighted target distribution (average across packs if multiple)
  const targets = {};
  for (const dimKey of dimensions) {
    const dim = DIMENSIONS[dimKey];
    if (!dim) continue;
    const packTargets = [];
    for (const packId of marketPackIds) {
      try {
        const pack = marketPacks.get(packId);
        const t = getTargetDistribution(pack, dimKey);
        if (t) packTargets.push(t);
      } catch (err) { /* pack not found, skip */ }
    }
    if (packTargets.length === 0) continue;
    targets[dimKey] = averageDistributions(packTargets);
  }

  // Phase 1: before-audit
  const gapsBefore = {};
  for (const dimKey of dimensions) {
    if (!targets[dimKey]) continue;
    const empirical = computeEmpiricalDistribution(agentContexts, dimKey);
    gapsBefore[dimKey] = computeGaps(empirical, targets[dimKey], tolerance_pp);
  }
  onProgress({ phase: 'audit_before', gaps: gapsBefore });

  // Phase 2: rebalance per dimension
  const allReassignments = [];
  const gapsAfter = {};
  for (const dimKey of dimensions) {
    if (!targets[dimKey]) continue;
    const result = rebalanceDimension(agentContexts, dimKey, targets[dimKey], tolerance_pp);
    allReassignments.push(...result.reassignments);
    gapsAfter[dimKey] = result.final_gaps;
    onProgress({
      phase: 'rebalanced',
      dimension: dimKey,
      reassignments_in_dim: result.reassignments.length,
    });
  }

  // Phase 3: fidelity score
  const fidelityScore = computeFidelityScore(gapsAfter, tolerance_pp);

  return {
    skipped: false,
    packs_used: marketPackIds,
    tolerance_pp,
    dimensions_checked: Object.keys(gapsBefore),
    gaps_before: gapsBefore,
    gaps_after: gapsAfter,
    total_reassignments: allReassignments.length,
    reassignment_rate_pct: Math.round((allReassignments.length / agentContexts.length) * 1000) / 10,
    reassignments_sample: allReassignments.slice(0, 20), // sample for audit log (full list available if needed)
    fidelity_score_pct: fidelityScore,
    fidelity_threshold_pct: 85,
    fidelity_passed: fidelityScore >= 85,
  };
}

function averageDistributions(distList) {
  if (distList.length === 1) return distList[0];
  const allKeys = new Set();
  for (const d of distList) for (const k of Object.keys(d)) allKeys.add(k);
  const out = {};
  for (const k of allKeys) {
    const vals = distList.map(d => Number(d[k] || 0));
    out[k] = vals.reduce((s, v) => s + v, 0) / vals.length;
  }
  return out;
}

function computeFidelityScore(gapsAfter, tolerancePp) {
  let total = 0, within = 0;
  for (const gaps of Object.values(gapsAfter || {})) {
    for (const g of gaps) {
      total++;
      if (Math.abs(g.gap_pp) <= tolerancePp) within++;
    }
  }
  if (total === 0) return 0;
  return Math.round((within / total) * 100);
}

module.exports = {
  enforceDistributions,
  computeEmpiricalDistribution,
  computeGaps,
  getTargetDistribution,
  DIMENSIONS,
  DEFAULT_TOLERANCE_PP,
};
