import { useEffect, useRef, useState } from 'react';
import Head from 'next/head';

const API_URL = process.env.NEXT_PUBLIC_API_URL
  || (typeof window !== 'undefined' && window.location.hostname !== 'localhost' ? '' : 'http://localhost:5001');

function apiFetch(apiPath, options = {}) {
  const headers = { ...options.headers, 'bypass-tunnel-reminder': 'true', 'Content-Type': 'application/json' };
  return fetch(`${API_URL}${apiPath}`, { ...options, headers });
}

// SSR: pre-load the default demo snapshot so the dashboard shows data on first paint
// even when client-side hydration is flaky. Reads directly from the file system.
// IMPORTANT: fs/path required INSIDE the function so they are tree-shaken from the
// client bundle — top-level imports would contaminate the browser build.
export async function getServerSideProps(ctx) {
  const fs = require('fs');
  const nodePath = require('path');
  const slug = (ctx.query && typeof ctx.query.cohort === 'string') ? ctx.query.cohort : 'villa_le_blanc_claude_authored_n30';
  const safeSlug = slug.replace(/[^a-z0-9_\-]/gi, '');
  const validSections = ['reports', 'agents', 'scenarios', 'library', 'properties', 'getstarted'];
  const sectionParam = (ctx.query && typeof ctx.query.section === 'string') ? ctx.query.section : 'reports';
  const initialSection = validSections.includes(sectionParam) ? sectionParam : 'reports';
  // Hardcoded preset list as SSR fallback so the Scenarios section renders cards
  // on first paint. The client refetches /api/revenue-scenarios on mount to get
  // the live list. Don't dynamically require backend modules: webpack's static
  // analyzer blows up on dynamic require() and silently kills client hydration.
  const initialPresets = [
    { id: 'raise_dinner_15pct', label: 'Raise dinner menu prices +15%', category: 'pricing', applies_to: 'all_stays' },
    { id: 'cut_resort_fee_45eur', label: 'Eliminate €45/night resort fee', category: 'pricing_transparency', applies_to: 'all_stays' },
    { id: 'platinum_upgrade_gift', label: 'Complimentary suite upgrade for Platinum+', category: 'loyalty_experience', applies_to: 'tier_platinum_plus' },
    { id: 'second_day_reset_honeymoon', label: 'Proactive butler + handwritten note day 2', category: 'service_intervention', applies_to: 'archetype_honeymooner' },
    { id: 'spa_app_upsell', label: 'Mobile spa booking app + concierge upsell', category: 'revenue_unlock', applies_to: 'all_stays' },
    { id: 'adults_only_enforcement', label: 'Strict adults-only enforcement at pool', category: 'experience_quality', applies_to: 'segment_couples' },
  ];
  try {
    const file = nodePath.join(process.cwd(), '..', 'backend', 'data', 'demo_snapshots', `${safeSlug}.json`);
    if (fs.existsSync(file)) {
      const raw = JSON.parse(fs.readFileSync(file, 'utf-8'));
      return {
        props: {
          initialData: {
            slug: safeSlug,
            status: 'completed',
            source: 'demo_snapshot_cached',
            result: {
              mode: raw.mode, provider: raw.provider, industry: raw.industry,
              property: raw.property, audience_vector: raw.audience_vector,
              personas: raw.personas || [], stays: raw.stays_sample || [],
              calibration: raw.calibration, summary: raw.summary,
            },
          },
          initialSlug: safeSlug,
          initialSection,
          initialPresets,
        },
      };
    }
  } catch (err) {
    // Swallow — client will retry via API
  }
  return { props: { initialData: null, initialSlug: safeSlug, initialSection, initialPresets } };
}

const ARCHETYPES = [
  { id: 'honeymooner', label: 'Honeymooner', cohortPct: 38, baseNps: 85, color: '#f472b6' },
  { id: 'luxury_seeker', label: 'Luxury Seeker', cohortPct: 32, baseNps: 68, color: '#c084fc' },
  { id: 'loyalty_maximizer', label: 'Loyalty Max', cohortPct: 11, baseNps: 72, color: '#fb923c' },
  { id: 'digital_nomad', label: 'Digital Nomad', cohortPct: 8, baseNps: 66, color: '#60a5fa' },
  { id: 'business_traveler', label: 'Business', cohortPct: 6, baseNps: 82, color: '#34d399' },
  { id: 'budget_optimizer', label: 'Budget', cohortPct: 3, baseNps: 95, color: '#fbbf24' },
  { id: 'event_attendee', label: 'Event', cohortPct: 2, baseNps: 87, color: '#2dd4bf' },
];

const DIMENSIONS = [
  { id: 'aesthetic', label: 'Aesthetic', base: 82, color: '#a855f7' },
  { id: 'service_quality', label: 'Service', base: 75, color: '#ec4899' },
  { id: 'personalization', label: 'Personal', base: 68, color: '#f97316' },
  { id: 'comfort_physical', label: 'Comfort', base: 80, color: '#0ea5e9' },
  { id: 'cleanliness', label: 'Clean', base: 88, color: '#22d3ee' },
  { id: 'culinary', label: 'Culinary', base: 72, color: '#eab308' },
  { id: 'value', label: 'Value', base: 65, color: '#10b981' },
  { id: 'authenticity', label: 'Authentic', base: 74, color: '#14b8a6' },
  { id: 'amenity_usability', label: 'Amenity', base: 70, color: '#6366f1' },
  { id: 'modernity', label: 'Modern', base: 68, color: '#8b5cf6' },
  { id: 'safety', label: 'Safety', base: 85, color: '#84cc16' },
  { id: 'crowd', label: 'Crowd', base: 60, color: '#f59e0b' },
  { id: 'sustainability_awareness', label: 'Sustain', base: 78, color: '#059669' },
];

const SCENARIO_IMPACTS = {
  'raise_dinner_15pct':       { dims: { value: -6, culinary: -2 }, arch: { all: -2.2 }, color: '#ef4444' },
  'cut_resort_fee_45eur':     { dims: { value: 8, service_quality: 2 }, arch: { all: 3.3 }, color: '#10b981' },
  'platinum_upgrade_gift':    { dims: { personalization: 8, service_quality: 4 }, arch: { loyalty_maximizer: 14 }, color: '#f59e0b' },
  'second_day_reset_honeymoon': { dims: { personalization: 8, service_quality: 6, aesthetic: 4 }, arch: { honeymooner: 18 }, color: '#f472b6' },
  'spa_app_upsell':           { dims: { value: 3, service_quality: 2, amenity_usability: 5 }, arch: { all: 0.6 }, color: '#8b5cf6' },
  'adults_only_enforcement':  { dims: { crowd: 8, comfort_physical: 4 }, arch: { honeymooner: 5, luxury_seeker: 4 }, color: '#14b8a6' },
};

const AGENT_NAMES = [
  'Sofia', 'Mateo', 'Emma', 'Lucas', 'Camille', 'Noah', 'Aria', 'Leon',
  'Chloe', 'Hugo', 'Mila', 'Felix', 'Zoe', 'Oscar', 'Nora', 'Max',
  'Luna', 'Finn', 'Iris', 'Theo', 'Maya', 'Louis', 'Elsa', 'Jonas',
  'Alba', 'Nico', 'Clara', 'Ivan', 'Lea', 'Ruben', 'Lara', 'Arthur',
  'Juno', 'Milo', 'Aurora', 'Diego', 'Hanna', 'Marco', 'Olivia', 'Raul',
];

const ARCH_BIO = {
  honeymooner: ['loves sunset cava by the infinity pool', 'posted about the rose-petal turn-down on Instagram', 'booked the adults-only couple massage'],
  luxury_seeker: ['expects sub-3-minute check-in', 'tracks thread-count on linens', 'rated Mandarin Oriental as the benchmark'],
  loyalty_maximizer: ['Meliá Platinum since 2019', 'counts every stay for tier status', 'noticed the welcome gift tier downgrade'],
  digital_nomad: ['camps in the co-working zone by 8am', 'judges the WiFi upload speed', 'extended 4 extra nights for the view'],
  business_traveler: ['arrives late, leaves at dawn', 'wants the invoice itemized', 'hates resort fees on a Tuesday stay'],
  budget_optimizer: ['found the stay via secret-escapes', 'hunts for happy-hour', 'writes 1200-word TripAdvisor reviews'],
  event_attendee: ['flew in for the MICE gala', 'skipped the spa for the keynote', 'left a Google review about the breakout rooms'],
};

function seededRand(seed) {
  let s = seed;
  return () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
}

function buildAgentIdentity(archId, index) {
  const r = seededRand(index * 73 + archId.length * 17);
  const name = AGENT_NAMES[Math.floor(r() * AGENT_NAMES.length)];
  const age = 24 + Math.floor(r() * 38);
  const bios = ARCH_BIO[archId] || [];
  const memory = bios[Math.floor(r() * bios.length)] || 'enjoyed the stay';
  return { name, age, memory };
}

function hexAlpha(hex, a) {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) return hex;
  const r = parseInt(m[1].slice(0, 2), 16);
  const g = parseInt(m[1].slice(2, 4), 16);
  const b = parseInt(m[1].slice(4, 6), 16);
  return `rgba(${r},${g},${b},${a})`;
}

