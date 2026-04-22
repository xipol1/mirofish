/**
 * Calibration Drift Monitor — ENISA-grade audit layer for the empirical
 * signals that feed the simulation's decision engines.
 *
 * Goal: make every drift between a trusted baseline and the live voice-priors
 * detectable, auditable, and actionable. Three usage modes:
 *
 *   1. CLI check (for CI / cron): `node scripts/check_drift.js`
 *      Exits nonzero if any signal drifts more than its threshold. Writes
 *      an immutable audit record to backend/data/dignus_corpus/drift_audit/.
 *
 *   2. Runtime API: GET /api/dignus/drift → current status + recent audit.
 *
 *   3. UI banner: /lab Signals tab reads /api/dignus/drift and displays
 *      green (OK), yellow (WATCH), red (ALERT) with the specific signals
 *      that breached the band.
 *
 * Why this matters: regulators (ENISA, AI Act) require that AI-backed
 * decisions are auditable. Our decision engines now consume empirical
 * signals from a review corpus; if that corpus silently drifts (new ingest,
 * dataset refresh, regex change), decisions drift with it — and the consultant
 * wouldn't know. This module makes that observable + blockable.
 *
 * Signal-level thresholds default to ±10 percentage points on 0-1 signals
 * (e.g., price_sensitivity from 0.65 → 0.76 = 11pp = WATCH). Above ±20pp is
 * ALERT. Thresholds per-signal overridable in DRIFT_BANDS.
 */

const fs = require('fs');
const path = require('path');
const empirical = require('./empirical-signals');

const SNAPSHOT_DIR = path.join(__dirname, '..', '..', 'data', 'dignus_corpus', 'signal_snapshots');
const AUDIT_DIR = path.join(__dirname, '..', '..', 'data', 'dignus_corpus', 'drift_audit');

// Per-signal drift bands. All signals are 0-1 so we use absolute pp delta.
// "WATCH" is a soft alert (ship but log). "ALERT" is hard (block or page).
const DRIFT_BANDS = {
  price_sensitivity:      { watch_pp: 8,  alert_pp: 18 },
  service_expectation:    { watch_pp: 8,  alert_pp: 18 },
  cleanliness_threshold:  { watch_pp: 8,  alert_pp: 18 },
  loyalty_sensitivity:    { watch_pp: 8,  alert_pp: 18 },
  luxury_benchmark_score: { watch_pp: 8,  alert_pp: 18 },
  family_orientation:     { watch_pp: 8,  alert_pp: 18 },
  emotional_intensity:    { watch_pp: 6,  alert_pp: 15 },  // more volatile, tighter
  decision_latency_proxy: { watch_pp: 10, alert_pp: 22 },
  _default:               { watch_pp: 10, alert_pp: 20 },
};

// Cohort-level bands (aggregate across all archetypes)
const COHORT_BANDS = {
  reviews_count_rel_drop_pct: { watch: 15, alert: 30 },  // sudden shrinkage = concerning
  archetype_coverage_lost:    { watch: 1,  alert: 2 },    // how many archetypes disappear
  n_clusters_rel_drop_pct:    { watch: 10, alert: 25 },
};

function ensureDirs() {
  if (!fs.existsSync(SNAPSHOT_DIR)) fs.mkdirSync(SNAPSHOT_DIR, { recursive: true });
  if (!fs.existsSync(AUDIT_DIR)) fs.mkdirSync(AUDIT_DIR, { recursive: true });
}

/**
 * Capture the current byArchetype signals + metadata as a snapshot document.
 * Lean and audit-friendly — deterministic signature field for version pinning.
 */
function captureSnapshot({ label = 'manual', note = null } = {}) {
  ensureDirs();
  empirical.clearCache();  // force fresh read from voice_priors_from_reviews.json
  const vp = empirical.load();
  const archetypes = {};
  const archList = Object.keys(vp.clusters || {})
    .map(k => k.split('.')[0])
    .filter(a => a !== 'unclassified');
  for (const arch of [...new Set(archList)]) {
    const row = empirical.byArchetype(arch);
    if (row) archetypes[arch] = row;
  }

  const snapshot = {
    _label: label,
    _note: note,
    _captured_at: new Date().toISOString(),
    _source_generated_at: vp._generated_at || null,
    _source_signals_version: vp._signals_schema_version || null,
    _corpus: {
      total_reviews_in: vp._total_reviews_in || null,
      cluster_count: vp._cluster_count || 0,
    },
    archetypes,
  };

  // Filename: ISO timestamp + label slug. Immutable.
  const ts = snapshot._captured_at.replace(/[:.]/g, '-');
  const filename = `snapshot-${ts}-${String(label).replace(/[^a-z0-9_-]/gi, '')}.json`;
  const full = path.join(SNAPSHOT_DIR, filename);
  fs.writeFileSync(full, JSON.stringify(snapshot, null, 2));
  return { snapshot, file: full };
}

