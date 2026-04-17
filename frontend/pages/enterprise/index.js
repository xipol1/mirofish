import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';

const API_URL = process.env.NEXT_PUBLIC_API_URL || (typeof window !== 'undefined' && window.location.hostname !== 'localhost' ? '' : 'http://localhost:5001');

function apiFetch(path, options = {}) {
  const headers = { ...options.headers, 'bypass-tunnel-reminder': 'true' };
  return fetch(`${API_URL}${path}`, { ...options, headers });
}

const PRESETS = [
  {
    label: 'Meliá — Booking funnel validation',
    industry: 'hospitality',
    target_url: 'https://www.melia.com/',
    audience: 'Leisure and business travelers evaluating Meliá hotels. Mix: 30% business (Innside/Meliá), 25% leisure couples (Meliá/Sol), 20% families (Paradisus/Sol), 10% luxury (Gran Meliá/ME), 10% loyalty members, 5% event attendees. Mostly EU + Latam origin, 25-60 years old, 60% mobile device, mix of direct and OTA-primed.',
    goal: 'Maximize direct bookings vs OTA leakage; surface hidden-fee and loyalty-recognition friction',
    task_type: 'landing_page',
    agent_count: 12,
    accent: 'violet',
  },
  {
    label: 'Meliá — Loyalty rate recognition',
    industry: 'hospitality',
    target_url: 'https://www.melia.com/es/hoteles/espana/madrid/gran-melia-palacio-de-los-duques/',
    audience: 'MeliáRewards Silver/Gold/Platinum/Ambassador elite members planning city or leisure stays; they expect member rate auto-applied and benefits visible before booking.',
    goal: 'Measure loyalty-member conversion uplift; detect recognition failures at booking',
    task_type: 'pricing',
    agent_count: 10,
    accent: 'violet',
  },
  {
    label: 'Stripe Atlas — Developer onboarding',
    target_url: 'https://stripe.com/atlas',
    audience: 'Solo technical founders building a B2B SaaS, evaluating how to incorporate in the US; budget-sensitive; bootstrapped; 28-42 years old; moderate to high tech savviness.',
    goal: 'Maximize free account creation from qualified developer traffic',
    task_type: 'landing_page',
    agent_count: 10,
  },
  {
    label: 'HubSpot — Pricing page test',
    target_url: 'https://www.hubspot.com/pricing/marketing',
    audience: 'Head of Marketing at 50-500 employee B2B SaaS evaluating marketing automation; comparing vs Marketo, Pardot, ActiveCampaign; concerned about per-contact pricing surprises.',
    goal: 'Drive Professional-tier sign-ups',
    task_type: 'pricing',
    agent_count: 10,
  },
  {
    label: 'Shopify — Merchant signup',
    target_url: 'https://www.shopify.com/free-trial',
    audience: 'Small and mid-market merchants (ecommerce) ready to launch their online store. Mix of first-timers, Etsy graduates, and brands moving from WooCommerce. Mobile-heavy device mix.',
    goal: 'Maximize trial starts across segments',
    task_type: 'onboarding',
    agent_count: 15,
  },
  {
    label: 'Revolut Business — Onboarding',
    target_url: 'https://www.revolut.com/business/',
    audience: 'SME owners in EU and UK, 30-55 years old, moderate tech savviness, concerned about KYC friction and regulatory credibility; currently banking with traditional banks.',
    goal: 'Maximize KYC completions from EU/UK SME segment',
    task_type: 'onboarding',
    agent_count: 10,
  },
  {
    label: 'Atlassian Jira — Feature discovery',
    target_url: 'https://www.atlassian.com/software/jira',
    audience: 'Engineering managers and platform admins at 100-500 employee tech companies currently on Jira Cloud or evaluating migration; skeptical of feature bloat, care about admin UX.',
    goal: 'Drive new-feature adoption awareness',
    task_type: 'feature_validation',
    agent_count: 10,
  },
];