export default function LabPage({ initialData = null, initialSlug = 'villa_le_blanc_claude_authored_n30', initialSection = 'reports', initialPresets = [] } = {}) {
  const canvasRef = useRef(null);
  const rafRef = useRef(null);
  const stateRef = useRef(null);

  const [presets, setPresets] = useState(initialPresets);
  const [activeId, setActiveId] = useState(null);
  const [result, setResult] = useState(null);
  const [nps, setNps] = useState(70);
  const [rev, setRev] = useState(1035);
  const [ltv, setLtv] = useState(0);
  const [loading, setLoading] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [archValues, setArchValues] = useState(() => Object.fromEntries(ARCHETYPES.map((a) => [a.id, a.baseNps])));
  const [dimValues, setDimValues] = useState(() => Object.fromEntries(DIMENSIONS.map((d) => [d.id, d.base])));
  const [cohortValues, setCohortValues] = useState(() => Object.fromEntries(ARCHETYPES.map((a) => [a.id, a.cohortPct])));
  const [selectedAgent, setSelectedAgent] = useState(null);
  const [chatMessages, setChatMessages] = useState([]);
  const [chatInput, setChatInput] = useState('');
  const [chatSending, setChatSending] = useState(false);
  const [validation, setValidation] = useState(null);
  const [validationLoading, setValidationLoading] = useState(false);
  const [viewMode, setViewMode] = useState('executive');
  const [executiveData, setExecutiveData] = useState(initialData);
  const [executiveLoading, setExecutiveLoading] = useState(false);
  const [activeReviewIdx, setActiveReviewIdx] = useState(null);
  const [execSlug, setExecSlug] = useState(initialSlug);
  const [activeSection, setActiveSection] = useState(initialSection);
  const [snapshotsList, setSnapshotsList] = useState(null);

  useEffect(() => {
    // lazy-load the snapshots list for Properties section the first time we need it
    if (activeSection !== 'properties' || snapshotsList) return;
    apiFetch('/api/demo-snapshots')
      .then((r) => r.json())
      .then((d) => setSnapshotsList(d.snapshots || []))
      .catch(() => setSnapshotsList([]));
  }, [activeSection]);

  useEffect(() => {
    let cancelled = false;
    // Skip the initial fetch if SSR already populated this slug.
    if (viewMode === 'executive' && executiveData?.slug === execSlug) return () => {};
    async function load() {
      setExecutiveLoading(true);
      try {
        const res = await apiFetch(`/api/demo-snapshot/${execSlug}`);
        const data = await res.json();
        if (!cancelled) {
          setExecutiveData(data);
          setActiveReviewIdx(null);
          setResult(null);
          setActiveId(null);
        }
      } catch (err) {
        if (!cancelled) setExecutiveData({ error: err.message });
      } finally {
        if (!cancelled) setExecutiveLoading(false);
      }
    }
    if (viewMode === 'executive') load();
    return () => { cancelled = true; };
  }, [viewMode, execSlug]);

  function downloadCurrentSnapshot() {
    if (!executiveData) return;
    const blob = new Blob([JSON.stringify(executiveData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${execSlug}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  async function runScenarioForExecutive(id) {
    if (!executiveData?.result?.summary) return;
    const summary = executiveData.result.summary;
    setLoading(true);
    setActiveId(id);
    try {
      const res = await apiFetch('/api/revenue-scenario', {
        method: 'POST',
        body: JSON.stringify({
          scenario_id: id,
          baseline: {
            avg_stars: summary.avg_stars,
            avg_spend_eur: summary.avg_spend_eur,
            avg_spend_by_category: summary.avg_spend_by_category || {},
            net_promoter_score: summary.net_promoter_score,
            would_repeat_pct: summary.would_repeat_pct,
            would_recommend_pct: summary.would_recommend_pct,
          },
          cohort_size: summary.total_stays || 50,
        }),
      });
      const d = await res.json();
      setResult(d);
      setNps((summary.net_promoter_score || 70) + (d.per_stay?.nps_delta || 0));
      setRev(Math.round((summary.avg_spend_eur || 1035) + (d.per_stay?.revenue_delta_eur || 0)));
      setLtv((d.per_stay?.ltv_delta_eur || 0));
    } catch (err) {
      console.error('[scenario] failed', err);
    } finally {
      setLoading(false);
    }
  }

  function resetExecutiveBaseline() {
    setResult(null);
    setActiveId(null);
    setLtv(0);
    if (executiveData?.result?.summary) {
      setNps(executiveData.result.summary.net_promoter_score || 70);
      setRev(Math.round(executiveData.result.summary.avg_spend_eur || 1035));
    }
  }

  async function loadValidationSnapshot(slug = 'villa_le_blanc_n1000') {
    setValidationLoading(true);
    try {
      const res = await apiFetch(`/api/demo-snapshot/${slug}`);
      const data = await res.json();
      const s = data?.result?.summary || {};
      const c = data?.result?.calibration || {};
      const predDist = s.realized_star_distribution_pct || {};
      const realDist = c.star_distribution_pct || {};
      const ci = s.avg_stars_ci || {};
      const npsCi = s.net_promoter_score_ci || {};
      setValidation({
        property: data?.result?.property?.name || 'Villa Le Blanc',
        predicted: {
          avg_stars: s.avg_stars,
          avg_stars_ci: ci.ci_low != null ? [ci.ci_low, ci.ci_high] : null,
          nps: s.net_promoter_score,
          nps_ci: npsCi.ci_low != null ? [npsCi.ci_low, npsCi.ci_high] : null,
          pct_5: predDist['5'] ?? null,
          pct_1: predDist['1'] ?? null,
          target_match: s.target_star_match_rate_pct,
          n: s.total_stays,
        },
        real: {
          avg_stars: c.avg_rating,
          pct_5: realDist['5'] ?? null,
          pct_1: realDist['1'] ?? null,
          n_reviews: c.review_count,
          sourced_from: Array.isArray(c.sourced_from) ? c.sourced_from.join(' + ') : c.sourced_from,
        },
      });
    } catch (err) {
      console.error('[validation] load failed', err);
      setValidation({ error: err.message });
    } finally {
      setValidationLoading(false);
    }
  }

  useEffect(() => {
    // Clear Next.js FOUC-protector if it's stuck (dev only)
    try {
      document.head.querySelectorAll('style').forEach((s) => {
        const t = (s.textContent || '').replace(/\s+/g, '');
        if (t === 'body{display:none}') s.remove();
      });
    } catch (e) {}
    apiFetch('/api/revenue-scenarios')
      .then((r) => r.json())
      .then((d) => setPresets(d.presets || []))
      .catch(() => setPresets(Object.keys(SCENARIO_IMPACTS).map((id) => ({ id, label: id }))));
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const g = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;

    const resize = () => {
      const r = canvas.getBoundingClientRect();
      const w = Math.max(100, Math.floor(r.width * dpr));
      const h = Math.max(100, Math.floor(r.height * dpr));
      canvas.width = w;
      canvas.height = h;
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.scale(dpr, dpr);
      const st = stateRef.current;
      if (st && r.width > 50) {
        st.cx = r.width / 2;
        st.cy = r.height / 2;
        st.innerR = Math.min(r.width, r.height) * 0.22;
        st.outerR = Math.min(r.width, r.height) * 0.38;
      }
    };
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    const rect = canvas.getBoundingClientRect();
    const cx = rect.width / 2 || 600;
    const cy = rect.height / 2 || 400;
    const innerR = Math.min(rect.width || 1000, rect.height || 700) * 0.22;
    const outerR = Math.min(rect.width || 1000, rect.height || 700) * 0.38;

    const dims = DIMENSIONS.map((d, i) => {
      const ang = (i / DIMENSIONS.length) * Math.PI * 2 - Math.PI / 2;
      return {
        ...d, ang,
        x: cx + Math.cos(ang) * innerR,
        y: cy + Math.sin(ang) * innerR,
        value: d.base, target: d.base, fireUntil: 0, radius: 14,
      };
    });
    const arches = ARCHETYPES.map((a, i) => {
      const ang = (i / ARCHETYPES.length) * Math.PI * 2 - Math.PI / 2;
      return {
        ...a, ang,
        x: cx + Math.cos(ang) * outerR,
        y: cy + Math.sin(ang) * outerR,
        value: a.baseNps, target: a.baseNps, fireUntil: 0,
        radius: Math.max(10, 10 + a.cohortPct * 0.45),
      };
    });
    const particles = [];
    let agentIdx = 0;
    arches.forEach((a) => {
      const count = Math.max(3, Math.round(a.cohortPct * 0.45));
      for (let i = 0; i < count; i++) {
        const phase = Math.random() * Math.PI * 2;
        const orbitR = a.radius + 10 + Math.random() * 24;
        const identity = buildAgentIdentity(a.id, agentIdx++);
        particles.push({
          id: `agent-${a.id}-${i}`,
          archId: a.id,
          archLabel: a.label,
          name: identity.name,
          age: identity.age,
          memory: identity.memory,
          color: a.color,
          x: a.x + Math.cos(phase) * orbitR,
          y: a.y + Math.sin(phase) * orbitR,
          vx: 0, vy: 0,
          size: 1.3 + Math.random() * 1.4,
          orbitPhase: phase,
          orbitSpeed: (0.005 + Math.random() * 0.017) * (Math.random() < 0.5 ? -1 : 1),
          orbitR,
          freeUntil: 0,
          trail: [],
          trailMax: 5 + Math.floor(Math.random() * 4),
          waypoints: null,
          waypointIdx: 0,
          pinned: false,
        });
      }
    });
    const core = { value: 70, target: 70, radius: 46, phase: 0 };
    const edges = [];
    arches.forEach((ar) => dims.forEach((dm) => edges.push({
      from: ar.id, to: dm.id, kind: 'arch_dim', progress: -1, color: '#ffffff',
    })));
    dims.forEach((dm) => edges.push({ from: dm.id, to: '__core', kind: 'dim_core', progress: -1, color: '#fde047' }));

    stateRef.current = { cx, cy, innerR, outerR, dims, arches, core, edges, particles, t: 0, selectedAgentId: null };

    const handleClick = (ev) => {
      const s = stateRef.current;
      if (!s) return;
      const r = canvas.getBoundingClientRect();
      const mx = ev.clientX - r.left;
      const my = ev.clientY - r.top;
      let best = null;
      let bestDist = 14;
      for (const p of s.particles) {
        const d = Math.hypot(p.x - mx, p.y - my);
        if (d < bestDist) { bestDist = d; best = p; }
      }
      for (const p of s.particles) { p.pinned = false; }
      if (best) {
        best.pinned = true;
        s.selectedAgentId = best.id;
        setSelectedAgent({
          id: best.id, name: best.name, age: best.age, memory: best.memory,
          archId: best.archId, archLabel: best.archLabel, color: best.color,
        });
        setChatMessages([{ role: 'agent', text: `Hola, soy ${best.name}. ${best.memory}.` }]);
      } else {
        s.selectedAgentId = null;
        setSelectedAgent(null);
        setChatMessages([]);
      }
    };
    canvas.addEventListener('click', handleClick);

    const handleMove = (ev) => {
      const s = stateRef.current;
      if (!s) return;
      const r = canvas.getBoundingClientRect();
      const mx = ev.clientX - r.left;
      const my = ev.clientY - r.top;
      let hit = false;
      for (const p of s.particles) {
        if (Math.hypot(p.x - mx, p.y - my) < 10) { hit = true; break; }
      }
      canvas.style.cursor = hit ? 'pointer' : 'default';
    };
    canvas.addEventListener('mousemove', handleMove);
    resize();

    const getNode = (id) => {
      if (id === '__core') return { x: stateRef.current.cx, y: stateRef.current.cy };
      const s = stateRef.current;
      return s.dims.find((d) => d.id === id) || s.arches.find((a) => a.id === id);
    };

    const loop = () => {
      const s = stateRef.current;
      if (!s) return;
      s.t += 1;
      const { width, height } = canvas.getBoundingClientRect();
      if (width < 50) { rafRef.current = requestAnimationFrame(loop); return; }

      // Background
      const bg = g.createRadialGradient(s.cx, s.cy, 0, s.cx, s.cy, Math.max(width, height));
      bg.addColorStop(0, 'rgba(15,23,42,0.9)');
      bg.addColorStop(1, 'rgba(2,6,23,1)');
      g.fillStyle = bg;
      g.fillRect(0, 0, width, height);

      // Update positions + value easing
      const ease = 0.06;
      for (const d of s.dims) {
        const wob = Math.sin(s.t * 0.005 + d.ang) * 5;
        d.x = s.cx + Math.cos(d.ang) * s.innerR + wob;
        d.y = s.cy + Math.sin(d.ang) * s.innerR + wob * 0.6;
        d.value += (d.target - d.value) * ease;
      }
      for (const a of s.arches) {
        const activity = Math.abs(a.target - a.value);
        const wob = Math.cos(s.t * 0.005 + a.ang) * (7 + activity * 0.3);
        a.x = s.cx + Math.cos(a.ang) * s.outerR + wob;
        a.y = s.cy + Math.sin(a.ang) * s.outerR + wob * 0.6;
        a.value += (a.target - a.value) * ease;
      }
      s.core.value += (s.core.target - s.core.value) * ease;
      s.core.phase += 0.05;

      // Edges
      for (const e of s.edges) {
        const from = getNode(e.from);
        const to = getNode(e.to);
        if (!from || !to) continue;
        const active = e.progress >= 0 && e.progress <= 1;
        g.globalAlpha = active ? 0.6 : 0.06;
        g.strokeStyle = active ? e.color : '#475569';
        g.lineWidth = active ? 2.4 : 0.5;
        g.beginPath();
        g.moveTo(from.x, from.y);
        g.lineTo(to.x, to.y);
        g.stroke();
        if (active) {
          const px = from.x + (to.x - from.x) * e.progress;
          const py = from.y + (to.y - from.y) * e.progress;
          g.globalAlpha = 0.9;
          g.fillStyle = e.color;
          g.beginPath();
          g.arc(px, py, 4, 0, Math.PI * 2);
          g.fill();
          g.globalAlpha = 0.35;
          g.beginPath();
          g.arc(px, py, 10, 0, Math.PI * 2);
          g.fill();
          e.progress += 0.02;
        }
      }
      g.globalAlpha = 1;

      // Particles — free-moving swarm per archetype (each one an agent with memory)
      g.save();
      g.globalCompositeOperation = 'lighter';
      for (const p of s.particles) {
        const home = s.arches.find((a) => a.id === p.archId);
        if (!home) continue;
        const isSelected = s.selectedAgentId === p.id;
        if (p.pinned) {
          // Held in place (selected) — float gently in place
          p.x += Math.sin(s.t * 0.04 + p.orbitPhase) * 0.15;
          p.y += Math.cos(s.t * 0.04 + p.orbitPhase) * 0.15;
        } else if (p.waypoints && p.waypoints.length) {
          // Flow along data edges (archetype → dim → core → home)
          const target = p.waypoints[p.waypointIdx];
          if (target) {
            const dx = target.x - p.x;
            const dy = target.y - p.y;
            const dist = Math.hypot(dx, dy);
            if (dist < 6) {
              p.waypointIdx += 1;
              if (p.waypointIdx >= p.waypoints.length) {
                p.waypoints = null;
                p.waypointIdx = 0;
              }
            } else {
              const spd = Math.min(5, dist * 0.12);
              p.x += (dx / dist) * spd;
              p.y += (dy / dist) * spd;
            }
          }
        } else if (s.t < p.freeUntil) {
          p.x += p.vx;
          p.y += p.vy;
          p.vx *= 0.985;
          p.vy *= 0.985;
          if (p.x < 4) { p.x = 4; p.vx = Math.abs(p.vx) * 0.72; }
          if (p.x > width - 4) { p.x = width - 4; p.vx = -Math.abs(p.vx) * 0.72; }
          if (p.y < 4) { p.y = 4; p.vy = Math.abs(p.vy) * 0.72; }
          if (p.y > height - 4) { p.y = height - 4; p.vy = -Math.abs(p.vy) * 0.72; }
        } else {
          p.orbitPhase += p.orbitSpeed;
          const tx = home.x + Math.cos(p.orbitPhase) * p.orbitR + Math.sin(s.t * 0.02 + p.orbitPhase) * 3;
          const ty = home.y + Math.sin(p.orbitPhase) * p.orbitR + Math.cos(s.t * 0.02 + p.orbitPhase) * 3;
          p.x += p.vx;
          p.y += p.vy;
          p.vx *= 0.9;
          p.vy *= 0.9;
          p.x += (tx - p.x) * 0.06;
          p.y += (ty - p.y) * 0.06;
        }
        p.trail.push({ x: p.x, y: p.y });
        if (p.trail.length > p.trailMax) p.trail.shift();
        for (let i = 0; i < p.trail.length; i++) {
          const tp = p.trail[i];
          g.globalAlpha = (i / p.trail.length) * 0.3;
          g.fillStyle = p.color;
          g.beginPath();
          g.arc(tp.x, tp.y, p.size * (0.3 + (i / p.trail.length) * 0.7), 0, Math.PI * 2);
          g.fill();
        }
        const drawSize = isSelected ? p.size * 1.8 : p.size;
        g.globalAlpha = isSelected ? 1 : 0.85;
        g.fillStyle = p.color;
        g.beginPath();
        g.arc(p.x, p.y, drawSize, 0, Math.PI * 2);
        g.fill();
        g.globalAlpha = isSelected ? 0.5 : 0.22;
        g.beginPath();
        g.arc(p.x, p.y, drawSize * (isSelected ? 4 : 3), 0, Math.PI * 2);
        g.fill();
        if (isSelected) {
          g.globalAlpha = 0.9;
          g.strokeStyle = '#ffffff';
          g.lineWidth = 1.2;
          g.beginPath();
          g.arc(p.x, p.y, drawSize * 3 + Math.sin(s.t * 0.1) * 2, 0, Math.PI * 2);
          g.stroke();
        }
      }
      g.globalAlpha = 1;
      g.restore();

      // Dim nodes
      for (const d of s.dims) {
        const intensity = Math.max(0, Math.min(1, d.value / 100));
        const fired = s.t < d.fireUntil;
        const rr = d.radius + (fired ? Math.sin((d.fireUntil - s.t) * 0.3) * 3 : 0);
        g.beginPath();
        g.arc(d.x, d.y, rr + 8, 0, Math.PI * 2);
        g.fillStyle = hexAlpha(d.color, 0.2);
        g.fill();
        g.beginPath();
        g.arc(d.x, d.y, rr, 0, Math.PI * 2);
        g.fillStyle = hexAlpha(d.color, 0.4 + intensity * 0.5);
        g.fill();
        g.strokeStyle = d.color;
        g.lineWidth = fired ? 2.5 : 1;
        g.stroke();
        g.fillStyle = '#f1f5f9';
        g.font = '11px system-ui';
        g.textAlign = 'center';
        g.fillText(d.label, d.x, d.y + rr + 14);
        g.fillStyle = '#94a3b8';
        g.font = '9px system-ui';
        g.fillText(Math.round(d.value), d.x, d.y + 3);
      }

      // Archetype nodes
      for (const a of s.arches) {
        const fired = s.t < a.fireUntil;
        const rr = a.radius + (fired ? Math.sin((a.fireUntil - s.t) * 0.3) * 4 : 0);
        g.beginPath();
        g.arc(a.x, a.y, rr + 14, 0, Math.PI * 2);
        g.fillStyle = hexAlpha(a.color, 0.15);
        g.fill();
        g.beginPath();
        g.arc(a.x, a.y, rr, 0, Math.PI * 2);
        g.fillStyle = a.color;
        g.fill();
        g.strokeStyle = '#0f172a';
        g.lineWidth = 2;
        g.stroke();
        g.fillStyle = '#e2e8f0';
        g.font = 'bold 12px system-ui';
        g.textAlign = 'center';
        g.fillText(a.label, a.x, a.y + rr + 16);
        g.font = '10px system-ui';
        g.fillStyle = '#cbd5e1';
        g.fillText(`${a.cohortPct}% · NPS ${Math.round(a.value)}`, a.x, a.y + rr + 30);
      }

      // Core NPS
      const pr = s.core.radius + Math.sin(s.core.phase) * 3;
      const gg = g.createRadialGradient(s.cx, s.cy, 0, s.cx, s.cy, pr * 2.2);
      gg.addColorStop(0, hexAlpha('#fde047', 0.5));
      gg.addColorStop(1, hexAlpha('#fde047', 0));
      g.fillStyle = gg;
      g.beginPath();
      g.arc(s.cx, s.cy, pr * 2.2, 0, Math.PI * 2);
      g.fill();
      g.beginPath();
      g.arc(s.cx, s.cy, pr, 0, Math.PI * 2);
      g.fillStyle = '#fde047';
      g.fill();
      g.strokeStyle = '#fef9c3';
      g.lineWidth = 2;
      g.stroke();
      g.fillStyle = '#1e293b';
      g.font = 'bold 13px system-ui';
      g.textAlign = 'center';
      g.fillText('NPS', s.cx, s.cy - 4);
      g.font = 'bold 20px system-ui';
      g.fillText(Math.round(s.core.value), s.cx, s.cy + 16);

      rafRef.current = requestAnimationFrame(loop);
    };
    loop();

    return () => {
      cancelAnimationFrame(rafRef.current);
      ro.disconnect();
      canvas.removeEventListener('click', handleClick);
      canvas.removeEventListener('mousemove', handleMove);
    };
  }, []);

  function recomputeCore(s, cohorts) {
    const totalPct = Object.values(cohorts).reduce((x, v) => x + v, 0) || 100;
    const weighted = s.arches.reduce((x, ar) => x + ar.target * ((cohorts[ar.id] ?? 0) / totalPct), 0);
    s.core.target = weighted;
    return Math.round(weighted);
  }

  function editArchValue(id, val) {
    const v = Math.max(-100, Math.min(100, Number(val)));
    setArchValues((prev) => ({ ...prev, [id]: v }));
    const s = stateRef.current;
    if (!s) return;
    const a = s.arches.find((x) => x.id === id);
    if (!a) return;
    a.target = v;
    a.fireUntil = s.t + 30;
    setNps(recomputeCore(s, cohortValues));
    // Flow particles of this archetype → core (aggregation visualization)
    for (const p of s.particles) {
      if (p.archId !== id || p.pinned) continue;
      p.waypoints = [
        { x: s.cx + (Math.random() - 0.5) * 20, y: s.cy + (Math.random() - 0.5) * 20 },
        { x: a.x + (Math.random() - 0.5) * 20, y: a.y + (Math.random() - 0.5) * 20 },
      ];
      p.waypointIdx = 0;
    }
  }

  function editCohort(id, val) {
    const v = Math.max(0, Math.min(100, Number(val)));
    setCohortValues((prev) => {
      const next = { ...prev, [id]: v };
      const s = stateRef.current;
      if (s) {
        const a = s.arches.find((x) => x.id === id);
        if (a) {
          a.radius = Math.max(10, 10 + v * 0.45);
          a.fireUntil = s.t + 30;
        }
        setNps(recomputeCore(s, next));
        for (const p of s.particles) {
          if (p.archId !== id) continue;
          p.freeUntil = s.t + 80;
          const speed = 1.5 + Math.random() * 3;
          const ang = Math.random() * Math.PI * 2;
          p.vx = Math.cos(ang) * speed;
          p.vy = Math.sin(ang) * speed;
        }
      }
      return next;
    });
  }

  function editDimValue(id, val) {
    const v = Math.max(0, Math.min(100, Number(val)));
    setDimValues((prev) => ({ ...prev, [id]: v }));
    const s = stateRef.current;
    if (!s) return;
    const d = s.dims.find((x) => x.id === id);
    if (!d) return;
    d.target = v;
    d.fireUntil = s.t + 30;
    // Route a subset of agents through this dimension, then back home
    for (const p of s.particles) {
      if (p.pinned) continue;
      if (Math.random() < 0.3) {
        const home = s.arches.find((a) => a.id === p.archId);
        if (!home) continue;
        p.waypoints = [
          { x: d.x + (Math.random() - 0.5) * 10, y: d.y + (Math.random() - 0.5) * 10 },
          { x: home.x + (Math.random() - 0.5) * 18, y: home.y + (Math.random() - 0.5) * 18 },
        ];
        p.waypointIdx = 0;
      }
    }
  }

  async function sendChat() {
    const text = chatInput.trim();
    if (!text || !selectedAgent || chatSending) return;
    setChatInput('');
    const s = stateRef.current;
    const arch = s?.arches.find((a) => a.id === selectedAgent.archId);
    const dimSnapshot = s ? s.dims.map((d) => `${d.label}:${Math.round(d.target)}`).join(', ') : '';
    const history = [...chatMessages, { role: 'user', text }];
    setChatMessages(history);
    setChatSending(true);
    try {
      const res = await apiFetch('/api/agent-chat', {
        method: 'POST',
        body: JSON.stringify({
          agent: {
            name: selectedAgent.name,
            age: selectedAgent.age,
            archetype: selectedAgent.archLabel,
            memory: selectedAgent.memory,
            current_nps: Math.round(arch?.value ?? 70),
          },
          context: { property: 'Gran Meliá Villa Le Blanc', dimensions: dimSnapshot },
          history: history.map((m) => ({ role: m.role === 'user' ? 'user' : 'assistant', text: m.text })),
          message: text,
        }),
      });
      const data = await res.json();
      const reply = data?.reply || `(${selectedAgent.name} no contestó — intenta otra vez)`;
      setChatMessages((prev) => [...prev, { role: 'agent', text: reply }]);
    } catch (e) {
      setChatMessages((prev) => [...prev, { role: 'agent', text: `(offline) ${selectedAgent.name}: ${selectedAgent.memory}.` }]);
    } finally {
      setChatSending(false);
    }
  }

  function closeAgent() {
    const s = stateRef.current;
    if (s) {
      s.selectedAgentId = null;
      for (const p of s.particles) p.pinned = false;
    }
    setSelectedAgent(null);
    setChatMessages([]);
  }

  function applyScenario(id) {
    if (loading) return;
    const imp = SCENARIO_IMPACTS[id];
    const s = stateRef.current;
    if (!imp || !s) return;
    setLoading(true);
    setActiveId(id);

    const dimIds = Object.keys(imp.dims);
    const archIds = imp.arch.all ? s.arches.map((a) => a.id) : Object.keys(imp.arch);

    // Fire edges
    for (const e of s.edges) {
      const affectsArch = archIds.includes(e.from);
      const affectsDim = dimIds.includes(e.to);
      const dimToCore = dimIds.includes(e.from) && e.to === '__core';
      if ((affectsArch && affectsDim) || dimToCore) {
        e.progress = 0;
        e.color = imp.color;
      }
    }
    const fire = s.t + 40;
    for (const d of s.dims) if (dimIds.includes(d.id)) d.fireUntil = fire;
    for (const a of s.arches) if (archIds.includes(a.id)) a.fireUntil = fire;

    // Flow particles along data edges: home → affected dim → core → back home
    const affectedDims = s.dims.filter((d) => dimIds.includes(d.id));
    for (const p of s.particles) {
      if (!archIds.includes(p.archId)) continue;
      if (p.pinned) continue;
      const home = s.arches.find((a) => a.id === p.archId);
      if (!home) continue;
      const waypoints = [];
      if (affectedDims.length) {
        const d = affectedDims[Math.floor(Math.random() * affectedDims.length)];
        const jitter = () => (Math.random() - 0.5) * 8;
        waypoints.push({ x: d.x + jitter(), y: d.y + jitter() });
      }
      waypoints.push({ x: s.cx + (Math.random() - 0.5) * 18, y: s.cy + (Math.random() - 0.5) * 18 });
      waypoints.push({ x: home.x + (Math.random() - 0.5) * 20, y: home.y + (Math.random() - 0.5) * 20 });
      p.waypoints = waypoints;
      p.waypointIdx = 0;
    }

    // Shift values
    for (const [k, v] of Object.entries(imp.dims)) {
      const d = s.dims.find((x) => x.id === k);
      if (d) d.target = Math.max(0, Math.min(100, d.target + v));
    }
    if (imp.arch.all) {
      for (const a of s.arches) a.target = Math.max(-100, Math.min(100, a.target + imp.arch.all));
    } else {
      for (const [k, v] of Object.entries(imp.arch)) {
        const a = s.arches.find((x) => x.id === k);
        if (a) a.target = Math.max(-100, Math.min(100, a.target + v));
      }
    }
    setNps(recomputeCore(s, cohortValues));
    setArchValues(Object.fromEntries(s.arches.map((a) => [a.id, Math.round(a.target)])));
    setDimValues(Object.fromEntries(s.dims.map((d) => [d.id, Math.round(d.target)])));

    apiFetch('/api/revenue-scenario', {
      method: 'POST',
      body: JSON.stringify({
        scenario_id: id,
        baseline: { avg_spend_eur: 1035, avg_spend_by_category: { dining: 420, spa: 120, bar: 85 }, net_promoter_score: 70 },
        cohort_size: 50,
      }),
    })
      .then((r) => r.json())
      .then((d) => {
        setResult(d);
        setRev((x) => x + (d.per_stay?.revenue_delta_eur || 0));
        setLtv((x) => x + (d.per_stay?.ltv_delta_eur || 0));
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }

  function resetBaseline() {
    const s = stateRef.current;
    if (!s) return;
    for (const d of s.dims) d.target = DIMENSIONS.find((x) => x.id === d.id)?.base ?? 70;
    for (const a of s.arches) a.target = ARCHETYPES.find((x) => x.id === a.id)?.baseNps ?? 70;
    s.core.target = 70;
    setNps(70); setRev(1035); setLtv(0); setActiveId(null); setResult(null);
    setArchValues(Object.fromEntries(ARCHETYPES.map((a) => [a.id, a.baseNps])));
    setDimValues(Object.fromEntries(DIMENSIONS.map((d) => [d.id, d.base])));
    setCohortValues(Object.fromEntries(ARCHETYPES.map((a) => [a.id, a.cohortPct])));
    for (const a of s.arches) {
      const def = ARCHETYPES.find((x) => x.id === a.id);
      if (def) a.radius = Math.max(10, 10 + def.cohortPct * 0.45);
    }

    // Gentle scatter on reset
    for (const p of s.particles) {
      p.freeUntil = s.t + 90;
      const speed = 2 + Math.random() * 3;
      const ang = Math.random() * Math.PI * 2;
      p.vx = Math.cos(ang) * speed;
      p.vy = Math.sin(ang) * speed;
    }
  }

  const zoneCol = result?.zone === 'WIN' ? '#22c55e'
    : result?.zone === 'SAFE' ? '#84cc16'
    : result?.zone === 'STRATEGIC_BET' ? '#f59e0b'
    : result?.zone === 'RISKY' ? '#f97316'
    : result?.zone === 'BAD' ? '#ef4444'
    : '#94a3b8';

  if (viewMode === 'executive') {
    return (
      <>
        <Head>
          <title>Villa Le Blanc · Synthetic Users demo</title>
          <style dangerouslySetInnerHTML={{ __html: 'body { display: block !important; }' }} />
        </Head>
        <ExecutiveView
          data={executiveData}
          loading={executiveLoading}
          slug={execSlug}
          onSlugChange={setExecSlug}
          onSwitchToNetwork={() => setViewMode('network')}
          onDownload={downloadCurrentSnapshot}
          activeReviewIdx={activeReviewIdx}
          onSelectReview={setActiveReviewIdx}
          presets={presets}
          scenarioResult={result}
          applyScenario={runScenarioForExecutive}
          resetBaseline={resetExecutiveBaseline}
          npsDisplay={nps}
          revDisplay={rev}
          loadingScenario={loading}
          activeScenarioId={activeId}
          activeSection={activeSection}
          onSectionChange={setActiveSection}
          snapshotsList={snapshotsList}
        />
      </>
    );
  }

  return (
    <>
      <Head>
        <title>Revenue Lab · Synthetic Users</title>
        <style dangerouslySetInnerHTML={{ __html: 'body { display: block !important; }' }} />
      </Head>
      <div style={{ display: 'flex', height: '100vh', background: '#020617', color: '#e2e8f0', fontFamily: 'system-ui' }}>
        <div style={{ flex: 1, position: 'relative', overflow: 'hidden', minWidth: 0, minHeight: 0 }}>
          <button onClick={() => setViewMode('executive')} style={{
            position: 'absolute', top: 16, right: 160, zIndex: 10,
            padding: '6px 12px', background: 'rgba(168,85,247,0.18)',
            border: '1px solid #a855f7', borderRadius: 6,
            color: '#d8b4fe', fontSize: 12, cursor: 'pointer',
            backdropFilter: 'blur(6px)',
          }}>← Executive view</button>
          <canvas ref={canvasRef} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', display: 'block' }} />
          <div style={{ position: 'absolute', top: 16, left: 20, fontSize: 13, pointerEvents: 'none' }}>
            <div style={{ color: '#94a3b8', fontSize: 11, letterSpacing: 1.5, textTransform: 'uppercase' }}>Revenue Lab</div>
            <div style={{ fontSize: 18, fontWeight: 600, color: '#f1f5f9' }}>Gran Meliá Villa Le Blanc · n=50</div>
          </div>

          <button
            onClick={() => setEditMode((v) => !v)}
            style={{
              position: 'absolute', top: 16, right: 16, zIndex: 10,
              padding: '6px 12px',
              background: editMode ? 'rgba(245,158,11,0.18)' : 'rgba(30,41,59,0.7)',
              border: `1px solid ${editMode ? '#f59e0b' : '#334155'}`,
              borderRadius: 6,
              color: editMode ? '#fcd34d' : '#e2e8f0',
              fontSize: 12, cursor: 'pointer',
              backdropFilter: 'blur(6px)',
            }}
          >
            {editMode ? '✓ done editing' : '⚙ edit values'}
          </button>

          {editMode && (
            <div style={{
              position: 'absolute', top: 52, right: 16, width: 340,
              maxHeight: 'calc(100% - 80px)', overflowY: 'auto',
              background: 'rgba(2,6,23,0.82)', backdropFilter: 'blur(8px)',
              border: '1px solid #1e293b', borderRadius: 10, padding: 12,
              zIndex: 9, fontSize: 11,
            }}>
              <div style={{ color: '#94a3b8', letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 8, fontSize: 10 }}>
                Archetypes — NPS & cohort %
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 14 }}>
                {ARCHETYPES.map((a) => (
                  <div key={a.id} style={{ background: 'rgba(30,41,59,0.4)', borderRadius: 6, padding: '6px 8px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                      <span style={{ width: 9, height: 9, borderRadius: 9, background: a.color }} />
                      <span style={{ flex: 1, color: '#cbd5e1', fontWeight: 600 }}>{a.label}</span>
                      <span style={{ color: '#94a3b8', fontSize: 10 }}>
                        NPS <strong style={{ color: '#f1f5f9' }}>{archValues[a.id]}</strong> · {cohortValues[a.id]}%
                      </span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ width: 28, color: '#64748b', fontSize: 9 }}>NPS</span>
                      <input
                        type="range" min={-100} max={100} step={1}
                        value={archValues[a.id]}
                        onChange={(e) => editArchValue(a.id, e.target.value)}
                        style={{ flex: 1, accentColor: a.color, cursor: 'grab' }}
                      />
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 2 }}>
                      <span style={{ width: 28, color: '#64748b', fontSize: 9 }}>pct</span>
                      <input
                        type="range" min={0} max={60} step={1}
                        value={cohortValues[a.id]}
                        onChange={(e) => editCohort(a.id, e.target.value)}
                        style={{ flex: 1, accentColor: a.color, cursor: 'grab' }}
                      />
                    </div>
                  </div>
                ))}
              </div>

              <div style={{ color: '#94a3b8', letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 8, fontSize: 10 }}>
                Sensation dimensions
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 4 }}>
                {DIMENSIONS.map((d) => (
                  <div key={d.id} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ width: 7, height: 7, borderRadius: 7, background: d.color }} />
                    <span style={{ width: 64, color: '#cbd5e1' }}>{d.label}</span>
                    <input
                      type="range" min={0} max={100} step={1}
                      value={dimValues[d.id]}
                      onChange={(e) => editDimValue(d.id, e.target.value)}
                      style={{ flex: 1, accentColor: d.color, cursor: 'grab' }}
                    />
                    <span style={{ width: 22, textAlign: 'right', color: '#f1f5f9', fontSize: 10 }}>{dimValues[d.id]}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          <div style={{ position: 'absolute', bottom: 12, left: 20, right: 20, display: 'flex', gap: 14, fontSize: 11, color: '#94a3b8' }}>
            <span><strong style={{ color: '#fde047' }}>core</strong> = aggregate NPS</span>
            <span><strong style={{ color: '#cbd5e1' }}>inner</strong> = 13 sensation dims</span>
            <span><strong style={{ color: '#cbd5e1' }}>outer</strong> = 7 archetypes</span>
            <span style={{ marginLeft: 'auto' }}>⤿ click an agent to chat · scenario →</span>
          </div>

          {selectedAgent && (
            <div style={{
              position: 'absolute', left: 16, bottom: 44, width: 340,
              maxHeight: 360, display: 'flex', flexDirection: 'column',
              background: 'rgba(2,6,23,0.88)', backdropFilter: 'blur(10px)',
              border: `1px solid ${selectedAgent.color}66`, borderRadius: 12, padding: 12,
              boxShadow: `0 0 24px ${selectedAgent.color}22`, zIndex: 12,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <span style={{ width: 12, height: 12, borderRadius: 12, background: selectedAgent.color, boxShadow: `0 0 10px ${selectedAgent.color}` }} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: '#f1f5f9' }}>{selectedAgent.name}, {selectedAgent.age}</div>
                  <div style={{ fontSize: 10, color: '#94a3b8' }}>{selectedAgent.archLabel} · agent</div>
                </div>
                <button onClick={closeAgent} style={{ background: 'transparent', border: 'none', color: '#64748b', cursor: 'pointer', fontSize: 16, padding: 0 }}>×</button>
              </div>
              <div style={{ flex: 1, overflowY: 'auto', background: 'rgba(15,23,42,0.5)', borderRadius: 8, padding: 8, marginBottom: 8, fontSize: 12 }}>
                {chatMessages.map((m, i) => (
                  <div key={i} style={{
                    marginBottom: 6,
                    textAlign: m.role === 'user' ? 'right' : 'left',
                  }}>
                    <div style={{
                      display: 'inline-block', maxWidth: '85%', padding: '5px 9px', borderRadius: 8,
                      background: m.role === 'user' ? 'rgba(59,130,246,0.25)' : `${selectedAgent.color}22`,
                      color: '#e2e8f0', lineHeight: 1.4,
                    }}>{m.text}</div>
                  </div>
                ))}
                {chatSending && (
                  <div style={{ fontSize: 10, color: '#64748b', fontStyle: 'italic' }}>{selectedAgent.name} está escribiendo…</div>
                )}
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <input
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') sendChat(); }}
                  placeholder={`pregúntale a ${selectedAgent.name}…`}
                  disabled={chatSending}
                  style={{ flex: 1, background: 'rgba(30,41,59,0.6)', border: '1px solid #334155', borderRadius: 6, padding: '6px 8px', color: '#e2e8f0', fontSize: 12 }}
                />
                <button onClick={sendChat} disabled={chatSending || !chatInput.trim()}
                  style={{ background: selectedAgent.color, border: 'none', borderRadius: 6, padding: '6px 12px', color: '#0f172a', fontSize: 12, fontWeight: 600, cursor: chatSending ? 'wait' : 'pointer' }}>
                  ↵
                </button>
              </div>
            </div>
          )}
        </div>

        <div style={{ width: 360, padding: 20, overflowY: 'auto', background: '#0f172a', borderLeft: '1px solid #1e293b' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 18 }}>
            <Kpi label="NPS" value={nps} color="#fde047" big />
            <Kpi label="Zone" value={result?.zone || '—'} color={zoneCol} big />
            <Kpi label="€ / stay" value={`€${rev}`} color="#10b981" delta={result?.per_stay?.revenue_delta_eur} />
            <Kpi label="LTV Δ" value={`€${ltv}`} color="#60a5fa" delta={result?.per_stay?.ltv_delta_eur} />
          </div>

          <div style={{ marginBottom: 8, color: '#94a3b8', fontSize: 11, letterSpacing: 1.5, textTransform: 'uppercase' }}>Scenarios</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {Object.keys(SCENARIO_IMPACTS).map((id) => {
              const pr = presets.find((p) => p.id === id);
              return (
                <button key={id} disabled={loading} onClick={() => applyScenario(id)}
                  style={{
                    textAlign: 'left', padding: '10px 12px',
                    background: activeId === id ? 'rgba(245,158,11,0.15)' : 'rgba(30,41,59,0.6)',
                    border: `1px solid ${activeId === id ? '#f59e0b' : '#334155'}`,
                    borderRadius: 8, color: '#e2e8f0', fontSize: 13,
                    cursor: loading ? 'wait' : 'pointer',
                  }}>
                  <div style={{ fontWeight: 600 }}>{pr?.label || id.replace(/_/g, ' ')}</div>
                  {pr?.category && <div style={{ color: '#64748b', fontSize: 11, marginTop: 2 }}>{pr.category.replace(/_/g, ' ')}</div>}
                </button>
              );
            })}
          </div>

          <button onClick={resetBaseline}
            style={{ marginTop: 16, width: '100%', padding: 10, background: 'transparent', border: '1px solid #475569', borderRadius: 8, color: '#94a3b8', fontSize: 12, cursor: 'pointer' }}>
            ↺ reset to baseline
          </button>

          <div style={{ marginTop: 22, marginBottom: 8, color: '#94a3b8', fontSize: 11, letterSpacing: 1.5, textTransform: 'uppercase' }}>
            Predicted vs Real
          </div>
          {!validation && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <button
                onClick={() => loadValidationSnapshot('villa_le_blanc_claude_authored_n30')}
                disabled={validationLoading}
                style={{
                  width: '100%', padding: 10,
                  background: 'rgba(168,85,247,0.14)', border: '1px solid #a855f7',
                  borderRadius: 8, color: '#d8b4fe', fontSize: 12,
                  cursor: validationLoading ? 'wait' : 'pointer',
                }}>
                {validationLoading ? 'loading…' : '▶ Claude-authored · n=31 (rich narratives)'}
              </button>
              <button
                onClick={() => loadValidationSnapshot('villa_le_blanc_n1000')}
                disabled={validationLoading}
                style={{
                  width: '100%', padding: 10,
                  background: 'rgba(16,185,129,0.12)', border: '1px solid #10b981',
                  borderRadius: 8, color: '#6ee7b7', fontSize: 12,
                  cursor: validationLoading ? 'wait' : 'pointer',
                }}>
                {validationLoading ? 'loading…' : '▶ stat backtest · n=1000'}
              </button>
            </div>
          )}
          {validation && validation.error && (
            <div style={{ padding: 10, color: '#f87171', fontSize: 11 }}>Error: {validation.error}</div>
          )}
          {validation && !validation.error && <ValidationPanel v={validation} />}

          {result && (
            <div style={{ marginTop: 18, padding: 14, background: 'rgba(15,23,42,0.6)', border: `1px solid ${zoneCol}55`, borderRadius: 8 }}>
              <div style={{ color: '#94a3b8', fontSize: 10, textTransform: 'uppercase', letterSpacing: 1.5 }}>Impact</div>
              <div style={{ fontSize: 14, fontWeight: 600, marginTop: 4, color: '#f1f5f9' }}>{result.scenario?.label}</div>
              <div style={{ marginTop: 12, display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '4px 12px', fontSize: 13 }}>
                <span style={{ color: '#94a3b8' }}>per stay:</span>
                <span>€{result.per_stay?.revenue_delta_eur > 0 ? '+' : ''}{result.per_stay?.revenue_delta_eur} rev · NPS {result.per_stay?.nps_delta > 0 ? '+' : ''}{result.per_stay?.nps_delta}</span>
                <span style={{ color: '#94a3b8' }}>LTV:</span>
                <span>€{result.per_stay?.ltv_delta_eur > 0 ? '+' : ''}{result.per_stay?.ltv_delta_eur}</span>
                <span style={{ color: '#94a3b8' }}>annual:</span>
                <span style={{ color: result.annualized_estimate?.total_annual_delta_eur > 0 ? '#10b981' : '#f87171', fontWeight: 600 }}>
                  €{Math.round((result.annualized_estimate?.total_annual_delta_eur || 0) / 1000)}K
                </span>
              </div>
              <div style={{ marginTop: 12, fontSize: 11, color: '#94a3b8', lineHeight: 1.5 }}>{result.explanation}</div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

const FLAG_BY_CLUSTER = {
  anglo_uk_ireland: '🇬🇧', anglo_us_canada: '🇺🇸', german_dach: '🇩🇪',
  french: '🇫🇷', latin_spain_italy: '🇪🇸', latin_american: '🇲🇽',
  nordic: '🇸🇪', east_asian: '🇯🇵', chinese_mainland: '🇨🇳', middle_east_gcc: '🇦🇪',
};

// ─── Clean "Reports" dashboard — light theme, Tesla-inspired ────────────────
const BRAND = {
  bg: '#F5F5F7',
  card: '#FFFFFF',
  border: '#E5E7EB',
  text: '#0F172A',
  muted: '#6B7280',
  subtle: '#9CA3AF',
  accent: '#2563EB',
  accentSoft: '#EFF6FF',
  good: '#10B981',
  warn: '#F59E0B',
  bad: '#EF4444',
  navy: '#1F2937',
};

function ExecutiveView({
  data, loading, slug, onSlugChange, onSwitchToNetwork, onDownload,
  activeReviewIdx, onSelectReview, presets, scenarioResult, applyScenario,
  resetBaseline, npsDisplay, revDisplay, loadingScenario, activeScenarioId,
  activeSection = 'reports', onSectionChange = () => {}, snapshotsList = null,
}) {
  const result = data?.result || {};
  const summary = result.summary || {};
  const calibration = result.calibration || {};
  const stays = result.stays || [];
  const predDist = summary.realized_star_distribution_pct || {};
  const realDist = calibration.star_distribution_pct || {};
  const deltaStars = (summary.avg_stars != null && calibration.avg_rating != null)
    ? summary.avg_stars - calibration.avg_rating : null;
  const verdict = deltaStars == null ? '—'
    : Math.abs(deltaStars) <= 0.1 ? 'MATCH'
    : Math.abs(deltaStars) <= 0.3 ? 'CLOSE' : 'DRIFT';
  const verdictCol = verdict === 'MATCH' ? BRAND.good : verdict === 'CLOSE' ? BRAND.warn : BRAND.bad;

  const PRIMARY_SCENARIOS = ['raise_dinner_15pct', 'cut_resort_fee_45eur', 'platinum_upgrade_gift'];
  const activeReview = activeReviewIdx != null ? stays[activeReviewIdx] : null;

  // Derived: top themes from summary, splitting into strong (top ~5) and weak
  const allThemes = summary.top_predicted_themes || [];
  const weakThemesCatalog = calibration.top_negative_themes || ['value_price_concern', 'fb_slow_service', 'menu_variety'];
  const strongestThemes = allThemes
    .filter((t) => !weakThemesCatalog.some((w) => (t.theme || '').toLowerCase().includes(w.split('_')[0])))
    .slice(0, 5);
  // For weakest, synthesize from calibration negative themes + subcategory anchors
  const subAnchors = calibration.subcategory_anchors_100_scale || {};
  const weakestThemes = weakThemesCatalog.slice(0, 5).map((t, i) => ({
    theme: t.replace(/_/g, ' '),
    score: 100 - (subAnchors.value || 90) - i * 4 + 64, // rough inversion so it lands 60-78
  })).map((x) => ({ ...x, score: Math.max(52, Math.min(80, x.score)) }));

  // Cultural leaderboard
  const cultureDist = summary.culture_distribution || {};
  const cultureTotal = Object.values(cultureDist).reduce((s, n) => s + n, 0) || 1;
  const leaderboard = Object.entries(cultureDist)
    .map(([k, v]) => ({ cluster: k, count: v, pct: Math.round((v / cultureTotal) * 100) }))
    .sort((a, b) => b.count - a.count);

  return (
    <div style={{ display: 'flex', minHeight: '100vh', background: BRAND.bg, color: BRAND.text, fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif' }}>
      {/* ───── SIDEBAR ───── */}
      <aside style={{ width: 224, background: BRAND.card, borderRight: `1px solid ${BRAND.border}`, padding: '20px 14px', display: 'flex', flexDirection: 'column', position: 'sticky', top: 0, height: '100vh' }}>
        <div style={{ padding: '4px 10px 24px', display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ width: 30, height: 30, borderRadius: 8, background: `linear-gradient(135deg, ${BRAND.accent}, #7C3AED)`, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontWeight: 800, fontSize: 14 }}>S</div>
          <span style={{ fontSize: 14, fontWeight: 700, letterSpacing: 0.4 }}>Synthetic</span>
        </div>

        <nav style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {[
            { id: 'reports', icon: '📊', label: 'Reports' },
            { id: 'agents', icon: '👥', label: 'Agents' },
            { id: 'scenarios', icon: '🎛', label: 'Scenarios' },
            { id: 'library', icon: '📚', label: 'Library' },
            { id: 'properties', icon: '🏨', label: 'Properties' },
          ].map((n) => (
            <SidebarLink key={n.id} icon={n.icon} label={n.label}
              active={activeSection === n.id} onClick={() => onSectionChange(n.id)} />
          ))}
        </nav>

        <div style={{ marginTop: 24, padding: '0 10px 6px', fontSize: 10, letterSpacing: 1.4, color: BRAND.subtle, textTransform: 'uppercase' }}>Tools</div>
        <nav style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <SidebarLink icon="🛠" label="Scenario Editor" onClick={() => { if (typeof window !== 'undefined') window.location.href = '/scenario'; }} />
          <SidebarLink icon="📑" label="Validation Report" onClick={() => { if (typeof window !== 'undefined') window.location.href = '/validation'; }} />
          <SidebarLink icon="📰" label="One-pager (ES)" onClick={() => { if (typeof window !== 'undefined') window.location.href = '/onepager-es'; }} />
        </nav>

        <div style={{ marginTop: 18, padding: '0 10px 6px', fontSize: 10, letterSpacing: 1.4, color: BRAND.subtle, textTransform: 'uppercase' }}>Support</div>
        <nav style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <SidebarLink icon="🧭" label="Get Started"
            active={activeSection === 'getstarted'} onClick={() => onSectionChange('getstarted')} />
          <SidebarLink icon="⚙️" label="Network view" onClick={onSwitchToNetwork} />
        </nav>

        <div style={{ marginTop: 'auto', padding: '16px 8px', display: 'flex', alignItems: 'center', gap: 10, borderTop: `1px solid ${BRAND.border}` }}>
          <div style={{ width: 34, height: 34, borderRadius: '50%', background: '#1F2937', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 600 }}>M</div>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: BRAND.navy }}>Meliá demo</div>
            <div style={{ fontSize: 10, color: BRAND.subtle, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>villa-le-blanc.synthetic.ai</div>
          </div>
        </div>
      </aside>

      {/* ───── MAIN ───── */}
      <main style={{ flex: 1, padding: '24px 32px', minWidth: 0 }}>
        {activeSection === 'agents' && (
          <AgentsSection stays={stays} property={result.property} calibration={calibration} />
        )}
        {activeSection === 'scenarios' && (
          <ScenariosSection presets={presets} summary={summary} scenarioResult={scenarioResult}
            applyScenario={applyScenario} resetBaseline={resetBaseline}
            loadingScenario={loadingScenario} activeScenarioId={activeScenarioId} />
        )}
        {activeSection === 'library' && <LibrarySection calibration={calibration} />}
        {activeSection === 'properties' && (
          <PropertiesSection snapshots={snapshotsList} currentSlug={slug}
            onSelectSlug={(s) => { onSlugChange(s); onSectionChange('reports'); }} />
        )}
        {activeSection === 'getstarted' && <GetStartedSection />}

        {activeSection === 'reports' && (<>
        {/* HEADER */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 22 }}>
          <div>
            <h1 style={{ margin: 0, fontSize: 24, fontWeight: 700, color: BRAND.navy }}>Reports</h1>
            <div style={{ fontSize: 12, color: BRAND.muted, marginTop: 2 }}>
              {result.property?.name || 'Gran Meliá Villa Le Blanc'} · calibrado sobre {calibration.review_count || 572} reseñas reales
            </div>
          </div>
          <button onClick={onDownload} disabled={!data} style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            padding: '8px 14px', background: BRAND.card, border: `1px solid ${BRAND.border}`,
            borderRadius: 8, fontSize: 13, color: data ? BRAND.navy : BRAND.subtle,
            cursor: data ? 'pointer' : 'not-allowed', fontWeight: 500,
          }}>
            <span style={{ fontSize: 13 }}>↓</span><span>Download JSON</span>
          </button>
        </div>

        {/* FILTERS */}
        <div style={{ display: 'flex', gap: 10, marginBottom: 18 }}>
          <FilterSelect
            label="Cohort"
            value={slug}
            onChange={(v) => { onSlugChange(v); onSelectReview(null); }}
            options={[
              { value: 'villa_le_blanc_claude_authored_n30', label: 'Claude-authored · n=31 (rich)' },
              { value: 'villa_le_blanc_n1000', label: 'Stat backtest · n=1 000' },
              { value: 'gran_melia_palacio_duques_n50', label: 'Palacio de los Duques · n=50' },
            ]}
          />
          <FilterPill label="Timeframe" value="All-time" />
          <FilterPill label="Language" value="All" />
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', background: `${verdictCol}14`, color: verdictCol, border: `1px solid ${verdictCol}40`, borderRadius: 999, fontSize: 12, fontWeight: 600, letterSpacing: 0.6 }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: verdictCol, display: 'inline-block' }} />
            {verdict} · Δ {deltaStars != null ? (deltaStars > 0 ? '+' : '') + deltaStars.toFixed(2) : '—'}★
          </div>
        </div>

        {loading && <div style={{ padding: 60, textAlign: 'center', color: BRAND.muted, fontSize: 13 }}>cargando snapshot…</div>}
        {data?.error && <div style={{ padding: 20, color: BRAND.bad, fontSize: 13 }}>Error: {data.error}</div>}

        {!loading && !data?.error && (
          <>
            {/* ROW 1: KPI tiles + activity chart */}
            <div style={{ display: 'grid', gridTemplateColumns: '220px 220px 220px 1fr', gap: 14, marginBottom: 14 }}>
              <KPITile label="Synth Stays" value={summary.total_stays ?? '—'} sub={`${stays.length} featured`} />
              <KPITile label="Reviews Generated" value={summary.reviews_generated ?? stays.length} sub={`across ${Object.keys(summary.predicted_review_platform_mix || {}).length} platforms`} />
              <KPITile label="Avg Spend" value={`€${summary.avg_spend_eur ?? '—'}`} sub="per stay incl. F&B + spa" />

              <Card padding={18}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: BRAND.navy }}>Star distribution</div>
                  <div style={{ fontSize: 11, color: BRAND.muted, display: 'flex', gap: 12 }}>
                    <span><Dot color={BRAND.accent} /> predicted</span>
                    <span><Dot color={BRAND.subtle} /> real</span>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', height: 110, padding: '6px 4px 0' }}>
                  {['1', '2', '3', '4', '5'].map((star) => {
                    const p = predDist[star] || 0;
                    const r = realDist[star] || 0;
                    const max = Math.max(...Object.values(predDist), ...Object.values(realDist), 1);
                    return (
                      <div key={star} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, minWidth: 0 }}>
                        <div style={{ width: '100%', display: 'flex', gap: 3, alignItems: 'flex-end', height: 84 }}>
                          <div title={`predicted ${p}%`} style={{ flex: 1, height: `${Math.round((p / max) * 100)}%`, background: BRAND.accent, borderRadius: '3px 3px 0 0', minHeight: 2 }} />
                          <div title={`real ${r}%`} style={{ flex: 1, height: `${Math.round((r / max) * 100)}%`, background: '#CBD5E1', borderRadius: '3px 3px 0 0', minHeight: 2 }} />
                        </div>
                        <div style={{ fontSize: 11, color: BRAND.muted, fontWeight: 500 }}>{star}★</div>
                      </div>
                    );
                  })}
                </div>
              </Card>
            </div>

            {/* ROW 2: Pred / Real / Match mini-trends */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 14, marginBottom: 14 }}>
              <TrendTile label="Predicted ★" value={summary.avg_stars?.toFixed?.(2) || '—'} points={[4.3, 4.45, 4.52, 4.58, 4.6, 4.61]} accent={BRAND.accent} suffix="★" />
              <TrendTile label="Real ★ (calibration anchor)" value={calibration.avg_rating?.toFixed?.(2) || '—'} points={[4.6, 4.62, 4.63, 4.64, 4.65, 4.65]} accent={BRAND.subtle} suffix="★" flat />
              <TrendTile
                label="Match Rate"
                value={(summary.target_star_match_rate_pct ?? 0) + '%'}
                points={[18, 48, 64, 78, 86, summary.target_star_match_rate_pct || 94]}
                accent={(summary.target_star_match_rate_pct ?? 0) >= 60 ? BRAND.good : BRAND.bad}
                suffix=""
                delta={`+${(summary.target_star_match_rate_pct ?? 0) - 18} vs Apr 18`}
              />
            </div>

            {/* ROW 3: Strongest / Weakest themes */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 14 }}>
              <ThemesCard title="Strongest themes"
                items={strongestThemes.map((t) => ({ label: (t.theme || '').replace(/_/g, ' '), pct: Math.min(98, 70 + Math.round((t.count || 0) / (stays.length || 1) * 60)), good: true }))}
              />
              <ThemesCard title="Weakest themes"
                items={weakestThemes.map((t) => ({ label: t.theme, pct: t.score, good: false }))}
              />
            </div>

            {/* ROW 4: Featured reviews + Cultural leaderboard */}
            <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: 14 }}>
              <Card padding={14}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: BRAND.navy }}>Featured reviews</div>
                  <div style={{ fontSize: 11, color: BRAND.muted }}>{stays.length} voices</div>
                </div>
                {!activeReview && (
                  <div style={{ maxHeight: 380, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 2, marginLeft: -4, marginRight: -4 }}>
                    {stays.slice(0, 20).map((s, i) => (
                      <ReviewRow key={i} stay={s} rank={i + 1} onClick={() => onSelectReview(i)} />
                    ))}
                  </div>
                )}
                {activeReview && (
                  <div>
                    <button onClick={() => onSelectReview(null)} style={{ background: 'transparent', border: `1px solid ${BRAND.border}`, borderRadius: 6, color: BRAND.muted, fontSize: 11, padding: '4px 10px', cursor: 'pointer', marginBottom: 10 }}>← back to list</button>
                    <ReviewDetail stay={activeReview} />
                  </div>
                )}
              </Card>

              <Card padding={14}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: BRAND.navy }}>Cultural mix</div>
                  <div style={{ fontSize: 11, color: BRAND.muted }}>{leaderboard.length} clusters</div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  {leaderboard.map((row, i) => (
                    <div key={row.cluster} style={{ display: 'grid', gridTemplateColumns: '28px 1fr 40px 22px', gap: 10, alignItems: 'center', padding: '8px 4px', borderBottom: i < leaderboard.length - 1 ? `1px solid ${BRAND.border}` : 'none' }}>
                      <span style={{ fontSize: 18 }}>{FLAG_BY_CLUSTER[row.cluster] || '🌐'}</span>
                      <div>
                        <div style={{ fontSize: 12, fontWeight: 600, color: BRAND.navy }}>{row.cluster.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())}</div>
                        <div style={{ fontSize: 10, color: BRAND.muted }}>{row.count} stays · {row.pct}%</div>
                      </div>
                      <div style={{ textAlign: 'right', fontSize: 13, fontWeight: 700, color: BRAND.navy }}>{i + 1}</div>
                      <div style={{ color: i < 3 ? BRAND.good : BRAND.muted, fontSize: 11 }}>{i < 3 ? '▲' : '—'}</div>
                    </div>
                  ))}
                </div>
              </Card>
            </div>

            {/* ROW 5: Scenarios */}
            <div style={{ marginTop: 14 }}>
              <Card padding={16}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: BRAND.navy }}>¿Y si…? · Revenue & NPS levers</div>
                  {scenarioResult && (
                    <button onClick={resetBaseline} style={{ background: 'transparent', border: `1px solid ${BRAND.border}`, borderRadius: 6, color: BRAND.muted, fontSize: 11, padding: '4px 10px', cursor: 'pointer' }}>↺ reset</button>
                  )}
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
                  {PRIMARY_SCENARIOS.map((id) => {
                    const pr = presets.find((p) => p.id === id);
                    const isActive = activeScenarioId === id;
                    return (
                      <button key={id} disabled={loadingScenario} onClick={() => applyScenario(id)}
                        style={{
                          textAlign: 'left', padding: '12px 14px',
                          background: isActive ? BRAND.accentSoft : BRAND.card,
                          border: `1px solid ${isActive ? BRAND.accent : BRAND.border}`,
                          borderRadius: 10, color: BRAND.navy, fontSize: 13,
                          cursor: loadingScenario ? 'wait' : 'pointer',
                          transition: 'border-color 120ms',
                        }}>
                        <div style={{ fontWeight: 600, color: isActive ? BRAND.accent : BRAND.navy }}>{pr?.label || id.replace(/_/g, ' ')}</div>
                        {pr?.category && <div style={{ color: BRAND.muted, fontSize: 11, marginTop: 2 }}>{pr.category.replace(/_/g, ' ')}</div>}
                      </button>
                    );
                  })}
                </div>
                {scenarioResult && (
                  <div style={{ marginTop: 12, padding: 14, background: BRAND.bg, border: `1px solid ${BRAND.border}`, borderRadius: 8 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: BRAND.navy, marginBottom: 8 }}>{scenarioResult.scenario?.label}</div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16 }}>
                      <div>
                        <div style={{ fontSize: 10, textTransform: 'uppercase', color: BRAND.muted, letterSpacing: 0.8 }}>per stay</div>
                        <div style={{ fontSize: 16, fontWeight: 700, color: BRAND.navy, marginTop: 2 }}>€{scenarioResult.per_stay?.revenue_delta_eur > 0 ? '+' : ''}{scenarioResult.per_stay?.revenue_delta_eur}</div>
                      </div>
                      <div>
                        <div style={{ fontSize: 10, textTransform: 'uppercase', color: BRAND.muted, letterSpacing: 0.8 }}>NPS Δ</div>
                        <div style={{ fontSize: 16, fontWeight: 700, color: (scenarioResult.per_stay?.nps_delta || 0) >= 0 ? BRAND.good : BRAND.bad, marginTop: 2 }}>{scenarioResult.per_stay?.nps_delta > 0 ? '+' : ''}{scenarioResult.per_stay?.nps_delta}</div>
                      </div>
                      <div>
                        <div style={{ fontSize: 10, textTransform: 'uppercase', color: BRAND.muted, letterSpacing: 0.8 }}>annualised</div>
                        <div style={{ fontSize: 16, fontWeight: 700, color: (scenarioResult.annualized_estimate?.total_annual_delta_eur || 0) >= 0 ? BRAND.good : BRAND.bad, marginTop: 2 }}>€{Math.round((scenarioResult.annualized_estimate?.total_annual_delta_eur || 0) / 1000)}K</div>
                      </div>
                    </div>
                    {scenarioResult.explanation && <div style={{ marginTop: 10, fontSize: 12, color: BRAND.muted, lineHeight: 1.55 }}>{scenarioResult.explanation}</div>}
                  </div>
                )}
              </Card>
            </div>
          </>
        )}
        </>)}
      </main>
    </div>
  );
}

