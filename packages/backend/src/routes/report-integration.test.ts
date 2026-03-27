/**
 * Integration tests for the full backend report pipeline.
 *
 * Unlike report.test.ts (which tests route handlers in isolation), these tests
 * verify the COMPLETE data pipeline:
 *
 *   seed derived tables → ReportGenerator → route handlers → JSON/PDF/CSV
 *
 * Focus areas:
 *   - Specific data values flowing correctly through the pipeline
 *   - CSV column count (13 columns per plan spec)
 *   - Cross-format consistency (preview data matches PDF content)
 *   - All three format endpoints returning 404 for non-existent year
 *
 * Uses the same in-memory SQLite + vi.hoisted pattern as report.test.ts
 * to avoid the TDZ issue with ReportGenerator's module-level singleton.
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
// DB mock — vi.hoisted ensures mockDbRef exists before mock factory runs.
// This is required because ReportGenerator creates a singleton at module
// load time, which would capture the wrong (null) db reference otherwise.
// ---------------------------------------------------------------------------

// biome-ignore lint/suspicious/noExplicitAny: test helper — DB ref holds any drizzle instance
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
// Import route registrar AFTER mocks are set up
// ---------------------------------------------------------------------------

import { registerReportRoutes } from './report.js';

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
// Fixture seed — inserts a realistic 2024 dataset into all required tables.
// Returns key expected values for cross-assertion.
// ---------------------------------------------------------------------------

interface SeedResult {
  spotNetEur: string;
  futuresEstimatedTaxEur: string;
  earnTotalIncomeEur: string;
  tradeCount: number;
}

function seedFullPipeline(year = 2024): SeedResult {
  const db = mockDbRef.current;

  // tax_summaries for all three buckets
  db.insert(taxSummaries)
    .values([
      {
        taxYear: year,
        bucket: 'private_sale',
        totalGainsEur: '3000',
        totalLossesEur: '-500',
        netEur: '2500',
        taxableAmountEur: '2500',
        estimatedTaxEur: '0',
        tradeCount: 3,
        computedAt: new Date().toISOString(),
      },
      {
        taxYear: year,
        bucket: 'futures_pnl',
        totalGainsEur: '800',
        totalLossesEur: '-200',
        netEur: '600',
        taxableAmountEur: '600',
        estimatedTaxEur: '158.25',
        tradeCount: 4,
        computedAt: new Date().toISOString(),
      },
      {
        taxYear: year,
        bucket: 'staking_earn',
        totalGainsEur: '250',
        totalLossesEur: '0',
        netEur: '250',
        taxableAmountEur: '250',
        estimatedTaxEur: '0',
        tradeCount: 5,
        computedAt: new Date().toISOString(),
      },
    ])
    .run();

  // sell transaction
  const [sellTx] = db
    .insert(transactions)
    .values({
      exchange: 'bitget',
      sourceType: 'spot_tx',
      canonicalType: 'sell',
      symbol: 'BTC',
      side: 'sell',
      amount: '0.1',
      price: '50000',
      fee: '0',
      totalValue: '5000',
      tradedAt: `${year}-06-15T10:00:00.000Z`,
      taxYear: year,
      checksum: `integration-sell-${year}`,
      importedAt: new Date().toISOString(),
    })
    .returning()
    .all();

  // second sell transaction for more tradeAppendix entries
  const [sellTx2] = db
    .insert(transactions)
    .values({
      exchange: 'bitget',
      sourceType: 'spot_tx',
      canonicalType: 'sell',
      symbol: 'ETH',
      side: 'sell',
      amount: '1.5',
      price: '3000',
      fee: '0',
      totalValue: '4500',
      tradedAt: `${year}-09-20T14:30:00.000Z`,
      taxYear: year,
      checksum: `integration-sell2-${year}`,
      importedAt: new Date().toISOString(),
    })
    .returning()
    .all();

  // buy transaction for BTC lot
  const [buyTx] = db
    .insert(transactions)
    .values({
      exchange: 'bitget',
      sourceType: 'spot_tx',
      canonicalType: 'buy',
      symbol: 'BTC',
      side: 'buy',
      amount: '0.1',
      price: '30000',
      fee: '0',
      totalValue: '3000',
      tradedAt: `${year - 1}-01-10T00:00:00.000Z`,
      taxYear: year - 1,
      checksum: `integration-buy-btc-${year}`,
      importedAt: new Date().toISOString(),
    })
    .returning()
    .all();

  // buy transaction for ETH lot
  const [buyTx2] = db
    .insert(transactions)
    .values({
      exchange: 'bitget',
      sourceType: 'spot_tx',
      canonicalType: 'buy',
      symbol: 'ETH',
      side: 'buy',
      amount: '1.5',
      price: '2000',
      fee: '0',
      totalValue: '3000',
      tradedAt: `${year - 1}-03-01T00:00:00.000Z`,
      taxYear: year - 1,
      checksum: `integration-buy-eth-${year}`,
      importedAt: new Date().toISOString(),
    })
    .returning()
    .all();

  // fifo_lots
  const [btcLot] = db
    .insert(fifoLots)
    .values({
      symbol: 'BTC',
      originalAmount: '0.1',
      remainingAmount: '0',
      costBasisEur: '3000',
      costPerUnitEur: '30000',
      feeEur: '0',
      acquiredAt: `${year - 1}-01-10T00:00:00.000Z`,
      taxYear: year,
      transactionId: buyTx.id,
    })
    .returning()
    .all();

  const [ethLot] = db
    .insert(fifoLots)
    .values({
      symbol: 'ETH',
      originalAmount: '1.5',
      remainingAmount: '0',
      costBasisEur: '3000',
      costPerUnitEur: '2000',
      feeEur: '0',
      acquiredAt: `${year - 1}-03-01T00:00:00.000Z`,
      taxYear: year,
      transactionId: buyTx2.id,
    })
    .returning()
    .all();

  // lot_consumptions
  db.insert(lotConsumptions)
    .values([
      {
        lotId: btcLot.id,
        sellTransactionId: sellTx.id,
        amountConsumed: '0.1',
        costBasisEur: '3000',
        proceedsEur: '5000',
        gainLossEur: '2000',
        feeEur: '0',
        heldDays: 521,
        haltefristMet: false,
        taxYear: year,
      },
      {
        lotId: ethLot.id,
        sellTransactionId: sellTx2.id,
        amountConsumed: '1.5',
        costBasisEur: '3000',
        proceedsEur: '4500',
        gainLossEur: '1500',
        feeEur: '0',
        heldDays: 568,
        haltefristMet: false,
        taxYear: year,
      },
    ])
    .run();

  // futures_position
  db.insert(futuresPositions)
    .values({
      symbol: 'BTCUSDT',
      realizedPnlEur: '600',
      feeEur: '15',
      transactionId: sellTx.id,
      taxYear: year,
    })
    .run();

  // earn_income
  db.insert(earnIncome)
    .values([
      {
        symbol: 'ETH',
        amount: '0.1',
        eurValueAtReceipt: '150',
        receivedAt: `${year}-02-01T00:00:00.000Z`,
        transactionId: sellTx.id,
        taxYear: year,
      },
      {
        symbol: 'BTC',
        amount: '0.002',
        eurValueAtReceipt: '100',
        receivedAt: `${year}-05-01T00:00:00.000Z`,
        transactionId: sellTx2.id,
        taxYear: year,
      },
    ])
    .run();

  return {
    spotNetEur: '2500',
    futuresEstimatedTaxEur: '158.25',
    earnTotalIncomeEur: '250', // 150 + 100
    tradeCount: 2, // two lot_consumptions → two tradeAppendix rows
  };
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
// Integration: GET /api/report/years
// ===========================================================================

describe('Integration: GET /api/report/years returns available years', () => {
  beforeEach(setupApp);
  afterEach(() => sqlite.close());

  it('returns [2024] after seeding 2024 data', async () => {
    seedFullPipeline(2024);

    const res = await app.request('/api/report/years');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { years: number[] };
    expect(body.years).toContain(2024);
  });
});

// ===========================================================================
// Integration: GET /api/report/2024/preview returns complete ReportData
// ===========================================================================

describe('Integration: GET /api/report/2024/preview returns complete ReportData', () => {
  beforeEach(setupApp);
  afterEach(() => sqlite.close());

  it('returns 200 with taxYear and generatedAt', async () => {
    seedFullPipeline(2024);

    const res = await app.request('/api/report/2024/preview');
    expect(res.status).toBe(200);
    // biome-ignore lint/suspicious/noExplicitAny: JSON response shape not typed
    const body = (await res.json()) as any;
    expect(body.taxYear).toBe(2024);
    expect(body.generatedAt).toBeTruthy();
  });

  it('spotSummary has correct netEur from seeded data', async () => {
    const seed = seedFullPipeline(2024);

    const res = await app.request('/api/report/2024/preview');
    // biome-ignore lint/suspicious/noExplicitAny: JSON response shape not typed
    const body = (await res.json()) as any;
    expect(body.spotSummary.netEur).toBe(seed.spotNetEur);
  });

  it('futuresSummary has estimatedTaxEur > 0', async () => {
    seedFullPipeline(2024);

    const res = await app.request('/api/report/2024/preview');
    // biome-ignore lint/suspicious/noExplicitAny: JSON response shape not typed
    const body = (await res.json()) as any;
    expect(parseFloat(body.futuresSummary.estimatedTaxEur)).toBeGreaterThan(0);
  });

  it('earnSummary has totalIncomeEur > 0', async () => {
    seedFullPipeline(2024);

    const res = await app.request('/api/report/2024/preview');
    // biome-ignore lint/suspicious/noExplicitAny: JSON response shape not typed
    const body = (await res.json()) as any;
    expect(parseFloat(body.earnSummary.totalIncomeEur)).toBeGreaterThan(0);
  });

  it('tradeAppendix.length matches expected lot_consumptions count', async () => {
    const seed = seedFullPipeline(2024);

    const res = await app.request('/api/report/2024/preview');
    // biome-ignore lint/suspicious/noExplicitAny: JSON response shape not typed
    const body = (await res.json()) as any;
    expect(body.tradeAppendix.length).toBe(seed.tradeCount);
  });

  it('tradeAppendix rows have expected fields', async () => {
    seedFullPipeline(2024);

    const res = await app.request('/api/report/2024/preview');
    // biome-ignore lint/suspicious/noExplicitAny: JSON response shape not typed
    const body = (await res.json()) as any;
    const row = body.tradeAppendix[0];

    expect(row).toHaveProperty('symbol');
    expect(row).toHaveProperty('buyDate');
    expect(row).toHaveProperty('sellDate');
    expect(row).toHaveProperty('gainLossEur');
    expect(row).toHaveProperty('heldDays');
    expect(row).toHaveProperty('haltefristMet');
  });
});

// ===========================================================================
// Integration: GET /api/report/2024/pdf returns valid PDF
// ===========================================================================

describe('Integration: GET /api/report/2024/pdf returns valid PDF', () => {
  beforeEach(setupApp);
  afterEach(() => sqlite.close());

  it('returns 200 with Content-Type: application/pdf', async () => {
    seedFullPipeline(2024);

    const res = await app.request('/api/report/2024/pdf');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/pdf');
  });

  it('body starts with %PDF- marker', async () => {
    seedFullPipeline(2024);

    const res = await app.request('/api/report/2024/pdf');
    const arrayBuffer = await res.arrayBuffer();
    const bytes = new Uint8Array(arrayBuffer);

    // %PDF- in ASCII: 0x25 0x50 0x44 0x46 0x2D
    expect(bytes[0]).toBe(0x25); // %
    expect(bytes[1]).toBe(0x50); // P
    expect(bytes[2]).toBe(0x44); // D
    expect(bytes[3]).toBe(0x46); // F
    expect(bytes[4]).toBe(0x2d); // -
  });

  it('body length > 1000 bytes (non-trivial PDF)', async () => {
    seedFullPipeline(2024);

    const res = await app.request('/api/report/2024/pdf');
    const arrayBuffer = await res.arrayBuffer();
    expect(arrayBuffer.byteLength).toBeGreaterThan(1000);
  });
}, 15000);

// ===========================================================================
// Integration: GET /api/report/2024/csv returns valid CSV
// ===========================================================================

describe('Integration: GET /api/report/2024/csv returns valid CSV', () => {
  beforeEach(setupApp);
  afterEach(() => sqlite.close());

  it('returns 200 with Content-Type containing text/csv', async () => {
    seedFullPipeline(2024);

    const res = await app.request('/api/report/2024/csv');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/csv');
  });

  it('header row has exactly 13 columns', async () => {
    seedFullPipeline(2024);

    const res = await app.request('/api/report/2024/csv');
    const text = await res.text();

    // Skip BOM (\uFEFF), split lines, get first (header) row
    const withoutBom = text.startsWith('\uFEFF') ? text.slice(1) : text;
    const headerLine = withoutBom.split('\r\n')[0];
    const columns = headerLine.split(';');
    expect(columns).toHaveLength(13);
  });

  it('data row count matches tradeAppendix length', async () => {
    const seed = seedFullPipeline(2024);

    const res = await app.request('/api/report/2024/csv');
    const text = await res.text();

    const withoutBom = text.startsWith('\uFEFF') ? text.slice(1) : text;
    const lines = withoutBom.split('\r\n').filter(Boolean);
    // lines[0] = header, then data rows, then summary rows
    // data rows come before the empty separator + summary section
    // find index of blank line (the separator)
    const separatorIdx = withoutBom.split('\r\n').findIndex((l) => l.trim() === '');
    const dataRows = separatorIdx > 1 ? separatorIdx - 1 : lines.length - 1;
    expect(dataRows).toBe(seed.tradeCount);
  });

  it('body contains Zusammenfassung section', async () => {
    seedFullPipeline(2024);

    const res = await app.request('/api/report/2024/csv');
    const text = await res.text();
    expect(text).toContain('Zusammenfassung');
  });
});

// ===========================================================================
// Integration: Preview data matches CSV content (cross-format consistency)
// ===========================================================================

describe('Integration: Cross-format consistency', () => {
  beforeEach(setupApp);
  afterEach(() => sqlite.close());

  it('preview spotSummary.netEur matches Spot Netto EUR in CSV summary section', async () => {
    const seed = seedFullPipeline(2024);

    // Fetch preview to get the reference netEur
    const previewRes = await app.request('/api/report/2024/preview');
    // biome-ignore lint/suspicious/noExplicitAny: JSON response shape not typed
    const previewBody = (await previewRes.json()) as any;
    const netEur = previewBody.spotSummary.netEur;
    expect(netEur).toBe(seed.spotNetEur);

    // Fetch CSV and verify netEur appears in the summary section
    const csvRes = await app.request('/api/report/2024/csv');
    const csvText = await csvRes.text();

    // CSV summary section contains "Spot Netto EUR;<value>"
    expect(csvText).toContain(`Spot Netto EUR${';'}${netEur}`);
  });

  it('preview futuresSummary.estimatedTaxEur matches CSV summary', async () => {
    const seed = seedFullPipeline(2024);

    const previewRes = await app.request('/api/report/2024/preview');
    // biome-ignore lint/suspicious/noExplicitAny: JSON response shape not typed
    const previewBody = (await previewRes.json()) as any;
    const estimatedTaxEur = previewBody.futuresSummary.estimatedTaxEur;
    expect(estimatedTaxEur).toBe(seed.futuresEstimatedTaxEur);

    const csvRes = await app.request('/api/report/2024/csv');
    const csvText = await csvRes.text();

    expect(csvText).toContain(`Geschätzte Abgeltungssteuer EUR${';'}${estimatedTaxEur}`);
  });

  it('PDF buffer is non-empty and starts with %PDF- (format smoke check)', async () => {
    seedFullPipeline(2024);

    const pdfRes = await app.request('/api/report/2024/pdf');
    const arrayBuffer = await pdfRes.arrayBuffer();
    const bytes = new Uint8Array(arrayBuffer);

    // PDF starts with %PDF-
    expect(bytes[0]).toBe(0x25); // %
    expect(bytes[1]).toBe(0x50); // P
    expect(arrayBuffer.byteLength).toBeGreaterThan(1000);
  });
}, 15000);

// ===========================================================================
// Integration: Report for non-existent year returns 404
// ===========================================================================

describe('Integration: Report for non-existent year returns 404', () => {
  beforeEach(setupApp);
  afterEach(() => sqlite.close());

  it('GET /api/report/2099/preview returns 404', async () => {
    const res = await app.request('/api/report/2099/preview');
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain('2099');
  });

  it('GET /api/report/2099/pdf returns 404', async () => {
    const res = await app.request('/api/report/2099/pdf');
    expect(res.status).toBe(404);
  });

  it('GET /api/report/2099/csv returns 404', async () => {
    const res = await app.request('/api/report/2099/csv');
    expect(res.status).toBe(404);
  });
});
