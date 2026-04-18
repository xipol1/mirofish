/**
 * AI Provider Multiplexer
 *
 * Priority: Groq (free, fast, large model) > Claude (paid, top quality) > Ollama (local)
 * Exposes callAI(prompt) and callAIJSON(prompt) with consistent interface.
 */

const GROQ_API_KEY = process.env.GROQ_API_KEY;
const CLAUDE_API_KEY = process.env.CLAUDE_API_KEY;
const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'qwen2.5:3b';
const GROQ_MODEL = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';

function hasValidKey(key) {
  return key && key.length > 10 && !key.includes('your-key-here');
}

let provider = 'none';
if (process.env.USE_OLLAMA === 'true') provider = 'ollama';
else if (hasValidKey(GROQ_API_KEY)) provider = 'groq';
else if (hasValidKey(CLAUDE_API_KEY)) provider = 'claude';
else provider = 'ollama';

console.log(`[AI] Provider selected: ${provider} (model: ${
  provider === 'groq' ? GROQ_MODEL :
  provider === 'ollama' ? OLLAMA_MODEL :
  provider === 'claude' ? 'claude-sonnet-4-20250514' : 'none'
})`);

// ─────────────────────────────────────────────────────────────
// GROQ
// ─────────────────────────────────────────────────────────────
async function callGroq(prompt, options = {}, attempt = 0) {
  const { maxTokens = 4096, temperature = 0.7, system = null } = options;

  const messages = [];
  if (system) messages.push({ role: 'system', content: system });
  messages.push({ role: 'user', content: prompt });

  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${GROQ_API_KEY}`,
    },
    body: JSON.stringify({
      model: GROQ_MODEL,
      messages,
      max_tokens: maxTokens,
      temperature,
    }),
  });

  if (res.status === 429 && attempt < 5) {
    // Respect Retry-After header, or parse from message body
    const retryAfterHeader = res.headers.get('retry-after');
    const bodyText = await res.text();
    const bodyMatch = bodyText.match(/try again in ([\d.]+)s/i);
    const waitMs = retryAfterHeader
      ? parseFloat(retryAfterHeader) * 1000
      : bodyMatch
        ? Math.ceil(parseFloat(bodyMatch[1]) * 1000)
        : Math.min(2000 * Math.pow(2, attempt), 30000);

    console.log(`[AI] Groq rate limited, waiting ${Math.round(waitMs / 1000)}s (attempt ${attempt + 1}/5)`);
    await new Promise(r => setTimeout(r, waitMs + 200));
    return callGroq(prompt, options, attempt + 1);
  }

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Groq API error ${res.status}: ${text.substring(0, 300)}`);
  }

  const data = await res.json();
  return data.choices[0].message.content;
}

// ─────────────────────────────────────────────────────────────
// CLAUDE
// ─────────────────────────────────────────────────────────────
let anthropicClient = null;
function getAnthropicClient() {
  if (!anthropicClient) {
    const Anthropic = require('@anthropic-ai/sdk');
    anthropicClient = new Anthropic({ apiKey: CLAUDE_API_KEY });
  }
  return anthropicClient;
}

async function callClaudeAPI(prompt, options = {}) {
  const { maxTokens = 4096, temperature = 0.7, system = null } = options;

  const params = {
    model: 'claude-sonnet-4-20250514',
    max_tokens: maxTokens,
    temperature,
    messages: [{ role: 'user', content: prompt }],
  };
  if (system) params.system = system;

  const client = getAnthropicClient();
  const response = await client.messages.create(params);
  return response.content[0].text;
}

// ─────────────────────────────────────────────────────────────
// OLLAMA
// ─────────────────────────────────────────────────────────────
async function callOllama(prompt, options = {}) {
  const { temperature = 0.7, system = null } = options;

  const res = await fetch(`${OLLAMA_URL}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: OLLAMA_MODEL,
      prompt,
      system: system || undefined,
      stream: false,
      options: { temperature, num_predict: 4096, num_ctx: 8192 },
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Ollama error ${res.status}: ${text}`);
  }

  const data = await res.json();
  return data.response;
}

