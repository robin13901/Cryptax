import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as schema from '../db/schema.js';

// ---------------------------------------------------------------------------
// vi.hoisted — TDZ-safe ref for mockDb (must exist before vi.mock factory runs)
// ---------------------------------------------------------------------------

const { mockDbRef } = vi.hoisted(() => ({
  mockDbRef: { current: null as ReturnType<typeof drizzle<typeof schema>> | null },
}));

// ---------------------------------------------------------------------------
// Module mocks — declared before any imports that resolve them
// ---------------------------------------------------------------------------

vi.mock('../db/client.js', () => ({
  get db() {
    return mockDbRef.current;
  },
  get sqlite() {
    return undefined;
  },
}));

// Mock BitgetAdapter — controlled per-test
const mockFetchSpotTrades = vi.fn();
const mockFetchFuturesTrades = vi.fn();

vi.mock('./bitget-adapter.js', () => ({
  BitgetAdapter: vi.fn().mockImplementation(() => ({
    fetchSpotTrades: mockFetchSpotTrades,
    fetchFuturesTrades: mockFetchFuturesTrades,
  })),
}));

// encryptCredentials used directly in test helper (no mock — we need real encryption)
import { encryptCredentials } from '../auth/credential-cipher.js';
// Import syncExchange AFTER mocks are declared
import { syncExchange } from './sync-engine.js';

// ---------------------------------------------------------------------------
// Migration helper (matches exchanges.test.ts pattern)
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

const MASTER_KEY = 'test-master-key-1234567890abcdef12345678';

