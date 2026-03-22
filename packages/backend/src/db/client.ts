import type { Database as SqliteDatabase } from 'better-sqlite3';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema.js';

const DB_PATH = process.env.DB_PATH ?? 'cryptax.db';

const sqliteDb: SqliteDatabase = new Database(DB_PATH);

// Enable WAL mode for better concurrent read performance
sqliteDb.pragma('journal_mode = WAL');

// Enable foreign key enforcement (SQLite has FKs off by default)
sqliteDb.pragma('foreign_keys = ON');

export const db = drizzle(sqliteDb, { schema });
export const sqlite: SqliteDatabase = sqliteDb;
