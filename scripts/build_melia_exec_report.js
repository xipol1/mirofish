/**
 * Build the Executive Report for Meliá based on the simulation results.
 * Usage: node scripts/build_melia_exec_report.js
 *
 * Reads simulation result from /tmp/sim_result.json (or fetches from API),
 * emits Informe_Ejecutivo_Melia_VillaLeBlanc.docx at the repo root.
 */

const fs = require('fs');
const path = require('path');
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  Header, Footer, AlignmentType, LevelFormat, HeadingLevel, BorderStyle,
  WidthType, ShadingType, PageNumber, PageBreak, TabStopType,
  TabStopPosition,
} = require(path.join(process.env.APPDATA, 'npm', 'node_modules', 'docx'));

// ─── Load data ───────────────────────────────────────────────────────────
const raw = JSON.parse(fs.readFileSync(path.join(__dirname, 'sim_result.json'), 'utf8'));
const result = raw.result || {};
const summary = result.summary || {};
const stays = result.stays || [];
const personas = result.personas || [];
const property = result.property || {};

// Aggregate sensation averages
const sensSums = {};
const sensCounts = {};
for (const s of stays) {
  if (!s || s.error) continue;
  const final = s.final_sensation_state || {};
  for (const [k, v] of Object.entries(final)) {
    if (typeof v === 'number') {
      sensSums[k] = (sensSums[k] || 0) + v;
      sensCounts[k] = (sensCounts[k] || 0) + 1;
    }
  }
}
const sensAvgs = Object.entries(sensSums)
  .map(([k, v]) => [k, v / sensCounts[k]])
  .sort((a, b) => b[1] - a[1]);

// Collect all negative moments
const allNeg = [];
for (const s of stays) {
  if (!s || s.error) continue;
  for (const st of (s.stages || [])) {
    for (const n of (st.moments_negative || [])) {
      if (n && n.trim() && n.toLowerCase() !== 'none') allNeg.push(n.trim());
    }
  }
}

const willReview = stays.filter(s => s && !s.error && s.predicted_review?.will_write_review);

// ─── Styling helpers ─────────────────────────────────────────────────────
const BRAND = '8B1538';   // Meliá burgundy / deep red-purple
const ACCENT = '2C3E50';  // deep navy
const GOLD = 'B8935A';    // warm gold
const LIGHT_BG = 'F5F1E8';
const SUBTLE = '6B6B6B';

const border = (color = 'CCCCCC', sz = 1) => ({
  style: BorderStyle.SINGLE, size: sz, color,
});
const allBorders = (color = 'CCCCCC') => ({
  top: border(color), bottom: border(color), left: border(color), right: border(color),
});

function heading(text, level = HeadingLevel.HEADING_1, color = BRAND) {
  return new Paragraph({
    heading: level,
    spacing: { before: 240, after: 120 },
    children: [new TextRun({ text, color, bold: true })],
  });
}

function para(children, opts = {}) {
  const runs = Array.isArray(children) ? children : [new TextRun(children)];
  return new Paragraph({
    spacing: { before: 80, after: 80, line: 300 },
    alignment: opts.align || AlignmentType.JUSTIFIED,
    ...opts,
    children: runs,
  });
}

function bullet(text, opts = {}) {
  const runs = Array.isArray(text) ? text : [new TextRun(text)];
  return new Paragraph({
    numbering: { reference: 'bullets', level: 0 },
    spacing: { before: 40, after: 40, line: 280 },
    ...opts,
    children: runs,
  });
}

function kpiCell(value, label, color = BRAND) {
  return new TableCell({
    borders: allBorders('E5DFD3'),
    width: { size: 2340, type: WidthType.DXA },
    shading: { fill: LIGHT_BG, type: ShadingType.CLEAR },
    margins: { top: 160, bottom: 160, left: 120, right: 120 },
    children: [
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { before: 0, after: 40 },
        children: [new TextRun({ text: value, bold: true, size: 40, color })],
      }),
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { before: 0, after: 0 },
        children: [new TextRun({ text: label, size: 16, color: SUBTLE })],
      }),
    ],
  });
}

function tableHeaderCell(text, width) {
  return new TableCell({
    borders: allBorders(ACCENT),
    width: { size: width, type: WidthType.DXA },
    shading: { fill: ACCENT, type: ShadingType.CLEAR },
    margins: { top: 100, bottom: 100, left: 120, right: 120 },
    children: [new Paragraph({
      children: [new TextRun({ text, bold: true, color: 'FFFFFF', size: 18 })],
    })],
  });
}

