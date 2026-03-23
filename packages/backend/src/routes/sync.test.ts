import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SyncResult } from '@cryptax/shared';
import * as schema from '../db/schema.js';

// ---------------------------------------------------------------------------
// DB mock — must be declared before importing the modules under test
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

// ---------------------------------------------------------------------------
// syncExchange mock
// ---------------------------------------------------------------------------

const mockSyncExchange = vi.fn<(connectionId: number) => Promise<SyncResult>>();

vi.mock('../exchange/sync-engine.js', () => ({
  get syncExchange() {
    return mockSyncExchange;
  },
}));

// Import after mocks are registered
import { registerSyncRoutes } from './sync.js';

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

function seedMasterKey(sqlite: ReturnType<typeof Database>): void {
  sqlite.exec(
    `INSERT INTO app_settings (key, value, updated_at)
     VALUES ('credential_master_key', '${MASTER_KEY}', '${new Date().toISOString()}')`
  );
}

function buildTestApp(): Hono {
  const app = new Hono();
  registerSyncRoutes(app);
  return app;
}

function makeSyncResult(overrides: Partial<SyncResult> = {}): SyncResult {
  return {
    connectionId: 1,
    exchange: 'bitget',
    spotTrades: { imported: 5, duplicates: 2, errors: 0 },
    futuresTrades: { imported: 3, duplicates: 1, errors: 0 },
    totalImported: 8,
    totalDuplicates: 3,
    syncedAt: '2026-03-23T10:00:00Z',
    warnings: [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('sync routes', () => {
  let app: Hono;
  let sqlite: ReturnType<typeof Database>;

  beforeEach(() => {
    sqlite = new Database(':memory:');
    applyMigrations(sqlite);
    seedMasterKey(sqlite);
    mockDb = drizzle(sqlite, { schema });
    app = buildTestApp();
    mockSyncExchange.mockReset();
  });

  afterEach(() => {
    sqlite.close();
    vi.restoreAllMocks();
  });

  // -------------------------------------------------------------------------
  // POST /api/exchanges/:id/sync
  // -------------------------------------------------------------------------

  describe('POST /api/exchanges/:id/sync', () => {
    it('returns 404 when connection id does not exist', async () => {
      const res = await app.request('/api/exchanges/999/sync', {
        method: 'POST',
      });
      expect(res.status).toBe(404);
      const body = await res.json<{ error: string }>();
      expect(body.error).toContain('not found');
    });

    it('returns 400 for invalid (non-integer) id', async () => {
      const res = await app.request('/api/exchanges/abc/sync', {
        method: 'POST',
      });
      expect(res.status).toBe(400);
    });

    it('returns SyncResult on successful sync', async () => {
      // Seed a connection
      sqlite.exec(`
        INSERT INTO exchange_connections (exchange, label, encrypted_credentials, created_at)
        VALUES ('bitget', 'Test Account', 'enc_placeholder', '2026-01-01T00:00:00Z')
      `);
      const row = sqlite.prepare('SELECT id FROM exchange_connections LIMIT 1').get() as {
        id: number;
      };

      const expected = makeSyncResult({ connectionId: row.id });
      mockSyncExchange.mockResolvedValueOnce(expected);

      const res = await app.request(`/api/exchanges/${row.id}/sync`, {
        method: 'POST',
      });

      expect(res.status).toBe(200);
      const body = await res.json<SyncResult>();
      expect(body.connectionId).toBe(row.id);
      expect(body.totalImported).toBe(8);
      expect(body.totalDuplicates).toBe(3);
      expect(mockSyncExchange).toHaveBeenCalledWith(row.id);
    });

    it('returns 500 with sanitized error on sync failure', async () => {
      // Seed a connection
      sqlite.exec(`
        INSERT INTO exchange_connections (exchange, label, encrypted_credentials, created_at)
        VALUES ('bitget', 'Fail Account', 'enc_placeholder', '2026-01-01T00:00:00Z')
      `);
      const row = sqlite.prepare('SELECT id FROM exchange_connections LIMIT 1').get() as {
        id: number;
      };

      // Error contains a long alphanumeric-only string (simulating API key leak)
      mockSyncExchange.mockRejectedValueOnce(
        new Error('Authentication failed with key ABCDEF1234567890ABCDEF1234567890')
      );

      const res = await app.request(`/api/exchanges/${row.id}/sync`, {
        method: 'POST',
      });

      expect(res.status).toBe(500);
      const body = await res.json<{ error: string }>();
      expect(body.error).toContain('Sync failed');
      // Long alphanumeric-only token should be redacted
      expect(body.error).not.toContain('ABCDEF1234567890ABCDEF1234567890');
      expect(body.error).toContain('[redacted]');
    });

    it('sanitizes error messages with credential-like tokens', async () => {
      sqlite.exec(`
        INSERT INTO exchange_connections (exchange, label, encrypted_credentials, created_at)
        VALUES ('bitget', 'Cred Account', 'enc_placeholder', '2026-01-01T00:00:00Z')
      `);
      const row = sqlite.prepare('SELECT id FROM exchange_connections LIMIT 1').get() as {
        id: number;
      };

      // Short messages (<=20 chars) should not be redacted
      mockSyncExchange.mockRejectedValueOnce(new Error('Network timeout error'));

      const res = await app.request(`/api/exchanges/${row.id}/sync`, {
        method: 'POST',
      });

      expect(res.status).toBe(500);
      const body = await res.json<{ error: string }>();
      // Short words preserved since none >20 chars alphanumeric-only
      expect(body.error).toContain('Network');
    });
  });

  // -------------------------------------------------------------------------
  // POST /api/exchanges/sync-all
  // -------------------------------------------------------------------------

  describe('POST /api/exchanges/sync-all', () => {
    it('returns empty results when no connections exist', async () => {
      const res = await app.request('/api/exchanges/sync-all', {
        method: 'POST',
      });

      expect(res.status).toBe(200);
      const body = await res.json<{
        results: SyncResult[];
        totalImported: number;
        totalDuplicates: number;
      }>();
      expect(body.results).toHaveLength(0);
      expect(body.totalImported).toBe(0);
      expect(body.totalDuplicates).toBe(0);
    });

    it('aggregates results for multiple connections', async () => {
      // Seed two connections
      sqlite.exec(`
        INSERT INTO exchange_connections (exchange, label, encrypted_credentials, created_at)
        VALUES ('bitget', 'Account A', 'enc_a', '2026-01-01T00:00:00Z'),
               ('bitget', 'Account B', 'enc_b', '2026-01-01T00:00:00Z')
      `);

      const rows = sqlite
        .prepare('SELECT id FROM exchange_connections ORDER BY id')
        .all() as { id: number }[];

      mockSyncExchange
        .mockResolvedValueOnce(makeSyncResult({ connectionId: rows[0].id, totalImported: 10, totalDuplicates: 2 }))
        .mockResolvedValueOnce(makeSyncResult({ connectionId: rows[1].id, totalImported: 5, totalDuplicates: 1 }));

      const res = await app.request('/api/exchanges/sync-all', {
        method: 'POST',
      });

      expect(res.status).toBe(200);
      const body = await res.json<{
        results: SyncResult[];
        totalImported: number;
        totalDuplicates: number;
      }>();
      expect(body.results).toHaveLength(2);
      expect(body.totalImported).toBe(15);
      expect(body.totalDuplicates).toBe(3);
    });

    it('includes failed result in aggregation when one connection errors', async () => {
      sqlite.exec(`
        INSERT INTO exchange_connections (exchange, label, encrypted_credentials, created_at)
        VALUES ('bitget', 'Good Account', 'enc_good', '2026-01-01T00:00:00Z'),
               ('bitget', 'Bad Account', 'enc_bad', '2026-01-01T00:00:00Z')
      `);

      const rows = sqlite
        .prepare('SELECT id FROM exchange_connections ORDER BY id')
        .all() as { id: number }[];

      mockSyncExchange
        .mockResolvedValueOnce(makeSyncResult({ connectionId: rows[0].id, totalImported: 7, totalDuplicates: 0 }))
        .mockRejectedValueOnce(new Error('API down'));

      const res = await app.request('/api/exchanges/sync-all', {
        method: 'POST',
      });

      expect(res.status).toBe(200);
      const body = await res.json<{
        results: SyncResult[];
        totalImported: number;
        totalDuplicates: number;
      }>();
      // Both results included (one success, one failure)
      expect(body.results).toHaveLength(2);
      // Only the successful one contributes to totalImported
      expect(body.totalImported).toBe(7);
      // Failed result has warnings
      const failedResult = body.results.find((r) => r.warnings.length > 0);
      expect(failedResult).toBeDefined();
      expect(failedResult?.warnings[0]).toContain('Sync failed');
    });
  });
});
