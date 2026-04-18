/**
 * OWASP Top 10 (2021) + common web attack-vector catalog.
 *
 * Each entry maps an internal vector id → OWASP category, plus metadata
 * used by the demo script and the real probe engine.
 */

const OWASP_CATEGORIES = [
  { id: 'A01', label: 'Broken Access Control' },
  { id: 'A02', label: 'Cryptographic Failures' },
  { id: 'A03', label: 'Injection' },
  { id: 'A04', label: 'Insecure Design' },
  { id: 'A05', label: 'Security Misconfiguration' },
  { id: 'A06', label: 'Vulnerable & Outdated Components' },
  { id: 'A07', label: 'Identification & Authentication Failures' },
  { id: 'A08', label: 'Software & Data Integrity Failures' },
  { id: 'A09', label: 'Security Logging & Monitoring Failures' },
  { id: 'A10', label: 'Server-Side Request Forgery (SSRF)' },
];

const VECTORS = {
  // A01
  idor: { owasp: 'A01', label: 'IDOR / Broken Object-Level Auth', severity_base: 'high' },
  priv_esc: { owasp: 'A01', label: 'Vertical Privilege Escalation', severity_base: 'critical' },
  directory_listing: { owasp: 'A01', label: 'Directory Listing Exposed', severity_base: 'medium' },
  forced_browsing: { owasp: 'A01', label: 'Forced Browsing to Admin', severity_base: 'high' },
  mass_assignment: { owasp: 'A01', label: 'Mass Assignment / Over-posting', severity_base: 'high' },

  // A02
  tls_audit: { owasp: 'A02', label: 'Weak TLS / Missing HSTS', severity_base: 'medium' },
  plaintext_http: { owasp: 'A02', label: 'Plaintext HTTP Endpoint', severity_base: 'high' },
  cookie_flags: { owasp: 'A02', label: 'Cookie Missing Secure/HttpOnly', severity_base: 'medium' },

  // A03
  sqli_error: { owasp: 'A03', label: 'Error-Based SQL Injection Indicator', severity_base: 'critical' },
  xss_reflected: { owasp: 'A03', label: 'Reflected XSS Surface', severity_base: 'high' },
  xss_stored: { owasp: 'A03', label: 'Stored XSS Sink', severity_base: 'critical' },
  command_injection: { owasp: 'A03', label: 'Command Injection Surface', severity_base: 'critical' },

  // A04
  rate_limit_bypass: { owasp: 'A04', label: 'No Rate Limiting / Enumeration', severity_base: 'high' },
  captcha_bypass: { owasp: 'A04', label: 'Captcha Weakness', severity_base: 'medium' },
  card_testing: { owasp: 'A04', label: 'Payment Endpoint Not Rate-Limited', severity_base: 'high' },

  // A05
  headers_audit: { owasp: 'A05', label: 'Missing Security Headers', severity_base: 'medium' },
  cors_misconfig: { owasp: 'A05', label: 'CORS Misconfiguration', severity_base: 'high' },
  info_disclosure: { owasp: 'A05', label: 'Sensitive File Exposure', severity_base: 'high' },
  default_creds: { owasp: 'A05', label: 'Default / Weak Credentials', severity_base: 'critical' },
  verbose_errors: { owasp: 'A05', label: 'Verbose Error Stack Trace', severity_base: 'low' },
  tech_stack: { owasp: 'A05', label: 'Tech Stack Fingerprint Leakage', severity_base: 'low' },

  // A06
  cve_fingerprint: { owasp: 'A06', label: 'Outdated Component with Known CVE', severity_base: 'high' },
  '3p_script_audit': { owasp: 'A06', label: 'Unvetted 3rd-Party Script', severity_base: 'medium' },
  subresource_integrity: { owasp: 'A06', label: 'Missing SRI on External Script', severity_base: 'medium' },
  cdn_takeover: { owasp: 'A06', label: 'Dangling CDN / Subdomain Takeover', severity_base: 'high' },
  dep_confusion: { owasp: 'A06', label: 'Dependency Confusion Risk', severity_base: 'medium' },

  // A07
  credential_stuffing: { owasp: 'A07', label: 'Credential Stuffing Window Open', severity_base: 'high' },
  session_fixation: { owasp: 'A07', label: 'Session Fixation Possible', severity_base: 'medium' },
  session_hijack: { owasp: 'A07', label: 'Session Token in URL / Leakable', severity_base: 'high' },
  jwt_flaws: { owasp: 'A07', label: 'JWT Signature / Algorithm Weakness', severity_base: 'high' },
  auth_bypass: { owasp: 'A07', label: 'Authentication Bypass', severity_base: 'critical' },
  mfa_weakness: { owasp: 'A07', label: 'MFA Downgrade / Skip Path', severity_base: 'high' },
  password_reset_flow: { owasp: 'A07', label: 'Password Reset Weakness', severity_base: 'high' },

  // A08
  supply_chain: { owasp: 'A08', label: 'Supply Chain Attack Surface', severity_base: 'high' },
  email_spoofing_dns: { owasp: 'A08', label: 'Missing SPF / DMARC / DKIM', severity_base: 'medium' },
  oauth_redirect: { owasp: 'A08', label: 'Open Redirect via OAuth Callback', severity_base: 'high' },

  // A09
  exfil_dlp: { owasp: 'A09', label: 'Exfil Surface / No Egress Monitoring', severity_base: 'medium' },
  api_leak: { owasp: 'A09', label: 'Verbose API Response / PII Leak', severity_base: 'medium' },

  // A10
  ssrf: { owasp: 'A10', label: 'SSRF Surface Detected', severity_base: 'critical' },

  // Extras
  sso_abuse: { owasp: 'A07', label: 'SSO Misconfiguration', severity_base: 'high' },
  phish_surface: { owasp: 'A07', label: 'Lookalike Domain / Phish-Prone UI', severity_base: 'low' },
  open_redirect: { owasp: 'A08', label: 'Open Redirect', severity_base: 'medium' },
  zero_day: { owasp: 'A06', label: 'Unknown Behavior (Fuzz Signal)', severity_base: 'info' },
};

const SEVERITY_WEIGHTS = { critical: 9.5, high: 7.5, medium: 5.0, low: 3.0, info: 0.5 };

function vectorInfo(id) {
  return VECTORS[id] || { owasp: 'A05', label: id, severity_base: 'info' };
}

module.exports = { OWASP_CATEGORIES, VECTORS, SEVERITY_WEIGHTS, vectorInfo };
