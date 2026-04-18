/**
 * Meliá Pitch Deck Builder — commercial angle (CRO/CMO)
 * Focus: revenue uplift, segment insights, speed-to-decision.
 *
 * Output: Synthetic_Users_Melia_Pitch_Deck.pptx at repo root.
 */

const path = require('path');
const fs = require('fs');
const pptxgen = require(path.join(process.env.APPDATA, 'npm', 'node_modules', 'pptxgenjs'));

// ─── Brand palette (Meliá-aligned) ───────────────────────────────
const BRAND = '8B1538';      // Meliá burgundy
const ACCENT = '2C3E50';     // Deep navy
const GOLD = 'B8935A';       // Warm gold
const CREAM = 'F5F1E8';      // Light cream background
const INK = '1A1A1A';        // Near-black text
const SUBTLE = '6B6B6B';     // Subtle gray
const WHITE = 'FFFFFF';
const SUCCESS = '1A7F37';
const DANGER = 'B91C1C';
const ACCENT_LIGHT = 'E8EBF0';

// ─── Initialize ──────────────────────────────────────────────────
const pres = new pptxgen();
pres.title = 'Synthetic Users × Meliá — Revenue Intelligence Pitch';
pres.company = 'Synthetic Users';
pres.author = 'Synthetic Users';
pres.layout = 'LAYOUT_WIDE'; // 13.333 × 7.5 inches

// ─── SLIDE 1: COVER ──────────────────────────────────────────────
{
  const s = pres.addSlide();
  s.background = { color: BRAND };

  // Thin gold bar top
  s.addShape('rect', { x: 0, y: 0, w: 13.333, h: 0.15, fill: { color: GOLD } });

  // Tagline top
  s.addText('CONFIDENTIAL · FOR MELIÁ HOTELS INTERNATIONAL · APRIL 2026', {
    x: 0.6, y: 0.5, w: 12, h: 0.3, fontSize: 10, color: GOLD, charSpacing: 4, bold: true, fontFace: 'Calibri',
  });

  // Main title
  s.addText('Revenue decisions, predicted', {
    x: 0.6, y: 2.0, w: 12, h: 1.5, fontSize: 54, color: WHITE, bold: true, fontFace: 'Georgia',
  });
  s.addText('before you deploy them.', {
    x: 0.6, y: 2.9, w: 12, h: 1.2, fontSize: 54, color: GOLD, italic: true, fontFace: 'Georgia',
  });

  // Subtitle
  s.addText('Synthetic Users × Meliá Hotels International', {
    x: 0.6, y: 4.8, w: 12, h: 0.5, fontSize: 22, color: WHITE, fontFace: 'Calibri',
  });
  s.addText('Proven accuracy: F1 91.4% against 572 real Villa Le Blanc reviews.', {
    x: 0.6, y: 5.3, w: 12, h: 0.5, fontSize: 16, color: 'E5DFD3', italic: true, fontFace: 'Calibri',
  });

  // Footer
  s.addText('Abril 2026 · Rafa Ferrer · Synthetic Users', {
    x: 0.6, y: 6.8, w: 12, h: 0.3, fontSize: 11, color: GOLD, fontFace: 'Calibri',
  });
}

// ─── SLIDE 2: THE REVENUE GAP ────────────────────────────────────
{
  const s = pres.addSlide();
  s.background = { color: CREAM };

  // Left side — title + framing
  s.addShape('rect', { x: 0, y: 0, w: 5.5, h: 7.5, fill: { color: BRAND } });

  s.addText('THE REVENUE GAP', {
    x: 0.5, y: 0.6, w: 4.5, h: 0.4, fontSize: 12, color: GOLD, charSpacing: 4, bold: true,
  });
  s.addText('Every CRO is running revenue on 90-day-old data.', {
    x: 0.5, y: 1.1, w: 4.8, h: 2.8, fontSize: 30, color: WHITE, bold: true, fontFace: 'Georgia',
  });
  s.addText(
    'Guest research moves on quarterly cycles. Pricing experiments take a season to validate. ' +
    'Property refurbs commit capex before anyone knows how guests will react. ' +
    'The gap between decision and evidence is where margin leaks.',
    { x: 0.5, y: 4.6, w: 4.8, h: 2.4, fontSize: 14, color: 'E5DFD3', fontFace: 'Calibri' }
  );

  // Right side — 3 pain points with stats
  const paintPoints = [
    { stat: '12 weeks', label: 'Average time from research brief to actionable panel result' },
    { stat: '90 days', label: 'Delay between guest stay and NPS signal reaching ops teams' },
    { stat: '€1.2M', label: 'Estimated RevPAR risk per 100-room property per year from blind pricing/ops decisions' },
  ];

  let y = 0.9;
  for (const p of paintPoints) {
    // Stat card
    s.addShape('rect', { x: 6.2, y, w: 6.5, h: 1.9, fill: { color: WHITE }, line: { color: 'E5DFD3', width: 1 } });
    s.addShape('rect', { x: 6.2, y, w: 0.15, h: 1.9, fill: { color: GOLD } });

    s.addText(p.stat, {
      x: 6.5, y: y + 0.2, w: 3.0, h: 0.9, fontSize: 40, bold: true, color: BRAND, fontFace: 'Georgia',
    });
    s.addText(p.label, {
      x: 6.5, y: y + 1.0, w: 6.0, h: 0.8, fontSize: 12, color: INK, fontFace: 'Calibri',
    });

    y += 2.1;
  }
}

