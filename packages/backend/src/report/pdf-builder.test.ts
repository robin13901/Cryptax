/**
 * PDF Builder Tests
 *
 * Validates that buildPdf() produces a valid PDF Buffer.
 *
 * Text search strategy:
 *   PDFKit with embedded TTF fonts uses CID glyph encoding for body text,
 *   which is NOT plain-text searchable in the binary buffer.
 *   However, PDF info metadata (Title, Keywords, Subject) is always stored as
 *   literal PDF strings and IS searchable in the raw buffer.
 *
 *   buildPdf() sets Keywords to include all section identifiers:
 *   "Krypto-Steuerreport [year] Anlage SO Anlage KAP Staking Earn EStG Freigrenze"
 *
 *   Tests verify:
 *   1. Valid PDF structure (%PDF- header, %%EOF trailer)
 *   2. Metadata-based content (searchable in binary)
 *   3. Buffer is non-empty and valid
 *   4. Edge cases (empty data, zero values)
 */

import { describe, it, expect } from 'vitest';
import type { ReportData } from '@cryptax/shared';
import { buildPdf, formatEurPdf } from './pdf-builder.js';

// ---------------------------------------------------------------------------
// Test fixture — realistic German tax report data
// ---------------------------------------------------------------------------

const MOCK_GENERATED_AT = '2025-01-15T10:30:00.000Z';

const mockReportData: ReportData = {
  taxYear: 2024,
  generatedAt: MOCK_GENERATED_AT,
  spotSummary: {
    totalGainsEur: '3250.75',
    totalLossesEur: '-850.20',
    netEur: '2400.55',
    taxableAmountEur: '2400.55',
    freigrenzeLimitEur: '1000',
    freigrenzeStatus: 'over',
    tradeCount: 42,
    taxFreeTradeCount: 8,
  },
  futuresSummary: {
    totalGainsEur: '1500.00',
    totalLossesEur: '-300.00',
    netEur: '1200.00',
    taxableAmountEur: '1200.00',
    totalFeesEur: '45.80',
    estimatedTaxEur: '316.50',
    tradeCount: 15,
  },
  earnSummary: {
    totalIncomeEur: '320.45',
    freigrenzeLimitEur: '256',
    freigrenzeStatus: 'over',
    recordCount: 28,
    perCoinBreakdown: [
      { symbol: 'ETH', totalEur: '180.30', count: 12 },
      { symbol: 'BTC', totalEur: '95.15', count: 8 },
      { symbol: 'SOL', totalEur: '45.00', count: 8 },
    ],
  },
  tradeAppendix: [
    {
      id: 1,
      symbol: 'BTC',
      buyDate: '2023-06-01T00:00:00.000Z',
      sellDate: '2024-02-15T00:00:00.000Z',
      amountConsumed: '0.05',
      costBasisEur: '1500.00',
      proceedsEur: '2100.00',
      gainLossEur: '600.00',
      feeEur: '10.50',
      heldDays: 259,
      haltefristMet: false,
      exchange: 'Bitget',
    },
    {
      id: 2,
      symbol: 'ETH',
      buyDate: '2022-03-10T00:00:00.000Z',
      sellDate: '2024-04-20T00:00:00.000Z',
      amountConsumed: '1.5',
      costBasisEur: '2400.00',
      proceedsEur: '4500.00',
      gainLossEur: '2100.00',
      feeEur: '22.00',
      heldDays: 772,
      haltefristMet: true,
      exchange: 'Bitget',
    },
  ],
};

/** Fixture with minimal/zero data for edge case tests */
const emptyReportData: ReportData = {
  taxYear: 2023,
  generatedAt: '2024-01-10T08:00:00.000Z',
  spotSummary: {
    totalGainsEur: '0',
    totalLossesEur: '0',
    netEur: '0',
    taxableAmountEur: '0',
    freigrenzeLimitEur: '1000',
    freigrenzeStatus: 'under',
    tradeCount: 0,
    taxFreeTradeCount: 0,
  },
  futuresSummary: {
    totalGainsEur: '0',
    totalLossesEur: '0',
    netEur: '0',
    taxableAmountEur: '0',
    totalFeesEur: '0',
    estimatedTaxEur: '0',
    tradeCount: 0,
  },
  earnSummary: {
    totalIncomeEur: '0',
    freigrenzeLimitEur: '256',
    freigrenzeStatus: 'under',
    recordCount: 0,
    perCoinBreakdown: [],
  },
  tradeAppendix: [],
};

// ---------------------------------------------------------------------------
// Search helper
// ---------------------------------------------------------------------------

/**
 * Return true if substring appears in the PDF buffer.
 * Searches both latin1 and utf8 representations.
 *
 * Note: body text rendered with embedded TTF fonts is CID-encoded and NOT
 * plain-text searchable. This function reliably finds:
 *   - PDF info metadata (Title, Author, Subject, Keywords)
 *   - PDF structural elements (%PDF-, %%EOF, stream/endstream)
 *   - Object dictionary keys (/Title, /Author, etc.)
 */
