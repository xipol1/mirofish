const express = require('express');
const db = require('../services/db');

const router = express.Router();

// POST /api/calibration/:id
// Body: { metric_key, predicted_value, actual_value, change_implemented, notes }
router.post('/calibration/:id', (req, res) => {
  const simulationId = req.params.id;
  const { metric_key, predicted_value, actual_value, change_implemented, notes } = req.body;

  if (!metric_key) return res.status(400).json({ error: 'metric_key is required' });

  const sim = db.getSimulation(simulationId);
  if (!sim) return res.status(404).json({ error: 'Simulation not found' });

  try {
    db.addCalibration({
      simulationId,
      metricKey: metric_key,
      predictedValue: predicted_value,
      actualValue: actual_value,
      changeImplemented: change_implemented,
      notes,
    });
    res.json({ ok: true });
  } catch (err) {
    console.error('[calibration] error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/calibration/:id — list feedback for a simulation
router.get('/calibration/:id', (req, res) => {
  const rows = db.getCalibrationsForSim(req.params.id);
  res.json({ calibrations: rows });
});

// GET /api/calibration-stats — aggregate stats across all feedback
router.get('/calibration-stats', (req, res) => {
  res.json({ stats: db.getCalibrationStats() });
});

module.exports = router;
