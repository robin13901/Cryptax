import type { PriceFailureReason, PriceSource } from '@cryptax/shared';
import { Decimal } from 'decimal.js';
import { and, eq } from 'drizzle-orm';
import { CoinGeckoOutOfRangeError } from './coingecko-client.js';
import type { lookupPriceCache, upsertPriceCache } from './price-cache.js';
import { parseSymbol, usesCsvFillPrice, usesCsvUsdtPrice } from './symbol-parser.js';
import { berlinToUtcMs } from './timezone.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A transaction row as returned from the DB (minimal fields needed for resolution). */
export interface TransactionRow {
  id: number;
  orderId: string | null;
  sourceType: string;
  symbol: string;
  side: string | null;
  amount: string;
  price: string;
  tradedAt: string;
}

/** Returned when price resolution succeeds. */
export interface ResolutionResult {
  eurPrice: string;
  source: PriceSource;
  /** USDT intermediate price (only set when source = 'bitget-usdt' or 'csv-pair') */
  usdtPrice?: string;
  /** USDT/EUR rate used for conversion (only set when source = 'bitget-usdt' or 'csv-pair') */
  usdtEurRate?: string;
}

/** Returned when price resolution fails. */
export interface ResolutionFailure {
  reason: PriceFailureReason;
}

/** The result of attempting to resolve a price for a transaction. */
export type ResolutionOutcome =
  | { ok: true; result: ResolutionResult }
  | { ok: false; failure: ResolutionFailure };

