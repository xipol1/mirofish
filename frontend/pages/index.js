import { useState, useRef, useEffect } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';

const API_URL = process.env.NEXT_PUBLIC_API_URL || (typeof window !== 'undefined' && window.location.hostname !== 'localhost' ? '' : 'http://localhost:5001');

function apiFetch(path, options = {}) {
  const headers = { ...options.headers, 'bypass-tunnel-reminder': 'true' };
  return fetch(`${API_URL}${path}`, { ...options, headers });
}

const EXAMPLE_CONTENT = `Hero: "ProjectFlow — Ship products faster"
Subheadline: "The modern project management tool for agile teams"
CTA: "Start Free Trial"

Features:
- Sprint Planning: Drag-and-drop sprint boards with automated velocity tracking
- Roadmap View: Real-time product roadmap that syncs with your sprints
- Team Analytics: See who's blocked, what's on track, and where to focus
- Integrations: Connect with GitHub, Slack, Figma, and 50+ tools

Pricing:
- Starter: $0/month — Up to 5 users, basic boards, 1 project
- Pro: $12/user/month — Unlimited projects, roadmaps, analytics, integrations
- Enterprise: $29/user/month — SSO, audit logs, priority support, custom fields

Social Proof: None visible
Trust Signals: "14-day free trial, no credit card required"
Footer: Standard links, no testimonials or case studies`;

const EXAMPLE_AUDIENCE = 'Product managers and engineering leads at B2B SaaS companies with 20-200 employees, evaluating project management tools to replace Jira or spreadsheets';

/* ============================================================
   LANDING PAGE — Synthetic Users Platform
   ============================================================ */

