import type { EngineRunResponse } from '@cryptax/shared';
import type { Hono } from 'hono';
import { db } from '../db/client.js';
import { checkNullPrices } from '../engine/null-price-gate.js';
import { runTaxCalculation } from '../engine/tax-calculator.js';

// ---------------------------------------------------------------------------
// Concurrent-run guard
// ---------------------------------------------------------------------------

let isRunning = false;

// ---------------------------------------------------------------------------
// registerEngineRoutes
// ---------------------------------------------------------------------------

/**
 * Register tax engine routes on the Hono application.
 *
 * Routes:
 *   POST  /api/engine/run     — Trigger full tax calculation pipeline
 *   GET   /api/engine/status  — Return current engine run status
 */
export function registerEngineRoutes(app: Hono) {
  // -------------------------------------------------------------------------
  // GET /api/engine/status
  // -------------------------------------------------------------------------
  app.get('/api/engine/status', (c) => {
    return c.json({ isRunning });
  });

  // -------------------------------------------------------------------------
  // POST /api/engine/run
  // -------------------------------------------------------------------------
  app.post('/api/engine/run', async (c) => {
    if (isRunning) {
      return c.json({ error: 'Engine already running' }, 409);
    }

    isRunning = true;
    try {
      // Pre-flight: check for NULL prices before running the full engine
      // This gives us structured error data for the 422 response.
      const nullErrors = checkNullPrices(db);
      if (nullErrors.length > 0) {
        const response: EngineRunResponse = {
          success: false,
          summaries: [],
          fifo: { lotsCreated: 0, consumptions: 0, sellsWithoutLots: 0 },
          futures: { positionsRecorded: 0 },
          earn: { incomeRecorded: 0, lotsCreated: 0 },
          errors: nullErrors.map((e) => ({
            transactionId: e.transactionId,
            reason: `Missing EUR price — run price enrichment first (symbol: ${e.symbol}, tradedAt: ${e.tradedAt})`,
          })),
          nullPriceErrors: nullErrors,
          computedAt: new Date().toISOString(),
        };
        return c.json(response, 422);
      }

      // runTaxCalculation is synchronous but we await to allow async mocks
      // in tests and to keep consistent patterns with the price enrichment route.
      const result = await Promise.resolve(runTaxCalculation(db));

      const response: EngineRunResponse = {
        success: true,
        summaries: result.summaries,
        fifo: {
          lotsCreated: result.fifo.lots.length,
          consumptions: result.fifo.consumptions.length,
          sellsWithoutLots: result.fifo.sellsWithoutLots.length,
        },
        futures: {
          positionsRecorded: result.futures.positions.length,
        },
        earn: {
          incomeRecorded: result.earn.incomeRecords.length,
          lotsCreated: result.earn.lotsCreated.length,
        },
        errors: result.errors,
        computedAt: new Date().toISOString(),
      };

      return c.json(response, 200);
    } finally {
      isRunning = false;
    }
  });
}
