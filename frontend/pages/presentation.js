/**
 * Presentación Synthetic Users × Dignus — interactive slide deck.
 *
 * Target audience: Dignus consultancy evaluating whether to adopt
 * Synthetic Users as the invisible engine behind every recommendation.
 *
 * Navigation: ←/→ or j/k, numbers 1-9/0, click dots, Esc to exit.
 */

import Head from 'next/head';
import { useCallback, useEffect, useState } from 'react';

const BRAND = {
  bg: '#0B1220',
  bgSoft: '#111827',
  card: '#1F2937',
  border: '#374151',
  text: '#F9FAFB',
  muted: '#9CA3AF',
  subtle: '#6B7280',
  accent: '#3B82F6',
  accentSoft: '#1E3A8A',
  good: '#10B981',
  warn: '#F59E0B',
  bad: '#EF4444',
  gold: '#FCD34D',
};

const SLIDES = [
  // 1 · Cover
  { id: 'cover', type: 'cover' },
  // 2 · The pitch
  { id: 'pitch', type: 'pitch' },
  // 3 · Product suite
  { id: 'suite', type: 'suite' },
  // 4 · Scenario Editor
  { id: 'scenario', type: 'product',
    kicker: 'Product 1 · Consultant workbench',
    title: 'Scenario Editor',
    tagline: 'Any decision, edited freely, live preview in &lt;500ms',
    url: '/scenario',
    bullets: [
      'Pre-decision workbench — no pre-written scenarios, just a blank form that loads a coherent default',
      'Live impact preview on NPS, revenue per stay, LTV, annualised — no waiting for a full sim',
      'Scenario library: save, duplicate, rename, delete. Auto-draft persistence — no lost work',
      'CSV import of PMS data (monthly ADR + occupancy, EN/ES months, auto-delimiter)',
      'A/B compare two variants side by side before committing',
      'One click → Run full sim → redirects to Validation Report',
    ],
    tryText: 'Try with any client decision →',
  },
  // 5 · Validation Report
  { id: 'validation', type: 'product',
    kicker: 'Product 2 · Client deliverable',
    title: 'Validation Report',
    tagline: 'Seven-section white-label deliverable ready to hand to a client',
    url: '/validation',
    bullets: [
      'Executive summary with zone classification (WIN / SAFE / STRATEGIC_BET / RISKY / BAD)',
      'Sensitivity analysis — price elasticity, volume elasticity, NPS elasticity per segment',
      'Review forecaster — predicted platform mix and predicted review tone',
      'Competitor game-theory matrix — how rivals likely respond',
      'Narrative simulation — 6-8 synthetic guests reviewed in their own voice',
      'Interview deep-dive — Dignus consultant can chat with any simulated guest',
      'PDF export — white-label ready with Dignus branding',
    ],
    tryText: 'View a live report →',
  },
  // 6 · Synthetic Users Dashboard
  { id: 'lab', type: 'product',
    kicker: 'Product 3 · Proof asset + client showcase',
    title: 'Synthetic Users Dashboard',
    tagline: 'A full calibrated twin you can show prospects before they sign',
    url: '/lab',
    bullets: [
      'Six navigable sections: Reports · Agents · Scenarios · Library · Properties · Get Started',
      'Calibrated against 572 real reviews (Villa Le Blanc, Menorca)',
      '31 synthetic guests with rich persona + 6-stage journey + first-person review',
      'Click any agent → expanded view with chat + 13-dim sensation radar + collapsible journey stages',
      '"Ask this agent about this moment" — seeds chat from the score breakdown',
      'Multi-property roster (Villa Le Blanc · Palacio de los Duques · add your own)',
    ],
    tryText: 'Open the dashboard →',
  },
  // 7 · One-pager & Executive Report
  { id: 'handouts', type: 'product',
    kicker: 'Product 4 · Sales collateral',
    title: 'One-pager · Executive Report',
    tagline: 'Print-ready A4 and long-form DOCX for the pitch phase',
    url: '/onepager-es',
    bullets: [
      'One-pager — A4 landscape, print-ready, English and Spanish versions',
      'Executive report — 18-page DOCX, 7 sections, tables, ready for Word/PDF export',
      'Both cover: methodology, calibration proof, case study numbers, pitch timeline',
      'Update once — regenerate via a single Node script (`node scripts/build_melia_exec_v4.js`)',
      'Branded palette, consistent typography, Dignus-editable source',
    ],
    tryText: 'Open one-pager (ES) →',
  },
  // 8 · Workflow diagram
  { id: 'workflow', type: 'workflow' },
  // 9 · Calibration proof
  { id: 'calibration', type: 'calibration' },
  // 10 · Case study
  { id: 'casestudy', type: 'casestudy' },
  // 11 · Engagement
  { id: 'engagement', type: 'engagement' },
  // 12 · CTA
  { id: 'cta', type: 'cta' },
];

