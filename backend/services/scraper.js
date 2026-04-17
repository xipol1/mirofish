/**
 * URL Scraper — Playwright-based (JS-rendered SPAs) with optional authentication.
 *
 * Given a URL, renders the page with a headless browser and extracts structured content.
 * If `auth` entries are provided, also logs in with each (email, password) and scrapes the
 * authenticated landing to capture dashboard content. Returns one merged scrape object.
 *
 * auth entry shape: { role: string, email: string, password: string, loginPath?: string, postLoginPath?: string }
 */

const cheerio = require('cheerio');
const { chromium } = require('playwright');

const HEADLESS = (process.env.PLAYWRIGHT_HEADLESS || 'true') !== 'false';
const NAV_TIMEOUT = parseInt(process.env.PLAYWRIGHT_NAV_TIMEOUT_MS, 10) || 30000;
const DEFAULT_TIMEOUT = parseInt(process.env.PLAYWRIGHT_DEFAULT_TIMEOUT_MS, 10) || 10000;

function isUrl(str) {
  if (!str || typeof str !== 'string') return false;
  return /^https?:\/\/[^\s]+$/i.test(str.trim());
}

function cleanText(s) {
  if (!s) return '';
  return String(s).replace(/\s+/g, ' ').trim();
}

/**
 * Parses a SCRAPE_AUTH_* env var of form "role:email:password,role:email:password".
 * Returns [] if the var is empty/unset.
 */
function parseScrapeAuthEnv(value) {
  if (!value || typeof value !== 'string') return [];
  return value.split(',').map(entry => {
    const [role, email, ...passwordParts] = entry.split(':');
    const password = passwordParts.join(':'); // password may contain ':'
    if (!role || !email || !password) return null;
    return { role: role.trim(), email: email.trim(), password: password.trim() };
  }).filter(Boolean);
}

async function renderPage(browser, url, { waitUntil = 'networkidle' } = {}) {
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (compatible; SyntheticUsersBot/1.0)',
    viewport: { width: 1280, height: 800 },
  });
  context.setDefaultTimeout(DEFAULT_TIMEOUT);
  context.setDefaultNavigationTimeout(NAV_TIMEOUT);
  const page = await context.newPage();
  try {
    await page.goto(url, { waitUntil, timeout: NAV_TIMEOUT });
    await page.waitForTimeout(800); // let late hydration settle
    const html = await page.content();
    const finalUrl = page.url();
    return { html, finalUrl, context, page };
  } catch (err) {
    await context.close();
    throw err;
  }
}

async function loginAndRender(browser, baseUrl, { email, password, loginPath = '/auth/login', postLoginPath = '/' }) {
  const origin = new URL(baseUrl).origin;
  const loginUrl = origin + loginPath;
  const postUrl = origin + postLoginPath;

  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (compatible; SyntheticUsersBot/1.0)',
    viewport: { width: 1280, height: 800 },
  });
  context.setDefaultTimeout(DEFAULT_TIMEOUT);
  context.setDefaultNavigationTimeout(NAV_TIMEOUT);
  const page = await context.newPage();

  try {
    await page.goto(loginUrl, { waitUntil: 'networkidle', timeout: NAV_TIMEOUT });
    await page.waitForSelector('input[type="email"]', { timeout: DEFAULT_TIMEOUT });
    await page.fill('input[type="email"]', email);
    await page.fill('input[type="password"]', password);

    const submit = page.locator('button:has-text("Iniciar sesión"), button:has-text("Iniciar Sesión"), button:has-text("Sign in"), button[type="submit"]').first();
    await Promise.all([
      page.waitForLoadState('networkidle', { timeout: NAV_TIMEOUT }).catch(() => {}),
      submit.click(),
    ]);
    await page.waitForTimeout(1500); // let client-side routing land

    // If we're still on the login page, treat as failed
    const afterLoginUrl = page.url();
    const stillOnLogin = /\/auth\/login/i.test(afterLoginUrl);
    if (stillOnLogin) {
      const errMsg = await page.locator('[role="alert"], .error, .text-red-500, .text-destructive').first().innerText().catch(() => '');
      await context.close();
      return { ok: false, reason: errMsg || 'Still on login page after submit', finalUrl: afterLoginUrl };
    }

    // Navigate to the post-login page we actually want to scrape
    if (afterLoginUrl !== postUrl) {
      try { await page.goto(postUrl, { waitUntil: 'networkidle', timeout: NAV_TIMEOUT }); } catch (_) { /* stay where we are */ }
    }
    await page.waitForTimeout(800);
    const html = await page.content();
    const finalUrl = page.url();
    await context.close();
    return { ok: true, html, finalUrl };
  } catch (err) {
    await context.close();
    return { ok: false, reason: err.message.substring(0, 200) };
  }
}

