import { createHash } from 'node:crypto';
import type { Trade } from 'ccxt';
import type { transactions } from '../db/schema.js';

// ---------------------------------------------------------------------------
// normalizeApiTrade
// ---------------------------------------------------------------------------

/**
 * Convert a ccxt Trade object into a transactions.$inferInsert shape.
 *
 * Field mapping:
 * - orderId:       trade.id (fill ID — unique per fill; NOT trade.order which is order ID)
 * - exchange:      'bitget'
 * - sourceType:    caller-supplied ('spot_tx' | 'futures_tx')
 * - canonicalType: derived from trade.side ('buy'/'sell')
 * - symbol:        trade.symbol
 * - side:          trade.side ('buy' | 'sell') or null
 * - amount:        trade.amount as string
 * - price:         trade.price as string (or '0' if undefined)
 * - fee:           trade.fee?.cost as string (or '0' if absent)
 * - totalValue:    trade.cost as string (or '0' if undefined)
 * - tradedAt:      ISO string from trade.timestamp
 * - taxYear:       year extracted from tradedAt
 * - sourceFile:    null (no CSV file for API-fetched trades)
 * - rawRow:        JSON of the original ccxt Trade info field
 * - checksum:      SHA-256 of trade.id + exchange + sourceType (deterministic dedup key)
 * - importedAt:    current ISO timestamp
 *
 * @param trade      ccxt Trade object from fetchMyTrades
 * @param sourceType 'spot_tx' for spot trades, 'futures_tx' for futures/swap trades
 */
export function normalizeApiTrade(
  trade: Trade,
  sourceType: 'spot_tx' | 'futures_tx'
): typeof transactions.$inferInsert {
  const tradedAt =
    trade.timestamp != null ? new Date(trade.timestamp).toISOString() : new Date().toISOString();

  const taxYear = parseInt(tradedAt.substring(0, 4), 10);

  const price = trade.price != null ? String(trade.price) : '0';
  const amount = trade.amount != null ? String(trade.amount) : '0';
  const fee = trade.fee?.cost != null ? String(trade.fee.cost) : '0';
  const totalValue = trade.cost != null ? String(trade.cost) : '0';

  const side = trade.side === 'buy' || trade.side === 'sell' ? trade.side : null;

  const canonicalType: string = side === 'buy' ? 'buy' : side === 'sell' ? 'sell' : 'unknown';

  // Deterministic checksum: trade.id + exchange + sourceType are globally unique for a fill
  const checksum = createHash('sha256')
    .update(`${trade.id ?? ''}:bitget:${sourceType}`)
    .digest('hex');

  return {
    orderId: trade.id ?? null,
    exchange: 'bitget',
    sourceType,
    canonicalType,
    symbol: trade.symbol ?? '',
    side,
    amount,
    price,
    fee,
    totalValue,
    tradedAt,
    taxYear,
    sourceFile: null,
    rawRow: JSON.stringify(trade.info ?? {}),
    checksum,
    importedAt: new Date().toISOString(),
  };
}
