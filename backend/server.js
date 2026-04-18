require('dotenv').config();
const express = require('express');
const cors = require('cors');
const simulationRoutes = require('./routes/simulation');
const calibrationRoutes = require('./routes/calibration');
const enterpriseRoutes = require('./routes/enterprise');
const cybersecurityRoutes = require('./routes/cybersecurity');
const db = require('./db/pg');

const app = express();
const PORT = process.env.PORT || 5001;

app.use(cors());
app.use(express.json({ limit: '10mb' }));

app.use('/api', simulationRoutes);
app.use('/api', calibrationRoutes);
app.use('/api', enterpriseRoutes);
app.use('/api', cybersecurityRoutes);
app.use('/api', require('./routes/properties'));

// Run PG migrations on boot (no-op if DATABASE_URL unset)
db.migrate().catch(err => console.error('[pg] migration error:', err.message));

// Preload datasets (samples always; real datasets if downloaded)
try {
  const datasets = require('./services/datasets');
  const s = datasets.preloadAll();
  console.log('[datasets] Preload complete:', JSON.stringify(s.cache_sizes));
} catch (err) {
  console.error('[datasets] preload failed:', err.message);
}

app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.listen(PORT, () => {
  console.log(`Synthetic Users API running on http://localhost:${PORT}`);
});
