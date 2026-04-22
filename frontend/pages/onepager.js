/**
 * One-pager — consulting pitch deliverable.
 *
 * Imprime a A4. Entregable físico que el consultor deja encima de la mesa
 * o adjunta en su email al cliente. Todo configurable vía query params
 * para poder imprimirlo personalizado por engagement.
 *
 * URLs:
 *   /onepager                              default (consulting preset)
 *   /onepager?client=Meliá&engagement=...  custom client
 *   /onepager?brand=generic                unbranded
 *   /onepager?consultant=Xavi              with consultant name
 */

import Head from 'next/head';

export async function getServerSideProps(ctx) {
  const brand = (ctx.query.brand || 'consult').toString().toLowerCase();
  const client = (ctx.query.client || '').toString();
  const engagement = (ctx.query.engagement || '').toString();
  const consultant = (ctx.query.consultant || '').toString();
  return { props: { brand, client, engagement, consultant } };
}

const THEMES = {
  consult: {
    name: 'Pre-decision Validation',
    primary: '#0F4C75',
    primaryDark: '#0A3558',
    accent: '#E94560',
    muted: '#6B7888',
    tagline: 'Revenue management consultancy',
    footer: 'Synthetic Users — calibrated on 6,076 real reviews · 8 mixed-brand properties',
  },
  generic: {
    name: 'Decision Validation',
    primary: '#1f2937',
    primaryDark: '#111827',
    accent: '#059669',
    muted: '#6b7280',
    tagline: 'Pre-decision synthetic validation',
    footer: '',
  },
};

