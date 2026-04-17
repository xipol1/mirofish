/**
 * Industry Adapter — swaps archetypes, pain library, recommendation templates,
 * KPIs, and ontology based on the target industry.
 *
 * Usage:
 *   const pack = loadIndustryPack('hospitality');
 *   pack.archetypes -> { landing_page: [...], pricing: [...], ... }
 *   pack.pain_library -> [...]
 *   pack.recommendation_templates -> {...}
 *   pack.kpis -> {...}
 *   pack.ontology -> {...}
 *
 * Fallback order:
 *   1. data/industries/{slug}/*.json
 *   2. data/*.json (legacy / default SaaS-focused data)
 *
 * Supports archetype inheritance via "_inherit_from" keys:
 *   Archetype with { "id": "x", "_inherit_from": "landing_page.some_id" }
 *   inherits all fields from that path, allowing shared definitions.
 */

const path = require('path');
const fs = require('fs');

const INDUSTRY_BASE = path.join(__dirname, '..', 'data', 'industries');
const LEGACY_BASE = path.join(__dirname, '..', 'data');

// Canonical valid industry slugs. Can be extended as we add packs.
const VALID_INDUSTRIES = ['default', 'saas', 'hospitality', 'retail', 'banking', 'healthcare', 'telecom', 'automotive'];

// Cache loaded packs for perf
const _packCache = {};

function loadJsonSafe(filePath, fallback = null) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch (err) {
    console.error(`[industries] Failed to load ${filePath}:`, err.message);
    return fallback;
  }
}

function loadIndustryPack(slug = 'default') {
  const normalizedSlug = (slug || 'default').toLowerCase();
  if (_packCache[normalizedSlug]) return _packCache[normalizedSlug];

  const industryDir = path.join(INDUSTRY_BASE, normalizedSlug);
  const hasIndustryDir = fs.existsSync(industryDir);

  // Load industry-specific files
  const archetypesIndustry = hasIndustryDir
    ? loadJsonSafe(path.join(industryDir, 'archetypes.json'), null)
    : null;
  const painIndustry = hasIndustryDir
    ? loadJsonSafe(path.join(industryDir, 'pain_library.json'), null)
    : null;
  const recsIndustry = hasIndustryDir
    ? loadJsonSafe(path.join(industryDir, 'recommendation_templates.json'), null)
    : null;
  const kpisIndustry = hasIndustryDir
    ? loadJsonSafe(path.join(industryDir, 'kpis.json'), null)
    : null;
  const ontologyIndustry = hasIndustryDir
    ? loadJsonSafe(path.join(industryDir, 'ontology.json'), null)
    : null;

  // Load legacy defaults
  const archetypesDefault = loadJsonSafe(path.join(LEGACY_BASE, 'archetypes.json'), { landing_page: [] });
  const painDefault = loadJsonSafe(path.join(LEGACY_BASE, 'pain_library.json'), []);
  const recsDefault = loadJsonSafe(path.join(LEGACY_BASE, 'recommendation_templates.json'), {});

  // Merge strategy:
  //  - archetypes: industry overrides default per task_type; unknown task_types fall back to default
  //  - pain_library: merge + de-dup (industry entries prepended for retrieval priority)
  //  - recommendation_templates: merge (industry templates added to defaults)
  const mergedArchetypes = {
    ...archetypesDefault,
    ...(archetypesIndustry || {}),
  };

  // Resolve inheritance (_inherit_from: "taskType.id")
  for (const taskType of Object.keys(mergedArchetypes)) {
    const arr = mergedArchetypes[taskType];
    if (!Array.isArray(arr)) continue;
    mergedArchetypes[taskType] = arr.map(a => {
      if (a._inherit_from) {
        const [srcTask, srcId] = a._inherit_from.split('.');
        const src = (mergedArchetypes[srcTask] || []).find(x => x.id === srcId);
        if (src) {
          return { ...src, ...a, _inherit_from: undefined };
        }
      }
      return a;
    });
  }

  const mergedPain = [
    ...(Array.isArray(painIndustry) ? painIndustry : []),
    ...(Array.isArray(painDefault) ? painDefault.filter(p => !painIndustry || !painIndustry.some(ip => ip.id === p.id)) : []),
  ];

  const mergedRecs = {
    ...recsDefault,
    ...(recsIndustry || {}),
  };

  const pack = {
    slug: normalizedSlug,
    has_industry_pack: hasIndustryDir,
    archetypes: mergedArchetypes,
    pain_library: mergedPain,
    recommendation_templates: mergedRecs,
    kpis: kpisIndustry,
    ontology: ontologyIndustry,
  };

  _packCache[normalizedSlug] = pack;
  return pack;
}

function clearCache() {
  for (const k of Object.keys(_packCache)) delete _packCache[k];
}

function listAvailableIndustries() {
  try {
    const dirs = fs.readdirSync(INDUSTRY_BASE).filter(d => {
      const full = path.join(INDUSTRY_BASE, d);
      return fs.statSync(full).isDirectory() && fs.existsSync(path.join(full, 'ontology.json'));
    });
    return dirs.map(slug => {
      const ontology = loadJsonSafe(path.join(INDUSTRY_BASE, slug, 'ontology.json'), {});
      return {
        slug,
        label: ontology.label || slug,
        description: ontology.description || '',
        sub_verticals: ontology.sub_verticals || [],
      };
    });
  } catch (err) {
    return [];
  }
}

function getArchetypesForTask(taskType, industrySlug = 'default', count = null) {
  const pack = loadIndustryPack(industrySlug);
  const list = pack.archetypes[taskType] || pack.archetypes.landing_page || [];
  const n = count || list.length;
  return list.slice(0, n);
}

function getRecommendationTemplates(industrySlug = 'default') {
  return loadIndustryPack(industrySlug).recommendation_templates;
}

function getKpis(industrySlug = 'default') {
  return loadIndustryPack(industrySlug).kpis;
}

function getOntology(industrySlug = 'default') {
  return loadIndustryPack(industrySlug).ontology;
}

module.exports = {
  loadIndustryPack,
  clearCache,
  listAvailableIndustries,
  getArchetypesForTask,
  getRecommendationTemplates,
  getKpis,
  getOntology,
  VALID_INDUSTRIES,
};
