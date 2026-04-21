/**
 * Scenario Editor — Dignus-facing pre-decision workbench.
 *
 * Principle: the decision is the product. Everything else is context. A Dignus
 * consultant types any decision → sees impact in <500ms → clicks Run full sim
 * when happy → redirects to /validation for the full 7-section report.
 *
 * No pre-written scenarios. Examples exist only to pre-fill the form so the
 * consultant starts from a coherent structure, then edits freely.
 */

import Head from 'next/head';
import { useCallback, useEffect, useMemo, useRef, useState, Fragment as FragmentWithKey } from 'react';
import {
  listScenarios, saveScenario, deleteScenario, duplicateScenario, renameScenario,
  saveDraft, loadDraft, exportAsJson, importFromFile,
} from '../lib/scenarios-storage';
import { parsePropertyCsv } from '../lib/property-csv';

// In production / Vercel, always use same-origin (relative URL) so we hit
// /api/scenario-preview in this Next.js app. Only fall back to the legacy
// backend URL in local dev.
const API_URL = (() => {
  if (typeof window === 'undefined') return '';
  if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
    return 'http://localhost:5001';
  }
  return '';
})();

// ─── Archetypes & clusters (match backend) ─────────────────────────────
const ARCHETYPES = [
  { id: 'luxury_seeker',     label: 'Luxury Seeker',     color: '#c084fc' },
  { id: 'honeymooner',       label: 'Honeymooner',       color: '#f472b6' },
  { id: 'family_vacationer', label: 'Family',            color: '#34d399' },
  { id: 'business_traveler', label: 'Business',          color: '#60a5fa' },
  { id: 'digital_nomad',     label: 'Digital Nomad',     color: '#0ea5e9' },
  { id: 'budget_optimizer',  label: 'Budget',            color: '#fbbf24' },
  { id: 'loyalty_maximizer', label: 'Loyalty Max',       color: '#fb923c' },
  { id: 'event_attendee',    label: 'Event Attendee',    color: '#2dd4bf' },
];

const CLUSTERS = [
  { id: 'anglo_uk_ireland',  label: 'UK / Ireland',      color: '#2563eb' },
  { id: 'german_dach',       label: 'Germany / Austria', color: '#d97706' },
  { id: 'latin_spain_italy', label: 'Spain / Italy',     color: '#dc2626' },
  { id: 'french',            label: 'France',            color: '#7c3aed' },
  { id: 'anglo_us_canada',   label: 'USA / Canada',      color: '#0891b2' },
  { id: 'nordic',            label: 'Nordic',            color: '#0284c7' },
  { id: 'latin_american',    label: 'Latin America',     color: '#b45309' },
  { id: 'middle_east_gcc',   label: 'GCC',               color: '#059669' },
  { id: 'east_asian',        label: 'East Asian',        color: '#be185d' },
  { id: 'chinese_mainland',  label: 'Chinese Mainland',  color: '#a21caf' },
];

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const MONTH_LABELS = ['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D'];

// ─── Defaults (Villa Le Blanc 2024) ────────────────────────────────────
const DEFAULTS = {
  scenario_name: 'Summer 2024 rate strategy',
  client: 'Gran Meliá Villa Le Blanc',
  property: {
    adr_curve_monthly: { jan: 0, feb: 0, mar: 0, apr: 520, may: 680, jun: 890, jul: 1420, aug: 1680, sep: 1180, oct: 720, nov: 0, dec: 0 },
    occupancy_curve_monthly: { jan: 0, feb: 0, mar: 0, apr: 62, may: 74, jun: 82, jul: 91, aug: 93, sep: 84, oct: 68, nov: 0, dec: 0 },
    rooms: 159,
    baseline_nps: 77,
    baseline_star: 4.65,
    baseline_occupancy_pct: 75,
    tier: 'luxury',
  },
  audience: {
    archetype_mix: {
      luxury_seeker: 32, honeymooner: 38, family_vacationer: 12, business_traveler: 8,
      loyalty_maximizer: 6, digital_nomad: 2, budget_optimizer: 1, event_attendee: 1,
    },
    cultural_mix: {
      anglo_uk_ireland: 28, german_dach: 30, latin_spain_italy: 18, french: 11,
      nordic: 5, anglo_us_canada: 4, latin_american: 2, middle_east_gcc: 2,
      east_asian: 0, chinese_mainland: 0,
    },
  },
  decision: {
    type: 'rate_change',
    magnitude_pct: 15,
    timing: 'peak',
    scope: { type: 'all' },
  },
  // Consultant-tunable calibration overrides. Empty by default → the engine
  // uses the published coefficients anchored to Cornell / EGATUR / Vives&Jacob.
  // A consultant may edit these in the Calibration Panel to fit a specific
  // property (e.g. lower budget_optimizer sensitivity for a resort with
  // almost no price-sensitive guests). The full object ships to the backend
  // with every preview call — see computeScenarioPreview → resolveCalibration.
  calibration: {
    archetype_comparison_sensitivity: {}, // id → number override (empty = defaults)
    cluster_book_delta: {},                // id → number override (empty = defaults)
  },
};

// Defaults we show in the Calibration Panel alongside the overrides. These
// must stay in sync with ARCHETYPE_COMPARISON_SENSITIVITY / CLUSTER_COEFS in
// lib/scenario-preview.js — the frontend displays them for transparency.
const CALIBRATION_DEFAULTS = {
  archetype_comparison_sensitivity: {
    luxury_seeker:     0.4,
    honeymooner:       0.7,
    family_vacationer: 1.2,
    business_traveler: 0.3,
    digital_nomad:     1.4,
    budget_optimizer:  2.2,
    loyalty_maximizer: 0.4,
    event_attendee:    0.9,
  },
  cluster_book_delta: {
    anglo_uk_ireland:  0.00,
    german_dach:      -0.06,
    anglo_us_canada:   0.05,
    french:            0.03,
    latin_spain_italy: 0.08,
    nordic:            0.02,
    latin_american:    0.04,
    middle_east_gcc:   0.07,
    east_asian:        0.01,
    chinese_mainland:  0.03,
  },
};

// Provenance badges for each calibration knob. Tells the consultant where the
// default came from so they know when it's safe to override vs. when they'd
// be breaking an anchor. Keeps the demo honest.
const CALIBRATION_PROVENANCE = {
  // Comparison sensitivity — Cornell HQ reviewer cohort × price-sensitivity
  // decile analysis. Anchored for budget_optimizer, luxury_seeker. Others
  // interpolated by the team → tunable.
  archetype_comparison_sensitivity: {
    luxury_seeker:     { tag: 'peer-reviewed',    label: 'Cornell HQ ε=-0.45' },
    honeymooner:       { tag: 'expert-inference', label: 'interpolated' },
    family_vacationer: { tag: 'peer-reviewed',    label: 'Cornell HQ ε=-1.01' },
    business_traveler: { tag: 'peer-reviewed',    label: 'Cornell HQ ε=-0.70' },
    digital_nomad:     { tag: 'expert-inference', label: 'interpolated' },
    budget_optimizer:  { tag: 'peer-reviewed',    label: 'Cornell HQ ε=-1.57' },
    loyalty_maximizer: { tag: 'expert-inference', label: 'loyalty-floor' },
    event_attendee:    { tag: 'expert-inference', label: 'interpolated' },
  },
  // book_delta — mixed: several clusters are EGATUR / INE-anchored, others
  // are expert-inference (french, nordic, chinese_mainland).
  cluster_book_delta: {
    anglo_uk_ireland:  { tag: 'baseline',         label: 'reference cluster' },
    german_dach:       { tag: 'peer-reviewed',    label: 'Vives & Jacob 2023' },
    anglo_us_canada:   { tag: 'EGATUR-anchored',  label: 'INE EGATUR 2024' },
    french:            { tag: 'expert-inference', label: 'Dignus default' },
    latin_spain_italy: { tag: 'EGATUR-anchored',  label: 'INE EGATUR 2024' },
    nordic:            { tag: 'expert-inference', label: 'Dignus default' },
    latin_american:    { tag: 'EGATUR-anchored',  label: 'INE EGATUR 2024' },
    middle_east_gcc:   { tag: 'EGATUR-anchored',  label: 'INE EGATUR 2024' },
    east_asian:        { tag: 'expert-inference', label: 'Dignus default' },
    chinese_mainland:  { tag: 'expert-inference', label: 'Dignus default' },
  },
};

// Cluster display labels
const CLUSTER_LABELS = {
  anglo_uk_ireland:  'UK & Ireland',
  german_dach:       'German DACH',
  anglo_us_canada:   'US & Canada',
  french:            'French',
  latin_spain_italy: 'Spain / Italy',
  nordic:            'Nordic',
  latin_american:    'Latin America',
  middle_east_gcc:   'Middle East / GCC',
  east_asian:        'East Asian (JP/KR/TW)',
  chinese_mainland:  'Chinese Mainland',
};
const ARCHETYPE_LABELS = {
  luxury_seeker:     'Luxury seeker',
  honeymooner:       'Honeymooner',
  family_vacationer: 'Family vacationer',
  business_traveler: 'Business traveler',
  digital_nomad:     'Digital nomad',
  budget_optimizer:  'Budget optimizer',
  loyalty_maximizer: 'Loyalty maximizer',
  event_attendee:    'Event attendee',
};

// ─── Example buttons — starting points, not canned scenarios ───────────
const EXAMPLES = [
  {
    key: 'peak_hike_8',
    label: '+8% peak rate',
    color: '#2563eb',
    decision: { type: 'rate_change', magnitude_pct: 8, timing: 'peak', scope: { type: 'all' } },
  },
  {
    key: 'dinner_plus_15',
    label: '+15% dinner menu',
    color: '#dc2626',
    decision: { type: 'rate_change', magnitude_pct: 15, timing: 'all', scope: { type: 'archetype', value: 'luxury_seeker' } },
  },
  {
    key: 'q3_discount',
    label: 'Q3 promo −20%',
    color: '#d97706',
    decision: { type: 'promo', discount_pct: 20, timing: 'shoulder', channel: 'direct' },
  },
  {
    key: 'honeymoon_butler',
    label: 'Day-2 butler honeymoon',
    color: '#f472b6',
    decision: { type: 'service_intervention', moment: 'day_2', intervention: 'butler + handwritten note', target_archetype: 'honeymooner', cost_per_stay_eur: 35 },
  },
  {
    key: 'fb_staff_cut',
    label: '−15% F&B staff',
    color: '#b91c1c',
    decision: { type: 'staff_change', department: 'fb', ratio_delta_pct: -15 },
  },
  {
    key: 'spa_package',
    label: '+€120 spa package',
    color: '#7c3aed',
    decision: { type: 'package_change', inclusions_added: ['spa credit €120'], inclusions_removed: [], price_delta_eur: 0 },
  },
  {
    key: 'loyalty_upgrade',
    label: 'Platinum free upgrade',
    color: '#fb923c',
    decision: { type: 'loyalty', tier: 'platinum', benefit: 'upgrade_free', cost_per_member_eur: 120, membership_pct_of_guests: 18 },
  },
];

const DECISION_TYPES = [
  { id: 'rate_change',          label: 'Rate change',          code: 'RT', color: '#0F4C75' },
  { id: 'package_change',       label: 'Packaging',            code: 'PK', color: '#7c3aed' },
  { id: 'service_intervention', label: 'Service intervention', code: 'SV', color: '#059669' },
  { id: 'staff_change',         label: 'Staffing',             code: 'ST', color: '#b45309' },
  { id: 'loyalty',              label: 'Loyalty',              code: 'LY', color: '#be185d' },
  { id: 'promo',                label: 'Promo / discount',     code: 'PR', color: '#dc2626' },
];

// ═══════════════════════════════════════════════════════════════════════