// ─── SLIDE 3: OUR PROPOSITION ────────────────────────────────────
{
  const s = pres.addSlide();
  s.background = { color: WHITE };

  s.addText('OUR PROPOSITION', {
    x: 0.6, y: 0.5, w: 12, h: 0.3, fontSize: 12, color: BRAND, charSpacing: 4, bold: true,
  });
  s.addText('Revenue intelligence, on a 48-hour cycle.', {
    x: 0.6, y: 0.9, w: 12, h: 1.0, fontSize: 40, bold: true, color: INK, fontFace: 'Georgia',
  });
  s.addText(
    'We simulate the full guest journey — arrival, room, F&B, amenities, checkout, review — ' +
    'for hundreds of calibrated synthetic guests. You get segment-level revenue insights in days, not quarters.',
    { x: 0.6, y: 1.8, w: 12, h: 1.0, fontSize: 16, color: SUBTLE, italic: true, fontFace: 'Calibri' }
  );

  // Three pillars — icons in circles
  const pillars = [
    {
      title: 'Revenue uplift',
      body: 'Predict how a rate change, loyalty shift, or refurb affects RevPAR — segment by segment — before deploying capex.',
      color: BRAND,
    },
    {
      title: 'Segment insights',
      body: 'Decompose satisfaction and friction by market, archetype, and booking channel. See which €1 of investment moves which segment.',
      color: ACCENT,
    },
    {
      title: 'Speed to decision',
      body: 'From brief to actionable report in 2 weeks. Re-run experiments in 48 hours. Never wait for the next quarterly panel.',
      color: GOLD,
    },
  ];

  let x = 0.6;
  for (let i = 0; i < pillars.length; i++) {
    const p = pillars[i];
    // Circle with number
    s.addShape('ellipse', { x, y: 3.3, w: 0.7, h: 0.7, fill: { color: p.color } });
    s.addText(`${i + 1}`, {
      x, y: 3.3, w: 0.7, h: 0.7, fontSize: 22, bold: true, color: WHITE, align: 'center', valign: 'middle', fontFace: 'Georgia',
    });
    // Title
    s.addText(p.title, {
      x: x + 0.9, y: 3.35, w: 3.5, h: 0.5, fontSize: 20, bold: true, color: INK, fontFace: 'Georgia',
    });
    // Body
    s.addText(p.body, {
      x, y: 4.3, w: 4.0, h: 2.2, fontSize: 12, color: SUBTLE, fontFace: 'Calibri',
    });
    x += 4.3;
  }

  // Bottom strip — proof
  s.addShape('rect', { x: 0, y: 6.8, w: 13.333, h: 0.7, fill: { color: BRAND } });
  s.addText('Proof point — next slide: F1 91.4% accuracy on Villa Le Blanc backtested against 572 real reviews.', {
    x: 0.6, y: 6.85, w: 12.2, h: 0.6, fontSize: 14, color: WHITE, italic: true, bold: true, align: 'center', valign: 'middle',
  });
}

// ─── SLIDE 4: HEADLINE PROOF — F1 91.4% ──────────────────────────
{
  const s = pres.addSlide();
  s.background = { color: ACCENT };

  s.addText('ACCURACY PROOF', {
    x: 0.6, y: 0.5, w: 12, h: 0.3, fontSize: 12, color: GOLD, charSpacing: 4, bold: true,
  });
  s.addText('We backtested our model against real reviews.', {
    x: 0.6, y: 0.95, w: 12, h: 0.6, fontSize: 28, color: WHITE, bold: true, fontFace: 'Georgia',
  });

  // Giant stat
  s.addText('F1 = 91.4%', {
    x: 0.6, y: 2.0, w: 12, h: 2.4, fontSize: 160, color: GOLD, bold: true, align: 'center', fontFace: 'Georgia',
  });

  s.addText('Theme detection precision × recall against 572 real Villa Le Blanc reviews', {
    x: 0.6, y: 4.4, w: 12, h: 0.5, fontSize: 18, color: WHITE, align: 'center', italic: true, fontFace: 'Calibri',
  });

  // 4 support stats at the bottom
  const supportStats = [
    { num: '100%', label: 'Theme recall — every theme real guests mention, we surface' },
    { num: '84%', label: 'Theme precision — our predictions map to real themes' },
    { num: '572', label: 'Real reviews in backtest corpus (TripAdvisor + Booking + Expedia + 3 pro)' },
    { num: '22', label: 'Cross-archetype themes catalogued and matched' },
  ];

  let x = 0.6;
  for (const st of supportStats) {
    s.addShape('rect', { x, y: 5.3, w: 3.0, h: 1.6, fill: { color: '1E2941' }, line: { color: GOLD, width: 1 } });
    s.addText(st.num, {
      x, y: 5.35, w: 3.0, h: 0.7, fontSize: 38, color: GOLD, bold: true, align: 'center', fontFace: 'Georgia',
    });
    s.addText(st.label, {
      x: x + 0.15, y: 6.05, w: 2.7, h: 0.9, fontSize: 10, color: 'E5DFD3', align: 'center', fontFace: 'Calibri',
    });
    x += 3.15;
  }

  // Footer
  s.addText('Source: backtest_villa_le_blanc_report.md · Reproducible: node scripts/backtest_villa_le_blanc.js', {
    x: 0.6, y: 7.1, w: 12, h: 0.3, fontSize: 9, color: 'E5DFD3', italic: true, align: 'center',
  });
}

