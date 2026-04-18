/**
 * Client-side demo engine for the Cyber Swarm.
 *
 * Runs entirely in the browser — no backend required.
 * Deterministic (seeded by hostname + agent count) so the same target produces
 * the same findings.
 */

export const PERSONAS = [
  { id: 'script_kiddie', label: 'Script Kiddie', color: '#fb7185', share: 0.30, skill: 1, vectors: ['info_disclosure', 'default_creds', 'xss_reflected', 'directory_listing', 'sqli_error'] },
  { id: 'bug_bounty', label: 'Bug Bounty Hunter', color: '#f59e0b', share: 0.15, skill: 4, vectors: ['idor', 'ssrf', 'xss_stored', 'auth_bypass', 'jwt_flaws', 'cors_misconfig', 'open_redirect'] },
  { id: 'botnet_fraud', label: 'Botnet / Fraud Ring', color: '#ef4444', share: 0.15, skill: 2, vectors: ['credential_stuffing', 'rate_limit_bypass', 'card_testing', 'session_fixation', 'captcha_bypass'] },
  { id: 'insider', label: 'Insider Threat', color: '#a855f7', share: 0.10, skill: 3, vectors: ['idor', 'priv_esc', 'mass_assignment', 'api_leak', 'exfil_dlp'] },
  { id: 'apt', label: 'APT / Nation-State', color: '#dc2626', share: 0.10, skill: 5, vectors: ['supply_chain', 'zero_day', 'sso_abuse', 'oauth_redirect', 'session_hijack', 'ssrf'] },
  { id: 'scanner', label: 'Automated Scanner', color: '#0ea5e9', share: 0.10, skill: 2, vectors: ['headers_audit', 'tls_audit', 'cve_fingerprint', 'tech_stack', 'info_disclosure', 'cors_misconfig'] },
  { id: 'supply_chain', label: 'Supply-Chain Attacker', color: '#22c55e', share: 0.05, skill: 4, vectors: ['3p_script_audit', 'subresource_integrity', 'cdn_takeover', 'dep_confusion'] },
  { id: 'social_engineer', label: 'Social Engineer', color: '#ec4899', share: 0.05, skill: 3, vectors: ['phish_surface', 'oauth_redirect', 'mfa_weakness', 'email_spoofing_dns', 'password_reset_flow'] },
];

