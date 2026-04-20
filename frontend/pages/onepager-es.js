/**
 * One-pager ES — Dignus pitch handout en español.
 *
 * Imprime a A4. Configurable vía query params:
 *   /onepager-es                              default (tema Dignus)
 *   /onepager-es?client=Meliá                 cliente en cabecera
 *   /onepager-es?consultant=Xavi              consultor en pie
 *   /onepager-es?brand=generic                sin branding Dignus
 */

import Head from 'next/head';

export async function getServerSideProps(ctx) {
  const brand = (ctx.query.brand || 'dignus').toString().toLowerCase();
  const client = (ctx.query.client || '').toString();
  const engagement = (ctx.query.engagement || '').toString();
  const consultant = (ctx.query.consultant || '').toString();
  return { props: { brand, client, engagement, consultant } };
}

const THEMES = {
  dignus: {
    name: 'Dignus',
    primary: '#0F4C75',
    primaryDark: '#0A3558',
    accent: '#E94560',
    muted: '#6B7888',
    tagline: 'Consultoría de revenue management',
    footer: 'Preparado por Dignus',
  },
  generic: {
    name: 'Validación de decisiones',
    primary: '#1f2937',
    primaryDark: '#111827',
    accent: '#059669',
    muted: '#6b7280',
    tagline: 'Validación sintética pre-decisión',
    footer: '',
  },
};

