import fs from 'node:fs';
import path from 'node:path';
import type { EngineRunResponse } from '@cryptax/shared';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as schema from '../db/schema.js';

// ---------------------------------------------------------------------------
// DB mock — same pattern as prices.test.ts
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
// Mock tax engine modules
// ---------------------------------------------------------------------------

const mockCheckNullPrices = vi.fn();
const mockRunTaxCalculation = vi.fn();

vi.mock('../engine/null-price-gate.js', () => ({
  checkNullPrices: (...args: unknown[]) => mockCheckNullPrices(...args),
}));

vi.mock('../engine/tax-calculator.js', () => ({
  runTaxCalculation: (...args: unknown[]) => mockRunTaxCalculation(...args),
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
// Import route registrar (after mocks)
// ---------------------------------------------------------------------------

import { registerEngineRoutes } from './engine.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const MOCK_TAX_RESULT = {
  fifo: {
    lots: [{ symbol: 'BTC' } as object, { symbol: 'ETH' } as object],
    consumptions: [{ taxYear: 2024 } as object],
    sellsWithoutLots: [],
    skipped: [],
  },
  spotTax: [],
  futures: {
    positions: [{ symbol: 'BTC' } as object],
    skipped: [],
  },
  earn: {
    incomeRecords: [{ taxYear: 2024 } as object],
    lotsCreated: [{ symbol: 'BTC' } as object],
    skipped: [],
  },
  summaries: [
    {
      taxYear: 2024,
      bucket: 'private_sale',
      totalGainsEur: '1000.00',
      totalLossesEur: '0.00',
      netEur: '1000.00',
      taxableAmountEur: '0.00',
      estimatedTaxEur: '0',
      tradeCount: 1,
    },
  ],
  errors: [],
};

const MOCK_NULL_PRICE_ERRORS = [
  {
    transactionId: 42,
    symbol: 'BTC',
    tradedAt: '2024-01-01T00:00:00.000Z',
    sourceType: 'spot_tx',
    canonicalType: 'buy',
  },
];

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

  // Reset all mock call counts and implementations between tests
  vi.clearAllMocks();

  // Default: no null price errors
  mockCheckNullPrices.mockReturnValue([]);
  mockRunTaxCalculation.mockReturnValue(MOCK_TAX_RESULT);

  app = new Hono();
  registerEngineRoutes(app);
}

// ---------------------------------------------------------------------------
// GET /api/engine/status
// ---------------------------------------------------------------------------

describe('GET /api/engine/status', () => {
  beforeEach(setupApp);
  afterEach(() => sqlite.close());

  it('returns isRunning=false when no engine run is in progress', async () => {
    const res = await app.request('/api/engine/status');
    expect(res.status).toBe(200);

    const body = (await res.json()) as { isRunning: boolean };
    expect(body.isRunning).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// POST /api/engine/run — success path
// ---------------------------------------------------------------------------

describe('POST /api/engine/run', () => {
  beforeEach(setupApp);
  afterEach(() => sqlite.close());

  it('returns 200 with EngineRunResponse on successful calculation', async () => {
    const res = await app.request('/api/engine/run', { method: 'POST' });
    expect(res.status).toBe(200);

    const body = (await res.json()) as EngineRunResponse;

    expect(body.success).toBe(true);
    expect(body.summaries).toHaveLength(1);
    expect(body.summaries[0].bucket).toBe('private_sale');
    expect(body.summaries[0].taxYear).toBe(2024);

    expect(body.fifo.lotsCreated).toBe(2);
    expect(body.fifo.consumptions).toBe(1);
    expect(body.fifo.sellsWithoutLots).toBe(0);

    expect(body.futures.positionsRecorded).toBe(1);

    expect(body.earn.incomeRecorded).toBe(1);
    expect(body.earn.lotsCreated).toBe(1);

    expect(body.errors).toHaveLength(0);
    expect(body.nullPriceErrors).toBeUndefined();
    expect(body.computedAt).toBeTruthy();
  });

  it('calls checkNullPrices and runTaxCalculation', async () => {
    await app.request('/api/engine/run', { method: 'POST' });

    expect(mockCheckNullPrices).toHaveBeenCalledTimes(1);
    expect(mockRunTaxCalculation).toHaveBeenCalledTimes(1);
  });

  it('returns 422 with nullPriceErrors when transactions are missing EUR price', async () => {
    mockCheckNullPrices.mockReturnValueOnce(MOCK_NULL_PRICE_ERRORS);

    const res = await app.request('/api/engine/run', { method: 'POST' });
    expect(res.status).toBe(422);

    const body = (await res.json()) as EngineRunResponse;

    expect(body.success).toBe(false);
    expect(body.nullPriceErrors).toBeDefined();
    expect(body.nullPriceErrors).toHaveLength(1);
    expect(body.nullPriceErrors?.[0].transactionId).toBe(42);
    expect(body.nullPriceErrors?.[0].symbol).toBe('BTC');
    expect(body.errors).toHaveLength(1);
    expect(body.errors[0].reason).toContain('Missing EUR price');

    // Engine should NOT be called when null prices are present
    expect(mockRunTaxCalculation).not.toHaveBeenCalled();
  });

  it('returns 409 when engine is already running', async () => {
    // Make runTaxCalculation return a hanging Promise to hold isRunning = true.
    // The route wraps the call in Promise.resolve() so a Promise mock works here.
    let resolveFirst!: () => void;
    const firstRunPromise = new Promise<typeof MOCK_TAX_RESULT>((resolve) => {
      resolveFirst = () => resolve(MOCK_TAX_RESULT);
    });
    mockRunTaxCalculation.mockReturnValueOnce(firstRunPromise);

    // Start first run (don't await — it's hanging)
    const firstReq = app.request('/api/engine/run', { method: 'POST' });

    // Small delay to let first request reach isRunning = true
    await new Promise((r) => setTimeout(r, 10));

    // Try second run while first is in progress
    const secondRes = await app.request('/api/engine/run', { method: 'POST' });
    expect(secondRes.status).toBe(409);

    // Let the first one finish
    resolveFirst();
    await firstReq;
  });

  it('resets isRunning to false after successful run', async () => {
    await app.request('/api/engine/run', { method: 'POST' });

    const statusRes = await app.request('/api/engine/status');
    const body = (await statusRes.json()) as { isRunning: boolean };
    expect(body.isRunning).toBe(false);
  });

  it('resets isRunning to false even when 422 is returned', async () => {
    mockCheckNullPrices.mockReturnValueOnce(MOCK_NULL_PRICE_ERRORS);

    await app.request('/api/engine/run', { method: 'POST' });

    const statusRes = await app.request('/api/engine/status');
    const body = (await statusRes.json()) as { isRunning: boolean };
    expect(body.isRunning).toBe(false);
  });
});
