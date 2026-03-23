import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { registerEngineRoutes } from './routes/engine.js';
import { registerHealthRoutes } from './routes/health.js';
import { registerImportRoutes } from './routes/import.js';
import { registerPriceRoutes } from './routes/prices.js';
import { registerSummaryRoutes } from './routes/summary.js';
import { registerTransactionRoutes } from './routes/transactions.js';

const app = new Hono();

app.use('*', logger());
app.use('/api/*', cors());

registerHealthRoutes(app);
registerImportRoutes(app);
registerPriceRoutes(app);
registerEngineRoutes(app);
registerSummaryRoutes(app);
registerTransactionRoutes(app);

serve({ fetch: app.fetch, port: 3001 }, () => {
  console.log('Backend server running on http://localhost:3001');
});
