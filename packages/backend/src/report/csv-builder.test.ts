/**
 * CSV Builder Tests
 *
 * Verifies the output of buildCsv(data: ReportData):
 *   - UTF-8 BOM prefix
 *   - Semicolon delimiter with 13 columns
 *   - German header labels
 *   - Data row count matches tradeAppendix length
 *   - Ja/Nein mapping for haltefristMet
 *   - Dot decimal separator for EUR values (not German comma)
 *   - Summary section presence and content
 *   - Empty appendix (header + summary only, no data rows)
 *   - Field escaping for semicolons
 *   - Sequential row numbering (Nr column)
 */

import { describe, expect, it } from 'vitest';
import type { ReportData, TradeAppendixRow } from '@cryptax/shared';
import { buildCsv, escapeCsvField } from './csv-builder.js';

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

function makeTradeRow(overrides: Partial<TradeAppendixRow> = {}): TradeAppendixRow {
  return {
    id: 1,
    symbol: 'BTC',
    buyDate: '2024-01-01T00:00:00.000Z',
    sellDate: '2024-09-01T00:00:00.000Z',
    amountConsumed: '0.5',
    costBasisEur: '20000.00',
    proceedsEur: '25000.00',
    gainLossEur: '5000.00',
    feeEur: '10.50',
    heldDays: 244,
    haltefristMet: false,
    exchange: 'bitget',
    ...overrides,
  };
}

function makeReportData(overrides: Partial<ReportData> = {}): ReportData {
  return {
    taxYear: 2024,
    generatedAt: '2026-03-23T00:00:00.000Z',
    spotSummary: {
      totalGainsEur: '5000',
      totalLossesEur: '-1000',
      netEur: '4000',
      taxableAmountEur: '4000',
      freigrenzeLimitEur: '1000',
      freigrenzeStatus: 'over',
      tradeCount: 3,
      taxFreeTradeCount: 1,
    },
    futuresSummary: {
      totalGainsEur: '2000',
      totalLossesEur: '-500',
      netEur: '1500',
      taxableAmountEur: '1500',
      totalFeesEur: '25.50',
      estimatedTaxEur: '395.625',
      tradeCount: 5,
    },
    earnSummary: {
      totalIncomeEur: '300',
      freigrenzeLimitEur: '256',
      freigrenzeStatus: 'over',
      recordCount: 3,
      perCoinBreakdown: [
        { symbol: 'ETH', totalEur: '200', count: 2 },
        { symbol: 'SOL', totalEur: '100', count: 1 },
      ],
    },
    tradeAppendix: [
      makeTradeRow({ id: 1, symbol: 'BTC', haltefristMet: false, gainLossEur: '5000.00' }),
      makeTradeRow({ id: 2, symbol: 'ETH', haltefristMet: true, gainLossEur: '-500.00', heldDays: 400 }),
      makeTradeRow({ id: 3, symbol: 'SOL', haltefristMet: false, gainLossEur: '200.00' }),
    ],
    ...overrides,
  };
}

/**
 * Parse the CSV output into lines, splitting on CRLF.
 * Ignores the BOM on the first character.
 */
function parseLines(csv: string): string[] {
  const withoutBom = csv.startsWith('\uFEFF') ? csv.slice(1) : csv;
  // Remove trailing CRLF before splitting so we don't get an empty trailing element
  return withoutBom.replace(/\r\n$/, '').split('\r\n');
}

/**
 * Split a CSV line into fields by semicolon delimiter.
 * Does NOT handle quoted fields with embedded semicolons (full parser not needed for tests).
 * For tests that need embedded-semicolon fields, inspect raw string presence.
 */
function splitFields(line: string): string[] {
  return line.split(';');
}

// ---------------------------------------------------------------------------
// BOM and encoding
// ---------------------------------------------------------------------------

