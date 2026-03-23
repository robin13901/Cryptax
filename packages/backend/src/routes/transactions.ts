import type {
  LotConsumptionDetail,
  MoneyString,
  TransactionDetailResponse,
  TransactionPageResponse,
} from '@cryptax/shared';
import { and, asc, between, count, desc, eq, like, or, sql } from 'drizzle-orm';
import type { Hono } from 'hono';
import { db } from '../db/client.js';
import {
  earnIncome,
  fifoLots,
  futuresPositions,
  lotConsumptions,
  transactions,
} from '../db/schema.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseIntParam(
  raw: string | undefined,
  defaultValue: number,
  max?: number,
): number {
  if (!raw) return defaultValue;
  const parsed = parseInt(raw, 10);
  if (Number.isNaN(parsed)) return defaultValue;
  if (max !== undefined && parsed > max) return max;
  return parsed < 0 ? defaultValue : parsed;
}

function buildSortExpr(sortBy: string, sortDir: string) {
  const direction = sortDir === 'asc' ? asc : desc;

  switch (sortBy) {
    case 'amount':
      return direction(sql<number>`CAST(${transactions.amount} AS REAL)`);
    case 'eurPrice':
      return direction(sql<number>`CAST(${transactions.eurPrice} AS REAL)`);
    case 'symbol':
      return direction(transactions.symbol);
    case 'canonicalType':
      return direction(transactions.canonicalType);
    case 'tradedAt':
    default:
      return direction(transactions.tradedAt);
  }
}

// ---------------------------------------------------------------------------
// registerTransactionRoutes
// ---------------------------------------------------------------------------

/**
 * Register transaction routes on the Hono application.
 *
 * Routes:
 *   GET  /api/transactions       — Paginated, filtered, searchable, sortable list
 *   GET  /api/transactions/:id   — Full detail with FIFO lots and tax impact
 */
