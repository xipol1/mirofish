import { useState } from 'react';

const API_URL = process.env.NEXT_PUBLIC_API_URL || (typeof window !== 'undefined' && window.location.hostname !== 'localhost' ? '' : 'http://localhost:5001');

export default function CohortQueryPanel({ simulationId, archetypeOptions = [] }) {
  const [criteria, setCriteria] = useState({
    archetype: '',
    nps_min: '',
    nps_max: '',
    mentioned_theme: '',
    has_adversarial_event: '',
  });
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [expanded, setExpanded] = useState(true);

  const run = async () => {
    setLoading(true);
    setError(null);
    const c = {};
    if (criteria.archetype) c.archetype = criteria.archetype;
    if (criteria.nps_min !== '') c.nps_min = Number(criteria.nps_min);
    if (criteria.nps_max !== '') c.nps_max = Number(criteria.nps_max);
    if (criteria.mentioned_theme) c.mentioned_theme = criteria.mentioned_theme.split(',').map(s => s.trim()).filter(Boolean);
    if (criteria.has_adversarial_event === 'yes') c.has_adversarial_event = true;
    if (criteria.has_adversarial_event === 'no') c.has_adversarial_event = false;

    try {
      const res = await fetch(`${API_URL}/api/simulation/${simulationId}/agents/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'bypass-tunnel-reminder': 'true' },
        body: JSON.stringify({ criteria: c }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || `HTTP ${res.status}`);
      setResult(d);
    } catch (err) { setError(err.message); }
    finally { setLoading(false); }
  };

  return (
    <section className="bg-surface-800 border border-white/10 rounded-2xl p-6">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-xs font-semibold text-violet-400 uppercase tracking-widest">Cohort query</h3>
        <button onClick={() => setExpanded(e => !e)} className="text-xs text-gray-500 hover:text-white">{expanded ? 'collapse' : 'expand'}</button>
      </div>
      {expanded && (
        <>
          <div className="grid md:grid-cols-5 gap-2 mb-3">
            <select value={criteria.archetype} onChange={e => setCriteria(c => ({ ...c, archetype: e.target.value }))}
              className="bg-[#12121c] border border-white/10 rounded px-2 py-2 text-xs text-white">
              <option value="">any archetype</option>
              {archetypeOptions.map(a => <option key={a} value={a}>{a}</option>)}
            </select>
            <input placeholder="NPS min" value={criteria.nps_min} onChange={e => setCriteria(c => ({ ...c, nps_min: e.target.value }))} className="bg-[#12121c] border border-white/10 rounded px-2 py-2 text-xs text-white" />
            <input placeholder="NPS max" value={criteria.nps_max} onChange={e => setCriteria(c => ({ ...c, nps_max: e.target.value }))} className="bg-[#12121c] border border-white/10 rounded px-2 py-2 text-xs text-white" />
            <input placeholder="themes (comma sep.)" value={criteria.mentioned_theme} onChange={e => setCriteria(c => ({ ...c, mentioned_theme: e.target.value }))} className="bg-[#12121c] border border-white/10 rounded px-2 py-2 text-xs text-white" />
            <select value={criteria.has_adversarial_event} onChange={e => setCriteria(c => ({ ...c, has_adversarial_event: e.target.value }))} className="bg-[#12121c] border border-white/10 rounded px-2 py-2 text-xs text-white">
              <option value="">any adverse</option>
              <option value="yes">had incident</option>
              <option value="no">no incident</option>
            </select>
          </div>
          <button onClick={run} disabled={loading} className="px-4 py-1.5 bg-gradient-to-r from-violet-500 to-indigo-600 text-white rounded text-xs font-semibold disabled:opacity-50">
            {loading ? 'Querying…' : 'Query'}
          </button>

          {error && <div className="text-xs text-red-400 mt-3">{error}</div>}
          {result && (
            <div className="mt-4 space-y-3">
              <div className="bg-white/5 rounded-lg p-3 text-xs text-gray-300">
                <span className="text-white font-semibold">{result.count}</span> agents matched
                {result.summary.avg_nps != null && <span> · avg NPS <span className="text-emerald-300">{result.summary.avg_nps}</span></span>}
                {result.summary.avg_stars != null && <span> · avg ★ <span className="text-amber-300">{result.summary.avg_stars}</span></span>}
                {result.summary.avg_spend_eur != null && <span> · avg spend <span className="text-violet-300">€{result.summary.avg_spend_eur}</span></span>}
              </div>
              {result.summary.theme_frequency?.length > 0 && (
                <div className="text-xs text-gray-400">
                  Themes: {result.summary.theme_frequency.slice(0, 10).map(t => `${t.theme} (${t.pct}%)`).join(' · ')}
                </div>
              )}
              <div className="max-h-60 overflow-y-auto space-y-1.5">
                {result.matched.map(a => (
                  <div key={a.slot} className="bg-[#12121c] border border-white/5 rounded p-2 text-xs flex justify-between">
                    <span className="text-gray-300">#{a.slot} · {a.persona_name} <span className="text-violet-400">{a.archetype}</span></span>
                    <span className="text-gray-400">{a.stars}★ · NPS {a.nps} · €{a.spend_eur}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </section>
  );
}