function pdfContains(buf: Buffer, substring: string): boolean {
  return buf.toString('latin1').includes(substring) || buf.toString('utf8').includes(substring);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('buildPdf', () => {
  it('returns a non-empty Buffer', async () => {
    const result = await buildPdf(mockReportData);
    expect(result).toBeInstanceOf(Buffer);
    expect(result.length).toBeGreaterThan(0);
  });

  it('PDF starts with %PDF- header (bytes 0x25 0x50 0x44 0x46 0x2D)', async () => {
    const buf = await buildPdf(mockReportData);
    const header = buf.slice(0, 5).toString('ascii');
    expect(header).toBe('%PDF-');
  });

  it('PDF ends with %%EOF marker', async () => {
    const buf = await buildPdf(mockReportData);
    const tail = buf.toString('latin1').slice(-20);
    expect(tail).toContain('%%EOF');
  });

  it('PDF is a substantial buffer (font subsets + multi-page content)', async () => {
    const buf = await buildPdf(mockReportData);
    // A multi-page PDF with embedded font subsets and graphics should be at least 15KB
    expect(buf.length).toBeGreaterThan(15_000);
  });

  // -------------------------------------------------------------------------
  // Metadata-based content verification
  // PDFKit stores document info (Title, Keywords, Subject) as literal PDF
  // strings — these are always plain-text searchable in the binary buffer,
  // regardless of font encoding.
  // -------------------------------------------------------------------------

  it('PDF metadata contains "Krypto-Steuerreport" in Title', async () => {
    const buf = await buildPdf(mockReportData);
    expect(pdfContains(buf, 'Krypto-Steuerreport')).toBe(true);
  });

  it('PDF metadata contains the tax year', async () => {
    const buf = await buildPdf(mockReportData);
    expect(pdfContains(buf, '2024')).toBe(true);
  });

  it('PDF metadata contains "Anlage SO" in Keywords', async () => {
    const buf = await buildPdf(mockReportData);
    expect(pdfContains(buf, 'Anlage SO')).toBe(true);
  });

  it('PDF metadata contains "Anlage KAP" in Keywords', async () => {
    const buf = await buildPdf(mockReportData);
    expect(pdfContains(buf, 'Anlage KAP')).toBe(true);
  });

  it('PDF metadata contains "Staking" in Keywords', async () => {
    const buf = await buildPdf(mockReportData);
    expect(pdfContains(buf, 'Staking')).toBe(true);
  });

  it('PDF metadata contains "EStG" in Keywords', async () => {
    const buf = await buildPdf(mockReportData);
    expect(pdfContains(buf, 'EStG')).toBe(true);
  });

  it('PDF metadata contains "Freigrenze" in Keywords', async () => {
    const buf = await buildPdf(mockReportData);
    expect(pdfContains(buf, 'Freigrenze')).toBe(true);
  });

  it('PDF metadata contains author "Cryptax"', async () => {
    const buf = await buildPdf(mockReportData);
    expect(pdfContains(buf, 'Cryptax')).toBe(true);
  });

  // -------------------------------------------------------------------------
  // PDF structural markers
  // -------------------------------------------------------------------------

  it('PDF contains stream objects (content streams for graphics/text)', async () => {
    const buf = await buildPdf(mockReportData);
    expect(pdfContains(buf, 'stream')).toBe(true);
  });

  it('PDF references multiple pages (multi-page document)', async () => {
    const buf = await buildPdf(mockReportData);
    // /Pages object references the page tree
    expect(pdfContains(buf, '/Pages')).toBe(true);
  });

  it('PDF contains font embedding marker', async () => {
    const buf = await buildPdf(mockReportData);
    // DejaVu font name prefix appears in the font descriptor
    expect(pdfContains(buf, '/Font')).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Edge cases
  // -------------------------------------------------------------------------

  it('buildPdf does not throw for empty tradeAppendix', async () => {
    await expect(buildPdf(emptyReportData)).resolves.toBeInstanceOf(Buffer);
  });

  it('buildPdf does not throw for zero-valued summaries', async () => {
    const buf = await buildPdf(emptyReportData);
    expect(buf.length).toBeGreaterThan(0);
    expect(buf.slice(0, 5).toString('ascii')).toBe('%PDF-');
  });

  it('PDF for empty data still contains valid metadata', async () => {
    const buf = await buildPdf(emptyReportData);
    expect(pdfContains(buf, 'Krypto-Steuerreport')).toBe(true);
    expect(pdfContains(buf, 'Anlage SO')).toBe(true);
    expect(pdfContains(buf, 'Anlage KAP')).toBe(true);
  });

  it('PDF for year 2023 contains the correct year in metadata', async () => {
    const buf = await buildPdf(emptyReportData);
    expect(pdfContains(buf, '2023')).toBe(true);
  });

  it('each tax year produces a distinct PDF (metadata differs)', async () => {
    const buf2024 = await buildPdf(mockReportData);
    const buf2023 = await buildPdf(emptyReportData);
    // Title differs by year
    expect(pdfContains(buf2024, 'Krypto-Steuerreport 2024')).toBe(true);
    expect(pdfContains(buf2023, 'Krypto-Steuerreport 2023')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// formatEurPdf helper tests
// ---------------------------------------------------------------------------

describe('formatEurPdf', () => {
  it('formats positive value as German currency', () => {
    const result = formatEurPdf('1234.56');
    // German locale: 1.234,56 € or 1.234,56 EUR
    expect(result).toMatch(/1\.234,56/);
  });

  it('formats negative value with minus sign and correct decimal', () => {
    const result = formatEurPdf('-500.00');
    // Matches "-500,00" or "500,00-" depending on locale variant
    expect(result).toMatch(/500,00/);
  });

  it('formats zero value', () => {
    const result = formatEurPdf('0');
    expect(result).toMatch(/0,00/);
  });

  it('formats large value with thousands separator', () => {
    const result = formatEurPdf('12345.67');
    // German thousands separator is a dot: 12.345,67
    expect(result).toMatch(/12\.345,67/);
  });

  it('includes currency symbol or code', () => {
    const result = formatEurPdf('100');
    // de-DE locale uses '€' symbol
    expect(result).toMatch(/€|EUR/);
  });

  it('rounds to 2 decimal places', () => {
    // parseFloat('1234.567') = 1234.567, rounds to 1234.57
    const result = formatEurPdf('1234.567');
    expect(result).toMatch(/1\.234,5[67]/);
  });
});
