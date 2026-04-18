# MEGA-PROMPT PARA CLAUDE OPUS 4.7 — Synthetic Users Enterprise Build

## Contexto del proyecto

Estás trabajando en el repo `Synthetic Users` — una plataforma que simula huéspedes sintéticos de hotel atravesando el journey completo (arrival → room → F&B → checkout → post-stay review) para que un CRO de hospitality prediga outcomes de revenue antes de desplegar cambios.

**Cliente target:** Meliá Hotels International (390+ hoteles, ~€2B revenue anual).
**Primera propiedad a validar:** Gran Meliá Villa Le Blanc, Menorca.
**Piloto comercial confirmado:** reunión mañana con CRO/CMO.
**Accuracy demostrada:** F1 91,4% de theme detection contra 572 reviews reales (backtest público).

**Stack actual:**
- Backend: Node.js Express (puerto 5001) + SQLite (Villa Le Blanc corpus) + opcional PostgreSQL
- Frontend: Next.js 14 (puerto 5002)
- LLM: Ollama qwen2.5:3b local (fallback Groq/Claude — cambiaremos a Claude Opus 4.7 para producción)
- Workspace: `C:\Users\win\Desktop\Nueva carpeta (6)\MiroFish-main\`

## Objetivo de esta sesión

**Implementar 8 capacidades críticas** que permiten a un CRO de Meliá **extraer todo el valor posible de cada huésped sintético** generado, transformando la plataforma de "simulación con informe estático" a "plataforma interactiva de inteligencia de revenue con audit trail".

El criterio de éxito es: un analista de Meliá puede, partiendo de una simulación completada de 50 huéspedes, **responder cualquier pregunta comercial específica en minutos** (qué huésped, qué dimensión, qué escenario contrafactual, qué uplift estimado).

---

## Infraestructura actual — NO REIMPLEMENTAR

Los siguientes módulos **ya existen y funcionan**. Debes reusarlos, no reescribirlos:

### Módulos de servicio (`backend/services/enterprise/`)

| Módulo | Qué hace |
|---|---|
| `simulation-orchestrator.js` | Orquestador modality-agnostic. Corre cualquier modality con N agentes en paralelo. |
| `modalities/index.js` | Registro central de modalities (stay_experience, booking_engine_test, rate_strategy_test, loyalty_change_test). |
| `modalities/stay-experience.js` | Modality principal. Ejecuta 8-16 stages por huésped. Usa runStay de guest-journey. |
| `guest-journey.js` | Ejecuta stages por huésped con inyección de adversarial events + staff continuity. |
| `narrative-engine.js` | Construye prompts por stage + llama LLM + normaliza output JSON. |
| `sensation-tracker.js` | 13 dimensiones sensoriales. Matemática sqrt bonus / linear penalty. |
| `cultural-profiles.js` | 10 clusters (german_dach, anglo_uk_ireland, etc.) con modifiers Hofstede-calibrados. |
| `booking-context.js` | Rate paid, channel, lead time, rate plan, upsells pre-booked. |
| `external-context.js` | Season, weather per night, occupancy, local events. |
| `staff-registry.js` | Named staff entities con rapport score acumulado cross-stage. |
| `post-stay-journey.js` | Checkout, billing, departure, email delay, review write delay, WoM, return intent. |
| `adversarial-events.js` | 15 tipos de incidentes con deltas calibrados per-archetype. |
| `star-sampler.js` | Stratified star target sampling con archetype skews. |
| `cohort-enforcer.js` | Valida + rebalancea distribuciones del cohorte vs market pack. |
| `market-packs.js` | 5 packs (UK, DE, ES, US, LATAM) schema v0.2 con provenance. |
| `review-predictor.js` | Genera reviews predichas basándose en stay record. |

### Data (`backend/data/`)

- `industries/hospitality/sensation_dimensions.json` — 13 dims con baselines per-archetype + star thresholds
- `industries/hospitality/stay_behaviors.json` — 8 archetypes con `theme_scope` (primary/rarely/never mentioned)
- `industries/hospitality/cultural_profiles.json` — 10 clusters con Hofstede
- `industries/hospitality/adversarial_events.json` — 15 eventos con deltas + archetype sensitivity
- `industries/hospitality/villa_le_blanc_calibration.json` — Villa Le Blanc v2.0 con 77/15/5/2/1 distribution + subcategory anchors TA
- `datasets/behavioral_studies/hofstede_6d_scores.json` — 30 países × 6 dims
- `datasets/behavioral_studies/hospitality_benchmarks_2024.json` — NPS benchmarks QuestionPro, review rates MARA, etc.
- `validation/villa_le_blanc_real_corpus_2026_04.json` — 572 reviews reales con 22 temas catalogados
- `sources/catalog.json` — catálogo de 12 fuentes citadas
- `market_packs/{uk,de,es,us,latam}.json` — 5 packs

### Endpoints existentes (backend/routes/properties.js)

- `POST /api/simulate` — Lanza simulación con modality específica
- `POST /api/stay-simulate-direct` — Legacy endpoint (llama stay_experience)
- `GET /api/simulation/:id` — Estado + resultados completos
- `GET /api/stay-simulation/:id` — Legacy
- `GET /api/modalities` — Lista modalities
- `GET /api/market-packs` — Lista packs
- `GET /api/market-packs/:id/provenance` — Auditoría de provenance
- `GET /api/sources`, `/api/sources/:id` — Catálogo de fuentes

### Frontend

- `frontend/pages/stays/[id].js` — Página de polling de simulación con vista por stay

**NO rompas ninguno de estos endpoints.** Todo lo que construyas debe ser aditivo.

---

## Capacidades a construir en ESTA sesión

### CAPACIDAD A — AI Moderator (Agent Interview)

**Problema:** Tras terminar una simulación, el stay record de cada huésped es un JSON que puedes leer pero **no "preguntarle"**. Un analista de Meliá quiere poder interrogar a un agente específico en lenguaje natural sobre su experiencia.

**Deliverable:**

1. **Módulo nuevo:** `backend/services/enterprise/agent-interviewer.js`

```js
/**
 * Agent Interviewer — permite preguntar a un huésped sintético completado
 * sobre su experiencia. El LLM responde en primera persona con memoria
 * completa del stay.
 */
