/**
 * Meliá One-Pager A4 — leave-behind after the meeting.
 * Scannable in 3 minutes. Everything a CRO needs to say yes or forward.
 *
 * Output: Synthetic_Users_Melia_OnePager.docx at repo root.
 */

const fs = require('fs');
const path = require('path');
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  Header, Footer, AlignmentType, LevelFormat, HeadingLevel, BorderStyle,
  WidthType, ShadingType, PageNumber, PageBreak, TabStopType,
} = require(path.join(process.env.APPDATA, 'npm', 'node_modules', 'docx'));

// Brand palette
const BRAND = '8B1538';
const ACCENT = '2C3E50';
const GOLD = 'B8935A';
const CREAM = 'F5F1E8';
const INK = '1A1A1A';
const SUBTLE = '6B6B6B';
const LIGHT_BG = 'F5F1E8';

const border = (c = 'CCCCCC', sz = 1) => ({ style: BorderStyle.SINGLE, size: sz, color: c });
const allBorders = (c = 'CCCCCC') => ({ top: border(c), bottom: border(c), left: border(c), right: border(c) });

function para(children, opts = {}) {
  const runs = Array.isArray(children) ? children : [new TextRun(children)];
  return new Paragraph({
    spacing: { before: 40, after: 40, line: 260 },
    alignment: opts.align || AlignmentType.LEFT,
    ...opts,
    children: runs,
  });
}
function bullet(text, opts = {}) {
  const runs = Array.isArray(text) ? text : [new TextRun(text)];
  return new Paragraph({
    numbering: { reference: 'bullets', level: 0 },
    spacing: { before: 20, after: 20, line: 260 },
    ...opts,
    children: runs,
  });
}
function kpiCell(value, label, color = BRAND) {
  return new TableCell({
    borders: allBorders('E5DFD3'),
    width: { size: 2340, type: WidthType.DXA },
    shading: { fill: LIGHT_BG, type: ShadingType.CLEAR },
    margins: { top: 120, bottom: 120, left: 100, right: 100 },
    children: [
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { before: 0, after: 40 },
        children: [new TextRun({ text: value, bold: true, size: 36, color })],
      }),
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { before: 0, after: 0 },
        children: [new TextRun({ text: label, size: 14, color: SUBTLE })],
      }),
    ],
  });
}

const children = [];

// ─── HEADER — BRAND BAND ────────────────────────────────────
children.push(new Paragraph({
  spacing: { before: 0, after: 60 },
  children: [new TextRun({ text: 'SYNTHETIC USERS × MELIÁ HOTELS INTERNATIONAL', size: 16, bold: true, color: GOLD, characterSpacing: 60 })],
}));

// Main headline
children.push(new Paragraph({
  spacing: { before: 0, after: 60 },
  children: [new TextRun({ text: 'Revenue decisions, predicted', size: 36, bold: true, color: BRAND })],
}));
children.push(new Paragraph({
  spacing: { before: 0, after: 200 },
  children: [new TextRun({ text: 'before you deploy them.', size: 36, bold: true, italics: true, color: GOLD })],
}));

// Subtitle
children.push(para([
  new TextRun({ text: 'Synthetic Users ', bold: true, size: 22, color: ACCENT }),
  new TextRun({ text: 'simulates hundreds of calibrated guests through the full journey — arrival, room, F&B, checkout, review — so CROs can predict segment-level revenue outcomes in days, not quarters.', size: 20, color: INK }),
]));

// ─── HERO STAT BAR ──────────────────────────────────────────
children.push(new Paragraph({ spacing: { before: 240, after: 120 }, children: [new TextRun({ text: 'PROOF — VALIDATED AGAINST REAL REVIEWS', bold: true, color: BRAND, size: 16, characterSpacing: 40 })] }));

