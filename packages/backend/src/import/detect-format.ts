import type { SourceType } from '@cryptax/shared';

// ---------------------------------------------------------------------------
// detectDelimiter
// ---------------------------------------------------------------------------

/**
 * Determine whether a CSV header line uses semicolons or commas as the
 * field delimiter.
 *
 * The 2024 Bitget spot transaction file is the ONLY semicolon-delimited
 * format. All other formats use commas. Delimiter detection MUST run before
 * format detection so that header columns can be split correctly.
 *
 * @param headerLine - The raw first line of a CSV file (BOM stripped).
 * @returns ';' when semicolons outnumber commas, ',' otherwise.
 */
export function detectDelimiter(headerLine: string): ';' | ',' {
  const semiCount = (headerLine.match(/;/g) ?? []).length;
  const commaCount = (headerLine.match(/,/g) ?? []).length;
  return semiCount > commaCount ? ';' : ',';
}

// ---------------------------------------------------------------------------
// detectFormat
// ---------------------------------------------------------------------------

/**
 * Identify which of the 5 Bitget CSV formats a raw file contains.
 *
 * Detection order (most-specific first to least-specific):
 *   1. earn          — unique 'interest coin' + 'reference' columns
 *   2. futures_order — unique 'netprofits' + 'realized p/l' columns
 *   3. spot_order    — unique 'trading pair' + 'base asset' columns
 *   4. futures_tx    — unique 'futures' + 'wallet balance' columns
 *   5. spot_tx       — unique 'available' column
 *
 * The 2024 and 2025 spot transaction files have identical headers but
 * different delimiters — delimiter detection is applied first so column
 * splitting works regardless of which variant is supplied.
 *
 * @param rawText - Full CSV file text (may contain UTF-8 BOM).
 * @returns The detected {@link SourceType}.
 * @throws Error when no format signature matches.
 */
export function detectFormat(rawText: string): SourceType {
  // Strip BOM if present
  const noBom = rawText.startsWith('\uFEFF') ? rawText.slice(1) : rawText;
  const firstLine = noBom.split('\n')[0];
  const delim = detectDelimiter(firstLine);

  const cols = firstLine.split(delim).map((c) => c.trim().toLowerCase().replace(/\r$/, ''));

  const has = (col: string): boolean => cols.includes(col);

  // Most-specific checks first
  if (has('interest coin') && has('reference')) return 'earn';
  if (has('netprofits') && has('realized p/l')) return 'futures_order';
  if (has('trading pair') && has('base asset')) return 'spot_order';
  if (has('futures') && has('wallet balance')) return 'futures_tx';
  if (has('available')) return 'spot_tx';

  throw new Error(`Unknown CSV format. Headers: ${firstLine}`);
}