async function interviewAgent({ stayRecord, persona, bookingContext, culturalContext, question, previousQA = [] }) {
  // Construye prompt con:
  //   1. Persona (name, age, archetype_label, goals, deal_breakers)
  //   2. Cultural context (origin country, language, complaint style)
  //   3. Booking context (room rate, channel, lead time)
  //   4. Stay journey completo: cada stage con narrative + sensations + moments
  //   5. Adversarial events que ocurrieron y resolution_quality
  //   6. Staff interactions con rapport
  //   7. Post-stay state (return intent, WoM, NPS correction)
  //   8. Review predicho (si existe)
  //   9. Previous Q&A turns (si es conversación multi-turn)
  // Llama callAIJSON con temperatura 0.6
  // Retorna: { answer, emotional_tone, cited_stage_indices, memory_confidence_0_1 }
}

async function interviewMultipleAgents({ simulationResult, agentIndices, question }) {
  // Ejecuta interviewAgent en paralelo para N agentes
  // Returns: array of { agent_slot, persona_name, answer, ... }
}
```

2. **Endpoint nuevo:** `POST /api/simulation/:simulationId/agent/:agentSlot/interview` en `properties.js`
   - Body: `{ question: string, previous_qa?: [{question, answer}] }`
   - Respuesta: `{ answer, emotional_tone, cited_stage, memory_confidence, persona_name, archetype }`
   - Lee la simulación del activeStaySims cache + del result; si no hay resultado (sim sin completar) responde 409.
   - Timeout 60s.

3. **Endpoint multi-agente:** `POST /api/simulation/:simulationId/interview-cohort`
   - Body: `{ question: string, filters?: { archetype?, nps_min?, nps_max? }, max_agents: default 10 }`
   - Respuesta: array de respuestas de agentes filtrados

4. **Frontend:** extender `frontend/pages/stays/[id].js`
   - Cuando la sim está `completed`, por cada stay mostrar botón **"Interview this guest"**
   - Al click abre modal con:
     - Textarea para pregunta
     - Botón "Ask"
     - Historial de Q&A con la respuesta renderizada (preservando saltos de línea)
     - Muestra el persona_name + archetype en el header del modal
   - Soporta conversación multi-turn (envía previous_qa en cada llamada)

**Criterios de éxito:**
- Preguntar a un Luxury Seeker con NPS +45: *"¿qué fue lo mejor de tu estancia?"* → respuesta coherente en primera persona citando moments positivos específicos de su stage history
- Preguntar a un Digital Nomad con NPS -66: *"¿qué te haría volver?"* → respuesta cita wifi + pricing específicamente
- Multi-turn: follow-up preguntas usan contexto previo

---

### CAPACIDAD B — Agent Cohort Retrieval

**Problema:** Dado una simulación de 50 agentes, un analista quiere filtrar: "muéstrame todos los que mencionaron wifi AND tenían NPS<0 AND están en segmento couples".

**Deliverable:**

1. **Módulo:** `backend/services/enterprise/agent-retrieval.js`

```js
/**
 * Filtra agentes dentro de una simulación según criterios múltiples.
 */
