/**
 * Auth Pre-Journey — logs an agent into the test site before the evaluation begins.
 *
 * Modes:
 *   1. env_credentials  — reads SCRAPE_AUTH_* env vars, logs in via form autodetect
 *   2. manual_script    — executes a custom login script (for complex flows / SSO)
 *   3. stored_cookies   — injects pre-saved cookies (fastest, requires upload)
 *   4. none             — no auth needed
 *
 * Credential env format:
 *   SCRAPE_AUTH_<SLUG>=role:email:password[,role2:email2:password2]
 */

const human = require('./human');

/**
 * Parse SCRAPE_AUTH_* env var.
 *   "creator:email:pw,advertiser:email:pw"
 */
function parseCreds(envValue) {
  if (!envValue) return [];
  return envValue.split(',').map(tuple => {
    const parts = tuple.trim().split(':');
    if (parts.length < 3) return null;
    const [role, email, ...passParts] = parts;
    return { role: role.trim(), email: email.trim(), password: passParts.join(':').trim() };
  }).filter(Boolean);
}

function getCredentialsForSite(siteSlug, { role } = {}) {
  const key = `SCRAPE_AUTH_${siteSlug.toUpperCase()}`;
  const creds = parseCreds(process.env[key]);
  if (creds.length === 0) return null;
  if (role) return creds.find(c => c.role === role) || creds[0];
  return creds[0];
}

/**
 * Try autodetecting login form and filling it.
 * Works for most form-based login flows.
 */
async function loginWithForm(page, { loginUrl, email, password, persona }) {
  await page.goto(loginUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});

  // Find email field
  const emailSelectors = [
    'input[type="email"]',
    'input[name="email"]',
    'input[name="username"]',
    'input[id="email"]',
    'input[autocomplete="email"]',
    'input[autocomplete="username"]',
  ];
  let emailField = null;
  for (const sel of emailSelectors) {
    emailField = await page.$(sel);
    if (emailField) break;
  }

  // Find password field
  const passwordField = await page.$('input[type="password"]');

  if (!emailField || !passwordField) {
    return { ok: false, error: 'login form not detected' };
  }

  // Type email (with slight human-like delay)
  await emailField.click({ delay: 50 });
  await human.sleep(human.randRange(200, 500));
  for (const ch of email) {
    await page.keyboard.type(ch, { delay: human.typingKeystrokeDelay(persona) });
  }

  await human.sleep(human.randRange(300, 800));

  // Type password
  await passwordField.click({ delay: 50 });
  await human.sleep(human.randRange(200, 500));
  for (const ch of password) {
    await page.keyboard.type(ch, { delay: human.typingKeystrokeDelay(persona) });
  }

  await human.sleep(human.postInputReviewPause(persona));

  // Find submit button
  const submitSelectors = [
    'button[type="submit"]',
    'input[type="submit"]',
    'button:has-text("Sign in")',
    'button:has-text("Log in")',
    'button:has-text("Login")',
    'button:has-text("Entrar")',
    'button:has-text("Iniciar sesión")',
  ];

  let submitted = false;
  for (const sel of submitSelectors) {
    const btn = await page.$(sel).catch(() => null);
    if (btn) {
      await Promise.all([
        page.waitForLoadState('domcontentloaded', { timeout: 15000 }).catch(() => {}),
        btn.click({ timeout: 3000 }).catch(() => {}),
      ]);
      submitted = true;
      break;
    }
  }

  if (!submitted) {
    // Fallback: press Enter
    await passwordField.press('Enter');
    await page.waitForLoadState('domcontentloaded', { timeout: 15000 }).catch(() => {});
  }

  await human.sleep(1500);
  const currentUrl = page.url();
  const success = !currentUrl.includes('login') && !currentUrl.includes('signin');
  return { ok: success, url: currentUrl };
}

/**
 * Entry point used by the journey runner.
 */
async function doAuthPrejourney({ page, authConfig, persona }) {
  if (!authConfig || authConfig.mode === 'none') return { skipped: true };

  if (authConfig.mode === 'env_credentials') {
    const creds = getCredentialsForSite(authConfig.site_slug, { role: authConfig.role });
    if (!creds) return { ok: false, error: `no credentials for site ${authConfig.site_slug}` };
    return loginWithForm(page, {
      loginUrl: authConfig.login_url,
      email: creds.email,
      password: creds.password,
      persona,
    });
  }

  if (authConfig.mode === 'manual_script' && typeof authConfig.script === 'function') {
    try {
      await authConfig.script({ page });
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }

  if (authConfig.mode === 'stored_cookies' && Array.isArray(authConfig.cookies)) {
    await page.context().addCookies(authConfig.cookies);
    return { ok: true, cookies_added: authConfig.cookies.length };
  }

  return { ok: false, error: 'unknown auth mode' };
}

module.exports = { doAuthPrejourney, parseCreds, getCredentialsForSite, loginWithForm };
