/**
 * Cyber Swarm orchestrator — routes to demo or real engine based on mode.
 */

const { runDemoSimulation } = require('./demo-engine');
const { runRealSimulation } = require('./real-engine');

async function runCyberSimulation({ targetUrl, mode = 'demo', totalAgents = 500, authorized, acknowledgement, durationMs, onProgress }) {
  if (mode === 'real') {
    return runRealSimulation({ targetUrl, authorized, acknowledgement, onProgress });
  }
  return runDemoSimulation({ targetUrl, totalAgents, durationMs, onProgress });
}

module.exports = { runCyberSimulation };
