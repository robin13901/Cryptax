import type { YearSummaryResponse } from '@cryptax/shared';
import { TAX_CONSTANTS } from '@cryptax/shared';
import { eq, sql } from 'drizzle-orm';
import type { Hono } from 'hono';
import { db } from '../db/client.js';
import {
  fifoLots,
  futuresPositions,
  lotConsumptions,
  taxSummaries,
  transactions,
} from '../db/schema.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sumStrings(values: string[]): string {
  const total = values.reduce((acc, v) => acc + parseFloat(v), 0);
  return String(total);
}

/**
 * Build a zero-valued YearSummaryResponse (engineHasRun = false).
 */
function buildEmptyResponse(taxYear: number): YearSummaryResponse {
  return {
    taxYear,
    availableYears: [],
    engineHasRun: false,
    buckets: [],
    totalNetEur: '0',
    totalTradeCount: 0,
    totalTaxableEur: '0',
    totalEstimatedTaxEur: '0',
    monthlySpot: [],
    monthlyFutures: [],
    perCoinGainLoss: [],
    portfolioAllocation: [],
    yearOverYear: [],
    spotFreigrenzeEur: TAX_CONSTANTS.SPOT_FREIGRENZE_EUR,
    earnFreigrenzeEur: TAX_CONSTANTS.EARN_FREIGRENZE_EUR,
    spotNetForFreigrenze: '0',
    earnTotalForFreigrenze: '0',
  };
}

// ---------------------------------------------------------------------------
// registerSummaryRoutes
// ---------------------------------------------------------------------------

/**
 * Register summary routes on the Hono application.
 *
 * Routes:
 *   GET  /api/summary/:year  — Return pre-computed KPI + chart data for a tax year
 */