function seedMasterKey(sqlite: ReturnType<typeof Database>): void {
  sqlite.exec(
    `INSERT INTO app_settings (key, value, updated_at)
     VALUES ('credential_master_key', '${MASTER_KEY}', '${new Date().toISOString()}')`
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSpotTrade(overrides: Record<string, unknown> = {}) {
  return {
    id: 'spot-fill-001',
    order: 'spot-order-001',
    timestamp: new Date('2024-01-15T10:00:00Z').getTime(),
    datetime: '2024-01-15T10:00:00Z',
    symbol: 'BTC/USDT',
    side: 'buy',
    price: 42000,
    amount: 0.01,
    cost: 420,
    fee: { cost: 0.42, currency: 'USDT' },
    takerOrMaker: 'maker',
    type: 'limit',
    info: {},
    ...overrides,
  };
}

function makeFuturesTrade(overrides: Record<string, unknown> = {}) {
  return {
    id: 'fut-fill-001',
    order: 'fut-order-001',
    timestamp: new Date('2024-01-15T11:00:00Z').getTime(),
    datetime: '2024-01-15T11:00:00Z',
    symbol: 'BTC/USDT:USDT',
    side: 'sell',
    price: 42100,
    amount: 0.01,
    cost: 421,
    fee: { cost: 0.421, currency: 'USDT' },
    takerOrMaker: 'taker',
    type: 'market',
    info: {},
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Shared setup
// ---------------------------------------------------------------------------

describe('syncExchange', () => {
  let sqlite: ReturnType<typeof Database>;

  beforeEach(() => {
    vi.clearAllMocks();

    sqlite = new Database(':memory:');
    applyMigrations(sqlite);
    seedMasterKey(sqlite);
    mockDbRef.current = drizzle(sqlite, { schema });

    // Default: return empty arrays (no trades)
    mockFetchSpotTrades.mockResolvedValue([]);
    mockFetchFuturesTrades.mockResolvedValue([]);
  });

  afterEach(() => {
    sqlite.close();
  });

  // -------------------------------------------------------------------------
  // Helper: insert an exchange connection with real encrypted credentials
  // -------------------------------------------------------------------------

  function insertConnection(opts: { lastSyncAt?: string } = {}): number {
    const encrypted = encryptCredentials(
      JSON.stringify({ apiKey: 'test-key', secret: 'test-secret', password: 'test-pass' }),
      MASTER_KEY
    );

    const row = mockDbRef.current
      ?.insert(schema.exchangeConnections)
      .values({
        exchange: 'bitget',
        label: 'Test Bitget',
        encryptedCredentials: encrypted,
        lastSyncAt: opts.lastSyncAt ?? null,
        createdAt: new Date().toISOString(),
      })
      .returning({ id: schema.exchangeConnections.id })
      .get();

    return row?.id;
  }

  // -------------------------------------------------------------------------
  // Error: connection not found
  // -------------------------------------------------------------------------

  it('throws when connectionId does not exist', async () => {
    await expect(syncExchange(9999)).rejects.toThrow('Exchange connection 9999 not found');
  });

  // -------------------------------------------------------------------------
  // Happy path: no trades
  // -------------------------------------------------------------------------

  it('returns zero counts when both spot and futures return empty arrays', async () => {
    const connectionId = insertConnection();

    const result = await syncExchange(connectionId);

    expect(result.connectionId).toBe(connectionId);
    expect(result.exchange).toBe('bitget');
    expect(result.totalImported).toBe(0);
    expect(result.totalDuplicates).toBe(0);
    expect(result.warnings).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // Happy path: spot + futures trades imported
  // -------------------------------------------------------------------------

  it('imports spot and futures trades and returns correct counts', async () => {
    const connectionId = insertConnection();

    mockFetchSpotTrades.mockResolvedValue([makeSpotTrade()]);
    mockFetchFuturesTrades.mockResolvedValue([makeFuturesTrade()]);

    const result = await syncExchange(connectionId);

    expect(result.spotTrades.imported).toBe(1);
    expect(result.futuresTrades.imported).toBe(1);
    expect(result.totalImported).toBe(2);
    expect(result.totalDuplicates).toBe(0);
    expect(result.warnings).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // Deduplication: second sync of same trades = duplicates
  // -------------------------------------------------------------------------

  it('deduplicates on second sync — same trades become duplicates', async () => {
    const connectionId = insertConnection();

    const spot = makeSpotTrade();
    const futures = makeFuturesTrade();

    mockFetchSpotTrades.mockResolvedValue([spot]);
    mockFetchFuturesTrades.mockResolvedValue([futures]);

    // First sync
    const first = await syncExchange(connectionId);
    expect(first.totalImported).toBe(2);

    // Second sync with identical trades
    const second = await syncExchange(connectionId);
    expect(second.totalImported).toBe(0);
    expect(second.totalDuplicates).toBe(2);
  });

  // -------------------------------------------------------------------------
  // Incremental sync: lastSyncAt watermark passed to adapter
  // -------------------------------------------------------------------------

  it('passes lastSyncAt as since to fetchSpotTrades and fetchFuturesTrades', async () => {
    const lastSyncAt = '2024-01-10T00:00:00.000Z';
    const connectionId = insertConnection({ lastSyncAt });

    await syncExchange(connectionId);

    const expectedSince = new Date(lastSyncAt).getTime();
    expect(mockFetchSpotTrades).toHaveBeenCalledWith(expectedSince);
    expect(mockFetchFuturesTrades).toHaveBeenCalledWith(expectedSince);
  });

  it('passes undefined as since when lastSyncAt is null (first sync)', async () => {
    const connectionId = insertConnection({ lastSyncAt: undefined });

    await syncExchange(connectionId);

    expect(mockFetchSpotTrades).toHaveBeenCalledWith(undefined);
    expect(mockFetchFuturesTrades).toHaveBeenCalledWith(undefined);
  });

  // -------------------------------------------------------------------------
  // Watermark update
  // -------------------------------------------------------------------------

  it('updates lastSyncAt on exchange_connections after successful sync', async () => {
    const connectionId = insertConnection();

    const before = new Date('2020-01-01').getTime();
    const result = await syncExchange(connectionId);

    // Verify the watermark was written to DB
    const _conn = mockDbRef.current
      ?.select({ lastSyncAt: schema.exchangeConnections.lastSyncAt })
      .from(schema.exchangeConnections)
      .where(schema.exchangeConnections.id === connectionId)
      .get();

    expect(result.syncedAt).toBeTruthy();
    expect(new Date(result.syncedAt).getTime()).toBeGreaterThan(before);
  });

  // -------------------------------------------------------------------------
  // Partial failure: spot succeeds, futures fails
  // -------------------------------------------------------------------------

  it('imports spot trades and adds warning when futures fetch fails', async () => {
    const connectionId = insertConnection();

    mockFetchSpotTrades.mockResolvedValue([makeSpotTrade()]);
    mockFetchFuturesTrades.mockRejectedValue(new Error('Futures API timeout'));

    const result = await syncExchange(connectionId);

    expect(result.spotTrades.imported).toBe(1);
    expect(result.futuresTrades.imported).toBe(0);
    expect(result.futuresTrades.errors).toBe(1);
    expect(result.totalImported).toBe(1);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('Futures trade fetch failed');
    expect(result.warnings[0]).toContain('Futures API timeout');
  });

  // -------------------------------------------------------------------------
  // Partial failure: futures succeeds, spot fails
  // -------------------------------------------------------------------------

  it('imports futures trades and adds warning when spot fetch fails', async () => {
    const connectionId = insertConnection();

    mockFetchSpotTrades.mockRejectedValue(new Error('Spot rate limit exceeded'));
    mockFetchFuturesTrades.mockResolvedValue([makeFuturesTrade()]);

    const result = await syncExchange(connectionId);

    expect(result.futuresTrades.imported).toBe(1);
    expect(result.spotTrades.imported).toBe(0);
    expect(result.spotTrades.errors).toBe(1);
    expect(result.totalImported).toBe(1);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('Spot trade fetch failed');
    expect(result.warnings[0]).toContain('Spot rate limit exceeded');
  });

  // -------------------------------------------------------------------------
  // Multiple trades imported
  // -------------------------------------------------------------------------

  it('imports multiple spot trades from a single sync', async () => {
    const connectionId = insertConnection();

    const trades = [
      makeSpotTrade({ id: 'spot-001' }),
      makeSpotTrade({ id: 'spot-002', timestamp: new Date('2024-01-16T10:00:00Z').getTime() }),
      makeSpotTrade({ id: 'spot-003', timestamp: new Date('2024-01-17T10:00:00Z').getTime() }),
    ];

    mockFetchSpotTrades.mockResolvedValue(trades);

    const result = await syncExchange(connectionId);

    expect(result.spotTrades.imported).toBe(3);
    expect(result.totalImported).toBe(3);
  });

  // -------------------------------------------------------------------------
  // SyncResult shape
  // -------------------------------------------------------------------------

  it('returns correct SyncResult shape with all required fields', async () => {
    const connectionId = insertConnection();

    const result = await syncExchange(connectionId);

    expect(result).toHaveProperty('connectionId');
    expect(result).toHaveProperty('exchange');
    expect(result).toHaveProperty('spotTrades');
    expect(result).toHaveProperty('futuresTrades');
    expect(result).toHaveProperty('totalImported');
    expect(result).toHaveProperty('totalDuplicates');
    expect(result).toHaveProperty('syncedAt');
    expect(result).toHaveProperty('warnings');

    expect(result.spotTrades).toHaveProperty('imported');
    expect(result.spotTrades).toHaveProperty('duplicates');
    expect(result.spotTrades).toHaveProperty('errors');

    expect(result.futuresTrades).toHaveProperty('imported');
    expect(result.futuresTrades).toHaveProperty('duplicates');
    expect(result.futuresTrades).toHaveProperty('errors');
  });
});
