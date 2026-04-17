export default function handler(req, res) {
  const hasOllama = !!process.env.OLLAMA_URL;
  const hasClaude = process.env.CLAUDE_API_KEY && process.env.CLAUDE_API_KEY !== 'sk-ant-your-key-here';

  res.json({
    mode: hasClaude ? 'full' : 'demo',
    provider: hasClaude ? 'claude' : hasOllama ? 'ollama' : 'demo',
    agents: hasClaude ? 25 : 3,
  });
}
