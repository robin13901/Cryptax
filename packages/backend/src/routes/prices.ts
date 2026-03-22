import type { EnrichmentResponse, ManualPriceEntry, PriceStatusResponse } from '@cryptax/shared';
import { toDecimal } from '@cryptax/shared';
import { count, eq, isNotNull, isNull } from 'drizzle-orm';
import type { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { db } from '../db/client.js';
import { transactions } from '../db/schema.js';
import { createDefaultEnrichmentDeps, runEnrichment } from '../prices/enrichment-engine.js';

// ---------------------------------------------------------------------------
// Concurrent-run guard
// ---------------------------------------------------------------------------

let isRunning = false;

// ---------------------------------------------------------------------------
// registerPriceRoutes
// ---------------------------------------------------------------------------

/**
 * Register EUR price enrichment routes on the Hono application.
 *
 * Routes:
 *   GET   /api/prices/status          — Current resolution status
 *   POST  /api/prices/enrich          — Trigger enrichment (fire and wait)
 *   GET   /api/prices/enrich/progress — Trigger enrichment with SSE progress stream
 *   PATCH /api/prices/manual          — Set EUR price manually for a transaction
 */
export function registerPriceRoutes(app: Hono) {
  // -------------------------------------------------------------------------
  // GET /api/prices/status
  // -------------------------------------------------------------------------
  app.get('/api/prices/status', (c) => {
    // Total count
    const [{ value: total }] = db.select({ value: count() }).from(transactions).all() as [
      { value: number },
    ];

    // Resolved count (eur_price IS NOT NULL)
    const [{ value: resolved }] = db
      .select({ value: count() })
      .from(transactions)
      .where(isNotNull(transactions.eurPrice))
      .all() as [{ value: number }];

    const unresolved = total - resolved;

    // bySource: group resolved rows by price_source
    const sourceRows = db
      .select({ source: transactions.priceSource, cnt: count() })
      .from(transactions)
      .where(isNotNull(transactions.eurPrice))
      .groupBy(transactions.priceSource)
      .all() as Array<{ source: string | null; cnt: number }>;

    const bySource: Record<string, number> = {};
    for (const row of sourceRows) {
      const key = row.source ?? 'unknown';
      bySource[key] = row.cnt;
    }

    // failureBreakdown: group unresolved rows by price_failure_reason
    const failureRows = db
      .select({ reason: transactions.priceFailureReason, cnt: count() })
      .from(transactions)
      .where(isNull(transactions.eurPrice))
      .groupBy(transactions.priceFailureReason)
      .all() as Array<{ reason: string | null; cnt: number }>;

    const failureBreakdown: Record<string, number> = {};
    for (const row of failureRows) {
      const key = row.reason ?? 'unknown';
      failureBreakdown[key] = row.cnt;
    }

    // Unresolved transaction list
    const unresolvedRows = db
      .select({
        id: transactions.id,
        symbol: transactions.symbol,
        tradedAt: transactions.tradedAt,
        failureReason: transactions.priceFailureReason,
      })
      .from(transactions)
      .where(isNull(transactions.eurPrice))
      .orderBy(transactions.tradedAt)
      .limit(100)
      .all();

    const response: PriceStatusResponse = {
      total,
      resolved,
      unresolved,
      isEnriching: isRunning,
      bySource,
      failureBreakdown,
      unresolvedTransactions: unresolvedRows.map((r) => ({
        id: r.id,
        symbol: r.symbol,
        tradedAt: r.tradedAt,
        failureReason: r.failureReason,
      })),
    };

    return c.json(response);
  });

  // -------------------------------------------------------------------------
  // POST /api/prices/enrich
  // -------------------------------------------------------------------------
  app.post('/api/prices/enrich', async (c) => {
    if (isRunning) {
      return c.json({ error: 'Enrichment already in progress' }, 409);
    }

    isRunning = true;
    try {
      const deps = createDefaultEnrichmentDeps();
      const result = await runEnrichment(db, deps);

      const response: EnrichmentResponse = {
        total: result.total,
        resolved: result.resolved,
        failed: result.failed,
        bySource: result.bySource,
        failures: result.failures.map((f) => ({
          transactionId: f.transactionId,
          symbol: f.symbol,
          reason: f.reason ?? 'unknown',
        })),
      };

      return c.json(response, 200);
    } finally {
      isRunning = false;
    }
  });

  // -------------------------------------------------------------------------
  // GET /api/prices/enrich/progress  (SSE)
  // -------------------------------------------------------------------------
  app.get('/api/prices/enrich/progress', (c) => {
    if (isRunning) {
      return c.json({ error: 'Enrichment already in progress' }, 409);
    }

    return streamSSE(c, async (stream) => {
      isRunning = true;
      try {
        const deps = createDefaultEnrichmentDeps();

        const result = await runEnrichment(db, deps, async (progress) => {
          await stream.writeSSE({
            event: 'progress',
            data: JSON.stringify(progress),
          });
        });

        await stream.writeSSE({
          event: 'complete',
          data: JSON.stringify({
            total: result.total,
            resolved: result.resolved,
            failed: result.failed,
            bySource: result.bySource,
            failures: result.failures.map((f) => ({
              transactionId: f.transactionId,
              symbol: f.symbol,
              reason: f.reason ?? 'unknown',
            })),
          }),
        });
      } catch (err) {
        await stream.writeSSE({
          event: 'error',
          data: JSON.stringify({
            error: err instanceof Error ? err.message : 'Unknown error',
          }),
        });
      } finally {
        isRunning = false;
      }
    });
  });

  // -------------------------------------------------------------------------
  // PATCH /api/prices/manual
  // -------------------------------------------------------------------------
  app.patch('/api/prices/manual', async (c) => {
    let body: ManualPriceEntry;
    try {
      body = (await c.req.json()) as ManualPriceEntry;
    } catch {
      return c.json({ error: 'Invalid JSON body' }, 400);
    }

    const { transactionId, eurPrice } = body;

    // Validate transactionId
    if (typeof transactionId !== 'number' || !Number.isInteger(transactionId)) {
      return c.json({ error: 'transactionId must be an integer' }, 400);
    }

    // Validate eurPrice is a valid positive Decimal
    let priceDecimal: ReturnType<typeof toDecimal>;
    try {
      priceDecimal = toDecimal(eurPrice);
    } catch {
      return c.json({ error: 'eurPrice is not a valid decimal number' }, 400);
    }

    if (priceDecimal.isNegative() || priceDecimal.isZero()) {
      return c.json({ error: 'eurPrice must be positive' }, 400);
    }

    // Fetch the transaction
    const rows = db.select().from(transactions).where(eq(transactions.id, transactionId)).all();

    if (rows.length === 0) {
      return c.json({ error: `Transaction ${transactionId} not found` }, 404);
    }

    const tx = rows[0];

    // Already resolved by a non-manual source → reject
    if (tx.eurPrice !== null && tx.priceSource !== null && tx.priceSource !== 'manual') {
      return c.json(
        {
          error: `Transaction ${transactionId} is already resolved by source '${tx.priceSource}'`,
        },
        400
      );
    }

    // Apply manual price
    const now = new Date().toISOString();
    db.update(transactions)
      .set({
        eurPrice: priceDecimal.toFixed(),
        priceSource: 'manual',
        priceResolvedAt: now,
        priceFailureReason: null,
      })
      .where(eq(transactions.id, transactionId))
      .run();

    return c.json({
      transactionId,
      eurPrice: priceDecimal.toFixed(),
      priceSource: 'manual',
      priceResolvedAt: now,
    });
  });
}

// ---------------------------------------------------------------------------
// Helper used by import route (fire-and-forget auto-trigger)
// ---------------------------------------------------------------------------

/**
 * Triggers enrichment in the background after a CSV import.
 * Guards against concurrent runs and swallows all errors silently.
 */
export function triggerEnrichmentBackground(): void {
  if (isRunning) return;
  isRunning = true;
  const deps = createDefaultEnrichmentDeps();
  runEnrichment(db, deps)
    .catch((err) => console.error('[enrichment] background run failed:', err))
    .finally(() => {
      isRunning = false;
    });
}