export default function Home() {
  const router = useRouter();
  const formRef = useRef(null);
  const [content, setContent] = useState('');
  const [audience, setAudience] = useState('');
  const [goal, setGoal] = useState('');
  const [taskType, setTaskType] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [config, setConfig] = useState(null);
  const [agentCount, setAgentCount] = useState(25);

  useEffect(() => {
    apiFetch('/api/config').then(r => r.json()).then((c) => {
      setConfig(c);
      if (c?.agents) setAgentCount(c.agents);
    }).catch(() => {});
  }, []);

  const isDemo = config?.mode === 'demo';

  const scrollToForm = () => {
    formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const body = { audience };
      const trimmed = content.trim();
      if (/^https?:\/\//i.test(trimmed) && !trimmed.includes('\n')) {
        body.url = trimmed;
      } else {
        body.content = content;
      }
      if (goal && goal.trim()) body.goal = goal.trim();
      if (taskType) body.taskType = taskType;
      if (Number.isFinite(agentCount) && agentCount > 0) body.agentCount = agentCount;

      const res = await apiFetch('/api/simulate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Simulation failed to start');
      }
      const data = await res.json();
      router.push(`/results/${data.simulationId}`);
    } catch (err) {
      setError(err.message);
      setLoading(false);
    }
  };

  const loadExample = () => {
    setContent(EXAMPLE_CONTENT);
    setAudience(EXAMPLE_AUDIENCE);
  };

  return (
    <>
      <Head>
        <title>Synthetic Users — Test your product on simulated users before you launch</title>
        <meta name="description" content="Simulate 25 realistic users on your landing page. Get specific, actionable recommendations in 60 seconds. Stop guessing, start knowing." />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </Head>

      <div className="min-h-screen bg-[#08080e] text-gray-100 antialiased">

        {/* ─── NAV ─── */}
        <nav className="fixed top-0 w-full z-50 border-b border-white/5 bg-[#08080e]/80 backdrop-blur-xl">
          <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center text-white font-bold text-xs">SU</div>
              <span className="font-semibold text-white text-lg tracking-tight">Synthetic Users</span>
            </div>
            <div className="hidden md:flex items-center gap-8 text-sm text-gray-400">
              <a href="#how" className="hover:text-white transition-colors">How it works</a>
              <a href="#use-cases" className="hover:text-white transition-colors">Use cases</a>
              <a href="#pricing" className="hover:text-white transition-colors">Pricing</a>
            </div>
            <button onClick={scrollToForm} className="bg-white text-black text-sm font-semibold px-4 py-2 rounded-lg hover:bg-gray-200 transition-colors">
              Try free
            </button>
          </div>
        </nav>

        {/* ─── HERO ─── */}
        <section className="relative pt-32 pb-20 md:pt-44 md:pb-32 overflow-hidden">
          {/* Glow */}
          <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[600px] bg-gradient-to-b from-violet-600/20 via-indigo-600/10 to-transparent rounded-full blur-3xl pointer-events-none" />

          <div className="relative max-w-4xl mx-auto px-6 text-center">
            <div className="inline-flex items-center gap-2 border border-violet-500/30 bg-violet-500/10 rounded-full px-4 py-1.5 text-sm text-violet-300 mb-8">
              <span className="w-1.5 h-1.5 rounded-full bg-violet-400 animate-pulse" />
              {isDemo ? `Demo mode \u2014 ${agentCount} free agents via Ollama` : 'Now in public beta'}
            </div>

            <h1 className="text-5xl md:text-7xl font-extrabold tracking-tight text-white leading-[1.08] mb-6">
              Your next launch<br />
              <span className="bg-gradient-to-r from-violet-400 via-indigo-400 to-cyan-400 bg-clip-text text-transparent">
                doesn&apos;t have to be a guess
              </span>
            </h1>

            <p className="text-lg md:text-xl text-gray-400 max-w-2xl mx-auto mb-10 leading-relaxed">
              Simulate <strong className="text-white">{agentCount} realistic users</strong> on your landing page, pricing, or feature.
              Get exact recommendations you can act on.{isDemo ? '' : <> In <strong className="text-white">60 seconds</strong>.</>}
            </p>

            <div className="flex flex-col sm:flex-row items-center justify-center gap-4 mb-6">
              <button onClick={scrollToForm} className="group bg-white text-black font-semibold px-8 py-4 rounded-xl text-base hover:bg-gray-100 transition-all shadow-lg shadow-white/10 hover:shadow-white/20">
                Test your landing page free
                <span className="ml-2 inline-block group-hover:translate-x-0.5 transition-transform">&rarr;</span>
              </button>
              <a href="#demo" className="text-gray-400 hover:text-white text-sm transition-colors underline underline-offset-4 decoration-gray-700 hover:decoration-gray-400">
                See example results
              </a>
            </div>
            <p className="text-xs text-gray-600">3 free simulations. No credit card. No signup.</p>

            {/* Hero visual — fake dashboard */}
            <div className="mt-16 relative mx-auto max-w-3xl">
              <div className="absolute -inset-4 bg-gradient-to-b from-violet-600/20 to-transparent rounded-3xl blur-2xl pointer-events-none" />
              <div className="relative bg-[#0f0f18] border border-white/10 rounded-2xl p-6 md:p-8 shadow-2xl">
                <div className="flex items-center gap-2 mb-6">
                  <div className="w-3 h-3 rounded-full bg-red-500/60" />
                  <div className="w-3 h-3 rounded-full bg-yellow-500/60" />
                  <div className="w-3 h-3 rounded-full bg-green-500/60" />
                  <span className="ml-3 text-xs text-gray-600">Synthetic Users — Simulation Results</span>
                </div>

                {/* Fake headline insight */}
                <div className="bg-violet-500/10 border border-violet-500/20 rounded-xl p-4 mb-5">
                  <p className="text-xs text-violet-400 font-medium mb-1">KEY FINDING</p>
                  <p className="text-white font-semibold text-sm md:text-base">19 of 25 users bounced because they couldn&apos;t find pricing within 8 seconds.</p>
                </div>

                {/* Fake outcome bar */}
                <div className="flex gap-3 mb-5">
                  <div className="flex-1 bg-[#111119] rounded-lg p-3 text-center">
                    <div className="text-2xl font-bold text-emerald-400">6</div>
                    <div className="text-[10px] text-gray-500">Converted</div>
                  </div>
                  <div className="flex-1 bg-[#111119] rounded-lg p-3 text-center">
                    <div className="text-2xl font-bold text-red-400">19</div>
                    <div className="text-[10px] text-gray-500">Bounced</div>
                  </div>
                  <div className="flex-1 bg-[#111119] rounded-lg p-3 text-center">
                    <div className="text-2xl font-bold text-amber-400">0</div>
                    <div className="text-[10px] text-gray-500">Interested</div>
                  </div>
                </div>

                {/* Fake recommendation */}
                <div className="bg-[#111119] border border-white/5 rounded-xl p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="bg-emerald-500/20 text-emerald-400 text-[10px] font-bold px-2 py-0.5 rounded-full">HIGH CONFIDENCE</span>
                    <span className="text-[10px] text-gray-600">91% confidence</span>
                  </div>
                  <p className="text-white text-sm font-medium mb-1">Move pricing to the hero section</p>
                  <p className="text-gray-500 text-xs">19 of 25 users looked for pricing before engaging with features. Expected impact: +22-30% conversion.</p>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ─── TRUST BAR ─── */}
        <section className="border-y border-white/5 py-8">
          <div className="max-w-4xl mx-auto px-6 flex flex-wrap items-center justify-center gap-x-10 gap-y-4 text-sm text-gray-500">
            <span className="flex items-center gap-2"><CheckCircle />60-second results</span>
            <span className="flex items-center gap-2"><CheckCircle />No code required</span>
            <span className="flex items-center gap-2"><CheckCircle />25 diverse user profiles</span>
            <span className="flex items-center gap-2"><CheckCircle />Actionable recommendations</span>
          </div>
        </section>

        {/* ─── HOW IT WORKS ─── */}
        <section id="how" className="py-24 md:py-32">
          <div className="max-w-5xl mx-auto px-6">
            <SectionLabel>How it works</SectionLabel>
            <h2 className="text-3xl md:text-4xl font-bold text-white text-center mb-4">From zero feedback to clear decisions.</h2>
            <p className="text-gray-500 text-center max-w-xl mx-auto mb-16">Three steps. Under two minutes. No research team required.</p>

            <div className="grid md:grid-cols-3 gap-8">
              <StepCard
                step="01"
                title="Paste your content"
                desc="Drop in your landing page copy, pricing tiers, or feature description. Plain text works. No URL required."
              />
              <StepCard
                step="02"
                title="Describe your audience"
                desc='One sentence: "B2B SaaS founders, bootstrapped, pre-PMF." We generate 25 diverse users that match.'
              />
              <StepCard
                step="03"
                title="Get recommendations"
                desc="Each synthetic user evaluates your page independently. You get ranked actions with confidence levels."
              />
            </div>
          </div>
        </section>

        {/* ─── DEMO / RESULTS ─── */}
        <section id="demo" className="py-24 md:py-32 bg-[#0b0b14]">
          <div className="max-w-5xl mx-auto px-6">
            <SectionLabel>Real output</SectionLabel>
            <h2 className="text-3xl md:text-4xl font-bold text-white text-center mb-4">This is what you get. Not a dashboard. Decisions.</h2>
            <p className="text-gray-500 text-center max-w-xl mx-auto mb-16">Actual simulation output from a SaaS landing page test.</p>

            <div className="grid md:grid-cols-2 gap-8">
              {/* Left — insight + metric */}
              <div className="space-y-5">
                <div className="bg-[#12121c] border border-white/5 rounded-xl p-5">
                  <p className="text-xs text-violet-400 font-semibold mb-2 uppercase tracking-wider">Headline Insight</p>
                  <p className="text-white font-semibold leading-relaxed">
                    &quot;64% of simulated users bounced. The primary blocker was not price &mdash; it was trust. Zero social proof on the page.&quot;
                  </p>
                </div>

                <div className="bg-[#12121c] border border-white/5 rounded-xl p-5">
                  <p className="text-xs text-red-400 font-semibold mb-3 uppercase tracking-wider">Top Friction Point</p>
                  <div className="flex items-center gap-3">
                    <div className="w-12 h-12 rounded-lg bg-red-500/10 flex items-center justify-center text-red-400 font-bold text-lg shrink-0">16</div>
                    <div>
                      <p className="text-white text-sm font-medium">users looked for testimonials and found none</p>
                      <p className="text-gray-500 text-xs mt-0.5">Blocks conversion for 64% of the audience</p>
                    </div>
                  </div>
                </div>

                <div className="bg-[#12121c] border border-white/5 rounded-xl p-5">
                  <p className="text-xs text-amber-400 font-semibold mb-3 uppercase tracking-wider">Segment Divergence</p>
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between"><span className="text-gray-400">Founders (budget holders)</span><span className="text-emerald-400 font-medium">52% converted</span></div>
                    <div className="flex justify-between"><span className="text-gray-400">Product managers</span><span className="text-red-400 font-medium">24% converted</span></div>
                    <div className="flex justify-between"><span className="text-gray-400">Technical evaluators</span><span className="text-amber-400 font-medium">33% converted</span></div>
                  </div>
                </div>
              </div>

              {/* Right — recommendations */}
              <div className="space-y-4">
                <RecCard
                  n={1}
                  confidence="92%"
                  color="emerald"
                  action="Add 3 customer logos and one testimonial above the fold"
                  evidence="16 of 25 users searched for social proof. 0 found any."
                  impact="+18-25% conversion"
                />
                <RecCard
                  n={2}
                  confidence="84%"
                  color="emerald"
                  action='Change hero headline from "Modern solution" to a specific pain point'
                  evidence="21 of 25 users skipped the hero. Perceived as generic."
                  impact="+12-18% conversion"
                />
                <RecCard
                  n={3}
                  confidence="78%"
                  color="amber"
                  action="Reduce pricing from 3 tiers to 2"
                  evidence="12 users experienced choice paralysis. Pro and Enterprise overlap 80%."
                  impact="+8-14% conversion"
                />
              </div>
            </div>
          </div>
        </section>

        {/* ─── BEFORE / AFTER ─── */}
        <section className="py-24 md:py-32">
          <div className="max-w-5xl mx-auto px-6">
            <SectionLabel>Value</SectionLabel>
            <h2 className="text-3xl md:text-4xl font-bold text-white text-center mb-16">The gap between guessing and knowing</h2>

            <div className="grid md:grid-cols-2 gap-6">
              <div className="bg-[#12121c] border border-red-500/10 rounded-2xl p-8">
                <p className="text-red-400 font-semibold text-sm mb-5 uppercase tracking-wider">Without Synthetic Users</p>
                <ul className="space-y-4">
                  <BeforeItem text="You launch and hope the copy works" />
                  <BeforeItem text="Pricing is based on competitor Googling" />
                  <BeforeItem text='Feature roadmap is based on "gut feel"' />
                  <BeforeItem text="You find out what's broken after losing users" />
                  <BeforeItem text="User research takes 2-4 weeks and $5K+" />
                </ul>
              </div>
              <div className="bg-[#12121c] border border-emerald-500/10 rounded-2xl p-8">
                <p className="text-emerald-400 font-semibold text-sm mb-5 uppercase tracking-wider">With Synthetic Users</p>
                <ul className="space-y-4">
                  <AfterItem text="You know which headline converts before going live" />
                  <AfterItem text="Pricing validated against 25 realistic buyer profiles" />
                  <AfterItem text="Feature prioritized by simulated adoption rate" />
                  <AfterItem text="Friction points identified with exact root causes" />
                  <AfterItem text="60 seconds. $0 for your first 3 tests" />
                </ul>
              </div>
            </div>
          </div>
        </section>

        {/* ─── USE CASES ─── */}
        <section id="use-cases" className="py-24 md:py-32 bg-[#0b0b14]">
          <div className="max-w-5xl mx-auto px-6">
            <SectionLabel>Use cases</SectionLabel>
            <h2 className="text-3xl md:text-4xl font-bold text-white text-center mb-4">Test anything that touches a user decision</h2>
            <p className="text-gray-500 text-center max-w-xl mx-auto mb-16">Every mode simulates how real users think, react, and decide.</p>

            <div className="grid md:grid-cols-3 gap-6">
              <UseCaseCard
                icon={<IconPage />}
                title="Landing Page Testing"
                desc="Find out why visitors bounce. Get specific copy, layout, and trust signal recommendations."
                metric="Avg. finding: 3.2 friction points per page"
              />
              <UseCaseCard
                icon={<IconDollar />}
                title="Pricing Validation"
                desc="Test willingness to pay, tier selection patterns, and price sensitivity by segment."
                metric="Avg. finding: 1 tier is always wrong"
              />
              <UseCaseCard
                icon={<IconLightning />}
                title="Feature Validation"
                desc='Simulate adoption before building. Know if users would switch from their current solution.'
                metric='Avg. finding: 40% of features don&apos;t solve the stated pain'
              />
            </div>
          </div>
        </section>

        {/* ─── WHY NOT ALTERNATIVES ─── */}
        <section className="py-24 md:py-32">
          <div className="max-w-4xl mx-auto px-6">
            <SectionLabel>Comparison</SectionLabel>
            <h2 className="text-3xl md:text-4xl font-bold text-white text-center mb-16">The old ways are slow, expensive, or random</h2>

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-white/10">
                    <th className="text-left py-4 pr-8 text-gray-500 font-medium" />
                    <th className="text-center py-4 px-4 text-gray-500 font-medium">User Research</th>
                    <th className="text-center py-4 px-4 text-gray-500 font-medium">A/B Testing</th>
                    <th className="text-center py-4 px-4 text-gray-500 font-medium">Guessing</th>
                    <th className="text-center py-4 px-4">
                      <span className="text-violet-400 font-bold">Synthetic Users</span>
                    </th>
                  </tr>
                </thead>
                <tbody className="text-gray-400">
                  <CompRow label="Time to insight" vals={['2-4 weeks', '1-4 weeks', 'Instant', <span key="su" className="text-white font-semibold">60 seconds</span>]} />
                  <CompRow label="Cost" vals={['$5K-20K', '$500+/mo tools', '$0', <span key="su" className="text-white font-semibold">Free to start</span>]} />
                  <CompRow label="Requires live traffic" vals={['No', 'Yes', 'No', <span key="su" className="text-white font-semibold">No</span>]} />
                  <CompRow label="Works pre-launch" vals={['Sort of', 'No', 'Yes (badly)', <span key="su" className="text-white font-semibold">Yes</span>]} />
                  <CompRow label="Explains why users leave" vals={['Yes', 'No', 'No', <span key="su" className="text-white font-semibold">Yes, per user</span>]} />
                  <CompRow label="Gives specific actions" vals={['Sometimes', 'No', 'No', <span key="su" className="text-white font-semibold">Ranked list</span>]} />
                </tbody>
              </table>
            </div>
          </div>
        </section>

        {/* ─── PRICING ─── */}
        <section id="pricing" className="py-24 md:py-32 bg-[#0b0b14]">
          <div className="max-w-5xl mx-auto px-6">
            <SectionLabel>Pricing</SectionLabel>
            <h2 className="text-3xl md:text-4xl font-bold text-white text-center mb-4">One bad launch costs more than a year of this</h2>
            <p className="text-gray-500 text-center max-w-xl mx-auto mb-16">Start free. Upgrade when it saves you money.</p>

            <div className="grid md:grid-cols-3 gap-6 max-w-4xl mx-auto">
              <PricingCard
                name="Starter"
                price="0"
                period=""
                desc="See if it works for you"
                features={['3 simulations / month', '25 users per simulation', 'Landing page mode', 'Top recommendation only']}
                cta="Start free"
                onCta={scrollToForm}
              />
              <PricingCard
                name="Growth"
                price="149"
                period="/mo"
                desc="For founders shipping weekly"
                features={['30 simulations / month', '50 users per simulation', 'All modes (pricing, features, onboarding)', 'Full recommendations + alternatives', 'Re-test with changes', 'Unlimited history']}
                cta="Start free trial"
                featured
                onCta={scrollToForm}
              />
              <PricingCard
                name="Scale"
                price="499"
                period="/mo"
                desc="For growth teams running experiments"
                features={['Unlimited simulations', '200 users per simulation', 'Comparative A/B simulations', 'CRM data integration', 'Priority processing', 'API access']}
                cta="Contact us"
                onCta={scrollToForm}
              />
            </div>
          </div>
        </section>

        {/* ─── SIMULATION FORM ─── */}
        <section id="simulate" ref={formRef} className="py-24 md:py-32">
          <div className="max-w-2xl mx-auto px-6">
            <div className="text-center mb-10">
              <h2 className="text-3xl md:text-4xl font-bold text-white mb-3">Run your first simulation</h2>
              <p className="text-gray-500">Paste your landing page. Describe your audience. Get answers.</p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-5">
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-sm font-medium text-gray-300">Landing page content</label>
                  <button type="button" onClick={loadExample} className="text-xs text-violet-400 hover:text-white transition-colors">Load example</button>
                </div>
                <textarea
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  placeholder="Paste your landing page text here. Include headline, features, pricing, CTAs, and social proof."
                  rows={8}
                  required
                  className="w-full bg-[#12121c] border border-white/10 rounded-xl px-4 py-3 text-gray-200 placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-violet-500/50 focus:border-violet-500/50 resize-y text-sm font-mono"
                />
              </div>

              <div>
                <label className="text-sm font-medium text-gray-300 mb-2 block">Target audience</label>
                <textarea
                  value={audience}
                  onChange={(e) => setAudience(e.target.value)}
                  placeholder='e.g. "SaaS founders, bootstrapped, 10-50 employees, evaluating analytics tools"'
                  rows={3}
                  required
                  className="w-full bg-[#12121c] border border-white/10 rounded-xl px-4 py-3 text-gray-200 placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-violet-500/50 focus:border-violet-500/50 resize-y text-sm"
                />
              </div>

              <div className="grid md:grid-cols-2 gap-4">
                <div>
                  <label className="text-sm font-medium text-gray-300 mb-2 block">
                    Test type <span className="text-gray-600 text-xs">(optional — auto-detected)</span>
                  </label>
                  <select
                    value={taskType}
                    onChange={(e) => setTaskType(e.target.value)}
                    className="w-full bg-[#12121c] border border-white/10 rounded-xl px-4 py-3 text-gray-200 focus:outline-none focus:ring-2 focus:ring-violet-500/50 text-sm"
                  >
                    <option value="">Auto-detect</option>
                    <option value="landing_page">Landing page</option>
                    <option value="pricing">Pricing strategy</option>
                    <option value="marketing_campaign">Marketing campaign</option>
                    <option value="feature_validation">Feature validation</option>
                    <option value="onboarding">Onboarding flow</option>
                  </select>
                </div>
                <div>
                  <label className="text-sm font-medium text-gray-300 mb-2 block">
                    Your goal <span className="text-gray-600 text-xs">(optional)</span>
                  </label>
                  <input
                    type="text"
                    value={goal}
                    onChange={(e) => setGoal(e.target.value)}
                    placeholder="e.g. Maximize signups / validate pricing / etc."
                    className="w-full bg-[#12121c] border border-white/10 rounded-xl px-4 py-3 text-gray-200 placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-violet-500/50 text-sm"
                  />
                </div>
              </div>

              <div>
                <label className="text-sm font-medium text-gray-300 mb-2 block">
                  Number of synthetic users <span className="text-gray-600 text-xs">(1–200 · fewer = faster)</span>
                </label>
                <div className="flex items-center gap-4">
                  <input
                    type="range"
                    min={1}
                    max={200}
                    step={1}
                    value={agentCount}
                    onChange={(e) => setAgentCount(parseInt(e.target.value, 10))}
                    className="flex-1 accent-violet-500"
                  />
                  <input
                    type="number"
                    min={1}
                    max={200}
                    value={agentCount}
                    onChange={(e) => {
                      const v = parseInt(e.target.value, 10);
                      if (Number.isFinite(v)) setAgentCount(Math.max(1, Math.min(200, v)));
                    }}
                    className="w-20 bg-[#12121c] border border-white/10 rounded-xl px-3 py-2 text-gray-200 focus:outline-none focus:ring-2 focus:ring-violet-500/50 text-sm text-center"
                  />
                </div>
              </div>

              {error && (
                <div className="bg-red-900/20 border border-red-500/20 rounded-xl px-4 py-3 text-red-400 text-sm">{error}</div>
              )}

              <button
                type="submit"
                disabled={loading || !content.trim() || !audience.trim()}
                className="w-full bg-white text-black font-semibold py-4 px-6 rounded-xl text-base hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed transition-all shadow-lg shadow-white/10"
              >
                {loading ? (
                  <span className="flex items-center justify-center gap-2">
                    <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>
                    Launching {agentCount} synthetic users...
                  </span>
                ) : `Run Simulation \u2014 ${agentCount} Synthetic Users${isDemo ? ' (Free Demo)' : ''}`}
              </button>
              <p className="text-center text-xs text-gray-600">
                {isDemo ? `Demo mode: ${agentCount} agents via Ollama (local). May take 2-3 minutes.` : 'Takes 60-90 seconds. Each user evaluates your page independently.'}
              </p>
            </form>
          </div>
        </section>

        {/* ─── FINAL CTA ─── */}
        <section className="py-24 md:py-32 bg-[#0b0b14] relative overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-b from-violet-600/5 to-transparent pointer-events-none" />
          <div className="relative max-w-3xl mx-auto px-6 text-center">
            <h2 className="text-4xl md:text-5xl font-extrabold text-white mb-6 tracking-tight">
              Every day you launch without data,<br />
              <span className="bg-gradient-to-r from-violet-400 to-indigo-400 bg-clip-text text-transparent">you leave money on the table.</span>
            </h2>
            <p className="text-gray-400 text-lg mb-10 max-w-lg mx-auto">
              Your competitors are guessing too. But the first one to stop guessing wins.
            </p>
            <button onClick={scrollToForm} className="bg-white text-black font-semibold px-10 py-4 rounded-xl text-base hover:bg-gray-100 transition-all shadow-lg shadow-white/10 hover:shadow-white/20">
              Test your landing page now &rarr;
            </button>
            <p className="mt-4 text-xs text-gray-600">Free. No signup. 60 seconds to your first insight.</p>
          </div>
        </section>

        {/* ─── FOOTER ─── */}
        <footer className="border-t border-white/5 py-10">
          <div className="max-w-6xl mx-auto px-6 flex flex-col md:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-2.5">
              <div className="w-6 h-6 rounded-md bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center text-white font-bold text-[9px]">SU</div>
              <span className="text-gray-500 text-sm">Synthetic Users &copy; 2026</span>
            </div>
            <p className="text-gray-600 text-xs">Talk to your users before they exist.</p>
          </div>
        </footer>
      </div>
    </>
  );
}