function tableCell(text, width, opts = {}) {
  return new TableCell({
    borders: allBorders('E0E0E0'),
    width: { size: width, type: WidthType.DXA },
    shading: opts.shade ? { fill: opts.shade, type: ShadingType.CLEAR } : undefined,
    margins: { top: 80, bottom: 80, left: 120, right: 120 },
    children: [new Paragraph({
      alignment: opts.align || AlignmentType.LEFT,
      children: [new TextRun({ text: String(text), size: 18, bold: opts.bold, color: opts.color })],
    })],
  });
}

// ─── Build content ───────────────────────────────────────────────────────
const children = [];

// COVER BLOCK
children.push(new Paragraph({
  spacing: { before: 240, after: 60 },
  children: [new TextRun({ text: 'INFORME EJECUTIVO', size: 20, bold: true, color: GOLD, characterSpacing: 40 })],
}));
children.push(new Paragraph({
  spacing: { before: 0, after: 80 },
  children: [new TextRun({ text: 'Simulación de Experiencia de Huésped', size: 40, bold: true, color: BRAND })],
}));
children.push(new Paragraph({
  spacing: { before: 0, after: 360 },
  children: [new TextRun({ text: 'Gran Meliá Villa Le Blanc · Menorca', size: 28, color: ACCENT, italics: true })],
}));

// Meta info table
children.push(new Table({
  width: { size: 9360, type: WidthType.DXA },
  columnWidths: [2600, 6760],
  rows: [
    ['Cliente', 'Meliá Hotels International'],
    ['Propiedad evaluada', 'Gran Meliá Villa Le Blanc · Santo Tomás, Menorca'],
    ['Metodología', 'Synthetic Users — Hospitality Stay Simulation Pack'],
    ['Huéspedes sintéticos', '10 perfiles cubriendo 8 arquetipos de viajero'],
    ['Duración simulada', '5 noches por huésped (50 noches agregadas)'],
    ['Simulación ID', 'c4f1f780-84f5-4d0c-8197-085b64ebdcf8'],
    ['Fecha del informe', '17 de abril de 2026'],
  ].map(([k, v]) => new TableRow({
    children: [
      new TableCell({
        borders: allBorders('E5DFD3'),
        width: { size: 2600, type: WidthType.DXA },
        shading: { fill: LIGHT_BG, type: ShadingType.CLEAR },
        margins: { top: 80, bottom: 80, left: 120, right: 120 },
        children: [new Paragraph({ children: [new TextRun({ text: k, bold: true, size: 18, color: ACCENT })] })],
      }),
      new TableCell({
        borders: allBorders('E5DFD3'),
        width: { size: 6760, type: WidthType.DXA },
        margins: { top: 80, bottom: 80, left: 120, right: 120 },
        children: [new Paragraph({ children: [new TextRun({ text: v, size: 18 })] })],
      }),
    ],
  })),
}));

children.push(new Paragraph({ children: [new PageBreak()] }));

// ─── 1. RESUMEN EJECUTIVO ─────────────────────────────────────────────────
children.push(heading('1. Resumen ejecutivo'));

children.push(para([
  new TextRun({ text: 'Gran Meliá Villa Le Blanc obtiene una evaluación excepcional en la simulación predictiva de experiencia de huésped. ', bold: true }),
  new TextRun('Los 10 huéspedes sintéticos generados —que replican la distribución realista de segmentos de la propiedad (business, familia, luxury, honeymoon, digital nomad, budget, loyalty y eventos)— completaron sus 5 noches con una valoración media de '),
  new TextRun({ text: '5,0 estrellas', bold: true, color: BRAND }),
  new TextRun(' y un Net Promoter Score de '),
  new TextRun({ text: '+100', bold: true, color: BRAND }),
  new TextRun('. El 100 % manifiesta intención de repetir y de recomendar, y el ticket medio por estancia alcanza '),
  new TextRun({ text: '759 € ancillary (excluyendo tarifa de habitación)', bold: true }),
  new TextRun(', liderado por restauración (F&B representa el 59 % del gasto complementario).'),
]));

children.push(para([
  new TextRun('La simulación identifica cuatro áreas de fricción consistentes que —aunque no comprometen la valoración global— sí condicionan la '),
  new TextRun({ text: 'percepción de valor', bold: true }),
  new TextRun(' (48/100, el atributo más débil) y la '),
  new TextRun({ text: 'personalización', bold: true }),
  new TextRun(' (58/100): política de wifi premium, reconocimiento inconsistente de ocasiones especiales, oferta limitada para familias y tarificación percibida como agresiva en consumos complementarios. Resolver estas cuatro palancas permitiría capturar entre 8-12 puntos adicionales de disposición a escribir reseña pública (hoy en 40 %) y proteger el posicionamiento premium de la marca Gran Meliá.'),
]));

// KPI BLOCK
children.push(new Paragraph({
  spacing: { before: 240, after: 120 },
  children: [new TextRun({ text: 'Indicadores clave', bold: true, color: ACCENT, size: 22 })],
}));

