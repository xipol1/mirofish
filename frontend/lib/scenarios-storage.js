/**
 * Scenarios storage — thin localStorage wrapper.
 *
 * Persists saved scenarios + the current working draft so a consultant can
 * close the tab on Monday, reopen it on Wednesday, and still have their
 * half-built cohort / decision / calibration intact. No server, no auth —
 * just the browser. Good enough for piloto; add a real DB later if Dignus
 * wants cross-device sync.
 *
 * Schema:
 *   mirofish:scenarios:v1 = [{ id, name, client, updatedAt, payload }]
 *   mirofish:draft:v1     = { payload, updatedAt }
 *
 * payload = the full scenario object the editor uses (property / audience /
 * decision / calibration / scenario_name / client).
 */

const STORE_KEY = 'mirofish:scenarios:v1';
const DRAFT_KEY = 'mirofish:draft:v1';

function isBrowser() {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

function safeRead(key, fallback) {
  if (!isBrowser()) return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function safeWrite(key, value) {
  if (!isBrowser()) return false;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

function genId() {
  return 'scn_' + Math.random().toString(36).slice(2, 9) + '_' + Date.now().toString(36);
}

// ── Saved scenarios list ─────────────────────────────────────────────────

export function listScenarios() {
  const list = safeRead(STORE_KEY, []);
  // Newest first
  return [...list].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}

export function getScenario(id) {
  return listScenarios().find((s) => s.id === id) || null;
}

export function saveScenario({ id, name, client, payload }) {
  const list = safeRead(STORE_KEY, []);
  const now = Date.now();
  if (id) {
    const idx = list.findIndex((s) => s.id === id);
    if (idx >= 0) {
      list[idx] = { ...list[idx], name, client, payload, updatedAt: now };
      safeWrite(STORE_KEY, list);
      return list[idx];
    }
  }
  const newEntry = { id: genId(), name, client, payload, updatedAt: now };
  list.push(newEntry);
  safeWrite(STORE_KEY, list);
  return newEntry;
}

export function deleteScenario(id) {
  const list = safeRead(STORE_KEY, []).filter((s) => s.id !== id);
  safeWrite(STORE_KEY, list);
}

export function duplicateScenario(id) {
  const src = getScenario(id);
  if (!src) return null;
  return saveScenario({
    name: `${src.name} (copy)`,
    client: src.client,
    payload: JSON.parse(JSON.stringify(src.payload)),
  });
}

export function renameScenario(id, newName) {
  const list = safeRead(STORE_KEY, []);
  const idx = list.findIndex((s) => s.id === id);
  if (idx < 0) return null;
  list[idx] = { ...list[idx], name: newName, updatedAt: Date.now() };
  safeWrite(STORE_KEY, list);
  return list[idx];
}

// ── Current working draft ────────────────────────────────────────────────
// Auto-saved continuously so the user never loses their in-progress edit.

export function saveDraft(payload) {
  return safeWrite(DRAFT_KEY, { payload, updatedAt: Date.now() });
}

export function loadDraft() {
  const raw = safeRead(DRAFT_KEY, null);
  return raw && raw.payload ? raw : null;
}

export function clearDraft() {
  if (!isBrowser()) return;
  try { window.localStorage.removeItem(DRAFT_KEY); } catch {}
}

// ── Export / import JSON ─────────────────────────────────────────────────

export function exportAsJson(payload, { name, client } = {}) {
  const blob = new Blob(
    [JSON.stringify({ name, client, exported_at: new Date().toISOString(), payload }, null, 2)],
    { type: 'application/json' },
  );
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${(name || 'scenario').replace(/[^a-z0-9\-_]/gi, '_')}.mirofish.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export async function importFromFile(file) {
  const text = await file.text();
  const parsed = JSON.parse(text);
  // Accept either a raw payload or a wrapped { payload } export.
  const payload = parsed.payload ?? parsed;
  return { payload, name: parsed.name, client: parsed.client };
}