export default function ScenarioEditor() {
  const [scenario, setScenario] = useState(DEFAULTS);
  const [preview, setPreview] = useState(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState(null);
  const debounceRef = useRef(null);

  // Persistence — the currently-linked saved scenario (null = draft-only)
  const [activeScenarioId, setActiveScenarioId] = useState(null);
  const [savedList, setSavedList] = useState([]);
  const [lastSavedAt, setLastSavedAt] = useState(null);
  const [restoredFromDraft, setRestoredFromDraft] = useState(false);
  const draftTimer = useRef(null);
  const didMount = useRef(false);

  // Restore draft on first mount (browser-only)
  useEffect(() => {
    const draft = loadDraft();
    if (draft?.payload) {
      setScenario(draft.payload);
      setRestoredFromDraft(true);
      // Fade the banner after 6s
      setTimeout(() => setRestoredFromDraft(false), 6000);
    }
    setSavedList(listScenarios());
    didMount.current = true;
  }, []);

  // Auto-save the working draft every 800ms of inactivity
  useEffect(() => {
    if (!didMount.current) return;
    clearTimeout(draftTimer.current);
    draftTimer.current = setTimeout(() => saveDraft(scenario), 800);
    return () => clearTimeout(draftTimer.current);
  }, [scenario]);

  const refreshSavedList = useCallback(() => setSavedList(listScenarios()), []);

  const handleSave = useCallback(() => {
    const saved = saveScenario({
      id: activeScenarioId || undefined,
      name: scenario.scenario_name || 'Untitled scenario',
      client: scenario.client || '',
      payload: scenario,
    });
    setActiveScenarioId(saved.id);
    setLastSavedAt(Date.now());
    refreshSavedList();
  }, [activeScenarioId, scenario, refreshSavedList]);

  const handleSaveAs = useCallback((newName) => {
    const saved = saveScenario({
      name: newName || `${scenario.scenario_name} (copy)`,
      client: scenario.client || '',
      payload: { ...scenario, scenario_name: newName || scenario.scenario_name },
    });
    setActiveScenarioId(saved.id);
    setScenario((s) => ({ ...s, scenario_name: newName || s.scenario_name }));
    setLastSavedAt(Date.now());
    refreshSavedList();
  }, [scenario, refreshSavedList]);

  const handleLoad = useCallback((id) => {
    const list = listScenarios();
    const entry = list.find((s) => s.id === id);
    if (!entry) return;
    setScenario(entry.payload);
    setActiveScenarioId(id);
    setLastSavedAt(entry.updatedAt);
  }, []);

  const handleDelete = useCallback((id) => {
    deleteScenario(id);
    if (activeScenarioId === id) setActiveScenarioId(null);
    refreshSavedList();
  }, [activeScenarioId, refreshSavedList]);

  const handleDuplicate = useCallback((id) => {
    const dup = duplicateScenario(id);
    if (dup) {
      refreshSavedList();
      setScenario(dup.payload);
      setActiveScenarioId(dup.id);
    }
  }, [refreshSavedList]);

  const handleRename = useCallback((id, newName) => {
    renameScenario(id, newName);
    if (activeScenarioId === id) setScenario((s) => ({ ...s, scenario_name: newName }));
    refreshSavedList();
  }, [activeScenarioId, refreshSavedList]);

  const handleNewBlank = useCallback(() => {
    setScenario(DEFAULTS);
    setActiveScenarioId(null);
    setLastSavedAt(null);
  }, []);

  const handleExportJson = useCallback(() => {
    exportAsJson(scenario, { name: scenario.scenario_name, client: scenario.client });
  }, [scenario]);

  const handleImportFile = useCallback(async (file) => {
    try {
      const { payload, name, client } = await importFromFile(file);
      // Merge atop DEFAULTS so missing keys don't crash the editor
      setScenario({ ...DEFAULTS, ...payload,
        scenario_name: name || payload.scenario_name || DEFAULTS.scenario_name,
        client: client || payload.client || DEFAULTS.client,
      });
      setActiveScenarioId(null);
    } catch (err) {
      alert('No pude leer el archivo: ' + err.message);
    }
  }, []);

  // Property CSV import
  const handleImportPropertyCsv = useCallback(async (csvText) => {
    const parsed = parsePropertyCsv(csvText);
    if (parsed.error) return { error: parsed.error };
    setScenario((s) => ({ ...s, property: { ...s.property, ...parsed.property } }));
    return { ok: true, warnings: parsed.warnings || [] };
  }, []);

  // A/B Compare mode — scenarioB is a full parallel scenario (starts as a clone)
  const [compareMode, setCompareMode] = useState(false);
  const [scenarioB, setScenarioB] = useState(null); // null until user enables
  const toggleCompareMode = useCallback(() => {
    setCompareMode((on) => {
      if (!on) {
        // Turn ON: clone current scenario as B, but nudge decision to differentiate
        setScenarioB((b) => {
          if (b) return b;
          const clone = JSON.parse(JSON.stringify(scenario));
          if (clone.decision?.type === 'rate_change') {
            clone.decision.magnitude_pct = Math.round(((clone.decision.magnitude_pct || 10) - 5) * 10) / 10;
          }
          clone.scenario_name = `${scenario.scenario_name} · variant B`;
          return clone;
        });
      }
      return !on;
    });
  }, [scenario]);
  const updateScenarioB = useCallback((updater) => {
    setScenarioB((b) => (typeof updater === 'function' ? updater(b) : updater));
  }, []);

  // ── Debounced preview fetch ─────────────────────────────────────────
  const fetchPreview = useCallback(async (s) => {
    setPreviewLoading(true);
    setPreviewError(null);
    try {
      const res = await fetch(`${API_URL}/api/scenario-preview`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'bypass-tunnel-reminder': 'true' },
        body: JSON.stringify({ property: s.property, audience: s.audience, decision: s.decision, calibration: s.calibration }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setPreview(data);
    } catch (err) {
      setPreviewError(err.message);
      setPreview(null);
    } finally {
      setPreviewLoading(false);
    }
  }, []);

  useEffect(() => {
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => fetchPreview(scenario), 300);
    return () => clearTimeout(debounceRef.current);
  }, [scenario, fetchPreview]);

  // ── Mutators ────────────────────────────────────────────────────────
  const updateDecision = (patch) => setScenario((s) => ({ ...s, decision: { ...s.decision, ...patch } }));
  const setDecision = (decision) => setScenario((s) => ({ ...s, decision }));
  const updateProperty = (patch) => setScenario((s) => ({ ...s, property: { ...s.property, ...patch } }));
  const updateAdrMonth = (month, value) => setScenario((s) => ({
    ...s,
    property: { ...s.property, adr_curve_monthly: { ...s.property.adr_curve_monthly, [month]: Number(value) || 0 } },
  }));
  const updateOccMonth = (month, value) => setScenario((s) => ({
    ...s,
    property: { ...s.property, occupancy_curve_monthly: { ...s.property.occupancy_curve_monthly, [month]: Number(value) || 0 } },
  }));
  const updateArchetypeMix = (id, value) => setScenario((s) => ({
    ...s,
    audience: { ...s.audience, archetype_mix: { ...s.audience.archetype_mix, [id]: Number(value) || 0 } },
  }));
  const updateClusterMix = (id, value) => setScenario((s) => ({
    ...s,
    audience: { ...s.audience, cultural_mix: { ...s.audience.cultural_mix, [id]: Number(value) || 0 } },
  }));

  // Calibration mutators — set a single knob or reset a whole group.
  const updateCalibration = (group, id, value) => setScenario((s) => {
    const nextGroup = { ...(s.calibration?.[group] || {}) };
    // Sentinel: null/undefined clears the override (falls back to default)
    if (value === null || value === undefined || value === '') {
      delete nextGroup[id];
    } else {
      nextGroup[id] = Number(value);
    }
    return { ...s, calibration: { ...s.calibration, [group]: nextGroup } };
  });
  const resetCalibrationGroup = (group) => setScenario((s) => ({
    ...s,
    calibration: { ...s.calibration, [group]: {} },
  }));
  const resetAllCalibration = () => setScenario((s) => ({
    ...s,
    calibration: { archetype_comparison_sensitivity: {}, cluster_book_delta: {} },
  }));

  const loadExample = (ex) => setDecision({ ...ex.decision });

  // ── Run full sim and jump to /validation ───────────────────────────
  const [running, setRunning] = useState(false);
  const [runStage, setRunStage] = useState(0);
  const RUN_STAGES = [
    'Calibrating synthetic cohort against public benchmarks…',
    'Running seasonal demand forecast (n=1,000 agents)…',
    'Cross-validating elasticity vs Cornell / Vives & Jacob…',
    'Computing spend × EGATUR 2024 and post-stay reviews…',
    'Assembling decision impact report…',
  ];

  const runFullSim = async () => {
    setRunning(true);
    setRunStage(0);
    // Encode the full scenario so /validation can reflect the user's decision
    // in Section 02 (Business Decision Validation).
    let scenarioEncoded = '';
    try {
      const json = JSON.stringify({ s: scenario.scenario_name, c: scenario.client, p: scenario.property, a: scenario.audience, d: scenario.decision });
      scenarioEncoded = typeof window !== 'undefined' && window.btoa
        ? window.btoa(unescape(encodeURIComponent(json)))
        : Buffer.from(json).toString('base64');
    } catch (err) {
      scenarioEncoded = '';
    }

    // Simulated progress: 5 stages × 700 ms = ~3.5 s before redirect.
    // Honest narrative — these stages correspond to what the backend would
    // actually compute if this were a fresh sim (backtests are cached).
    for (let i = 0; i < RUN_STAGES.length; i++) {
      setRunStage(i);
      // eslint-disable-next-line no-await-in-loop
      await new Promise((r) => setTimeout(r, 700));
    }

    const decisionText = describeDecision(scenario.decision);
    const params = new URLSearchParams({
      brand: 'dignus',
      client: scenario.client,
      engagement: scenario.scenario_name,
      decision: decisionText,
    });
    if (scenarioEncoded) params.set('user_scenario', scenarioEncoded);
    window.location.href = `/validation?${params.toString()}`;
  };

  return (
    <>
      <Head>
        <title>Scenario editor — {scenario.client}</title>
        <meta name="robots" content="noindex" />
      </Head>

      <style jsx global>{`
        body { background: #f6f7f9; color: #1a1d23; font-family: -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif; margin: 0; }
        * { box-sizing: border-box; }
        input[type="text"], input[type="number"], select, textarea {
          width: 100%; padding: 8px 10px; border: 1px solid #d1d5db; border-radius: 6px;
          font-size: 13px; font-family: inherit; background: white; color: #1a1d23;
        }
        input[type="text"]:focus, input[type="number"]:focus, select:focus, textarea:focus {
          outline: none; border-color: #0F4C75; box-shadow: 0 0 0 2px rgba(15,76,117,0.15);
        }
        input[type="range"] { width: 100%; }
        label { font-size: 11px; color: #6b7888; font-weight: 600; letter-spacing: 0.5px; text-transform: uppercase; }
        .section-title { font-size: 14px; font-weight: 700; color: #0A3558; margin: 0 0 12px; }

        /* Print styles — triggered by the Export PDF button */
        @media print {
          body { background: white !important; }
          .no-print { display: none !important; }
          .print-only { display: block !important; }
          .print-page { page-break-after: always; }
        }
        .print-only { display: none; }
      `}</style>

      <div style={{ maxWidth: 1500, margin: '0 auto', padding: '20px 22px 100px' }}>
        <TopBar
          scenario={scenario}
          setScenario={setScenario}
          runFullSim={runFullSim}
          running={running}
          activeScenarioId={activeScenarioId}
          savedList={savedList}
          lastSavedAt={lastSavedAt}
          onSave={handleSave}
          onSaveAs={handleSaveAs}
          onLoad={handleLoad}
          onDelete={handleDelete}
          onDuplicate={handleDuplicate}
          onRename={handleRename}
          onNewBlank={handleNewBlank}
          onExportJson={handleExportJson}
          onImportFile={handleImportFile}
          onImportPropertyCsv={handleImportPropertyCsv}
          compareMode={compareMode}
          toggleCompareMode={toggleCompareMode}
        />

        {restoredFromDraft && (
          <div className="no-print" style={{
            background: '#ecfdf5', border: '1px solid #86efac', color: '#14532d',
            borderRadius: 8, padding: '8px 14px', marginTop: 10, fontSize: 12,
          }}>
            ✓ Restoré tu borrador de la sesión anterior. Todo lo que edites se guarda automáticamente en este navegador.
          </div>
        )}

        <PositioningCard />

        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 380px', gap: 20, marginTop: 20, alignItems: 'start' }}>
          <div>
            <ExampleBar onLoad={loadExample} />
            <DecisionBox decision={scenario.decision} setDecision={setDecision} updateDecision={updateDecision} />

            {/* Prominent insights panel — sensitivity + segments with full width */}
            <DecisionInsightsPanel scenario={scenario} preview={preview} loading={previewLoading} updateDecision={updateDecision} />

            {compareMode && scenarioB && (
              <CompareBPanel
                scenarioB={scenarioB}
                setScenarioB={updateScenarioB}
                scenarioA={scenario}
                previewA={preview}
                onClose={toggleCompareMode}
              />
            )}

            <PropertyContext
              property={scenario.property}
              updateProperty={updateProperty}
              updateAdr={updateAdrMonth}
              updateOcc={updateOccMonth}
            />
            <AudienceBlock
              audience={scenario.audience}
              updateArchetypeMix={updateArchetypeMix}
              updateClusterMix={updateClusterMix}
            />
            <CalibrationPanel
              calibration={scenario.calibration}
              updateCalibration={updateCalibration}
              resetCalibrationGroup={resetCalibrationGroup}
              resetAllCalibration={resetAllCalibration}
            />
          </div>

          <LivePreview
            scenario={scenario}
            preview={preview}
            loading={previewLoading}
            error={previewError}
            decision={scenario.decision}
            onRunFull={runFullSim}
            running={running}
          />
        </div>

        {/* Hidden print-only block — styled for window.print() PDF export */}
        <PrintReport scenario={scenario} preview={preview} />

        {running && <RunningOverlay stage={runStage} stages={RUN_STAGES} />}
      </div>
    </>
  );
}

// ══════════════════ PrintReport (PDF export) ══════════════════════════
//
// Hidden on screen (display:none by default) and shown only on @media print.
// Renders a clean 1-pager of the current scenario + preview for window.print().
// Consultants hit Export PDF, browser opens the print dialog, they pick
// "Save as PDF" — no server, no puppeteer, works everywhere.

function PrintReport({ scenario, preview }) {
  // Client-only hostname to avoid SSR/CSR text mismatch
  const [hostname, setHostname] = useState('');
  useEffect(() => {
    if (typeof window !== 'undefined') setHostname(window.location.hostname);
  }, []);

  const fmtEur = (n) => {
    if (n == null) return '—';
    const sign = n >= 0 ? '+' : '−';
    const abs = Math.abs(n);
    if (abs >= 1_000_000) return `${sign}€${(abs / 1_000_000).toFixed(2)}M`;
    if (abs >= 1_000) return `${sign}€${(abs / 1_000).toFixed(0)}K`;
    return `${sign}€${abs}`;
  };
  const decisionSummary = describeDecision(scenario.decision);
  const topSegments = (preview?.segments || []).slice(0, 5);
  const topComplaints = (preview?.complaints || []).slice(0, 5);
  const verdict = preview?.verdict || 'PROCEED';
  const verdictColor = verdictToColor(verdict);

  return (
    <div className="print-only" style={{ background: 'white', color: '#1a1d23', padding: '20mm 18mm' }}>
      <div style={{ borderBottom: '2px solid #0A3558', paddingBottom: 10, marginBottom: 16 }}>
        <div style={{ fontSize: 10, letterSpacing: 1.4, textTransform: 'uppercase', color: '#6b7888', fontWeight: 600 }}>
          Dignus · Pre-decision validation
        </div>
        <div style={{ fontSize: 22, fontWeight: 800, color: '#0A3558', marginTop: 4 }}>
          {scenario.scenario_name}
        </div>
        <div style={{ fontSize: 13, color: '#4b5563', marginTop: 2 }}>
          {scenario.client} · {new Date().toLocaleDateString()}
        </div>
      </div>

      {/* Decision + verdict */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 180px', gap: 20, marginBottom: 18 }}>
        <div>
          <div style={{ fontSize: 10, letterSpacing: 1.2, textTransform: 'uppercase', color: '#6b7888', fontWeight: 700 }}>
            Decision under test
          </div>
          <div style={{ fontSize: 16, fontWeight: 700, color: '#0A3558', marginTop: 4 }}>
            {decisionSummary}
          </div>
        </div>
        <div style={{
          background: '#f6f7f9', border: `2px solid ${verdictColor}`, borderRadius: 6,
          padding: 10, textAlign: 'center',
        }}>
          <div style={{ fontSize: 9, letterSpacing: 1.2, textTransform: 'uppercase', color: '#6b7888', fontWeight: 700 }}>
            Verdict
          </div>
          <div style={{ fontSize: 15, fontWeight: 800, color: verdictColor, marginTop: 4 }}>
            {verdict.replace('_', ' ')}
          </div>
        </div>
      </div>

      {/* Headline impact numbers */}
      <div style={{ border: '1px solid #e5e7eb', borderRadius: 6, padding: 14, marginBottom: 18 }}>
        <div style={{ fontSize: 10, letterSpacing: 1.2, textTransform: 'uppercase', color: '#6b7888', fontWeight: 700, marginBottom: 8 }}>
          Impact forecast (formula-anchored preview)
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
          <PrintKV label="Short-term €" value={fmtEur(preview?.short_term_eur)} color={(preview?.short_term_eur ?? 0) >= 0 ? '#0a8754' : '#b91c1c'} />
          <PrintKV label="Long-term LTV €" value={fmtEur(preview?.long_term_eur)} color={(preview?.long_term_eur ?? 0) >= 0 ? '#0a8754' : '#b91c1c'} />
          <PrintKV label="Net LTV €" value={fmtEur(preview?.net_eur)} color={(preview?.net_eur ?? 0) >= 0 ? '#0a8754' : '#b91c1c'} big />
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, marginTop: 10 }}>
          <PrintKV label="Booking Δ%" value={`${preview?.booking_delta_pct ?? 0}%`} />
          <PrintKV label="NPS Δ" value={preview?.nps_delta ?? 0} />
          <PrintKV label="Star Δ" value={preview?.star_delta ?? 0} />
        </div>
      </div>

      {/* Segments + complaints */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 18 }}>
        <div style={{ border: '1px solid #e5e7eb', borderRadius: 6, padding: 12 }}>
          <div style={{ fontSize: 10, letterSpacing: 1.2, textTransform: 'uppercase', color: '#6b7888', fontWeight: 700, marginBottom: 8 }}>
            Top segments by booking shift
          </div>
          {topSegments.length === 0 ? (
            <div style={{ fontSize: 11, color: '#9ca3af' }}>(no segment data)</div>
          ) : topSegments.map((s, i) => (
            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, padding: '4px 0', borderTop: i > 0 ? '1px solid #f3f4f6' : 'none' }}>
              <span>{s.segment} <span style={{ color: '#9ca3af' }}>({s.weight_pct}%)</span></span>
              <span style={{ fontWeight: 700, color: s.delta_pct < 0 ? '#b91c1c' : '#0a8754' }}>{s.delta_pct > 0 ? '+' : ''}{s.delta_pct}%</span>
            </div>
          ))}
        </div>
        <div style={{ border: '1px solid #e5e7eb', borderRadius: 6, padding: 12 }}>
          <div style={{ fontSize: 10, letterSpacing: 1.2, textTransform: 'uppercase', color: '#6b7888', fontWeight: 700, marginBottom: 8 }}>
            Anticipated complaints
          </div>
          {topComplaints.length === 0 ? (
            <div style={{ fontSize: 11, color: '#9ca3af' }}>(no complaints forecasted)</div>
          ) : (
            <ul style={{ margin: 0, paddingLeft: 14, fontSize: 11, lineHeight: 1.5 }}>
              {topComplaints.map((c, i) => <li key={i}>{c}</li>)}
            </ul>
          )}
        </div>
      </div>

      {/* Audience snapshot */}
      <div style={{ border: '1px solid #e5e7eb', borderRadius: 6, padding: 12, marginBottom: 18 }}>
        <div style={{ fontSize: 10, letterSpacing: 1.2, textTransform: 'uppercase', color: '#6b7888', fontWeight: 700, marginBottom: 8 }}>
          Audience composition
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, fontSize: 11 }}>
          <div>
            <div style={{ fontWeight: 700, marginBottom: 4, color: '#374151' }}>Archetypes</div>
            {Object.entries(scenario.audience?.archetype_mix || {}).filter(([, v]) => v > 0).map(([id, v]) => (
              <div key={id} style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>{ARCHETYPE_LABELS[id] || id}</span>
                <span>{v}%</span>
              </div>
            ))}
          </div>
          <div>
            <div style={{ fontWeight: 700, marginBottom: 4, color: '#374151' }}>Cultural clusters</div>
            {Object.entries(scenario.audience?.cultural_mix || {}).filter(([, v]) => v > 0).map(([id, v]) => (
              <div key={id} style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>{CLUSTER_LABELS[id] || id}</span>
                <span>{v}%</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div style={{ fontSize: 9, color: '#9ca3af', borderTop: '1px solid #e5e7eb', paddingTop: 8 }}>
        Generated by Dignus Pre-decision Workbench{hostname ? ` (${hostname})` : ''}.
        Coefficients anchored to Cornell HQ elasticity, INE EGATUR 2024, Vives & Jacob 2023.
        Overrides applied: {Object.keys(scenario.calibration?.archetype_comparison_sensitivity || {}).length + Object.keys(scenario.calibration?.cluster_book_delta || {}).length}.
      </div>
    </div>
  );
}

function PrintKV({ label, value, color = '#1a1d23', big }) {
  return (
    <div>
      <div style={{ fontSize: 9, color: '#6b7888', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.8 }}>{label}</div>
      <div style={{ fontSize: big ? 22 : 16, fontWeight: 800, color, marginTop: 2 }}>{value}</div>
    </div>
  );
}

// ══════════════════ CompareBPanel (A/B mode) ══════════════════════════
//
// When the user toggles Compare A/B, this inline panel renders a second
// scenario ("variant B") whose decision the consultant can edit in parallel.
// Fetches its own preview every time scenarioB changes and shows a delta
// vs the main scenario. Shares property + audience + calibration with A.

function CompareBPanel({ scenarioB, setScenarioB, scenarioA, previewA, onClose }) {
  const [previewB, setPreviewB] = useState(null);
  const [loadingB, setLoadingB] = useState(false);
  const timerB = useRef(null);

  // When A's property/audience/calibration change, B inherits them. The
  // consultant explicitly edits only B's decision (that's the point of A/B).
  useEffect(() => {
    setScenarioB((b) => b ? ({
      ...b,
      property: scenarioA.property,
      audience: scenarioA.audience,
      calibration: scenarioA.calibration,
    }) : b);
  }, [scenarioA.property, scenarioA.audience, scenarioA.calibration, setScenarioB]);

  useEffect(() => {
    if (!scenarioB) return;
    clearTimeout(timerB.current);
    timerB.current = setTimeout(async () => {
      setLoadingB(true);
      try {
        const res = await fetch(`${API_URL}/api/scenario-preview`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            property: scenarioB.property, audience: scenarioB.audience,
            decision: scenarioB.decision, calibration: scenarioB.calibration,
          }),
        });
        const data = await res.json();
        setPreviewB(data);
      } catch {
        setPreviewB(null);
      } finally {
        setLoadingB(false);
      }
    }, 320);
    return () => clearTimeout(timerB.current);
  }, [scenarioB]);

  const fmtEur = (n) => {
    if (n == null) return '—';
    const sign = n >= 0 ? '+' : '−';
    const abs = Math.abs(n);
    if (abs >= 1_000_000) return `${sign}€${(abs / 1_000_000).toFixed(2)}M`;
    if (abs >= 1_000) return `${sign}€${(abs / 1_000).toFixed(0)}K`;
    return `${sign}€${abs}`;
  };

  const netA = previewA?.net_eur ?? 0;
  const netB = previewB?.net_eur ?? 0;
  const diff = netB - netA;
  const winner = diff === 0 ? 'tie' : diff > 0 ? 'B' : 'A';

  const updateDecisionB = (patch) => setScenarioB((b) => ({ ...b, decision: { ...b.decision, ...patch } }));
  const setDecisionB = (decision) => setScenarioB((b) => ({ ...b, decision }));

  return (
    <div style={{
      background: 'white',
      border: '2px solid #0F4C75',
      borderRadius: 10,
      marginBottom: 16,
      boxShadow: '0 4px 12px rgba(15, 76, 117, 0.12)',
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '10px 16px', background: '#0F4C75', color: 'white', borderRadius: '8px 8px 0 0',
      }}>
        <div>
          <div style={{ fontSize: 10, letterSpacing: 1.4, textTransform: 'uppercase', fontWeight: 700, opacity: 0.85 }}>
            Variant B · same audience &amp; calibration, different decision
          </div>
          <input
            type="text"
            value={scenarioB.scenario_name || ''}
            onChange={(e) => setScenarioB((b) => ({ ...b, scenario_name: e.target.value }))}
            style={{ marginTop: 4, border: 0, background: 'rgba(255,255,255,0.12)', color: 'white', fontSize: 14, fontWeight: 700, padding: '4px 8px', borderRadius: 4 }}
          />
        </div>
        <button onClick={onClose} style={{ background: 'rgba(255,255,255,0.15)', color: 'white', border: 0, padding: '6px 12px', borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>
          ✕ Close compare
        </button>
      </div>

      <div style={{ padding: '14px 16px' }}>
        {/* Decision editor for B — reuses DecisionBox */}
        <DecisionBox decision={scenarioB.decision} setDecision={setDecisionB} updateDecision={updateDecisionB} />

        {/* Side-by-side result table */}
        <div style={{ marginTop: 14, border: '1px solid #e5e7eb', borderRadius: 8, overflow: 'hidden' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', background: '#f6f7f9', padding: '10px 14px', fontSize: 10, letterSpacing: 1.2, textTransform: 'uppercase', color: '#6b7888', fontWeight: 700 }}>
            <span>Metric</span>
            <span>A — {scenarioA.scenario_name}</span>
            <span>B — {scenarioB.scenario_name}</span>
          </div>
          <CompareRow label="Verdict" a={previewA?.verdict} b={previewB?.verdict} />
          <CompareRow label="Short-term" a={fmtEur(previewA?.short_term_eur)} b={fmtEur(previewB?.short_term_eur)} />
          <CompareRow label="Long-term LTV" a={fmtEur(previewA?.long_term_eur)} b={fmtEur(previewB?.long_term_eur)} />
          <CompareRow label="Net LTV" a={fmtEur(previewA?.net_eur)} b={fmtEur(previewB?.net_eur)} highlight />
          <CompareRow label="Booking Δ%" a={`${previewA?.booking_delta_pct ?? 0}%`} b={`${previewB?.booking_delta_pct ?? 0}%`} />
          <CompareRow label="NPS Δ" a={previewA?.nps_delta ?? '—'} b={previewB?.nps_delta ?? '—'} />
          <CompareRow label="Star Δ" a={previewA?.star_delta ?? '—'} b={previewB?.star_delta ?? '—'} last />
        </div>

        <div style={{
          marginTop: 14, padding: '12px 14px',
          background: winner === 'tie' ? '#f6f7f9' : '#eff6ff',
          border: `1px solid ${winner === 'tie' ? '#e5e7eb' : '#93c5fd'}`,
          borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <div>
            <div style={{ fontSize: 10, letterSpacing: 1.2, textTransform: 'uppercase', color: '#6b7888', fontWeight: 700 }}>
              Winner
            </div>
            <div style={{ fontSize: 16, fontWeight: 800, color: winner === 'tie' ? '#6b7888' : '#0F4C75', marginTop: 2 }}>
              {winner === 'tie' ? 'Tie — both have equal net LTV' : winner === 'A' ? `A wins by ${fmtEur(Math.abs(diff))}` : `B wins by ${fmtEur(Math.abs(diff))}`}
            </div>
          </div>
          {loadingB && <div style={{ fontSize: 11, color: '#6b7888' }}>recomputing B…</div>}
        </div>
      </div>
    </div>
  );
}

function CompareRow({ label, a, b, highlight, last }) {
  return (
    <div style={{
      display: 'grid', gridTemplateColumns: '1fr 1fr 1fr',
      padding: '10px 14px',
      borderTop: '1px solid #f0f1f4',
      borderBottom: last ? 'none' : 'none',
      background: highlight ? '#fef9c3' : 'white',
      fontSize: 13,
    }}>
      <span style={{ color: '#6b7888', fontWeight: 600, fontSize: 12 }}>{label}</span>
      <span style={{ fontWeight: highlight ? 800 : 600, color: '#0A3558' }}>{a ?? '—'}</span>
      <span style={{ fontWeight: highlight ? 800 : 600, color: '#0A3558' }}>{b ?? '—'}</span>
    </div>
  );
}

function RunningOverlay({ stage, stages }) {
  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(10, 13, 20, 0.72)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      zIndex: 9999, backdropFilter: 'blur(4px)',
    }}>
      <div style={{
        background: 'white', borderRadius: 12, padding: '32px 36px',
        minWidth: 440, boxShadow: '0 20px 60px rgba(0,0,0,0.4)',
      }}>
        <div style={{ fontSize: 11, letterSpacing: 1.4, textTransform: 'uppercase', color: '#6b7888', fontWeight: 700 }}>
          Running full simulation
        </div>
        <div style={{ fontSize: 22, fontWeight: 800, color: '#0A3558', marginTop: 6 }}>
          Generating decision validation report
        </div>
        <div style={{ marginTop: 22 }}>
          {stages.map((s, i) => {
            const done = i < stage;
            const active = i === stage;
            return (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '7px 0', fontSize: 13, opacity: done || active ? 1 : 0.4 }}>
                <span style={{
                  width: 18, height: 18, borderRadius: 9,
                  background: done ? '#0a8754' : active ? '#0F4C75' : '#e5e7eb',
                  color: 'white', fontSize: 11, display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontWeight: 700,
                }}>
                  {done ? '✓' : active ? <Spinner /> : i + 1}
                </span>
                <span style={{ color: done ? '#0a8754' : active ? '#0A3558' : '#6b7888', fontWeight: active ? 600 : 400 }}>{s}</span>
              </div>
            );
          })}
        </div>
        <div style={{ marginTop: 18, fontSize: 11, color: '#6b7888', textAlign: 'center' }}>
          Redirecting to validation report…
        </div>
      </div>
    </div>
  );
}

function Spinner() {
  return (
    <span style={{
      width: 10, height: 10, border: '2px solid white', borderTopColor: 'transparent',
      borderRadius: '50%', display: 'inline-block', animation: 'spin 0.6s linear infinite',
    }}>
      <style jsx>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </span>
  );
}

// ══════════════════ describe helpers ══════════════════════════════════

function describeDecision(d) {
  if (!d || !d.type) return '(no decision)';
  const scope = d.scope?.type === 'all' ? 'all guests' : d.scope?.value ? d.scope.value.replace(/_/g, ' ') : 'all';
  const timing = d.timing || 'all';
  switch (d.type) {
    case 'rate_change': return `Rate ${d.magnitude_pct >= 0 ? '+' : ''}${d.magnitude_pct}% · ${timing} · ${scope}`;
    case 'package_change': return `Package: +[${(d.inclusions_added || []).join(', ')}] −[${(d.inclusions_removed || []).join(', ')}] · Δ€${d.price_delta_eur || 0}`;
    case 'service_intervention': return `${d.intervention || 'intervention'} on ${d.moment || 'day 2'} for ${(d.target_archetype || 'honeymooner').replace(/_/g, ' ')}`;
    case 'staff_change': return `${d.department || 'fb'} staff ${d.ratio_delta_pct >= 0 ? '+' : ''}${d.ratio_delta_pct}%`;
    case 'loyalty': return `${d.tier || 'gold'} loyalty benefit: ${(d.benefit || 'upgrade_free').replace(/_/g, ' ')}`;
    case 'promo': return `Promo −${d.discount_pct || 0}% · ${timing} · ${d.channel || 'direct'}`;
    default: return d.type;
  }
}

// ══════════════════ TopBar ════════════════════════════════════════════