export default function OnePager({ brand, client, engagement, consultant }) {
  const theme = THEMES[brand] || THEMES.generic;
  const today = new Date().toISOString().slice(0, 10);

  return (
    <>
      <Head>
        <title>{`${theme.name} · Pre-decision validation — one-pager`}</title>
        <meta name="robots" content="noindex" />
      </Head>

      <style jsx global>{`
        body { background: #eceef1; color: #1a1d23; font-family: -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif; margin: 0; }
        * { box-sizing: border-box; }
        @page { size: A4 portrait; margin: 12mm; }
        @media print {
          body { background: white !important; }
          .no-print { display: none !important; }
          .page { box-shadow: none !important; border: none !important; }
        }
        @media screen {
          .page { box-shadow: 0 10px 40px rgba(0,0,0,0.1); }
        }
      `}</style>

      <div style={{ maxWidth: 820, margin: '0 auto', padding: '24px 16px 60px' }}>
        {/* Print button */}
        <button className="no-print" onClick={() => window.print()} style={{
          position: 'fixed', top: 18, right: 18,
          background: theme.primary, color: 'white', border: 0,
          padding: '10px 16px', borderRadius: 8, fontSize: 12, fontWeight: 700,
          cursor: 'pointer', boxShadow: '0 6px 18px rgba(15,76,117,0.3)',
          zIndex: 100,
        }}>
          Print / Save as PDF
        </button>

        <div className="page" style={{
          background: 'white', borderRadius: 4, padding: '20mm 18mm',
          minHeight: '270mm',
          position: 'relative', overflow: 'hidden',
        }}>
          {/* ─── HEADER ───────────────────────────────────── */}
          <header style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end',
            borderBottom: `3px solid ${theme.primary}`, paddingBottom: 12, marginBottom: 18,
          }}>
            <div>
              <div style={{ fontSize: 9, letterSpacing: 2, textTransform: 'uppercase', color: theme.muted, fontWeight: 700 }}>
                {theme.tagline}
              </div>
              <div style={{ fontSize: 30, fontWeight: 800, color: theme.primaryDark, marginTop: 2, letterSpacing: -0.5 }}>
                {theme.name}
              </div>
            </div>
            <div style={{ textAlign: 'right', fontSize: 10, color: theme.muted, lineHeight: 1.5 }}>
              <div style={{ fontWeight: 700, color: '#1a1d23', fontSize: 11 }}>New service offering</div>
              <div>Pre-decision synthetic validation</div>
              {client && <div style={{ marginTop: 2 }}>For: <strong>{client}</strong></div>}
              {engagement && <div>{engagement}</div>}
              <div style={{ marginTop: 3, fontSize: 9 }}>{today} · v1.0 · confidential</div>
            </div>
          </header>

          {/* ─── HERO ────────────────────────────────────── */}
          <section style={{ marginBottom: 18 }}>
            <h1 style={{
              fontSize: 22, fontWeight: 800, color: theme.primaryDark,
              margin: '0 0 6px', lineHeight: 1.2, letterSpacing: -0.3,
            }}>
              Test every revenue decision before your client executes it.
            </h1>
            <p style={{ fontSize: 12, lineHeight: 1.5, color: '#2a313d', margin: 0 }}>
              A validation layer for revenue management consultants.
              Simulate how <strong>1,000 synthetic travelers</strong> react to a proposed rate change,
              packaging shift, service intervention, or loyalty move — <strong>before</strong> it ships,
              calibrated against peer-reviewed academic benchmarks and public tourism statistics.
            </p>
          </section>

          {/* ─── THE GAP ──────────────────────────────────── */}
          <section style={{
            display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, marginBottom: 18,
          }}>
            <ArrowStep n="1" title="Today" color={theme.muted}>
              You analyze the client's data. You recommend a rate / package / staff decision.
            </ArrowStep>
            <ArrowStep n="2" title="Gap — 8-12 weeks" color={theme.accent} highlight>
              Client executes blind. Nobody validates before shipping. If it goes wrong, your brand takes the hit.
            </ArrowStep>
            <ArrowStep n="3" title="With this layer" color={theme.primary}>
              You pre-test against segmented synthetic cohorts. Deliver the recommendation + validation report.
            </ArrowStep>
          </section>

          {/* ─── 4 CAPABILITIES ──────────────────────────── */}
          <section style={{ marginBottom: 18 }}>
            <SectionHeader number="01" title="What this adds to your workflow" theme={theme} />
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10, marginTop: 10 }}>
              <Capability icon="⚡" label="Live impact preview" body="Short-term revenue + 3-yr LTV + ΔNPS in <500ms as you edit." theme={theme} />
              <Capability icon="📈" label="Sensitivity sweep" body="Curve showing where the decision breaks. Optimal + Nash break point." theme={theme} />
              <Capability icon="📝" label="Review forecast (90-day)" body="7 realistic reviews that will appear on TripAdvisor / Booking / Google." theme={theme} />
              <Capability icon="⚔️" label="Competitor reaction matrix" body="3×3 game-theory grid. Dominant strategy + Nash equilibrium identified." theme={theme} />
            </div>
          </section>

          {/* ─── PROOF ───────────────────────────────────── */}
          <section style={{ marginBottom: 18 }}>
            <SectionHeader number="02" title="Framework backtested against public data" theme={theme} />
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, marginTop: 10 }}>
              <ProofCard metric="95.5%" label="Rank correlation" sub="Seasonal occupancy · IBESTAT/STR" theme={theme} />
              <ProofCard metric="87.5%" label="Elasticity match" sub="vs Cornell HQ + Vives & Jacob" theme={theme} />
              <ProofCard metric="80%" label="Per-cluster spend" sub="vs EGATUR 2024 (INE Spain)" theme={theme} />
              <ProofCard metric="90%" label="Star distribution" sub="Review holdout validation" theme={theme} />
            </div>
            <p style={{ fontSize: 9, color: theme.muted, margin: '8px 0 0', lineHeight: 1.4 }}>
              Sources: Vives &amp; Jacob (2023); Garín-Muñoz; Singh &amp; Corsun (Cornell HQ 2023); Xuan Tran (2011);
              INE EGATUR &amp; FRONTUR 2024; IBESTAT Frontur; STR luxury Med benchmark; AENA traffic data;
              Booking/Expedia published rates. Every figure traceable.
            </p>
          </section>

          {/* ─── UNIT ECONOMICS ────────────────────────── */}
          <section style={{ marginBottom: 18 }}>
            <SectionHeader number="03" title="Unit economics for your consultancy" theme={theme} />
            <div style={{
              marginTop: 10, background: '#f6f7f9', borderRadius: 6,
              border: '1px solid #e5e7eb', padding: '12px 14px',
            }}>
              <table style={{ width: '100%', fontSize: 11, borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid #d1d5db' }}>
                    <th style={{ textAlign: 'left', padding: '4px 0', fontSize: 9, letterSpacing: 1, textTransform: 'uppercase', color: theme.muted, fontWeight: 700 }}>Per engagement</th>
                    <th style={{ textAlign: 'right', padding: '4px 0', fontSize: 9, letterSpacing: 1, textTransform: 'uppercase', color: theme.muted, fontWeight: 700 }}>Today</th>
                    <th style={{ textAlign: 'right', padding: '4px 0', fontSize: 9, letterSpacing: 1, textTransform: 'uppercase', color: theme.muted, fontWeight: 700 }}>With validation layer</th>
                    <th style={{ textAlign: 'right', padding: '4px 0', fontSize: 9, letterSpacing: 1, textTransform: 'uppercase', color: theme.muted, fontWeight: 700 }}>Δ</th>
                  </tr>
                </thead>
                <tbody>
                  <UnitRow label="Price to client" a="€20,000" b="€35,000" delta="+75%" positive />
                  <UnitRow label="Your variable cost" a="€8,000" b="€8,000" delta="flat" muted />
                  <UnitRow label="Rev-share to vendor (30%)" a="—" b="€10,500" delta="new line" muted />
                  <UnitRow label="Net to your consultancy" a="€12,000" b="€16,500" delta="+37%" positive bold />
                </tbody>
              </table>
              <p style={{ fontSize: 10, color: theme.muted, marginTop: 10, lineHeight: 1.5 }}>
                At 30 engagements/year with 50% adoption: <strong>+€225k ARR in new consultancy revenue</strong>.
                No hiring. No workflow changes. One additional deliverable your competitors do not offer.
              </p>
            </div>
          </section>

          {/* ─── PILOT PROPOSAL ──────────────────────────── */}
          <section style={{ marginBottom: 14 }}>
            <SectionHeader number="04" title="90-day pilot — zero upfront" theme={theme} />
            <div style={{
              marginTop: 10,
              background: `linear-gradient(135deg, ${theme.primary}08 0%, ${theme.primary}04 100%)`,
              border: `1px solid ${theme.primary}33`, borderLeft: `4px solid ${theme.primary}`,
              borderRadius: 6, padding: '12px 14px',
            }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }}>
                <PilotStat label="Duration" value="90 days" theme={theme} />
                <PilotStat label="Engagements" value="3 real" theme={theme} />
                <PilotStat label="Upfront fee" value="€0" theme={theme} color="#059669" />
                <PilotStat label="Vendor share" value="30% rev" theme={theme} />
              </div>
              <div style={{ marginTop: 12, fontSize: 11, color: '#374151', lineHeight: 1.6 }}>
                <strong>Success gate</strong>: client accepts the premium pricing in ≥2 of 3 engagements AND
                post-implementation forecast accuracy ≥70%. If gate passes → we sign an annual licence.
                If not → no further obligation either side.
                <br /><br />
                <strong>White-label</strong>: 100% branded as {theme.name}. The technology is invisible
                to your clients — they receive a polished {theme.name}-branded validation report.
              </div>
            </div>
          </section>

          {/* ─── FOOTER / CTA ────────────────────────────── */}
          <footer style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '12px 0 0', borderTop: '1px solid #e5e7eb',
            fontSize: 10, color: theme.muted,
          }}>
            <div style={{ fontSize: 11, color: '#1a1d23', fontWeight: 600 }}>
              🔗 Try the live workbench: <span style={{ color: theme.primary, fontWeight: 700 }}>synthetic-users-suite.vercel.app/scenario</span>
            </div>
            <div style={{ textAlign: 'right' }}>
              {consultant && <div style={{ color: '#1a1d23', fontWeight: 600 }}>{consultant}</div>}
              <div>{theme.footer}</div>
            </div>
          </footer>
        </div>
      </div>
    </>
  );
}

