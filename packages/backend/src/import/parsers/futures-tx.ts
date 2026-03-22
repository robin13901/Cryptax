import type { ImportFileError } from '@cryptax/shared';

/**
 * Typed representation of a single parsed Bitget futures transaction CSV row.
 *
 * Column mapping (futures_tx format):
 *   Order          → orderId        (tab-stripped)
 *   Date           → tradedAt
 *   Coin           → coin           (settlement asset, e.g. 'USDT')
 *   Futures        → futures        (trading pair, e.g. 'POPCATUSDT')
 *   Margin Mode    → marginMode
 *   Type           → rawType        (stored as-is — 9 known Bitget type strings)
 *   Amount         → amount         (signed)
 *   Fee            → fee
 *   Wallet balance → walletBalance
 */
export interface ParsedFuturesTx {
  orderId: string;
  tradedAt: string;
  coin: string;
  futures: string;
  marginMode: string;
  rawType: string;
  amount: string;
  fee: string;
  walletBalance: string;
  sourceFile: string;
}

/**
 * Result shape returned by parseFuturesTx.
 */
export interface ParseFuturesTxResult {
  transactions: ParsedFuturesTx[];
  errors: ImportFileError[];
}

/**
 * Build a lower-cased key map once per row for efficient multi-field access.
 */
function lowerRow(row: Record<string, string>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [k, v] of Object.entries(row)) {
    result[k.toLowerCase()] = v;
  }
  return result;
}

/**
 * Parse pre-parsed CSV rows (from csv-parse/sync) for the Bitget futures_tx
 * format into typed ParsedFuturesTx objects.
 *
 * Headers expected: Order,Date,Coin,Futures,Margin Mode,Type,Amount,Fee,Wallet balance
 *
 * @param rows - Array of key→value objects from csv-parse (columns: true)
 * @param filename - Source filename, attached to every parsed transaction
 * @returns Object with `transactions` (valid rows) and `errors` (invalid rows)
 */
export function parseFuturesTx(
  rows: Record<string, string>[],
  filename: string
): ParseFuturesTxResult {
  const transactions: ParsedFuturesTx[] = [];
  const errors: ImportFileError[] = [];

  for (let i = 0; i < rows.length; i++) {
    const rowNumber = i + 1; // 1-indexed for error reporting
    const row = rows[i] as Record<string, string>;
    const lr = lowerRow(row);

    // Strip leading/trailing whitespace (including tabs) from all values.
    // csv-parse with trim:true handles this for properly-parsed rows, but we
    // apply it here as a safety measure for rows supplied directly in tests.
    const get = (key: string): string => (lr[key] ?? '').trim();

    const orderId = get('order');
    const tradedAt = get('date');
    const type = get('type');
    const amount = get('amount');

    // Validate required fields
    if (!orderId) {
      errors.push({
        row: rowNumber,
        field: 'order',
        message: 'Missing required field: order',
        rawData: JSON.stringify(row),
      });
      continue;
    }

    if (!tradedAt) {
      errors.push({
        row: rowNumber,
        field: 'date',
        message: 'Missing required field: date',
        rawData: JSON.stringify(row),
      });
      continue;
    }

    if (!type) {
      errors.push({
        row: rowNumber,
        field: 'type',
        message: 'Missing required field: type',
        rawData: JSON.stringify(row),
      });
      continue;
    }

    if (!amount) {
      errors.push({
        row: rowNumber,
        field: 'amount',
        message: 'Missing required field: amount',
        rawData: JSON.stringify(row),
      });
      continue;
    }

    transactions.push({
      orderId,
      tradedAt,
      coin: get('coin'),
      futures: get('futures'),
      marginMode: get('margin mode'),
      rawType: type, // stored as-is — normalization to CanonicalType happens in plan 02-07
      amount,
      fee: get('fee'),
      walletBalance: get('wallet balance'),
      sourceFile: filename,
    });
  }

  return { transactions, errors };
}
