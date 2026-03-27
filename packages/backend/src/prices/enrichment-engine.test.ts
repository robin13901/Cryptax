import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as schema from '../db/schema.js';
import { transactions } from '../db/schema.js';
import type { EnrichmentDeps } from './enrichment-engine.js';
import { runEnrichment } from './enrichment-engine.js';
import { lookupPriceCache, upsertPriceCache } from './price-cache.js';

// ---------------------------------------------------------------------------
// Migration helper (same pattern as price-cache.test.ts)
// ---------------------------------------------------------------------------

function applyMigrations(sqlite: ReturnType<typeof Database>): void {
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
// Test setup
// ---------------------------------------------------------------------------

type Db = ReturnType<typeof drizzle<typeof schema>>;

let sqlite: ReturnType<typeof Database>;
let db: Db;

beforeEach(() => {
  sqlite = new Database(':memory:');
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  applyMigrations(sqlite);
  db = drizzle(sqlite, { schema });
});

afterEach(() => {
  sqlite.close();
});

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** Minimal transaction insert — all required fields. */
function makeTxInsert(overrides: Partial<typeof transactions.$inferInsert> = {}) {
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
    tradedAt: '2024-03-31 12:23:00',
    taxYear: 2024,
    checksum: `chk-${Math.random()}`,
    importedAt: new Date().toISOString(),
    ...overrides,
  } as const;
}

// ---------------------------------------------------------------------------
// Mock deps factory
// ---------------------------------------------------------------------------