// ══════════════════ Helpers ═══════════════════════════════════════════

function SectionHeader({ number, title, theme }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, paddingBottom: 4, borderBottom: '1px solid #e5e7eb' }}>
      <span style={{ fontSize: 10, letterSpacing: 2, fontWeight: 700, color: theme.accent }}>{number}</span>
      <h2 style={{ margin: 0, fontSize: 13, fontWeight: 800, color: theme.primaryDark, letterSpacing: -0.2 }}>{title}</h2>
    </div>
  );
}

function Capability({ icon, label, body, theme }) {
  return (
    <div style={{
      background: 'white', border: '1px solid #e5e7eb',
      borderLeft: `3px solid ${theme.primary}`,
      borderRadius: 4, padding: '10px 12px',
    }}>
      <div style={{ fontSize: 15, marginBottom: 2 }}>{icon}</div>
      <div style={{ fontSize: 12, fontWeight: 700, color: theme.primaryDark, marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 10, color: '#374151', lineHeight: 1.5 }}>{body}</div>
    </div>
  );
}

function ProofCard({ metric, label, sub, theme }) {
  return (
    <div style={{
      background: 'white', border: `1px solid ${theme.primary}44`,
      borderTop: `3px solid ${theme.primary}`,
      borderRadius: 4, padding: '10px 10px', textAlign: 'center',
    }}>
      <div style={{ fontSize: 22, fontWeight: 900, color: theme.primaryDark, letterSpacing: -0.5, lineHeight: 1 }}>
        {metric}
      </div>
      <div style={{ fontSize: 10, fontWeight: 700, color: '#1a1d23', marginTop: 4 }}>{label}</div>
      <div style={{ fontSize: 9, color: theme.muted, marginTop: 2, lineHeight: 1.3 }}>{sub}</div>
    </div>
  );
}