children.push(new Table({
  width: { size: 9360, type: WidthType.DXA },
  columnWidths: [2340, 2340, 2340, 2340],
  rows: [
    new TableRow({
      children: [
        kpiCell('91.4%', 'Theme F1 accuracy', BRAND),
        kpiCell('100%', 'Theme recall', GOLD),
        kpiCell('572', 'Real reviews backtest corpus', ACCENT),
        kpiCell('14d', 'Delivery time, one property', BRAND),
      ],
    }),
  ],
}));
children.push(para([
  new TextRun({ text: 'Backtest: Villa Le Blanc simulation output measured against 572 public reviews (TripAdvisor 305 + Booking 267) + 3 professional reviews. ', size: 14, color: SUBTLE, italics: true }),
  new TextRun({ text: 'Reproducible via ', size: 14, color: SUBTLE, italics: true }),
  new TextRun({ text: 'node scripts/backtest_villa_le_blanc.js', size: 14, color: BRAND, italics: true, font: 'Consolas' }),
  new TextRun({ text: '.', size: 14, color: SUBTLE, italics: true }),
]));

// ─── 3 PILLARS ──────────────────────────────────────────────
children.push(new Paragraph({ spacing: { before: 280, after: 120 }, children: [new TextRun({ text: 'WHAT WE DELIVER', bold: true, color: BRAND, size: 16, characterSpacing: 40 })] }));

children.push(new Table({
  width: { size: 9360, type: WidthType.DXA },
  columnWidths: [3120, 3120, 3120],
  rows: [
    new TableRow({ children: [
      new TableCell({
        borders: allBorders('E5DFD3'),
        width: { size: 3120, type: WidthType.DXA },
        shading: { fill: BRAND, type: ShadingType.CLEAR },
        margins: { top: 160, bottom: 160, left: 160, right: 160 },
        children: [
          new Paragraph({ spacing: { before: 0, after: 60 }, children: [new TextRun({ text: '1 · REVENUE UPLIFT', bold: true, color: GOLD, size: 14, characterSpacing: 30 })] }),
          new Paragraph({ spacing: { before: 0, after: 80 }, children: [new TextRun({ text: 'Quantified', bold: true, color: 'FFFFFF', size: 22 })] }),
          new Paragraph({ children: [new TextRun({ text: 'Predict RevPAR and ancillary lift from rate, loyalty, and ops decisions, segment by segment, before capex.', color: 'E5DFD3', size: 16 })] }),
        ],
      }),
      new TableCell({
        borders: allBorders('E5DFD3'),
        width: { size: 3120, type: WidthType.DXA },
        shading: { fill: ACCENT, type: ShadingType.CLEAR },
        margins: { top: 160, bottom: 160, left: 160, right: 160 },
        children: [
          new Paragraph({ spacing: { before: 0, after: 60 }, children: [new TextRun({ text: '2 · SEGMENT INSIGHT', bold: true, color: GOLD, size: 14, characterSpacing: 30 })] }),
          new Paragraph({ spacing: { before: 0, after: 80 }, children: [new TextRun({ text: 'Decomposed', bold: true, color: 'FFFFFF', size: 22 })] }),
          new Paragraph({ children: [new TextRun({ text: 'Where is NPS leaking. Which segment. Which friction. How much it costs. Fixability map included.', color: 'E5DFD3', size: 16 })] }),
        ],
      }),
      new TableCell({
        borders: allBorders('E5DFD3'),
        width: { size: 3120, type: WidthType.DXA },
        shading: { fill: GOLD, type: ShadingType.CLEAR },
        margins: { top: 160, bottom: 160, left: 160, right: 160 },
        children: [
          new Paragraph({ spacing: { before: 0, after: 60 }, children: [new TextRun({ text: '3 · SPEED', bold: true, color: BRAND, size: 14, characterSpacing: 30 })] }),
          new Paragraph({ spacing: { before: 0, after: 80 }, children: [new TextRun({ text: '14 days', bold: true, color: 'FFFFFF', size: 22 })] }),
          new Paragraph({ children: [new TextRun({ text: 'Brief Monday, insight in 2 weeks. Re-run counterfactuals in 48 h. No quarterly panel cycles.', color: 'FFFFFF', size: 16 })] }),
        ],
      }),
    ]}),
  ],
}));

// ─── CASE STUDY STRIP ───────────────────────────────────────
children.push(new Paragraph({ spacing: { before: 280, after: 120 }, children: [new TextRun({ text: 'CASE STUDY · VILLA LE BLANC GRAN MELIÁ', bold: true, color: BRAND, size: 16, characterSpacing: 40 })] }));