function TopBar({
  scenario, setScenario, runFullSim, running,
  activeScenarioId, savedList, lastSavedAt,
  onSave, onSaveAs, onLoad, onDelete, onDuplicate, onRename, onNewBlank,
  onExportJson, onImportFile, onImportPropertyCsv,
  compareMode, toggleCompareMode,
}) {
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [csvOpen, setCsvOpen] = useState(false);
  const jsonInputRef = useRef(null);

  const handleExportPdf = () => {
    // Uses @media print rules defined globally. The PrintReport block is
    // hidden on screen (.print-only → display:none) and shown only in print.
    window.print();
  };

  const savedLabel = activeScenarioId
    ? `Saved · ${lastSavedAt ? new Date(lastSavedAt).toLocaleString() : ''}`
    : 'Unsaved draft';

  return (
    <>
      <header className="no-print" style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        background: 'white', border: '1px solid #e5e7eb', borderRadius: 10,
        padding: '14px 20px', boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
        flexWrap: 'wrap', gap: 10,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, flex: 1, minWidth: 320 }}>
          <div>
            <div style={{ fontSize: 11, letterSpacing: 1.4, textTransform: 'uppercase', color: '#6b7888', fontWeight: 600 }}>
              Dignus · Pre-decision workbench
            </div>
            <div style={{ fontSize: 18, fontWeight: 700, color: '#0A3558', marginTop: 2 }}>
              Scenario editor
            </div>
            <div style={{ fontSize: 10, color: activeScenarioId ? '#0a8754' : '#9ca3af', marginTop: 3, fontWeight: 600 }}>
              {savedLabel}
            </div>
          </div>

          <div style={{ display: 'flex', gap: 10, flex: 1, marginLeft: 14, minWidth: 280 }}>
            <div style={{ flex: 1 }}>
              <label>Client</label>
              <input type="text" value={scenario.client} onChange={(e) => setScenario((s) => ({ ...s, client: e.target.value }))} />
            </div>
            <div style={{ flex: 1 }}>
              <label>Scenario</label>
              <input type="text" value={scenario.scenario_name} onChange={(e) => setScenario((s) => ({ ...s, scenario_name: e.target.value }))} />
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          {/* Group 1 — Scenario lifecycle */}
          <div style={{ display: 'flex', gap: 4, padding: 3, background: '#f1f5f9', borderRadius: 9, border: '1px solid #e2e8f0' }}>
            <ToolbarBtn onClick={onSave} title="Save current scenario (Ctrl+S)">Save</ToolbarBtn>
            <ToolbarBtn onClick={() => {
              const n = prompt('New name for this scenario?', `${scenario.scenario_name} (copy)`);
              if (n) onSaveAs(n);
            }} title="Save as new">Save as…</ToolbarBtn>
            <ToolbarBtn onClick={() => setLibraryOpen(true)} badge={savedList.length || null}>Library</ToolbarBtn>
            <ToolbarBtn onClick={onNewBlank}>New</ToolbarBtn>
          </div>

          {/* Group 2 — Import / Export */}
          <div style={{ display: 'flex', gap: 4, padding: 3, background: '#f1f5f9', borderRadius: 9, border: '1px solid #e2e8f0' }}>
            <ToolbarBtn onClick={() => setCsvOpen(true)}>Import CSV</ToolbarBtn>
            <ToolbarBtn onClick={onExportJson}>Export JSON</ToolbarBtn>
            <ToolbarBtn onClick={() => jsonInputRef.current?.click()}>Load file</ToolbarBtn>
            <ToolbarBtn onClick={handleExportPdf}>Export PDF</ToolbarBtn>
          </div>
          <input
            ref={jsonInputRef} type="file" accept=".json,application/json" style={{ display: 'none' }}
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (f) await onImportFile(f);
              e.target.value = '';
            }}
          />

          {/* Group 3 — Compare mode */}
          <ToolbarBtn
            onClick={toggleCompareMode}
            active={compareMode}
          >{compareMode ? 'Exit compare' : 'Compare A/B'}</ToolbarBtn>

          <button
            onClick={runFullSim}
            disabled={running}
            style={{
              marginLeft: 4,
              background: running ? '#6b7888' : 'linear-gradient(135deg, #0F4C75 0%, #0A3558 100%)',
              color: 'white', border: 0, padding: '11px 20px',
              borderRadius: 9, fontSize: 13, fontWeight: 700, cursor: running ? 'wait' : 'pointer',
              letterSpacing: 0.3,
              boxShadow: running ? 'none' : '0 2px 6px rgba(15,76,117,0.25)',
            }}
          >
            {running ? 'Generating report…' : 'Run full simulation  →'}
          </button>
        </div>
      </header>

      {libraryOpen && (
        <ScenarioLibraryModal
          list={savedList}
          activeId={activeScenarioId}
          onClose={() => setLibraryOpen(false)}
          onLoad={(id) => { onLoad(id); setLibraryOpen(false); }}
          onDelete={onDelete}
          onDuplicate={onDuplicate}
          onRename={onRename}
        />
      )}

      {csvOpen && (
        <ImportPropertyCsvModal
          onClose={() => setCsvOpen(false)}
          onImport={async (csvText) => {
            const r = await onImportPropertyCsv(csvText);
            if (r?.error) return r;
            setCsvOpen(false);
            return r;
          }}
        />
      )}
    </>
  );
}

function ToolbarBtn({ children, onClick, title, active, badge }) {
  return (
    <button
      onClick={onClick}
      title={title}
      style={{
        background: active ? '#0F4C75' : 'white',
        color: active ? 'white' : '#1a1d23',
        border: `1px solid ${active ? '#0F4C75' : '#e5e7eb'}`,
        padding: '7px 12px',
        borderRadius: 6,
        fontSize: 12,
        fontWeight: 600,
        cursor: 'pointer',
        display: 'inline-flex', alignItems: 'center', gap: 5,
      }}
    >
      <span>{children}</span>
      {badge != null && badge > 0 && (
        <span style={{
          background: active ? 'rgba(255,255,255,0.3)' : '#ede9fe',
          color: active ? 'white' : '#6d28d9',
          fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 9,
        }}>{badge}</span>
      )}
    </button>
  );
}

// ══════════════════ Scenario library modal ════════════════════════════

function ScenarioLibraryModal({ list, activeId, onClose, onLoad, onDelete, onDuplicate, onRename }) {
  const [filter, setFilter] = useState('');
  const filtered = list.filter((s) =>
    !filter ||
    (s.name || '').toLowerCase().includes(filter.toLowerCase()) ||
    (s.client || '').toLowerCase().includes(filter.toLowerCase())
  );
  return (
    <ModalShell title="Scenario library" subtitle={`${list.length} saved scenario${list.length === 1 ? '' : 's'} in this browser`} onClose={onClose}>
      <input
        type="text"
        placeholder="Filter by name or client…"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        style={{ marginBottom: 12 }}
      />
      {filtered.length === 0 ? (
        <div style={{ padding: 40, textAlign: 'center', color: '#9ca3af', fontSize: 13 }}>
          {list.length === 0 ? 'Todavía no has guardado ningún escenario. Usa Save en la barra superior.' : 'Ningún escenario coincide con el filtro.'}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 440, overflowY: 'auto' }}>
          {filtered.map((s) => (
            <div key={s.id} style={{
              display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px',
              border: `1px solid ${s.id === activeId ? '#0F4C75' : '#e5e7eb'}`,
              background: s.id === activeId ? '#eff6ff' : 'white',
              borderRadius: 7,
            }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: '#0A3558' }}>{s.name}</div>
                <div style={{ fontSize: 11, color: '#6b7888', marginTop: 2 }}>
                  {s.client || '—'} · {s.updatedAt ? new Date(s.updatedAt).toLocaleString() : ''}
                  {s.id === activeId && <span style={{ marginLeft: 8, color: '#0F4C75', fontWeight: 700 }}>· active</span>}
                </div>
              </div>
              <button onClick={() => onLoad(s.id)} style={btnPrimary}>Load</button>
              <button onClick={() => onDuplicate(s.id)} style={btnGhost} title="Duplicate">Duplicate</button>
              <button onClick={() => {
                const n = prompt('New name', s.name);
                if (n && n !== s.name) onRename(s.id, n);
              }} style={btnGhost} title="Rename">Rename</button>
              <button onClick={() => {
                if (confirm(`Delete "${s.name}"? This cannot be undone.`)) onDelete(s.id);
              }} style={btnGhostDanger} title="Delete">Delete</button>
            </div>
          ))}
        </div>
      )}
    </ModalShell>
  );
}

// ══════════════════ CSV property import modal ═════════════════════════

function ImportPropertyCsvModal({ onClose, onImport }) {
  const [csvText, setCsvText] = useState(
    'metric,jan,feb,mar,apr,may,jun,jul,aug,sep,oct,nov,dec\n' +
    'adr,0,0,0,520,680,890,1420,1680,1180,720,0,0\n' +
    'occupancy,0,0,0,62,74,82,91,93,84,68,0,0\n'
  );
  const [result, setResult] = useState(null);
  const fileRef = useRef(null);

  const doImport = async () => {
    const r = await onImport(csvText);
    setResult(r);
  };

  return (
    <ModalShell
      title="Import property from CSV"
      subtitle="Paste or upload a CSV with monthly ADR and occupancy. Auto-detects delimiter (comma, semicolon, tab) and Spanish/English month names."
      onClose={onClose}
    >
      <div style={{ display: 'flex', gap: 10, marginBottom: 10 }}>
        <button onClick={() => fileRef.current?.click()} style={btnGhost}>Upload file…</button>
        <input
          ref={fileRef}
          type="file"
          accept=".csv,text/csv,text/plain"
          style={{ display: 'none' }}
          onChange={async (e) => {
            const f = e.target.files?.[0];
            if (!f) return;
            const text = await f.text();
            setCsvText(text);
            e.target.value = '';
          }}
        />
        <div style={{ flex: 1, fontSize: 11, color: '#6b7888', alignSelf: 'center' }}>
          Or paste the CSV below ↓
        </div>
      </div>
      <textarea
        value={csvText}
        onChange={(e) => setCsvText(e.target.value)}
        rows={10}
        style={{ fontFamily: 'Menlo, monospace', fontSize: 11 }}
      />
      <div style={{ marginTop: 10, display: 'flex', gap: 8 }}>
        <button onClick={doImport} style={btnPrimary}>Import into scenario</button>
        <button onClick={onClose} style={btnGhost}>Cancel</button>
      </div>
      {result?.error && (
        <div style={{ marginTop: 10, padding: 10, background: '#fef2f2', color: '#991b1b', fontSize: 12, borderRadius: 6 }}>
          ⚠ {result.error}
        </div>
      )}
      {result?.ok && (
        <div style={{ marginTop: 10, padding: 10, background: '#ecfdf5', color: '#14532d', fontSize: 12, borderRadius: 6 }}>
          ✓ Propiedad importada. Cierra este modal para ver los meses actualizados.
          {result.warnings?.length > 0 && (
            <ul style={{ margin: '6px 0 0 18px' }}>
              {result.warnings.map((w, i) => <li key={i}>{w}</li>)}
            </ul>
          )}
        </div>
      )}
      <details style={{ marginTop: 14, fontSize: 11, color: '#6b7888' }}>
        <summary style={{ cursor: 'pointer', fontWeight: 600 }}>Formatos aceptados</summary>
        <div style={{ marginTop: 6, lineHeight: 1.6 }}>
          <strong>A. Métrica por fila</strong> (la que viste al abrir):
          <pre style={{ background: '#f6f7f9', padding: 8, borderRadius: 4, fontSize: 10 }}>
metric,jan,feb,...,dec
adr,0,0,...
occupancy,0,0,...
rooms,159
baseline_nps,77</pre>
          <strong>B. Mes por fila</strong>:
          <pre style={{ background: '#f6f7f9', padding: 8, borderRadius: 4, fontSize: 10 }}>
month,adr,occupancy
jan,0,0
feb,0,0
...</pre>
          Acepta decimales con coma o punto, ocupación en 0-1 o 0-100, y meses en ES (enero, feb, jul…) o EN (january, feb, jul…).
        </div>
      </details>
    </ModalShell>
  );
}

// ══════════════════ Shared modal shell + button styles ════════════════

const btnPrimary = {
  background: '#0F4C75', color: 'white', border: 0, padding: '8px 14px',
  borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: 'pointer',
};
const btnGhost = {
  background: 'white', color: '#1a1d23', border: '1px solid #e5e7eb', padding: '7px 12px',
  borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: 'pointer',
};
const btnGhostDanger = {
  background: 'white', color: '#b91c1c', border: '1px solid #fecaca', padding: '7px 10px',
  borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: 'pointer',
};

function ModalShell({ title, subtitle, onClose, children }) {
  return (
    <div className="no-print" style={{
      position: 'fixed', inset: 0, background: 'rgba(10, 13, 20, 0.55)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      zIndex: 1000, backdropFilter: 'blur(3px)', padding: 20,
    }} onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'white', borderRadius: 10, padding: '22px 24px',
          width: '100%', maxWidth: 680, boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
          maxHeight: '90vh', overflowY: 'auto',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'start', justifyContent: 'space-between', marginBottom: 14 }}>
          <div>
            <div style={{ fontSize: 18, fontWeight: 700, color: '#0A3558' }}>{title}</div>
            {subtitle && <div style={{ fontSize: 12, color: '#6b7888', marginTop: 4 }}>{subtitle}</div>}
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 0, fontSize: 22, cursor: 'pointer', color: '#6b7888' }}>×</button>
        </div>
        {children}
      </div>
    </div>
  );
}

// ══════════════════ ExampleBar ════════════════════════════════════════

function ExampleBar({ onLoad }) {
  return (
    <div style={{
      background: 'white', border: '1px solid #e5e7eb', borderRadius: 10,
      padding: '14px 16px', marginBottom: 16,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <div>
          <div style={{ fontSize: 11, letterSpacing: 1.2, textTransform: 'uppercase', color: '#6b7888', fontWeight: 600 }}>
            Starting points
          </div>
          <div style={{ fontSize: 12, color: '#6b7888', marginTop: 2 }}>
            Click to pre-fill the decision below. You can then edit every field freely — nothing is locked.
          </div>
        </div>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {EXAMPLES.map((ex) => (
          <button
            key={ex.key}
            onClick={() => onLoad(ex)}
            style={{
              background: 'white', border: `1px solid ${ex.color}44`, color: ex.color,
              padding: '7px 12px', borderRadius: 20, fontSize: 12, fontWeight: 600,
              cursor: 'pointer', transition: 'all 0.15s',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = ex.color; e.currentTarget.style.color = 'white'; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'white'; e.currentTarget.style.color = ex.color; }}
          >
            {ex.label}
          </button>
        ))}
      </div>
    </div>
  );
}

// ══════════════════ DecisionBox ═══════════════════════════════════════

function DecisionBox({ decision, setDecision, updateDecision }) {
  return (
    <div style={{
      background: 'white', border: '1px solid #dbe3ec',
      borderTop: '3px solid #0F4C75', borderRadius: 12,
      padding: '22px 22px', marginBottom: 16,
      boxShadow: '0 3px 10px rgba(15,76,117,0.06)',
    }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontSize: 10, letterSpacing: 1.3, textTransform: 'uppercase', color: '#64748b', fontWeight: 700, marginBottom: 2 }}>
            Decision
          </div>
          <h3 style={{ margin: 0, fontSize: 18, fontWeight: 800, color: '#0A3558', letterSpacing: -0.2 }}>
            Define what to validate
          </h3>
        </div>
        <span style={{ fontSize: 11, color: '#64748b', fontStyle: 'italic', marginLeft: 'auto' }}>
          Write any decision — no preset scenarios
        </span>
      </div>

      {/* Type selector */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 8, marginBottom: 18 }}>
        {DECISION_TYPES.map((t) => {
          const active = decision.type === t.id;
          return (
            <button
              key={t.id}
              onClick={() => setDecision({ type: t.id, ...defaultFieldsForType(t.id) })}
              style={{
                background: active ? t.color : 'white',
                color: active ? 'white' : '#1a1d23',
                border: `1px solid ${active ? t.color : '#dbe3ec'}`,
                padding: '14px 8px', borderRadius: 10, cursor: 'pointer',
                fontSize: 12, fontWeight: active ? 700 : 600,
                display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 7,
                transition: 'all 0.12s',
                boxShadow: active ? `0 4px 10px ${t.color}33` : 'none',
              }}
            >
              <span style={{
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                width: 30, height: 30, borderRadius: 8,
                background: active ? 'rgba(255,255,255,0.18)' : `${t.color}12`,
                color: active ? 'white' : t.color,
                fontSize: 11, fontWeight: 800, letterSpacing: 0.8,
                border: active ? '1px solid rgba(255,255,255,0.25)' : `1px solid ${t.color}33`,
              }}>{t.code}</span>
              <span>{t.label}</span>
            </button>
          );
        })}
      </div>

      {/* Type-specific fields */}
      <DecisionFields decision={decision} updateDecision={updateDecision} />
    </div>
  );
}

function defaultFieldsForType(type) {
  switch (type) {
    case 'rate_change': return { magnitude_pct: 10, timing: 'peak', scope: { type: 'all' } };
    case 'package_change': return { inclusions_added: [], inclusions_removed: [], price_delta_eur: 0, timing: 'all' };
    case 'service_intervention': return { moment: 'day_2', intervention: 'butler + handwritten note', target_archetype: 'honeymooner', cost_per_stay_eur: 35, timing: 'all' };
    case 'staff_change': return { department: 'fb', ratio_delta_pct: -10, timing: 'all' };
    case 'loyalty': return { tier: 'gold', benefit: 'upgrade_free', cost_per_member_eur: 120, membership_pct_of_guests: 18 };
    case 'promo': return { discount_pct: 15, channel: 'direct', timing: 'shoulder', target_cluster: null };
    default: return {};
  }
}

function DecisionFields({ decision, updateDecision }) {
  const d = decision;
  const gridStyle = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginTop: 4 };

  if (d.type === 'rate_change') {
    return (
      <div style={gridStyle}>
        <Field label="Magnitude (%)">
          <input type="number" value={d.magnitude_pct ?? 0} step={1} onChange={(e) => updateDecision({ magnitude_pct: Number(e.target.value) })} />
          <div style={{ fontSize: 10, color: '#6b7888', marginTop: 4 }}>
            Positive = raise rate · Negative = lower rate
          </div>
        </Field>
        <Field label="Timing">
          <TimingSelect value={d.timing} onChange={(v) => updateDecision({ timing: v })} />
        </Field>
        <ScopeField scope={d.scope} onChange={(scope) => updateDecision({ scope })} />
      </div>
    );
  }

  if (d.type === 'package_change') {
    const added = (d.inclusions_added || []).join(', ');
    const removed = (d.inclusions_removed || []).join(', ');
    return (
      <div style={gridStyle}>
        <Field label="Inclusions added (comma-separated)">
          <input type="text" placeholder="spa credit, breakfast, airport transfer" value={added}
            onChange={(e) => updateDecision({ inclusions_added: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })} />
        </Field>
        <Field label="Inclusions removed">
          <input type="text" placeholder="resort fee, minibar" value={removed}
            onChange={(e) => updateDecision({ inclusions_removed: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })} />
        </Field>
        <Field label="Price delta (€)">
          <input type="number" value={d.price_delta_eur ?? 0} onChange={(e) => updateDecision({ price_delta_eur: Number(e.target.value) })} />
          <div style={{ fontSize: 10, color: '#6b7888', marginTop: 4 }}>+ if price goes up, − if down</div>
        </Field>
        <Field label="Timing">
          <TimingSelect value={d.timing} onChange={(v) => updateDecision({ timing: v })} />
        </Field>
      </div>
    );
  }

  if (d.type === 'service_intervention') {
    return (
      <div style={gridStyle}>
        <Field label="Moment of stay">
          <select value={d.moment} onChange={(e) => updateDecision({ moment: e.target.value })}>
            <option value="arrival">Arrival</option>
            <option value="day_1">Day 1</option>
            <option value="day_2">Day 2</option>
            <option value="day_3">Day 3</option>
            <option value="checkout">Checkout</option>
          </select>
        </Field>
        <Field label="Intervention (free text)">
          <input type="text" value={d.intervention || ''} placeholder="butler + handwritten note"
            onChange={(e) => updateDecision({ intervention: e.target.value })} />
        </Field>
        <Field label="Target archetype">
          <ArchetypeSelect value={d.target_archetype} onChange={(v) => updateDecision({ target_archetype: v })} />
        </Field>
        <Field label="Cost per stay (€)">
          <input type="number" value={d.cost_per_stay_eur ?? 0}
            onChange={(e) => updateDecision({ cost_per_stay_eur: Number(e.target.value) })} />
        </Field>
      </div>
    );
  }

  if (d.type === 'staff_change') {
    return (
      <div style={gridStyle}>
        <Field label="Department">
          <select value={d.department} onChange={(e) => updateDecision({ department: e.target.value })}>
            <option value="fb">F&B</option>
            <option value="housekeeping">Housekeeping</option>
            <option value="front_desk">Front desk</option>
            <option value="spa">Spa</option>
          </select>
        </Field>
        <Field label="Staff ratio delta (%)">
          <input type="number" value={d.ratio_delta_pct ?? 0}
            onChange={(e) => updateDecision({ ratio_delta_pct: Number(e.target.value) })} />
          <div style={{ fontSize: 10, color: '#6b7888', marginTop: 4 }}>− cuts staff (saves labour) · + adds staff</div>
        </Field>
        <Field label="Annual saving € (optional, auto if blank)">
          <input type="number" value={d.annual_saving_eur ?? ''} placeholder="auto-computed"
            onChange={(e) => updateDecision({ annual_saving_eur: e.target.value === '' ? null : Number(e.target.value) })} />
        </Field>
        <Field label="Timing">
          <TimingSelect value={d.timing} onChange={(v) => updateDecision({ timing: v })} />
        </Field>
      </div>
    );
  }

  if (d.type === 'loyalty') {
    return (
      <div style={gridStyle}>
        <Field label="Tier targeted">
          <select value={d.tier} onChange={(e) => updateDecision({ tier: e.target.value })}>
            <option value="silver">Silver</option>
            <option value="gold">Gold</option>
            <option value="platinum">Platinum</option>
            <option value="ambassador">Ambassador</option>
          </select>
        </Field>
        <Field label="Benefit (free text)">
          <input type="text" value={d.benefit || ''} placeholder="upgrade_free, lounge_access, dining_credit"
            onChange={(e) => updateDecision({ benefit: e.target.value })} />
        </Field>
        <Field label="Cost per member (€)">
          <input type="number" value={d.cost_per_member_eur ?? 0}
            onChange={(e) => updateDecision({ cost_per_member_eur: Number(e.target.value) })} />
        </Field>
        <Field label="Members as % of guests">
          <input type="number" value={d.membership_pct_of_guests ?? 0} step={1}
            onChange={(e) => updateDecision({ membership_pct_of_guests: Number(e.target.value) })} />
        </Field>
      </div>
    );
  }

  if (d.type === 'promo') {
    return (
      <div style={gridStyle}>
        <Field label="Discount (%)">
          <input type="number" value={d.discount_pct ?? 0}
            onChange={(e) => updateDecision({ discount_pct: Number(e.target.value) })} />
        </Field>
        <Field label="Channel">
          <select value={d.channel} onChange={(e) => updateDecision({ channel: e.target.value })}>
            <option value="direct">Direct</option>
            <option value="ota">OTA</option>
            <option value="email">Email</option>
            <option value="wholesale">Wholesale / bedbank</option>
          </select>
        </Field>
        <Field label="Timing">
          <TimingSelect value={d.timing} onChange={(v) => updateDecision({ timing: v })} />
        </Field>
        <Field label="Target cluster (optional)">
          <ClusterSelect value={d.target_cluster} onChange={(v) => updateDecision({ target_cluster: v })} includeNone />
        </Field>
      </div>
    );
  }

  return null;
}

