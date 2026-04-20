/**
 * POST /api/scenario-preview
 *
 * Next.js serverless function wrapping the formula-based preview engine.
 * Used in production (Vercel) so the scenario editor doesn't require a
 * separately-deployed backend. Same contract as the Express route in
 * backend/routes/properties.js — same inputs, same outputs.
 */

import { computeScenarioPreview } from '../../lib/scenario-preview';

export default function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  try {
    const preview = computeScenarioPreview(req.body || {});
    res.status(200).json(preview);
  } catch (err) {
    res.status(500).json({ error: err.message?.substring(0, 300) || 'preview failed' });
  }
}
