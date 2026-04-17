/**
 * Perception module — what the agent "sees" on the current page.
 *
 * Extracts:
 *   - Visible text hierarchy (headings, CTAs, prices, body)
 *   - Interactive elements (buttons, links, inputs) with selectors
 *   - Structural landmarks (nav, main, footer)
 *   - Accessibility tree (roles, labels)
 *   - Visual viewport info
 *
 * All outputs are token-budget-aware so we don't overflow the LLM context.
 */

const MAX_INTERACTIVES = 40;
const MAX_TEXT_CHARS = 3000;

async function capturePage(page, { includeAccessibility = true } = {}) {
  const url = page.url();
  const title = await page.title().catch(() => '');

  const result = await page.evaluate((MAX_INTERACTIVES) => {
    // ── Viewport + scroll state ──
    const scroll = { x: window.scrollX, y: window.scrollY };
    const viewport = { w: window.innerWidth, h: window.innerHeight };
    const doc = { w: document.documentElement.scrollWidth, h: document.documentElement.scrollHeight };
    const scrollPct = doc.h > viewport.h ? Math.round((scroll.y / (doc.h - viewport.h)) * 100) : 0;

    // ── Helper: is element visible ──
    function isVisible(el) {
      if (!el || !el.getBoundingClientRect) return false;
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) return false;
      const style = window.getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
      return true;
    }

    function isInViewport(el) {
      const r = el.getBoundingClientRect();
      return r.bottom > 0 && r.top < window.innerHeight && r.right > 0 && r.left < window.innerWidth;
    }

    function robustSelector(el) {
      // Prefer id, then data-testid, then unique role/text combo
      if (el.id && /^[a-zA-Z][\w\-]+$/.test(el.id)) return `#${el.id}`;
      const testId = el.getAttribute('data-testid') || el.getAttribute('data-test') || el.getAttribute('data-cy');
      if (testId) return `[data-testid="${testId}"]`;
      const aria = el.getAttribute('aria-label');
      if (aria && aria.length < 60) return `[aria-label="${aria.replace(/"/g, '\\"')}"]`;
      // Fall back to a path-based selector
      const parts = [];
      let e = el;
      while (e && e.nodeType === 1 && parts.length < 5) {
        let s = e.tagName.toLowerCase();
        if (e.className && typeof e.className === 'string') {
          const c = e.className.split(/\s+/).filter(x => x && x.length < 30)[0];
          if (c) s += `.${c}`;
        }
        const parent = e.parentElement;
        if (parent) {
          const sibs = Array.from(parent.children).filter(c => c.tagName === e.tagName);
          if (sibs.length > 1) s += `:nth-of-type(${sibs.indexOf(e) + 1})`;
        }
        parts.unshift(s);
        e = e.parentElement;
      }
      return parts.join(' > ');
    }

    // ── Interactive elements ──
    const interactables = [];
    const selectors = ['a[href]', 'button', 'input:not([type="hidden"])', 'select', 'textarea', '[role="button"]', '[role="link"]', '[onclick]'];
    const els = document.querySelectorAll(selectors.join(','));
    for (const el of els) {
      if (!isVisible(el)) continue;
      if (interactables.length >= MAX_INTERACTIVES) break;
      const tag = el.tagName.toLowerCase();
      const role = el.getAttribute('role') || tag;
      const text = (el.innerText || el.value || el.placeholder || '').trim().substring(0, 80);
      if (!text && !el.getAttribute('aria-label')) continue;
      const type = el.type || null;
      const inView = isInViewport(el);
      interactables.push({
        kind: tag === 'a' ? 'link' : (tag === 'button' || role === 'button') ? 'button' : (tag === 'input' || tag === 'textarea' || tag === 'select') ? 'input' : 'interactive',
        role,
        text,
        type,
        aria_label: el.getAttribute('aria-label') || null,
        placeholder: el.getAttribute('placeholder') || null,
        href: el.getAttribute('href') || null,
        in_viewport: inView,
        selector: robustSelector(el),
      });
    }

    // ── Headings hierarchy ──
    const headings = [];
    for (const h of document.querySelectorAll('h1, h2, h3, h4')) {
      if (!isVisible(h)) continue;
      const t = (h.innerText || '').trim().substring(0, 150);
      if (t) headings.push({ level: parseInt(h.tagName[1], 10), text: t, in_viewport: isInViewport(h) });
      if (headings.length >= 30) break;
    }

    // ── Visible text blocks (chunked for LLM) ──
    const visibleText = [];
    let charBudget = 3000;
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode: (node) => {
        if (!node.parentElement) return NodeFilter.FILTER_REJECT;
        const t = (node.nodeValue || '').trim();
        if (t.length < 4) return NodeFilter.FILTER_REJECT;
        if (!isVisible(node.parentElement)) return NodeFilter.FILTER_REJECT;
        const tag = node.parentElement.tagName.toLowerCase();
        if (['script', 'style', 'noscript'].includes(tag)) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      },
    });
    while (charBudget > 0) {
      const node = walker.nextNode();
      if (!node) break;
      const text = node.nodeValue.trim();
      if (!text) continue;
      const slice = text.substring(0, charBudget);
      visibleText.push(slice);
      charBudget -= slice.length;
    }

    // ── Trust signals quick scan ──
    const bodyText = document.body.innerText || '';
    const trust = {
      has_testimonials: /testimonial|customers say|our users say|\"[^"]{20,200}\"/i.test(bodyText),
      has_logos: document.querySelectorAll('img[alt*="logo" i]').length >= 3,
      has_soc2: /soc\s*2/i.test(bodyText),
      has_gdpr: /gdpr/i.test(bodyText),
      has_hipaa: /hipaa/i.test(bodyText),
      has_pricing_visible: /\$\d+|€\d+|£\d+|\/month|\/mo|\/year/i.test(bodyText),
    };

    // ── Primary CTA candidate (largest button above the fold with action text) ──
    const actionWords = /(start|try|sign ?up|get|buy|book|request|demo|free|subscribe|register|join)/i;
    let primaryCta = null;
    for (const el of interactables) {
      if (el.kind !== 'button' && el.kind !== 'link') continue;
      if (!el.in_viewport) continue;
      if (actionWords.test(el.text || '')) { primaryCta = el; break; }
    }

    return {
      scroll, scroll_pct: scrollPct, viewport, doc_size: doc,
      headings,
      interactables,
      visible_text: visibleText.join(' | ').substring(0, 3000),
      trust_signals: trust,
      primary_cta: primaryCta,
    };
  }, MAX_INTERACTIVES);

  let ariaTree = null;
  if (includeAccessibility) {
    try {
      ariaTree = await page.accessibility.snapshot({ interestingOnly: true });
    } catch (e) { /* ignore */ }
  }

  return {
    url,
    title,
    ...result,
    aria_tree: ariaTree ? summarizeAriaTree(ariaTree, 60) : null,
  };
}