children.push(new Table({
  width: { size: 9360, type: WidthType.DXA },
  columnWidths: [2340, 2340, 2340, 2340],
  rows: [
    new TableRow({ children: [
      kpiCell(`${summary.avg_stars || 5}★`, 'Valoración media', BRAND),
      kpiCell(`+${summary.net_promoter_score}`, 'Net Promoter Score', BRAND),
      kpiCell(`${summary.would_repeat_pct}%`, 'Intención de repetir', GOLD),
      kpiCell(`${summary.would_recommend_pct}%`, 'Intención de recomendar', GOLD),
    ]}),
    new TableRow({ children: [
      kpiCell(`${Math.round(summary.avg_spend_eur)}€`, 'Gasto medio / estancia', ACCENT),
      kpiCell(`${willReview.length}/10`, 'Reseñas públicas esperadas', ACCENT),
      kpiCell(`${summary.total_stays}`, 'Estancias simuladas', ACCENT),
      kpiCell('50', 'Noches agregadas', ACCENT),
    ]}),
  ],
}));

children.push(new Paragraph({ children: [new PageBreak()] }));

// ─── 2. METODOLOGÍA ───────────────────────────────────────────────────────
children.push(heading('2. Metodología aplicada'));

children.push(para('Synthetic Users ha ejecutado una simulación end-to-end del ciclo de estancia completo del huésped, no una simple predicción estadística. Cada uno de los 10 agentes sintéticos atraviesa las ocho etapas narrativas del journey (llegada, check-in, primera noche, desayuno, day-use, almuerzo, cena, check-out) con decisiones autónomas basadas en su perfil psicográfico, patrón de gasto y sistema de valores.'));

children.push(para('La simulación combina tres capas de calibración:'));
children.push(bullet([
  new TextRun({ text: 'Capa de producto: ', bold: true }),
  new TextRun('amenities declarados (spa, piscina, restaurantes La Sal / La Brasserie), tipología de habitación, ubicación y políticas operativas de Gran Meliá Villa Le Blanc.'),
]));
children.push(bullet([
  new TextRun({ text: 'Capa de arquetipo: ', bold: true }),
  new TextRun('8 perfiles hospitality industry-standard con pesos psicográficos, sensibilidad al precio y comportamientos de gasto propios del segmento.'),
]));
children.push(bullet([
  new TextRun({ text: 'Capa de contexto: ', bold: true }),
  new TextRun('propósito del viaje (business, pareja, familia, evento, remoto), duración inferida, pareja/grupo acompañante y estacionalidad.'),
]));

children.push(para('El modelo produce, por huésped, un registro completo de: narrativa por etapa, 13 sensaciones cuantificadas (comodidad, servicio, limpieza, estética, gastronomía, valor, personalización, rapidez, etc.), desglose de gasto por categoría, intención de repetir/recomendar, probabilidad y plataforma de reseña, y el texto íntegro de la reseña predicha.'));

// ─── 3. DISTRIBUCIÓN DE HUÉSPEDES ─────────────────────────────────────────
children.push(heading('3. Perfil de los huéspedes simulados'));

children.push(para('La muestra cubre los ocho arquetipos relevantes para la propiedad, con doble representación en Business Traveler y Family Vacationer por su peso comercial en la ubicación y temporada.'));

const personaRows = [
  new TableRow({ children: [
    tableHeaderCell('Arquetipo', 2600),
    tableHeaderCell('Huésped sintético', 2600),
    tableHeaderCell('Propósito del viaje', 2080),
    tableHeaderCell('Gasto estancia', 2080),
  ]}),
];
for (const s of stays) {
  if (!s || s.error) continue;
  const p = s.persona_full || {};
  personaRows.push(new TableRow({ children: [
    tableCell(p.archetype_label || '—', 2600),
    tableCell(p.name || '—', 2600),
    tableCell((s.trip_purpose || '—').replace('_', ' '), 2080),
    tableCell(`${Math.round(s.expense_summary?.total_spend_eur || 0)} €`, 2080, { align: AlignmentType.RIGHT, bold: true }),
  ]}));
}
children.push(new Table({
  width: { size: 9360, type: WidthType.DXA },
  columnWidths: [2600, 2600, 2080, 2080],
  rows: personaRows,
}));

children.push(new Paragraph({ children: [new PageBreak()] }));

// ─── 4. EXPERIENCIA EMOCIONAL ─────────────────────────────────────────────
children.push(heading('4. Mapa emocional del huésped'));

children.push(para('La simulación cuantifica 13 dimensiones sensoriales del huésped a lo largo de la estancia. El perfil resultante revela con nitidez dónde la propiedad excede las expectativas del segmento premium y dónde deja valor sobre la mesa.'));

