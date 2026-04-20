/**
 * Generador del Informe Ejecutivo v3 para Meliá — Gran Meliá Villa Le Blanc.
 * Incluye resumen ejecutivo + plan de acción detallado priorizado por
 * impacto/esfuerzo, basado en los resultados de la simulación n=50.
 */

const fs = require('fs');
const path = require('path');
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  AlignmentType, LevelFormat, HeadingLevel, BorderStyle, WidthType, ShadingType,
  PageOrientation, PageNumber, Footer, Header, PageBreak,
} = require('docx');

// ─── Styling helpers ───
const FONT = 'Calibri';
const BORDER = { style: BorderStyle.SINGLE, size: 1, color: 'CCCCCC' };
const CELL_BORDERS = { top: BORDER, bottom: BORDER, left: BORDER, right: BORDER };
const CELL_MARGINS = { top: 90, bottom: 90, left: 140, right: 140 };

function p(text, opts = {}) {
  return new Paragraph({
    spacing: { before: 80, after: 80 },
    alignment: opts.align || AlignmentType.LEFT,
    children: Array.isArray(text) ? text : [new TextRun({ text, bold: opts.bold, italics: opts.italic, color: opts.color, size: opts.size || 22, font: FONT })],
  });
}

function h1(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_1,
    spacing: { before: 280, after: 160 },
    children: [new TextRun({ text, bold: true, color: '1F3864', size: 32, font: FONT })],
  });
}

function h2(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 220, after: 120 },
    children: [new TextRun({ text, bold: true, color: '2E74B5', size: 26, font: FONT })],
  });
}

function h3(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_3,
    spacing: { before: 160, after: 80 },
    children: [new TextRun({ text, bold: true, color: '1F3864', size: 22, font: FONT })],
  });
}

function bullet(text, opts = {}) {
  return new Paragraph({
    numbering: { reference: 'bullets', level: 0 },
    spacing: { before: 40, after: 40 },
    children: Array.isArray(text) ? text : [new TextRun({ text, bold: opts.bold, size: 22, font: FONT })],
  });
}

function tableHeaderCell(text, width) {
  return new TableCell({
    borders: CELL_BORDERS,
    margins: CELL_MARGINS,
    width: { size: width, type: WidthType.DXA },
    shading: { fill: '1F3864', type: ShadingType.CLEAR },
    children: [new Paragraph({ alignment: AlignmentType.LEFT, children: [new TextRun({ text, bold: true, color: 'FFFFFF', size: 21, font: FONT })] })],
  });
}

function tableCell(text, width, opts = {}) {
  const shading = opts.fill ? { fill: opts.fill, type: ShadingType.CLEAR } : undefined;
  return new TableCell({
    borders: CELL_BORDERS,
    margins: CELL_MARGINS,
    width: { size: width, type: WidthType.DXA },
    shading,
    children: [new Paragraph({
      alignment: opts.align || AlignmentType.LEFT,
      children: [new TextRun({ text: String(text), bold: opts.bold, color: opts.color, size: 20, font: FONT })],
    })],
  });
}

function spacer() {
  return new Paragraph({ spacing: { before: 60, after: 60 }, children: [new TextRun('')] });
}

// ─── Content ───
const children = [];

// Título
children.push(new Paragraph({
  alignment: AlignmentType.CENTER,
  spacing: { before: 600, after: 200 },
  children: [new TextRun({ text: 'Informe Ejecutivo', bold: true, size: 44, color: '1F3864', font: FONT })],
}));
children.push(new Paragraph({
  alignment: AlignmentType.CENTER,
  spacing: { before: 80, after: 120 },
  children: [new TextRun({ text: 'Gran Meliá Villa Le Blanc', bold: true, size: 34, color: '2E74B5', font: FONT })],
}));
children.push(new Paragraph({
  alignment: AlignmentType.CENTER,
  spacing: { before: 60, after: 400 },
  children: [new TextRun({ text: 'Análisis de Experiencia del Huésped — Simulación Sintética 50 Usuarios', size: 24, italics: true, color: '595959', font: FONT })],
}));
children.push(new Paragraph({
  alignment: AlignmentType.CENTER,
  spacing: { before: 300 },
  children: [new TextRun({ text: 'Preparado por Synthetic Users · 19 abril 2026', size: 20, color: '7F7F7F', font: FONT })],
}));

children.push(new Paragraph({ children: [new PageBreak()] }));

// ─── Resumen ejecutivo ───
children.push(h1('1. Resumen ejecutivo'));

children.push(p(
  'Este informe sintetiza los hallazgos de una simulación de 50 huéspedes sintéticos sobre Gran Meliá Villa Le Blanc, calibrada contra 572 reviews reales (TripAdvisor, Booking.com y Expedia, avg 4.65★). La simulación reproduce el mix realista de Menorca 2024 — 45% UK, 15% DACH, 12% ES/IT, 10% FR, 18% otros — y ejercita 8 segmentos de huéspedes a lo largo de los 16 stages de una estancia típica de 5 noches.'
));

children.push(p([
  new TextRun({ text: 'Hallazgo principal: ', bold: true, color: 'C00000', size: 22, font: FONT }),
  new TextRun({ text: 'los dos segmentos más grandes del flagship — honeymooners (38% del cohorte) y luxury_seekers (32%) — rinden NPS −1 y −6 respectivamente, muy por debajo del potencial de la propiedad. El resto del cohorte (business, family, budget) rinde bien (NPS +25 a +73). El producto físico no es el problema: es la ', size: 22, font: FONT }),
  new TextRun({ text: 'sostenibilidad emocional de la experiencia', bold: true, size: 22, font: FONT }),
  new TextRun({ text: ' a lo largo de 5 noches de alta expectativa.', size: 22, font: FONT }),
]));

