/**
 * Extracts the full memory of a completed simulation into a human-readable
 * markdown document + a compact JSON summary. Run once; outputs are written
 * to sim_snapshots/.
 */

const fs = require('fs');
const path = require('path');

const RAW = path.join(__dirname, 'sim_92fd75dd_raw.json');
const data = JSON.parse(fs.readFileSync(RAW, 'utf-8'));

const r = data.result || data;
const summary = r.summary || {};
const records = r.records || r.stays || [];
const valid = records.filter(s => s && !s.error);
const property = r.property || {};
const audience = r.audience_vector || {};

const lines = [];
const push = (s = '') => lines.push(s);

// ── Header ────────────────────────────────────────────────────────
push(`# Simulation Memory — 92fd75dd-b9b5-4811-befb-a6d4732d2479`);
push('');
push(`**Status:** ${data.status}  `);
push(`**Started:** ${data.started_at || '—'}  `);
push(`**Completed:** ${data.completed_at || '—'}  `);
push(`**Property:** ${property.name || '—'} (${property.brand || '—'})  `);
push(`**Provider:** ${r.provider || '—'}  `);
push(`**Modality:** ${r.modality || r.modality_label || 'stay_experience'}  `);
push(`**Audience:** ${typeof audience === 'string' ? audience : (audience.label || audience.summary || JSON.stringify(audience).slice(0, 200))}  `);
push(`**Total stays:** ${summary.total_stays || valid.length}  `);
push('');
push(`_Raw JSON backup: [sim_92fd75dd_raw.json](./sim_92fd75dd_raw.json) · 926 KB_`);
push('');

// ── Summary ───────────────────────────────────────────────────────
push(`## 1. Cohort summary`);
push('');
push(`| Metric | Value |`);
push(`|---|---|`);
push(`| Avg stars | ${summary.avg_stars ?? '—'} |`);
push(`| Avg NPS | ${summary.avg_nps ?? '—'} |`);
push(`| Net Promoter Score | ${summary.net_promoter_score ?? '—'} |`);
push(`| Avg spend € | ${summary.avg_spend_eur ?? '—'} |`);
push(`| Avg room rate paid € | ${summary.avg_room_rate_paid_eur ?? '—'} |`);
push(`| Would repeat % | ${summary.would_repeat_pct ?? '—'} |`);
push(`| Would recommend % | ${summary.would_recommend_pct ?? '—'} |`);
push(`| Reviews that will be written | ${summary.reviews_generated ?? '—'} |`);
push(`| Avg staff rapport | ${summary.avg_staff_rapport ?? '—'} |`);
push(`| Adversarial events total | ${summary.adversarial_events_total ?? 0} |`);
push('');

// Star distribution
if (summary.realized_star_distribution_pct) {
  push(`### Star distribution`);
  push('');
  push(`| ★ | % of stays |`);
  push(`|---|---|`);
  for (const [k, v] of Object.entries(summary.realized_star_distribution_pct)) {
    push(`| ${k}★ | ${v}% |`);
  }
  push('');
}

// Platform mix
if (summary.predicted_review_platform_mix && Object.keys(summary.predicted_review_platform_mix).length) {
  push(`### Predicted review platforms`);
  push('');
  for (const [k, v] of Object.entries(summary.predicted_review_platform_mix)) {
    push(`- ${k} — ${v}`);
  }
  push('');
}

// Top themes
if (summary.top_predicted_themes && summary.top_predicted_themes.length) {
  push(`### Top predicted review themes`);
  push('');
  for (const t of summary.top_predicted_themes) {
    push(`- ${t.theme} ×${t.count}`);
  }
  push('');
}

// Spend by category
if (summary.avg_spend_by_category && Object.keys(summary.avg_spend_by_category).length) {
  push(`### Avg spend per stay, by category`);
  push('');
  const entries = Object.entries(summary.avg_spend_by_category).sort((a, b) => b[1] - a[1]);
  for (const [cat, val] of entries) {
    push(`- ${cat.replace(/_/g, ' ')}: €${val}`);
  }
  push('');
}

