/**
 * ReportGenerator — aggregates all tax data for a given year into a ReportData object.
 *
 * This is the data foundation for all three report outputs:
 *   - JSON preview (REST endpoint)
 *   - PDF generation
 *   - CSV export
 *
 * One call to generate(year) queries all six relevant DB tables and produces a
 * fully typed ReportData object. Returns null if the engine has not run for the
 * requested year (no tax_summaries rows exist).
 *
 * Tax buckets covered:
 *   - private_sale  → §23 EStG (SpotSummary)
 *   - futures_pnl   → §20 EStG (FuturesSummary)
 *   - staking_earn  → §22 Nr. 3 EStG (EarnSummary)
 *
 * TradeAppendix includes ALL lot_consumptions for the year (both taxable and
 * Haltefrist-met / tax-free), sorted by sellDate ASC then symbol ASC.
 */

import type {
  EarnCoinBreakdown,
  EarnSummary,
  FuturesAppendixRow,
  FuturesSummary,
  ReportData,
  SpotSummary,
  TradeAppendixRow,
} from '@cryptax/shared';
import { TAX_CONSTANTS } from '@cryptax/shared';
import { asc, eq, sql } from 'drizzle-orm';
import { db as defaultDb } from '../db/client.js';
import {
  earnIncome,
  fifoLots,
  futuresPositions,
  lotConsumptions,
  taxSummaries,
  transactions,
} from '../db/schema.js';
import type { Db } from './types.js';

// ---------------------------------------------------------------------------
// ReportGenerator
// ---------------------------------------------------------------------------

export class ReportGenerator {
  private readonly db: Db;

  /**
   * @param db - Drizzle database instance. Defaults to the application DB.
   *             Pass an in-memory DB in tests.
   */
  constructor(db: Db = defaultDb) {
    this.db = db;
  }

