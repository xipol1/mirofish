/**
 * Synthetic Users × Dignus — product suite landing page.
 *
 * The entry point to the entire suite. Dignus visits this page, sees the value
 * in 15 seconds, and clicks through to either:
 *   - /presentation (12-slide walkthrough)
 *   - /lab (live calibrated dashboard · Villa Le Blanc case study)
 *   - /scenario (consultant workbench)
 *   - /validation (client-facing report)
 *
 * The old lead-generation form (landing-page simulator) is archived as
 * /_index.saas.js.bak for reference.
 */

import Head from 'next/head';

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
  gold: '#FCD34D',
  purple: '#A78BFA',
};

export default function Home() {
  return (
    <>
      <Head>
        <title>Synthetic Users × Dignus · Pre-decision validation suite</title>
        <meta name="description" content="The invisible engine behind every Dignus recommendation. Four tools that let consultants validate any client decision against a calibrated synthetic guest cohort — before recommending." />
        <style dangerouslySetInnerHTML={{ __html: `body{margin:0;background:${BRAND.bg};}a{text-decoration:none;}*,*::before,*::after{box-sizing:border-box;}` }} />
      </Head>

      <div style={{ minHeight: '100vh', background: BRAND.bg, color: BRAND.text, fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif', lineHeight: 1.55 }}>
        {/* NAV */}
        <nav style={{ position: 'sticky', top: 0, zIndex: 10, background: `${BRAND.bg}ee`, backdropFilter: 'blur(12px)', borderBottom: `1px solid ${BRAND.border}55` }}>
          <div style={{ maxWidth: 1200, margin: '0 auto', padding: '16px 32px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ width: 30, height: 30, borderRadius: 8, background: `linear-gradient(135deg, ${BRAND.accent}, #7C3AED)`, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontWeight: 800, fontSize: 14 }}>S</div>
              <span style={{ fontSize: 15, fontWeight: 700, letterSpacing: 0.3 }}>Synthetic Users</span>
              <span style={{ color: BRAND.subtle, fontSize: 12 }}>×</span>
              <span style={{ fontSize: 13, color: BRAND.muted, fontWeight: 500 }}>Dignus</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <NavLink href="/presentation">Deck</NavLink>
              <NavLink href="/scenario">Scenario</NavLink>
              <NavLink href="/validation">Validation</NavLink>
              <NavLink href="/onepager-es">One-pager</NavLink>
              <a href="/lab" style={{
                marginLeft: 8, padding: '8px 16px', background: BRAND.accent, color: 'white',
                borderRadius: 8, fontSize: 13, fontWeight: 600,
                boxShadow: `0 4px 12px ${BRAND.accent}44`,
              }}>Open dashboard →</a>
            </div>
          </div>
        </nav>

        {/* HERO */}
        <section style={{ maxWidth: 1200, margin: '0 auto', padding: '100px 32px 60px', textAlign: 'center' }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 10, padding: '6px 16px', background: BRAND.accentSoft, border: `1px solid ${BRAND.accent}`, borderRadius: 999, marginBottom: 28, fontSize: 11, letterSpacing: 1.6, textTransform: 'uppercase', color: BRAND.accent, fontWeight: 600 }}>
            PRE-DECISION VALIDATION · FOR HOSPITALITY CONSULTANTS
          </div>
          <h1 style={{ margin: 0, fontSize: 72, lineHeight: 1.02, fontWeight: 800, letterSpacing: -1.5, color: BRAND.text }}>
            The invisible engine<br />
            <span style={{ background: `linear-gradient(90deg, ${BRAND.accent}, ${BRAND.purple})`, WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>behind every Dignus recommendation.</span>
          </h1>
          <p style={{ margin: '32px auto 0', maxWidth: 760, fontSize: 20, lineHeight: 1.5, color: BRAND.muted }}>
            Four tools that let consultants validate any client decision against a calibrated synthetic guest cohort — <strong style={{ color: BRAND.text }}>before recommending</strong>. No guesswork. No 6-month post-mortem.
          </p>
          <div style={{ marginTop: 44, display: 'flex', gap: 14, justifyContent: 'center', flexWrap: 'wrap' }}>
            <a href="/lab" style={{
              display: 'inline-flex', alignItems: 'center', gap: 10,
              padding: '16px 28px', background: BRAND.accent, color: 'white',
              borderRadius: 12, fontSize: 15, fontWeight: 600,
              boxShadow: `0 8px 24px ${BRAND.accent}55`,
            }}>
              🚀 Open the dashboard
              <span style={{ opacity: 0.7 }}>→</span>
            </a>
            <a href="/presentation" style={{
              display: 'inline-flex', alignItems: 'center', gap: 10,
              padding: '16px 28px', background: 'transparent', color: BRAND.text,
              border: `1px solid ${BRAND.border}`, borderRadius: 12, fontSize: 15, fontWeight: 500,
            }}>
              🎬 Watch 5-min deck
            </a>
          </div>
          <div style={{ marginTop: 34, fontSize: 12, color: BRAND.subtle, letterSpacing: 0.8 }}>
            Calibrated against 572 real reviews · 10 cultures · Δ −0.04★ vs reality
          </div>
        </section>

        {/* PROOF STRIP */}
        <section style={{ background: BRAND.bgSoft, borderTop: `1px solid ${BRAND.border}44`, borderBottom: `1px solid ${BRAND.border}44`, padding: '36px 32px' }}>
          <div style={{ maxWidth: 1100, margin: '0 auto', display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 24 }}>
            {[
              { big: '572', sub: 'real reviews calibrated' },
              { big: '4.61★', sub: 'predicted (real 4.65)' },
              { big: '+71', sub: 'NPS simulated · CI ±2' },
              { big: '94%', sub: 'target-star match rate' },
              { big: '10', sub: 'cultures · Hofstede 6-D' },
            ].map((s) => (
              <div key={s.big} style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 32, fontWeight: 800, color: BRAND.gold, lineHeight: 1, fontFeatureSettings: "'tnum'" }}>{s.big}</div>
                <div style={{ fontSize: 11, color: BRAND.muted, marginTop: 6, textTransform: 'uppercase', letterSpacing: 0.8 }}>{s.sub}</div>
              </div>
            ))}
          </div>
        </section>

        {/* PITCH */}
        <section style={{ maxWidth: 1100, margin: '0 auto', padding: '100px 32px 60px' }}>
          <div style={{ textAlign: 'center', marginBottom: 44 }}>
            <div style={{ fontSize: 11, letterSpacing: 2, textTransform: 'uppercase', color: BRAND.gold, marginBottom: 14 }}>The pitch</div>
            <h2 style={{ margin: 0, fontSize: 44, fontWeight: 700, color: BRAND.text, letterSpacing: -0.5 }}>
              Consultants recommend.<br />
              <span style={{ color: BRAND.accent }}>Now they can validate first.</span>
            </h2>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 20 }}>
            {[
              { label: 'Before', col: '#EF4444', text: 'Guess → recommend → defend in board review → adjust in production. 6-month feedback cycle on a decision that was already final.' },
              { label: 'Gap', col: BRAND.warn, text: 'No simulated ground truth between intuition and client sign-off. Every recommendation carries unquantified risk.' },
              { label: 'After', col: BRAND.good, text: 'Simulate on synthetic cohort → validate NPS, revenue, LTV deltas → recommend with confidence intervals. Same-week turnaround.' },
            ].map((c) => (
              <div key={c.label} style={{ padding: 24, background: BRAND.card, border: `1px solid ${c.col}33`, borderRadius: 14 }}>
                <div style={{ fontSize: 10, letterSpacing: 1.2, textTransform: 'uppercase', color: c.col, marginBottom: 12, fontWeight: 700 }}>{c.label}</div>
                <div style={{ fontSize: 14, color: BRAND.muted, lineHeight: 1.6 }}>{c.text}</div>
              </div>
            ))}
          </div>
        </section>

        {/* PRODUCTS */}
        <section style={{ maxWidth: 1200, margin: '0 auto', padding: '60px 32px' }}>
          <div style={{ textAlign: 'center', marginBottom: 50 }}>
            <div style={{ fontSize: 11, letterSpacing: 2, textTransform: 'uppercase', color: BRAND.accent, marginBottom: 14 }}>Four products in the suite</div>
            <h2 style={{ margin: 0, fontSize: 44, fontWeight: 700, color: BRAND.text, letterSpacing: -0.5 }}>
              Everything a Dignus consultant needs, end-to-end.
            </h2>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 20 }}>
            <ProductCard
              num="01" icon="🛠" color={BRAND.accent}
              title="Scenario Editor"
              sub="Consultant workbench · &lt;500ms live preview"
              href="/scenario"
              bullets={[
                'Any decision, edited freely. No pre-written scenarios — just a blank form with a coherent default.',
                'Live impact preview on NPS, revenue, LTV, annualised — instantly, no full-sim wait.',
                'Library with save / duplicate / rename / delete. Auto-draft persistence.',
                'CSV import of PMS data (ADR + occupancy, EN/ES months).',
                'A/B compare two variants side by side before committing.',
              ]}
            />
            <ProductCard
              num="02" icon="📑" color={BRAND.purple}
              title="Validation Report"
              sub="White-label deliverable · 7 sections · PDF export"
              href="/validation"
              bullets={[
                'Executive summary with zone classification (WIN / SAFE / STRATEGIC_BET / RISKY / BAD).',
                'Sensitivity analysis — price, volume, NPS elasticity per segment.',
                'Review forecaster — predicted platform mix and review tone.',
                'Competitor game-theory matrix — how rivals likely respond.',
                'Interview deep-dive — chat with any simulated guest.',
              ]}
            />
            <ProductCard
              num="03" icon="📊" color={BRAND.good}
              title="Synthetic Users Dashboard"
              sub="Calibrated case study · showcase asset"
              href="/lab"
              bullets={[
                'Six navigable sections: Reports, Agents, Scenarios, Library, Properties, Get Started.',
                'Calibrated on 572 real reviews (Gran Meliá Villa Le Blanc, Menorca).',
                '31 synthetic guests with persona + 6-stage journey + first-person review.',
                'Click any agent → chat + 13-dim sensation radar + collapsible journey.',
                '"Ask this agent about this moment" — seeds chat from score breakdown.',
              ]}
            />
            <ProductCard
              num="04" icon="📰" color={BRAND.gold}
              title="One-pager · Executive Report"
              sub="Sales collateral · A4 + DOCX, EN + ES"
              href="/onepager-es"
              bullets={[
                'One-pager — A4 landscape, print-ready, EN & ES.',
                'Executive report — 18-page DOCX, 7 sections, Word-editable.',
                'Methodology · calibration proof · case-study numbers · pitch timeline.',
                'Regenerable via one Node script.',
                'Dignus-editable source, branded palette.',
              ]}
            />
          </div>
        </section>

        {/* WORKFLOW */}
        <section style={{ background: BRAND.bgSoft, padding: '80px 32px', borderTop: `1px solid ${BRAND.border}44`, borderBottom: `1px solid ${BRAND.border}44` }}>
          <div style={{ maxWidth: 1200, margin: '0 auto' }}>
            <div style={{ textAlign: 'center', marginBottom: 50 }}>
              <div style={{ fontSize: 11, letterSpacing: 2, textTransform: 'uppercase', color: BRAND.accent, marginBottom: 14 }}>The workflow</div>
              <h2 style={{ margin: 0, fontSize: 40, fontWeight: 700, color: BRAND.text }}>
                From client brief to signed-off memo in <span style={{ color: BRAND.accent }}>one day</span>.
              </h2>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
              {[
                { n: 1, icon: '📞', label: 'Client brief', sub: 'Decision arrives', col: BRAND.subtle },
                { n: 2, icon: '🛠', label: 'Scenario Editor', sub: '500ms preview, iterate', col: BRAND.accent },
                { n: 3, icon: '⚡', label: 'Run full sim', sub: '1 000-agent cohort', col: BRAND.purple },
                { n: 4, icon: '📑', label: 'Validation Report', sub: '7 sections, white-label', col: BRAND.good },
                { n: 5, icon: '📨', label: 'Client receives', sub: 'Signed-off memo', col: BRAND.gold },
              ].map((s, i, arr) => (
                <>
                  <div key={s.n} style={{ flex: 1, textAlign: 'center', minWidth: 150 }}>
                    <div style={{ width: 70, height: 70, margin: '0 auto 12px', borderRadius: '50%', background: `${s.col}22`, border: `2px solid ${s.col}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 28 }}>{s.icon}</div>
                    <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: 1.2, color: s.col, fontWeight: 700, marginBottom: 4 }}>Step {s.n}</div>
                    <div style={{ fontSize: 14, fontWeight: 600, color: BRAND.text, marginBottom: 3 }}>{s.label}</div>
                    <div style={{ fontSize: 11, color: BRAND.muted }}>{s.sub}</div>
                  </div>
                  {i < arr.length - 1 && (
                    <div key={`arr${i}`} style={{ fontSize: 20, color: BRAND.subtle }}>→</div>
                  )}
                </>
              ))}
            </div>
          </div>
        </section>

        {/* CASE STUDY */}
        <section style={{ maxWidth: 1100, margin: '0 auto', padding: '100px 32px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 50, alignItems: 'center' }}>
            <div>
              <div style={{ fontSize: 11, letterSpacing: 2, textTransform: 'uppercase', color: BRAND.accent, marginBottom: 14 }}>Case study · Gran Meliá Villa Le Blanc</div>
              <h2 style={{ margin: 0, fontSize: 40, fontWeight: 700, color: BRAND.text, marginBottom: 20, letterSpacing: -0.5 }}>
                31 synthetic guests. 10 languages.<br />4 decisions validated in 30 minutes.
              </h2>
              <p style={{ margin: 0, fontSize: 16, color: BRAND.muted, lineHeight: 1.6, marginBottom: 24 }}>
                Menorca flagship. Real 4.65★ average, 572 reviews scraped from TripAdvisor and Booking. We built a synthetic twin that landed within <strong style={{ color: BRAND.text }}>0.04 stars</strong> of reality — and used it to test raising dinner prices, cutting resort fees, and enforcing adults-only access.
              </p>
              <a href="/lab" style={{
                display: 'inline-flex', alignItems: 'center', gap: 10,
                padding: '12px 20px', background: BRAND.accent, color: 'white',
                borderRadius: 10, fontSize: 14, fontWeight: 600,
                boxShadow: `0 6px 18px ${BRAND.accent}44`,
              }}>
                See the live dashboard
                <span style={{ opacity: 0.7 }}>→</span>
              </a>
            </div>
            <div>
              <div style={{ padding: 28, background: BRAND.card, border: `1px solid ${BRAND.border}`, borderRadius: 14, marginBottom: 14 }}>
                <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 1.2, color: BRAND.good, fontWeight: 700, marginBottom: 14 }}>Calibration match</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
                  {[['4.65★', 'real'], ['4.61★', 'predicted'], ['−0.04', 'Δ']].map(([v, k]) => (
                    <div key={k}>
                      <div style={{ fontSize: 28, fontWeight: 800, color: BRAND.text, lineHeight: 1 }}>{v}</div>
                      <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: 1, color: BRAND.muted, marginTop: 4 }}>{k}</div>
                    </div>
                  ))}
                </div>
              </div>
              <div style={{ padding: 20, background: BRAND.bgSoft, border: `1px solid ${BRAND.border}`, borderRadius: 10 }}>
                <div style={{ fontStyle: 'italic', fontSize: 13, color: BRAND.muted, lineHeight: 1.6, marginBottom: 10 }}>
                  &ldquo;Our honeymoon was delayed two years by IVF… They had read my note, actioned it, and not once made a performance of it.&rdquo;
                </div>
                <div style={{ fontSize: 11, color: BRAND.subtle, letterSpacing: 0.4 }}>— Harriet C., synthetic guest #6 · NPS +100 · Booking.com 5★</div>
              </div>
            </div>
          </div>
        </section>

        {/* ENGAGEMENT */}
        <section style={{ background: BRAND.bgSoft, padding: '80px 32px', borderTop: `1px solid ${BRAND.border}44` }}>
          <div style={{ maxWidth: 1200, margin: '0 auto' }}>
            <div style={{ textAlign: 'center', marginBottom: 50 }}>
              <div style={{ fontSize: 11, letterSpacing: 2, textTransform: 'uppercase', color: BRAND.accent, marginBottom: 14 }}>Engagement model</div>
              <h2 style={{ margin: 0, fontSize: 40, fontWeight: 700, color: BRAND.text, letterSpacing: -0.5 }}>Pick how Dignus deploys it.</h2>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 20 }}>
              {[
                { name: 'Solo Consultant', price: '€490', period: '/ month', features: ['All 4 products, single user', '500 sim-runs / month', 'Shared scenario library', 'Email support'], accent: BRAND.subtle },
                { name: 'Firm Seat', price: '€1 990', period: '/ month', features: ['Up to 10 consultants', '5 000 sim-runs / month', 'Client workspace separation', 'Custom property calibration'], accent: BRAND.accent, featured: true },
                { name: 'White-label', price: 'Custom', period: '', features: ['Unlimited seats', 'Your branding + domain', 'Dedicated onboarding', 'SLA + API access'], accent: BRAND.gold },
              ].map((t) => (
                <div key={t.name} style={{
                  padding: 28, background: t.featured ? `${BRAND.accent}14` : BRAND.card,
                  border: `1px solid ${t.featured ? BRAND.accent : BRAND.border}`, borderRadius: 14,
                  boxShadow: t.featured ? `0 8px 32px ${BRAND.accent}22` : 'none', position: 'relative',
                }}>
                  {t.featured && (
                    <div style={{ position: 'absolute', top: -12, left: 20, padding: '3px 12px', background: BRAND.accent, color: 'white', borderRadius: 999, fontSize: 10, fontWeight: 700, letterSpacing: 1 }}>RECOMMENDED</div>
                  )}
                  <div style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: 1.2, color: t.accent, fontWeight: 700, marginBottom: 10 }}>{t.name}</div>
                  <div style={{ marginBottom: 22 }}>
                    <span style={{ fontSize: 40, fontWeight: 800, color: BRAND.text, lineHeight: 1 }}>{t.price}</span>
                    {t.period && <span style={{ fontSize: 14, color: BRAND.muted, marginLeft: 6 }}>{t.period}</span>}
                  </div>
                  <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {t.features.map((f, i) => (
                      <li key={i} style={{ fontSize: 13, color: BRAND.muted, display: 'flex', gap: 8, lineHeight: 1.5 }}>
                        <span style={{ color: t.accent, fontWeight: 700 }}>✓</span>
                        <span>{f}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* CTA */}
        <section style={{ maxWidth: 900, margin: '0 auto', padding: '110px 32px', textAlign: 'center' }}>
          <div style={{ fontSize: 11, letterSpacing: 2, textTransform: 'uppercase', color: BRAND.gold, marginBottom: 14 }}>Ready to try?</div>
          <h2 style={{ margin: 0, fontSize: 52, fontWeight: 800, color: BRAND.text, letterSpacing: -1, marginBottom: 20 }}>
            Your next recommendation.<br />
            <span style={{ background: `linear-gradient(90deg, ${BRAND.gold}, ${BRAND.accent})`, WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>Signed off in hours, not days.</span>
          </h2>
          <p style={{ margin: '0 auto', maxWidth: 640, fontSize: 17, color: BRAND.muted, lineHeight: 1.55, marginBottom: 36 }}>
            Pilot in 14 days. Every product below is live, bookmarkable, and shareable with any client today.
          </p>
          <div style={{ display: 'flex', gap: 14, justifyContent: 'center', flexWrap: 'wrap', marginBottom: 26 }}>
            <a href="/lab" style={{
              display: 'inline-flex', alignItems: 'center', gap: 10,
              padding: '16px 28px', background: BRAND.accent, color: 'white',
              borderRadius: 12, fontSize: 15, fontWeight: 600,
              boxShadow: `0 8px 24px ${BRAND.accent}55`,
            }}>🚀 Open dashboard →</a>
            <a href="/presentation" style={{
              display: 'inline-flex', alignItems: 'center', gap: 10,
              padding: '16px 28px', background: 'transparent', color: BRAND.text,
              border: `1px solid ${BRAND.border}`, borderRadius: 12, fontSize: 15, fontWeight: 500,
            }}>🎬 Watch the deck</a>
          </div>
          <a href="mailto:rafaferrer43@gmail.com?subject=Synthetic%20Users%20%C3%97%20Dignus%20%E2%80%94%20pilot%20request" style={{
            display: 'inline-flex', alignItems: 'center', gap: 10, padding: '12px 22px',
            background: BRAND.card, color: BRAND.text, border: `1px solid ${BRAND.border}`,
            borderRadius: 10, fontSize: 13, fontWeight: 500,
          }}>
            <span>📅</span>
            <span>Book a pilot · rafaferrer43@gmail.com</span>
          </a>
        </section>

        {/* FOOTER */}
        <footer style={{ borderTop: `1px solid ${BRAND.border}55`, padding: '30px 32px', background: BRAND.bgSoft }}>
          <div style={{ maxWidth: 1200, margin: '0 auto', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 14, fontSize: 11, color: BRAND.subtle }}>
            <div>© 2026 Synthetic Users. For Dignus consultancy. All product demos are live.</div>
            <div style={{ display: 'flex', gap: 18 }}>
              <a href="/lab" style={{ color: BRAND.muted }}>Dashboard</a>
              <a href="/presentation" style={{ color: BRAND.muted }}>Deck</a>
              <a href="/scenario" style={{ color: BRAND.muted }}>Scenario</a>
              <a href="/validation" style={{ color: BRAND.muted }}>Validation</a>
              <a href="/onepager-es" style={{ color: BRAND.muted }}>One-pager</a>
              <a href="mailto:rafaferrer43@gmail.com" style={{ color: BRAND.muted }}>Contact</a>
            </div>
          </div>
        </footer>
      </div>
    </>
  );
}

function NavLink({ href, children }) {
  return (
    <a href={href} style={{
      padding: '6px 10px', color: BRAND.muted, fontSize: 13, fontWeight: 500,
      borderRadius: 6, transition: 'color 120ms',
    }}>{children}</a>
  );
}

function ProductCard({ num, icon, color, title, sub, href, bullets }) {
  return (
    <a href={href} style={{
      display: 'flex', flexDirection: 'column', gap: 14,
      padding: 28, background: BRAND.card, border: `1px solid ${BRAND.border}`,
      borderRadius: 16, color: BRAND.text, transition: 'all 200ms',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
        <div style={{ width: 56, height: 56, borderRadius: 14, background: `${color}22`, border: `1px solid ${color}55`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 26, flexShrink: 0 }}>{icon}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: 1.2, color, fontWeight: 700, marginBottom: 4 }}>{num}</div>
          <div style={{ fontSize: 22, fontWeight: 700, color: BRAND.text }}>{title}</div>
          <div style={{ fontSize: 12, color: BRAND.muted, marginTop: 2 }} dangerouslySetInnerHTML={{ __html: sub }} />
        </div>
        <div style={{ color, fontSize: 20 }}>→</div>
      </div>
      <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 8 }}>
        {bullets.map((b, i) => (
          <li key={i} style={{ display: 'flex', gap: 10, fontSize: 13, color: BRAND.muted, lineHeight: 1.55 }}>
            <span style={{ color: color, flexShrink: 0, fontWeight: 700 }}>✓</span>
            <span>{b}</span>
          </li>
        ))}
      </ul>
    </a>
  );
}
