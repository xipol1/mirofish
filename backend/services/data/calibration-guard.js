/**
 * Calibration Guard — post-ingest drift gate.
 *
 * Compares a candidate calibration snapshot (produced by aggregateReviews +
 * toCalibrationSignals) against a trusted baseline. Flags or blocks
 * publishing if the candidate drifts outside safe bands. This is what stops
 * a bad ingest batch from silently poisoning the simulation.
 *
 * Verdict states:
 *   OK      — ship it
 *   WATCH   — soft drift; ship but log
 *   BLOCK   — hard drift; refuse and surface to the consultant
 */

const DEFAULT_BANDS = {
  // Overall property metrics
  avg_rating_abs_delta: 0.25,               // 4.65 → 4.40 or 4.90 is a BLOCK
  avg_rating_watch_delta: 0.12,             // softer gate for WATCH
  star_distribution_pct_delta_any_bucket: 15,    // BLOCK if any bucket shifts >15pp
  star_distribution_pct_delta_watch: 8,          // WATCH if any bucket shifts >8pp
  positive_pct_abs_delta: 12,               // BLOCK if positive sentiment shifts >12pp
  positive_pct_watch: 6,

  // Cohort-shape metrics
  min_review_count: 30,                     // below this, we do not trust the batch
  min_review_count_per_property: 20,
  min_archetype_coverage_pct: 60,           // at least 60% of major archetypes represented
  min_language_count: 2,                    // at least 2 languages (except single-culture properties)
  min_primary_language_pct: 35,             // top language must be ≥35% of batch
  max_primary_language_pct: 95,             // but not a monoculture either (unless configured)
  max_single_reviewer_pct: 5,               // no single reviewer dominates >5% of batch
  min_unique_hashes_pct: 95,                // after dedup, ≥95% of rows should be unique

  // Theme drift (optional, only runs if baseline has theme_top_10)
  theme_rank_correlation_min: 0.40,         // Spearman; below = themes reshuffled unexpectedly
};

// Major archetypes we expect a meaningful batch to cover. A single-property
// demo (say, adults-only) may override this list.
const DEFAULT_MAJOR_ARCHETYPES = [
  'business_traveler', 'family_vacationer', 'luxury_seeker', 'honeymooner',
  'budget_optimizer', 'loyalty_maximizer',
];

function pctDelta(a, b) {
  if (a == null || b == null) return null;
  return Math.abs(a - b);
}

function spearmanCorr(listA, listB) {
  // listA, listB are ordered arrays of the same items; returns rank correlation.
  // Uses only items present in both; if < 3 overlap returns null.
  const commonA = listA.filter(x => listB.includes(x));
  if (commonA.length < 3) return null;
  const commonB = listB.filter(x => commonA.includes(x));
  const rankA = new Map(commonA.map((x, i) => [x, i]));
  const rankB = new Map(commonB.map((x, i) => [x, i]));
  const n = commonA.length;
  let dSq = 0;
  for (const item of commonA) {
    const diff = rankA.get(item) - rankB.get(item);
    dSq += diff * diff;
  }
  const denom = n * (n * n - 1);
  return denom === 0 ? 1 : 1 - (6 * dSq) / denom;
}

/**
 * Run the drift gate.
 *
 * @param {Object} candidate  calibration signals from toCalibrationSignals()
 *                            + optional archetype_coverage_counts + language_counts
 *                            + reviewer_counts
 * @param {Object|null} baseline  trusted baseline (same shape); null on cold-start
 * @param {Object} userBands  overrides DEFAULT_BANDS
 * @param {Object} ctx        optional context: { major_archetypes, cold_start_ok }
 * @returns {{ verdict: 'OK'|'WATCH'|'BLOCK', reasons: Array, summary: Object }}
 */
