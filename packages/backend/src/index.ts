import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { jwt } from 'hono/jwt';
import { logger } from 'hono/logger';
import { JWT_SECRET, registerAuthRoutes } from './routes/auth.js';
import { registerEngineRoutes, triggerEngineBackground } from './routes/engine.js';
import { registerExchangeRoutes } from './routes/exchanges.js';
import { registerHealthRoutes } from './routes/health.js';
import { registerImportRoutes } from './routes/import.js';
import { registerPriceRoutes } from './routes/prices.js';
import { registerReportRoutes } from './routes/report.js';
import { registerSummaryRoutes } from './routes/summary.js';
import { registerTransactionRoutes } from './routes/transactions.js';

const app = new Hono();

app.use('*', logger());
app.use('/api/*', cors());

// JWT middleware — protects all /api/* routes except /api/auth/*
app.use('/api/*', async (c, next) => {
  const path = new URL(c.req.url).pathname;
  if (path.startsWith('/api/auth/')) return next();
  try {
    return await jwt({ secret: JWT_SECRET, alg: 'HS256', cookie: 'session' })(c, next);
  } catch {
    return c.json({ error: 'Unauthorized' }, 401);
  }
});

// Auth routes must be registered first (setup/login endpoints are unauthenticated)
registerAuthRoutes(app);

registerHealthRoutes(app);
registerImportRoutes(app);
registerPriceRoutes(app);
registerEngineRoutes(app);
registerSummaryRoutes(app);
registerTransactionRoutes(app);
registerReportRoutes(app);
registerExchangeRoutes(app);

serve({ fetch: app.fetch, port: 3001 }, () => {
  console.log('Backend server running on http://localhost:3001');
  triggerEngineBackground();
});
