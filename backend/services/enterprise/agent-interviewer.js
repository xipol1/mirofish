/**
 * Agent Interviewer — lets a Meliá analyst "interrogate" any completed synthetic guest.
 *
 * Given a stay record (single agent inside a completed simulation) plus the persona,
 * cultural / booking context and post-stay state, this module builds a first-person
 * prompt that makes the LLM answer AS the guest, citing concrete stages from their
 * experience. Supports multi-turn conversations (previous_qa) and batch interviews
 * over multiple agents in parallel.
 */

const { callAIJSON } = require('../ai');

const INTERVIEW_CONCURRENCY = parseInt(process.env.INTERVIEW_CONCURRENCY, 10) || 4;

function compactStage(stage, idx) {
  if (!stage) return null;
  return {
    idx,
    stage: stage.stage,
    night: stage.night || 1,
    narrative: (stage.narrative || '').slice(0, 400),
    internal_thoughts: (stage.internal_thoughts || '').slice(0, 200),
    moments_positive: (stage.moments_positive || []).map(m => typeof m === 'string' ? m : (m.description || m.note || '')).filter(Boolean).slice(0, 3),
    moments_negative: (stage.moments_negative || []).map(m => typeof m === 'string' ? m : (m.description || m.note || '')).filter(Boolean).slice(0, 3),
    expenses: (stage.expenses_this_stage || []).map(e => `€${e.amount_eur} ${e.item || e.category}`).slice(0, 4),
  };
}

function buildInterviewPrompt({ stayRecord, persona, bookingContext, culturalContext, question, previousQA = [] }) {
  const stages = (stayRecord.stages || []).map(compactStage).filter(Boolean);
  const sensSummary = stayRecord.sensation_summary || {};
  const postStay = stayRecord.post_stay || {};
  const predictedReview = stayRecord.predicted_review || {};
  const staff = stayRecord.staff_registry || [];
  const adversarial = stayRecord.adversarial_events || [];

  const priorTurns = previousQA.length
    ? previousQA.map((t, i) => `Turn ${i + 1}:\n  Analyst: ${t.question}\n  You answered: ${t.answer}`).join('\n\n')
    : '(this is the first question)';

  const language = culturalContext?.native_language || culturalContext?.language || 'en';
  const nationality = culturalContext?.nationality || culturalContext?.culture_cluster || 'international';
  const complaintStyle = culturalContext?.complaint_style || 'balanced';

  const personaLine = `${persona.name} · ${persona.archetype_label || persona.archetype_id} · age ${persona.age || '—'} · ${persona.role || ''}`.trim();

  return `You are ${personaLine}. You are a synthetic guest who just finished a stay at ${stayRecord.property_name || 'the property'}. An analyst is interviewing you. Answer strictly in first person, as yourself, using ONLY what you experienced during the stay described below. Do not invent facts.

=== WHO YOU ARE ===
Nationality / culture: ${nationality}
Native language: ${language}
Complaint style: ${complaintStyle}
Goals on this trip: ${(persona.goals || []).join(', ') || 'unspecified'}
Deal-breakers: ${(persona.deal_breakers || []).join(', ') || 'none'}

=== HOW YOU BOOKED ===
Channel: ${bookingContext?.booking_channel || 'unknown'} · rate plan: ${bookingContext?.rate_plan || 'unknown'} · lead time: ${bookingContext?.lead_time_days || '?'} days
Room rate paid: €${bookingContext?.room_rate_paid_eur || '?'} · price tier perceived: ${bookingContext?.price_tier || 'unknown'}
Pre-booked upsells: ${(bookingContext?.pre_booked_upsells || []).join(', ') || 'none'}

=== YOUR STAY, STAGE BY STAGE (${stages.length} stages, ${stayRecord.stay_length_nights || '?'} nights) ===
${stages.map(s => `[${s.idx}] ${s.stage.toUpperCase()} (night ${s.night})
  Narrative: "${s.narrative}"
  Inner thought: ${s.internal_thoughts || '—'}
  + Positives: ${s.moments_positive.join(' | ') || '—'}
  - Negatives: ${s.moments_negative.join(' | ') || '—'}
  Spend: ${s.expenses.join(', ') || '—'}`).join('\n\n')}

=== ADVERSE INCIDENTS THAT HAPPENED ===
${adversarial.length ? adversarial.map(e => `- ${e.event_id} at ${e.stage || '?'}: resolution ${e.resolution_quality || '?'}`).join('\n') : '(none)'}

=== STAFF YOU INTERACTED WITH ===
${staff.length ? staff.map(s => `- ${s.name} (${s.role}) — rapport ${s.rapport_score ?? 0}`).join('\n') : '(none memorable)'}

=== HOW YOU FELT BY THE END ===
Final stars you would give: ${sensSummary.stars ?? '?'}/5
Your NPS score: ${sensSummary.nps ?? '?'}
Would you return: ${predictedReview.would_repeat ? 'yes' : 'no'} · Would you recommend: ${predictedReview.would_recommend ? 'yes' : 'no'}
Return intent 12m: ${postStay.return_intent?.return_intent_12m_probability ?? '?'}
Did you write a review: ${predictedReview.will_write_review ? `yes, on ${predictedReview.platform}` : 'no'}
${predictedReview.body ? `Review body you wrote:\n"${predictedReview.body.slice(0, 400)}"` : ''}

=== PRIOR TURNS IN THIS INTERVIEW ===
${priorTurns}

=== THE ANALYST NOW ASKS ===
"${question}"

=== INSTRUCTIONS ===
Answer in first person, conversational, 2-5 sentences, in ${language === 'es' ? 'Spanish' : language === 'de' ? 'German' : language === 'fr' ? 'French' : language === 'it' ? 'Italian' : language === 'pt' ? 'Portuguese' : 'English'}.
Cite at least ONE concrete stage index from the journey above (by idx) that backs your answer. If the question is about something you never experienced, say so honestly — do not fabricate.

Return ONLY this JSON:
{
  "answer": "your first-person reply, 2-5 sentences, natural tone",
  "emotional_tone": "delighted|satisfied|neutral|frustrated|angry|disappointed|nostalgic",
  "cited_stage_indices": [array of stage indices (integers) you drew from],
  "memory_confidence_0_1": 0.0-1.0 (how clearly you remember the relevant moments),
  "mentioned_themes": ["2-5 short tags: wifi, value, staff, room, food, etc."]
}`;
}