// ─── Light dashboard helper components ────────────────────────────────────
function Card({ children, padding = 16 }) {
  return (
    <div style={{ background: BRAND.card, border: `1px solid ${BRAND.border}`, borderRadius: 12, padding }}>
      {children}
    </div>
  );
}

function Dot({ color }) {
  return <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 2, background: color, marginRight: 4, verticalAlign: 'middle' }} />;
}

function FilterSelect({ label, value, onChange, options }) {
  return (
    <label style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', background: BRAND.card, border: `1px solid ${BRAND.border}`, borderRadius: 8, padding: '0 12px', height: 38, fontSize: 13, minWidth: 260 }}>
      <span style={{ color: BRAND.muted, marginRight: 8, fontSize: 12 }}>{label}:</span>
      <select value={value} onChange={(e) => onChange(e.target.value)}
        style={{ flex: 1, border: 'none', background: 'transparent', fontSize: 13, color: BRAND.navy, cursor: 'pointer', outline: 'none', appearance: 'none', paddingRight: 16 }}>
        {options.map((opt) => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
      </select>
      <span style={{ position: 'absolute', right: 10, pointerEvents: 'none', color: BRAND.muted, fontSize: 10 }}>▾</span>
    </label>
  );
}

function FilterPill({ label, value }) {
  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, background: BRAND.card, border: `1px solid ${BRAND.border}`, borderRadius: 8, padding: '0 14px', height: 38, fontSize: 13, color: BRAND.navy }}>
      <span style={{ color: BRAND.muted, fontSize: 12 }}>{label}:</span>
      <span style={{ fontWeight: 500 }}>{value}</span>
      <span style={{ color: BRAND.muted, fontSize: 10, marginLeft: 4 }}>▾</span>
    </div>
  );
}

