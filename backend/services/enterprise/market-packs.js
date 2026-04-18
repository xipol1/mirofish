/**
 * Market Packs — emitting-market behavioral primitives with provenance.
 *
 * Schema versions supported:
 *   - v0.1 (legacy): flat values, pack-level sources list
 *   - v0.2 (current): per-field provenance via either {value, source_id, confidence_0_100, last_validated}
 *                     wrappers (for scalars) or `_provenance` keys (for distributions)
 *
 * The service normalizes read access via getValue() / getProvenance() so
 * callers don't need to know the schema version.
 */

const path = require('path');
const fs = require('fs');

const PACKS_DIR = path.join(__dirname, '..', '..', 'data', 'market_packs');
const SOURCES_CATALOG = path.join(__dirname, '..', '..', 'data', 'sources', 'catalog.json');
const cache = {};
let _sources = null;

function loadSources() {
  if (_sources) return _sources;
  if (!fs.existsSync(SOURCES_CATALOG)) {
    _sources = { sources: {} };
    return _sources;
  }
  try {
    _sources = JSON.parse(fs.readFileSync(SOURCES_CATALOG, 'utf-8'));
  } catch (err) {
    console.error('[market-packs] Failed to load sources catalog:', err.message);
    _sources = { sources: {} };
  }
  return _sources;
}

function loadAll() {
  if (Object.keys(cache).length > 0) return cache;
  if (!fs.existsSync(PACKS_DIR)) return cache;

  for (const file of fs.readdirSync(PACKS_DIR)) {
    if (!file.endsWith('.json')) continue;
    try {
      const content = JSON.parse(fs.readFileSync(path.join(PACKS_DIR, file), 'utf-8'));
      if (content.market_id) cache[content.market_id] = content;
    } catch (err) {
      console.error(`[market-packs] Failed to load ${file}:`, err.message);
    }
  }
  return cache;
}

function list() {
  return Object.values(loadAll()).map(p => ({
    market_id: p.market_id,
    label: p.label,
    iso_country_code: p.iso_country_code,
    pack_version: p.pack_version,
    schema_version: p.schema_version || '0.1.0',
    cultural_cluster_mapping: p.cultural_cluster_mapping,
  }));
}

function get(marketId) {
  const packs = loadAll();
  if (!packs[marketId]) throw new Error(`Market pack '${marketId}' not found. Available: ${Object.keys(packs).join(', ')}`);
  return packs[marketId];
}

function has(marketId) {
  return !!loadAll()[marketId];
}

// ─── Schema-aware accessors ───────────────────────────────────────

/**
 * Unwrap a wrapped scalar: if the node is {value, source_id, ...}, return value;
 * otherwise return as-is.
 */
function unwrapScalar(node) {
  if (node && typeof node === 'object' && !Array.isArray(node) && 'value' in node && 'source_id' in node) {
    return node.value;
  }
  return node;
}

/**
 * Unwrap a distribution object (removes _provenance key, unwraps any wrapped values).
 */
function unwrapDistribution(node) {
  if (!node || typeof node !== 'object' || Array.isArray(node)) return node;
  const out = {};
  for (const [k, v] of Object.entries(node)) {
    if (k === '_provenance') continue;
    out[k] = unwrapScalar(v);
  }
  return out;
}

/**
 * Generic recursive unwrap for any node — used when a consumer wants the
 * pack stripped of provenance for downstream use.
 */
function unwrapNode(node) {
  if (node == null) return node;
  if (Array.isArray(node)) return node.map(unwrapNode);
  if (typeof node !== 'object') return node;

  // Scalar wrap?
  if ('value' in node && 'source_id' in node) return unwrapScalar(node);

  // Items-wrapped (for lists with provenance)
  if ('_provenance' in node && Array.isArray(node.items)) {
    return node.items;
  }

  // Distribution or nested object
  const out = {};
  for (const [k, v] of Object.entries(node)) {
    if (k === '_provenance') continue;
    out[k] = unwrapNode(v);
  }
  return out;
}

/**
 * Get the raw value of a field via dot-path. Handles both v0.1 and v0.2.
 * Examples:
 *   getValue(pack, 'price_sensitivity.elasticity_coefficient')
 *   getValue(pack, 'channel_share_pct')  → returns distribution object
 */
function getValue(pack, fieldPath) {
  const parts = fieldPath.split('.');
  let node = pack;
  for (const p of parts) {
    if (node == null) return null;
    node = node[p];
  }
  return unwrapNode(node);
}

/**
 * Get provenance metadata for a field. Returns null if pack has no provenance
 * or field is not cited. Includes the resolved source metadata from catalog.
 */