const VECTORS = {
  idor: { owasp: 'A01', label: 'IDOR / Broken Object-Level Auth', sev: 'high' },
  priv_esc: { owasp: 'A01', label: 'Vertical Privilege Escalation', sev: 'critical' },
  directory_listing: { owasp: 'A01', label: 'Directory Listing Exposed', sev: 'medium' },
  mass_assignment: { owasp: 'A01', label: 'Mass Assignment / Over-posting', sev: 'high' },
  forced_browsing: { owasp: 'A01', label: 'Forced Browsing to Admin', sev: 'high' },

  tls_audit: { owasp: 'A02', label: 'Weak TLS / Missing HSTS', sev: 'medium' },
  cookie_flags: { owasp: 'A02', label: 'Cookie Missing Secure/HttpOnly', sev: 'medium' },
  plaintext_http: { owasp: 'A02', label: 'Plaintext HTTP Endpoint', sev: 'high' },

  sqli_error: { owasp: 'A03', label: 'Error-Based SQL Injection Indicator', sev: 'critical' },
  xss_reflected: { owasp: 'A03', label: 'Reflected XSS Surface', sev: 'high' },
  xss_stored: { owasp: 'A03', label: 'Stored XSS Sink', sev: 'critical' },
  command_injection: { owasp: 'A03', label: 'Command Injection Surface', sev: 'critical' },

  rate_limit_bypass: { owasp: 'A04', label: 'No Rate Limiting / Enumeration', sev: 'high' },
  captcha_bypass: { owasp: 'A04', label: 'Captcha Weakness', sev: 'medium' },
  card_testing: { owasp: 'A04', label: 'Payment Endpoint Not Rate-Limited', sev: 'high' },

  headers_audit: { owasp: 'A05', label: 'Missing Security Headers', sev: 'medium' },
  cors_misconfig: { owasp: 'A05', label: 'CORS Misconfiguration', sev: 'high' },
  info_disclosure: { owasp: 'A05', label: 'Sensitive File Exposure', sev: 'high' },
  default_creds: { owasp: 'A05', label: 'Default / Weak Credentials', sev: 'critical' },
  verbose_errors: { owasp: 'A05', label: 'Verbose Error Stack Trace', sev: 'low' },
  tech_stack: { owasp: 'A05', label: 'Tech Stack Fingerprint Leakage', sev: 'low' },

  cve_fingerprint: { owasp: 'A06', label: 'Outdated Component with Known CVE', sev: 'high' },
  '3p_script_audit': { owasp: 'A06', label: 'Unvetted 3rd-Party Script', sev: 'medium' },
  subresource_integrity: { owasp: 'A06', label: 'Missing SRI on External Script', sev: 'medium' },
  cdn_takeover: { owasp: 'A06', label: 'Dangling CDN / Subdomain Takeover', sev: 'high' },
  dep_confusion: { owasp: 'A06', label: 'Dependency Confusion Risk', sev: 'medium' },

  credential_stuffing: { owasp: 'A07', label: 'Credential Stuffing Window Open', sev: 'high' },
  session_fixation: { owasp: 'A07', label: 'Session Fixation Possible', sev: 'medium' },
  session_hijack: { owasp: 'A07', label: 'Session Token in URL / Leakable', sev: 'high' },
  jwt_flaws: { owasp: 'A07', label: 'JWT Signature / Algorithm Weakness', sev: 'high' },
  auth_bypass: { owasp: 'A07', label: 'Authentication Bypass', sev: 'critical' },
  mfa_weakness: { owasp: 'A07', label: 'MFA Downgrade / Skip Path', sev: 'high' },
  password_reset_flow: { owasp: 'A07', label: 'Password Reset Weakness', sev: 'high' },
  sso_abuse: { owasp: 'A07', label: 'SSO Misconfiguration', sev: 'high' },
  phish_surface: { owasp: 'A07', label: 'Lookalike Domain / Phish-Prone UI', sev: 'low' },

  supply_chain: { owasp: 'A08', label: 'Supply Chain Attack Surface', sev: 'high' },
  email_spoofing_dns: { owasp: 'A08', label: 'Missing SPF / DMARC / DKIM', sev: 'medium' },
  oauth_redirect: { owasp: 'A08', label: 'Open Redirect via OAuth Callback', sev: 'high' },
  open_redirect: { owasp: 'A08', label: 'Open Redirect', sev: 'medium' },

  exfil_dlp: { owasp: 'A09', label: 'Exfil Surface / No Egress Monitoring', sev: 'medium' },
  api_leak: { owasp: 'A09', label: 'Verbose API Response / PII Leak', sev: 'medium' },

  ssrf: { owasp: 'A10', label: 'SSRF Surface Detected', sev: 'critical' },
  zero_day: { owasp: 'A06', label: 'Unknown Behavior (Fuzz Signal)', sev: 'info' },
};

const SEVERITY_WEIGHTS = { critical: 9.5, high: 7.5, medium: 5.0, low: 3.0, info: 0.5 };

