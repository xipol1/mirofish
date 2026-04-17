/**
 * Persona Generator — produces N task-adaptive personas for a simulation run.
 *
 * Strategy:
 *   - The task type has K archetypes (currently 3).
 *   - For N agents, we distribute round-robin across archetypes (ceil(N/K) per archetype).
 *   - Each variant of the same archetype gets a DIFFERENT pain-library sample (seed-based),
 *     slight trait randomization within archetype bounds, and a distinct persona name.
 *   - Generation runs in concurrent batches (GROQ_CONCURRENCY) to parallelize within rate limits.
 */

const { callAIJSON, getCohortSize } = require('./ai');
const { getArchetypesForTask } = require('./archetypes');
const { retrievePainPoints } = require('./painLibrary');

const CONCURRENCY = parseInt(process.env.GROQ_CONCURRENCY, 10) || 4;

async function generatePersonas({ taskType, audienceVector, count, onProgress, seedPersonas, industrySlug = 'default' }) {
  const n = count || getCohortSize();
  const emit = onProgress || (() => {});

  // Seed bypass — skip LLM entirely when caller provides personas directly
  if (Array.isArray(seedPersonas) && seedPersonas.length > 0) {
    const picked = seedPersonas.slice(0, n);
    console.log(`[personaGenerator] Using ${picked.length} seed personas (LLM skipped)`);
    emit({ message: `Using ${picked.length} seed personas (LLM skipped)` });
    return picked;
  }

  const archetypes = getArchetypesForTask(taskType, industrySlug);
  const K = archetypes.length;

  // Round-robin assignment of archetype to each persona slot
  const assignments = [];
  for (let i = 0; i < n; i++) {
    const archetype = archetypes[i % K];
    const variantIndex = Math.floor(i / K); // 0 for first instance, 1 for second, etc.
    assignments.push({ archetype, variantIndex, slotIndex: i });
  }

  const personas = [];
  const usedNames = new Set();
  const totalBatches = Math.ceil(assignments.length / CONCURRENCY);

  // Process in concurrent batches to respect Groq TPM limit while parallelizing
  for (let i = 0; i < assignments.length; i += CONCURRENCY) {
    const batch = assignments.slice(i, i + CONCURRENCY);
    const batchNum = Math.floor(i / CONCURRENCY) + 1;
    console.log(`[personaGenerator] Batch ${batchNum}/${totalBatches} (${batch.length} personas)`);
    emit({ message: `Personas batch ${batchNum}/${totalBatches} (${personas.length}/${n} done)` });

    const batchResults = await Promise.all(
      batch.map(async ({ archetype, variantIndex, slotIndex }) => {
        // Different seed per variant => different pain sample
        const painPoints = retrievePainPoints({
          archetypeId: archetype.id,
          audienceVector,
          k: 3,
          seed: slotIndex + 1,
          industrySlug,
        });
        try {
          return await synthesizePersona({
            archetype,
            painPoints,
            audienceVector,
            taskType,
            avoidNames: [...usedNames],
            variantIndex,
            slotIndex,
            industrySlug,
          });
        } catch (err) {
          console.error(`[personaGenerator] Variant ${slotIndex} failed: ${err.message.substring(0, 100)}`);
          return fallbackPersona(archetype, painPoints, audienceVector);
        }
      })
    );

    for (const p of batchResults) {
      if (p.name) usedNames.add(p.name);
      personas.push(p);
    }
    emit({ message: `Personas batch ${batchNum}/${totalBatches} done (${personas.length}/${n})` });
  }

  return personas;
}