/* ============================================================
   COMPONENTS
   ============================================================ */

function SectionLabel({ children }) {
  return <p className="text-xs font-semibold text-violet-400 uppercase tracking-widest text-center mb-3">{children}</p>;
}

function CheckCircle() {
  return (
    <svg className="w-4 h-4 text-violet-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
    </svg>
  );
}

function StepCard({ step, title, desc }) {
  return (
    <div className="bg-[#12121c] border border-white/5 rounded-2xl p-7 hover:border-violet-500/20 transition-colors">
      <div className="text-4xl font-extrabold text-violet-500/20 mb-4">{step}</div>
      <h3 className="text-white font-semibold text-lg mb-2">{title}</h3>
      <p className="text-gray-500 text-sm leading-relaxed">{desc}</p>
    </div>
  );
}

function RecCard({ n, confidence, color, action, evidence, impact }) {
  const colorMap = {
    emerald: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/10',
    amber: 'bg-amber-500/15 text-amber-400 border-amber-500/10',
  };
  return (
    <div className={`border rounded-xl p-5 ${colorMap[color] || colorMap.emerald}`}>
      <div className="flex items-center gap-2 mb-2">
        <span className="text-xs font-bold bg-black/20 px-2 py-0.5 rounded-full">#{n}</span>
        <span className="text-xs opacity-70">{confidence} confidence</span>
      </div>
      <p className="text-white text-sm font-semibold mb-1.5">{action}</p>
      <p className="text-xs opacity-70 mb-2">{evidence}</p>
      <p className="text-xs font-medium">Expected: {impact}</p>
    </div>
  );
}