describe('UTF-8 BOM prefix', () => {
  it('starts with UTF-8 BOM character', () => {
    const csv = buildCsv(makeReportData());
    expect(csv[0]).toBe('\uFEFF');
  });

  it('BOM is exactly one character (U+FEFF)', () => {
    const csv = buildCsv(makeReportData());
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv.charCodeAt(1)).not.toBe(0xfeff);
  });
});

// ---------------------------------------------------------------------------
// Delimiter and column count
// ---------------------------------------------------------------------------

describe('Semicolon delimiter and 13 columns', () => {
  it('uses semicolon as column delimiter — header has 13 fields', () => {
    const csv = buildCsv(makeReportData());
    const lines = parseLines(csv);
    const headerFields = splitFields(lines[0]);
    expect(headerFields).toHaveLength(13);
  });

  it('data rows also have 13 fields', () => {
    const csv = buildCsv(makeReportData());
    const lines = parseLines(csv);
    // Line 0 = header, lines 1-3 = data rows (3 appendix entries)
    const dataRow = splitFields(lines[1]);
    expect(dataRow).toHaveLength(13);
  });
});

// ---------------------------------------------------------------------------
// German header labels
// ---------------------------------------------------------------------------

describe('German header labels', () => {
  it('header contains expected German column names', () => {
    const csv = buildCsv(makeReportData());
    const lines = parseLines(csv);
    const header = lines[0];

    expect(header).toContain('Nr');
    expect(header).toContain('Symbol');
    expect(header).toContain('Kaufdatum');
    expect(header).toContain('Verkaufdatum');
    expect(header).toContain('Einstandswert EUR');
    expect(header).toContain('Haltefrist erfuellt');
    expect(header).toContain('Steuerfrei');
    expect(header).toContain('Boerse');
  });

  it('header row has all 13 expected column labels in order', () => {
    const csv = buildCsv(makeReportData());
    const lines = parseLines(csv);
    const fields = splitFields(lines[0]);

    expect(fields[0]).toBe('Nr');
    expect(fields[1]).toBe('Symbol');
    expect(fields[2]).toBe('Kaufdatum');
    expect(fields[3]).toBe('Verkaufdatum');
    expect(fields[4]).toBe('Menge');
    expect(fields[5]).toBe('Einstandswert EUR');
    expect(fields[6]).toBe('Erloes EUR');
    expect(fields[7]).toBe('Gewinn/Verlust EUR');
    expect(fields[8]).toBe('Gebuehr EUR');
    expect(fields[9]).toBe('Haltedauer Tage');
    expect(fields[10]).toBe('Haltefrist erfuellt');
    expect(fields[11]).toBe('Steuerfrei');
    expect(fields[12]).toBe('Boerse');
  });
});

// ---------------------------------------------------------------------------
// Data row count
// ---------------------------------------------------------------------------

describe('Data row count matches tradeAppendix length', () => {
  it('produces one data row per TradeAppendixRow', () => {
    const data = makeReportData();
    const csv = buildCsv(data);
    const lines = parseLines(csv);
    // Line 0 = header; skip to count non-header, non-blank, non-summary lines
    // Summary starts with blank line then 'Zusammenfassung'
    const summaryStartIndex = lines.findIndex((l) => l.startsWith('Zusammenfassung'));
    // Data rows: from line 1 up to (but not including) the blank line before summary
    const dataRows = lines.slice(1, summaryStartIndex - 1); // -1 for blank separator
    expect(dataRows).toHaveLength(data.tradeAppendix.length);
  });

  it('5-row appendix produces 5 data rows', () => {
    const rows = Array.from({ length: 5 }, (_, i) =>
      makeTradeRow({ id: i + 1, symbol: `COIN${i}` })
    );
    const csv = buildCsv(makeReportData({ tradeAppendix: rows }));
    const lines = parseLines(csv);
    const summaryStartIndex = lines.findIndex((l) => l.startsWith('Zusammenfassung'));
    const dataRows = lines.slice(1, summaryStartIndex - 1);
    expect(dataRows).toHaveLength(5);
  });
});