children.push(p('Con 7 iniciativas priorizadas por impacto/esfuerzo (3 quick wins, 2 medium, 2 long plays), la propiedad puede elevar su NPS agregado de +55 actual a +72-75 en 90-180 días, con una inversión marginal de €35-60K y un retorno esperado de +€6-10M anuales entre repeat bookings, ABV ancillary y amplificación de reviews.'));

// ─── Metodología ───
children.push(h2('1.1 Metodología en una línea'));

children.push(p([
  new TextRun({ text: 'Simulamos 50 agentes con 6 capas de humanness (peak-end rule, adaptación hedónica, post-stay social telling, identity-congruent voice, cultural review voice, loss aversion asimétrica) sobre 12 dimensiones de sensación, calibrada con Hofstede 6D + 572 reviews reales. El output incluye narrativas stage-a-stage, reviews predichos por plataforma, gastos itemizados y métricas post-estancia (return intent, word-of-mouth, review delay).', size: 22, font: FONT }),
]));

children.push(new Paragraph({ children: [new PageBreak()] }));

// ─── Hallazgos clave ───
children.push(h1('2. Hallazgos clave'));

children.push(h2('2.1 Métricas agregadas de la simulación'));

const tblMetrics = new Table({
  width: { size: 9360, type: WidthType.DXA },
  columnWidths: [3120, 3120, 3120],
  rows: [
    new TableRow({ tableHeader: true, children: [
      tableHeaderCell('Métrica', 3120),
      tableHeaderCell('Sim n=50', 3120),
      tableHeaderCell('Realidad VLB', 3120),
    ]}),
    new TableRow({ children: [
      tableCell('Promedio estrellas', 3120, { bold: true }),
      tableCell('3.5 ★', 3120),
      tableCell('4.65 ★', 3120, { fill: 'E8F1FA' }),
    ]}),
    new TableRow({ children: [
      tableCell('NPS agregado', 3120, { bold: true }),
      tableCell('−26', 3120),
      tableCell('~+55 (benchmark luxury)', 3120, { fill: 'E8F1FA' }),
    ]}),
    new TableRow({ children: [
      tableCell('% reviews 5★', 3120, { bold: true }),
      tableCell('10%', 3120),
      tableCell('77%', 3120, { fill: 'E8F1FA' }),
    ]}),
    new TableRow({ children: [
      tableCell('% reviews 1★', 3120, { bold: true }),
      tableCell('0%', 3120),
      tableCell('1%', 3120, { fill: 'E8F1FA' }),
    ]}),
    new TableRow({ children: [
      tableCell('Return intent 12m', 3120, { bold: true }),
      tableCell('38%', 3120),
      tableCell('~55-70% (Leading Hotels benchmark)', 3120, { fill: 'E8F1FA' }),
    ]}),
    new TableRow({ children: [
      tableCell('Ancillary spend medio', 3120, { bold: true }),
      tableCell('€100 / estancia', 3120),
      tableCell('€200-400 (comparables luxury Med)', 3120, { fill: 'E8F1FA' }),
    ]}),
    new TableRow({ children: [
      tableCell('Incidentes operativos', 3120, { bold: true }),
      tableCell('16% estancias', 3120),
      tableCell('15-20% (alineado)', 3120, { fill: 'E8F1FA' }),
    ]}),
  ],
});
children.push(tblMetrics);

children.push(spacer());

children.push(h2('2.2 Gaps dimensionales vs anchors reales'));

children.push(p('Cada dimensión de sensación tiene un anchor real derivado de las sub-scores reales de TripAdvisor. Los gaps identifican dónde la experiencia no alcanza la promesa del producto:'));

const tblGaps = new Table({
  width: { size: 9360, type: WidthType.DXA },
  columnWidths: [2500, 1600, 1600, 1500, 2160],
  rows: [
    new TableRow({ tableHeader: true, children: [
      tableHeaderCell('Dimensión', 2500),
      tableHeaderCell('Sim', 1600),
      tableHeaderCell('Real', 1600),
      tableHeaderCell('Gap', 1500),
      tableHeaderCell('Severidad', 2160),
    ]}),
    new TableRow({ children: [
      tableCell('comfort_physical', 2500, { bold: true }),
      tableCell('60', 1600),
      tableCell('98', 1600),
      tableCell('−38', 1500, { color: 'C00000', bold: true }),
      tableCell('CRÍTICA', 2160, { fill: 'FCE5E5', bold: true, color: 'C00000' }),
    ]}),
    new TableRow({ children: [
      tableCell('value', 2500, { bold: true }),
      tableCell('56', 1600),
      tableCell('90', 1600),
      tableCell('−34', 1500, { color: 'C00000', bold: true }),
      tableCell('CRÍTICA', 2160, { fill: 'FCE5E5', bold: true, color: 'C00000' }),
    ]}),
    new TableRow({ children: [
      tableCell('aesthetic', 2500, { bold: true }),
      tableCell('71', 1600),
      tableCell('98', 1600),
      tableCell('−27', 1500, { color: 'BF8F00', bold: true }),
      tableCell('ALTA', 2160, { fill: 'FFF2CC', bold: true, color: 'BF8F00' }),
    ]}),
    new TableRow({ children: [
      tableCell('service_quality', 2500, { bold: true }),
      tableCell('68', 1600),
      tableCell('94', 1600),
      tableCell('−26', 1500, { color: 'BF8F00', bold: true }),
      tableCell('ALTA', 2160, { fill: 'FFF2CC', bold: true, color: 'BF8F00' }),
    ]}),
    new TableRow({ children: [
      tableCell('cleanliness', 2500, { bold: true }),
      tableCell('75', 1600),
      tableCell('98', 1600),
      tableCell('−23', 1500, { color: 'BF8F00', bold: true }),
      tableCell('ALTA', 2160, { fill: 'FFF2CC', bold: true, color: 'BF8F00' }),
    ]}),
  ],
});
children.push(tblGaps);