async function interviewAgent({ stayRecord, persona, bookingContext, culturalContext, question, previousQA = [] }) {
  if (!stayRecord || stayRecord.error) {
    return { answer: null, error: 'stay record missing or failed', emotional_tone: null, cited_stage_indices: [], memory_confidence_0_1: 0 };
  }
  if (!question || !question.trim()) {
    return { answer: null, error: 'question is empty', emotional_tone: null, cited_stage_indices: [], memory_confidence_0_1: 0 };
  }

  const prompt = buildInterviewPrompt({ stayRecord, persona, bookingContext, culturalContext, question, previousQA });

  let result;
  try {
    result = await callAIJSON(prompt, { maxTokens: 700, temperature: 0.6 });
  } catch (err) {
    console.error('[agent-interviewer] LLM failed:', err.message.substring(0, 150));
    return {
      answer: null,
      error: `LLM call failed: ${err.message.substring(0, 120)}`,
      emotional_tone: null,
      cited_stage_indices: [],
      memory_confidence_0_1: 0,
    };
  }

  return {
    answer: result.answer || null,
    emotional_tone: result.emotional_tone || 'neutral',
    cited_stage_indices: Array.isArray(result.cited_stage_indices) ? result.cited_stage_indices.filter(n => Number.isFinite(n)) : [],
    memory_confidence_0_1: typeof result.memory_confidence_0_1 === 'number'
      ? Math.max(0, Math.min(1, result.memory_confidence_0_1))
      : 0.6,
    mentioned_themes: Array.isArray(result.mentioned_themes) ? result.mentioned_themes.slice(0, 6) : [],
    persona_name: persona?.name || null,
    archetype: persona?.archetype_label || persona?.archetype_id || null,
  };
}

/**
 * Run interviews for many agents in parallel. `items` is an array of
 * { stayRecord, persona, bookingContext, culturalContext, question, previousQA? }
 */
async function interviewMultipleAgents(items) {
  const results = new Array(items.length);
  let nextIdx = 0;

  async function worker() {
    while (true) {
      const my = nextIdx++;
      if (my >= items.length) return;
      try {
        results[my] = {
          agent_slot: items[my].agent_slot,
          ...(await interviewAgent(items[my])),
        };
      } catch (err) {
        results[my] = {
          agent_slot: items[my].agent_slot,
          answer: null,
          error: err.message.substring(0, 200),
        };
      }
    }
  }

  const n = Math.min(INTERVIEW_CONCURRENCY, items.length);
  await Promise.all(Array.from({ length: n }, () => worker()));
  return results;
}

module.exports = { interviewAgent, interviewMultipleAgents, buildInterviewPrompt };