/**
 * Load a named snapshot or the latest. Label='latest' returns the most recent.
 */
function loadSnapshot(labelOrPath) {
  ensureDirs();
  if (labelOrPath && fs.existsSync(labelOrPath)) {
    return JSON.parse(fs.readFileSync(labelOrPath, 'utf8'));
  }
  const files = fs.readdirSync(SNAPSHOT_DIR).filter(f => f.endsWith('.json'));
  if (files.length === 0) return null;
  let filename;
  if (labelOrPath && labelOrPath !== 'latest') {
    filename = files.find(f => f.includes(`-${labelOrPath}.json`));
  } else {
    filename = files.sort().reverse()[0];
  }
  if (!filename) return null;
  return JSON.parse(fs.readFileSync(path.join(SNAPSHOT_DIR, filename), 'utf8'));
}

function listSnapshots() {
  ensureDirs();
  return fs.readdirSync(SNAPSHOT_DIR)
    .filter(f => f.endsWith('.json'))
    .sort()
    .reverse()
    .map(f => {
      const raw = JSON.parse(fs.readFileSync(path.join(SNAPSHOT_DIR, f), 'utf8'));
      return {
        file: f,
        captured_at: raw._captured_at,
        label: raw._label,
        note: raw._note,
        cluster_count: raw._corpus?.cluster_count,
        total_reviews_in: raw._corpus?.total_reviews_in,
        archetypes_count: Object.keys(raw.archetypes || {}).length,
      };
    });
}

/**
 * Compare a candidate against a baseline.
 * Returns { verdict, findings[], summary } where verdict is OK / WATCH / ALERT.
 */
function compareSnapshots(baseline, candidate, userBands = {}) {
  const bands = { ...DRIFT_BANDS, ...userBands };
  const cohortBands = COHORT_BANDS;
  const findings = [];
  let worstSeverity = 'OK';

  if (!baseline) {
    return { verdict: 'OK', findings: [{ kind: 'no_baseline', severity: 'INFO', message: 'No baseline — first capture' }], summary: { baseline: null, candidate_has_data: Boolean(candidate?.archetypes) } };
  }
  if (!candidate || !candidate.archetypes) {
    return { verdict: 'ALERT', findings: [{ kind: 'no_candidate', severity: 'ALERT', message: 'candidate snapshot missing or empty' }], summary: {} };
  }

  // ─── Cohort-level drift ───────────────────────────────────────────────────
  const bR = baseline._corpus?.total_reviews_in || 0;
  const cR = candidate._corpus?.total_reviews_in || 0;
  if (bR > 0) {
    const relDrop = ((bR - cR) / bR) * 100;
    if (relDrop >= cohortBands.reviews_count_rel_drop_pct.alert) {
      findings.push({ kind: 'reviews_count_drop', severity: 'ALERT', baseline: bR, candidate: cR, drop_pct: Math.round(relDrop * 10) / 10 });
      worstSeverity = 'ALERT';
    } else if (relDrop >= cohortBands.reviews_count_rel_drop_pct.watch) {
      findings.push({ kind: 'reviews_count_drop', severity: 'WATCH', baseline: bR, candidate: cR, drop_pct: Math.round(relDrop * 10) / 10 });
      if (worstSeverity === 'OK') worstSeverity = 'WATCH';
    }
  }
  const baselineArchs = Object.keys(baseline.archetypes || {});
  const candidateArchs = Object.keys(candidate.archetypes || {});
  const lostArchs = baselineArchs.filter(a => !candidateArchs.includes(a));
  if (lostArchs.length >= cohortBands.archetype_coverage_lost.alert) {
    findings.push({ kind: 'archetypes_missing', severity: 'ALERT', missing: lostArchs });
    worstSeverity = 'ALERT';
  } else if (lostArchs.length >= cohortBands.archetype_coverage_lost.watch) {
    findings.push({ kind: 'archetypes_missing', severity: 'WATCH', missing: lostArchs });
    if (worstSeverity === 'OK') worstSeverity = 'WATCH';
  }

  // ─── Per-archetype per-signal drift ───────────────────────────────────────
  const signalKeys = ['price_sensitivity', 'service_expectation', 'cleanliness_threshold', 'loyalty_sensitivity', 'luxury_benchmark_score', 'family_orientation', 'emotional_intensity', 'decision_latency_proxy'];
  for (const arch of baselineArchs) {
    const bRow = baseline.archetypes[arch];
    const cRow = candidate.archetypes[arch];
    if (!cRow) continue;  // already caught by archetypes_missing above
    for (const sig of signalKeys) {
      const bVal = bRow[sig];
      const cVal = cRow[sig];
      if (bVal == null || cVal == null) continue;
      const deltaPP = Math.abs(cVal - bVal) * 100;  // 0-1 scale → percentage points
      const band = bands[sig] || bands._default;
      if (deltaPP >= band.alert_pp) {
        findings.push({ kind: 'signal_drift', severity: 'ALERT', archetype: arch, signal: sig, baseline: bVal, candidate: cVal, delta_pp: Math.round(deltaPP * 10) / 10, threshold_pp: band.alert_pp });
        worstSeverity = 'ALERT';
      } else if (deltaPP >= band.watch_pp) {
        findings.push({ kind: 'signal_drift', severity: 'WATCH', archetype: arch, signal: sig, baseline: bVal, candidate: cVal, delta_pp: Math.round(deltaPP * 10) / 10, threshold_pp: band.watch_pp });
        if (worstSeverity === 'OK') worstSeverity = 'WATCH';
      }
    }
    // Complaint-trigger set drift — symmetric diff of top-3
    const bTriggers = (bRow.top_complaint_triggers || []).slice(0, 3).map(t => t.trigger);
    const cTriggers = (cRow.top_complaint_triggers || []).slice(0, 3).map(t => t.trigger);
    const diff = [
      ...bTriggers.filter(t => !cTriggers.includes(t)).map(t => ({ t, side: 'lost' })),
      ...cTriggers.filter(t => !bTriggers.includes(t)).map(t => ({ t, side: 'added' })),
    ];
    if (diff.length >= 2) {
      findings.push({ kind: 'complaint_triggers_reshuffle', severity: 'WATCH', archetype: arch, baseline_top3: bTriggers, candidate_top3: cTriggers, diff });
      if (worstSeverity === 'OK') worstSeverity = 'WATCH';
    }
  }

  return {
    verdict: worstSeverity,
    findings,
    summary: {
      baseline_captured_at: baseline._captured_at,
      candidate_captured_at: candidate._captured_at,
      baseline_reviews: bR,
      candidate_reviews: cR,
      baseline_clusters: baseline._corpus?.cluster_count || 0,
      candidate_clusters: candidate._corpus?.cluster_count || 0,
      archetypes_compared: baselineArchs.length,
      findings_count: findings.length,
      watch_count: findings.filter(f => f.severity === 'WATCH').length,
      alert_count: findings.filter(f => f.severity === 'ALERT').length,
    },
  };
}