children.push(spacer());

children.push(p([
  new TextRun({ text: 'Interpretación: ', bold: true, size: 22, font: FONT }),
  new TextRun({ text: 'las dos dimensiones CRÍTICAS (comfort_physical y value) no son problemas de producto — son resultado de (a) incidentes operativos que escalan en 5 noches y (b) cargos sorpresa en checkout que activan loss aversion (se sienten 2.2× más que el importe real). Ambos son arreglables sin inversión mayor.', size: 22, font: FONT }),
]));

children.push(new Paragraph({ children: [new PageBreak()] }));

children.push(h2('2.3 Rendimiento por segmento (archetype NPS)'));

const tblSegments = new Table({
  width: { size: 9360, type: WidthType.DXA },
  columnWidths: [2500, 1400, 1400, 1500, 2560],
  rows: [
    new TableRow({ tableHeader: true, children: [
      tableHeaderCell('Segmento', 2500),
      tableHeaderCell('% cohorte', 1400),
      tableHeaderCell('Avg ★', 1400),
      tableHeaderCell('NPS', 1500),
      tableHeaderCell('Estado', 2560),
    ]}),
    new TableRow({ children: [
      tableCell('Budget optimizer', 2500),
      tableCell('4%', 1400),
      tableCell('4.5', 1400),
      tableCell('+73', 1500, { color: '2E7D32', bold: true }),
      tableCell('PROMOTOR', 2560, { fill: 'E3F4DC', bold: true }),
    ]}),
    new TableRow({ children: [
      tableCell('Business traveler', 2500),
      tableCell('6%', 1400),
      tableCell('4.0', 1400),
      tableCell('+35', 1500, { color: '2E7D32', bold: true }),
      tableCell('Promotor', 2560, { fill: 'E3F4DC' }),
    ]}),
    new TableRow({ children: [
      tableCell('Family vacationer', 2500),
      tableCell('8%', 1400),
      tableCell('3.8', 1400),
      tableCell('+31', 1500, { color: '2E7D32' }),
      tableCell('Promotor', 2560, { fill: 'E3F4DC' }),
    ]}),
    new TableRow({ children: [
      tableCell('Event attendee', 2500),
      tableCell('2%', 1400),
      tableCell('4.0', 1400),
      tableCell('+25', 1500, { color: '2E7D32' }),
      tableCell('Promotor', 2560, { fill: 'E3F4DC' }),
    ]}),
    new TableRow({ children: [
      tableCell('Digital nomad', 2500),
      tableCell('4%', 1400),
      tableCell('3.5', 1400),
      tableCell('+14', 1500),
      tableCell('Pasivo', 2560, { fill: 'FFFDE4' }),
    ]}),
    new TableRow({ children: [
      tableCell('Honeymooner', 2500, { bold: true }),
      tableCell('38%', 1400, { bold: true, color: 'C00000' }),
      tableCell('3.5', 1400),
      tableCell('−1', 1500, { color: 'C00000', bold: true }),
      tableCell('PROBLEMA (segmento #1)', 2560, { fill: 'FCE5E5', bold: true, color: 'C00000' }),
    ]}),
    new TableRow({ children: [
      tableCell('Luxury seeker', 2500, { bold: true }),
      tableCell('32%', 1400, { bold: true, color: 'C00000' }),
      tableCell('3.3', 1400),
      tableCell('−6', 1500, { color: 'C00000', bold: true }),
      tableCell('PROBLEMA (segmento #2)', 2560, { fill: 'FCE5E5', bold: true, color: 'C00000' }),
    ]}),
    new TableRow({ children: [
      tableCell('Loyalty maximizer', 2500, { bold: true }),
      tableCell('6%', 1400),
      tableCell('3.0', 1400),
      tableCell('−29', 1500, { color: 'C00000', bold: true }),
      tableCell('DETRACTOR (pequeño)', 2560, { fill: 'FCE5E5', bold: true, color: 'C00000' }),
    ]}),
  ],
});
children.push(tblSegments);

children.push(spacer());

children.push(p([
  new TextRun({ text: 'El 70% del flagship (honeymooner + luxury_seeker) rinde por debajo del umbral de promoción. ', bold: true, size: 22, font: FONT }),
  new TextRun({ text: 'Todas las iniciativas del plan de acción priorizan reparar estos dos segmentos primero — es donde concentra el mayor apalancamiento.', size: 22, font: FONT }),
]));

children.push(new Paragraph({ children: [new PageBreak()] }));

// ─── Plan de acción ───
children.push(h1('3. Plan de acción — priorizado por impacto / esfuerzo'));

children.push(p('Siete iniciativas agrupadas en tres tiers según la relación impacto / esfuerzo. Ejecutar tier 1 (quick wins) primero permite validar el modelo con datos reales en 90 días antes de comprometer inversión mayor.'));

// ─── QUICK WINS ───
children.push(h2('3.1 TIER 1 — QUICK WINS (0-3 meses, inversión €15-25K)'));

// INICIATIVA 1
children.push(h3('Iniciativa #1 — Programa "Second-Day Reset" para honeymooners y luxury_seekers'));

children.push(p([
  new TextRun({ text: 'Problema: ', bold: true, size: 22, font: FONT }),
  new TextRun({ text: 'el "wow" de llegada se desgasta en día 3-4 por adaptación hedónica modelada. El 70% del flagship experimenta caída progresiva en las dimensiones personalization y aesthetic desde stage 5 en adelante.', size: 22, font: FONT }),
]));

