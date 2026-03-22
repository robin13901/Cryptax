import type { SourceType } from '@cryptax/shared';
import { parse } from 'csv-parse/sync';
import { detectDelimiter, detectFormat } from './detect-format.js';

// ---------------------------------------------------------------------------
// parseRawCSV
// ---------------------------------------------------------------------------

/**
 * Parse a raw Bitget CSV file into typed row objects.
 *
 * This is the entry point for all CSV processing. It:
 *   1. Detects the delimiter from the header line (BEFORE format detection).
 *   2. Detects the format by column signature.
 *   3. Parses all rows using csv-parse/sync with BOM stripping, trimming, and
 *      column names derived from the header row.
 *
 * The returned rows are ready to be passed to the appropriate format-specific
 * parser (parseSpotTx, parseFuturesTx, etc.) and then to normalizeToTransaction.
 *
 * @param fileText - Full raw CSV file content (may have UTF-8 BOM).
 * @returns Object with detected format, delimiter, and parsed row array.
 */
export function parseRawCSV(fileText: string): {
  format: SourceType;
  delimiter: ';' | ',';
  rows: Record<string, string>[];
} {
  // Strip BOM manually to get clean header for delimiter + format detection
  const noBom = fileText.startsWith('\uFEFF') ? fileText.slice(1) : fileText;
  const headerLine = noBom.split('\n')[0];

  const delimiter = detectDelimiter(headerLine);
  const format = detectFormat(fileText); // uses its own BOM stripping

  const rows = parse(fileText, {
    bom: true,
    delimiter,
    columns: true,
    skip_empty_lines: true,
    trim: true,
    relax_column_count: true,
  }) as Record<string, string>[];

  return { format, delimiter, rows };
}
