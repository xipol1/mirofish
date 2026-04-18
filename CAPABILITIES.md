# Synthetic Users — Enterprise Capabilities

Eight additive capabilities (A–H) built on top of the existing simulation stack.
Every existing endpoint stays intact; new endpoints ride alongside.

Base URL assumed: `http://localhost:5001`.

---

## A. Agent Interview

Ask a completed synthetic guest anything in natural language. The LLM answers
in first person from inside the stay record.

**Single agent**
```bash
curl -X POST http://localhost:5001/api/simulation/$SIM_ID/agent/0/interview \
  -H 'Content-Type: application/json' \
  -d '{"question": "¿Qué fue lo mejor de tu estancia?"}'
```

**With conversation memory (multi-turn)**
```bash
curl -X POST http://localhost:5001/api/simulation/$SIM_ID/agent/0/interview \
  -H 'Content-Type: application/json' \
  -d '{
    "question": "Y entonces, ¿volverías?",
    "previous_qa": [{"question": "¿Qué fue lo mejor?", "answer": "La vista al mar..."}]
  }'
```

**Batch across the cohort, filtered**
```bash
curl -X POST http://localhost:5001/api/simulation/$SIM_ID/interview-cohort \
  -H 'Content-Type: application/json' \
  -d '{
    "question": "What would make you return?",
    "filters": {"archetype": "digital_nomad", "nps_max": 0},
    "max_agents": 10
  }'
```

Response fields: `answer`, `emotional_tone`, `cited_stage_indices`,
`memory_confidence_0_1`, `mentioned_themes`.

---

## B. Agent Cohort Retrieval

Filter agents by any combination of archetype, NPS band, price tier, channel,
adverse events, or keyword themes.

```bash
curl -X POST http://localhost:5001/api/simulation/$SIM_ID/agents/query \
  -H 'Content-Type: application/json' \
  -d '{
    "criteria": {
      "mentioned_theme": ["wifi", "value"],
      "nps_max": 0,
      "archetype": ["digital_nomad", "budget_optimizer"]
    }
  }'
```

Response: `{ count, matched: [...agents], summary: { avg_nps, theme_frequency, shared_friction, shared_delight } }`.

---

## C. Attribution Decomposition

Decomposes an agent's NPS into per-dimension and per-stage contributions using
the sensation-history captured during simulation.

**Per agent**
```bash
curl http://localhost:5001/api/simulation/$SIM_ID/agent/0/attribution
```

**Whole cohort + per-archetype drivers**
```bash
curl http://localhost:5001/api/simulation/$SIM_ID/attribution
```

Response highlights: `top_3_positive_drivers`, `top_3_negative_drivers` (with
`example_moment` text), `adversarial_event_nps_impact`, `per_stage_nps_delta`.

---

## D. A/B Counterfactual Engine

Runs baseline + variant on the same frozen personas. Delta is causal, not
correlational, and ships with bootstrap-based significance.

```bash
curl -X POST http://localhost:5001/api/counterfactual \
  -H 'Content-Type: application/json' \
  -d '{
    "modality": "stay_experience",
    "audience": "European couples 30-55 high-income visiting Menorca in shoulder season",
    "agent_count": 8,
    "property": {"name": "Villa Le Blanc", "slug": "villa-le-blanc", "data_json": {"tier": "luxury"}},
    "baseline_inputs": {},
    "variant_inputs": {"pre_booked_upsells_override": ["airport_transfer", "spa_credit"]},
    "variant_label": "bundle_amenities_inclusive"
  }'
```

The response is `{simulationId}`. Poll `GET /api/simulation/$SIM_ID` like any
simulation; on completion the result contains `delta.avg_nps_delta`,
`delta.avg_spend_delta`, `delta.significance.nps_p_value` and
`delta.revenue_projection_eur_annual`. The frontend at
`/counterfactual/[id]` renders it side-by-side.

---

## E. Confidence Intervals

Every stay_experience simulation summary now carries a `_ci` shape for each
aggregated metric (`avg_stars_ci`, `avg_nps_ci`, `avg_spend_eur_ci`,
`would_repeat_pct_ci`, `realized_star_distribution_pct_ci`, …).

```js
summary.avg_nps_ci === { value: 45, ci_low: 38, ci_high: 52, std: 6.2, n: 50 }
```

The bootstrap is deterministic when a seed is provided via
`addConfidenceIntervalsToSummary(summary, stays, { seed: 42 })`. The frontend
renders `45 ± 7` next to each KPI card.

---

## F. Revenue Playbook Auto-generator

Generates a branded document for the CRO from any completed simulation.

```bash
# Markdown (ES default)
curl -OJ "http://localhost:5001/api/simulation/$SIM_ID/playbook?format=md&language=es"

# HTML (EN)
curl -OJ "http://localhost:5001/api/simulation/$SIM_ID/playbook?format=html&language=en"

# JSON (structured)
curl "http://localhost:5001/api/simulation/$SIM_ID/playbook?format=json"

# Word (requires `docx` module installed globally or in deps)
curl -OJ "http://localhost:5001/api/simulation/$SIM_ID/playbook?format=docx&language=es"
```

Sections: executive summary (with CIs), segment matrix, top friction/delight,
NPS attribution drivers, auto-generated recommendations P0–P3, sample detractor/
passive/promoter reviews, provenance, appendix.

---

## G. Multi-language Review Output

Reviews are now written in the guest's native language derived from
`cultural_context.native_language`: German for `german_dach`, Spanish for
`spanish` and `latam`, Italian for `italian`, Portuguese for `brazilian`, etc.
The response `predicted_review.language` holds the ISO code.

No endpoint change needed — just run any stay simulation; review bodies will be
in the right language per agent.

---

## H. Longitudinal Agent Persistence

When PostgreSQL is configured (`DATABASE_URL`), every completed stay persists
the persona into `synthetic_agents` and the stay into `agent_stay_history`.
Tables are created on first use.

```bash
# List known agents
curl http://localhost:5001/api/agents?archetype=luxury_seeker&limit=50

# Get a specific agent's full history
curl http://localhost:5001/api/agent/$AGENT_ID/history
```

To reuse agents in a future simulation, pass them via
`modality_inputs._frozen_personas` (also used internally by the counterfactual
engine). The orchestrator will reuse those personas instead of regenerating.

If PG is not configured, persistence is a silent no-op — all other capabilities
still work.

---

## Testing

```bash
node backend/tests/agent-interviewer.test.js     # 4 tests — pure prompt / shape
node backend/tests/attribution-engine.test.js    # 5 tests — decomposition math
node backend/tests/confidence-intervals.test.js  # 5 tests — bootstrap + summary
```

All 14 tests pass on a clean run.

### Manual end-to-end

1. Launch a stay simulation with n=3 at Villa Le Blanc.
2. Wait for status `completed` (`GET /api/simulation/$SIM_ID`).
3. `curl -X POST /api/simulation/$SIM_ID/agent/0/interview -d '{"question":"¿qué te gustó más?"}'` → first-person answer.
4. `GET /api/simulation/$SIM_ID/agent/0/attribution` → NPS decomposition.
5. `POST /api/simulation/$SIM_ID/agents/query -d '{"criteria":{"nps_min":0}}'` → filtered cohort.
6. `GET /api/simulation/$SIM_ID/playbook?format=md&language=es` → Markdown playbook buffer.
7. `POST /api/counterfactual -d '{...}'` → counterfactual in-flight.