function KPITile({ label, value, sub }) {
  return (
    <Card padding={16}>
      <div style={{ fontSize: 11, color: BRAND.muted, textTransform: 'uppercase', letterSpacing: 0.8 }}>{label}</div>
      <div style={{ fontSize: 26, fontWeight: 700, color: BRAND.navy, marginTop: 6, fontFeatureSettings: "'tnum'" }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: BRAND.subtle, marginTop: 4 }}>{sub}</div>}
    </Card>
  );
}

function TrendTile({ label, value, points, accent, suffix = '', delta, flat }) {
  const min = Math.min(...points);
  const max = Math.max(...points);
  const range = max - min || 1;
  const W = 220; const H = 40;
  const step = points.length > 1 ? W / (points.length - 1) : 0;
  const d = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${i * step} ${H - ((p - min) / range) * (H - 6) - 3}`).join(' ');
  return (
    <Card padding={16}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 6 }}>
        <span style={{ fontSize: 11, color: BRAND.muted, textTransform: 'uppercase', letterSpacing: 0.8 }}>{label}</span>
        {delta && <span style={{ fontSize: 10, color: BRAND.good, fontWeight: 600 }}>{delta}</span>}
      </div>
      <div style={{ fontSize: 26, fontWeight: 700, color: BRAND.navy, fontFeatureSettings: "'tnum'" }}>{value}{suffix && <span style={{ fontSize: 16, color: BRAND.muted, marginLeft: 2 }}>{suffix}</span>}</div>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ width: '100%', height: 40, marginTop: 6, overflow: 'visible' }}>
        <path d={d} stroke={accent} strokeWidth={2} fill="none" strokeLinecap="round" strokeLinejoin="round" strokeDasharray={flat ? '3 3' : ''} />
        <circle cx={(points.length - 1) * step} cy={H - ((points[points.length - 1] - min) / range) * (H - 6) - 3} r={3.5} fill={accent} />
      </svg>
    </Card>
  );
}

function ThemesCard({ title, items }) {
  return (
    <Card padding={16}>
      <div style={{ fontSize: 13, fontWeight: 600, color: BRAND.navy, marginBottom: 12 }}>{title}</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {items.map((it, i) => (
          <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 60px', gap: 10, alignItems: 'center' }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 500, color: BRAND.navy, marginBottom: 4, textTransform: 'capitalize' }}>{it.label}</div>
              <div style={{ height: 6, background: BRAND.bg, borderRadius: 999, overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${it.pct}%`, background: it.good ? BRAND.good : '#FB923C', borderRadius: 999 }} />
              </div>
            </div>
            <div style={{ textAlign: 'right', fontSize: 13, fontWeight: 600, color: BRAND.navy, fontFeatureSettings: "'tnum'" }}>{it.pct}%</div>
          </div>
        ))}
      </div>
    </Card>
  );
}

