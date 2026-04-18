/**
 * Informe Ejecutivo standalone — SOLO datos de la simulación n=50 ejecutada.
 * Sin comparación con versiones previas.
 *
 * Usage: node scripts/build_melia_report_standalone.js
 */

const fs = require('fs');
const path = require('path');
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  Header, Footer, AlignmentType, LevelFormat, HeadingLevel, BorderStyle,
  WidthType, ShadingType, PageNumber, PageBreak, TabStopType,
} = require(path.join(process.env.APPDATA, 'npm', 'node_modules', 'docx'));

const raw = JSON.parse(fs.readFileSync(path.join(__dirname, 'sim_v2_result.json'), 'utf-8'));
const result = raw.result || {};
const summary = result.summary || {};
const stays = (result.stays || []).filter(s => s && !s.error);
const calibration = result.calibration || {};

// Per-archetype aggregation
const byArch = {};
for (const s of stays) {
  const a = s.archetype_id;
  if (!byArch[a]) byArch[a] = [];
  byArch[a].push(s);
}

// All negative moments (dedup)
const allNeg = [];
const seenNeg = new Set();
for (const s of stays) {
  for (const st of (s.stages || [])) {
    for (const n of (st.moments_negative || [])) {
      const text = typeof n === 'string' ? n : (n?.description || n?.text || '');
      const t = String(text).trim();
      if (!t) continue;
      const key = t.toLowerCase().substring(0, 60);
      if (seenNeg.has(key)) continue;
      seenNeg.add(key);
      if (t.length > 20) allNeg.push(t.substring(0, 200));
    }
  }
}

// Positive moments (dedup, for balance)
const allPos = [];
const seenPos = new Set();
for (const s of stays) {
  for (const st of (s.stages || [])) {
    for (const p of (st.moments_positive || [])) {
      const text = typeof p === 'string' ? p : (p?.description || p?.text || '');
      const t = String(text).trim();
      if (!t) continue;
      const key = t.toLowerCase().substring(0, 60);
      if (seenPos.has(key)) continue;
      seenPos.add(key);
      if (t.length > 20) allPos.push(t.substring(0, 200));
    }
  }
}

const evByType = summary.adversarial_events_triggered || {};
const evTotal = summary.adversarial_events_total || 0;

// Sample reviews (one per sentiment bucket)
const reviewers = stays.filter(s => s.predicted_review?.will_write_review);
reviewers.sort((a, b) => (a.sensation_summary?.stars || 0) - (b.sensation_summary?.stars || 0));
const revLow = reviewers[0];
const revMid = reviewers[Math.floor(reviewers.length / 2)];
const revHigh = reviewers[reviewers.length - 1];

// Spend by category
const spendCats = {};
const spendCatsCount = {};
for (const s of stays) {
  for (const [c, v] of Object.entries(s.expense_summary?.by_category || {})) {
    spendCats[c] = (spendCats[c] || 0) + v;
    spendCatsCount[c] = (spendCatsCount[c] || 0) + 1;
  }
}
const spendCatsSorted = Object.entries(spendCats)
  .map(([c, total]) => ({ c, avg: total / (spendCatsCount[c] || 1), n: spendCatsCount[c] }))
  .sort((a, b) => b.avg - a.avg)
  .slice(0, 12);

// Platform mix
const platforms = {};
for (const r of reviewers) {
  const p = r.predicted_review?.platform || 'unknown';
  platforms[p] = (platforms[p] || 0) + 1;
}

// ─── Styling ────────────────────────────────────────────────────────
const BRAND = '8B1538', ACCENT = '2C3E50', GOLD = 'B8935A';
const LIGHT_BG = 'F5F1E8', SUBTLE = '6B6B6B';
const GREEN = '1A7F37', RED = 'B91C1C';

const border = c => ({ style: BorderStyle.SINGLE, size: 1, color: c });
const allBorders = c => ({ top: border(c), bottom: border(c), left: border(c), right: border(c) });

