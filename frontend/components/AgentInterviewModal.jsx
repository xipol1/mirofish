import { useState } from 'react';

const API_URL = process.env.NEXT_PUBLIC_API_URL || (typeof window !== 'undefined' && window.location.hostname !== 'localhost' ? '' : 'http://localhost:5001');

export default function AgentInterviewModal({ simulationId, slot, persona, onClose }) {
  const [question, setQuestion] = useState('');
  const [loading, setLoading] = useState(false);
  const [turns, setTurns] = useState([]); // [{ question, answer, tone, cited, confidence, themes }]
  const [error, setError] = useState(null);

  const ask = async () => {
    if (!question.trim() || loading) return;
    setLoading(true);
    setError(null);
    const q = question;
    const previous_qa = turns.map(t => ({ question: t.question, answer: t.answer }));
    try {
      const res = await fetch(`${API_URL}/api/simulation/${simulationId}/agent/${slot}/interview`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'bypass-tunnel-reminder': 'true' },
        body: JSON.stringify({ question: q, previous_qa }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setTurns(prev => [...prev, {
        question: q,
        answer: data.answer || '(no answer)',
        tone: data.emotional_tone,
        cited: data.cited_stage_indices || [],
        confidence: data.memory_confidence_0_1,
        themes: data.mentioned_themes || [],
      }]);
      setQuestion('');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center p-4 z-50 overflow-y-auto" onClick={onClose}>
      <div className="bg-surface-800 border border-white/10 rounded-2xl max-w-3xl w-full max-h-[90vh] overflow-y-auto p-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between mb-4">
          <div>
            <div className="text-xs text-violet-400 uppercase tracking-widest">Interview · synthetic guest</div>
            <h2 className="text-xl font-bold text-white">{persona?.name || `Agent #${slot}`}</h2>
            <div className="text-xs text-gray-500 mt-1">{persona?.archetype_label || persona?.archetype_id} · slot {slot}</div>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-white text-2xl">×</button>
        </div>

        <div className="space-y-4 mb-4 max-h-[55vh] overflow-y-auto pr-2">
          {turns.length === 0 && (
            <div className="text-xs text-gray-500 italic bg-white/5 rounded-lg p-4 border border-white/5">
              Ask this guest anything about their stay. They respond in first person and cite the stage their memory comes from.
            </div>
          )}
          {turns.map((t, i) => (
            <div key={i} className="space-y-2">
              <div className="bg-violet-500/10 border border-violet-500/20 rounded-lg p-3">
                <div className="text-xs text-violet-300 mb-1">Analyst</div>
                <div className="text-sm text-white">{t.question}</div>
              </div>
              <div className="bg-white/5 border border-white/10 rounded-lg p-3">
                <div className="text-xs text-gray-400 mb-1">{persona?.name || 'Guest'} · <span className="text-amber-300">{t.tone}</span> · confidence {Math.round((t.confidence || 0) * 100)}%</div>
                <div className="text-sm text-gray-200 whitespace-pre-wrap">{t.answer}</div>
                {(t.cited?.length > 0 || t.themes?.length > 0) && (
                  <div className="mt-2 flex flex-wrap gap-1 text-[10px]">
                    {t.cited.map((c, j) => <span key={`c${j}`} className="bg-violet-500/10 text-violet-300 px-2 py-0.5 rounded">stage {c}</span>)}
                    {t.themes.map((th, j) => <span key={`t${j}`} className="bg-white/5 text-gray-400 px-2 py-0.5 rounded">{th}</span>)}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>

        {error && <div className="text-xs text-red-400 mb-2">{error}</div>}

        <div className="flex gap-2">
          <textarea
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ask(); } }}
            placeholder="e.g. ¿qué fue lo mejor de tu estancia? / what would make you come back?"
            rows={2}
            className="flex-1 bg-[#12121c] border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-violet-500/50"
            disabled={loading}
          />
          <button
            onClick={ask}
            disabled={loading || !question.trim()}
            className="px-4 py-2 bg-gradient-to-r from-violet-500 to-indigo-600 text-white rounded-lg text-sm font-semibold disabled:opacity-50"
          >
            {loading ? '…' : 'Ask'}
          </button>
        </div>
      </div>
    </div>
  );
}
