import type { PriceFailureReason } from '@cryptax/shared';
import { eq, isNull, or } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import type * as schema from '../db/schema.js';
import { transactions } from '../db/schema.js';
import { createBitgetClient } from './bitget-client.js';
import { createCoinGeckoClient, SYMBOL_OVERRIDES } from './coingecko-client.js';
import { lookupPriceCache, upsertPriceCache } from './price-cache.js';
import { resolvePrice } from './resolution-strategy.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Db = BetterSQLite3Database<typeof schema>;

/** Progress event emitted after each transaction is processed. */
export interface EnrichmentProgress {
  total: number;
  processed: number;
  resolved: number;
  failed: number;
  currentSymbol: string;
  currentSource: string;
}

/** Final result returned by runEnrichment. */
export interface EnrichmentResult {
  total: number;
  resolved: number;
  failed: number;
  skippedCacheHit: number;
  bySource: Record<string, number>;
  failures: Array<{ transactionId: number; symbol: string; reason: PriceFailureReason }>;
}

/** Optional callback invoked after each transaction is processed. */
export type ProgressCallback = (progress: EnrichmentProgress) => void;

// ---------------------------------------------------------------------------
// Deps interface (allows DI for testing)
// ---------------------------------------------------------------------------

export interface EnrichmentDeps {
  bitgetClient: {
    fetchClose: (
      symbol: string,
      targetMs: number,
      granularity?: '1min' | '5min'
    ) => Promise<string | null>;
  };
  coingeckoClient: {
    fetchPrice: (coinId: string, utcMs: number) => Promise<string | null>;
    loadSymbolMap: () => Promise<Map<string, string>>;
  };
  cache: {
    lookup: typeof lookupPriceCache;
    upsert: typeof upsertPriceCache;
  };
}

// ---------------------------------------------------------------------------
// Default deps factory (production use)
// ---------------------------------------------------------------------------

export function createDefaultEnrichmentDeps(fetchFn?: typeof globalThis.fetch): EnrichmentDeps {
  return {
    bitgetClient: createBitgetClient(fetchFn),
    coingeckoClient: createCoinGeckoClient(fetchFn),
    cache: {
      lookup: lookupPriceCache,
      upsert: upsertPriceCache,
    },
  };
}

// ---------------------------------------------------------------------------
// runEnrichment
// ---------------------------------------------------------------------------

/**
 * Resolves EUR prices for all unresolved transactions.
 *
 * "Unresolved" = rows where eur_price IS NULL OR price_source = 'manual'.
 * Manual entries are intentionally overwritten on re-run (they are treated as
 * needing fresh resolution). Rows that already have a non-manual eur_price are
 * skipped (incremental behaviour).
 *
 * Processing is sequential to respect rate limits from the throttled clients.
 * Exceptions per transaction are caught and recorded as 'api-error' — the run
 * never throws.
 *
 * @param db         - Drizzle database instance
 * @param deps       - Injected client/cache dependencies
 * @param onProgress - Optional callback called after each transaction
 * @returns          - Aggregated result with counts and failure details
 */
export async function runEnrichment(
  db: Db,
  deps: EnrichmentDeps,
  onProgress?: ProgressCallback
): Promise<EnrichmentResult> {
  const { bitgetClient, coingeckoClient, cache } = deps;

  // -------------------------------------------------------------------------
  // 1. Select unresolved transactions
  // -------------------------------------------------------------------------
  const rows = await db
    .select()
    .from(transactions)
    .where(or(isNull(transactions.eurPrice), eq(transactions.priceSource, 'manual')))
    .orderBy(transactions.tradedAt);

  const total = rows.length;

  if (total === 0) {
    return {
      total: 0,
      resolved: 0,
      failed: 0,
      skippedCacheHit: 0,
      bySource: {},
      failures: [],
    };
  }

  // -------------------------------------------------------------------------
  // 2. Load CoinGecko symbol map once, then apply SYMBOL_OVERRIDES
  // -------------------------------------------------------------------------
  const baseSymbolMap = await coingeckoClient.loadSymbolMap();

  const symbolMap = new Map(baseSymbolMap);
  for (const [sym, coinId] of Object.entries(SYMBOL_OVERRIDES)) {
    symbolMap.set(sym, coinId);
  }

  // -------------------------------------------------------------------------
  // 3. Process each transaction sequentially
  // -------------------------------------------------------------------------
  let resolved = 0;
  let failed = 0;
  const skippedCacheHit = 0;
  const bySource: Record<string, number> = {};
  const failures: Array<{
    transactionId: number;
    symbol: string;
    reason: PriceFailureReason;
  }> = [];

  for (let i = 0; i < rows.length; i++) {
    const tx = rows[i];
    const now = new Date().toISOString();

    let currentSource = '';

    try {
      const outcome = await resolvePrice(
        {
          id: tx.id,
          orderId: tx.orderId,
          sourceType: tx.sourceType,
          symbol: tx.symbol,
          side: tx.side,
          amount: tx.amount,
          price: tx.price,
          tradedAt: tx.tradedAt,
        },
        {
          bitgetClient,
          coingeckoClient,
          symbolMap,
          cache,
          db,
          transactionsTable: transactions,
        }
      );

      if (outcome.ok) {
        const { eurPrice, source } = outcome.result;
        currentSource = source ?? '';

        // UPDATE eur_price, price_source, price_resolved_at; clear failure reason
        await db
          .update(transactions)
          .set({
            eurPrice,
            priceSource: source,
            priceResolvedAt: now,
            priceFailureReason: null,
          })
          .where(eq(transactions.id, tx.id));

        resolved++;

        const sourceKey = source ?? 'unknown';
        bySource[sourceKey] = (bySource[sourceKey] ?? 0) + 1;
      } else {
        const { reason } = outcome.failure;
        currentSource = reason ?? '';

        // UPDATE price_failure_reason; clear eur_price, price_source, price_resolved_at
        await db
          .update(transactions)
          .set({
            eurPrice: null,
            priceSource: null,
            priceResolvedAt: null,
            priceFailureReason: reason,
          })
          .where(eq(transactions.id, tx.id));

        failed++;
        failures.push({ transactionId: tx.id, symbol: tx.symbol, reason });
      }
    } catch {
      // Catch-all: record as api-error, continue with next transaction
      currentSource = 'api-error';

      await db
        .update(transactions)
        .set({
          eurPrice: null,
          priceSource: null,
          priceResolvedAt: null,
          priceFailureReason: 'api-error',
        })
        .where(eq(transactions.id, tx.id));

      failed++;
      failures.push({ transactionId: tx.id, symbol: tx.symbol, reason: 'api-error' });
    }

    // -----------------------------------------------------------------------
    // 4. Emit progress callback
    // -----------------------------------------------------------------------
    if (onProgress) {
      onProgress({
        total,
        processed: i + 1,
        resolved,
        failed,
        currentSymbol: tx.symbol,
        currentSource,
      });
    }
  }

  return {
    total,
    resolved,
    failed,
    skippedCacheHit,
    bySource,
    failures,
  };
}