// Adversarial events
if (summary.adversarial_events_triggered && Object.keys(summary.adversarial_events_triggered).length) {
  push(`### Adversarial events triggered`);
  push('');
  for (const [ev, n] of Object.entries(summary.adversarial_events_triggered).sort((a, b) => b[1] - a[1])) {
    push(`- ${ev} ×${n}`);
  }
  push('');
}

// Post-stay
if (summary.post_stay) {
  const ps = summary.post_stay;
  push(`### Post-stay metrics`);
  push('');
  push(`| Metric | Value |`);
  push(`|---|---|`);
  push(`| Checkout bill dispute % | ${ps.checkout_bill_dispute_pct ?? '—'} |`);
  push(`| Departure gesture offered % | ${ps.departure_gesture_offered_pct ?? '—'} |`);
  push(`| Avg post-stay NPS delta | ${ps.avg_post_stay_nps_delta ?? '—'} |`);
  push(`| Avg review write delay (days) | ${ps.avg_review_write_delay_days ?? '—'} |`);
  push(`| Avg return intent 12m | ${ps.avg_return_intent_12m ?? '—'} |`);
  push(`| Word of mouth shared % | ${ps.word_of_mouth_shared_pct ?? '—'} |`);
  push(`| Word of mouth social post % | ${ps.word_of_mouth_social_post_pct ?? '—'} |`);
  push('');
}

// Distributions
if (summary.culture_distribution) {
  push(`### Culture cluster distribution`);
  push('');
  for (const [k, v] of Object.entries(summary.culture_distribution)) push(`- ${k}: ${v}`);
  push('');
}
if (summary.booking_channel_distribution) {
  push(`### Booking channel distribution`);
  push('');
  for (const [k, v] of Object.entries(summary.booking_channel_distribution)) push(`- ${k}: ${v}`);
  push('');
}
if (summary.price_tier_distribution) {
  push(`### Price tier distribution`);
  push('');
  for (const [k, v] of Object.entries(summary.price_tier_distribution)) push(`- ${k}: ${v}`);
  push('');
}

// ── Per-stay detail ───────────────────────────────────────────────
push(`## 2. Individual stays (${valid.length})`);
push('');