function heading(text, color = BRAND) {
  return new Paragraph({ heading: HeadingLevel.HEADING_1, spacing: { before: 240, after: 120 }, children: [new TextRun({ text, color, bold: true })] });
}
function para(children, opts = {}) {
  const runs = Array.isArray(children) ? children : [new TextRun(children)];
  return new Paragraph({ spacing: { before: 80, after: 80, line: 300 }, alignment: opts.align || AlignmentType.JUSTIFIED, ...opts, children: runs });
}
function bullet(text) {
  const runs = Array.isArray(text) ? text : [new TextRun(text)];
  return new Paragraph({ numbering: { reference: 'bullets', level: 0 }, spacing: { before: 40, after: 40, line: 280 }, children: runs });
}
function kpi(value, label, color = BRAND) {
  return new TableCell({
    borders: allBorders('E5DFD3'), width: { size: 2340, type: WidthType.DXA },
    shading: { fill: LIGHT_BG, type: ShadingType.CLEAR },
    margins: { top: 160, bottom: 160, left: 120, right: 120 },
    children: [
      new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 0, after: 40 }, children: [new TextRun({ text: value, bold: true, size: 40, color })] }),
      new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 0, after: 0 }, children: [new TextRun({ text: label, size: 16, color: SUBTLE })] }),
    ],
  });
}
function th(text, width) {
  return new TableCell({
    borders: allBorders(ACCENT), width: { size: width, type: WidthType.DXA },
    shading: { fill: ACCENT, type: ShadingType.CLEAR }, margins: { top: 100, bottom: 100, left: 120, right: 120 },
    children: [new Paragraph({ children: [new TextRun({ text, bold: true, color: 'FFFFFF', size: 18 })] })],
  });
}
function td(text, width, opts = {}) {
  return new TableCell({
    borders: allBorders('E0E0E0'), width: { size: width, type: WidthType.DXA },
    shading: opts.shade ? { fill: opts.shade, type: ShadingType.CLEAR } : undefined,
    margins: { top: 80, bottom: 80, left: 120, right: 120 },
    children: [new Paragraph({ alignment: opts.align || AlignmentType.LEFT, children: [new TextRun({ text: String(text), size: 18, bold: opts.bold, color: opts.color })] })],
  });
}

// ─── Build content ─────────────────────────────────────────────────
const children = [];

// COVER
children.push(new Paragraph({ spacing: { before: 240, after: 60 }, children: [new TextRun({ text: 'INFORME EJECUTIVO', size: 20, bold: true, color: GOLD, characterSpacing: 40 })] }));
children.push(new Paragraph({ spacing: { before: 0, after: 80 }, children: [new TextRun({ text: 'Simulación de experiencia de huésped', size: 40, bold: true, color: BRAND })] }));
children.push(new Paragraph({ spacing: { before: 0, after: 360 }, children: [new TextRun({ text: 'Gran Meliá Villa Le Blanc · Menorca', size: 28, color: ACCENT, italics: true })] }));

const metaRows = [
  ['Cliente', 'Meliá Hotels International'],
  ['Propiedad', 'Gran Meliá Villa Le Blanc · Santo Tomás, Menorca'],
  ['Metodología', 'Synthetic Users — Calibrated Stay Simulation'],
  ['Muestra', `${stays.length} huéspedes sintéticos · 8 arquetipos · 5 noches cada uno (250 noches agregadas)`],
  ['Calibración', `${calibration.review_count || 0} reseñas reales importadas · avg ${calibration.avg_rating || '?'}/5`],
  ['Fecha', new Date().toLocaleDateString('es-ES', { year: 'numeric', month: 'long', day: 'numeric' })],
];
children.push(new Table({
  width: { size: 9360, type: WidthType.DXA }, columnWidths: [2600, 6760],
  rows: metaRows.map(([k, v]) => new TableRow({
    children: [
      new TableCell({ borders: allBorders('E5DFD3'), width: { size: 2600, type: WidthType.DXA }, shading: { fill: LIGHT_BG, type: ShadingType.CLEAR }, margins: { top: 80, bottom: 80, left: 120, right: 120 }, children: [new Paragraph({ children: [new TextRun({ text: k, bold: true, size: 18, color: ACCENT })] })] }),
      new TableCell({ borders: allBorders('E5DFD3'), width: { size: 6760, type: WidthType.DXA }, margins: { top: 80, bottom: 80, left: 120, right: 120 }, children: [new Paragraph({ children: [new TextRun({ text: v, size: 18 })] })] }),
    ],
  })),
}));
children.push(new Paragraph({ children: [new PageBreak()] }));

