import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import AgentInterviewModal from '../../components/AgentInterviewModal';
import AttributionBarChart from '../../components/AttributionBarChart';
import CohortQueryPanel from '../../components/CohortQueryPanel';

const API_URL = process.env.NEXT_PUBLIC_API_URL || (typeof window !== 'undefined' && window.location.hostname !== 'localhost' ? '' : 'http://localhost:5001');

function apiFetch(path, options = {}) {
  return fetch(`${API_URL}${path}`, { ...options, headers: { ...options.headers, 'bypass-tunnel-reminder': 'true' } });
}

export default function StayViewer() {
  const router = useRouter();
  const { id } = router.query;
  const [status, setStatus] = useState('running');
  const [progress, setProgress] = useState({ events: [], agents_done: 0, agents_total: 0 });
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [selected, setSelected] = useState(null);

  const poll = useCallback(async () => {
    if (!id) return;
    try {
      const res = await apiFetch(`/api/stay-simulation/${id}`);
      if (!res.ok) throw new Error('not found');
      const d = await res.json();
      if (d.progress) setProgress(d.progress);
      if (d.status === 'completed') { setStatus('completed'); setResult(d.result || d); }
      else if (d.status === 'failed') { setStatus('failed'); setError(d.error); }
    } catch (err) { setError(err.message); }
  }, [id]);

  useEffect(() => {
    if (!id || status !== 'running') return;
    poll();
    const iv = setInterval(poll, 2000);
    return () => clearInterval(iv);
  }, [id, status, poll]);

  return (
    <>
      <Head><title>Stay simulation — Synthetic Users</title></Head>
      <div className="min-h-screen bg-[#08080e] text-gray-100">
        <nav className="border-b border-white/5 px-6 py-4">
          <div className="max-w-6xl mx-auto flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center text-white font-bold text-xs">SU</div>
              <span className="font-semibold text-white text-lg">Stay simulation</span>
              <span className="text-xs px-2 py-0.5 rounded-full bg-violet-500/10 text-violet-300">HOSPITALITY</span>
            </div>
            <a href="/properties" className="text-sm text-gray-400 hover:text-white">← Properties</a>
          </div>
        </nav>

        <main className="max-w-6xl mx-auto px-6 py-8 space-y-8">
          {status === 'running' && <RunningView progress={progress} />}
          {status === 'failed' && <div className="bg-red-900/20 border border-red-500/30 rounded-xl p-6 text-red-300">{error}</div>}
          {status === 'completed' && result && <CompletedView result={result} selected={selected} setSelected={setSelected} />}
        </main>
      </div>
    </>
  );
}

