/**
 * Route tests for /api/report/* endpoints.
 *
 * Pattern: in-memory SQLite + Drizzle (same as summary.test.ts).
 * Uses vi.mock('../db/client.js') + vi.hoisted to inject the test DB into
 * ReportGenerator, avoiding TDZ issues with the module-level singleton.
 */

import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as schema from '../db/schema.js';
import {
  earnIncome,
  fifoLots,
  futuresPositions,
  lotConsumptions,
  taxSummaries,
  transactions,
} from '../db/schema.js';

// ---------------------------------------------------------------------------
// DB mock — injects in-memory DB into all modules that import '../db/client.js'
// vi.hoisted ensures mockDbRef is initialized before the mock factory runs,
// avoiding temporal dead zone when report-generator.ts creates its singleton.
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const { mockDbRef } = vi.hoisted(() => ({ mockDbRef: { current: null as any } }));

vi.mock('../db/client.js', () => ({
  get db() {
    return mockDbRef.current;
  },
  get sqlite() {
    return undefined;
  },
}));

// ---------------------------------------------------------------------------
// Migration helper
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Import route registrar AFTER mocks are set up
// ---------------------------------------------------------------------------

import { registerReportRoutes } from './report.js';

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

function makeTxInsert(
  overrides: Partial<typeof transactions.$inferInsert> = {}
): typeof transactions.$inferInsert {
  return {
    exchange: 'bitget',
    sourceType: 'spot_tx',
    canonicalType: 'sell',
    symbol: 'BTC',
    side: 'sell',
    amount: '0.1',
    price: '50000',
    fee: '0',
    totalValue: '5000',
    tradedAt: '2024-06-01T12:00:00.000Z',
    taxYear: 2024,
    checksum: 'chk-sell-001',
    importedAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeSummaryInsert(
  overrides: Partial<typeof taxSummaries.$inferInsert> = {}
): typeof taxSummaries.$inferInsert {
  return {
    taxYear: 2024,
    bucket: 'private_sale',
    totalGainsEur: '2000',
    totalLossesEur: '-500',
    netEur: '1500',
    taxableAmountEur: '1500',
    estimatedTaxEur: '0',
    tradeCount: 5,
    computedAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeLotInsert(
  overrides: Partial<typeof fifoLots.$inferInsert> = {}
): typeof fifoLots.$inferInsert {
  return {
    symbol: 'BTC',
    originalAmount: '0.1',
    remainingAmount: '0',
    costBasisEur: '3000',
    costPerUnitEur: '30000',
    feeEur: '0',
    acquiredAt: '2024-01-01T00:00:00.000Z',
    taxYear: 2024,
    ...overrides,
  };
}

/**
 * Seed minimal but complete data for one tax year.
 * Inserts one row into all required tables for the given year.
 */
function seedTestData(year: number, checksum = 'chk-001'): void {
  const db = mockDbRef.current;

  // tax_summaries — required for ReportGenerator to return non-null
  db.insert(taxSummaries)
    .values([
      makeSummaryInsert({ taxYear: year, bucket: 'private_sale' }),
      makeSummaryInsert({ taxYear: year, bucket: 'futures_pnl', netEur: '500', tradeCount: 2 }),
      makeSummaryInsert({ taxYear: year, bucket: 'staking_earn', netEur: '100', tradeCount: 1 }),
    ])
    .run();

  // sell transaction
  const [sellTx] = db
    .insert(transactions)
    .values(
      makeTxInsert({
        taxYear: year,
        tradedAt: `${year}-06-01T12:00:00.000Z`,
        checksum,
      })
    )
    .returning()
    .all();

  // buy transaction (for fifo_lot acquisition)
  const [buyTx] = db
    .insert(transactions)
    .values(
      makeTxInsert({
        taxYear: year - 1,
        canonicalType: 'buy',
        tradedAt: `${year - 1}-01-01T00:00:00.000Z`,
        checksum: `${checksum}-buy`,
      })
    )
    .returning()
    .all();

  // fifo_lot
  const [lot] = db
    .insert(fifoLots)
    .values(
      makeLotInsert({
        taxYear: year,
        acquiredAt: `${year - 1}-01-01T00:00:00.000Z`,
        transactionId: buyTx.id,
      })
    )
    .returning()
    .all();

  // lot_consumption
  db.insert(lotConsumptions)
    .values({
      lotId: lot.id,
      sellTransactionId: sellTx.id,
      amountConsumed: '0.1',
      costBasisEur: '3000',
      proceedsEur: '5000',
      gainLossEur: '2000',
      feeEur: '0',
      heldDays: 517,
      haltefristMet: false,
      taxYear: year,
    })
    .run();

  // futures_position
  db.insert(futuresPositions)
    .values({
      symbol: 'BTCUSDT',
      realizedPnlEur: '500',
      feeEur: '10',
      transactionId: sellTx.id,
      taxYear: year,
    })
    .run();

  // earn_income
  db.insert(earnIncome)
    .values({
      symbol: 'ETH',
      amount: '0.05',
      eurValueAtReceipt: '100',
      receivedAt: `${year}-03-01T00:00:00.000Z`,
      transactionId: sellTx.id,
      taxYear: year,
    })
    .run();
}

// ---------------------------------------------------------------------------
// Shared app setup
// ---------------------------------------------------------------------------

let app: Hono;
let sqlite: ReturnType<typeof Database>;

function setupApp() {
  sqlite = new Database(':memory:');
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  applyMigrations(sqlite);
  mockDbRef.current = drizzle(sqlite, { schema });

  app = new Hono();
  registerReportRoutes(app);
}

// ===========================================================================
// GET /api/report/years
// ===========================================================================

describe('GET /api/report/years', () => {
  beforeEach(setupApp);
  afterEach(() => sqlite.close());

  it('returns empty array when no tax_summaries exist', async () => {
    const res = await app.request('/api/report/years');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { years: number[] };
    expect(body.years).toEqual([]);
  });

  it('returns years from tax_summaries', async () => {
    mockDbRef.current
      .insert(taxSummaries)
      .values([
        makeSummaryInsert({ taxYear: 2024 }),
        makeSummaryInsert({ taxYear: 2025, bucket: 'futures_pnl' }),
      ])
      .run();

    const res = await app.request('/api/report/years');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { years: number[] };
    expect(body.years).toContain(2024);
    expect(body.years).toContain(2025);
  });

  it('returns years sorted ascending', async () => {
    mockDbRef.current
      .insert(taxSummaries)
      .values([
        makeSummaryInsert({ taxYear: 2025 }),
        makeSummaryInsert({ taxYear: 2023 }),
        makeSummaryInsert({ taxYear: 2024, bucket: 'futures_pnl' }),
      ])
      .run();

    const res = await app.request('/api/report/years');
    const body = (await res.json()) as { years: number[] };
    expect(body.years).toEqual([2023, 2024, 2025]);
  });

  it('deduplicates years (multiple buckets per year)', async () => {
    mockDbRef.current
      .insert(taxSummaries)
      .values([
        makeSummaryInsert({ taxYear: 2024, bucket: 'private_sale' }),
        makeSummaryInsert({ taxYear: 2024, bucket: 'futures_pnl' }),
        makeSummaryInsert({ taxYear: 2024, bucket: 'staking_earn' }),
      ])
      .run();

    const res = await app.request('/api/report/years');
    const body = (await res.json()) as { years: number[] };
    expect(body.years).toEqual([2024]);
  });
});

// ===========================================================================
// GET /api/report/:year/preview
// ===========================================================================

describe('GET /api/report/:year/preview', () => {
  beforeEach(setupApp);
  afterEach(() => sqlite.close());

  it('returns 400 for non-numeric year', async () => {
    const res = await app.request('/api/report/abc/preview');
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain('abc');
  });

  it('returns 400 when year contains letters', async () => {
    const res = await app.request('/api/report/notayear/preview');
    expect(res.status).toBe(400);
  });

  it('returns 404 when no tax data exists for the year', async () => {
    const res = await app.request('/api/report/2099/preview');
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain('2099');
  });

  it('returns 200 with ReportData JSON for a valid year with data', async () => {
    seedTestData(2024);

    const res = await app.request('/api/report/2024/preview');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/json');
  });

  it('response contains expected ReportData fields', async () => {
    seedTestData(2024);

    const res = await app.request('/api/report/2024/preview');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const body = (await res.json()) as any;

    expect(body).toHaveProperty('taxYear', 2024);
    expect(body).toHaveProperty('generatedAt');
    expect(body).toHaveProperty('spotSummary');
    expect(body).toHaveProperty('futuresSummary');
    expect(body).toHaveProperty('earnSummary');
    expect(body).toHaveProperty('tradeAppendix');
  });

  it('spotSummary contains correct structure', async () => {
    seedTestData(2024);

    const res = await app.request('/api/report/2024/preview');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const body = (await res.json()) as any;
    const spot = body.spotSummary;

    expect(spot).toHaveProperty('totalGainsEur');
    expect(spot).toHaveProperty('totalLossesEur');
    expect(spot).toHaveProperty('netEur');
    expect(spot).toHaveProperty('taxableAmountEur');
    expect(spot).toHaveProperty('freigrenzeStatus');
    expect(spot).toHaveProperty('tradeCount');
  });

  it('tradeAppendix is an array', async () => {
    seedTestData(2024);

    const res = await app.request('/api/report/2024/preview');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const body = (await res.json()) as any;
    expect(Array.isArray(body.tradeAppendix)).toBe(true);
  });
});

// ===========================================================================
// GET /api/report/:year/pdf
// ===========================================================================

describe('GET /api/report/:year/pdf', () => {
  beforeEach(setupApp);
  afterEach(() => sqlite.close());

  it('returns 400 for non-numeric year', async () => {
    const res = await app.request('/api/report/abc/pdf');
    expect(res.status).toBe(400);
  });

  it('returns 404 when no tax data exists for the year', async () => {
    const res = await app.request('/api/report/2099/pdf');
    expect(res.status).toBe(404);
  });

  it('returns 200 with Content-Type application/pdf', async () => {
    seedTestData(2024);

    const res = await app.request('/api/report/2024/pdf');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/pdf');
  });

  it('returns Content-Disposition attachment with correct filename', async () => {
    seedTestData(2024);

    const res = await app.request('/api/report/2024/pdf');
    const disposition = res.headers.get('content-disposition');
    expect(disposition).toContain('attachment');
    expect(disposition).toContain('cryptax-steuerreport-2024.pdf');
  });

  it('response body is a valid PDF (starts with %PDF-)', async () => {
    seedTestData(2024);

    const res = await app.request('/api/report/2024/pdf');
    const arrayBuffer = await res.arrayBuffer();
    const bytes = new Uint8Array(arrayBuffer);

    // %PDF- in ASCII: 0x25, 0x50, 0x44, 0x46, 0x2D
    expect(bytes[0]).toBe(0x25); // %
    expect(bytes[1]).toBe(0x50); // P
    expect(bytes[2]).toBe(0x44); // D
    expect(bytes[3]).toBe(0x46); // F
    expect(bytes[4]).toBe(0x2d); // -
  });

  it('PDF body is non-empty (has meaningful size)', async () => {
    seedTestData(2024);

    const res = await app.request('/api/report/2024/pdf');
    const arrayBuffer = await res.arrayBuffer();
    expect(arrayBuffer.byteLength).toBeGreaterThan(1000);
  });
}, 15000); // PDF generation can be slower — 15s timeout

// ===========================================================================
// GET /api/report/:year/csv
// ===========================================================================

describe('GET /api/report/:year/csv', () => {
  beforeEach(setupApp);
  afterEach(() => sqlite.close());

  it('returns 400 for non-numeric year', async () => {
    const res = await app.request('/api/report/abc/csv');
    expect(res.status).toBe(400);
  });

  it('returns 404 when no tax data exists for the year', async () => {
    const res = await app.request('/api/report/2099/csv');
    expect(res.status).toBe(404);
  });

  it('returns 200 with Content-Type containing text/csv', async () => {
    seedTestData(2024);

    const res = await app.request('/api/report/2024/csv');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/csv');
  });

  it('returns Content-Disposition attachment with correct filename', async () => {
    seedTestData(2024);

    const res = await app.request('/api/report/2024/csv');
    const disposition = res.headers.get('content-disposition');
    expect(disposition).toContain('attachment');
    expect(disposition).toContain('cryptax-steuerberater-2024.csv');
  });

  it('response body starts with UTF-8 BOM + header row', async () => {
    seedTestData(2024);

    const res = await app.request('/api/report/2024/csv');
    // Read raw bytes to check for BOM (TextDecoder strips BOM by default)
    const arrayBuffer = await res.arrayBuffer();
    const bytes = new Uint8Array(arrayBuffer);

    // UTF-8 BOM: 0xEF, 0xBB, 0xBF
    expect(bytes[0]).toBe(0xef);
    expect(bytes[1]).toBe(0xbb);
    expect(bytes[2]).toBe(0xbf);

    // Decode without BOM stripping to check headers
    const text = new TextDecoder('utf-8', { ignoreBOM: true }).decode(arrayBuffer);
    // First 3 bytes are BOM — after that should be the header row
    expect(text).toContain('Nr');
    expect(text).toContain('Symbol');
    expect(text).toContain('Kaufdatum');
  });

  it('response body uses semicolons as delimiter', async () => {
    seedTestData(2024);

    const res = await app.request('/api/report/2024/csv');
    const text = await res.text();

    // Header row uses semicolons
    const firstLine = text.slice(1).split('\r\n')[0]; // skip BOM
    expect(firstLine).toContain(';');
  });

  it('response body contains the summary section', async () => {
    seedTestData(2024);

    const res = await app.request('/api/report/2024/csv');
    const text = await res.text();

    expect(text).toContain('Zusammenfassung');
    expect(text).toContain('Steuerjahr');
  });
});

// ===========================================================================
// Cross-endpoint: multiple years
// ===========================================================================

describe('Multi-year isolation', () => {
  beforeEach(setupApp);
  afterEach(() => sqlite.close());

  it('preview returns data only for the requested year', async () => {
    seedTestData(2023, 'seed-2023');
    seedTestData(2024, 'seed-2024');

    const res2023 = await app.request('/api/report/2023/preview');
    const res2024 = await app.request('/api/report/2024/preview');

    expect(res2023.status).toBe(200);
    expect(res2024.status).toBe(200);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const body2023 = (await res2023.json()) as any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const body2024 = (await res2024.json()) as any;

    expect(body2023.taxYear).toBe(2023);
    expect(body2024.taxYear).toBe(2024);
  });

  it('years endpoint returns both seeded years sorted', async () => {
    seedTestData(2023, 'seed-2023b');
    seedTestData(2024, 'seed-2024b');

    const res = await app.request('/api/report/years');
    const body = (await res.json()) as { years: number[] };
    expect(body.years).toContain(2023);
    expect(body.years).toContain(2024);
    // Should be sorted ascending
    const idx2023 = body.years.indexOf(2023);
    const idx2024 = body.years.indexOf(2024);
    expect(idx2023).toBeLessThan(idx2024);
  });
});
