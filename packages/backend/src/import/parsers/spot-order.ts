import type { ImportFileError } from '@cryptax/shared';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ParsedSpotOrder {
  orderId: string;
  tradedAt: string;
  symbol: string;
  baseAsset: string;
  quoteAsset: string;
  rawType: string;
  orderType: string;
  price: string;
  amount: string;
  executed: string;
  tradingVolume: string;
  status: string;
  sourceFile: string;
}

// ---------------------------------------------------------------------------
// Required fields (lowercase column keys after normalisation)
// ---------------------------------------------------------------------------

const REQUIRED_FIELDS: Array<{ key: string; label: string }> = [
  { key: 'order id', label: 'Order Id' },
  { key: 'date', label: 'Date' },
  { key: 'direction', label: 'Direction' },
  { key: 'average price', label: 'Average Price' },
  { key: 'order amount', label: 'Order amount' },
];

// ---------------------------------------------------------------------------
// parseSpotOrder
// ---------------------------------------------------------------------------

/**
 * Parses pre-split CSV rows from a Bitget spot order history export into
 * typed ParsedSpotOrder objects.
 *
 * Expects rows with these columns (case-insensitive):
 *   Date, Type, Order Id, Trading pair, Base Asset, Quote Asset,
 *   Direction, Price, Order amount, Executed, Average Price,
 *   Trading volume, Status
 *
 * @param rows     Array of raw CSV rows (Record<string, string>) from csv-parse
 * @param filename Original filename — stored on every parsed row for traceability
 */
export function parseSpotOrder(
  rows: Record<string, string>[],
  filename: string
): { transactions: ParsedSpotOrder[]; errors: ImportFileError[] } {
  const transactions: ParsedSpotOrder[] = [];
  const errors: ImportFileError[] = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const rowNumber = i + 1; // 1-based row number for error reporting

    // Normalise keys to lowercase for case-insensitive lookup
    const norm: Record<string, string> = {};
    for (const [k, v] of Object.entries(row)) {
      norm[k.toLowerCase()] = typeof v === 'string' ? v.trim() : String(v ?? '');
    }

    // Validate required fields
    let hasError = false;
    for (const { key, label } of REQUIRED_FIELDS) {
      if (!norm[key]) {
        errors.push({
          row: rowNumber,
          field: label,
          message: `Missing required field: ${label}`,
          rawData: JSON.stringify(row),
        });
        hasError = true;
        break; // report first missing field only to keep errors focused
      }
    }

    if (hasError) {
      continue;
    }

    const baseAsset = norm['base asset'] ?? '';
    const quoteAsset = norm['quote asset'] ?? '';

    transactions.push({
      orderId: norm['order id'],
      tradedAt: norm.date,
      baseAsset,
      quoteAsset,
      symbol: `${baseAsset}/${quoteAsset}`,
      rawType: norm.direction,
      orderType: norm.type ?? '',
      price: norm['average price'],
      amount: norm['order amount'],
      executed: norm.executed ?? '',
      tradingVolume: norm['trading volume'] ?? '',
      status: norm.status ?? '',
      sourceFile: filename,
    });
  }

  return { transactions, errors };
}
