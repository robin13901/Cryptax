import { eq } from 'drizzle-orm';
import type { Hono } from 'hono';
import type { SyncResult } from '@cryptax/shared';
import { db } from '../db/client.js';
import { exchangeConnections } from '../db/schema.js';
import { syncExchange } from '../exchange/sync-engine.js';

// ---------------------------------------------------------------------------
// Error message sanitizer
// Strips tokens that are >20 chars and alphanumeric-only (API keys, secrets, etc.)
// ---------------------------------------------------------------------------
function sanitizeErrorMessage(msg: string): string {
  return msg.replace(/[A-Za-z0-9]{21,}/g, '[redacted]');
}

export function registerSyncRoutes(app: Hono): void {
  /**
   * POST /api/exchanges/:id/sync
   * Triggers a sync for a single exchange connection.
   * Returns SyncResult on success, 404 if not found, 500 on failure.
   */
  app.post('/api/exchanges/:id/sync', async (c) => {
    const rawId = Number(c.req.param('id'));
    if (!Number.isInteger(rawId) || rawId <= 0) {
      return c.json({ error: 'Invalid id' }, 400);
    }

    // Verify connection exists before calling syncExchange
    const existing = db
      .select({ id: exchangeConnections.id })
      .from(exchangeConnections)
      .where(eq(exchangeConnections.id, rawId))
      .get();

    if (!existing) {
      return c.json({ error: 'Exchange connection not found' }, 404);
    }

    try {
      const result = await syncExchange(rawId);
      return c.json(result satisfies SyncResult);
    } catch (err) {
      const rawMsg = err instanceof Error ? err.message : String(err);
      const safeMsg = sanitizeErrorMessage(rawMsg);
      return c.json({ error: `Sync failed: ${safeMsg}` }, 500);
    }
  });

  /**
   * POST /api/exchanges/sync-all
   * Triggers sync for all exchange connections sequentially.
   * Returns aggregated SyncResult array with totalImported and totalDuplicates.
   */
  app.post('/api/exchanges/sync-all', async (c) => {
    const allConnections = db
      .select({ id: exchangeConnections.id })
      .from(exchangeConnections)
      .all();

    const results: SyncResult[] = [];

    for (const conn of allConnections) {
      try {
        const result = await syncExchange(conn.id);
        results.push(result);
      } catch (err) {
        const rawMsg = err instanceof Error ? err.message : String(err);
        const safeMsg = sanitizeErrorMessage(rawMsg);
        // Push a failed result shape so the caller sees which connection failed
        results.push({
          connectionId: conn.id,
          exchange: 'unknown',
          spotTrades: { imported: 0, duplicates: 0, errors: 1 },
          futuresTrades: { imported: 0, duplicates: 0, errors: 1 },
          totalImported: 0,
          totalDuplicates: 0,
          syncedAt: new Date().toISOString(),
          warnings: [`Sync failed: ${safeMsg}`],
        });
      }
    }

    const totalImported = results.reduce((sum, r) => sum + r.totalImported, 0);
    const totalDuplicates = results.reduce((sum, r) => sum + r.totalDuplicates, 0);

    return c.json({ results, totalImported, totalDuplicates });
  });
}
