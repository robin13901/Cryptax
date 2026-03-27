import { serve } from '@hono/node-server';
import { createApp } from './app.js';
import { triggerEngineBackground } from './routes/engine.js';

const app = createApp();

serve({ fetch: app.fetch, port: 3001 }, () => {
  console.log('Backend server running on http://localhost:3001');
  triggerEngineBackground();
});