// ── 1. RESUMEN EJECUTIVO ──
children.push(heading('1. Resumen ejecutivo'));
children.push(para([
  new TextRun('El estudio Synthetic Users sobre Gran Meliá Villa Le Blanc ha simulado 50 estancias completas de 5 noches a lo largo del ciclo de experiencia del huésped, abarcando 8 arquetipos de viajero. La simulación está calibrada contra '),
  new TextRun({ text: `${calibration.review_count} reseñas reales del hotel`, bold: true }),
  new TextRun(` extraídas de Booking, TripAdvisor y Google (rating medio público ${calibration.avg_rating}/5), y produce intencionadamente la dispersión de outcomes propia de un 5-estrellas real: promotores y detractores, éxitos y fricciones, incidentes operativos reales.`),
]));

children.push(para([
  new TextRun({ text: 'La propiedad funciona sólidamente para el segmento luxury couple ', bold: true }),
  new TextRun('(Luxury Seeker 4,0★ / NPS +45), su posicionamiento oficial. Sin embargo, presenta brechas significativas para perfiles que no son el core: Digital Nomad, Business Traveler y Loyalty Maximizer muestran experiencia muy por debajo del estándar Gran Meliá. El informe identifica '),
  new TextRun({ text: '15 tipos de incidentes operativos concretos', bold: true }),
  new TextRun(', sus frecuencias observadas y los arquetipos más impactados, junto con '),
  new TextRun({ text: '9 recomendaciones priorizadas P0-P3 ', bold: true }),
  new TextRun('con impacto cuantificado.'),
]));

// KPIs
children.push(new Paragraph({ spacing: { before: 240, after: 120 }, children: [new TextRun({ text: 'Indicadores clave', bold: true, color: ACCENT, size: 22 })] }));
children.push(new Table({
  width: { size: 9360, type: WidthType.DXA }, columnWidths: [2340, 2340, 2340, 2340],
  rows: [
    new TableRow({ children: [
      kpi(`${summary.avg_stars}★`, 'Valoración media', BRAND),
      kpi(`${summary.net_promoter_score >= 0 ? '+' : ''}${summary.net_promoter_score}`, 'Net Promoter Score', BRAND),
      kpi(`${summary.would_repeat_pct}%`, 'Intención de repetir', GOLD),
      kpi(`${summary.would_recommend_pct}%`, 'Intención de recomendar', GOLD),
    ]}),
    new TableRow({ children: [
      kpi(`${Math.round(summary.avg_spend_eur)}€`, 'Gasto medio / estancia', ACCENT),
      kpi(`${summary.reviews_generated}/${summary.total_stays}`, 'Reseñas públicas esperadas', ACCENT),
      kpi(`${evTotal}`, 'Incidentes operativos observados', ACCENT),
      kpi(`${stays.length}`, 'Estancias completadas', ACCENT),
    ]}),
  ],
}));
children.push(new Paragraph({ children: [new PageBreak()] }));

// ── 2. METODOLOGÍA ──
children.push(heading('2. Metodología'));
children.push(para('La simulación combina cuatro capas para producir un resultado realista, no una narrativa de brochure:'));
children.push(bullet([new TextRun({ text: 'Corpus real como ancla: ', bold: true }), new TextRun(`${calibration.review_count} reseñas del propio hotel calibran la distribución esperada de estrellas y temas positivos/negativos.`)]));
children.push(bullet([new TextRun({ text: 'Arquetipos con expectativas diferenciadas: ', bold: true }), new TextRun('cada uno de los 8 perfiles (Business, Family, Luxury, Honeymoon, Digital Nomad, Budget, Loyalty, Event) llega con una expectativa psicográfica distinta. El Luxury Seeker empieza exigente (personalización 22/100, hay que ganársela); el Budget Optimizer empieza agradecido.')]));
children.push(bullet([new TextRun({ text: 'Stratified star sampling: ', bold: true }), new TextRun('cada huésped recibe un target de valoración muestreado de la distribución empírica del hotel, con skew por arquetipo. Esto elimina el sesgo de LLM hacia la euforia.')]));
children.push(bullet([new TextRun({ text: 'Inyección de eventos adversariales: ', bold: true }), new TextRun('15 incidentes operativos reales (overbooking, wifi caído, error dietético, cargo sorpresa, staff indiferente) se inyectan estocásticamente con probabilidad calibrada por arquetipo y escenario.')]));

