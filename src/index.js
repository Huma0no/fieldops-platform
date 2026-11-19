require('dotenv').config();
const express = require('express');
const rateLimit = require('express-rate-limit');
const { pool } = require('./db/pool');
const { authenticate, requirePasswordChanged, requireRole } = require('./middleware/auth');

const app = express();
// Behind a reverse proxy, rate limits must key on the client IP, not the proxy's.
// TRUST_PROXY = number of proxies in front of the server; unset = direct exposure.
const trustProxyHops = Number(process.env.TRUST_PROXY);
if (trustProxyHops > 0) app.set('trust proxy', trustProxyHops);
// No CORS: FieldOps and Dispatch are served from the API's own origin (pilot)
// or through the Vite dev proxy, so only same-origin requests are allowed (C7).
app.use(express.json());

// Only sign-in is rate limited (password guessing). Authenticated routes have
// no per-IP cap: Dispatch polling and a technician's uploads share an IP and
// must not lock each other out (CC-18).
const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 10 });

app.get('/api/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ok', db: 'connected' });
  } catch (err) {
    res.status(503).json({ status: 'error', db: 'unreachable', message: err.message });
  }
});

// Authentication routes include the public login and their own authenticated handlers.
app.post('/api/auth/login', loginLimiter);
app.use('/api/auth', require('./routes/auth'));

// The apps, before the session check (PP-02): FieldOps as-is at / (no build
// step; its service worker precaches source paths) and Dispatch's Vite build
// at /dispatch/ (`npm run build:dispatch`). Only existing files are served;
// anything else falls through to the API.
const path = require('path');
app.use('/dispatch', express.static(path.join(__dirname, '../frontend/dispatch/dist')));
app.use(express.static(path.join(__dirname, '../frontend/pwa')));

// All operational routes require a valid server-side session. Temporary passwords
// can access only the authentication routes until replaced.
app.use(authenticate, requirePasswordChanged);

// Enforce application access at the route boundary as well as within sensitive handlers.
app.use('/api/dispatch', requireRole('owner', 'dispatcher'));

app.use('/api/dispatch/technicians', require('./routes/technicians'));
app.use('/api/dispatch', require('./routes/dispatch'));
app.use('/api/dispatch', require('./routes/reports'));
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
app.use('/api', require('./routes/inventory'));
app.use('/api/dispatch', require('./routes/restock'));
app.use('/api/dispatch', require('./routes/payperiods'));
app.use('/api', require('./routes/payperiods'));
app.use('/api', require('./routes/corrections'));
app.use('/api/chat', require('./routes/chat'));
app.use('/api/technicians', require('./routes/settings'));
app.use('/api/workspace', require('./routes/accFix'));
app.use('/api/catalog', require('./routes/catalog'));
app.use('/api/dispatch', require('./routes/catalog'));

// Global error handler
app.use((err, req, res, _next) => {
  if (err.status >= 400 && err.status < 500) {
    return res.status(err.status).json({ error: err.message });
  }
  console.error(err);
  if (process.env.NODE_ENV === 'production') {
    return res.status(500).json({ error: 'Internal server error' });
  }
  res.status(500).json({ error: err.message, stack: err.stack });
});

const PORT = process.env.PORT || 3001;
if (require.main === module) {
  const { bootstrapInitialOwner } = require('./routes/auth');
  bootstrapInitialOwner().then(() => {
    app.listen(PORT, () => {
      console.log(`FieldOps server listening on port ${PORT}`);
    });
    const { autoClosePeriods, ensureCurrentPeriodExists } = require('./services/autoClose');
    async function runPayPeriodJob() {
      await ensureCurrentPeriodExists();
      await autoClosePeriods();
    }
    runPayPeriodJob();
    setInterval(runPayPeriodJob, 24 * 60 * 60 * 1000);
  }).catch(err => {
    console.error(`Authentication bootstrap failed: ${err.message}`);
    process.exitCode = 1;
    pool.end().catch(() => {});
  });
}

module.exports = app;
