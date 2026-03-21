import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as schema from '../db/schema.js';

// ---------------------------------------------------------------------------
// DB setup helpers
// ---------------------------------------------------------------------------

/**
 * Apply the two migration SQL files to an in-memory SQLite database.
 * Statements are split on the drizzle separator `--> statement-breakpoint`.
 */
function applyMigrations(sqlite: ReturnType<typeof Database>) {
  const migrationsDir = path.resolve(process.cwd(), 'packages/backend/drizzle');

  for (const file of ['0000_initial.sql', '0001_import_batches.sql']) {
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
// Mocked db module
// ---------------------------------------------------------------------------

// We mock ../db/client.js to return an in-memory database for each test.
let mockDb: ReturnType<typeof drizzle<typeof schema>>;

vi.mock('../db/client.js', () => ({
  get db() {
    return mockDb;
  },
  get sqlite() {
    return undefined;
  },
}));

import { batchInsert } from './insert.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeBatch(sqlite: ReturnType<typeof Database>): ReturnType<typeof drizzle<typeof schema>> {
  return drizzle(sqlite, { schema });
}

/** Insert a dummy import_batches row and return its id (satisfies FK). */
function createBatch(sqlite: ReturnType<typeof Database>): number {
  const row = sqlite
    .prepare(
      `INSERT INTO import_batches
         (filename, source_type, total_rows, imported_count, duplicates_count, errors_count, imported_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run('test.csv', 'spot_tx', 0, 0, 0, 0, new Date().toISOString());
  return row.lastInsertRowid as number;
}

/** Return a minimal valid transactions insert row. */
function makeRow(
  batchId: number,
  overrides: Partial<typeof schema.transactions.$inferInsert> = {}
): typeof schema.transactions.$inferInsert {
  return {
    orderId: 'ORD-001',
    exchange: 'bitget',
    sourceType: 'spot_tx',
    canonicalType: 'buy',
    symbol: 'BTC',
    side: 'buy',
    amount: '0.5',
    price: '0',
    fee: '0',
    totalValue: '0',
    tradedAt: '2024-03-15 10:30:00',
    taxYear: 2024,
    sourceFile: 'test.csv',
    rawRow: '{}',
    checksum: 'checksum-001',
    importedAt: new Date().toISOString(),
    batchId,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('batchInsert', () => {
  let sqlite: ReturnType<typeof Database>;
  let batchId: number;

  beforeEach(() => {
    sqlite = new Database(':memory:');
    sqlite.pragma('journal_mode = WAL');
    sqlite.pragma('foreign_keys = ON');
    applyMigrations(sqlite);
    mockDb = makeBatch(sqlite);
    batchId = createBatch(sqlite);
  });

  afterEach(() => {
    sqlite.close();
  });

  it('inserts 3 new rows — returns inserted: 3, duplicates: 0', () => {
    const rows = [
      makeRow(batchId, { orderId: 'A', checksum: 'cs-A' }),
      makeRow(batchId, { orderId: 'B', checksum: 'cs-B' }),
      makeRow(batchId, { orderId: 'C', checksum: 'cs-C' }),
    ];

    const result = batchInsert(rows, batchId);

    expect(result.inserted).toBe(3);
    expect(result.duplicates).toBe(0);
  });

  it('re-inserting same 3 rows skips all — returns inserted: 0, duplicates: 3', () => {
    const rows = [
      makeRow(batchId, { orderId: 'A', checksum: 'cs-A' }),
      makeRow(batchId, { orderId: 'B', checksum: 'cs-B' }),
      makeRow(batchId, { orderId: 'C', checksum: 'cs-C' }),
    ];

    // First insert
    batchInsert(rows, batchId);

    // Second insert — all should be duplicates
    const result = batchInsert(rows, batchId);

    expect(result.inserted).toBe(0);
    expect(result.duplicates).toBe(3);
  });

  it('inserting 250 rows — all inserted (tests chunking at 200)', () => {
    const rows = Array.from({ length: 250 }, (_, i) =>
      makeRow(batchId, { orderId: `ORD-${i}`, checksum: `cs-${i}` })
    );

    const result = batchInsert(rows, batchId);

    expect(result.inserted).toBe(250);
    expect(result.duplicates).toBe(0);
  });

  it('returns inserted: 0, duplicates: 0 for empty input', () => {
    const result = batchInsert([], batchId);

    expect(result.inserted).toBe(0);
    expect(result.duplicates).toBe(0);
  });

  it('partial duplicates — only new rows are counted', () => {
    const existing = [makeRow(batchId, { orderId: 'X', checksum: 'cs-X' })];
    batchInsert(existing, batchId);

    const mixed = [
      makeRow(batchId, { orderId: 'X', checksum: 'cs-X' }), // duplicate
      makeRow(batchId, { orderId: 'Y', checksum: 'cs-Y' }), // new
    ];

    const result = batchInsert(mixed, batchId);

    expect(result.inserted).toBe(1);
    expect(result.duplicates).toBe(1);
  });

  it('stamps batchId on each inserted row', () => {
    const rows = [makeRow(batchId, { orderId: 'Z', checksum: 'cs-Z' })];
    batchInsert(rows, batchId);

    const stored = sqlite
      .prepare("SELECT batch_id FROM transactions WHERE order_id = 'Z'")
      .get() as { batch_id: number };

    expect(stored.batch_id).toBe(batchId);
  });
});
