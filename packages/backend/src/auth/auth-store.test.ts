import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as schema from '../db/schema.js';

// ---------------------------------------------------------------------------
// DB mock — must be declared before importing the module under test
// ---------------------------------------------------------------------------

let mockDb: ReturnType<typeof drizzle<typeof schema>>;

vi.mock('../db/client.js', () => ({
  get db() {
    return mockDb;
  },
}));

// Import after mock is registered
import { getPasswordHash, hasPassword, setPasswordHash } from './auth-store.js';

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
// Tests
// ---------------------------------------------------------------------------

describe('auth-store', () => {
  let sqlite: ReturnType<typeof Database>;

  beforeEach(() => {
    sqlite = new Database(':memory:');
    applyMigrations(sqlite);
    mockDb = drizzle(sqlite, { schema });
  });

  afterEach(() => {
    sqlite.close();
  });

  it('hasPassword returns false initially', () => {
    expect(hasPassword()).toBe(false);
  });

  it('hasPassword returns true after setPasswordHash', () => {
    setPasswordHash('somehashvalue');
    expect(hasPassword()).toBe(true);
  });

  it('getPasswordHash returns null initially', () => {
    expect(getPasswordHash()).toBeNull();
  });

  it('getPasswordHash returns the stored hash after setPasswordHash', () => {
    setPasswordHash('my_stored_hash_abc123');
    expect(getPasswordHash()).toBe('my_stored_hash_abc123');
  });

  it('setPasswordHash overwrites existing hash (upsert)', () => {
    setPasswordHash('first_hash');
    setPasswordHash('second_hash');
    expect(getPasswordHash()).toBe('second_hash');
    // hasPassword still returns true
    expect(hasPassword()).toBe(true);
  });
});
