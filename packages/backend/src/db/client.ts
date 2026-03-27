import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Database as SqliteDatabase } from 'better-sqlite3';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import * as schema from './schema.js';

const DB_PATH = process.env.DB_PATH ?? 'cryptax.db';

const sqliteDb: SqliteDatabase = new Database(DB_PATH);

// Enable WAL mode for better concurrent read performance
sqliteDb.pragma('journal_mode = WAL');

// Enable foreign key enforcement (SQLite has FKs off by default)
sqliteDb.pragma('foreign_keys = ON');

export const db = drizzle(sqliteDb, { schema });
export const sqlite: SqliteDatabase = sqliteDb;

// Auto-apply migrations on startup (idempotent — skips already-applied)
if (DB_PATH !== ':memory:') {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const migrationsFolder = resolve(__dirname, '../../drizzle');
  migrate(db, { migrationsFolder });
}
