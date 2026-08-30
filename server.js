import dotenv from 'dotenv';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import rateLimit from 'express-rate-limit';

import googleMapsRoute from './src/routes/googleMapsRoute.js';
import emailExtractorRoute from './src/routes/emailExtractorRoute.js';
import emailVerifyRoute from './src/routes/emailVerifyRouter.js';
import emailSendRoute from './src/routes/emailSendRoute.js';
import techDetectorRoute from './src/routes/techDetectorRoute.js';
import websiteAuditRoute from './src/routes/websiteAuditRoute.js';
import settingsRoute from './src/routes/settingsRoute.js';
import { isSmtpConfigured } from './src/config/settingsStore.js';

dotenv.config();

if (!isSmtpConfigured()) {
  console.warn('⚠️  SMTP is not configured — /api/send-emails will fail until you set it up in Settings.');
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

// Rate limiting — scraping and email sending are expensive/abusable operations
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
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

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Central error handler
app.use((err, req, res, next) => {
  console.error(err);
  if (err.message === 'Not allowed by CORS') {
    return res.status(403).json({ error: 'Origin not allowed' });
  }
  res.status(err.status || 500).json({
    error: 'Internal server error',
    ...(isProduction ? {} : { details: err.message }),
  });
});

const server = app.listen(PORT, () => {
  console.log(`✅ Server running on http://localhost:${PORT}`);
});

const shutdown = (signal) => {
  console.log(`${signal} received, shutting down gracefully...`);
  server.close(() => {
    console.log('Server closed.');
    process.exit(0);
  });
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));