export function registerSummaryRoutes(app: Hono) {
  // -------------------------------------------------------------------------
  // GET /api/summary/:year
  // -------------------------------------------------------------------------
  app.get('/api/summary/:year', async (c) => {
    const rawYear = c.req.param('year');
    const taxYear = parseInt(rawYear, 10);
    if (Number.isNaN(taxYear)) {
      return c.json({ error: `Invalid year: ${rawYear}` }, 400);
    }

    // -----------------------------------------------------------------------
    // engineHasRun check: if tax_summaries is empty the engine has never run
    // -----------------------------------------------------------------------
    const engineCheck = db.select().from(taxSummaries).limit(1).all();
    if (engineCheck.length === 0) {
      return c.json(buildEmptyResponse(taxYear));
    }

    // -----------------------------------------------------------------------
    // Available years
    // -----------------------------------------------------------------------
    const availableYearsRows = db
      .selectDistinct({ year: taxSummaries.taxYear })
      .from(taxSummaries)
      .all();
    const availableYears = availableYearsRows.map((r) => r.year);

    // -----------------------------------------------------------------------
    // Buckets for requested year
    // -----------------------------------------------------------------------
    const bucketRows = db
      .select()
      .from(taxSummaries)
      .where(eq(taxSummaries.taxYear, taxYear))
      .all();

    const buckets: YearSummaryResponse['buckets'] = bucketRows.map((row) => ({
      bucket: row.bucket as 'private_sale' | 'futures_pnl' | 'staking_earn',
      totalGainsEur: row.totalGainsEur,
      totalLossesEur: row.totalLossesEur,
      netEur: row.netEur,
      taxableAmountEur: row.taxableAmountEur,
      estimatedTaxEur: row.estimatedTaxEur,
      tradeCount: row.tradeCount,
    }));

    // -----------------------------------------------------------------------
    // Aggregated KPIs
    // -----------------------------------------------------------------------
    const totalNetEur = sumStrings(buckets.map((b) => b.netEur));
    const totalTradeCount = buckets.reduce((acc, b) => acc + b.tradeCount, 0);
    const totalTaxableEur = sumStrings(buckets.map((b) => b.taxableAmountEur));
    const totalEstimatedTaxEur = sumStrings(buckets.map((b) => b.estimatedTaxEur));

    // -----------------------------------------------------------------------
    // Monthly spot (DASH-02, DASH-05)
    // -----------------------------------------------------------------------
    const monthlySpotRows = db
      .select({
        month: sql<string>`strftime('%Y-%m', ${transactions.tradedAt})`.as('month'),
        gains: sql<string>`CAST(SUM(CASE WHEN CAST(${lotConsumptions.gainLossEur} AS REAL) > 0 THEN CAST(${lotConsumptions.gainLossEur} AS REAL) ELSE 0 END) AS TEXT)`.as('gains'),
        losses: sql<string>`CAST(SUM(CASE WHEN CAST(${lotConsumptions.gainLossEur} AS REAL) < 0 THEN CAST(${lotConsumptions.gainLossEur} AS REAL) ELSE 0 END) AS TEXT)`.as('losses'),
      })
      .from(lotConsumptions)
      .innerJoin(transactions, eq(lotConsumptions.sellTransactionId, transactions.id))
      .where(eq(lotConsumptions.taxYear, taxYear))
      .groupBy(sql`strftime('%Y-%m', ${transactions.tradedAt})`)
      .orderBy(sql`strftime('%Y-%m', ${transactions.tradedAt})`)
      .all();

    const monthlySpot = monthlySpotRows.map((r) => ({
      month: r.month,
      gains: r.gains ?? '0',
      losses: r.losses ?? '0',
    }));

    // -----------------------------------------------------------------------
    // Monthly futures (DASH-05, DASH-06)
    // -----------------------------------------------------------------------
    const monthlyFuturesRows = db
      .select({
        month: sql<string>`strftime('%Y-%m', ${transactions.tradedAt})`.as('month'),
        pnl: sql<string>`CAST(SUM(CAST(${futuresPositions.realizedPnlEur} AS REAL) - CAST(${futuresPositions.feeEur} AS REAL)) AS TEXT)`.as('pnl'),
      })
      .from(futuresPositions)
      .innerJoin(transactions, eq(futuresPositions.transactionId, transactions.id))
      .where(eq(futuresPositions.taxYear, taxYear))
      .groupBy(sql`strftime('%Y-%m', ${transactions.tradedAt})`)
      .orderBy(sql`strftime('%Y-%m', ${transactions.tradedAt})`)
      .all();

    const monthlyFutures = monthlyFuturesRows.map((r) => ({
      month: r.month,
      pnl: r.pnl ?? '0',
    }));

    // -----------------------------------------------------------------------
    // Per-coin gain/loss (DASH-04)
    // -----------------------------------------------------------------------
    const perCoinRows = db
      .select({
        symbol: fifoLots.symbol,
        net: sql<string>`CAST(SUM(CAST(${lotConsumptions.gainLossEur} AS REAL)) AS TEXT)`.as('net'),
      })
      .from(lotConsumptions)
      .innerJoin(fifoLots, eq(lotConsumptions.lotId, fifoLots.id))
      .where(eq(lotConsumptions.taxYear, taxYear))
      .groupBy(fifoLots.symbol)
      .orderBy(sql`SUM(CAST(${lotConsumptions.gainLossEur} AS REAL)) DESC`)
      .all();

    const perCoinGainLoss = perCoinRows.map((r) => ({
      symbol: r.symbol,
      net: r.net ?? '0',
    }));

    // -----------------------------------------------------------------------
    // Portfolio allocation — open lots only (DASH-03), not filtered by year
    // -----------------------------------------------------------------------
    const portfolioRows = db
      .select({
        symbol: fifoLots.symbol,
        valueEur: sql<string>`CAST(SUM(CAST(${fifoLots.remainingAmount} AS REAL) * CAST(${fifoLots.costPerUnitEur} AS REAL)) AS TEXT)`.as('valueEur'),
      })
      .from(fifoLots)
      .where(sql`CAST(${fifoLots.remainingAmount} AS REAL) > 0`)
      .groupBy(fifoLots.symbol)
      .orderBy(sql`SUM(CAST(${fifoLots.remainingAmount} AS REAL) * CAST(${fifoLots.costPerUnitEur} AS REAL)) DESC`)
      .all();

    const portfolioAllocation = portfolioRows.map((r) => ({
      symbol: r.symbol,
      valueEur: r.valueEur ?? '0',
    }));

    // -----------------------------------------------------------------------
    // Year-over-year (DASH-08)
    // -----------------------------------------------------------------------
    const allSummaries = db.select().from(taxSummaries).all();

    // Group by taxYear and pivot by bucket
    const yoyMap = new Map<
      number,
      { spotNet: string; futuresNet: string; earnNet: string }
    >();
    for (const row of allSummaries) {
      if (!yoyMap.has(row.taxYear)) {
        yoyMap.set(row.taxYear, { spotNet: '0', futuresNet: '0', earnNet: '0' });
      }
      const entry = yoyMap.get(row.taxYear)!;
      if (row.bucket === 'private_sale') entry.spotNet = row.netEur;
      else if (row.bucket === 'futures_pnl') entry.futuresNet = row.netEur;
      else if (row.bucket === 'staking_earn') entry.earnNet = row.netEur;
    }

    const yearOverYear = Array.from(yoyMap.entries())
      .sort(([a], [b]) => a - b)
      .map(([year, data]) => ({
        taxYear: year,
        spotNet: data.spotNet,
        futuresNet: data.futuresNet,
        earnNet: data.earnNet,
      }));

    // -----------------------------------------------------------------------
    // Freigrenze
    // -----------------------------------------------------------------------
    const spotBucket = buckets.find((b) => b.bucket === 'private_sale');
    const earnBucket = buckets.find((b) => b.bucket === 'staking_earn');

    const spotNetForFreigrenze = spotBucket?.netEur ?? '0';
    const earnTotalForFreigrenze = earnBucket?.netEur ?? '0';

    // -----------------------------------------------------------------------
    // Build response
    // -----------------------------------------------------------------------
    const response: YearSummaryResponse = {
      taxYear,
      availableYears,
      engineHasRun: true,
      buckets,
      totalNetEur,
      totalTradeCount,
      totalTaxableEur,
      totalEstimatedTaxEur,
      monthlySpot,
      monthlyFutures,
      perCoinGainLoss,
      portfolioAllocation,
      yearOverYear,
      spotFreigrenzeEur: TAX_CONSTANTS.SPOT_FREIGRENZE_EUR,
      earnFreigrenzeEur: TAX_CONSTANTS.EARN_FREIGRENZE_EUR,
      spotNetForFreigrenze,
      earnTotalForFreigrenze,
    };

    return c.json(response);
  });
}