function runDriftGate(candidate, baseline, userBands = {}, ctx = {}) {
  const bands = { ...DEFAULT_BANDS, ...userBands };
  const reasons = [];
  const warnings = [];
  const majorArchetypes = ctx.major_archetypes || DEFAULT_MAJOR_ARCHETYPES;

  // ─── Cohort-shape checks (no baseline required) ────────────────────────────
  const reviewCount = candidate.review_count || 0;
  if (reviewCount < bands.min_review_count) {
    reasons.push({ rule: 'min_review_count', severity: 'BLOCK', observed: reviewCount, threshold: bands.min_review_count });
  }

  const archCounts = candidate.archetype_coverage_counts || {};
  const archetypesPresent = Object.keys(archCounts).filter(a => archCounts[a] > 0);
  const coveredMajor = majorArchetypes.filter(a => archetypesPresent.includes(a));
  const archetypeCoveragePct = majorArchetypes.length === 0 ? 100 : (coveredMajor.length / majorArchetypes.length) * 100;
  if (archetypeCoveragePct < bands.min_archetype_coverage_pct) {
    reasons.push({
      rule: 'min_archetype_coverage',
      severity: 'BLOCK',
      observed: Math.round(archetypeCoveragePct),
      threshold: bands.min_archetype_coverage_pct,
      missing_archetypes: majorArchetypes.filter(a => !archetypesPresent.includes(a)),
    });
  }

  const langCounts = candidate.language_counts || {};
  const langEntries = Object.entries(langCounts).filter(([l]) => l !== 'und');
  const langTotal = langEntries.reduce((s, [, n]) => s + n, 0) || 1;
  const langCount = langEntries.length;
  const topLang = langEntries.sort((a, b) => b[1] - a[1])[0];
  const topLangPct = topLang ? (topLang[1] / langTotal) * 100 : 0;
  if (langCount < bands.min_language_count && !ctx.single_culture_property) {
    warnings.push({ rule: 'min_language_count', severity: 'WATCH', observed: langCount, threshold: bands.min_language_count });
  }
  if (topLang && topLangPct > bands.max_primary_language_pct && !ctx.single_culture_property) {
    warnings.push({ rule: 'monoculture_language', severity: 'WATCH', observed: Math.round(topLangPct), language: topLang[0], threshold: bands.max_primary_language_pct });
  }
  if (topLang && topLangPct < bands.min_primary_language_pct) {
    warnings.push({ rule: 'fragmented_language', severity: 'WATCH', observed: Math.round(topLangPct), threshold: bands.min_primary_language_pct });
  }

  // Reviewer concentration
  const reviewerCounts = candidate.reviewer_counts || {};
  const reviewerEntries = Object.entries(reviewerCounts);
  const topReviewer = reviewerEntries.sort((a, b) => b[1] - a[1])[0];
  if (topReviewer && reviewCount > 0) {
    const topPct = (topReviewer[1] / reviewCount) * 100;
    if (topPct > bands.max_single_reviewer_pct) {
      reasons.push({ rule: 'reviewer_concentration', severity: 'BLOCK', reviewer: topReviewer[0], observed_pct: Math.round(topPct * 10) / 10, threshold_pct: bands.max_single_reviewer_pct });
    }
  }

  // Unique hash ratio
  if (candidate.unique_hashes != null && reviewCount > 0) {
    const uniquePct = (candidate.unique_hashes / reviewCount) * 100;
    if (uniquePct < bands.min_unique_hashes_pct) {
      reasons.push({ rule: 'low_unique_hash_ratio', severity: 'BLOCK', observed_pct: Math.round(uniquePct * 10) / 10, threshold_pct: bands.min_unique_hashes_pct });
    }
  }

  // ─── Baseline-relative checks (require baseline) ───────────────────────────
  if (baseline) {
    // Rating drift
    if (candidate.avg_rating != null && baseline.avg_rating != null) {
      const delta = Math.abs(candidate.avg_rating - baseline.avg_rating);
      if (delta >= bands.avg_rating_abs_delta) {
        reasons.push({ rule: 'avg_rating_drift', severity: 'BLOCK', observed_delta: Math.round(delta * 100) / 100, baseline: baseline.avg_rating, candidate: candidate.avg_rating, threshold: bands.avg_rating_abs_delta });
      } else if (delta >= bands.avg_rating_watch_delta) {
        warnings.push({ rule: 'avg_rating_drift', severity: 'WATCH', observed_delta: Math.round(delta * 100) / 100, threshold: bands.avg_rating_watch_delta });
      }
    }

    // Star distribution bucket drift
    if (candidate.star_distribution_pct && baseline.star_distribution_pct) {
      const buckets = ['1', '2', '3', '4', '5'];
      let worstDelta = 0, worstBucket = null;
      for (const b of buckets) {
        const a = candidate.star_distribution_pct[b] || 0;
        const base = baseline.star_distribution_pct[b] || 0;
        const d = Math.abs(a - base);
        if (d > worstDelta) { worstDelta = d; worstBucket = b; }
      }
      if (worstDelta >= bands.star_distribution_pct_delta_any_bucket) {
        reasons.push({ rule: 'star_distribution_drift', severity: 'BLOCK', bucket: worstBucket, observed_delta_pp: Math.round(worstDelta * 10) / 10, threshold_pp: bands.star_distribution_pct_delta_any_bucket });
      } else if (worstDelta >= bands.star_distribution_pct_delta_watch) {
        warnings.push({ rule: 'star_distribution_drift', severity: 'WATCH', bucket: worstBucket, observed_delta_pp: Math.round(worstDelta * 10) / 10 });
      }
    }

    // Positive sentiment share drift
    if (candidate.sentiment_distribution && baseline.sentiment_distribution) {
      const toPct = (d) => {
        const total = (d.positive || 0) + (d.mixed || 0) + (d.negative || 0);
        return total ? (d.positive / total) * 100 : null;
      };
      const aP = toPct(candidate.sentiment_distribution);
      const bP = toPct(baseline.sentiment_distribution);
      if (aP != null && bP != null) {
        const delta = Math.abs(aP - bP);
        if (delta >= bands.positive_pct_abs_delta) {
          reasons.push({ rule: 'positive_sentiment_drift', severity: 'BLOCK', observed_delta_pp: Math.round(delta * 10) / 10, threshold_pp: bands.positive_pct_abs_delta });
        } else if (delta >= bands.positive_pct_watch) {
          warnings.push({ rule: 'positive_sentiment_drift', severity: 'WATCH', observed_delta_pp: Math.round(delta * 10) / 10 });
        }
      }
    }

    // Theme rank correlation
    if (Array.isArray(candidate.theme_top_10) && Array.isArray(baseline.theme_top_10)) {
      const aList = candidate.theme_top_10.map(t => t.theme);
      const bList = baseline.theme_top_10.map(t => t.theme);
      const corr = spearmanCorr(aList, bList);
      if (corr != null && corr < bands.theme_rank_correlation_min) {
        warnings.push({ rule: 'theme_rank_drift', severity: 'WATCH', observed_corr: Math.round(corr * 100) / 100, threshold: bands.theme_rank_correlation_min });
      }
    }
  }

  const hasBlock = reasons.some(r => r.severity === 'BLOCK');
  const verdict = hasBlock ? 'BLOCK' : (warnings.length > 0 ? 'WATCH' : 'OK');

  return {
    verdict,
    reasons,      // BLOCK-level
    warnings,     // WATCH-level
    summary: {
      review_count: reviewCount,
      archetype_coverage_pct: Math.round(archetypeCoveragePct),
      language_count: langCount,
      top_language: topLang?.[0] || null,
      top_language_pct: Math.round(topLangPct),
      baseline_compared: Boolean(baseline),
    },
  };
}