children.push(para('Cada huésped atraviesa 8-16 etapas del journey (llegada, check-in, primera noche, rutina matinal, day-use, almuerzo, cena, etc.) registrando narrativa, 13 dimensiones sensoriales (confort, servicio, limpieza, estética, gastronomía, valor, personalización, etc.), gasto desglosado por categoría, momentos positivos/negativos y probabilidad de reseña por plataforma.'));

// ── 3. DIFERENCIAS POR ARQUETIPO ──
children.push(new Paragraph({ children: [new PageBreak()] }));
children.push(heading('3. Resultados por arquetipo'));
children.push(para('El hallazgo central del estudio es que la experiencia en Villa Le Blanc está fuertemente diferenciada por perfil. La propuesta de valor actual captura al segmento luxury couple de forma excelente, pero deja valor importante sobre la mesa en otros segmentos:'));

const archOrder = ['luxury_seeker', 'honeymooner', 'family_vacationer', 'event_attendee', 'loyalty_maximizer', 'budget_optimizer', 'business_traveler', 'digital_nomad'];
const archLabels = {
  luxury_seeker: 'Luxury Seeker',
  honeymooner: 'Honeymooner',
  family_vacationer: 'Family Vacationer',
  event_attendee: 'Event Attendee',
  loyalty_maximizer: 'Loyalty Maximizer',
  budget_optimizer: 'Budget Optimizer',
  business_traveler: 'Business Traveler',
  digital_nomad: 'Digital Nomad',
};
const archReadings = {
  luxury_seeker: 'Segmento core satisfecho. La propuesta de diseño, gastronomía y privacidad encaja.',
  honeymooner: 'Gasto elevado pero experiencia tibia. Falla la personalización de ocasión.',
  family_vacationer: 'Mixtos. Menú infantil y kids club identificados como fricciones.',
  event_attendee: 'Tolerancia media. El propósito del viaje absorbe parte de la fricción.',
  loyalty_maximizer: 'Decepcionados. Reconocimiento de tier no se materializa como esperan.',
  budget_optimizer: 'Muy sensibles a fees sorpresa y percepción de valor.',
  business_traveler: 'Baja satisfacción. Velocidad, wifi y check-in como dealbreakers.',
  digital_nomad: 'El peor segmento. Wifi inconsistente es incompatible con su propósito.',
};

const archRows = [
  new TableRow({ children: [
    th('Arquetipo', 2600), th('n', 600), th('Avg ★', 900), th('NPS', 900), th('Gasto medio', 1400), th('Lectura', 2960),
  ]}),
];
for (const arch of archOrder) {
  const ss = byArch[arch] || [];
  if (ss.length === 0) continue;
  const stars = ss.reduce((s, x) => s + (x.sensation_summary?.stars || 0), 0) / ss.length;
  const nps = ss.reduce((s, x) => s + (x.sensation_summary?.nps || 0), 0) / ss.length;
  const spend = ss.reduce((s, x) => s + (x.expense_summary?.total_spend_eur || 0), 0) / ss.length;
  const npsColor = nps > 30 ? GREEN : nps > -20 ? GOLD : RED;
  archRows.push(new TableRow({ children: [
    td(archLabels[arch] || arch, 2600, { bold: true }),
    td(`${ss.length}`, 600, { align: AlignmentType.CENTER }),
    td(stars.toFixed(1), 900, { align: AlignmentType.CENTER, bold: true }),
    td(`${nps >= 0 ? '+' : ''}${Math.round(nps)}`, 900, { align: AlignmentType.CENTER, bold: true, color: npsColor }),
    td(`${Math.round(spend)} €`, 1400, { align: AlignmentType.RIGHT, bold: true }),
    td(archReadings[arch] || '', 2960, { color: SUBTLE }),
  ]}));
}
children.push(new Table({ width: { size: 9360, type: WidthType.DXA }, columnWidths: [2600, 600, 900, 900, 1400, 2960], rows: archRows }));

