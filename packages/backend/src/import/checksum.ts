import { createHash } from 'node:crypto';

// ---------------------------------------------------------------------------
// computeChecksum
// ---------------------------------------------------------------------------

/**
 * Compute a deterministic SHA-256 checksum for a single CSV row.
 *
 * The row is serialised via JSON.stringify (column order is preserved by
 * csv-parse — the same file parsed twice always produces the same key order).
 * The hex digest is 64 characters long.
 *
 * Used downstream by the transactions table UNIQUE constraint on
 * (order_id, exchange, checksum) to detect and skip duplicate rows on
 * re-import.
 *
 * @param row - A key→value record as returned by csv-parse (columns: true).
 * @returns 64-character lowercase hex SHA-256 digest.
 */
export function computeChecksum(row: Record<string, string>): string {
  return createHash('sha256').update(JSON.stringify(row)).digest('hex');
}