export default function EnterpriseHome() {
  const router = useRouter();
  const [targetUrl, setTargetUrl] = useState('');
  const [audience, setAudience] = useState('');
  const [goal, setGoal] = useState('');
  const [taskType, setTaskType] = useState('');
  const [agentCount, setAgentCount] = useState(10);
  const [industry, setIndustry] = useState('default');
  const [availableIndustries, setAvailableIndustries] = useState([]);
  const [authEnabled, setAuthEnabled] = useState(false);
  const [authSiteSlug, setAuthSiteSlug] = useState('');
  const [authRole, setAuthRole] = useState('');
  const [authLoginUrl, setAuthLoginUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [health, setHealth] = useState(null);

  useEffect(() => {
    apiFetch('/api/enterprise/health').then(r => r.json()).then(setHealth).catch(() => {});
    apiFetch('/api/enterprise/industries').then(r => r.json()).then((d) => setAvailableIndustries(d.industries || [])).catch(() => {});
  }, []);

  const loadPreset = (p) => {
    setTargetUrl(p.target_url);
    setAudience(p.audience);
    setGoal(p.goal);
    setTaskType(p.task_type);
    setAgentCount(p.agent_count);
    setIndustry(p.industry || 'default');
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const body = {
        target_url: targetUrl.trim(),
        audience: audience.trim(),
        agent_count: agentCount,
      };
      if (goal && goal.trim()) body.goal = goal.trim();
      if (taskType) body.task_type = taskType;
      if (industry && industry !== 'default') body.industry = industry;
      if (authEnabled && authSiteSlug) {
        body.auth_config = {
          mode: 'env_credentials',
          site_slug: authSiteSlug,
          role: authRole || undefined,
          login_url: authLoginUrl || undefined,
        };
      }
      const res = await apiFetch('/api/enterprise/simulate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Simulation failed to start');
      }
      const data = await res.json();
      router.push(`/enterprise/run/${data.simulationId}`);
    } catch (err) {
      setError(err.message);
      setLoading(false);
    }
  };

  return (
    <>
      <Head>
        <title>Enterprise Launch Validation — Synthetic Users</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </Head>
      <div className="min-h-screen bg-[#08080e] text-gray-100">

        {/* Nav */}
        <nav className="border-b border-white/5 px-6 py-4">
          <div className="max-w-6xl mx-auto flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center text-white font-bold text-xs">SU</div>
              <span className="font-semibold text-white text-lg">Synthetic Users</span>
              <span className="text-xs px-2 py-0.5 rounded-full bg-violet-500/10 text-violet-300 border border-violet-500/20 ml-1">ENTERPRISE</span>
            </div>
            <div className="flex items-center gap-3 text-xs">
              {health && (
                <>
                  <span className={`px-2 py-1 rounded-full ${health.pg ? 'bg-emerald-500/10 text-emerald-300 border border-emerald-500/20' : 'bg-amber-500/10 text-amber-300 border border-amber-500/20'}`}>PG {health.pg ? 'ok' : 'off'}</span>
                  <span className="px-2 py-1 rounded-full bg-slate-500/10 text-slate-300 border border-slate-500/20">Storage: {health.storage}</span>
                  <span className="px-2 py-1 rounded-full bg-slate-500/10 text-slate-300 border border-slate-500/20">Queue: {health.queue}</span>
                </>
              )}
              <a href="/" className="text-gray-400 hover:text-white">Starter →</a>
            </div>
          </div>
        </nav>

        <main className="max-w-5xl mx-auto px-6 py-10">
          <div className="mb-10">
            <h1 className="text-4xl font-bold text-white mb-3">Pre-launch validation at enterprise scale</h1>
            <p className="text-gray-400 max-w-2xl">Spin up a cohort of synthetic agents with human-like navigation. Each agent opens a real Chromium browser, scrolls, hovers, types, clicks, gets frustrated, and abandons — just like your real users.</p>
          </div>

          {/* Presets */}
          <div className="mb-8">
            <h3 className="text-xs font-semibold text-violet-400 uppercase tracking-widest mb-3">Enterprise demos</h3>
            <div className="grid md:grid-cols-3 gap-3">
              {PRESETS.map((p, i) => (
                <button
                  key={i}
                  onClick={() => loadPreset(p)}
                  className={`text-left bg-surface-800 hover:bg-white/5 border ${p.industry === 'hospitality' ? 'border-violet-500/40' : 'border-white/10'} hover:border-violet-500/60 rounded-xl p-4 transition-all group`}
                >
                  <div className="flex items-center gap-2 mb-1">
                    <div className="text-sm font-semibold text-white group-hover:text-violet-300">{p.label}</div>
                    {p.industry && p.industry !== 'default' && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-violet-500/15 text-violet-300 uppercase tracking-wider">{p.industry}</span>
                    )}
                  </div>
                  <div className="text-xs text-gray-500">{p.target_url}</div>
                  <div className="text-xs text-gray-600 mt-2">{p.agent_count} agents · {p.task_type}</div>
                </button>
              ))}
            </div>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} className="bg-surface-800 border border-white/10 rounded-2xl p-6 space-y-5">
            <div>
              <label className="block text-sm font-semibold text-gray-300 mb-2">Target URL *</label>
              <input
                type="url"
                required
                value={targetUrl}
                onChange={(e) => setTargetUrl(e.target.value)}
                placeholder="https://your-product.com/landing-page"
                className="w-full bg-[#12121c] border border-white/10 rounded-xl px-4 py-3 text-gray-200 placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-violet-500/50"
              />
              <p className="text-xs text-gray-500 mt-1">Agents will start their journey at this URL.</p>
            </div>

            <div>
              <label className="block text-sm font-semibold text-gray-300 mb-2">Target audience *</label>
              <textarea
                required
                value={audience}
                onChange={(e) => setAudience(e.target.value)}
                rows={3}
                placeholder='e.g. "VP of Product at mid-market B2B SaaS (100-500 employees), evaluating analytics tools, skeptical of AI claims, EU-based."'
                className="w-full bg-[#12121c] border border-white/10 rounded-xl px-4 py-3 text-gray-200 placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-violet-500/50 resize-y text-sm"
              />
              <p className="text-xs text-gray-500 mt-1">Be specific — vertical, role, company size, buying stage, geography, concerns.</p>
            </div>

            <div>
              <label className="block text-sm font-semibold text-gray-300 mb-2">Industry pack <span className="text-xs text-gray-500 ml-1">(loads sector-specific archetypes, pain library, and KPIs)</span></label>
              <select value={industry} onChange={(e) => setIndustry(e.target.value)} className="w-full bg-[#12121c] border border-white/10 rounded-xl px-3 py-2.5 text-gray-200 focus:outline-none focus:ring-2 focus:ring-violet-500/50 text-sm">
                <option value="default">Default (SaaS / general)</option>
                {availableIndustries.map((ind) => (
                  <option key={ind.slug} value={ind.slug}>{ind.label}{ind.sub_verticals?.length ? ` — ${ind.sub_verticals.slice(0, 3).join(', ')}` : ''}</option>
                ))}
              </select>
            </div>

            <div className="grid md:grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-semibold text-gray-300 mb-2">Test type</label>
                <select value={taskType} onChange={(e) => setTaskType(e.target.value)} className="w-full bg-[#12121c] border border-white/10 rounded-xl px-3 py-2.5 text-gray-200 focus:outline-none focus:ring-2 focus:ring-violet-500/50 text-sm">
                  <option value="">Auto-detect</option>
                  <option value="landing_page">Landing page</option>
                  <option value="pricing">Pricing</option>
                  <option value="marketing_campaign">Marketing campaign</option>
                  <option value="feature_validation">Feature validation</option>
                  <option value="onboarding">Onboarding</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-300 mb-2">Agent count</label>
                <input
                  type="number"
                  min={1}
                  max={500}
                  value={agentCount}
                  onChange={(e) => setAgentCount(parseInt(e.target.value, 10) || 10)}
                  className="w-full bg-[#12121c] border border-white/10 rounded-xl px-3 py-2.5 text-gray-200 focus:outline-none focus:ring-2 focus:ring-violet-500/50 text-sm"
                />
                <p className="text-xs text-gray-600 mt-1">10-50 for demos · 100-500 for full enterprise runs</p>
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-300 mb-2">Your goal</label>
                <input
                  type="text"
                  value={goal}
                  onChange={(e) => setGoal(e.target.value)}
                  placeholder="e.g. Maximize Pro-tier signups"
                  className="w-full bg-[#12121c] border border-white/10 rounded-xl px-3 py-2.5 text-gray-200 placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-violet-500/50 text-sm"
                />
              </div>
            </div>

            {/* Auth (advanced) */}
            <div className="border-t border-white/10 pt-5">
              <label className="flex items-center gap-2 cursor-pointer mb-3">
                <input type="checkbox" checked={authEnabled} onChange={(e) => setAuthEnabled(e.target.checked)} className="accent-violet-500" />
                <span className="text-sm text-gray-300 font-semibold">Enable authenticated navigation</span>
                <span className="text-xs text-gray-500">(for testing logged-in flows — uses SCRAPE_AUTH_&lt;SLUG&gt; env credentials)</span>
              </label>
              {authEnabled && (
                <div className="grid md:grid-cols-3 gap-3 pl-6">
                  <input type="text" placeholder="Site slug (e.g. CHANNELAD)" value={authSiteSlug} onChange={(e) => setAuthSiteSlug(e.target.value)} className="bg-[#12121c] border border-white/10 rounded-xl px-3 py-2 text-gray-200 text-sm" />
                  <input type="text" placeholder="Role (optional)" value={authRole} onChange={(e) => setAuthRole(e.target.value)} className="bg-[#12121c] border border-white/10 rounded-xl px-3 py-2 text-gray-200 text-sm" />
                  <input type="url" placeholder="Login URL" value={authLoginUrl} onChange={(e) => setAuthLoginUrl(e.target.value)} className="bg-[#12121c] border border-white/10 rounded-xl px-3 py-2 text-gray-200 text-sm" />
                </div>
              )}
            </div>

            {error && (
              <div className="bg-red-900/20 border border-red-500/30 rounded-xl p-4 text-red-300 text-sm">{error}</div>
            )}

            <button type="submit" disabled={loading || !targetUrl || !audience} className="w-full bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold py-4 rounded-xl transition-all shadow-lg shadow-violet-900/30">
              {loading ? 'Launching enterprise simulation...' : `Launch ${agentCount} agents on Playwright →`}
            </button>
            <p className="text-center text-xs text-gray-600">Estimated time: ~{Math.ceil(agentCount * 0.75)}-{Math.ceil(agentCount * 1.5)} minutes · Real Chromium browser per agent · Full evidence capture</p>
          </form>
        </main>
      </div>
    </>
  );
}