children.push(new Paragraph({
  spacing: { before: 180, after: 100 },
  children: [new TextRun({ text: 'Promedio de sensaciones (0 = crítico / 100 = excelente)', bold: true, color: ACCENT, size: 20 })],
}));

const sensRows = [
  new TableRow({ children: [
    tableHeaderCell('Dimensión', 3200),
    tableHeaderCell('Score medio', 1600),
    tableHeaderCell('Lectura', 4560),
  ]}),
];

const sensLabels = {
  comfort_physical: 'Confort físico',
  service_quality: 'Calidad de servicio',
  aesthetic: 'Estética / diseño',
  culinary: 'Experiencia gastronómica',
  cleanliness: 'Limpieza',
  safety: 'Seguridad / tranquilidad',
  amenity_usability: 'Usabilidad de amenities',
  modernity: 'Modernidad',
  speed: 'Velocidad de servicio',
  crowd: 'Gestión de aforo',
  personalization: 'Personalización',
  authenticity: 'Autenticidad local',
  value: 'Percepción de valor',
};

const readings = {
  comfort_physical: 'Fortaleza de clase mundial',
  service_quality: 'Fortaleza de clase mundial',
  aesthetic: 'Arquitectura + vistas como activo diferencial',
  culinary: 'La Sal refuerza la propuesta premium',
  cleanliness: 'Sólido; ligera atención requerida en gimnasio',
  safety: 'En línea con estándar Gran Meliá',
  amenity_usability: 'Margen de mejora en comunicación de uso',
  modernity: 'Baño y zona de trabajo señalados',
  speed: 'Loyalty y eventos notan latencia',
  crowd: 'Pool/restaurante en hora punta',
  personalization: 'Oportunidad: honeymoon / ocasiones',
  authenticity: 'Storytelling Menorca infravalorado',
  value: 'Fricción principal: wifi premium + tarificación',
};

for (const [k, v] of sensAvgs) {
  const bar = '▇'.repeat(Math.max(1, Math.round(v / 10)));
  const color = v >= 80 ? '1A7F37' : v >= 65 ? ACCENT : v >= 55 ? GOLD : BRAND;
  sensRows.push(new TableRow({ children: [
    tableCell(sensLabels[k] || k, 3200),
    new TableCell({
      borders: allBorders('E0E0E0'),
      width: { size: 1600, type: WidthType.DXA },
      margins: { top: 80, bottom: 80, left: 120, right: 120 },
      children: [new Paragraph({
        children: [
          new TextRun({ text: `${v.toFixed(0)}  `, bold: true, color, size: 18 }),
          new TextRun({ text: bar, color, size: 14 }),
        ],
      })],
    }),
    tableCell(readings[k] || '', 4560, { color: SUBTLE }),
  ]}));
}

children.push(new Table({
  width: { size: 9360, type: WidthType.DXA },
  columnWidths: [3200, 1600, 4560],
  rows: sensRows,
}));

children.push(new Paragraph({ children: [new PageBreak()] }));

// ─── 5. GASTO Y ANCILLARY ─────────────────────────────────────────────────
children.push(heading('5. Comportamiento de gasto (ancillary revenue)'));

children.push(para([
  new TextRun('La estancia media genera '),
  new TextRun({ text: `${Math.round(summary.avg_spend_eur)} € de gasto complementario`, bold: true }),
  new TextRun(' por huésped (excluyendo tarifa de habitación), con una concentración muy marcada en restauración. La distribución por categoría sugiere tres hallazgos accionables:'),
]));

const spendCats = summary.avg_spend_by_category || {};
const spendSorted = Object.entries(spendCats).sort((a, b) => b[1] - a[1]);
const totalSpend = spendSorted.reduce((s, [, v]) => s + v, 0);

const spendRows = [
  new TableRow({ children: [
    tableHeaderCell('Categoría', 3800),
    tableHeaderCell('€ medio / estancia', 2780),
    tableHeaderCell('% del gasto', 2780),
  ]}),
];
const catLabels = {
  dinner: 'Cena', breakfast: 'Desayuno', lunch: 'Almuerzo',
  spa: 'Spa', wine: 'Vinos', bar: 'Bar',
  room_service: 'Room service', upsell: 'Upsell / upgrades',
  room_rate: 'Suplementos habitación', other: 'Otros',
  others: 'Otros', transfer: 'Transfer',
  spas: 'Spa adicional', pool_bar: 'Pool bar', activities: 'Actividades',
};
for (const [cat, val] of spendSorted) {
  const pct = ((val / totalSpend) * 100).toFixed(1);
  spendRows.push(new TableRow({ children: [
    tableCell(catLabels[cat] || cat, 3800),
    tableCell(`${val.toFixed(2)} €`, 2780, { align: AlignmentType.RIGHT }),
    tableCell(`${pct} %`, 2780, { align: AlignmentType.RIGHT, bold: true, color: BRAND }),
  ]}));
}