// ─── SLIDE 5: CASE STUDY — VILLA LE BLANC FINDINGS ───────────────
{
  const s = pres.addSlide();
  s.background = { color: WHITE };

  s.addText('CASE STUDY · VILLA LE BLANC', {
    x: 0.6, y: 0.4, w: 12, h: 0.3, fontSize: 12, color: BRAND, charSpacing: 4, bold: true,
  });
  s.addText('50 synthetic guests. 8 archetypes. 36 revenue opportunities identified.', {
    x: 0.6, y: 0.8, w: 12, h: 0.7, fontSize: 24, color: INK, bold: true, fontFace: 'Georgia',
  });

  // Table of findings by archetype
  const tableHeader = [
    { text: 'Archetype', options: { bold: true, color: WHITE, fill: { color: BRAND }, align: 'left' } },
    { text: 'NPS sim', options: { bold: true, color: WHITE, fill: { color: BRAND }, align: 'center' } },
    { text: 'Avg spend', options: { bold: true, color: WHITE, fill: { color: BRAND }, align: 'right' } },
    { text: 'Revenue opportunity identified', options: { bold: true, color: WHITE, fill: { color: BRAND }, align: 'left' } },
  ];

  const rows = [
    [
      { text: 'Luxury Seeker', options: { bold: true } },
      { text: '+45', options: { color: SUCCESS, bold: true, align: 'center' } },
      { text: '€416', options: { align: 'right' } },
      { text: 'Core segment — protect via brand-signature touches', options: { color: SUBTLE } },
    ],
    [
      { text: 'Honeymooner', options: { bold: true } },
      { text: '−13', options: { color: DANGER, bold: true, align: 'center' } },
      { text: '€934', options: { align: 'right', bold: true, color: GOLD } },
      { text: 'Highest spender, but dissatisfied. Fix personalization → +40% retention', options: { color: SUBTLE } },
    ],
    [
      { text: 'Family Vacationer', options: { bold: true } },
      { text: '−48', options: { color: DANGER, bold: true, align: 'center' } },
      { text: '€201', options: { align: 'right' } },
      { text: 'Kids menu + club capacity are friction. Low capex, high NPS impact', options: { color: SUBTLE } },
    ],
    [
      { text: 'Digital Nomad', options: { bold: true } },
      { text: '−66', options: { color: DANGER, bold: true, align: 'center' } },
      { text: '€23', options: { align: 'right' } },
      { text: 'Wifi SLA contract → unlock 14-night+ stays, RevPAR compound', options: { color: SUBTLE } },
    ],
    [
      { text: 'Business Traveler', options: { bold: true } },
      { text: '−46', options: { color: DANGER, bold: true, align: 'center' } },
      { text: '€48', options: { align: 'right' } },
      { text: 'Executive Dinner La Sal pre-reserve: +€200-400 ancillary per stay', options: { color: SUBTLE } },
    ],
    [
      { text: 'Loyalty Maximizer', options: { bold: true } },
      { text: '−47', options: { color: DANGER, bold: true, align: 'center' } },
      { text: '€108', options: { align: 'right' } },
      { text: 'Tier recognition protocol → churn risk reduced by 25pp', options: { color: SUBTLE } },
    ],
  ];

  s.addTable([tableHeader, ...rows], {
    x: 0.6, y: 1.8, w: 12.1,
    colW: [2.2, 1.4, 1.4, 7.1],
    fontSize: 12, fontFace: 'Calibri',
    rowH: 0.55,
    border: { pt: 1, color: 'E5DFD3' },
  });

  // Bottom insight
  s.addShape('rect', { x: 0.6, y: 6.0, w: 12.1, h: 1.2, fill: { color: CREAM }, line: { color: GOLD, width: 1 } });
  s.addShape('rect', { x: 0.6, y: 6.0, w: 0.12, h: 1.2, fill: { color: GOLD } });
  s.addText('KEY INSIGHT', {
    x: 0.9, y: 6.1, w: 3, h: 0.3, fontSize: 10, color: GOLD, charSpacing: 4, bold: true,
  });
  s.addText(
    'The property works for 1 of 8 segments (Luxury Seeker). Closing the gap on ' +
    'Honeymoon + Loyalty + Digital Nomad alone represents an estimated €1.8-2.4M annual RevPAR uplift.',
    { x: 0.9, y: 6.4, w: 11.6, h: 0.8, fontSize: 13, color: INK, italic: true, fontFace: 'Georgia' }
  );
}

