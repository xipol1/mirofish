/**
 * Demo Engine (Option A) — cinematic, pre-scripted attack simulation.
 *
 * Produces a deterministic-but-plausible stream of "findings" across 500 agents
 * over ~60-120 seconds, without making ANY real HTTP requests against the target.
 *
 * Use this for pitch demos. For real assessment, see ./real-engine.js.
 */

const { allocateCohort } = require('./attack-personas');
const { vectorInfo } = require('./owasp-catalog');
const { severityToScore, severityToVector } = require('./vulnerability-scorer');

function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Probability a given vector actually "fires" a finding during a demo run.
// Tuned so a typical run produces 30-60 findings across all severities.
const VECTOR_HIT_RATE = {
  headers_audit: 0.95,
  tls_audit: 0.60,
  cookie_flags: 0.70,
  info_disclosure: 0.40,
  cors_misconfig: 0.55,
  rate_limit_bypass: 0.45,
  tech_stack: 0.85,
  verbose_errors: 0.50,
  xss_reflected: 0.25,
  xss_stored: 0.10,
  sqli_error: 0.08,
  idor: 0.20,
  auth_bypass: 0.05,
  priv_esc: 0.08,
  credential_stuffing: 0.50,
  session_fixation: 0.15,
  session_hijack: 0.10,
  jwt_flaws: 0.15,
  ssrf: 0.06,
  mass_assignment: 0.12,
  forced_browsing: 0.25,
  directory_listing: 0.20,
  card_testing: 0.15,
  captcha_bypass: 0.20,
  default_creds: 0.05,
  mfa_weakness: 0.10,
  password_reset_flow: 0.15,
  oauth_redirect: 0.10,
  open_redirect: 0.20,
  cve_fingerprint: 0.45,
  '3p_script_audit': 0.60,
  subresource_integrity: 0.55,
  cdn_takeover: 0.03,
  dep_confusion: 0.08,
  supply_chain: 0.10,
  api_leak: 0.25,
  exfil_dlp: 0.20,
  command_injection: 0.04,
  sso_abuse: 0.08,
  phish_surface: 0.30,
  email_spoofing_dns: 0.55,
  zero_day: 0.02,
};

