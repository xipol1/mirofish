/**
 * Navigator — Playwright-driven browser session with human-like interaction.
 *
 * Provides the raw "hands and eyes" — the agent's cognitive loop decides actions,
 * this module executes them realistically in a real Chromium browser.
 */

let chromium = null;
try { ({ chromium } = require('playwright')); } catch (e) { /* not installed yet */ }

const human = require('./human');

const HEADLESS = process.env.PLAYWRIGHT_HEADLESS !== 'false';
const NAV_TIMEOUT = parseInt(process.env.PLAYWRIGHT_NAV_TIMEOUT_MS, 10) || 30000;
const DEFAULT_TIMEOUT = parseInt(process.env.PLAYWRIGHT_DEFAULT_TIMEOUT_MS, 10) || 10000;

// ── User-agent pool (modern Chrome) ──
const UA_POOL = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
];

// ── Viewport pool — reflects real-world device distribution ──
const VIEWPORTS = {
  desktop: { width: 1440, height: 900 },
  laptop: { width: 1366, height: 768 },
  tablet: { width: 1024, height: 1366 },
  mobile: { width: 390, height: 844 },
};

function pickViewport(persona) {
  const preferred = persona?.device_preference;
  if (preferred && VIEWPORTS[preferred]) return VIEWPORTS[preferred];
  // Default distribution: 60% desktop-ish, 30% mobile, 10% laptop
  const r = Math.random();
  if (r < 0.6) return VIEWPORTS.desktop;
  if (r < 0.9) return VIEWPORTS.mobile;
  return VIEWPORTS.laptop;
}

async function launchBrowser() {
  if (!chromium) throw new Error('Playwright not installed. Run: npm install playwright && npx playwright install chromium');
  const browser = await chromium.launch({
    headless: HEADLESS,
    args: [
      '--disable-blink-features=AutomationControlled',
      '--disable-dev-shm-usage',
      '--no-sandbox',
    ],
  });
  return browser;
}

async function createSession(browser, persona, { recordVideo = false, videoDir = null } = {}) {
  const viewport = pickViewport(persona);
  const ua = UA_POOL[Math.floor(Math.random() * UA_POOL.length)];

  const contextOpts = {
    viewport,
    userAgent: ua,
    locale: persona?.locale || 'en-US',
    timezoneId: persona?.timezone || 'America/New_York',
    javaScriptEnabled: true,
    bypassCSP: false,
    ignoreHTTPSErrors: true,
  };
  if (recordVideo && videoDir) {
    contextOpts.recordVideo = { dir: videoDir, size: viewport };
  }

  const context = await browser.newContext(contextOpts);
  // Hide webdriver flag
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
    Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
  });

  const page = await context.newPage();
  page.setDefaultTimeout(DEFAULT_TIMEOUT);
  page.setDefaultNavigationTimeout(NAV_TIMEOUT);

  return { context, page, viewport, ua };
}

// ── Actions ──────────────────────────────────────────────────

async function goto(page, url, persona) {
  await human.sleep(human.preActionPause(persona, 'nav'));
  const startedAt = Date.now();
  try {
    const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT });
    const elapsed = Date.now() - startedAt;
    // Wait for settled network briefly
    await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
    return { ok: resp?.ok() ?? true, status: resp?.status() ?? 0, elapsed_ms: elapsed };
  } catch (err) {
    return { ok: false, error: err.message, elapsed_ms: Date.now() - startedAt };
  }
}

async function scroll(page, persona, direction = 'down') {
  await human.sleep(human.preActionPause(persona, 'scroll'));
  const dist = human.scrollDistance() * (direction === 'up' ? -1 : 1);
  await page.evaluate(async (dy) => {
    // Smooth scroll
    const steps = 10;
    const perStep = dy / steps;
    for (let i = 0; i < steps; i++) {
      window.scrollBy(0, perStep);
      await new Promise(r => setTimeout(r, 20 + Math.random() * 30));
    }
  }, dist);
  await human.sleep(human.readTime(500, persona));
}

async function clickBySelector(page, selector, persona) {
  await human.sleep(human.preActionPause(persona, 'click'));
  const el = await page.$(selector);
  if (!el) return { ok: false, error: 'selector_not_found' };
  const distract = human.maybeDistract();
  if (distract) await human.sleep(distract);

  try {
    // Hover first, then click
    await el.hover({ timeout: 3000 }).catch(() => {});
    await human.sleep(human.randRange(150, 400));
    await el.scrollIntoViewIfNeeded({ timeout: 3000 }).catch(() => {});
    await el.click({ timeout: 5000 });
    // Wait for any navigation or DOM settling
    await page.waitForLoadState('domcontentloaded', { timeout: 5000 }).catch(() => {});
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

async function clickByIndex(page, interactables, index, persona) {
  const el = interactables?.[index];
  if (!el) return { ok: false, error: 'index_out_of_range' };
  return clickBySelector(page, el.selector, persona);
}

async function typeText(page, selector, text, persona) {
  await human.sleep(human.preActionPause(persona, 'type'));
  const el = await page.$(selector);
  if (!el) return { ok: false, error: 'selector_not_found' };
  try {
    await el.scrollIntoViewIfNeeded({ timeout: 3000 }).catch(() => {});
    await el.click({ timeout: 3000 }).catch(() => {});
    await human.sleep(human.randRange(150, 400));

    const rate = human.typoRate(persona);
    for (const ch of text) {
      if (Math.random() < rate && /[a-zA-Z]/.test(ch)) {
        // Type a typo then correct
        await page.keyboard.type(human.typoFor(ch));
        await human.sleep(human.randRange(80, 200));
        await page.keyboard.press('Backspace');
        await human.sleep(human.randRange(60, 180));
      }
      await page.keyboard.type(ch);
      await human.sleep(human.typingKeystrokeDelay(persona));
    }
    await human.sleep(human.postInputReviewPause(persona));
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

async function pressKey(page, key, persona) {
  await human.sleep(human.preActionPause(persona, 'type'));
  await page.keyboard.press(key);
  await page.waitForLoadState('domcontentloaded', { timeout: 5000 }).catch(() => {});
  return { ok: true };
}

async function goBack(page, persona) {
  await human.sleep(human.preActionPause(persona, 'nav'));
  try {
    await page.goBack({ waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

async function screenshot(page) {
  try {
    return await page.screenshot({ type: 'jpeg', quality: 72, fullPage: false });
  } catch (err) {
    return null;
  }
}

async function fullPageScreenshot(page) {
  try {
    return await page.screenshot({ type: 'jpeg', quality: 68, fullPage: true });
  } catch (err) {
    return null;
  }
}

async function domSnapshot(page) {
  try {
    return await page.content();
  } catch (err) {
    return null;
  }
}

async function closeSession({ context, page }) {
  try { await page.close(); } catch (e) { /* ignore */ }
  try { await context.close(); } catch (e) { /* ignore */ }
}

module.exports = {
  launchBrowser,
  createSession,
  closeSession,
  goto,
  scroll,
  clickBySelector,
  clickByIndex,
  typeText,
  pressKey,
  goBack,
  screenshot,
  fullPageScreenshot,
  domSnapshot,
};
