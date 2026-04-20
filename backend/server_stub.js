#!/usr/bin/env node
/**
 * HTTP backend with ai.js swapped for the deterministic Claude-synth stub.
 * Serves the same API as server.js (routes, /api/stay-simulate-direct, etc.)
 * but every LLM call is answered in-process without hitting Groq / Claude /
 * Ollama — ultra-fast and rate-limit-free.
 */

require('dotenv').config();

const path = require('path');
const Module = require('module');

const stubPath = path.resolve(__dirname, 'services', 'ai_claude_synth.js');
const origResolve = Module._resolveFilename;
Module._resolveFilename = function(request, parent, ...rest) {
  if ((request === './ai' || request === '../ai' || request.endsWith('/services/ai'))
      && parent && parent.filename && parent.filename.includes('backend')) {
    return stubPath;
  }
  return origResolve.call(this, request, parent, ...rest);
};

// Boot the real server — it will now transparently use the stub for AI calls.
require('./server.js');
