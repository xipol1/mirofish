/**
 * PDF Report Generator — audit-ready enterprise report.
 *
 * Sections:
 *   1. Cover page
 *   2. Executive summary (headline + key metrics)
 *   3. Agent cohort breakdown
 *   4. Journey funnel
 *   5. Top findings / patterns
 *   6. Recommended actions (ranked)
 *   7. Per-agent traces (1 page per agent with key screenshot)
 *   8. Appendix: methodology + confidence
 */

const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');
const storage = require('../storage');

const COLORS = {
  violet: '#6366f1',
  indigo: '#4f46e5',
  emerald: '#059669',
  red: '#dc2626',
  amber: '#d97706',
  slate: '#475569',
  slateLight: '#94a3b8',
  bg: '#0f172a',
  text: '#0f172a',
  dim: '#64748b',
};

async function generateReport({ simulation, outputPath }) {
  return new Promise(async (resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: 'A4', margin: 50, bufferPages: true });
      const stream = fs.createWriteStream(outputPath);
      doc.pipe(stream);

      // ── Cover ──
      coverPage(doc, simulation);

      // ── Executive Summary ──
      doc.addPage();
      executiveSummary(doc, simulation);

      // ── Cohort ──
      doc.addPage();
      cohortSection(doc, simulation);

      // ── Funnel ──
      doc.addPage();
      funnelSection(doc, simulation);

      // ── Recommendations ──
      doc.addPage();
      recommendationsSection(doc, simulation);

      // ── Per-Agent (first screenshot only for space) ──
      if (simulation.result?.agent_results?.length) {
        for (const agent of simulation.result.agent_results.slice(0, 10)) {
          doc.addPage();
          await agentTraceSection(doc, agent);
        }
      }

      // ── Methodology ──
      doc.addPage();
      methodologySection(doc, simulation);

      // ── Page numbers ──
      const range = doc.bufferedPageRange();
      for (let i = 0; i < range.count; i++) {
        doc.switchToPage(i);
        doc.fontSize(8).fillColor(COLORS.dim)
          .text(`Synthetic Users — Confidential — Page ${i + 1} of ${range.count}`, 50, doc.page.height - 30, { align: 'center', width: doc.page.width - 100 });
      }

      doc.end();
      stream.on('finish', () => resolve(outputPath));
      stream.on('error', reject);
    } catch (err) {
      reject(err);
    }
  });
}

function coverPage(doc, sim) {
  doc.rect(0, 0, doc.page.width, doc.page.height).fill('#0f172a');

  doc.fillColor('#a78bfa').fontSize(14).text('SYNTHETIC USERS', 50, 60, { characterSpacing: 4 });

  doc.fillColor('#f8fafc').fontSize(36).font('Helvetica-Bold')
    .text('Launch Validation Report', 50, 200, { width: doc.page.width - 100 });

  const product = sim.result?.scenario_summary?.site_name || sim.input?.target_url || 'Product';
  doc.fillColor('#cbd5e1').fontSize(18).font('Helvetica')
    .text(product, 50, 260, { width: doc.page.width - 100 });

  if (sim.input?.goal) {
    doc.fillColor('#94a3b8').fontSize(12).font('Helvetica-Oblique')
      .text(`Goal: ${sim.input.goal}`, 50, 300, { width: doc.page.width - 100 });
  }

  // Key number
  const cr = sim.result?.outcomes?.conversion_rate ?? 0;
  doc.fillColor('#a78bfa').fontSize(80).font('Helvetica-Bold')
    .text(`${cr}%`, 50, 420);
  doc.fillColor('#cbd5e1').fontSize(14).font('Helvetica')
    .text('predicted conversion rate', 50, 520);

  const agents = sim.result?.outcomes?.total ?? 0;
  doc.fillColor('#64748b').fontSize(10)
    .text(`based on ${agents} synthetic agents navigating the product`, 50, 545);

  doc.fillColor('#64748b').fontSize(10)
    .text(`Generated ${new Date().toISOString()}`, 50, doc.page.height - 80);
}