// ─────────────────────────────────────────────────────────────
// UNIFIED INTERFACE
// ─────────────────────────────────────────────────────────────
async function callAI(prompt, options = {}) {
  if (provider === 'groq') return callGroq(prompt, options);
  if (provider === 'claude') return callClaudeAPI(prompt, options);
  if (provider === 'ollama') return callOllama(prompt, options);
  throw new Error('No AI provider configured');
}

function extractJSON(raw) {
  let cleaned = String(raw).trim();

  // Direct parse
  try { return JSON.parse(cleaned); } catch (e) { /* continue */ }

  // Common small-LLM mistake: wrapping object body in [] instead of {}.
  // Detect `[ "key": value, ... ]` and swap to `{ "key": value, ... }`.
  if (/^\[\s*"[^"]+"\s*:/.test(cleaned)) {
    const swapped = '{' + cleaned.slice(1, cleaned.lastIndexOf(']')) + '}';
    try { return JSON.parse(swapped); } catch (e) { /* continue */ }
    // Try also without trimming the final ] (malformed close)
    try { return JSON.parse(cleaned.replace(/^\[/, '{').replace(/\]\s*$/, '}')); } catch (e) { /* continue */ }
  }

  // Markdown fence extraction
  const fenceMatch = cleaned.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
  if (fenceMatch) {
    try { return JSON.parse(fenceMatch[1].trim()); } catch (e) { /* continue */ }
    // Also try the [ → { swap on the fenced content
    const fenced = fenceMatch[1].trim();
    if (/^\[\s*"[^"]+"\s*:/.test(fenced)) {
      try { return JSON.parse('{' + fenced.slice(1, fenced.lastIndexOf(']')) + '}'); } catch (e) { /* continue */ }
    }
  }

  // JSON object/array detection
  const firstBrace = cleaned.search(/[\[{]/);
  if (firstBrace !== -1) {
    // Find matching closing brace
    const openChar = cleaned[firstBrace];
    const closeChar = openChar === '[' ? ']' : '}';
    let depth = 0;
    let endIdx = -1;
    let inString = false;
    let escaped = false;

    for (let i = firstBrace; i < cleaned.length; i++) {
      const c = cleaned[i];
      if (escaped) { escaped = false; continue; }
      if (c === '\\') { escaped = true; continue; }
      if (c === '"') { inString = !inString; continue; }
      if (inString) continue;
      if (c === openChar) depth++;
      else if (c === closeChar) {
        depth--;
        if (depth === 0) { endIdx = i; break; }
      }
    }

    if (endIdx !== -1) {
      try { return JSON.parse(cleaned.slice(firstBrace, endIdx + 1)); } catch (e) { /* continue */ }
    }

    // Last resort: slice to last brace
    const lastClose = Math.max(cleaned.lastIndexOf(']'), cleaned.lastIndexOf('}'));
    if (lastClose > firstBrace) {
      try { return JSON.parse(cleaned.slice(firstBrace, lastClose + 1)); } catch (e) { /* continue */ }
    }
  }

  throw new Error(`Failed to parse JSON from AI response: ${cleaned.substring(0, 300)}`);
}

async function callAIJSON(prompt, options = {}, retries = 2) {
  const jsonInstruction = '\n\nOUTPUT FORMAT: Return ONLY valid JSON. No markdown fences, no explanation, no preamble. Start your response with [ or { directly and end with ] or }.';

  let lastError;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const raw = await callAI(prompt + jsonInstruction, options);
      return extractJSON(raw);
    } catch (err) {
      lastError = err;
      console.error(`[AI] JSON attempt ${attempt + 1}/${retries + 1} failed: ${err.message.substring(0, 120)}`);
      if (attempt < retries) {
        await new Promise(r => setTimeout(r, 500));
      }
    }
  }
  throw lastError;
}

function getProvider() {
  return provider;
}

function getCohortSize() {
  return parseInt(process.env.AGENT_COUNT, 10) || 3;
}

module.exports = { callAI, callAIJSON, getProvider, getCohortSize, extractJSON };
