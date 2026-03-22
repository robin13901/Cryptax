import type { ImportError } from '@cryptax/shared';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ParsedSpotTx {
  /** Order ID (leading tab stripped) */
  orderId: string;
  /** Trade timestamp as-is from CSV, e.g. '2024-12-31 23:17:21' */
  tradedAt: string;
  /** Coin symbol, e.g. 'USDE', 'EUR', 'BTC' */
  symbol: string;
  /** Raw type string as-is from CSV, e.g. 'Buy', 'Sell', 'Interest' */
  rawType: string;
  /** Signed amount string, negative for outflows, e.g. '-37.06153' */
  amount: string;
  /** Fee string, e.g. '0', '-0.16' */
  fee: string;
  /** Running balance column value */
  available: string;
  /** Source filename passed into parseSpotTx */
  sourceFile: string;
}

// ---------------------------------------------------------------------------
// Parser result
// ---------------------------------------------------------------------------

export interface SpotTxParseResult {
  transactions: ParsedSpotTx[];
  errors: ImportError[];
}

// ---------------------------------------------------------------------------
// Required fields (case-normalised lowercase names for lookup)
// ---------------------------------------------------------------------------

const REQUIRED_FIELDS = ['order', 'date', 'coin', 'type', 'amount'] as const;

/**
 * Canonical display names for the required fields.  Used when a field is
 * completely absent from the row (so we cannot derive casing from the row
 * itself) — matches the actual Bitget CSV header casing.
 */
const CANONICAL_DISPLAY: Record<string, string> = {
  order: 'order',
  date: 'Date',
  coin: 'Coin',
  type: 'Type',
  amount: 'Amount',
};

/**
 * Normalise all keys of a CSV row to lowercase so that 'order' and 'Order'
 * are treated identically. The original casing of the value is preserved.
 */
function normaliseKeys(row: Record<string, string>): Record<string, string> {
  const normalised: Record<string, string> = {};
  for (const [key, value] of Object.entries(row)) {
    normalised[key.toLowerCase()] = value;
  }
  return normalised;
}

/**
 * Find the original casing for a required field to report back in errors.
 * If no key exists in the row, fall back to the canonical display name.
 */
function originalCasing(row: Record<string, string>, lowercaseField: string): string {
  for (const key of Object.keys(row)) {
    if (key.toLowerCase() === lowercaseField) {
      return key;
    }
  }
  return CANONICAL_DISPLAY[lowercaseField] ?? lowercaseField;
}

// ---------------------------------------------------------------------------
// parseSpotTx
// ---------------------------------------------------------------------------

/**
 * Parse pre-processed CSV rows (output of csv-parse/sync with `columns: true,
 * trim: true, bom: true`) for Bitget spot transaction files.
 *
 * Handles both the 2024 semicolon-delimited and 2025 comma-delimited formats —
 * they have identical headers so after csv-parse normalisation the rows are
 * structurally identical.
 *
 * Does NOT perform canonical-type mapping, checksum calculation, or DB
 * insertion — those responsibilities belong to later pipeline stages.
 *
 * @param rows     Array of raw CSV row objects (mixed-case keys are accepted)
 * @param filename Source filename, stored in each ParsedSpotTx for traceability
 * @returns        Object with `transactions` (valid rows) and `errors` (invalid rows)
 */
export function parseSpotTx(rows: Record<string, string>[], filename: string): SpotTxParseResult {
  const transactions: ParsedSpotTx[] = [];
  const errors: ImportError[] = [];

  for (let i = 0; i < rows.length; i++) {
    const original = rows[i];
    const row = normaliseKeys(original);

    // Validate required fields
    let hasError = false;
    for (const field of REQUIRED_FIELDS) {
      const value = row[field];
      if (value === undefined || value === null || value.trim() === '') {
        const displayField = originalCasing(original, field);
        errors.push({
          row: i,
          field: displayField,
          message: `Required field '${displayField}' is missing or empty`,
          rawData: JSON.stringify(original),
        });
        hasError = true;
        break; // Report first missing field per row, skip to next row
      }
    }

    if (hasError) {
      continue;
    }

    // Strip leading tab from order ID if present (defensive — csv-parse trim
    // should handle this, but we guard against it regardless)
    const orderId = row.order.replace(/^\t+/, '').trim();

    transactions.push({
      orderId,
      tradedAt: row.date,
      symbol: row.coin,
      rawType: row.type,
      amount: row.amount,
      fee: row.fee ?? '0',
      available: row.available ?? '',
      sourceFile: filename,
    });
  }

  return { transactions, errors };
}
