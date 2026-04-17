/**
 * Human-timing library — generates realistic delays, typing patterns, and movement.
 *
 * Everything here is stochastic but bounded. The intent is to defeat naive bot
 * detection AND to produce journeys that look authentic in screenshots/video.
 */

function randRange(min, max) {
  return Math.floor(Math.random() + min + Math.random() * (max - min));
}

function gaussian(mean, stddev) {
  // Box-Muller
  const u = 1 - Math.random();
  const v = Math.random();
  return mean + stddev * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function clamp(n, min, max) { return Math.max(min, Math.min(max, n)); }

/**
 * Pre-action pause (reading/thinking before acting).
 * Scales with patience: less patient users pause less.
 */
function preActionPause(persona, type = 'click') {
  const patience = persona?.traits?.patience ?? 0.5;
  const base = { click: 600, type: 400, scroll: 250, hover: 200, nav: 1000 }[type] || 500;
  const mean = base * (0.5 + patience);
  const delay = clamp(gaussian(mean, mean * 0.3), 80, 4000);
  return Math.round(delay);
}

/**
 * Typing delay between keystrokes (ms).
 * Based on WPM (words per minute), with gaussian jitter.
 * Low tech_savviness users type slower and make more typos.
 */
function typingKeystrokeDelay(persona) {
  const techSav = persona?.traits?.tech_savviness ?? 0.6;
  const wpm = 30 + techSav * 60;  // 30-90 WPM
  const meanMs = 60000 / (wpm * 5); // 5 chars per word average
  return clamp(Math.round(gaussian(meanMs, meanMs * 0.35)), 30, 500);
}

/**
 * Typo probability per keystroke.
 */
function typoRate(persona) {
  const techSav = persona?.traits?.tech_savviness ?? 0.6;
  return clamp(0.04 - techSav * 0.03, 0.005, 0.06);
}

/**
 * Read-time delay (ms) — how long the user "reads" before scrolling/clicking.
 * Depends on text length + patience.
 */
function readTime(textLength = 200, persona) {
  const patience = persona?.traits?.patience ?? 0.5;
  const wordsEstimate = textLength / 5;
  const baseWpm = 200 + patience * 200; // 200-400 wpm reading speed
  const readMs = (wordsEstimate / baseWpm) * 60000;
  return Math.round(clamp(readMs, 400, 15000));
}

/**
 * Probability the agent abandons at this step given current affect state.
 */
function abandonmentProbability(affect, persona) {
  const patience = persona?.traits?.patience ?? 0.5;
  const frust = affect.frustration || 0;
  const conf = affect.confusion || 0;
  const energy = affect.energy || 1;
  // Frustration above tolerance + low energy → exit
  const raw = (frust - patience) * 0.4 + conf * 0.2 + (1 - energy) * 0.15;
  return clamp(raw, 0, 0.95);
}

/**
 * Scroll distance (px) sampled from human patterns.
 */
function scrollDistance() {
  // Most scrolls are short; occasional long scroll
  if (Math.random() < 0.2) return randRange(800, 2000);
  return randRange(150, 600);
}

/**
 * Occasional distraction: micro-pause as if the user looked away.
 */
function maybeDistract() {
  if (Math.random() < 0.08) return randRange(2000, 6000);
  return 0;
}

/**
 * Delay between typing and pressing submit/next.
 * Humans pause to review.
 */
function postInputReviewPause(persona) {
  const patience = persona?.traits?.patience ?? 0.5;
  return clamp(Math.round(gaussian(1200 * (0.5 + patience), 400)), 300, 5000);
}

/**
 * Generate a typo for a given character.
 */
function typoFor(ch) {
  const adjacent = {
    a: 'sqwz', b: 'vghn', c: 'xdfv', d: 'serfc', e: 'wrsdf', f: 'drcvgt',
    g: 'ftyhb', h: 'gyujn', i: 'ujko', j: 'hnmuik', k: 'jmiol', l: 'kop',
    m: 'njk', n: 'bhjm', o: 'iklp', p: 'ol', q: 'wa', r: 'edft',
    s: 'awedxz', t: 'rfgy', u: 'yhji', v: 'cfgb', w: 'qeas', x: 'zsdc',
    y: 'tghu', z: 'asx',
  };
  const lower = ch.toLowerCase();
  const neighbors = adjacent[lower];
  if (!neighbors) return ch;
  const pick = neighbors[Math.floor(Math.random() * neighbors.length)];
  return ch === lower ? pick : pick.toUpperCase();
}

/**
 * Sleep helper.
 */
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

module.exports = {
  preActionPause,
  typingKeystrokeDelay,
  typoRate,
  readTime,
  abandonmentProbability,
  scrollDistance,
  maybeDistract,
  postInputReviewPause,
  typoFor,
  sleep,
  randRange,
  gaussian,
  clamp,
};