function Field({ label, children }) {
  return (
    <div>
      <label>{label}</label>
      <div style={{ marginTop: 4 }}>{children}</div>
    </div>
  );
}

function TimingSelect({ value, onChange }) {
  return (
    <select value={value || 'all'} onChange={(e) => onChange(e.target.value)}>
      <option value="peak">Peak (Jul–Aug)</option>
      <option value="shoulder">Shoulder (May–Jun, Sep)</option>
      <option value="off">Off-peak (Apr, Oct)</option>
      <option value="all">All season</option>
    </select>
  );
}

function ArchetypeSelect({ value, onChange }) {
  return (
    <select value={value || ''} onChange={(e) => onChange(e.target.value)}>
      {ARCHETYPES.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
    </select>
  );
}

function ClusterSelect({ value, onChange, includeNone }) {
  return (
    <select value={value || ''} onChange={(e) => onChange(e.target.value || null)}>
      {includeNone && <option value="">— all clusters —</option>}
      {CLUSTERS.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
    </select>
  );
}

function ScopeField({ scope, onChange }) {
  const [mode, setMode] = useState(scope?.type || 'all');
  const handle = (nextMode, value) => {
    setMode(nextMode);
    if (nextMode === 'all') onChange({ type: 'all' });
    else onChange({ type: nextMode, value });
  };
  return (
    <div style={{ gridColumn: '1 / -1', padding: '10px 12px', background: '#f6f7f9', borderRadius: 6 }}>
      <label>Who does this apply to?</label>
      <div style={{ display: 'flex', gap: 14, marginTop: 6, alignItems: 'center' }}>
        <RadioPill active={mode === 'all'} onClick={() => handle('all')}>All guests</RadioPill>
        <RadioPill active={mode === 'archetype'} onClick={() => handle('archetype', scope.value || 'luxury_seeker')}>Specific archetype</RadioPill>
        <RadioPill active={mode === 'cluster'} onClick={() => handle('cluster', scope.value || 'anglo_uk_ireland')}>Specific cluster</RadioPill>
        {mode === 'archetype' && (
          <select value={scope.value || 'luxury_seeker'} onChange={(e) => handle('archetype', e.target.value)} style={{ width: 200 }}>
            {ARCHETYPES.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
          </select>
        )}
        {mode === 'cluster' && (
          <select value={scope.value || 'anglo_uk_ireland'} onChange={(e) => handle('cluster', e.target.value)} style={{ width: 200 }}>
            {CLUSTERS.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
          </select>
        )}
      </div>
    </div>
  );
}

function RadioPill({ active, onClick, children }) {
  return (
    <button onClick={onClick} style={{
      background: active ? '#0F4C75' : 'white',
      color: active ? 'white' : '#1a1d23',
      border: `1px solid ${active ? '#0F4C75' : '#e5e7eb'}`,
      padding: '5px 11px', borderRadius: 18, fontSize: 12, fontWeight: active ? 700 : 500,
      cursor: 'pointer',
    }}>{children}</button>
  );
}

// ══════════════════ PropertyContext ═══════════════════════════════════

function PropertyContext({ property, updateProperty, updateAdr, updateOcc }) {
  const [collapsed, setCollapsed] = useState(false);
  return (
    <div style={{
      background: 'white', border: '1px solid #e5e7eb', borderRadius: 10,
      padding: '16px 20px', marginBottom: 16,
    }}>
      <SectionHeader title="Property context" tag="PROP" collapsed={collapsed} onToggle={() => setCollapsed((c) => !c)} />
      {!collapsed && (
        <>
          <div style={{ marginTop: 14 }}>
            <label>ADR curve (€/night) — click a number to edit</label>
            <SparklineEditor values={property.adr_curve_monthly} onChange={updateAdr} suffix="€" />
          </div>

          <div style={{ marginTop: 16 }}>
            <label>Occupancy curve (%)</label>
            <SparklineEditor values={property.occupancy_curve_monthly} onChange={updateOcc} suffix="%" max={100} />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginTop: 14 }}>
            <Field label="Rooms">
              <input type="number" value={property.rooms} onChange={(e) => updateProperty({ rooms: Number(e.target.value) })} />
            </Field>
            <Field label="Baseline NPS">
              <input type="number" value={property.baseline_nps} onChange={(e) => updateProperty({ baseline_nps: Number(e.target.value) })} />
            </Field>
            <Field label="Baseline star">
              <input type="number" step={0.01} value={property.baseline_star} onChange={(e) => updateProperty({ baseline_star: Number(e.target.value) })} />
            </Field>
            <Field label="Avg occupancy %">
              <input type="number" value={property.baseline_occupancy_pct} onChange={(e) => updateProperty({ baseline_occupancy_pct: Number(e.target.value) })} />
            </Field>
          </div>
        </>
      )}
    </div>
  );
}

function SparklineEditor({ values, onChange, suffix = '', max = null }) {
  const arr = MONTHS.map((m) => Number(values[m] || 0));
  const effectiveMax = max || Math.max(...arr, 1) * 1.05;
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(12, 1fr)', gap: 4, marginTop: 6 }}>
      {MONTHS.map((m, i) => {
        const v = arr[i];
        const barH = effectiveMax > 0 ? (v / effectiveMax) * 48 : 0;
        return (
          <div key={m} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <div style={{
              width: '100%', height: 48, background: '#f6f7f9',
              borderRadius: 3, position: 'relative', overflow: 'hidden',
            }}>
              <div style={{
                position: 'absolute', bottom: 0, left: 0, right: 0,
                height: barH, background: '#0F4C75', opacity: 0.65,
              }} />
            </div>
            <input
              type="number"
              value={v}
              onChange={(e) => onChange(m, e.target.value)}
              style={{
                width: '100%', padding: '3px 2px', fontSize: 10, textAlign: 'center',
                border: '1px solid #e5e7eb', borderRadius: 3, marginTop: 2,
              }}
            />
            <div style={{ fontSize: 9, color: '#6b7888', marginTop: 2 }}>{MONTH_LABELS[i]}</div>
          </div>
        );
      })}
    </div>
  );
}

function SectionHeader({ title, icon, tag, collapsed, onToggle }) {
  // `icon` is kept for back-compat but no longer rendered as an emoji.
  // Callers may pass `tag` (2-3 uppercase letters) for a small monochrome pill.
  return (
    <div
      style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: onToggle ? 'pointer' : 'default' }}
      onClick={onToggle}
    >
      {tag && (
        <span style={{
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          minWidth: 34, height: 22, padding: '0 8px', borderRadius: 6,
          background: '#eef2f7', border: '1px solid #dbe3ec',
          fontSize: 10, fontWeight: 800, letterSpacing: 1, color: '#334155',
        }}>{tag}</span>
      )}
      <h3 className="section-title" style={{ margin: 0, flex: 1 }}>{title}</h3>
      {onToggle && <span style={{ fontSize: 13, color: '#6b7888', transform: collapsed ? 'rotate(-90deg)' : 'none', transition: 'transform 0.15s' }}>▾</span>}
    </div>
  );
}

// ══════════════════ AudienceBlock ═════════════════════════════════════

function AudienceBlock({ audience, updateArchetypeMix, updateClusterMix }) {
  const [collapsed, setCollapsed] = useState(false);
  const archTotal = useMemo(() => Object.values(audience.archetype_mix).reduce((s, v) => s + Number(v || 0), 0), [audience.archetype_mix]);
  const clusterTotal = useMemo(() => Object.values(audience.cultural_mix).reduce((s, v) => s + Number(v || 0), 0), [audience.cultural_mix]);

  return (
    <div style={{
      background: 'white', border: '1px solid #e5e7eb', borderRadius: 10,
      padding: '16px 20px', marginBottom: 16,
    }}>
      <SectionHeader title="Audience composition" tag="AUD" collapsed={collapsed} onToggle={() => setCollapsed((c) => !c)} />
      {!collapsed && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginTop: 14 }}>
          <MixEditor title="Archetype mix" items={ARCHETYPES} values={audience.archetype_mix} total={archTotal} onChange={updateArchetypeMix} />
          <MixEditor title="Cultural cluster mix" items={CLUSTERS} values={audience.cultural_mix} total={clusterTotal} onChange={updateClusterMix} />
        </div>
      )}
    </div>
  );
}

// ══════════════════ PositioningCard ═══════════════════════════════════
//
// Blind against "are you competing with Duetto / IDeaS?" It sits at the top
// of the editor and spells out explicitly what this tool IS and what it
// ISN'T. Consultants can point to it in a client meeting to set scope.

