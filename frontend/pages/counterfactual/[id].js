import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';

const API_URL = process.env.NEXT_PUBLIC_API_URL || (typeof window !== 'undefined' && window.location.hostname !== 'localhost' ? '' : 'http://localhost:5001');
const apiFetch = (p, o = {}) => fetch(`${API_URL}${p}`, { ...o, headers: { ...o.headers, 'bypass-tunnel-reminder': 'true' } });

export default function CounterfactualViewer() {
  const router = useRouter();
  const { id } = router.query;
  const [state, setState] = useState({ status: 'running', progress: { events: [] }, result: null, error: null });

  const poll = useCallback(async () => {
    if (!id) return;
    try {
      const res = await apiFetch(`/api/simulation/${id}`);
      const d = await res.json();
      setState(s => ({ ...s, status: d.status, progress: d.progress || s.progress, result: d.status === 'completed' ? d.result : null, error: d.error || null }));
    } catch (err) { setState(s => ({ ...s, error: err.message })); }
  }, [id]);

  useEffect(() => {
    if (!id || state.status !== 'running') return;
    poll();
    const iv = setInterval(poll, 2500);
    return () => clearInterval(iv);
  }, [id, state.status, poll]);

  return (
    <>
      <Head><title>Counterfactual — Synthetic Users</title></Head>
      <div className="min-h-screen bg-[#08080e] text-gray-100">
        <nav className="border-b border-white/5 px-6 py-4">
          <div className="max-w-6xl mx-auto flex items-center justify-between">
            <span className="font-semibold text-white text-lg">A/B Counterfactual</span>
            <a href="/properties" className="text-sm text-gray-400 hover:text-white">← Properties</a>
          </div>
        </nav>
        <main className="max-w-6xl mx-auto px-6 py-8 space-y-8">
          {state.status === 'running' && <Running events={state.progress.events} />}
          {state.status === 'failed' && <div className="bg-red-900/20 border border-red-500/30 rounded-xl p-6 text-red-300">{state.error}</div>}
          {state.status === 'completed' && state.result && <Completed r={state.result} />}
        </main>
      </div>
    </>
  );
}

function Running({ events = [] }) {
  return (
    <div className="bg-surface-800 border border-white/10 rounded-2xl p-6">
      <h2 className="text-xl font-bold text-white mb-2">Running baseline + variant…</h2>
      <p className="text-gray-400 text-sm mb-4">Each cohort runs the same personas through a different configuration so the delta is causal, not correlational.</p>
      <div className="max-h-80 overflow-y-auto space-y-1 font-mono text-[11px]">
        {[...events].reverse().slice(0, 60).map((e, i) => (
          <div key={i} className="text-gray-400"><span className="text-violet-400">{e.arm || e.phase || e.type}</span> · {e.payload?.persona_name || e.payload?.message || ''}</div>
        ))}
      </div>
    </div>
  );
}

function Completed({ r }) {
  const d = r.delta || {};
  const cohortDeltaColor = (v) => v > 0 ? 'text-emerald-300' : v < 0 ? 'text-red-300' : 'text-gray-400';

  return (
    <>
      <section className="grid md:grid-cols-2 gap-4">
        <Card title="Baseline" s={r.baseline_summary} tone="gray" />
        <Card title={`Variant — ${r.variant_label}`} s={r.variant_summary} tone="violet" />
      </section>

      <section className="bg-surface-800 border border-white/10 rounded-2xl p-6">
        <h3 className="text-xs font-semibold text-violet-400 uppercase tracking-widest mb-3">Causal delta (variant − baseline)</h3>
        <div className="grid md:grid-cols-5 gap-3">
          <Delta label="NPS" value={d.avg_nps_delta} suffix="" />
          <Delta label="Stars" value={d.avg_stars_delta} suffix="" />
          <Delta label="Spend" value={d.avg_spend_delta} suffix="€" />
          <Delta label="ADR" value={d.avg_adr_delta} suffix="€" />
          <Delta label="Return intent" value={d.avg_return_intent_delta} suffix="" />
        </div>
        {d.significance && (
          <div className="mt-4 text-xs text-gray-400">
            NPS bootstrap 95% CI: <span className="text-white">[{d.significance.nps_ci?.low}, {d.significance.nps_ci?.high}]</span> · p≈{d.significance.nps_p_value?.toFixed(3)}
          </div>
        )}
        {d.revenue_projection_eur_annual != null && (
          <div className="mt-2 text-sm text-emerald-300 font-semibold">Projected annual revenue uplift: €{d.revenue_projection_eur_annual.toLocaleString()}</div>
        )}
      </section>

      {d.per_segment_delta && Object.keys(d.per_segment_delta).length > 0 && (
        <section className="bg-surface-800 border border-white/10 rounded-2xl p-6">
          <h3 className="text-xs font-semibold text-violet-400 uppercase tracking-widest mb-3">Per-segment delta</h3>
          <div className="grid md:grid-cols-2 gap-2">
            {Object.entries(d.per_segment_delta).map(([arch, seg]) => (
              <div key={arch} className="bg-[#12121c] border border-white/5 rounded-lg p-3 text-xs">
                <div className="flex justify-between mb-1"><span className="text-white">{arch}</span><span className="text-gray-500">n={seg.n}</span></div>
                <div className="flex gap-3 text-gray-300">
                  <span>ΔNPS <span className={cohortDeltaColor(seg.avg_nps_delta)}>{seg.avg_nps_delta}</span></span>
                  <span>Δ★ <span className={cohortDeltaColor(seg.avg_stars_delta)}>{seg.avg_stars_delta}</span></span>
                  <span>Δ€ <span className={cohortDeltaColor(seg.avg_spend_delta)}>{seg.avg_spend_delta}</span></span>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
    </>
  );
}

function Card({ title, s = {}, tone }) {
  const border = tone === 'violet' ? 'border-violet-500/30' : 'border-white/10';
  return (
    <div className={`bg-surface-800 border ${border} rounded-2xl p-5`}>
      <div className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-3">{title}</div>
      <div className="grid grid-cols-2 gap-2 text-xs">
        <Stat label="Avg ★" value={s.avg_stars} />
        <Stat label="Avg NPS" value={s.avg_nps} />
        <Stat label="Net promoter" value={s.net_promoter_score} />
        <Stat label="Avg spend €" value={s.avg_spend_eur} />
        <Stat label="Would repeat %" value={s.would_repeat_pct} />
        <Stat label="Would recommend %" value={s.would_recommend_pct} />
      </div>
    </div>
  );
}

function Stat({ label, value }) {
  return (
    <div className="bg-white/5 rounded px-2 py-1.5">
      <div className="text-gray-500 text-[10px] uppercase">{label}</div>
      <div className="text-white font-semibold">{value ?? '—'}</div>
    </div>
  );
}

function Delta({ label, value, suffix }) {
  const color = value > 0 ? 'text-emerald-300' : value < 0 ? 'text-red-300' : 'text-gray-400';
  const sign = value > 0 ? '+' : '';
  return (
    <div className="bg-[#12121c] border border-white/5 rounded-lg p-3">
      <div className="text-[10px] text-gray-500 uppercase">{label}</div>
      <div className={`text-lg font-bold ${color}`}>{value != null ? `${sign}${value}${suffix}` : '—'}</div>
    </div>
  );
}
