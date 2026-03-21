import type { ImportFileError } from '@cryptax/shared';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ParsedFuturesOrder {
  orderId: string;
  tradedAt: string;
  coin: string;
  futures: string;
  rawType: string;
  orderSource: string;
  transactionType: string;
  /** Average Price — empty string for Market orders, not an error */
  price: string;
  amount: string;
  executed: string;
  tradingVolume: string;
  /** Realized P/L — captured for Phase 4 futures PnL tracking */
  realizedPnl: string;
  /** NetProfits — captured for Phase 4 futures PnL tracking */
  netProfits: string;
  status: string;
  sourceFile: string;
}

// ---------------------------------------------------------------------------
// Column key normalizer (case-insensitive, whitespace-tolerant)
// ---------------------------------------------------------------------------

/**
 * Build a lookup map from normalised key → actual row value.
 * Futures order history headers include mixed-case and special chars:
 *   'Order ID', 'Realized P/L', 'NetProfits', 'order source'
 * Normalising to lowercase allows safe access regardless of Bitget capitalisation changes.
 */
function normaliseRow(row: Record<string, string>): Map<string, string> {
  const map = new Map<string, string>();
  for (const [k, v] of Object.entries(row)) {
    map.set(k.trim().toLowerCase(), v ?? '');
  }
  return map;
}

function get(map: Map<string, string>, key: string): string {
  return (map.get(key.toLowerCase()) ?? '').trim();
}

// ---------------------------------------------------------------------------
// Main parser
// ---------------------------------------------------------------------------

/**
 * Parse pre-tokenised futures order history CSV rows.
 *
 * Rows are expected to already be parsed by csv-parse (BOM stripped, trimmed).
 * This function validates required fields and maps columns to ParsedFuturesOrder.
 *
 * Headers (Format 6):
 *   Date, Order ID, Direction, Coin, Futures, order source, Transaction type,
 *   Price, Average Price, Order amount, Executed, Trading volume,
 *   Realized P/L, NetProfits, Status
 *
 * Required: Order ID, Date, Direction
 * Optional: Average Price (empty string for Market orders — NOT an error)
 */
export function parseFuturesOrder(
  rows: Record<string, string>[],
  filename: string
): { transactions: ParsedFuturesOrder[]; errors: ImportFileError[] } {
  const transactions: ParsedFuturesOrder[] = [];
  const errors: ImportFileError[] = [];

  for (let i = 0; i < rows.length; i++) {
    const rowNum = i + 1;
    const raw = rows[i];
    const r = normaliseRow(raw);

    const rawOrderId = get(r, 'order id');
    const date = get(r, 'date');
    const direction = get(r, 'direction');

    // Required field validation
    if (!rawOrderId) {
      errors.push({
        row: rowNum,
        field: 'Order ID',
        message: 'Order ID is required',
        rawData: JSON.stringify(raw),
      });
      continue;
    }

    if (!date) {
      errors.push({
        row: rowNum,
        field: 'Date',
        message: 'Date is required',
        rawData: JSON.stringify(raw),
      });
      continue;
    }

    if (!direction) {
      errors.push({
        row: rowNum,
        field: 'Direction',
        message: 'Direction is required',
        rawData: JSON.stringify(raw),
      });
      continue;
    }

    transactions.push({
      orderId: rawOrderId,
      tradedAt: date,
      coin: get(r, 'coin'),
      futures: get(r, 'futures'),
      rawType: direction,
      orderSource: get(r, 'order source'),
      transactionType: get(r, 'transaction type'),
      // Average Price intentionally allowed to be empty (Market orders)
      price: get(r, 'average price'),
      amount: get(r, 'order amount'),
      executed: get(r, 'executed'),
      tradingVolume: get(r, 'trading volume'),
      realizedPnl: get(r, 'realized p/l'),
      netProfits: get(r, 'netprofits'),
      status: get(r, 'status'),
      sourceFile: filename,
    });
  }

  return { transactions, errors };
}