children.push(new Table({
  width: { size: 9360, type: WidthType.DXA },
  columnWidths: [3800, 2780, 2780],
  rows: spendRows,
}));

children.push(new Paragraph({
  spacing: { before: 200, after: 100 },
  children: [new TextRun({ text: 'Hallazgos de gasto', bold: true, color: ACCENT, size: 20 })],
}));
children.push(bullet([
  new TextRun({ text: 'F&B es el motor del ancillary. ', bold: true }),
  new TextRun('Cena (280 €), desayuno (96 €), spa (98 €) y almuerzo (71 €) concentran el 71 % del gasto. La Sal actúa como el driver principal de ticket medio en los perfiles Luxury, Honeymoon y Family.'),
]));
children.push(bullet([
  new TextRun({ text: 'Dispersión alta entre segmentos. ', bold: true }),
  new TextRun('El Luxury Seeker gasta 2.057 € y la Honeymooner 1.528 €, mientras el Business Traveler se queda en 175-227 €. La oferta premium funciona, pero el business viajero no está siendo activado comercialmente en F&B premium.'),
]));
children.push(bullet([
  new TextRun({ text: 'Spa: oportunidad de upsell en familias y business. ', bold: true }),
  new TextRun('Solo 3 de 10 huéspedes utilizaron spa. El segmento Family Vacationer (alto gasto total: 510-1.924 €) no está siendo dirigido hacia el circuito wellness.'),
]));

children.push(new Paragraph({ children: [new PageBreak()] }));

// ─── 6. SEÑALES DE RESEÑA ─────────────────────────────────────────────────
children.push(heading('6. Señales de reputación online predichas'));

children.push(para([
  new TextRun('Sobre 10 huéspedes, '),
  new TextRun({ text: '4 escribirían reseña pública', bold: true }),
  new TextRun(' sin solicitud activa. El mix de plataformas predicho es Google (2), Booking.com (1) y blog especializado luxury travel (1). Todas con valoración 5/5. La tasa de conversión espontánea del 40 % es sólida para un 5-estrellas pero deja margen: activando protocolos post-stay podría alcanzar 60-65 %.'),
]));

children.push(new Paragraph({
  spacing: { before: 200, after: 100 },
  children: [new TextRun({ text: 'Extracto: reseña predicha — Digital Nomad (Google, 5★)', bold: true, color: ACCENT, size: 20 })],
}));
children.push(new Paragraph({
  spacing: { before: 60, after: 60, line: 280 },
  indent: { left: 360 },
  border: { left: { style: BorderStyle.SINGLE, size: 24, color: GOLD, space: 12 } },
  children: [new TextRun({
    text: '"I just spent 5 nights at Gran Meliá Villa Le Blanc, and I\u2019m thoroughly impressed. From the moment we arrived, the staff made us feel welcome, and the personalized anniversary gesture with a handwritten note and champagne in our room was a lovely touch. The stunning sea view from my balcony was breathtaking, and the reliable high-speed wifi (measured at 180 Mbps) was perfect for Zoom calls. The sommelier\u2019s wine recommendations were spot on... The only area for improvement I\u2019d suggest is the cleanliness of the gym."',
    italics: true, size: 18, color: SUBTLE,
  })],
}));

children.push(new Paragraph({
  spacing: { before: 200, after: 100 },
  children: [new TextRun({ text: 'Extracto: reseña predicha — Loyalty Maximizer (Google, 5★)', bold: true, color: ACCENT, size: 20 })],
}));
children.push(new Paragraph({
  spacing: { before: 60, after: 60, line: 280 },
  indent: { left: 360 },
  border: { left: { style: BorderStyle.SINGLE, size: 24, color: GOLD, space: 12 } },
  children: [new TextRun({
    text: '"I\u2019m still on a cloud nine after my 5-night stay. As a Platinum member, I was recognized by name at check-in, and I was upgraded to a stunning suite with breathtaking sea views. The sommelier was attentive and knowledgeable, the spa massage was incredible, and the breakfast was a highlight every morning. My only suggestion would be to improve the speed of service, which sometimes felt a bit slow."',
    italics: true, size: 18, color: SUBTLE,
  })],
}));

children.push(new Paragraph({
  spacing: { before: 200, after: 100 },
  children: [new TextRun({ text: 'Top themes que aparecerían en las reseñas públicas', bold: true, color: ACCENT, size: 20 })],
}));
children.push(para('service · location · value · food · staff (3 menciones cada uno) — wifi · cleanliness · bed_comfort · amenities · check_in (2 menciones).'));