export default function OnePagerES({ brand, client, engagement, consultant }) {
  const theme = THEMES[brand] || THEMES.generic;
  const today = new Date().toISOString().slice(0, 10);

  return (
    <>
      <Head>
        <title>{`${theme.name} · Validación pre-decisión — one-pager`}</title>
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
        {/* Botón imprimir */}
        <button className="no-print" onClick={() => window.print()} style={{
          position: 'fixed', top: 18, right: 18,
          background: theme.primary, color: 'white', border: 0,
          padding: '10px 16px', borderRadius: 8, fontSize: 12, fontWeight: 700,
          cursor: 'pointer', boxShadow: '0 6px 18px rgba(15,76,117,0.3)',
          zIndex: 100,
        }}>
          Imprimir / Guardar PDF
        </button>

        <div className="page" style={{
          background: 'white', borderRadius: 4, padding: '20mm 18mm',
          minHeight: '270mm',
          position: 'relative', overflow: 'hidden',
        }}>
          {/* ─── CABECERA ───────────────────────────────────── */}
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
              <div style={{ fontWeight: 700, color: '#1a1d23', fontSize: 11 }}>Nueva línea de servicio</div>
              <div>Validación sintética pre-decisión</div>
              {client && <div style={{ marginTop: 2 }}>Para: <strong>{client}</strong></div>}
              {engagement && <div>{engagement}</div>}
              <div style={{ marginTop: 3, fontSize: 9 }}>{today} · v1.0 · confidencial</div>
            </div>
          </header>

          {/* ─── HERO ────────────────────────────────────── */}
          <section style={{ marginBottom: 18 }}>
            <h1 style={{
              fontSize: 22, fontWeight: 800, color: theme.primaryDark,
              margin: '0 0 6px', lineHeight: 1.2, letterSpacing: -0.3,
            }}>
              Valida cada decisión de revenue antes de que tu cliente la ejecute.
            </h1>
            <p style={{ fontSize: 12, lineHeight: 1.5, color: '#2a313d', margin: 0 }}>
              Una capa de validación para consultores {theme.name === 'Dignus' ? 'Dignus' : 'de revenue management'}.
              Simula cómo reaccionarían <strong>1.000 viajeros sintéticos</strong> a un cambio de tarifa,
              packaging, intervención de servicio o ajuste de loyalty — <strong>antes</strong> de implementarlo,
              calibrado contra benchmarks académicos peer-reviewed y estadísticas oficiales de turismo.
            </p>
          </section>

          {/* ─── EL GAP ──────────────────────────────────── */}
          <section style={{
            display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, marginBottom: 18,
          }}>
            <ArrowStep n="1" title="Hoy" color={theme.muted}>
              Analizas la data del cliente. Recomiendas una decisión de tarifa / packaging / plantilla.
            </ArrowStep>
            <ArrowStep n="2" title="El gap — 8-12 semanas" color={theme.accent} highlight>
              El cliente ejecuta a ciegas. Nadie valida antes. Si sale mal, tu marca absorbe el daño.
            </ArrowStep>
            <ArrowStep n="3" title="Con esta capa" color={theme.primary}>
              Pre-testeas contra cohortes sintéticas segmentadas. Entregas recomendación + informe de validación.
            </ArrowStep>
          </section>

          {/* ─── 4 CAPACIDADES ──────────────────────────── */}
          <section style={{ marginBottom: 18 }}>
            <SectionHeader number="01" title="Lo que añade esto a tu flujo de trabajo" theme={theme} />
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10, marginTop: 10 }}>
              <Capability icon="⚡" label="Preview de impacto en vivo" body="Revenue corto plazo + LTV a 3 años + ΔNPS en <500ms mientras editas." theme={theme} />
              <Capability icon="📈" label="Sensitivity sweep" body="Curva que muestra dónde se rompe la decisión. Óptimo + punto de equilibrio Nash." theme={theme} />
              <Capability icon="📝" label="Forecast de reviews (90 días)" body="7 reviews realistas que aparecerán en TripAdvisor / Booking / Google." theme={theme} />
              <Capability icon="⚔️" label="Matriz de reacción del competidor" body="Matriz 3×3 de teoría de juegos. Estrategia dominante + equilibrio Nash identificados." theme={theme} />
            </div>
          </section>

          {/* ─── PRUEBA ───────────────────────────────────── */}
          <section style={{ marginBottom: 18 }}>
            <SectionHeader number="02" title="Framework backtested contra data pública" theme={theme} />
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, marginTop: 10 }}>
              <ProofCard metric="95,5%" label="Correlación de rangos" sub="Ocupación estacional · IBESTAT/STR" theme={theme} />
              <ProofCard metric="87,5%" label="Match de elasticidad" sub="vs Cornell HQ + Vives & Jacob" theme={theme} />
              <ProofCard metric="80%" label="Gasto por cluster" sub="vs EGATUR 2024 (INE España)" theme={theme} />
              <ProofCard metric="90%" label="Distribución de estrellas" sub="Validación holdout de reviews" theme={theme} />
            </div>
            <p style={{ fontSize: 9, color: theme.muted, margin: '8px 0 0', lineHeight: 1.4 }}>
              Fuentes: Vives &amp; Jacob (2023); Garín-Muñoz; Singh &amp; Corsun (Cornell HQ 2023); Xuan Tran (2011);
              INE EGATUR &amp; FRONTUR 2024; IBESTAT Frontur; STR luxury Med benchmark; AENA traffic; rates
              publicados en Booking/Expedia. Toda cifra trazable.
            </p>
          </section>

          {/* ─── UNIT ECONOMICS ────────────────────────── */}
          <section style={{ marginBottom: 18 }}>
            <SectionHeader number="03" title="Unit economics para tu consultoría" theme={theme} />
            <div style={{
              marginTop: 10, background: '#f6f7f9', borderRadius: 6,
              border: '1px solid #e5e7eb', padding: '12px 14px',
            }}>
              <table style={{ width: '100%', fontSize: 11, borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid #d1d5db' }}>
                    <th style={{ textAlign: 'left', padding: '4px 0', fontSize: 9, letterSpacing: 1, textTransform: 'uppercase', color: theme.muted, fontWeight: 700 }}>Por engagement</th>
                    <th style={{ textAlign: 'right', padding: '4px 0', fontSize: 9, letterSpacing: 1, textTransform: 'uppercase', color: theme.muted, fontWeight: 700 }}>Hoy</th>
                    <th style={{ textAlign: 'right', padding: '4px 0', fontSize: 9, letterSpacing: 1, textTransform: 'uppercase', color: theme.muted, fontWeight: 700 }}>Con capa de validación</th>
                    <th style={{ textAlign: 'right', padding: '4px 0', fontSize: 9, letterSpacing: 1, textTransform: 'uppercase', color: theme.muted, fontWeight: 700 }}>Δ</th>
                  </tr>
                </thead>
                <tbody>
                  <UnitRow label="Precio al cliente" a="20.000 €" b="35.000 €" delta="+75%" positive />
                  <UnitRow label="Tu coste variable" a="8.000 €" b="8.000 €" delta="igual" muted />
                  <UnitRow label="Rev-share al proveedor (30%)" a="—" b="10.500 €" delta="nueva línea" muted />
                  <UnitRow label="Neto para tu consultoría" a="12.000 €" b="16.500 €" delta="+37%" positive bold />
                </tbody>
              </table>
              <p style={{ fontSize: 10, color: theme.muted, marginTop: 10, lineHeight: 1.5 }}>
                A 30 engagements/año con 50% de adopción: <strong>+225.000 € ARR</strong> en nuevos ingresos de consultoría.
                Sin contratar. Sin cambiar tu flujo. Un entregable adicional que tus competidores no ofrecen.
              </p>
            </div>
          </section>

          {/* ─── PROPUESTA DE PILOTO ─────────────────────── */}
          <section style={{ marginBottom: 14 }}>
            <SectionHeader number="04" title="Piloto de 90 días — sin coste inicial" theme={theme} />
            <div style={{
              marginTop: 10,
              background: `linear-gradient(135deg, ${theme.primary}08 0%, ${theme.primary}04 100%)`,
              border: `1px solid ${theme.primary}33`, borderLeft: `4px solid ${theme.primary}`,
              borderRadius: 6, padding: '12px 14px',
            }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }}>
                <PilotStat label="Duración" value="90 días" theme={theme} />
                <PilotStat label="Engagements" value="3 reales" theme={theme} />
                <PilotStat label="Pago inicial" value="0 €" theme={theme} color="#059669" />
                <PilotStat label="Share proveedor" value="30% rev" theme={theme} />
              </div>
              <div style={{ marginTop: 12, fontSize: 11, color: '#374151', lineHeight: 1.6 }}>
                <strong>Gate de éxito</strong>: el cliente acepta el premium pricing en ≥2 de 3 engagements Y la
                accuracy del forecast post-implementación es ≥70%. Si se cumple → firmamos licencia anual.
                Si no → sin obligaciones por ninguna parte.
                <br /><br />
                <strong>White-label</strong>: 100% con marca {theme.name}. La tecnología es invisible para tus
                clientes — reciben un informe de validación pulido con marca {theme.name}.
              </div>
            </div>
          </section>

          {/* ─── PIE / CTA ──────────────────────────────── */}
          <footer style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '12px 0 0', borderTop: '1px solid #e5e7eb',
            fontSize: 10, color: theme.muted,
          }}>
            <div style={{ fontSize: 11, color: '#1a1d23', fontWeight: 600 }}>
              🔗 Prueba el workbench en vivo: <span style={{ color: theme.primary, fontWeight: 700 }}>synthetic-users-suite.vercel.app/scenario</span>
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
        Paso {n}
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