function queryAgents(simulationResult, criteria = {}) {
  // criteria:
  //   archetype: string | string[]
  //   culture_cluster: string | string[]
  //   market_pack: string | string[]
  //   nps_min: number
  //   nps_max: number
  //   stars_min: number
  //   stars_max: number
  //   would_repeat: boolean
  //   would_recommend: boolean
  //   has_adversarial_event: boolean | string (event_id)
  //   mentioned_theme: string | string[]  (busca en moments + narrative)
  //   price_tier: string | string[]
  //   booking_channel: string | string[]
  //   spend_min: number
  //   spend_max: number
  // Retorna array ordenado por NPS desc con: { slot, persona_name, archetype, stars, nps, spend, matched_themes[], key_moment }
}

function summarizeCohortQuery(agents, simulationResult) {
  // Retorna: { n: count, avg_nps, avg_spend, avg_stars,
  //            theme_frequency: {}, shared_friction: [], shared_delight: [] }
}
```

2. **Endpoint:** `POST /api/simulation/:simulationId/agents/query`
   - Body: objeto `criteria`
   - Respuesta: `{ matched: [...agents], summary: {...}, count: n }`

3. **Frontend:** añadir en `frontend/pages/stays/[id].js` un panel "Cohort query" con:
   - Filtros (selects + number ranges)
   - Botón "Query"
   - Resultado: lista colapsable de agentes matcheados + summary metrics

**Criterios de éxito:**
- Query `{mentioned_theme: 'wifi', nps_max: 0}` devuelve solo agentes con wifi + NPS negativo
- Summary muestra theme_frequency ordenado, avg metrics del cohorte

---

### CAPACIDAD C — Attribution Decomposition

**Problema:** Cuando un agente tiene NPS -66, ¿cuánto viene de wifi, cuánto de ruido, cuánto de check-in? Sin esta decomposición las recomendaciones son hand-wavy.

**Deliverable:**

1. **Módulo:** `backend/services/enterprise/attribution-engine.js`

```js
/**
 * Decomposición de contribución per-dimension al NPS final.
 * Usa sensation_history + deltas por stage + adversarial events.
 */
function decomposeAgentNPS(stayRecord) {
  // Calcula:
  //   baseline_nps (arrival state → NPS)
  //   per_stage_nps_delta: array de { stage, delta, contributors: { dim: points } }
  //   adversarial_event_nps_impact: per incident
  //   final_nps
  //   dimension_total_contribution: { aesthetic: +Xpts, value: -Ypts, ... }
  //   top_3_positive_drivers: [{dim, points, example_moment}]
  //   top_3_negative_drivers: [{dim, points, example_moment}]
  // Retorna decomposición completa
}

function decomposeCohortNPS(simulationResult) {
  // Agrega decomposición a nivel cohorte
  // Retorna: { cohort_avg_nps, top_drivers_cohort_level, segment_drivers: { archetype: {top_drivers} } }
}
```

2. **Endpoints:**
   - `GET /api/simulation/:simulationId/agent/:agentSlot/attribution` — un agente
   - `GET /api/simulation/:simulationId/attribution` — cohorte completo

3. **Frontend:** añadir en cada stay card un toggle "Why did this rating happen?" que muestra barras horizontales con los drivers positivos (verdes) y negativos (rojos) con sus puntos.

**Criterios de éxito:**
- Digital Nomad con NPS -66: attribution muestra wifi_intermittent contribuyendo -28pts, noisy_neighbors -15pts, etc.
- Cohort view: muestra los 5 drivers más impactantes del cohorte con segmentación por archetype

---

### CAPACIDAD D — A/B Counterfactual Engine

**Problema:** Meliá pregunta "¿y si quitamos el resort fee?". No podemos responder porque cada simulación es estática.

**Deliverable:**

1. **Módulo:** `backend/services/enterprise/counterfactual-engine.js`

```js
/**
 * Corre 2 simulaciones en paralelo con las MISMAS personas pero inputs diferentes.
 * Reporta delta causal (no correlacional).
 */
