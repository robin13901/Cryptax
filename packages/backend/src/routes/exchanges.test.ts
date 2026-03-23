import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ExchangeConnection } from '@cryptax/shared';
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
import { registerExchangeRoutes } from './exchanges.js';

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

const MASTER_KEY = 'test-master-key-1234567890abcdef12345678';

/**
 * Inserts a credential_master_key into app_settings so the cipher can function.
 */
function seedMasterKey(sqlite: ReturnType<typeof Database>): void {
  sqlite.exec(
    `INSERT INTO app_settings (key, value, updated_at)
     VALUES ('credential_master_key', '${MASTER_KEY}', '${new Date().toISOString()}')`
  );
}

function buildTestApp(): Hono {
  const app = new Hono();
  registerExchangeRoutes(app);
  return app;
}

const VALID_BODY = {
  exchange: 'bitget',
  label: 'My Bitget Account',
  credentials: {
    apiKey: 'my-api-key',
    secret: 'my-secret',
    password: 'my-passphrase',
  },
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('exchange routes', () => {
  let app: Hono;
  let sqlite: ReturnType<typeof Database>;

  beforeEach(() => {
    sqlite = new Database(':memory:');
    applyMigrations(sqlite);
    seedMasterKey(sqlite);
    mockDb = drizzle(sqlite, { schema });
    app = buildTestApp();
  });

  afterEach(() => {
    sqlite.close();
  });

  // -------------------------------------------------------------------------
  // GET /api/exchanges
  // -------------------------------------------------------------------------

  describe('GET /api/exchanges', () => {
    it('returns empty array initially', async () => {
      const res = await app.request('/api/exchanges');
      expect(res.status).toBe(200);
      const body = await res.json<ExchangeConnection[]>();
      expect(body).toEqual([]);
    });

    it('returns connections without encrypted_credentials field after creation', async () => {
      // Create a connection first
      await app.request('/api/exchanges', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(VALID_BODY),
      });

      const res = await app.request('/api/exchanges');
      const body = await res.json<ExchangeConnection[]>();

      expect(body).toHaveLength(1);
      expect(body[0]).not.toHaveProperty('encryptedCredentials');
      expect(body[0]).not.toHaveProperty('encrypted_credentials');
    });
  });

  // -------------------------------------------------------------------------
  // POST /api/exchanges
  // -------------------------------------------------------------------------

  describe('POST /api/exchanges', () => {
    it('creates a connection and returns 201 with ExchangeConnection shape', async () => {
      const res = await app.request('/api/exchanges', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(VALID_BODY),
      });

      expect(res.status).toBe(201);
      const body = await res.json<ExchangeConnection>();

      expect(body.id).toBeTypeOf('number');
      expect(body.exchange).toBe('bitget');
      expect(body.label).toBe('My Bitget Account');
      expect(body.createdAt).toBeTypeOf('string');
      expect(body.lastSyncAt).toBeNull();
    });

    it('response does not include credentials', async () => {
      const res = await app.request('/api/exchanges', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(VALID_BODY),
      });

      const body = await res.json<Record<string, unknown>>();
      expect(body).not.toHaveProperty('encryptedCredentials');
      expect(body).not.toHaveProperty('encrypted_credentials');
      expect(body).not.toHaveProperty('credentials');
      expect(JSON.stringify(body)).not.toContain(VALID_BODY.credentials.apiKey);
    });

    it('GET /api/exchanges returns the created connection', async () => {
      await app.request('/api/exchanges', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(VALID_BODY),
      });

      const listRes = await app.request('/api/exchanges');
      const list = await listRes.json<ExchangeConnection[]>();

      expect(list).toHaveLength(1);
      expect(list[0].exchange).toBe('bitget');
      expect(list[0].label).toBe('My Bitget Account');
    });

    it('returns 400 when exchange is not bitget', async () => {
      const res = await app.request('/api/exchanges', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...VALID_BODY, exchange: 'binance' }),
      });
      expect(res.status).toBe(400);
    });

    it('returns 400 when apiKey is missing', async () => {
      const res = await app.request('/api/exchanges', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...VALID_BODY,
          credentials: { ...VALID_BODY.credentials, apiKey: '' },
        }),
      });
      expect(res.status).toBe(400);
    });

    it('returns 400 when secret is missing', async () => {
      const res = await app.request('/api/exchanges', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...VALID_BODY,
          credentials: { ...VALID_BODY.credentials, secret: '' },
        }),
      });
      expect(res.status).toBe(400);
    });

    it('returns 400 when password is missing', async () => {
      const res = await app.request('/api/exchanges', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...VALID_BODY,
          credentials: { ...VALID_BODY.credentials, password: '' },
        }),
      });
      expect(res.status).toBe(400);
    });

    it('returns 400 when credentials object is absent', async () => {
      const res = await app.request('/api/exchanges', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ exchange: 'bitget', label: 'Test' }),
      });
      expect(res.status).toBe(400);
    });

    it('returns 400 when label is empty', async () => {
      const res = await app.request('/api/exchanges', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...VALID_BODY, label: '' }),
      });
      expect(res.status).toBe(400);
    });
  });

  // -------------------------------------------------------------------------
  // DELETE /api/exchanges/:id
  // -------------------------------------------------------------------------

  describe('DELETE /api/exchanges/:id', () => {
    it('removes an existing connection and returns { deleted: true }', async () => {
      // Create first
      const createRes = await app.request('/api/exchanges', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(VALID_BODY),
      });
      const created = await createRes.json<ExchangeConnection>();

      // Delete
      const deleteRes = await app.request(`/api/exchanges/${created.id}`, {
        method: 'DELETE',
      });
      expect(deleteRes.status).toBe(200);
      const body = await deleteRes.json<{ deleted: boolean }>();
      expect(body.deleted).toBe(true);

      // Confirm gone
      const listRes = await app.request('/api/exchanges');
      const list = await listRes.json<ExchangeConnection[]>();
      expect(list).toHaveLength(0);
    });

    it('returns 404 for non-existent connection', async () => {
      const res = await app.request('/api/exchanges/999', {
        method: 'DELETE',
      });
      expect(res.status).toBe(404);
    });
  });

  // -------------------------------------------------------------------------
  // POST /api/exchanges/:id/test
  // -------------------------------------------------------------------------

  describe('POST /api/exchanges/:id/test', () => {
    it('returns 404 for non-existent connection id', async () => {
      const res = await app.request('/api/exchanges/999/test', {
        method: 'POST',
      });
      expect(res.status).toBe(404);
    });

    it('returns stubbed ccxt-not-installed response for valid connection', async () => {
      // Create a connection
      const createRes = await app.request('/api/exchanges', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(VALID_BODY),
      });
      const created = await createRes.json<ExchangeConnection>();

      const testRes = await app.request(`/api/exchanges/${created.id}/test`, {
        method: 'POST',
      });

      expect(testRes.status).toBe(200);
      const body = await testRes.json<{ success: boolean; error?: string }>();
      expect(body.success).toBe(false);
      expect(body.error).toBe('ccxt not yet installed');
    });
  });
});
