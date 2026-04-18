/**
 * Adversary personas for the Cyber Swarm.
 *
 * Each persona represents a class of attacker with a characteristic skill level,
 * motivations, and attack vectors. A cohort of 500 agents is distributed across
 * personas using the `default_share` weight.
 */

const PERSONAS = [
  {
    id: 'script_kiddie',
    label: 'Script Kiddie',
    description: 'Low-skill opportunist running public exploit tools and default wordlists.',
    skill: 1,
    motivation: 'defacement / bragging rights',
    color: '#fb7185', // rose-400
    default_share: 0.30,
    vectors: ['info_disclosure', 'default_creds', 'xss_reflected', 'directory_listing', 'sqli_error'],
    ttps: ['nikto-style scans', 'Google dorking', 'LOIC-like bursts', 'Metasploit auto'],
  },
  {
    id: 'bug_bounty',
    label: 'Bug Bounty Hunter',
    description: 'Methodical researcher chasing valid, reportable vulns for cash.',
    skill: 4,
    motivation: 'responsible disclosure + payout',
    color: '#f59e0b', // amber-500
    default_share: 0.15,
    vectors: ['idor', 'ssrf', 'xss_stored', 'auth_bypass', 'jwt_flaws', 'cors_misconfig', 'open_redirect'],
    ttps: ['Burp Suite replay', 'parameter fuzzing', 'manual logic testing'],
  },
  {
    id: 'botnet_fraud',
    label: 'Botnet / Fraud Ring',
    description: 'Automated armies doing credential stuffing, card testing, and inventory denial.',
    skill: 2,
    motivation: 'monetization via stolen accounts',
    color: '#ef4444', // red-500
    default_share: 0.15,
    vectors: ['credential_stuffing', 'rate_limit_bypass', 'card_testing', 'session_fixation', 'captcha_bypass'],
    ttps: ['residential proxies', 'OpenBullet configs', 'ATO playbooks'],
  },
  {
    id: 'insider',
    label: 'Insider Threat',
    description: 'Authenticated user abusing trust boundaries — horizontal and vertical privilege escalation.',
    skill: 3,
    motivation: 'data exfil / sabotage',
    color: '#a855f7', // purple-500
    default_share: 0.10,
    vectors: ['idor', 'priv_esc', 'mass_assignment', 'api_leak', 'exfil_dlp'],
    ttps: ['legitimate session + tampered IDs', 'GraphQL introspection abuse'],
  },
  {
    id: 'apt',
    label: 'APT / Nation-State',
    description: 'Stealth long-dwell operator focused on persistence and lateral movement.',
    skill: 5,
    motivation: 'espionage / strategic',
    color: '#dc2626', // red-600
    default_share: 0.10,
    vectors: ['supply_chain', 'zero_day', 'sso_abuse', 'oauth_redirect', 'session_hijack', 'ssrf'],
    ttps: ['living off the land', 'cloud metadata abuse', 'OAuth consent phishing'],
  },
  {
    id: 'scanner',
    label: 'Automated Scanner',
    description: 'Noisy, broad-surface scanners (Nuclei, ZAP, Acunetix-class).',
    skill: 2,
    motivation: 'broad mapping',
    color: '#0ea5e9', // sky-500
    default_share: 0.10,
    vectors: ['headers_audit', 'tls_audit', 'cve_fingerprint', 'tech_stack', 'info_disclosure', 'cors_misconfig'],
    ttps: ['Nuclei templates', 'WhatWeb', 'Wappalyzer', 'ZAP active scan'],
  },
  {
    id: 'supply_chain',
    label: 'Supply-Chain Attacker',
    description: 'Targets 3rd-party JS, CDNs, and dependency confusion.',
    skill: 4,
    motivation: 'persistence via vendor trust',
    color: '#22c55e', // green-500 (poison)
    default_share: 0.05,
    vectors: ['3p_script_audit', 'subresource_integrity', 'cdn_takeover', 'dep_confusion'],
    ttps: ['typosquatting', 'compromised package', 'SRI missing'],
  },
  {
    id: 'social_engineer',
    label: 'Social Engineer',
    description: 'Targets humans and session state — phishing, MFA fatigue, OAuth consent abuse.',
    skill: 3,
    motivation: 'account takeover',
    color: '#ec4899', // pink-500
    default_share: 0.05,
    vectors: ['phish_surface', 'oauth_redirect', 'mfa_weakness', 'email_spoofing_dns', 'password_reset_flow'],
    ttps: ['clone-phishing', 'evilginx-style proxies', 'SPF/DMARC audit'],
  },
];

function allocateCohort(total = 500, overrides = {}) {
  const share = PERSONAS.map(p => overrides[p.id] ?? p.default_share);
  const sum = share.reduce((a, b) => a + b, 0) || 1;
  let remaining = total;
  const allocs = PERSONAS.map((p, i) => {
    if (i === PERSONAS.length - 1) return { persona: p, count: remaining };
    const c = Math.round((share[i] / sum) * total);
    remaining -= c;
    return { persona: p, count: c };
  });
  return allocs;
}

function listPersonas() {
  return PERSONAS.map(p => ({ ...p }));
}

function getPersona(id) {
  return PERSONAS.find(p => p.id === id) || null;
}

module.exports = { PERSONAS, allocateCohort, listPersonas, getPersona };