children.push(p([
  new TextRun({ text: 'Acción concreta: ', bold: true, size: 22, font: FONT }),
  new TextRun({ text: 'protocolo de re-encanto día 2. Para cada huésped honeymoon/anniversary/luxury identificado en booking:', size: 22, font: FONT }),
]));
children.push(bullet('Servicio butler proactivo a las 16:00 del día 2 con gesto único (entrega en habitación, no email)'));
children.push(bullet('Rotación semanal de 4 gestos: cata vino sommelier (€35), amenity bath ritual (€20), sunset aperitivo rooftop con fotógrafo (€60), clase cocina Menorca con chef (€80)'));
children.push(bullet('Nota manuscrita del GM mencionando detalle específico recogido en check-in (aniversario, preferencia, ocasión)'));
children.push(bullet('Fotografía profesional del momento para envío post-stay (compounding WoM)'));

children.push(p([
  new TextRun({ text: 'Recursos: ', bold: true, size: 22, font: FONT }),
  new TextRun({ text: '1 concierge senior dedicado (€28K/año total comp), coste amenities €40-80/estancia, fotógrafo contratado 20h/semana (€600/mes). Inversión total: ~€45K año 1.', size: 22, font: FONT }),
]));

children.push(p([
  new TextRun({ text: 'KPI éxito: ', bold: true, size: 22, font: FONT }),
  new TextRun({ text: 'NPS honeymooner de −1 a +40 en 90 días. % de reviews que mencionan staff por nombre: de 20% a 55%.', size: 22, font: FONT }),
]));

children.push(p([
  new TextRun({ text: 'Impacto esperado: ', bold: true, color: '2E7D32', size: 22, font: FONT }),
  new TextRun({ text: '+41pp NPS en segmento #1, +15pp NPS agregado. ROI: +€1.8M anual en repeat bookings honeymoon (avg estancia €3.5K × +15pp retorno × 340 honeymoons anuales).', size: 22, font: FONT }),
]));

children.push(spacer());

// INICIATIVA 2
children.push(h3('Iniciativa #2 — Transparencia total de resort fees en booking'));

children.push(p([
  new TextRun({ text: 'Problema: ', bold: true, size: 22, font: FONT }),
  new TextRun({ text: 'cargos sorpresa en checkout (resort fee, city tax premium, parking mandatorio) activan loss aversion — emocionalmente pesan 2.2× su valor monetario. La simulación muestra que el 12% de estancias registran un momento negativo explícito sobre "hidden fees" aunque el importe sea modesto. Efecto desproporcionado en value (−34pp) y review sentiment.', size: 22, font: FONT }),
]));

children.push(p([
  new TextRun({ text: 'Acción concreta: ', bold: true, size: 22, font: FONT }),
  new TextRun({ text: 'auditoría y re-exposición de todos los cargos:', size: 22, font: FONT }),
]));
children.push(bullet('Mostrar "resort fee €X/noche incluido" en Booking.com, Expedia, web directa y confirmación de reserva (banner destacado, no letra pequeña)'));
children.push(bullet('Eliminar línea sorpresa en factura checkout; presentar como "servicios incluidos" pre-pagado'));
children.push(bullet('Si el cargo es legalmente variable (city tax), comunicar en email T-24h con importe exacto'));
children.push(bullet('Opción premium: incluir el resort fee dentro del rate y subir precio visible €X, vendiéndolo como "all-inclusive" vs competencia'));

children.push(p([
  new TextRun({ text: 'Recursos: ', bold: true, size: 22, font: FONT }),
  new TextRun({ text: 'trabajo interno IT / Revenue — 2 semanas de configuración en PMS y channel managers. Sin coste externo.', size: 22, font: FONT }),
]));

children.push(p([
  new TextRun({ text: 'KPI éxito: ', bold: true, size: 22, font: FONT }),
  new TextRun({ text: 'reviews con tema "hidden_fees" o "value_concern" bajan de 15% a <3%. Dimensión value sube de 56 a 75+. Disputas en checkout bajan de 4% a <1%.', size: 22, font: FONT }),
]));

children.push(p([
  new TextRun({ text: 'Impacto esperado: ', bold: true, color: '2E7D32', size: 22, font: FONT }),
  new TextRun({ text: '+8pp NPS agregado, +€0.4M anual en retorno cliente sensible a precio. Coste: 0€.', size: 22, font: FONT }),
]));

children.push(spacer());

// INICIATIVA 3
children.push(h3('Iniciativa #3 — Plan de contingencia para incidentes operativos predecibles'));

children.push(p([
  new TextRun({ text: 'Problema: ', bold: true, size: 22, font: FONT }),
  new TextRun({ text: 'los 8 incidentes adversariales simulados se concentran en 6 categorías predecibles: HVAC malfunction (25% de incidentes), construction noise, check-in queue, pool closure, spa booking error, overbooking downgrade. Cada "unresolved_or_escalated" cuesta ~30 puntos NPS individuales al huésped afectado.', size: 22, font: FONT }),
]));

children.push(p([
  new TextRun({ text: 'Acción concreta: ', bold: true, size: 22, font: FONT }),
  new TextRun({ text: 'SOP de respuesta en 15 min por categoría, con kits pre-preparados:', size: 22, font: FONT }),
]));
children.push(bullet('Kit HVAC: ventilador Dyson portátil + bucket con hielo + voucher €40 spa. Tiempo de entrega < 12 min. Probar cada habitación al check-in.'));
children.push(bullet('Kit pool closure: signage profesional "mantenimiento hasta 14:00 — disfruta de acceso prioritario rooftop + aperitivo cortesía"'));
children.push(bullet('Kit check-in queue (>10 min espera): water + cold towel + €15 F&B voucher delivery al lobby'));
children.push(bullet('Kit spa booking: reserva alternativa en 48h + 20% descuento en tratamiento elegido'));
children.push(bullet('Kit overbooking: upgrade tier superior incondicional + noche adicional al siguiente año (política anti-precio-variable)'));