async function synthesizePersona({ archetype, painPoints, audienceVector, taskType, avoidNames = [], variantIndex = 0, slotIndex = 0 }) {
  const painContext = painPoints.map((p, i) =>
    `[Real pain #${i + 1}] "${p.pain_quote}"\n  Language markers: ${(p.language_markers || []).join(', ')}\n  Concerns: ${(p.concerns || []).join(', ')}`
  ).join('\n\n');

  const nameConstraint = avoidNames.length > 0
    ? `CRITICAL: Do NOT use any of these names (already used): ${avoidNames.slice(-20).join(', ')}. Choose a CLEARLY DIFFERENT first name — diverse genders and cultural backgrounds representative of the audience's geography.`
    : 'Use a realistic first name that fits the geography and role.';

  // Slight trait randomization within archetype — keeps archetype identity but adds natural variation
  const jitter = () => (Math.random() - 0.5) * 0.2; // ±0.1
  const traits = archetype.base_traits;
  const jitteredTraits = {
    patience: clamp(traits.patience + jitter(), 0, 1),
    trust_baseline: clamp(traits.trust_baseline + jitter(), 0, 1),
    price_sensitivity: clamp(traits.price_sensitivity + jitter(), 0, 1),
    tech_savviness: clamp(traits.tech_savviness + jitter(), 0, 1),
    risk_tolerance: clamp(traits.risk_tolerance + jitter(), 0, 1),
  };

  const variantNote = variantIndex > 0
    ? `\nThis is VARIANT ${variantIndex} of this archetype — other variants of this same archetype already exist in the cohort. Make this one distinctively DIFFERENT: different industry sub-niche, different company stage, different geography, different specific pain point focus. The archetype label is the same but the specific person must feel unique.`
    : '';

  const prompt = `You are instantiating ONE realistic synthetic persona for a product-testing simulation.

=== ARCHETYPE ===
Label: ${archetype.label}
Coverage purpose: ${archetype.coverage_purpose}
Decision style: ${archetype.decision_style}
Behavioral markers: ${(archetype.behavioral_markers || []).join('; ')}${variantNote}

=== TARGET AUDIENCE ===
Vertical: ${audienceVector.vertical}
Role archetype: ${audienceVector.role_archetype}
Company size: ${audienceVector.company_size}
Buying stage: ${audienceVector.buying_stage}
Budget authority: ${audienceVector.budget_authority}
Primary pain themes: ${(audienceVector.primary_pain_themes || []).join('; ')}

=== REAL PAIN POINTS (from public sources) ===
${painContext}

=== PERSONALITY TRAITS TO USE ===
patience=${jitteredTraits.patience.toFixed(2)}, trust_baseline=${jitteredTraits.trust_baseline.toFixed(2)}, price_sensitivity=${jitteredTraits.price_sensitivity.toFixed(2)}, tech_savviness=${jitteredTraits.tech_savviness.toFixed(2)}, risk_tolerance=${jitteredTraits.risk_tolerance.toFixed(2)}

${nameConstraint}

Instantiate ONE concrete persona who embodies this archetype, in this audience, speaking consistent with the real pain above. Return this JSON:

{
  "name": "realistic first and last name — MUST differ from the avoid list",
  "age": number,
  "role": "specific job title",
  "company_description": "1-sentence company context",
  "archetype_id": "${archetype.id}",
  "archetype_label": "${archetype.label}",
  "goals_for_this_visit": ["2-3 specific outcomes they want"],
  "current_alternatives": ["what they use today"],
  "pain_quotes_in_voice": ["2 short first-person quotes channeling the pain points"],
  "top_objections": ["3 specific things that will make them hesitate"],
  "decision_style": "${archetype.decision_style}",
  "traits": {
    "patience": ${jitteredTraits.patience.toFixed(2)},
    "trust_baseline": ${jitteredTraits.trust_baseline.toFixed(2)},
    "price_sensitivity": ${jitteredTraits.price_sensitivity.toFixed(2)},
    "tech_savviness": ${jitteredTraits.tech_savviness.toFixed(2)},
    "risk_tolerance": ${jitteredTraits.risk_tolerance.toFixed(2)}
  },
  "budget_monthly_usd": number,
  "hot_buttons": ["3 specific things that would excite them"],
  "deal_breakers": ["2-3 instant-bounce triggers"],
  "behavioral_markers_activated": ["pick 3 most relevant"]
}`;

  const persona = await callAIJSON(prompt, { maxTokens: 1200, temperature: 0.9 });

  // Attach meta for traceability
  persona._archetype_id = archetype.id;
  persona._variant_index = variantIndex;
  persona._slot_index = slotIndex;
  persona._source_pain_samples = painPoints.map(p => ({ quote: p.pain_quote, source: p.source_type }));
  persona._coverage_purpose = archetype.coverage_purpose;

  // Force-override traits with jittered values (LLM sometimes ignores the instruction)
  persona.traits = jitteredTraits;
  persona.archetype_id = archetype.id;
  persona.archetype_label = archetype.label;
  persona.decision_style = archetype.decision_style;

  return persona;
}

function clamp(n, min, max) { return Math.max(min, Math.min(max, n)); }

function fallbackPersona(archetype, painPoints, audienceVector) {
  const samplePain = painPoints[0];
  return {
    name: `Agent ${Math.floor(Math.random() * 9000) + 1000}`,
    age: 35,
    role: audienceVector.role_archetype || 'Manager',
    company_description: `${audienceVector.company_size} ${audienceVector.vertical} company`,
    archetype_id: archetype.id,
    archetype_label: archetype.label,
    goals_for_this_visit: ['Evaluate if this solves my problem', 'Understand cost'],
    current_alternatives: ['Manual process'],
    pain_quotes_in_voice: samplePain ? [samplePain.pain_quote] : ['I need something that works.'],
    top_objections: ['Price', 'Unclear value', 'Trust'],
    decision_style: archetype.decision_style,
    traits: { ...archetype.base_traits },
    budget_monthly_usd: 200,
    hot_buttons: ['Clear ROI', 'Social proof'],
    deal_breakers: ['Hidden pricing'],
    behavioral_markers_activated: (archetype.behavioral_markers || []).slice(0, 3),
    _archetype_id: archetype.id,
    _coverage_purpose: archetype.coverage_purpose,
    _fallback: true,
  };
}

module.exports = { generatePersonas };
