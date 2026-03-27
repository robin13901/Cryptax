import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as schema from '../db/schema.js';

// ---------------------------------------------------------------------------
// DB mock (same pattern as insert / orchestrator tests)
// ---------------------------------------------------------------------------

let mockDb: ReturnType<typeof drizzle<typeof schema>>;

vi.mock('../db/client.js', () => ({
  get db() {
    return mockDb;
  },
  get sqlite() {
    return undefined;
  },
}));

function applyMigrations(sqlite: ReturnType<typeof Database>) {
  const migrationsDir = path.resolve(process.cwd(), 'packages/backend/drizzle');
  for (const file of [
    '0000_initial.sql',
    '0001_import_batches.sql',
    '0002_eur_price_columns.sql',
  ]) {
    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
    const statements = sql
      .split('--> statement-breakpoint')
      .map((s) => s.trim())
      .filter(Boolean);
    for (const stmt of statements) {
      sqlite.exec(stmt);
    }
  }
}

import { registerImportRoutes } from './import.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const SPOT_TX_CSV = [
  'order;Date;Coin;Type;Amount;Fee;Available',
  '2001;2024-04-01 10:00:00;BTC;Buy;0.2;0.001;10',
  '2002;2024-04-02 11:00:00;ETH;Sell;-1.0;0;5',
].join('\n');

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('POST /api/import/csv', () => {
  let app: Hono;
  let sqlite: ReturnType<typeof Database>;

  beforeEach(() => {
    sqlite = new Database(':memory:');
    sqlite.pragma('journal_mode = WAL');
    sqlite.pragma('foreign_keys = ON');
    applyMigrations(sqlite);
    mockDb = drizzle(sqlite, { schema });

    app = new Hono();
    registerImportRoutes(app);
  });

  afterEach(() => {
    sqlite.close();
  });

  it('returns 200 with correct summary for a valid CSV upload', async () => {
    const formData = new FormData();
    formData.append('files', new File([SPOT_TX_CSV], 'spot-2024.csv', { type: 'text/csv' }));

    const res = await app.request('/api/import/csv', {
      method: 'POST',
      body: formData,
    });

    expect(res.status).toBe(200);

    const body = (await res.json()) as {
      results: unknown[];
      summary: {
        totalFiles: number;
        totalImported: number;
        totalDuplicates: number;
        totalErrors: number;
      };
    };

    expect(body.summary.totalFiles).toBe(1);
    expect(body.summary.totalImported).toBe(2);
    expect(body.summary.totalDuplicates).toBe(0);
    expect(body.summary.totalErrors).toBe(0);
    expect(body.results).toHaveLength(1);
  });

  it('returns 400 when no files are provided', async () => {
    const formData = new FormData();

    const res = await app.request('/api/import/csv', {
      method: 'POST',
      body: formData,
    });

    expect(res.status).toBe(400);
  });

  it('handles multi-file upload in one request', async () => {
    const formData = new FormData();
    formData.append('files', new File([SPOT_TX_CSV], 'file1.csv', { type: 'text/csv' }));
    formData.append('files', new File([SPOT_TX_CSV], 'file2.csv', { type: 'text/csv' }));

    const res = await app.request('/api/import/csv', {
      method: 'POST',
      body: formData,
    });

    expect(res.status).toBe(200);

    const body = (await res.json()) as {
      summary: { totalFiles: number; totalImported: number; totalDuplicates: number };
    };

    expect(body.summary.totalFiles).toBe(2);
    // First file inserts 2, second file's rows are duplicates
    expect(body.summary.totalImported).toBe(2);
    expect(body.summary.totalDuplicates).toBe(2);
  });
});

describe('GET /api/import/batches', () => {
  let app: Hono;
  let sqlite: ReturnType<typeof Database>;

  beforeEach(() => {
    sqlite = new Database(':memory:');
    sqlite.pragma('journal_mode = WAL');
    sqlite.pragma('foreign_keys = ON');
    applyMigrations(sqlite);
    mockDb = drizzle(sqlite, { schema });

    app = new Hono();
    registerImportRoutes(app);
  });

  afterEach(() => {
    sqlite.close();
  });

  it('returns empty array when no batches exist', async () => {
    const res = await app.request('/api/import/batches');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body).toHaveLength(0);
  });

  it('returns batches after import', async () => {
    // Create a batch via import
    const formData = new FormData();
    formData.append('files', new File([SPOT_TX_CSV], 'test.csv', { type: 'text/csv' }));
    await app.request('/api/import/csv', { method: 'POST', body: formData });

    const res = await app.request('/api/import/batches');
    expect(res.status).toBe(200);
    const body = (await res.json()) as unknown[];
    expect(body).toHaveLength(1);
  });
});

describe('DELETE /api/import/batches/:id', () => {
  let app: Hono;
  let sqlite: ReturnType<typeof Database>;

  beforeEach(() => {
    sqlite = new Database(':memory:');
    sqlite.pragma('journal_mode = WAL');
    sqlite.pragma('foreign_keys = ON');
    applyMigrations(sqlite);
    mockDb = drizzle(sqlite, { schema });

    app = new Hono();
    registerImportRoutes(app);
  });

  afterEach(() => {
    sqlite.close();
  });

  it('deletes a batch and its transactions', async () => {
    // First import some data
    const formData = new FormData();
    formData.append('files', new File([SPOT_TX_CSV], 'del-test.csv', { type: 'text/csv' }));
    const importRes = await app.request('/api/import/csv', {
      method: 'POST',
      body: formData,
    });
    const importBody = (await importRes.json()) as {
      results: Array<{ batchId: number }>;
    };
    const batchId = importBody.results[0].batchId;

    // Verify transactions exist
    const txBefore = sqlite
      .prepare('SELECT COUNT(*) as cnt FROM transactions WHERE batch_id = ?')
      .get(batchId) as { cnt: number };
    expect(txBefore.cnt).toBe(2);

    // Delete the batch
    const deleteRes = await app.request(`/api/import/batches/${batchId}`, { method: 'DELETE' });
    expect(deleteRes.status).toBe(200);
    const deleteBody = (await deleteRes.json()) as {
      deleted: boolean;
      batchId: number;
    };
    expect(deleteBody.deleted).toBe(true);
    expect(deleteBody.batchId).toBe(batchId);

    // Verify transactions are gone
    const txAfter = sqlite
      .prepare('SELECT COUNT(*) as cnt FROM transactions WHERE batch_id = ?')
      .get(batchId) as { cnt: number };
    expect(txAfter.cnt).toBe(0);

    // Verify batch is gone
    const batchAfter = sqlite
      .prepare('SELECT COUNT(*) as cnt FROM import_batches WHERE id = ?')
      .get(batchId) as { cnt: number };
    expect(batchAfter.cnt).toBe(0);
  });

  it('returns 400 for non-numeric batch ID', async () => {
    const res = await app.request('/api/import/batches/abc', {
      method: 'DELETE',
    });
    expect(res.status).toBe(400);
  });
});
