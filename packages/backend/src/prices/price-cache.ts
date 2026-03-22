import { and, eq } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import type * as schema from '../db/schema.js';
import { priceCache } from '../db/schema.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Db = BetterSQLite3Database<typeof schema>;

/** A row returned from the price_cache table. */
export type PriceCacheEntry = typeof priceCache.$inferSelect;

/** A row suitable for inserting into the price_cache table. */
export type PriceCacheInsert = typeof priceCache.$inferInsert;

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

/**
 * Looks up the price cache for a given symbol and minute-precision UTC timestamp.
 *
 * Returns the first matching row or `null` if no entry exists.
 * When multiple sources are present for the same symbol+timestamp, returns
 * whichever row the database returns first (caller should prefer a specific
 * source before calling this if determinism matters).
 */
export async function lookupPriceCache(
  db: Db,
  symbol: string,
  timestampMinute: string
): Promise<PriceCacheEntry | null> {
  const rows = await db
    .select()
    .from(priceCache)
    .where(and(eq(priceCache.symbol, symbol), eq(priceCache.timestamp, timestampMinute)))
    .limit(1);

  return rows[0] ?? null;
}

// ---------------------------------------------------------------------------
// Write
// ---------------------------------------------------------------------------

/**
 * Inserts a price cache entry. If a row with the same (symbol, timestamp, source)
 * already exists the insert is silently ignored (onConflictDoNothing).
 */
export async function upsertPriceCache(db: Db, entry: PriceCacheInsert): Promise<void> {
  await db.insert(priceCache).values(entry).onConflictDoNothing();
}