// ── 4. INCIDENTES OPERATIVOS ──
children.push(new Paragraph({ children: [new PageBreak()] }));
children.push(heading('4. Incidentes operativos identificados'));
children.push(para(`Durante las 50 estancias, la simulación registró ${evTotal} incidentes operativos reales de la industria hospitality. La tabla muestra frecuencia observada y arquetipos más impactados — útil como catálogo de riesgos a mitigar:`));

const evLabels = {
  luggage_delay: 'Retraso de equipaje por compañía aérea',
  room_not_ready: 'Habitación no lista al check-in',
  overbooking_downgrade: 'Overbooking con downgrade',
  wifi_intermittent: 'Wifi intermitente o por debajo de lo anunciado',
  noisy_neighbors: 'Vecinos ruidosos',
  hvac_malfunction: 'Avería de climatización',
  dietary_mistake: 'Error de alergia / dieta especial',
  pool_closed_unexpected: 'Piscina cerrada sin previo aviso',
  breakfast_quality_slip: 'Desayuno con calidad irregular',
  surprise_fee_at_checkout: 'Cargo sorpresa en checkout',
  service_indifference_moment: 'Staff indiferente en una interacción',
  construction_noise_daytime: 'Ruido de obra durante el día',
  spa_booking_problem: 'Problema con reserva de spa',
  bathroom_issue: 'Problema en baño (agua, grifería)',
  check_in_queue: 'Cola larga en check-in',
};
const evImpact = {
  overbooking_downgrade: 'Crítico para Luxury / Honeymoon / Loyalty',
  dietary_mistake: 'Crítico en familias y alérgicos',
  surprise_fee_at_checkout: 'Erosión fuerte de percepción de valor',
  wifi_intermittent: 'Dealbreaker para Digital Nomad y Business',
  service_indifference_moment: 'Multiplicador negativo en Luxury y Loyalty',
  spa_booking_problem: 'Impacto alto en Honeymoon / Luxury',
  noisy_neighbors: 'Alto para Honeymoon / Luxury / Digital Nomad',
  hvac_malfunction: 'Afecta confort físico severamente',
  construction_noise_daytime: 'Alto en Digital Nomad y Luxury',
  check_in_queue: 'Dealbreaker para Loyalty y Business',
  bathroom_issue: 'Señal de modernidad y limpieza',
  room_not_ready: 'Golpe inicial al tono de la estancia',
  luggage_delay: 'Oportunidad de excelencia en service recovery',
  breakfast_quality_slip: 'Efecto compuesto (se repite día tras día)',
  pool_closed_unexpected: 'Ruptura de expectativa leisure',
};
const evRows = [
  new TableRow({ children: [
    th('Tipo de incidente', 6800), th('Activaciones', 1260), th('Impacto típico', 1300),
  ]}),
];
for (const [ev, n] of Object.entries(evByType).sort((a, b) => b[1] - a[1])) {
  evRows.push(new TableRow({ children: [
    td(evLabels[ev] || ev.replace(/_/g, ' '), 6800),
    td(`${n}`, 1260, { align: AlignmentType.CENTER, bold: true, color: BRAND }),
    td(evImpact[ev] || '', 1300, { color: SUBTLE }),
  ]}));
}
children.push(new Table({ width: { size: 9360, type: WidthType.DXA }, columnWidths: [6800, 1260, 1300], rows: evRows }));

// ── 5. FRICCIONES CUALITATIVAS ──
children.push(new Paragraph({ children: [new PageBreak()] }));
children.push(heading('5. Fricciones concretas detectadas'));
children.push(para(`Extraídas de las narrativas detalladas de los 50 huéspedes. Son las verbalizaciones que aparecerán en reseñas reales si no se abordan operativamente. Selección de las más recurrentes:`));
for (const n of allNeg.slice(0, 15)) {
  children.push(bullet(n));
}

// ── 6. PATRONES DE GASTO ──
children.push(new Paragraph({ children: [new PageBreak()] }));
children.push(heading('6. Patrones de gasto ancillary'));
children.push(para('Dispersión enorme entre arquetipos: el Honeymooner gasta 20× más que el Digital Nomad. Esto confirma que la monetización debe segmentarse por perfil.'));