function sectionTitle(doc, text) {
  doc.moveDown(0.5);
  doc.fillColor(COLORS.violet).fontSize(10).font('Helvetica-Bold').text(text.toUpperCase(), { characterSpacing: 3 });
  doc.moveDown(0.3);
  doc.strokeColor(COLORS.violet).lineWidth(2).moveTo(50, doc.y).lineTo(150, doc.y).stroke();
  doc.moveDown(0.8);
}

function executiveSummary(doc, sim) {
  sectionTitle(doc, 'Executive Summary');

  const headline = sim.result?.headline || sim.result?.insights?.headline || 'Simulation complete.';
  doc.fillColor(COLORS.text).fontSize(16).font('Helvetica-Bold')
    .text(headline, { width: doc.page.width - 100, lineGap: 4 });
  doc.moveDown(1);

  const m = sim.result?.metrics || {};
  const stats = [
    ['Total agents', m.total_agents ?? 0],
    ['Converted', m.converted ?? 0],
    ['Interested', m.interested ?? 0],
    ['Bounced', m.bounced ?? 0],
    ['Abandoned', m.abandoned ?? 0],
    ['Conversion rate', `${m.conversion_rate ?? 0}%  ±${m.ci_95_margin_pct ?? '?'}%`],
    ['Trust score', (m.trust_score ?? 0).toFixed ? (m.trust_score ?? 0).toFixed(2) : m.trust_score],
    ['Avg navigation depth', m.navigation_entropy ?? 0],
    ['Rage events', m.rage_events ?? 0],
    ['Confidence', `${Math.round((m.confidence_score ?? 0) * 100)}%`],
  ];

  drawStatsTable(doc, stats);

  if (m.sample_size_warning) {
    doc.moveDown(1);
    doc.fillColor(COLORS.amber).fontSize(9).font('Helvetica-Oblique')
      .text('⚠ ' + m.sample_size_warning, { width: doc.page.width - 100 });
  }
}

function drawStatsTable(doc, rows) {
  const rowH = 22;
  const colW = (doc.page.width - 100) / 2;
  let y = doc.y;
  rows.forEach(([label, value], i) => {
    if (i % 2 === 0) {
      doc.rect(50, y, doc.page.width - 100, rowH).fill('#f1f5f9').fillColor(COLORS.text);
    }
    doc.fillColor(COLORS.slate).fontSize(10).font('Helvetica').text(label, 60, y + 6, { width: colW });
    doc.fillColor(COLORS.text).fontSize(11).font('Helvetica-Bold').text(String(value), 60 + colW, y + 5, { width: colW - 10, align: 'right' });
    y += rowH;
  });
  doc.y = y + 10;
}

function cohortSection(doc, sim) {
  sectionTitle(doc, 'Agent Cohort');

  const personas = sim.result?.personas || [];
  doc.fillColor(COLORS.slate).fontSize(11)
    .text(`${personas.length} synthetic agents were generated, each representing a distinct decision archetype seeded from real public pain points.`, { width: doc.page.width - 100 });
  doc.moveDown(1);

  const seg = sim.result?.metrics?.segment_outcomes || {};
  doc.fillColor(COLORS.text).fontSize(13).font('Helvetica-Bold').text('Conversion by archetype').moveDown(0.5);
  const segRows = Object.entries(seg).map(([k, v]) => [
    k,
    `${v.total} agents`,
    `${v.converted} converted`,
    `${v.conversion_rate}%`,
  ]);
  drawMultiColTable(doc, ['Archetype', 'Size', 'Converted', 'Rate'], segRows);
}

