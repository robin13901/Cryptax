import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Database as SqliteDatabase } from 'better-sqlite3';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import * as schema from './schema.js';

let _db: BetterSQLite3Database<typeof schema> | null = null;
let _sqlite: SqliteDatabase | null = null;

/** Default migrations folder (relative to compiled db/client.js) */
function defaultMigrationsPath(): string {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  return resolve(__dirname, '../../drizzle');
}

/**
 * Initialize the database explicitly with custom paths.
 * Call this BEFORE any code accesses `db` or `sqlite`.
 * Used by the Electron main process to set userData paths.
 */
export function initDb(options: { dbPath: string; migrationsPath?: string }): void {
  if (_db) throw new Error('Database already initialized');
  const sqliteDb = new Database(options.dbPath);
  // Enable WAL mode for better concurrent read performance
  sqliteDb.pragma('journal_mode = WAL');
  // Enable foreign key enforcement (SQLite has FKs off by default)
  sqliteDb.pragma('foreign_keys = ON');
  _db = drizzle(sqliteDb, { schema });
  _sqlite = sqliteDb;

  if (options.dbPath !== ':memory:') {
    const folder = options.migrationsPath ?? defaultMigrationsPath();
    migrate(_db, { migrationsFolder: folder });
  }
}

/**
 * Returns the default migrations folder path.
 * Useful for the Electron main process to know where source migrations live.
 */
export function getMigrationsPath(): string {
  return defaultMigrationsPath();
}

/** Auto-initialize on first access (existing behavior). */
function ensureInitialized(): void {
  if (!_db) {
    const dbPath = process.env.DB_PATH ?? 'cryptax.db';
    initDb({ dbPath, migrationsPath: defaultMigrationsPath() });
  }
}

/** Drizzle ORM instance. Auto-initializes on first access. */
export const db: BetterSQLite3Database<typeof schema> = new Proxy(
  {} as BetterSQLite3Database<typeof schema>,
  {
    get(_target, prop, receiver) {
      ensureInitialized();
      return Reflect.get(_db!, prop, receiver);
    },
  },
);

/** Raw better-sqlite3 instance. Auto-initializes on first access. */
export const sqlite: SqliteDatabase = new Proxy({} as SqliteDatabase, {
  get(_target, prop, receiver) {
    ensureInitialized();
    return Reflect.get(_sqlite!, prop, receiver);
  },
});