/** Dependency-injected clients and helpers for resolvePrice. */
export interface ResolutionDeps {
  bitgetClient: {
    fetchClose: (
      symbol: string,
      targetMs: number,
      granularity?: '1min' | '5min'
    ) => Promise<string | null>;
  };
  coingeckoClient: {
    fetchPrice: (coinId: string, utcMs: number) => Promise<string | null>;
  };
  /** CoinGecko lowercase-symbol → coin-id map, loaded once per enrichment run. */
  symbolMap: Map<string, string>;
  cache: {
    lookup: typeof lookupPriceCache;
    upsert: typeof upsertPriceCache;
  };
  // biome-ignore lint/suspicious/noExplicitAny: Drizzle DB type is complex; any is intentional here
  db: any;
  /** Drizzle transactions table reference for sibling queries. */
  // biome-ignore lint/suspicious/noExplicitAny: Drizzle table type is complex
  transactionsTable?: any;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Rounds a UTC millisecond timestamp down to minute precision and returns
 * an ISO 8601 string suitable for use as a price-cache key.
 */
function toTimestampMinute(utcMs: number): string {
  const truncated = Math.floor(utcMs / 60_000) * 60_000;
  return new Date(truncated).toISOString();
}

/**
 * Derive COIN/USDT price from a paired USDT transaction at the same timestamp.
 *
 * Pattern: when you buy MOZ with USDT, there are two rows at the same timestamp:
 *   - USDT Sell -50    (spent 50 USDT)
 *   - MOZ  Buy  1234   (received 1234 MOZ)
 * → MOZ price = 50 / 1234 USDT
 *
 * Returns the USDT price as a Decimal string, or null if no matching pair found.
 */
function derivePriceFromPair(
  tx: TransactionRow,
  // biome-ignore lint/suspicious/noExplicitAny: Drizzle DB/table types are complex
  db: any,
  // biome-ignore lint/suspicious/noExplicitAny: Drizzle table type
  txTable: any
): string | null {
  if (!tx.side || !tx.tradedAt || !tx.orderId) return null;

  // Find USDT transactions at the same timestamp with the opposite side
  const oppositeSide = tx.side === 'buy' ? 'sell' : 'buy';

  const siblings = db
    .select({
      orderId: txTable.orderId,
      amount: txTable.amount,
    })
    .from(txTable)
    .where(
      and(
        eq(txTable.tradedAt, tx.tradedAt),
        eq(txTable.symbol, 'USDT'),
        eq(txTable.side, oppositeSide)
      )
    )
    .all() as Array<{ orderId: string | null; amount: string }>;

  if (siblings.length === 0) return null;

  // Match by closest order_id to handle multiple pairs at the same timestamp
  const coinOrderId = BigInt(tx.orderId);
  let bestMatch: (typeof siblings)[0] | null = null;
  let bestDistance = BigInt('999999999999999999');

  for (const sib of siblings) {
    if (!sib.orderId) continue;
    const sibOrderId = BigInt(sib.orderId);
    const distance = coinOrderId > sibOrderId ? coinOrderId - sibOrderId : sibOrderId - coinOrderId;
    if (distance < bestDistance) {
      bestDistance = distance;
      bestMatch = sib;
    }
  }

  // Safety: reject if order_id distance is unreasonably large (>100)
  if (!bestMatch || bestDistance > 100n) return null;

  const usdtAmount = new Decimal(bestMatch.amount).abs();
  const coinAmount = new Decimal(tx.amount).abs();

  if (coinAmount.isZero()) return null;

  return usdtAmount.div(coinAmount).toString();
}

// ---------------------------------------------------------------------------
// resolvePrice
// ---------------------------------------------------------------------------

/**
 * Resolves the EUR price for a transaction using a multi-source fallback chain:
 *
 *   1. EUR self-price (EUR transactions always = 1.0 EUR)
 *   2. CSV pair derivation (derive COIN/USDT from paired tx, then × USDT/EUR)
 *   3. CSV fill-price shortcut (spot_order with EUR pair)
 *   4. Price cache hit
 *   5. Bitget USDT fallback (COIN/USDT × USDT/EUR, 1 min → 5 min)
 *   6. Bitget direct EUR (1 min → 5 min)
 *   7. CoinGecko history API
 *
 * Never throws. Returns ResolutionOutcome.
 */
export async function resolvePrice(
  tx: TransactionRow,
  deps: ResolutionDeps
): Promise<ResolutionOutcome> {
  const { bitgetClient, coingeckoClient, symbolMap, cache, db } = deps;
  const txTable = deps.transactionsTable;

  // -------------------------------------------------------------------------
  // Step 1: EUR self-price — EUR is always worth 1.0 EUR
  // -------------------------------------------------------------------------
  if (tx.symbol.toUpperCase() === 'EUR') {
    return { ok: true, result: { eurPrice: '1', source: 'self' } };
  }

  // -------------------------------------------------------------------------
  // Step 1b: USDT-margined futures — amount is in USDT, need USDT/EUR rate
  // For futures_tx, the symbol is the contract name (e.g. "POPCATUSDT") but
  // the Coin column (and thus the amount) is in USDT. The EUR price per unit
  // is simply the USDT/EUR exchange rate.
  // -------------------------------------------------------------------------
  if (tx.sourceType === 'futures_tx') {
    const targetMs = berlinToUtcMs(tx.tradedAt);
    const usdtInEur =
      (await bitgetClient.fetchClose('USDTEUR', targetMs, '1min')) ??
      (await bitgetClient.fetchClose('USDTEUR', targetMs, '5min'));

    if (usdtInEur !== null) {
      const timestampMinute = toTimestampMinute(targetMs);
      await cache.upsert(db, {
        symbol: 'USDTEUR',
        timestamp: timestampMinute,
        eurPrice: usdtInEur,
        source: 'bitget-direct',
        fetchedAt: new Date().toISOString(),
      });
      return {
        ok: true,
        result: { eurPrice: usdtInEur, source: 'bitget-direct' },
      };
    }
  }

  // -------------------------------------------------------------------------
  // Step 2: CSV pair derivation — derive price from paired USDT transaction
  // -------------------------------------------------------------------------
  if (txTable) {
    const usdtPrice = derivePriceFromPair(tx, db, txTable);
    if (usdtPrice !== null) {
      // We have COIN/USDT price from the CSV data. Now get USDT/EUR from Bitget.
      const targetMs = berlinToUtcMs(tx.tradedAt);

      const usdtInEur =
        (await bitgetClient.fetchClose('USDTEUR', targetMs, '1min')) ??
        (await bitgetClient.fetchClose('USDTEUR', targetMs, '5min'));

      if (usdtInEur !== null) {
        const eurPrice = new Decimal(usdtPrice).mul(new Decimal(usdtInEur)).toString();
        const timestampMinute = toTimestampMinute(targetMs);

        // biome-ignore lint/suspicious/noExplicitAny: sourceType from DB
        const parsedSymbol = parseSymbol(tx.symbol, tx.sourceType as any);
        await cache.upsert(db, {
          symbol: parsedSymbol.bitgetSymbol,
          timestamp: timestampMinute,
          eurPrice,
          source: 'csv-pair',
          usdtPrice,
          usdtEurRate: usdtInEur,
          fetchedAt: new Date().toISOString(),
        });

        return {
          ok: true,
          result: {
            eurPrice,
            source: 'csv-pair',
            usdtPrice,
            usdtEurRate: usdtInEur,
          },
        };
      }
    }
  }

  // -------------------------------------------------------------------------
  // Step 3: CSV fill-price shortcut (EUR-quoted spot orders)
  // -------------------------------------------------------------------------
  // biome-ignore lint/suspicious/noExplicitAny: sourceType comes from DB as string
  if (usesCsvFillPrice(tx.sourceType as any, tx.symbol, tx.price)) {
    return { ok: true, result: { eurPrice: tx.price, source: 'csv-fill' } };
  }

  // -------------------------------------------------------------------------
  // Step 3b: CSV USDT fill-price (USDT-quoted spot/futures orders)
  // The CSV "Average Price" is in USDT — multiply by USDT/EUR rate.
  // -------------------------------------------------------------------------
  // biome-ignore lint/suspicious/noExplicitAny: sourceType comes from DB as string
  if (usesCsvUsdtPrice(tx.sourceType as any, tx.symbol, tx.price)) {
    const targetMsUsdt = berlinToUtcMs(tx.tradedAt);
    const usdtInEur =
      (await bitgetClient.fetchClose('USDTEUR', targetMsUsdt, '1min')) ??
      (await bitgetClient.fetchClose('USDTEUR', targetMsUsdt, '5min'));

    if (usdtInEur !== null) {
      const eurPrice = new Decimal(tx.price).mul(new Decimal(usdtInEur)).toString();
      const timestampMinuteUsdt = toTimestampMinute(targetMsUsdt);
      // biome-ignore lint/suspicious/noExplicitAny: sourceType from DB
      const parsed = parseSymbol(tx.symbol, tx.sourceType as any);
      await cache.upsert(db, {
        symbol: parsed.bitgetSymbol,
        timestamp: timestampMinuteUsdt,
        eurPrice,
        source: 'csv-fill',
        usdtPrice: tx.price,
        usdtEurRate: usdtInEur,
        fetchedAt: new Date().toISOString(),
      });
      return {
        ok: true,
        result: { eurPrice, source: 'csv-fill', usdtPrice: tx.price, usdtEurRate: usdtInEur },
      };
    }
  }

  // -------------------------------------------------------------------------
  // Step 4: Parse symbol and compute cache key
  // -------------------------------------------------------------------------
  // biome-ignore lint/suspicious/noExplicitAny: sourceType comes from DB as string
  const parsedSymbol = parseSymbol(tx.symbol, tx.sourceType as any);
  const targetMs = berlinToUtcMs(tx.tradedAt);
  const timestampMinute = toTimestampMinute(targetMs);

  // -------------------------------------------------------------------------
  // Step 5: Cache lookup
  // -------------------------------------------------------------------------
  const cached = await cache.lookup(db, parsedSymbol.bitgetSymbol, timestampMinute);
  if (cached) {
    return {
      ok: true,
      result: {
        eurPrice: cached.eurPrice,
        source: cached.source as PriceSource,
        usdtPrice: cached.usdtPrice ?? undefined,
        usdtEurRate: cached.usdtEurRate ?? undefined,
      },
    };
  }

  const baseAsset = parsedSymbol.base;

  // -------------------------------------------------------------------------
  // Step 6: Bitget USDT fallback (COIN/USDT × USDT/EUR, same targetMs)
  // -------------------------------------------------------------------------
  const usdtSymbol = `${baseAsset}USDT`;

  // Try 1-minute granularity for both legs simultaneously
  const [baseInUsdt1min, usdtInEur1min] = await Promise.all([
    bitgetClient.fetchClose(usdtSymbol, targetMs, '1min'),
    bitgetClient.fetchClose('USDTEUR', targetMs, '1min'),
  ]);

  if (baseInUsdt1min !== null && usdtInEur1min !== null) {
    const eurPrice = new Decimal(baseInUsdt1min).mul(new Decimal(usdtInEur1min)).toString();
    await cache.upsert(db, {
      symbol: parsedSymbol.bitgetSymbol,
      timestamp: timestampMinute,
      eurPrice,
      source: 'bitget-usdt',
      usdtPrice: baseInUsdt1min,
      usdtEurRate: usdtInEur1min,
      fetchedAt: new Date().toISOString(),
    });
    return {
      ok: true,
      result: {
        eurPrice,
        source: 'bitget-usdt',
        usdtPrice: baseInUsdt1min,
        usdtEurRate: usdtInEur1min,
      },
    };
  }

  // Try 5-minute granularity for both legs simultaneously
  const [baseInUsdt5min, usdtInEur5min] = await Promise.all([
    bitgetClient.fetchClose(usdtSymbol, targetMs, '5min'),
    bitgetClient.fetchClose('USDTEUR', targetMs, '5min'),
  ]);

  if (baseInUsdt5min !== null && usdtInEur5min !== null) {
    const eurPrice = new Decimal(baseInUsdt5min).mul(new Decimal(usdtInEur5min)).toString();
    await cache.upsert(db, {
      symbol: parsedSymbol.bitgetSymbol,
      timestamp: timestampMinute,
      eurPrice,
      source: 'bitget-usdt',
      usdtPrice: baseInUsdt5min,
      usdtEurRate: usdtInEur5min,
      fetchedAt: new Date().toISOString(),
    });
    return {
      ok: true,
      result: {
        eurPrice,
        source: 'bitget-usdt',
        usdtPrice: baseInUsdt5min,
        usdtEurRate: usdtInEur5min,
      },
    };
  }

  // -------------------------------------------------------------------------
  // Step 7: Bitget direct EUR (1 min, then 5 min)
  // -------------------------------------------------------------------------
  const eurSymbol = `${baseAsset}EUR`;

  const eurDirect1min = await bitgetClient.fetchClose(eurSymbol, targetMs, '1min');
  if (eurDirect1min !== null) {
    await cache.upsert(db, {
      symbol: parsedSymbol.bitgetSymbol,
      timestamp: timestampMinute,
      eurPrice: eurDirect1min,
      source: 'bitget-direct',
      fetchedAt: new Date().toISOString(),
    });
    return {
      ok: true,
      result: { eurPrice: eurDirect1min, source: 'bitget-direct' },
    };
  }

  const eurDirect5min = await bitgetClient.fetchClose(eurSymbol, targetMs, '5min');
  if (eurDirect5min !== null) {
    await cache.upsert(db, {
      symbol: parsedSymbol.bitgetSymbol,
      timestamp: timestampMinute,
      eurPrice: eurDirect5min,
      source: 'bitget-direct',
      fetchedAt: new Date().toISOString(),
    });
    return {
      ok: true,
      result: { eurPrice: eurDirect5min, source: 'bitget-direct' },
    };
  }

  // -------------------------------------------------------------------------
  // Step 8: CoinGecko fallback
  // -------------------------------------------------------------------------
  const coinKey = parsedSymbol.base.toLowerCase();
  const coinId = symbolMap.get(coinKey);

  if (coinId) {
    try {
      const cgPrice = await coingeckoClient.fetchPrice(coinId, targetMs);
      if (cgPrice !== null) {
        await cache.upsert(db, {
          symbol: parsedSymbol.bitgetSymbol,
          timestamp: timestampMinute,
          eurPrice: cgPrice,
          source: 'coingecko',
          fetchedAt: new Date().toISOString(),
        });
        return { ok: true, result: { eurPrice: cgPrice, source: 'coingecko' } };
      }
      // null from CoinGecko → no price available
      return { ok: false, failure: { reason: 'coingecko-miss' } };
    } catch (err) {
      if (err instanceof CoinGeckoOutOfRangeError) {
        return { ok: false, failure: { reason: 'coingecko-miss' } };
      }
      // Unexpected error from CoinGecko — treat as api-error
      return { ok: false, failure: { reason: 'api-error' } };
    }
  }

  // -------------------------------------------------------------------------
  // Step 9: All sources failed
  // -------------------------------------------------------------------------
  return { ok: false, failure: { reason: 'no-bitget-pair' } };
}