// ─── SLIDE 6: SEGMENT REVENUE MATRIX ─────────────────────────────
{
  const s = pres.addSlide();
  s.background = { color: WHITE };

  s.addText('SEGMENT REVENUE MATRIX', {
    x: 0.6, y: 0.4, w: 12, h: 0.3, fontSize: 12, color: BRAND, charSpacing: 4, bold: true,
  });
  s.addText('Every segment has a different payoff curve.', {
    x: 0.6, y: 0.8, w: 12, h: 0.7, fontSize: 26, color: INK, bold: true, fontFace: 'Georgia',
  });
  s.addText('Our simulation quantifies both ticket size AND fixability per archetype. You invest where both are high.',
    { x: 0.6, y: 1.55, w: 12, h: 0.5, fontSize: 14, color: SUBTLE, italic: true, fontFace: 'Calibri' });

  // 2x2 matrix — High ticket / Low ticket × High fixability / Low fixability
  const boxW = 5.5, boxH = 2.4;
  const xLeft = 1.5, xRight = 7.0;
  const yTop = 2.4, yBottom = 4.9;

  // Quadrant headings (cross axes labels)
  s.addText('HIGH AVG SPEND', { x: 0, y: 2.4, w: 1.4, h: 2.4, fontSize: 11, bold: true, color: BRAND, align: 'center', valign: 'middle', charSpacing: 2 });
  s.addText('LOW AVG SPEND', { x: 0, y: 4.9, w: 1.4, h: 2.4, fontSize: 11, bold: true, color: BRAND, align: 'center', valign: 'middle', charSpacing: 2 });
  s.addText('← FIXABILITY HARD', { x: xLeft, y: 7.35, w: boxW, h: 0.3, fontSize: 10, color: SUBTLE, align: 'center', charSpacing: 2 });
  s.addText('FIXABILITY EASY →', { x: xRight, y: 7.35, w: boxW, h: 0.3, fontSize: 10, color: SUBTLE, align: 'center', charSpacing: 2 });

  // Quadrants
  // Q1: High spend / Hard to fix — "Protect & monitor"
  s.addShape('rect', { x: xLeft, y: yTop, w: boxW, h: boxH, fill: { color: CREAM }, line: { color: 'E5DFD3', width: 2 } });
  s.addText('PROTECT & MONITOR', { x: xLeft + 0.3, y: yTop + 0.3, w: boxW - 0.3, h: 0.4, fontSize: 12, bold: true, color: GOLD, charSpacing: 2 });
  s.addText('Luxury Seeker', { x: xLeft + 0.3, y: yTop + 0.75, w: boxW - 0.3, h: 0.5, fontSize: 22, bold: true, color: INK, fontFace: 'Georgia' });
  s.addText('€416 avg · NPS +45', { x: xLeft + 0.3, y: yTop + 1.3, w: boxW - 0.3, h: 0.3, fontSize: 13, color: SUBTLE });
  s.addText('Core segment. Slow, expensive to dial up. Track for drift.', { x: xLeft + 0.3, y: yTop + 1.7, w: boxW - 0.3, h: 0.6, fontSize: 12, color: INK });

  // Q2: High spend / Easy to fix — "⭐ GOLDEN OPPORTUNITY"
  s.addShape('rect', { x: xRight, y: yTop, w: boxW, h: boxH, fill: { color: BRAND }, line: { color: GOLD, width: 3 } });
  s.addText('⭐ GOLDEN OPPORTUNITY', { x: xRight + 0.3, y: yTop + 0.3, w: boxW - 0.3, h: 0.4, fontSize: 12, bold: true, color: GOLD, charSpacing: 2 });
  s.addText('Honeymooner', { x: xRight + 0.3, y: yTop + 0.75, w: boxW - 0.3, h: 0.5, fontSize: 22, bold: true, color: WHITE, fontFace: 'Georgia' });
  s.addText('€934 avg · NPS −13', { x: xRight + 0.3, y: yTop + 1.3, w: boxW - 0.3, h: 0.3, fontSize: 13, color: 'E5DFD3' });
  s.addText('Highest spender, easy personalization fix. 40%+ retention uplift potential.', { x: xRight + 0.3, y: yTop + 1.7, w: boxW - 0.3, h: 0.6, fontSize: 12, color: WHITE });

  // Q3: Low spend / Hard to fix — "Reconsider position"
  s.addShape('rect', { x: xLeft, y: yBottom, w: boxW, h: boxH, fill: { color: 'F5F5F5' }, line: { color: 'E5DFD3', width: 2 } });
  s.addText('RECONSIDER POSITION', { x: xLeft + 0.3, y: yBottom + 0.3, w: boxW - 0.3, h: 0.4, fontSize: 12, bold: true, color: SUBTLE, charSpacing: 2 });
  s.addText('Budget Optimizer', { x: xLeft + 0.3, y: yBottom + 0.75, w: boxW - 0.3, h: 0.5, fontSize: 22, bold: true, color: INK, fontFace: 'Georgia' });
  s.addText('€25 avg · NPS −40', { x: xLeft + 0.3, y: yBottom + 1.3, w: boxW - 0.3, h: 0.3, fontSize: 13, color: SUBTLE });
  s.addText('Low payoff. De-prioritize or shift to a different property.', { x: xLeft + 0.3, y: yBottom + 1.7, w: boxW - 0.3, h: 0.6, fontSize: 12, color: INK });

  // Q4: Low spend / Easy to fix — "Quick win"
  s.addShape('rect', { x: xRight, y: yBottom, w: boxW, h: boxH, fill: { color: ACCENT }, line: { color: 'E5DFD3', width: 2 } });
  s.addText('QUICK WIN', { x: xRight + 0.3, y: yBottom + 0.3, w: boxW - 0.3, h: 0.4, fontSize: 12, bold: true, color: GOLD, charSpacing: 2 });
  s.addText('Digital Nomad', { x: xRight + 0.3, y: yBottom + 0.75, w: boxW - 0.3, h: 0.5, fontSize: 22, bold: true, color: WHITE, fontFace: 'Georgia' });
  s.addText('€23 avg · NPS −66 · Wifi fix', { x: xRight + 0.3, y: yBottom + 1.3, w: boxW - 0.3, h: 0.3, fontSize: 13, color: 'E5DFD3' });
  s.addText('Wifi SLA unlocks 14-night+ LoS. Low capex, compound effect.', { x: xRight + 0.3, y: yBottom + 1.7, w: boxW - 0.3, h: 0.6, fontSize: 12, color: WHITE });
}

