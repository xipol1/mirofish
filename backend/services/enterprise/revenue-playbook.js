/**
 * Revenue Playbook Generator — renders a completed simulation into a branded
 * deliverable for the CRO: executive summary, per-segment findings, friction
 * clusters, attribution drivers, and prioritized recommendations.
 *
 * Formats supported out-of-the-box (no extra dependencies):
 *   - 'md'   → Markdown buffer
 *   - 'html' → HTML buffer (Meliá burgundy/navy/gold palette)
 *   - 'json' → Structured document (for other renderers)
 *
 * Optional (if the global `docx` module is resolvable):
 *   - 'docx' → Word document buffer
 *
 * Languages: 'es' (default) and 'en'.
 */

const agentRetrieval = require('./agent-retrieval');
const attribution = require('./attribution-engine');

const COPY = {
  es: {
    cover_title: 'Revenue Playbook',
    cover_subtitle: 'Synthetic Users · Hospitality Intelligence',
    exec_summary: 'Resumen Ejecutivo',
    methodology: 'Metodología',
    per_segment: 'Hallazgos por arquetipo',
    friction: 'Principales puntos de fricción',
    delight: 'Principales momentos de deleite',
    attribution: 'Atribución — drivers de NPS',
    recommendations: 'Recomendaciones priorizadas',
    predicted_reviews: 'Muestras de reviews predichas',
    appendix: 'Apéndice',
    generated_at: 'Generado el',
    property: 'Propiedad',
    audience: 'Audiencia',
    stays_simulated: 'Estancias simuladas',
    provenance_line: 'Fuentes calibradas contra 572 reviews reales (F1 theme detection = 91,4%)',
    priority: 'Prioridad',
    segment: 'Segmento',
    driver: 'Driver',
    impact: 'Impacto',
    p0: 'P0 — Crítico (ejecutar en 30 días)',
    p1: 'P1 — Alto (ejecutar en 60-90 días)',
    p2: 'P2 — Medio (trimestre siguiente)',
    p3: 'P3 — Bajo (roadmap anual)',
  },
  en: {
    cover_title: 'Revenue Playbook',
    cover_subtitle: 'Synthetic Users · Hospitality Intelligence',
    exec_summary: 'Executive Summary',
    methodology: 'Methodology',
    per_segment: 'Findings by archetype',
    friction: 'Top friction clusters',
    delight: 'Top delight moments',
    attribution: 'NPS attribution drivers',
    recommendations: 'Prioritized recommendations',
    predicted_reviews: 'Predicted review samples',
    appendix: 'Appendix',
    generated_at: 'Generated on',
    property: 'Property',
    audience: 'Audience',
    stays_simulated: 'Stays simulated',
    provenance_line: 'Sources calibrated against 572 real reviews (theme detection F1 = 91.4%)',
    priority: 'Priority',
    segment: 'Segment',
    driver: 'Driver',
    impact: 'Impact',
    p0: 'P0 — Critical (execute within 30 days)',
    p1: 'P1 — High (execute within 60-90 days)',
    p2: 'P2 — Medium (next quarter)',
    p3: 'P3 — Low (annual roadmap)',
  },
};

function ciLabel(ci) {
  if (!ci || ci.value == null) return '—';
  const pm = ci.ci_high != null && ci.ci_low != null ? Math.round(Math.max(Math.abs(ci.ci_high - ci.value), Math.abs(ci.value - ci.ci_low)) * 10) / 10 : null;
  return pm != null ? `${ci.value} ± ${pm}` : `${ci.value}`;
}

/**
 * Build the structured document (format-agnostic).
 */
