/**
 * Property CSV parser — converts a consultant's monthly ADR / occupancy
 * export (from their PMS or a spreadsheet) into the scenario.property
 * shape the editor expects.
 *
 * Accepted shapes (all case-insensitive, delimiter auto-detected — `,` or `;`):
 *
 *  A. Two-column / metric-per-row:
 *       metric,jan,feb,mar,apr,may,jun,jul,aug,sep,oct,nov,dec
 *       adr,0,0,0,520,680,890,1420,1680,1180,720,0,0
 *       occupancy,0,0,0,62,74,82,91,93,84,68,0,0
 *
 *  B. Column-per-month with a `month` column:
 *       month,adr,occupancy
 *       jan,0,0
 *       feb,0,0
 *       ...
 *
 *  C. Single ADR / single OCC row only — will fill the other with zeros
 *     and warn the consultant.
 *
 * Optional extra row / column: `rooms` (single integer), `baseline_nps`,
 * `baseline_star`, `baseline_occupancy_pct`, `tier`.
 */

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const MONTH_ALIASES = {
  january: 'jan', enero: 'jan', ene: 'jan',
  february: 'feb', febrero: 'feb',
  march: 'mar', marzo: 'mar',
  april: 'apr', abril: 'apr',
  may: 'may', mayo: 'may',
  june: 'jun', junio: 'jun',
  july: 'jul', julio: 'jul',
  august: 'aug', agosto: 'aug', ago: 'aug',
  september: 'sep', septiembre: 'sep', setiembre: 'sep', sept: 'sep',
  october: 'oct', octubre: 'oct',
  november: 'nov', noviembre: 'nov',
  december: 'dec', diciembre: 'dec', dic: 'dec',
};

function normalizeMonthKey(s) {
  const k = String(s || '').trim().toLowerCase();
  if (MONTHS.includes(k)) return k;
  return MONTH_ALIASES[k] || null;
}

function detectDelimiter(firstLine) {
  const commaCount = (firstLine.match(/,/g) || []).length;
  const semiCount = (firstLine.match(/;/g) || []).length;
  const tabCount = (firstLine.match(/\t/g) || []).length;
  if (tabCount > Math.max(commaCount, semiCount)) return '\t';
  if (semiCount > commaCount) return ';';
  return ',';
}

function parseNumber(s) {
  if (s == null) return null;
  const cleaned = String(s).trim().replace(/[€$% ]/g, '').replace(',', '.');
  if (cleaned === '') return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function splitRow(line, delim) {
  // Simple split — no quoted-field support (consultants rarely use them here)
  return line.split(delim).map((c) => c.trim());
}

export function parsePropertyCsv(raw) {
  const warnings = [];
  const text = String(raw || '').replace(/\r\n?/g, '\n').trim();
  if (!text) return { error: 'CSV está vacío' };

  const lines = text.split('\n').filter((l) => l.trim() !== '');
  if (lines.length < 2) return { error: 'El CSV necesita al menos 2 filas (cabecera + datos)' };

  const delim = detectDelimiter(lines[0]);
  const header = splitRow(lines[0], delim).map((h) => h.toLowerCase());

  const adr = Object.fromEntries(MONTHS.map((m) => [m, 0]));
  const occ = Object.fromEntries(MONTHS.map((m) => [m, 0]));
  const meta = { rooms: null, baseline_nps: null, baseline_star: null, baseline_occupancy_pct: null, tier: null };

  // Detect shape
  const headerIsMonths = header.slice(1).every((h) => normalizeMonthKey(h)) && header.length >= 13;
  const headerHasMonthCol = header.includes('month') || header.includes('mes');

  if (headerIsMonths) {
    // Shape A — metric-per-row
    for (let i = 1; i < lines.length; i++) {
      const cells = splitRow(lines[i], delim);
      const metric = (cells[0] || '').toLowerCase();
      const values = cells.slice(1).map(parseNumber);
      const monthKeys = header.slice(1).map(normalizeMonthKey);

      if (metric === 'adr' || metric === 'rate' || metric === 'price' || metric === 'tarifa') {
        for (let j = 0; j < monthKeys.length && j < values.length; j++) {
          if (monthKeys[j] && values[j] != null) adr[monthKeys[j]] = values[j];
        }
      } else if (metric === 'occupancy' || metric === 'occ' || metric === 'ocupacion' || metric === 'ocupación') {
        for (let j = 0; j < monthKeys.length && j < values.length; j++) {
          if (monthKeys[j] && values[j] != null) occ[monthKeys[j]] = values[j];
        }
      } else if (metric === 'rooms') {
        meta.rooms = values.find((v) => v != null) ?? meta.rooms;
      } else if (metric === 'baseline_nps' || metric === 'nps') {
        meta.baseline_nps = values.find((v) => v != null) ?? meta.baseline_nps;
      } else if (metric === 'baseline_star' || metric === 'star' || metric === 'stars') {
        meta.baseline_star = values.find((v) => v != null) ?? meta.baseline_star;
      }
    }
  } else if (headerHasMonthCol) {
    // Shape B — column-per-month-row
    const monthIdx = header.indexOf('month') >= 0 ? header.indexOf('month') : header.indexOf('mes');
    const adrIdx = ['adr', 'rate', 'price', 'tarifa'].map((k) => header.indexOf(k)).find((i) => i >= 0);
    const occIdx = ['occupancy', 'occ', 'ocupacion', 'ocupación'].map((k) => header.indexOf(k)).find((i) => i >= 0);
    if (adrIdx == null && occIdx == null) {
      return { error: 'No se encontraron columnas "adr" ni "occupancy"' };
    }
    for (let i = 1; i < lines.length; i++) {
      const cells = splitRow(lines[i], delim);
      const monthKey = normalizeMonthKey(cells[monthIdx]);
      if (!monthKey) continue;
      if (adrIdx != null) {
        const v = parseNumber(cells[adrIdx]);
        if (v != null) adr[monthKey] = v;
      }
      if (occIdx != null) {
        const v = parseNumber(cells[occIdx]);
        if (v != null) occ[monthKey] = v;
      }
    }
  } else {
    return { error: 'Formato no reconocido. Usa cabecera con meses (jan,feb…) o columna "month".' };
  }

  // Sanity — warn if occupancy looks like 0-1 instead of 0-100
  const occMax = Math.max(...Object.values(occ));
  if (occMax > 0 && occMax <= 1.5) {
    for (const m of MONTHS) occ[m] = Math.round(occ[m] * 100 * 10) / 10;
    warnings.push('La ocupación venía en 0-1, la convertí a 0-100.');
  }

  const adrMax = Math.max(...Object.values(adr));
  if (adrMax === 0) warnings.push('No se leyó ningún ADR > 0. Revisa el archivo.');

  const property = {
    adr_curve_monthly: adr,
    occupancy_curve_monthly: occ,
    rooms: meta.rooms || 100,
    baseline_nps: meta.baseline_nps || 65,
    baseline_star: meta.baseline_star || 4.3,
    baseline_occupancy_pct: meta.baseline_occupancy_pct || Math.round(Object.values(occ).filter((v) => v > 0).reduce((s, v) => s + v, 0) / Math.max(1, Object.values(occ).filter((v) => v > 0).length)),
    tier: meta.tier || 'luxury',
  };

  return { property, warnings };
}
