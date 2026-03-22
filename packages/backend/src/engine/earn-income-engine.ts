/**
 * Earn Income Engine — §22 Nr. 3 EStG (sonstige Einkünfte) tax bucket.
 *
 * Earn/staking income has dual tax treatment under German law:
 *   1. Taxable income at EUR fair market value when received (Zufluss principle)
 *   2. Creates a new FIFO lot for the received coins so they can be tracked
 *      for future Haltefrist and disposal tax calculation
 *
 * Note on Freigrenze: The 256 EUR annual Freigrenze (TAX_CONSTANTS.EARN_FREIGRENZE_EUR)
 * is NOT applied here. It is a per-year aggregate cliff check handled by the
 * tax-calculator orchestrator (plan 04-06). This engine records raw income only.
 */
import type { SourceType } from '@cryptax/shared';
import { fromDecimal, toDecimal, ZERO } from '@cryptax/shared';
import { parseSymbol } from '../prices/symbol-parser.js';
import type { EarnIncomeResult, EngineTransaction, InMemoryLot } from './types.js';

// ---------------------------------------------------------------------------
// Canonical types processed by this engine
// ---------------------------------------------------------------------------

/**
 * Canonical types that generate both income records and FIFO lots.
 * earn_withdrawal is intentionally excluded — it is an internal Bitget transfer,
 * not a taxable receipt.
 */
const EARN_TAXABLE_TYPES = new Set(['earn_interest', 'earn_deposit'] as const);

// ---------------------------------------------------------------------------
// runEarnIncomeEngine
// ---------------------------------------------------------------------------

/**
 * Pure function. Takes all engine transactions, filters to earn types,
 * and returns income records + FIFO lots for each qualifying transaction.
 *
 * Processing rules:
 * - earn_interest / earn_deposit: record income + create FIFO lot
 * - earn_withdrawal: skipped (internal transfer, not taxable)
 * - all other canonical types: skipped
 *
 * Income record: { transactionId, symbol, amount, eurValueAtReceipt, receivedAt, taxYear }
 * FIFO lot: costPerUnitEur = eurPrice (fair market value at receipt), feeEur = 0
 *
 * @param transactions - All engine transactions (pre-filtered by null-price gate)
 * @returns EarnIncomeResult with incomeRecords, lotsCreated, and skipped arrays
 */
export function runEarnIncomeEngine(transactions: EngineTransaction[]): EarnIncomeResult {
  const incomeRecords: EarnIncomeResult['incomeRecords'] = [];
  const lotsCreated: InMemoryLot[] = [];
  const skipped: EarnIncomeResult['skipped'] = [];

  let lotIndex = 0;

  for (const tx of transactions) {
    if (
      !EARN_TAXABLE_TYPES.has(
        tx.canonicalType as typeof EARN_TAXABLE_TYPES extends Set<infer T> ? T : never
      )
    ) {
      // Provide a specific reason for earn_withdrawal vs generic skip
      const reason =
        tx.canonicalType === 'earn_withdrawal'
          ? 'earn_withdrawal is an internal Bitget transfer — not taxable'
          : `not an earn transaction (canonicalType: ${tx.canonicalType})`;
      skipped.push({ transactionId: tx.id, reason });
      continue;
    }

    // Normalize base asset (e.g. earn sourceType → "ETH" from "ETH")
    const baseAsset = parseSymbol(tx.symbol, tx.sourceType as SourceType).base;

    // EUR value at receipt = eurPrice * amount
    const eurRate = toDecimal(tx.eurPrice);
    const amount = toDecimal(tx.amount);
    const eurValueAtReceipt = eurRate.times(amount);

    // 1. Income record (§22 Nr. 3 EStG)
    incomeRecords.push({
      transactionId: tx.id,
      symbol: baseAsset,
      amount: tx.amount,
      eurValueAtReceipt: fromDecimal(eurValueAtReceipt),
      receivedAt: tx.tradedAt,
      taxYear: tx.taxYear,
    });

    // 2. FIFO lot (cost basis = fair market value at receipt, no fee)
    const lot: InMemoryLot = {
      id: lotIndex,
      transactionId: tx.id,
      symbol: baseAsset,
      originalAmount: amount,
      remainingAmount: amount,
      costPerUnitEur: eurRate,
      feeEur: ZERO,
      acquiredAt: tx.tradedAt,
      taxYear: tx.taxYear,
    };
    lotsCreated.push(lot);
    lotIndex += 1;
  }

  return { incomeRecords, lotsCreated, skipped };
}