function getProvenance(pack, fieldPath) {
  const parts = fieldPath.split('.');
  let node = pack;
  for (const p of parts) {
    if (node == null) return null;
    node = node[p];
  }
  if (node == null || typeof node !== 'object') return null;

  let prov = null;
  // Scalar wrap
  if ('value' in node && 'source_id' in node) {
    prov = { source_id: node.source_id, confidence_0_100: node.confidence_0_100, last_validated: node.last_validated, sample_size: node.sample_size, notes: node.notes };
  } else if ('_provenance' in node) {
    prov = { ...node._provenance };
  }

  if (!prov) return null;

  // Enrich with full source catalog entry
  const catalog = loadSources();
  const src = catalog.sources?.[prov.source_id] || null;
  return { ...prov, source_details: src };
}

/**
 * Returns all fields in a pack with their provenance, for audit/export.
 */
function getAllProvenance(pack, prefix = '', acc = []) {
  if (pack == null || typeof pack !== 'object' || Array.isArray(pack)) return acc;

  // Scalar wrap at this level
  if ('value' in pack && 'source_id' in pack) {
    acc.push({
      field: prefix.replace(/\.$/, ''),
      value: pack.value,
      provenance: { source_id: pack.source_id, confidence_0_100: pack.confidence_0_100, last_validated: pack.last_validated },
    });
    return acc;
  }

  // Distribution with shared _provenance
  if ('_provenance' in pack) {
    acc.push({
      field: prefix.replace(/\.$/, ''),
      value: 'distribution',
      provenance: pack._provenance,
    });
  }

  for (const [k, v] of Object.entries(pack)) {
    if (k.startsWith('_') || ['pack_version', 'schema_version', 'market_id', 'label', 'iso_country_code', 'currency_iso', 'last_updated', 'cultural_cluster_mapping'].includes(k)) continue;
    if (typeof v === 'object' && v !== null) {
      getAllProvenance(v, `${prefix}${k}.`, acc);
    }
  }
  return acc;
}

// ─── Distribution samplers (schema-aware) ─────────────────────────

function sampleChannel(pack) {
  const dist = getValue(pack, 'channel_share_pct') || {};
  return weightedPick(dist, 'booking_com');
}

function sampleDevice(pack) {
  const dist = getValue(pack, 'device_share_pct') || {};
  return weightedPick(dist, 'mobile');
}

function sampleBookingWindow(pack) {
  const dist = getValue(pack, 'booking_window_distribution_days') || {};
  return weightedPick(dist, 'medium_15_45');
}

function weightedPick(distribution, fallback) {
  const entries = Object.entries(distribution);
  if (entries.length === 0) return fallback;
  const total = entries.reduce((s, [, v]) => s + Number(v || 0), 0) || 1;
  let r = Math.random() * total;
  for (const [k, v] of entries) { r -= Number(v || 0); if (r <= 0) return k; }
  return entries[0][0];
}

/**
 * Behavior signals: compact summary for prompt injection. Schema-aware.
 */
function getBehaviorSignals(marketId) {
  const pack = get(marketId);
  return {
    market: pack.label,
    iso: pack.iso_country_code,
    typical_booking_window: pickDominantKey(getValue(pack, 'booking_window_distribution_days')),
    preferred_channel: pickDominantKey(getValue(pack, 'channel_share_pct')),
    preferred_device: pickDominantKey(getValue(pack, 'device_share_pct')),
    price_elasticity: getValue(pack, 'price_sensitivity.elasticity_coefficient'),
    walk_away_threshold_pct_above_comp: getValue(pack, 'price_sensitivity.walk_away_threshold_pct_above_comp_set'),
    cancellation_preference: (getValue(pack, 'cancellation_patterns.refundable_rate_preference_pct') || 0) > 55 ? 'refundable' : 'non_refundable',
    review_writing_probability_pct: getValue(pack, 'review_writing_probability_pct'),
    complaint_escalation_pattern: getValue(pack, 'complaint_escalation_pattern'),
    loyalty_tier_penetration_pct: getValue(pack, 'loyalty_tier_penetration_pct'),
    key_behavioral_traits: getValue(pack, 'key_behavioral_traits'),
    typical_length_of_stay_leisure_couples: getValue(pack, 'typical_length_of_stay_nights_by_segment.leisure_couples'),
    typical_length_of_stay_leisure_family: getValue(pack, 'typical_length_of_stay_nights_by_segment.leisure_family'),
  };
}

function pickDominantKey(distribution) {
  if (!distribution || typeof distribution !== 'object') return null;
  const entries = Object.entries(distribution);
  if (entries.length === 0) return null;
  entries.sort((a, b) => Number(b[1] || 0) - Number(a[1] || 0));
  return entries[0][0];
}

function buildOriginMix(marketPackIds, shares) {
  if (!Array.isArray(marketPackIds) || marketPackIds.length === 0) return null;
  const out = {};
  for (let i = 0; i < marketPackIds.length; i++) {
    const id = marketPackIds[i];
    const pack = get(id);
    const share = Array.isArray(shares) && shares[i] != null ? shares[i] : 100 / marketPackIds.length;
    const cluster = pack.cultural_cluster_mapping;
    if (cluster) out[cluster] = (out[cluster] || 0) + share;
  }
  return out;
}

// ─── Validation ───────────────────────────────────────────────────

