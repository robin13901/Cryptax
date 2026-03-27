import type { ExchangeConnection, ExchangeCredentials } from '@cryptax/shared';
import { eq } from 'drizzle-orm';
import type { Hono } from 'hono';
import {
  decryptCredentials,
  encryptCredentials,
  getCredentialMasterKey,
} from '../auth/credential-cipher.js';
import { db } from '../db/client.js';
import { exchangeConnections } from '../db/schema.js';

export function registerExchangeRoutes(app: Hono): void {
  /**
   * GET /api/exchanges
   * Returns all exchange connections. Never includes encrypted_credentials.
   */
  app.get('/api/exchanges', (c) => {
    const rows = db
      .select({
        id: exchangeConnections.id,
        exchange: exchangeConnections.exchange,
        label: exchangeConnections.label,
        lastSyncAt: exchangeConnections.lastSyncAt,
        createdAt: exchangeConnections.createdAt,
      })
      .from(exchangeConnections)
      .all();

    return c.json(rows satisfies ExchangeConnection[]);
  });

  /**
   * POST /api/exchanges
   * Body: { exchange: string, label: string, credentials: ExchangeCredentials }
   * Creates a new exchange connection with encrypted credentials.
   * Returns 201 with ExchangeConnection (no credentials).
   */
  app.post('/api/exchanges', async (c) => {
    const body = await c.req.json<{
      exchange?: string;
      label?: string;
      credentials?: Partial<ExchangeCredentials>;
    }>();

    // Validate exchange
    if (body.exchange !== 'bitget') {
      return c.json({ error: 'Unsupported exchange. Only "bitget" is supported.' }, 400);
    }

    // Validate label
    if (typeof body.label !== 'string' || body.label.trim() === '') {
      return c.json({ error: 'label must be a non-empty string' }, 400);
    }

    // Validate credentials
    const creds = body.credentials;
    if (
      !creds ||
      typeof creds.apiKey !== 'string' ||
      creds.apiKey.trim() === '' ||
      typeof creds.secret !== 'string' ||
      creds.secret.trim() === '' ||
      typeof creds.password !== 'string' ||
      creds.password.trim() === ''
    ) {
      return c.json(
        { error: 'credentials must include non-empty apiKey, secret, and password' },
        400
      );
    }

    // Encrypt credentials
    const masterKey = getCredentialMasterKey();
    const encryptedCredentials = encryptCredentials(
      JSON.stringify({
        apiKey: creds.apiKey,
        secret: creds.secret,
        password: creds.password,
      }),
      masterKey
    );

    const now = new Date().toISOString();
    const inserted = db
      .insert(exchangeConnections)
      .values({
        exchange: body.exchange,
        label: body.label.trim(),
        encryptedCredentials,
        createdAt: now,
      })
      .returning({
        id: exchangeConnections.id,
        exchange: exchangeConnections.exchange,
        label: exchangeConnections.label,
        lastSyncAt: exchangeConnections.lastSyncAt,
        createdAt: exchangeConnections.createdAt,
      })
      .get();

    if (!inserted) {
      return c.json({ error: 'Failed to create exchange connection' }, 500);
    }

    return c.json(inserted satisfies ExchangeConnection, 201);
  });

  /**
   * DELETE /api/exchanges/:id
   * Removes the exchange connection. Does NOT delete any imported transactions.
   */
  app.delete('/api/exchanges/:id', (c) => {
    const rawId = Number(c.req.param('id'));
    if (!Number.isInteger(rawId) || rawId <= 0) {
      return c.json({ error: 'Invalid id' }, 400);
    }

    const existing = db
      .select({ id: exchangeConnections.id })
      .from(exchangeConnections)
      .where(eq(exchangeConnections.id, rawId))
      .get();

    if (!existing) {
      return c.json({ error: 'Exchange connection not found' }, 404);
    }

    db.delete(exchangeConnections).where(eq(exchangeConnections.id, rawId)).run();

    return c.json({ deleted: true });
  });

  /**
   * POST /api/exchanges/:id/test
   * Decrypts credentials and validates against the exchange API.
   * Currently stubbed — ccxt not yet integrated.
   */
  app.post('/api/exchanges/:id/test', (c) => {
    const rawId = Number(c.req.param('id'));
    if (!Number.isInteger(rawId) || rawId <= 0) {
      return c.json({ error: 'Invalid id' }, 400);
    }

    const row = db
      .select({
        id: exchangeConnections.id,
        exchange: exchangeConnections.exchange,
        encryptedCredentials: exchangeConnections.encryptedCredentials,
      })
      .from(exchangeConnections)
      .where(eq(exchangeConnections.id, rawId))
      .get();

    if (!row) {
      return c.json({ error: 'Exchange connection not found' }, 404);
    }

    // Verify we can decrypt (validates master key is present + credentials are well-formed)
    try {
      const masterKey = getCredentialMasterKey();
      decryptCredentials(row.encryptedCredentials, masterKey);
    } catch (err) {
      return c.json(
        { success: false, error: `Credential decryption failed: ${(err as Error).message}` },
        500
      );
    }

    // ccxt not yet installed — stub response
    return c.json({ success: false, error: 'ccxt not yet installed' });
  });
}