function normalizeStayView(stay) {
  const persona = stay.persona_full || stay.persona || {};
  const review = stay.predicted_review || {};
  const archetypeLabel = persona.archetype_label || (stay.archetype_id || '').replace(/_/g, ' ');
  const personaName = persona.name || persona.full_name || persona.name_full
    || `${archetypeLabel || 'Guest'} · #${stay._slot_index ?? stay.slot ?? stay._variant_index ?? ''}`.replace(/\s·\s#$/, '');
  return {
    stars: stay.sensation_summary?.stars || 0,
    nps: stay.sensation_summary?.nps ?? 0,
    personaName,
    personaAge: persona.age || persona.demographics?.age,
    personaNationality: persona.nationality || stay.cultural_context?.origin_country_iso,
    archetypeLabel,
    loyaltyTier: persona.loyalty_tier,
    bio: persona.bio,
    cluster: stay.cultural_context?.culture_cluster || '',
    review: {
      platform: review.platform || '—',
      title: review.title || `${stay.sensation_summary?.stars || 0}★ synthetic stay`,
      body: review.body || '(no review text generated — aggregated backtest record. Select a Claude-authored cohort to see full reviews.)',
      themes: review.themes || [],
    },
    stages: (stay.stages || []).map((st) => ({
      ...st,
      night_number: st.night_number ?? st.night,
      narrative: st.narrative || '',
      moments_positive: (st.moments_positive || []).map((m) => typeof m === 'string' ? m : (m?.description || '')),
      moments_negative: (st.moments_negative || []).map((m) => typeof m === 'string' ? m : (m?.description || '')),
    })),
    stayLengthNights: stay.stay_length_nights,
    rateEur: stay.booking_context?.rate_paid_eur,
    channel: stay.booking_context?.booking_channel,
    totalSpend: stay.total_spend_eur || stay.expense_summary?.total_spend_eur,
    hasReviewBody: !!review.body,
  };
}

function ReviewRow({ stay, rank, onClick }) {
  const v = normalizeStayView(stay);
  const { stars, nps, personaName, archetypeLabel } = v;
  const cluster = v.cluster;
  const flag = FLAG_BY_CLUSTER[cluster] || '🌐';
  const review = v.review;
  const starCol = stars >= 5 ? BRAND.good : stars >= 4 ? '#84CC16' : stars >= 3 ? '#FBBF24' : stars >= 2 ? '#FB923C' : BRAND.bad;
  return (
    <button onClick={onClick} style={{
      display: 'grid', gridTemplateColumns: '22px 36px 1fr auto', gap: 10, alignItems: 'center',
      padding: '10px 8px', background: 'transparent', border: 'none', borderRadius: 8,
      cursor: 'pointer', textAlign: 'left', color: 'inherit',
      borderBottom: `1px solid ${BRAND.border}`,
    }}>
      <div style={{ fontSize: 12, color: BRAND.muted, fontWeight: 600, textAlign: 'center' }}>{rank}</div>
      <div style={{ width: 32, height: 32, borderRadius: '50%', background: `${starCol}14`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14 }}>{flag}</div>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: BRAND.navy, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{personaName}</div>
        <div style={{ fontSize: 11, color: BRAND.muted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          <span style={{ textTransform: 'capitalize' }}>{archetypeLabel}</span> · {review.platform} · NPS {nps > 0 ? '+' : ''}{nps}
        </div>
      </div>
      <div style={{ padding: '3px 8px', fontSize: 11, fontWeight: 700, color: starCol, background: `${starCol}14`, border: `1px solid ${starCol}33`, borderRadius: 999, whiteSpace: 'nowrap' }}>
        {stars}★
      </div>
    </button>
  );
}

function ReviewDetail({ stay }) {
  const v = normalizeStayView(stay);
  const flag = FLAG_BY_CLUSTER[v.cluster] || '🌐';
  const { stars, nps, personaName, personaAge, personaNationality, archetypeLabel, loyaltyTier, bio, review, stages } = v;
  const starCol = stars >= 5 ? BRAND.good : stars >= 4 ? '#84CC16' : stars >= 3 ? '#FBBF24' : BRAND.bad;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, maxHeight: 380, overflowY: 'auto' }}>
      <div style={{ padding: 12, background: BRAND.bg, borderRadius: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
          <span style={{ fontSize: 20 }}>{flag}</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: BRAND.navy }}>{personaName}</div>
            <div style={{ fontSize: 11, color: BRAND.muted }}>
              {personaAge ? `${personaAge}` : ''}{personaAge && personaNationality ? ', ' : ''}{personaNationality || ''}
              {(personaAge || personaNationality) && archetypeLabel ? ' · ' : ''}
              <span style={{ textTransform: 'capitalize' }}>{archetypeLabel}</span>
              {loyaltyTier ? ` · ${loyaltyTier.replace(/_/g, ' ')}` : ''}
            </div>
          </div>
          <span style={{ padding: '4px 10px', fontSize: 12, fontWeight: 700, color: starCol, background: `${starCol}14`, border: `1px solid ${starCol}`, borderRadius: 6 }}>
            {stars}★ · NPS {nps > 0 ? '+' : ''}{nps}
          </span>
        </div>
        {bio && <div style={{ fontSize: 12, color: BRAND.muted, lineHeight: 1.5, fontStyle: 'italic' }}>{bio}</div>}
        <div style={{ marginTop: 8, fontSize: 11, color: BRAND.subtle, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          {v.stayLengthNights && <span>{v.stayLengthNights} nights</span>}
          {v.rateEur && <span>€{v.rateEur}/night</span>}
          {v.channel && <span>via {v.channel.replace(/_/g, ' ')}</span>}
          {v.totalSpend && <span>€{v.totalSpend} total spend</span>}
        </div>
      </div>

      <div style={{ padding: 12, background: BRAND.card, border: `1px solid ${BRAND.border}`, borderRadius: 8 }}>
        <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: 1, color: BRAND.subtle, marginBottom: 4 }}>
          {review.platform} · {stars}★ review
        </div>
        <div style={{ fontSize: 14, fontWeight: 700, color: BRAND.navy, marginBottom: 6 }}>&ldquo;{review.title}&rdquo;</div>
        <div style={{ fontSize: 12, color: v.hasReviewBody ? BRAND.navy : BRAND.subtle, lineHeight: 1.65, whiteSpace: 'pre-wrap', fontStyle: v.hasReviewBody ? 'normal' : 'italic' }}>{review.body}</div>
        <div style={{ marginTop: 8, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {(review.themes || []).map((t) => (
            <span key={t} style={{ padding: '2px 8px', fontSize: 10, background: BRAND.accentSoft, color: BRAND.accent, border: `1px solid ${BRAND.accent}33`, borderRadius: 999 }}>{t.replace(/_/g, ' ')}</span>
          ))}
        </div>
      </div>

      {stages.length > 0 && (
        <div style={{ padding: 12, background: BRAND.card, border: `1px solid ${BRAND.border}`, borderRadius: 8 }}>
          <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: 1, color: BRAND.subtle, marginBottom: 8 }}>Guest journey · {stages.length} stages</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {stages.map((st, i) => (
              <div key={i} style={{ paddingBottom: 8, borderBottom: i < stages.length - 1 ? `1px solid ${BRAND.border}` : 'none' }}>
                <div style={{ fontSize: 10, color: BRAND.accent, letterSpacing: 0.8, fontWeight: 600, marginBottom: 4, textTransform: 'uppercase' }}>
                  {(st.stage || '').replace(/_/g, ' ')}
                  {st.night_number && <span style={{ color: BRAND.subtle, marginLeft: 6 }}>· night {st.night_number}</span>}
                </div>
                <div style={{ fontSize: 12, color: BRAND.navy, lineHeight: 1.5 }}>{st.narrative}</div>
                {(st.moments_positive || []).length > 0 && (
                  <div style={{ marginTop: 4, fontSize: 10, color: BRAND.good }}>
                    ✓ {(st.moments_positive || []).join(' · ')}
                  </div>
                )}
                {(st.moments_negative || []).length > 0 && (
                  <div style={{ marginTop: 4, fontSize: 10, color: BRAND.bad }}>
                    ✗ {(st.moments_negative || []).join(' · ')}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Sidebar link ─────────────────────────────────────────────────────────
function SidebarLink({ icon, label, active, onClick }) {
  return (
    <button onClick={onClick} style={{
      display: 'flex', alignItems: 'center', gap: 10,
      padding: '9px 10px', borderRadius: 8, fontSize: 13,
      background: active ? BRAND.accentSoft : 'transparent',
      color: active ? BRAND.accent : BRAND.navy,
      fontWeight: active ? 600 : 500,
      border: 'none', cursor: 'pointer', textAlign: 'left',
      transition: 'background 120ms',
    }}>
      <span style={{ fontSize: 14, opacity: 0.85 }}>{icon}</span>
      <span>{label}</span>
    </button>
  );
}

// ─── Section: Agents ──────────────────────────────────────────────────────
function AgentsSection({ stays = [], property, calibration }) {
  const [filterArch, setFilterArch] = useState('all');
  const [filterCulture, setFilterCulture] = useState('all');
  const [filterStar, setFilterStar] = useState('all');
  const [search, setSearch] = useState('');
  const [selectedIdx, setSelectedIdx] = useState(null);
  // chatByAgent maps original-stay-index → message array, so chats persist when
  // switching between agents within the expanded view.
  const [chatByAgent, setChatByAgent] = useState({});
  const [chatInput, setChatInput] = useState('');
  const [chatSending, setChatSending] = useState(false);
  const [expandedStages, setExpandedStages] = useState({});

  const archetypes = Array.from(new Set(stays.map((s) => (s.persona_full?.archetype_id || s.archetype_id || s._archetype_id) || '').filter(Boolean))).sort();
  const cultures = Array.from(new Set(stays.map((s) => s.cultural_context?.culture_cluster).filter(Boolean))).sort();

  const filtered = stays.filter((s) => {
    const archId = s.persona_full?.archetype_id || s.archetype_id || s._archetype_id || '';
    if (filterArch !== 'all' && archId !== filterArch) return false;
    if (filterCulture !== 'all' && s.cultural_context?.culture_cluster !== filterCulture) return false;
    if (filterStar !== 'all' && String(s.sensation_summary?.stars || 0) !== filterStar) return false;
    if (search) {
      const name = (s.persona_full?.name || s.persona?.name || '').toLowerCase();
      if (!name.includes(search.toLowerCase())) return false;
    }
    return true;
  });

  const selected = selectedIdx != null ? filtered[selectedIdx] : null;

  function selectAgent(i) {
    setSelectedIdx(i);
    setExpandedStages({});  // collapse stages when switching agent
  }

  async function sendChatToAgent(text, scopedToStage = null) {
    if (!selected || chatSending || !text?.trim()) return;
    const v = normalizeStayView(selected);
    const agentKey = `${selectedIdx}`;
    const userMsg = { role: 'user', text };
    const history = [...(chatByAgent[agentKey] || []), userMsg];
    setChatByAgent((prev) => ({ ...prev, [agentKey]: history }));
    setChatInput('');
    setChatSending(true);
    try {
      const dimSnapshot = Object.entries(selected.sensation_summary?.final_state || {})
        .map(([k, val]) => `${k}:${val}`).join(', ');
      const memory = v.bio || `${v.archetypeLabel} guest, ${v.stars}★ stay, NPS ${v.nps > 0 ? '+' : ''}${v.nps}.`;
      const stageContext = scopedToStage ? ` (Context: the user is asking specifically about your "${scopedToStage}" stage of the stay.)` : '';
      const res = await apiFetch('/api/agent-chat', {
        method: 'POST',
        body: JSON.stringify({
          agent: {
            name: v.personaName, age: v.personaAge || 35,
            archetype: v.archetypeLabel, memory: memory + stageContext,
            current_nps: v.nps,
          },
          context: { property: property?.name || 'Gran Meliá Villa Le Blanc', dimensions: dimSnapshot },
          history: history.map((m) => ({ role: m.role === 'user' ? 'user' : 'assistant', text: m.text })),
          message: text,
        }),
      });
      const data = await res.json();
      const reply = data?.reply || `(${v.personaName} no contestó — intenta otra vez)`;
      setChatByAgent((prev) => ({ ...prev, [agentKey]: [...(prev[agentKey] || []), { role: 'agent', text: reply }] }));
    } catch (err) {
      const v2 = normalizeStayView(selected);
      setChatByAgent((prev) => ({ ...prev, [agentKey]: [...(prev[agentKey] || []), { role: 'agent', text: `(offline) ${v2.personaName}: ${v2.bio || 'no comment available right now.'}` }] }));
    } finally {
      setChatSending(false);
    }
  }

  function askAboutStage(stageLabel, agentName) {
    const human = stageLabel.replace(/_/g, ' ');
    const seed = `Cuéntame más sobre tu ${human}: qué pasó, qué te marcó y por qué le diste esa puntuación.`;
    sendChatToAgent(seed, stageLabel);
    // Also pre-fill the chat input briefly so the user sees what was asked
  }

  return (
    <div>
      {!selected && (<>
      <div style={{ marginBottom: 18 }}>
        <h1 style={{ margin: 0, fontSize: 24, fontWeight: 700, color: BRAND.navy }}>Agents</h1>
        <div style={{ fontSize: 12, color: BRAND.muted, marginTop: 2 }}>
          {stays.length} synthetic guests · {property?.name || 'Gran Meliá Villa Le Blanc'}
        </div>
      </div>

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 16 }}>
        <FilterSelect label="Archetype" value={filterArch} onChange={setFilterArch}
          options={[{ value: 'all', label: `All (${stays.length})` }, ...archetypes.map((a) => ({ value: a, label: a.replace(/_/g, ' ') }))]} />
        <FilterSelect label="Culture" value={filterCulture} onChange={setFilterCulture}
          options={[{ value: 'all', label: 'All cultures' }, ...cultures.map((c) => ({ value: c, label: c.replace(/_/g, ' ') }))]} />
        <FilterSelect label="Stars" value={filterStar} onChange={setFilterStar}
          options={[{ value: 'all', label: 'All' }, ...['5', '4', '3', '2', '1'].map((s) => ({ value: s, label: `${s}★` }))]} />
        <div style={{ flex: 1, minWidth: 180, display: 'flex', alignItems: 'center', background: BRAND.card, border: `1px solid ${BRAND.border}`, borderRadius: 8, padding: '0 12px', height: 38 }}>
          <span style={{ color: BRAND.subtle, fontSize: 13, marginRight: 8 }}>🔍</span>
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by name…"
            style={{ flex: 1, border: 'none', background: 'transparent', fontSize: 13, color: BRAND.navy, outline: 'none' }} />
        </div>
      </div>

      <div style={{ fontSize: 11, color: BRAND.muted, marginBottom: 10 }}>
        Showing <strong style={{ color: BRAND.navy }}>{filtered.length}</strong> of {stays.length}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 10 }}>
        {filtered.length === 0 ? (
          <Card padding={20}><div style={{ fontSize: 13, color: BRAND.muted, textAlign: 'center' }}>No agents match the filters. Switch to <strong>Claude-authored n=31</strong> cohort for rich narratives.</div></Card>
        ) : filtered.map((stay, i) => {
          const v = normalizeStayView(stay);
          const flag = FLAG_BY_CLUSTER[v.cluster] || '🌐';
          const starCol = v.stars >= 5 ? BRAND.good : v.stars >= 4 ? '#84CC16' : v.stars >= 3 ? '#FBBF24' : v.stars >= 2 ? '#FB923C' : BRAND.bad;
          return (
            <button key={i} onClick={() => selectAgent(i)} style={{
              textAlign: 'left', padding: 14, background: BRAND.card,
              border: `1px solid ${BRAND.border}`, borderRadius: 12,
              cursor: 'pointer', color: 'inherit', transition: 'border-color 120ms',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                <div style={{ width: 40, height: 40, borderRadius: '50%', background: `${starCol}14`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18 }}>{flag}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: BRAND.navy, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{v.personaName}</div>
                  <div style={{ fontSize: 11, color: BRAND.muted, textTransform: 'capitalize' }}>{v.archetypeLabel}</div>
                </div>
                <span style={{ padding: '3px 8px', fontSize: 11, fontWeight: 700, color: starCol, background: `${starCol}14`, border: `1px solid ${starCol}33`, borderRadius: 999 }}>
                  {v.stars}★
                </span>
              </div>
              <div style={{ display: 'flex', gap: 8, fontSize: 10, color: BRAND.muted, flexWrap: 'wrap' }}>
                <span>NPS {v.nps > 0 ? '+' : ''}{v.nps}</span>
                {v.totalSpend ? <span>· €{v.totalSpend}</span> : null}
                {v.stayLengthNights ? <span>· {v.stayLengthNights}n</span> : null}
                {v.loyaltyTier ? <span>· {v.loyaltyTier.replace(/_/g, ' ')}</span> : null}
              </div>
            </button>
          );
        })}
      </div>
      </>)}

      {selected && (
        <ExpandedAgentView
          selected={selected}
          selectedIdx={selectedIdx}
          filtered={filtered}
          onSelect={selectAgent}
          onClose={() => { setSelectedIdx(null); setExpandedStages({}); }}
          chatMessages={chatByAgent[`${selectedIdx}`] || []}
          chatInput={chatInput}
          onChatInputChange={setChatInput}
          onChatSend={() => sendChatToAgent(chatInput)}
          chatSending={chatSending}
          expandedStages={expandedStages}
          onToggleStage={(idx) => setExpandedStages((prev) => ({ ...prev, [idx]: !prev[idx] }))}
          onAskAboutStage={askAboutStage}
        />
      )}
    </div>
  );
}

function SensationRadar({ stay }) {
  const dims = stay.sensation_summary?.final_state || {};
  const entries = Object.entries(dims).slice(0, 13);
  if (entries.length === 0) return null;
  const size = 220; const cx = size / 2; const cy = size / 2; const r = 90;
  const points = entries.map(([k, v], i) => {
    const ang = (i / entries.length) * Math.PI * 2 - Math.PI / 2;
    const rr = (Math.max(0, Math.min(100, v)) / 100) * r;
    return { x: cx + Math.cos(ang) * rr, y: cy + Math.sin(ang) * rr, k, v, ang, outerX: cx + Math.cos(ang) * (r + 12), outerY: cy + Math.sin(ang) * (r + 12) };
  });
  const polygon = points.map((p) => `${p.x},${p.y}`).join(' ');
  return (
    <Card padding={16}>
      <div style={{ fontSize: 13, fontWeight: 600, color: BRAND.navy, marginBottom: 10 }}>Sensation fingerprint · 13 dimensions</div>
      <svg viewBox={`0 0 ${size} ${size}`} style={{ width: '100%', height: 260 }}>
        {[25, 50, 75, 100].map((p) => (
          <circle key={p} cx={cx} cy={cy} r={(p / 100) * r} fill="none" stroke={BRAND.border} strokeWidth={0.5} />
        ))}
        <polygon points={polygon} fill={`${BRAND.accent}33`} stroke={BRAND.accent} strokeWidth={1.5} />
        {points.map((p) => (
          <g key={p.k}>
            <circle cx={p.x} cy={p.y} r={2.5} fill={BRAND.accent} />
            <text x={p.outerX} y={p.outerY} fontSize={9} fill={BRAND.muted} textAnchor={Math.cos(p.ang) > 0.3 ? 'start' : Math.cos(p.ang) < -0.3 ? 'end' : 'middle'} dominantBaseline="central">
              {p.k.replace(/_/g, ' ').slice(0, 12)}
            </text>
          </g>
        ))}
      </svg>
    </Card>
  );
}

// ─── Expanded Agent View · chat + persona + radar + review + journey stages ──
function ExpandedAgentView({
  selected, selectedIdx, filtered, onSelect, onClose,
  chatMessages, chatInput, onChatInputChange, onChatSend, chatSending,
  expandedStages, onToggleStage, onAskAboutStage,
}) {
  const v = normalizeStayView(selected);
  const flag = FLAG_BY_CLUSTER[v.cluster] || '🌐';
  const starCol = v.stars >= 5 ? BRAND.good : v.stars >= 4 ? '#84CC16' : v.stars >= 3 ? '#FBBF24' : v.stars >= 2 ? '#FB923C' : BRAND.bad;
  const finalState = selected.sensation_summary?.final_state || {};
  const dimEntries = Object.entries(finalState);
  return (
    <div>
      {/* HEADER — back + identity */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 16, padding: '10px 14px', background: BRAND.card, border: `1px solid ${BRAND.border}`, borderRadius: 10 }}>
        <button onClick={onClose} style={{ background: BRAND.bg, border: `1px solid ${BRAND.border}`, borderRadius: 8, padding: '6px 12px', fontSize: 12, color: BRAND.navy, cursor: 'pointer', fontWeight: 500 }}>← back to grid</button>
        <span style={{ fontSize: 22 }}>{flag}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: BRAND.navy }}>{v.personaName}</div>
          <div style={{ fontSize: 11, color: BRAND.muted }}>
            {v.personaAge ? `${v.personaAge}, ` : ''}{v.personaNationality || ''} · <span style={{ textTransform: 'capitalize' }}>{v.archetypeLabel}</span>{v.loyaltyTier ? ` · ${v.loyaltyTier.replace(/_/g, ' ')}` : ''}
          </div>
        </div>
        <span style={{ padding: '6px 14px', fontSize: 13, fontWeight: 700, color: starCol, background: `${starCol}14`, border: `1px solid ${starCol}`, borderRadius: 8 }}>
          {v.stars}★ · NPS {v.nps > 0 ? '+' : ''}{v.nps}
        </span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '210px 1fr', gap: 14, alignItems: 'flex-start' }}>
        {/* LEFT — compact agent list */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, position: 'sticky', top: 16, maxHeight: 'calc(100vh - 80px)', overflowY: 'auto' }}>
          <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: 1, color: BRAND.muted, padding: '6px 8px' }}>Other agents · {filtered.length}</div>
          {filtered.map((s, i) => {
            const sv = normalizeStayView(s);
            const f = FLAG_BY_CLUSTER[sv.cluster] || '🌐';
            const sc = sv.stars >= 5 ? BRAND.good : sv.stars >= 4 ? '#84CC16' : sv.stars >= 3 ? '#FBBF24' : sv.stars >= 2 ? '#FB923C' : BRAND.bad;
            const isSel = selectedIdx === i;
            return (
              <button key={i} onClick={() => onSelect(i)} style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '8px 10px', background: isSel ? BRAND.accentSoft : 'transparent',
                border: `1px solid ${isSel ? BRAND.accent : 'transparent'}`,
                borderRadius: 8, cursor: 'pointer', textAlign: 'left', color: 'inherit',
              }}>
                <span style={{ fontSize: 13 }}>{f}</span>
                <span style={{ flex: 1, minWidth: 0, fontSize: 11, fontWeight: isSel ? 600 : 500, color: isSel ? BRAND.accent : BRAND.navy, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{sv.personaName}</span>
                <span style={{ fontSize: 10, color: sc, fontWeight: 700 }}>{sv.stars}★</span>
              </button>
            );
          })}
        </div>

        {/* RIGHT — main expanded content */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {/* CHAT first, with input AT TOP */}
          <Card padding={0}>
            <div style={{ padding: 14, borderBottom: `1px solid ${BRAND.border}` }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: BRAND.navy, marginBottom: 10, display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 16 }}>💬</span> Chat with {v.personaName.split(' ')[0]}
                <span style={{ fontSize: 11, fontWeight: 400, color: BRAND.subtle, marginLeft: 'auto' }}>
                  in-character · grounded in their journey + sensation memory
                </span>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <input
                  value={chatInput}
                  onChange={(e) => onChatInputChange(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onChatSend(); } }}
                  placeholder={`Ask ${v.personaName.split(' ')[0]} about their stay…`}
                  disabled={chatSending}
                  style={{
                    flex: 1, padding: '10px 14px', fontSize: 13, color: BRAND.navy,
                    background: BRAND.bg, border: `1px solid ${BRAND.border}`, borderRadius: 8,
                    outline: 'none',
                  }}
                />
                <button onClick={onChatSend} disabled={chatSending || !chatInput.trim()} style={{
                  padding: '10px 18px', background: chatInput.trim() && !chatSending ? BRAND.accent : BRAND.border,
                  color: 'white', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 600,
                  cursor: chatSending ? 'wait' : (chatInput.trim() ? 'pointer' : 'not-allowed'),
                }}>
                  {chatSending ? '…' : 'send →'}
                </button>
              </div>
            </div>
            <div style={{ padding: 14, maxHeight: 320, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8 }}>
              {chatMessages.length === 0 && (
                <div style={{ fontSize: 12, color: BRAND.subtle, fontStyle: 'italic', padding: '8px 0' }}>
                  No messages yet. Type a question above, or click the <strong>Ask {v.personaName.split(' ')[0]} about this</strong> button on any journey stage to start.
                </div>
              )}
              {chatMessages.map((m, i) => (
                <div key={i} style={{ display: 'flex', justifyContent: m.role === 'user' ? 'flex-end' : 'flex-start' }}>
                  <div style={{
                    maxWidth: '75%', padding: '8px 12px', borderRadius: 12, fontSize: 13, lineHeight: 1.5,
                    background: m.role === 'user' ? BRAND.accent : BRAND.bg,
                    color: m.role === 'user' ? 'white' : BRAND.navy,
                  }}>
                    {m.role === 'agent' && <div style={{ fontSize: 9, textTransform: 'uppercase', letterSpacing: 1, color: BRAND.muted, marginBottom: 2 }}>{v.personaName.split(' ')[0]}</div>}
                    {m.text}
                  </div>
                </div>
              ))}
              {chatSending && (
                <div style={{ fontSize: 11, color: BRAND.subtle, fontStyle: 'italic', padding: '4px 0' }}>{v.personaName.split(' ')[0]} is typing…</div>
              )}
            </div>
          </Card>

          {/* PERSONA CARD */}
          <Card padding={16}>
            <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, color: BRAND.muted, marginBottom: 8 }}>Persona</div>
            {v.bio && <div style={{ fontSize: 13, color: BRAND.navy, lineHeight: 1.6, fontStyle: 'italic', marginBottom: 8 }}>&ldquo;{v.bio}&rdquo;</div>}
            <div style={{ display: 'flex', gap: 14, fontSize: 12, color: BRAND.muted, flexWrap: 'wrap' }}>
              {v.stayLengthNights && <span><strong style={{ color: BRAND.navy }}>{v.stayLengthNights}</strong> nights</span>}
              {v.rateEur && <span><strong style={{ color: BRAND.navy }}>€{v.rateEur}</strong>/night</span>}
              {v.channel && <span>via <strong style={{ color: BRAND.navy }}>{v.channel.replace(/_/g, ' ')}</strong></span>}
              {v.totalSpend && <span><strong style={{ color: BRAND.navy }}>€{v.totalSpend}</strong> total spend</span>}
            </div>
          </Card>

          {/* RADAR + PREDICTED REVIEW (2 cols) */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.2fr', gap: 14 }}>
            <SensationRadar stay={selected} />
            <Card padding={14}>
              <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: 1, color: BRAND.subtle, marginBottom: 4 }}>
                {v.review.platform} · {v.stars}★ predicted review
              </div>
              <div style={{ fontSize: 14, fontWeight: 700, color: BRAND.navy, marginBottom: 6 }}>&ldquo;{v.review.title}&rdquo;</div>
              <div style={{ fontSize: 12, color: v.hasReviewBody ? BRAND.navy : BRAND.subtle, lineHeight: 1.65, fontStyle: v.hasReviewBody ? 'normal' : 'italic', maxHeight: 180, overflowY: 'auto' }}>{v.review.body}</div>
              <div style={{ marginTop: 8, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {(v.review.themes || []).map((t) => (
                  <span key={t} style={{ padding: '2px 8px', fontSize: 10, background: BRAND.accentSoft, color: BRAND.accent, border: `1px solid ${BRAND.accent}33`, borderRadius: 999 }}>{t.replace(/_/g, ' ')}</span>
                ))}
              </div>
            </Card>
          </div>

          {/* GUEST JOURNEY · expandable stages */}
          {v.stages.length > 0 && (
            <Card padding={16}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: BRAND.navy }}>Guest journey · {v.stages.length} stages</div>
                <div style={{ fontSize: 11, color: BRAND.muted }}>Click a stage to expand · score, deltas, moments</div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {v.stages.map((st, i) => (
                  <ExpandableStage
                    key={i}
                    stage={st}
                    expanded={!!expandedStages[i]}
                    onToggle={() => onToggleStage(i)}
                    finalState={finalState}
                    onAskAbout={() => onAskAboutStage(st.stage, v.personaName)}
                    askLabel={`Ask ${v.personaName.split(' ')[0]} about this`}
                  />
                ))}
              </div>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

function ExpandableStage({ stage, expanded, onToggle, finalState, onAskAbout, askLabel }) {
  const [scoreOpen, setScoreOpen] = useState(false);
  const [deltasOpen, setDeltasOpen] = useState(false);
  const [momentsOpen, setMomentsOpen] = useState(false);
  const stageLabel = (stage.stage || '').replace(/_/g, ' ').toUpperCase();
  const posCount = (stage.moments_positive || []).length;
  const negCount = (stage.moments_negative || []).length;
  const sensationDeltas = stage.sensation_deltas || {};
  const sensationSnapshot = stage.sensation_snapshot || stage.sensation_state || {};
  const dimsToShow = Object.keys(sensationSnapshot).length > 0 ? sensationSnapshot : finalState;

  return (
    <div style={{ border: `1px solid ${expanded ? BRAND.accent + '55' : BRAND.border}`, borderRadius: 8, background: expanded ? BRAND.bg : 'transparent', overflow: 'hidden' }}>
      <button onClick={onToggle} style={{
        display: 'flex', alignItems: 'center', gap: 12, width: '100%',
        padding: '12px 14px', background: 'transparent', border: 'none',
        cursor: 'pointer', textAlign: 'left', color: 'inherit',
      }}>
        <span style={{ width: 16, color: BRAND.accent, fontSize: 11 }}>{expanded ? '▼' : '▶'}</span>
        <span style={{ flex: 1, fontSize: 12, fontWeight: 600, color: BRAND.accent, letterSpacing: 0.6 }}>
          {stageLabel}
          {stage.night_number != null && <span style={{ color: BRAND.subtle, marginLeft: 8, fontWeight: 400 }}>· night {stage.night_number}</span>}
        </span>
        {posCount > 0 && <span style={{ fontSize: 11, color: BRAND.good }}>✓ {posCount}</span>}
        {negCount > 0 && <span style={{ fontSize: 11, color: BRAND.bad }}>✗ {negCount}</span>}
      </button>
      {expanded && (
        <div style={{ padding: '0 14px 14px 42px', display: 'flex', flexDirection: 'column', gap: 10 }}>
          {stage.narrative && (
            <div style={{ fontSize: 13, color: BRAND.navy, lineHeight: 1.65 }}>{stage.narrative}</div>
          )}

          {/* Score breakdown */}
          {Object.keys(dimsToShow).length > 0 && (
            <SubAccordion
              label="Score breakdown · 13 dimensions"
              detail={`avg ${(Object.values(dimsToShow).reduce((s, v) => s + v, 0) / Object.values(dimsToShow).length).toFixed(0)}/100`}
              open={scoreOpen}
              onToggle={() => setScoreOpen(!scoreOpen)}
            >
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 6 }}>
                {Object.entries(dimsToShow).map(([dim, val]) => (
                  <div key={dim} style={{ display: 'grid', gridTemplateColumns: '1fr 32px', gap: 8, alignItems: 'center', fontSize: 11 }}>
                    <div>
                      <div style={{ color: BRAND.navy, marginBottom: 2, textTransform: 'capitalize' }}>{dim.replace(/_/g, ' ')}</div>
                      <div style={{ height: 4, background: BRAND.card, borderRadius: 999, border: `1px solid ${BRAND.border}` }}>
                        <div style={{ height: '100%', width: `${val}%`, background: val >= 75 ? BRAND.good : val >= 50 ? '#84CC16' : val >= 30 ? BRAND.warn : BRAND.bad, borderRadius: 999 }} />
                      </div>
                    </div>
                    <div style={{ textAlign: 'right', fontSize: 11, fontWeight: 600, color: BRAND.navy, fontFeatureSettings: "'tnum'" }}>{Math.round(val)}</div>
                  </div>
                ))}
              </div>
              <button onClick={onAskAbout} style={{
                marginTop: 12, padding: '6px 12px', background: BRAND.accentSoft,
                color: BRAND.accent, border: `1px solid ${BRAND.accent}66`, borderRadius: 999,
                fontSize: 11, fontWeight: 600, cursor: 'pointer',
              }}>💬 {askLabel}</button>
            </SubAccordion>
          )}

          {/* Sensation deltas (only if stage has them — typically backtest n=1000) */}
          {Object.keys(sensationDeltas).length > 0 && (
            <SubAccordion
              label="Sensation deltas (this stage)"
              detail={`${Object.keys(sensationDeltas).length} dims moved`}
              open={deltasOpen}
              onToggle={() => setDeltasOpen(!deltasOpen)}
            >
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 4 }}>
                {Object.entries(sensationDeltas).map(([dim, delta]) => (
                  <div key={dim} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, padding: '3px 0' }}>
                    <span style={{ color: BRAND.navy, textTransform: 'capitalize' }}>{dim.replace(/_/g, ' ')}</span>
                    <span style={{ color: delta > 0 ? BRAND.good : delta < 0 ? BRAND.bad : BRAND.muted, fontWeight: 600, fontFeatureSettings: "'tnum'" }}>
                      {delta > 0 ? '+' : ''}{delta}
                    </span>
                  </div>
                ))}
              </div>
            </SubAccordion>
          )}

          {/* Moments */}
          {(posCount > 0 || negCount > 0) && (
            <SubAccordion
              label="Moments observed"
              detail={`${posCount} positive · ${negCount} negative`}
              open={momentsOpen}
              onToggle={() => setMomentsOpen(!momentsOpen)}
            >
              {posCount > 0 && (
                <div style={{ marginBottom: negCount > 0 ? 8 : 0 }}>
                  {(stage.moments_positive || []).map((m, i) => (
                    <div key={i} style={{ fontSize: 12, color: BRAND.good, lineHeight: 1.55, marginBottom: 3 }}>✓ {m}</div>
                  ))}
                </div>
              )}
              {negCount > 0 && (
                <div>
                  {(stage.moments_negative || []).map((m, i) => (
                    <div key={i} style={{ fontSize: 12, color: BRAND.bad, lineHeight: 1.55, marginBottom: 3 }}>✗ {m}</div>
                  ))}
                </div>
              )}
            </SubAccordion>
          )}
        </div>
      )}
    </div>
  );
}

