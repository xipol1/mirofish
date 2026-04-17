import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';

const API_URL = process.env.NEXT_PUBLIC_API_URL || (typeof window !== 'undefined' && window.location.hostname !== 'localhost' ? '' : 'http://localhost:5001');

function apiFetch(path, options = {}) {
  return fetch(`${API_URL}${path}`, { ...options, headers: { ...options.headers, 'bypass-tunnel-reminder': 'true' } });
}

export default function PropertyDetail() {
  const router = useRouter();
  const { id } = router.query;
  const [property, setProperty] = useState(null);
  const [reviews, setReviews] = useState([]);
  const [aggregation, setAggregation] = useState(null);
  const [uploadJson, setUploadJson] = useState('');
  const [scrapeUrl, setScrapeUrl] = useState('');
  const [simAudience, setSimAudience] = useState('');
  const [simAgentCount, setSimAgentCount] = useState(6);
  const [uploadMsg, setUploadMsg] = useState(null);
  const [launchingSim, setLaunchingSim] = useState(false);

  useEffect(() => {
    if (!id) return;
    apiFetch(`/api/properties/${id}`).then(r => r.json()).then(d => setProperty(d.property)).catch(() => {});
    loadReviews();
  }, [id]);

  const loadReviews = () => {
    if (!id) return;
    apiFetch(`/api/properties/${id}/reviews?limit=200`).then(r => r.json()).then(d => {
      setReviews(d.reviews || []);
      setAggregation(d.aggregation);
    }).catch(() => {});
  };

  const uploadReviews = async () => {
    setUploadMsg(null);
    try {
      const parsed = JSON.parse(uploadJson);
      const reviewsArr = Array.isArray(parsed) ? parsed : parsed.reviews;
      if (!Array.isArray(reviewsArr)) throw new Error('Expected JSON array or { reviews: [...] }');
      const res = await apiFetch(`/api/properties/${id}/reviews/upload`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reviews: reviewsArr }),
      });
      const d = await res.json();
      if (res.ok) {
        setUploadMsg(`Uploaded ${d.inserted} reviews (${d.skipped} skipped as duplicates)`);
        setUploadJson('');
        loadReviews();
      } else throw new Error(d.error);
    } catch (err) { setUploadMsg('Error: ' + err.message); }
  };

  const startScrape = async () => {
    if (!scrapeUrl) return;
    const res = await apiFetch(`/api/properties/${id}/reviews/scrape`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: scrapeUrl, limit: 50 }),
    });
    const d = await res.json();
    setUploadMsg(d.message || 'Scrape queued');
  };

  const launchStaySim = async () => {
    if (!simAudience) return;
    setLaunchingSim(true);
    try {
      const res = await apiFetch(`/api/properties/${id}/stay-simulate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ audience: simAudience, agent_count: simAgentCount }),
      });
      const d = await res.json();
      if (res.ok) {
        router.push(`/stays/${d.simulationId}`);
      } else throw new Error(d.error);
    } catch (err) {
      setUploadMsg('Error: ' + err.message);
      setLaunchingSim(false);
    }
  };

  if (!property) return <div className="min-h-screen bg-[#08080e] text-gray-400 flex items-center justify-center">Loading property…</div>;

  const identity = property.data_json?.identity || {};
  const marketing = property.data_json?.marketing || property.marketing_json || {};

  return (
    <>
      <Head><title>{property.name} — Synthetic Users</title></Head>
      <div className="min-h-screen bg-[#08080e] text-gray-100">
        <nav className="border-b border-white/5 px-6 py-4">
          <div className="max-w-6xl mx-auto flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center text-white font-bold text-xs">SU</div>
              <span className="font-semibold text-white text-lg">{property.name}</span>
              {property.brand && <span className="text-xs px-2 py-0.5 rounded-full bg-violet-500/10 text-violet-300 border border-violet-500/20">{property.brand}</span>}
            </div>
            <a href="/properties" className="text-sm text-gray-400 hover:text-white">← Properties</a>
          </div>
        </nav>

        <main className="max-w-6xl mx-auto px-6 py-8 space-y-8">

          {/* Identity */}
          <section className="bg-surface-800 border border-white/10 rounded-2xl p-6">
            <h2 className="text-xs font-semibold text-violet-400 uppercase tracking-widest mb-3">Identity</h2>
            <div className="grid md:grid-cols-4 gap-4">
              <Info label="Tier" value={identity.tier || '—'} />
              <Info label="Category" value={identity.category_stars ? `${identity.category_stars} ★` : '—'} />
              <Info label="Location" value={`${identity.location?.city || ''}, ${identity.location?.country || ''}`} />
              <Info label="Rooms" value={property.data_json?.capacity?.total_rooms || '—'} />
            </div>
            {marketing.primary_positioning && (
              <p className="mt-4 text-sm text-gray-300">{marketing.primary_positioning}</p>
            )}
            {Array.isArray(marketing.known_strengths) && marketing.known_strengths.length > 0 && (
              <div className="mt-3 text-xs text-gray-400"><span className="text-emerald-400 font-semibold">Strengths:</span> {marketing.known_strengths.join(' · ')}</div>
            )}
            {Array.isArray(marketing.known_weaknesses) && marketing.known_weaknesses.length > 0 && (
              <div className="mt-1 text-xs text-gray-400"><span className="text-red-400 font-semibold">Weaknesses:</span> {marketing.known_weaknesses.join(' · ')}</div>
            )}
          </section>

          {/* Reviews section */}
          <section className="bg-surface-800 border border-white/10 rounded-2xl p-6">
            <div className="flex items-start justify-between mb-4">
              <h2 className="text-xs font-semibold text-violet-400 uppercase tracking-widest">Ingested reviews ({reviews.length})</h2>
              {aggregation?.avg_rating_normalized_5 && (
                <div className="text-right">
                  <div className="text-2xl font-bold text-amber-300">{aggregation.avg_rating_normalized_5.toFixed(1)} ★</div>
                  <div className="text-xs text-gray-500">Avg across sources</div>
                </div>
              )}
            </div>

            {aggregation && (
              <div className="grid md:grid-cols-2 gap-4 mb-6">
                <div>
                  <div className="text-xs font-semibold text-emerald-400 uppercase mb-2">Top positive themes</div>
                  <div className="flex flex-wrap gap-1.5">
                    {(aggregation.top_positive_themes || []).map(t => <span key={t} className="bg-emerald-500/10 text-emerald-300 text-xs px-2 py-0.5 rounded-full">{t}</span>)}
                    {(aggregation.top_positive_themes || []).length === 0 && <span className="text-xs text-gray-500">Not enough data</span>}
                  </div>
                </div>
                <div>
                  <div className="text-xs font-semibold text-red-400 uppercase mb-2">Top negative themes</div>
                  <div className="flex flex-wrap gap-1.5">
                    {(aggregation.top_negative_themes || []).map(t => <span key={t} className="bg-red-500/10 text-red-300 text-xs px-2 py-0.5 rounded-full">{t}</span>)}
                    {(aggregation.top_negative_themes || []).length === 0 && <span className="text-xs text-gray-500">Not enough data</span>}
                  </div>
                </div>
              </div>
            )}

            <details className="mb-4">
              <summary className="cursor-pointer text-sm text-gray-300 font-semibold">+ Upload reviews (JSON)</summary>
              <div className="mt-3 space-y-2">
                <textarea value={uploadJson} onChange={(e) => setUploadJson(e.target.value)} rows={5} placeholder='[{"source":"tripadvisor","body":"...","rating_numeric":4,"rating_scale":5,"title":"..."}, ...]' className="w-full bg-[#12121c] border border-white/10 rounded-xl px-3 py-2 text-xs font-mono text-gray-200" />
                <button onClick={uploadReviews} className="bg-violet-600 hover:bg-violet-500 text-white text-xs font-semibold px-4 py-2 rounded-lg">Upload</button>
              </div>
            </details>

            <details className="mb-4">
              <summary className="cursor-pointer text-sm text-gray-300 font-semibold">+ Scrape from URL (TripAdvisor / Booking / Google Maps)</summary>
              <div className="mt-3 flex gap-2">
                <input type="url" value={scrapeUrl} onChange={(e) => setScrapeUrl(e.target.value)} placeholder="https://www.tripadvisor.com/Hotel_Review-g...html" className="flex-1 bg-[#12121c] border border-white/10 rounded-xl px-3 py-2 text-sm text-gray-200" />
                <button onClick={startScrape} className="bg-violet-600 hover:bg-violet-500 text-white text-xs font-semibold px-4 py-2 rounded-lg">Scrape</button>
              </div>
            </details>

            {uploadMsg && <p className="text-xs text-gray-400 mt-2">{uploadMsg}</p>}

            {/* Recent reviews */}
            {reviews.length > 0 && (
              <div className="mt-5 max-h-72 overflow-y-auto space-y-2">
                {reviews.slice(0, 25).map((r, i) => (
                  <div key={i} className="text-xs bg-[#12121c] border border-white/5 rounded-lg p-3">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-[10px] uppercase bg-white/5 px-1.5 py-0.5 rounded text-gray-400">{r.source}</span>
                      {r.rating_numeric && <span className="text-amber-300 font-semibold">{r.rating_numeric}/{r.rating_scale || 5}</span>}
                    </div>
                    {r.title && <div className="font-semibold text-gray-200 mb-0.5">{r.title}</div>}
                    <div className="text-gray-400 leading-relaxed">{(r.body || '').substring(0, 300)}{r.body?.length > 300 ? '…' : ''}</div>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Run stay simulation */}
          <section className="bg-gradient-to-br from-violet-900/20 to-surface-800 border border-violet-500/20 rounded-2xl p-6">
            <h2 className="text-xs font-semibold text-violet-400 uppercase tracking-widest mb-4">Run stay simulation</h2>
            <p className="text-sm text-gray-300 mb-4">Send synthetic guests through a complete stay at this property. Each agent lives through arrival, room, F&B, amenities, and checkout — producing a predicted review + spending + NPS.</p>

            <div className="space-y-4">
              <textarea value={simAudience} onChange={(e) => setSimAudience(e.target.value)} rows={3} placeholder='Target guest mix, e.g.: "Mix of business travelers (30%), luxury couples (25%), family vacationers (20%), loyalty members (15%), event attendees (10%). EU and Latam origin, 30-60 years old, mobile-heavy."' className="w-full bg-[#12121c] border border-white/10 rounded-xl px-3 py-2 text-sm text-gray-200" />
              <div className="flex items-center gap-4">
                <label className="text-sm text-gray-400">Agents:</label>
                <input type="number" min={3} max={50} value={simAgentCount} onChange={(e) => setSimAgentCount(parseInt(e.target.value, 10) || 6)} className="w-20 bg-[#12121c] border border-white/10 rounded-xl px-3 py-2 text-sm text-gray-200" />
                <button disabled={launchingSim || !simAudience} onClick={launchStaySim} className="flex-1 bg-violet-600 hover:bg-violet-500 disabled:opacity-40 text-white font-semibold py-2.5 rounded-xl text-sm">
                  {launchingSim ? 'Launching…' : `Launch ${simAgentCount} stay simulations →`}
                </button>
              </div>
            </div>
          </section>
        </main>
      </div>
    </>
  );
}

function Info({ label, value }) {
  return (
    <div>
      <div className="text-xs text-gray-500 uppercase tracking-wider">{label}</div>
      <div className="text-sm text-white font-semibold mt-0.5">{value}</div>
    </div>
  );
}