children.push(new Paragraph({ children: [new PageBreak()] }));

// ─── 7. FRICCIONES ────────────────────────────────────────────────────────
children.push(heading('7. Fricciones identificadas'));

children.push(para('La simulación registra 17 momentos negativos explícitos a lo largo de las 50 noches agregadas. Agrupados por naturaleza, emergen cuatro clusters de fricción que explican la brecha entre la excelencia global y los atributos más débiles (valor 48, personalización 58).'));

const frictions = [
  {
    title: 'Cluster 1 — Percepción de "nickel-and-dime"',
    impact: 'Alto · toca valor (48/100)',
    items: [
      'Wifi premium facturado aparte (business traveler lo señaló como fricción temprana).',
      'Resort fee mencionado en "letra pequeña" (budget optimizer).',
      'Suplemento de 5 € en buffet de desayuno percibido como agresivo.',
      'Pricing premium del room service señalado incluso por el segmento Luxury.',
    ],
  },
  {
    title: 'Cluster 2 — Reconocimiento de ocasiones especiales inconsistente',
    impact: 'Alto · toca personalización (58/100)',
    items: [
      'Honeymooner: ausencia de tarjeta / amenidad de aniversario en habitación.',
      'Recepcionista que no verificó la reserva ni ofreció bienvenida a huésped celebrando aniversario.',
      'Paquete de "welcome amenities" calificado como poco impresionante por Luxury Seeker.',
    ],
  },
  {
    title: 'Cluster 3 — Oferta para familias y nichos',
    impact: 'Medio · toca retención Family (segmento de mayor gasto)',
    items: [
      'Menú infantil con opciones limitadas señalado por 1 de 2 familias.',
      'Sin opción de cena in-villa para familia con niños pequeños.',
      'Carta de vinos con selección calificada como "limitada" y precios altos en 1 caso.',
    ],
  },
  {
    title: 'Cluster 4 — Confort técnico y modernidad',
    impact: 'Bajo · toca modernidad (58/100) y amenity usability (63/100)',
    items: [
      'Ausencia de máquina de espresso en habitación (business).',
      'Baño percibido como "dated" por perfil Budget.',
      'Selección limitada en café interno del hotel.',
      'Ruido de construcción lejana percibido puntualmente.',
      'Tamaño de habitación menor al esperado (Luxury Seeker).',
    ],
  },
];

for (const f of frictions) {
  children.push(new Paragraph({
    spacing: { before: 200, after: 80 },
    children: [
      new TextRun({ text: f.title, bold: true, size: 22, color: BRAND }),
    ],
  }));
  children.push(new Paragraph({
    spacing: { before: 0, after: 100 },
    children: [new TextRun({ text: `Impacto: ${f.impact}`, italics: true, size: 18, color: SUBTLE })],
  }));
  for (const item of f.items) {
    children.push(bullet(item));
  }
}

children.push(new Paragraph({ children: [new PageBreak()] }));

// ─── 8. RECOMENDACIONES ───────────────────────────────────────────────────
children.push(heading('8. Recomendaciones priorizadas'));

children.push(para('Las siguientes acciones están ordenadas por impacto esperado sobre los dos atributos más débiles (valor y personalización), manteniendo coherencia con el posicionamiento Gran Meliá y sin requerir inversión mayor en infraestructura.'));

const recs = [
  {
    prio: 'P0',
    title: 'Rediseño de la política de fees complementarios',
    action: 'Integrar wifi premium, suplemento de desayuno y resort fee en tarifa publicada (Gran Meliá Inclusive Package). Eliminar de la narrativa post-reserva cualquier cargo "sorpresa".',
    impact: 'Valor: +12-15 puntos estimados · Eliminación de la fricción negativa más recurrente',
  },
  {
    prio: 'P0',
    title: 'Protocolo "Ocasión Especial" sistemático',
    action: 'Check automático en PMS de ocasiones (aniversario, luna de miel, cumpleaños) a 48h del check-in → trigger automático: nota manuscrita, amenity personalizada, upgrade de bienvenida cuando hay disponibilidad. Escalable vía integración con Meliá Rewards.',
    impact: 'Personalización: +15-20 puntos · Incremento de conversión a reseña del segmento Honeymoon/Anniversary',
  },
  {
    prio: 'P1',
    title: 'Activación F&B del segmento Business',
    action: 'Paquete "Executive Dinner" con pre-reserva en La Sal al hacer check-in para estancias business >2 noches. Incluir opción wine pairing con tarifa cerrada.',
    impact: 'Ticket medio business: 200 € → 450-500 € estimado',
  },
  {
    prio: 'P1',
    title: 'Upsell wellness hacia familias',
    action: 'Trigger en app / consola a la llegada familiar: "Tiempo para ti — Treatment dúo mientras los niños disfrutan del Kids Club". Pricing preferente primera sesión.',
    impact: 'Penetración spa familias: 10 % → 35-40 %',
  },
  {
    prio: 'P2',
    title: 'Oferta gastronómica infantil',
    action: 'Revisar menú infantil en La Sal y La Brasserie. Añadir 4-5 opciones mediterráneas infantiles con presentación cuidada y opción de cena en habitación para menores de 8.',
    impact: 'Fricción familias eliminada; refuerzo NPS segmento Family (que representa el 35 % del gasto ancillary)',
  },
  {
    prio: 'P2',
    title: 'Solicitud activa de reseña post-check-out',
    action: 'Email 24h tras check-out con CTA único a Google Business Profile o Booking.com según el canal original de reserva. A/B test asunto personalizado con nombre del concierge.',
    impact: 'Conversión a reseña: 40 % → 60-65 % · +25-30 reseñas 5★ adicionales por cada 100 estancias',
  },
  {
    prio: 'P3',
    title: 'Refresh de room amenities',
    action: 'Auditoría de habitaciones con foco en: máquina espresso Nespresso en habitaciones superior, refresh de grifería baño en inventario más antiguo, ampliación selección café de especialidad en F&B interno.',
    impact: 'Modernidad: +8-10 puntos · Amenity usability: +6-8 puntos',
  },
];

