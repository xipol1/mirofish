/**
 * POST /api/scenario-sensitivity
 *
 * Sweeps one parameter of the decision across a range and returns the curve
 * of (short/long/net/verdict) at each step. Lets the UI draw the "breaking
 * point" chart so consultants see the inflection where the decision flips
 * from PROCEED to NOT_RECOMMENDED.
 */

import { runSensitivitySweep } from '../../lib/scenario-preview';

export default function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  try {
    const { range, steps, ...scenario } = req.body || {};
    const result = runSensitivitySweep(scenario, { range, steps });
    res.status(200).json(result);
  } catch (err) {
    res.status(500).json({ error: err.message?.substring(0, 300) || 'sensitivity failed' });
  }
}
