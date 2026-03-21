import type { CanonicalType, SourceType, TransactionSide } from '@cryptax/shared';
import type { transactions } from '../db/schema.js';
import { computeChecksum } from './checksum.js';
import { mapCanonicalType } from './type-map.js';

// ---------------------------------------------------------------------------
// Side derivation
// ---------------------------------------------------------------------------

/**
 * Derive the transaction side (buy/sell/null) from a canonical type.
 *
 * Rules:
 * - 'buy', 'earn_interest', 'earn_deposit', 'transfer_in' → 'buy'
 * - 'sell', 'transfer_out' → 'sell'
 * - Futures open_long / close_short (positive equity action) → 'buy'
 * - Futures open_short / close_long (negative equity action) → 'sell'
 * - 'futures_funding', 'fee', 'futures_fee', 'earn_withdrawal', 'unknown' → null
 */
function deriveSide(canonicalType: CanonicalType): TransactionSide {
  switch (canonicalType) {
    case 'buy':
    case 'earn_interest':
    case 'earn_deposit':
    case 'transfer_in':
      return 'buy';

    case 'sell':
    case 'transfer_out':
      return 'sell';

    case 'futures_open_long':
    case 'futures_close_short':
      return 'buy';

    case 'futures_open_short':
    case 'futures_close_long':
      return 'sell';

    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// normalizeToTransaction
// ---------------------------------------------------------------------------

/**
 * Normalise a single parsed CSV row into a Drizzle transaction insert shape.
 *
 * This function is format-aware — it derives symbol, orderId, price, amount,
 * fee, and totalValue differently depending on which of the 5 Bitget CSV
 * formats the row came from.
 *
 * CRITICAL NOT-NULL rules (DB enforces these):
 * - price: use '0' when the format has no price column (spot_tx, futures_tx, earn)
 * - totalValue: use '0' when not available (spot_tx, futures_tx, earn)
 * - fee: use '0' when absent
 *
 * @param row         Parsed row object — shape depends on format (see parsers).
 * @param format      Source format identifier.
 * @param filename    Original CSV filename for traceability.
 * @param rawCsvRow   The original csv-parse row (used for checksum + rawRow).
 * @returns           Insert-ready object matching `typeof transactions.$inferInsert`.
 */
export function normalizeToTransaction(
  row: Record<string, string>,
  format: SourceType,
  filename: string,
  rawCsvRow: Record<string, string>
): typeof transactions.$inferInsert {
  // Each format stores the raw type string under a different key.
  // The parsers normalise these to lowercase keys after their own processing,
  // but here we work directly with the pre-parsed csv-parse output rows.
  const rawType = getRawType(row, format);
  const canonicalType = mapCanonicalType(format, rawType);
  const side = deriveSide(canonicalType);

  const { orderId, symbol, price, amount, fee, totalValue, tradedAt } = extractFields(row, format);

  const taxYear = parseInt(tradedAt.substring(0, 4), 10);

  return {
    orderId: orderId || null,
    exchange: 'bitget',
    sourceType: format,
    canonicalType,
    symbol,
    side,
    amount: amount || '0',
    price,
    fee: fee || '0',
    totalValue,
    tradedAt,
    taxYear,
    sourceFile: filename,
    rawRow: JSON.stringify(rawCsvRow),
    checksum: computeChecksum(rawCsvRow),
    importedAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Per-format field extraction
// ---------------------------------------------------------------------------

/**
 * Get the raw type string from a row, normalising key casing per format.
 * The csv-parse rows preserve original CSV casing. Each format uses a
 * different column for the type string.
 */
function getRawType(row: Record<string, string>, format: SourceType): string {
  const lower = lowerKeys(row);
  switch (format) {
    case 'spot_tx':
      return lower.type ?? '';
    case 'futures_tx':
      return lower.type ?? '';
    case 'earn':
      return lower.type ?? '';
    case 'spot_order':
      // spot_order uses Direction column as rawType (see 02-04 decision)
      return lower.direction ?? '';
    case 'futures_order':
      // futures_order uses Direction column as rawType (see 02-05 decision)
      return lower.direction ?? '';
  }
}

interface ExtractedFields {
  orderId: string;
  symbol: string;
  price: string;
  amount: string;
  fee: string;
  totalValue: string;
  tradedAt: string;
}

function extractFields(row: Record<string, string>, format: SourceType): ExtractedFields {
  const r = lowerKeys(row);

  switch (format) {
    case 'spot_tx':
      return {
        orderId: r.order ?? '',
        symbol: r.coin ?? '',
        price: '0', // spot_tx has no price column
        amount: r.amount ?? '0',
        fee: r.fee ?? '0',
        totalValue: '0', // spot_tx has no total value column
        tradedAt: r.date ?? '',
      };

    case 'futures_tx':
      return {
        orderId: r.order ?? '',
        symbol: r.futures ?? r.coin ?? '', // prefer Futures column (trading pair)
        price: '0', // futures_tx has no price column
        amount: r.amount ?? '0',
        fee: r.fee ?? '0',
        totalValue: '0', // futures_tx has no total value column
        tradedAt: r.date ?? '',
      };

    case 'earn':
      return {
        orderId: r.reference ?? '',
        symbol: r['interest coin'] ?? r.coin ?? '', // received asset (interest coin preferred)
        price: '0', // earn has no price column
        amount: r.amount ?? '0',
        fee: r['handling fee'] ?? '0',
        totalValue: '0', // earn has no total value column
        tradedAt: r['start time'] ?? '',
      };

    case 'spot_order':
      return {
        orderId: r['order id'] ?? '',
        // symbol derived as BASE/QUOTE (see 02-04 decision)
        symbol:
          r['base asset'] && r['quote asset']
            ? `${r['base asset']}/${r['quote asset']}`
            : (r['trading pair'] ?? ''),
        price: r['average price'] ?? '0', // Average Price is fill price (see 02-04)
        amount: r['order amount'] ?? '0',
        fee: '0', // spot_order has no fee column
        totalValue: r['trading volume'] ?? '0',
        tradedAt: r.date ?? '',
      };

    case 'futures_order':
      return {
        orderId: r['order id'] ?? '',
        symbol: r.futures ?? '',
        price: r['average price'] ?? '0', // empty for Market orders — stored as '0'
        amount: r['order amount'] ?? '0',
        fee: '0', // futures_order has no fee column
        totalValue: r['trading volume'] ?? '0',
        tradedAt: r.date ?? '',
      };
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function lowerKeys(row: Record<string, string>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [k, v] of Object.entries(row)) {
    result[k.trim().toLowerCase()] = v ?? '';
  }
  return result;
}
