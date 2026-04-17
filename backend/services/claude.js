const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'qwen2.5:3b';
const USE_OLLAMA = process.env.USE_OLLAMA === 'true' || !process.env.CLAUDE_API_KEY || process.env.CLAUDE_API_KEY === 'sk-ant-your-key-here';

let anthropicClient = null;

function getAnthropicClient() {
  if (!anthropicClient) {
    const Anthropic = require('@anthropic-ai/sdk');
    anthropicClient = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });
  }
  return anthropicClient;
}

async function callOllama(prompt, options = {}) {
  const { temperature = 0.7 } = options;

  const res = await fetch(`${OLLAMA_URL}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: OLLAMA_MODEL,
      prompt,
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

async function callClaudeAPI(prompt, options = {}) {
  const { maxTokens = 4096, temperature = 0.7 } = options;
  const client = getAnthropicClient();

  const response = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: maxTokens,
    temperature,
    messages: [{ role: 'user', content: prompt }],
  });

  return response.content[0].text;
}

async function callClaude(prompt, options = {}) {
  if (USE_OLLAMA) {
    console.log(`[AI] Using Ollama (${OLLAMA_MODEL})`);
    return callOllama(prompt, options);
  }
  console.log('[AI] Using Claude API');
  return callClaudeAPI(prompt, options);
}

function extractJSON(raw) {
  const cleaned = raw.trim();

  // Direct parse
  try {
    return JSON.parse(cleaned);
  } catch (e) { /* continue */ }

  // Extract from markdown fence
  const fenceMatch = cleaned.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
  if (fenceMatch) {
    try { return JSON.parse(fenceMatch[1].trim()); } catch (e) { /* continue */ }
  }

  // Find JSON array or object
  const jsonStart = cleaned.search(/[\[{]/);
  const jsonEnd = Math.max(cleaned.lastIndexOf(']'), cleaned.lastIndexOf('}'));
  if (jsonStart !== -1 && jsonEnd !== -1 && jsonEnd > jsonStart) {
    try { return JSON.parse(cleaned.slice(jsonStart, jsonEnd + 1)); } catch (e) { /* continue */ }
  }

  throw new Error(`Failed to parse JSON from AI response: ${cleaned.substring(0, 300)}`);
}

async function callClaudeJSON(prompt, options = {}, retries = 2) {
  const jsonInstruction = '\n\nCRITICAL: You MUST return ONLY valid JSON. No markdown fences, no explanation, no text before or after the JSON. Start your response with [ or { directly.';

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const raw = await callClaude(prompt + jsonInstruction, options);
      return extractJSON(raw);
    } catch (err) {
      console.error(`[AI] JSON parse attempt ${attempt + 1} failed: ${err.message.substring(0, 100)}`);
      if (attempt === retries) throw err;
      console.log('[AI] Retrying with simplified prompt...');
    }
  }
}

module.exports = { callClaude, callClaudeJSON, USE_OLLAMA };