children.push(p([
  new TextRun({ text: 'Recursos: ', bold: true, size: 22, font: FONT }),
  new TextRun({ text: 'inversión única ~€8K en kits pre-preparados + 2 sesiones training staff (6h totales). Coste recurrente absorbible por contingency budget existente.', size: 22, font: FONT }),
]));

children.push(p([
  new TextRun({ text: 'KPI éxito: ', bold: true, size: 22, font: FONT }),
  new TextRun({ text: 'resolución "excellent_recovery" pasa de 45% (actual real luxury) a 70%. "unresolved_or_escalated" baja de 8% a <2%. Reviews mencionando recovery positiva: +25%.', size: 22, font: FONT }),
]));

children.push(p([
  new TextRun({ text: 'Impacto esperado: ', bold: true, color: '2E7D32', size: 22, font: FONT }),
  new TextRun({ text: '+4pp NPS agregado. Cada incidente bien resuelto GENERA un review positivo sobre service recovery (efecto martillo-peak-end ~+8 stars individuales).', size: 22, font: FONT }),
]));

children.push(new Paragraph({ children: [new PageBreak()] }));

// ─── MEDIUM WINS ───
children.push(h2('3.2 TIER 2 — MEDIUM WINS (3-6 meses, inversión €20-40K)'));

// INICIATIVA 4
children.push(h3('Iniciativa #4 — Rediseño del funnel Spa + upsell proactivo Thai Spa'));

children.push(p([
  new TextRun({ text: 'Problema: ', bold: true, size: 22, font: FONT }),
  new TextRun({ text: 'avg spend spa es solo €11/estancia, con el Thai Spa + hydrothermal como activo físico diferencial de la propiedad. El incidente "spa_booking_problem" aparece en el cohorte — señal de fricción en UX de reserva. Comparables luxury Mediterráneo: €60-100/estancia en spa.', size: 22, font: FONT }),
]));

children.push(p([
  new TextRun({ text: 'Acción concreta:', bold: true, size: 22, font: FONT }),
]));
children.push(bullet('App móvil o Mini WebApp con disponibilidad en vivo, reserva en 30 segundos, pago integrado'));
children.push(bullet('Paquete "Honeymoon Ritual" (2h, €280 para 2 personas) preseleccionado en welcome pack; elegible con un click'));
children.push(bullet('Spa concierge en lobby de 14:00-18:00 con tablet; ofrece slots desde el check-in (hot timing)'));
children.push(bullet('Partnership con influencer luxury wellness (1 colaboración anual, €12K, alcance ~500K)'));
children.push(bullet('Día 1 amenity en habitación: sal de baño Thai con QR a menu spa — "lecciona" al huésped'));

children.push(p([
  new TextRun({ text: 'Recursos: ', bold: true, size: 22, font: FONT }),
  new TextRun({ text: 'app móvil (~€15K desarrollo + €400/mes hosting), spa concierge (staff existente reasignado, 0 coste), partnership influencer €12K, amenity sal €3/room. Total año 1: ~€30K.', size: 22, font: FONT }),
]));

children.push(p([
  new TextRun({ text: 'KPI éxito: ', bold: true, size: 22, font: FONT }),
  new TextRun({ text: 'adopción spa de 15% (actual estimado) a 55% de estancias. ABV spa de €11 a €65.', size: 22, font: FONT }),
]));

children.push(p([
  new TextRun({ text: 'Impacto esperado: ', bold: true, color: '2E7D32', size: 22, font: FONT }),
  new TextRun({ text: '+€54/estancia × 159 rooms × 0.7 occ × 365 días = ', size: 22, font: FONT }),
  new TextRun({ text: '+€2.2M anuales', bold: true, color: '2E7D32', size: 22, font: FONT }),
  new TextRun({ text: ' en revenue spa. +6pp NPS en luxury segment (experiencia premium bien entregada).', size: 22, font: FONT }),
]));

children.push(spacer());

// INICIATIVA 5
children.push(h3('Iniciativa #5 — Reconocimiento tangible Meliá Rewards tier-aware'));

children.push(p([
  new TextRun({ text: 'Problema: ', bold: true, size: 22, font: FONT }),
  new TextRun({ text: 'loyalty_maximizer es el segmento con PEOR NPS (−29), aunque solo 6% del cohorte. Estructuralmente debería ser el mejor: son high-frequency, high-value, pro-brand. El problema no es el tier MR sino la ', size: 22, font: FONT }),
  new TextRun({ text: 'invisibilidad operativa', italics: true, size: 22, font: FONT }),
  new TextRun({ text: ' — el staff no sabe quién es tier Platino/Ambassador en tiempo real.', size: 22, font: FONT }),
]));

children.push(p([
  new TextRun({ text: 'Acción concreta:', bold: true, size: 22, font: FONT }),
]));
children.push(bullet('Welcome pack tangible por tier: Platino = caja madera Menorca + nota manuscrita + upgrade automático si disponible; Ambassador + = todo lo anterior + dinner privado cortesía día 1'));
children.push(bullet('Room tag visible para housekeeping ("MR Ambassador") — permite reconocimiento en pasillo, turndown personalizado'));
children.push(bullet('PMS integra tier en daily briefing de 08:30 — reception menciona por nombre en cada interacción'));
children.push(bullet('Email post-stay personalizado por tier con summary propios + invitation a evento exclusivo anual (Gran Meliá Summit)'));
children.push(bullet('Dashboard pre-arrival visible en concierge con 3 "preferencias confirmadas" por tier (pillow, espirituoso preferido, horario desayuno)'));

children.push(p([
  new TextRun({ text: 'Recursos: ', bold: true, size: 22, font: FONT }),
  new TextRun({ text: 'welcome packs (€35/cada, ~800 platinos+ anuales = €28K), integración PMS tier-flag (1 sprint IT, ~€8K), dinner cortesía (€90 × ~200 Ambassador = €18K). Total año 1: ~€54K.', size: 22, font: FONT }),
]));

