/**
 * Tax Calculation Orchestrator
 *
 * Central coordinator for the entire tax computation pipeline. Implements
 * stateless truncate-and-recompute semantics: every run starts from scratch,
 * deletes all derived data, and rebuilds from transactions.
 *
 * Pipeline:
 * 1. NULL price gate — abort if any taxable transaction has no EUR price
 * 2. Load all transactions ordered by tradedAt ASC
 * 3. Truncate all derived tables (FK-safe order)
 * 4. Run earn income engine (creates §22 Nr. 3 income records + FIFO lots)
 * 5. Run FIFO engine on buy/sell + earn lots (merged, sorted)
 * 6. Run futures P&L engine (§20 EStG, isolated)
 * 7. Run spot tax calculator on FIFO consumptions (§23 EStG)
 * 8. Write all results to DB
 * 9. Generate per-year per-bucket tax summaries
 * 10. Return TaxCalculationResult
 *
 * Tax buckets:
 * - private_sale  → §23 EStG (spot FIFO, haltefrist, freigrenze 1000 EUR)
 * - futures_pnl   → §20 EStG (abgeltungssteuer 26.375%, no freigrenze)
 * - staking_earn  → §22 Nr. 3 EStG (earn income, freigrenze 256 EUR cliff)
 */

import type { CanonicalType, SourceType } from '@cryptax/shared';
import { fromDecimal, TAX_CONSTANTS, toDecimal, ZERO } from '@cryptax/shared';
import { asc } from 'drizzle-orm';
import {
  earnIncome,
  fifoLots,
  futuresPositions,
  lotConsumptions,
  taxSummaries,
  transactions,
} from '../db/schema.js';
import { runEarnIncomeEngine } from './earn-income-engine.js';
import { runFifoEngine } from './fifo-engine.js';
import { runFuturesPnlEngine } from './futures-pnl-engine.js';
import { checkNullPrices } from './null-price-gate.js';
import { calculateSpotTax } from './spot-tax-calculator.js';
import type { Db, EngineTransaction, TaxCalculationResult } from './types.js';

// ---------------------------------------------------------------------------
// runTaxCalculation
// ---------------------------------------------------------------------------

/**
 * Execute the full tax calculation pipeline.
 *
 * Stateless: truncates all derived tables before recomputing. Calling this
 * function twice with the same transaction data produces identical results.
 *
 * @param db - Drizzle database instance (BetterSQLite3)
 * @returns TaxCalculationResult — engine results, summaries, and any errors
 */
