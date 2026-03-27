/**
 * FIFO Lot Engine Core
 *
 * Pure function — no DB access. Processes pre-sorted EngineTransactions,
 * creates InMemoryLots on buy, consumes them in FIFO order on sell.
 *
 * Rules:
 * 1. Sort transactions by tradedAt ASC; tiebreak: buys (0) before sells (1)
 * 2. For each buy: create InMemoryLot using Decimal arithmetic
 * 3. For each sell: consume oldest lots first (FIFO), track ConsumptionRecords
 * 4. Sells without matching lots → sellsWithoutLots
 * 5. Non-buy/sell canonical types → skipped
 */

import type { SourceType } from '@cryptax/shared';
import { TAX_CONSTANTS, toDecimal } from '@cryptax/shared';
import { differenceInCalendarDays } from 'date-fns';
import { Decimal } from 'decimal.js';
import { parseSymbol } from '../prices/symbol-parser.js';
import type {
  ConsumptionRecord,
  EngineTransaction,
  FifoEngineResult,
  InMemoryLot,
} from './types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Sort key for tiebreaking same-timestamp transactions: buys before sells. */
function sortKey(tx: EngineTransaction): number {
  if (tx.canonicalType === 'buy') return 0;
  if (tx.canonicalType === 'sell') return 1;
  return 2;
}

/** Normalize a transaction's symbol to its base asset. */
function normalizeBase(tx: EngineTransaction): string {
  return parseSymbol(tx.symbol, tx.sourceType as SourceType).base;
}

// ---------------------------------------------------------------------------
// runFifoEngine
// ---------------------------------------------------------------------------

/**
 * Run the FIFO lot engine over a set of EngineTransactions.
 *
 * @param transactions - Engine transactions (buy/sell/other). Must have
 *   non-null eurPrice on all buy/sell entries (null-price gate must run first).
 * @returns FifoEngineResult with lots, consumptions, error lists.
 */
export function runFifoEngine(transactions: EngineTransaction[]): FifoEngineResult {
  // --- 1. Sort (copy — do not mutate input) --------------------------------
  const sorted = [...transactions].sort((a, b) => {
    const timeDiff = a.tradedAt.localeCompare(b.tradedAt);
    if (timeDiff !== 0) return timeDiff;
    return sortKey(a) - sortKey(b);
  });

  // --- 2. State ------------------------------------------------------------
  /** All lots created — index is the lot's id before DB insert. */
  const lots: InMemoryLot[] = [];
  /** Lot pools keyed by normalized base asset. */
  const pools = new Map<string, InMemoryLot[]>();
  const consumptions: ConsumptionRecord[] = [];
  const sellsWithoutLots: FifoEngineResult['sellsWithoutLots'] = [];
  const skipped: FifoEngineResult['skipped'] = [];

  // --- 3. Process each transaction -----------------------------------------
  for (const tx of sorted) {
    if (tx.canonicalType === 'buy') {
      processBuy(tx, lots, pools);
    } else if (tx.canonicalType === 'sell') {
      processSell(tx, pools, lots, consumptions, sellsWithoutLots);
    } else {
      skipped.push({
        transactionId: tx.id,
        reason: `Skipped canonical type: ${tx.canonicalType}`,
      });
    }
  }

  return { lots, consumptions, sellsWithoutLots, skipped };
}

// ---------------------------------------------------------------------------
// processBuy
// ---------------------------------------------------------------------------

function processBuy(
  tx: EngineTransaction,
  lots: InMemoryLot[],
  pools: Map<string, InMemoryLot[]>
): void {
  const base = normalizeBase(tx);
  const amount = toDecimal(tx.amount).abs();
  const eurPrice = toDecimal(tx.eurPrice);

  // costBasisEur = eurPrice * amount
  const costBasisEur = eurPrice.times(amount);

  // feeEur: fee is in base coin units for spot_tx, convert to EUR via eurPrice.
  // For spot_order, fee may be in quote currency — using eurPrice as multiplier
  // is an acceptable approximation (fees are small and this is consistent).
  // spot_tx CSVs store fees as negative — use abs()
  const feeEur = toDecimal(tx.fee).abs().times(eurPrice);

  // costPerUnitEur = (costBasisEur + feeEur) / amount
  const costPerUnitEur = costBasisEur.plus(feeEur).div(amount);

  const lotIndex = lots.length;

  const lot: InMemoryLot = {
    id: lotIndex,
    transactionId: tx.id,
    symbol: base,
    originalAmount: amount,
    remainingAmount: amount,
    costPerUnitEur,
    feeEur,
    acquiredAt: tx.tradedAt,
    taxYear: tx.taxYear,
  };

  lots.push(lot);

  if (!pools.has(base)) {
    pools.set(base, []);
  }
  pools.get(base)?.push(lot);
}

// ---------------------------------------------------------------------------
// processSell
// ---------------------------------------------------------------------------

function processSell(
  tx: EngineTransaction,
  pools: Map<string, InMemoryLot[]>,
  lots: InMemoryLot[],
  consumptions: ConsumptionRecord[],
  sellsWithoutLots: FifoEngineResult['sellsWithoutLots']
): void {
  const base = normalizeBase(tx);
  // spot_tx CSVs store sell amounts as negative (e.g. "-233.32") — use abs()
  const sellAmount = toDecimal(tx.amount).abs();
  const sellEurPrice = toDecimal(tx.eurPrice);
  // spot_tx CSVs store fees as negative (e.g. "-0.16") — use abs()
  const totalSellFee = toDecimal(tx.fee).abs();

  const pool = pools.get(base) ?? [];

  // Filter to lots with remaining amount > 0
  const availableLots = pool.filter((l) => l.remainingAmount.greaterThan(0));

  if (availableLots.length === 0) {
    // No lots at all — flag entire sell
    sellsWithoutLots.push({
      transactionId: tx.id,
      symbol: base,
      amount: tx.amount,
    });
    return;
  }

  let remaining = sellAmount;

  for (const lot of availableLots) {
    if (remaining.lessThanOrEqualTo(0)) break;

    const consumed = Decimal.min(lot.remainingAmount, remaining);
    remaining = remaining.minus(consumed);

    // Consume from lot
    lot.remainingAmount = lot.remainingAmount.minus(consumed);

    // Proportional fee allocation: consumed / sellAmount * totalSellFee
    const allocatedFee = consumed.div(sellAmount).times(totalSellFee);

    // Proceeds and cost basis
    const proceeds = consumed.times(sellEurPrice);
    const costBasis = consumed.times(lot.costPerUnitEur);
    const gainLoss = proceeds.minus(costBasis).minus(allocatedFee);

    // Held days calculation
    const sellDate = new Date(tx.tradedAt);
    const acquireDate = new Date(lot.acquiredAt);
    const heldDays = differenceInCalendarDays(sellDate, acquireDate);
    const haltefristMet = heldDays >= TAX_CONSTANTS.HALTEFRIST_DAYS;

    // Find the lot's global index
    const lotIndex = lots.indexOf(lot);

    consumptions.push({
      lotIndex,
      sellTransactionId: tx.id,
      amountConsumed: consumed,
      costBasisEur: costBasis,
      proceedsEur: proceeds,
      gainLossEur: gainLoss,
      feeEur: allocatedFee,
      heldDays,
      haltefristMet,
      taxYear: tx.taxYear,
    });
  }

  // If sell couldn't be fully covered, flag it
  if (remaining.greaterThan(0)) {
    sellsWithoutLots.push({
      transactionId: tx.id,
      symbol: base,
      amount: tx.amount,
    });
  }
}