function buildDoc(simulationResult, { language = 'es' } = {}) {
  const t = COPY[language] || COPY.es;
  const summary = simulationResult?.summary || {};
  const records = simulationResult?.records || [];
  const valid = records.filter(r => r && !r.error);

  const propertyName = simulationResult?.property?.name || '—';
  const audienceText = simulationResult?.audience_vector?.label
    || simulationResult?.audience_vector?.summary
    || '—';

  // Per-archetype rollup
  const byArch = {};
  for (const r of valid) {
    const a = r.persona_full?.archetype_id || r.archetype_id || 'unknown';
    (byArch[a] = byArch[a] || []).push(r);
  }
  const archRows = Object.entries(byArch).map(([arch, list]) => {
    const npsAvg = Math.round(list.reduce((s, r) => s + (r.sensation_summary?.nps ?? 0), 0) / list.length);
    const starsAvg = Math.round((list.reduce((s, r) => s + (r.sensation_summary?.stars ?? 0), 0) / list.length) * 10) / 10;
    const spendAvg = Math.round(list.reduce((s, r) => s + (r.expense_summary?.total_spend_eur ?? 0), 0) / list.length);
    return { archetype: arch, n: list.length, avg_nps: npsAvg, avg_stars: starsAvg, avg_spend_eur: spendAvg };
  }).sort((a, b) => b.n - a.n);

  // Friction / delight clusters
  const q = agentRetrieval.queryAgents(simulationResult, {});
  const cohortSummary = agentRetrieval.summarizeCohortQuery(q, simulationResult);

  // Attribution
  const cohortAttr = attribution.decomposeCohortNPS(simulationResult);

  // Predicted review samples (1 detractor, 1 passive, 1 promoter)
  const sortedByNps = [...valid].sort((a, b) => (a.sensation_summary?.nps ?? 0) - (b.sensation_summary?.nps ?? 0));
  const detractor = sortedByNps.find(r => (r.sensation_summary?.nps ?? 0) < 0 && r.predicted_review?.will_write_review);
  const passive = sortedByNps.find(r => {
    const n = r.sensation_summary?.nps ?? 0;
    return n >= 0 && n < 50 && r.predicted_review?.will_write_review;
  });
  const promoter = [...sortedByNps].reverse().find(r => (r.sensation_summary?.nps ?? 0) >= 50 && r.predicted_review?.will_write_review);

  // Auto-recommendations
  const recs = generateRecommendations({ archRows, cohortAttr, cohortSummary, t });

  return {
    meta: {
      language,
      property_name: propertyName,
      audience: audienceText,
      n_stays: valid.length,
      generated_at: new Date().toISOString(),
      provenance_line: t.provenance_line,
      provider: simulationResult?.provider || null,
    },
    exec_summary: {
      avg_stars: summary.avg_stars,
      avg_nps: summary.avg_nps,
      net_promoter_score: summary.net_promoter_score,
      avg_spend_eur: summary.avg_spend_eur,
      would_repeat_pct: summary.would_repeat_pct,
      would_recommend_pct: summary.would_recommend_pct,
      ci: {
        stars: ciLabel(summary.avg_stars_ci),
        nps: ciLabel(summary.avg_nps_ci),
        spend: ciLabel(summary.avg_spend_eur_ci),
        nps_net: ciLabel(summary.net_promoter_score_ci),
      },
    },
    segment_matrix: archRows,
    friction: cohortSummary.shared_friction || [],
    delight: cohortSummary.shared_delight || [],
    theme_frequency: cohortSummary.theme_frequency || [],
    attribution: {
      top_drivers_cohort_level: cohortAttr.top_drivers_cohort_level || [],
      segment_drivers: cohortAttr.segment_drivers || {},
    },
    predicted_reviews_sample: [
      detractor && formatReviewSample(detractor, 'detractor'),
      passive && formatReviewSample(passive, 'passive'),
      promoter && formatReviewSample(promoter, 'promoter'),
    ].filter(Boolean),
    recommendations: recs,
  };
}

function formatReviewSample(record, tag) {
  const pr = record.predicted_review || {};
  return {
    tag,
    persona_name: record.persona_full?.name || record.persona?.name || '',
    archetype: record.persona_full?.archetype_label || record.persona?.archetype_label || record.archetype_id,
    platform: pr.platform,
    language: pr.language,
    stars: pr.star_rating,
    nps: pr.nps ?? record.sensation_summary?.nps,
    title: pr.title,
    body: (pr.body || '').slice(0, 900),
  };
}