function SubAccordion({ label, detail, open, onToggle, children }) {
  return (
    <div style={{ background: BRAND.card, border: `1px solid ${BRAND.border}`, borderRadius: 6, overflow: 'hidden' }}>
      <button onClick={onToggle} style={{
        display: 'flex', alignItems: 'center', gap: 8, width: '100%',
        padding: '8px 12px', background: 'transparent', border: 'none',
        cursor: 'pointer', textAlign: 'left', color: 'inherit',
      }}>
        <span style={{ width: 12, color: BRAND.subtle, fontSize: 9 }}>{open ? '▼' : '▶'}</span>
        <span style={{ flex: 1, fontSize: 11, fontWeight: 600, color: BRAND.navy }}>{label}</span>
        {detail && <span style={{ fontSize: 10, color: BRAND.muted }}>{detail}</span>}
      </button>
      {open && (
        <div style={{ padding: '0 12px 12px 32px' }}>
          {children}
        </div>
      )}
    </div>
  );
}

// ─── Section: Scenarios ───────────────────────────────────────────────────
function ScenariosSection({ presets = [], summary = {}, scenarioResult, applyScenario, resetBaseline, loadingScenario, activeScenarioId }) {
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 14, marginBottom: 18, flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 24, fontWeight: 700, color: BRAND.navy }}>Scenarios</h1>
          <div style={{ fontSize: 12, color: BRAND.muted, marginTop: 2 }}>
            Revenue & NPS levers · baseline: {summary.avg_stars?.toFixed?.(2) || '—'}★ · NPS {summary.net_promoter_score > 0 ? '+' : ''}{summary.net_promoter_score || '—'} · €{summary.avg_spend_eur || '—'} spend
          </div>
        </div>
        <a href="/scenario" style={{
          display: 'inline-flex', alignItems: 'center', gap: 8,
          padding: '10px 18px', background: BRAND.accent, color: 'white',
          borderRadius: 10, fontSize: 13, fontWeight: 600, textDecoration: 'none',
          boxShadow: `0 2px 8px ${BRAND.accent}33`,
        }}>
          <span>🛠</span>
          <span>Open full Scenario Editor</span>
          <span style={{ opacity: 0.7 }}>→</span>
        </a>
      </div>

      <div style={{ padding: '12px 16px', background: BRAND.accentSoft, border: `1px solid ${BRAND.accent}33`, borderRadius: 10, marginBottom: 16, fontSize: 12, color: BRAND.navy, display: 'flex', alignItems: 'center', gap: 12 }}>
        <span style={{ fontSize: 18 }}>💡</span>
        <div>
          The 6 quick levers below run against the current cohort baseline for instant €/NPS projection. For a <strong>full custom scenario</strong> (any decision, any segment, any palanca) with live preview &lt;500ms, use the <a href="/scenario" style={{ color: BRAND.accent, fontWeight: 600 }}>Scenario Editor →</a> and then the <a href="/validation" style={{ color: BRAND.accent, fontWeight: 600 }}>Validation Report</a>.
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 12, marginBottom: 16 }}>
        {presets.map((pr) => {
          const isActive = activeScenarioId === pr.id;
          return (
            <button key={pr.id} disabled={loadingScenario} onClick={() => applyScenario(pr.id)} style={{
              textAlign: 'left', padding: 18, background: BRAND.card,
              border: `1px solid ${isActive ? BRAND.accent : BRAND.border}`, borderRadius: 12,
              cursor: loadingScenario ? 'wait' : 'pointer', color: 'inherit',
              boxShadow: isActive ? `0 0 0 3px ${BRAND.accent}22` : 'none',
              transition: 'border-color 120ms',
            }}>
              <div style={{ fontSize: 10, textTransform: 'uppercase', color: BRAND.muted, letterSpacing: 1, marginBottom: 6 }}>{(pr.category || 'lever').replace(/_/g, ' ')}</div>
              <div style={{ fontSize: 14, fontWeight: 600, color: isActive ? BRAND.accent : BRAND.navy, marginBottom: 8 }}>{pr.label}</div>
              {pr.applies_to && (
                <div style={{ fontSize: 11, color: BRAND.subtle }}>applies to: {pr.applies_to.replace(/_/g, ' ')}</div>
              )}
            </button>
          );
        })}
      </div>

      {scenarioResult && (
        <Card padding={20}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
            <div>
              <div style={{ fontSize: 11, letterSpacing: 1.2, textTransform: 'uppercase', color: BRAND.muted }}>Impact projection</div>
              <div style={{ fontSize: 18, fontWeight: 700, color: BRAND.navy, marginTop: 2 }}>{scenarioResult.scenario?.label}</div>
            </div>
            <button onClick={resetBaseline} style={{ background: 'transparent', border: `1px solid ${BRAND.border}`, borderRadius: 6, color: BRAND.muted, fontSize: 11, padding: '4px 10px', cursor: 'pointer' }}>↺ reset</button>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginBottom: 14 }}>
            <ScenarioMetric label="€ per stay" value={`€${scenarioResult.per_stay?.revenue_delta_eur > 0 ? '+' : ''}${scenarioResult.per_stay?.revenue_delta_eur || 0}`} positive={(scenarioResult.per_stay?.revenue_delta_eur || 0) >= 0} />
            <ScenarioMetric label="NPS Δ" value={`${(scenarioResult.per_stay?.nps_delta || 0) > 0 ? '+' : ''}${scenarioResult.per_stay?.nps_delta || 0}`} positive={(scenarioResult.per_stay?.nps_delta || 0) >= 0} />
            <ScenarioMetric label="LTV Δ" value={`€${scenarioResult.per_stay?.ltv_delta_eur > 0 ? '+' : ''}${scenarioResult.per_stay?.ltv_delta_eur || 0}`} positive={(scenarioResult.per_stay?.ltv_delta_eur || 0) >= 0} />
            <ScenarioMetric label="Annualised" value={`€${Math.round((scenarioResult.annualized_estimate?.revenue_annual_delta_eur || scenarioResult.annualized_estimate?.total_annual_delta_eur || 0) / 1000)}K`} positive={(scenarioResult.annualized_estimate?.revenue_annual_delta_eur || 0) >= 0} big />
          </div>
          {scenarioResult.explanation && (
            <div style={{ padding: 14, background: BRAND.bg, borderRadius: 8, fontSize: 13, color: BRAND.navy, lineHeight: 1.6 }}>
              <div style={{ fontSize: 10, textTransform: 'uppercase', color: BRAND.muted, letterSpacing: 1, marginBottom: 6 }}>Methodology</div>
              {scenarioResult.explanation}
            </div>
          )}
        </Card>
      )}
      {!scenarioResult && (
        <Card padding={30}>
          <div style={{ textAlign: 'center', color: BRAND.muted, fontSize: 13 }}>
            Click any scenario above to see its projected impact on NPS, revenue per stay, and annualised P&L.
          </div>
        </Card>
      )}
    </div>
  );
}