function BeforeItem({ text }) {
  return (
    <li className="flex items-start gap-3 text-gray-400 text-sm">
      <span className="text-red-500 mt-0.5 shrink-0">&times;</span>
      {text}
    </li>
  );
}

function AfterItem({ text }) {
  return (
    <li className="flex items-start gap-3 text-gray-300 text-sm">
      <span className="text-emerald-400 mt-0.5 shrink-0">&#10003;</span>
      {text}
    </li>
  );
}

function CompRow({ label, vals }) {
  return (
    <tr className="border-b border-white/5">
      <td className="py-3 pr-8 text-gray-300 font-medium">{label}</td>
      {vals.map((v, i) => <td key={i} className="py-3 px-4 text-center">{v}</td>)}
    </tr>
  );
}

function UseCaseCard({ icon, title, desc, metric }) {
  return (
    <div className="bg-[#12121c] border border-white/5 rounded-2xl p-7 hover:border-violet-500/20 transition-colors group">
      <div className="w-10 h-10 rounded-xl bg-violet-500/10 flex items-center justify-center text-violet-400 mb-5 group-hover:bg-violet-500/20 transition-colors">{icon}</div>
      <h3 className="text-white font-semibold text-lg mb-2">{title}</h3>
      <p className="text-gray-500 text-sm leading-relaxed mb-4">{desc}</p>
      <p className="text-xs text-violet-400/80">{metric}</p>
    </div>
  );
}