function extractFromHtml(html, url) {
  const $ = cheerio.load(html);
  $('script, style, noscript, svg, iframe').remove();

  const title = cleanText($('title').first().text()) || cleanText($('meta[property="og:title"]').attr('content'));
  const description = cleanText($('meta[name="description"]').attr('content')) || cleanText($('meta[property="og:description"]').attr('content'));
  const siteName = cleanText($('meta[property="og:site_name"]').attr('content'));

  const h1s = [];
  $('h1').slice(0, 5).each((_, el) => { const t = cleanText($(el).text()); if (t) h1s.push(t); });
  const h2s = [];
  $('h2').slice(0, 15).each((_, el) => { const t = cleanText($(el).text()); if (t) h2s.push(t); });
  const h3s = [];
  $('h3').slice(0, 25).each((_, el) => { const t = cleanText($(el).text()); if (t) h3s.push(t); });

  const ctas = [];
  $('button, a[class*="btn"], a[class*="button"], a[role="button"]').each((_, el) => {
    const t = cleanText($(el).text());
    if (t && t.length > 1 && t.length < 80 && !ctas.includes(t)) ctas.push(t);
  });

  const pricingCandidates = [];
  $('*').each((_, el) => {
    const t = cleanText($(el).text());
    if (!t || t.length > 300) return;
    if (/(\$|€|£)\s*\d+|\b\d+\s*(?:USD|EUR|GBP|MXN|ARS|COP|\/mo|\/month|per month|\/year|per year|per user|\/mes|\/año)/i.test(t)) {
      if (!pricingCandidates.some(p => p.includes(t) || t.includes(p))) pricingCandidates.push(t);
    }
  });

  const trustMarkers = { testimonials_present: false, logos_present: false, compliance_mentions: [], stats_claims: [] };
  const bodyText = cleanText($('body').text());
  const lower = bodyText.toLowerCase();
  if (/testimonial|reviews|customers say|what.{1,20}customer|lo que dicen/i.test(lower)) trustMarkers.testimonials_present = true;
  if ($('img[alt*="logo" i]').length > 3 || /trusted by|used by|our customers|confian en nosotros/i.test(lower)) trustMarkers.logos_present = true;
  for (const term of ['SOC 2', 'SOC2', 'HIPAA', 'GDPR', 'ISO 27001', 'PCI DSS', 'CCPA', 'LGPD']) {
    if (new RegExp(term.replace(/\s/g, '\\s?'), 'i').test(lower)) trustMarkers.compliance_mentions.push(term);
  }
  const statsRegex = /\b(\d{1,3}(?:,\d{3})+|\d+[kmb]?\+|\d+(?:\.\d+)?%)\s+[a-záéíóúñ]+/gi;
  trustMarkers.stats_claims = [...new Set(lower.match(statsRegex) || [])].slice(0, 10);

  const features = [];
  $('h3').slice(0, 15).each((_, el) => {
    const name = cleanText($(el).text());
    const desc = cleanText($(el).next().text()).substring(0, 200);
    if (name && name.length < 80) features.push({ name, description: desc });
  });

  const navLinks = [];
  $('nav a, header a').slice(0, 25).each((_, el) => {
    const text = cleanText($(el).text());
    const href = $(el).attr('href');
    if (text && text.length > 1 && text.length < 40) navLinks.push({ text, href });
  });

  return {
    url,
    title,
    description,
    site_name: siteName,
    headings: { h1: h1s, h2: h2s, h3: h3s.slice(0, 10) },
    ctas: ctas.slice(0, 20),
    pricing_signals: pricingCandidates.slice(0, 20),
    trust_markers: trustMarkers,
    features_detected: features.slice(0, 12),
    nav_links: navLinks,
    has_faq: /frequently asked|\bfaq\b|preguntas frecuentes/i.test(lower),
    visible_text_sample: bodyText.substring(0, 4000),
  };
}

/**
 * Main entry. Optionally logs in with each auth entry and scrapes the authenticated view.
 * Returns a single merged scrape object; authenticated views attached as `auth_views[]`.
 */
async function scrapeUrl(url, { auth = [] } = {}) {
  const browser = await chromium.launch({ headless: HEADLESS });
  try {
    // Public page
    const pub = await renderPage(browser, url);
    const publicScrape = extractFromHtml(pub.html, pub.finalUrl);
    await pub.context.close();

    // Authenticated views
    const authViews = [];
    for (const entry of auth) {
      console.log(`[scraper] Logging in as ${entry.role} (${entry.email})`);
      const result = await loginAndRender(browser, url, entry);
      if (!result.ok) {
        console.log(`[scraper]   ✗ login failed for ${entry.role}: ${result.reason}`);
        authViews.push({ role: entry.role, ok: false, reason: result.reason, final_url: result.finalUrl });
        continue;
      }
      const extracted = extractFromHtml(result.html, result.finalUrl);
      console.log(`[scraper]   ✓ ${entry.role} scraped (${(extracted.visible_text_sample || '').length} chars) @ ${result.finalUrl}`);
      authViews.push({ role: entry.role, ok: true, final_url: result.finalUrl, ...extracted });
    }

    // Merge: concatenate auth view text into the main sample so downstream LLM sees everything
    const mergedSample = [
      publicScrape.visible_text_sample,
      ...authViews.filter(v => v.ok).map(v => `\n\n=== LOGGED IN AS ${v.role.toUpperCase()} (${v.final_url}) ===\n${v.visible_text_sample || ''}`),
    ].join('');

    return {
      ...publicScrape,
      visible_text_sample: mergedSample.substring(0, 12000),
      auth_views: authViews,
    };
  } finally {
    await browser.close();
  }
}

module.exports = { scrapeUrl, isUrl, parseScrapeAuthEnv };