  /**
   * Generate a complete ReportData object for the given tax year.
   *
   * @param taxYear - The year to generate the report for (e.g. 2024).
   * @returns ReportData when data exists, null when no engine run found for the year.
   */
  generate(taxYear: number): ReportData | null {
    // -------------------------------------------------------------------------
    // Step 1: Guard — return null if engine has never run for this year.
    // -------------------------------------------------------------------------
    const hasData = this.db
      .select({ one: sql<number>`1` })
      .from(taxSummaries)
      .where(eq(taxSummaries.taxYear, taxYear))
      .limit(1)
      .all();

    if (hasData.length === 0) {
      return null;
    }

    const generatedAt = new Date().toISOString();

    // -------------------------------------------------------------------------
    // Step 2: Build SpotSummary from tax_summaries (bucket = 'private_sale')
    // -------------------------------------------------------------------------
    const spotSummary = this.buildSpotSummary(taxYear);

    // -------------------------------------------------------------------------
    // Step 3: Build FuturesSummary from tax_summaries (bucket = 'futures_pnl')
    // -------------------------------------------------------------------------
    const futuresSummary = this.buildFuturesSummary(taxYear);

    // -------------------------------------------------------------------------
    // Step 4: Build EarnSummary from tax_summaries (bucket = 'staking_earn')
    // -------------------------------------------------------------------------
    const earnSummary = this.buildEarnSummary(taxYear);

    // -------------------------------------------------------------------------
    // Step 5: Build TradeAppendix from lot_consumptions JOIN fifo_lots + transactions
    // -------------------------------------------------------------------------
    const tradeAppendix = this.buildTradeAppendix(taxYear);

    // -------------------------------------------------------------------------
    // Step 6: Build FuturesAppendix from futures_positions JOIN transactions
    // -------------------------------------------------------------------------
    const futuresAppendix = this.buildFuturesAppendix(taxYear);

    return {
      taxYear,
      generatedAt,
      spotSummary,
      futuresSummary,
      earnSummary,
      tradeAppendix,
      futuresAppendix,
    };
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private buildSpotSummary(taxYear: number): SpotSummary {
    // Fetch the private_sale summary row (may not exist if no spot trades)
    const row = this.db
      .select()
      .from(taxSummaries)
      .where(sql`${taxSummaries.taxYear} = ${taxYear} AND ${taxSummaries.bucket} = 'private_sale'`)
      .limit(1)
      .all();

    const totalGainsEur = row[0]?.totalGainsEur ?? '0';
    const totalLossesEur = row[0]?.totalLossesEur ?? '0';
    const netEur = row[0]?.netEur ?? '0';
    const taxableAmountEur = row[0]?.taxableAmountEur ?? '0';
    const tradeCount = row[0]?.tradeCount ?? 0;

    const freigrenzeStatus: 'under' | 'over' =
      parseFloat(netEur) <= parseFloat(TAX_CONSTANTS.SPOT_FREIGRENZE_EUR) ? 'under' : 'over';

    // Count lot consumptions where haltefrist_met = true for this year
    const taxFreeResult = this.db
      .select({ cnt: sql<number>`COUNT(*)` })
      .from(lotConsumptions)
      .where(sql`${lotConsumptions.taxYear} = ${taxYear} AND ${lotConsumptions.haltefristMet} = 1`)
      .all();

    const taxFreeTradeCount = Number(taxFreeResult[0]?.cnt ?? 0);

    return {
      totalGainsEur,
      totalLossesEur,
      netEur,
      taxableAmountEur,
      freigrenzeLimitEur: TAX_CONSTANTS.SPOT_FREIGRENZE_EUR,
      freigrenzeStatus,
      tradeCount,
      taxFreeTradeCount,
    };
  }

  private buildFuturesSummary(taxYear: number): FuturesSummary {
    const row = this.db
      .select()
      .from(taxSummaries)
      .where(sql`${taxSummaries.taxYear} = ${taxYear} AND ${taxSummaries.bucket} = 'futures_pnl'`)
      .limit(1)
      .all();

    const totalGainsEur = row[0]?.totalGainsEur ?? '0';
    const totalLossesEur = row[0]?.totalLossesEur ?? '0';
    const netEur = row[0]?.netEur ?? '0';
    const taxableAmountEur = row[0]?.taxableAmountEur ?? '0';
    const estimatedTaxEur = row[0]?.estimatedTaxEur ?? '0';
    const tradeCount = row[0]?.tradeCount ?? 0;

    // Sum fees from futures_positions for this year
    const feesResult = this.db
      .select({ total: sql<string>`COALESCE(SUM(CAST(${futuresPositions.feeEur} AS REAL)), 0)` })
      .from(futuresPositions)
      .where(eq(futuresPositions.taxYear, taxYear))
      .all();

    const totalFeesEur = String(feesResult[0]?.total ?? '0');

    return {
      totalGainsEur,
      totalLossesEur,
      netEur,
      taxableAmountEur,
      totalFeesEur,
      estimatedTaxEur,
      tradeCount,
    };
  }

  private buildEarnSummary(taxYear: number): EarnSummary {
    const row = this.db
      .select()
      .from(taxSummaries)
      .where(sql`${taxSummaries.taxYear} = ${taxYear} AND ${taxSummaries.bucket} = 'staking_earn'`)
      .limit(1)
      .all();

    const recordCount = row[0]?.tradeCount ?? 0;

    // Compute totalIncomeEur directly from earn_income (not from tax_summaries totalGainsEur
    // to be explicit about the source — same value but more direct)
    const incomeResult = this.db
      .select({
        total: sql<string>`COALESCE(SUM(CAST(${earnIncome.eurValueAtReceipt} AS REAL)), 0)`,
      })
      .from(earnIncome)
      .where(eq(earnIncome.taxYear, taxYear))
      .all();

    const totalIncomeEur = String(incomeResult[0]?.total ?? '0');

    const freigrenzeStatus: 'under' | 'over' =
      parseFloat(totalIncomeEur) <= parseFloat(TAX_CONSTANTS.EARN_FREIGRENZE_EUR)
        ? 'under'
        : 'over';

    // Per-coin breakdown
    const coinRows = this.db
      .select({
        symbol: earnIncome.symbol,
        totalEur: sql<string>`COALESCE(SUM(CAST(${earnIncome.eurValueAtReceipt} AS REAL)), 0)`,
        count: sql<number>`COUNT(*)`,
      })
      .from(earnIncome)
      .where(eq(earnIncome.taxYear, taxYear))
      .groupBy(earnIncome.symbol)
      .orderBy(asc(earnIncome.symbol))
      .all();

    const perCoinBreakdown: EarnCoinBreakdown[] = coinRows.map((r) => ({
      symbol: r.symbol,
      totalEur: String(r.totalEur),
      count: Number(r.count),
    }));

    return {
      totalIncomeEur,
      freigrenzeLimitEur: TAX_CONSTANTS.EARN_FREIGRENZE_EUR,
      freigrenzeStatus,
      recordCount,
      perCoinBreakdown,
    };
  }

  private buildTradeAppendix(taxYear: number): TradeAppendixRow[] {
    // JOIN lot_consumptions → fifo_lots (for symbol, acquired_at) → transactions (for traded_at, exchange)
    const rows = this.db
      .select({
        id: lotConsumptions.id,
        sellTransactionId: lotConsumptions.sellTransactionId,
        symbol: fifoLots.symbol,
        buyDate: fifoLots.acquiredAt,
        sellDate: transactions.tradedAt,
        amountConsumed: lotConsumptions.amountConsumed,
        costBasisEur: lotConsumptions.costBasisEur,
        proceedsEur: lotConsumptions.proceedsEur,
        gainLossEur: lotConsumptions.gainLossEur,
        feeEur: lotConsumptions.feeEur,
        heldDays: lotConsumptions.heldDays,
        haltefristMet: lotConsumptions.haltefristMet,
        exchange: transactions.exchange,
      })
      .from(lotConsumptions)
      .innerJoin(fifoLots, eq(lotConsumptions.lotId, fifoLots.id))
      .innerJoin(transactions, eq(lotConsumptions.sellTransactionId, transactions.id))
      .where(eq(lotConsumptions.taxYear, taxYear))
      .orderBy(asc(transactions.tradedAt), asc(fifoLots.symbol))
      .all();

    return rows.map((r) => ({
      id: r.id,
      sellTransactionId: r.sellTransactionId,
      symbol: r.symbol,
      buyDate: r.buyDate,
      sellDate: r.sellDate,
      amountConsumed: r.amountConsumed,
      costBasisEur: r.costBasisEur,
      proceedsEur: r.proceedsEur,
      gainLossEur: r.gainLossEur,
      feeEur: r.feeEur,
      heldDays: r.heldDays,
      haltefristMet: Boolean(r.haltefristMet),
      exchange: r.exchange,
    }));
  }

  private buildFuturesAppendix(taxYear: number): FuturesAppendixRow[] {
    const directionMap: Record<string, string> = {
      futures_close_long: 'Close Long',
      futures_close_short: 'Close Short',
      futures_funding: 'Funding',
      futures_fee: 'Gebühr',
      futures_open_long: 'Gebühr',
      futures_open_short: 'Gebühr',
    };

    const rows = this.db
      .select({
        id: futuresPositions.id,
        transactionId: futuresPositions.transactionId,
        symbol: futuresPositions.symbol,
        date: transactions.tradedAt,
        canonicalType: transactions.canonicalType,
        realizedPnlEur: futuresPositions.realizedPnlEur,
        feeEur: futuresPositions.feeEur,
        exchange: transactions.exchange,
      })
      .from(futuresPositions)
      .innerJoin(transactions, eq(futuresPositions.transactionId, transactions.id))
      .where(eq(futuresPositions.taxYear, taxYear))
      .orderBy(asc(transactions.tradedAt), asc(futuresPositions.symbol))
      .all();

    return rows.map((r) => ({
      id: r.id,
      transactionId: r.transactionId!,
      symbol: r.symbol,
      date: r.date,
      direction: directionMap[r.canonicalType] ?? r.canonicalType,
      realizedPnlEur: r.realizedPnlEur,
      feeEur: r.feeEur,
      exchange: r.exchange,
    }));
  }
}

// ---------------------------------------------------------------------------
// Convenience factory (application usage)
// ---------------------------------------------------------------------------

/** Singleton ReportGenerator bound to the application DB. */
export const reportGenerator = new ReportGenerator();