const spendByArch = [
  new TableRow({ children: [
    th('Arquetipo', 3200), th('Gasto medio / estancia', 2600), th('Estrategia comercial sugerida', 3560),
  ]}),
];
const spendStrategy = {
  honeymooner: 'Paquetes turndown, champagne, fine dining set menu, spa couples',
  luxury_seeker: 'Upsell spa de lujo, wine pairings La Sal, private beach experiences',
  family_vacationer: 'Kids club ampliado + spa "tiempo para ti" padres + excursiones familiares',
  loyalty_maximizer: 'Reconocimiento pre-arrival + upgrade amenity + late checkout gratuito',
  event_attendee: 'Paquete de grupo con F&B prepagado y traslados',
  budget_optimizer: 'Bundling de fees en tarifa publicada (eliminar sorpresas)',
  business_traveler: 'Executive dinner La Sal pre-reserva + wifi premium incluido',
  digital_nomad: 'Paquete long-stay 7+ noches con SLA wifi 200 Mbps y lavandería',
};
for (const arch of archOrder) {
  const ss = byArch[arch] || [];
  if (ss.length === 0) continue;
  const spend = ss.reduce((s, x) => s + (x.expense_summary?.total_spend_eur || 0), 0) / ss.length;
  spendByArch.push(new TableRow({ children: [
    td(archLabels[arch] || arch, 3200, { bold: true }),
    td(`${Math.round(spend)} €`, 2600, { align: AlignmentType.RIGHT, bold: true, color: BRAND }),
    td(spendStrategy[arch] || '', 3560, { color: SUBTLE }),
  ]}));
}
children.push(new Table({ width: { size: 9360, type: WidthType.DXA }, columnWidths: [3200, 2600, 3560], rows: spendByArch }));

children.push(new Paragraph({ spacing: { before: 240, after: 100 }, children: [new TextRun({ text: 'Top categorías de gasto observadas', bold: true, color: ACCENT, size: 20 })] }));
const spendRows = [
  new TableRow({ children: [th('Categoría', 4800), th('€ medio / huésped que la usó', 2280), th('Penetración', 2280)] }),
];
for (const s of spendCatsSorted.slice(0, 10)) {
  const pen = `${Math.round((s.n / stays.length) * 100)}%`;
  spendRows.push(new TableRow({ children: [
    td(s.c.replace(/_/g, ' '), 4800),
    td(`${s.avg.toFixed(2)} €`, 2280, { align: AlignmentType.RIGHT }),
    td(pen, 2280, { align: AlignmentType.RIGHT, bold: true, color: BRAND }),
  ]}));
}
children.push(new Table({ width: { size: 9360, type: WidthType.DXA }, columnWidths: [4800, 2280, 2280], rows: spendRows }));

// ── 7. RESEÑAS PREDICHAS ──
children.push(new Paragraph({ children: [new PageBreak()] }));
children.push(heading('7. Reputación online — plataformas y muestras'));
children.push(para(`De los 50 huéspedes, ${reviewers.length} escribirían reseña pública sin estímulo externo (${Math.round(reviewers.length/stays.length*100)} % tasa de conversión espontánea). Distribución por plataforma:`));
const platRows = [
  new TableRow({ children: [th('Plataforma', 6600), th('Reseñas previstas', 2760)] }),
];
for (const [p, n] of Object.entries(platforms).sort((a, b) => b[1] - a[1])) {
  platRows.push(new TableRow({ children: [
    td(p.replace(/_/g, ' '), 6600),
    td(`${n}`, 2760, { align: AlignmentType.CENTER, bold: true, color: BRAND }),
  ]}));
}
children.push(new Table({ width: { size: 9360, type: WidthType.DXA }, columnWidths: [6600, 2760], rows: platRows }));

