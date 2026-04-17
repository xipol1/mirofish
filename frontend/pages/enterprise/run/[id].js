import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';

const API_URL = process.env.NEXT_PUBLIC_API_URL || (typeof window !== 'undefined' && window.location.hostname !== 'localhost' ? '' : 'http://localhost:5001');

function apiFetch(path, options = {}) {
  const headers = { ...options.headers, 'bypass-tunnel-reminder': 'true' };
  return fetch(`${API_URL}${path}`, { ...options, headers });
}

const PHASE_LABELS = {
  starting: 'Starting up',
  classifying: 'Classifying test type',
  decomposing_audience: 'Parsing audience',
  generating_personas: 'Generating personas',
  launching_browser: 'Launching Chromium cluster',
  running_agents: 'Running agents on Playwright',
  computing_metrics: 'Computing journey metrics',
  synthesizing_insights: 'Synthesizing insights',
  generating_recommendations: 'Generating recommendations',
  done: 'Complete',
};

export default function EnterpriseRun() {
  const router = useRouter();
  const { id } = router.query;
  const [status, setStatus] = useState('running');
  const [result, setResult] = useState(null);
  const [progress, setProgress] = useState({ phase: 'starting', phase_index: 0, agents_done: 0, agents_total: 0, events: [] });
  const [error, setError] = useState(null);
  const [elapsed, setElapsed] = useState(0);
  const [selectedAgent, setSelectedAgent] = useState(null);

  const poll = useCallback(async () => {
    if (!id) return;
    try {
      const res = await apiFetch(`/api/enterprise/simulation/${id}`);
      if (!res.ok) throw new Error('Simulation not found');
      const data = await res.json();
      if (data.progress) setProgress(data.progress);
      if (data.status === 'completed') { setStatus('completed'); setResult(data.result); }
      else if (data.status === 'failed') { setStatus('failed'); setError(data.error); }
    } catch (err) { setError(err.message); setStatus('failed'); }
  }, [id]);

  useEffect(() => {
    if (!id) return;
    if (status === 'completed' || status === 'failed') return;
    poll();
    const iv = setInterval(poll, 2000);
    return () => clearInterval(iv);
  }, [id, status, poll]);

  useEffect(() => {
    if (status !== 'running') return;
    const iv = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(iv);
  }, [status]);

  return (
    <>
      <Head><title>Enterprise Run — Synthetic Users</title></Head>
      <div className="min-h-screen bg-[#08080e] text-gray-100">
        <nav className="border-b border-white/5 px-6 py-4">
          <div className="max-w-6xl mx-auto flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center text-white font-bold text-xs">SU</div>
              <span className="font-semibold text-white text-lg">Synthetic Users</span>
              <span className="text-xs px-2 py-0.5 rounded-full bg-violet-500/10 text-violet-300 border border-violet-500/20">ENTERPRISE</span>
            </div>
            <a href="/enterprise" className="text-sm text-gray-400 hover:text-white">← New simulation</a>
          </div>
        </nav>

        <main className="max-w-6xl mx-auto px-6 py-8">
          {status === 'running' && <RunningView progress={progress} elapsed={elapsed} />}
          {status === 'failed' && <FailedView error={error} onRetry={() => router.push('/enterprise')} />}
          {status === 'completed' && result && (
            <CompletedView result={result} simulationId={id} selectedAgent={selectedAgent} setSelectedAgent={setSelectedAgent} />
          )}
        </main>
      </div>
    </>
  );
}