/**
 * Validate a pack against the expected schema. Checks required top-level
 * fields and (for v0.2) that cited fields have complete provenance.
 */
function validatePack(pack) {
  const errors = [];
  const warnings = [];
  const REQUIRED_TOP = ['pack_version', 'market_id', 'label', 'iso_country_code', 'cultural_cluster_mapping'];
  for (const k of REQUIRED_TOP) {
    if (!pack[k]) errors.push(`Missing required field: ${k}`);
  }

  const REQUIRED_DATA = [
    'booking_window_distribution_days', 'channel_share_pct', 'price_sensitivity',
    'cancellation_patterns', 'device_share_pct', 'typical_length_of_stay_nights_by_segment',
    'review_writing_probability_pct', 'loyalty_tier_penetration_pct',
  ];
  for (const k of REQUIRED_DATA) {
    if (!(k in pack)) errors.push(`Missing required data field: ${k}`);
  }

  const version = pack.schema_version || pack.pack_version || '0.1.0';
  const isV02 = version.startsWith('0.2');

  if (isV02) {
    // Every cited field should have source_id referencing the catalog
    const catalog = loadSources();
    const knownSources = new Set(Object.keys(catalog.sources || {}));

    const provs = getAllProvenance(pack);
    let missingSources = 0;
    let lowConfidenceCount = 0;
    for (const p of provs) {
      if (!p.provenance?.source_id) {
        errors.push(`Field '${p.field}' has provenance but no source_id`);
        missingSources++;
        continue;
      }
      if (!knownSources.has(p.provenance.source_id)) {
        warnings.push(`Field '${p.field}' references unknown source '${p.provenance.source_id}'`);
      }
      if (p.provenance.confidence_0_100 != null && p.provenance.confidence_0_100 < 40) {
        lowConfidenceCount++;
      }
    }

    // Compute cited coverage
    const citedFieldCount = provs.length;
    warnings.push(`v0.2 pack '${pack.market_id}' has ${citedFieldCount} cited fields, ${lowConfidenceCount} with confidence <40 (expert inference)`);
  }

  return { ok: errors.length === 0, errors, warnings, version, is_v02: isV02 };
}

// Check distribution sums (should be ~100% for share distributions)
function validateDistributionSums(pack, toleranceMaxPct = 1) {
  const issues = [];
  const distFields = [
    'booking_window_distribution_days',
    'channel_share_pct',
    'device_share_pct',
    'destination_origin_airport_distribution_pct',
    'segment_mix_outbound_to_mediterranean_pct',
    'review_platform_usage_pct',
    'payment_preferences',
  ];
  for (const field of distFields) {
    const dist = getValue(pack, field);
    if (!dist || typeof dist !== 'object') continue;
    const total = Object.values(dist).reduce((s, v) => s + Number(v || 0), 0);
    // If values are 0-1 fractions, expected sum is ~1; if 0-100, expected ~100
    const expected = total <= 1.5 ? 1 : 100;
    const diff = Math.abs(total - expected);
    const diffPct = (diff / expected) * 100;
    if (diffPct > toleranceMaxPct) {
      issues.push({
        field,
        total,
        expected,
        diff_pct: Math.round(diffPct * 100) / 100,
      });
    }
  }
  return issues;
}

/**
 * Compute overall confidence score for a v0.2 pack — weighted avg of
 * per-field confidence, weighted by importance.
 */
function computePackConfidence(pack) {
  if (!pack || !(pack.schema_version || '').startsWith('0.2')) {
    return { overall_confidence_0_100: null, is_v02: false };
  }
  const provs = getAllProvenance(pack);
  if (provs.length === 0) return { overall_confidence_0_100: null, is_v02: true, note: 'no provenance data' };

  const confs = provs
    .map(p => p.provenance?.confidence_0_100)
    .filter(c => typeof c === 'number');

  if (confs.length === 0) return { overall_confidence_0_100: null, is_v02: true };

  const avg = confs.reduce((s, v) => s + v, 0) / confs.length;
  const minConf = Math.min(...confs);
  const maxConf = Math.max(...confs);
  const lowConfFields = provs.filter(p => (p.provenance?.confidence_0_100 || 100) < 50);

  return {
    overall_confidence_0_100: Math.round(avg),
    min_confidence: minConf,
    max_confidence: maxConf,
    is_v02: true,
    total_cited_fields: provs.length,
    low_confidence_fields_count: lowConfFields.length,
    low_confidence_field_names: lowConfFields.map(p => p.field),
  };
}

module.exports = {
  list,
  get,
  has,
  loadAll,
  // Schema-aware accessors
  getValue,
  getProvenance,
  getAllProvenance,
  unwrapNode,
  unwrapDistribution,
  // Samplers
  sampleChannel,
  sampleDevice,
  sampleBookingWindow,
  getBehaviorSignals,
  buildOriginMix,
  // Validation
  validatePack,
  validateDistributionSums,
  computePackConfidence,
  // Sources
  loadSources,
};
