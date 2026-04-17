import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';

const API_URL = process.env.NEXT_PUBLIC_API_URL || (typeof window !== 'undefined' && window.location.hostname !== 'localhost' ? '' : 'http://localhost:5001');

function apiFetch(path, options = {}) {
  const headers = { ...options.headers, 'bypass-tunnel-reminder': 'true' };
  return fetch(`${API_URL}${path}`, { ...options, headers });
}

export default function Results() {
  const router = useRouter();
  const { id } = router.query;

  const [status, setStatus] = useState('running');
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [elapsed, setElapsed] = useState(0);
  const [expandedAgent, setExpandedAgent] = useState(null);
  const [progress, setProgress] = useState({ phase: 'starting', phase_index: 0, agents_done: 0, agents_total: 0, messages: [] });

  const poll = useCallback(async () => {
    if (!id) return;
    try {
      const res = await apiFetch(`/api/simulation/${id}`);
      if (!res.ok) throw new Error('Simulation not found');
      const data = await res.json();
      if (data.progress) setProgress(data.progress);
      if (data.status === 'completed') { setStatus('completed'); setResult(data.result); }
      else if (data.status === 'failed') { setStatus('failed'); setError(data.error || 'Unknown error'); }
    } catch (err) { setError(err.message); setStatus('failed'); }
  }, [id]);

  useEffect(() => {
    if (status !== 'running' || !id) return;
    poll();
    const interval = setInterval(poll, 2000);
    return () => clearInterval(interval);
  }, [status, id, poll]);

  useEffect(() => {
    if (status !== 'running') return;
    const interval = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(interval);
  }, [status]);

  // ─── LOADING ───
  if (status === 'running') {
    const phaseIndex = progress.phase_index || 0;
    const done = progress.agents_done || 0;
    const total = progress.agents_total || 0;
    const agentPct = total > 0 ? Math.min(100, (done / total) * 100) : 0;

    return (
      <Layout>
        <div className="max-w-2xl mx-auto py-8">
          <div className="flex items-center gap-4 mb-8">
            <div className="relative shrink-0">
              <div className="w-16 h-16 rounded-full border-4 border-white/5 border-t-violet-500 animate-spin" />
              <div className="absolute inset-0 flex items-center justify-center"><span className="text-sm font-bold text-violet-400">{elapsed}s</span></div>
            </div>
            <div className="min-w-0">
              <h2 className="text-xl font-bold text-white">Running Realistic Simulation</h2>
              <p className="text-sm text-gray-400 truncate">{humanPhase(progress.phase)} · {total > 0 ? `${done}/${total} agents done` : 'setting up'}</p>
            </div>
          </div>

          {/* Pipeline progress */}
          <div className="space-y-1.5 text-sm mb-6 bg-surface-800 border border-white/5 rounded-xl p-4">
            <Stage done={phaseIndex > 1} active={phaseIndex === 1} label="Scraping / parsing content" />
            <Stage done={phaseIndex > 2} active={phaseIndex === 2} label="Classifying test type" />
            <Stage done={phaseIndex > 3} active={phaseIndex === 3} label="Decomposing audience" />
            <Stage done={phaseIndex > 6} active={phaseIndex >= 4 && phaseIndex <= 6} label="Retrieving pain library + generating personas" />
            <Stage done={phaseIndex > 7} active={phaseIndex === 7} label="Parsing scenario" />
            <Stage done={phaseIndex > 8} active={phaseIndex === 8} label={total > 0 ? `Running ${total} agents (Chain-of-Thought)` : 'Running agents'} />
            <Stage done={phaseIndex > 9} active={phaseIndex === 9} label="Computing metrics" />
            <Stage done={phaseIndex > 10} active={phaseIndex === 10} label="Synthesizing insights" />
            <Stage done={phaseIndex >= 11 && progress.phase === 'done'} active={phaseIndex === 11} label="Generating + validating recommendations" />
          </div>

          {/* Agent progress bar */}
          {phaseIndex === 8 && total > 0 && (
            <div className="bg-surface-800 border border-white/5 rounded-xl p-4 mb-6">
              <div className="flex justify-between text-xs mb-2">
                <span className="text-gray-400">Agents completed</span>
                <span className="text-white font-semibold">{done} / {total}</span>
              </div>
              <div className="h-2 bg-white/5 rounded-full overflow-hidden">
                <div className="h-full bg-gradient-to-r from-violet-500 to-indigo-500 transition-all duration-500" style={{ width: `${agentPct}%` }} />
              </div>
            </div>
          )}

          {/* Live activity stream */}
          {progress.messages && progress.messages.length > 0 && (
            <div className="bg-surface-800 border border-white/5 rounded-xl p-4 max-h-64 overflow-y-auto font-mono text-xs space-y-1">
              <div className="text-gray-500 uppercase tracking-wider text-[10px] mb-2 sticky top-0 bg-surface-800">Activity stream</div>
              {progress.messages.slice(-20).reverse().map((m, i) => (
                <div key={i} className="text-gray-400 flex gap-3">
                  <span className="text-gray-600 shrink-0">{new Date(m.t).toLocaleTimeString().slice(0, 8)}</span>
                  <span className="truncate">{m.text}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </Layout>
    );
  }

  // ─── ERROR ───
  if (status === 'failed') {
    return (
      <Layout>
        <div className="flex flex-col items-center justify-center min-h-[60vh] text-center">
          <div className="w-16 h-16 rounded-full bg-red-900/30 flex items-center justify-center mb-4"><span className="text-2xl">!</span></div>
          <h2 className="text-2xl font-bold text-white mb-2">Simulation Failed</h2>
          <p className="text-red-400 mb-6 max-w-md">{error}</p>
          <button onClick={() => router.push('/')} className="bg-white/10 hover:bg-white/20 text-white px-6 py-2.5 rounded-lg transition-colors">Try Again</button>
        </div>
      </Layout>
    );
  }

  if (!result) return null;

  const {
    mode, task_type, task_classification, audience_vector,
    personas = [], agent_results = [], metrics = {}, insights = {},
    recommendations = [], outcomes = {}, headline, scenario_summary,
    elapsed_ms,
  } = result;

  return (
    <Layout>
      <Head><title>Results — Synthetic Users</title></Head>
      <div className="space-y-8">

        {/* ─── HEADER STRIP ─── */}
        <section className="flex flex-wrap items-center justify-between gap-3 text-xs">
          <div className="flex flex-wrap gap-2">
            <Chip label={mode || '—'} tone="violet" />
            <Chip label={`Task: ${task_type || 'unknown'}`} tone="slate" />
            <Chip label={`Audience: ${audience_vector?.vertical || '?'} · ${audience_vector?.role_level || '?'}`} tone="slate" />
            {elapsed_ms && <Chip label={`${Math.round(elapsed_ms / 1000)}s`} tone="slate" />}
            {metrics.confidence_score != null && <Chip label={`Confidence ${Math.round(metrics.confidence_score * 100)}%`} tone="emerald" />}
          </div>
          <button onClick={() => router.push('/')} className="text-gray-400 hover:text-white">← New simulation</button>
        </section>

        {/* ─── HEADLINE ─── */}
        <section className="animate-fade-in-up">
          <div className="bg-gradient-to-br from-violet-900/30 via-surface-800 to-surface-800 border border-violet-500/20 rounded-2xl p-6">
            <div className="text-xs font-semibold text-violet-400 uppercase tracking-widest mb-2">Key Finding</div>
            <h2 className="text-xl md:text-2xl font-bold text-white leading-snug">{headline || insights.headline || 'Simulation complete.'}</h2>
          </div>
        </section>

        {/* ─── OUTCOMES + METRICS ─── */}
        <section className="grid md:grid-cols-4 gap-4">
          <Stat label="Converted" value={outcomes.converted} total={outcomes.total} color="emerald" />
          <Stat label="Interested" value={outcomes.interested} total={outcomes.total} color="amber" />
          <Stat label="Bounced" value={outcomes.bounced} total={outcomes.total} color="red" />
          <Stat label="Intent score" value={metrics.intent_score != null ? metrics.intent_score.toFixed(2) : '—'} total="/ 1.0" color="violet" raw />
        </section>

        {/* ─── QUANTITATIVE METRICS ─── */}
        <section>
          <SectionTitle>Quantitative Metrics</SectionTitle>
          <div className="grid md:grid-cols-2 gap-4">
            <Card title="Attention decay">
              {(metrics.attention_decay || []).length === 0 ? (
                <p className="text-xs text-gray-500">No sections analyzed.</p>
              ) : (
                <div className="space-y-2">
                  {(metrics.attention_decay || []).map((a, i) => (
                    <div key={i}>
                      <div className="flex justify-between text-xs mb-1">
                        <span className="text-gray-300 capitalize">{String(a?.section || '').replace(/_/g, ' ') || 'section'}</span>
                        <span className="text-gray-500">{Math.round((a?.retention || 0) * 100)}%</span>
                      </div>
                      <div className="h-1.5 bg-white/5 rounded-full overflow-hidden">
                        <div className="h-full bg-violet-500 transition-all duration-500" style={{ width: `${(a?.retention || 0) * 100}%` }} />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Card>

            <Card title="Trust score">
              <div className="flex items-end gap-4 mb-3">
                <div className="text-4xl font-bold text-white">{metrics.trust_score != null ? metrics.trust_score.toFixed(2) : '—'}</div>
                <div className="text-xs text-gray-500 pb-2">/ 1.00</div>
              </div>
              <div className="text-xs text-gray-500 mb-2">Top missing signals:</div>
              <ul className="space-y-1">
                {(metrics.top_missing_signals || []).slice(0, 4).map((s, i) => (
                  <li key={i} className="text-xs text-red-300">− {s.signal} <span className="text-gray-600">({s.count})</span></li>
                ))}
                {(!metrics.top_missing_signals || metrics.top_missing_signals.length === 0) && <li className="text-xs text-gray-600">None identified</li>}
              </ul>
            </Card>

            <Card title="Friction density (higher = more friction)">
              {Object.entries(metrics.friction_density || {}).length === 0 ? (
                <p className="text-xs text-gray-500">No friction detected.</p>
              ) : (
                <div className="space-y-1.5">
                  {Object.entries(metrics.friction_density || {})
                    .sort((a, b) => (b[1] || 0) - (a[1] || 0))
                    .map(([section, val], i) => (
                      <div key={i} className="flex justify-between text-xs">
                        <span className="text-gray-300 capitalize">{String(section || '').replace(/_/g, ' ')}</span>
                        <span className={val > 1 ? 'text-red-400' : val > 0.5 ? 'text-amber-400' : 'text-gray-400'}>{Number(val || 0).toFixed(2)}</span>
                      </div>
                    ))}
                </div>
              )}
            </Card>

            <Card title="Decision latency + objection coverage">
              <div className="grid grid-cols-2 gap-3 mb-3">
                <div>
                  <div className="text-xs text-gray-500">Median</div>
                  <div className="text-lg font-semibold text-white">{metrics.decision_latency?.p50_seconds || 0}s</div>
                </div>
                <div>
                  <div className="text-xs text-gray-500">P90</div>
                  <div className="text-lg font-semibold text-white">{metrics.decision_latency?.p90_seconds || 0}s</div>
                </div>
              </div>
              <div>
                <div className="text-xs text-gray-500 mb-1">Objection coverage</div>
                <div className="flex items-center gap-2">
                  <div className="flex-1 h-1.5 bg-white/5 rounded-full overflow-hidden">
                    <div className="h-full bg-emerald-500" style={{ width: `${(metrics.objection_coverage || 0) * 100}%` }} />
                  </div>
                  <span className="text-xs text-gray-400">{Math.round((metrics.objection_coverage || 0) * 100)}%</span>
                </div>
              </div>
            </Card>
          </div>
        </section>

        {/* ─── RECOMMENDATIONS ─── */}
        <section>
          <SectionTitle>Recommended Actions</SectionTitle>
          <div className="space-y-4">
            {recommendations.length === 0 ? (
              <p className="text-gray-500 text-sm">No specific recommendations generated.</p>
            ) : (
              recommendations.map((rec, i) => <RecCard key={i} rec={rec} index={i} />)
            )}
          </div>
        </section>

        {/* ─── PERSONAS ─── */}
        <section>
          <SectionTitle>Archetypes Simulated</SectionTitle>
          <div className="grid md:grid-cols-3 gap-4">
            {personas.map((p, i) => (
              <PersonaCard key={i} persona={p} agent={agent_results.find(a => a._persona_name === p.name)} />
            ))}
          </div>
        </section>

        {/* ─── AGENT REASONING (full prose) ─── */}
        <section>
          <SectionTitle>Agent Reasoning Traces</SectionTitle>
          <div className="space-y-3">
            {agent_results.map((a, i) => (
              <div key={i} className="bg-surface-800 border border-white/5 rounded-xl overflow-hidden">
                <button
                  onClick={() => setExpandedAgent(expandedAgent === i ? null : i)}
                  className="w-full flex items-center justify-between px-5 py-3 hover:bg-white/5 transition-colors text-left"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <OutcomeDot outcome={a.outcome} />
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-white truncate">{a._persona_name}</div>
                      <div className="text-xs text-gray-500 truncate">{a._persona_archetype_label}</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <span className="hidden md:inline text-xs text-gray-500">{a.decision_latency_seconds}s</span>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${outcomeToneClasses(a.outcome)}`}>{a.outcome}</span>
                    <span className="text-gray-600">{expandedAgent === i ? '−' : '+'}</span>
                  </div>
                </button>
                {expandedAgent === i && (
                  <div className="px-5 pb-5 pt-3 border-t border-white/5 space-y-4">
                    <div>
                      <div className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-2">Stream of consciousness</div>
                      <p className="text-sm text-gray-300 leading-relaxed whitespace-pre-wrap">{a.reasoning || '(no narration)'}</p>
                    </div>
                    <div className="grid md:grid-cols-2 gap-4">
                      <Mini label="Attention path" items={a.attention_path} tone="violet" />
                      <Mini label="Ignored" items={a.sections_ignored} tone="slate" />
                      <Mini label="Friction points" items={(a.friction_points || []).map(f => `${f.where}: ${f.what}`)} tone="red" />
                      <Mini label="Trust signals missing" items={a.trust_signals_missing} tone="amber" />
                      <Mini label="Objections triggered" items={a.objections_triggered} tone="red" />
                      <Mini label="Hot buttons hit" items={a.hot_buttons_hit} tone="emerald" />
                    </div>
                    <div className="text-xs text-gray-500">
                      <span className="text-gray-400">Decision:</span> {a.outcome_reason || '—'} · <span className="text-gray-400">Emotional arc:</span> {a.emotional_arc || '—'}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>

        {/* ─── PATTERNS ─── */}
        {insights.patterns && insights.patterns.length > 0 && (
          <section>
            <SectionTitle>Behavioral Patterns</SectionTitle>
            <div className="space-y-3">
              {insights.patterns.map((p, i) => (
                <div key={i} className="bg-surface-800 border border-white/5 rounded-xl p-5">
                  <div className="flex items-start justify-between gap-3 mb-2">
                    <p className="text-white font-medium text-sm flex-1">{p.pattern}</p>
                    <SeverityBadge severity={p.severity} />
                  </div>
                  <p className="text-xs text-gray-500 mb-2">{p.evidence}</p>
                  <p className="text-xs text-gray-600"><span className="text-gray-500">Why:</span> {p.root_cause}</p>
                  {p.affected_archetypes && p.affected_archetypes.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mt-2">
                      {p.affected_archetypes.map((a, j) => (
                        <span key={j} className="text-[10px] bg-white/5 text-gray-400 px-2 py-0.5 rounded-full">{a}</span>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </section>
        )}

        {/* ─── CALIBRATION ─── */}
        <section>
          <SectionTitle>Calibration — Feed back actual results</SectionTitle>
          <CalibrationForm simulationId={id} predicted={outcomes.conversion_rate} />
        </section>
      </div>
    </Layout>
  );
}

// ──────────────────────────────────────────────────────────────
// Components
// ──────────────────────────────────────────────────────────────

function Layout({ children }) {
  return (
    <div className="min-h-screen bg-[#08080e] text-gray-200">
      <header className="border-b border-white/5 px-6 py-4">
        <div className="max-w-5xl mx-auto flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center text-white font-bold text-xs">SU</div>
          <span className="text-white font-semibold text-lg tracking-tight">Synthetic Users</span>
        </div>
      </header>
      <main className="max-w-5xl mx-auto px-6 py-8">{children}</main>
    </div>
  );
}

function SectionTitle({ children }) {
  return <h3 className="text-xs font-semibold text-violet-400 uppercase tracking-widest mb-4">{children}</h3>;
}

function Card({ title, children }) {
  return (
    <div className="bg-surface-800 border border-white/5 rounded-xl p-5">
      <div className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">{title}</div>
      {children}
    </div>
  );
}

function Stat({ label, value, total, color, raw }) {
  const colorMap = { emerald: 'text-emerald-400', red: 'text-red-400', amber: 'text-amber-400', violet: 'text-violet-400' };
  return (
    <div className="bg-surface-800 border border-white/5 rounded-xl p-4 text-center">
      <div className={`text-3xl font-bold ${colorMap[color]}`}>{value}{!raw && total ? <span className="text-gray-600 text-lg"> / {total}</span> : null}</div>
      <div className="text-xs text-gray-500 mt-1">{label}{raw && total ? <span className="text-gray-600 ml-1">{total}</span> : null}</div>
    </div>
  );
}

function Chip({ label, tone }) {
  const map = {
    violet: 'bg-violet-500/10 text-violet-300 border-violet-500/20',
    slate: 'bg-white/5 text-gray-400 border-white/10',
    emerald: 'bg-emerald-500/10 text-emerald-300 border-emerald-500/20',
  };
  return <span className={`px-2 py-1 rounded-full border ${map[tone] || map.slate}`}>{label}</span>;
}

function OutcomeDot({ outcome }) {
  const c = outcome === 'converted' ? 'bg-emerald-400' : outcome === 'interested' ? 'bg-amber-400' : 'bg-red-400';
  return <span className={`w-2 h-2 rounded-full ${c}`} />;
}

function outcomeToneClasses(outcome) {
  if (outcome === 'converted') return 'bg-emerald-900/40 text-emerald-400';
  if (outcome === 'interested') return 'bg-amber-900/40 text-amber-400';
  return 'bg-red-900/40 text-red-400';
}

function SeverityBadge({ severity }) {
  const map = { high: 'bg-red-900/40 text-red-400', medium: 'bg-amber-900/40 text-amber-400', low: 'bg-white/10 text-gray-400' };
  return <span className={`text-[10px] px-2 py-0.5 rounded-full shrink-0 ${map[severity] || map.low}`}>{severity}</span>;
}

function humanPhase(p) {
  const map = {
    starting: 'Starting up',
    scraping: 'Scraping URL',
    classifying: 'Classifying test type',
    decomposing_audience: 'Parsing audience',
    generating_personas: 'Generating personas',
    parsing_scenario: 'Parsing scenario',
    running_agents: 'Running agents',
    computing_metrics: 'Computing metrics',
    synthesizing_insights: 'Synthesizing insights',
    generating_recommendations: 'Generating recommendations',
    done: 'Finalizing',
  };
  return map[p] || p || '…';
}

function Stage({ done, active, label }) {
  return (
    <div className="flex items-center gap-2 text-sm">
      {done ? <span className="text-emerald-400 w-4 text-center">✓</span> : active ? <span className="w-4 text-center"><span className="inline-block w-2 h-2 rounded-full bg-violet-500 animate-pulse" /></span> : <span className="w-4 text-center text-gray-700">·</span>}
      <span className={done ? 'text-gray-500' : active ? 'text-white' : 'text-gray-600'}>{label}</span>
    </div>
  );
}

function Mini({ label, items, tone }) {
  if (!items || items.length === 0) return null;
  const toneMap = { red: 'text-red-300', amber: 'text-amber-300', emerald: 'text-emerald-300', violet: 'text-violet-300', slate: 'text-gray-400' };
  return (
    <div>
      <div className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-1.5">{label}</div>
      <ul className="space-y-0.5">
        {items.slice(0, 5).map((item, i) => (<li key={i} className={`text-xs ${toneMap[tone] || 'text-gray-300'}`}>• {typeof item === 'string' ? item : JSON.stringify(item)}</li>))}
      </ul>
    </div>
  );
}

function PersonaCard({ persona, agent }) {
  return (
    <div className="bg-surface-800 border border-white/5 rounded-xl p-5">
      <div className="flex items-start justify-between mb-2">
        <div>
          <div className="text-xs font-semibold text-violet-400 uppercase tracking-wider mb-1">{persona.archetype_label}</div>
          <div className="text-white font-semibold">{persona.name}</div>
          <div className="text-xs text-gray-500">{persona.age} · {persona.role}</div>
        </div>
        {agent && <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${outcomeToneClasses(agent.outcome)}`}>{agent.outcome}</span>}
      </div>
      <div className="text-xs text-gray-400 mt-3 mb-3">{persona.company_description}</div>
      {persona.pain_quotes_in_voice && persona.pain_quotes_in_voice[0] && (
        <blockquote className="text-xs text-gray-300 italic border-l-2 border-violet-500/50 pl-3 py-0.5 mb-3">"{persona.pain_quotes_in_voice[0]}"</blockquote>
      )}
      <div className="grid grid-cols-2 gap-x-2 gap-y-1 text-[10px] text-gray-500 mt-2">
        <div>Budget: <span className="text-gray-300">${persona.budget_monthly_usd}/mo</span></div>
        <div>Style: <span className="text-gray-300">{persona.decision_style}</span></div>
        <div>Trust: <span className="text-gray-300">{persona.traits?.trust_baseline}</span></div>
        <div>Patience: <span className="text-gray-300">{persona.traits?.patience}</span></div>
      </div>
    </div>
  );
}

function RecCard({ rec, index }) {
  const conf = { high: 'bg-emerald-500/20 text-emerald-300', medium: 'bg-amber-500/20 text-amber-300', low: 'bg-white/10 text-gray-400' };
  const effortLabel = { quick_fix: 'Quick fix (<1h)', medium: 'Medium (1-4h)', major_change: 'Major change (days)' };
  return (
    <div className="bg-surface-800 border border-white/5 rounded-xl p-5">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold text-violet-400 bg-violet-500/10 w-6 h-6 rounded-full flex items-center justify-center shrink-0">{rec.priority || index + 1}</span>
          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${conf[rec.confidence] || conf.low}`}>{rec.confidence} confidence</span>
        </div>
        <span className="text-xs text-gray-500 shrink-0">{effortLabel[rec.effort] || rec.effort}</span>
      </div>
      <h4 className="text-base font-semibold text-white mb-2 leading-snug">{rec.action}</h4>
      {rec.evidence && <p className="text-xs text-gray-500 mb-3"><span className="text-gray-400">Evidence:</span> {rec.evidence}</p>}
      <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs">
        {rec.expected_impact && <span className="text-emerald-400">Impact: {rec.expected_impact}</span>}
        {rec.tradeoff && <span className="text-amber-400">Trade-off: {rec.tradeoff}</span>}
      </div>
      {rec.alternative && <p className="text-xs text-gray-500 mt-2"><span className="text-gray-400">Alternative:</span> {rec.alternative}</p>}
    </div>
  );
}

function CalibrationForm({ simulationId, predicted }) {
  const [actual, setActual] = useState('');
  const [notes, setNotes] = useState('');
  const [change, setChange] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState(null);

  const submit = async (e) => {
    e.preventDefault();
    setError(null);
    try {
      const res = await apiFetch(`/api/calibration/${simulationId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          metric_key: 'conversion_rate',
          predicted_value: predicted,
          actual_value: parseFloat(actual) || null,
          change_implemented: change || null,
          notes: notes || null,
        }),
      });
      if (!res.ok) throw new Error('Failed to submit');
      setSubmitted(true);
    } catch (err) { setError(err.message); }
  };

  if (submitted) {
    return <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-xl p-5 text-emerald-300 text-sm">Thanks — calibration recorded. Your feedback improves future predictions.</div>;
  }

  return (
    <form onSubmit={submit} className="bg-surface-800 border border-white/5 rounded-xl p-5 space-y-4">
      <p className="text-sm text-gray-400">After you implement changes and get real data, come back and tell us what actually happened. This calibrates future predictions.</p>
      <div className="grid md:grid-cols-2 gap-4">
        <div>
          <label className="block text-xs text-gray-400 mb-1">Predicted conversion rate</label>
          <div className="bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-gray-300">{predicted != null ? `${predicted}%` : '—'}</div>
        </div>
        <div>
          <label className="block text-xs text-gray-400 mb-1">Actual conversion rate (%)</label>
          <input type="number" step="0.1" value={actual} onChange={e => setActual(e.target.value)} placeholder="e.g. 4.2" className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-violet-500/50" />
        </div>
      </div>
      <div>
        <label className="block text-xs text-gray-400 mb-1">What did you change?</label>
        <input type="text" value={change} onChange={e => setChange(e.target.value)} placeholder="e.g. Added 3 customer logos above the fold" className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-violet-500/50" />
      </div>
      <div>
        <label className="block text-xs text-gray-400 mb-1">Notes (optional)</label>
        <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-violet-500/50" />
      </div>
      {error && <div className="text-red-400 text-sm">{error}</div>}
      <button type="submit" className="bg-violet-600 hover:bg-violet-500 text-white text-sm font-semibold px-5 py-2.5 rounded-lg transition-colors">Submit calibration</button>
    </form>
  );
}