// ---------------------------------------------------------------------------
// Ja/Nein mapping
// ---------------------------------------------------------------------------

describe('Haltefrist Ja/Nein mapping', () => {
  it('haltefristMet=true renders "Ja" in both Haltefrist erfuellt and Steuerfrei columns', () => {
    const data = makeReportData({
      tradeAppendix: [makeTradeRow({ haltefristMet: true })],
    });
    const csv = buildCsv(data);
    const lines = parseLines(csv);
    const fields = splitFields(lines[1]); // first data row
    expect(fields[10]).toBe('Ja'); // Haltefrist erfuellt
    expect(fields[11]).toBe('Ja'); // Steuerfrei
  });

  it('haltefristMet=false renders "Nein" in both Haltefrist erfuellt and Steuerfrei columns', () => {
    const data = makeReportData({
      tradeAppendix: [makeTradeRow({ haltefristMet: false })],
    });
    const csv = buildCsv(data);
    const lines = parseLines(csv);
    const fields = splitFields(lines[1]);
    expect(fields[10]).toBe('Nein'); // Haltefrist erfuellt
    expect(fields[11]).toBe('Nein'); // Steuerfrei
  });

  it('mixed haltefrist rows render correctly in sequence', () => {
    const data = makeReportData({
      tradeAppendix: [
        makeTradeRow({ id: 1, haltefristMet: true }),
        makeTradeRow({ id: 2, haltefristMet: false }),
        makeTradeRow({ id: 3, haltefristMet: true }),
      ],
    });
    const csv = buildCsv(data);
    const lines = parseLines(csv);

    expect(splitFields(lines[1])[10]).toBe('Ja');
    expect(splitFields(lines[2])[10]).toBe('Nein');
    expect(splitFields(lines[3])[10]).toBe('Ja');
  });
});

// ---------------------------------------------------------------------------
// Decimal separator
// ---------------------------------------------------------------------------

describe('EUR values use dot decimal separator', () => {
  it('costBasisEur value appears with dot separator, not comma', () => {
    const data = makeReportData({
      tradeAppendix: [makeTradeRow({ costBasisEur: '1234.56' })],
    });
    const csv = buildCsv(data);
    expect(csv).toContain('1234.56');
    expect(csv).not.toContain('1234,56');
  });

  it('gainLossEur with many decimal places preserved as-is', () => {
    const data = makeReportData({
      tradeAppendix: [makeTradeRow({ gainLossEur: '9876.123456789' })],
    });
    const csv = buildCsv(data);
    expect(csv).toContain('9876.123456789');
  });

  it('negative gainLossEur preserved with minus sign', () => {
    const data = makeReportData({
      tradeAppendix: [makeTradeRow({ gainLossEur: '-500.25' })],
    });
    const csv = buildCsv(data);
    const lines = parseLines(csv);
    const fields = splitFields(lines[1]);
    expect(fields[7]).toBe('-500.25'); // Gewinn/Verlust EUR column
  });
});

// ---------------------------------------------------------------------------
// Summary section
// ---------------------------------------------------------------------------

