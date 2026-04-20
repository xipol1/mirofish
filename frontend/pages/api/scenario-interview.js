/**
 * POST /api/scenario-interview
 *
 * Takes a consultant's free-form question plus a target (archetype, cluster)
 * and returns an in-character response generated from the offline Q&A pool.
 * Deterministic — same question → same answer, guaranteeing live demos work
 * without API keys or latency.
 */

import { generateInterviewAnswer } from '../../lib/scenario-preview';

export default function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  try {
    const { question, archetype, cluster } = req.body || {};
    const result = generateInterviewAnswer({
      question: question || '',
      archId: archetype || 'luxury_seeker',
      clusterId: cluster || 'anglo_uk_ireland',
    });
    res.status(200).json(result);
  } catch (err) {
    res.status(500).json({ error: err.message?.substring(0, 300) || 'interview failed' });
  }
}