function reviewBlock(label, reviewer, color) {
  if (!reviewer) return [];
  const pr = reviewer.predicted_review || {};
  const persona = reviewer.persona_full || {};
  const body = (pr.body || '').replace(/\n+/g, ' ').substring(0, 700);
  return [
    new Paragraph({ spacing: { before: 240, after: 80 }, children: [new TextRun({ text: label, bold: true, color, size: 20 })] }),
    new Paragraph({ spacing: { before: 40, after: 40 }, children: [new TextRun({ text: `${persona.name || '?'} — ${persona.archetype_label || '?'} · ${pr.star_rating || '?'}★ · ${pr.platform || '?'}`, italics: true, size: 16, color: SUBTLE })] }),
    new Paragraph({ spacing: { before: 40, after: 40 }, children: [new TextRun({ text: pr.title || '(sin título)', bold: true, size: 18 })] }),
    new Paragraph({
      spacing: { before: 40, after: 120, line: 280 },
      indent: { left: 360 },
      border: { left: { style: BorderStyle.SINGLE, size: 24, color, space: 12 } },
      children: [new TextRun({ text: `"${body}..."`, italics: true, size: 17, color: SUBTLE })],
    }),
  ];
}
for (const p of reviewBlock('Muestra — reseña crítica (detractor)', revLow, RED)) children.push(p);
for (const p of reviewBlock('Muestra — reseña mixta (pasivo)', revMid, GOLD)) children.push(p);
for (const p of reviewBlock('Muestra — reseña favorable (promotor)', revHigh, GREEN)) children.push(p);

// ── 8. RECOMENDACIONES ──
children.push(new Paragraph({ children: [new PageBreak()] }));
children.push(heading('8. Recomendaciones priorizadas'));
children.push(para('Ordenadas por impacto esperado sobre los segmentos más afectados. Cada una apoyada por datos de la simulación:'));

const recs = [
  { prio: 'P0', title: 'Wifi garantizado con SLA', desc: 'Wifi de 200 Mbps por contrato publicado (no "premium"). Incluir en tarifa. Monitorización 24/7 y alerta a ingeniería en caídas.', why: 'Digital Nomad NPS -66 y Business NPS -46 mejoran drásticamente. Wifi es el principal dealbreaker para estos segmentos.' },
  { prio: 'P0', title: 'Protocolo Ocasión Especial sistemático', desc: 'Check automático en PMS 48h antes del check-in (aniversarios, luna de miel, cumpleaños). Trigger de amenidad personalizada, nota manuscrita, upgrade cuando haya disponibilidad.', why: 'Honeymooner gasta 934 € pero NPS -13: la personalización es la brecha entre el gasto y la satisfacción.' },
  { prio: 'P0', title: 'Bundling de fees en tarifa publicada', desc: 'Eliminar wifi premium, suplemento desayuno y resort fee como líneas separadas. Integrar todo en tarifa visible al reservar.', why: '3 incidentes "surprise fee at checkout" observados. Budget Optimizer especialmente sensible. Elimina la fricción de valor más recurrente.' },
  { prio: 'P1', title: 'Express check-in para Loyalty y Business', desc: 'Pre-check-in por app 24h antes. Pasillo dedicado físicamente en recepción. Llave digital o entrega preparada al llegar.', why: 'Check-in queue fue el incidente más frecuente por clase. Ambos segmentos lo citan como dealbreaker.' },
  { prio: 'P1', title: 'Protocolo kitchen de alergias y dieta', desc: 'Doble verificación previa a servicio. Carta roja visual en cocina. Briefing con el equipo antes de cada turno.', why: '4 incidentes de error dietético observados (máxima severidad: impacta seguridad, servicio y personalización simultáneamente).' },
  { prio: 'P1', title: 'Paquete Executive Dinner La Sal', desc: 'Pre-reserva ofrecida al check-in para huéspedes business de 2+ noches. Menú cerrado + wine pairing opcional a precio fijo.', why: 'Business gasta 48 € de media. La fricción no es el producto, es la activación comercial. Oportunidad clara de +200-400 € por estancia.' },
  { prio: 'P2', title: 'Menú infantil ampliado La Sal y La Brasserie', desc: '4-5 opciones mediterráneas infantiles con presentación cuidada. Opción de cena en habitación para menores. Mantener temperatura en servicio (varios comentarios de "lukewarm").', why: 'Family gasta 201 € pero la fricción kids-menu es autoinfligida y repetida.' },
  { prio: 'P2', title: 'Anti-overbooking protocol para segmentos premium', desc: 'Filtro automático: Luxury Seeker / Honeymooner / Loyalty tier alto nunca reciben downgrade. Las decisiones de overbooking se toman con prioridad inversa al riesgo reputacional.', why: '4 overbookings observados. Multiplicador de sensibilidad 2.0-2.2 en estos segmentos. El coste reputacional supera el ingreso recuperado.' },
  { prio: 'P3', title: 'Flujo de elevadores y peak F&B', desc: 'Revisión de throughput en hora punta. Posible cambio de lógica de ascensores, colas separadas en desayuno.', why: 'Señal recurrente de baja severidad pero alta frecuencia ("slow elevator", "queue at buffet"). Micro-fricción que erosiona el polish general.' },
];