export default function PresentationPage() {
  const [idx, setIdx] = useState(0);
  const total = SLIDES.length;

  const go = useCallback((delta) => {
    setIdx((i) => Math.max(0, Math.min(total - 1, i + delta)));
  }, [total]);

  const goTo = useCallback((n) => setIdx(Math.max(0, Math.min(total - 1, n))), [total]);

  useEffect(() => {
    function onKey(e) {
      if (e.key === 'ArrowRight' || e.key === ' ' || e.key === 'j' || e.key === 'n' || e.key === 'PageDown') { e.preventDefault(); go(1); }
      else if (e.key === 'ArrowLeft' || e.key === 'k' || e.key === 'p' || e.key === 'PageUp') { e.preventDefault(); go(-1); }
      else if (e.key === 'Home') { e.preventDefault(); goTo(0); }
      else if (e.key === 'End') { e.preventDefault(); goTo(total - 1); }
      else if (e.key === 'Escape') { if (typeof window !== 'undefined') window.location.href = '/lab'; }
      else if (e.key >= '0' && e.key <= '9') {
        const n = e.key === '0' ? 9 : parseInt(e.key, 10) - 1;
        goTo(n);
      }
    }
    if (typeof window !== 'undefined') window.addEventListener('keydown', onKey);
    return () => { if (typeof window !== 'undefined') window.removeEventListener('keydown', onKey); };
  }, [go, goTo, total]);

  const slide = SLIDES[idx];
  const progress = ((idx + 1) / total) * 100;

  return (
    <>
      <Head>
        <title>Synthetic Users × Dignus · Product Suite</title>
        <style dangerouslySetInnerHTML={{ __html: 'body { display: block !important; margin: 0; overflow: hidden; }' }} />
      </Head>
      <div style={{ position: 'fixed', inset: 0, background: BRAND.bg, color: BRAND.text, fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif', overflow: 'hidden' }}>
        {/* Progress bar */}
        <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 3, background: BRAND.border, zIndex: 10 }}>
          <div style={{ height: '100%', width: `${progress}%`, background: `linear-gradient(90deg, ${BRAND.accent}, #7C3AED)`, transition: 'width 260ms ease' }} />
        </div>

        {/* Slide content */}
        <div style={{ position: 'absolute', inset: 0, padding: '60px 80px 100px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <SlideContent slide={slide} idx={idx} />
        </div>

        {/* Footer nav */}
        <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, padding: '20px 40px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: `linear-gradient(to top, ${BRAND.bg}, transparent)`, zIndex: 5 }}>
          <div style={{ fontSize: 11, color: BRAND.subtle, letterSpacing: 1.2, textTransform: 'uppercase' }}>
            Synthetic Users × Dignus · {idx + 1} / {total}
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            {SLIDES.map((_, i) => (
              <button key={i} onClick={() => goTo(i)} style={{
                width: i === idx ? 20 : 8, height: 8, borderRadius: 4, padding: 0,
                background: i === idx ? BRAND.accent : BRAND.border, border: 'none',
                cursor: 'pointer', transition: 'all 200ms ease',
              }} />
            ))}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={() => go(-1)} disabled={idx === 0} style={{
              padding: '8px 14px', background: 'transparent', border: `1px solid ${BRAND.border}`,
              borderRadius: 8, color: idx === 0 ? BRAND.subtle : BRAND.text, fontSize: 13,
              cursor: idx === 0 ? 'not-allowed' : 'pointer', fontWeight: 500,
            }}>← prev</button>
            <button onClick={() => go(1)} disabled={idx === total - 1} style={{
              padding: '8px 14px', background: idx === total - 1 ? BRAND.border : BRAND.accent,
              border: 'none', borderRadius: 8, color: 'white', fontSize: 13,
              cursor: idx === total - 1 ? 'not-allowed' : 'pointer', fontWeight: 600,
            }}>next →</button>
          </div>
        </div>

        {/* Keyboard hint */}
        <div style={{ position: 'absolute', top: 20, right: 30, fontSize: 10, color: BRAND.subtle, letterSpacing: 1 }}>
          ← → arrows · 1–9 jump · esc to dashboard
        </div>
      </div>
    </>
  );
}

function SlideContent({ slide, idx }) {
  if (slide.type === 'cover') return <CoverSlide />;
  if (slide.type === 'pitch') return <PitchSlide />;
  if (slide.type === 'suite') return <SuiteSlide />;
  if (slide.type === 'product') return <ProductSlide slide={slide} />;
  if (slide.type === 'workflow') return <WorkflowSlide />;
  if (slide.type === 'calibration') return <CalibrationSlide />;
  if (slide.type === 'casestudy') return <CaseStudySlide />;
  if (slide.type === 'engagement') return <EngagementSlide />;
  if (slide.type === 'cta') return <CtaSlide />;
  return null;
}

function CoverSlide() {
  return (
    <div style={{ maxWidth: 1100, width: '100%', textAlign: 'center' }}>
      <div style={{ display: 'inline-flex', alignItems: 'center', gap: 14, padding: '8px 18px', background: BRAND.accentSoft, border: `1px solid ${BRAND.accent}`, borderRadius: 999, marginBottom: 32, fontSize: 12, letterSpacing: 1.6, textTransform: 'uppercase', color: BRAND.accent, fontWeight: 600 }}>
        <span>SYNTHETIC USERS</span>
        <span style={{ opacity: 0.5 }}>×</span>
        <span>DIGNUS</span>
      </div>
      <h1 style={{ margin: 0, fontSize: 64, lineHeight: 1.05, fontWeight: 800, letterSpacing: -1, color: BRAND.text }}>
        The invisible engine<br />
        <span style={{ background: `linear-gradient(90deg, ${BRAND.accent}, #A78BFA)`, WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>behind every Dignus recommendation.</span>
      </h1>
      <p style={{ margin: '28px auto 0', maxWidth: 700, fontSize: 18, lineHeight: 1.55, color: BRAND.muted }}>
        Four products that turn your consulting workflow into a pre-decision validation engine. One source of truth for every client recommendation — from first scenario to final board memo.
      </p>
      <div style={{ marginTop: 40, fontSize: 12, color: BRAND.subtle, letterSpacing: 1.4 }}>
        Press <kbd style={{ background: BRAND.card, border: `1px solid ${BRAND.border}`, padding: '2px 8px', borderRadius: 4, fontFamily: 'ui-monospace, monospace', fontSize: 11 }}>→</kbd> to start
      </div>
    </div>
  );
}

function PitchSlide() {
  return (
    <div style={{ maxWidth: 1000, width: '100%' }}>
      <div style={{ fontSize: 11, letterSpacing: 2, textTransform: 'uppercase', color: BRAND.gold, marginBottom: 18 }}>The pitch, in one sentence</div>
      <p style={{ margin: 0, fontSize: 48, lineHeight: 1.25, fontWeight: 600, color: BRAND.text }}>
        Every Dignus consultant validates every client decision against a <span style={{ color: BRAND.accent }}>calibrated synthetic cohort</span> — before recommending.
      </p>
      <div style={{ marginTop: 40, display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 20 }}>
        {[
          { label: 'Before Synthetic Users', text: 'Guess → recommend → defend in review → adjust in production', col: BRAND.bad },
          { label: 'Gap', text: 'No simulated ground truth between intuition and client', col: BRAND.warn },
          { label: 'After Synthetic Users', text: 'Simulate → validate → recommend with confidence intervals', col: BRAND.good },
        ].map((c) => (
          <div key={c.label} style={{ padding: 20, background: BRAND.card, border: `1px solid ${c.col}33`, borderRadius: 12 }}>
            <div style={{ fontSize: 10, letterSpacing: 1.2, textTransform: 'uppercase', color: c.col, marginBottom: 8, fontWeight: 600 }}>{c.label}</div>
            <div style={{ fontSize: 14, color: BRAND.muted, lineHeight: 1.55 }}>{c.text}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function SuiteSlide() {
  const items = [
    { icon: '🛠', title: 'Scenario Editor', sub: 'Consultant workbench', color: BRAND.accent },
    { icon: '📑', title: 'Validation Report', sub: 'Client deliverable', color: '#A78BFA' },
    { icon: '📊', title: 'Synthetic Dashboard', sub: 'Proof + demo', color: BRAND.good },
    { icon: '📰', title: 'One-pager + Report', sub: 'Sales collateral', color: BRAND.gold },
  ];
  return (
    <div style={{ maxWidth: 1100, width: '100%' }}>
      <div style={{ fontSize: 11, letterSpacing: 2, textTransform: 'uppercase', color: BRAND.accent, marginBottom: 12 }}>Four products in the suite</div>
      <h2 style={{ margin: 0, fontSize: 42, fontWeight: 700, color: BRAND.text, marginBottom: 40 }}>
        Everything a Dignus consultant needs, end-to-end.
      </h2>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 20 }}>
        {items.map((it, i) => (
          <div key={it.title} style={{ padding: 28, background: BRAND.card, border: `1px solid ${BRAND.border}`, borderRadius: 14, display: 'flex', alignItems: 'center', gap: 20 }}>
            <div style={{ width: 64, height: 64, borderRadius: 14, background: `${it.color}22`, border: `1px solid ${it.color}55`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 28, flexShrink: 0 }}>{it.icon}</div>
            <div>
              <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 1.2, color: it.color, fontWeight: 600, marginBottom: 4 }}>{'0' + (i + 1)}</div>
              <div style={{ fontSize: 22, fontWeight: 700, color: BRAND.text, marginBottom: 4 }}>{it.title}</div>
              <div style={{ fontSize: 13, color: BRAND.muted }}>{it.sub}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ProductSlide({ slide }) {
  return (
    <div style={{ maxWidth: 1200, width: '100%', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 60, alignItems: 'center' }}>
      <div>
        <div style={{ fontSize: 11, letterSpacing: 2, textTransform: 'uppercase', color: BRAND.accent, marginBottom: 14, fontWeight: 600 }}>{slide.kicker}</div>
        <h2 style={{ margin: 0, fontSize: 54, fontWeight: 800, color: BRAND.text, letterSpacing: -0.5, marginBottom: 16 }}>{slide.title}</h2>
        <p style={{ margin: 0, fontSize: 20, lineHeight: 1.5, color: BRAND.muted }} dangerouslySetInnerHTML={{ __html: slide.tagline }} />
        <a href={slide.url} style={{
          display: 'inline-flex', alignItems: 'center', gap: 10,
          marginTop: 28, padding: '14px 22px', background: BRAND.accent,
          color: 'white', borderRadius: 10, fontSize: 14, fontWeight: 600,
          textDecoration: 'none', boxShadow: `0 8px 24px ${BRAND.accent}44`,
        }}>
          {slide.tryText} <span style={{ opacity: 0.7 }}>↗</span>
        </a>
      </div>
      <div style={{ padding: 28, background: BRAND.card, border: `1px solid ${BRAND.border}`, borderRadius: 14 }}>
        <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 1.2, color: BRAND.subtle, marginBottom: 14, fontWeight: 600 }}>What's inside</div>
        <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 12 }}>
          {slide.bullets.map((b, i) => (
            <li key={i} style={{ display: 'flex', gap: 12, fontSize: 14, color: BRAND.text, lineHeight: 1.55 }}>
              <span style={{ color: BRAND.accent, flexShrink: 0, fontWeight: 700 }}>✓</span>
              <span>{b}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function WorkflowSlide() {
  const steps = [
    { n: 1, icon: '📞', label: 'Client brief', sub: 'Decision arrives', color: BRAND.subtle },
    { n: 2, icon: '🛠', label: 'Scenario Editor', sub: '500ms preview, iterate', color: BRAND.accent },
    { n: 3, icon: '⚡', label: 'Run full sim', sub: '1000-agent cohort', color: '#A78BFA' },
    { n: 4, icon: '📑', label: 'Validation Report', sub: '7 sections, white-label', color: BRAND.good },
    { n: 5, icon: '📨', label: 'Client receives', sub: 'Signed-off memo', color: BRAND.gold },
  ];
  return (
    <div style={{ maxWidth: 1200, width: '100%' }}>
      <div style={{ fontSize: 11, letterSpacing: 2, textTransform: 'uppercase', color: BRAND.accent, marginBottom: 12 }}>The workflow</div>
      <h2 style={{ margin: 0, fontSize: 42, fontWeight: 700, color: BRAND.text, marginBottom: 50 }}>
        From client brief to signed-off recommendation in <span style={{ color: BRAND.accent }}>one day</span>.
      </h2>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
        {steps.map((s, i) => (
          <>
            <div key={s.n} style={{ flex: 1, textAlign: 'center' }}>
              <div style={{ width: 80, height: 80, margin: '0 auto 14px', borderRadius: '50%', background: `${s.color}22`, border: `2px solid ${s.color}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 32 }}>{s.icon}</div>
              <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: 1.2, color: s.color, fontWeight: 700, marginBottom: 4 }}>Step {s.n}</div>
              <div style={{ fontSize: 15, fontWeight: 600, color: BRAND.text, marginBottom: 3 }}>{s.label}</div>
              <div style={{ fontSize: 11, color: BRAND.muted }}>{s.sub}</div>
            </div>
            {i < steps.length - 1 && (
              <div key={`arr${i}`} style={{ fontSize: 22, color: BRAND.subtle, padding: '0 4px' }}>→</div>
            )}
          </>
        ))}
      </div>
      <div style={{ marginTop: 40, padding: 18, background: BRAND.card, border: `1px solid ${BRAND.border}`, borderRadius: 10, fontSize: 13, color: BRAND.muted, lineHeight: 1.6, textAlign: 'center' }}>
        Every step is logged. Every iteration versioned. Every recommendation has a <strong style={{ color: BRAND.text }}>confidence interval</strong> instead of an adjective.
      </div>
    </div>
  );
}

function CalibrationSlide() {
  const stats = [
    { big: '572', label: 'Real reviews in corpus', sub: 'TripAdvisor + Booking' },
    { big: '4.65★', label: 'Real avg rating', sub: 'vs 4.61★ predicted · Δ−0.04' },
    { big: '94%', label: 'Target-star match', sub: 'goal ≥60% · we land 94' },
    { big: '10', label: 'Cultures modelled', sub: 'Hofstede 6-D calibrated' },
    { big: '15', label: 'Adversarial events', sub: 'HVAC · overbooking · fees…' },
    { big: '13', label: 'Sensation dimensions', sub: 'aesthetic · service · value…' },
  ];
  return (
    <div style={{ maxWidth: 1100, width: '100%' }}>
      <div style={{ fontSize: 11, letterSpacing: 2, textTransform: 'uppercase', color: BRAND.gold, marginBottom: 12 }}>Proof of calibration</div>
      <h2 style={{ margin: 0, fontSize: 42, fontWeight: 700, color: BRAND.text, marginBottom: 10 }}>
        Not a generic LLM wrapper.
      </h2>
      <p style={{ margin: 0, fontSize: 18, color: BRAND.muted, marginBottom: 40 }}>
        Every dimension anchored to publicly observable reality, verifiable against the source corpus.
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }}>
        {stats.map((s) => (
          <div key={s.label} style={{ padding: 22, background: BRAND.card, border: `1px solid ${BRAND.border}`, borderRadius: 12 }}>
            <div style={{ fontSize: 44, fontWeight: 800, color: BRAND.gold, lineHeight: 1, marginBottom: 6, fontFeatureSettings: "'tnum'" }}>{s.big}</div>
            <div style={{ fontSize: 14, fontWeight: 600, color: BRAND.text, marginBottom: 3 }}>{s.label}</div>
            <div style={{ fontSize: 11, color: BRAND.muted }}>{s.sub}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function CaseStudySlide() {
  return (
    <div style={{ maxWidth: 1200, width: '100%' }}>
      <div style={{ fontSize: 11, letterSpacing: 2, textTransform: 'uppercase', color: BRAND.accent, marginBottom: 12 }}>Case study · Gran Meliá Villa Le Blanc (Menorca)</div>
      <h2 style={{ margin: 0, fontSize: 38, fontWeight: 700, color: BRAND.text, marginBottom: 30 }}>
        31 synthetic guests, 10 languages, 4 decisions tested in 30 minutes.
      </h2>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
        <div style={{ padding: 24, background: BRAND.card, border: `1px solid ${BRAND.border}`, borderRadius: 12 }}>
          <div style={{ fontSize: 11, letterSpacing: 1.2, textTransform: 'uppercase', color: BRAND.good, marginBottom: 12, fontWeight: 700 }}>Calibration match</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
            {[['4.65★', 'real'], ['4.61★', 'predicted'], ['−0.04', 'Δ']].map(([v, k]) => (
              <div key={k}>
                <div style={{ fontSize: 28, fontWeight: 800, color: BRAND.text, lineHeight: 1 }}>{v}</div>
                <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: 1, color: BRAND.muted, marginTop: 4 }}>{k}</div>
              </div>
            ))}
          </div>
        </div>
        <div style={{ padding: 24, background: BRAND.card, border: `1px solid ${BRAND.border}`, borderRadius: 12 }}>
          <div style={{ fontSize: 11, letterSpacing: 1.2, textTransform: 'uppercase', color: BRAND.accent, marginBottom: 12, fontWeight: 700 }}>Decisions validated</div>
          <div style={{ fontSize: 13, color: BRAND.text, lineHeight: 1.7 }}>
            Raise dinner +15% · +€247K / yr, −2.2 NPS<br />
            Cut €45 resort fee · +3.3 NPS, promoter flip<br />
            Platinum upgrade gift · +2.8 NPS at scale<br />
            Adults-only enforcement · +3.7 NPS on couples
          </div>
        </div>
        <div style={{ gridColumn: '1 / 3', padding: 20, background: BRAND.bgSoft, border: `1px solid ${BRAND.border}`, borderRadius: 10, fontStyle: 'italic', fontSize: 14, color: BRAND.muted, lineHeight: 1.6 }}>
          &ldquo;Our honeymoon was delayed two years by IVF… They had read my note, actioned it, and not once made a performance of it.&rdquo;
          <div style={{ fontStyle: 'normal', fontSize: 11, color: BRAND.subtle, marginTop: 8, letterSpacing: 0.6 }}>— Harriet C., synthetic guest #6 · NPS +100 · Booking.com 5★ · generated by Claude grounded in 572-review calibration</div>
        </div>
      </div>
    </div>
  );
}

function EngagementSlide() {
  const tiers = [
    { name: 'Solo Consultant', price: '€490 / mo', features: ['All 4 products, single user', '500 sim-runs / month', 'Shared scenario library', 'Email support'], accent: BRAND.subtle },
    { name: 'Firm Seat', price: '€1,990 / mo', features: ['Up to 10 consultants', '5,000 sim-runs / month', 'Client workspace separation', 'Custom property calibration'], accent: BRAND.accent, featured: true },
    { name: 'White-label', price: 'Custom', features: ['Unlimited seats', 'Your branding + domain', 'Dedicated onboarding', 'SLA + API access'], accent: BRAND.gold },
  ];
  return (
    <div style={{ maxWidth: 1200, width: '100%' }}>
      <div style={{ fontSize: 11, letterSpacing: 2, textTransform: 'uppercase', color: BRAND.accent, marginBottom: 12 }}>Engagement model</div>
      <h2 style={{ margin: 0, fontSize: 42, fontWeight: 700, color: BRAND.text, marginBottom: 40 }}>
        Pick how Dignus deploys it.
      </h2>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 20 }}>
        {tiers.map((t) => (
          <div key={t.name} style={{ padding: 28, background: t.featured ? `${BRAND.accent}14` : BRAND.card, border: `1px solid ${t.featured ? BRAND.accent : BRAND.border}`, borderRadius: 14, boxShadow: t.featured ? `0 8px 32px ${BRAND.accent}22` : 'none', position: 'relative' }}>
            {t.featured && (
              <div style={{ position: 'absolute', top: -12, left: 20, padding: '3px 12px', background: BRAND.accent, color: 'white', borderRadius: 999, fontSize: 10, fontWeight: 700, letterSpacing: 1 }}>RECOMMENDED</div>
            )}
            <div style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: 1.2, color: t.accent, fontWeight: 700, marginBottom: 8 }}>{t.name}</div>
            <div style={{ fontSize: 36, fontWeight: 800, color: BRAND.text, marginBottom: 20, lineHeight: 1 }}>{t.price}</div>
            <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 10 }}>
              {t.features.map((f, i) => (
                <li key={i} style={{ fontSize: 13, color: BRAND.muted, display: 'flex', gap: 8, lineHeight: 1.5 }}>
                  <span style={{ color: t.accent }}>✓</span>
                  <span>{f}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <div style={{ marginTop: 24, textAlign: 'center', fontSize: 12, color: BRAND.subtle }}>
        All tiers include: no-code scenario editor · white-label deliverables · LLM fallback (zero downtime) · NDA-ready.
      </div>
    </div>
  );
}

function CtaSlide() {
  const links = [
    { url: '/scenario', icon: '🛠', label: 'Scenario Editor', sub: 'Start a blank decision' },
    { url: '/validation', icon: '📑', label: 'Validation Report', sub: 'See the full deliverable' },
    { url: '/lab', icon: '📊', label: 'Synthetic Dashboard', sub: 'Villa Le Blanc case study' },
    { url: '/onepager-es', icon: '📰', label: 'One-pager (ES)', sub: 'Print-ready handout' },
  ];
  return (
    <div style={{ maxWidth: 1100, width: '100%', textAlign: 'center' }}>
      <div style={{ fontSize: 11, letterSpacing: 2, textTransform: 'uppercase', color: BRAND.gold, marginBottom: 14 }}>Try any product now</div>
      <h2 style={{ margin: 0, fontSize: 54, fontWeight: 800, color: BRAND.text, marginBottom: 14, letterSpacing: -0.5 }}>
        Next recommendation.<br />
        <span style={{ background: `linear-gradient(90deg, ${BRAND.gold}, ${BRAND.accent})`, WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>Signed off in hours, not days.</span>
      </h2>
      <p style={{ margin: '0 auto', maxWidth: 700, fontSize: 16, color: BRAND.muted, marginBottom: 36 }}>
        Every product here is live and bookmarkable. Share any link with a client. Pilot in 14 days.
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 14, marginBottom: 24 }}>
        {links.map((l) => (
          <a key={l.url} href={l.url} style={{
            display: 'flex', alignItems: 'center', gap: 16, padding: 20,
            background: BRAND.card, border: `1px solid ${BRAND.border}`, borderRadius: 12,
            textDecoration: 'none', color: BRAND.text, transition: 'all 200ms',
          }}>
            <div style={{ fontSize: 28 }}>{l.icon}</div>
            <div style={{ textAlign: 'left', flex: 1 }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: BRAND.text }}>{l.label}</div>
              <div style={{ fontSize: 12, color: BRAND.muted, marginTop: 2 }}>{l.sub}</div>
            </div>
            <div style={{ color: BRAND.accent, fontSize: 20 }}>→</div>
          </a>
        ))}
      </div>
      <a href="mailto:rafaferrer43@gmail.com?subject=Synthetic%20Users%20%C3%97%20Dignus%20%E2%80%94%20pilot%20request" style={{ display: 'inline-flex', alignItems: 'center', gap: 10, padding: '12px 24px', background: BRAND.accent, color: 'white', borderRadius: 10, fontSize: 14, fontWeight: 600, boxShadow: `0 8px 32px ${BRAND.accent}44`, textDecoration: 'none' }}>
        <span>📅</span>
        <span>Book a pilot · rafaferrer43@gmail.com</span>
      </a>
    </div>
  );
}