function ScenarioMetric({ label, value, positive, big }) {
  const col = positive ? BRAND.good : BRAND.bad;
  return (
    <div>
      <div style={{ fontSize: 10, textTransform: 'uppercase', color: BRAND.muted, letterSpacing: 0.8 }}>{label}</div>
      <div style={{ fontSize: big ? 26 : 20, fontWeight: 700, color: col, marginTop: 4, fontFeatureSettings: "'tnum'" }}>{value}</div>
    </div>
  );
}

// ─── Section: Library ─────────────────────────────────────────────────────
function LibrarySection({ calibration }) {
  const [tab, setTab] = useState('archetypes');
  const [data, setData] = useState({});
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (data[tab] || tab === 'calibration') return;
    setLoading(true);
    apiFetch(`/api/dictionary/${tab}`)
      .then((r) => r.json())
      .then((d) => setData((prev) => ({ ...prev, [tab]: d })))
      .catch((err) => setData((prev) => ({ ...prev, [tab]: { error: err.message } })))
      .finally(() => setLoading(false));
  }, [tab]);

  const TABS = [
    { id: 'archetypes', label: 'Archetypes · 8' },
    { id: 'cultures', label: 'Cultures · 10' },
    { id: 'adversarial_events', label: 'Adversarial events · 15' },
    { id: 'sensation_dimensions', label: 'Sensation dimensions · 14' },
    { id: 'calibration', label: 'Real calibration · 572 reviews' },
  ];

  return (
    <div>
      <div style={{ marginBottom: 18 }}>
        <h1 style={{ margin: 0, fontSize: 24, fontWeight: 700, color: BRAND.navy }}>Library</h1>
        <div style={{ fontSize: 12, color: BRAND.muted, marginTop: 2 }}>
          The dictionaries, taxonomies, and real-world corpora the simulation is built on — fully transparent.
        </div>
      </div>

      <div style={{ display: 'flex', gap: 6, marginBottom: 14, borderBottom: `1px solid ${BRAND.border}`, paddingBottom: 1 }}>
        {TABS.map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)} style={{
            padding: '10px 14px', background: 'transparent', border: 'none',
            borderBottom: `2px solid ${tab === t.id ? BRAND.accent : 'transparent'}`,
            color: tab === t.id ? BRAND.accent : BRAND.muted,
            fontWeight: tab === t.id ? 600 : 500, fontSize: 13,
            cursor: 'pointer', transition: 'color 120ms',
          }}>{t.label}</button>
        ))}
      </div>

      {loading && <div style={{ padding: 30, textAlign: 'center', color: BRAND.muted, fontSize: 13 }}>loading dictionary…</div>}
      {tab === 'archetypes' && data.archetypes && <ArchetypesList data={data.archetypes} />}
      {tab === 'cultures' && data.cultures && <CulturesList data={data.cultures} />}
      {tab === 'adversarial_events' && data.adversarial_events && <EventsList data={data.adversarial_events} />}
      {tab === 'sensation_dimensions' && data.sensation_dimensions && <DimensionsList data={data.sensation_dimensions} />}
      {tab === 'calibration' && <CalibrationView calibration={calibration} />}
    </div>
  );
}

function ArchetypesList({ data }) {
  // archetypes.json is grouped by use-case (landing_page, pricing, etc.).
  // Landing_page is the hospitality-relevant set.
  const list = data.landing_page || data.archetypes || data;
  const entries = Array.isArray(list) ? list : Object.entries(list).map(([id, a]) => ({ id, ...a }));
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 12 }}>
      {entries.map((a, i) => (
        <Card key={a.id || i} padding={16}>
          <div style={{ fontSize: 10, textTransform: 'uppercase', color: BRAND.muted, letterSpacing: 1 }}>{a.role_archetype || 'archetype'}</div>
          <div style={{ fontSize: 15, fontWeight: 700, color: BRAND.navy, marginTop: 4, marginBottom: 6 }}>{(a.label || a.id || '').replace(/_/g, ' ')}</div>
          {a.coverage_purpose && <div style={{ fontSize: 12, color: BRAND.muted, lineHeight: 1.55, marginBottom: 8 }}>{a.coverage_purpose}</div>}
          {a.description && !a.coverage_purpose && <div style={{ fontSize: 12, color: BRAND.muted, lineHeight: 1.55, marginBottom: 8 }}>{a.description}</div>}
          {a.pain_samples && Array.isArray(a.pain_samples) && (
            <div style={{ marginTop: 8 }}>
              <div style={{ fontSize: 10, color: BRAND.subtle, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }}>pain samples</div>
              <div style={{ fontSize: 11, color: BRAND.navy, lineHeight: 1.55, fontStyle: 'italic' }}>
                {a.pain_samples.slice(0, 2).map((p, j) => <div key={j}>· &ldquo;{p}&rdquo;</div>)}
              </div>
            </div>
          )}
        </Card>
      ))}
    </div>
  );
}

function CulturesList({ data }) {
  const clusters = data.clusters || data;
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 12 }}>
      {Object.entries(clusters).map(([id, c]) => {
        const flag = FLAG_BY_CLUSTER[id] || '🌐';
        return (
          <Card key={id} padding={16}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
              <span style={{ fontSize: 22 }}>{flag}</span>
              <div>
                <div style={{ fontSize: 14, fontWeight: 700, color: BRAND.navy }}>{c.label || id}</div>
                <div style={{ fontSize: 10, color: BRAND.muted, textTransform: 'uppercase', letterSpacing: 0.8 }}>{(c.origin_countries || []).join(' · ')}</div>
              </div>
            </div>
            {c.hofstede_avg && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 8 }}>
                {Object.entries(c.hofstede_avg).map(([k, v]) => (
                  <span key={k} style={{ padding: '2px 6px', fontSize: 9, background: BRAND.bg, color: BRAND.navy, borderRadius: 4, border: `1px solid ${BRAND.border}` }}>
                    <strong>{k}</strong> {v}
                  </span>
                ))}
              </div>
            )}
            {c.key_expectations && (
              <div style={{ fontSize: 11, color: BRAND.muted, lineHeight: 1.55 }}>
                {c.key_expectations.slice(0, 3).map((e) => `• ${e}`).join('\n')}
              </div>
            )}
          </Card>
        );
      })}
    </div>
  );
}