function funnelSection(doc, sim) {
  sectionTitle(doc, 'Journey Funnel');
  const funnel = sim.result?.metrics?.funnel || [];
  if (funnel.length === 0) {
    doc.fillColor(COLORS.slate).fontSize(11).text('No funnel data available.');
    return;
  }
  doc.fillColor(COLORS.slate).fontSize(10).text(`${funnel.length} unique URLs were reached across the cohort.`);
  doc.moveDown(0.8);

  // Bar chart
  const chartX = 50;
  const chartY = doc.y;
  const chartW = doc.page.width - 100;
  const rowH = 28;

  funnel.slice(0, 10).forEach((f, i) => {
    const y = chartY + i * rowH;
    const pct = f.retention * 100;
    const barW = (chartW - 200) * f.retention;

    doc.fillColor(COLORS.text).fontSize(9).text(truncateUrl(f.url, 40), chartX, y + 5, { width: 180 });
    doc.rect(chartX + 185, y + 4, chartW - 200, rowH - 10).strokeColor('#e2e8f0').lineWidth(1).stroke();
    doc.rect(chartX + 185, y + 4, Math.max(2, barW), rowH - 10).fill(COLORS.violet);
    doc.fillColor(COLORS.text).fontSize(9)
      .text(`${f.visitors} (${Math.round(pct)}%)`, chartX + chartW - 60, y + 7, { width: 60, align: 'right' });
  });

  doc.y = chartY + funnel.slice(0, 10).length * rowH + 20;

  // Top dropoffs
  const dropoffs = sim.result?.metrics?.top_dropoff_pages || [];
  if (dropoffs.length) {
    doc.fillColor(COLORS.text).fontSize(12).font('Helvetica-Bold').text('Top drop-off pages').moveDown(0.3);
    dropoffs.forEach(d => {
      doc.fillColor(COLORS.red).fontSize(9).text(`• ${d.count} agents abandoned at: ${d.url}`, { width: doc.page.width - 100 });
    });
  }
}

function recommendationsSection(doc, sim) {
  sectionTitle(doc, 'Recommended Actions');

  const recs = sim.result?.recommendations || [];
  if (recs.length === 0) {
    doc.fillColor(COLORS.slate).fontSize(11).text('No specific recommendations generated.');
    return;
  }

  recs.forEach(rec => {
    // Card
    const startY = doc.y;
    doc.rect(50, startY, doc.page.width - 100, 0).strokeColor('#e2e8f0');

    doc.fillColor(COLORS.violet).fontSize(10).font('Helvetica-Bold')
      .text(`#${rec.priority || 1}  ·  ${(rec.confidence || 'medium').toUpperCase()} CONFIDENCE  ·  ${(rec.effort || 'medium').replace('_', ' ').toUpperCase()}`, 50, startY + 8);

    doc.fillColor(COLORS.text).fontSize(13).font('Helvetica-Bold').text(rec.action || '', 50, doc.y + 2, { width: doc.page.width - 100 });
    doc.moveDown(0.3);

    if (rec.evidence) {
      doc.fillColor(COLORS.slate).fontSize(9).font('Helvetica-Oblique').text(`Evidence: ${rec.evidence}`, { width: doc.page.width - 100 });
    }
    if (rec.expected_impact) {
      doc.fillColor(COLORS.emerald).fontSize(10).font('Helvetica-Bold').text(`Expected impact: ${rec.expected_impact}`);
    }
    if (rec.tradeoff) {
      doc.fillColor(COLORS.amber).fontSize(9).font('Helvetica-Oblique').text(`Trade-off: ${rec.tradeoff}`, { width: doc.page.width - 100 });
    }

    doc.moveDown(1);
  });
}

async function agentTraceSection(doc, agent) {
  sectionTitle(doc, `Agent Trace — ${agent._persona_name || 'Agent'}`);

  doc.fillColor(COLORS.slate).fontSize(10)
    .text(`Archetype: ${agent._persona_archetype_label || '?'}  ·  Outcome: ${agent.outcome || '?'}  ·  Steps: ${agent.total_steps ?? (agent.steps?.length ?? 0)}`);
  doc.moveDown(0.5);

  if (agent.outcome_reason) {
    doc.fillColor(COLORS.text).fontSize(11).font('Helvetica-Bold').text('Decision:').moveDown(0.2);
    doc.fillColor(COLORS.text).fontSize(10).font('Helvetica').text(agent.outcome_reason, { width: doc.page.width - 100 });
    doc.moveDown(0.5);
  }

  if (agent.emotional_arc) {
    doc.fillColor(COLORS.slate).fontSize(9).font('Helvetica-Oblique').text(`Emotional arc: ${agent.emotional_arc}`);
    doc.moveDown(0.3);
  }

  // Show first screenshot if available
  const stepsWithShots = (agent.steps || []).filter(s => s.screenshot_key);
  if (stepsWithShots.length > 0) {
    const firstShot = stepsWithShots[0];
    try {
      const fs = require('fs');
      const p = storage.localPath(firstShot.screenshot_key);
      if (fs.existsSync(p)) {
        const availW = doc.page.width - 100;
        doc.image(p, 50, doc.y, { fit: [availW, 300], align: 'center' });
        doc.y += 310;
        doc.fillColor(COLORS.dim).fontSize(8).text(`Step ${firstShot.step_index}: ${firstShot.url_after || ''}`);
      }
    } catch (e) { /* skip */ }
  }

  // Step list (text only, summarized)
  doc.moveDown(0.5);
  doc.fillColor(COLORS.text).fontSize(11).font('Helvetica-Bold').text('Journey summary:').moveDown(0.2);
  (agent.steps || []).slice(0, 12).forEach(s => {
    const act = s.action?.toUpperCase() || 'STEP';
    doc.fillColor(COLORS.slate).fontSize(8).font('Helvetica')
      .text(`  step ${s.step_index}  ${act}  ${s.result_ok === false ? '✗' : ''}  ${(s.reasoning || '').substring(0, 140)}`, { width: doc.page.width - 100 });
  });
}