async function runCounterfactual({
  modality,
  audience,
  agent_count,
  property,
  baseline_inputs,       // inputs originales
  variant_inputs,        // inputs a probar
  variant_label,         // 'remove_resort_fee', 'bundle_wifi', etc.
  onProgress,
}) {
  // 1. Genera personas UNA VEZ
  // 2. Corre modality con baseline_inputs
  // 3. Corre modality con variant_inputs (mismas personas)
  // 4. Calcula delta per-agent y per-cohorte en todas las métricas
  // 5. Retorna:
  //    {
  //      baseline_result: {...},
  //      variant_result: {...},
  //      delta: {
  //        avg_nps_delta, avg_stars_delta, avg_spend_delta,
  //        per_agent_deltas: [{slot, nps_delta, stars_delta, spend_delta}],
  //        per_segment_delta: { archetype: {delta_nps, delta_spend} },
  //        significance: { metric: p_value },  // bootstrap
  //        revenue_projection_eur: estimated annual uplift
  //      }
  //    }
}
```

2. **Endpoint:** `POST /api/counterfactual`
   - Body: `{ modality, audience, agent_count, property, baseline_inputs, variant_inputs, variant_label }`
   - Devuelve simulation_id que polleas igual que cualquier sim normal; cuando completa devuelve el delta report
   - Tiempo: 2× el de una simulación normal

3. **Frontend:** pagina nueva `frontend/pages/counterfactual/[id].js` con:
   - Vista side-by-side baseline vs variant
   - Delta bars con colores (verde uplift, rojo downlift)
   - Per-segment breakdown

**Criterios de éxito:**
- Baseline: `pre_booked_upsells: []`. Variant: `pre_booked_upsells: ['airport_transfer']`. El delta debe mostrar mejora en satisfaction + revenue boost.
- La significancia estadística se calcula con bootstrap 1000 resamples.

---

### CAPACIDAD E — Confidence Intervals en todos los outputs agregados

**Problema:** Reportamos "NPS = 45" cuando debería ser "NPS = 45 ± 7 (95% CI, n=50)".

**Deliverable:**

1. **Módulo:** `backend/services/enterprise/confidence-intervals.js`

```js
function bootstrap(samples, metricFn, nResamples = 1000) {
  // Retorna { mean, ci_95_low, ci_95_high, std_dev, n }
}