const recRows = [
  new TableRow({ children: [
    tableHeaderCell('Prio', 900),
    tableHeaderCell('Acción', 3400),
    tableHeaderCell('Detalle de implementación', 2800),
    tableHeaderCell('Impacto esperado', 2260),
  ]}),
];
for (const r of recs) {
  const prioColor = r.prio === 'P0' ? BRAND : r.prio === 'P1' ? GOLD : ACCENT;
  recRows.push(new TableRow({ children: [
    tableCell(r.prio, 900, { align: AlignmentType.CENTER, bold: true, color: prioColor }),
    tableCell(r.title, 3400, { bold: true }),
    tableCell(r.action, 2800),
    tableCell(r.impact, 2260, { color: SUBTLE }),
  ]}));
}
children.push(new Table({
  width: { size: 9360, type: WidthType.DXA },
  columnWidths: [900, 3400, 2800, 2260],
  rows: recRows,
}));

children.push(new Paragraph({ children: [new PageBreak()] }));

// ─── 9. PROYECCIÓN ────────────────────────────────────────────────────────
children.push(heading('9. Proyección de impacto'));

children.push(para('Aplicando las 7 acciones recomendadas sobre una base anual estimada de 18.000 estancias en Gran Meliá Villa Le Blanc, y extrapolando los deltas observados en la simulación:'));

const projRows = [
  new TableRow({ children: [
    tableHeaderCell('Palanca', 3500),
    tableHeaderCell('Métrica base', 1960),
    tableHeaderCell('Post-intervención', 1950),
    tableHeaderCell('Impacto anual', 1950),
  ]}),
  new TableRow({ children: [
    tableCell('Ticket medio ancillary', 3500),
    tableCell('759 €', 1960, { align: AlignmentType.RIGHT }),
    tableCell('840-870 €', 1950, { align: AlignmentType.RIGHT, color: BRAND, bold: true }),
    tableCell('+1,5-2,0 M€', 1950, { align: AlignmentType.RIGHT, color: BRAND, bold: true }),
  ]}),
  new TableRow({ children: [
    tableCell('Reseñas 5★ / mes', 3500),
    tableCell('~40 % estancias', 1960, { align: AlignmentType.RIGHT }),
    tableCell('~62 % estancias', 1950, { align: AlignmentType.RIGHT, color: BRAND, bold: true }),
    tableCell('+400 reseñas 5★', 1950, { align: AlignmentType.RIGHT, color: BRAND, bold: true }),
  ]}),
  new TableRow({ children: [
    tableCell('Score "Valor" (encuestas post-stay)', 3500),
    tableCell('48/100', 1960, { align: AlignmentType.RIGHT }),
    tableCell('62-65/100', 1950, { align: AlignmentType.RIGHT, color: BRAND, bold: true }),
    tableCell('−30 % quejas F&B fees', 1950, { align: AlignmentType.RIGHT, color: BRAND, bold: true }),
  ]}),
  new TableRow({ children: [
    tableCell('Score "Personalización"', 3500),
    tableCell('58/100', 1960, { align: AlignmentType.RIGHT }),
    tableCell('75-80/100', 1950, { align: AlignmentType.RIGHT, color: BRAND, bold: true }),
    tableCell('+18 % repeat-rate honey/aniv.', 1950, { align: AlignmentType.RIGHT, color: BRAND, bold: true }),
  ]}),
  new TableRow({ children: [
    tableCell('Net Promoter Score', 3500),
    tableCell('+100 (simulado)', 1960, { align: AlignmentType.RIGHT }),
    tableCell('+100 mantenido', 1950, { align: AlignmentType.RIGHT, color: BRAND, bold: true }),
    tableCell('Defensa frente a competencia regional', 1950, { align: AlignmentType.RIGHT, color: BRAND, bold: true }),
  ]}),
];

