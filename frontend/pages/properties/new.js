import { useState } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';

const API_URL = process.env.NEXT_PUBLIC_API_URL || (typeof window !== 'undefined' && window.location.hostname !== 'localhost' ? '' : 'http://localhost:5001');

function apiFetch(path, options = {}) {
  return fetch(`${API_URL}${path}`, { ...options, headers: { ...options.headers, 'bypass-tunnel-reminder': 'true' } });
}

const MELIA_EXAMPLE = {
  name: 'Gran Meliá Palacio de los Duques',
  brand: 'Gran Meliá',
  website_url: 'https://www.melia.com/en/hotels/spain/madrid/gran-melia-palacio-de-los-duques/',
  data_json: {
    identity: {
      name: 'Gran Meliá Palacio de los Duques',
      brand: 'Gran Meliá',
      tier: 'luxury',
      category_stars: 5,
      location: { city: 'Madrid', country: 'Spain', neighborhood: 'Ópera', destination_type: 'urban' },
      opening_year: 2015,
    },
    capacity: { total_rooms: 180, restaurants_count: 2, pool_count: 1, spa: true, gym: true, business_center: true },
    amenities: {
      wifi_advertised_mbps: 300,
      wifi_actual_measured_mbps: 150,
      parking: { available: true, rate_eur_per_day: 35, valet: true },
    },
    pricing_model: { typical_adr_eur: 420, resort_fee_eur_per_night: 0, city_tax_eur_per_night: 4 },
    loyalty: { program_name: 'MeliáRewards' },
    marketing: {
      primary_positioning: 'Historic palace in Madrid\'s Opera district, blending heritage with modern luxury',
      known_strengths: ['rooftop pool with Royal Palace views', 'Dos Cielos Michelin restaurant', 'central Ópera location'],
      known_weaknesses: ['some street-facing rooms can be noisy', 'rooms smaller than international luxury standard'],
    },
  },
};

export default function NewProperty() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [brand, setBrand] = useState('');
  const [websiteUrl, setWebsiteUrl] = useState('');
  const [jsonText, setJsonText] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const loadExample = () => {
    setName(MELIA_EXAMPLE.name);
    setBrand(MELIA_EXAMPLE.brand);
    setWebsiteUrl(MELIA_EXAMPLE.website_url);
    setJsonText(JSON.stringify(MELIA_EXAMPLE.data_json, null, 2));
  };

  const submit = async (e) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      let data_json = {};
      try { data_json = jsonText ? JSON.parse(jsonText) : {}; } catch (err) { throw new Error('Data JSON invalid: ' + err.message); }
      const res = await apiFetch('/api/properties', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, brand, website_url: websiteUrl, data_json }),
      });
      if (!res.ok) { const d = await res.json(); throw new Error(d.error || 'create failed'); }
      const d = await res.json();
      router.push(`/properties/${d.property.id}`);
    } catch (err) {
      setError(err.message);
      setLoading(false);
    }
  };

  return (
    <>
      <Head><title>New property — Synthetic Users</title></Head>
      <div className="min-h-screen bg-[#08080e] text-gray-100">
        <nav className="border-b border-white/5 px-6 py-4">
          <div className="max-w-4xl mx-auto flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center text-white font-bold text-xs">SU</div>
              <span className="font-semibold text-white text-lg">New property</span>
            </div>
            <a href="/properties" className="text-sm text-gray-400 hover:text-white">← Properties</a>
          </div>
        </nav>

        <main className="max-w-3xl mx-auto px-6 py-10">
          <div className="flex items-start justify-between mb-6">
            <div>
              <h1 className="text-2xl font-bold text-white mb-1">Create property</h1>
              <p className="text-sm text-gray-400">Upload the hotel's full profile. The simulation engine consumes this data.</p>
            </div>
            <button onClick={loadExample} className="text-xs text-violet-400 hover:text-violet-300">Load Meliá example →</button>
          </div>

          <form onSubmit={submit} className="space-y-5">
            <div>
              <label className="block text-sm font-semibold text-gray-300 mb-2">Property name *</label>
              <input type="text" required value={name} onChange={(e) => setName(e.target.value)} className="w-full bg-[#12121c] border border-white/10 rounded-xl px-4 py-3 text-gray-200" />
            </div>
            <div>
              <label className="block text-sm font-semibold text-gray-300 mb-2">Brand</label>
              <input type="text" value={brand} onChange={(e) => setBrand(e.target.value)} placeholder="e.g. Gran Meliá, Meliá, INNSIDE, Sol, Paradisus, ME" className="w-full bg-[#12121c] border border-white/10 rounded-xl px-4 py-3 text-gray-200 placeholder-gray-600" />
            </div>
            <div>
              <label className="block text-sm font-semibold text-gray-300 mb-2">Website URL</label>
              <input type="url" value={websiteUrl} onChange={(e) => setWebsiteUrl(e.target.value)} className="w-full bg-[#12121c] border border-white/10 rounded-xl px-4 py-3 text-gray-200" />
            </div>
            <div>
              <label className="block text-sm font-semibold text-gray-300 mb-2">Property data (JSON) <span className="text-xs text-gray-500 ml-1">— schema: identity, capacity, amenities, pricing_model, loyalty, marketing, operations_and_sops</span></label>
              <textarea value={jsonText} onChange={(e) => setJsonText(e.target.value)} rows={18} placeholder='{"identity": {...}, "capacity": {...}, ...}' className="w-full bg-[#12121c] border border-white/10 rounded-xl px-4 py-3 text-gray-200 text-xs font-mono" />
              <p className="text-xs text-gray-500 mt-1">See <code className="text-violet-300">backend/data/industries/hospitality/property_template.json</code> for the full schema.</p>
            </div>
            {error && <div className="bg-red-900/20 border border-red-500/30 rounded-xl p-3 text-red-300 text-sm">{error}</div>}
            <button type="submit" disabled={loading || !name} className="w-full bg-violet-600 hover:bg-violet-500 disabled:opacity-40 text-white font-semibold py-3 rounded-xl">
              {loading ? 'Creating...' : 'Create property'}
            </button>
          </form>
        </main>
      </div>
    </>
  );
}