const EVIDENCE_TEMPLATES = {
  headers_audit: [
    'Missing `Content-Security-Policy` — inline script execution permitted.',
    'Missing `Strict-Transport-Security` — downgrade to HTTP possible.',
    '`X-Frame-Options` absent → clickjacking surface exposed.',
    '`Referrer-Policy` not set → full URL leaks to 3rd parties.',
    '`Permissions-Policy` unset → camera/mic/geolocation unconstrained.',
  ],
  tls_audit: [
    'TLS 1.0/1.1 still negotiable on fallback path.',
    'Weak cipher suite accepted: TLS_RSA_WITH_AES_128_CBC_SHA.',
    'HSTS max-age < 6 months (current: 86400).',
    'Certificate chain missing intermediate (trust fallback triggered in 1% of UAs).',
  ],
  cookie_flags: [
    'Session cookie `sessionid` issued WITHOUT HttpOnly.',
    'Auth cookie `auth_token` issued WITHOUT Secure flag over HTTPS.',
    'Cookie `tracking_id` has SameSite=None without Secure.',
  ],
  info_disclosure: [
    '`/.git/config` exposed — full repo reconstructible.',
    '`/robots.txt` lists `/admin/internal/` (disclosed attack surface).',
    '`/.env.backup` returned 200 OK with `AWS_SECRET_ACCESS_KEY=` line.',
    '`/swagger.json` world-readable without auth — full API map leaked.',
    '`/sitemap.xml` reveals unpublished URL paths: /beta/payments/v2, /internal/flags.',
    '`.DS_Store` found in /assets/ — discloses local dev file tree.',
  ],
  cors_misconfig: [
    '`Access-Control-Allow-Origin: *` paired with `Allow-Credentials: true` on `/api/user/me`.',
    'Origin reflection unvalidated — any domain can issue credentialed requests to `/api/billing/*`.',
    'Null-origin accepted on `/api/auth/session` → exploitable from `file://` or sandboxed iframes.',
  ],
  rate_limit_bypass: [
    'POST `/api/login` served 600 requests/min from single IP without challenge.',
    'No lockout after 200 failed logins on `/auth/signin`.',
    'GraphQL `/graphql` has no query-depth or complexity cap.',
  ],
  tech_stack: [
    '`Server: nginx/1.18.0` (4 years old).',
    '`X-Powered-By: Express` header exposes framework.',
    'Fingerprinted: WordPress 5.9.3, jQuery 1.12.4.',
  ],
  verbose_errors: [
    'Stack trace returned on malformed JSON body — reveals backend path `/app/server/routes/login.js:42`.',
    'Django DEBUG=True detected on staging subdomain.',
  ],
  xss_reflected: [
    '`?q=<payload>` reflected unescaped inside `<script>` block at `/search`.',
    'Error page echoes `Referer` header verbatim — reflected XSS via header injection.',
  ],
  xss_stored: [
    'Review body accepts and renders raw HTML on `/product/:id` page.',
    'User display-name field stores and renders `<img onerror=...>`.',
  ],
  sqli_error: [
    "Tick-injected `id` parameter on `/api/items?id=1'` returned `pq: unterminated quoted string`.",
    '`ORDER BY 99999` on `/catalog?sort=` triggered SQL error disclosing column count.',
  ],
  idor: [
    '`/api/users/{id}/invoices` returned 200 for any numeric id (tested with 12 pivots).',
    'Direct object reference in `/orders?oid=` — no ownership check.',
    'S3 signed URL on profile_picture lacks user binding — swap id, get photo.',
  ],
  auth_bypass: [
    '`Authorization: Bearer null` returns 200 on `/api/admin/metrics`.',
    'Cookie `role=user` tamperable to `role=admin`, server re-reads cookie verbatim.',
  ],
  priv_esc: [
    '`PATCH /api/user/me {"role":"admin"}` succeeds — mass-assignment allows self-promotion.',
  ],
  credential_stuffing: [
    'Login endpoint accepts 500+ req/min with no velocity check — ATO window open.',
    '"Forgot password" oracle reveals valid emails via 200/404 response diff.',
  ],
  session_fixation: [
    'Session ID issued pre-login is NOT rotated post-authentication.',
  ],
  session_hijack: [
    'Session token reflected in URL query string (`?session=...`).',
  ],
  jwt_flaws: [
    'JWT accepts `alg: none` on `/api/session/verify`.',
    'JWT signing key detected as HS256 with low-entropy secret (`secret123` tested successfully).',
  ],
  ssrf: [
    'Image-import endpoint fetches arbitrary URL including `http://169.254.169.254/latest/meta-data/`.',
  ],
  mass_assignment: [
    'Signup endpoint accepts and honors `is_verified: true` from client body.',
  ],
  forced_browsing: [
    '`/admin/` returns 200 without any auth challenge — only hidden via navigation.',
    '`/internal/debug` reachable with a plain GET.',
  ],
  directory_listing: [
    'Directory listing enabled on `/uploads/` — reveals filenames.',
  ],
  card_testing: [
    'Payment-intent endpoint `/api/pay/test` accepts 100+ declines/min from one IP.',
  ],
  captcha_bypass: [
    'Captcha token reused successfully 3× without invalidation.',
  ],
  default_creds: [
    'Admin panel at `/wp-admin/` accepts `admin:admin` (tested with read-only probe, no login).',
  ],
  mfa_weakness: [
    'MFA challenge skippable by replaying `remember_device=1` cookie across accounts.',
  ],
  password_reset_flow: [
    'Password-reset link uses predictable token (timestamp + uid).',
    '"Reset" endpoint confirms whether email exists via response timing (420ms vs 95ms).',
  ],
  oauth_redirect: [
    'OAuth `redirect_uri` param accepts wildcard-adjacent host (tenant.example.com → tenant.example.com.evil).',
  ],
  open_redirect: [
    '`/out?url=` forwards to any external host without allow-list.',
  ],
  cve_fingerprint: [
    'Detected `jQuery 1.12.4` — CVE-2020-11022, CVE-2020-11023.',
    'nginx 1.18.0 — CVE-2021-23017.',
    'Apache Struts signature match — CVE-2017-5638 surface.',
  ],
  '3p_script_audit': [
    '7 third-party scripts loaded on checkout page — 3 from unvetted CDNs.',
    'Facebook Pixel + Hotjar + Drift loaded pre-consent (GDPR risk).',
  ],
  subresource_integrity: [
    '<script src="cdn.example.com/widget.js"> loaded WITHOUT integrity= hash.',
  ],
  cdn_takeover: [
    'CNAME `static.example.com → old-bucket.s3.amazonaws.com` (bucket unclaimed → takeover possible).',
  ],
  dep_confusion: [
    'Internal package `@corp/utils` not scoped-lock — public registry hijack risk.',
  ],
  supply_chain: [
    'Build pipeline pulls unpinned `latest` tag for 3 base images.',
  ],
  api_leak: [
    '`/api/users/me` returns `password_hash` field in response.',
    'GraphQL introspection enabled in production.',
  ],
  exfil_dlp: [
    'Outbound POST to `paste.ee` from page unrestricted by CSP.',
  ],
  command_injection: [
    '`filename` param on PDF-export endpoint shell-interpolated into `wkhtmltopdf`.',
  ],
  sso_abuse: [
    'SAML ACS accepts unsigned assertions when `SignatureAlgorithm` omitted.',
  ],
  phish_surface: [
    'Lookalike domain registered 14 days ago: `{lookalike}` — active mail MX.',
  ],
  email_spoofing_dns: [
    'SPF record present but `~all` (soft-fail) — spoofed mail still deliverable.',
    'No DMARC policy found at `_dmarc.{host}` — impersonation uncontrolled.',
  ],
};

