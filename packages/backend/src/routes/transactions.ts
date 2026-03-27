import type {
  LotConsumptionDetail,
  MoneyString,
  TransactionDetailResponse,
  TransactionPageResponse,
} from '@cryptax/shared';
import { and, asc, between, count, desc, eq, like, not, or, sql } from 'drizzle-orm';
import type { Hono } from 'hono';
import { db, sqlite } from '../db/client.js';
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

function parseIntParam(raw: string | undefined, defaultValue: number, max?: number): number {
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
    default:
      return direction(transactions.tradedAt);
  }
}

/**
 * Derive base coin from symbol + sourceType.
 * "BTC/EUR" → "BTC", "BTCUSDT" → "BTC", "BTC" → "BTC"
 */
function deriveBaseCoin(symbol: string, sourceType: string): string {
  // spot_order / futures_order with slash: "BTC/EUR" → "BTC"
  const slashIdx = symbol.indexOf('/');
  if (slashIdx !== -1) return symbol.slice(0, slashIdx);

  // futures: strip known suffixes
  if (sourceType === 'futures_order' || sourceType === 'futures_tx') {
    const upper = symbol.toUpperCase();
    for (const suffix of ['USDT', 'USD', 'EUR', 'BTC', 'PERP']) {
      if (upper.endsWith(suffix) && upper.length > suffix.length) {
        return upper.slice(0, upper.length - suffix.length);
      }
    }
  }

  return symbol;
}

/**
 * Derive trading pair from symbol + sourceType.
 * spot_order: "BTC/EUR" → "BTC/EUR"
 * futures_order/futures_tx: "BTCUSDT" → "BTCUSDT"
 * spot_tx/earn: bare coin → null (no pair info)
 */
function deriveTradingPair(symbol: string, sourceType: string): string | null {
  if (sourceType === 'spot_order') return symbol;
  if (sourceType === 'futures_order' || sourceType === 'futures_tx') return symbol;
  return null;
}

/**
 * SQL condition to exclude spot_tx rows that have a matching spot_order
 * at the same traded_at timestamp. Bitget uses different order IDs in
 * spot_tx vs spot_order, so we match by timestamp instead.
 */
function buildCollapseCondition() {
  return not(
    and(
      eq(transactions.sourceType, 'spot_tx'),
      sql`${transactions.tradedAt} IN (SELECT traded_at FROM transactions WHERE source_type = 'spot_order')`
    )!
  );
}

/**
 * Batch-load fees from spot_tx siblings for a set of spot_order traded_at
 * timestamps. Returns a map: tradedAt → aggregated absolute fee from spot_tx.
 */
function loadSpotTxFees(tradedAts: string[]): Map<string, string> {
  const map = new Map<string, string>();
  if (tradedAts.length === 0) return map;

  const placeholders = tradedAts.map(() => '?').join(',');

  // For each traded_at, find the spot_tx rows and pick the largest absolute fee.
  const rows = sqlite
    .prepare(
      `SELECT traded_at AS tradedAt,
              CAST(MAX(ABS(CAST(fee AS REAL))) AS TEXT) AS fee
       FROM transactions
       WHERE source_type = 'spot_tx'
         AND traded_at IN (${placeholders})
         AND ABS(CAST(fee AS REAL)) > 0
       GROUP BY traded_at`
    )
    .all(...tradedAts) as { tradedAt: string; fee: string }[];

  for (const row of rows) {
    map.set(row.tradedAt, row.fee);
  }

  return map;
}

/**
 * Batch-load P&L values for a set of transaction IDs.
 * Sources: lot_consumptions (FIFO sells), futures_positions, earn_income.
 */