// ─── SLIDE 7: SPEED-TO-DECISION ─────────────────────────────────
{
  const s = pres.addSlide();
  s.background = { color: WHITE };

  s.addText('SPEED-TO-DECISION', {
    x: 0.6, y: 0.4, w: 12, h: 0.3, fontSize: 12, color: BRAND, charSpacing: 4, bold: true,
  });
  s.addText('14 days vs 12 weeks vs 6 months.', {
    x: 0.6, y: 0.85, w: 12, h: 0.7, fontSize: 34, color: INK, bold: true, fontFace: 'Georgia',
  });
  s.addText('The same question answered with three different research methods. We are 6-12× faster at 3-5× lower cost.',
    { x: 0.6, y: 1.7, w: 12, h: 0.5, fontSize: 14, color: SUBTLE, italic: true, fontFace: 'Calibri' });

  // Comparison: 3 columns (us, panel, internal)
  const colW = 3.8, colH = 4.6;
  const cols = [
    {
      title: 'SYNTHETIC USERS',
      subtitle: 'Our engine',
      time: '14 DAYS',
      cost: '€18K',
      scope: '50-500 synthetic guests',
      pros: ['Re-run in 48h', 'Segment-level precision', 'Calibrated vs real corpus (F1 91.4%)', 'Reproducible & auditable'],
      cons: ['Validated range: 5-star hospitality', 'Claude Opus production recommended'],
      highlight: true,
    },
    {
      title: 'TRADITIONAL PANEL',
      subtitle: 'Qualtrics / Dscout / in-house',
      time: '12 WEEKS',
      cost: '€50-80K',
      scope: '50-100 real respondents',
      pros: ['Real human voices', 'Deep qualitative'],
      cons: ['Panel self-selection bias', '12-week feedback loop', 'Fixed after brief locks', 'Cannot re-run experiments'],
      highlight: false,
    },
    {
      title: 'INTERNAL MEASUREMENT',
      subtitle: 'Post-stay NPS + CSAT',
      time: '6 MONTHS',
      cost: 'Sunk operational',
      scope: 'Actual guests post-factum',
      pros: ['Ground truth (eventually)', 'No additional cost'],
      cons: ['Post-facto only', 'No pre-launch validation', '90-day lag to signal', 'No counterfactual'],
      highlight: false,
    },
  ];

  let x = 0.6;
  for (const c of cols) {
    const fillColor = c.highlight ? BRAND : WHITE;
    const textColor = c.highlight ? WHITE : INK;
    const subtleColor = c.highlight ? 'E5DFD3' : SUBTLE;
    const border = c.highlight ? { color: GOLD, width: 3 } : { color: 'E5DFD3', width: 1 };

    s.addShape('rect', { x, y: 2.3, w: colW, h: colH, fill: { color: fillColor }, line: border });

    s.addText(c.title, { x: x + 0.25, y: 2.45, w: colW - 0.5, h: 0.35, fontSize: 11, bold: true, color: c.highlight ? GOLD : BRAND, charSpacing: 3 });
    s.addText(c.subtitle, { x: x + 0.25, y: 2.8, w: colW - 0.5, h: 0.3, fontSize: 11, color: subtleColor, italic: true });

    s.addText(c.time, { x: x + 0.25, y: 3.2, w: colW - 0.5, h: 0.6, fontSize: 32, bold: true, color: c.highlight ? GOLD : BRAND, fontFace: 'Georgia' });
    s.addText(`${c.cost} · ${c.scope}`, { x: x + 0.25, y: 3.85, w: colW - 0.5, h: 0.3, fontSize: 11, color: subtleColor });

    // Pros
    let proY = 4.3;
    for (const pro of c.pros) {
      s.addText('✓', { x: x + 0.25, y: proY, w: 0.3, h: 0.25, fontSize: 12, bold: true, color: c.highlight ? GOLD : SUCCESS });
      s.addText(pro, { x: x + 0.55, y: proY, w: colW - 0.85, h: 0.3, fontSize: 10, color: textColor });
      proY += 0.32;
    }
    // Cons
    for (const con of c.cons) {
      s.addText('×', { x: x + 0.25, y: proY, w: 0.3, h: 0.25, fontSize: 12, bold: true, color: c.highlight ? 'E5DFD3' : DANGER });
      s.addText(con, { x: x + 0.55, y: proY, w: colW - 0.85, h: 0.3, fontSize: 10, color: subtleColor });
      proY += 0.32;
    }
    x += colW + 0.1;
  }
}