function RunningView({ progress }) {
  const pct = progress.agents_total > 0 ? (progress.agents_done / progress.agents_total) * 100 : 0;
  return (
    <div className="space-y-6">
      <div className="bg-surface-800 border border-white/10 rounded-2xl p-6">
        <h2 className="text-xl font-bold text-white mb-2">Running stay simulations…</h2>
        <p className="text-gray-400 text-sm mb-4">Each agent is living through the full stay: check-in, room, F&B, amenities, checkout.</p>
        <div className="flex justify-between text-xs mb-1">
          <span className="text-gray-400">Stays completed</span>
          <span className="text-white font-semibold">{progress.agents_done} / {progress.agents_total}</span>
        </div>
        <div className="h-2 bg-white/5 rounded-full overflow-hidden">
          <div className="h-full bg-gradient-to-r from-violet-500 to-indigo-500 transition-all duration-500" style={{ width: `${pct}%` }} />
        </div>
      </div>

      <div className="bg-surface-800 border border-white/10 rounded-2xl p-5 max-h-[540px] overflow-y-auto">
        <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-widest mb-3">Activity stream</h3>
        <div className="space-y-2 text-xs font-mono">
          {[...(progress.events || [])].reverse().slice(0, 60).map((ev, i) => (
            <div key={i} className="border-l-2 border-white/5 pl-3 py-0.5">
              <div className="text-gray-500">{new Date(ev.t).toLocaleTimeString().slice(0, 8)} · <span className="text-violet-400">{ev.type}</span></div>
              <div className="text-gray-300 break-words">
                {ev.payload?.persona_name && <span className="text-white font-semibold">{ev.payload.persona_name}</span>}
                {ev.payload?.archetype && <span className="text-violet-300"> · {ev.payload.archetype}</span>}
                {ev.payload?.stage && <span className="text-gray-400"> · stage {ev.payload.stage.stage || ev.payload.stage}</span>}
                {ev.payload?.stars != null && <span className="text-amber-300 ml-2">{ev.payload.stars}★</span>}
                {ev.payload?.nps != null && <span className="text-emerald-300 ml-2">NPS {ev.payload.nps}</span>}
                {ev.payload?.total_spend_eur != null && <span className="text-gray-400 ml-2">€{ev.payload.total_spend_eur}</span>}
                {ev.payload?.stage?.narrative && <div className="text-gray-400 italic mt-0.5">"{ev.payload.stage.narrative.substring(0, 180)}…"</div>}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function CompletedView({ result, selected, setSelected }) {
  const router = useRouter();
  const simulationId = router.query.id;
  const s = result.summary || {};
  const stays = (result.records || result.stays || []).filter(x => x && !x.error);
  const [interviewSlot, setInterviewSlot] = useState(null);

  const archetypeOptions = Array.from(new Set(stays.map(st => st.persona?.archetype_id || st.persona_full?.archetype_id || st.archetype_id).filter(Boolean)));

  const ciSuffix = (ci) => {
    if (!ci || ci.ci_low == null || ci.ci_high == null) return '';
    const pm = Math.max(Math.abs((ci.ci_high ?? 0) - (ci.value ?? 0)), Math.abs((ci.value ?? 0) - (ci.ci_low ?? 0)));
    return ` ± ${Math.round(pm * 10) / 10}`;
  };

  const downloadPlaybook = (fmt = 'md', lang = 'es') => {
    const url = `${API_URL}/api/simulation/${simulationId}/playbook?format=${fmt}&language=${lang}`;
    window.open(url, '_blank');
  };

  return (
    <div className="space-y-8">
      {/* Top metrics */}
      <section className="grid md:grid-cols-5 gap-4">
        <Metric label="Stays" value={s.total_stays} color="white" />
        <Metric label="Avg stars" value={s.avg_stars != null ? `${s.avg_stars}★${ciSuffix(s.avg_stars_ci)}` : '—'} color="amber" />
        <Metric label="NPS" value={s.net_promoter_score != null ? `${s.net_promoter_score}${ciSuffix(s.net_promoter_score_ci)}` : '—'} color={s.net_promoter_score > 30 ? 'emerald' : s.net_promoter_score < 0 ? 'red' : 'violet'} />
        <Metric label="Avg spend" value={s.avg_spend_eur ? `€${s.avg_spend_eur}${ciSuffix(s.avg_spend_eur_ci)}` : '—'} color="violet" />
        <Metric label="Would repeat" value={s.would_repeat_pct != null ? `${s.would_repeat_pct}%${ciSuffix(s.would_repeat_pct_ci)}` : '—'} color="emerald" />
      </section>

      {/* Enterprise actions */}
      <section className="flex flex-wrap gap-2">
        <button onClick={() => downloadPlaybook('md', 'es')} className="text-xs bg-violet-500/10 hover:bg-violet-500/20 border border-violet-500/30 text-violet-200 rounded px-3 py-1.5">Download Playbook (.md ES)</button>
        <button onClick={() => downloadPlaybook('html', 'es')} className="text-xs bg-violet-500/10 hover:bg-violet-500/20 border border-violet-500/30 text-violet-200 rounded px-3 py-1.5">Playbook (.html ES)</button>
        <button onClick={() => downloadPlaybook('html', 'en')} className="text-xs bg-violet-500/10 hover:bg-violet-500/20 border border-violet-500/30 text-violet-200 rounded px-3 py-1.5">Playbook (.html EN)</button>
        <button onClick={() => downloadPlaybook('docx', 'es')} className="text-xs bg-violet-500/10 hover:bg-violet-500/20 border border-violet-500/30 text-violet-200 rounded px-3 py-1.5">Playbook (.docx ES)</button>
      </section>

      <CohortQueryPanel simulationId={simulationId} archetypeOptions={archetypeOptions} />

      {/* Predicted top themes */}
      {s.top_predicted_themes?.length > 0 && (
        <section className="bg-surface-800 border border-white/10 rounded-2xl p-6">
          <h3 className="text-xs font-semibold text-violet-400 uppercase tracking-widest mb-3">Top predicted review themes</h3>
          <div className="flex flex-wrap gap-2">
            {s.top_predicted_themes.map((t, i) => (
              <span key={i} className="bg-white/5 text-gray-300 text-sm px-3 py-1 rounded-full border border-white/5">
                {t.theme} <span className="text-gray-600 ml-1">×{t.count}</span>
              </span>
            ))}
          </div>
        </section>
      )}

      {/* Spend by category */}
      {Object.keys(s.avg_spend_by_category || {}).length > 0 && (
        <section className="bg-surface-800 border border-white/10 rounded-2xl p-6">
          <h3 className="text-xs font-semibold text-violet-400 uppercase tracking-widest mb-3">Avg spend per stay, by category</h3>
          <div className="space-y-2">
            {Object.entries(s.avg_spend_by_category).sort((a, b) => b[1] - a[1]).map(([cat, val]) => (
              <div key={cat}>
                <div className="flex justify-between text-xs mb-1">
                  <span className="text-gray-300 capitalize">{cat.replace(/_/g, ' ')}</span>
                  <span className="text-white font-semibold">€{val.toFixed(2)}</span>
                </div>
                <div className="h-1.5 bg-white/5 rounded-full overflow-hidden">
                  <div className="h-full bg-gradient-to-r from-violet-500 to-indigo-500" style={{ width: `${Math.min(100, (val / Math.max(...Object.values(s.avg_spend_by_category))) * 100)}%` }} />
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Stays list */}
      <section>
        <h3 className="text-xs font-semibold text-violet-400 uppercase tracking-widest mb-4">Individual stays ({stays.length})</h3>
        <div className="grid md:grid-cols-2 gap-3">
          {stays.map((stay, i) => (
            <div key={i} className="bg-surface-800 border border-white/10 hover:border-violet-500/30 rounded-xl p-5 transition-all">
              <button onClick={() => setSelected({ ...stay, _slot: i })} className="w-full text-left">
                <div className="flex items-start justify-between mb-2">
                  <div>
                    <div className="text-xs text-violet-400 uppercase tracking-wider">{stay.persona?.archetype_label || stay.persona_full?.archetype_label}</div>
                    <h4 className="text-white font-semibold">{stay.persona?.name || stay.persona_full?.name}</h4>
                  </div>
                  <div className="text-right">
                    <div className="text-lg font-bold text-amber-300">{stay.sensation_summary?.stars || '—'}★</div>
                    <div className="text-xs text-gray-500">NPS {stay.sensation_summary?.nps ?? '—'}</div>
                  </div>
                </div>
                <div className="text-xs text-gray-400 grid grid-cols-3 gap-2 mt-2">
                  <span>{stay.stay_length_nights}n</span>
                  <span>€{stay.expense_summary?.total_spend_eur || 0}</span>
                  <span>{stay.predicted_review?.will_write_review ? `→ ${stay.predicted_review.platform}` : 'no review'}</span>
                </div>
              </button>
              <div className="mt-3 flex gap-2">
                <button onClick={() => setInterviewSlot(i)} className="text-[11px] bg-violet-500/10 hover:bg-violet-500/20 border border-violet-500/30 text-violet-200 rounded px-2 py-1">
                  Interview this guest
                </button>
              </div>
            </div>
          ))}
        </div>
      </section>

      {interviewSlot != null && (
        <AgentInterviewModal
          simulationId={simulationId}
          slot={interviewSlot}
          persona={stays[interviewSlot]?.persona_full || stays[interviewSlot]?.persona}
          onClose={() => setInterviewSlot(null)}
        />
      )}

      {selected && <StayDetail stay={selected} simulationId={simulationId} onClose={() => setSelected(null)} />}
    </div>
  );
}

function StayDetail({ stay, simulationId, onClose }) {
  const pr = stay.predicted_review;
  const [showAttr, setShowAttr] = useState(false);
  const persona = stay.persona || stay.persona_full || {};
  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center p-4 z-50 overflow-y-auto" onClick={onClose}>
      <div className="bg-surface-800 border border-white/10 rounded-2xl max-w-4xl w-full max-h-[90vh] overflow-y-auto p-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between mb-4">
          <div>
            <div className="text-xs text-violet-400 uppercase tracking-widest">{persona.archetype_label}</div>
            <h2 className="text-xl font-bold text-white">{persona.name}</h2>
            <div className="text-xs text-gray-500 mt-1">{persona.role} · {stay.stay_length_nights} nights · {stay.trip_purpose}</div>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-white text-2xl">×</button>
        </div>

        {stay._slot != null && simulationId && (
          <div className="mb-4">
            <button onClick={() => setShowAttr(v => !v)} className="text-xs bg-violet-500/10 hover:bg-violet-500/20 border border-violet-500/30 text-violet-200 rounded px-3 py-1.5">
              {showAttr ? 'Hide' : 'Why did this rating happen?'}
            </button>
            {showAttr && <AttributionBarChart simulationId={simulationId} slot={stay._slot} />}
          </div>
        )}

        <div className="grid md:grid-cols-4 gap-3 mb-6">
          <Metric label="Stars" value={`${stay.sensation_summary?.stars || '—'}★`} color="amber" />
          <Metric label="NPS" value={stay.sensation_summary?.nps ?? '—'} color="emerald" />
          <Metric label="Total spend" value={`€${stay.expense_summary?.total_spend_eur || 0}`} color="violet" />
          <Metric label="Moments" value={`${(stay.moments_positive || []).length}+ / ${(stay.moments_negative || []).length}-`} color="white" />
        </div>

        {/* Predicted review */}
        {pr?.will_write_review && (
          <div className="bg-[#12121c] border border-violet-500/20 rounded-xl p-5 mb-6">
            <div className="text-xs font-semibold text-violet-400 uppercase mb-2">Predicted review — {pr.platform}</div>
            {pr.title && <div className="text-white font-semibold mb-1">{pr.title}</div>}
            <div className="flex items-center gap-2 mb-3">
              <span className="text-amber-300 font-bold">{pr.star_rating}/5</span>
              <span className="text-xs text-gray-500">· Language: {pr.language || 'en'}</span>
            </div>
            <div className="text-sm text-gray-300 leading-relaxed whitespace-pre-wrap">{pr.body}</div>
            {(pr.themes || []).length > 0 && (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {pr.themes.map(t => <span key={t} className="bg-white/5 text-gray-400 text-[10px] px-2 py-0.5 rounded-full">{t}</span>)}
              </div>
            )}
          </div>
        )}

        {/* Stage-by-stage */}
        <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Stage journey ({(stay.stages || []).length} stages)</h3>
        <div className="space-y-3">
          {(stay.stages || []).map((stg, i) => (
            <div key={i} className="bg-[#12121c] border border-white/5 rounded-xl p-4">
              <div className="flex items-center justify-between mb-2">
                <div className="text-xs font-semibold text-violet-400 uppercase">{stg.stage}</div>
                <div className="text-xs text-gray-500">Night {stg.night || 1}</div>
              </div>
              <p className="text-sm text-gray-300 leading-relaxed mb-2 italic">"{stg.narrative}"</p>
              {stg.internal_thoughts && <p className="text-xs text-gray-500 mb-2">→ {stg.internal_thoughts}</p>}
              {Array.isArray(stg.moments_positive) && stg.moments_positive.length > 0 && (
                <div className="mt-2 text-xs text-emerald-300">
                  {stg.moments_positive.map((m, j) => <div key={j}>+ {typeof m === 'string' ? m : m.description}</div>)}
                </div>
              )}
              {Array.isArray(stg.moments_negative) && stg.moments_negative.length > 0 && (
                <div className="mt-1 text-xs text-red-300">
                  {stg.moments_negative.map((m, j) => <div key={j}>- {typeof m === 'string' ? m : m.description}</div>)}
                </div>
              )}
              {Array.isArray(stg.expenses_this_stage) && stg.expenses_this_stage.length > 0 && (
                <div className="mt-2 text-xs text-gray-400">
                  {stg.expenses_this_stage.map((e, j) => <span key={j} className="inline-block mr-3">€{e.amount_eur} {e.item || e.category}</span>)}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function Metric({ label, value, color }) {
  const colorMap = { white: 'text-white', emerald: 'text-emerald-400', red: 'text-red-400', amber: 'text-amber-300', violet: 'text-violet-400' };
  return (
    <div className="bg-surface-800 border border-white/10 rounded-xl p-4">
      <div className={`text-2xl font-bold ${colorMap[color] || 'text-white'}`}>{value}</div>
      <div className="text-xs text-gray-500 mt-1">{label}</div>
    </div>
  );
}