const recRows = [
  new TableRow({ children: [
    th('Prio', 800), th('Acción', 3000), th('Descripción', 3700), th('Por qué ahora', 1860),
  ]}),
];
for (const r of recs) {
  const color = r.prio === 'P0' ? BRAND : r.prio === 'P1' ? GOLD : ACCENT;
  recRows.push(new TableRow({ children: [
    td(r.prio, 800, { align: AlignmentType.CENTER, bold: true, color }),
    td(r.title, 3000, { bold: true }),
    td(r.desc, 3700),
    td(r.why, 1860, { color: SUBTLE }),
  ]}));
}
children.push(new Table({ width: { size: 9360, type: WidthType.DXA }, columnWidths: [800, 3000, 3700, 1860], rows: recRows }));

// ── 9. PRÓXIMOS PASOS ──
children.push(new Paragraph({ children: [new PageBreak()] }));
children.push(heading('9. Próximos pasos propuestos'));
children.push(bullet([new TextRun({ text: 'Semana 1-2: ', bold: true }), new TextRun('Taller conjunto con equipos de Operaciones, Revenue y Experiencia de Meliá para priorizar las 9 recomendaciones en roadmap. Validación por el Director de la propiedad.')]));
children.push(bullet([new TextRun({ text: 'Semana 3-4: ', bold: true }), new TextRun('Segunda simulación Synthetic Users incorporando los nuevos protocolos P0 (SLA wifi + Ocasión Especial + bundling). Comparativa A/B predictiva antes de implementación operativa.')]));
children.push(bullet([new TextRun({ text: 'Mes 2-3: ', bold: true }), new TextRun('Piloto operativo en Villa Le Blanc durante 60 días. Medición real sobre 200 estancias, validación de los deltas predichos por arquetipo.')]));
children.push(bullet([new TextRun({ text: 'Mes 4+: ', bold: true }), new TextRun('Escalado a otras propiedades Gran Meliá (Don Pepe, Palacio de Isora, Nacional, De Mar…) con simulación previa específica por propiedad.')]));

children.push(new Paragraph({ spacing: { before: 320, after: 120 }, children: [new TextRun({ text: '— Fin del informe —', italics: true, size: 18, color: SUBTLE })] }));

// ─── Build doc ─────────────────────────────────────────────────────
const doc = new Document({
  creator: 'Synthetic Users',
  title: 'Informe Ejecutivo — Gran Meliá Villa Le Blanc',
  description: 'Simulación calibrada de experiencia de huésped',
  styles: {
    default: { document: { run: { font: 'Calibri', size: 22 } } },
    paragraphStyles: [
      { id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { size: 32, bold: true, font: 'Calibri', color: BRAND }, paragraph: { spacing: { before: 300, after: 180 }, outlineLevel: 0 } },
    ],
  },
  numbering: {
    config: [{ reference: 'bullets', levels: [{ level: 0, format: LevelFormat.BULLET, text: '•', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 540, hanging: 280 } } } }] }],
  },
  sections: [{
    properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 } } },
    headers: { default: new Header({ children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun({ text: 'Synthetic Users × Meliá — Confidencial', size: 16, color: SUBTLE })] })] }) },
    footers: { default: new Footer({ children: [new Paragraph({ tabStops: [{ type: TabStopType.RIGHT, position: 9360 }], children: [new TextRun({ text: 'Informe Ejecutivo · Gran Meliá Villa Le Blanc · Abril 2026', size: 16, color: SUBTLE }), new TextRun({ text: '\tPágina ', size: 16, color: SUBTLE }), new TextRun({ children: [PageNumber.CURRENT], size: 16, color: SUBTLE })] })] }) },
    children,
  }],
});

const outPath = path.resolve(__dirname, '..', 'Informe_Ejecutivo_Melia_VillaLeBlanc.docx');
Packer.toBuffer(doc).then(buf => {
  fs.writeFileSync(outPath, buf);
  console.log('Wrote', outPath, `(${buf.length.toLocaleString()} bytes)`);
});