function methodologySection(doc, sim) {
  sectionTitle(doc, 'Methodology');

  doc.fillColor(COLORS.text).fontSize(10).font('Helvetica').text(
    'Each synthetic agent is instantiated with: (1) a decision archetype drawn from a curated behavioral taxonomy, (2) real-world pain points retrieved from public community sources (Reddit, IndieHackers, G2, LinkedIn), (3) demographic and personality traits randomized within archetype bounds, and (4) first-person voice matching the target audience.',
    { width: doc.page.width - 100, lineGap: 2 });
  doc.moveDown(0.8);
  doc.fillColor(COLORS.text).text(
    'Agents navigate the live product using an instrumented Chromium browser (Playwright). Human-like timing, scroll patterns, typing cadence with typos, and authentic decision latency are applied. At each step, the agent perceives the page structure, reasons through its persona, updates its affective state, and chooses a next action (scroll, click, type, submit, back, wait, abandon, or goal_achieved).',
    { width: doc.page.width - 100, lineGap: 2 });
  doc.moveDown(0.8);
  doc.fillColor(COLORS.text).text(
    'Metrics are computed deterministically from recorded journeys. Insights are synthesized by an LLM constrained to the measured data (no hallucination of numbers). Confidence intervals use a normal approximation to the binomial proportion; predictions should be validated via live A/B testing at launch.',
    { width: doc.page.width - 100, lineGap: 2 });

  doc.moveDown(1);
  doc.fillColor(COLORS.dim).fontSize(8).font('Helvetica-Oblique').text(
    'This report is a pre-launch directional prediction, not a statistical ground truth. Decisions based on this data should account for the confidence interval and the sample size warning (if present). Synthetic Users maintains a calibration loop that compares predictions against real post-launch data to improve future forecasts.',
    { width: doc.page.width - 100, lineGap: 2 });
}

function drawMultiColTable(doc, headers, rows) {
  const cols = headers.length;
  const colW = (doc.page.width - 100) / cols;
  const rowH = 22;
  let y = doc.y;

  // Header
  doc.rect(50, y, doc.page.width - 100, rowH).fill(COLORS.violet);
  headers.forEach((h, i) => {
    doc.fillColor('#ffffff').fontSize(9).font('Helvetica-Bold').text(h, 60 + i * colW, y + 7, { width: colW - 10 });
  });
  y += rowH;

  rows.forEach((row, ri) => {
    if (ri % 2 === 0) {
      doc.rect(50, y, doc.page.width - 100, rowH).fill('#f8fafc');
    }
    row.forEach((cell, i) => {
      doc.fillColor(COLORS.text).fontSize(9).font('Helvetica').text(String(cell), 60 + i * colW, y + 7, { width: colW - 10 });
    });
    y += rowH;
  });
  doc.y = y + 8;
}

function truncateUrl(u, max) {
  if (!u) return '';
  if (u.length <= max) return u;
  return u.substring(0, max - 1) + '…';
}

module.exports = { generateReport };