function PricingCard({ name, price, period, desc, features, cta, featured, onCta }) {
  return (
    <div className={`rounded-2xl p-7 flex flex-col ${featured ? 'bg-gradient-to-b from-violet-600/20 to-[#12121c] border-2 border-violet-500/30 ring-1 ring-violet-500/10 relative' : 'bg-[#12121c] border border-white/5'}`}>
      {featured && <span className="absolute -top-3 left-1/2 -translate-x-1/2 bg-violet-500 text-white text-xs font-bold px-3 py-1 rounded-full">Most Popular</span>}
      <p className="text-white font-semibold text-lg mb-1">{name}</p>
      <p className="text-gray-500 text-xs mb-5">{desc}</p>
      <div className="mb-6">
        <span className="text-4xl font-extrabold text-white">${price}</span>
        <span className="text-gray-500 text-sm">{period}</span>
      </div>
      <ul className="space-y-2.5 mb-8 flex-1">
        {features.map((f, i) => (
          <li key={i} className="flex items-start gap-2 text-sm text-gray-400">
            <svg className="w-4 h-4 text-violet-400 mt-0.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
            {f}
          </li>
        ))}
      </ul>
      <button onClick={onCta} className={`w-full py-3 rounded-xl font-semibold text-sm transition-all ${featured ? 'bg-white text-black hover:bg-gray-100 shadow-lg shadow-white/10' : 'bg-white/5 text-white hover:bg-white/10 border border-white/10'}`}>
        {cta}
      </button>
    </div>
  );
}

function IconPage() {
  return <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" /></svg>;
}

function IconDollar() {
  return <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M12 6v12m-3-2.818l.879.659c1.171.879 3.07.879 4.242 0 1.172-.879 1.172-2.303 0-3.182C13.536 12.219 12.768 12 12 12c-.725 0-1.45-.22-2.003-.659-1.106-.879-1.106-2.303 0-3.182s2.9-.879 4.006 0l.415.33M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>;
}

function IconLightning() {
  return <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z" /></svg>;
}
