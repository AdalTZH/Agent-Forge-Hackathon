import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { logger } from './utils/logger.js';
import agentRoutes from './routes/agent.js';

const PORT = process.env.PORT || 3001;
const app = express();

// ─────────────────────────────────────────────
// Middleware
// ─────────────────────────────────────────────
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:5173',
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type'],
}));
app.use(express.json());

// Request logger
app.use((req, _res, next) => {
  logger.info('HTTP', `${req.method} ${req.path}`);
  next();
});

// ─────────────────────────────────────────────
// Routes
// ─────────────────────────────────────────────
app.use('/api/agent', agentRoutes);

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

// 404 handler
app.use((_req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// Global error handler
app.use((err, _req, res, _next) => {
  logger.error('Server', 'Unhandled error', err);
  res.status(500).json({ error: 'Internal server error' });
});

// ─────────────────────────────────────────────
// Start
// ─────────────────────────────────────────────
app.listen(PORT, () => {
  logger.success('Server', `Backend running on http://localhost:${PORT}`);
  logger.info('Server', 'Required env vars: OPENAI_API_KEY, BRIGHTDATA_API_TOKEN, ACONTEXT_API_KEY, ACTIONBOOK_API_KEY');
});
