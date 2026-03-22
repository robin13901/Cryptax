import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as schema from '../db/schema.js';
import { transactions } from '../db/schema.js';
import type { EnrichmentDeps } from '../prices/enrichment-engine.js';

// ---------------------------------------------------------------------------
// DB mock — same pattern as import.test.ts
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
// Mock enrichment engine for most tests (avoid real API calls)
// ---------------------------------------------------------------------------

const mockRunEnrichment = vi.fn();
const mockCreateDefaultEnrichmentDeps = vi.fn();

vi.mock('../prices/enrichment-engine.js', () => ({
  runEnrichment: (...args: unknown[]) => mockRunEnrichment(...args),
  createDefaultEnrichmentDeps: (...args: unknown[]) => mockCreateDefaultEnrichmentDeps(...args),
}));

// ---------------------------------------------------------------------------
// Migration helper
// ---------------------------------------------------------------------------

function applyMigrations(sqlite: ReturnType<typeof Database>) {
  const migrationsDir = path.resolve(process.cwd(), 'packages/backend/drizzle');
  for (const file of [
    '0000_initial.sql',
    '0001_import_batches.sql',
    '0002_eur_price_columns.sql',
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
// Import the route registrar (after mocks are set up)
// ---------------------------------------------------------------------------

import { registerPriceRoutes } from './prices.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeTxInsert(
  overrides: Partial<typeof transactions.$inferInsert> = {}
): typeof transactions.$inferInsert {
  return {
    exchange: 'bitget',
    sourceType: 'spot_tx',
    canonicalType: 'buy',
    symbol: 'BTC',
    side: 'buy',
    amount: '0.001',
    price: '0',
    fee: '0',
    totalValue: '0',
    tradedAt: '2024-03-31T12:00:00.000Z',
    taxYear: 2024,
    checksum: `chk-${Math.random()}`,
    importedAt: new Date().toISOString(),
    ...overrides,
  };
}

const MOCK_ENRICHMENT_RESULT = {
  total: 1,
  resolved: 1,
  failed: 0,
  skippedCacheHit: 0,
  bySource: { coingecko: 1 },
  failures: [],
};

// ---------------------------------------------------------------------------
// Shared setup
// ---------------------------------------------------------------------------

let app: Hono;
let sqlite: ReturnType<typeof Database>;

function setupApp() {
  sqlite = new Database(':memory:');
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  applyMigrations(sqlite);
  mockDb = drizzle(sqlite, { schema });

  // Reset the isRunning guard between tests by re-importing (module-level state)
  // We mock the enrichment engine so isRunning is only set by the routes module.
  mockRunEnrichment.mockResolvedValue(MOCK_ENRICHMENT_RESULT);
  mockCreateDefaultEnrichmentDeps.mockReturnValue({} as EnrichmentDeps);

  app = new Hono();
  registerPriceRoutes(app);
}

// ---------------------------------------------------------------------------
// GET /api/prices/status
// ---------------------------------------------------------------------------

describe('GET /api/prices/status', () => {
  beforeEach(setupApp);
  afterEach(() => sqlite.close());

  it('returns zero counts when no transactions exist', async () => {
    const res = await app.request('/api/prices/status');
    expect(res.status).toBe(200);

    const body = (await res.json()) as {
      total: number;
      resolved: number;
      unresolved: number;
      isEnriching: boolean;
      bySource: Record<string, number>;
      failureBreakdown: Record<string, number>;
      unresolvedTransactions: unknown[];
    };

    expect(body.total).toBe(0);
    expect(body.resolved).toBe(0);
    expect(body.unresolved).toBe(0);
    expect(body.isEnriching).toBe(false);
    expect(body.bySource).toEqual({});
    expect(body.failureBreakdown).toEqual({});
    expect(body.unresolvedTransactions).toHaveLength(0);
  });

  it('reflects resolved and unresolved counts correctly', async () => {
    // Insert resolved transaction
    await mockDb.insert(transactions).values(
      makeTxInsert({
        checksum: 'chk-resolved',
        // biome-ignore lint/suspicious/noExplicitAny: test fixture
        eurPrice: '60000.00' as any,
        // biome-ignore lint/suspicious/noExplicitAny: test fixture
        priceSource: 'coingecko' as any,
      })
    );

    // Insert unresolved transaction with failure reason
    await mockDb.insert(transactions).values(
      makeTxInsert({
        symbol: 'UNKNOWN',
        checksum: 'chk-unresolved',
        // biome-ignore lint/suspicious/noExplicitAny: test fixture
        priceFailureReason: 'no-bitget-pair' as any,
      })
    );

    const res = await app.request('/api/prices/status');
    expect(res.status).toBe(200);

    const body = (await res.json()) as {
      total: number;
      resolved: number;
      unresolved: number;
      bySource: Record<string, number>;
      failureBreakdown: Record<string, number>;
      unresolvedTransactions: Array<{ symbol: string; failureReason: string | null }>;
    };

    expect(body.total).toBe(2);
    expect(body.resolved).toBe(1);
    expect(body.unresolved).toBe(1);
    expect(body.bySource.coingecko).toBe(1);
    expect(body.failureBreakdown['no-bitget-pair']).toBe(1);
    expect(body.unresolvedTransactions).toHaveLength(1);
    expect(body.unresolvedTransactions[0].symbol).toBe('UNKNOWN');
  });

  it('groups failure breakdown by reason', async () => {
    await mockDb.insert(transactions).values([
      makeTxInsert({
        checksum: 'chk-f1',
        // biome-ignore lint/suspicious/noExplicitAny: test fixture
        priceFailureReason: 'no-bitget-pair' as any,
      }),
      makeTxInsert({
        checksum: 'chk-f2',
        // biome-ignore lint/suspicious/noExplicitAny: test fixture
        priceFailureReason: 'no-bitget-pair' as any,
      }),
      makeTxInsert({
        checksum: 'chk-f3',
        // biome-ignore lint/suspicious/noExplicitAny: test fixture
        priceFailureReason: 'api-error' as any,
      }),
    ]);

    const res = await app.request('/api/prices/status');
    const body = (await res.json()) as {
      failureBreakdown: Record<string, number>;
    };

    expect(body.failureBreakdown['no-bitget-pair']).toBe(2);
    expect(body.failureBreakdown['api-error']).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// POST /api/prices/enrich
// ---------------------------------------------------------------------------

describe('POST /api/prices/enrich', () => {
  beforeEach(setupApp);
  afterEach(() => sqlite.close());

  it('returns 200 with enrichment result on success', async () => {
    mockRunEnrichment.mockResolvedValueOnce(MOCK_ENRICHMENT_RESULT);

    const res = await app.request('/api/prices/enrich', { method: 'POST' });
    expect(res.status).toBe(200);

    const body = (await res.json()) as {
      total: number;
      resolved: number;
      failed: number;
      bySource: Record<string, number>;
      failures: unknown[];
    };

    expect(body.total).toBe(1);
    expect(body.resolved).toBe(1);
    expect(body.failed).toBe(0);
    expect(body.bySource.coingecko).toBe(1);
    expect(body.failures).toHaveLength(0);
  });

  it('returns 409 when enrichment is already running', async () => {
    // Make runEnrichment hang for the first call
    let resolveFirst!: () => void;
    const firstRunPromise = new Promise<typeof MOCK_ENRICHMENT_RESULT>((resolve) => {
      resolveFirst = () => resolve(MOCK_ENRICHMENT_RESULT);
    });
    mockRunEnrichment.mockReturnValueOnce(firstRunPromise);

    // Start first enrichment (don't await)
    const firstReq = app.request('/api/prices/enrich', { method: 'POST' });

    // Small delay to let first request reach the isRunning = true guard
    await new Promise((r) => setTimeout(r, 10));

    // Try second enrichment while first is running
    const secondRes = await app.request('/api/prices/enrich', { method: 'POST' });
    expect(secondRes.status).toBe(409);

    // Let the first one finish
    resolveFirst();
    await firstReq;
  });
});

// ---------------------------------------------------------------------------
// PATCH /api/prices/manual
// ---------------------------------------------------------------------------

describe('PATCH /api/prices/manual', () => {
  beforeEach(setupApp);
  afterEach(() => sqlite.close());

  it('sets EUR price manually for an unresolved transaction', async () => {
    const [inserted] = await mockDb
      .insert(transactions)
      .values(makeTxInsert({ checksum: 'chk-manual-patch' }))
      .returning();

    const res = await app.request('/api/prices/manual', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ transactionId: inserted.id, eurPrice: '55000.50' }),
    });

    expect(res.status).toBe(200);

    const body = (await res.json()) as {
      transactionId: number;
      eurPrice: string;
      priceSource: string;
    };

    expect(body.transactionId).toBe(inserted.id);
    expect(body.priceSource).toBe('manual');

    // Verify DB was updated
    const row = sqlite
      .prepare('SELECT eur_price, price_source FROM transactions WHERE id = ?')
      .get(inserted.id) as { eur_price: string; price_source: string };

    expect(row.eur_price).toBe('55000.5');
    expect(row.price_source).toBe('manual');
  });

  it('returns 404 when transaction does not exist', async () => {
    const res = await app.request('/api/prices/manual', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ transactionId: 99999, eurPrice: '100.00' }),
    });

    expect(res.status).toBe(404);
  });

  it('returns 400 for invalid eurPrice', async () => {
    const [inserted] = await mockDb
      .insert(transactions)
      .values(makeTxInsert({ checksum: 'chk-invalid-price' }))
      .returning();

    const res = await app.request('/api/prices/manual', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ transactionId: inserted.id, eurPrice: 'not-a-number' }),
    });

    expect(res.status).toBe(400);
  });

  it('returns 400 for zero or negative eurPrice', async () => {
    const [inserted] = await mockDb
      .insert(transactions)
      .values(makeTxInsert({ checksum: 'chk-zero-price' }))
      .returning();

    const resZero = await app.request('/api/prices/manual', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ transactionId: inserted.id, eurPrice: '0' }),
    });
    expect(resZero.status).toBe(400);

    const resNeg = await app.request('/api/prices/manual', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ transactionId: inserted.id, eurPrice: '-10' }),
    });
    expect(resNeg.status).toBe(400);
  });

  it('returns 400 when transaction is already resolved by a non-manual source', async () => {
    const [inserted] = await mockDb
      .insert(transactions)
      .values(
        makeTxInsert({
          checksum: 'chk-already-resolved-manual',
          // biome-ignore lint/suspicious/noExplicitAny: test fixture
          eurPrice: '50000.00' as any,
          // biome-ignore lint/suspicious/noExplicitAny: test fixture
          priceSource: 'bitget-direct' as any,
        })
      )
      .returning();

    const res = await app.request('/api/prices/manual', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ transactionId: inserted.id, eurPrice: '99999.00' }),
    });

    expect(res.status).toBe(400);
  });

  it('allows overwriting a manual price with another manual price', async () => {
    const [inserted] = await mockDb
      .insert(transactions)
      .values(
        makeTxInsert({
          checksum: 'chk-overwrite-manual',
          // biome-ignore lint/suspicious/noExplicitAny: test fixture
          eurPrice: '50000.00' as any,
          // biome-ignore lint/suspicious/noExplicitAny: test fixture
          priceSource: 'manual' as any,
        })
      )
      .returning();

    const res = await app.request('/api/prices/manual', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ transactionId: inserted.id, eurPrice: '60000.00' }),
    });

    expect(res.status).toBe(200);

    const row = sqlite
      .prepare('SELECT eur_price FROM transactions WHERE id = ?')
      .get(inserted.id) as { eur_price: string };

    expect(row.eur_price).toBe('60000');
  });

  it('returns 400 for invalid transactionId type', async () => {
    const res = await app.request('/api/prices/manual', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ transactionId: 'abc', eurPrice: '100.00' }),
    });

    expect(res.status).toBe(400);
  });
});
