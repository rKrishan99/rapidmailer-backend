import dotenv from 'dotenv';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import rateLimit from 'express-rate-limit';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import googleMapsRoute from './src/routes/googleMapsRoute.js';
import emailExtractorRoute from './src/routes/emailExtractorRoute.js';
import emailVerifyRoute from './src/routes/emailVerifyRouter.js';
import emailSendRoute from './src/routes/emailSendRoute.js';
import techDetectorRoute from './src/routes/techDetectorRoute.js';
import websiteAuditRoute from './src/routes/websiteAuditRoute.js';
import settingsRoute from './src/routes/settingsRoute.js';
import emailAccountsRoute from './src/routes/emailAccountsRoute.js';
import socialEnrichRoute from './src/routes/socialEnrichRoute.js';
import whatsappRoute from './src/routes/whatsappRoute.js';
import { isEmailConfigured } from './src/config/settingsStore.js';
import { closeAllTrackedBrowsers } from './src/utils/browserRegistry.js';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Last-resort safety net: this is a single-user desktop app with no one to
// restart a crashed server for them, so the right default is to log and
// keep running rather than let Node's default "crash the whole process"
// behavior take down an in-progress task over one unexpected error. Real
// bugs still show up in the log for us to fix; the user just doesn't lose
// their session over it.
process.on('uncaughtException', (err) => {
  console.error('⚠️  Uncaught exception (continuing):', err.message, err.stack);
});
process.on('unhandledRejection', (reason) => {
  console.error('⚠️  Unhandled promise rejection (continuing):', reason?.message || reason);
});

try {
  if (!isEmailConfigured()) {
    console.warn('⚠️  No email account is configured — /api/send-emails will fail until you add one in Email Accounts.');
  }
} catch (err) {
  console.error('⚠️  Could not check email configuration at startup:', err.message);
}

const app = express();
const PORT = process.env.PORT || 5000;
const isProduction = process.env.NODE_ENV === 'production';

app.disable('x-powered-by');
app.set('trust proxy', 1);

// Security & performance middleware
app.use(helmet());
app.use(compression());

const allowedOrigins = (process.env.CORS_ORIGIN || '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow non-browser requests (curl, server-to-server) with no Origin header
      if (!origin || allowedOrigins.length === 0 || allowedOrigins.includes(origin)) {
        return callback(null, true);
      }
      return callback(new Error('Not allowed by CORS'));
    },
  })
);

app.use(express.json({ limit: '1mb' }));

// Rate limiting. This is a single-user desktop app bound to 127.0.0.1 — the
// only realistic client is the app's own frontend, not an external
// adversary — so this exists as a basic backstop against a runaway retry
// loop, not a security boundary. The real abuse control is the per-request
// caps on each bulk endpoint (MAX_RECIPIENTS_PER_REQUEST, MAX_BULK_URLS,
// etc.), which a legitimate power user running several of those back-to-back
// can hit well before 100 requests in 15 minutes — hence the generous limit.
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 2000,
  standardHeaders: true,
  legacyHeaders: false,
});
app.use('/api', apiLimiter);

// Routes
app.use('/api', googleMapsRoute);
app.use('/api', emailExtractorRoute);
app.use('/api', emailVerifyRoute);
app.use('/api', emailSendRoute);
app.use('/api', techDetectorRoute);
app.use('/api', websiteAuditRoute);
app.use('/api', settingsRoute);
app.use('/api', emailAccountsRoute);
app.use('/api', socialEnrichRoute);
app.use('/api', whatsappRoute);

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

// Serve the built frontend when it's shipped alongside this server (the
// desktop build). Absent in normal dev, where Vite serves the frontend.
const FRONTEND_DIR = path.join(__dirname, '..', 'frontend');
if (fs.existsSync(FRONTEND_DIR)) {
  app.use(express.static(FRONTEND_DIR));
  app.get(/^(?!\/api).*/, (req, res) => {
    res.sendFile(path.join(FRONTEND_DIR, 'index.html'));
  });
}

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Central error handler
app.use((err, req, res, next) => {
  console.error(err.message);
  if (err.message === 'Not allowed by CORS') {
    return res.status(403).json({ error: 'Origin not allowed' });
  }
  res.status(err.status || 500).json({
    error: 'Internal server error',
    ...(isProduction ? {} : { details: err.message }),
  });
});

const server = app.listen(PORT, '127.0.0.1', () => {
  console.log(`✅ Server running on http://localhost:${PORT}`);
});

// Node's default behavior for an unhandled 'error' event on a Server is to
// throw, which (via the uncaughtException handler above) would otherwise
// just log and limp along with no port bound at all. EADDRINUSE specifically
// means this process can never do its job, so exit cleanly and clearly
// instead — the desktop wrapper (main.js) detects this exit and shows the
// user an actual error dialog rather than a silently-dead backend.
server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`⚠️  Port ${PORT} is already in use — is another copy of RapidMailer already running?`);
    process.exit(1);
  }
  console.error('⚠️  Server error:', err.message);
  process.exit(1);
});

const shutdown = (signal) => {
  console.log(`${signal} received, shutting down gracefully...`);
  closeAllTrackedBrowsers().finally(() => {
    server.close(() => {
      console.log('Server closed.');
      process.exit(0);
    });
    // Don't wait forever on a hung connection/scrape — force exit if
    // server.close()'s callback hasn't fired shortly after.
    setTimeout(() => process.exit(0), 5000).unref();
  });
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