const caseBullets = [
  ['€934 avg spend', 'Honeymooner segment — highest spender — but NPS −13. Personalization fix unlocks 40%+ retention uplift.'],
  ['€48 avg spend', 'Business Traveler — underserved. Executive Dinner pre-reserve protocol: +€200-400 ancillary per stay.'],
  ['NPS −66', 'Digital Nomad — worst segment. Wifi SLA contract unlocks 14-night+ length of stay. Low capex, compound revenue.'],
  ['36 incidents', 'Operational risks simulated across 50 stays. Full friction cluster ranking with recommended mitigations.'],
];

children.push(new Table({
  width: { size: 9360, type: WidthType.DXA },
  columnWidths: [2100, 7260],
  rows: caseBullets.map(([stat, desc]) => new TableRow({
    children: [
      new TableCell({
        borders: allBorders('E5DFD3'),
        width: { size: 2100, type: WidthType.DXA },
        shading: { fill: LIGHT_BG, type: ShadingType.CLEAR },
        margins: { top: 100, bottom: 100, left: 140, right: 100 },
        children: [new Paragraph({ children: [new TextRun({ text: stat, bold: true, color: BRAND, size: 20 })] })],
      }),
      new TableCell({
        borders: allBorders('E5DFD3'),
        width: { size: 7260, type: WidthType.DXA },
        margins: { top: 100, bottom: 100, left: 140, right: 140 },
        children: [new Paragraph({ children: [new TextRun({ text: desc, size: 16, color: INK })] })],
      }),
    ],
  })),
}));

children.push(para([
  new TextRun({ text: 'Estimated annual uplift from addressing these 3 segments alone: ', size: 14, color: SUBTLE, italics: true }),
  new TextRun({ text: '€1.8-2.4M RevPAR.', size: 14, bold: true, color: BRAND, italics: true }),
]));

// ─── PRICING STRIP ──────────────────────────────────────────
children.push(new Paragraph({ spacing: { before: 280, after: 120 }, children: [new TextRun({ text: 'HOW TO ENGAGE', bold: true, color: BRAND, size: 16, characterSpacing: 40 })] }));

children.push(new Table({
  width: { size: 9360, type: WidthType.DXA },
  columnWidths: [3120, 3120, 3120],
  rows: [
    new TableRow({ children: [
      new TableCell({
        borders: { top: border(GOLD, 24), bottom: border(GOLD, 8), left: border(GOLD, 8), right: border(GOLD, 8) },
        width: { size: 3120, type: WidthType.DXA },
        shading: { fill: BRAND, type: ShadingType.CLEAR },
        margins: { top: 160, bottom: 160, left: 160, right: 160 },
        children: [
          new Paragraph({ children: [new TextRun({ text: '★ START HERE', bold: true, color: GOLD, size: 12, characterSpacing: 40 })] }),
          new Paragraph({ spacing: { before: 40, after: 40 }, children: [new TextRun({ text: 'AUDIT', bold: true, color: 'FFFFFF', size: 28 })] }),
          new Paragraph({ spacing: { before: 0, after: 60 }, children: [new TextRun({ text: '€18,000 · 2 weeks', bold: true, color: GOLD, size: 16 })] }),
          new Paragraph({ children: [new TextRun({ text: 'One property. One modality. Revenue opportunity matrix + Model Accuracy Report.', color: 'E5DFD3', size: 14 })] }),
        ],
      }),
      new TableCell({
        borders: allBorders('E5DFD3'),
        width: { size: 3120, type: WidthType.DXA },
        margins: { top: 160, bottom: 160, left: 160, right: 160 },
        children: [
          new Paragraph({ children: [new TextRun({ text: 'PARTNERSHIP', bold: true, color: GOLD, size: 12, characterSpacing: 40 })] }),
          new Paragraph({ spacing: { before: 40, after: 40 }, children: [new TextRun({ text: 'PILOT', bold: true, color: INK, size: 28 })] }),
          new Paragraph({ spacing: { before: 0, after: 60 }, children: [new TextRun({ text: '€85,000 · 3 months', bold: true, color: BRAND, size: 16 })] }),
          new Paragraph({ children: [new TextRun({ text: '3 properties · 3 modalities · PMS read-only access · Revenue Playbook per property.', color: SUBTLE, size: 14 })] }),
        ],
      }),
      new TableCell({
        borders: allBorders('E5DFD3'),
        width: { size: 3120, type: WidthType.DXA },
        margins: { top: 160, bottom: 160, left: 160, right: 160 },
        children: [
          new Paragraph({ children: [new TextRun({ text: 'SCALED DEPLOYMENT', bold: true, color: GOLD, size: 12, characterSpacing: 40 })] }),
          new Paragraph({ spacing: { before: 40, after: 40 }, children: [new TextRun({ text: 'ENTERPRISE', bold: true, color: INK, size: 28 })] }),
          new Paragraph({ spacing: { before: 0, after: 60 }, children: [new TextRun({ text: '€240K / year', bold: true, color: BRAND, size: 16 })] }),
          new Paragraph({ children: [new TextRun({ text: '25+ properties · always-on dashboard · A/B counterfactual engine · quarterly recalibration.', color: SUBTLE, size: 14 })] }),
        ],
      }),
    ]}),
  ],
}));

