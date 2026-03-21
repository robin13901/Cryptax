import { db } from '../db/client.js';
import { transactions } from '../db/schema.js';

// ---------------------------------------------------------------------------
// chunkArray
// ---------------------------------------------------------------------------

/**
 * Split an array into chunks of at most `size` elements.
 */
function chunkArray<T>(array: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
}

// ---------------------------------------------------------------------------
// batchInsert
// ---------------------------------------------------------------------------

/**
 * Insert rows into the transactions table in chunks of 200, using
 * onConflictDoNothing for deduplication based on the unique constraint
 * (order_id, exchange, checksum).
 *
 * All chunks are wrapped in a single transaction for atomicity.
 *
 * @param rows    Insert-ready row objects matching the transactions schema.
 * @param batchId Import batch ID to associate with all rows.
 * @returns       Count of actually inserted rows and skipped duplicates.
 */
export function batchInsert(
  rows: (typeof transactions.$inferInsert)[],
  batchId: number
): { inserted: number; duplicates: number } {
  if (rows.length === 0) {
    return { inserted: 0, duplicates: 0 };
  }

  // Stamp each row with the batchId
  const stamped = rows.map((r) => ({ ...r, batchId }));
  const chunks = chunkArray(stamped, 200);

  let inserted = 0;

  db.transaction((tx) => {
    for (const chunk of chunks) {
      const result = tx.insert(transactions).values(chunk).onConflictDoNothing().run();
      inserted += result.changes;
    }
  });

  const duplicates = rows.length - inserted;
  return { inserted, duplicates };
}
