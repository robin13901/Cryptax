import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as schema from '../db/schema.js';
import { lookupPriceCache, upsertPriceCache } from './price-cache.js';

// ---------------------------------------------------------------------------
// Migration helper
// ---------------------------------------------------------------------------

/**
 * Apply all migration SQL files to an in-memory SQLite database.
 * Uses the drizzle separator `--> statement-breakpoint` to split statements.
 */
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

const SYMBOL = 'BTCEUR';
const TIMESTAMP = '2024-03-31T10:23:00.000Z';
const EUR_PRICE = '65432.10';
const SOURCE = 'bitget';
const FETCHED_AT = new Date().toISOString();

// ---------------------------------------------------------------------------
// lookupPriceCache
// ---------------------------------------------------------------------------

describe('lookupPriceCache', () => {
  it('returns null when no matching row exists', async () => {
    const result = await lookupPriceCache(db, SYMBOL, TIMESTAMP);
    expect(result).toBeNull();
  });

  it('returns the entry after an upsert', async () => {
    await upsertPriceCache(db, {
      symbol: SYMBOL,
      timestamp: TIMESTAMP,
      eurPrice: EUR_PRICE,
      source: SOURCE,
      fetchedAt: FETCHED_AT,
    });

    const result = await lookupPriceCache(db, SYMBOL, TIMESTAMP);

    expect(result).not.toBeNull();
    expect(result?.eurPrice).toBe(EUR_PRICE);
    expect(result?.source).toBe(SOURCE);
  });

  it('returns null for a different symbol', async () => {
    await upsertPriceCache(db, {
      symbol: SYMBOL,
      timestamp: TIMESTAMP,
      eurPrice: EUR_PRICE,
      source: SOURCE,
      fetchedAt: FETCHED_AT,
    });

    const result = await lookupPriceCache(db, 'ETHEUR', TIMESTAMP);
    expect(result).toBeNull();
  });

  it('returns null for a different timestamp', async () => {
    await upsertPriceCache(db, {
      symbol: SYMBOL,
      timestamp: TIMESTAMP,
      eurPrice: EUR_PRICE,
      source: SOURCE,
      fetchedAt: FETCHED_AT,
    });

    const result = await lookupPriceCache(db, SYMBOL, '2024-01-01T00:00:00.000Z');
    expect(result).toBeNull();
  });

  it('returns entry with usdtPrice and usdtEurRate when stored', async () => {
    await upsertPriceCache(db, {
      symbol: 'BTCUSDT',
      timestamp: TIMESTAMP,
      eurPrice: '65000.00',
      source: 'usdt_fallback',
      usdtPrice: '70000.00',
      usdtEurRate: '0.9285',
      fetchedAt: FETCHED_AT,
    });

    const result = await lookupPriceCache(db, 'BTCUSDT', TIMESTAMP);

    expect(result?.usdtPrice).toBe('70000.00');
    expect(result?.usdtEurRate).toBe('0.9285');
  });
});

// ---------------------------------------------------------------------------
// upsertPriceCache
// ---------------------------------------------------------------------------

describe('upsertPriceCache', () => {
  it('inserts a new entry successfully', async () => {
    await expect(
      upsertPriceCache(db, {
        symbol: SYMBOL,
        timestamp: TIMESTAMP,
        eurPrice: EUR_PRICE,
        source: SOURCE,
        fetchedAt: FETCHED_AT,
      })
    ).resolves.not.toThrow();

    const result = await lookupPriceCache(db, SYMBOL, TIMESTAMP);
    expect(result).not.toBeNull();
  });

  it('does not throw on duplicate (symbol, timestamp, source)', async () => {
    const entry = {
      symbol: SYMBOL,
      timestamp: TIMESTAMP,
      eurPrice: EUR_PRICE,
      source: SOURCE,
      fetchedAt: FETCHED_AT,
    };

    await upsertPriceCache(db, entry);

    // Second insert with identical (symbol, timestamp, source) — must not throw
    await expect(upsertPriceCache(db, entry)).resolves.not.toThrow();
  });

  it('stores both usdtPrice and usdtEurRate fields', async () => {
    await upsertPriceCache(db, {
      symbol: 'BTCUSDT',
      timestamp: TIMESTAMP,
      eurPrice: '65000.00',
      source: 'usdt_fallback',
      usdtPrice: '70000.00',
      usdtEurRate: '0.9285',
      fetchedAt: FETCHED_AT,
    });

    const row = sqlite
      .prepare("SELECT usdt_price, usdt_eur_rate FROM price_cache WHERE symbol = 'BTCUSDT'")
      .get() as { usdt_price: string; usdt_eur_rate: string };

    expect(row.usdt_price).toBe('70000.00');
    expect(row.usdt_eur_rate).toBe('0.9285');
  });

  it('allows multiple sources for the same symbol + timestamp', async () => {
    const base = { symbol: SYMBOL, timestamp: TIMESTAMP, fetchedAt: FETCHED_AT };

    await upsertPriceCache(db, { ...base, eurPrice: '65000.00', source: 'bitget' });
    await upsertPriceCache(db, { ...base, eurPrice: '65100.00', source: 'usdt_fallback' });

    // Both rows should exist
    const rows = sqlite
      .prepare('SELECT source FROM price_cache WHERE symbol = ? AND timestamp = ? ORDER BY source')
      .all(SYMBOL, TIMESTAMP) as { source: string }[];

    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.source)).toContain('bitget');
    expect(rows.map((r) => r.source)).toContain('usdt_fallback');
  });
});