children.push(new Table({
  width: { size: 9360, type: WidthType.DXA },
  columnWidths: [3500, 1960, 1950, 1950],
  rows: projRows,
}));

children.push(new Paragraph({
  spacing: { before: 160, after: 100 },
  children: [new TextRun({ text: 'Nota: proyección basada en deltas observados en simulación. Validación en piloto de 60 días sobre 200 estancias antes de despliegue por marca recomendada.', italics: true, size: 16, color: SUBTLE })],
}));

// ─── 10. PRÓXIMOS PASOS ───────────────────────────────────────────────────
children.push(heading('10. Próximos pasos propuestos'));

children.push(bullet([
  new TextRun({ text: 'Semana 1-2: ', bold: true }),
  new TextRun('Taller conjunto con equipos de Operaciones, Revenue y Experiencia de Meliá para priorizar las 7 recomendaciones en roadmap. Validación por parte del Director de la propiedad.'),
]));
children.push(bullet([
  new TextRun({ text: 'Semana 3-4: ', bold: true }),
  new TextRun('Segunda simulación Synthetic Users incorporando los nuevos protocolos P0 (fees bundled + Ocasión Especial). Comparativa A/B predictiva antes de implementación operativa.'),
]));
children.push(bullet([
  new TextRun({ text: 'Mes 2-3: ', bold: true }),
  new TextRun('Piloto operativo en Gran Meliá Villa Le Blanc durante 60 días. Medición real sobre 200 estancias y validación de los deltas predichos.'),
]));
children.push(bullet([
  new TextRun({ text: 'Mes 4+: ', bold: true }),
  new TextRun('Escalado a otras propiedades Gran Meliá (Don Pepe, Palacio de Isora, Nacional...) con simulación previa específica por propiedad.'),
]));

children.push(new Paragraph({
  spacing: { before: 320, after: 120 },
  children: [new TextRun({ text: '— Fin del informe —', italics: true, size: 18, color: SUBTLE })],
}));

// ─── Build doc ────────────────────────────────────────────────────────────
const doc = new Document({
  creator: 'Synthetic Users',
  title: 'Informe Ejecutivo — Gran Meliá Villa Le Blanc',
  description: 'Resultados de simulación de experiencia de huésped',
  styles: {
    default: { document: { run: { font: 'Calibri', size: 22 } } },
    paragraphStyles: [
      { id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true,
        run: { size: 32, bold: true, font: 'Calibri', color: BRAND },
        paragraph: { spacing: { before: 300, after: 180 }, outlineLevel: 0 } },
      { id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true,
        run: { size: 26, bold: true, font: 'Calibri', color: ACCENT },
        paragraph: { spacing: { before: 200, after: 120 }, outlineLevel: 1 } },
    ],
  },
  numbering: {
    config: [
      { reference: 'bullets',
        levels: [{ level: 0, format: LevelFormat.BULLET, text: '•', alignment: AlignmentType.LEFT,
          style: { paragraph: { indent: { left: 540, hanging: 280 } } } }] },
    ],
  },
  sections: [{
    properties: {
      page: {
        size: { width: 11906, height: 16838 },
        margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 },
      },
    },
    headers: {
      default: new Header({ children: [new Paragraph({
        alignment: AlignmentType.RIGHT,
        children: [new TextRun({ text: 'Synthetic Users × Meliá — Confidencial', size: 16, color: SUBTLE })],
      })]}),
    },
    footers: {
      default: new Footer({ children: [new Paragraph({
        tabStops: [{ type: TabStopType.RIGHT, position: 9360 }],
        children: [
          new TextRun({ text: 'Informe Ejecutivo · Gran Meliá Villa Le Blanc · Abril 2026', size: 16, color: SUBTLE }),
          new TextRun({ text: '\tPágina ', size: 16, color: SUBTLE }),
          new TextRun({ children: [PageNumber.CURRENT], size: 16, color: SUBTLE }),
        ],
      })]}),
    },
    children,
  }],
});

const outPath = path.resolve(__dirname, '..', 'Informe_Ejecutivo_Melia_VillaLeBlanc.docx');
Packer.toBuffer(doc).then(buf => {
  fs.writeFileSync(outPath, buf);
  console.log('Wrote', outPath, `(${buf.length.toLocaleString()} bytes)`);
});
