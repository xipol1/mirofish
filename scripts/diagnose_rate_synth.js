#!/usr/bin/env node
/**
 * Diagnostic: directly call the synth for rate_strategy_test decision stage
 * across N personas and report the distribution of (walk, book, perception).
 */

process.env.USE_SYNTH = 'true';
const { callAIJSON } = require('../backend/services/ai');

function makePrompt({ personaName, archetype, cluster, rate_eur, stage }) {
  return `You are simulating a prospective hotel booker evaluating a specific rate offer. Stay in character.

=== YOU ARE ===
Name: ${personaName}
Archetype: ${archetype}
Your typical booking behavior: direct web

Culture cluster: ${cluster}

=== PROPERTY ===
Gran Meliá Villa Le Blanc (Gran Meliá)

=== THE RATE OFFER YOU ARE EVALUATING ===
Label: Test rate
Price: €${rate_eur}/night
Inclusions: Breakfast, WiFi, Taxes
Cancellation policy: flexible_48h
Additional terms: Base room

=== CURRENT STAGE: ${stage} ===
What's your first reaction?

Return JSON.`;
}

(async () => {
  const archetype = 'family_vacationer';
  const clusters = ['anglo_uk_ireland', 'german_dach', 'french', 'latin_spain_italy', 'nordic'];
  const N_PER_CLUSTER = 30;

  for (const rate of [525, 875]) {
    let walks = 0, books = 0, total = 0;
    const perceptions = {};
    for (const cluster of clusters) {
      for (let i = 0; i < N_PER_CLUSTER; i++) {
        // price_exposure
        const pe = await callAIJSON(makePrompt({ personaName: `P${i}`, archetype, cluster, rate_eur: rate, stage: 'price_exposure' }));
        perceptions[pe.price_perception] = (perceptions[pe.price_perception] || 0) + 1;
        if (pe.walk_away) { walks++; total++; continue; }
        // decision
        const de = await callAIJSON(makePrompt({ personaName: `P${i}`, archetype, cluster, rate_eur: rate, stage: 'decision' }));
        if (de.would_book) books++;
        total++;
      }
    }
    console.log(`\nrate=€${rate} (N=${total})`);
    console.log(`  walks   : ${walks} (${(100 * walks / total).toFixed(1)}%)`);
    console.log(`  books   : ${books} (${(100 * books / total).toFixed(1)}%)`);
    console.log(`  perceptions:`, perceptions);
  }
})();
