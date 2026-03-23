/**
 * CSV Builder — converts ReportData into a machine-readable semicolon-delimited CSV.
 *
 * Output format:
 *   - UTF-8 BOM prefix (\uFEFF) for German Excel auto-detection
 *   - Semicolon (;) as column delimiter (German Excel standard)
 *   - CRLF (\r\n) line endings (Windows/Excel compatibility)
 *   - Dot (.) as decimal separator in EUR values (machine-readable, not German locale)
 *   - German column labels
 *
 * The CSV is the Steuerberater handoff format — a superset of the PDF columns
 * with all raw data fields for professional tax preparation. All lot consumptions
 * are included: both taxable AND tax-free (Haltefrist-met) trades.
 *
 * Columns (13 total):
 *   Nr, Symbol, Kaufdatum, Verkaufdatum, Menge, Einstandswert EUR,
 *   Erloes EUR, Gewinn/Verlust EUR, Gebuehr EUR, Haltedauer Tage,
 *   Haltefrist erfuellt, Steuerfrei, Boerse
 */

import type { ReportData } from '@cryptax/shared';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const BOM = '\uFEFF';
const SEP = ';';
const CRLF = '\r\n';

const HEADER_COLUMNS = [
  'Nr',
  'Symbol',
  'Kaufdatum',
  'Verkaufdatum',
  'Menge',
  'Einstandswert EUR',
  'Erloes EUR',
  'Gewinn/Verlust EUR',
  'Gebuehr EUR',
  'Haltedauer Tage',
  'Haltefrist erfuellt',
  'Steuerfrei',
  'Boerse',
] as const;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Escape a CSV field value.
 * If the value contains a semicolon, double-quote, or newline, wrap in double
 * quotes and escape internal double-quotes by doubling them.
 */
export function escapeCsvField(value: string): string {
  if (value.includes(SEP) || value.includes('"') || value.includes('\n') || value.includes('\r')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/**
 * Join an array of string values into a CSV row, applying field escaping.
 */
function buildRow(fields: string[]): string {
  return fields.map(escapeCsvField).join(SEP);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Convert a ReportData object into a UTF-8 CSV string with BOM prefix.
 *
 * The output is suitable for direct download / file-write. The calling code
 * must NOT prepend a BOM — it is included in the returned string.
 *
 * @param data - Fully populated ReportData for a single tax year.
 * @returns CSV string beginning with \uFEFF, lines separated by \r\n.
 */
export function buildCsv(data: ReportData): string {
  const lines: string[] = [];

  // ---------------------------------------------------------------------------
  // Header row
  // ---------------------------------------------------------------------------
  lines.push(buildRow([...HEADER_COLUMNS]));

  // ---------------------------------------------------------------------------
  // Data rows — one per TradeAppendixRow
  // ---------------------------------------------------------------------------
  data.tradeAppendix.forEach((row, index) => {
    const jaOrNein = row.haltefristMet ? 'Ja' : 'Nein';

    lines.push(
      buildRow([
        String(index + 1),           // Nr (1-indexed)
        row.symbol,                   // Symbol
        row.buyDate,                  // Kaufdatum
        row.sellDate,                 // Verkaufdatum
        row.amountConsumed,           // Menge
        row.costBasisEur,             // Einstandswert EUR
        row.proceedsEur,              // Erloes EUR
        row.gainLossEur,              // Gewinn/Verlust EUR
        row.feeEur,                   // Gebuehr EUR
        String(row.heldDays),         // Haltedauer Tage
        jaOrNein,                     // Haltefrist erfuellt
        jaOrNein,                     // Steuerfrei (same logic, explicit column)
        row.exchange,                 // Boerse
      ])
    );
  });

  // ---------------------------------------------------------------------------
  // Summary section — blank separator row then key tax figures
  // ---------------------------------------------------------------------------
  const freigrenzeLabel =
    data.spotSummary.freigrenzeStatus === 'under' ? 'Eingehalten' : 'Ueberschritten';

  lines.push('');                                                            // blank row
  lines.push(buildRow(['Zusammenfassung', '']));
  lines.push(buildRow(['Steuerjahr', String(data.taxYear)]));
  lines.push(buildRow(['Spot Netto EUR', data.spotSummary.netEur]));
  lines.push(buildRow(['Spot Freigrenze', freigrenzeLabel]));
  lines.push(buildRow(['Futures Netto EUR', data.futuresSummary.netEur]));
  lines.push(buildRow(['Geschaetzte Abgeltungssteuer EUR', data.futuresSummary.estimatedTaxEur]));
  lines.push(buildRow(['Staking Einkommen EUR', data.earnSummary.totalIncomeEur]));

  // Join all lines with CRLF, add trailing CRLF, prepend BOM
  return BOM + lines.join(CRLF) + CRLF;
}
