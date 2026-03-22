import type { ImportResponse } from '@cryptax/shared';
import { eq } from 'drizzle-orm';
import type { Hono } from 'hono';
import { db } from '../db/client.js';
import { importBatches, transactions } from '../db/schema.js';
import { importCSVFile } from '../import/orchestrator.js';
import { triggerEnrichmentBackground } from './prices.js';

// ---------------------------------------------------------------------------
// registerImportRoutes
// ---------------------------------------------------------------------------

/**
 * Register CSV import routes on the Hono application.
 *
 * Routes:
 *   POST   /api/import/csv           — Upload one or more CSV files
 *   GET    /api/import/batches       — List all import batches
 *   DELETE /api/import/batches/:id   — Delete a batch and all its transactions
 */
export function registerImportRoutes(app: Hono) {
  // -------------------------------------------------------------------------
  // POST /api/import/csv
  // -------------------------------------------------------------------------
  app.post('/api/import/csv', async (c) => {
    try {
      const formData = await c.req.formData();
      const files = formData.getAll('files') as File[];

      if (files.length === 0) {
        return c.json({ error: 'No files provided' }, 400);
      }

      const results = await Promise.all(
        files.map(async (file) => {
          const text = await file.text();
          return importCSVFile(text, file.name);
        })
      );

      const response: ImportResponse = {
        results,
        summary: {
          totalFiles: results.length,
          totalRows: results.reduce(
            (sum: number, r: { totalRows: number }) => sum + r.totalRows,
            0
          ),
          totalImported: results.reduce(
            (sum: number, r: { imported: number }) => sum + r.imported,
            0
          ),
          totalDuplicates: results.reduce(
            (sum: number, r: { duplicatesSkipped: number }) => sum + r.duplicatesSkipped,
            0
          ),
          totalErrors: results.reduce(
            (sum: number, r: { errors: unknown[] }) => sum + r.errors.length,
            0
          ),
        },
      };

      // Fire-and-forget: trigger price enrichment after successful import
      triggerEnrichmentBackground();

      return c.json(response, 200);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      console.error('[import/csv] Error:', message);
      if (err instanceof Error) {
        console.error('[import/csv] Stack:', err.stack);
      }
      return c.json({ error: message }, 500);
    }
  });

  // -------------------------------------------------------------------------
  // GET /api/import/batches
  // -------------------------------------------------------------------------
  app.get('/api/import/batches', (c) => {
    const batches = db.select().from(importBatches).orderBy(importBatches.importedAt).all();
    return c.json(batches);
  });

  // -------------------------------------------------------------------------
  // DELETE /api/import/batches/:id
  // -------------------------------------------------------------------------
  app.delete('/api/import/batches/:id', (c) => {
    const id = Number(c.req.param('id'));

    if (Number.isNaN(id)) {
      return c.json({ error: 'Invalid batch ID' }, 400);
    }

    db.transaction((tx) => {
      // Remove all transactions belonging to this batch
      tx.delete(transactions).where(eq(transactions.batchId, id)).run();
      // Remove the batch record itself
      tx.delete(importBatches).where(eq(importBatches.id, id)).run();
    });

    return c.json({ deleted: true, batchId: id });
  });
}