function loadPnlForIds(ids: number[]): Map<number, string> {
  const map = new Map<number, string>();
  if (ids.length === 0) return map;

  const placeholders = ids.map(() => '?').join(',');

  // 1. FIFO lot consumptions: SUM(gain_loss_eur) grouped by sell_transaction_id
  const fifoRows = sqlite
    .prepare(
      `SELECT sell_transaction_id AS txId, CAST(SUM(CAST(gain_loss_eur AS REAL)) AS TEXT) AS pnl
       FROM lot_consumptions
       WHERE sell_transaction_id IN (${placeholders})
       GROUP BY sell_transaction_id`
    )
    .all(...ids) as { txId: number; pnl: string }[];
  for (const row of fifoRows) {
    map.set(row.txId, row.pnl);
  }

  // 2. Futures positions: realizedPnlEur - feeEur
  const futuresRows = sqlite
    .prepare(
      `SELECT transaction_id AS txId,
              CAST(CAST(realized_pnl_eur AS REAL) - CAST(fee_eur AS REAL) AS TEXT) AS pnl
       FROM futures_positions
       WHERE transaction_id IN (${placeholders})`
    )
    .all(...ids) as { txId: number; pnl: string }[];
  for (const row of futuresRows) {
    if (!map.has(row.txId)) map.set(row.txId, row.pnl);
  }

  // 3. Earn income: eurValueAtReceipt
  const earnRows = sqlite
    .prepare(
      `SELECT transaction_id AS txId, eur_value_at_receipt AS pnl
       FROM earn_income
       WHERE transaction_id IN (${placeholders})`
    )
    .all(...ids) as { txId: number; pnl: string }[];
  for (const row of earnRows) {
    if (!map.has(row.txId)) map.set(row.txId, row.pnl);
  }

  return map;
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
    const { year, type, coin, from, to, search, sortBy, sortDir, limit, offset } = c.req.query();

    const parsedLimit = parseIntParam(limit, 50, 200);
    const parsedOffset = parseIntParam(offset, 0);

    // Build WHERE conditions
    const conditions: ReturnType<typeof eq>[] = [];
    if (year) conditions.push(eq(transactions.taxYear, Number(year)));
    if (type) conditions.push(eq(transactions.canonicalType, type));
    if (coin) {
      // Match both bare coin ("MOZ") and pair ("MOZ/USDT", "MOZ/EUR")
      conditions.push(
        or(eq(transactions.symbol, coin), like(transactions.symbol, `${coin}/%`)) as ReturnType<
          typeof eq
        >
      );
    }
    if (from && to) conditions.push(between(transactions.tradedAt, from, to));
    if (search) {
      conditions.push(
        or(
          like(transactions.symbol, `%${search}%`),
          like(transactions.orderId, `%${search}%`)
        ) as ReturnType<typeof eq>
      );
    }

    // Collapse spot_tx rows that have a matching spot_order (same orderId)
    conditions.push(buildCollapseCondition() as ReturnType<typeof eq>);

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    // Count query
    const countResult = db.select({ count: count() }).from(transactions).where(whereClause).get();
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
        totalValue: transactions.totalValue,
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

    // Batch-load P&L for fetched transaction IDs
    const ids = items.map((i) => i.id);
    const pnlMap = loadPnlForIds(ids);

    // Batch-load fees from spot_tx siblings for spot_order rows (by traded_at)
    const spotOrderTradedAts = items
      .filter((i) => i.sourceType === 'spot_order')
      .map((i) => i.tradedAt);
    const spotTxFeeMap = loadSpotTxFees(spotOrderTradedAts);

    // Available years for filter dropdown (unfiltered, always all years)
    const yearRows = db
      .selectDistinct({ taxYear: transactions.taxYear })
      .from(transactions)
      .orderBy(desc(transactions.taxYear))
      .all();
    const availableYears = yearRows.map((r) => r.taxYear);

    const response: TransactionPageResponse = {
      items: items.map((item) => {
        // For spot_order rows, merge the fee from the related spot_tx
        let fee = item.fee;
        if (item.sourceType === 'spot_order') {
          const spotTxFee = spotTxFeeMap.get(item.tradedAt);
          if (spotTxFee) fee = spotTxFee;
        }

        return {
          id: item.id,
          orderId: item.orderId,
          symbol: item.symbol,
          baseCoin: deriveBaseCoin(item.symbol, item.sourceType),
          tradingPair: deriveTradingPair(item.symbol, item.sourceType),
          canonicalType: item.canonicalType as import('@cryptax/shared').CanonicalType,
          sourceType: item.sourceType as import('@cryptax/shared').SourceType,
          side: item.side as import('@cryptax/shared').TransactionSide,
          amount: item.amount,
          price: item.price,
          fee,
          eurPrice: item.eurPrice,
          totalValue: item.totalValue,
          tradedAt: item.tradedAt,
          taxYear: item.taxYear,
          exchange: item.exchange,
          gainLossEur: pnlMap.get(item.id) ?? null,
        };
      }),
      total,
      hasMore: parsedOffset + parsedLimit < total,
      offset: parsedOffset,
      limit: parsedLimit,
      availableYears,
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
    const txRow = db.select().from(transactions).where(eq(transactions.id, id)).get();

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
    const taxImpact = computeTaxImpact(lotConsumptionDetails, futuresPosition, earnIncomeData);

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
        priceFailureReason:
          txRow.priceFailureReason as import('@cryptax/shared').PriceFailureReason,
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
  earn: { amount: MoneyString; eurValueAtReceipt: MoneyString } | null
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
    const pnl = parseFloat(futuresPos.realizedPnlEur) - parseFloat(futuresPos.feeEur);
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
