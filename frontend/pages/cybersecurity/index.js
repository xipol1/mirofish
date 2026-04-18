import { useState, useEffect, useRef, useMemo } from 'react';
import Head from 'next/head';
import { runDemoSimulation } from '../../lib/cybersecurity/demo-engine';

const PRESETS = [
  {
    label: 'MiroFish — Self-assessment',
    target_url: 'https://mirofish.io',
    description: 'Run the swarm against our own public surface. Best for showing the product on our site.',
  },
  {
    label: 'Meliá — Booking surface audit',
    target_url: 'https://www.melia.com/',
    description: '500 adversaries probe the booking funnel: credential stuffing, rate-limit, OAuth redirect, PCI-adjacent findings.',
  },
  {
    label: 'Revolut Business — Onboarding',
    target_url: 'https://www.revolut.com/business/',
    description: 'KYC surface + OAuth + JWT audit for a fintech-style target.',
  },
  {
    label: 'Generic SaaS — example.com',
    target_url: 'https://example.com',
    description: 'Neutral target for a quick pitch demo.',
  },
];

const PERSONA_STATIC = [
  { id: 'script_kiddie', label: 'Script Kiddie', color: '#fb7185', share: '30%' },
  { id: 'bug_bounty', label: 'Bug Bounty Hunter', color: '#f59e0b', share: '15%' },
  { id: 'botnet_fraud', label: 'Botnet / Fraud', color: '#ef4444', share: '15%' },
  { id: 'insider', label: 'Insider Threat', color: '#a855f7', share: '10%' },
  { id: 'apt', label: 'APT / Nation-State', color: '#dc2626', share: '10%' },
  { id: 'scanner', label: 'Automated Scanner', color: '#0ea5e9', share: '10%' },
  { id: 'supply_chain', label: 'Supply-Chain', color: '#22c55e', share: '5%' },
  { id: 'social_engineer', label: 'Social Engineer', color: '#ec4899', share: '5%' },
];

const PHASE_LABELS = {
  starting: 'Initializing swarm',
  recon: 'Reconnaissance',
  swarm_deploy: 'Deploying adversary agents',
  attacking: 'Swarm attacking',
  aggregating: 'Scoring findings',
  done: 'Complete',
};

const SEVERITY_STYLE = {
  critical: { bg: 'bg-red-600/20', text: 'text-red-300', border: 'border-red-500/40', dot: '#dc2626', label: 'CRIT' },
  high:     { bg: 'bg-orange-500/20', text: 'text-orange-300', border: 'border-orange-500/40', dot: '#f97316', label: 'HIGH' },
  medium:   { bg: 'bg-amber-500/15', text: 'text-amber-300', border: 'border-amber-500/30', dot: '#f59e0b', label: 'MED' },
  low:      { bg: 'bg-sky-500/10', text: 'text-sky-300', border: 'border-sky-500/30', dot: '#0ea5e9', label: 'LOW' },
  info:     { bg: 'bg-slate-500/10', text: 'text-slate-300', border: 'border-slate-500/20', dot: '#94a3b8', label: 'INFO' },
};

