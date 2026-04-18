/**
 * Cultural Profiles Service
 *
 * Assigns each synthetic guest an origin country + culture cluster, and exposes
 * the associated expectation modifiers. Used to seed realistic diversity in the
 * guest mix (instead of 10× "Kato Yamato Nakamura" honeymooning in Menorca).
 */

const path = require('path');
const fs = require('fs');

const CULT_PATH = path.join(__dirname, '..', '..', 'data', 'industries', 'hospitality', 'cultural_profiles.json');
let _cfg = null;
function getConfig() {
  if (_cfg) return _cfg;
  _cfg = JSON.parse(fs.readFileSync(CULT_PATH, 'utf-8'));
  return _cfg;
}

function getCluster(clusterId) {
  return getConfig().clusters[clusterId] || getConfig().clusters[getConfig()._fallback_cluster];
}

/**
 * Sample an origin cluster for a Menorca property based on realistic arrival mix.
 */
function sampleClusterForMenorca() {
  const mix = getConfig().menorca_typical_origin_mix_pct || {};
  const entries = Object.entries(mix);
  const total = entries.reduce((s, [, v]) => s + v, 0) || 100;
  let r = Math.random() * total;
  for (const [k, v] of entries) {
    r -= v;
    if (r <= 0) return k;
  }
  return entries[0][0];
}

/**
 * Sample a specific origin country within a cluster.
 */
function sampleCountryFromCluster(clusterId) {
  const cluster = getCluster(clusterId);
  const countries = cluster.origin_countries || ['GB'];
  return countries[Math.floor(Math.random() * countries.length)];
}

function sampleLanguageFromCluster(clusterId) {
  const cluster = getCluster(clusterId);
  const langs = cluster.primary_languages || ['en'];
  return langs[Math.floor(Math.random() * langs.length)];
}

/**
 * Build the cultural context for a persona. Returns:
 *   - origin_country_iso
 *   - culture_cluster
 *   - native_language
 *   - cluster object with expectations, modifiers, platform preferences
 *   - narrative_block: prompt content describing the cultural lens
 */
function buildCulturalContext({ clusterId = null, countryIso = null, propertyCountry = 'ES' } = {}) {
  const cluster_id = clusterId || sampleClusterForMenorca();
  const cluster = getCluster(cluster_id);
  const country = countryIso || sampleCountryFromCluster(cluster_id);
  const language = sampleLanguageFromCluster(cluster_id);

  const languageMatchWithStaff = (propertyCountry === 'ES' && ['es'].includes(language))
    || (language === 'en'); // most hotels have English baseline
  const languageFrictionEstimate = languageMatchWithStaff ? 'low' : 'medium_to_high';

  const narrative_block = [
    `=== CULTURAL LENS ===`,
    `Origin country: ${country}`,
    `Culture cluster: ${cluster.label}`,
    `Native language: ${language}`,
    `Language match with staff: ${languageMatchWithStaff ? 'YES (English or native match)' : 'NO (expects some language friction)'}`,
    `Complaint style: ${cluster.complaint_style?.replace(/_/g, ' ')}`,
    `Key expectations in order of importance:`,
    ...(cluster.key_expectations || []).map(e => `  • ${e}`),
    `Price sensitivity: ${cluster.price_sensitivity}`,
    `Value threshold strictness: ${cluster.value_threshold_strictness}`,
    `Tolerance for chaos / disruption: ${cluster.tolerance_for_chaos}`,
    ``,
    `Narrative note: act as a guest from ${cluster.label}. Their service expectations, vocabulary, and what they notice are different from a generic traveler. ${
      cluster.complaint_style === 'rarely_complain_but_never_return'
        ? 'They rarely voice complaints in person — but they remember everything and their review is merciless.'
        : cluster.complaint_style === 'verbal_immediate_emotional'
          ? 'They complain immediately, warmly, expecting fast resolution. Bad recovery escalates fast.'
          : cluster.complaint_style === 'direct_to_manager_immediate'
            ? 'They escalate to management within minutes of an issue. Expect compensation.'
            : 'They tend to be reserved in-person but very detailed in the written review later.'
    }`,
  ].join('\n');

  return {
    origin_country_iso: country,
    culture_cluster: cluster_id,
    culture_cluster_label: cluster.label,
    native_language: language,
    language_match_with_staff: languageMatchWithStaff,
    language_friction_estimate: languageFrictionEstimate,
    sensation_baseline_modifiers: cluster.sensation_baseline_modifiers || {},
    review_platform_preference: cluster.review_platform_preference || {},
    review_length_multiplier: cluster.review_length_multiplier || 1.0,
    review_voice: cluster.review_voice || null,
    complaint_style: cluster.complaint_style,
    price_sensitivity: cluster.price_sensitivity,
    value_threshold_strictness: cluster.value_threshold_strictness,
    tolerance_for_chaos: cluster.tolerance_for_chaos,
    key_expectations: cluster.key_expectations || [],
    narrative_block,
  };
}

module.exports = { buildCulturalContext, getCluster, getConfig, sampleClusterForMenorca, sampleCountryFromCluster };