/**
 * Write an immutable audit record. Callers pass the comparison result + any
 * context they want preserved for the CI/compliance trail.
 */
function writeAuditRecord(comparison, { triggered_by = 'cli', actor = 'unknown' } = {}) {
  ensureDirs();
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `audit-${ts}-${comparison.verdict}.json`;
  const full = path.join(AUDIT_DIR, filename);
  fs.writeFileSync(full, JSON.stringify({
    _audit_version: '1.0.0',
    _written_at: new Date().toISOString(),
    _triggered_by: triggered_by,
    _actor: actor,
    verdict: comparison.verdict,
    findings: comparison.findings,
    summary: comparison.summary,
  }, null, 2));
  return full;
}

function listAuditRecords({ limit = 20 } = {}) {
  ensureDirs();
  return fs.readdirSync(AUDIT_DIR)
    .filter(f => f.endsWith('.json'))
    .sort()
    .reverse()
    .slice(0, limit)
    .map(f => {
      try {
        const r = JSON.parse(fs.readFileSync(path.join(AUDIT_DIR, f), 'utf8'));
        return {
          file: f,
          written_at: r._written_at,
          verdict: r.verdict,
          triggered_by: r._triggered_by,
          actor: r._actor,
          findings_count: (r.findings || []).length,
          alert_count: (r.findings || []).filter(x => x.severity === 'ALERT').length,
          watch_count: (r.findings || []).filter(x => x.severity === 'WATCH').length,
          summary: r.summary,
        };
      } catch { return { file: f, error: true }; }
    });
}

/**
 * End-to-end helper: capture a fresh snapshot, compare to the named baseline,
 * write audit record, return result. Used by both the CLI and the HTTP route.
 */
function runCheck({ baselineLabel = 'baseline', triggered_by = 'cli', actor = 'unknown', bandsOverride = {} } = {}) {
  const baseline = loadSnapshot(baselineLabel);
  const { snapshot: candidate } = captureSnapshot({ label: `check-${Date.now()}`, note: `auto-capture by ${triggered_by}` });
  const comparison = compareSnapshots(baseline, candidate, bandsOverride);
  const auditPath = writeAuditRecord(comparison, { triggered_by, actor });
  return { ...comparison, audit_file: path.basename(auditPath), baseline_file: baseline ? `${baseline._captured_at} (label=${baseline._label})` : null };
}

module.exports = {
  captureSnapshot,
  loadSnapshot,
  listSnapshots,
  compareSnapshots,
  writeAuditRecord,
  listAuditRecords,
  runCheck,
  DRIFT_BANDS,
  COHORT_BANDS,
};