function pickTemplate(vector, rng, host) {
  const list = EVIDENCE_TEMPLATES[vector] || [`Finding on vector ${vector} — manual review required.`];
  const tpl = list[Math.floor(rng() * list.length)];
  const lookalike = host.replace(/\./, '-') + '.co';
  return tpl.replace('{host}', host).replace('{lookalike}', lookalike);
}

/**
 * Run a demo simulation.
 *
 * @param {object} opts
 * @param {string} opts.targetUrl
 * @param {number} [opts.totalAgents=500]
 * @param {number} [opts.durationMs=90000]  Total wall-clock for the demo.
 * @param {function} [opts.onProgress]
 * @returns {Promise<{findings, metrics, cohort}>}
 */
async function runDemoSimulation({ targetUrl, totalAgents = 500, durationMs = 90000, onProgress }) {
  const emit = onProgress || (() => {});
  const host = safeHost(targetUrl);
  const seed = hashStr(host + '|' + totalAgents);
  const rng = mulberry32(seed);

  const cohort = allocateCohort(totalAgents);
  emit({ type: 'cyber_start', payload: { target: targetUrl, host, total_agents: totalAgents, cohort: cohort.map(c => ({ id: c.persona.id, count: c.count })) } });

  // Phase 1: Reconnaissance (quick)
  emit({ type: 'phase_start', phase: 'recon', payload: { message: 'Reconnaissance — fingerprinting target' } });
  await sleep(800);
  emit({ type: 'recon_result', payload: { host, ip_guess: fakeIp(rng), tech_stack: fakeStack(rng), open_ports_hint: [80, 443, ...(rng() < 0.3 ? [22] : [])] } });

  // Phase 2: Swarm deployment
  emit({ type: 'phase_start', phase: 'swarm_deploy', payload: { message: `Deploying ${totalAgents} adversary agents` } });
  // Small staged "waves" — announce persona batches
  for (const { persona, count } of cohort) {
    emit({ type: 'persona_deployed', payload: { persona_id: persona.id, persona_label: persona.label, count, color: persona.color } });
    await sleep(120);
  }

  // Phase 3: Attack wave — findings stream
  emit({ type: 'phase_start', phase: 'attacking', payload: { message: 'Swarm attacking — streaming findings' } });

  const findings = [];
  const vectorsPool = [];
  for (const { persona, count } of cohort) {
    for (const v of persona.vectors) vectorsPool.push({ persona, vector: v, weight: count });
  }

  // Decide which vectors actually produce findings this run.
  const shortlist = [];
  for (const entry of vectorsPool) {
    const pHit = VECTOR_HIT_RATE[entry.vector] ?? 0.2;
    // Weight hit chance mildly by cohort size.
    const effective = pHit * (0.7 + Math.log10((entry.weight || 1) + 1) * 0.15);
    if (rng() < effective) shortlist.push(entry);
  }
  // Dedupe (same vector surfaced by multiple personas → keep one, strongest persona).
  const byVector = {};
  for (const e of shortlist) {
    const prev = byVector[e.vector];
    if (!prev || e.persona.skill > prev.persona.skill) byVector[e.vector] = e;
  }
  const finalList = Object.values(byVector);

  // Add a couple of high-fidelity "featured" findings — always present — for narrative.
  const featured = ['headers_audit', 'tech_stack', '3p_script_audit'];
  for (const f of featured) {
    if (!byVector[f]) finalList.push({ persona: cohort.find(c => c.persona.id === 'scanner').persona, vector: f, weight: 50 });
  }

  // Stagger findings across remaining time budget.
  const attackBudgetMs = Math.max(5000, durationMs - 5000);
  const perFinding = Math.max(250, Math.floor(attackBudgetMs / Math.max(1, finalList.length)));

  for (let i = 0; i < finalList.length; i++) {
    const { persona, vector } = finalList[i];
    const info = vectorInfo(vector);
    const severity = jitteredSeverity(info.severity_base, rng);
    const cvss = severityToScore(severity, rng());
    const evidence = pickTemplate(vector, rng, host);
    const finding = {
      id: `F-${String(i + 1).padStart(3, '0')}`,
      vector,
      vector_label: info.label,
      owasp: info.owasp,
      severity,
      cvss,
      cvss_vector: severityToVector(severity),
      persona_id: persona.id,
      persona_label: persona.label,
      persona_color: persona.color,
      evidence,
      confidence: severity === 'critical' ? 'high' : severity === 'high' ? 'high' : 'medium',
      detected_at: new Date().toISOString(),
      recommendation: recommendationFor(vector),
    };
    findings.push(finding);
    emit({ type: 'finding', payload: finding });
    const wait = perFinding + Math.floor(rng() * perFinding * 0.6);
    await sleep(wait);
  }

  emit({ type: 'phase_start', phase: 'aggregating', payload: { message: 'Scoring & ranking findings' } });
  await sleep(600);

  const metrics = aggregate(findings, cohort, totalAgents);
  emit({ type: 'cyber_complete', payload: { total_findings: findings.length, severity_buckets: metrics.severity_buckets, overall_grade: metrics.overall_grade } });

  return { findings, metrics, cohort: cohort.map(c => ({ persona_id: c.persona.id, persona_label: c.persona.label, count: c.count, color: c.persona.color })), target: { url: targetUrl, host } };
}