// ─── NEXT STEP CTA ──────────────────────────────────────────
children.push(new Paragraph({
  spacing: { before: 280, after: 0 },
  border: { top: border(GOLD, 32), bottom: border(GOLD, 32) },
  children: [new TextRun({ text: ' ', size: 14 })],
}));
children.push(new Paragraph({
  spacing: { before: 160, after: 80 },
  children: [new TextRun({ text: 'THE ASK', bold: true, color: BRAND, size: 16, characterSpacing: 40 })],
}));
children.push(para([
  new TextRun({ text: '€18K · 2 weeks · ', bold: true, size: 22, color: INK }),
  new TextRun({ text: 'pick a property today — we start Monday.', bold: true, size: 22, color: BRAND }),
]));

children.push(new Paragraph({
  spacing: { before: 120, after: 60 },
  children: [new TextRun({ text: 'WHAT WE NEED FROM YOU', bold: true, color: BRAND, size: 14, characterSpacing: 30 })],
}));
children.push(bullet('1 property to simulate first (Villa Le Blanc or your pick)'));
children.push(bullet('1 key business question (revenue / satisfaction / pricing / loyalty)'));
children.push(bullet('DPA signature for data access — we have a template ready'));
children.push(bullet('Executive sponsor (CRO or Director of Experience)'));

// ─── FOOTER ─────────────────────────────────────────────────
children.push(new Paragraph({
  spacing: { before: 280, after: 0 },
  border: { top: border(BRAND, 12) },
  children: [new TextRun({ text: ' ', size: 10 })],
}));
children.push(new Paragraph({
  spacing: { before: 100, after: 0 },
  children: [
    new TextRun({ text: 'Rafa Ferrer · Synthetic Users · ', size: 12, color: SUBTLE }),
    new TextRun({ text: 'rafa@syntheticusers.com', size: 12, bold: true, color: BRAND }),
    new TextRun({ text: '  ·  Abril 2026  ·  Confidential', size: 12, color: SUBTLE }),
  ],
}));

// ─── Document config ────────────────────────────────────────
const doc = new Document({
  creator: 'Synthetic Users',
  title: 'Synthetic Users × Meliá — One-Pager',
  description: 'Commercial leave-behind',
  styles: {
    default: { document: { run: { font: 'Calibri', size: 20 } } },
  },
  numbering: {
    config: [
      {
        reference: 'bullets',
        levels: [{ level: 0, format: LevelFormat.BULLET, text: '→', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 360, hanging: 220 } }, run: { color: BRAND, bold: true } } }],
      },
    ],
  },
  sections: [{
    properties: {
      page: {
        size: { width: 11906, height: 16838 }, // A4
        margin: { top: 1000, right: 1000, bottom: 800, left: 1000 },
      },
    },
    children,
  }],
});

const outPath = path.resolve(__dirname, '..', 'Synthetic_Users_Melia_OnePager.docx');
Packer.toBuffer(doc).then(buf => {
  fs.writeFileSync(outPath, buf);
  console.log('Wrote one-pager:', outPath, `(${buf.length.toLocaleString()} bytes)`);
});
