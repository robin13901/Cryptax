/**
 * Futures P&L Engine — §20 EStG (Abgeltungssteuer) tax bucket.
 *
 * Processes futures transactions and produces per-transaction realized P&L
 * records. Completely isolated from the FIFO spot engine — no lots are
 * created, no Haltefrist applies, and no cross-contamination with §23 EStG.
 *
 * Tax treatment: Futures gains/losses fall under §20 EStG (capital income),
 * taxed at Abgeltungssteuer 26.375% (including solidarity surcharge). There
 * is no Freigrenze and no holding period exemption for futures.
 */
import type { SourceType } from '@cryptax/shared';
import { fromDecimal, toDecimal, ZERO } from '@cryptax/shared';
import { parseSymbol } from '../prices/symbol-parser.js';
import type { EngineTransaction, FuturesPnlResult } from './types.js';

// ---------------------------------------------------------------------------
// Canonical types processed by this engine
// ---------------------------------------------------------------------------

/**
 * Canonical types that produce a realized P&L or fee record.
 * Open positions are included to capture their trading fees.
 */
const FUTURES_TAXABLE_TYPES = new Set([
  'futures_close_long',
  'futures_close_short',
  'futures_fee',
  'futures_funding',
  'futures_open_long',
  'futures_open_short',
] as const);

// ---------------------------------------------------------------------------
// runFuturesPnlEngine
// ---------------------------------------------------------------------------

/**
 * Pure function. Takes all engine transactions, filters to futures-only,
 * and returns per-transaction P&L records.
 *
 * Processing rules:
 * - futures_close_long / futures_close_short: realized P&L = amount × eurPrice,
 *   plus fee from tx.fee × eurPrice
 * - futures_fee: feeEur = abs(amount × eurPrice), realizedPnlEur = 0
 * - futures_funding: realizedPnlEur = amount × eurPrice (sign preserved)
 * - futures_open_long / futures_open_short: fee-only record (no P&L)
 * - all other canonical types: skipped
 *
 * @param transactions - All engine transactions (pre-filtered by null-price gate)
 * @returns FuturesPnlResult with positions and skipped arrays
 */
export function runFuturesPnlEngine(transactions: EngineTransaction[]): FuturesPnlResult {
  const positions: FuturesPnlResult['positions'] = [];
  const skipped: FuturesPnlResult['skipped'] = [];

  for (const tx of transactions) {
    if (
      !FUTURES_TAXABLE_TYPES.has(
        tx.canonicalType as typeof FUTURES_TAXABLE_TYPES extends Set<infer T> ? T : never
      )
    ) {
      skipped.push({ transactionId: tx.id, reason: 'not a futures transaction' });
      continue;
    }

    const symbol = parseSymbol(tx.symbol, tx.sourceType as SourceType).base;
    const eurRate = toDecimal(tx.eurPrice);

    // Extract fee from tx.fee (CSV Fee column) — always negative or zero
    const rawFee = toDecimal(tx.fee);
    const feeEur = rawFee.isZero() ? ZERO : rawFee.times(eurRate).abs();

    if (tx.canonicalType === 'futures_fee') {
      // Dedicated fee transaction: amount is the fee itself
      const feeFromAmount = toDecimal(tx.amount).times(eurRate).abs();
      positions.push({
        transactionId: tx.id,
        symbol,
        realizedPnlEur: '0',
        feeEur: fromDecimal(feeFromAmount.plus(feeEur)),
        taxYear: tx.taxYear,
      });
    } else if (
      tx.canonicalType === 'futures_open_long' ||
      tx.canonicalType === 'futures_open_short'
    ) {
      // Open positions: no P&L, only fees
      if (!feeEur.isZero()) {
        positions.push({
          transactionId: tx.id,
          symbol,
          realizedPnlEur: '0',
          feeEur: fromDecimal(feeEur),
          taxYear: tx.taxYear,
        });
      } else {
        skipped.push({ transactionId: tx.id, reason: 'open position with no fee' });
      }
    } else {
      // futures_close_long, futures_close_short, futures_funding
      // Preserve sign: positive for gains, negative for losses/payments
      const pnlEur = toDecimal(tx.amount).times(eurRate);
      positions.push({
        transactionId: tx.id,
        symbol,
        realizedPnlEur: fromDecimal(pnlEur),
        feeEur: fromDecimal(feeEur),
        taxYear: tx.taxYear,
      });
    }
  }

  return { positions, skipped };
}