function addConfidenceIntervalsToSummary(summary, stays) {
  // Modifica el summary para que cada métrica numérica tenga su CI
  // En lugar de `avg_nps: 45`, tener `avg_nps: { value: 45, ci_low: 38, ci_high: 52, std: 12, n: 50 }`
  // Aplica a: avg_stars, avg_nps, net_promoter_score, avg_spend_eur, would_repeat_pct, would_recommend_pct,
  //           realized_star_distribution_pct (por bucket), conversion rates en booking_engine, etc.
}
```

2. **Integración:** el orquestador llama `addConfidenceIntervalsToSummary` antes de retornar result.summary.

3. **Frontend:** cada métrica muestra `45 ± 7` formato.

**Criterios de éxito:**
- Todas las métricas agregadas tienen CI
- Bootstrap reproducible (seed opcional)

---

### CAPACIDAD F — Revenue Playbook Auto-generator

**Problema:** Actualmente existe `scripts/build_melia_report_standalone.js` que genera el informe .docx, pero está ad-hoc. Debe ser un endpoint.

**Deliverable:**

1. **Módulo:** `backend/services/enterprise/revenue-playbook.js`

```js
async function generateRevenuePlaybook({ simulationId, format = 'docx', language = 'es' }) {
  // Carga simulación completed
  // Construye documento con secciones:
  //   1. Portada + meta (property, audience, n_agents, accuracy score si existe backtest)
  //   2. Executive summary (KPIs con CI)
  //   3. Segment revenue matrix (2x2)
  //   4. Per-archetype findings (tabla)
  //   5. Top friction clusters (ranked by cohort impact)
  //   6. Predicted review samples (3: detractor/passive/promoter)
  //   7. Attribution cohort-level (los 5 drivers de NPS)
  //   8. 7 recommendations P0-P3 (auto-generadas por segmento afectado)
  //   9. Methodology notes + provenance + sources list
  //   10. Appendix: metadata simulación + versión calibration
  // Retorna Buffer del .docx (o .pdf si format=pdf)
}
```

2. **Endpoint:** `GET /api/simulation/:simulationId/playbook?format=docx&language=es`
   - Devuelve archivo para descarga

3. **Frontend:** botón "Download Revenue Playbook" en stays/[id].js cuando status=completed

**Criterios de éxito:**
- Genera .docx de 20-30 páginas branded Meliá (burgundy/navy/gold)
- Sin intervención manual
- Multi-idioma (ES y EN mínimo)

---

### CAPACIDAD G — Multi-language Review Output

**Problema:** Actualmente todas las reviews predichas son en inglés. Un huésped alemán debería escribir en alemán, español en español.

**Deliverable:**

1. **Modificar:** `backend/services/enterprise/review-predictor.js`
   - Detectar `cultural_context.native_language`
   - Pasar al prompt LLM: "Write this review in [language]. Use the natural vocabulary of a [nationality] reviewer."

2. **Modificar:** `modalities/stay-experience.js` en `runForAgent` — pasar cultural_context a predictReview (ya debería estarlo, verificar)

3. **Añadir campo output:** `predicted_review.language` (código ISO)

**Criterios de éxito:**
- Un agente German_DACH escribe review en alemán
- Un Spanish escribe en español
- UK/US escribe en inglés
- LATAM escribe en español

---

### CAPACIDAD H — Longitudinal Agent Persistence

**Problema:** Cada simulación genera personas nuevas. No se pueden "reusar" agentes entre sims para trackear evolución.

**Deliverable:**

1. **Modificar schema DB** — añadir tabla `synthetic_agents`:
   ```sql
   CREATE TABLE IF NOT EXISTS synthetic_agents (
     agent_id TEXT PRIMARY KEY,
     persona_json JSONB,
     archetype_id TEXT,
     culture_cluster TEXT,
     created_at TIMESTAMP DEFAULT NOW(),
     first_simulation_id TEXT
   );
   CREATE TABLE IF NOT EXISTS agent_stay_history (
     agent_id TEXT,
     simulation_id TEXT,
     stay_record_json JSONB,
     completed_at TIMESTAMP,
     PRIMARY KEY (agent_id, simulation_id)
   );
   ```

2. **Modificar:** `simulation-orchestrator.js` para persistir agentes tras cada sim

3. **Modificar:** `personaGenerator.js` para aceptar parámetro `reuse_agent_ids?: string[]` y traer personas persistidas

4. **Endpoint:** `GET /api/agent/:agentId/history` — histórico de estancias de un agente

5. **Cross-sim memory injection:** si una persona ya tuvo una stay previa, el narrative-engine incluye un bloque "YOUR PRIOR EXPERIENCE AT THIS PROPERTY" con key moments de la stay anterior.

**Criterios de éxito:**
- Ejecutar 2 simulaciones con `reuse_agent_ids` de la primera → los agentes conservan coherencia (archetypes, nombres, cultural origin)
- GET history devuelve estancia 1 + estancia 2

---

## Reglas arquitecturales

1. **Backward compatibility:** ningún endpoint existente puede cambiar su contrato. Solo añadir nuevos.
2. **Reuse antes que reimplementar:** todas las capacidades usan módulos existentes (sensation-tracker, market-packs, etc.).
3. **No cambies calibraciones:** los números en sensation_dimensions.json, cultural_profiles.json, adversarial_events.json ya están calibrados contra benchmarks reales. No los modifiques.
4. **LLM calls:** usar `backend/services/ai.js` → `callAIJSON`. Ya maneja retry, rate limit, multi-provider.
5. **Logging:** consistente con estilo existente (console.log con `[module-name]` prefix).
6. **Error handling:** try/catch + substring(0, 200) en errors, no dejar que 1 agent failure mate la request.
7. **Concurrency:** reusar el pattern de CONCURRENCY constant + worker pool.
8. **Schema validation:** usar zod o validación manual en endpoints (body.property.name required, etc.).
9. **Tests:** para cada módulo nuevo, crear `backend/tests/{module}.test.js` con 3-5 tests unitarios (usar Node built-in `node:test` o similar).
10. **Comments:** mínimos pero explican el "por qué" no el "qué".

---

## Output esperado

Al final de la sesión debe existir:

### Nuevos archivos backend (8+)

- `backend/services/enterprise/agent-interviewer.js`
- `backend/services/enterprise/agent-retrieval.js`
- `backend/services/enterprise/attribution-engine.js`
- `backend/services/enterprise/counterfactual-engine.js`
- `backend/services/enterprise/confidence-intervals.js`
- `backend/services/enterprise/revenue-playbook.js`
- `backend/tests/agent-interviewer.test.js`
- `backend/tests/attribution-engine.test.js`
- `backend/tests/confidence-intervals.test.js`

### Archivos modificados

- `backend/routes/properties.js` — añade 8+ endpoints nuevos
- `backend/services/enterprise/review-predictor.js` — multi-language
- `backend/services/enterprise/simulation-orchestrator.js` — integra CI + persistencia agente
- `backend/db/pg.js` (o migración SQL) — tablas agents + history

### Nuevos archivos frontend

- `frontend/pages/counterfactual/[id].js` — vista side-by-side
- `frontend/components/AgentInterviewModal.jsx` — modal de entrevista
- `frontend/components/AttributionBarChart.jsx` — barras de drivers
- `frontend/components/CohortQueryPanel.jsx` — panel de filtros

### Archivos modificados frontend

- `frontend/pages/stays/[id].js` — añade botones Interview + Attribution + download Playbook + Cohort Query

### Testing

Al final, ejecuta:
1. `node backend/tests/agent-interviewer.test.js`
2. `node backend/tests/attribution-engine.test.js`
3. `node backend/tests/confidence-intervals.test.js`
4. Test end-to-end manual: lanzar una simulación n=3 Villa Le Blanc, esperar completion, hacer POST a `/api/simulation/:id/agent/0/interview` con `{question: "qué te gustó más?"}`, verificar respuesta.

### Documento

- `CAPABILITIES.md` en la raíz: describe las 8 capacidades nuevas con un ejemplo de cURL/fetch por cada endpoint.

---

## Restricciones

- **No añadas dependencias pesadas.** Evita ML libs (tensorflow, pytorch, transformers). El proyecto es intencionalmente LLM + heuristics, no ML entrenado.
- **No cambies el package.json salvo para añadir dependencias necesarias.** Si añades, justifica en un comentario.
- **No toques el schema del stay_record.** Es consumido por el frontend existente. Puedes añadir campos, no eliminar.
- **Usa Spanish en las respuestas de los agentes SOLO si su cultural_context.native_language lo indica.**

## Prioridad si no hay tiempo para todo

Si por alguna razón no puedes completar las 8 capacidades:

**Must-have (bloquean la reunión con Meliá):**
- A (Agent Interview)
- C (Attribution)
- D (Counterfactual)

**Should-have (aumentan valor comercial):**
- F (Revenue Playbook auto-gen)
- E (Confidence intervals)
- B (Cohort retrieval)

**Nice-to-have (diferenciación):**
- G (Multi-language)
- H (Longitudinal persistence)

---

## Success criteria de la sesión

Al final, con una sola simulación completada de Villa Le Blanc n=20, un analista debe poder:

1. **Preguntarle a cualquier agente cualquier pregunta** y recibir respuesta coherente con su stay
2. **Filtrar agentes** por criterios combinados y ver summary del cohorte
3. **Ver por qué** cualquier agente tiene el NPS que tiene (attribution)
4. **Correr un contrafactual** "¿y si hacemos X?" y ver el delta
5. **Descargar el Revenue Playbook** en .docx
6. **Ver CIs** en todas las métricas agregadas
7. **Ver reviews en el idioma nativo** del guest sintético
8. **Persistir agentes** para reusarlos en sims futuras

Ejecuta. No me preguntes clarificaciones salvo que haya ambigüedad bloqueante. Al terminar, produce un resumen de qué se construyó, qué se testeó, y qué queda pendiente (si algo).