for (let i = 0; i < records.length; i++) {
  const stay = records[i];
  if (!stay) { push(`### Slot ${i}: (empty)`); push(''); continue; }
  if (stay.error) { push(`### Slot ${i}: ERROR`); push(`\`${stay.error}\``); push(''); continue; }

  const persona = stay.persona_full || stay.persona || {};
  const s = stay.sensation_summary || {};
  const es = stay.expense_summary || {};
  const bc = stay.booking_context || {};
  const cc = stay.cultural_context || {};
  const pr = stay.predicted_review || {};
  const ps = stay.post_stay || {};

  push(`### Slot ${i} — ${persona.name || '—'} (${persona.archetype_label || persona.archetype_id || '—'})`);
  push('');
  push(`- **Role:** ${persona.role || '—'} · age ${persona.age || '—'}`);
  push(`- **Origin:** ${cc.origin_country_iso || '—'} · culture ${cc.culture_cluster || '—'} · language ${cc.native_language || '—'}`);
  push(`- **Trip:** ${stay.stay_length_nights || '—'}n · ${stay.trip_purpose || '—'}`);
  push(`- **Booking:** ${bc.booking_channel || '—'} · ${bc.rate_plan || '—'} · lead ${bc.lead_time_days ?? '?'}d · €${bc.room_rate_paid_eur ?? '?'} · tier ${bc.price_tier || '—'}`);
  if (bc.pre_booked_upsells && bc.pre_booked_upsells.length) push(`- **Pre-booked:** ${bc.pre_booked_upsells.join(', ')}`);
  push(`- **Result:** ${s.stars ?? '—'}★ · NPS ${s.nps ?? '—'} · spend €${es.total_spend_eur ?? 0}`);
  push(`- **Post-stay:** repeat=${pr.would_repeat ? 'yes' : 'no'} · recommend=${pr.would_recommend ? 'yes' : 'no'} · return intent ${ps.return_intent?.return_intent_12m_probability ?? '—'}`);

  if (persona.goals && persona.goals.length) push(`- **Goals:** ${persona.goals.join(' · ')}`);
  if (persona.deal_breakers && persona.deal_breakers.length) push(`- **Deal-breakers:** ${persona.deal_breakers.join(' · ')}`);

  // Stages
  if (stay.stages && stay.stages.length) {
    push('');
    push(`#### Journey (${stay.stages.length} stages)`);
    push('');
    for (let j = 0; j < stay.stages.length; j++) {
      const stg = stay.stages[j];
      push(`**[${j}] ${stg.stage} — night ${stg.night || 1}**  `);
      if (stg.narrative) push(`> ${stg.narrative.replace(/\n+/g, ' ').slice(0, 500)}`);
      if (stg.internal_thoughts) push(`_Inner thought:_ ${stg.internal_thoughts.slice(0, 250)}  `);
      if (Array.isArray(stg.moments_positive) && stg.moments_positive.length) {
        const texts = stg.moments_positive.map(m => !m ? '' : typeof m === 'string' ? m : (m.description || m.note || '')).filter(Boolean);
        if (texts.length) push(`- ✓ ${texts.join(' · ')}`);
      }
      if (Array.isArray(stg.moments_negative) && stg.moments_negative.length) {
        const texts = stg.moments_negative.map(m => !m ? '' : typeof m === 'string' ? m : (m.description || m.note || '')).filter(Boolean);
        if (texts.length) push(`- ✗ ${texts.join(' · ')}`);
      }
      if (Array.isArray(stg.expenses_this_stage) && stg.expenses_this_stage.length) {
        push(`- €: ${stg.expenses_this_stage.map(e => `€${e.amount_eur} ${e.item || e.category}`).join(', ')}`);
      }
      push('');
    }
  }

  // Adversarial events
  if (stay.adversarial_events && stay.adversarial_events.length) {
    push(`#### Adversarial events`);
    push('');
    for (const ev of stay.adversarial_events) {
      push(`- **${ev.event_id}** at ${ev.stage || '?'} · resolution: ${ev.resolution_quality || '?'}`);
    }
    push('');
  }

  // Staff interactions
  if (stay.staff_registry && stay.staff_registry.length) {
    push(`#### Staff interactions`);
    push('');
    for (const st of stay.staff_registry) {
      push(`- ${st.name} (${st.role}) — rapport ${st.rapport_score ?? 0}`);
    }
    push('');
  }

  // Predicted review
  if (pr.will_write_review) {
    push(`#### Predicted review — ${pr.platform} · ${pr.star_rating}★ · ${pr.language || '—'}`);
    push('');
    if (pr.title) push(`**${pr.title}**`);
    push('');
    push(`${(pr.body || '').replace(/\n/g, '\n')}`);
    push('');
    if (pr.themes && pr.themes.length) push(`_Themes:_ ${pr.themes.join(' · ')}  `);
    push('');
  } else {
    push(`_No review written (reason: ${pr.reason_not_writing || 'archetype probability not met'})_`);
    push('');
  }

  // Moments summary
  if (stay.moments_positive && stay.moments_positive.length) {
    const texts = stay.moments_positive.map(m => !m ? '' : typeof m === 'string' ? m : (m.description || '')).filter(Boolean);
    if (texts.length) {
      push(`#### All positive moments (${texts.length})`);
      push('');
      for (const t of texts) push(`- ✓ ${t}`);
      push('');
    }
  }
  if (stay.moments_negative && stay.moments_negative.length) {
    const texts = stay.moments_negative.map(m => !m ? '' : typeof m === 'string' ? m : (m.description || '')).filter(Boolean);
    if (texts.length) {
      push(`#### All negative moments (${texts.length})`);
      push('');
      for (const t of texts) push(`- ✗ ${t}`);
      push('');
    }
  }

  push('---');
  push('');
}