function summarizeAriaTree(node, maxNodes, acc = []) {
  if (!node || acc.length >= maxNodes) return acc;
  if (node.name || node.role) {
    acc.push({ role: node.role, name: (node.name || '').substring(0, 80) });
  }
  if (node.children) {
    for (const c of node.children) summarizeAriaTree(c, maxNodes, acc);
  }
  return acc;
}

/**
 * Compresses a perception object into a text block sized for LLM prompts.
 */
function perceptionToPrompt(perception) {
  const lines = [];
  lines.push(`URL: ${perception.url}`);
  if (perception.title) lines.push(`Title: ${perception.title}`);
  lines.push(`Viewport: ${perception.viewport.w}x${perception.viewport.h} | Scroll: ${perception.scroll_pct}% of page`);

  if (perception.headings?.length) {
    lines.push('');
    lines.push('HEADINGS:');
    for (const h of perception.headings.slice(0, 15)) {
      lines.push(`  ${'  '.repeat(h.level - 1)}H${h.level}: ${h.text}${h.in_viewport ? ' [visible]' : ''}`);
    }
  }

  if (perception.visible_text) {
    lines.push('');
    lines.push('VISIBLE TEXT:');
    lines.push(perception.visible_text.substring(0, MAX_TEXT_CHARS));
  }

  if (perception.interactables?.length) {
    lines.push('');
    lines.push('INTERACTIVE ELEMENTS (use the index for actions):');
    perception.interactables.slice(0, 25).forEach((el, i) => {
      const vis = el.in_viewport ? '[visible]' : '[off-screen]';
      const label = el.text || el.aria_label || el.placeholder || '(no label)';
      const kind = el.kind.toUpperCase();
      lines.push(`  [${i}] ${kind} ${vis}: "${label.substring(0, 80)}"${el.type ? ` type=${el.type}` : ''}${el.href ? ` href=${el.href.substring(0, 60)}` : ''}`);
    });
  }

  if (perception.trust_signals) {
    const t = perception.trust_signals;
    const active = Object.entries(t).filter(([k, v]) => v).map(([k]) => k.replace('has_', ''));
    lines.push('');
    lines.push(`TRUST SIGNALS ON PAGE: ${active.join(', ') || 'none detected'}`);
  }

  return lines.join('\n');
}

module.exports = { capturePage, perceptionToPrompt };