const VECTOR_HIT_RATE = {
  headers_audit: 0.95, tech_stack: 0.85, cookie_flags: 0.70, tls_audit: 0.60,
  '3p_script_audit': 0.60, subresource_integrity: 0.55, email_spoofing_dns: 0.55,
  cors_misconfig: 0.55, verbose_errors: 0.50, credential_stuffing: 0.50,
  rate_limit_bypass: 0.45, cve_fingerprint: 0.45, info_disclosure: 0.40,
  phish_surface: 0.30, forced_browsing: 0.25, xss_reflected: 0.25, api_leak: 0.25,
  idor: 0.20, directory_listing: 0.20, open_redirect: 0.20, captcha_bypass: 0.20,
  exfil_dlp: 0.20, card_testing: 0.15, session_fixation: 0.15, jwt_flaws: 0.15,
  password_reset_flow: 0.15, mass_assignment: 0.12, xss_stored: 0.10,
  session_hijack: 0.10, supply_chain: 0.10, oauth_redirect: 0.10, mfa_weakness: 0.10,
  priv_esc: 0.08, sqli_error: 0.08, dep_confusion: 0.08, sso_abuse: 0.08,
  ssrf: 0.06, auth_bypass: 0.05, default_creds: 0.05, command_injection: 0.04,
  cdn_takeover: 0.03, zero_day: 0.02,
};

const EVIDENCE = {
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
    '`.DS_Store` found in /assets/ — discloses local dev file tree.',
  ],
  cors_misconfig: [
    '`Access-Control-Allow-Origin: *` paired with `Allow-Credentials: true` on `/api/user/me`.',
    'Origin reflection unvalidated — any domain can issue credentialed requests to `/api/billing/*`.',
    'Null-origin accepted on `/api/auth/session`.',
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
  priv_esc: ['`PATCH /api/user/me {"role":"admin"}` succeeds — mass-assignment allows self-promotion.'],
  credential_stuffing: [
    'Login endpoint accepts 500+ req/min with no velocity check — ATO window open.',
    '"Forgot password" oracle reveals valid emails via 200/404 response diff.',
  ],
  session_fixation: ['Session ID issued pre-login is NOT rotated post-authentication.'],
  session_hijack: ['Session token reflected in URL query string (`?session=...`).'],
  jwt_flaws: [
    'JWT accepts `alg: none` on `/api/session/verify`.',
    'JWT signing key detected as HS256 with low-entropy secret.',
  ],
  ssrf: ['Image-import endpoint fetches arbitrary URL including `http://169.254.169.254/latest/meta-data/`.'],
  mass_assignment: ['Signup endpoint accepts and honors `is_verified: true` from client body.'],
  forced_browsing: [
    '`/admin/` returns 200 without any auth challenge — only hidden via navigation.',
    '`/internal/debug` reachable with a plain GET.',
  ],
  directory_listing: ['Directory listing enabled on `/uploads/` — reveals filenames.'],
  card_testing: ['Payment-intent endpoint `/api/pay/test` accepts 100+ declines/min from one IP.'],
  captcha_bypass: ['Captcha token reused successfully 3× without invalidation.'],
  default_creds: ['Admin panel at `/wp-admin/` accepts `admin:admin` (detected via probe).'],
  mfa_weakness: ['MFA challenge skippable by replaying `remember_device=1` cookie across accounts.'],
  password_reset_flow: [
    'Password-reset link uses predictable token (timestamp + uid).',
    '"Reset" endpoint confirms whether email exists via response timing (420ms vs 95ms).',
  ],
  oauth_redirect: ['OAuth `redirect_uri` param accepts wildcard-adjacent host (tenant.example.com → tenant.example.com.evil).'],
  open_redirect: ['`/out?url=` forwards to any external host without allow-list.'],
  cve_fingerprint: [
    'Detected `jQuery 1.12.4` — CVE-2020-11022, CVE-2020-11023.',
    'nginx 1.18.0 — CVE-2021-23017.',
    'Apache Struts signature match — CVE-2017-5638 surface.',
  ],
  '3p_script_audit': [
    '7 third-party scripts loaded on checkout page — 3 from unvetted CDNs.',
    'Facebook Pixel + Hotjar + Drift loaded pre-consent (GDPR risk).',
  ],
  subresource_integrity: ['<script src="cdn.example.com/widget.js"> loaded WITHOUT integrity= hash.'],
  cdn_takeover: ['CNAME `static.example.com → old-bucket.s3.amazonaws.com` (bucket unclaimed → takeover possible).'],
  dep_confusion: ['Internal package `@corp/utils` not scoped-lock — public registry hijack risk.'],
  supply_chain: ['Build pipeline pulls unpinned `latest` tag for 3 base images.'],
  api_leak: [
    '`/api/users/me` returns `password_hash` field in response.',
    'GraphQL introspection enabled in production.',
  ],
  exfil_dlp: ['Outbound POST to `paste.ee` from page unrestricted by CSP.'],
  command_injection: ['`filename` param on PDF-export endpoint shell-interpolated into `wkhtmltopdf`.'],
  sso_abuse: ['SAML ACS accepts unsigned assertions when `SignatureAlgorithm` omitted.'],
  phish_surface: ['Lookalike domain registered 14 days ago: `{lookalike}` — active mail MX.'],
  email_spoofing_dns: [
    'SPF record present but `~all` (soft-fail) — spoofed mail still deliverable.',
    'No DMARC policy found at `_dmarc.{host}` — impersonation uncontrolled.',
  ],
  plaintext_http: ['Site serves content over plaintext HTTP without automatic redirect to HTTPS.'],
};