// ── Calibration + provenance ──────────────────────────────────────
if (r.calibration) {
  push(`## 3. Calibration baseline`);
  push('');
  const cal = r.calibration;
  push(`- Review count: ${cal.review_count ?? '—'}`);
  push(`- Avg rating: ${cal.avg_rating ?? '—'}`);
  if (cal.star_distribution_pct) {
    push(`- Star distribution: ${JSON.stringify(cal.star_distribution_pct)}`);
  }
  push('');
}

if (r.cohort_enforcement) {
  push(`## 4. Cohort enforcement audit`);
  push('');
  const ce = r.cohort_enforcement;
  push(`- Fidelity score: ${ce.fidelity_score_pct ?? '—'}% (passed: ${ce.fidelity_passed})`);
  push(`- Total reassignments: ${ce.total_reassignments ?? 0} (${ce.reassignment_rate_pct ?? 0}%)`);
  push(`- Dimensions checked: ${JSON.stringify(ce.dimensions_checked || [])}`);
  push('');
}

// ── Write outputs ─────────────────────────────────────────────────
const outMd = path.join(__dirname, 'sim_92fd75dd_memory.md');
fs.writeFileSync(outMd, lines.join('\n'), 'utf-8');

// Compact structured JSON (no raw narratives, just the keyed data)
const compact = {
  meta: {
    simulation_id: '92fd75dd-b9b5-4811-befb-a6d4732d2479',
    status: data.status,
    started_at: data.started_at,
    completed_at: data.completed_at,
    property: property.name,
    brand: property.brand,
    modality: r.modality,
    provider: r.provider,
  },
  summary,
  cohort_enforcement: r.cohort_enforcement,
  calibration: r.calibration,
  audience_vector: audience,
  personas: r.personas,
  stays: valid.map((s, i) => ({
    slot: i,
    persona_name: s.persona_full?.name || s.persona?.name,
    archetype: s.persona_full?.archetype_id || s.archetype_id,
    culture_cluster: s.cultural_context?.culture_cluster,
    stars: s.sensation_summary?.stars,
    nps: s.sensation_summary?.nps,
    spend_eur: s.expense_summary?.total_spend_eur,
    would_repeat: s.predicted_review?.would_repeat,
    would_recommend: s.predicted_review?.would_recommend,
    review_platform: s.predicted_review?.platform,
    review_language: s.predicted_review?.language,
    review_title: s.predicted_review?.title,
    review_body: s.predicted_review?.body,
    review_themes: s.predicted_review?.themes,
    stage_count: (s.stages || []).length,
    adversarial_events: (s.adversarial_events || []).map(e => e.event_id),
    positive_moments: (s.moments_positive || []).length,
    negative_moments: (s.moments_negative || []).length,
    booking_channel: s.booking_context?.booking_channel,
    rate_plan: s.booking_context?.rate_plan,
    room_rate_paid_eur: s.booking_context?.room_rate_paid_eur,
  })),
};
const outJson = path.join(__dirname, 'sim_92fd75dd_compact.json');
fs.writeFileSync(outJson, JSON.stringify(compact, null, 2), 'utf-8');

console.log(`Wrote ${outMd} (${Math.round(fs.statSync(outMd).size / 1024)} KB)`);
console.log(`Wrote ${outJson} (${Math.round(fs.statSync(outJson).size / 1024)} KB)`);
console.log(`Stays: ${valid.length} valid out of ${records.length} records.`);
