import type { PriceFailureReason, PriceSource } from '@cryptax/shared';
import { Decimal } from '@cryptax/shared';
import { CoinGeckoOutOfRangeError } from './coingecko-client.js';
import type { lookupPriceCache, upsertPriceCache } from './price-cache.js';
import { parseSymbol, usesCsvFillPrice } from './symbol-parser.js';
import { berlinToUtcMs } from './timezone.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A transaction row as returned from the DB (minimal fields needed for resolution). */
export interface TransactionRow {
  id: number;
  sourceType: string;
  symbol: string;
  price: string;
  tradedAt: string;
}

/** Returned when price resolution succeeds. */
export interface ResolutionResult {
  eurPrice: string;
  source: PriceSource;
  /** USDT intermediate price (only set when source = 'bitget-usdt') */
  usdtPrice?: string;
  /** USDT/EUR rate used for conversion (only set when source = 'bitget-usdt') */
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

// ---------------------------------------------------------------------------
// resolvePrice
// ---------------------------------------------------------------------------

/**
 * Resolves the EUR price for a transaction using a multi-source fallback chain:
 *
 *   1. CSV fill-price shortcut (spot_order with EUR pair)
 *   2. Price cache hit
 *   3. Bitget direct EUR (1 min → 5 min)
 *   4. Bitget USDT fallback (COIN/USDT × USDT/EUR, 1 min → 5 min)
 *   5. CoinGecko history API
 *
 * Never throws. Returns ResolutionOutcome.
 */
export async function resolvePrice(
  tx: TransactionRow,
  deps: ResolutionDeps
): Promise<ResolutionOutcome> {
  const { bitgetClient, coingeckoClient, symbolMap, cache, db } = deps;

  // -------------------------------------------------------------------------
  // Step 1: CSV fill-price shortcut
  // -------------------------------------------------------------------------
  // biome-ignore lint/suspicious/noExplicitAny: sourceType comes from DB as string
  if (usesCsvFillPrice(tx.sourceType as any, tx.symbol, tx.price)) {
    return { ok: true, result: { eurPrice: tx.price, source: 'csv-fill' } };
  }

  // -------------------------------------------------------------------------
  // Step 2: Parse symbol and compute cache key
  // -------------------------------------------------------------------------
  // biome-ignore lint/suspicious/noExplicitAny: sourceType comes from DB as string
  const parsedSymbol = parseSymbol(tx.symbol, tx.sourceType as any);
  const targetMs = berlinToUtcMs(tx.tradedAt);
  const timestampMinute = toTimestampMinute(targetMs);

  // -------------------------------------------------------------------------
  // Step 3: Cache lookup
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
  // Step 4: Bitget direct EUR (1 min, then 5 min)
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
    return { ok: true, result: { eurPrice: eurDirect1min, source: 'bitget-direct' } };
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
    return { ok: true, result: { eurPrice: eurDirect5min, source: 'bitget-direct' } };
  }

  // -------------------------------------------------------------------------
  // Step 5: Bitget USDT fallback (COIN/USDT × USDT/EUR, same targetMs)
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
  // Step 6: CoinGecko fallback
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
  // Step 7: All sources failed
  // -------------------------------------------------------------------------
  return { ok: false, failure: { reason: 'no-bitget-pair' } };
}