describe('Summary section', () => {
  it('output contains "Zusammenfassung" keyword', () => {
    const csv = buildCsv(makeReportData());
    expect(csv).toContain('Zusammenfassung');
  });

  it('summary contains the correct tax year', () => {
    const csv = buildCsv(makeReportData({ taxYear: 2023 }));
    expect(csv).toContain('2023');
    expect(csv).toContain('Steuerjahr');
  });

  it('summary contains spot net EUR value', () => {
    const data = makeReportData();
    data.spotSummary.netEur = '3750.50';
    const csv = buildCsv(data);
    expect(csv).toContain('3750.50');
    expect(csv).toContain('Spot Netto EUR');
  });

  it('summary shows "Eingehalten" when freigrenzeStatus is "under"', () => {
    const data = makeReportData();
    data.spotSummary.freigrenzeStatus = 'under';
    const csv = buildCsv(data);
    expect(csv).toContain('Eingehalten');
    expect(csv).not.toContain('Ueberschritten');
  });

  it('summary shows "Ueberschritten" when freigrenzeStatus is "over"', () => {
    const data = makeReportData();
    data.spotSummary.freigrenzeStatus = 'over';
    const csv = buildCsv(data);
    expect(csv).toContain('Ueberschritten');
  });

  it('summary contains futures net EUR and estimated tax', () => {
    const data = makeReportData();
    data.futuresSummary.netEur = '1500';
    data.futuresSummary.estimatedTaxEur = '395.625';
    const csv = buildCsv(data);
    expect(csv).toContain('Futures Netto EUR');
    expect(csv).toContain('1500');
    expect(csv).toContain('Geschaetzte Abgeltungssteuer EUR');
    expect(csv).toContain('395.625');
  });

  it('summary contains staking income', () => {
    const data = makeReportData();
    data.earnSummary.totalIncomeEur = '300';
    const csv = buildCsv(data);
    expect(csv).toContain('Staking Einkommen EUR');
    expect(csv).toContain('300');
  });

  it('summary section appears after a blank separator line', () => {
    const csv = buildCsv(makeReportData());
    const lines = parseLines(csv);
    const summaryIndex = lines.findIndex((l) => l.startsWith('Zusammenfassung'));
    expect(summaryIndex).toBeGreaterThan(0);
    // The line before Zusammenfassung should be blank (empty string)
    expect(lines[summaryIndex - 1]).toBe('');
  });
});

// ---------------------------------------------------------------------------
// Empty appendix
// ---------------------------------------------------------------------------

describe('Empty tradeAppendix', () => {
  it('produces header row and summary, but no data rows', () => {
    const data = makeReportData({ tradeAppendix: [] });
    const csv = buildCsv(data);
    const lines = parseLines(csv);

    // First line must be header
    expect(lines[0]).toContain('Nr');
    // Summary must still appear
    expect(csv).toContain('Zusammenfassung');

    // No data rows — the blank line is immediately after the header
    const summaryIndex = lines.findIndex((l) => l.startsWith('Zusammenfassung'));
    // Lines between header (index 0) and blank separator (summaryIndex - 1): should be 0 data rows
    const dataRows = lines.slice(1, summaryIndex - 1);
    expect(dataRows).toHaveLength(0);
  });

  it('empty appendix still outputs tax year in summary', () => {
    const csv = buildCsv(makeReportData({ taxYear: 2022, tradeAppendix: [] }));
    expect(csv).toContain('2022');
  });
});

// ---------------------------------------------------------------------------
// Field escaping
// ---------------------------------------------------------------------------

describe('CSV field escaping', () => {
  it('wraps field containing semicolon in double quotes', () => {
    // Exchange name with a semicolon (edge case test)
    const data = makeReportData({
      tradeAppendix: [makeTradeRow({ exchange: 'bitget;test' })],
    });
    const csv = buildCsv(data);
    expect(csv).toContain('"bitget;test"');
  });

  it('escapes internal double quotes by doubling them', () => {
    const data = makeReportData({
      tradeAppendix: [makeTradeRow({ exchange: 'bit"get' })],
    });
    const csv = buildCsv(data);
    expect(csv).toContain('"bit""get"');
  });

  it('leaves plain fields unquoted', () => {
    const result = escapeCsvField('bitget');
    expect(result).toBe('bitget');
  });

  it('wraps field containing newline in double quotes', () => {
    const result = escapeCsvField('line1\nline2');
    expect(result).toBe('"line1\nline2"');
  });

  it('wraps field containing CRLF in double quotes', () => {
    const result = escapeCsvField('line1\r\nline2');
    expect(result).toBe('"line1\r\nline2"');
  });
});