function aggregate(findings, cohort, totalAgents) {
  const buckets = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
  const byOwasp = {};
  const byPersona = {};
  let cvssSum = 0;
  for (const f of findings) {
    buckets[f.severity]++;
    byOwasp[f.owasp] = (byOwasp[f.owasp] || 0) + 1;
    byPersona[f.persona_id] = (byPersona[f.persona_id] || 0) + 1;
    cvssSum += f.cvss;
  }
  const worst = findings.reduce((w, f) => (f.cvss > (w?.cvss ?? -1) ? f : w), null);
  const avgCvss = findings.length ? Math.round((cvssSum / findings.length) * 10) / 10 : 0;

  // Grade: A/B/C/D/F based on criticals + highs
  let grade = 'A';
  if (buckets.critical >= 1) grade = 'F';
  else if (buckets.high >= 5) grade = 'D';
  else if (buckets.high >= 2) grade = 'C';
  else if (buckets.high >= 1 || buckets.medium >= 5) grade = 'B';

  return {
    total_agents: totalAgents,
    total_findings: findings.length,
    severity_buckets: buckets,
    by_owasp: byOwasp,
    by_persona: byPersona,
    avg_cvss: avgCvss,
    worst_finding: worst,
    overall_grade: grade,
    owasp_coverage: {
      tested: 10,
      triggered: Object.keys(byOwasp).length,
    },
  };
}