function RunningView({ progress, elapsed }) {
  const pct = progress.agents_total > 0 ? (progress.agents_done / progress.agents_total) * 100 : 0;
  const phases = ['starting', 'classifying', 'decomposing_audience', 'generating_personas', 'launching_browser', 'running_agents', 'computing_metrics', 'synthesizing_insights', 'generating_recommendations', 'done'];
  const phaseIdx = phases.indexOf(progress.phase || 'starting');

  return (
    <div className="grid lg:grid-cols-3 gap-6">
      <div className="lg:col-span-2 space-y-6">
        <div className="bg-surface-800 border border-white/10 rounded-2xl p-6">
          <div className="flex items-center gap-4 mb-6">
            <div className="relative w-16 h-16 shrink-0">
              <div className="w-full h-full rounded-full border-4 border-white/5 border-t-violet-500 animate-spin" />
              <div className="absolute inset-0 flex items-center justify-center"><span className="text-sm font-bold text-violet-400">{elapsed}s</span></div>
            </div>
            <div className="flex-1 min-w-0">
              <h2 className="text-xl font-bold text-white">Playwright Agents Running</h2>
              <p className="text-sm text-gray-400">{PHASE_LABELS[progress.phase] || progress.phase}</p>
            </div>
          </div>

          {/* Pipeline */}
          <div className="space-y-1.5 text-sm mb-6">
            {phases.slice(0, 9).map((p, i) => {
              const done = i < phaseIdx;
              const active = i === phaseIdx;
              return (
                <div key={p} className="flex items-center gap-3">
                  {done ? <span className="text-emerald-400 w-4 text-center">✓</span>
                    : active ? <span className="w-4 text-center"><span className="inline-block w-2 h-2 rounded-full bg-violet-500 animate-pulse" /></span>
                    : <span className="w-4 text-center text-gray-700">·</span>}
                  <span className={done ? 'text-gray-500' : active ? 'text-white font-semibold' : 'text-gray-600'}>{PHASE_LABELS[p]}</span>
                </div>
              );
            })}
          </div>

          {/* Agent progress bar */}
          {progress.agents_total > 0 && (
            <div>
              <div className="flex justify-between text-xs mb-2">
                <span className="text-gray-400">Agents completed</span>
                <span className="text-white font-semibold">{progress.agents_done} / {progress.agents_total}</span>
              </div>
              <div className="h-2 bg-white/5 rounded-full overflow-hidden">
                <div className="h-full bg-gradient-to-r from-violet-500 to-indigo-500 transition-all duration-500" style={{ width: `${pct}%` }} />
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Activity stream */}
      <div className="bg-surface-800 border border-white/10 rounded-2xl p-5 max-h-[640px] overflow-y-auto">
        <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-widest mb-3">Live activity</h3>
        {(progress.events || []).length === 0 ? (
          <p className="text-xs text-gray-600">No events yet...</p>
        ) : (
          <div className="space-y-2 text-xs font-mono">
            {[...(progress.events || [])].reverse().slice(0, 40).map((ev, i) => (
              <div key={i} className="border-l-2 border-white/5 pl-3 py-0.5">
                <div className="text-gray-500">{new Date(ev.t).toLocaleTimeString().slice(0, 8)} · <span className="text-violet-400">{ev.type}</span></div>
                <div className="text-gray-300 break-words">
                  {ev.payload?.persona_name && <span className="text-white font-semibold">{ev.payload.persona_name}</span>}
                  {ev.payload?.outcome && <span className={`ml-2 px-1.5 py-0.5 rounded text-[10px] ${outcomeColor(ev.payload.outcome)}`}>{ev.payload.outcome}</span>}
                  {ev.payload?.reasoning && <div className="text-gray-400 mt-0.5 italic">{ev.payload.reasoning.substring(0, 160)}</div>}
                  {ev.payload?.message && <span className="text-gray-400"> {ev.payload.message}</span>}
                  {ev.payload?.step_index != null && <span className="text-gray-500"> step {ev.payload.step_index}</span>}
                  {ev.payload?.url && <div className="text-gray-600 truncate text-[10px] mt-0.5">{ev.payload.url}</div>}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function FailedView({ error, onRetry }) {
  return (
    <div className="max-w-xl mx-auto text-center py-20">
      <div className="w-16 h-16 rounded-full bg-red-500/10 border border-red-500/20 flex items-center justify-center text-red-400 text-2xl mx-auto mb-4">!</div>
      <h2 className="text-2xl font-bold text-white mb-2">Simulation Failed</h2>
      <p className="text-red-400 mb-6">{error}</p>
      <button onClick={onRetry} className="bg-white/10 hover:bg-white/20 text-white px-6 py-2.5 rounded-lg">Try again</button>
    </div>
  );
}

function CompletedView({ result, simulationId, selectedAgent, setSelectedAgent }) {
  const m = result.metrics || {};
  const agents = result.agent_results || [];
  const personas = result.personas || [];

  return (
    <div className="space-y-8">
      {/* Headline */}
      <section>
        <div className="flex items-center justify-between mb-4">
          <div>
            <div className="text-xs font-semibold text-violet-400 uppercase tracking-widest mb-1">Launch Validation Complete</div>
            <h1 className="text-2xl font-bold text-white">{result.headline || 'Simulation complete.'}</h1>
          </div>
          <a href={`${API_URL}/api/enterprise/simulation/${simulationId}/report.pdf`} target="_blank" rel="noreferrer"
             className="bg-violet-600 hover:bg-violet-500 text-white font-semibold px-5 py-2.5 rounded-xl transition-colors text-sm shrink-0">
            Download PDF report ↓
          </a>
        </div>
      </section>

      {/* Top-line metrics */}
      <section className="grid md:grid-cols-5 gap-4">
        <Metric label="Total agents" value={m.total_agents ?? 0} />
        <Metric label="Converted" value={m.converted ?? 0} color="emerald" />
        <Metric label="Conversion rate" value={`${m.conversion_rate ?? 0}%`} sublabel={`±${m.ci_95_margin_pct ?? '?'}%`} color="violet" />
        <Metric label="Trust score" value={(m.trust_score ?? 0).toFixed ? m.trust_score.toFixed(2) : m.trust_score} sublabel="/ 1.0" />
        <Metric label="Confidence" value={`${Math.round((m.confidence_score ?? 0) * 100)}%`} />
      </section>

      {m.sample_size_warning && (
        <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-3 text-amber-300 text-sm">⚠ {m.sample_size_warning}</div>
      )}

      {/* Funnel */}
      {m.funnel && m.funnel.length > 0 && (
        <section className="bg-surface-800 border border-white/10 rounded-2xl p-6">
          <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4">Journey funnel</h3>
          <div className="space-y-2">
            {m.funnel.slice(0, 12).map((f, i) => (
              <div key={i}>
                <div className="flex justify-between text-xs mb-1">
                  <span className="text-gray-300 truncate">{truncate(f.url, 60)}</span>
                  <span className="text-gray-500">{f.visitors} agents · {Math.round(f.retention * 100)}%</span>
                </div>
                <div className="h-2 bg-white/5 rounded-full overflow-hidden">
                  <div className="h-full bg-gradient-to-r from-violet-500 to-indigo-500" style={{ width: `${f.retention * 100}%` }} />
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Recommendations */}
      {result.recommendations && result.recommendations.length > 0 && (
        <section>
          <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-3">Recommended actions</h3>
          <div className="space-y-3">
            {result.recommendations.map((rec, i) => (
              <div key={i} className="bg-surface-800 border border-white/10 rounded-xl p-5">
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-xs font-bold text-violet-400 bg-violet-500/10 w-6 h-6 rounded-full flex items-center justify-center">{rec.priority || i + 1}</span>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${confidenceColor(rec.confidence)}`}>{rec.confidence} confidence</span>
                  <span className="text-xs text-gray-500">{rec.effort?.replace('_', ' ') || 'medium'}</span>
                </div>
                <p className="text-white font-semibold mb-2">{rec.action}</p>
                {rec.evidence && <p className="text-sm text-gray-500 mb-2"><span className="text-gray-400">Evidence:</span> {rec.evidence}</p>}
                <div className="flex gap-5 text-xs">
                  {rec.expected_impact && <span className="text-emerald-400">Impact: {rec.expected_impact}</span>}
                  {rec.tradeoff && <span className="text-amber-400">Trade-off: {rec.tradeoff}</span>}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Agents grid */}
      <section>
        <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-3">Agent journeys ({agents.length})</h3>
        <div className="grid md:grid-cols-2 gap-3">
          {agents.map((a, i) => (
            <button
              key={i}
              onClick={() => setSelectedAgent(a)}
              className="text-left bg-surface-800 hover:bg-white/5 border border-white/10 hover:border-violet-500/30 rounded-xl p-4 transition-all"
            >
              <div className="flex items-start justify-between mb-2">
                <div>
                  <div className="text-sm font-semibold text-white">{a._persona_name}</div>
                  <div className="text-xs text-gray-500">{a._persona_archetype_label}</div>
                </div>
                <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${outcomeColor(a.outcome)}`}>{a.outcome}</span>
              </div>
              <p className="text-xs text-gray-400 line-clamp-2">{a.outcome_reason || '—'}</p>
              <div className="flex gap-3 mt-2 text-[10px] text-gray-500">
                <span>{a.total_steps || (a.steps?.length ?? 0)} steps</span>
                <span>{Math.round((a.total_duration_ms || 0) / 1000)}s</span>
                {a.emotional_arc && <span>· {a.emotional_arc}</span>}
              </div>
            </button>
          ))}
        </div>
      </section>

      {/* Agent detail modal */}
      {selectedAgent && (
        <AgentDetailModal agent={selectedAgent} onClose={() => setSelectedAgent(null)} simulationId={simulationId} />
      )}
    </div>
  );
}

function AgentDetailModal({ agent, onClose, simulationId }) {
  const [evidence, setEvidence] = useState(null);
  useEffect(() => {
    if (!agent?.agent_run_id && !agent?.id) return;
    const runId = agent.agent_run_id || agent.id;
    apiFetch(`/api/enterprise/agent/${runId}/evidence`)
      .then(r => r.json())
      .then(d => setEvidence(d.evidence || []))
      .catch(() => setEvidence([]));
  }, [agent]);

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center p-6 z-50 overflow-y-auto" onClick={onClose}>
      <div className="bg-surface-800 border border-white/10 rounded-2xl max-w-4xl w-full max-h-[90vh] overflow-y-auto p-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between mb-4">
          <div>
            <div className="text-xs text-violet-400 uppercase tracking-widest mb-1">{agent._persona_archetype_label}</div>
            <h3 className="text-xl font-bold text-white">{agent._persona_name}</h3>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-white text-2xl">×</button>
        </div>

        <div className="mb-4 grid grid-cols-3 gap-3 text-xs">
          <div><span className="text-gray-500">Outcome:</span> <span className={`ml-1 px-2 py-0.5 rounded font-semibold ${outcomeColor(agent.outcome)}`}>{agent.outcome}</span></div>
          <div><span className="text-gray-500">Steps:</span> <span className="text-white">{agent.total_steps || (agent.steps?.length ?? 0)}</span></div>
          <div><span className="text-gray-500">Duration:</span> <span className="text-white">{Math.round((agent.total_duration_ms || 0) / 1000)}s</span></div>
        </div>

        {agent.outcome_reason && (
          <div className="bg-[#12121c] rounded-xl p-4 mb-4">
            <div className="text-xs font-semibold text-gray-500 uppercase mb-1">Final decision</div>
            <p className="text-sm text-gray-200">{agent.outcome_reason}</p>
          </div>
        )}

        {/* Journey steps */}
        <div className="space-y-3">
          <h4 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">Journey trace</h4>
          {(agent.steps || []).map((s, i) => (
            <div key={i} className="bg-[#12121c] border border-white/5 rounded-xl p-4">
              <div className="flex items-start gap-3">
                <span className="text-xs font-bold text-violet-400 bg-violet-500/10 w-7 h-7 rounded-full flex items-center justify-center shrink-0">{s.step_index}</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xs font-semibold text-white uppercase">{s.action}</span>
                    {s.result_ok === false && <span className="text-xs text-red-400">FAILED</span>}
                    {s.action_duration_ms && <span className="text-xs text-gray-600">{Math.round(s.action_duration_ms)}ms</span>}
                  </div>
                  {s.reasoning && <p className="text-sm text-gray-300 mb-1 italic">"{s.reasoning}"</p>}
                  {s.url_after && <p className="text-xs text-gray-500 truncate">{s.url_after}</p>}
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Evidence (screenshots) */}
        {evidence && evidence.length > 0 && (
          <div className="mt-6">
            <h4 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-3">Evidence ({evidence.length} screenshots)</h4>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
              {evidence.map((e, i) => (
                <a key={i} href={e.url} target="_blank" rel="noreferrer" className="block bg-[#12121c] rounded-lg overflow-hidden border border-white/5 hover:border-violet-500/40">
                  <img src={e.url} alt={`step ${e.step_index}`} className="w-full h-auto" />
                  <div className="p-2 text-[10px] text-gray-500">step {e.step_index}</div>
                </a>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── helpers ──
function Metric({ label, value, sublabel, color = 'white' }) {
  const colorMap = { white: 'text-white', emerald: 'text-emerald-400', violet: 'text-violet-400', red: 'text-red-400' };
  return (
    <div className="bg-surface-800 border border-white/10 rounded-xl p-4">
      <div className={`text-3xl font-bold ${colorMap[color]}`}>{value}{sublabel && <span className="text-sm text-gray-600 ml-1">{sublabel}</span>}</div>
      <div className="text-xs text-gray-500 mt-1">{label}</div>
    </div>
  );
}

function outcomeColor(o) {
  if (o === 'converted') return 'bg-emerald-500/20 text-emerald-300';
  if (o === 'interested') return 'bg-amber-500/20 text-amber-300';
  if (o === 'abandoned' || o === 'bounced') return 'bg-red-500/20 text-red-300';
  return 'bg-white/10 text-gray-400';
}

function confidenceColor(c) {
  if (c === 'high') return 'bg-emerald-500/20 text-emerald-300';
  if (c === 'medium') return 'bg-amber-500/20 text-amber-300';
  return 'bg-white/10 text-gray-400';
}

function truncate(s, n) { return !s ? '' : s.length <= n ? s : s.substring(0, n - 1) + '…'; }