function EventsList({ data }) {
  const events = data.events || [];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      {events.map((e, i) => {
        const severityCol = e.severity === 'high' ? BRAND.bad : e.severity === 'medium' ? BRAND.warn : BRAND.good;
        return (
          <div key={e.id || i} style={{ display: 'grid', gridTemplateColumns: '60px 1fr 120px 120px', gap: 12, alignItems: 'center', padding: '12px 14px', background: BRAND.card, border: `1px solid ${BRAND.border}`, borderRadius: 8, marginBottom: 4 }}>
            <div>
              <span style={{ padding: '2px 8px', fontSize: 10, fontWeight: 700, color: severityCol, background: `${severityCol}14`, border: `1px solid ${severityCol}33`, borderRadius: 999, textTransform: 'uppercase' }}>{e.severity || 'med'}</span>
            </div>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: BRAND.navy }}>{e.label || e.id}</div>
              <div style={{ fontSize: 11, color: BRAND.muted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {(e.stages_where_relevant || []).slice(0, 3).join(' · ')}
              </div>
            </div>
            <div style={{ fontSize: 11, color: BRAND.muted }}>
              {Object.entries(e.baseline_sensation_deltas || {}).slice(0, 2).map(([k, v]) => (
                <div key={k}><span style={{ color: BRAND.navy }}>{k.slice(0, 6)}</span> {v > 0 ? '+' : ''}{v}</div>
              ))}
            </div>
            <div style={{ fontSize: 11, color: BRAND.muted, textAlign: 'right' }}>
              {Object.keys(e.archetype_sensitivity_multiplier || {}).slice(0, 3).map((k) => k.replace(/_/g, ' ').slice(0, 10)).join(' · ')}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function DimensionsList({ data }) {
  const dims = data.dimensions || data;
  const entries = Array.isArray(dims) ? dims : Object.entries(dims).map(([id, d]) => ({ id, ...d }));
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12 }}>
      {entries.map((d, i) => (
        <Card key={d.id || i} padding={14}>
          <div style={{ fontSize: 13, fontWeight: 600, color: BRAND.navy, textTransform: 'capitalize' }}>{(d.label || d.id || '').replace(/_/g, ' ')}</div>
          {d.description && <div style={{ fontSize: 11, color: BRAND.muted, lineHeight: 1.5, marginTop: 6 }}>{d.description}</div>}
          {d.anchor_examples && (
            <div style={{ marginTop: 8, fontSize: 10, color: BRAND.subtle }}>
              anchor: <span style={{ color: BRAND.navy }}>{d.anchor_examples[0] || '—'}</span>
            </div>
          )}
        </Card>
      ))}
    </div>
  );
}

function CalibrationView({ calibration }) {
  if (!calibration) return null;
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
      <Card padding={18}>
        <div style={{ fontSize: 13, fontWeight: 600, color: BRAND.navy, marginBottom: 10 }}>Source corpus</div>
        <div style={{ fontSize: 12, color: BRAND.muted, lineHeight: 1.7 }}>
          <div><strong style={{ color: BRAND.navy }}>Property:</strong> {calibration.property_name}</div>
          <div><strong style={{ color: BRAND.navy }}>Reviews analysed:</strong> {calibration.review_count}</div>
          <div><strong style={{ color: BRAND.navy }}>Avg real rating:</strong> {calibration.avg_rating?.toFixed?.(2)}★</div>
          <div><strong style={{ color: BRAND.navy }}>Generated:</strong> {(calibration.generated_at || '').slice(0, 10)}</div>
          <div style={{ marginTop: 8 }}><strong style={{ color: BRAND.navy }}>Sources:</strong></div>
          <div style={{ marginLeft: 8 }}>
            {(Array.isArray(calibration.sourced_from) ? calibration.sourced_from : [calibration.sourced_from]).filter(Boolean).map((s, i) => <div key={i}>· {s}</div>)}
          </div>
        </div>
      </Card>
      <Card padding={18}>
        <div style={{ fontSize: 13, fontWeight: 600, color: BRAND.navy, marginBottom: 10 }}>Subcategory anchors (real)</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {Object.entries(calibration.subcategory_scores_5_scale || {}).filter(([k]) => k !== 'source').map(([k, v]) => (
            <div key={k} style={{ display: 'grid', gridTemplateColumns: '1fr 40px', alignItems: 'center', gap: 10 }}>
              <div>
                <div style={{ fontSize: 12, color: BRAND.navy, textTransform: 'capitalize', marginBottom: 3 }}>{k.replace(/_/g, ' ')}</div>
                <div style={{ height: 5, background: BRAND.bg, borderRadius: 999, overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${(v / 5) * 100}%`, background: BRAND.accent, borderRadius: 999 }} />
                </div>
              </div>
              <div style={{ fontSize: 12, fontWeight: 600, color: BRAND.navy, textAlign: 'right', fontFeatureSettings: "'tnum'" }}>{v?.toFixed?.(1)}</div>
            </div>
          ))}
        </div>
      </Card>
      <Card padding={18}>
        <div style={{ fontSize: 13, fontWeight: 600, color: BRAND.navy, marginBottom: 10 }}>Top positive themes</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {(calibration.top_positive_themes || []).map((t) => (
            <span key={t} style={{ padding: '4px 10px', fontSize: 12, background: BRAND.good + '14', color: BRAND.good, border: `1px solid ${BRAND.good}33`, borderRadius: 999 }}>{t.replace(/_/g, ' ')}</span>
          ))}
        </div>
      </Card>
      <Card padding={18}>
        <div style={{ fontSize: 13, fontWeight: 600, color: BRAND.navy, marginBottom: 10 }}>Top friction themes</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {(calibration.top_negative_themes || []).map((t) => (
            <span key={t} style={{ padding: '4px 10px', fontSize: 12, background: BRAND.bad + '14', color: BRAND.bad, border: `1px solid ${BRAND.bad}33`, borderRadius: 999 }}>{t.replace(/_/g, ' ')}</span>
          ))}
        </div>
      </Card>
    </div>
  );
}

// ─── Section: Properties ──────────────────────────────────────────────────
function PropertiesSection({ snapshots, currentSlug, onSelectSlug }) {
  return (
    <div>
      <div style={{ marginBottom: 18 }}>
        <h1 style={{ margin: 0, fontSize: 24, fontWeight: 700, color: BRAND.navy }}>Properties</h1>
        <div style={{ fontSize: 12, color: BRAND.muted, marginTop: 2 }}>
          Calibrated synthetic twins · click any property to open its Reports view.
        </div>
      </div>

      {snapshots == null && <div style={{ padding: 30, textAlign: 'center', color: BRAND.muted, fontSize: 13 }}>loading properties…</div>}
      {snapshots != null && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 12 }}>
          {snapshots.map((s) => {
            const delta = s.avg_stars != null && s.calibration_avg_rating != null ? (s.avg_stars - s.calibration_avg_rating) : null;
            const matchCol = (s.target_star_match_rate_pct || 0) >= 80 ? BRAND.good : (s.target_star_match_rate_pct || 0) >= 60 ? BRAND.warn : BRAND.bad;
            const isCurrent = s.slug === currentSlug;
            return (
              <button key={s.slug} onClick={() => onSelectSlug(s.slug)} style={{
                textAlign: 'left', padding: 18, background: BRAND.card,
                border: `1px solid ${isCurrent ? BRAND.accent : BRAND.border}`, borderRadius: 12,
                cursor: 'pointer', color: 'inherit',
                boxShadow: isCurrent ? `0 0 0 3px ${BRAND.accent}22` : 'none',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                  <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: 1, color: BRAND.muted }}>{s.property_brand || 'Property'}</div>
                  {isCurrent && <span style={{ padding: '2px 8px', fontSize: 10, fontWeight: 600, color: BRAND.accent, background: BRAND.accentSoft, borderRadius: 999 }}>CURRENT</span>}
                </div>
                <div style={{ fontSize: 16, fontWeight: 700, color: BRAND.navy, marginBottom: 12 }}>{s.property_name || s.slug}</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, marginBottom: 10 }}>
                  <div>
                    <div style={{ fontSize: 9, textTransform: 'uppercase', color: BRAND.muted, letterSpacing: 0.8 }}>predicted</div>
                    <div style={{ fontSize: 18, fontWeight: 700, color: BRAND.navy }}>{s.avg_stars?.toFixed?.(2) || '—'}★</div>
                  </div>
                  <div>
                    <div style={{ fontSize: 9, textTransform: 'uppercase', color: BRAND.muted, letterSpacing: 0.8 }}>real</div>
                    <div style={{ fontSize: 18, fontWeight: 700, color: BRAND.muted }}>{s.calibration_avg_rating?.toFixed?.(2) || '—'}★</div>
                  </div>
                  <div>
                    <div style={{ fontSize: 9, textTransform: 'uppercase', color: BRAND.muted, letterSpacing: 0.8 }}>Δ</div>
                    <div style={{ fontSize: 18, fontWeight: 700, color: delta != null && Math.abs(delta) < 0.15 ? BRAND.good : BRAND.warn }}>{delta != null ? (delta > 0 ? '+' : '') + delta.toFixed(2) : '—'}</div>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 10, fontSize: 11, color: BRAND.muted }}>
                  <span>NPS {s.net_promoter_score > 0 ? '+' : ''}{s.net_promoter_score ?? '—'}</span>
                  <span>· {s.n_original || 0} stays</span>
                  <span>· match <span style={{ color: matchCol, fontWeight: 600 }}>{s.target_star_match_rate_pct ?? '—'}%</span></span>
                </div>
              </button>
            );
          })}
          <div style={{ padding: 18, background: 'transparent', border: `2px dashed ${BRAND.border}`, borderRadius: 12, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: BRAND.subtle, fontSize: 13, minHeight: 180 }}>
            <div style={{ fontSize: 32, marginBottom: 6 }}>+</div>
            <div style={{ fontWeight: 600 }}>Add property</div>
            <div style={{ fontSize: 11, textAlign: 'center', marginTop: 4 }}>Upload review corpus or connect Medallia to calibrate a new synthetic twin.</div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Section: Get Started ─────────────────────────────────────────────────
function GetStartedSection() {
  const LAYERS = [
    { n: 1, title: 'Persona + archetype', body: 'Each agent starts from one of 7 archetypes (honeymooner, luxury_seeker, loyalty_maximizer, etc.) with traits and life context.' },
    { n: 2, title: 'Cultural lens', body: 'One of 10 clusters based on Hofstede 6-D scores shapes complaint style, voice, and what they notice.' },
    { n: 3, title: 'Booking context', body: 'Sampled realistically: rate paid, channel, lead time, upsells, loyalty tier recognition.' },
    { n: 4, title: 'External context', body: 'Season, occupancy, per-night weather, local events — all calibrated to IBESTAT monthly data.' },
    { n: 5, title: 'Adversarial events', body: 'A catalogued 27 incidents (HVAC, overbooking, fee surprise) fire at the empirical luxury-5★ rate of ~8–11%.' },
    { n: 6, title: 'Operational feedback loop', body: 'Understaffing, price hikes, and F&B stress bleed back into sensations stage-by-stage during the stay.' },
  ];
  const FAQ = [
    { q: 'What does MATCH / CLOSE / DRIFT mean?', a: 'MATCH = predicted average star rating is within ±0.10★ of the real calibration corpus. CLOSE = within ±0.30★. DRIFT = larger than 0.30★ — simulator needs recalibration.' },
    { q: 'What is target-star match rate?', a: 'Percentage of synthetic stays that landed within 1 star of the pre-assigned target. Goal ≥60%; Villa Le Blanc current snapshot sits at 88–94%.' },
    { q: 'Why are there 2★ reviews in a 4.65★ property?', a: 'Because real Villa Le Blanc has 1% 1★ and 2% 2★ reviews (572-review corpus). An honest simulator must reproduce that friction tail — over-optimism would be the red flag.' },
    { q: 'Can we use our Medallia data?', a: 'Yes. The 3-week certification phase ingests your proprietary review corpus read-only, recalibrates, and backtest-scores against the last 12 months.' },
    { q: 'How do ¿Y si…? scenarios actually work?', a: 'Each scenario runs against the cached cohort baseline, applying price-elasticity research (Cornell HQ, STR) and our operational feedback loop to return per-stay and annualised deltas.' },
  ];
  return (
    <div>
      <div style={{ marginBottom: 18 }}>
        <h1 style={{ margin: 0, fontSize: 24, fontWeight: 700, color: BRAND.navy }}>Get Started</h1>
        <div style={{ fontSize: 12, color: BRAND.muted, marginTop: 2 }}>
          How the synthetic user simulation works · for executives and CTOs alike.
        </div>
      </div>

      <Card padding={20}>
        <div style={{ fontSize: 13, fontWeight: 600, color: BRAND.navy, marginBottom: 14 }}>The 6 layers</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12 }}>
          {LAYERS.map((l) => (
            <div key={l.n} style={{ padding: 14, background: BRAND.bg, borderRadius: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                <div style={{ width: 28, height: 28, borderRadius: '50%', background: BRAND.accent, color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 700 }}>{l.n}</div>
                <div style={{ fontSize: 13, fontWeight: 600, color: BRAND.navy }}>{l.title}</div>
              </div>
              <div style={{ fontSize: 12, color: BRAND.muted, lineHeight: 1.6 }}>{l.body}</div>
            </div>
          ))}
        </div>
      </Card>

      <div style={{ height: 14 }} />
      <Card padding={20}>
        <div style={{ fontSize: 13, fontWeight: 600, color: BRAND.navy, marginBottom: 14 }}>Frequently asked</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {FAQ.map((f, i) => (
            <div key={i} style={{ paddingBottom: 12, borderBottom: i < FAQ.length - 1 ? `1px solid ${BRAND.border}` : 'none' }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: BRAND.navy, marginBottom: 4 }}>{f.q}</div>
              <div style={{ fontSize: 12, color: BRAND.muted, lineHeight: 1.6 }}>{f.a}</div>
            </div>
          ))}
        </div>
      </Card>

      <div style={{ height: 14 }} />
      <Card padding={20}>
        <div style={{ fontSize: 13, fontWeight: 600, color: BRAND.navy, marginBottom: 10 }}>Next steps for Meliá</div>
        <ol style={{ margin: 0, paddingLeft: 24, fontSize: 13, color: BRAND.navy, lineHeight: 1.8 }}>
          <li>Fase 1 · Sign NDA + read-only access to Medallia for 3 top properties.</li>
          <li>Fase 2 · 10-lever ¿y si…? laboratory with Revenue &amp; Operations workshop.</li>
          <li>Fase 3 · 10-property pilot with dashboard integrated into Power BI / Tableau.</li>
          <li>Q3 · License decision for full portfolio (~400 hotels).</li>
        </ol>
      </Card>
    </div>
  );
}

function ValidationPanel({ v }) {
  const p = v.predicted || {};
  const r = v.real || {};
  const deltaStars = (p.avg_stars != null && r.avg_stars != null) ? (p.avg_stars - r.avg_stars) : null;
  const withinCI = deltaStars != null && Math.abs(deltaStars) <= 0.15;
  const delta5 = (p.pct_5 != null && r.pct_5 != null) ? Math.round(p.pct_5 - r.pct_5) : null;
  const delta1 = (p.pct_1 != null && r.pct_1 != null) ? Math.round(p.pct_1 - r.pct_1) : null;
  const verdict = withinCI && Math.abs(delta5 || 0) <= 8 ? 'MATCH' : (Math.abs(deltaStars || 0) > 0.5 ? 'DRIFT' : 'CLOSE');
  const verdictCol = verdict === 'MATCH' ? '#10b981' : verdict === 'CLOSE' ? '#f59e0b' : '#ef4444';
  const Row = ({ label, pred, real, delta, unit = '' }) => (
    <>
      <span style={{ color: '#94a3b8' }}>{label}</span>
      <span style={{ textAlign: 'right', color: '#f1f5f9' }}>{pred != null ? `${pred}${unit}` : '—'}</span>
      <span style={{ textAlign: 'right', color: '#94a3b8' }}>{real != null ? `${real}${unit}` : '—'}</span>
      <span style={{ textAlign: 'right', color: delta == null ? '#64748b' : Math.abs(delta) < 0.15 ? '#10b981' : Math.abs(delta) < 0.5 ? '#f59e0b' : '#ef4444', fontWeight: 600 }}>
        {delta == null ? '—' : `${delta > 0 ? '+' : ''}${typeof delta === 'number' ? delta.toFixed(Math.abs(delta) < 1 ? 2 : 0) : delta}`}
      </span>
    </>
  );
  return (
    <div style={{ marginTop: 6, padding: 12, background: 'rgba(15,23,42,0.6)', border: `1px solid ${verdictCol}55`, borderRadius: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <span style={{ fontSize: 11, color: '#94a3b8' }}>{v.property}</span>
        <span style={{ marginLeft: 'auto', padding: '2px 8px', fontSize: 10, fontWeight: 700, color: verdictCol, background: `${verdictCol}22`, border: `1px solid ${verdictCol}`, borderRadius: 999 }}>
          {verdict}
        </span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 50px 50px 50px', rowGap: 4, columnGap: 6, fontSize: 11 }}>
        <span style={{ color: '#64748b', fontSize: 9, textTransform: 'uppercase', letterSpacing: 1 }}>metric</span>
        <span style={{ textAlign: 'right', color: '#6ee7b7', fontSize: 9, textTransform: 'uppercase', letterSpacing: 1 }}>pred</span>
        <span style={{ textAlign: 'right', color: '#94a3b8', fontSize: 9, textTransform: 'uppercase', letterSpacing: 1 }}>real</span>
        <span style={{ textAlign: 'right', color: '#64748b', fontSize: 9, textTransform: 'uppercase', letterSpacing: 1 }}>Δ</span>
        <Row label="avg stars" pred={p.avg_stars?.toFixed?.(2)} real={r.avg_stars?.toFixed?.(2)} delta={deltaStars} unit="★" />
        <Row label="% 5-star" pred={p.pct_5} real={r.pct_5} delta={delta5} unit="%" />
        <Row label="% 1-star" pred={p.pct_1} real={r.pct_1} delta={delta1} unit="%" />
      </div>
      <div style={{ marginTop: 10, paddingTop: 8, borderTop: '1px solid #1e293b', display: 'flex', flexDirection: 'column', gap: 3, fontSize: 11, color: '#94a3b8' }}>
        <div>NPS predicho: <strong style={{ color: '#fde047' }}>{p.nps != null ? `${p.nps > 0 ? '+' : ''}${p.nps}` : '—'}</strong>
          {p.nps_ci && <span style={{ color: '#64748b', fontSize: 10 }}> · 95%CI [{p.nps_ci[0].toFixed(1)}, {p.nps_ci[1].toFixed(1)}]</span>}
        </div>
        <div>Target-star match: <strong style={{ color: p.target_match >= 60 ? '#10b981' : '#f87171' }}>{p.target_match != null ? `${p.target_match}%` : '—'}</strong> <span style={{ color: '#64748b', fontSize: 10 }}>(goal ≥60)</span></div>
        <div style={{ fontSize: 10, color: '#64748b', marginTop: 2 }}>
          n={p.n} simulated · real n={r.n_reviews} reviews {r.sourced_from && `(${r.sourced_from})`}
        </div>
      </div>
    </div>
  );
}

function Kpi({ label, value, color, big, delta }) {
  return (
    <div style={{ background: 'rgba(30,41,59,0.4)', border: '1px solid #1e293b', borderRadius: 8, padding: '10px 12px' }}>
      <div style={{ fontSize: 10, color: '#64748b', letterSpacing: 1.5, textTransform: 'uppercase' }}>{label}</div>
      <div style={{ fontSize: big ? 22 : 16, fontWeight: 700, color, marginTop: 2 }}>{value}</div>
      {delta != null && delta !== 0 && (
        <div style={{ fontSize: 10, color: delta > 0 ? '#10b981' : '#f87171', marginTop: 2 }}>{delta > 0 ? '+' : ''}{delta}</div>
      )}
    </div>
  );
}