function generateRecommendations({ archRows, cohortAttr, cohortSummary, t }) {
  const recs = [];
  const topNeg = (cohortAttr.top_drivers_cohort_level || []).filter(d => d.avg_points < 0).slice(0, 5);
  const friction = cohortSummary.shared_friction || [];

  // P0: biggest negative driver
  if (topNeg[0]) {
    recs.push({
      priority: 'P0',
      segment: 'cohort',
      title: cleanDim(topNeg[0].dim),
      rationale: `Driver costs an average of ${Math.abs(topNeg[0].avg_points)} NPS points per guest.`,
      evidence: friction[0]?.description || null,
      expected_uplift_nps: Math.abs(Math.round(topNeg[0].avg_points * 0.6)),
    });
  }
  if (topNeg[1]) {
    recs.push({
      priority: 'P1',
      segment: 'cohort',
      title: cleanDim(topNeg[1].dim),
      rationale: `Secondary friction (~${Math.abs(topNeg[1].avg_points)} NPS / guest).`,
      evidence: friction[1]?.description || null,
      expected_uplift_nps: Math.abs(Math.round(topNeg[1].avg_points * 0.45)),
    });
  }

  // Per-segment negative drivers → P1/P2
  for (const [arch, info] of Object.entries(cohortAttr.segment_drivers || {})) {
    const worst = (info.top_drivers || []).filter(d => d.avg_points < 0)[0];
    if (worst) {
      recs.push({
        priority: info.avg_nps < 0 ? 'P1' : 'P2',
        segment: arch,
        title: cleanDim(worst.dim),
        rationale: `For ${arch} (n=${info.n}), this dim costs ~${Math.abs(worst.avg_points)} NPS.`,
        evidence: null,
        expected_uplift_nps: Math.abs(Math.round(worst.avg_points * 0.4)),
      });
    }
  }

  // P3: nice-to-have from delight amplification
  const topPos = (cohortAttr.top_drivers_cohort_level || []).filter(d => d.avg_points > 0)[0];
  if (topPos) {
    recs.push({
      priority: 'P3',
      segment: 'cohort',
      title: `Amplify: ${cleanDim(topPos.dim)}`,
      rationale: `Already a positive driver (+${topPos.avg_points} NPS). Scale the moments that trigger it.`,
      evidence: (cohortSummary.shared_delight || [])[0]?.description || null,
      expected_uplift_nps: Math.round(topPos.avg_points * 0.25),
    });
  }

  return recs.slice(0, 7);
}

