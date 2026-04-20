/**
 * POST /api/competitor-matrix
 *
 * Runs a 3×3 competitor-reaction game-theory matrix: your 3 rate options
 * crossed with 3 competitor reactions. Returns the matrix + dominant
 * strategy (maximin) + Nash equilibrium (if any).
 */

import { runCompetitorMatrix } from '../../lib/scenario-preview';

export default function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  try {
    const { yourOptions, competitorReactions, ...scenario } = req.body || {};
    const result = runCompetitorMatrix(scenario, { yourOptions, competitorReactions });
    res.status(200).json(result);
  } catch (err) {
    res.status(500).json({ error: err.message?.substring(0, 300) || 'matrix failed' });
  }
}
