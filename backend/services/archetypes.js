/**
 * Archetype Selector — chooses archetypes for a given task type.
 *
 * Delegates to the industry adapter (services/industries.js). When an industry
 * slug is provided, the industry-specific archetype bank is used; otherwise
 * the legacy/default SaaS bank applies.
 */

const industries = require('./industries');

function getArchetypesForTask(taskType, countOrIndustry, maybeCount) {
  // Back-compat: old signature was getArchetypesForTask(taskType, count).
  // New signature: getArchetypesForTask(taskType, industrySlug, count).
  let industrySlug = 'default';
  let count = null;
  if (typeof countOrIndustry === 'number') {
    count = countOrIndustry;
  } else if (typeof countOrIndustry === 'string') {
    industrySlug = countOrIndustry;
    count = maybeCount || null;
  }
  return industries.getArchetypesForTask(taskType, industrySlug, count);
}

function getArchetypeById(archetypeId, industrySlug = 'default') {
  const pack = industries.loadIndustryPack(industrySlug);
  for (const taskType of Object.keys(pack.archetypes)) {
    const found = (pack.archetypes[taskType] || []).find(a => a.id === archetypeId);
    if (found) return found;
  }
  return null;
}

function loadArchetypes(industrySlug = 'default') {
  return industries.loadIndustryPack(industrySlug).archetypes;
}

module.exports = { getArchetypesForTask, getArchetypeById, loadArchetypes };