const RECOMMENDATIONS = {
  headers_audit: 'Add CSP, HSTS, X-Frame-Options, X-Content-Type-Options, Referrer-Policy, Permissions-Policy.',
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
  default: 'Review finding context and apply least-privilege remediation.',
};

/* ───── Utility ───── */

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
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function safeHost(u) { try { return new URL(u).hostname; } catch { return 'unknown.host'; } }
function allocateCohort(total, overrides = {}) {
  const share = PERSONAS.map(p => overrides[p.id] ?? p.share);
  const sum = share.reduce((a, b) => a + b, 0) || 1;
  let remaining = total;
  return PERSONAS.map((p, i) => {
    if (i === PERSONAS.length - 1) return { persona: p, count: remaining };
    const c = Math.round((share[i] / sum) * total);
    remaining -= c;
    return { persona: p, count: c };
  });
}
function severityToScore(sev, jitter = 0) {
  const base = SEVERITY_WEIGHTS[sev] ?? 0;
  const j = (jitter * 0.6) - 0.3;
  return Math.max(0, Math.min(10, Math.round((base + j) * 10) / 10));
}
function severityToVector(sev) {
  const v = {
    critical: 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H',
    high:     'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:L/A:N',
    medium:   'CVSS:3.1/AV:N/AC:L/PR:N/UI:R/S:U/C:L/I:L/A:N',
    low:      'CVSS:3.1/AV:N/AC:H/PR:L/UI:R/S:U/C:L/I:N/A:N',
    info:     'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:N/A:N',
  };
  return v[sev] || v.info;
}
function jitteredSeverity(base, rng) {
  const order = ['info', 'low', 'medium', 'high', 'critical'];
  const i = order.indexOf(base);
  if (i < 0) return base;
  const r = rng();
  if (r < 0.15 && i > 0) return order[i - 1];
  if (r > 0.92 && i < 4) return order[i + 1];
  return base;
}
function pickTemplate(vector, rng, host) {
  const list = EVIDENCE[vector] || [`Finding on ${vector} — manual review required.`];
  const tpl = list[Math.floor(rng() * list.length)];
  const lookalike = host.replace(/\./, '-') + '.co';
  return tpl.replace('{host}', host).replace('{lookalike}', lookalike);
}

/* ───── Main engine ───── */

