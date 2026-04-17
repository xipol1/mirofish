import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';

const API_URL = process.env.NEXT_PUBLIC_API_URL || (typeof window !== 'undefined' && window.location.hostname !== 'localhost' ? '' : 'http://localhost:5001');

function apiFetch(path, options = {}) {
  const headers = { ...options.headers, 'bypass-tunnel-reminder': 'true' };
  return fetch(`${API_URL}${path}`, { ...options, headers });
}

export default function PropertiesList() {
  const router = useRouter();
  const [properties, setProperties] = useState(null);
  const [datasetsStatus, setDatasetsStatus] = useState(null);

  useEffect(() => {
    apiFetch('/api/properties').then(r => r.json()).then(d => setProperties(d.properties || [])).catch(() => setProperties([]));
    apiFetch('/api/enterprise/datasets/status').then(r => r.json()).then(setDatasetsStatus).catch(() => {});
  }, []);

  return (
    <>
      <Head><title>Properties — Synthetic Users Hospitality</title></Head>
      <div className="min-h-screen bg-[#08080e] text-gray-100">
        <nav className="border-b border-white/5 px-6 py-4">
          <div className="max-w-6xl mx-auto flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center text-white font-bold text-xs">SU</div>
              <span className="font-semibold text-white text-lg">Synthetic Users</span>
              <span className="text-xs px-2 py-0.5 rounded-full bg-violet-500/10 text-violet-300 border border-violet-500/20 ml-1">HOSPITALITY</span>
            </div>
            <a href="/enterprise" className="text-sm text-gray-400 hover:text-white">← Enterprise</a>
          </div>
        </nav>

        <main className="max-w-6xl mx-auto px-6 py-10">
          <div className="flex items-start justify-between mb-8">
            <div>
              <h1 className="text-3xl font-bold text-white mb-2">Properties</h1>
              <p className="text-gray-400 text-sm max-w-lg">Upload hotels to the platform. The system runs multi-archetype stay simulations against each property, with calibration from ingested reviews.</p>
            </div>
            <button onClick={() => router.push('/properties/new')} className="bg-violet-600 hover:bg-violet-500 text-white font-semibold px-5 py-2.5 rounded-xl text-sm">
              + New property
            </button>
          </div>

          {datasetsStatus && (
            <div className="mb-6 bg-surface-800 border border-white/5 rounded-xl p-4 flex flex-wrap gap-3 text-xs">
              <div className="text-gray-400 font-semibold uppercase tracking-wider mr-2">Datasets:</div>
              {Object.entries(datasetsStatus.cache_sizes || {}).map(([k, v]) => (
                <div key={k} className="bg-white/5 px-2 py-1 rounded">
                  <span className="text-gray-400">{k.replace(/_/g, ' ')}:</span>{' '}
                  <span className="text-emerald-400 font-mono">{v}</span>
                </div>
              ))}
            </div>
          )}

          {!properties && <p className="text-gray-500">Loading...</p>}
          {properties && properties.length === 0 && (
            <div className="bg-surface-800 border border-white/10 rounded-2xl p-10 text-center">
              <h2 className="text-xl font-bold text-white mb-2">No properties yet</h2>
              <p className="text-gray-400 mb-6">Add your first hotel to start running stay simulations.</p>
              <button onClick={() => router.push('/properties/new')} className="bg-violet-600 hover:bg-violet-500 text-white font-semibold px-5 py-2.5 rounded-xl text-sm">
                + Create first property
              </button>
            </div>
          )}

          {properties && properties.length > 0 && (
            <div className="grid md:grid-cols-2 gap-4">
              {properties.map((p) => (
                <div key={p.id} onClick={() => router.push(`/properties/${p.id}`)}
                  className="bg-surface-800 hover:bg-white/5 border border-white/10 hover:border-violet-500/40 rounded-2xl p-5 cursor-pointer transition-all">
                  <div className="flex items-start justify-between mb-2">
                    <div>
                      <div className="text-xs text-violet-400 uppercase tracking-wider">{p.brand || 'Independent'}</div>
                      <h3 className="text-white font-semibold text-lg mt-0.5">{p.name}</h3>
                    </div>
                    {p.historical_avg_rating && (
                      <div className="bg-amber-500/10 text-amber-300 text-sm font-bold px-2 py-1 rounded">
                        {Number(p.historical_avg_rating).toFixed(1)} ★
                      </div>
                    )}
                  </div>
                  {p.website_url && <div className="text-xs text-gray-500 truncate mt-1">{p.website_url}</div>}
                </div>
              ))}
            </div>
          )}
        </main>
      </div>
    </>
  );
}