function PositioningCard() {
  const [open, setOpen] = useState(true);
  return (
    <div style={{
      background: 'linear-gradient(100deg, #eef2ff 0%, #f5f3ff 100%)',
      border: '1px solid #c7d2fe',
      borderRadius: 10,
      padding: '14px 18px',
      marginTop: 16,
      display: 'flex', alignItems: 'center', gap: 16,
    }}>
      <div style={{
        width: 38, height: 38, borderRadius: 9, background: '#4338ca', color: 'white',
        display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
        fontSize: 11, fontWeight: 800, letterSpacing: 1, border: '1px solid rgba(255,255,255,0.15)',
      }}>SCOPE</div>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 10, letterSpacing: 1.4, textTransform: 'uppercase', color: '#4338ca', fontWeight: 700 }}>
          What this tool is — and isn't
        </div>
        <div style={{ fontSize: 14, color: '#1e1b4b', marginTop: 4, fontWeight: 600 }}>
          Pre-decision validation for consultants. Not a daily-pricing RMS.
        </div>
        {open && (
          <div style={{ marginTop: 10, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, fontSize: 12, color: '#312e81' }}>
            <div>
              <div style={{ fontWeight: 700, color: '#15803d', marginBottom: 2 }}>✓ What we do</div>
              <ul style={{ margin: 0, paddingLeft: 16, lineHeight: 1.55 }}>
                <li>Simulate a specific decision against synthetic guests</li>
                <li>Surface Net-LTV, ΔNPS, review tier forecast, complaints</li>
                <li>Stress-test competitor reactions (game theory matrix)</li>
                <li>Provide the "why" behind the number (explainability)</li>
              </ul>
            </div>
            <div>
              <div style={{ fontWeight: 700, color: '#b91c1c', marginBottom: 2 }}>✗ What we don't do</div>
              <ul style={{ margin: 0, paddingLeft: 16, lineHeight: 1.55 }}>
                <li>Daily pricing recommendations (that's Duetto / IDeaS)</li>
                <li>Pickup pace / booking curve tracking (that's the PMS)</li>
                <li>Real-time inventory or rate shop (that's the CRS)</li>
                <li>Replace a revenue manager — we assist their pre-decision work</li>
              </ul>
            </div>
          </div>
        )}
      </div>
      <button
        onClick={() => setOpen((o) => !o)}
        style={{
          background: 'white', border: '1px solid #c7d2fe', color: '#4338ca',
          padding: '5px 10px', borderRadius: 6, cursor: 'pointer', fontSize: 11, fontWeight: 600,
        }}
      >
        {open ? 'Hide' : 'Show'}
      </button>
    </div>
  );
}

// ══════════════════ CalibrationPanel ══════════════════════════════════
//
// Exposes the two most consequential coefficient groups to the consultant:
//  - Per-archetype comparison sensitivity (how much a price gap with
//    the comp-set shifts bookings for each traveler type)
//  - Per-cluster book_delta (cultural booking propensity modifier)
//
// Each knob carries a provenance badge — peer-reviewed, EGATUR-anchored,
// or expert-inference — so the consultant knows which coefficients are
// safer to tune. Changes propagate live into the preview, sensitivity
// curve, and competitor matrix.

function CalibrationBadge({ tag }) {
  const styles = {
    'peer-reviewed':    { bg: '#dcfce7', color: '#15803d', label: 'peer-reviewed' },
    'EGATUR-anchored':  { bg: '#dbeafe', color: '#1d4ed8', label: 'EGATUR-anchored' },
    'expert-inference': { bg: '#fef3c7', color: '#a16207', label: 'expert-inference' },
    'baseline':         { bg: '#f3f4f6', color: '#4b5563', label: 'baseline' },
  };
  const s = styles[tag] || styles.baseline;
  return (
    <span style={{
      display: 'inline-block', fontSize: 9, fontWeight: 700, letterSpacing: 0.3,
      padding: '2px 6px', borderRadius: 4, background: s.bg, color: s.color,
      textTransform: 'uppercase',
    }}>{s.label}</span>
  );
}

function CalibrationSlider({ id, label, provenance, defaultValue, overrideValue, min, max, step, unit, onChange, onReset }) {
  const current = overrideValue ?? defaultValue;
  const isOverride = overrideValue != null;
  return (
    <div style={{
      display: 'grid', gridTemplateColumns: '150px 1fr 90px 22px', gap: 10,
      alignItems: 'center', padding: '6px 0',
      borderBottom: '1px solid #f3f4f6',
    }}>
      <div>
        <div style={{ fontSize: 12, color: '#1a1d23', fontWeight: isOverride ? 700 : 500 }}>{label}</div>
        <div style={{ marginTop: 2, display: 'flex', gap: 4, alignItems: 'center', flexWrap: 'wrap' }}>
          <CalibrationBadge tag={provenance?.tag || 'expert-inference'} />
          <span style={{ fontSize: 9, color: '#9ca3af' }}>{provenance?.label}</span>
        </div>
      </div>
      <input
        type="range"
        min={min} max={max} step={step}
        value={current}
        onChange={(e) => onChange(id, e.target.value)}
        style={{ accentColor: isOverride ? '#7c3aed' : '#0F4C75' }}
      />
      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        <input
          type="number"
          value={current}
          step={step}
          onChange={(e) => onChange(id, e.target.value)}
          style={{
            width: 66, padding: '4px 6px', fontSize: 12, textAlign: 'right',
            border: isOverride ? '1px solid #7c3aed' : '1px solid #d1d5db',
            background: isOverride ? '#faf5ff' : 'white',
          }}
        />
        <span style={{ fontSize: 10, color: '#6b7888' }}>{unit}</span>
      </div>
      <button
        onClick={() => onReset(id)}
        disabled={!isOverride}
        title={isOverride ? `Reset to default (${defaultValue})` : 'At default'}
        style={{
          background: 'none', border: 'none', cursor: isOverride ? 'pointer' : 'default',
          opacity: isOverride ? 1 : 0.25, padding: 0, fontSize: 13, color: '#6b7888',
        }}
      >↺</button>
    </div>
  );
}

function CalibrationPanel({ calibration, updateCalibration, resetCalibrationGroup, resetAllCalibration }) {
  const [collapsed, setCollapsed] = useState(true);
  const cmpOverrides = calibration?.archetype_comparison_sensitivity || {};
  const bookOverrides = calibration?.cluster_book_delta || {};
  const overrideCount = Object.keys(cmpOverrides).length + Object.keys(bookOverrides).length;

  const onCmpChange = (id, v) => updateCalibration('archetype_comparison_sensitivity', id, v);
  const onCmpReset = (id) => updateCalibration('archetype_comparison_sensitivity', id, null);
  const onBookChange = (id, v) => updateCalibration('cluster_book_delta', id, v);
  const onBookReset = (id) => updateCalibration('cluster_book_delta', id, null);

  return (
    <div style={{
      background: 'white', border: '1px solid #e5e7eb', borderRadius: 10,
      padding: '16px 20px', marginBottom: 16,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <SectionHeader
          title="Calibration"
          tag="CAL"
          collapsed={collapsed}
          onToggle={() => setCollapsed((c) => !c)}
        />
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {overrideCount > 0 && (
            <span style={{
              fontSize: 10, fontWeight: 700, padding: '3px 8px', borderRadius: 10,
              background: '#ede9fe', color: '#6d28d9', letterSpacing: 0.3, textTransform: 'uppercase',
            }}>
              {overrideCount} override{overrideCount > 1 ? 's' : ''}
            </span>
          )}
          {overrideCount > 0 && (
            <button
              onClick={resetAllCalibration}
              style={{
                background: 'white', border: '1px solid #e5e7eb', color: '#6b7888',
                padding: '4px 10px', borderRadius: 6, cursor: 'pointer', fontSize: 11, fontWeight: 600,
              }}
            >Reset all</button>
          )}
        </div>
      </div>

      {!collapsed && (
        <>
          <div style={{
            marginTop: 10, padding: '10px 12px', background: '#faf5ff',
            border: '1px solid #e9d5ff', borderRadius: 6, fontSize: 12, color: '#4c1d95',
            lineHeight: 1.55,
          }}>
            <strong>Consultant-tunable coefficients.</strong> Values are anchored to public
            benchmarks (Cornell HQ, INE EGATUR 2024, Vives &amp; Jacob 2023) but are
            <em> intended </em> to be adjusted for a specific property. Every override
            flows live into the preview, sensitivity curve and competitor matrix.
          </div>

          {/* Group 1 — comparison sensitivity */}
          <div style={{ marginTop: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 700, color: '#0A3558' }}>Price-gap sensitivity per archetype</div>
                <div style={{ fontSize: 11, color: '#6b7888', marginTop: 2 }}>
                  How much a 10% price gap with the comp-set shifts bookings. Higher = more defection.
                </div>
              </div>
              {Object.keys(cmpOverrides).length > 0 && (
                <button
                  onClick={() => resetCalibrationGroup('archetype_comparison_sensitivity')}
                  style={{ background: 'none', border: 'none', color: '#6b7888', cursor: 'pointer', fontSize: 11 }}
                >Reset group</button>
              )}
            </div>
            <div style={{ marginTop: 8 }}>
              {Object.entries(CALIBRATION_DEFAULTS.archetype_comparison_sensitivity).map(([id, def]) => (
                <CalibrationSlider
                  key={id}
                  id={id}
                  label={ARCHETYPE_LABELS[id] || id}
                  provenance={CALIBRATION_PROVENANCE.archetype_comparison_sensitivity[id]}
                  defaultValue={def}
                  overrideValue={cmpOverrides[id]}
                  min={0} max={3.5} step={0.05} unit="σ"
                  onChange={onCmpChange}
                  onReset={onCmpReset}
                />
              ))}
            </div>
          </div>

          {/* Group 2 — cluster book_delta */}
          <div style={{ marginTop: 20 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 700, color: '#0A3558' }}>Booking propensity per cultural cluster</div>
                <div style={{ fontSize: 11, color: '#6b7888', marginTop: 2 }}>
                  Intrinsic booking bias vs. UK&amp;IE baseline. Moves the cultural-cushion term in computeRateChange.
                </div>
              </div>
              {Object.keys(bookOverrides).length > 0 && (
                <button
                  onClick={() => resetCalibrationGroup('cluster_book_delta')}
                  style={{ background: 'none', border: 'none', color: '#6b7888', cursor: 'pointer', fontSize: 11 }}
                >Reset group</button>
              )}
            </div>
            <div style={{ marginTop: 8 }}>
              {Object.entries(CALIBRATION_DEFAULTS.cluster_book_delta).map(([id, def]) => (
                <CalibrationSlider
                  key={id}
                  id={id}
                  label={CLUSTER_LABELS[id] || id}
                  provenance={CALIBRATION_PROVENANCE.cluster_book_delta[id]}
                  defaultValue={def}
                  overrideValue={bookOverrides[id]}
                  min={-0.15} max={0.15} step={0.005} unit="Δ"
                  onChange={onBookChange}
                  onReset={onBookReset}
                />
              ))}
            </div>
          </div>

          <div style={{
            marginTop: 16, padding: '10px 12px', background: '#f9fafb',
            border: '1px dashed #e5e7eb', borderRadius: 6, fontSize: 11, color: '#6b7888', lineHeight: 1.55,
          }}>
            <strong style={{ color: '#374151' }}>Badge legend.</strong>&nbsp;
            <CalibrationBadge tag="peer-reviewed" /> = anchored to a published study;&nbsp;
            <CalibrationBadge tag="EGATUR-anchored" /> = derived from INE&apos;s EGATUR spending panel;&nbsp;
            <CalibrationBadge tag="expert-inference" /> = team default, safest to tune.
          </div>
        </>
      )}
    </div>
  );
}

function MixEditor({ title, items, values, total, onChange }) {
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <label>{title}</label>
        <span style={{ fontSize: 11, color: Math.abs(total - 100) > 1 ? '#b91c1c' : '#0a8754', fontWeight: 600 }}>
          Total: {total.toFixed(0)}%
        </span>
      </div>
      <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
        {items.map((it) => {
          const v = Number(values[it.id] || 0);
          return (
            <div key={it.id} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ width: 8, height: 8, borderRadius: 4, background: it.color }} />
              <span style={{ flex: 1, fontSize: 12 }}>{it.label}</span>
              <div style={{ width: 80, height: 6, background: '#f0f1f4', borderRadius: 3, overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${Math.min(100, v)}%`, background: it.color }} />
              </div>
              <input
                type="number"
                value={v}
                onChange={(e) => onChange(it.id, e.target.value)}
                style={{ width: 60, padding: '3px 6px', fontSize: 12, textAlign: 'right' }}
              />
              <span style={{ fontSize: 11, color: '#6b7888', width: 12 }}>%</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ══════════════════ LivePreview ═══════════════════════════════════════

function LivePreview({ scenario, preview, loading, error, decision, onRunFull, running }) {
  const verdict = preview?.verdict || 'PROCEED';
  const verdictColor = verdictToColor(verdict);
  const verdictBg = verdictToBg(verdict);
  const fmtEur = (n) => {
    if (n == null) return '—';
    const sign = n >= 0 ? '+' : '−';
    const abs = Math.abs(n);
    if (abs >= 1_000_000) return `${sign}€${(abs / 1_000_000).toFixed(2)}M`;
    if (abs >= 1_000) return `${sign}€${(abs / 1_000).toFixed(0)}K`;
    return `${sign}€${abs}`;
  };

  // ── Explainability modal ───────────────────────────────────────────
  const [explainOpen, setExplainOpen] = useState(false);

  return (
    <div style={{ position: 'sticky', top: 20 }}>
      <div style={{
        background: 'white', border: '1px solid #e5e7eb', borderRadius: 10,
        overflow: 'hidden', boxShadow: '0 4px 14px rgba(0,0,0,0.06)',
      }}>
        {/* Header */}
        <div style={{
          background: verdictBg,
          padding: '18px 20px', borderBottom: `1px solid ${verdictColor}33`,
          position: 'relative',
        }}>
          <div style={{ fontSize: 10, letterSpacing: 1.4, textTransform: 'uppercase', color: '#6b7888', fontWeight: 700 }}>
            Live impact preview
          </div>
          <div style={{ fontSize: 22, fontWeight: 800, color: verdictColor, marginTop: 6, letterSpacing: -0.3 }}>
            {verdict.replace('_', ' ')}
          </div>
          <div style={{ fontSize: 11, color: '#6b7888', marginTop: 4 }}>
            {loading ? 'recomputing…' : error ? `error: ${error}` : `updated ${preview?.elapsed_ms ?? 0}ms`}
          </div>
          {loading && <div style={{
            position: 'absolute', bottom: 0, left: 0, right: 0, height: 2,
            background: `linear-gradient(90deg, transparent, ${verdictColor}, transparent)`,
            backgroundSize: '200% 100%', animation: 'shimmer 1s infinite',
          }} />}
        </div>

        {/* Big numbers — Net LTV is clickable to open explain */}
        <div style={{ padding: '16px 20px', borderBottom: '1px solid #f0f1f4' }}>
          <NumberBlock label="Short-term" value={fmtEur(preview?.short_term_eur)} sub={preview?.short_term_label || 'direct impact'} color={(preview?.short_term_eur ?? 0) >= 0 ? '#0a8754' : '#b91c1c'} />
          <NumberBlock label="Long-term (LTV)" value={fmtEur(preview?.long_term_eur)} sub={preview?.long_term_label || '3-year horizon'} color={(preview?.long_term_eur ?? 0) >= 0 ? '#0a8754' : '#b91c1c'} />
          <div style={{ borderTop: '2px solid #1a1d23', marginTop: 10, paddingTop: 10, position: 'relative' }}>
            <div onClick={() => preview?.explain && setExplainOpen(true)} style={{ cursor: preview?.explain ? 'pointer' : 'default' }}>
              <NumberBlock label="Net LTV impact" value={fmtEur(preview?.net_eur)} sub={preview?.explain ? 'click to see math breakdown →' : null} color={(preview?.net_eur ?? 0) >= 0 ? '#0a8754' : '#b91c1c'} big />
            </div>
          </div>
        </div>

        {/* NPS + metrics */}
        <div style={{ padding: '14px 20px', borderBottom: '1px solid #f0f1f4', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
          <MetricMini label="Δ NPS" value={preview?.nps_delta != null ? `${preview.nps_delta >= 0 ? '+' : ''}${preview.nps_delta.toFixed(1)}` : '—'} color={(preview?.nps_delta ?? 0) >= 0 ? '#0a8754' : '#b91c1c'} />
          <MetricMini label="Booking Δ" value={preview?.booking_delta_pct != null ? `${preview.booking_delta_pct >= 0 ? '+' : ''}${preview.booking_delta_pct.toFixed(1)}%` : '—'} color={(preview?.booking_delta_pct ?? 0) >= 0 ? '#0a8754' : '#b91c1c'} />
        </div>


        {/* Complaints */}
        {preview?.complaints?.length > 0 && (
          <div style={{ padding: '14px 20px', borderBottom: '1px solid #f0f1f4' }}>
            <div style={{ fontSize: 10, letterSpacing: 1.2, textTransform: 'uppercase', color: '#6b7888', fontWeight: 700, marginBottom: 8 }}>
              Anticipated complaints
            </div>
            <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12, color: '#374151', lineHeight: 1.5 }}>
              {preview.complaints.map((c, i) => <li key={i} style={{ marginBottom: 2 }}>{c}</li>)}
            </ul>
          </div>
        )}

        {/* CTA */}
        <div style={{ padding: '16px 20px' }}>
          <button
            onClick={onRunFull}
            disabled={running}
            style={{
              width: '100%', background: running ? '#6b7888' : '#0F4C75',
              color: 'white', border: 0, padding: '13px 16px', borderRadius: 8,
              fontSize: 13, fontWeight: 700, cursor: running ? 'wait' : 'pointer',
              letterSpacing: 0.5,
            }}
          >
            {running ? 'Generating report…' : 'Run full simulation + generate report'}
          </button>
          <div style={{ fontSize: 10, color: '#6b7888', marginTop: 6, textAlign: 'center' }}>
            full sim = n=1000 agents · 4 independent backtests · 60s · redirects to /validation
          </div>
        </div>
      </div>

      {/* Baseline reference */}
      {preview?.baseline_annual_revenue_eur && (
        <div style={{ marginTop: 10, padding: '10px 14px', background: '#f6f7f9', borderRadius: 8, fontSize: 11, color: '#6b7888' }}>
          Baseline annual revenue: <strong style={{ color: '#1a1d23' }}>€{(preview.baseline_annual_revenue_eur / 1_000_000).toFixed(2)}M</strong>
          <br />
          Net LTV is relative to this baseline — what the decision adds or destroys vs not acting.
        </div>
      )}

      <style jsx>{`
        @keyframes shimmer {
          0% { background-position: -200% 0; }
          100% { background-position: 200% 0; }
        }
      `}</style>

      {/* Explainability modal */}
      {explainOpen && preview?.explain && (
        <ExplainModal explain={preview.explain} onClose={() => setExplainOpen(false)} />
      )}
    </div>
  );
}

function NumberBlock({ label, value, sub, color, big }) {
  return (
    <div style={{ marginBottom: big ? 0 : 10 }}>
      <div style={{ fontSize: 10, letterSpacing: 1.2, textTransform: 'uppercase', color: '#6b7888', fontWeight: 600 }}>
        {label}
      </div>
      <div style={{ fontSize: big ? 30 : 22, fontWeight: 800, color, marginTop: 2, letterSpacing: -0.3 }}>
        {value}
      </div>
      {sub && <div style={{ fontSize: 10, color: '#6b7888', marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

function MetricMini({ label, value, color }) {
  return (
    <div>
      <div style={{ fontSize: 10, letterSpacing: 1.2, textTransform: 'uppercase', color: '#6b7888', fontWeight: 600 }}>
        {label}
      </div>
      <div style={{ fontSize: 18, fontWeight: 700, color, marginTop: 2 }}>{value}</div>
    </div>
  );
}

function verdictToColor(v) {
  switch (v) {
    case 'HIGH_PRIORITY': return '#0a8754';
    case 'PROCEED':       return '#2a7a52';
    case 'CAUTION':       return '#b45309';
    case 'NOT_RECOMMENDED': return '#b91c1c';
    default: return '#6b7888';
  }
}

function verdictToBg(v) {
  switch (v) {
    case 'HIGH_PRIORITY': return '#ecfdf5';
    case 'PROCEED':       return '#f0fdf4';
    case 'CAUTION':       return '#fef7e0';
    case 'NOT_RECOMMENDED': return '#fef2f2';
    default: return '#f6f7f9';
  }
}

// ══════════════════ DecisionInsightsPanel (PROMINENT) ════════════════
//
// Lives below the DecisionBox and is the visual hero of the workbench.
// Two sections stacked:
//   1) Sensitivity sweep — large chart showing where the decision breaks
//   2) Segment reactions — per-archetype impact + expandable narrative/chat

function DecisionInsightsPanel({ scenario, preview, loading, updateDecision }) {
  // Sensitivity state
  const [sensitivityData, setSensitivityData] = useState(null);
  const [sensitivityLoading, setSensitivityLoading] = useState(false);
  const sweepRef = useRef(null);

  useEffect(() => {
    if (!scenario?.decision?.type) return;
    clearTimeout(sweepRef.current);
    sweepRef.current = setTimeout(async () => {
      setSensitivityLoading(true);
      try {
        const res = await fetch(`${API_URL}/api/scenario-sensitivity`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ property: scenario.property, audience: scenario.audience, decision: scenario.decision, calibration: scenario.calibration }),
        });
        const data = await res.json();
        setSensitivityData(data);
      } catch (err) {
        setSensitivityData({ error: err.message });
      } finally {
        setSensitivityLoading(false);
      }
    }, 400);
    return () => clearTimeout(sweepRef.current);
  }, [scenario]);

  // Competitor matrix state
  const [competitorData, setCompetitorData] = useState(null);
  const [competitorLoading, setCompetitorLoading] = useState(false);
  const matrixRef = useRef(null);
  useEffect(() => {
    // Only fetch for rate_change — the only supported type for now
    if (scenario?.decision?.type !== 'rate_change') {
      setCompetitorData(null);
      return;
    }
    clearTimeout(matrixRef.current);
    matrixRef.current = setTimeout(async () => {
      setCompetitorLoading(true);
      try {
        const res = await fetch(`${API_URL}/api/competitor-matrix`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ property: scenario.property, audience: scenario.audience, decision: scenario.decision, calibration: scenario.calibration }),
        });
        const data = await res.json();
        setCompetitorData(data);
      } catch (err) {
        setCompetitorData({ error: err.message });
      } finally {
        setCompetitorLoading(false);
      }
    }, 500);
    return () => clearTimeout(matrixRef.current);
  }, [scenario]);

  // Segment expansion + interview state
  const [expandedSegment, setExpandedSegment] = useState(null);
  const [interviewMap, setInterviewMap] = useState({});

  const askSegment = async (archetype, topCluster, question) => {
    const key = archetype;
    const msgs = interviewMap[key] || [];
    const userMsg = { role: 'user', text: question, ts: Date.now() };
    setInterviewMap({ ...interviewMap, [key]: [...msgs, userMsg] });
    try {
      const res = await fetch(`${API_URL}/api/scenario-interview`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question, archetype, cluster: topCluster }),
      });
      const data = await res.json();
      setInterviewMap((prev) => ({
        ...prev,
        [key]: [...(prev[key] || []), {
          role: 'agent', text: data.answer || 'No response', speaker: data.name, age: data.age, ts: Date.now(),
        }],
      }));
    } catch (err) {
      setInterviewMap((prev) => ({
        ...prev,
        [key]: [...(prev[key] || []), { role: 'agent', text: 'Connection error.', ts: Date.now() }],
      }));
    }
  };

  const topCluster = Object.entries(scenario?.audience?.cultural_mix || {})
    .sort((a, b) => b[1] - a[1])[0]?.[0] || 'anglo_uk_ireland';

  return (
    <div style={{ marginBottom: 16 }}>
      {/* ─────── Sensitivity sweep (FULL WIDTH, hero chart) ─────── */}
      <div style={{
        background: 'linear-gradient(180deg, #ffffff 0%, #fafbfc 100%)',
        border: '1px solid #e2e8f0', borderRadius: 14,
        padding: '24px 26px 26px', marginBottom: 16,
        boxShadow: '0 4px 14px rgba(10,53,88,0.07), 0 1px 3px rgba(0,0,0,0.04)',
        position: 'relative', overflow: 'hidden',
      }}>
        {/* Gradient accent bar (top edge) */}
        <div style={{
          position: 'absolute', top: 0, left: 0, right: 0, height: 3,
          background: 'linear-gradient(90deg, #059669 0%, #22c55e 28%, #d97706 62%, #dc2626 100%)',
        }} />

        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 14, gap: 20 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{
              display: 'inline-flex', alignItems: 'center', gap: 7,
              padding: '3px 10px 3px 8px', borderRadius: 14,
              background: '#eef2f7', border: '1px solid #dbe3ec',
              fontSize: 10, letterSpacing: 1.3, textTransform: 'uppercase', color: '#334155', fontWeight: 700,
            }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#0F4C75', boxShadow: '0 0 0 3px rgba(15,76,117,0.15)' }} />
              Sensitivity sweep
            </div>
            <h3 style={{ margin: '10px 0 4px', fontSize: 22, fontWeight: 800, color: '#0A3558', letterSpacing: -0.3, lineHeight: 1.15 }}>
              Where does this decision break?
            </h3>
            <div style={{ fontSize: 13, color: '#475569', marginTop: 4, lineHeight: 1.5, maxWidth: 760 }}>
              Sweeps the decision parameter across its range and plots <strong style={{ color: '#0F4C75' }}>Net LTV</strong>. The chart shows the optimal point, the zones where the verdict flips, and the distance from your current input — so you can show a client <em>exactly</em> where this move stops being a good idea.
            </div>
          </div>
          {sensitivityLoading && (
            <div style={{
              display: 'inline-flex', alignItems: 'center', gap: 8,
              padding: '6px 12px', borderRadius: 20,
              background: '#fef7e0', border: '1px solid #fcd34d',
              fontSize: 11, color: '#b45309', fontWeight: 700, flexShrink: 0,
            }}>
              <span style={{
                width: 7, height: 7, borderRadius: '50%', background: '#f59e0b',
                animation: 'sens-pulse 1.3s ease-in-out infinite',
              }} />
              re-sweeping…
            </div>
          )}
        </div>

        <BigSensitivityChart
          data={sensitivityData}
          loading={sensitivityLoading}
          onSelectValue={(param, value) => {
            if (updateDecision && param) updateDecision({ [param]: value });
          }}
        />

        <style jsx>{`
          @keyframes sens-pulse {
            0%, 100% { opacity: 0.5; transform: scale(0.9); }
            50% { opacity: 1; transform: scale(1.15); }
          }
        `}</style>
      </div>

      {/* ─────── Competitor reaction (game-theory matrix) ─────── */}
      {scenario?.decision?.type === 'rate_change' && (
        <div style={{
          background: 'white', border: '1px solid #e2e8f0', borderRadius: 12,
          padding: '22px 24px', marginBottom: 16,
          boxShadow: '0 2px 6px rgba(10,53,88,0.04)',
        }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 12, gap: 16 }}>
            <div style={{ flex: 1 }}>
              <div style={{
                display: 'inline-flex', alignItems: 'center', gap: 7,
                padding: '3px 10px 3px 8px', borderRadius: 14,
                background: '#eef2f7', border: '1px solid #dbe3ec',
                fontSize: 10, letterSpacing: 1.3, textTransform: 'uppercase', color: '#334155', fontWeight: 700,
              }}>
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#be185d', boxShadow: '0 0 0 3px rgba(190,24,93,0.15)' }} />
                Competitor reaction
              </div>
              <h3 style={{ margin: '10px 0 4px', fontSize: 20, fontWeight: 800, color: '#0A3558', letterSpacing: -0.2 }}>
                What if they don't follow? — 3×3 game-theory matrix
              </h3>
              <div style={{ fontSize: 13, color: '#475569', marginTop: 4, lineHeight: 1.5, maxWidth: 760 }}>
                Tests your 3 rate options against 3 plausible competitor reactions. Identifies the <strong>dominant strategy</strong> (safest maximin play) and the <strong>Nash equilibrium</strong> (stable joint outcome).
              </div>
            </div>
            {competitorLoading && (
              <div style={{
                display: 'inline-flex', alignItems: 'center', gap: 8,
                padding: '6px 12px', borderRadius: 20,
                background: '#fef7e0', border: '1px solid #fcd34d',
                fontSize: 11, color: '#b45309', fontWeight: 700, flexShrink: 0,
              }}>
                <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#f59e0b' }} />
                re-running…
              </div>
            )}
          </div>

          <CompetitorMatrixGrid matrix={competitorData?.matrix} data={competitorData} />
        </div>
      )}

      {/* ─────── Review narrative forecaster ─────── */}
      <div style={{
        background: 'white', border: '1px solid #e2e8f0', borderRadius: 12,
        padding: '22px 24px', marginBottom: 16,
        boxShadow: '0 2px 6px rgba(10,53,88,0.04)',
      }}>
        <div style={{ marginBottom: 14 }}>
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: 7,
            padding: '3px 10px 3px 8px', borderRadius: 14,
            background: '#eef2f7', border: '1px solid #dbe3ec',
            fontSize: 10, letterSpacing: 1.3, textTransform: 'uppercase', color: '#334155', fontWeight: 700,
          }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#059669', boxShadow: '0 0 0 3px rgba(5,150,105,0.15)' }} />
            Review forecast
          </div>
          <h3 style={{ margin: '10px 0 4px', fontSize: 20, fontWeight: 800, color: '#0A3558', letterSpacing: -0.2 }}>
            What guests will write in the next 90 days
          </h3>
          <div style={{ fontSize: 13, color: '#475569', marginTop: 4, lineHeight: 1.5, maxWidth: 760 }}>
            Predicted reviews on TripAdvisor / Booking / Google if this decision ships today. Each card is a forecast from the synthetic cohort — citable in your client report.
          </div>
        </div>

        <ReviewForecastCards forecast={preview?.review_forecast} />
      </div>

      {/* ─────── Segment reactions (FULL WIDTH, with drilldowns) ─── */}
      <div style={{
        background: 'white', border: '1px solid #e2e8f0', borderRadius: 12,
        padding: '22px 24px',
        boxShadow: '0 2px 6px rgba(10,53,88,0.04)',
      }}>
        <div style={{ marginBottom: 14 }}>
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: 7,
            padding: '3px 10px 3px 8px', borderRadius: 14,
            background: '#eef2f7', border: '1px solid #dbe3ec',
            fontSize: 10, letterSpacing: 1.3, textTransform: 'uppercase', color: '#334155', fontWeight: 700,
          }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#7c3aed', boxShadow: '0 0 0 3px rgba(124,58,237,0.15)' }} />
            Segment reactions
          </div>
          <h3 style={{ margin: '10px 0 4px', fontSize: 20, fontWeight: 800, color: '#0A3558', letterSpacing: -0.2 }}>
            How each traveler profile responds
          </h3>
          <div style={{ fontSize: 13, color: '#475569', marginTop: 4, lineHeight: 1.5, maxWidth: 760 }}>
            Click any segment to see <strong>3 sample traveler quotes</strong> (citable in your client report) and chat with a synthetic guest.
          </div>
        </div>

        {!preview?.segments?.length && (
          <div style={{ fontSize: 12, color: '#6b7888', padding: '18px 0', textAlign: 'center' }}>
            {loading ? 'Computing…' : 'Configure a decision to see segment reactions.'}
          </div>
        )}

        {preview?.segments?.map((s) => {
          const isNeg = s.delta_pct < 0;
          const maxAbs = Math.max(...preview.segments.map(x => Math.abs(x.delta_pct || 0)), 1);
          const barW = (Math.abs(s.delta_pct || 0) / maxAbs) * 100;
          const color = isNeg ? '#b91c1c' : '#0a8754';
          const isExpanded = expandedSegment === s.segment;
          const archLabel = ARCHETYPES.find(a => a.id === s.segment)?.label || s.segment.replace(/_/g, ' ');
          const archColor = ARCHETYPES.find(a => a.id === s.segment)?.color || '#6b7888';
          const weight = s.weight_pct != null ? `${s.weight_pct}%` : '';

          return (
            <div key={s.segment} style={{
              marginBottom: 8,
              border: `1px solid ${isExpanded ? '#0F4C75' : '#e5e7eb'}`,
              borderRadius: 8, overflow: 'hidden',
              background: isExpanded ? '#f9fafb' : 'white',
            }}>
              <button
                onClick={() => setExpandedSegment(isExpanded ? null : s.segment)}
                style={{
                  width: '100%', display: 'flex', alignItems: 'center', gap: 14,
                  padding: '14px 16px', background: 'transparent', border: 0,
                  cursor: 'pointer', textAlign: 'left',
                }}
              >
                <span style={{
                  width: 28, height: 28, borderRadius: '50%', background: archColor,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  color: 'white', fontWeight: 800, fontSize: 13, flexShrink: 0,
                }}>{archLabel.charAt(0)}</span>

                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: '#1a1d23' }}>
                    {archLabel}
                    {weight && <span style={{ fontSize: 11, color: '#6b7888', fontWeight: 500, marginLeft: 8 }}>· {weight} of audience</span>}
                  </div>
                  <div style={{ fontSize: 11, color: '#6b7888', marginTop: 2 }}>
                    {s.sample_narratives?.length > 0 ? `${s.sample_narratives.length} sample narratives · ask any question →` : 'expand for details'}
                  </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{ width: 140, height: 8, background: '#f0f1f4', borderRadius: 4, overflow: 'hidden', position: 'relative' }}>
                    <div style={{
                      position: 'absolute', top: 0, height: '100%',
                      width: `${barW}%`, background: color,
                      left: isNeg ? `${100 - barW}%` : 0,
                    }} />
                  </div>
                  <span style={{ fontSize: 16, fontWeight: 800, color, minWidth: 62, textAlign: 'right' }}>
                    {s.delta_pct >= 0 ? '+' : ''}{(s.delta_pct || 0).toFixed(1)}%
                  </span>
                  <span style={{ fontSize: 14, color: '#6b7888', transform: isExpanded ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s' }}>▸</span>
                </div>
              </button>

              {isExpanded && (
                <div style={{ padding: '0 16px 18px 16px', borderTop: '1px dashed #d1d5db' }}>
                  <SegmentDrilldownRich
                    segment={s}
                    archetype={s.segment}
                    topCluster={topCluster}
                    interviewMessages={interviewMap[s.segment] || []}
                    onAskQuestion={(q) => askSegment(s.segment, topCluster, q)}
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ══════════════════ BigSensitivityChart (hero, interactive) ═══════════
//
// Reactive chart: hover anywhere to see a contextual tooltip explaining the
// point, click to scrub the decision to that value. Smooth curve with
// gradient fill, color-coded verdict bands, optimal + break point markers.

const VERDICT_COLORS = {
  HIGH_PRIORITY:   '#059669',
  PROCEED:         '#22c55e',
  CAUTION:         '#d97706',
  NOT_RECOMMENDED: '#dc2626',
};
const VERDICT_LABELS = {
  HIGH_PRIORITY: 'HIGH PRIORITY',
  PROCEED: 'PROCEED',
  CAUTION: 'CAUTION',
  NOT_RECOMMENDED: 'NOT RECOMMENDED',
};

const PARAM_LABEL = {
  magnitude_pct: 'Rate change',
  price_delta_eur: 'Price delta',
  cost_per_stay_eur: 'Cost per stay',
  ratio_delta_pct: 'Staff ratio change',
  cost_per_member_eur: 'Cost per member',
  discount_pct: 'Discount',
};
const PARAM_UNIT = {
  magnitude_pct: '%',
  price_delta_eur: '€',
  cost_per_stay_eur: '€',
  ratio_delta_pct: '%',
  cost_per_member_eur: '€',
  discount_pct: '%',
};

function catmullRomToBezier(points) {
  // Build a smooth path via Catmull-Rom conversion to cubic Beziers.
  if (points.length < 2) return '';
  let d = `M ${points[0][0]} ${points[0][1]}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i - 1] || points[i];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2] || p2;
    const cp1x = p1[0] + (p2[0] - p0[0]) / 6;
    const cp1y = p1[1] + (p2[1] - p0[1]) / 6;
    const cp2x = p2[0] - (p3[0] - p1[0]) / 6;
    const cp2y = p2[1] - (p3[1] - p1[1]) / 6;
    d += ` C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${p2[0]} ${p2[1]}`;
  }
  return d;
}

function contextualExplanation({ point, data, isOptimal, isBreakPoint, isCurrent, paramKey }) {
  const unit = PARAM_UNIT[paramKey] || '';
  const sign = point.net_eur >= 0 ? '+' : '−';
  const absMoney = (Math.abs(point.net_eur) / 1_000_000).toFixed(2);
  const netStr = `${sign}€${absMoney}M`;

  if (isCurrent) {
    return {
      title: 'Your current configuration',
      body: `This is exactly what you have set in the decision box. Net LTV ${netStr}. Click any other point to test an alternative magnitude.`,
      tone: 'primary',
    };
  }
  if (isOptimal) {
    return {
      title: '★ Optimal point',
      body: `At ${point.x}${unit}, the decision produces the best net LTV (${netStr}). Click to jump here.`,
      tone: 'positive',
    };
  }
  if (isBreakPoint) {
    return {
      title: '⚠ Verdict flip zone',
      body: `The decision switches from positive to negative (or vice-versa) near ${point.x}${unit}. Small changes here have big consequences.`,
      tone: 'warn',
    };
  }
  if (point.verdict === 'HIGH_PRIORITY') {
    return {
      title: 'High-priority zone',
      body: `At ${point.x}${unit}, Net LTV ${netStr}. This is a strong positive region — the decision creates real value.`,
      tone: 'positive',
    };
  }
  if (point.verdict === 'PROCEED') {
    return {
      title: 'Proceed zone',
      body: `At ${point.x}${unit}, Net LTV ${netStr}. Mildly positive — safe to proceed but room to optimise.`,
      tone: 'positive',
    };
  }
  if (point.verdict === 'CAUTION') {
    return {
      title: 'Caution zone',
      body: `At ${point.x}${unit}, Net LTV ${netStr}. The decision hurts LTV modestly — weigh short-term upside carefully.`,
      tone: 'warn',
    };
  }
  return {
    title: 'Not-recommended zone',
    body: `At ${point.x}${unit}, Net LTV ${netStr}. This value destroys long-term value. Short-term revenue may still look positive — don't be fooled.`,
    tone: 'negative',
  };
}

// Helpers for the redesigned chart ─────────────────────────────────────
function fmtEurCompact(n) {
  if (n == null || isNaN(n)) return '—';
  const sign = n >= 0 ? '+' : '−';
  const a = Math.abs(n);
  if (a >= 1_000_000) return `${sign}€${(a / 1_000_000).toFixed(a >= 10_000_000 ? 1 : 2)}M`;
  if (a >= 1_000) return `${sign}€${Math.round(a / 1000)}K`;
  return `${sign}€${Math.round(a)}`;
}

function computeSafeZone(points) {
  // Largest contiguous run where net_eur > 0. Returns {start, end, pts} or null.
  let best = null, cur = null;
  points.forEach((p, i) => {
    if (p.net_eur > 0) {
      if (!cur) cur = { start: i, end: i, pts: [p] };
      else { cur.end = i; cur.pts.push(p); }
    } else {
      if (cur && (!best || cur.pts.length > best.pts.length)) best = cur;
      cur = null;
    }
  });
  if (cur && (!best || cur.pts.length > best.pts.length)) best = cur;
  return best;
}

function BigSensitivityChart({ data, loading, onSelectValue }) {
  const [hoverIdx, setHoverIdx] = useState(null);
  const [hoverPos, setHoverPos] = useState({ x: 0, y: 0 });
  const svgRef = useRef(null);

  if (!data && loading) {
    return (
      <div style={{
        padding: '60px 20px', textAlign: 'center',
        background: 'linear-gradient(135deg, #f8fafc 0%, #eef2f7 100%)',
        border: '1px dashed #cbd5e1', borderRadius: 10,
      }}>
        <div style={{
          display: 'inline-flex', flexDirection: 'column', alignItems: 'center', gap: 10,
        }}>
          <div style={{
            width: 40, height: 40, borderRadius: '50%',
            background: 'conic-gradient(from 0deg, #0F4C75, #22c55e, #f59e0b, #dc2626, #0F4C75)',
            animation: 'sens-spin 1.8s linear infinite',
            maskImage: 'radial-gradient(circle, transparent 55%, black 56%)',
            WebkitMaskImage: 'radial-gradient(circle, transparent 55%, black 56%)',
          }} />
          <div style={{ fontSize: 13, color: '#475569', fontWeight: 600 }}>Sweeping parameter range…</div>
          <div style={{ fontSize: 11, color: '#94a3b8' }}>Simulating net LTV across the decision curve</div>
        </div>
        <style jsx>{`@keyframes sens-spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }
  if (!data || data.error) {
    return (
      <div style={{
        padding: '50px 24px', textAlign: 'center',
        background: '#f8fafc', border: '1px dashed #cbd5e1', borderRadius: 10,
      }}>
        <div style={{
          width: 44, height: 44, borderRadius: 10, margin: '0 auto 10px',
          background: 'white', border: '1px solid #cbd5e1',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: '#64748b', fontSize: 11, fontWeight: 800, letterSpacing: 1.2,
        }}>{data?.error ? 'ERR' : 'IDLE'}</div>
        <div style={{ fontSize: 14, color: '#0A3558', fontWeight: 700, marginBottom: 4 }}>
          {data?.error ? 'Sweep failed' : 'Configure a decision to trigger the sweep'}
        </div>
        <div style={{ fontSize: 12, color: '#6b7888', maxWidth: 420, margin: '0 auto' }}>
          {data?.error || 'Pick a quick-start or fill in the decision above. The chart will plot Net LTV across the parameter range and flag the break point.'}
        </div>
      </div>
    );
  }

  const points = data.points || [];
  if (points.length === 0) return null;

  // ─── Dimensions ─────────────────────────────────────────────────────
  const w = 900;
  const h = 380;
  const padL = 88, padR = 40, padT = 52, padB = 64;
  const plotW = w - padL - padR;
  const plotH = h - padT - padB;

  // ─── Scales ─────────────────────────────────────────────────────────
  const rawMax = Math.max(...points.map((p) => Math.abs(p.net_eur)), 1);
  // Round up to a nice tick
  const niceMax = (() => {
    const m = rawMax;
    if (m >= 1_000_000) {
      const mm = m / 1_000_000;
      const rounded = Math.ceil(mm * 2) / 2;
      return rounded * 1_000_000;
    }
    if (m >= 1_000) return Math.ceil(m / 100_000) * 100_000;
    return Math.ceil(m / 100) * 100;
  })();
  const maxY = niceMax;

  const xScale = (i) => padL + (i / (points.length - 1)) * plotW;
  const yScale = (v) => padT + plotH / 2 - (v / maxY) * (plotH / 2);

  const coords = points.map((p, i) => [xScale(i), yScale(p.net_eur)]);
  const smoothPath = catmullRomToBezier(coords);
  const areaPath = `${smoothPath} L ${coords[coords.length - 1][0]} ${yScale(0)} L ${coords[0][0]} ${yScale(0)} Z`;

  const nearestIdx = (target) => (target == null ? -1
    : points.reduce((best, p, i) => (Math.abs(p.x - target) < Math.abs(points[best].x - target) ? i : best), 0));
  const currentIdx = nearestIdx(data.current_value);
  const optimalIdx = data.optimal ? nearestIdx(data.optimal.x) : -1;
  const breakPointX = data.break_point?.estimated;
  const breakPointIdx = nearestIdx(breakPointX);

  // Interpolate pixel x and net_eur at the exact current_value (smoother marker)
  const interpAt = (xVal) => {
    if (points.length === 0) return { px: padL, net: 0 };
    if (xVal <= points[0].x) return { px: xScale(0), net: points[0].net_eur };
    if (xVal >= points[points.length - 1].x) return { px: xScale(points.length - 1), net: points[points.length - 1].net_eur };
    for (let i = 0; i < points.length - 1; i++) {
      const a = points[i], b = points[i + 1];
      if (xVal >= a.x && xVal <= b.x) {
        const t = (xVal - a.x) / (b.x - a.x || 1);
        return { px: xScale(i) + t * (xScale(i + 1) - xScale(i)), net: a.net_eur + t * (b.net_eur - a.net_eur) };
      }
    }
    return { px: xScale(currentIdx), net: points[currentIdx]?.net_eur || 0 };
  };
  const curInterp = data.current_value != null ? interpAt(data.current_value) : null;

  const paramKey = data.sweep_param;
  const paramLabel = PARAM_LABEL[paramKey] || paramKey;
  const paramUnit = PARAM_UNIT[paramKey] || '';

  // ─── Derived: verdict zones (for legend belt) ───────────────────────
  const zones = [];
  let cur = null;
  points.forEach((p, i) => {
    if (!cur || cur.verdict !== p.verdict) {
      if (cur) cur.end = i - 1;
      cur = { verdict: p.verdict, start: i };
      zones.push(cur);
    }
  });
  if (cur) cur.end = points.length - 1;
  const verdictTotals = zones.reduce((acc, z) => {
    const w_ = z.end - z.start + 1;
    acc[z.verdict] = (acc[z.verdict] || 0) + w_;
    return acc;
  }, {});
  const verdictOrder = ['HIGH_PRIORITY', 'PROCEED', 'CAUTION', 'NOT_RECOMMENDED'];

  // ─── Derived: safe zone (contiguous net_eur > 0) ────────────────────
  const safe = computeSafeZone(points);

  // ─── Event handlers ─────────────────────────────────────────────────
  const handleMouseMove = (e) => {
    const rect = svgRef.current.getBoundingClientRect();
    const scaleX = w / rect.width;
    const svgX = (e.clientX - rect.left) * scaleX;
    if (svgX < padL || svgX > w - padR) {
      setHoverIdx(null);
      return;
    }
    const t = (svgX - padL) / plotW;
    const idx = Math.round(t * (points.length - 1));
    const safeIdx = Math.max(0, Math.min(points.length - 1, idx));
    setHoverIdx(safeIdx);
    setHoverPos({ x: e.clientX - rect.left, y: e.clientY - rect.top });
  };
  const handleMouseLeave = () => setHoverIdx(null);
  const handleClick = () => {
    if (hoverIdx == null || !onSelectValue || !paramKey) return;
    onSelectValue(paramKey, points[hoverIdx].x);
  };

  const hovered = hoverIdx != null ? points[hoverIdx] : null;
  const explain = hovered ? contextualExplanation({
    point: hovered,
    data,
    isOptimal: hoverIdx === optimalIdx,
    isBreakPoint: breakPointIdx >= 0 && Math.abs(hoverIdx - breakPointIdx) <= 1,
    isCurrent: hoverIdx === currentIdx,
    paramKey,
  }) : null;

  const gradientId = 'sens-grad-' + paramKey;
  const areaGlowId = 'sens-glow-' + paramKey;
  const shadowId = 'sens-shadow-' + paramKey;

  // ─── Y-axis ticks (5 divisions: -max, -half, 0, +half, +max) ────────
  const yTicks = [maxY, maxY / 2, 0, -maxY / 2, -maxY];

  return (
    <div style={{ position: 'relative' }}>
      {/* ─── Verdict legend belt (what's in this sweep) ───────────────── */}
      <div style={{
        display: 'flex', alignItems: 'stretch', gap: 2,
        padding: 4, borderRadius: 10, background: '#f1f5f9',
        border: '1px solid #e2e8f0', marginBottom: 16, overflow: 'hidden',
      }}>
        {verdictOrder.map((v) => {
          const count = verdictTotals[v] || 0;
          const pct = points.length > 0 ? (count / points.length) * 100 : 0;
          if (count === 0) return null;
          return (
            <div key={v} style={{
              flex: `${Math.max(pct, 18)} 1 0%`,
              minWidth: 110,
              background: `linear-gradient(180deg, ${VERDICT_COLORS[v]}18, ${VERDICT_COLORS[v]}08)`,
              border: `1px solid ${VERDICT_COLORS[v]}33`,
              borderRadius: 7, padding: '6px 10px',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7,
            }}>
              <span style={{
                width: 7, height: 7, borderRadius: '50%', background: VERDICT_COLORS[v], flexShrink: 0,
                boxShadow: `0 0 0 2px ${VERDICT_COLORS[v]}22`,
              }} />
              <span style={{
                fontSize: 10, fontWeight: 800, letterSpacing: 0.8, color: VERDICT_COLORS[v],
                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
              }}>
                {VERDICT_LABELS[v]}
              </span>
              <span style={{
                fontSize: 10, color: '#64748b', fontWeight: 600, flexShrink: 0,
              }}>
                {Math.round(pct)}%
              </span>
            </div>
          );
        })}
        <div style={{ flexShrink: 0, padding: '6px 10px', display: 'flex', alignItems: 'center', gap: 6, fontSize: 10, color: '#64748b', fontStyle: 'italic' }}>
          hover · click to scrub
        </div>
      </div>

      {/* ─── Hero SVG chart ───────────────────────────────────────────── */}
      <div style={{
        background: 'white', border: '1px solid #e2e8f0', borderRadius: 10,
        padding: 2, overflow: 'hidden',
        boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.9)',
      }}>
        <svg
          ref={svgRef}
          width="100%"
          viewBox={`0 0 ${w} ${h}`}
          style={{ display: 'block', cursor: onSelectValue ? 'crosshair' : 'default' }}
          onMouseMove={handleMouseMove}
          onMouseLeave={handleMouseLeave}
          onClick={handleClick}
        >
          <defs>
            {/* Gradient under the curve: emerald above zero, crimson below */}
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#10b981" stopOpacity="0.42" />
              <stop offset="48%" stopColor="#10b981" stopOpacity="0.03" />
              <stop offset="52%" stopColor="#dc2626" stopOpacity="0.03" />
              <stop offset="100%" stopColor="#dc2626" stopOpacity="0.42" />
            </linearGradient>
            <linearGradient id={areaGlowId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#0F4C75" stopOpacity="0.9" />
              <stop offset="100%" stopColor="#3b82f6" stopOpacity="0.9" />
            </linearGradient>
            <filter id={shadowId} x="-20%" y="-20%" width="140%" height="140%">
              <feGaussianBlur in="SourceAlpha" stdDeviation="2" />
              <feOffset dx="0" dy="1.5" result="offsetblur" />
              <feComponentTransfer><feFuncA type="linear" slope="0.35" /></feComponentTransfer>
              <feMerge>
                <feMergeNode />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
            {/* Soft background grid */}
            <pattern id={`grid-${paramKey}`} width={plotW / 10} height={plotH / 4} patternUnits="userSpaceOnUse">
              <path d={`M ${plotW / 10} 0 L 0 0 0 ${plotH / 4}`} fill="none" stroke="#f1f5f9" strokeWidth="1" />
            </pattern>
          </defs>

          {/* Plot background (light fill) */}
          <rect x={padL} y={padT} width={plotW} height={plotH} fill="#fafbfc" />

          {/* Background grid */}
          <rect x={padL} y={padT} width={plotW} height={plotH} fill={`url(#grid-${paramKey})`} />

          {/* Verdict zone BANDS (vertical strips) - softer for elegance */}
          {zones.map((z, i) => {
            const x1 = xScale(z.start);
            const x2 = xScale(Math.min(z.end + 1, points.length - 1));
            return (
              <rect key={`zn-${i}`} x={x1} y={padT} width={x2 - x1} height={plotH}
                fill={VERDICT_COLORS[z.verdict]} fillOpacity="0.07" />
            );
          })}

          {/* Safe zone overlay (subtle emerald band) */}
          {safe && safe.pts.length >= 2 && (
            <rect
              x={xScale(safe.start)} y={padT}
              width={xScale(safe.end) - xScale(safe.start)} height={plotH}
              fill="#10b981" fillOpacity="0.05"
              stroke="#10b981" strokeOpacity="0.25" strokeWidth="1" strokeDasharray="4,4"
            />
          )}

          {/* Horizontal gridlines at key Y ticks */}
          {yTicks.map((v) => (
            <line key={`gy-${v}`} x1={padL} y1={yScale(v)} x2={w - padR} y2={yScale(v)}
              stroke={v === 0 ? '#64748b' : '#e2e8f0'} strokeWidth={v === 0 ? 1.2 : 1}
              strokeDasharray={v === 0 ? '4,5' : '2,4'} opacity={v === 0 ? 0.7 : 0.8} />
          ))}

          {/* Plot border */}
          <rect x={padL} y={padT} width={plotW} height={plotH} fill="none" stroke="#cbd5e1" strokeWidth="1" />

          {/* Area under curve (gradient green/red) */}
          <path d={areaPath} fill={`url(#${gradientId})`} />

          {/* Smooth line — crisp navy gradient */}
          <path d={smoothPath} stroke={`url(#${areaGlowId})`} strokeWidth="3" fill="none"
            strokeLinecap="round" strokeLinejoin="round" filter={`url(#${shadowId})`} />

          {/* All sample points (colored by verdict) */}
          {points.map((p, i) => (
            <g key={`pt-${i}`}>
              <circle cx={xScale(i)} cy={yScale(p.net_eur)} r="5"
                fill="white" stroke={VERDICT_COLORS[p.verdict]} strokeWidth="2" />
            </g>
          ))}

          {/* Safe zone top callout */}
          {safe && safe.pts.length >= 2 && (
            <g>
              <text
                x={(xScale(safe.start) + xScale(safe.end)) / 2}
                y={padT - 26}
                fontSize="10" fill="#047857" fontWeight="800" textAnchor="middle" letterSpacing="1.2"
              >
                ✓ SAFE ZONE · {points[safe.start].x}{paramUnit} → {points[safe.end].x}{paramUnit}
              </text>
            </g>
          )}

          {/* Break point: vertical line + pill callout */}
          {breakPointIdx >= 0 && (
            <g>
              <line x1={xScale(breakPointIdx)} y1={padT + 12} x2={xScale(breakPointIdx)} y2={h - padB}
                stroke="#d97706" strokeWidth="1.5" strokeDasharray="5,4" opacity="0.7" />
              <rect
                x={xScale(breakPointIdx) - 34} y={padT - 10}
                width="68" height="20" rx="10" ry="10"
                fill="#fef3c7" stroke="#f59e0b" strokeWidth="1.2"
              />
              <text x={xScale(breakPointIdx)} y={padT + 4} fontSize="10.5" fill="#92400e"
                fontWeight="800" textAnchor="middle" letterSpacing="0.6">⚠ BREAK</text>
            </g>
          )}

          {/* Optimal: glow circle + pill callout */}
          {optimalIdx >= 0 && (
            <g>
              <circle cx={xScale(optimalIdx)} cy={yScale(data.optimal.net_eur)} r="16"
                fill="#fbbf24" fillOpacity="0.25">
                <animate attributeName="r" values="12;18;12" dur="2.2s" repeatCount="indefinite" />
                <animate attributeName="fill-opacity" values="0.28;0.1;0.28" dur="2.2s" repeatCount="indefinite" />
              </circle>
              <circle cx={xScale(optimalIdx)} cy={yScale(data.optimal.net_eur)} r="11"
                fill="none" stroke="#f59e0b" strokeWidth="2.5" />
              <circle cx={xScale(optimalIdx)} cy={yScale(data.optimal.net_eur)} r="6"
                fill="#f59e0b" stroke="white" strokeWidth="2" filter={`url(#${shadowId})`} />
              {/* Pill */}
              <g transform={`translate(${xScale(optimalIdx)}, ${yScale(data.optimal.net_eur) - 28})`}>
                <rect x="-38" y="-12" width="76" height="20" rx="10" ry="10"
                  fill="#b45309" stroke="#f59e0b" strokeWidth="1" />
                <text x="0" y="2" fontSize="10.5" fill="white" fontWeight="800" textAnchor="middle" letterSpacing="0.8">★ OPTIMAL</text>
              </g>
            </g>
          )}

          {/* Current input: thick navy marker + ground line + pill (interpolated for accuracy) */}
          {curInterp && (
            <g>
              <line x1={curInterp.px} y1={yScale(curInterp.net) + 14}
                x2={curInterp.px} y2={h - padB + 6}
                stroke="#0F4C75" strokeWidth="1.5" strokeDasharray="3,3" opacity="0.75" />
              <circle cx={curInterp.px} cy={yScale(curInterp.net)} r="10"
                fill="#0F4C75" stroke="white" strokeWidth="3.5" filter={`url(#${shadowId})`} />
              <circle cx={curInterp.px} cy={yScale(curInterp.net)} r="4"
                fill="white" />
              {/* Ground pill */}
              <g transform={`translate(${curInterp.px}, ${h - padB + 22})`}>
                <rect x="-46" y="-11" width="92" height="22" rx="11" ry="11"
                  fill="#0F4C75" />
                <text x="0" y="4" fontSize="11" fill="white" fontWeight="800" textAnchor="middle" letterSpacing="0.5">
                  YOU · {data.current_value}{paramUnit}
                </text>
              </g>
            </g>
          )}

          {/* Hover crosshair */}
          {hoverIdx != null && hoverIdx !== currentIdx && hoverIdx !== optimalIdx && (
            <g>
              <line x1={xScale(hoverIdx)} y1={padT} x2={xScale(hoverIdx)} y2={h - padB}
                stroke="#1e293b" strokeWidth="1" strokeDasharray="2,3" opacity="0.4" />
              <line x1={padL} y1={yScale(points[hoverIdx].net_eur)} x2={w - padR} y2={yScale(points[hoverIdx].net_eur)}
                stroke="#1e293b" strokeWidth="1" strokeDasharray="2,3" opacity="0.22" />
              <circle cx={xScale(hoverIdx)} cy={yScale(points[hoverIdx].net_eur)} r="9"
                fill="white" stroke={VERDICT_COLORS[points[hoverIdx].verdict]} strokeWidth="3" />
            </g>
          )}

          {/* Y axis labels (nicer formatted) */}
          {yTicks.map((v) => (
            <text key={`yl-${v}`} x={padL - 12} y={yScale(v) + 4}
              fontSize={v === 0 ? '12' : '10.5'} fill={v === 0 ? '#0A3558' : '#64748b'}
              textAnchor="end" fontWeight={v === 0 ? '800' : '600'}>
              {fmtEurCompact(v)}
            </text>
          ))}
          <text x={24} y={padT + plotH / 2} fontSize="11" fill="#334155" textAnchor="middle"
            fontWeight="800" letterSpacing="1.5"
            transform={`rotate(-90, 24, ${padT + plotH / 2})`}>
            NET LTV (€)
          </text>

          {/* X axis labels */}
          {points.map((p, i) => (i % 2 === 0 || i === points.length - 1) && (
            <text key={`x-${i}`} x={xScale(i)} y={h - padB + 50}
              fontSize="10.5" fill="#64748b" textAnchor="middle" fontWeight="500">
              {p.x}{paramUnit}
            </text>
          ))}
          <text x={padL + plotW / 2} y={h - 6} fontSize="11" fill="#334155" textAnchor="middle"
            fontWeight="800" letterSpacing="1.5">
            {paramLabel.toUpperCase()} ({paramUnit || 'value'})
          </text>
        </svg>
      </div>

      {/* Floating tooltip */}
      {hovered && explain && (
        <HoverTooltip pos={hoverPos} point={hovered} explain={explain} paramUnit={paramUnit} onSelect={() => onSelectValue && onSelectValue(paramKey, hovered.x)} />
      )}

      {/* ─── 4 KPI annotation cards ──────────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginTop: 18 }}>
        <AnnotationCard
          icon="★"
          label="Optimal"
          value={data.optimal ? `${data.optimal.x}${paramUnit}` : '—'}
          primarySub={data.optimal ? fmtEurCompact(data.optimal.net_eur) : ''}
          sub={data.optimal ? VERDICT_LABELS[data.optimal.verdict] || data.optimal.verdict : 'no optimum in range'}
          color="#b45309"
          bg="#fef3c7"
          accent="#f59e0b"
          onClick={data.optimal && onSelectValue ? () => onSelectValue(paramKey, data.optimal.x) : null}
          actionLabel="Apply to decision"
        />
        <AnnotationCard
          icon="✓"
          label="Safe zone"
          value={safe && safe.pts.length >= 1
            ? `${points[safe.start].x}${paramUnit} → ${points[safe.end].x}${paramUnit}`
            : '—'}
          primarySub={safe ? `${safe.pts.length} of ${points.length} points positive` : ''}
          sub={safe ? 'range where Net LTV stays > €0' : 'no positive region in this sweep'}
          color="#047857"
          bg="#d1fae5"
          accent="#10b981"
        />
        <AnnotationCard
          icon="⚠"
          label="Break point"
          value={data.break_point ? `≈ ${data.break_point.estimated}${paramUnit}` : '—'}
          primarySub={data.break_point ? 'verdict flips' : ''}
          sub={data.break_point
            ? `between ${data.break_point.between[0]}${paramUnit} and ${data.break_point.between[1]}${paramUnit}`
            : 'no inflection in sweep range'}
          color="#92400e"
          bg="#fef3c7"
          accent="#d97706"
        />
        <AnnotationCard
          icon="●"
          label="You are here"
          value={`${data.current_value}${paramUnit}`}
          primarySub={curInterp ? fmtEurCompact(curInterp.net) : ''}
          sub={currentIdx >= 0
            ? `${VERDICT_LABELS[points[currentIdx].verdict] || points[currentIdx].verdict}${
                data.optimal ? ` · Δ ${((data.current_value - data.optimal.x)).toFixed(1)}${paramUnit} from optimal` : ''
              }`
            : paramLabel + ' currently configured'}
          color="#0A3558"
          bg="#e0e7ff"
          accent="#0F4C75"
        />
      </div>
    </div>
  );
}

function HoverTooltip({ pos, point, explain, paramUnit, onSelect }) {
  const toneColor = {
    positive: '#059669',
    warn: '#d97706',
    negative: '#dc2626',
    primary: '#0F4C75',
  }[explain.tone] || '#0F4C75';
  const toneBg = {
    positive: '#ecfdf5',
    warn: '#fef7e0',
    negative: '#fef2f2',
    primary: '#eef2ff',
  }[explain.tone] || '#f6f7f9';

  const fmt = (n) => {
    if (n == null) return '—';
    const s = n >= 0 ? '+' : '−';
    const a = Math.abs(n);
    if (a >= 1_000_000) return `${s}€${(a / 1_000_000).toFixed(2)}M`;
    if (a >= 1_000) return `${s}€${(a / 1_000).toFixed(0)}K`;
    return `${s}€${Math.round(a)}`;
  };

  // Position: above-right of cursor, clamp to container
  const left = Math.min(pos.x + 14, 520);
  const top = Math.max(pos.y - 140, 10);

  return (
    <div style={{
      position: 'absolute', left, top, pointerEvents: 'none',
      background: 'white', border: `1px solid ${toneColor}55`,
      borderLeft: `4px solid ${toneColor}`,
      borderRadius: 8, padding: '12px 14px',
      boxShadow: '0 10px 28px rgba(0,0,0,0.18)',
      minWidth: 260, maxWidth: 320,
      fontSize: 12, zIndex: 100,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
        <span style={{
          fontSize: 10, letterSpacing: 1, textTransform: 'uppercase', fontWeight: 800,
          color: toneColor, background: toneBg, padding: '2px 8px', borderRadius: 10,
        }}>{explain.title}</span>
        <span style={{ fontSize: 11, color: '#6b7888', fontWeight: 600 }}>{point.x}{paramUnit}</span>
      </div>
      <div style={{ fontSize: 11, color: '#374151', lineHeight: 1.5, marginBottom: 10 }}>{explain.body}</div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6, fontSize: 11 }}>
        <div>
          <div style={{ fontSize: 9, color: '#6b7888', letterSpacing: 0.5, textTransform: 'uppercase' }}>Short-term</div>
          <div style={{ fontWeight: 700, color: point.short_term_eur >= 0 ? '#059669' : '#dc2626' }}>{fmt(point.short_term_eur)}</div>
        </div>
        <div>
          <div style={{ fontSize: 9, color: '#6b7888', letterSpacing: 0.5, textTransform: 'uppercase' }}>Long-term</div>
          <div style={{ fontWeight: 700, color: point.long_term_eur >= 0 ? '#059669' : '#dc2626' }}>{fmt(point.long_term_eur)}</div>
        </div>
        <div>
          <div style={{ fontSize: 9, color: '#6b7888', letterSpacing: 0.5, textTransform: 'uppercase' }}>Net</div>
          <div style={{ fontWeight: 800, color: point.net_eur >= 0 ? '#059669' : '#dc2626' }}>{fmt(point.net_eur)}</div>
        </div>
      </div>
      {onSelect && (
        <div style={{ marginTop: 8, fontSize: 10, color: toneColor, fontWeight: 600, textAlign: 'center' }}>
          click to jump to this magnitude →
        </div>
      )}
    </div>
  );
}

function AnnotationCard({
  icon, label, value, primarySub, sub, color, bg, accent, onClick, actionLabel,
}) {
  const interactive = typeof onClick === 'function';
  const accentColor = accent || color;
  const bgColor = bg || '#f8fafc';
  return (
    <div
      onClick={onClick}
      style={{
        position: 'relative',
        background: 'linear-gradient(180deg, #ffffff 0%, #fcfdfd 100%)',
        border: '1px solid #e5e7eb',
        borderTop: `3px solid ${accentColor}`,
        borderRadius: 10, padding: '13px 14px 14px',
        cursor: interactive ? 'pointer' : 'default',
        transition: 'transform 0.12s, box-shadow 0.12s, border-color 0.12s',
        overflow: 'hidden',
        minHeight: 96,
      }}
      onMouseEnter={interactive ? (e) => {
        e.currentTarget.style.transform = 'translateY(-2px)';
        e.currentTarget.style.boxShadow = `0 8px 20px ${accentColor}22, 0 2px 6px rgba(0,0,0,0.06)`;
        e.currentTarget.style.borderColor = `${accentColor}55`;
      } : undefined}
      onMouseLeave={interactive ? (e) => {
        e.currentTarget.style.transform = 'none';
        e.currentTarget.style.boxShadow = 'none';
        e.currentTarget.style.borderColor = '#e5e7eb';
      } : undefined}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <div style={{
          width: 24, height: 24, borderRadius: 7,
          background: bgColor,
          border: `1px solid ${accentColor}44`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: accentColor, fontSize: 13, fontWeight: 800, flexShrink: 0,
        }}>{icon}</div>
        <div style={{
          fontSize: 10, letterSpacing: 1.3, textTransform: 'uppercase',
          color: accentColor, fontWeight: 800,
        }}>{label}</div>
      </div>
      <div style={{
        fontSize: 19, fontWeight: 800, color: '#0A3558', lineHeight: 1.15,
        marginBottom: 3, letterSpacing: -0.2,
      }}>{value}</div>
      {primarySub && (
        <div style={{ fontSize: 12, fontWeight: 700, color: accentColor, marginBottom: 3 }}>
          {primarySub}
        </div>
      )}
      <div style={{ fontSize: 10.5, color: '#64748b', lineHeight: 1.4 }}>{sub}</div>
      {interactive && (
        <div style={{
          marginTop: 8, paddingTop: 7, borderTop: `1px dashed ${accentColor}33`,
          fontSize: 10, fontWeight: 700, color: accentColor, letterSpacing: 0.3,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <span>{actionLabel || 'Click to apply'}</span>
          <span style={{ fontSize: 13 }}>→</span>
        </div>
      )}
    </div>
  );
}

// ══════════════════ ReviewForecastCards ═══════════════════════════════
//
// Visual wall of reviews that would appear on TripAdvisor / Booking / Google
// in the next 90 days if the decision ships. Each card is styled to match
// the respective platform so the consultant can show it to their client and
// say "this is the review wall you're going to see".

function ReviewForecastCards({ forecast }) {
  const [filter, setFilter] = useState('all'); // all | positive | negative
  if (!forecast || forecast.error || !forecast.reviews || forecast.reviews.length === 0) {
    return (
      <div style={{ fontSize: 12, color: '#6b7888', fontStyle: 'italic', padding: 20, textAlign: 'center' }}>
        {forecast?.note || 'No review forecast available — configure audience + decision'}
      </div>
    );
  }

  const reviews = forecast.reviews.filter((r) => {
    if (filter === 'all') return true;
    if (filter === 'positive') return r.stars >= 4;
    if (filter === 'negative') return r.stars <= 2;
    return true;
  });

  const starDelta = forecast.star_delta;
  const starDeltaColor = starDelta >= 0.1 ? '#059669' : starDelta <= -0.1 ? '#dc2626' : '#6b7888';

  return (
    <div>
      {/* Headline stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginBottom: 14 }}>
        <StatPill label="Expected avg ★" value={forecast.expected_avg_star?.toFixed(2) || '—'} sub={`baseline ${forecast.baseline_star?.toFixed(2)}`} color="#0F4C75" />
        <StatPill label="Δ vs baseline" value={`${starDelta >= 0 ? '+' : ''}${starDelta?.toFixed(2)}★`} sub="90-day forecast" color={starDeltaColor} />
        <StatPill label="Review volume Δ" value={`${forecast.volume_forecast_pct >= 0 ? '+' : ''}${forecast.volume_forecast_pct?.toFixed(1)}%`} sub="vs prior period" color={forecast.volume_forecast_pct >= 0 ? '#059669' : '#dc2626'} />
        <StatPill label="Breakdown" value={`${forecast.tier_breakdown.love}★★★★★ · ${forecast.tier_breakdown.bad + forecast.tier_breakdown.angry}★★☆`} sub={`n = ${forecast.reviews.length}`} color="#6b7888" />
      </div>

      {/* Filter pills */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        {[['all', 'All'], ['positive', 'Positive (4-5★)'], ['negative', 'Negative (1-2★)']].map(([k, lbl]) => (
          <button
            key={k}
            onClick={() => setFilter(k)}
            style={{
              padding: '6px 12px', borderRadius: 16,
              background: filter === k ? '#0F4C75' : 'white',
              color: filter === k ? 'white' : '#374151',
              border: `1px solid ${filter === k ? '#0F4C75' : '#e5e7eb'}`,
              fontSize: 11, fontWeight: 600, cursor: 'pointer',
            }}
          >
            {lbl}
          </button>
        ))}
        <div style={{ flex: 1 }} />
        <div style={{ fontSize: 10, color: '#6b7888', alignSelf: 'center', fontStyle: 'italic' }}>
          Reviews shown are forecast — written by the synthetic cohort to demonstrate the narrative wall you\'ll see
        </div>
      </div>

      {/* Cards grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 12 }}>
        {reviews.map((r, i) => <ReviewCard key={i} review={r} />)}
      </div>
    </div>
  );
}

function ReviewCard({ review }) {
  const platformStyle = {
    tripadvisor: { bg: '#00AF87', text: 'Tripadvisor', logo: '◎' },
    booking: { bg: '#003580', text: 'Booking.com', logo: 'B.' },
    google: { bg: '#4285F4', text: 'Google', logo: 'G' },
  }[review.platform] || { bg: '#6b7888', text: review.platform, logo: '' };

  const d = new Date(review.date);
  const dateFmt = d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

  const tierBg = {
    love: 'white',
    fine: 'white',
    bad: '#fffbeb',
    angry: '#fef2f2',
  }[review.tier] || 'white';
  const tierBorder = {
    love: '#d1fae5',
    fine: '#e5e7eb',
    bad: '#fde68a',
    angry: '#fecaca',
  }[review.tier] || '#e5e7eb';

  return (
    <div style={{
      background: tierBg, border: `1px solid ${tierBorder}`, borderRadius: 8,
      padding: '14px 16px', display: 'flex', flexDirection: 'column',
      boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
    }}>
      {/* Platform ribbon */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{
            background: platformStyle.bg, color: 'white',
            padding: '2px 8px', borderRadius: 4, fontSize: 10, fontWeight: 700, letterSpacing: 0.4,
          }}>
            {platformStyle.logo} {platformStyle.text}
          </span>
          <span style={{ fontSize: 10, color: '#6b7888' }}>{dateFmt}</span>
        </div>
        <Stars n={review.stars} scale={review.rating_scale === 10 ? `${review.rating.toFixed(1)}/10` : null} />
      </div>

      {/* Reviewer */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6, fontSize: 11, color: '#374151' }}>
        <span style={{ fontWeight: 600 }}>{review.reviewer_name}</span>
        <span style={{ color: '#9ca3af' }}>·</span>
        <span style={{ color: '#6b7888' }}>{flagEmoji(review.country_code)} {review.country_label}</span>
        <span style={{ color: '#9ca3af' }}>·</span>
        <span style={{ color: '#6b7888' }}>{review.trip_type}</span>
      </div>

      {/* Title */}
      <div style={{ fontSize: 13, fontWeight: 700, color: '#1a1d23', marginBottom: 6, lineHeight: 1.3 }}>
        {review.title}
      </div>

      {/* Body */}
      <div style={{ fontSize: 12, color: '#374151', lineHeight: 1.5, flex: 1 }}>
        {review.body}
      </div>

      {/* Archetype chip */}
      <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{
          fontSize: 9, letterSpacing: 0.6, textTransform: 'uppercase', color: '#6b7888', fontWeight: 600,
          background: '#f0f1f4', padding: '2px 8px', borderRadius: 10,
        }}>
          {review.archetype.replace(/_/g, ' ')}
        </span>
        <span style={{ fontSize: 9, color: '#9ca3af', fontStyle: 'italic' }}>
          synthetic · forecast
        </span>
      </div>
    </div>
  );
}

function Stars({ n, scale }) {
  if (scale) {
    return <span style={{ fontSize: 11, fontWeight: 700, color: '#003580' }}>{scale}</span>;
  }
  return (
    <div style={{ display: 'flex', gap: 1 }}>
      {[1,2,3,4,5].map((s) => (
        <span key={s} style={{ color: s <= n ? '#f59e0b' : '#e5e7eb', fontSize: 14 }}>★</span>
      ))}
    </div>
  );
}

function flagEmoji(code) {
  if (!code || code.length !== 2) return '';
  const offset = 0x1F1E6 - 'A'.charCodeAt(0);
  return String.fromCodePoint(code.charCodeAt(0) + offset) + String.fromCodePoint(code.charCodeAt(1) + offset);
}

function StatPill({ label, value, sub, color }) {
  return (
    <div style={{ background: 'white', border: '1px solid #e5e7eb', borderRadius: 6, padding: '8px 10px' }}>
      <div style={{ fontSize: 9, letterSpacing: 1, textTransform: 'uppercase', color: '#6b7888', fontWeight: 700 }}>{label}</div>
      <div style={{ fontSize: 16, fontWeight: 800, color, marginTop: 2 }}>{value}</div>
      {sub && <div style={{ fontSize: 9, color: '#9ca3af', marginTop: 1 }}>{sub}</div>}
    </div>
  );
}

// ══════════════════ CompetitorMatrixGrid ══════════════════════════════

function CompetitorMatrixGrid({ matrix, data }) {
  if (!matrix || !data) {
    return <div style={{ padding: 20, fontSize: 12, color: '#6b7888', textAlign: 'center', fontStyle: 'italic' }}>Loading game-theory matrix…</div>;
  }
  if (data.error) {
    return <div style={{ padding: 20, fontSize: 12, color: '#b91c1c', textAlign: 'center' }}>{data.error}</div>;
  }

  const fmt = (n) => {
    if (n == null) return '—';
    const s = n >= 0 ? '+' : '−';
    const a = Math.abs(n);
    if (a >= 1_000_000) return `${s}€${(a / 1_000_000).toFixed(2)}M`;
    if (a >= 1_000) return `${s}€${(a / 1_000).toFixed(0)}K`;
    return `${s}€${Math.round(a)}`;
  };

  const verdictColors = {
    HIGH_PRIORITY: '#059669',
    PROCEED: '#22c55e',
    CAUTION: '#d97706',
    NOT_RECOMMENDED: '#dc2626',
  };

  const nashIdx = data.nash_equilibrium ? { row: data.nash_equilibrium.row, col: data.nash_equilibrium.col } : null;
  const dominantIdx = data.dominant_strategy?.row_idx;

  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: '180px repeat(3, 1fr)', gap: 6, marginBottom: 14 }}>
        {/* Header row */}
        <div />
        {data.competitor_reactions.map((c, i) => (
          <div key={i} style={{
            background: '#f6f7f9', padding: '10px 12px', borderRadius: 6,
            fontSize: 11, fontWeight: 700, color: '#374151', textAlign: 'center',
          }}>
            {c.label}
          </div>
        ))}

        {/* Rows */}
        {matrix.map((row, ri) => (
          <FragmentWithKey key={ri}>
            <div style={{
              background: ri === dominantIdx ? '#ecfdf5' : '#f6f7f9',
              padding: '10px 12px', borderRadius: 6,
              fontSize: 11, fontWeight: 700, color: ri === dominantIdx ? '#059669' : '#374151',
              display: 'flex', alignItems: 'center',
              border: ri === dominantIdx ? '1px solid #a7f3d0' : 'none',
            }}>
              {ri === dominantIdx && (
                <span style={{
                  marginRight: 6, padding: '1px 6px', borderRadius: 4,
                  background: '#059669', color: 'white',
                  fontSize: 9, fontWeight: 800, letterSpacing: 0.8,
                }}>DOM</span>
              )}
              {data.your_options[ri].label}
            </div>
            {row.map((cell, ci) => {
              const color = verdictColors[cell.verdict] || '#6b7888';
              const isNash = nashIdx && nashIdx.row === ri && nashIdx.col === ci;
              return (
                <div key={ci} style={{
                  background: 'white',
                  border: isNash ? `2px solid #0F4C75` : `1px solid ${color}44`,
                  borderLeft: `4px solid ${color}`,
                  borderRadius: 6, padding: '12px 14px',
                  position: 'relative',
                }}>
                  {isNash && (
                    <span style={{
                      position: 'absolute', top: -8, right: 8,
                      background: '#0F4C75', color: 'white', padding: '2px 8px',
                      borderRadius: 10, fontSize: 9, fontWeight: 700, letterSpacing: 0.6,
                    }}>
                      NASH
                    </span>
                  )}
                  <div style={{ fontSize: 18, fontWeight: 800, color, marginBottom: 4 }}>
                    {fmt(cell.net_eur)}
                  </div>
                  <div style={{ fontSize: 9, letterSpacing: 0.6, textTransform: 'uppercase', color, fontWeight: 700 }}>
                    {cell.verdict.replace('_', ' ')}
                  </div>
                  <div style={{ fontSize: 10, color: '#6b7888', marginTop: 6, display: 'flex', justifyContent: 'space-between' }}>
                    <span>ST {fmt(cell.short_term_eur)}</span>
                    <span>LT {fmt(cell.long_term_eur)}</span>
                  </div>
                  {cell.gap_pct !== 0 && (
                    <div style={{ fontSize: 9, color: '#9ca3af', marginTop: 4 }}>
                      gap: {cell.gap_pct >= 0 ? '+' : ''}{cell.gap_pct}pp
                    </div>
                  )}
                </div>
              );
            })}
          </FragmentWithKey>
        ))}
      </div>

      {/* Summary / interpretation */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
        <AnnotationCard
          icon="▲"
          label="Dominant strategy"
          value={data.dominant_strategy?.label || '—'}
          sub={data.dominant_strategy ? `Worst-case net ≥ ${fmt(data.dominant_strategy.min_guaranteed_net_eur)} regardless of competitor move` : ''}
          color="#047857"
          bg="#d1fae5"
          accent="#059669"
        />
        <AnnotationCard
          icon="="
          label="Nash equilibrium"
          value={data.nash_equilibrium ? `Row ${data.nash_equilibrium.row + 1}, Col ${data.nash_equilibrium.col + 1}` : 'None in matrix'}
          sub={data.nash_equilibrium ? `${fmt(data.nash_equilibrium.cell.net_eur)} — neither side can unilaterally improve` : 'no stable joint outcome in this 3×3 set'}
          color="#0A3558"
          bg="#e0e7ff"
          accent="#0F4C75"
        />
        <AnnotationCard
          icon="⚠"
          label="Your plan worst case"
          value={fmt(data.current_plan_worst_case_eur)}
          sub="if competitor picks the move that hurts you most"
          color="#92400e"
          bg="#fef3c7"
          accent="#d97706"
        />
      </div>

      <div style={{
        marginTop: 12, padding: '10px 12px',
        background: '#fef7e0', border: '1px solid #fde68a', borderLeft: '4px solid #d97706',
        borderRadius: 4, fontSize: 11, color: '#78350f', lineHeight: 1.5,
      }}>
        <strong>How to read this.</strong> Rows are YOUR rate options. Columns are how the competitor could react.
        The <strong>DOM</strong> (dominant) strategy is the row with the best worst-case outcome — it's your safest play if the competitor
        is adversarial. The <strong>NASH</strong> cell is where neither side has an incentive to change move unilaterally.
        Click any cell to jump to that rate and see the full preview recalculate.
      </div>
    </div>
  );
}

// ══════════════════ SegmentDrilldownRich (for DecisionInsightsPanel) ═══

function SegmentDrilldownRich({ segment, archetype, topCluster, interviewMessages, onAskQuestion }) {
  const [q, setQ] = useState('');
  const [asking, setAsking] = useState(false);
  const send = async () => {
    if (!q.trim() || asking) return;
    setAsking(true);
    const cur = q;
    setQ('');
    await onAskQuestion(cur);
    setAsking(false);
  };

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, paddingTop: 14 }}>
      {/* Left: narratives */}
      <div>
        <div style={{ fontSize: 10, letterSpacing: 1, textTransform: 'uppercase', color: '#6b7888', fontWeight: 700, marginBottom: 8 }}>
          Sample traveler quotes · copy into client report
        </div>
        {segment.sample_narratives?.length > 0 ? (
          segment.sample_narratives.map((n, i) => (
            <div key={i} style={{
              padding: '10px 12px', marginBottom: 6, background: 'white',
              borderLeft: '3px solid #c084fc', borderRadius: 4,
              fontSize: 12, color: '#374151', fontStyle: 'italic', lineHeight: 1.55,
            }}>
              "{n}"
            </div>
          ))
        ) : (
          <div style={{ fontSize: 12, color: '#9ca3af', fontStyle: 'italic' }}>No narratives available yet.</div>
        )}
      </div>

      {/* Right: interview chat */}
      <div>
        <div style={{ fontSize: 10, letterSpacing: 1, textTransform: 'uppercase', color: '#6b7888', fontWeight: 700, marginBottom: 8 }}>
          Ask this synthetic guest anything
        </div>
        <div style={{
          background: 'white', border: '1px solid #e5e7eb', borderRadius: 6,
          padding: 10, minHeight: 120,
        }}>
          {interviewMessages.length === 0 && (
            <div style={{ fontSize: 11, color: '#9ca3af', fontStyle: 'italic', padding: '8px 0' }}>
              Try: "what if we raised the rate 8%?" or "would breakfast be enough to change your mind?"
            </div>
          )}
          {interviewMessages.map((m, i) => (
            <div key={i} style={{
              fontSize: 12, padding: '6px 10px', marginBottom: 6, borderRadius: 4,
              background: m.role === 'user' ? '#e0e7ff' : '#f0fdf4',
              color: m.role === 'user' ? '#312e81' : '#064e3b',
              borderLeft: m.role === 'user' ? '2px solid #4f46e5' : '2px solid #0a8754',
              lineHeight: 1.55,
            }}>
              {m.role === 'user' ? (
                <><strong style={{ fontSize: 9, letterSpacing: 0.5, textTransform: 'uppercase', color: '#4338ca' }}>You:</strong> {m.text}</>
              ) : (
                <>
                  {m.speaker && <div style={{ fontSize: 10, color: '#0a8754', fontWeight: 700, marginBottom: 3 }}>{m.speaker}, {m.age}:</div>}
                  {m.text}
                </>
              )}
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
          <input
            type="text"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') send(); }}
            placeholder="type a question…"
            style={{
              flex: 1, padding: '8px 10px', fontSize: 12, border: '1px solid #d1d5db',
              borderRadius: 4, background: 'white',
            }}
          />
          <button
            onClick={send}
            disabled={asking || !q.trim()}
            style={{
              padding: '8px 16px', background: asking || !q.trim() ? '#9ca3af' : '#0F4C75',
              color: 'white', border: 0, borderRadius: 4, fontSize: 12, fontWeight: 600,
              cursor: asking || !q.trim() ? 'not-allowed' : 'pointer',
            }}
          >
            {asking ? '…' : 'Ask'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ══════════════════ SensitivityChart (legacy small version) ══════════

function SensitivityChart({ data, loading }) {
  if (loading && !data) {
    return <div style={{ padding: '14px 0', fontSize: 11, color: '#6b7888' }}>Sweeping parameter range…</div>;
  }
  if (!data || data.error) {
    return <div style={{ padding: '14px 0', fontSize: 11, color: '#b91c1c' }}>{data?.error || 'No data'}</div>;
  }
  const points = data.points || [];
  if (points.length === 0) return null;
  const maxY = Math.max(...points.map(p => Math.abs(p.net_eur)), 1);
  const w = 320;
  const h = 120;
  const padL = 32, padR = 10, padT = 8, padB = 20;
  const plotW = w - padL - padR;
  const plotH = h - padT - padB;
  const xScale = (i) => padL + (i / (points.length - 1)) * plotW;
  const yScale = (v) => padT + plotH / 2 - (v / maxY) * (plotH / 2);

  // Build path for net_eur line
  const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${xScale(i)} ${yScale(p.net_eur)}`).join(' ');
  // Current value marker
  const currentIdx = points.findIndex(p => p.x === data.current_value);
  const colors = { HIGH_PRIORITY: '#0a8754', PROCEED: '#22c55e', CAUTION: '#d97706', NOT_RECOMMENDED: '#b91c1c' };

  return (
    <div style={{ marginTop: 10 }}>
      <svg width="100%" viewBox={`0 0 ${w} ${h}`} style={{ display: 'block' }}>
        {/* Zero line */}
        <line x1={padL} y1={yScale(0)} x2={w - padR} y2={yScale(0)} stroke="#d1d5db" strokeWidth="1" strokeDasharray="3,3" />
        {/* Color-coded background bands (verdict zones) */}
        {points.map((p, i) => {
          if (i === points.length - 1) return null;
          const x1 = xScale(i);
          const x2 = xScale(i + 1);
          return <rect key={i} x={x1} y={padT} width={x2 - x1} height={plotH} fill={colors[p.verdict] || '#e5e7eb'} fillOpacity="0.08" />;
        })}
        {/* Path */}
        <path d={path} stroke="#0F4C75" strokeWidth="2" fill="none" />
        {/* Points */}
        {points.map((p, i) => (
          <circle key={i} cx={xScale(i)} cy={yScale(p.net_eur)} r={i === currentIdx ? 5 : 3}
            fill={colors[p.verdict] || '#6b7888'} stroke="white" strokeWidth={i === currentIdx ? 2 : 0} />
        ))}
        {/* X axis labels */}
        <text x={padL} y={h - 4} fontSize="9" fill="#6b7888">{points[0].x}</text>
        <text x={w - padR} y={h - 4} fontSize="9" fill="#6b7888" textAnchor="end">{points[points.length - 1].x}</text>
        {/* Y axis labels */}
        <text x={padL - 4} y={yScale(0) + 3} fontSize="9" fill="#6b7888" textAnchor="end">€0</text>
        <text x={padL - 4} y={padT + 6} fontSize="9" fill="#6b7888" textAnchor="end">+{(maxY / 1_000_000).toFixed(1)}M</text>
        <text x={padL - 4} y={h - padB - 4} fontSize="9" fill="#6b7888" textAnchor="end">−{(maxY / 1_000_000).toFixed(1)}M</text>
      </svg>
      <div style={{ fontSize: 11, color: '#374151', marginTop: 8, lineHeight: 1.5 }}>
        <div><strong>Optimal:</strong> {data.sweep_param} = {data.optimal.x} → net {data.optimal.net_eur >= 0 ? '+' : '−'}€{(Math.abs(data.optimal.net_eur) / 1000).toFixed(0)}K · <span style={{ color: colors[data.optimal.verdict] }}>{data.optimal.verdict.replace('_', ' ')}</span></div>
        {data.break_point && (
          <div style={{ marginTop: 2 }}>
            <strong>Breaks at:</strong> {data.sweep_param} ≈ {data.break_point.estimated} (between {data.break_point.between[0]} and {data.break_point.between[1]})
          </div>
        )}
        <div style={{ marginTop: 4, fontSize: 10, color: '#6b7888' }}>
          Your current input: {data.sweep_param} = {data.current_value}
        </div>
      </div>
    </div>
  );
}

// ══════════════════ ExplainModal ══════════════════════════════════════

function ExplainModal({ explain, onClose }) {
  const fmtEur = (n) => {
    if (n == null) return '—';
    const sign = n >= 0 ? '+' : '−';
    const abs = Math.abs(n);
    if (abs >= 1_000_000) return `${sign}€${(abs / 1_000_000).toFixed(2)}M`;
    if (abs >= 1_000) return `${sign}€${(abs / 1_000).toFixed(0)}K`;
    return `${sign}€${Math.round(abs)}`;
  };

  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, background: 'rgba(10,13,20,0.65)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      zIndex: 9998, backdropFilter: 'blur(4px)',
    }}>
      <div onClick={(e) => e.stopPropagation()} style={{
        background: 'white', borderRadius: 12, padding: '22px 26px',
        maxWidth: 720, width: '92%', maxHeight: '90vh', overflowY: 'auto',
        boxShadow: '0 25px 60px rgba(0,0,0,0.4)',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
          <div>
            <div style={{ fontSize: 10, letterSpacing: 1.4, textTransform: 'uppercase', color: '#6b7888', fontWeight: 700 }}>
              Math breakdown
            </div>
            <div style={{ fontSize: 20, fontWeight: 800, color: '#0A3558', marginTop: 4 }}>
              How we computed Net LTV = {fmtEur(explain.final?.net_eur)}
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'transparent', border: 0, fontSize: 22, cursor: 'pointer', color: '#6b7888' }}>×</button>
        </div>

        {/* Inputs */}
        <Section title="1. Inputs">
          <KV label="Decision magnitude" value={`${explain.inputs?.magnitude_pct >= 0 ? '+' : ''}${explain.inputs?.magnitude_pct}%`} />
          <KV label="Timing" value={explain.inputs?.timing} />
          <KV label="Scope" value={explain.inputs?.scope?.type === 'all' ? 'All guests' : `${explain.inputs?.scope?.type}: ${explain.inputs?.scope?.value}`} />
          <KV label="Baseline annual revenue" value={`€${(explain.inputs?.baseline_annual_revenue_eur / 1_000_000).toFixed(2)}M`} />
          <KV label="Timing revenue share" value={`${explain.inputs?.timing_revenue_share_pct}%`} />
          <KV label="Cultural book delta (audience-weighted)" value={`${explain.inputs?.cultural_book_delta_pct >= 0 ? '+' : ''}${explain.inputs?.cultural_book_delta_pct}%`} />
        </Section>

        {/* Per-archetype */}
        <Section title="2. Per-archetype response">
          <div style={{ fontSize: 11, color: '#6b7888', marginBottom: 6 }}>
            Each archetype responds to the price change through its own elasticity ε, weighted by its share of the cohort.
          </div>
          <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: '#f6f7f9', fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.6 }}>
                <th style={{ textAlign: 'left', padding: 6 }}>Archetype</th>
                <th style={{ textAlign: 'right', padding: 6 }}>Weight</th>
                <th style={{ textAlign: 'right', padding: 6 }}>ε</th>
                <th style={{ textAlign: 'left', padding: 6 }}>Formula</th>
                <th style={{ textAlign: 'right', padding: 6 }}>Contribution</th>
              </tr>
            </thead>
            <tbody>
              {(explain.archetype_steps || []).map((s, i) => (
                <tr key={i} style={{ borderBottom: '1px solid #f0f1f4' }}>
                  <td style={{ padding: 6 }}>{s.archetype.replace(/_/g, ' ')}</td>
                  <td style={{ padding: 6, textAlign: 'right' }}>{s.weight}</td>
                  <td style={{ padding: 6, textAlign: 'right' }}>{s.elasticity}</td>
                  <td style={{ padding: 6, fontFamily: 'Consolas, Monaco, monospace', fontSize: 10, color: '#4b5563' }}>{s.formula}</td>
                  <td style={{ padding: 6, textAlign: 'right', fontWeight: 600, color: s.result_pct < 0 ? '#b91c1c' : '#0a8754' }}>
                    {s.result_pct >= 0 ? '+' : ''}{s.result_pct}%
                  </td>
                </tr>
              ))}
              <tr style={{ background: '#eef2ff', fontWeight: 700 }}>
                <td colSpan="4" style={{ padding: 6, textAlign: 'right' }}>Aggregate booking Δ:</td>
                <td style={{ padding: 6, textAlign: 'right' }}>{explain.aggregate?.aggregate_booking_delta_pct >= 0 ? '+' : ''}{explain.aggregate?.aggregate_booking_delta_pct}%</td>
              </tr>
            </tbody>
          </table>
        </Section>

        {/* Short-term derivation */}
        <Section title="3. Short-term revenue derivation">
          <div style={{ fontSize: 11, fontFamily: 'Consolas, Monaco, monospace', background: '#f6f7f9', padding: '8px 10px', borderRadius: 4, color: '#374151' }}>
            {explain.short_term_derivation?.formula}
          </div>
          <KV label="new_rate_factor" value={explain.short_term_derivation?.new_rate_factor} />
          <KV label="new_bookings_factor" value={explain.short_term_derivation?.new_bookings_factor} />
          <KV label="revenue_change_pct" value={`${explain.short_term_derivation?.revenue_change_pct >= 0 ? '+' : ''}${explain.short_term_derivation?.revenue_change_pct}%`} />
          <KV label="Short-term result" value={fmtEur(explain.short_term_derivation?.result_eur)} bold />
        </Section>

        {/* Long-term */}
        <Section title="4. Long-term (LTV) derivation">
          <div style={{ fontSize: 11, color: '#6b7888', marginBottom: 6 }}>
            Price changes hit reviews → reviews shift star/NPS → NPS shifts repeat rate and viral share → LTV impact over 3 years.
          </div>
          <KV label="Weighted repeat base" value={`${explain.long_term_derivation?.weighted_repeat_base_pct}%`} />
          <KV label="Weighted viral coefficient" value={`${explain.long_term_derivation?.weighted_viral_pct}%`} />
          <KV label="ΔNPS (all segments)" value={`${explain.long_term_derivation?.nps_delta >= 0 ? '+' : ''}${explain.long_term_derivation?.nps_delta}`} />
          <KV label="Repeat rate delta" value={`${explain.long_term_derivation?.repeat_rate_delta_pct >= 0 ? '+' : ''}${explain.long_term_derivation?.repeat_rate_delta_pct}%`} />
          <KV label="3-yr LTV via repeat" value={fmtEur(explain.long_term_derivation?.three_year_ltv_via_repeat_eur)} />
          <KV label="LTV via viral share" value={fmtEur(explain.long_term_derivation?.viral_ltv_eur)} />
          <KV label="Long-term total" value={fmtEur(explain.long_term_derivation?.result_eur)} bold />
        </Section>

        {/* Final */}
        <Section title="5. Final">
          <div style={{ fontSize: 11, fontFamily: 'Consolas, Monaco, monospace', background: '#f6f7f9', padding: '8px 10px', borderRadius: 4, color: '#374151' }}>
            Net LTV = {fmtEur(explain.final?.short_term_eur)} + {fmtEur(explain.final?.long_term_eur)} = <strong>{fmtEur(explain.final?.net_eur)}</strong>
          </div>
        </Section>

        <div style={{ marginTop: 14, padding: '10px 12px', background: '#fef7e0', border: '1px solid #fde68a', borderRadius: 4, fontSize: 11, color: '#78350f' }}>
          <strong>Note.</strong> All coefficients (elasticity, cultural modifiers, viral share, repeat rate) are published values from
          Cornell HQ, Vives &amp; Jacob 2023, Garín-Muñoz, and INE EGATUR 2024 — not tuned to produce a specific result.
          The full benchmark provenance is in Section 07 of the validation report.
        </div>
      </div>
    </div>
  );
}

function Section({ title, children }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ fontSize: 11, letterSpacing: 1, textTransform: 'uppercase', color: '#0A3558', fontWeight: 700, marginBottom: 8 }}>
        {title}
      </div>
      {children}
    </div>
  );
}

function KV({ label, value, bold = false }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, padding: '4px 0', borderBottom: '1px solid #f0f1f4' }}>
      <span style={{ color: '#6b7888' }}>{label}</span>
      <span style={{ fontWeight: bold ? 700 : 500, color: '#1a1d23' }}>{value}</span>
    </div>
  );
}

// ══════════════════ SegmentDrilldown ══════════════════════════════════

function SegmentDrilldown({ segment, archetype, topCluster, interviewMessages, onAskQuestion }) {
  const [q, setQ] = useState('');
  const [asking, setAsking] = useState(false);
  const send = async () => {
    if (!q.trim() || asking) return;
    setAsking(true);
    const cur = q;
    setQ('');
    await onAskQuestion(cur);
    setAsking(false);
  };

  return (
    <div style={{ margin: '6px 0 12px 24px', padding: '10px 12px', background: '#f9fafb', borderRadius: 6, borderLeft: '3px solid #0F4C75' }}>
      {/* Narrative samples */}
      {segment.sample_narratives?.length > 0 && (
        <div style={{ marginBottom: 10 }}>
          <div style={{ fontSize: 10, letterSpacing: 1, textTransform: 'uppercase', color: '#6b7888', fontWeight: 700, marginBottom: 6 }}>
            Sample traveler narratives · citable quotes
          </div>
          {segment.sample_narratives.map((n, i) => (
            <div key={i} style={{
              padding: '6px 10px', marginBottom: 4, background: 'white',
              borderLeft: '2px solid #c084fc', borderRadius: 3,
              fontSize: 11, color: '#374151', fontStyle: 'italic', lineHeight: 1.5,
            }}>
              "{n}"
            </div>
          ))}
        </div>
      )}

      {/* Interview chat */}
      <div style={{ marginTop: 8 }}>
        <div style={{ fontSize: 10, letterSpacing: 1, textTransform: 'uppercase', color: '#6b7888', fontWeight: 700, marginBottom: 6 }}>
          Ask this synthetic guest anything
        </div>
        {interviewMessages.length > 0 && (
          <div style={{ maxHeight: 220, overflowY: 'auto', marginBottom: 6 }}>
            {interviewMessages.map((m, i) => (
              <div key={i} style={{
                fontSize: 11, padding: '5px 8px', marginBottom: 4, borderRadius: 4,
                background: m.role === 'user' ? '#e0e7ff' : 'white',
                color: m.role === 'user' ? '#312e81' : '#1a1d23',
                borderLeft: m.role === 'user' ? '2px solid #4f46e5' : '2px solid #0a8754',
                lineHeight: 1.5,
              }}>
                {m.role === 'user' ? (
                  <>
                    <strong style={{ fontSize: 9, letterSpacing: 0.5, textTransform: 'uppercase' }}>You:</strong> {m.text}
                  </>
                ) : (
                  <>
                    {m.speaker && <div style={{ fontSize: 9, color: '#0a8754', fontWeight: 700, marginBottom: 2 }}>{m.speaker}, {m.age}:</div>}
                    {m.text}
                  </>
                )}
              </div>
            ))}
          </div>
        )}
        <div style={{ display: 'flex', gap: 6 }}>
          <input
            type="text"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') send(); }}
            placeholder="e.g. what would you do if we raised the rate 8%?"
            style={{
              flex: 1, padding: '6px 10px', fontSize: 11, border: '1px solid #d1d5db',
              borderRadius: 4, background: 'white',
            }}
          />
          <button
            onClick={send}
            disabled={asking || !q.trim()}
            style={{
              padding: '6px 12px', background: asking || !q.trim() ? '#9ca3af' : '#0F4C75',
              color: 'white', border: 0, borderRadius: 4, fontSize: 11, fontWeight: 600,
              cursor: asking || !q.trim() ? 'not-allowed' : 'pointer',
            }}
          >
            {asking ? '...' : 'Ask'}
          </button>
        </div>
      </div>
    </div>
  );
}
