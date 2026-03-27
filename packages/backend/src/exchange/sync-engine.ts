import type { SyncResult } from '@cryptax/shared';
import { eq } from 'drizzle-orm';
import { decryptCredentials, getCredentialMasterKey } from '../auth/credential-cipher.js';
import { db } from '../db/client.js';
import { exchangeConnections, importBatches } from '../db/schema.js';
import { batchInsert } from '../import/insert.js';
import { BitgetAdapter } from './bitget-adapter.js';
import { normalizeApiTrade } from './normalize-api-trade.js';

// ---------------------------------------------------------------------------
// syncExchange
// ---------------------------------------------------------------------------

/**
 * Full exchange sync orchestration:
 *
 *  1. Load exchange connection from DB
 *  2. Decrypt credentials using the credential master key
 *  3. Create a BitgetAdapter with the decrypted credentials
 *  4. Fetch spot and futures trades independently (Promise.allSettled for partial failure)
 *  5. Normalize ccxt Trade[] → transactions.$inferInsert[] for each side
 *  6. Create import_batch records and call batchInsert for deduplication
 *  7. Update exchange_connections.last_sync_at watermark
 *  8. Return SyncResult with counts and any warnings
 *
 * Partial failure: if spot succeeds but futures fails (or vice versa),
 * the successful side is imported and a warning is added for the failed side.
 *
 * @param connectionId The exchange_connections.id to sync
 * @returns            SyncResult with imported/duplicate counts and warnings
 */
export async function syncExchange(connectionId: number): Promise<SyncResult> {
  const now = new Date().toISOString();

  // -------------------------------------------------------------------------
  // 1. Load connection
  // -------------------------------------------------------------------------
  const connection = db
    .select()
    .from(exchangeConnections)
    .where(eq(exchangeConnections.id, connectionId))
    .get();

  if (!connection) {
    throw new Error(`Exchange connection ${connectionId} not found`);
  }

  // -------------------------------------------------------------------------
  // 2. Decrypt credentials
  // -------------------------------------------------------------------------
  const masterKey = getCredentialMasterKey();
  const credentialsJson = decryptCredentials(connection.encryptedCredentials, masterKey);
  const credentials = JSON.parse(credentialsJson) as {
    apiKey: string;
    secret: string;
    password: string;
  };

  // -------------------------------------------------------------------------
  // 3. Create adapter
  // -------------------------------------------------------------------------
  const adapter = new BitgetAdapter(credentials);

  // -------------------------------------------------------------------------
  // 4. Determine incremental since timestamp from last watermark
  // -------------------------------------------------------------------------
  const since = connection.lastSyncAt ? new Date(connection.lastSyncAt).getTime() : undefined;

  // -------------------------------------------------------------------------
  // 5. Fetch spot + futures independently (partial failure allowed)
  // -------------------------------------------------------------------------
  const [spotResult, futuresResult] = await Promise.allSettled([
    adapter.fetchSpotTrades(since),
    adapter.fetchFuturesTrades(since),
  ]);

  const warnings: string[] = [];

  // -------------------------------------------------------------------------
  // 6. Process spot trades
  // -------------------------------------------------------------------------
  let spotStats = { imported: 0, duplicates: 0, errors: 0 };

  if (spotResult.status === 'fulfilled') {
    const spotTrades = spotResult.value;
    if (spotTrades.length > 0) {
      const spotRows = spotTrades.map((t) => normalizeApiTrade(t, 'spot_tx'));

      // Create import_batch record for traceability
      const spotBatch = db
        .insert(importBatches)
        .values({
          filename: `api:bitget:spot:${now}`,
          sourceType: 'spot_tx',
          totalRows: spotTrades.length,
          importedCount: 0,
          duplicatesCount: 0,
          errorsCount: 0,
          importedAt: now,
        })
        .returning({ id: importBatches.id })
        .get();

      if (spotBatch) {
        const result = batchInsert(spotRows, spotBatch.id);

        // Update batch record with actual counts
        db.update(importBatches)
          .set({
            importedCount: result.inserted,
            duplicatesCount: result.duplicates,
          })
          .where(eq(importBatches.id, spotBatch.id))
          .run();

        spotStats = { imported: result.inserted, duplicates: result.duplicates, errors: 0 };
      }
    }
  } else {
    const errMsg =
      spotResult.reason instanceof Error ? spotResult.reason.message : String(spotResult.reason);
    warnings.push(`Spot trade fetch failed: ${errMsg}`);
    spotStats = { imported: 0, duplicates: 0, errors: 1 };
  }

  // -------------------------------------------------------------------------
  // 7. Process futures trades
  // -------------------------------------------------------------------------
  let futuresStats = { imported: 0, duplicates: 0, errors: 0 };

  if (futuresResult.status === 'fulfilled') {
    const futuresTrades = futuresResult.value;
    if (futuresTrades.length > 0) {
      const futuresRows = futuresTrades.map((t) => normalizeApiTrade(t, 'futures_tx'));

      // Create import_batch record for traceability
      const futuresBatch = db
        .insert(importBatches)
        .values({
          filename: `api:bitget:futures:${now}`,
          sourceType: 'futures_tx',
          totalRows: futuresTrades.length,
          importedCount: 0,
          duplicatesCount: 0,
          errorsCount: 0,
          importedAt: now,
        })
        .returning({ id: importBatches.id })
        .get();

      if (futuresBatch) {
        const result = batchInsert(futuresRows, futuresBatch.id);

        // Update batch record with actual counts
        db.update(importBatches)
          .set({
            importedCount: result.inserted,
            duplicatesCount: result.duplicates,
          })
          .where(eq(importBatches.id, futuresBatch.id))
          .run();

        futuresStats = { imported: result.inserted, duplicates: result.duplicates, errors: 0 };
      }
    }
  } else {
    const errMsg =
      futuresResult.reason instanceof Error
        ? futuresResult.reason.message
        : String(futuresResult.reason);
    warnings.push(`Futures trade fetch failed: ${errMsg}`);
    futuresStats = { imported: 0, duplicates: 0, errors: 1 };
  }

  // -------------------------------------------------------------------------
  // 8. Update watermark (only if at least one side succeeded)
  // -------------------------------------------------------------------------
  const atLeastOneSuccess =
    spotResult.status === 'fulfilled' || futuresResult.status === 'fulfilled';

  if (atLeastOneSuccess) {
    db.update(exchangeConnections)
      .set({ lastSyncAt: now })
      .where(eq(exchangeConnections.id, connectionId))
      .run();
  }

  // -------------------------------------------------------------------------
  // 9. Return result
  // -------------------------------------------------------------------------
  return {
    connectionId,
    exchange: connection.exchange,
    spotTrades: spotStats,
    futuresTrades: futuresStats,
    totalImported: spotStats.imported + futuresStats.imported,
    totalDuplicates: spotStats.duplicates + futuresStats.duplicates,
    syncedAt: now,
    warnings,
  };
}
