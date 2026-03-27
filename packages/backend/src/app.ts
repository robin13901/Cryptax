import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { jwt } from 'hono/jwt';
import { logger } from 'hono/logger';
import { JWT_SECRET, registerAuthRoutes } from './routes/auth.js';
import { registerEngineRoutes } from './routes/engine.js';
import { registerExchangeRoutes } from './routes/exchanges.js';
import { registerHealthRoutes } from './routes/health.js';
import { registerImportRoutes } from './routes/import.js';
import { registerPriceRoutes } from './routes/prices.js';
import { registerReportRoutes } from './routes/report.js';
import { registerSummaryRoutes } from './routes/summary.js';
import { registerSyncRoutes } from './routes/sync.js';
import { registerTransactionRoutes } from './routes/transactions.js';

/**
 * Creates a fully-configured Hono application instance.
 * Does NOT start an HTTP server — caller decides how to serve.
 * Used by index.ts (standalone) and by the Electron main process.
 */
export function createApp(): Hono {
  const app = new Hono();

  app.use('*', logger());
  // Open CORS for both web origins and Electron file:// origins
  app.use('/api/*', cors({ origin: '*' }));

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
  registerSyncRoutes(app);

  return app;
}
