import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as schema from '../db/schema.js';
import { transactions } from '../db/schema.js';
import { checkNullPrices } from './null-price-gate.js';

// ---------------------------------------------------------------------------
// Migration helper — same pattern as price-cache.test.ts
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

let checksumCounter = 0;

function makeTxInsert(overrides: Partial<typeof transactions.$inferInsert> = {}) {
  checksumCounter += 1;
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
    checksum: `chk-${checksumCounter}-${Math.random()}`,
    importedAt: new Date().toISOString(),
    eurPrice: '65000',
    ...overrides,
  } as typeof transactions.$inferInsert;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('checkNullPrices', () => {
  it('passes when all taxable transactions have eurPrice', () => {
    db.insert(transactions)
      .values([
        makeTxInsert({ canonicalType: 'buy', eurPrice: '65000' }),
        makeTxInsert({ canonicalType: 'sell', eurPrice: '70000' }),
        makeTxInsert({
          canonicalType: 'futures_close_long',
          sourceType: 'futures_tx',
          eurPrice: '65500',
        }),
      ])
      .run();

    const errors = checkNullPrices(db);

    expect(errors).toHaveLength(0);
  });

  it('fails when a buy transaction has NULL eurPrice', () => {
    db.insert(transactions)
      .values([makeTxInsert({ canonicalType: 'buy', eurPrice: null })])
      .run();

    const result = db.select().from(transactions).all();
    const errors = checkNullPrices(db);

    expect(errors).toHaveLength(1);
    expect(errors[0].canonicalType).toBe('buy');
    expect(errors[0].symbol).toBe('BTC');
    expect(errors[0].transactionId).toBe(result[0].id);
  });

  it('fails when a futures_close_long transaction has NULL eurPrice', () => {
    db.insert(transactions)
      .values([
        makeTxInsert({
          canonicalType: 'futures_close_long',
          sourceType: 'futures_tx',
          symbol: 'BTCUSDT',
          eurPrice: null,
        }),
      ])
      .run();

    const errors = checkNullPrices(db);

    expect(errors).toHaveLength(1);
    expect(errors[0].canonicalType).toBe('futures_close_long');
    expect(errors[0].symbol).toBe('BTCUSDT');
  });

  it('ignores transfer_in with NULL eurPrice', () => {
    db.insert(transactions)
      .values([
        makeTxInsert({
          canonicalType: 'transfer_in',
          sourceType: 'spot_tx',
          eurPrice: null,
        }),
      ])
      .run();

    const errors = checkNullPrices(db);

    expect(errors).toHaveLength(0);
  });

  it('ignores earn_withdrawal with NULL eurPrice', () => {
    db.insert(transactions)
      .values([
        makeTxInsert({
          canonicalType: 'earn_withdrawal',
          sourceType: 'earn',
          eurPrice: null,
        }),
      ])
      .run();

    const errors = checkNullPrices(db);

    expect(errors).toHaveLength(0);
  });

  it('returns multiple errors when multiple taxable transactions have NULL eurPrice', () => {
    db.insert(transactions)
      .values([
        makeTxInsert({ canonicalType: 'buy', symbol: 'BTC', eurPrice: null }),
        makeTxInsert({ canonicalType: 'sell', symbol: 'ETH', eurPrice: null }),
        // This one has a price — should not appear in errors
        makeTxInsert({ canonicalType: 'buy', symbol: 'SOL', eurPrice: '150' }),
      ])
      .run();

    const errors = checkNullPrices(db);

    expect(errors).toHaveLength(2);
    const symbols = errors.map((e) => e.symbol).sort();
    expect(symbols).toEqual(['BTC', 'ETH']);
  });

  it('ignores fee and unknown canonical types with NULL eurPrice', () => {
    db.insert(transactions)
      .values([
        makeTxInsert({ canonicalType: 'fee', eurPrice: null }),
        makeTxInsert({ canonicalType: 'unknown', eurPrice: null }),
      ])
      .run();

    const errors = checkNullPrices(db);

    expect(errors).toHaveLength(0);
  });

  it('includes tradedAt and sourceType in returned errors', () => {
    db.insert(transactions)
      .values([
        makeTxInsert({
          canonicalType: 'earn_interest',
          sourceType: 'earn',
          tradedAt: '2024-06-15 08:00:00',
          eurPrice: null,
        }),
      ])
      .run();

    const errors = checkNullPrices(db);

    expect(errors).toHaveLength(1);
    expect(errors[0].tradedAt).toBe('2024-06-15 08:00:00');
    expect(errors[0].sourceType).toBe('earn');
    expect(errors[0].canonicalType).toBe('earn_interest');
  });
});
