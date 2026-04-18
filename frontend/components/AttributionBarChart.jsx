import { useEffect, useState } from 'react';

const API_URL = process.env.NEXT_PUBLIC_API_URL || (typeof window !== 'undefined' && window.location.hostname !== 'localhost' ? '' : 'http://localhost:5001');

function cleanDim(dim) {
  if (!dim) return '';
  return dim.replace(/^_/, '').replace(/_/g, ' ');
}

export default function AttributionBarChart({ simulationId, slot }) {
  const [attr, setAttr] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancel = false;
    setLoading(true);
    fetch(`${API_URL}/api/simulation/${simulationId}/agent/${slot}/attribution`, { headers: { 'bypass-tunnel-reminder': 'true' } })
      .then(r => r.json())
      .then(d => { if (!cancel) { setAttr(d); setLoading(false); } })
      .catch(err => { if (!cancel) { setError(err.message); setLoading(false); } });
    return () => { cancel = true; };
  }, [simulationId, slot]);

  if (loading) return <div className="text-xs text-gray-500">Computing attribution…</div>;
  if (error) return <div className="text-xs text-red-400">{error}</div>;
  if (!attr || attr.error) return <div className="text-xs text-gray-500">No attribution available.</div>;

  const pos = (attr.top_positive_drivers || []).slice(0, 5);
  const neg = (attr.top_negative_drivers || []).slice(0, 5);
  const maxAbs = Math.max(
    ...pos.map(p => Math.abs(p.points)),
    ...neg.map(n => Math.abs(n.points)),
    1,
  );

  return (
    <div className="bg-[#12121c] border border-white/10 rounded-xl p-4 mt-3">
      <div className="text-xs font-semibold text-violet-400 uppercase mb-3">Why this rating? (final NPS {attr.final_nps})</div>

      {pos.length > 0 && (
        <div className="mb-3">
          <div className="text-[10px] uppercase text-emerald-400 mb-1">Positive drivers</div>
          {pos.map((p, i) => (
            <div key={i} className="mb-1.5">
              <div className="flex justify-between text-xs text-gray-300"><span>{cleanDim(p.dim)}</span><span className="text-emerald-300">+{p.points} NPS</span></div>
              <div className="h-1.5 bg-white/5 rounded-full overflow-hidden"><div className="h-full bg-emerald-400/70" style={{ width: `${(Math.abs(p.points) / maxAbs) * 100}%` }} /></div>
            </div>
          ))}
        </div>
      )}

      {neg.length > 0 && (
        <div>
          <div className="text-[10px] uppercase text-red-400 mb-1">Negative drivers</div>
          {neg.map((n, i) => (
            <div key={i} className="mb-1.5">
              <div className="flex justify-between text-xs text-gray-300"><span>{cleanDim(n.dim)}</span><span className="text-red-300">{n.points} NPS</span></div>
              <div className="h-1.5 bg-white/5 rounded-full overflow-hidden"><div className="h-full bg-red-400/70" style={{ width: `${(Math.abs(n.points) / maxAbs) * 100}%` }} /></div>
            </div>
          ))}
        </div>
      )}

      {(attr.adversarial_event_nps_impact || []).length > 0 && (
        <div className="mt-3 pt-3 border-t border-white/5">
          <div className="text-[10px] uppercase text-amber-400 mb-1">Adverse events</div>
          {attr.adversarial_event_nps_impact.map((ev, i) => (
            <div key={i} className="text-[11px] text-gray-400">
              • {ev.event_id} @ {ev.stage} — res: {ev.resolution_quality} → <span className="text-red-300">{ev.nps_impact} NPS</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
