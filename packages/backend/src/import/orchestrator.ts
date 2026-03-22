import type { PerFileResult, SourceType } from '@cryptax/shared';
import { eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { importBatches } from '../db/schema.js';
import { batchInsert } from './insert.js';
import { normalizeToTransaction } from './normalize.js';
import { parseRawCSV } from './parse-csv.js';
import { parseEarn } from './parsers/earn.js';
import { parseFuturesOrder } from './parsers/futures-order.js';
import { parseFuturesTx } from './parsers/futures-tx.js';
import { parseSpotOrder } from './parsers/spot-order.js';
import { parseSpotTx } from './parsers/spot-tx.js';

// ---------------------------------------------------------------------------
// importCSVFile
// ---------------------------------------------------------------------------

/**
 * Orchestrates the full CSV import pipeline for a single file:
 *   1. parseRawCSV   — detect format + delimiter, parse to raw rows
 *   2. format parser — validate rows, collect errors (spot_tx, etc.)
 *   3. normalizeToTransaction — map each valid raw row to a DB insert shape
 *   4. batchInsert   — insert with dedup via onConflictDoNothing
 *   5. importBatches — create + update a tracking record
 *
 * Returns a PerFileResult with counts and any row-level errors.
 *
 * @param fileText  Raw CSV file content (may contain BOM).
 * @param filename  Original filename for traceability and batch record.
 */
export function importCSVFile(fileText: string, filename: string): PerFileResult {
  // -------------------------------------------------------------------------
  // 1. Parse raw CSV — detect format + rows
  // -------------------------------------------------------------------------
  let format: SourceType;
  let rawRows: Record<string, string>[];

  try {
    const parsed = parseRawCSV(fileText);
    format = parsed.format;
    rawRows = parsed.rows;
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'Unknown parse error';

    // Create a failed batch record with zero counts
    const [batch] = db
      .insert(importBatches)
      .values({
        filename,
        sourceType: 'spot_tx', // fallback — format unknown
        totalRows: 0,
        importedCount: 0,
        duplicatesCount: 0,
        errorsCount: 1,
        importedAt: new Date().toISOString(),
      })
      .returning()
      .all();

    return {
      filename,
      sourceType: 'spot_tx',
      totalRows: 0,
      imported: 0,
      duplicatesSkipped: 0,
      errors: [{ row: 0, field: 'format', message: errorMessage }],
      batchId: batch.id,
    };
  }

  // -------------------------------------------------------------------------
  // 2. Run format-specific parser to collect validation errors
  // -------------------------------------------------------------------------
  let parserErrors: {
    row: number;
    field: string;
    message: string;
    rawData?: string;
  }[] = [];

  switch (format) {
    case 'spot_tx': {
      parserErrors = parseSpotTx(rawRows, filename).errors;
      break;
    }
    case 'futures_tx': {
      parserErrors = parseFuturesTx(rawRows, filename).errors;
      break;
    }
    case 'spot_order': {
      parserErrors = parseSpotOrder(rawRows, filename).errors;
      break;
    }
    case 'futures_order': {
      parserErrors = parseFuturesOrder(rawRows, filename).errors;
      break;
    }
    case 'earn': {
      parserErrors = parseEarn(rawRows, filename).errors;
      break;
    }
  }

  // Set of row indices that had validation errors — skip these rows
  const errorRowIndices = new Set(parserErrors.map((e) => e.row));

  // -------------------------------------------------------------------------
  // 3. Create the import_batches record BEFORE inserting
  // -------------------------------------------------------------------------
  const [batch] = db
    .insert(importBatches)
    .values({
      filename,
      sourceType: format,
      totalRows: rawRows.length,
      importedCount: 0,
      duplicatesCount: 0,
      errorsCount: parserErrors.length,
      importedAt: new Date().toISOString(),
    })
    .returning()
    .all();

  // -------------------------------------------------------------------------
  // 4. Normalize valid rows into DB insert shapes
  // -------------------------------------------------------------------------
  const normalizedRows = rawRows
    .filter((_, i) => !errorRowIndices.has(i))
    .map((rawRow) => normalizeToTransaction(rawRow, format, filename, rawRow));

  // -------------------------------------------------------------------------
  // 5. Insert with dedup
  // -------------------------------------------------------------------------
  const insertResult = batchInsert(normalizedRows, batch.id);

  // -------------------------------------------------------------------------
  // 6. Update batch record with actual counts
  // -------------------------------------------------------------------------
  db.update(importBatches)
    .set({
      importedCount: insertResult.inserted,
      duplicatesCount: insertResult.duplicates,
    })
    .where(eq(importBatches.id, batch.id))
    .run();

  return {
    filename,
    sourceType: format,
    totalRows: rawRows.length,
    imported: insertResult.inserted,
    duplicatesSkipped: insertResult.duplicates,
    errors: parserErrors,
    batchId: batch.id,
  };
}