/**
 * Convenience wrapper: build a candidate from filter-stats + aggregate +
 * calibration signals in one call.
 */
function buildCandidate({ aggregation, filterStats, reviewerCounts }) {
  return {
    avg_rating: aggregation?.avg_rating_normalized_5 ?? aggregation?.avg_rating ?? null,
    review_count: aggregation?.review_count || 0,
    star_distribution_pct: aggregation?.star_distribution_pct || null,
    sentiment_distribution: aggregation?.sentiment_distribution || null,
    theme_top_10: (aggregation?.theme_frequencies
      ? Object.entries(aggregation.theme_frequencies)
          .map(([theme, c]) => ({ theme, total: c.total, positive_pct: c.total ? Math.round((c.positive / c.total) * 100) : 0 }))
          .sort((a, b) => b.total - a.total)
          .slice(0, 10)
      : []),
    archetype_coverage_counts: filterStats?.archetype_coverage_counts || {},
    language_counts: filterStats?.language_counts || {},
    reviewer_counts: reviewerCounts || {},
    unique_hashes: filterStats?.unique_hashes ?? null,
  };
}

module.exports = {
  runDriftGate,
  buildCandidate,
  DEFAULT_BANDS,
  DEFAULT_MAJOR_ARCHETYPES,
  spearmanCorr,
};