function makeDeps(overrides: Partial<EnrichmentDeps> = {}): EnrichmentDeps {
  return {
    bitgetClient: {
      fetchClose: vi.fn().mockResolvedValue(null),
    },
    coingeckoClient: {
      fetchPrice: vi.fn().mockResolvedValue(null),
      loadSymbolMap: vi.fn().mockResolvedValue(new Map([['btc', 'bitcoin']])),
    },
    cache: {
      lookup: lookupPriceCache,
      upsert: upsertPriceCache,
    },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Empty set
// ---------------------------------------------------------------------------

describe('runEnrichment - empty set', () => {
  it('returns zero counts when no unresolved transactions exist', async () => {
    const result = await runEnrichment(db, makeDeps());

    expect(result.total).toBe(0);
    expect(result.resolved).toBe(0);
    expect(result.failed).toBe(0);
    expect(result.failures).toHaveLength(0);
    expect(Object.keys(result.bySource)).toHaveLength(0);
  });

  it('does not call loadSymbolMap when no transactions to process', async () => {
    const deps = makeDeps();
    await runEnrichment(db, deps);

    expect(deps.coingeckoClient.loadSymbolMap).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Mixed results
// ---------------------------------------------------------------------------

describe('runEnrichment - mixed results', () => {
  it('resolves transactions that succeed and records failures for those that do not', async () => {
    // Insert 2 transactions: BTC (will resolve), ETH (will fail)
    await db
      .insert(transactions)
      .values([
        makeTxInsert({ symbol: 'BTC', checksum: 'chk-btc' }),
        makeTxInsert({ symbol: 'ETH', checksum: 'chk-eth' }),
      ]);

    const deps = makeDeps({
      coingeckoClient: {
        fetchPrice: vi.fn().mockImplementation((coinId: string) => {
          if (coinId === 'bitcoin') return Promise.resolve('65000.00');
          return Promise.resolve(null);
        }),
        loadSymbolMap: vi.fn().mockResolvedValue(
          new Map([
            ['btc', 'bitcoin'],
            ['eth', 'ethereum'],
          ])
        ),
      },
    });

    const result = await runEnrichment(db, deps);

    expect(result.total).toBe(2);
    expect(result.resolved).toBe(1);
    expect(result.failed).toBe(1);
    expect(result.bySource.coingecko).toBe(1);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0].symbol).toBe('ETH');
  });

  it('updates eur_price and price_source in DB for resolved transactions', async () => {
    const [inserted] = await db
      .insert(transactions)
      .values(makeTxInsert({ symbol: 'BTC', checksum: 'chk-btc-upd' }))
      .returning();

    const deps = makeDeps({
      coingeckoClient: {
        fetchPrice: vi.fn().mockResolvedValue('65432.10'),
        loadSymbolMap: vi.fn().mockResolvedValue(new Map([['btc', 'bitcoin']])),
      },
    });

    await runEnrichment(db, deps);

    const [_updated] = await db
      .select()
      .from(transactions)
      .where(schema.transactions.id ? undefined : undefined);

    // Get the specific row by id
    const rows = sqlite
      .prepare(
        'SELECT eur_price, price_source, price_failure_reason FROM transactions WHERE id = ?'
      )
      .all(inserted.id) as Array<{
      eur_price: string;
      price_source: string;
      price_failure_reason: string | null;
    }>;

    expect(rows[0].eur_price).toBe('65432.10');
    expect(rows[0].price_source).toBe('coingecko');
    expect(rows[0].price_failure_reason).toBeNull();
  });

  it('updates price_failure_reason in DB for failed transactions', async () => {
    const [inserted] = await db
      .insert(transactions)
      .values(makeTxInsert({ symbol: 'UNKNOWN', checksum: 'chk-unknown' }))
      .returning();

    const deps = makeDeps({
      coingeckoClient: {
        fetchPrice: vi.fn().mockResolvedValue(null),
        loadSymbolMap: vi.fn().mockResolvedValue(new Map()), // UNKNOWN not in map
      },
    });

    await runEnrichment(db, deps);

    const rows = sqlite
      .prepare(
        'SELECT eur_price, price_source, price_failure_reason FROM transactions WHERE id = ?'
      )
      .all(inserted.id) as Array<{
      eur_price: string | null;
      price_source: string | null;
      price_failure_reason: string | null;
    }>;

    expect(rows[0].eur_price).toBeNull();
    expect(rows[0].price_source).toBeNull();
    expect(rows[0].price_failure_reason).toBe('no-bitget-pair');
  });
});

// ---------------------------------------------------------------------------
// Manual entry overwrite
// ---------------------------------------------------------------------------

describe('runEnrichment - manual entry overwrite', () => {
  it('overwrites manual eur_price entries with fresh resolved price', async () => {
    const [inserted] = await db
      .insert(transactions)
      .values(
        makeTxInsert({
          symbol: 'BTC',
          checksum: 'chk-manual',
          // biome-ignore lint/suspicious/noExplicitAny: drizzle schema uses any for optional price fields
          eurPrice: '50000.00' as any,
          // biome-ignore lint/suspicious/noExplicitAny: drizzle schema uses any for optional price fields
          priceSource: 'manual' as any,
        })
      )
      .returning();

    // Confirm it was inserted as manual
    const before = sqlite
      .prepare('SELECT price_source FROM transactions WHERE id = ?')
      .get(inserted.id) as { price_source: string };
    expect(before.price_source).toBe('manual');

    const deps = makeDeps({
      coingeckoClient: {
        fetchPrice: vi.fn().mockResolvedValue('65000.00'),
        loadSymbolMap: vi.fn().mockResolvedValue(new Map([['btc', 'bitcoin']])),
      },
    });

    const result = await runEnrichment(db, deps);

    expect(result.total).toBe(1);
    expect(result.resolved).toBe(1);

    const after = sqlite
      .prepare('SELECT eur_price, price_source FROM transactions WHERE id = ?')
      .get(inserted.id) as { eur_price: string; price_source: string };
    expect(after.eur_price).toBe('65000.00');
    expect(after.price_source).toBe('coingecko');
  });

  it('does NOT re-process transactions that already have a non-manual eur_price', async () => {
    // This tx is already resolved (non-manual) — should be skipped
    await db.insert(transactions).values(
      makeTxInsert({
        symbol: 'BTC',
        checksum: 'chk-already-resolved',
        // biome-ignore lint/suspicious/noExplicitAny: drizzle schema uses any for optional price fields
        eurPrice: '55000.00' as any,
        // biome-ignore lint/suspicious/noExplicitAny: drizzle schema uses any for optional price fields
        priceSource: 'bitget-direct' as any,
      })
    );

    const deps = makeDeps();
    const result = await runEnrichment(db, deps);

    expect(result.total).toBe(0); // No unresolved transactions
    expect(deps.coingeckoClient.loadSymbolMap).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Progress callback
// ---------------------------------------------------------------------------

describe('runEnrichment - progress callback', () => {
  it('calls onProgress once per transaction', async () => {
    await db
      .insert(transactions)
      .values([
        makeTxInsert({ symbol: 'BTC', checksum: 'chk-p1' }),
        makeTxInsert({ symbol: 'ETH', checksum: 'chk-p2' }),
        makeTxInsert({ symbol: 'SOL', checksum: 'chk-p3' }),
      ]);

    const deps = makeDeps({
      coingeckoClient: {
        fetchPrice: vi.fn().mockResolvedValue('100.00'),
        loadSymbolMap: vi.fn().mockResolvedValue(
          new Map([
            ['btc', 'bitcoin'],
            ['eth', 'ethereum'],
            ['sol', 'solana'],
          ])
        ),
      },
    });

    const progressEvents: Parameters<typeof runEnrichment>[2][] = [];
    const onProgress = vi.fn((p) => progressEvents.push(p));

    await runEnrichment(db, deps, onProgress);

    expect(onProgress).toHaveBeenCalledTimes(3);

    // Processed count should increment each call
    const calls = onProgress.mock.calls;
    expect(calls[0][0].processed).toBe(1);
    expect(calls[1][0].processed).toBe(2);
    expect(calls[2][0].processed).toBe(3);

    // Total is always 3
    expect(calls[0][0].total).toBe(3);
    expect(calls[2][0].total).toBe(3);
  });

  it('progress callback carries currentSymbol', async () => {
    await db
      .insert(transactions)
      .values(makeTxInsert({ symbol: 'BTC', checksum: 'chk-symbol-check' }));

    const deps = makeDeps({
      coingeckoClient: {
        fetchPrice: vi.fn().mockResolvedValue('65000.00'),
        loadSymbolMap: vi.fn().mockResolvedValue(new Map([['btc', 'bitcoin']])),
      },
    });

    const onProgress = vi.fn();
    await runEnrichment(db, deps, onProgress);

    expect(onProgress.mock.calls[0][0].currentSymbol).toBe('BTC');
  });
});

// ---------------------------------------------------------------------------
// Exception handling (api-error)
// ---------------------------------------------------------------------------

describe('runEnrichment - exception handling', () => {
  it('catches exception per transaction, records api-error, and continues with remaining', async () => {
    await db
      .insert(transactions)
      .values([
        makeTxInsert({ symbol: 'BTC', checksum: 'chk-throws' }),
        makeTxInsert({ symbol: 'ETH', checksum: 'chk-succeeds' }),
      ]);

    let callCount = 0;
    const deps = makeDeps({
      coingeckoClient: {
        fetchPrice: vi.fn().mockImplementation(() => {
          callCount++;
          if (callCount === 1) throw new Error('Unexpected API crash');
          return Promise.resolve('3000.00');
        }),
        loadSymbolMap: vi.fn().mockResolvedValue(
          new Map([
            ['btc', 'bitcoin'],
            ['eth', 'ethereum'],
          ])
        ),
      },
    });

    const result = await runEnrichment(db, deps);

    // BTC threw → api-error; ETH succeeded
    expect(result.total).toBe(2);
    expect(result.failed).toBe(1);
    expect(result.resolved).toBe(1);
    expect(result.failures[0].reason).toBe('api-error');
  });

  it('records api-error in DB when exception is caught', async () => {
    const [inserted] = await db
      .insert(transactions)
      .values(makeTxInsert({ symbol: 'BTC', checksum: 'chk-api-error-db' }))
      .returning();

    const deps = makeDeps({
      coingeckoClient: {
        fetchPrice: vi.fn().mockRejectedValue(new Error('crash')),
        loadSymbolMap: vi.fn().mockResolvedValue(new Map([['btc', 'bitcoin']])),
      },
    });

    await runEnrichment(db, deps);

    const row = sqlite
      .prepare('SELECT price_failure_reason FROM transactions WHERE id = ?')
      .get(inserted.id) as { price_failure_reason: string };

    expect(row.price_failure_reason).toBe('api-error');
  });
});
