import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as schema from '../db/schema.js';

// ---------------------------------------------------------------------------
// DB mock setup (same pattern as insert.test.ts)
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

import { importCSVFile } from './orchestrator.js';

// ---------------------------------------------------------------------------
// Test CSV fixtures
// ---------------------------------------------------------------------------

/**
 * Minimal spot_tx CSV (semicolon-delimited 2024 style) with 3 valid rows.
 */
const SPOT_TX_CSV = [
  'order;Date;Coin;Type;Amount;Fee;Available',
  '1001;2024-03-01 10:00:00;BTC;Buy;0.1;0.0001;10',
  '1002;2024-03-02 11:00:00;ETH;Sell;-0.5;0;5',
  '1003;2024-03-03 12:00:00;USDT;Buy;100;-0.1;200',
].join('\n');

/**
 * Unknown format CSV — no recognisable header signature.
 */
const UNKNOWN_FORMAT_CSV = ['foo,bar,baz', '1,2,3'].join('\n');

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('importCSVFile', () => {
  let sqlite: ReturnType<typeof Database>;

  beforeEach(() => {
    sqlite = new Database(':memory:');
    sqlite.pragma('journal_mode = WAL');
    sqlite.pragma('foreign_keys = ON');
    applyMigrations(sqlite);
    mockDb = drizzle(sqlite, { schema });
  });

  afterEach(() => {
    sqlite.close();
  });

  describe('happy path — spot_tx CSV', () => {
    it('detects format, parses and inserts all rows', () => {
      const result = importCSVFile(SPOT_TX_CSV, 'test-2024.csv');

      expect(result.filename).toBe('test-2024.csv');
      expect(result.sourceType).toBe('spot_tx');
      expect(result.totalRows).toBe(3);
      expect(result.imported).toBe(3);
      expect(result.duplicatesSkipped).toBe(0);
      expect(result.errors).toHaveLength(0);
      expect(result.batchId).toBeGreaterThan(0);
    });

    it('creates an import_batches record with correct counts', () => {
      const result = importCSVFile(SPOT_TX_CSV, 'test-2024.csv');

      const batch = sqlite
        .prepare('SELECT * FROM import_batches WHERE id = ?')
        .get(result.batchId) as Record<string, unknown>;

      expect(batch.filename).toBe('test-2024.csv');
      expect(batch.source_type).toBe('spot_tx');
      expect(batch.total_rows).toBe(3);
      expect(batch.imported_count).toBe(3);
      expect(batch.duplicates_count).toBe(0);
      expect(batch.errors_count).toBe(0);
    });
  });

  describe('duplicate detection', () => {
    it('second import of same CSV has 0 imported, N duplicates', () => {
      // First import
      const first = importCSVFile(SPOT_TX_CSV, 'test-2024.csv');
      expect(first.imported).toBe(3);

      // Second import — all duplicates
      const second = importCSVFile(SPOT_TX_CSV, 'test-2024.csv');
      expect(second.imported).toBe(0);
      expect(second.duplicatesSkipped).toBe(3);
    });

    it('updates batch record with duplicate counts on re-import', () => {
      importCSVFile(SPOT_TX_CSV, 'test-2024.csv');
      const result = importCSVFile(SPOT_TX_CSV, 'test-2024-dup.csv');

      const batch = sqlite
        .prepare('SELECT * FROM import_batches WHERE id = ?')
        .get(result.batchId) as Record<string, unknown>;

      expect(batch.duplicates_count).toBe(3);
      expect(batch.imported_count).toBe(0);
    });
  });

  describe('error handling — unknown format', () => {
    it('returns PerFileResult with error, does not crash', () => {
      const result = importCSVFile(UNKNOWN_FORMAT_CSV, 'unknown.csv');

      expect(result.imported).toBe(0);
      expect(result.duplicatesSkipped).toBe(0);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].field).toBe('format');
      expect(result.errors[0].message).toContain('Unknown CSV format');
    });

    it('still creates a batch record on format error', () => {
      const result = importCSVFile(UNKNOWN_FORMAT_CSV, 'unknown.csv');

      expect(result.batchId).toBeGreaterThan(0);
      const batch = sqlite
        .prepare('SELECT * FROM import_batches WHERE id = ?')
        .get(result.batchId) as Record<string, unknown>;
      expect(batch).toBeTruthy();
      expect(batch.errors_count).toBe(1);
    });
  });

  describe('CSV with invalid rows', () => {
    it('invalid rows go to errors, valid rows are inserted', () => {
      const csvWithBadRow = [
        'order;Date;Coin;Type;Amount;Fee;Available',
        '1001;2024-03-01 10:00:00;BTC;Buy;0.1;0.0001;10', // valid
        ';;;;;;', // invalid — all required fields empty
      ].join('\n');

      const result = importCSVFile(csvWithBadRow, 'mixed.csv');

      expect(result.totalRows).toBe(2);
      expect(result.imported).toBe(1);
      expect(result.errors.length).toBeGreaterThan(0);
    });
  });
});