function jitteredSeverity(base, rng) {
  const r = rng();
  const order = ['info', 'low', 'medium', 'high', 'critical'];
  const idx = order.indexOf(base);
  if (idx < 0) return base;
  if (r < 0.15 && idx > 0) return order[idx - 1];
  if (r > 0.92 && idx < 4) return order[idx + 1];
  return base;
}

function recommendationFor(vector) {
  const map = {
    headers_audit: 'Add CSP, HSTS, X-Frame-Options, X-Content-Type-Options, Referrer-Policy, Permissions-Policy. Use securityheaders.com to verify.',
    tls_audit: 'Disable TLS <1.2, enforce HSTS preload (max-age ≥ 31536000; includeSubDomains; preload).',
    cookie_flags: 'Set HttpOnly, Secure, and SameSite=Lax (or Strict) on all session cookies.',
    info_disclosure: 'Remove exposed files from web root; block via WAF rule; audit CI to strip `.git`, `.env`, `.DS_Store`.',
    cors_misconfig: 'Never combine `Allow-Origin: *` with credentialed requests. Use an explicit allow-list per endpoint.',
    rate_limit_bypass: 'Add per-IP + per-account + per-session rate limits. Protect login/reset/pay endpoints especially.',
    tech_stack: 'Strip `Server` and `X-Powered-By` headers; route through CDN that redacts fingerprint.',
    verbose_errors: 'Disable DEBUG in production; return generic errors; log full context server-side.',
    xss_reflected: 'Context-aware output encoding + CSP with strict script-src.',
    xss_stored: 'Sanitize stored user HTML with DOMPurify/allow-list; CSP with nonce-based script-src.',
    sqli_error: 'Parameterize queries; use ORM placeholders; never concatenate user input into SQL.',
    idor: 'Enforce object-level authorization on every access; never trust client-supplied IDs.',
    auth_bypass: 'Treat every request as untrusted; verify signed session server-side; never re-read role from client.',
    priv_esc: 'Whitelist writable fields per role; reject unexpected fields with 400.',
    credential_stuffing: 'Device fingerprint + rate limits + breached-password screening + progressive MFA challenge.',
    jwt_flaws: 'Lock algorithm server-side (reject `none`); use ≥256-bit secret or asymmetric (RS/ES256).',
    ssrf: 'Egress allow-list, block 169.254.169.254 and RFC1918, disable HTTP redirect following on internal fetchers.',
    api_leak: 'Response DTO layer — never serialize internal fields; audit GraphQL resolvers for over-fetch.',
    cve_fingerprint: 'Upgrade components; subscribe to CVE feeds; add Dependabot/Renovate.',
    subresource_integrity: 'Add integrity=`sha384-…` and crossorigin=anonymous to every external <script>/<link>.',
    cdn_takeover: 'Audit DNS for dangling CNAMEs; reclaim or remove all orphan records.',
    email_spoofing_dns: 'Publish SPF with `-all`, DKIM keys, DMARC `p=reject` (after monitor phase).',
  };
  return map[vector] || 'Review finding context and apply least-privilege remediation.';
}

function fakeIp(rng) {
  return `${Math.floor(rng() * 200 + 20)}.${Math.floor(rng() * 255)}.${Math.floor(rng() * 255)}.${Math.floor(rng() * 255)}`;
}

function fakeStack(rng) {
  const stacks = [
    ['Cloudflare', 'nginx/1.18.0', 'Node.js/Express', 'PostgreSQL'],
    ['AWS CloudFront', 'nginx/1.22.1', 'Python/Django', 'PostgreSQL', 'Redis'],
    ['Fastly', 'nginx', 'Ruby/Rails', 'PostgreSQL', 'Sidekiq'],
    ['Cloudflare', 'LiteSpeed', 'PHP/Laravel', 'MySQL'],
    ['AWS ELB', 'Envoy', 'Go', 'PostgreSQL', 'Redis'],
  ];
  return stacks[Math.floor(rng() * stacks.length)];
}

function safeHost(u) {
  try { return new URL(u).hostname; } catch { return 'unknown.host'; }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

module.exports = { runDemoSimulation };