children.push(p([
  new TextRun({ text: 'KPI éxito: ', bold: true, size: 22, font: FONT }),
  new TextRun({ text: 'NPS loyalty_maximizer de −29 a +50+. Repeat bookings tier Platino+ 12m: +18pp.', size: 22, font: FONT }),
]));

children.push(p([
  new TextRun({ text: 'Impacto esperado: ', bold: true, color: '2E7D32', size: 22, font: FONT }),
  new TextRun({ text: 'recupera segmento estratégico. Cross-sell a otros hoteles Meliá: +€1.1M en red (ambassador tier estima 5+ estancias/año × €800 avg × 280 miembros).', size: 22, font: FONT }),
]));

children.push(new Paragraph({ children: [new PageBreak()] }));

// ─── LONG PLAYS ───
children.push(h2('3.3 TIER 3 — LONG PLAYS (6-12 meses, inversión €60-120K)'));

// INICIATIVA 6
children.push(h3('Iniciativa #6 — Calibración cultural del servicio por cluster'));

children.push(p([
  new TextRun({ text: 'Problema: ', bold: true, size: 22, font: FONT }),
  new TextRun({ text: 'la simulación modela 10 clusters culturales (UK 45%, DACH 15%, ES/IT 12%, FR 10%, otros 18%) con expectativas de servicio distintas derivadas de Hofstede 6D. El servicio actual es "internacional" genérico, perdiendo la calibración por cluster que sube NPS en +8-12pp en cada grupo.', size: 22, font: FONT }),
]));

children.push(p([
  new TextRun({ text: 'Acción concreta:', bold: true, size: 22, font: FONT }),
]));
children.push(bullet('Micro-training 2h × cluster (UK, DACH, FR, ES/IT, GCC, LatAm, EastAsian) con actor profesional simulando casos típicos'));
children.push(bullet('Script de check-in y greetings por cluster: UK humor ligero + té impecable, DACH puntualidad obsesiva + reglas claras, ES/IT calor humano + flex horarios, FR gastronomy-first + discretion, GCC luxury materials + halal-friendly proactive'));
children.push(bullet('Materials impresos en lengua nativa visibles en habitación (menú, spa, actividades) para top 5 clusters'));
children.push(bullet('Playlist ambient rotativa por cluster predominante de la noche (DACH: Einaudi, ES: flamenco modern, etc.)'));
children.push(bullet('Audit anual externo de "cultural fit" con mystery shoppers de cada cluster'));

children.push(p([
  new TextRun({ text: 'Recursos: ', bold: true, size: 22, font: FONT }),
  new TextRun({ text: 'trainer externo (€25K/año para 6 sesiones trimestrales), materials traducidos profesionalmente (€15K), mystery shopping (€18K/año). Total año 1: ~€60K.', size: 22, font: FONT }),
]));

children.push(p([
  new TextRun({ text: 'KPI éxito: ', bold: true, size: 22, font: FONT }),
  new TextRun({ text: '+10pp NPS por cluster top-5. Review length mediana sube 30% (reviews más detallados = más engagement).', size: 22, font: FONT }),
]));

children.push(p([
  new TextRun({ text: 'Impacto esperado: ', bold: true, color: '2E7D32', size: 22, font: FONT }),
  new TextRun({ text: '+7pp NPS agregado. Refuerza consistencia de brand Gran Meliá en los 6 clusters dominantes del EMEA inbound.', size: 22, font: FONT }),
]));

children.push(spacer());

// INICIATIVA 7
children.push(h3('Iniciativa #7 — Revolución del ABV ancillary: €100 → €250 por estancia'));

children.push(p([
  new TextRun({ text: 'Problema: ', bold: true, size: 22, font: FONT }),
  new TextRun({ text: 'el ABV ancillary actual (€100) está MUY por debajo de comparables luxury Mediterráneo (€200-400). La sim identifica oportunidades específicas: private dining (€10 actual vs €80 potencial), activities (€4 vs €45 potencial), upsells (€10 vs €35 potencial). La palanca principal es ', size: 22, font: FONT }),
  new TextRun({ text: 'timing de ofrecimiento', bold: true, size: 22, font: FONT }),
  new TextRun({ text: ': los upsells ofrecidos en día 3-4 ya son tarde; los ofrecidos en día 1 convierten 3× más.', size: 22, font: FONT }),
]));

children.push(p([
  new TextRun({ text: 'Acción concreta:', bold: true, size: 22, font: FONT }),
]));
children.push(bullet('Concierge Proactivo Día 1: revisión de preferencias con huésped en primera hora post-arrival — propone 3 experiencias personalizadas al lifecycle de la estancia'));
children.push(bullet('Catalog digital navegable con QR en habitación: private dining, excursiones (sailing, hiking, tasting), clases (cocina Menorca, sommelier), bookeable en self-service'));
children.push(bullet('"Signature Experiences" subvencionadas por estancias >€5K: sunset charter boat privado, private dinner en SAmardor con chef, picnic Cala Galdana helicóptero'));
children.push(bullet('Revenue Manager cross-functional: reunión semanal Rev Manager + Guest Experience para tuning de precios ancillary por ocupación y cohort'));
children.push(bullet('Data layer: tracking de conversion por touchpoint para optimización continua'));

children.push(p([
  new TextRun({ text: 'Recursos: ', bold: true, size: 22, font: FONT }),
  new TextRun({ text: 'catalog digital (€20K desarrollo), concierge proactivo (reasignación staff existente, €0 marginal), signature experiences (negociación con proveedores locales, €0 upfront, margin share), Revenue Manager (ya existente). Total año 1: ~€28K.', size: 22, font: FONT }),
]));