// ─── SLIDE 8: 4 REVENUE QUESTIONS WE ANSWER ─────────────────────
{
  const s = pres.addSlide();
  s.background = { color: CREAM };

  s.addText('4 REVENUE QUESTIONS WE ANSWER', {
    x: 0.6, y: 0.4, w: 12, h: 0.3, fontSize: 12, color: BRAND, charSpacing: 4, bold: true,
  });
  s.addText('Pick any. Same engine. Different output.', {
    x: 0.6, y: 0.85, w: 12, h: 0.7, fontSize: 30, color: INK, bold: true, fontFace: 'Georgia',
  });

  const questions = [
    {
      num: '01',
      title: 'Stay Experience',
      question: '"Where is our property losing NPS — and how much revenue does that cost us?"',
      output: 'Full 50-page report with friction ranked, per-segment NPS, and uplift projections',
      color: BRAND,
    },
    {
      num: '02',
      title: 'Booking Engine Test',
      question: '"Why are prospects abandoning our direct booking funnel — and at which step?"',
      output: 'Conversion funnel with drop-off reasons by market, device, and price variant',
      color: ACCENT,
    },
    {
      num: '03',
      title: 'Rate Strategy Test',
      question: '"If we raise ADR 12%, which segments walk and which stay?"',
      output: 'Demand curve per segment + revenue-optimum variant identification',
      color: GOLD,
    },
    {
      num: '04',
      title: 'Loyalty Change Test',
      question: '"How will our members react to the new earning rate structure?"',
      output: 'Churn risk by tier × market, tier migration patterns, competitor switch probability',
      color: SUCCESS,
    },
  ];

  // 2x2 grid
  const boxW = 5.9, boxH = 2.6;
  const positions = [
    { x: 0.6, y: 2.0 },
    { x: 6.8, y: 2.0 },
    { x: 0.6, y: 4.8 },
    { x: 6.8, y: 4.8 },
  ];

  for (let i = 0; i < questions.length; i++) {
    const q = questions[i];
    const pos = positions[i];
    s.addShape('rect', { x: pos.x, y: pos.y, w: boxW, h: boxH, fill: { color: WHITE }, line: { color: 'E5DFD3', width: 1 } });
    // Colored bar
    s.addShape('rect', { x: pos.x, y: pos.y, w: 0.12, h: boxH, fill: { color: q.color } });

    // Number
    s.addText(q.num, { x: pos.x + 0.25, y: pos.y + 0.2, w: 0.8, h: 0.4, fontSize: 14, bold: true, color: q.color, fontFace: 'Georgia' });
    // Title
    s.addText(q.title, { x: pos.x + 0.25, y: pos.y + 0.55, w: boxW - 0.4, h: 0.5, fontSize: 22, bold: true, color: INK, fontFace: 'Georgia' });
    // Question
    s.addText(q.question, { x: pos.x + 0.25, y: pos.y + 1.15, w: boxW - 0.4, h: 0.7, fontSize: 13, color: INK, italic: true, fontFace: 'Georgia' });
    // Output
    s.addText('→ ' + q.output, { x: pos.x + 0.25, y: pos.y + 1.9, w: boxW - 0.4, h: 0.6, fontSize: 11, color: SUBTLE });
  }
}

// ─── SLIDE 9: METHODOLOGY IN 60 SEC ─────────────────────────────
{
  const s = pres.addSlide();
  s.background = { color: WHITE };

  s.addText('METHODOLOGY · 60 SECONDS', {
    x: 0.6, y: 0.4, w: 12, h: 0.3, fontSize: 12, color: BRAND, charSpacing: 4, bold: true,
  });
  s.addText('6 calibration layers. 30+ cited sources. Fully auditable.', {
    x: 0.6, y: 0.85, w: 12, h: 0.7, fontSize: 28, color: INK, bold: true, fontFace: 'Georgia',
  });

  const layers = [
    { name: 'Cultural layer', src: 'Hofstede 6-D cultural dimensions (30 countries)' },
    { name: 'Booking context', src: 'Phocuswright European Consumer 2024 + channel data' },
    { name: 'External context', src: 'AENA traffic, Eurostat tourism, seasonal weather models' },
    { name: 'Staff continuity', src: 'Named entities persist across stages, rapport accumulates' },
    { name: 'Post-stay dynamics', src: 'Kahneman peak-end rule + Baumeister negativity bias' },
    { name: 'Property calibration', src: 'Real review corpus per property (Villa Le Blanc: 572 reviews)' },
  ];

  let y = 1.9;
  for (let i = 0; i < layers.length; i++) {
    const l = layers[i];
    // Number circle
    s.addShape('ellipse', { x: 0.6, y, w: 0.6, h: 0.6, fill: { color: BRAND } });
    s.addText(`${i + 1}`, { x: 0.6, y, w: 0.6, h: 0.6, fontSize: 18, bold: true, color: WHITE, align: 'center', valign: 'middle', fontFace: 'Georgia' });

    s.addText(l.name, { x: 1.4, y: y + 0.02, w: 4, h: 0.5, fontSize: 16, bold: true, color: INK, fontFace: 'Georgia' });
    s.addText(l.src, { x: 5.5, y: y + 0.1, w: 7, h: 0.5, fontSize: 12, color: SUBTLE, italic: true });

    y += 0.7;
  }

  // Bottom strip — sources
  s.addShape('rect', { x: 0.6, y: 6.4, w: 12.1, h: 0.8, fill: { color: ACCENT_LIGHT }, line: { color: ACCENT, width: 1 } });
  s.addText('CITED SOURCES', { x: 0.85, y: 6.5, w: 2.5, h: 0.25, fontSize: 10, bold: true, color: ACCENT, charSpacing: 3 });
  s.addText(
    'FRONTUR · EGATUR · ONS · AENA · Phocuswright · Skift · Cornell Hospitality Quarterly · ' +
    'Hofstede Insights · HolidayCheck · FUR Reiseanalyse · Statista · MARA 2025 · QuestionPro 2025 · Springer ENTER',
    { x: 0.85, y: 6.8, w: 11.6, h: 0.4, fontSize: 10, color: INK, italic: true }
  );
}