export async function runDemoSimulation({ targetUrl, totalAgents = 500, durationMs = 75000, onEvent, abortSignal }) {
  const emit = (e) => { if (abortSignal?.aborted) return; onEvent?.(e); };
  if (abortSignal?.aborted) return null;

  const host = safeHost(targetUrl);
  const seed = hashStr(host + '|' + totalAgents);
  const rng = mulberry32(seed);
  const cohort = allocateCohort(totalAgents);

  emit({ type: 'cyber_start', payload: { target: targetUrl, host, total_agents: totalAgents, cohort: cohort.map(c => ({ id: c.persona.id, count: c.count })) } });

  // Phase 1: recon
  emit({ type: 'phase_start', phase: 'recon', payload: { message: 'Reconnaissance — fingerprinting target' } });
  await sleep(700);
  if (abortSignal?.aborted) return null;
  emit({ type: 'recon_result', payload: { host, ip_guess: fakeIp(rng), tech_stack: fakeStack(rng), open_ports_hint: [80, 443, ...(rng() < 0.3 ? [22] : [])] } });

  // Phase 2: deploy swarm
  emit({ type: 'phase_start', phase: 'swarm_deploy', payload: { message: `Deploying ${totalAgents} adversary agents` } });
  for (const { persona, count } of cohort) {
    if (abortSignal?.aborted) return null;
    emit({ type: 'persona_deployed', payload: { persona_id: persona.id, persona_label: persona.label, count, color: persona.color } });
    await sleep(100);
  }

  // Phase 3: attacking
  emit({ type: 'phase_start', phase: 'attacking', payload: { message: 'Swarm attacking — streaming findings' } });

  const vectorsPool = [];
  for (const { persona, count } of cohort) {
    for (const v of persona.vectors) vectorsPool.push({ persona, vector: v, weight: count });
  }
  const shortlist = [];
  for (const entry of vectorsPool) {
    const pHit = VECTOR_HIT_RATE[entry.vector] ?? 0.2;
    const eff = pHit * (0.7 + Math.log10((entry.weight || 1) + 1) * 0.15);
    if (rng() < eff) shortlist.push(entry);
  }
  const byVector = {};
  for (const e of shortlist) {
    const prev = byVector[e.vector];
    if (!prev || e.persona.skill > prev.persona.skill) byVector[e.vector] = e;
  }
  const finalList = Object.values(byVector);

  // Always-on featured findings
  const featured = ['headers_audit', 'tech_stack', '3p_script_audit'];
  for (const f of featured) {
    if (!byVector[f]) finalList.push({ persona: PERSONAS.find(p => p.id === 'scanner'), vector: f });
  }

  const attackBudget = Math.max(4000, durationMs - 4000);
  const perFinding = Math.max(220, Math.floor(attackBudget / Math.max(1, finalList.length)));

  const findings = [];
  for (let i = 0; i < finalList.length; i++) {
    if (abortSignal?.aborted) return null;
    const { persona, vector } = finalList[i];
    const info = VECTORS[vector] || { owasp: 'A05', label: vector, sev: 'info' };
    const severity = jitteredSeverity(info.sev, rng);
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
      confidence: severity === 'critical' || severity === 'high' ? 'high' : 'medium',
      detected_at: new Date().toISOString(),
      recommendation: RECOMMENDATIONS[vector] || RECOMMENDATIONS.default,
    };
    findings.push(finding);
    emit({ type: 'finding', payload: finding });
    const wait = perFinding + Math.floor(rng() * perFinding * 0.6);
    await sleep(wait);
  }

  emit({ type: 'phase_start', phase: 'aggregating', payload: { message: 'Scoring findings' } });
  await sleep(500);
  if (abortSignal?.aborted) return null;

  const metrics = aggregate(findings, totalAgents);
  emit({ type: 'cyber_complete', payload: { total_findings: findings.length, severity_buckets: metrics.severity_buckets, overall_grade: metrics.overall_grade } });

  return {
    findings,
    metrics,
    target: { url: targetUrl, host },
    cohort: cohort.map(c => ({ persona_id: c.persona.id, persona_label: c.persona.label, count: c.count, color: c.persona.color })),
    mode: 'demo',
  };
}

function aggregate(findings, totalAgents) {
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
    owasp_coverage: { tested: 10, triggered: Object.keys(byOwasp).length },
  };
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