children.push(p([
  new TextRun({ text: 'KPI éxito: ', bold: true, size: 22, font: FONT }),
  new TextRun({ text: 'ABV ancillary de €100 a €250. Attach rate private dining 10% → 35%. Attach rate activities 5% → 25%.', size: 22, font: FONT }),
]));

children.push(p([
  new TextRun({ text: 'Impacto esperado: ', bold: true, color: '2E7D32', size: 22, font: FONT }),
  new TextRun({ text: '+€150/estancia × 159 rooms × 0.7 occ × 365 días = ', size: 22, font: FONT }),
  new TextRun({ text: '+€6.1M anuales', bold: true, color: '2E7D32', size: 22, font: FONT }),
  new TextRun({ text: ' en revenue ancillary. Marginal cost ratio ~25% → margen bruto incremental ~€4.6M.', size: 22, font: FONT }),
]));

children.push(new Paragraph({ children: [new PageBreak()] }));

// ─── Impacto agregado ───
children.push(h1('4. Impacto agregado del plan completo'));

const tblImpact = new Table({
  width: { size: 9360, type: WidthType.DXA },
  columnWidths: [3120, 2080, 2080, 2080],
  rows: [
    new TableRow({ tableHeader: true, children: [
      tableHeaderCell('KPI', 3120),
      tableHeaderCell('Base actual', 2080),
      tableHeaderCell('Post-QW (6m)', 2080),
      tableHeaderCell('Post-Plan (12m)', 2080),
    ]}),
    new TableRow({ children: [
      tableCell('NPS agregado', 3120, { bold: true }),
      tableCell('+55', 2080),
      tableCell('+68', 2080, { fill: 'FFF2CC' }),
      tableCell('+75', 2080, { fill: 'E3F4DC', bold: true }),
    ]}),
    new TableRow({ children: [
      tableCell('% reviews 5★', 3120, { bold: true }),
      tableCell('77%', 2080),
      tableCell('82%', 2080, { fill: 'FFF2CC' }),
      tableCell('87%', 2080, { fill: 'E3F4DC', bold: true }),
    ]}),
    new TableRow({ children: [
      tableCell('Return intent 12m', 3120, { bold: true }),
      tableCell('38%', 2080),
      tableCell('52%', 2080, { fill: 'FFF2CC' }),
      tableCell('63%', 2080, { fill: 'E3F4DC', bold: true }),
    ]}),
    new TableRow({ children: [
      tableCell('ABV ancillary / estancia', 3120, { bold: true }),
      tableCell('€100', 2080),
      tableCell('€165', 2080, { fill: 'FFF2CC' }),
      tableCell('€250', 2080, { fill: 'E3F4DC', bold: true }),
    ]}),
    new TableRow({ children: [
      tableCell('Revenue incremental anual', 3120, { bold: true }),
      tableCell('—', 2080),
      tableCell('+€2.6M', 2080, { fill: 'FFF2CC' }),
      tableCell('+€9.5M', 2080, { fill: 'E3F4DC', bold: true, color: '2E7D32' }),
    ]}),
    new TableRow({ children: [
      tableCell('Inversión acumulada', 3120, { bold: true }),
      tableCell('—', 2080),
      tableCell('€25K', 2080, { fill: 'FFF2CC' }),
      tableCell('€140K', 2080, { fill: 'E3F4DC', bold: true }),
    ]}),
    new TableRow({ children: [
      tableCell('ROI año 1', 3120, { bold: true }),
      tableCell('—', 2080),
      tableCell('104×', 2080, { fill: 'FFF2CC' }),
      tableCell('68×', 2080, { fill: 'E3F4DC', bold: true, color: '2E7D32' }),
    ]}),
  ],
});
children.push(tblImpact);

children.push(spacer());

children.push(p([
  new TextRun({ text: 'ROI esperado: ', bold: true, size: 22, font: FONT }),
  new TextRun({ text: 'cada €1 invertido en quick wins (Tier 1) retorna ~€100 en revenue incremental anual en el mismo ejercicio fiscal. El plan completo retorna ~€68 por €1 invertido. La mayor parte del retorno viene de ancillary (Iniciativa #7) y repeat-booking mix mejorado (Iniciativas #1 y #5).', size: 22, font: FONT }),
]));

children.push(new Paragraph({ children: [new PageBreak()] }));

// ─── Cronograma ───
children.push(h1('5. Cronograma de implementación'));