// ---------------------------------------------------------------------------
// Sequential row numbering
// ---------------------------------------------------------------------------

describe('Sequential Nr column', () => {
  it('Nr column starts at 1 and increments sequentially', () => {
    const rows = Array.from({ length: 4 }, (_, i) =>
      makeTradeRow({ id: i + 1, symbol: `COIN${i}` })
    );
    const csv = buildCsv(makeReportData({ tradeAppendix: rows }));
    const lines = parseLines(csv);

    // Data rows start at line index 1
    for (let i = 0; i < 4; i++) {
      const fields = splitFields(lines[i + 1]);
      expect(fields[0]).toBe(String(i + 1));
    }
  });

  it('single-row appendix has Nr = 1', () => {
    const data = makeReportData({ tradeAppendix: [makeTradeRow()] });
    const csv = buildCsv(data);
    const lines = parseLines(csv);
    expect(splitFields(lines[1])[0]).toBe('1');
  });

  it('Nr column counts only data rows (not affected by summary rows)', () => {
    const rows = [
      makeTradeRow({ id: 1 }),
      makeTradeRow({ id: 2 }),
      makeTradeRow({ id: 3 }),
    ];
    const csv = buildCsv(makeReportData({ tradeAppendix: rows }));
    const lines = parseLines(csv);

    // Last data row (line index 3) should have Nr = 3
    expect(splitFields(lines[3])[0]).toBe('3');
  });
});

// ---------------------------------------------------------------------------
// Line endings
// ---------------------------------------------------------------------------

describe('Line endings', () => {
  it('uses CRLF line endings throughout', () => {
    const csv = buildCsv(makeReportData());
    // Should contain CRLF sequences (not just LF)
    expect(csv).toContain('\r\n');
  });

  it('does not use bare LF line endings (LF only without preceding CR)', () => {
    const csv = buildCsv(makeReportData());
    // Replace all CRLF pairs, then check no bare LF remain
    const withoutCrlf = csv.replace(/\r\n/g, '');
    expect(withoutCrlf).not.toContain('\n');
  });
});

// ---------------------------------------------------------------------------
// Complete row field mapping
// ---------------------------------------------------------------------------

describe('Complete row field mapping', () => {
  it('maps all 13 fields in correct column positions', () => {
    const row = makeTradeRow({
      symbol: 'ETH',
      buyDate: '2023-05-10T12:00:00.000Z',
      sellDate: '2024-02-15T09:30:00.000Z',
      amountConsumed: '2.5',
      costBasisEur: '4000.00',
      proceedsEur: '6000.00',
      gainLossEur: '2000.00',
      feeEur: '15.75',
      heldDays: 281,
      haltefristMet: false,
      exchange: 'binance',
    });

    const csv = buildCsv(makeReportData({ tradeAppendix: [row] }));
    const lines = parseLines(csv);
    const fields = splitFields(lines[1]);

    expect(fields[0]).toBe('1');                        // Nr
    expect(fields[1]).toBe('ETH');                      // Symbol
    expect(fields[2]).toBe('2023-05-10T12:00:00.000Z'); // Kaufdatum
    expect(fields[3]).toBe('2024-02-15T09:30:00.000Z'); // Verkaufdatum
    expect(fields[4]).toBe('2.5');                      // Menge
    expect(fields[5]).toBe('4000.00');                  // Einstandswert EUR
    expect(fields[6]).toBe('6000.00');                  // Erloes EUR
    expect(fields[7]).toBe('2000.00');                  // Gewinn/Verlust EUR
    expect(fields[8]).toBe('15.75');                    // Gebuehr EUR
    expect(fields[9]).toBe('281');                      // Haltedauer Tage
    expect(fields[10]).toBe('Nein');                    // Haltefrist erfuellt
    expect(fields[11]).toBe('Nein');                    // Steuerfrei
    expect(fields[12]).toBe('binance');                 // Boerse
  });
});