export function registerTransactionRoutes(app: Hono) {
  // -------------------------------------------------------------------------
  // GET /api/transactions
  // -------------------------------------------------------------------------
  app.get('/api/transactions', (c) => {
    const { year, type, coin, from, to, search, sortBy, sortDir, limit, offset } =
      c.req.query();

    const parsedLimit = parseIntParam(limit, 50, 200);
    const parsedOffset = parseIntParam(offset, 0);

    // Build WHERE conditions
    const conditions: ReturnType<typeof eq>[] = [];
    if (year) conditions.push(eq(transactions.taxYear, Number(year)));
    if (type) conditions.push(eq(transactions.canonicalType, type));
    if (coin) conditions.push(eq(transactions.symbol, coin));
    if (from && to) conditions.push(between(transactions.tradedAt, from, to));
    if (search) {
      conditions.push(
        or(
          like(transactions.symbol, `%${search}%`),
          like(transactions.orderId, `%${search}%`),
        ) as ReturnType<typeof eq>,
      );
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    // Count query
    const countResult = db
      .select({ count: count() })
      .from(transactions)
      .where(whereClause)
      .get();
    const total = countResult?.count ?? 0;

    // Sort expression
    const sortExpr = buildSortExpr(sortBy ?? 'tradedAt', sortDir ?? 'desc');

    // Data query — select TransactionListItem fields
    const items = db
      .select({
        id: transactions.id,
        orderId: transactions.orderId,
        symbol: transactions.symbol,
        canonicalType: transactions.canonicalType,
        sourceType: transactions.sourceType,
        side: transactions.side,
        amount: transactions.amount,
        price: transactions.price,
        fee: transactions.fee,
        eurPrice: transactions.eurPrice,
        tradedAt: transactions.tradedAt,
        taxYear: transactions.taxYear,
        exchange: transactions.exchange,
      })
      .from(transactions)
      .where(whereClause)
      .orderBy(sortExpr)
      .limit(parsedLimit)
      .offset(parsedOffset)
      .all();

    const response: TransactionPageResponse = {
      items: items.map((item) => ({
        id: item.id,
        orderId: item.orderId,
        symbol: item.symbol,
        canonicalType: item.canonicalType as import('@cryptax/shared').CanonicalType,
        sourceType: item.sourceType as import('@cryptax/shared').SourceType,
        side: item.side as import('@cryptax/shared').TransactionSide,
        amount: item.amount,
        price: item.price,
        fee: item.fee,
        eurPrice: item.eurPrice,
        tradedAt: item.tradedAt,
        taxYear: item.taxYear,
        exchange: item.exchange,
      })),
      total,
      hasMore: parsedOffset + parsedLimit < total,
      offset: parsedOffset,
      limit: parsedLimit,
    };

    return c.json(response);
  });

  // -------------------------------------------------------------------------
  // GET /api/transactions/:id
  // -------------------------------------------------------------------------
  app.get('/api/transactions/:id', (c) => {
    const rawId = c.req.param('id');
    const id = parseInt(rawId, 10);
    if (Number.isNaN(id)) {
      return c.json({ error: `Invalid id: ${rawId}` }, 400);
    }

    // Fetch full transaction
    const txRow = db
      .select()
      .from(transactions)
      .where(eq(transactions.id, id))
      .get();

    if (!txRow) {
      return c.json({ error: `Transaction not found: ${id}` }, 404);
    }

    // Lot consumptions joined to FIFO lots
    const lots = db
      .select({
        lotId: lotConsumptions.lotId,
        amountConsumed: lotConsumptions.amountConsumed,
        costBasisEur: lotConsumptions.costBasisEur,
        proceedsEur: lotConsumptions.proceedsEur,
        gainLossEur: lotConsumptions.gainLossEur,
        feeEur: lotConsumptions.feeEur,
        heldDays: lotConsumptions.heldDays,
        haltefristMet: lotConsumptions.haltefristMet,
        acquiredAt: fifoLots.acquiredAt,
        costPerUnitEur: fifoLots.costPerUnitEur,
        symbol: fifoLots.symbol,
      })
      .from(lotConsumptions)
      .innerJoin(fifoLots, eq(lotConsumptions.lotId, fifoLots.id))
      .where(eq(lotConsumptions.sellTransactionId, id))
      .all();

    const lotConsumptionDetails: LotConsumptionDetail[] = lots.map((l) => ({
      lotId: l.lotId,
      amountConsumed: l.amountConsumed,
      costBasisEur: l.costBasisEur,
      proceedsEur: l.proceedsEur,
      gainLossEur: l.gainLossEur,
      feeEur: l.feeEur,
      heldDays: l.heldDays,
      haltefristMet: Boolean(l.haltefristMet),
      acquiredAt: l.acquiredAt,
      costPerUnitEur: l.costPerUnitEur,
      symbol: l.symbol,
    }));

    // Futures position
    const futuresRow = db
      .select({
        realizedPnlEur: futuresPositions.realizedPnlEur,
        feeEur: futuresPositions.feeEur,
      })
      .from(futuresPositions)
      .where(eq(futuresPositions.transactionId, id))
      .get();

    const futuresPosition = futuresRow
      ? {
          realizedPnlEur: futuresRow.realizedPnlEur,
          feeEur: futuresRow.feeEur,
        }
      : null;

    // Earn income
    const earnRow = db
      .select({
        amount: earnIncome.amount,
        eurValueAtReceipt: earnIncome.eurValueAtReceipt,
      })
      .from(earnIncome)
      .where(eq(earnIncome.transactionId, id))
      .get();

    const earnIncomeData = earnRow
      ? {
          amount: earnRow.amount,
          eurValueAtReceipt: earnRow.eurValueAtReceipt,
        }
      : null;

    // Compute taxImpact
    const taxImpact = computeTaxImpact(
      lotConsumptionDetails,
      futuresPosition,
      earnIncomeData,
    );

    const response: TransactionDetailResponse = {
      transaction: {
        id: txRow.id,
        orderId: txRow.orderId ?? '',
        exchange: txRow.exchange,
        sourceType: txRow.sourceType as import('@cryptax/shared').SourceType,
        canonicalType: txRow.canonicalType as import('@cryptax/shared').CanonicalType,
        symbol: txRow.symbol,
        side: txRow.side as import('@cryptax/shared').TransactionSide,
        amount: txRow.amount,
        price: txRow.price,
        fee: txRow.fee,
        totalValue: txRow.totalValue,
        tradedAt: txRow.tradedAt,
        taxYear: txRow.taxYear,
        sourceFile: txRow.sourceFile,
        rawRow: txRow.rawRow,
        checksum: txRow.checksum,
        importedAt: txRow.importedAt,
        eurPrice: txRow.eurPrice,
        priceSource: txRow.priceSource as import('@cryptax/shared').PriceSource,
        priceResolvedAt: txRow.priceResolvedAt,
        priceFailureReason: txRow.priceFailureReason as import('@cryptax/shared').PriceFailureReason,
      },
      lotConsumptions: lotConsumptionDetails,
      futuresPosition,
      earnIncome: earnIncomeData,
      taxImpact,
    };

    return c.json(response);
  });
}

// ---------------------------------------------------------------------------
// taxImpact computation
// ---------------------------------------------------------------------------

function sumMoneyStrings(values: MoneyString[]): MoneyString {
  const total = values.reduce((acc, v) => acc + parseFloat(v || '0'), 0);
  return String(total);
}

function computeTaxImpact(
  lots: LotConsumptionDetail[],
  futuresPos: { realizedPnlEur: MoneyString; feeEur: MoneyString } | null,
  earn: { amount: MoneyString; eurValueAtReceipt: MoneyString } | null,
): TransactionDetailResponse['taxImpact'] {
  // Private sale (FIFO lots)
  if (lots.length > 0) {
    const totalGainLossEur = sumMoneyStrings(lots.map((l) => l.gainLossEur));
    const allHaltefristMet = lots.every((l) => l.haltefristMet);
    return {
      bucket: 'private_sale',
      totalGainLossEur,
      isTaxFree: allHaltefristMet,
      reason: allHaltefristMet ? 'Haltefrist met' : 'Taxable',
    };
  }

  // Futures P&L
  if (futuresPos) {
    const pnl =
      parseFloat(futuresPos.realizedPnlEur) - parseFloat(futuresPos.feeEur);
    return {
      bucket: 'futures_pnl',
      totalGainLossEur: String(pnl),
      isTaxFree: false,
      reason: 'Taxable',
    };
  }

  // Earn / staking income
  if (earn) {
    return {
      bucket: 'staking_earn',
      totalGainLossEur: earn.eurValueAtReceipt,
      isTaxFree: false,
      reason: 'Taxable',
    };
  }

  // No tax event
  return {
    bucket: null,
    totalGainLossEur: '0',
    isTaxFree: true,
    reason: 'No tax event',
  };
}
