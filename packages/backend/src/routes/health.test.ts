import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { registerHealthRoutes } from './health.js';

describe('GET /api/health', () => {
  it('returns 200 with status ok', async () => {
    const app = new Hono();
    registerHealthRoutes(app);
    const res = await app.request('/api/health');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('ok');
    expect(body).toHaveProperty('ts');
  });

  it('returns timestamp as a number', async () => {
    const app = new Hono();
    registerHealthRoutes(app);
    const res = await app.request('/api/health');
    const body = await res.json();
    expect(typeof body.ts).toBe('number');
  });
});