function ArrowStep({ n, title, color, children, highlight }) {
  return (
    <div style={{
      padding: '10px 12px',
      background: highlight ? '#fef2f2' : '#f6f7f9',
      border: highlight ? `1px solid ${color}55` : '1px solid #e5e7eb',
      borderLeft: `3px solid ${color}`,
      borderRadius: 4,
    }}>
      <div style={{ fontSize: 9, letterSpacing: 1.4, textTransform: 'uppercase', color, fontWeight: 700 }}>
        Step {n}
      </div>
      <div style={{ fontSize: 11, fontWeight: 700, color: '#1a1d23', marginTop: 2, marginBottom: 3 }}>{title}</div>
      <div style={{ fontSize: 10, color: '#374151', lineHeight: 1.5 }}>{children}</div>
    </div>
  );
}

function UnitRow({ label, a, b, delta, positive, muted, bold }) {
  return (
    <tr style={{ borderBottom: '1px solid #e5e7eb' }}>
      <td style={{ padding: '6px 0', fontSize: 11, color: bold ? '#1a1d23' : '#374151', fontWeight: bold ? 700 : 500 }}>{label}</td>
      <td style={{ padding: '6px 0', fontSize: 11, color: '#6b7888', textAlign: 'right' }}>{a}</td>
      <td style={{ padding: '6px 0', fontSize: 11, color: '#1a1d23', fontWeight: bold ? 700 : 600, textAlign: 'right' }}>{b}</td>
      <td style={{
        padding: '6px 0', fontSize: 10, textAlign: 'right', fontWeight: 700,
        color: positive ? '#059669' : muted ? '#6b7888' : '#dc2626',
      }}>
        {delta}
      </td>
    </tr>
  );
}

function PilotStat({ label, value, color, theme }) {
  return (
    <div>
      <div style={{ fontSize: 9, letterSpacing: 1.2, textTransform: 'uppercase', color: theme.muted, fontWeight: 700 }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 800, color: color || theme.primaryDark, marginTop: 2 }}>{value}</div>
    </div>
  );
}
