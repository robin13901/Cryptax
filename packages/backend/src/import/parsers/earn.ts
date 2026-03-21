import type { ImportFileError } from '@cryptax/shared';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Parsed row from the Bitget On-chain Earn CSV format.
 *
 * Headers: Reference,Start time,Coin,Type,Interest coin,Amount,Handling fee,Status
 * Columns: 8
 *
 * Key difference from all other formats: the Reference column has NO leading
 * tab character — it is a clean numeric string.
 */
export interface ParsedEarn {
  /** Order / batch reference. Clean numeric — no tab prefix. */
  reference: string;
  /** ISO-like datetime: '2024-03-15 10:30:00' */
  startTime: string;
  /** Staked asset symbol (e.g. 'ETH', 'BTC') */
  coin: string;
  /** Raw type string from CSV (e.g. 'Staking') */
  rawType: string;
  /** Asset received as staking interest (may differ from coin) */
  interestCoin: string;
  /** Staked / interest amount — always positive for earn records */
  amount: string;
  /** Handling / service fee (usually '0') */
  handlingFee: string;
  /** Status field from CSV (e.g. 'Staked') */
  status: string;
  /** Original filename this row came from */
  sourceFile: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Normalise a row's keys to lowercase so the parser is robust regardless of
 * whether the caller or csv-parse preserved casing.
 */
function normaliseRow(row: Record<string, string>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const key of Object.keys(row)) {
    result[key.toLowerCase()] = row[key];
  }
  return result;
}

/** Trim a field value. Treats missing/null/undefined as empty string. */
function field(row: Record<string, string>, key: string): string {
  return (row[key] ?? '').trim();
}

// ---------------------------------------------------------------------------
// parseEarn
// ---------------------------------------------------------------------------

/**
 * Parse pre-processed CSV rows from the Bitget On-chain Earn export into
 * typed {@link ParsedEarn} objects.
 *
 * @param rows     Rows already parsed by csv-parse (columns as keys).
 * @param filename Original filename — attached to every ParsedEarn for tracing.
 * @returns        `transactions` for valid rows, `errors` for invalid ones.
 */
export function parseEarn(
  rows: Record<string, string>[],
  filename: string
): { transactions: ParsedEarn[]; errors: ImportFileError[] } {
  const transactions: ParsedEarn[] = [];
  const errors: ImportFileError[] = [];

  for (let i = 0; i < rows.length; i++) {
    const rowNumber = i + 1;
    const row = normaliseRow(rows[i]);

    const reference = field(row, 'reference');
    const startTime = field(row, 'start time');
    const amount = field(row, 'amount');
    const rawType = field(row, 'type');

    // ---- Required field validation ----------------------------------------

    if (!reference) {
      errors.push({
        row: rowNumber,
        field: 'reference',
        message: 'Missing required field: reference',
        rawData: JSON.stringify(rows[i]),
      });
      continue;
    }

    if (!startTime) {
      errors.push({
        row: rowNumber,
        field: 'start time',
        message: 'Missing required field: start time',
        rawData: JSON.stringify(rows[i]),
      });
      continue;
    }

    if (!amount) {
      errors.push({
        row: rowNumber,
        field: 'amount',
        message: 'Missing required field: amount',
        rawData: JSON.stringify(rows[i]),
      });
      continue;
    }

    // ---- Build ParsedEarn -------------------------------------------------

    transactions.push({
      reference,
      startTime,
      coin: field(row, 'coin'),
      rawType,
      interestCoin: field(row, 'interest coin'),
      amount,
      handlingFee: field(row, 'handling fee'),
      status: field(row, 'status'),
      sourceFile: filename,
    });
  }

  return { transactions, errors };
}
