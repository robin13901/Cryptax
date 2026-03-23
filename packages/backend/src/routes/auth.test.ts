import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { Hono } from 'hono';
import { jwt } from 'hono/jwt';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as schema from '../db/schema.js';

// ---------------------------------------------------------------------------
// DB mock — must be declared before importing the module under test
// ---------------------------------------------------------------------------

let mockDb: ReturnType<typeof drizzle<typeof schema>>;

vi.mock('../db/client.js', () => ({
  get db() {
    return mockDb;
  },
  get sqlite() {
    return undefined;
  },
}));

// Import after mock is registered
import { JWT_SECRET, registerAuthRoutes } from './auth.js';
import { registerHealthRoutes } from './health.js';

// ---------------------------------------------------------------------------
// Migration helper
// ---------------------------------------------------------------------------

function applyMigrations(sqlite: ReturnType<typeof Database>): void {
  const migrationsDir = path.resolve(process.cwd(), 'packages/backend/drizzle');
  for (const file of [
    '0000_initial.sql',
    '0001_import_batches.sql',
    '0002_eur_price_columns.sql',
    '0003_app_settings.sql',
  ]) {
    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
    const statements = sql
      .split('--> statement-breakpoint')
      .map((s) => s.trim())
      .filter(Boolean);
    for (const stmt of statements) {
      sqlite.exec(stmt);
    }
  }
}

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/**
 * Builds a Hono app with auth routes + JWT middleware + health route.
 * Mirrors the index.ts wiring for integration testing.
 */
function buildTestApp(): Hono {
  const app = new Hono();

  // JWT middleware (same as index.ts)
  app.use('/api/*', async (c, next) => {
    const urlPath = new URL(c.req.url).pathname;
    if (urlPath.startsWith('/api/auth/')) return next();
    try {
      return await jwt({ secret: JWT_SECRET, alg: 'HS256', cookie: 'session' })(c, next);
    } catch {
      return c.json({ error: 'Unauthorized' }, 401);
    }
  });

  registerAuthRoutes(app);
  registerHealthRoutes(app);

  return app;
}

/**
 * Sets up the app with a password and returns a valid session cookie string.
 */
async function setupAndLogin(
  app: Hono,
  password = 'testpassword123'
): Promise<string> {
  await app.request('/api/auth/setup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password }),
  });

  const loginRes = await app.request('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password }),
  });

  const cookieHeader = loginRes.headers.get('Set-Cookie') ?? '';
  // Extract the cookie value from: session=<token>; HttpOnly; ...
  const match = cookieHeader.match(/^session=([^;]+)/);
  return match ? `session=${match[1]}` : '';
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('auth routes', () => {
  let app: Hono;
  let sqlite: ReturnType<typeof Database>;

  beforeEach(() => {
    sqlite = new Database(':memory:');
    applyMigrations(sqlite);
    mockDb = drizzle(sqlite, { schema });
    app = buildTestApp();
  });

  afterEach(() => {
    sqlite.close();
  });

  describe('GET /api/auth/status', () => {
    it('returns hasPassword:false initially', async () => {
      const res = await app.request('/api/auth/status');
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.hasPassword).toBe(false);
      expect(body.authenticated).toBe(false);
    });

    it('returns hasPassword:true after setup', async () => {
      await app.request('/api/auth/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: 'securepass123' }),
      });

      const res = await app.request('/api/auth/status');
      const body = await res.json();
      expect(body.hasPassword).toBe(true);
    });
  });

  describe('POST /api/auth/setup', () => {
    it('returns 201 and ok:true with valid password', async () => {
      const res = await app.request('/api/auth/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: 'validpass1' }),
      });
      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.ok).toBe(true);
    });

    it('returns 400 when password is shorter than 8 characters', async () => {
      const res = await app.request('/api/auth/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: 'short' }),
      });
      expect(res.status).toBe(400);
    });

    it('returns 409 when password is already set', async () => {
      await app.request('/api/auth/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: 'firstpassword' }),
      });

      const res = await app.request('/api/auth/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: 'secondpassword' }),
      });
      expect(res.status).toBe(409);
    });
  });

  describe('POST /api/auth/login', () => {
    it('returns 200 and Set-Cookie header with correct password', async () => {
      await app.request('/api/auth/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: 'mypassword123' }),
      });

      const res = await app.request('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: 'mypassword123' }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.ok).toBe(true);

      const cookie = res.headers.get('Set-Cookie');
      expect(cookie).toMatch(/^session=/);
      expect(cookie).toMatch(/HttpOnly/i);
    });

    it('returns 401 with correct error message for wrong password', async () => {
      await app.request('/api/auth/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: 'rightpassword' }),
      });

      const res = await app.request('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: 'wrongpassword' }),
      });

      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.error).toBe('Falsches Passwort');
    });
  });

  describe('JWT middleware', () => {
    it('GET /api/health without session cookie returns 401', async () => {
      const res = await app.request('/api/health');
      expect(res.status).toBe(401);
    });

    it('GET /api/health with valid session cookie returns 200', async () => {
      const cookie = await setupAndLogin(app);
      expect(cookie).toBeTruthy();

      const res = await app.request('/api/health', {
        headers: { Cookie: cookie },
      });
      expect(res.status).toBe(200);
    });

    it('GET /api/auth/status is exempt from JWT middleware', async () => {
      // No cookie — should still return 200 (not 401)
      const res = await app.request('/api/auth/status');
      expect(res.status).toBe(200);
    });
  });

  describe('POST /api/auth/logout', () => {
    it('returns 200 and clears the session cookie', async () => {
      const cookie = await setupAndLogin(app);

      const res = await app.request('/api/auth/logout', {
        method: 'POST',
        headers: { Cookie: cookie },
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.ok).toBe(true);

      const setCookie = res.headers.get('Set-Cookie');
      // The cookie should be cleared (max-age=0 or expires in the past or empty value)
      expect(setCookie).toMatch(/session=/);
    });
  });
});