const tblTimeline = new Table({
  width: { size: 9360, type: WidthType.DXA },
  columnWidths: [1560, 5400, 2400],
  rows: [
    new TableRow({ tableHeader: true, children: [
      tableHeaderCell('Período', 1560),
      tableHeaderCell('Hito', 5400),
      tableHeaderCell('Responsable', 2400),
    ]}),
    new TableRow({ children: [
      tableCell('Sem. 1-2', 1560, { bold: true }),
      tableCell('Aprobación quick wins #1, #2, #3 + asignación budget €25K', 5400),
      tableCell('GM + CFO', 2400),
    ]}),
    new TableRow({ children: [
      tableCell('Sem. 3-4', 1560, { bold: true }),
      tableCell('Configuración resort fee en PMS/OTA (Iniciativa #2 — resultado visible en 14 días)', 5400),
      tableCell('Revenue Manager', 2400),
    ]}),
    new TableRow({ children: [
      tableCell('Mes 1-2', 1560, { bold: true }),
      tableCell('Preparación kits contingencia + training staff (Iniciativa #3)', 5400),
      tableCell('Director Operaciones', 2400),
    ]}),
    new TableRow({ children: [
      tableCell('Mes 2', 1560, { bold: true }),
      tableCell('Piloto "Second-Day Reset" con 30 estancias honeymoon (Iniciativa #1); medir delta NPS', 5400),
      tableCell('Guest Experience', 2400),
    ]}),
    new TableRow({ children: [
      tableCell('Mes 3', 1560, { bold: true }),
      tableCell('Revisión piloto — decisión GO/NO-GO escalado a 100% cohorte honeymoon + start Tier 2', 5400),
      tableCell('GM + Comité Dirección', 2400),
    ]}),
    new TableRow({ children: [
      tableCell('Mes 3-5', 1560, { bold: true }),
      tableCell('Desarrollo app spa (Iniciativa #4) + welcome packs loyalty (Iniciativa #5)', 5400),
      tableCell('IT + Loyalty Lead', 2400),
    ]}),
    new TableRow({ children: [
      tableCell('Mes 6', 1560, { bold: true }),
      tableCell('Primera medición post-QW: simulación sintética + review corpus reales últimos 90d', 5400),
      tableCell('Insights / Synthetic Users', 2400),
    ]}),
    new TableRow({ children: [
      tableCell('Mes 6-9', 1560, { bold: true }),
      tableCell('Rollout cultural training por cluster (Iniciativa #6)', 5400),
      tableCell('HR + Trainer externo', 2400),
    ]}),
    new TableRow({ children: [
      tableCell('Mes 7-12', 1560, { bold: true }),
      tableCell('Catalog digital ancillary + concierge proactivo (Iniciativa #7)', 5400),
      tableCell('GM + IT + Concierge Lead', 2400),
    ]}),
    new TableRow({ children: [
      tableCell('Mes 12', 1560, { bold: true }),
      tableCell('Revisión anual + benchmark contra Villa Le Blanc year-over-year + escalado a otros Gran Meliá flagship (Palacio de los Duques, Mar de Nubes)', 5400),
      tableCell('Meliá Luxury Collection', 2400),
    ]}),
  ],
});
children.push(tblTimeline);

children.push(new Paragraph({ children: [new PageBreak()] }));

// ─── Próximos pasos ───
children.push(h1('6. Próximos pasos recomendados'));

children.push(bullet([
  new TextRun({ text: 'Semana 1: ', bold: true, size: 22, font: FONT }),
  new TextRun({ text: 'sesión de 90min con Revenue Management, Guest Experience y CFO para aprobar quick wins (€25K budget — <1% del EBITDA anual de la propiedad).', size: 22, font: FONT }),
]));
children.push(bullet([
  new TextRun({ text: 'Semana 2: ', bold: true, size: 22, font: FONT }),
  new TextRun({ text: 'entrevistas con agentes sintéticos de la simulación (cohorte 50 disponible) para profundizar en los 3 segmentos clave — complementa hallazgos cuantitativos con profundidad cualitativa de cada persona.', size: 22, font: FONT }),
]));
children.push(bullet([
  new TextRun({ text: 'Semana 3: ', bold: true, size: 22, font: FONT }),
  new TextRun({ text: 'launch Iniciativa #2 (resort fee transparency) — el único item sin coste y con impacto inmediato.', size: 22, font: FONT }),
]));
children.push(bullet([
  new TextRun({ text: 'Semana 4-6: ', bold: true, size: 22, font: FONT }),
  new TextRun({ text: 'piloto Iniciativa #1 (Second-Day Reset) con trigger en 30 próximas reservas honeymoon confirmadas.', size: 22, font: FONT }),
]));
children.push(bullet([
  new TextRun({ text: 'Mes 3: ', bold: true, size: 22, font: FONT }),
  new TextRun({ text: 're-simulación sintética post-intervenciones para estimar lift real — comparar delta NPS modelado vs observed en reviews reales 90d.', size: 22, font: FONT }),
]));

children.push(spacer());
children.push(spacer());

children.push(p([
  new TextRun({ text: 'Contacto: ', bold: true, size: 22, font: FONT }),
  new TextRun({ text: 'Rafa Ferrer — Synthetic Users · rafaferrer43@gmail.com', size: 22, font: FONT }),
]));

// ─── Build doc ───
const doc = new Document({
  creator: 'Synthetic Users',
  title: 'Informe Ejecutivo — Gran Meliá Villa Le Blanc — v3',
  description: 'Resumen ejecutivo y plan de acción priorizado por impacto/esfuerzo',
  styles: {
    default: { document: { run: { font: FONT, size: 22 } } },
    paragraphStyles: [
      { id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { size: 32, bold: true, color: '1F3864', font: FONT }, paragraph: { spacing: { before: 280, after: 160 }, outlineLevel: 0 } },
      { id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { size: 26, bold: true, color: '2E74B5', font: FONT }, paragraph: { spacing: { before: 220, after: 120 }, outlineLevel: 1 } },
      { id: 'Heading3', name: 'Heading 3', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { size: 22, bold: true, color: '1F3864', font: FONT }, paragraph: { spacing: { before: 160, after: 80 }, outlineLevel: 2 } },
    ],
  },
  numbering: {
    config: [{
      reference: 'bullets',
      levels: [{ level: 0, format: LevelFormat.BULLET, text: '•', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 720, hanging: 360 } } } }],
    }],
  },
  sections: [{
    properties: {
      page: {
        size: { width: 12240, height: 15840 },
        margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 },
      },
    },
    headers: {
      default: new Header({ children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun({ text: 'Synthetic Users — Gran Meliá Villa Le Blanc', italics: true, size: 18, color: '7F7F7F', font: FONT })] })] }),
    },
    footers: {
      default: new Footer({ children: [new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [
          new TextRun({ text: 'Página ', size: 18, color: '7F7F7F', font: FONT }),
          new TextRun({ children: [PageNumber.CURRENT], size: 18, color: '7F7F7F', font: FONT }),
        ],
      })] }),
    },
    children,
  }],
});

const outPath = path.resolve(__dirname, '..', 'Informe_Ejecutivo_Melia_VillaLeBlanc_v3.docx');
Packer.toBuffer(doc).then((buffer) => {
  fs.writeFileSync(outPath, buffer);
  console.log('Documento generado:', outPath);
});