export default function CyberHome() {
  const [view, setView] = useState('form'); // 'form' | 'running' | 'completed'
  const [targetUrl, setTargetUrl] = useState('');
  const [agentCount, setAgentCount] = useState(500);
  const [error, setError] = useState(null);

  // Run state (lives here — no routing)
  const [findings, setFindings] = useState([]);
  const [phase, setPhase] = useState('starting');
  const [elapsed, setElapsed] = useState(0);
  const [result, setResult] = useState(null);
  const [target, setTarget] = useState(null);
  const [selectedFinding, setSelectedFinding] = useState(null);

  // Wall-clock timer while running
  useEffect(() => {
    if (view !== 'running') return;
    const iv = setInterval(() => setElapsed(e => e + 1), 1000);
    return () => clearInterval(iv);
  }, [view]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    try {
      const url = targetUrl.trim();
      try { new URL(url); } catch { throw new Error('Target URL must be a valid URL'); }

      // Reset state & enter running view
      setFindings([]);
      setPhase('starting');
      setElapsed(0);
      setResult(null);
      setTarget({ url, host: new URL(url).hostname });
      setSelectedFinding(null);
      setView('running');

      const localFindings = [];
      runDemoSimulation({
        targetUrl: url,
        totalAgents: agentCount,
        durationMs: 75000,
        onEvent: (ev) => {
          if (ev.phase) setPhase(ev.phase);
          if (ev.type === 'finding' && ev.payload) {
            localFindings.push(ev.payload);
            setFindings([...localFindings]);
          }
        },
      })
        .then((res) => {
          if (!res) return;
          setResult(res);
          setView('completed');
        })
        .catch((err) => {
          setError('Run failed: ' + err.message);
          setView('form');
        });
    } catch (err) {
      setError(err.message);
    }
  };

  const reset = () => {
    setView('form');
    setFindings([]);
    setResult(null);
    setTarget(null);
    setElapsed(0);
    setSelectedFinding(null);
  };

  return (
    <>
      <Head>
        <title>Cyber Swarm — Synthetic Users</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </Head>
      <div className="min-h-screen bg-[#08080e] text-gray-100 relative overflow-hidden">
        <div className="absolute inset-0 opacity-[0.06] pointer-events-none"
             style={{ backgroundImage: 'linear-gradient(rgba(239,68,68,.4) 1px, transparent 1px), linear-gradient(90deg, rgba(239,68,68,.4) 1px, transparent 1px)', backgroundSize: '40px 40px' }} />
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[600px] h-[600px] bg-red-600/10 blur-[140px] rounded-full pointer-events-none" />

        <nav className="border-b border-white/5 px-6 py-4 relative z-10">
          <div className="max-w-7xl mx-auto flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-red-500 to-rose-600 flex items-center justify-center text-white font-bold text-xs">SU</div>
              <span className="font-semibold text-white text-lg">Synthetic Users</span>
              <span className="text-xs px-2 py-0.5 rounded-full bg-red-500/10 text-red-300 border border-red-500/20 uppercase tracking-wider">Cyber Swarm</span>
            </div>
            <div className="flex items-center gap-3 text-xs">
              {view !== 'form' && <button onClick={reset} className="text-gray-400 hover:text-white">← New run</button>}
              <a href="/enterprise" className="text-gray-400 hover:text-white">Enterprise →</a>
              <a href="/" className="text-gray-400 hover:text-white">Home →</a>
            </div>
          </div>
        </nav>

        <main className="max-w-7xl mx-auto px-6 py-8 relative z-10">
          {view === 'form' && (
            <FormView
              targetUrl={targetUrl} setTargetUrl={setTargetUrl}
              agentCount={agentCount} setAgentCount={setAgentCount}
              error={error}
              onSubmit={handleSubmit}
              onPreset={(p) => setTargetUrl(p.target_url)}
            />
          )}
          {view === 'running' && (
            <RunningView findings={findings} phase={phase} target={target} elapsed={elapsed} totalAgents={agentCount} onSelectFinding={setSelectedFinding} />
          )}
          {view === 'completed' && result && (
            <CompletedView result={result} target={target} findings={findings} onSelectFinding={setSelectedFinding} onReset={reset} />
          )}
          {selectedFinding && <FindingModal finding={selectedFinding} onClose={() => setSelectedFinding(null)} />}
        </main>
      </div>
    </>
  );
}

/* ──────────── Form view ──────────── */

