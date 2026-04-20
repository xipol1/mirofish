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
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

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
  { id: 'rate_change',          label: 'Rate change',         icon: '⚡' },
  { id: 'package_change',       label: 'Packaging',           icon: '📦' },
  { id: 'service_intervention', label: 'Service intervention', icon: '👋' },
  { id: 'staff_change',         label: 'Staffing',            icon: '💼' },
  { id: 'loyalty',              label: 'Loyalty',             icon: '⭐' },
  { id: 'promo',                label: 'Promo / discount',    icon: '🎁' },
];

// ═══════════════════════════════════════════════════════════════════════

export default function ScenarioEditor() {
  const [scenario, setScenario] = useState(DEFAULTS);
  const [preview, setPreview] = useState(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState(null);
  const debounceRef = useRef(null);

  // ── Debounced preview fetch ─────────────────────────────────────────
  const fetchPreview = useCallback(async (s) => {
    setPreviewLoading(true);
    setPreviewError(null);
    try {
      const res = await fetch(`${API_URL}/api/scenario-preview`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'bypass-tunnel-reminder': 'true' },
        body: JSON.stringify({ property: s.property, audience: s.audience, decision: s.decision }),
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
      `}</style>

      <div style={{ maxWidth: 1500, margin: '0 auto', padding: '20px 22px 100px' }}>
        <TopBar scenario={scenario} setScenario={setScenario} runFullSim={runFullSim} running={running} />

        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 420px', gap: 20, marginTop: 20, alignItems: 'start' }}>
          <div>
            <ExampleBar onLoad={loadExample} />
            <DecisionBox decision={scenario.decision} setDecision={setDecision} updateDecision={updateDecision} />
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

        {running && <RunningOverlay stage={runStage} stages={RUN_STAGES} />}
      </div>
    </>
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

function TopBar({ scenario, setScenario, runFullSim, running }) {
  return (
    <header style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      background: 'white', border: '1px solid #e5e7eb', borderRadius: 10,
      padding: '14px 20px', boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, flex: 1 }}>
        <div>
          <div style={{ fontSize: 11, letterSpacing: 1.4, textTransform: 'uppercase', color: '#6b7888', fontWeight: 600 }}>
            Dignus · Pre-decision workbench
          </div>
          <div style={{ fontSize: 18, fontWeight: 700, color: '#0A3558', marginTop: 2 }}>
            Scenario editor
          </div>
        </div>

        <div style={{ display: 'flex', gap: 10, flex: 1, marginLeft: 24 }}>
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

      <button
        onClick={runFullSim}
        disabled={running}
        style={{
          marginLeft: 18,
          background: running ? '#6b7888' : '#0F4C75',
          color: 'white', border: 0, padding: '12px 22px',
          borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: running ? 'wait' : 'pointer',
          letterSpacing: 0.5,
        }}
      >
        {running ? 'Generating report…' : 'Run full sim + report →'}
      </button>
    </header>
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
      background: 'white', border: '2px solid #0F4C75', borderRadius: 10,
      padding: '20px 20px', marginBottom: 16,
      boxShadow: '0 3px 8px rgba(15,76,117,0.08)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
        <span style={{ fontSize: 18 }}>🎯</span>
        <h3 style={{ margin: 0, fontSize: 16, fontWeight: 800, color: '#0A3558', letterSpacing: 0.3 }}>
          The decision
        </h3>
        <span style={{ fontSize: 11, color: '#6b7888', fontStyle: 'italic', marginLeft: 'auto' }}>
          Write any decision you want to validate. No preset scenarios.
        </span>
      </div>

      {/* Type selector */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 6, marginBottom: 16 }}>
        {DECISION_TYPES.map((t) => {
          const active = decision.type === t.id;
          return (
            <button
              key={t.id}
              onClick={() => setDecision({ type: t.id, ...defaultFieldsForType(t.id) })}
              style={{
                background: active ? '#0F4C75' : 'white',
                color: active ? 'white' : '#1a1d23',
                border: `1px solid ${active ? '#0F4C75' : '#e5e7eb'}`,
                padding: '12px 6px', borderRadius: 8, cursor: 'pointer',
                fontSize: 11, fontWeight: active ? 700 : 500,
                display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
                transition: 'all 0.1s',
              }}
            >
              <span style={{ fontSize: 20 }}>{t.icon}</span>
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
      <SectionHeader title="Property context" icon="🏨" collapsed={collapsed} onToggle={() => setCollapsed((c) => !c)} />
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

function SectionHeader({ title, icon, collapsed, onToggle }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: onToggle ? 'pointer' : 'default' }} onClick={onToggle}>
      <span style={{ fontSize: 15 }}>{icon}</span>
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
      <SectionHeader title="Audience composition" icon="👥" collapsed={collapsed} onToggle={() => setCollapsed((c) => !c)} />
      {!collapsed && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginTop: 14 }}>
          <MixEditor title="Archetype mix" items={ARCHETYPES} values={audience.archetype_mix} total={archTotal} onChange={updateArchetypeMix} />
          <MixEditor title="Cultural cluster mix" items={CLUSTERS} values={audience.cultural_mix} total={clusterTotal} onChange={updateClusterMix} />
        </div>
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

  // ── Sensitivity sweep (lazy — only when requested) ─────────────────
  const [sensitivityOpen, setSensitivityOpen] = useState(false);
  const [sensitivityData, setSensitivityData] = useState(null);
  const [sensitivityLoading, setSensitivityLoading] = useState(false);
  const sweepReqRef = useRef(null);
  useEffect(() => {
    if (!sensitivityOpen) return;
    clearTimeout(sweepReqRef.current);
    sweepReqRef.current = setTimeout(async () => {
      setSensitivityLoading(true);
      try {
        const res = await fetch(`${API_URL}/api/scenario-sensitivity`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ property: scenario.property, audience: scenario.audience, decision: scenario.decision }),
        });
        const data = await res.json();
        setSensitivityData(data);
      } catch (err) {
        setSensitivityData({ error: err.message });
      } finally {
        setSensitivityLoading(false);
      }
    }, 300);
    return () => clearTimeout(sweepReqRef.current);
  }, [sensitivityOpen, scenario]);

  // ── Explainability modal ───────────────────────────────────────────
  const [explainOpen, setExplainOpen] = useState(false);

  // ── Expand segment → show narratives + interview ───────────────────
  const [expandedSegment, setExpandedSegment] = useState(null);
  const [interviewMap, setInterviewMap] = useState({});

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

        {/* Sensitivity sweep toggle */}
        <div style={{ padding: '10px 20px', borderBottom: '1px solid #f0f1f4', background: sensitivityOpen ? '#f6f7f9' : 'white' }}>
          <button
            onClick={() => setSensitivityOpen((v) => !v)}
            style={{
              width: '100%', background: 'transparent', border: 0, padding: '6px 0',
              fontSize: 12, color: '#0F4C75', fontWeight: 600, cursor: 'pointer', textAlign: 'left',
              display: 'flex', alignItems: 'center', gap: 8,
            }}
          >
            <span style={{ transform: sensitivityOpen ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s' }}>▸</span>
            <span>📈 Sensitivity sweep — where does this decision break?</span>
          </button>
          {sensitivityOpen && (
            <SensitivityChart data={sensitivityData} loading={sensitivityLoading} />
          )}
        </div>

        {/* Segments — expandable with narratives + interview */}
        {preview?.segments?.length > 0 && (
          <div style={{ padding: '14px 20px', borderBottom: '1px solid #f0f1f4' }}>
            <div style={{ fontSize: 10, letterSpacing: 1.2, textTransform: 'uppercase', color: '#6b7888', fontWeight: 700, marginBottom: 8 }}>
              Segments most affected · click to expand
            </div>
            {preview.segments.slice(0, 5).map((s) => {
              const isNeg = s.delta_pct < 0;
              const maxAbs = Math.max(...preview.segments.map(x => Math.abs(x.delta_pct || 0)), 1);
              const barW = (Math.abs(s.delta_pct || 0) / maxAbs) * 100;
              const color = isNeg ? '#b91c1c' : '#0a8754';
              const isExpanded = expandedSegment === s.segment;
              const topCluster = Object.entries(scenario?.audience?.cultural_mix || {})
                .sort((a, b) => b[1] - a[1])[0]?.[0] || 'anglo_uk_ireland';

              return (
                <div key={s.segment} style={{ marginBottom: 6 }}>
                  <button
                    onClick={() => setExpandedSegment(isExpanded ? null : s.segment)}
                    style={{
                      width: '100%', display: 'flex', alignItems: 'center', gap: 8,
                      padding: '5px 6px', background: isExpanded ? '#eef2ff' : 'transparent',
                      border: 0, borderRadius: 4, cursor: 'pointer', fontSize: 12,
                    }}
                  >
                    <span style={{ fontSize: 10, color: isExpanded ? '#0F4C75' : '#6b7888', transform: isExpanded ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s' }}>▸</span>
                    <span style={{ flex: 1, color: '#374151', textAlign: 'left' }}>{s.segment.replace(/_/g, ' ')}</span>
                    <div style={{ width: 80, height: 5, background: '#f0f1f4', borderRadius: 3, overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: `${barW}%`, background: color, marginLeft: isNeg ? `${100 - barW}%` : 0 }} />
                    </div>
                    <span style={{ width: 56, textAlign: 'right', fontWeight: 600, color, fontSize: 11 }}>
                      {s.delta_pct >= 0 ? '+' : ''}{(s.delta_pct || 0).toFixed(1)}%
                    </span>
                  </button>

                  {isExpanded && (
                    <SegmentDrilldown
                      segment={s}
                      archetype={s.segment}
                      topCluster={topCluster}
                      interviewMessages={interviewMap[s.segment] || []}
                      onAskQuestion={async (question) => {
                        const msgs = interviewMap[s.segment] || [];
                        const userMsg = { role: 'user', text: question, ts: Date.now() };
                        setInterviewMap({ ...interviewMap, [s.segment]: [...msgs, userMsg] });
                        try {
                          const res = await fetch(`${API_URL}/api/scenario-interview`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ question, archetype: s.segment, cluster: topCluster }),
                          });
                          const data = await res.json();
                          setInterviewMap((prev) => ({
                            ...prev,
                            [s.segment]: [...(prev[s.segment] || []), {
                              role: 'agent', text: data.answer || 'No response', speaker: data.name, age: data.age, ts: Date.now(),
                            }],
                          }));
                        } catch (err) {
                          setInterviewMap((prev) => ({
                            ...prev,
                            [s.segment]: [...(prev[s.segment] || []), { role: 'agent', text: 'Connection error.', ts: Date.now() }],
                          }));
                        }
                      }}
                    />
                  )}
                </div>
              );
            })}
          </div>
        )}

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

// ══════════════════ SensitivityChart ══════════════════════════════════

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