// ─── SLIDE 10: PRICING ───────────────────────────────────────────
{
  const s = pres.addSlide();
  s.background = { color: WHITE };

  s.addText('PRICING & ENGAGEMENT', {
    x: 0.6, y: 0.4, w: 12, h: 0.3, fontSize: 12, color: BRAND, charSpacing: 4, bold: true,
  });
  s.addText('Three ways to start. Low-commitment first.', {
    x: 0.6, y: 0.85, w: 12, h: 0.7, fontSize: 30, color: INK, bold: true, fontFace: 'Georgia',
  });

  const tiers = [
    {
      name: 'AUDIT',
      tagline: 'Start here',
      price: '€18,000',
      duration: '2 weeks',
      scope: 'One property · One modality · 50 synthetic guests',
      deliverables: ['Single property deep-dive report', 'Revenue opportunity matrix', 'Top 5 friction clusters ranked', 'Model Accuracy Report (backtest)', 'Executive 20-page deck'],
      cta: 'Recommended first step',
      highlighted: true,
    },
    {
      name: 'PILOT',
      tagline: '90-day partnership',
      price: '€85,000',
      duration: '3 months',
      scope: '3 properties · 3 modalities · data access for calibration',
      deliverables: ['3 property audits', 'Booking Engine + Rate Strategy tests', 'Revenue Playbook per property', 'Integration with Opera / Infor PMS (read-only)', 'Calibration loop: predict → measure → refine'],
      cta: 'Where pilot becomes product',
      highlighted: false,
    },
    {
      name: 'ENTERPRISE',
      tagline: 'Full engine subscription',
      price: '€240,000 / year',
      duration: '12 months',
      scope: '25+ properties · all modalities · always-on dashboard',
      deliverables: ['Portfolio-level intelligence', 'Always-on Revenue Playbook dashboard', 'A/B counterfactual engine', 'Quarterly recalibration', 'Strategic advisory'],
      cta: 'For scaled deployment',
      highlighted: false,
    },
  ];

  let x = 0.6;
  const colW = 4.1;
  for (const t of tiers) {
    const fillColor = t.highlighted ? BRAND : WHITE;
    const textColor = t.highlighted ? WHITE : INK;
    const subtleColor = t.highlighted ? 'E5DFD3' : SUBTLE;
    const border = t.highlighted ? { color: GOLD, width: 4 } : { color: 'E5DFD3', width: 1 };

    s.addShape('rect', { x, y: 1.9, w: colW, h: 5.3, fill: { color: fillColor }, line: border });

    // Tagline
    s.addText(t.tagline, { x: x + 0.3, y: 2.05, w: colW - 0.6, h: 0.3, fontSize: 10, bold: true, color: t.highlighted ? GOLD : GOLD, charSpacing: 3 });
    // Name
    s.addText(t.name, { x: x + 0.3, y: 2.35, w: colW - 0.6, h: 0.5, fontSize: 26, bold: true, color: textColor, fontFace: 'Georgia' });
    // Price
    s.addText(t.price, { x: x + 0.3, y: 2.85, w: colW - 0.6, h: 0.7, fontSize: 32, bold: true, color: t.highlighted ? GOLD : BRAND, fontFace: 'Georgia' });
    // Duration
    s.addText(t.duration, { x: x + 0.3, y: 3.55, w: colW - 0.6, h: 0.3, fontSize: 13, italic: true, color: subtleColor });

    // Scope
    s.addText(t.scope, { x: x + 0.3, y: 3.95, w: colW - 0.6, h: 0.5, fontSize: 11, color: textColor, italic: true });

    // Deliverables
    let delY = 4.55;
    for (const d of t.deliverables) {
      s.addText('●', { x: x + 0.3, y: delY, w: 0.2, h: 0.25, fontSize: 8, color: t.highlighted ? GOLD : BRAND });
      s.addText(d, { x: x + 0.55, y: delY - 0.02, w: colW - 0.8, h: 0.3, fontSize: 10, color: textColor });
      delY += 0.28;
    }

    // CTA at bottom
    if (t.highlighted) {
      s.addShape('rect', { x: x + 0.3, y: 6.7, w: colW - 0.6, h: 0.3, fill: { color: GOLD } });
      s.addText('⭐ ' + t.cta, { x: x + 0.3, y: 6.7, w: colW - 0.6, h: 0.3, fontSize: 11, bold: true, color: BRAND, align: 'center', valign: 'middle', charSpacing: 2 });
    } else {
      s.addText(t.cta, { x: x + 0.3, y: 6.75, w: colW - 0.6, h: 0.3, fontSize: 10, italic: true, color: subtleColor, align: 'center' });
    }

    x += colW + 0.15;
  }
}

