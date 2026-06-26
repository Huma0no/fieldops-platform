require('dotenv').config();
const express = require('express');
const { pool } = require('./db/pool');
const { authenticate } = require('./middleware/auth');

const app = express();
app.use(express.json());

app.get('/api/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ok', db: 'connected' });
  } catch (err) {
    res.status(503).json({ status: 'error', db: 'unreachable', message: err.message });
  }
});

// Auth routes mount BEFORE global authenticate (redeem-invite is unauthenticated)
app.use('/api/auth', require('./routes/auth'));

// All routes below require a valid bearer token
app.use(authenticate);

app.use('/api/dispatch/technicians', require('./routes/technicians'));
app.use('/api/dispatch', require('./routes/dispatch'));
app.use('/api/notifications', require('./routes/notifications'));
app.use('/api/sync', require('./routes/sync'));
app.use('/api/addresses', require('./routes/addresses'));

const { visitsRouter, dispatchVisitsRouter } = require('./routes/visits');
app.use('/api/visits', visitsRouter);
app.use('/api/dispatch/visits', dispatchVisitsRouter);
app.use('/api/visits', require('./routes/workspace'));
app.use('/api/visits', require('./routes/completion'));
app.use('/api', require('./routes/transfers'));
app.use('/api/dispatch', require('./routes/history'));

// Global error handler
app.use((err, req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

const PORT = process.env.PORT || 3001;
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`FieldOps server listening on port ${PORT}`);
  });
}

module.exports = app;