function cleanDim(dim) {
  if (!dim) return '';
  return dim.replace(/^_/, '').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

// ─── Renderers ────────────────────────────────────────────────────

function renderMarkdown(doc) {
  const t = COPY[doc.meta.language] || COPY.es;
  const lines = [];
  lines.push(`# ${t.cover_title} — ${doc.meta.property_name}`);
  lines.push(`*${t.cover_subtitle}*`);
  lines.push(`\n> ${t.provenance_line}\n`);
  lines.push(`- **${t.property}:** ${doc.meta.property_name}`);
  lines.push(`- **${t.audience}:** ${doc.meta.audience}`);
  lines.push(`- **${t.stays_simulated}:** ${doc.meta.n_stays}`);
  lines.push(`- **${t.generated_at}:** ${doc.meta.generated_at}\n`);

  lines.push(`## ${t.exec_summary}`);
  const es = doc.exec_summary;
  lines.push(`| Metric | Value (with 95% CI) |`);
  lines.push(`|---|---|`);
  lines.push(`| Avg stars | ${es.ci.stars || es.avg_stars} |`);
  lines.push(`| Avg NPS | ${es.ci.nps || es.avg_nps} |`);
  lines.push(`| Net promoter score | ${es.ci.nps_net || es.net_promoter_score} |`);
  lines.push(`| Avg spend € | ${es.ci.spend || es.avg_spend_eur} |`);
  lines.push(`| Would repeat % | ${es.would_repeat_pct} |`);
  lines.push(`| Would recommend % | ${es.would_recommend_pct} |`);
  lines.push('');

  lines.push(`## ${t.per_segment}`);
  lines.push(`| Archetype | n | Avg NPS | Avg stars | Avg spend € |`);
  lines.push(`|---|---|---|---|---|`);
  for (const r of doc.segment_matrix) {
    lines.push(`| ${r.archetype} | ${r.n} | ${r.avg_nps} | ${r.avg_stars} | ${r.avg_spend_eur} |`);
  }
  lines.push('');

  lines.push(`## ${t.friction}`);
  if (doc.friction.length === 0) lines.push('_(none)_');
  for (const f of doc.friction) lines.push(`- (${f.mentioned_by}×) ${f.description}`);
  lines.push('');

  lines.push(`## ${t.delight}`);
  if (doc.delight.length === 0) lines.push('_(none)_');
  for (const d of doc.delight) lines.push(`- (${d.mentioned_by}×) ${d.description}`);
  lines.push('');

  lines.push(`## ${t.attribution}`);
  for (const d of doc.attribution.top_drivers_cohort_level.slice(0, 8)) {
    const sign = d.avg_points >= 0 ? '+' : '';
    lines.push(`- **${cleanDim(d.dim)}**: ${sign}${d.avg_points} NPS pts avg per guest`);
  }
  lines.push('');

  lines.push(`## ${t.recommendations}`);
  const groups = [['P0', t.p0], ['P1', t.p1], ['P2', t.p2], ['P3', t.p3]];
  for (const [pri, label] of groups) {
    const grp = doc.recommendations.filter(r => r.priority === pri);
    if (!grp.length) continue;
    lines.push(`### ${label}`);
    for (const r of grp) {
      lines.push(`- **${r.title}** (${r.segment}) — ${r.rationale}${r.expected_uplift_nps ? ` · est. +${r.expected_uplift_nps} NPS` : ''}`);
      if (r.evidence) lines.push(`  - _Evidence:_ "${r.evidence}"`);
    }
    lines.push('');
  }

  lines.push(`## ${t.predicted_reviews}`);
  for (const s of doc.predicted_reviews_sample) {
    lines.push(`### ${s.tag.toUpperCase()} — ${s.persona_name} (${s.archetype}) · ${s.stars}★ · ${s.platform} (${s.language})`);
    if (s.title) lines.push(`**${s.title}**`);
    lines.push(`> ${s.body.replace(/\n/g, '\n> ')}`);
    lines.push('');
  }

  lines.push(`## ${t.appendix}`);
  lines.push(`_Provider: ${doc.meta.provider || 'n/a'} · Generated by Synthetic Users Enterprise._`);
  return Buffer.from(lines.join('\n'), 'utf-8');
}

function renderHTML(doc) {
  const t = COPY[doc.meta.language] || COPY.es;
  const burgundy = '#7a1e3a';
  const navy = '#0f2d4d';
  const gold = '#c9a642';
  const md = renderMarkdown(doc).toString('utf-8');
  // Minimal md→html
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  let html = esc(md);
  html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
  html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
  html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
  html = html.replace(/^\| (.+) \|$/gm, (line) => {
    const cells = line.slice(2, -2).split(' | ');
    return '<tr>' + cells.map(c => `<td>${c}</td>`).join('') + '</tr>';
  });
  html = html.replace(/(<tr>.+?<\/tr>(\n)?)+/g, m => `<table>${m}</table>`);
  html = html.replace(/^- (.+)$/gm, '<li>$1</li>');
  html = html.replace(/(<li>.+<\/li>(\n)?)+/g, m => `<ul>${m}</ul>`);
  html = html.replace(/^> (.+)$/gm, '<blockquote>$1</blockquote>');

  return Buffer.from(`<!doctype html>
<html><head><meta charset="utf-8"><title>${t.cover_title}</title>
<style>
  body { font-family: -apple-system, Segoe UI, Helvetica, Arial, sans-serif; color:#1a1a1a; max-width:880px; margin:40px auto; padding:0 24px; line-height:1.55; }
  h1 { color:${burgundy}; border-bottom:3px solid ${gold}; padding-bottom:10px; }
  h2 { color:${navy}; margin-top:32px; border-bottom:1px solid #ddd; padding-bottom:6px; }
  h3 { color:${burgundy}; margin-top:20px; }
  table { border-collapse:collapse; width:100%; margin:14px 0; }
  td { border:1px solid #ddd; padding:8px 10px; font-size:14px; }
  tr:first-child td { background:${navy}; color:#fff; font-weight:600; }
  blockquote { border-left:4px solid ${gold}; margin:12px 0; padding:6px 16px; color:#555; background:#faf7f0; }
  ul { padding-left:20px; }
  em { color:#666; }
</style></head><body>${html}</body></html>`, 'utf-8');
}

function renderDocx(doc) {
  let docx;
  try {
    // Attempt user-installed or global docx package
    docx = require('docx');
  } catch (e) {
    try {
      const path = require('path');
      docx = require(path.join(process.env.APPDATA || '', 'npm', 'node_modules', 'docx'));
    } catch (_) {
      throw new Error('`docx` module not installed. Install with: npm install docx -g, or request format=md|html|json.');
    }
  }
  const { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, HeadingLevel, WidthType, AlignmentType } = docx;

  const t = COPY[doc.meta.language] || COPY.es;
  const burgundy = '7A1E3A';
  const navy = '0F2D4D';

  const para = (text, opts = {}) => new Paragraph({
    children: [new TextRun({ text, bold: !!opts.bold, color: opts.color || '1a1a1a', size: opts.size || 22 })],
    heading: opts.heading,
    spacing: { before: opts.before || 100, after: opts.after || 100 },
    alignment: opts.alignment,
  });

  const children = [];
  children.push(para(t.cover_title, { heading: HeadingLevel.TITLE, color: burgundy, size: 48 }));
  children.push(para(`${doc.meta.property_name} · ${doc.meta.audience}`, { color: navy, size: 28 }));
  children.push(para(t.provenance_line, { color: '555555', size: 18 }));
  children.push(para(`${t.generated_at}: ${doc.meta.generated_at}`, { color: '555555', size: 18 }));
  children.push(para(''));

  children.push(para(t.exec_summary, { heading: HeadingLevel.HEADING_1, color: navy }));
  const es = doc.exec_summary;
  children.push(para(`Avg stars: ${es.ci.stars || es.avg_stars}`, { size: 22 }));
  children.push(para(`Avg NPS: ${es.ci.nps || es.avg_nps}`, { size: 22 }));
  children.push(para(`Net Promoter: ${es.ci.nps_net || es.net_promoter_score}`, { size: 22 }));
  children.push(para(`Avg spend €: ${es.ci.spend || es.avg_spend_eur}`, { size: 22 }));
  children.push(para(`Would repeat %: ${es.would_repeat_pct}`, { size: 22 }));
  children.push(para(`Would recommend %: ${es.would_recommend_pct}`, { size: 22 }));

  children.push(para(t.per_segment, { heading: HeadingLevel.HEADING_1, color: navy }));
  children.push(new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      new TableRow({
        children: [t.segment, 'n', 'NPS', '★', '€'].map(h => new TableCell({ children: [para(h, { bold: true, color: 'ffffff' })], shading: { fill: navy } })),
      }),
      ...doc.segment_matrix.map(r => new TableRow({
        children: [r.archetype, String(r.n), String(r.avg_nps), String(r.avg_stars), String(r.avg_spend_eur)]
          .map(v => new TableCell({ children: [para(v)] })),
      })),
    ],
  }));

  children.push(para(t.friction, { heading: HeadingLevel.HEADING_1, color: navy }));
  for (const f of doc.friction) children.push(para(`• (${f.mentioned_by}×) ${f.description}`, { size: 20 }));

  children.push(para(t.attribution, { heading: HeadingLevel.HEADING_1, color: navy }));
  for (const d of doc.attribution.top_drivers_cohort_level.slice(0, 8)) {
    const sign = d.avg_points >= 0 ? '+' : '';
    children.push(para(`• ${cleanDim(d.dim)}: ${sign}${d.avg_points} NPS`, { size: 20 }));
  }

  children.push(para(t.recommendations, { heading: HeadingLevel.HEADING_1, color: navy }));
  for (const pri of ['P0', 'P1', 'P2', 'P3']) {
    const grp = doc.recommendations.filter(r => r.priority === pri);
    if (!grp.length) continue;
    children.push(para(t[pri.toLowerCase()] || pri, { heading: HeadingLevel.HEADING_2, color: burgundy }));
    for (const r of grp) children.push(para(`• ${r.title} (${r.segment}) — ${r.rationale}${r.expected_uplift_nps ? ` · est. +${r.expected_uplift_nps} NPS` : ''}`, { size: 20 }));
  }

  children.push(para(t.predicted_reviews, { heading: HeadingLevel.HEADING_1, color: navy }));
  for (const s of doc.predicted_reviews_sample) {
    children.push(para(`${s.tag.toUpperCase()} — ${s.persona_name} (${s.archetype})`, { bold: true, color: burgundy, size: 22 }));
    children.push(para(`${s.stars}★ · ${s.platform} · ${s.language}`, { color: '888888', size: 18 }));
    if (s.title) children.push(para(s.title, { bold: true, size: 22 }));
    children.push(para(s.body, { size: 20 }));
  }

  const docBuilder = new Document({ sections: [{ children }] });
  return Packer.toBuffer(docBuilder);
}

/**
 * Public entry point.
 * @returns {Promise<{buffer: Buffer, mime: string, extension: string, doc: Object}>}
 */
async function generateRevenuePlaybook({ simulationResult, format = 'md', language = 'es' }) {
  if (!simulationResult) throw new Error('simulationResult required');
  const doc = buildDoc(simulationResult, { language });

  const fmt = String(format).toLowerCase();
  if (fmt === 'json') return { buffer: Buffer.from(JSON.stringify(doc, null, 2), 'utf-8'), mime: 'application/json', extension: 'json', doc };
  if (fmt === 'md') return { buffer: renderMarkdown(doc), mime: 'text/markdown', extension: 'md', doc };
  if (fmt === 'html') return { buffer: renderHTML(doc), mime: 'text/html', extension: 'html', doc };
  if (fmt === 'docx') return { buffer: await renderDocx(doc), mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', extension: 'docx', doc };
  throw new Error(`Unsupported format: ${format}. Use one of: md, html, json, docx.`);
}

module.exports = { generateRevenuePlaybook, buildDoc };