// ─── SLIDE 11: PROPOSED NEXT STEP ────────────────────────────────
{
  const s = pres.addSlide();
  s.background = { color: ACCENT };

  s.addText('PROPOSED NEXT STEP', {
    x: 0.6, y: 0.5, w: 12, h: 0.3, fontSize: 12, color: GOLD, charSpacing: 4, bold: true,
  });
  s.addText('2-week audit. One property. Clear output.', {
    x: 0.6, y: 0.95, w: 12, h: 1.0, fontSize: 40, color: WHITE, bold: true, fontFace: 'Georgia',
  });

  // Timeline
  const steps = [
    { week: 'DAY 1-2', title: 'Alignment', body: 'Pick the property (Villa Le Blanc or another). Define the question. DPA signature.' },
    { week: 'DAY 3-8', title: 'Calibration + simulation', body: '100 synthetic guests across 8 archetypes. Real-corpus backtest. Multi-modality output.' },
    { week: 'DAY 9-12', title: 'Analysis + synthesis', body: 'Revenue opportunity matrix. Friction cluster ranking. Segment-level uplift projections.' },
    { week: 'DAY 13-14', title: 'Delivery + alignment', body: '60-min executive walkthrough. 20-page deck + raw data. Decision on pilot.' },
  ];

  let y = 2.3;
  for (let i = 0; i < steps.length; i++) {
    const st = steps[i];
    // Week badge
    s.addShape('rect', { x: 0.6, y, w: 1.8, h: 0.9, fill: { color: GOLD } });
    s.addText(st.week, { x: 0.6, y: y + 0.3, w: 1.8, h: 0.35, fontSize: 12, bold: true, color: ACCENT, align: 'center', charSpacing: 2 });
    // Connector line
    if (i < steps.length - 1) {
      s.addShape('line', { x: 1.5, y: y + 0.9, w: 0, h: 0.3, line: { color: GOLD, width: 2 } });
    }
    // Title
    s.addText(st.title, { x: 2.7, y: y + 0.05, w: 10, h: 0.4, fontSize: 20, bold: true, color: WHITE, fontFace: 'Georgia' });
    // Body
    s.addText(st.body, { x: 2.7, y: y + 0.45, w: 10, h: 0.5, fontSize: 13, color: 'E5DFD3' });
    y += 1.15;
  }

  // Bottom — the ask
  s.addShape('rect', { x: 0.6, y: 6.6, w: 12.1, h: 0.7, fill: { color: GOLD } });
  s.addText('THE ASK: €18K · 2 weeks · Pick a property today — we start Monday.', {
    x: 0.6, y: 6.6, w: 12.1, h: 0.7, fontSize: 18, bold: true, color: ACCENT, align: 'center', valign: 'middle', fontFace: 'Georgia',
  });
}

// ─── SLIDE 12: CLOSE ────────────────────────────────────────────
{
  const s = pres.addSlide();
  s.background = { color: BRAND };

  s.addShape('rect', { x: 0, y: 0, w: 13.333, h: 0.15, fill: { color: GOLD } });

  s.addText('Thank you', {
    x: 0.6, y: 1.8, w: 12, h: 1.6, fontSize: 72, color: WHITE, bold: true, fontFace: 'Georgia',
  });
  s.addText('Ready for the questions that matter.', {
    x: 0.6, y: 3.4, w: 12, h: 0.8, fontSize: 24, color: GOLD, italic: true, fontFace: 'Georgia',
  });

  // What we need from you
  s.addText('WHAT WE NEED FROM YOU', {
    x: 0.6, y: 4.5, w: 12, h: 0.3, fontSize: 12, color: GOLD, charSpacing: 4, bold: true,
  });
  const asks = [
    '1 property to start (Villa Le Blanc or your pick)',
    '1 key business question (revenue / satisfaction / pricing)',
    'DPA signature for data access (we have a template)',
    'Executive sponsor (CRO or Director of Experience)',
  ];
  let y = 4.9;
  for (const a of asks) {
    s.addText('→ ' + a, { x: 0.6, y, w: 12, h: 0.35, fontSize: 15, color: WHITE });
    y += 0.4;
  }

  // Footer contact
  s.addText('Rafa Ferrer · Synthetic Users · rafa@syntheticusers.com', {
    x: 0.6, y: 7.0, w: 12, h: 0.3, fontSize: 11, color: GOLD, italic: true,
  });
}

// ─── Save ────────────────────────────────────────────────────────
const outPath = path.resolve(__dirname, '..', 'Synthetic_Users_Melia_Pitch_Deck.pptx');
pres.writeFile({ fileName: outPath })
  .then(name => console.log('Wrote pitch deck:', name));