function FormView({ targetUrl, setTargetUrl, agentCount, setAgentCount, error, onSubmit, onPreset }) {
  return (
    <>
      <div className="mb-10 max-w-4xl">
        <div className="inline-flex items-center gap-2 mb-3 px-3 py-1 rounded-full bg-red-500/10 border border-red-500/20 text-red-300 text-xs font-semibold uppercase tracking-widest">
          <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
          New category · offensive security
        </div>
        <h1 className="text-5xl font-bold text-white mb-4 leading-tight">An army of <span className="text-red-400">500 adversary agents</span><br />stress-testing your web app.</h1>
        <p className="text-gray-400 max-w-2xl text-lg">Eight classes of attacker — script kiddies, bug bounty hunters, botnets, insiders, APTs, scanners, supply-chain, social engineers — running OWASP Top 10 probes in parallel. Live findings, CVSS-scored.</p>
      </div>

      <div className="max-w-5xl">
        <div className="mb-10 bg-surface-800/80 backdrop-blur border border-white/10 rounded-2xl p-5">
          <div className="text-xs font-semibold text-red-400 uppercase tracking-widest mb-3">Cohort composition · 500 agents</div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {PERSONA_STATIC.map(p => (
              <div key={p.id} className="flex items-center gap-2 bg-[#12121c] border border-white/5 rounded-lg px-3 py-2">
                <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: p.color, boxShadow: `0 0 10px ${p.color}` }} />
                <div className="min-w-0">
                  <div className="text-xs font-semibold text-white truncate">{p.label}</div>
                  <div className="text-[10px] text-gray-500">{p.share}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="mb-8">
          <h3 className="text-xs font-semibold text-red-400 uppercase tracking-widest mb-3">Pitch targets</h3>
          <div className="grid md:grid-cols-2 gap-3">
            {PRESETS.map((p, i) => (
              <button key={i} onClick={() => onPreset(p)} className="text-left bg-surface-800 hover:bg-white/5 border border-white/10 hover:border-red-500/50 rounded-xl p-4 transition-all group">
                <div className="flex items-center justify-between mb-1">
                  <div className="text-sm font-semibold text-white group-hover:text-red-300">{p.label}</div>
                  <span className="text-[10px] text-red-400 opacity-0 group-hover:opacity-100 transition">Load →</span>
                </div>
                <div className="text-xs text-gray-500 mb-2">{p.target_url}</div>
                <div className="text-xs text-gray-600">{p.description}</div>
              </button>
            ))}
          </div>
        </div>

        <form onSubmit={onSubmit} className="bg-surface-800/80 backdrop-blur border border-white/10 rounded-2xl p-6 space-y-5">
          <div>
            <label className="block text-sm font-semibold text-gray-300 mb-2">Target URL *</label>
            <input
              type="url"
              required
              value={targetUrl}
              onChange={(e) => setTargetUrl(e.target.value)}
              placeholder="https://your-app.com"
              className="w-full bg-[#12121c] border border-white/10 rounded-xl px-4 py-3 text-gray-200 placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-red-500/50"
            />
          </div>

          <div>
            <label className="block text-sm font-semibold text-gray-300 mb-2">Swarm size</label>
            <input
              type="number"
              min={50}
              max={500}
              step={50}
              value={agentCount}
              onChange={(e) => setAgentCount(parseInt(e.target.value, 10) || 500)}
              className="w-32 bg-[#12121c] border border-white/10 rounded-xl px-3 py-2.5 text-gray-200 focus:outline-none focus:ring-2 focus:ring-red-500/50 text-sm"
            />
            <span className="ml-3 text-xs text-gray-600">50–500 agents · cinematic demo runs 100% in your browser</span>
          </div>

          {error && <div className="bg-red-900/20 border border-red-500/30 rounded-xl p-4 text-red-300 text-sm">{error}</div>}

          <button type="submit" disabled={!targetUrl}
            className="w-full bg-gradient-to-r from-red-600 to-rose-600 hover:from-red-500 hover:to-rose-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold py-4 rounded-xl transition-all shadow-lg shadow-red-900/40">
            Deploy {agentCount} adversary agents →
          </button>
          <p className="text-center text-xs text-gray-600">Typical run: ~60-90 seconds · OWASP Top 10 coverage · CVSS-scored findings</p>
        </form>
      </div>
    </>
  );
}

/* ──────────── Swarm canvas ──────────── */

function SwarmCanvas({ findings, target, totalAgents = 500 }) {
  const canvasRef = useRef(null);
  const rafRef = useRef(null);
  const agentsRef = useRef(null);
  const hitRef = useRef([]);

  useMemo(() => {
    const personas = [
      { id: 'script_kiddie', share: 0.30, color: '#fb7185' },
      { id: 'bug_bounty',    share: 0.15, color: '#f59e0b' },
      { id: 'botnet_fraud',  share: 0.15, color: '#ef4444' },
      { id: 'insider',       share: 0.10, color: '#a855f7' },
      { id: 'apt',           share: 0.10, color: '#dc2626' },
      { id: 'scanner',       share: 0.10, color: '#0ea5e9' },
      { id: 'supply_chain',  share: 0.05, color: '#22c55e' },
      { id: 'social_engineer', share: 0.05, color: '#ec4899' },
    ];
    const agents = [];
    let angleAcc = 0;
    for (const p of personas) {
      const n = Math.round(totalAgents * p.share);
      const arc = p.share * Math.PI * 2;
      const start = angleAcc;
      angleAcc += arc;
      for (let i = 0; i < n; i++) {
        const a = start + (i / Math.max(1, n - 1)) * arc + (Math.random() - 0.5) * 0.08;
        const radius = 0.62 + Math.random() * 0.28;
        agents.push({
          persona_id: p.id, color: p.color, angle: a,
          angleSpeed: 0.0002 + Math.random() * 0.0004,
          radius, radiusPhase: Math.random() * Math.PI * 2,
          radiusSpeed: 0.001 + Math.random() * 0.002,
          size: 1.3 + Math.random() * 1.6, flash: 0,
        });
      }
    }
    agentsRef.current = agents;
    return null;
  }, [totalAgents]);

  useEffect(() => {
    if (!findings?.length || !agentsRef.current) return;
    const latest = findings[findings.length - 1];
    if (!latest) return;
    const targetAgents = agentsRef.current.filter(a => a.persona_id === latest.persona_id);
    const pick = Math.min(16, targetAgents.length);
    for (let i = 0; i < pick; i++) {
      const a = targetAgents[Math.floor(Math.random() * targetAgents.length)];
      a.flash = 1;
    }
    hitRef.current.push({ persona_id: latest.persona_id, color: latest.persona_color || '#f87171', age: 0 });
    if (hitRef.current.length > 20) hitRef.current.shift();
  }, [findings?.length]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const dpr = Math.max(1, window.devicePixelRatio || 1);

    const resize = () => {
      const w = canvas.clientWidth, h = canvas.clientHeight;
      canvas.width = w * dpr; canvas.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    const render = () => {
      const w = canvas.clientWidth, h = canvas.clientHeight;
      const cx = w / 2, cy = h / 2;
      const R = Math.min(w, h) * 0.45;
      ctx.clearRect(0, 0, w, h);

      const pulse = (Math.sin(Date.now() / 350) + 1) / 2;
      const grad = ctx.createRadialGradient(cx, cy, 8, cx, cy, 60);
      grad.addColorStop(0, 'rgba(239,68,68,0.7)');
      grad.addColorStop(1, 'rgba(239,68,68,0)');
      ctx.fillStyle = grad;
      ctx.beginPath(); ctx.arc(cx, cy, 60 + pulse * 10, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#ef4444';
      ctx.beginPath(); ctx.arc(cx, cy, 7, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = 'rgba(239,68,68,0.35)';
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(cx, cy, 60 + pulse * 6, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.arc(cx, cy, 90, 0, Math.PI * 2); ctx.stroke();

      ctx.fillStyle = '#fca5a5';
      ctx.font = '600 11px ui-monospace, monospace';
      ctx.textAlign = 'center';
      ctx.fillText(target?.host || '—', cx, cy + 4);

      for (const b of hitRef.current) {
        b.age += 1;
        if (b.age > 40) continue;
        const alpha = 1 - b.age / 40;
        ctx.strokeStyle = b.color;
        ctx.globalAlpha = alpha * 0.55;
        ctx.lineWidth = 1.2;
        const src = agentsRef.current.find(a => a.persona_id === b.persona_id);
        if (src) {
          const x = cx + Math.cos(src.angle) * R * src.radius;
          const y = cy + Math.sin(src.angle) * R * src.radius;
          ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(cx, cy); ctx.stroke();
        }
        ctx.globalAlpha = 1;
      }
      hitRef.current = hitRef.current.filter(b => b.age <= 40);

      for (const a of agentsRef.current || []) {
        a.angle += a.angleSpeed;
        a.radiusPhase += a.radiusSpeed;
        const r = R * (a.radius + Math.sin(a.radiusPhase) * 0.015);
        const x = cx + Math.cos(a.angle) * r;
        const y = cy + Math.sin(a.angle) * r;

        if (a.flash > 0) {
          ctx.fillStyle = '#fff';
          ctx.globalAlpha = Math.min(1, a.flash);
          ctx.beginPath(); ctx.arc(x, y, a.size + 2.5, 0, Math.PI * 2); ctx.fill();
          a.flash -= 0.04;
        }
        ctx.globalAlpha = 0.85;
        ctx.fillStyle = a.color;
        ctx.beginPath(); ctx.arc(x, y, a.size, 0, Math.PI * 2); ctx.fill();
        ctx.globalAlpha = 1;
      }

      rafRef.current = requestAnimationFrame(render);
    };
    rafRef.current = requestAnimationFrame(render);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      ro.disconnect();
    };
  }, [target?.host]);

  return <canvas ref={canvasRef} className="w-full h-full" />;
}

/* ──────────── Running view ──────────── */

function RunningView({ findings, phase, target, elapsed, totalAgents, onSelectFinding }) {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-xs uppercase tracking-widest text-red-400 font-semibold mb-1">Live attack · {elapsed}s</div>
          <h1 className="text-2xl font-bold text-white truncate">{target?.host}</h1>
          <div className="text-xs text-gray-500">{target?.url}</div>
        </div>
        <div className="flex gap-4 text-right">
          <div><div className="text-2xl font-bold text-white">{findings.length}</div><div className="text-[10px] text-gray-500 uppercase">findings</div></div>
          <div><div className="text-2xl font-bold text-red-400">{findings.filter(f => f.severity === 'critical' || f.severity === 'high').length}</div><div className="text-[10px] text-gray-500 uppercase">severe</div></div>
        </div>
      </div>

      <div className="grid lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
          <div className="relative w-full h-[460px] bg-[#0a0a12] border border-white/10 rounded-2xl overflow-hidden">
            <SwarmCanvas findings={findings} target={target} totalAgents={totalAgents} />
            <div className="absolute top-3 left-3 text-[10px] uppercase tracking-widest text-red-400/70 font-semibold">{PHASE_LABELS[phase] || phase}</div>
            <div className="absolute top-3 right-3 text-[10px] uppercase tracking-widest text-gray-500">{totalAgents} agents · {findings.length} findings</div>
          </div>
        </div>
        <div className="bg-surface-800/80 border border-white/10 rounded-2xl p-4 h-[460px] overflow-y-auto">
          <div className="text-xs font-semibold text-red-400 uppercase tracking-widest mb-3 sticky top-0 bg-surface-800/95 pb-2 -mx-4 px-4 z-10">Live findings</div>
          {findings.length === 0 ? (
            <div className="text-xs text-gray-600 italic">Waiting for first finding...</div>
          ) : (
            <div className="space-y-2">
              {[...findings].reverse().map((f, i) => <FindingCard key={f.id || i} finding={f} onClick={() => onSelectFinding(f)} />)}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ──────────── Completed view ──────────── */

function CompletedView({ result, target, findings, onSelectFinding, onReset }) {
  const metrics = result.metrics || {};
  const buckets = metrics.severity_buckets || { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
  const grade = metrics.overall_grade || '—';
  const list = findings.length ? findings : (result.findings || []);

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="text-xs uppercase tracking-widest text-red-400 font-semibold mb-1">Assessment complete</div>
          <h1 className="text-3xl font-bold text-white">{target?.host}</h1>
          <div className="text-xs text-gray-500">{target?.url}</div>
        </div>
        <div className="flex items-center gap-3">
          <GradeCard grade={grade} />
          <button onClick={onReset} className="bg-white/10 hover:bg-white/20 text-white px-4 py-2 rounded-lg text-sm">New run</button>
        </div>
      </div>

      <section className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <Metric label="Total findings" value={list.length} />
        <Metric label="Critical" value={buckets.critical} color="red" />
        <Metric label="High" value={buckets.high} color="orange" />
        <Metric label="Medium" value={buckets.medium} color="amber" />
        <Metric label="Avg CVSS" value={(metrics.avg_cvss ?? 0).toFixed ? metrics.avg_cvss.toFixed(1) : metrics.avg_cvss} />
      </section>

      <section className="bg-surface-800 border border-white/10 rounded-2xl p-5">
        <div className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Severity distribution</div>
        <div className="flex h-3 rounded-full overflow-hidden bg-white/5">
          {['critical', 'high', 'medium', 'low', 'info'].map(sev => {
            const n = buckets[sev] || 0;
            const total = list.length || 1;
            const pct = (n / total) * 100;
            if (pct === 0) return null;
            return <div key={sev} style={{ width: `${pct}%`, background: SEVERITY_STYLE[sev].dot }} title={`${sev}: ${n}`} />;
          })}
        </div>
        <div className="flex flex-wrap gap-3 mt-3 text-[11px]">
          {['critical', 'high', 'medium', 'low', 'info'].map(sev => (
            <span key={sev} className="flex items-center gap-1.5 text-gray-400">
              <span className="w-2 h-2 rounded-full" style={{ background: SEVERITY_STYLE[sev].dot }} /> {sev} <b className="text-white ml-0.5">{buckets[sev] || 0}</b>
            </span>
          ))}
        </div>
      </section>

      <section className="bg-surface-800 border border-white/10 rounded-2xl p-5">
        <div className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">OWASP Top 10 coverage</div>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
          {['A01','A02','A03','A04','A05','A06','A07','A08','A09','A10'].map(k => {
            const hit = metrics.by_owasp?.[k] || 0;
            return (
              <div key={k} className={`rounded-lg border px-3 py-2 ${hit > 0 ? 'border-red-500/40 bg-red-500/10' : 'border-white/5 bg-white/5'}`}>
                <div className="flex items-center justify-between">
                  <span className={`text-xs font-mono ${hit > 0 ? 'text-red-300' : 'text-gray-500'}`}>{k}</span>
                  <span className={`text-xs font-bold ${hit > 0 ? 'text-white' : 'text-gray-600'}`}>{hit}</span>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <section>
        <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-3">All findings ({list.length})</h3>
        <div className="grid md:grid-cols-2 gap-3">
          {[...list].sort(cmpSeverity).map((f, i) => <FindingCard key={f.id || i} finding={f} onClick={() => onSelectFinding(f)} />)}
        </div>
      </section>
    </div>
  );
}

/* ──────────── Small pieces ──────────── */

function FindingCard({ finding, onClick }) {
  const s = SEVERITY_STYLE[finding.severity] || SEVERITY_STYLE.info;
  return (
    <button onClick={onClick} className={`w-full text-left ${s.bg} ${s.border} border rounded-xl p-3 hover:bg-white/5 transition group`}>
      <div className="flex items-start gap-2 mb-1">
        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${s.text} bg-black/30`}>{s.label}</span>
        <span className="text-[10px] text-gray-500 font-mono">{finding.owasp}</span>
        <span className="text-[10px] text-gray-400 font-mono ml-auto">CVSS {finding.cvss?.toFixed?.(1) ?? finding.cvss}</span>
      </div>
      <div className="text-sm font-semibold text-white leading-tight mb-1">{finding.vector_label}</div>
      <div className="text-[11px] text-gray-400 line-clamp-2">{finding.evidence}</div>
      <div className="flex items-center gap-1.5 mt-2">
        <span className="w-1.5 h-1.5 rounded-full" style={{ background: finding.persona_color }} />
        <span className="text-[10px] text-gray-500">{finding.persona_label}</span>
      </div>
    </button>
  );
}

function GradeCard({ grade }) {
  const colors = {
    A: 'from-emerald-500 to-emerald-700',
    B: 'from-lime-500 to-lime-700',
    C: 'from-amber-500 to-amber-700',
    D: 'from-orange-500 to-orange-700',
    F: 'from-red-500 to-rose-700',
  };
  return (
    <div className={`w-24 h-24 rounded-2xl bg-gradient-to-br ${colors[grade] || 'from-slate-500 to-slate-700'} flex items-center justify-center shadow-lg`}>
      <div className="text-center">
        <div className="text-4xl font-black text-white leading-none">{grade}</div>
        <div className="text-[9px] text-white/80 uppercase mt-1 tracking-widest">Grade</div>
      </div>
    </div>
  );
}

function Metric({ label, value, color = 'white' }) {
  const cmap = { white: 'text-white', red: 'text-red-400', orange: 'text-orange-400', amber: 'text-amber-400' };
  return (
    <div className="bg-surface-800 border border-white/10 rounded-xl p-4">
      <div className={`text-3xl font-bold ${cmap[color]}`}>{value}</div>
      <div className="text-xs text-gray-500 mt-1">{label}</div>
    </div>
  );
}

function FindingModal({ finding, onClose }) {
  const s = SEVERITY_STYLE[finding.severity] || SEVERITY_STYLE.info;
  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center p-6 z-50" onClick={onClose}>
      <div className="bg-surface-800 border border-white/10 rounded-2xl max-w-2xl w-full p-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between mb-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className={`text-[11px] font-bold px-2 py-0.5 rounded ${s.text} bg-black/30`}>{s.label}</span>
              <span className="text-[11px] text-gray-500 font-mono">{finding.owasp}</span>
              <span className="text-[11px] text-gray-400 font-mono">CVSS {finding.cvss?.toFixed?.(1) ?? finding.cvss}</span>
            </div>
            <h3 className="text-xl font-bold text-white">{finding.vector_label}</h3>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-white text-2xl leading-none">×</button>
        </div>
        <div className="space-y-4 text-sm">
          <div>
            <div className="text-[11px] uppercase text-gray-500 font-semibold tracking-wider mb-1">Evidence</div>
            <div className="bg-[#0b0b12] rounded-lg p-3 text-gray-200 font-mono text-[13px]">{finding.evidence}</div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <div className="text-[11px] uppercase text-gray-500 font-semibold tracking-wider mb-1">Detected by</div>
              <div className="flex items-center gap-2"><span className="w-2 h-2 rounded-full" style={{ background: finding.persona_color }} /><span className="text-gray-200">{finding.persona_label}</span></div>
            </div>
            <div>
              <div className="text-[11px] uppercase text-gray-500 font-semibold tracking-wider mb-1">CVSS vector</div>
              <div className="text-gray-400 font-mono text-[11px] truncate">{finding.cvss_vector}</div>
            </div>
          </div>
          {finding.recommendation && (
            <div>
              <div className="text-[11px] uppercase text-gray-500 font-semibold tracking-wider mb-1">Recommendation</div>
              <div className="text-gray-300">{finding.recommendation}</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function cmpSeverity(a, b) {
  const order = { critical: 4, high: 3, medium: 2, low: 1, info: 0 };
  return (order[b.severity] ?? 0) - (order[a.severity] ?? 0) || (b.cvss || 0) - (a.cvss || 0);
}