export function runTaxCalculation(db: Db): TaxCalculationResult {
  // -------------------------------------------------------------------------
  // Step 1: NULL price gate
  // -------------------------------------------------------------------------
  const nullPriceErrors = checkNullPrices(db);
  if (nullPriceErrors.length > 0) {
    return {
      fifo: { lots: [], consumptions: [], sellsWithoutLots: [], skipped: [] },
      spotTax: [],
      futures: { positions: [], skipped: [] },
      earn: { incomeRecords: [], lotsCreated: [], skipped: [] },
      summaries: [],
      errors: nullPriceErrors.map((e) => ({
        transactionId: e.transactionId,
        reason: `Missing EUR price — run price enrichment first (symbol: ${e.symbol}, tradedAt: ${e.tradedAt})`,
      })),
    };
  }

  // -------------------------------------------------------------------------
  // Step 2: Load all transactions ordered by tradedAt ASC
  // -------------------------------------------------------------------------
  const rows = db
    .select({
      id: transactions.id,
      orderId: transactions.orderId,
      exchange: transactions.exchange,
      sourceType: transactions.sourceType,
      canonicalType: transactions.canonicalType,
      symbol: transactions.symbol,
      side: transactions.side,
      amount: transactions.amount,
      price: transactions.price,
      fee: transactions.fee,
      totalValue: transactions.totalValue,
      tradedAt: transactions.tradedAt,
      taxYear: transactions.taxYear,
      eurPrice: transactions.eurPrice,
    })
    .from(transactions)
    .orderBy(asc(transactions.tradedAt))
    .all();

  // Cast to EngineTransaction — eurPrice is non-null after the gate above
  // (gate only passes when all taxable types have a price; skippable types
  // like transfer_in may still have null, but engines already skip them)
  const allTransactions: EngineTransaction[] = rows.map((row) => ({
    id: row.id,
    orderId: row.orderId,
    exchange: row.exchange,
    sourceType: row.sourceType as SourceType,
    canonicalType: row.canonicalType as CanonicalType,
    symbol: row.symbol,
    side: row.side,
    amount: row.amount,
    price: row.price,
    fee: row.fee,
    totalValue: row.totalValue,
    tradedAt: row.tradedAt,
    taxYear: row.taxYear,
    eurPrice: row.eurPrice ?? '0', // skippable types with null price get 0
  }));

  // -------------------------------------------------------------------------
  // Steps 3–9: run inside a single write transaction for atomicity
  // -------------------------------------------------------------------------
  const result = db.transaction((tx) => {
    // -----------------------------------------------------------------------
    // Step 3: Truncate all derived tables (FK-safe order)
    // lotConsumptions → fifoLots → futuresPositions → earnIncome → taxSummaries
    // -----------------------------------------------------------------------
    tx.delete(lotConsumptions).run();
    tx.delete(fifoLots).run();
    tx.delete(futuresPositions).run();
    tx.delete(earnIncome).run();
    tx.delete(taxSummaries).run();

    // -----------------------------------------------------------------------
    // Step 4: Run earn income engine first
    // Earn transactions produce:
    //   a) §22 Nr. 3 income records
    //   b) FIFO lots (cost basis = FMV at receipt) — fed into spot FIFO engine
    // -----------------------------------------------------------------------
    const earnResult = runEarnIncomeEngine(allTransactions);

    // -----------------------------------------------------------------------
    // Step 5: Build merged transaction list for FIFO engine
    // The earn lots need to enter the FIFO pool so that coins earned in 2024
    // can be matched (FIFO) against sells in 2025.
    //
    // Approach: create synthetic buy transactions from earn transactions so
    // the FIFO engine's processBuy() creates the lots with the correct
    // cost basis (FMV at receipt = eurPrice of the earn transaction).
    // -----------------------------------------------------------------------
    const earnBuyTransactions: EngineTransaction[] = allTransactions
      .filter((t) => t.canonicalType === 'earn_interest' || t.canonicalType === 'earn_deposit')
      .map((t) => ({
        ...t,
        canonicalType: 'buy' as CanonicalType,
      }));

    // Combine original transactions (buy/sell passes through, others skipped by fifo engine)
    // with synthetic earn-buys. The FIFO engine sorts internally by tradedAt.
    const fifoInputTransactions = [...allTransactions, ...earnBuyTransactions];

    const fifoResult = runFifoEngine(fifoInputTransactions);

    // -----------------------------------------------------------------------
    // Step 6: Run futures P&L engine (§20 EStG, fully isolated)
    // -----------------------------------------------------------------------
    const futuresResult = runFuturesPnlEngine(allTransactions);

    // -----------------------------------------------------------------------
    // Step 7: Run spot tax calculator on FIFO consumptions
    // -----------------------------------------------------------------------
    const spotTaxResult = calculateSpotTax(fifoResult.consumptions);

    // -----------------------------------------------------------------------
    // Step 8: Write results to DB
    // -----------------------------------------------------------------------

    // -- 8a: Insert FIFO lots and collect DB IDs --
    // Map from lot array index → DB auto-increment ID
    const lotIndexToDbId = new Map<number, number>();

    for (let i = 0; i < fifoResult.lots.length; i++) {
      const lot = fifoResult.lots[i];
      const costBasisEur = lot.costPerUnitEur.times(lot.originalAmount);

      const inserted = tx
        .insert(fifoLots)
        .values({
          symbol: lot.symbol,
          originalAmount: fromDecimal(lot.originalAmount),
          remainingAmount: fromDecimal(lot.remainingAmount),
          costBasisEur: fromDecimal(costBasisEur),
          costPerUnitEur: fromDecimal(lot.costPerUnitEur),
          feeEur: fromDecimal(lot.feeEur),
          acquiredAt: lot.acquiredAt,
          transactionId: lot.transactionId,
          taxYear: lot.taxYear,
        })
        .returning({ id: fifoLots.id })
        .get();

      lotIndexToDbId.set(i, inserted.id);
    }

    // -- 8b: Insert lot consumptions --
    for (const consumption of fifoResult.consumptions) {
      const dbLotId = lotIndexToDbId.get(consumption.lotIndex);
      if (dbLotId === undefined) {
        // Should never happen — lotIndex always maps to an inserted lot
        throw new Error(
          `BUG: Consumption references lot index ${consumption.lotIndex} which has no DB ID`
        );
      }

      tx.insert(lotConsumptions)
        .values({
          lotId: dbLotId,
          sellTransactionId: consumption.sellTransactionId,
          amountConsumed: fromDecimal(consumption.amountConsumed),
          costBasisEur: fromDecimal(consumption.costBasisEur),
          proceedsEur: fromDecimal(consumption.proceedsEur),
          gainLossEur: fromDecimal(consumption.gainLossEur),
          feeEur: fromDecimal(consumption.feeEur),
          heldDays: consumption.heldDays,
          haltefristMet: consumption.haltefristMet,
          taxYear: consumption.taxYear,
        })
        .run();
    }

    // -- 8c: Insert futures positions --
    for (const pos of futuresResult.positions) {
      tx.insert(futuresPositions)
        .values({
          symbol: pos.symbol,
          realizedPnlEur: pos.realizedPnlEur,
          feeEur: pos.feeEur,
          transactionId: pos.transactionId,
          taxYear: pos.taxYear,
        })
        .run();
    }

    // -- 8d: Insert earn income records --
    for (const record of earnResult.incomeRecords) {
      tx.insert(earnIncome)
        .values({
          symbol: record.symbol,
          amount: record.amount,
          eurValueAtReceipt: record.eurValueAtReceipt,
          receivedAt: record.receivedAt,
          transactionId: record.transactionId,
          taxYear: record.taxYear,
        })
        .run();
    }

    // -----------------------------------------------------------------------
    // Step 9: Generate per-year per-bucket tax summaries
    // -----------------------------------------------------------------------
    const computedAt = new Date().toISOString();

    // Collect all years across all buckets
    const allYears = new Set<number>();
    for (const s of spotTaxResult) allYears.add(s.taxYear);
    for (const p of futuresResult.positions) allYears.add(p.taxYear);
    for (const r of earnResult.incomeRecords) allYears.add(r.taxYear);

    const summaryRows: TaxCalculationResult['summaries'] = [];

    for (const year of [...allYears].sort()) {
      // -- 9a: private_sale (§23 EStG) --
      const spotYear = spotTaxResult.find((s) => s.taxYear === year);
      if (spotYear) {
        const taxable = toDecimal(spotYear.taxableAmountEur);
        const summaryRow = {
          taxYear: year,
          bucket: 'private_sale',
          totalGainsEur: spotYear.totalGainsEur,
          totalLossesEur: spotYear.totalLossesEur,
          netEur: spotYear.netGainEur,
          taxableAmountEur: spotYear.taxableAmountEur,
          // §23 private sales are taxed at individual income tax rate (not Abgeltungssteuer).
          // We do not know the marginal rate, so estimatedTaxEur = 0 for this bucket.
          estimatedTaxEur: '0',
          tradeCount: spotYear.tradeCount,
          computedAt,
        };
        tx.insert(taxSummaries).values(summaryRow).run();
        summaryRows.push({
          taxYear: summaryRow.taxYear,
          bucket: summaryRow.bucket,
          totalGainsEur: summaryRow.totalGainsEur,
          totalLossesEur: summaryRow.totalLossesEur,
          netEur: summaryRow.netEur,
          taxableAmountEur: summaryRow.taxableAmountEur,
          estimatedTaxEur: summaryRow.estimatedTaxEur,
          tradeCount: summaryRow.tradeCount,
        });
        // suppress unused variable warning
        void taxable;
      }

      // -- 9b: futures_pnl (§20 EStG) --
      const futuresForYear = futuresResult.positions.filter((p) => p.taxYear === year);
      if (futuresForYear.length > 0) {
        let totalGains = ZERO;
        let totalLosses = ZERO;

        for (const pos of futuresForYear) {
          const pnl = toDecimal(pos.realizedPnlEur);
          const fee = toDecimal(pos.feeEur);
          // Net P&L per position = pnl - fee (fee is already positive abs)
          const net = pnl.minus(fee);
          if (net.greaterThan(ZERO)) {
            totalGains = totalGains.plus(net);
          } else if (net.lessThan(ZERO)) {
            totalLosses = totalLosses.plus(net);
          }
        }

        const netEur = totalGains.plus(totalLosses);
        // No Freigrenze for futures — full net is taxable
        const taxableAmount = netEur.greaterThan(ZERO) ? netEur : ZERO;
        const estimatedTax = taxableAmount.times(toDecimal(TAX_CONSTANTS.ABGELTUNGSSTEUER_RATE));

        const futuresSummaryRow = {
          taxYear: year,
          bucket: 'futures_pnl',
          totalGainsEur: fromDecimal(totalGains),
          totalLossesEur: fromDecimal(totalLosses),
          netEur: fromDecimal(netEur),
          taxableAmountEur: fromDecimal(taxableAmount),
          estimatedTaxEur: fromDecimal(estimatedTax),
          tradeCount: futuresForYear.length,
          computedAt,
        };
        tx.insert(taxSummaries).values(futuresSummaryRow).run();
        summaryRows.push({
          taxYear: futuresSummaryRow.taxYear,
          bucket: futuresSummaryRow.bucket,
          totalGainsEur: futuresSummaryRow.totalGainsEur,
          totalLossesEur: futuresSummaryRow.totalLossesEur,
          netEur: futuresSummaryRow.netEur,
          taxableAmountEur: futuresSummaryRow.taxableAmountEur,
          estimatedTaxEur: futuresSummaryRow.estimatedTaxEur,
          tradeCount: futuresSummaryRow.tradeCount,
        });
      }

      // -- 9c: staking_earn (§22 Nr. 3 EStG) --
      const earnForYear = earnResult.incomeRecords.filter((r) => r.taxYear === year);
      if (earnForYear.length > 0) {
        let totalEarnEur = ZERO;
        for (const r of earnForYear) {
          totalEarnEur = totalEarnEur.plus(toDecimal(r.eurValueAtReceipt));
        }

        // Apply 256 EUR Freigrenze cliff:
        // if total <= 256 EUR → fully tax-free (taxableAmount = 0)
        // if total > 256 EUR → full amount is taxable (cliff, not deduction)
        const freigrenze = toDecimal(TAX_CONSTANTS.EARN_FREIGRENZE_EUR);
        const taxableEarn = totalEarnEur.greaterThan(freigrenze) ? totalEarnEur : ZERO;
        // §22 Nr. 3 income is taxed at the individual's marginal rate — unknown here
        const estimatedTaxEarn = ZERO;

        const earnSummaryRow = {
          taxYear: year,
          bucket: 'staking_earn',
          totalGainsEur: fromDecimal(totalEarnEur),
          totalLossesEur: '0',
          netEur: fromDecimal(totalEarnEur),
          taxableAmountEur: fromDecimal(taxableEarn),
          estimatedTaxEur: fromDecimal(estimatedTaxEarn),
          tradeCount: earnForYear.length,
          computedAt,
        };
        tx.insert(taxSummaries).values(earnSummaryRow).run();
        summaryRows.push({
          taxYear: earnSummaryRow.taxYear,
          bucket: earnSummaryRow.bucket,
          totalGainsEur: earnSummaryRow.totalGainsEur,
          totalLossesEur: earnSummaryRow.totalLossesEur,
          netEur: earnSummaryRow.netEur,
          taxableAmountEur: earnSummaryRow.taxableAmountEur,
          estimatedTaxEur: earnSummaryRow.estimatedTaxEur,
          tradeCount: earnSummaryRow.tradeCount,
        });
      }
    }

    return {
      fifo: fifoResult,
      spotTax: spotTaxResult,
      futures: futuresResult,
      earn: earnResult,
      summaries: summaryRows,
      errors: [],
    };
  }) as TaxCalculationResult;

  return result;
}
