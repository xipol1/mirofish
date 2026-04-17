/**
 * Review Scraper — ingests reviews from web sources into `reviews_ingested`.
 *
 * Uses Playwright (already part of the stack). Handles:
 *   - TripAdvisor property pages
 *   - Booking.com property pages (limited — anti-bot heavy)
 *   - Google Maps reviews (via Place API recommended for prod; scraper fallback here)
 *
 * The scrapers are best-effort; anti-bot may block. When blocked, returns whatever
 * was captured and logs the failure — customers can also upload reviews manually.
 */

let chromium = null;
try { ({ chromium } = require('playwright')); } catch (e) { /* not installed */ }

async function scrapeTripAdvisor(urlOrSlug, { limit = 50, onProgress = () => {} } = {}) {
  if (!chromium) throw new Error('Playwright not installed');
  const url = urlOrSlug.startsWith('http') ? urlOrSlug : `https://www.tripadvisor.com/Hotel_Review-${urlOrSlug}`;

  const browser = await chromium.launch({ headless: true, args: ['--disable-blink-features=AutomationControlled', '--no-sandbox'] });
  const reviews = [];
  try {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      locale: 'en-US',
    });
    const page = await context.newPage();
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 40000 });
    await page.waitForTimeout(3000);

    let pageNum = 0;
    while (reviews.length < limit && pageNum < 10) {
      // TripAdvisor review card selectors (may change; best effort)
      const cards = await page.$$eval('div[data-test-target="HR_CC_CARD"], div[data-automation="reviewCard"]', nodes =>
        nodes.map(n => {
          const title = n.querySelector('[data-test-target="review-title"] span, .noQuotes, [data-automation="reviewTitle"]')?.textContent?.trim() || '';
          const body = n.querySelector('[data-test-target="review-body"] span, .partial_entry, [data-automation="reviewText"]')?.textContent?.trim() || '';
          const ratingEl = n.querySelector('[data-test-target="review-rating"] svg title, [data-automation="bubbleRatingImage"] span');
          const ratingText = ratingEl?.textContent || '';
          const ratingMatch = ratingText.match(/([\d.]+) of 5/) || ratingText.match(/([\d.]+)/);
          const rating = ratingMatch ? parseFloat(ratingMatch[1]) : null;
          return { title, body, rating };
        })
      ).catch(() => []);

      for (const c of cards) {
        if (!c.body || c.body.length < 20) continue;
        reviews.push({
          source: 'tripadvisor',
          source_url: url,
          title: c.title.substring(0, 200),
          body: c.body.substring(0, 4000),
          rating_numeric: c.rating,
          rating_scale: 5,
          scraped_at: new Date().toISOString(),
        });
        if (reviews.length >= limit) break;
      }
      onProgress({ collected: reviews.length, page: pageNum });

      // Try to click "Next" to continue
      const nextBtn = await page.$('a[aria-label="Next page"], a.nav.next');
      if (!nextBtn) break;
      await Promise.all([
        page.waitForLoadState('domcontentloaded', { timeout: 15000 }).catch(() => {}),
        nextBtn.click().catch(() => {}),
      ]);
      await page.waitForTimeout(2000);
      pageNum++;
    }
  } finally {
    try { await browser.close(); } catch (e) { /* ignore */ }
  }
  return reviews;
}

async function scrapeBookingCom(url, { limit = 50, onProgress = () => {} } = {}) {
  if (!chromium) throw new Error('Playwright not installed');
  const browser = await chromium.launch({ headless: true, args: ['--disable-blink-features=AutomationControlled', '--no-sandbox'] });
  const reviews = [];
  try {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    });
    const page = await context.newPage();
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 40000 });
    await page.waitForTimeout(2000);

    const items = await page.$$eval('[data-testid="review-card"], [data-component="review-card"]', nodes =>
      nodes.map(n => {
        const title = n.querySelector('[data-testid="review-title"]')?.textContent?.trim() || '';
        const positive = n.querySelector('[data-testid="review-positive-text"]')?.textContent?.trim() || '';
        const negative = n.querySelector('[data-testid="review-negative-text"]')?.textContent?.trim() || '';
        const score = parseFloat(n.querySelector('[data-testid="review-score"]')?.textContent || '0');
        return { title, body: [positive, negative ? `Dislike: ${negative}` : ''].filter(Boolean).join(' — '), rating: score };
      })
    ).catch(() => []);

    for (const c of items.slice(0, limit)) {
      if (c.body && c.body.length > 10) {
        reviews.push({
          source: 'booking',
          source_url: url,
          title: c.title || null,
          body: c.body.substring(0, 4000),
          rating_numeric: c.rating,
          rating_scale: 10,
          scraped_at: new Date().toISOString(),
        });
      }
    }
    onProgress({ collected: reviews.length });
  } finally {
    try { await browser.close(); } catch (e) { /* ignore */ }
  }
  return reviews;
}

async function scrapeGoogleMaps(url, { limit = 50 } = {}) {
  if (!chromium) throw new Error('Playwright not installed');
  const browser = await chromium.launch({ headless: true, args: ['--disable-blink-features=AutomationControlled', '--no-sandbox'] });
  const reviews = [];
  try {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    });
    const page = await context.newPage();
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 40000 });
    await page.waitForTimeout(4000);

    const items = await page.$$eval('.jftiEf', nodes =>
      nodes.map(n => {
        const body = n.querySelector('.wiI7pd')?.textContent?.trim() || '';
        const ratingText = n.querySelector('.kvMYJc')?.getAttribute('aria-label') || '';
        const match = ratingText.match(/([\d.]+) star/);
        return { body, rating: match ? parseFloat(match[1]) : null };
      })
    ).catch(() => []);

    for (const c of items.slice(0, limit)) {
      if (c.body && c.body.length > 10) {
        reviews.push({
          source: 'google',
          source_url: url,
          title: null,
          body: c.body.substring(0, 4000),
          rating_numeric: c.rating,
          rating_scale: 5,
          scraped_at: new Date().toISOString(),
        });
      }
    }
  } finally {
    try { await browser.close(); } catch (e) { /* ignore */ }
  }
  return reviews;
}

/**
 * Dispatcher: choose scraper based on URL.
 */
async function scrape(url, opts = {}) {
  const u = String(url).toLowerCase();
  if (u.includes('tripadvisor.')) return scrapeTripAdvisor(url, opts);
  if (u.includes('booking.com')) return scrapeBookingCom(url, opts);
  if (u.includes('google.com/maps') || u.includes('maps.google')) return scrapeGoogleMaps(url, opts);
  throw new Error('Unsupported review source URL. Use TripAdvisor, Booking.com, or Google Maps.');
}

module.exports = { scrape, scrapeTripAdvisor, scrapeBookingCom, scrapeGoogleMaps };
