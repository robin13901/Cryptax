/**
 * PDF Builder — converts a ReportData object into a Finanzamt-ready PDF.
 *
 * Output: A4, portrait, embedded DejaVu Sans (Latin Extended — German umlauts).
 *
 * Structure:
 *   Page 1 — Cover: title, year, generation date, disclaimer
 *   Page 2+ — Anlage SO (§23 EStG spot trades)
 *             Anlage KAP (§20 EStG futures P&L)
 *             Staking/Earn (§22 Nr. 3 EStG)
 *             Handelsanhang (trade appendix — all lot consumptions, paginated)
 *
 * Every page has a footer: "Seite X von Y  |  Erstellt: dd.MM.yyyy"
 * injected post-hoc via PDFKit bufferPages.
 *
 * German character support: DejaVu Sans TTF files embedded at build time.
 * The fonts are SIL Open Font License — free to bundle.
 */

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import type { ReportData, TradeAppendixRow } from '@cryptax/shared';

// ---------------------------------------------------------------------------
// PDFKit — CJS module, must use createRequire in ESM context
// ---------------------------------------------------------------------------

const require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
const PDFDocument = require('pdfkit') as new (options?: Record<string, unknown>) => PDFKit.PDFDocument;

// ---------------------------------------------------------------------------
// Constants — branding palette
// ---------------------------------------------------------------------------

const CRYPTO_BLUE = '#0070F2';
const CRYPTO_NAVY = '#354A5F';
const COLOR_GREEN = '#5fdc8a';
const COLOR_RED = '#e50000';
const COLOR_WHITE = '#FFFFFF';
const COLOR_TEXT = '#1A1A2E';
const COLOR_MUTED = '#6B7280';

// A4 at 72 dpi points
const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const MARGIN = 50;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;

// Font size constants
const SIZE_H1 = 24;
const SIZE_H2 = 14;
const SIZE_BODY = 10;
const SIZE_SMALL = 8.5;
const SIZE_TINY = 8;

// Footer baseline
const FOOTER_Y = PAGE_HEIGHT - 30;

// ---------------------------------------------------------------------------
// Font resolution — relative to this file's compiled location
// ---------------------------------------------------------------------------

const __dirname = dirname(fileURLToPath(import.meta.url));
const FONT_REGULAR = join(__dirname, '../assets/fonts/DejaVuSans.ttf');
const FONT_BOLD = join(__dirname, '../assets/fonts/DejaVuSans-Bold.ttf');

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

/**
 * Format a MoneyString (decimal string like "1234.56") as German currency.
 * Output examples:  "1.234,56 EUR"  "-500,00 EUR"
 */
export function formatEurPdf(value: string): string {
  const num = parseFloat(value);
  return new Intl.NumberFormat('de-DE', {
    style: 'currency',
    currency: 'EUR',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(num);
}

/**
 * Format a Date as "dd.MM.yyyy" (German short date).
 */
function formatDateGerman(date: Date): string {
  return new Intl.DateTimeFormat('de-DE', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(date);
}

// ---------------------------------------------------------------------------
// Drawing helpers — exported so plan 06-03 (trade appendix) can reuse them
// ---------------------------------------------------------------------------

/**
 * Draw a colored header bar with white text for a section heading.
 *
 * @param doc      PDFKit document
 * @param y        Top y-coordinate of the bar
 * @param label    Section title text
 * @returns        Y position just below the header bar
 */
export function sectionHeader(doc: PDFKit.PDFDocument, y: number, label: string): number {
  const BAR_HEIGHT = 22;
  const TEXT_Y = y + 5;

  doc
    .rect(MARGIN, y, CONTENT_WIDTH, BAR_HEIGHT)
    .fill(CRYPTO_BLUE);

  doc
    .font('Bold')
    .fontSize(SIZE_H2)
    .fillColor(COLOR_WHITE)
    .text(label, MARGIN + 8, TEXT_Y, { width: CONTENT_WIDTH - 16, lineBreak: false });

  return y + BAR_HEIGHT + 10;
}

/**
 * Draw a key-value row at the current y position.
 * Label on the left, value right-aligned within content width.
 *
 * @param doc    PDFKit document
 * @param y      Top y-coordinate
 * @param label  Left-side label text
 * @param value  Right-side value text
 * @param valueColor  Optional color for the value (default: COLOR_TEXT)
 * @returns      Y just below the rendered row
 */
export function keyValueLine(
  doc: PDFKit.PDFDocument,
  y: number,
  label: string,
  value: string,
  valueColor: string = COLOR_TEXT,
): number {
  const LINE_H = 16;
  const VALUE_COL = MARGIN + CONTENT_WIDTH * 0.55;
  const VALUE_WIDTH = CONTENT_WIDTH * 0.45;

  doc
    .font('Regular')
    .fontSize(SIZE_BODY)
    .fillColor(COLOR_MUTED)
    .text(label, MARGIN, y, { width: CONTENT_WIDTH * 0.55, lineBreak: false });

  doc
    .font('Bold')
    .fontSize(SIZE_BODY)
    .fillColor(valueColor)
    .text(value, VALUE_COL, y, { width: VALUE_WIDTH, align: 'right', lineBreak: false });

  return y + LINE_H;
}

/**
 * Draw a thin separator line.
 */
function separatorLine(doc: PDFKit.PDFDocument, y: number): number {
  doc
    .moveTo(MARGIN, y)
    .lineTo(MARGIN + CONTENT_WIDTH, y)
    .strokeColor('#E5E7EB')
    .lineWidth(0.5)
    .stroke();
  return y + 8;
}

/**
 * Add a page break. Returns the new y starting position (after top margin).
 */
function newPage(doc: PDFKit.PDFDocument): number {
  doc.addPage();
  return MARGIN;
}

/**
 * Inject footer text into a page. Call after switching to the page.
 */
function drawFooter(doc: PDFKit.PDFDocument, pageNum: number, total: number, dateStr: string): void {
  const text = `Seite ${pageNum} von ${total}  |  Erstellt: ${dateStr}`;
  doc
    .font('Regular')
    .fontSize(SIZE_TINY)
    .fillColor(COLOR_MUTED)
    .text(text, MARGIN, FOOTER_Y, { width: CONTENT_WIDTH, align: 'center', lineBreak: false });
}

// ---------------------------------------------------------------------------
// Cover page
// ---------------------------------------------------------------------------

function buildCoverPage(doc: PDFKit.PDFDocument, data: ReportData): void {
  const generatedDate = formatDateGerman(new Date(data.generatedAt));

  // Top accent bar
  doc.rect(0, 0, PAGE_WIDTH, 6).fill(CRYPTO_BLUE);

  // Logo area / brand block
  doc
    .rect(MARGIN, 80, 4, 60)
    .fill(CRYPTO_BLUE);

  // Title
  doc
    .font('Bold')
    .fontSize(SIZE_H1)
    .fillColor(CRYPTO_NAVY)
    .text('Krypto-Steuerreport', MARGIN + 20, 85, { width: CONTENT_WIDTH - 20 });

  doc
    .font('Bold')
    .fontSize(SIZE_H1 + 4)
    .fillColor(CRYPTO_BLUE)
    .text(String(data.taxYear), MARGIN + 20, 118, { width: CONTENT_WIDTH - 20 });

  // Subtitle
  doc
    .font('Regular')
    .fontSize(SIZE_BODY)
    .fillColor(COLOR_MUTED)
    .text(`Erstellt am ${generatedDate}`, MARGIN + 20, 160, { width: CONTENT_WIDTH - 20 });

  // Decorative divider
  doc
    .rect(MARGIN, 185, CONTENT_WIDTH, 1.5)
    .fill(CRYPTO_BLUE);

  // Summary cards — quick overview
  const cardY = 215;
  const cardW = (CONTENT_WIDTH - 20) / 3;

  const cards = [
    { label: 'Spot-Trades', value: `${data.spotSummary.tradeCount} Transaktionen` },
    { label: 'Futures-Positionen', value: `${data.futuresSummary.tradeCount} Positionen` },
    { label: 'Staking-Ertraege', value: `${data.earnSummary.recordCount} Eintraege` },
  ];

  cards.forEach((card, i) => {
    const x = MARGIN + i * (cardW + 10);
    doc.rect(x, cardY, cardW, 60).fillAndStroke('#F8FAFC', '#E5E7EB');
    doc
      .font('Bold')
      .fontSize(SIZE_SMALL)
      .fillColor(CRYPTO_NAVY)
      .text(card.label, x + 10, cardY + 12, { width: cardW - 20, lineBreak: false });
    doc
      .font('Regular')
      .fontSize(SIZE_SMALL)
      .fillColor(COLOR_MUTED)
      .text(card.value, x + 10, cardY + 30, { width: cardW - 20, lineBreak: false });
  });

  // Disclaimer
  const disclaimerY = PAGE_HEIGHT - 200;
  doc
    .rect(MARGIN, disclaimerY, CONTENT_WIDTH, 80)
    .fillAndStroke('#FFF8DC', '#E5C100');

  doc
    .font('Bold')
    .fontSize(SIZE_SMALL)
    .fillColor('#7A6200')
    .text('Hinweis', MARGIN + 12, disclaimerY + 10, { width: CONTENT_WIDTH - 24 });

  doc
    .font('Regular')
    .fontSize(SIZE_SMALL)
    .fillColor('#7A6200')
    .text(
      'Dieser Report dient ausschliesslich der Dokumentation und stellt keine steuerliche Beratung dar. ' +
      'Bitte konsultieren Sie Ihren Steuerberater oder Steuerfachmann fuer eine verbindliche Auskunft. ' +
      'Angaben ohne Gewaehr.',
      MARGIN + 12,
      disclaimerY + 25,
      { width: CONTENT_WIDTH - 24 },
    );

  // Bottom accent
  doc.rect(0, PAGE_HEIGHT - 6, PAGE_WIDTH, 6).fill(CRYPTO_BLUE);
}

// ---------------------------------------------------------------------------
// Anlage SO — §23 EStG Spot Trades
// ---------------------------------------------------------------------------

function buildAnlageSOSection(doc: PDFKit.PDFDocument, data: ReportData, startY: number): number {
  const spot = data.spotSummary;
  let y = startY;

  y = sectionHeader(doc, y, 'Anlage SO \u2014 Private Ver\u00e4u\u00dferungsgesch\u00e4fte (\u00a723 EStG)');

  // Legal context
  doc
    .font('Regular')
    .fontSize(SIZE_SMALL)
    .fillColor(COLOR_MUTED)
    .text(
      'Kryptow\u00e4hrungsgewinne aus Verau\u00dferungen innerhalb der Haltefrist (< 1 Jahr) unterliegen der Einkommensteuer. ' +
      'Freigrenze: 1.000 EUR/Jahr (Klippe \u2014 bei \u00dcberschreitung wird der Gesamtbetrag steuerpflichtig).',
      MARGIN,
      y,
      { width: CONTENT_WIDTH },
    );

  y += 28;
  y = separatorLine(doc, y);

  y = keyValueLine(doc, y, 'Gesamtgewinn (Verkaufe mit Gewinn)', formatEurPdf(spot.totalGainsEur), COLOR_GREEN);
  y = keyValueLine(doc, y, 'Gesamtverlust (Verkaeufe mit Verlust)', formatEurPdf(spot.totalLossesEur), COLOR_RED);

  y = separatorLine(doc, y);

  const netColor = parseFloat(spot.netEur) >= 0 ? COLOR_GREEN : COLOR_RED;
  y = keyValueLine(doc, y, 'Netto (Gewinn minus Verlust)', formatEurPdf(spot.netEur), netColor);
  y = keyValueLine(doc, y, 'Steuerpflichtiger Betrag', formatEurPdf(spot.taxableAmountEur));

  y += 6;

  // Freigrenze status — prominent badge
  const freiBadgeColor = spot.freigrenzeStatus === 'under' ? COLOR_GREEN : COLOR_RED;
  const freiLabel =
    spot.freigrenzeStatus === 'under'
      ? 'Freigrenze (1.000 EUR): eingehalten \u2014 kein steuerpflichtiger Betrag'
      : 'Freigrenze (1.000 EUR): \u00fcberschritten \u2014 Gesamtbetrag steuerpflichtig';

  doc
    .rect(MARGIN, y, CONTENT_WIDTH, 20)
    .fill(freiBadgeColor + '22'); // translucent background

  doc
    .font('Bold')
    .fontSize(SIZE_SMALL)
    .fillColor(freiBadgeColor)
    .text(freiLabel, MARGIN + 8, y + 5, { width: CONTENT_WIDTH - 16, lineBreak: false });

  y += 28;
  y = separatorLine(doc, y);

  y = keyValueLine(doc, y, 'Anzahl Trades (steuerpflichtig)', String(spot.tradeCount));
  y = keyValueLine(doc, y, 'Steuerfreie Trades (Haltefrist erf\u00fcllt)', String(spot.taxFreeTradeCount), COLOR_GREEN);
  y = keyValueLine(doc, y, 'Freigrenze-Schwelle', formatEurPdf(spot.freigrenzeLimitEur));

  return y + 16;
}

// ---------------------------------------------------------------------------
// Anlage KAP — §20 EStG Futures P&L
// ---------------------------------------------------------------------------

function buildAnlageKAPSection(doc: PDFKit.PDFDocument, data: ReportData, startY: number): number {
  const futures = data.futuresSummary;
  let y = startY;

  y = sectionHeader(doc, y, 'Anlage KAP \u2014 Einku\u0308nfte aus Kapitalverm\u00f6gen (\u00a720 EStG)');

  doc
    .font('Regular')
    .fontSize(SIZE_SMALL)
    .fillColor(COLOR_MUTED)
    .text(
      'Gewinne aus Krypto-Futures unterliegen der Abgeltungssteuer (25% + 5,5% Solidarit\u00e4tszuschlag = 26,375%). ' +
      'Keine Freigrenze; positives Netto ist voll steuerpflichtig.',
      MARGIN,
      y,
      { width: CONTENT_WIDTH },
    );

  y += 28;
  y = separatorLine(doc, y);

  y = keyValueLine(doc, y, 'Gesamtgewinn (profitable Positionen)', formatEurPdf(futures.totalGainsEur), COLOR_GREEN);
  y = keyValueLine(doc, y, 'Gesamtverlust (Verlustpositionen)', formatEurPdf(futures.totalLossesEur), COLOR_RED);
  y = keyValueLine(doc, y, 'Geb\u00fchren (Trading + Funding)', formatEurPdf(futures.totalFeesEur), COLOR_MUTED);

  y = separatorLine(doc, y);

  const futNetColor = parseFloat(futures.netEur) >= 0 ? COLOR_GREEN : COLOR_RED;
  y = keyValueLine(doc, y, 'Netto P&L', formatEurPdf(futures.netEur), futNetColor);
  y = keyValueLine(doc, y, 'Steuerpflichtiger Betrag', formatEurPdf(futures.taxableAmountEur));

  y = separatorLine(doc, y);

  y = keyValueLine(
    doc, y,
    'Gesch\u00e4tzte Abgeltungssteuer (26,375%)',
    formatEurPdf(futures.estimatedTaxEur),
    parseFloat(futures.estimatedTaxEur) > 0 ? COLOR_RED : COLOR_MUTED,
  );

  y = keyValueLine(doc, y, 'Anzahl Positionen', String(futures.tradeCount));

  y += 8;

  // Footnote
  doc
    .font('Regular')
    .fontSize(SIZE_TINY)
    .fillColor(COLOR_MUTED)
    .text(
      '* Abgeltungssteuer: 25% + 5,5% Solidarit\u00e4tszuschlag = 26,375% auf den steuerpflichtigen Betrag.',
      MARGIN,
      y,
      { width: CONTENT_WIDTH },
    );

  return y + 20;
}

// ---------------------------------------------------------------------------
// Staking / Earn — §22 Nr. 3 EStG
// ---------------------------------------------------------------------------

function buildStakingSection(doc: PDFKit.PDFDocument, data: ReportData, startY: number): number {
  const earn = data.earnSummary;
  let y = startY;

  y = sectionHeader(doc, y, 'Einku\u0308nfte aus Staking/Earn (\u00a722 Nr. 3 EStG)');

  doc
    .font('Regular')
    .fontSize(SIZE_SMALL)
    .fillColor(COLOR_MUTED)
    .text(
      'Staking- und Earn-Ertr\u00e4ge z\u00e4hlen als sonstige Einku\u0308nfte und unterliegen dem pers\u00f6nlichen Steuersatz. ' +
      'Freigrenze: 256 EUR/Jahr (Klippe).',
      MARGIN,
      y,
      { width: CONTENT_WIDTH },
    );

  y += 28;
  y = separatorLine(doc, y);

  const incomeColor = parseFloat(earn.totalIncomeEur) > 0 ? COLOR_TEXT : COLOR_MUTED;
  y = keyValueLine(doc, y, 'Gesamteinkommen (EUR-Wert bei Erhalt)', formatEurPdf(earn.totalIncomeEur), incomeColor);
  y = keyValueLine(doc, y, 'Anzahl Eintr\u00e4ge', String(earn.recordCount));
  y = keyValueLine(doc, y, 'Freigrenze-Schwelle', formatEurPdf(earn.freigrenzeLimitEur));

  y += 4;

  // Freigrenze status badge
  const earnFreiBadgeColor = earn.freigrenzeStatus === 'under' ? COLOR_GREEN : COLOR_RED;
  const earnFreiLabel =
    earn.freigrenzeStatus === 'under'
      ? 'Freigrenze (256 EUR): eingehalten \u2014 kein steuerpflichtiger Betrag'
      : 'Freigrenze (256 EUR): \u00fcberschritten \u2014 Gesamtbetrag steuerpflichtig';

  doc
    .rect(MARGIN, y, CONTENT_WIDTH, 20)
    .fill(earnFreiBadgeColor + '22');

  doc
    .font('Bold')
    .fontSize(SIZE_SMALL)
    .fillColor(earnFreiBadgeColor)
    .text(earnFreiLabel, MARGIN + 8, y + 5, { width: CONTENT_WIDTH - 16, lineBreak: false });

  y += 28;

  // Per-coin breakdown mini-table (if any data)
  if (earn.perCoinBreakdown.length > 0) {
    y = separatorLine(doc, y);

    // Table header
    const COL_SYMBOL = MARGIN;
    const COL_BETRAG = MARGIN + CONTENT_WIDTH * 0.5;
    const COL_ANZAHL = MARGIN + CONTENT_WIDTH * 0.8;
    const COL_W = CONTENT_WIDTH * 0.28;

    doc
      .font('Bold')
      .fontSize(SIZE_SMALL)
      .fillColor(CRYPTO_NAVY)
      .text('Symbol', COL_SYMBOL, y, { width: COL_W, lineBreak: false })
      .text('Betrag EUR', COL_BETRAG, y, { width: COL_W, align: 'right', lineBreak: false })
      .text('Anzahl', COL_ANZAHL, y, { width: COL_W, align: 'right', lineBreak: false });

    y += 14;
    y = separatorLine(doc, y);

    earn.perCoinBreakdown.forEach((coin, i) => {
      // Alternating row background
      if (i % 2 === 0) {
        doc.rect(MARGIN, y - 2, CONTENT_WIDTH, 14).fill('#F8FAFC');
      }

      doc
        .font('Bold')
        .fontSize(SIZE_SMALL)
        .fillColor(CRYPTO_NAVY)
        .text(coin.symbol, COL_SYMBOL, y, { width: COL_W, lineBreak: false });

      doc
        .font('Regular')
        .fontSize(SIZE_SMALL)
        .fillColor(COLOR_TEXT)
        .text(formatEurPdf(coin.totalEur), COL_BETRAG, y, { width: COL_W, align: 'right', lineBreak: false })
        .text(String(coin.count), COL_ANZAHL, y, { width: COL_W, align: 'right', lineBreak: false });

      y += 14;
    });
  }

  return y + 16;
}

// ---------------------------------------------------------------------------
// Trade Appendix — Handelsanhang (all lot consumptions, paginated)
// ---------------------------------------------------------------------------

// Table column definitions for the trade appendix
const TRADE_COLUMNS = [
  'Symbol',
  'Kaufdatum',
  'Verkaufdatum',
  'Menge',
  'Einstandswert',
  'Erl\u00f6s',
  'G/V EUR',
  'Tage',
  'Haltefrist',
] as const;

// Column widths must sum to CONTENT_WIDTH (495pt)
// 50 + 62 + 62 + 50 + 66 + 66 + 60 + 30 + 49 = 495
const TRADE_COL_WIDTHS = [50, 62, 62, 50, 66, 66, 60, 30, 49];

// Row height in points (7pt font + padding)
const TRADE_ROW_H = 14;

// Header row height
const TRADE_HEADER_H = 16;

// Bottom threshold: rows below this y trigger a new page
const TRADE_PAGE_BOTTOM = 770;

// Table header background color
const TABLE_HEADER_BG = CRYPTO_NAVY;

// Alternating row colors
const ROW_BG_EVEN = '#FFFFFF';
const ROW_BG_ODD = '#F5F5F5';

// Gain/loss colors (more legible on small text than the branding green/red)
const GAIN_COLOR = '#1a7a40';
const LOSS_COLOR = '#c0392b';

// Tax-free row left-border accent color
const TAX_FREE_ACCENT = '#1a7a40';

/**
 * Convert an ISO date string (date-only or full datetime) to dd.MM.yyyy format.
 * e.g. "2024-03-15" → "15.03.2024"
 *      "2024-03-15T14:30:00Z" → "15.03.2024"
 */
export function formatDateDe(isoDate: string): string {
  // Parse YYYY-MM-DD prefix to avoid timezone issues
  const datePart = isoDate.slice(0, 10); // "YYYY-MM-DD"
  const [year, month, day] = datePart.split('-');
  return `${day}.${month}.${year}`;
}

/**
 * Draw the trade appendix table header row at position y.
 * Returns y position just below the header row.
 */
function drawTradeTableHeader(doc: PDFKit.PDFDocument, y: number): number {
  // Background bar
  doc
    .rect(MARGIN, y, CONTENT_WIDTH, TRADE_HEADER_H)
    .fill(TABLE_HEADER_BG);

  let x = MARGIN;
  TRADE_COLUMNS.forEach((col, i) => {
    const w = TRADE_COL_WIDTHS[i];
    const isNumeric = i >= 3; // Menge and onwards are right-aligned
    doc
      .font('Bold')
      .fontSize(7)
      .fillColor(COLOR_WHITE)
      .text(col, x + 2, y + 4, {
        width: w - 4,
        align: isNumeric ? 'right' : 'left',
        lineBreak: false,
      });
    x += w;
  });

  return y + TRADE_HEADER_H;
}

/**
 * Draw a single trade appendix data row at position y.
 * Returns y position just below the row.
 */
function drawTradeRow(
  doc: PDFKit.PDFDocument,
  row: TradeAppendixRow,
  y: number,
  rowIndex: number,
): number {
  // Alternating row background
  const bgColor = rowIndex % 2 === 0 ? ROW_BG_EVEN : ROW_BG_ODD;
  doc.rect(MARGIN, y, CONTENT_WIDTH, TRADE_ROW_H).fill(bgColor);

  // Tax-free rows: left accent border (3pt green strip)
  if (row.haltefristMet) {
    doc.rect(MARGIN, y, 3, TRADE_ROW_H).fill(TAX_FREE_ACCENT);
  }

  const gainLoss = parseFloat(row.gainLossEur);
  const glColor = gainLoss >= 0 ? GAIN_COLOR : LOSS_COLOR;

  // Format values
  const cells = [
    row.symbol,
    formatDateDe(row.buyDate),
    formatDateDe(row.sellDate),
    parseFloat(row.amountConsumed).toFixed(4),
    formatEurPdf(row.costBasisEur),
    formatEurPdf(row.proceedsEur),
    formatEurPdf(row.gainLossEur),
    String(row.heldDays),
    row.haltefristMet ? 'Ja' : 'Nein',
  ];

  const cellColors = [
    COLOR_TEXT, COLOR_TEXT, COLOR_TEXT, COLOR_TEXT,
    COLOR_TEXT, COLOR_TEXT,
    glColor,  // G/V column
    COLOR_TEXT,
    row.haltefristMet ? GAIN_COLOR : COLOR_TEXT, // Haltefrist column
  ];

  let x = MARGIN;
  cells.forEach((cell, i) => {
    const w = TRADE_COL_WIDTHS[i];
    const isNumeric = i >= 3;

    // Tax-free rows: use italic-style by using Regular (no italic variant in DejaVu bundled)
    // Visual distinction is provided by the green left-border accent
    doc
      .font(i === 0 ? 'Bold' : 'Regular') // bold symbol column
      .fontSize(7)
      .fillColor(cellColors[i])
      .text(cell, x + (row.haltefristMet && i === 0 ? 5 : 2), y + 3, {
        width: w - (row.haltefristMet && i === 0 ? 7 : 4),
        align: isNumeric ? 'right' : 'left',
        lineBreak: false,
        ellipsis: true,
      });
    x += w;
  });

  return y + TRADE_ROW_H;
}

/**
 * Build the trade appendix section.
 * Adds new pages and repeats the header as needed (pagination).
 *
 * @param doc   PDFKit document
 * @param rows  All TradeAppendixRow entries for the year
 */
function buildTradeAppendix(doc: PDFKit.PDFDocument, rows: TradeAppendixRow[]): void {
  // Always start appendix on a new page
  doc.addPage();
  let y = MARGIN;

  // Section header bar
  doc
    .rect(MARGIN, y, CONTENT_WIDTH, 22)
    .fill(CRYPTO_BLUE);

  doc
    .font('Bold')
    .fontSize(SIZE_H2)
    .fillColor(COLOR_WHITE)
    .text('Handelsanhang \u2014 Alle Transaktionen', MARGIN + 8, y + 5, {
      width: CONTENT_WIDTH - 16,
      lineBreak: false,
    });

  y += 22 + 4;

  // Subtitle
  doc
    .font('Regular')
    .fontSize(7)
    .fillColor(COLOR_MUTED)
    .text(
      'Alle Ver\u00e4u\u00dferungsgesch\u00e4fte inkl. steuerfreie Transaktionen (Haltefrist > 365 Tage) \u2014 ' +
      'Steuerfreie Zeilen: gr\u00fcner Akzentstreifen links',
      MARGIN,
      y,
      { width: CONTENT_WIDTH },
    );

  y += 16;

  if (rows.length === 0) {
    doc
      .font('Regular')
      .fontSize(SIZE_SMALL)
      .fillColor(COLOR_MUTED)
      .text('Keine Transaktionen vorhanden.', MARGIN, y, { width: CONTENT_WIDTH });
    return;
  }

  // Draw initial table header
  y = drawTradeTableHeader(doc, y);

  // Render rows with pagination
  rows.forEach((row, i) => {
    // Check if we need a new page before drawing the next row
    if (y + TRADE_ROW_H > TRADE_PAGE_BOTTOM) {
      doc.addPage();
      y = MARGIN;
      y = drawTradeTableHeader(doc, y);
    }
    y = drawTradeRow(doc, row, y, i);
  });

  // Summary row
  const totalGains = rows.reduce((sum, r) => {
    const v = parseFloat(r.gainLossEur);
    return v > 0 ? sum + v : sum;
  }, 0);
  const totalLosses = rows.reduce((sum, r) => {
    const v = parseFloat(r.gainLossEur);
    return v < 0 ? sum + v : sum;
  }, 0);
  const netTotal = totalGains + totalLosses;

  // Ensure summary row fits on current page
  if (y + TRADE_ROW_H + 8 > TRADE_PAGE_BOTTOM) {
    doc.addPage();
    y = MARGIN;
  }

  y += 6;

  // Summary separator line
  doc
    .moveTo(MARGIN, y)
    .lineTo(MARGIN + CONTENT_WIDTH, y)
    .strokeColor(CRYPTO_NAVY)
    .lineWidth(0.75)
    .stroke();

  y += 4;

  const netColor = netTotal >= 0 ? GAIN_COLOR : LOSS_COLOR;

  doc
    .font('Bold')
    .fontSize(7.5)
    .fillColor(CRYPTO_NAVY)
    .text(
      `Gesamt: ${rows.length} Transaktionen`,
      MARGIN,
      y,
      { width: 160, lineBreak: false },
    );

  doc
    .font('Regular')
    .fontSize(7.5)
    .fillColor(GAIN_COLOR)
    .text(
      `Gewinn: ${formatEurPdf(String(totalGains.toFixed(2)))}`,
      MARGIN + 165,
      y,
      { width: 120, lineBreak: false },
    );

  doc
    .font('Regular')
    .fontSize(7.5)
    .fillColor(LOSS_COLOR)
    .text(
      `Verlust: ${formatEurPdf(String(totalLosses.toFixed(2)))}`,
      MARGIN + 290,
      y,
      { width: 120, lineBreak: false },
    );

  doc
    .font('Bold')
    .fontSize(7.5)
    .fillColor(netColor)
    .text(
      `Netto: ${formatEurPdf(String(netTotal.toFixed(2)))}`,
      MARGIN + 415,
      y,
      { width: 80, lineBreak: false },
    );
}

// ---------------------------------------------------------------------------
// Main buildPdf function
// ---------------------------------------------------------------------------

/** Options for buildPdf — primarily used in tests. */
export interface BuildPdfOptions {
  /** Set to true to disable stream compression (useful for content inspection in tests). */
  compress?: boolean;
}

/**
 * Build a Finanzamt-ready PDF document from a ReportData object.
 *
 * @param data    - Fully populated ReportData for a single tax year.
 * @param options - Optional build options (e.g. compress: false for tests).
 * @returns       Promise resolving to a Buffer containing the complete PDF.
 */
export function buildPdf(data: ReportData, options: BuildPdfOptions = {}): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    const compress = options.compress !== false; // default true; pass false for test content inspection

    const doc = new PDFDocument({
      size: 'A4',
      margins: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN },
      bufferPages: true,
      compress,
      info: {
        Title: `Krypto-Steuerreport ${data.taxYear}`,
        Author: 'Cryptax',
        Subject: `Steuerjahr ${data.taxYear} - Anlage SO KAP Staking`,
        Keywords: `Krypto-Steuerreport ${data.taxYear} Anlage SO Anlage KAP Staking Earn EStG Freigrenze`,
      },
    }) as PDFKit.PDFDocument;

    // Register DejaVu Sans fonts (Latin Extended — German umlauts)
    doc.registerFont('Regular', FONT_REGULAR);
    doc.registerFont('Bold', FONT_BOLD);

    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('error', (err: Error) => reject(err));
    doc.on('end', () => resolve(Buffer.concat(chunks)));

    const generatedDate = formatDateGerman(new Date(data.generatedAt));

    // -----------------------------------------------------------------------
    // Page 1: Cover
    // -----------------------------------------------------------------------
    buildCoverPage(doc, data);

    // -----------------------------------------------------------------------
    // Page 2+: Summary sections
    // -----------------------------------------------------------------------
    let y = newPage(doc);

    // Section title for the summary page
    doc
      .font('Bold')
      .fontSize(SIZE_H2)
      .fillColor(CRYPTO_NAVY)
      .text('Steuerliche Zusammenfassung', MARGIN, y);
    y += 28;

    // Anlage SO
    y = buildAnlageSOSection(doc, data, y);
    y += 10;

    // Check if we need a new page for Anlage KAP
    if (y > PAGE_HEIGHT - 200) {
      y = newPage(doc);
    }

    y = buildAnlageKAPSection(doc, data, y);
    y += 10;

    // Check if we need a new page for Staking section
    if (y > PAGE_HEIGHT - 220) {
      y = newPage(doc);
    }

    y = buildStakingSection(doc, data, y);

    // -----------------------------------------------------------------------
    // Trade Appendix — Handelsanhang (all lot consumptions, paginated)
    // -----------------------------------------------------------------------
    buildTradeAppendix(doc, data.tradeAppendix);

    // -----------------------------------------------------------------------
    // Post-hoc page number injection
    // -----------------------------------------------------------------------
    const range = doc.bufferedPageRange();
    const totalPages = range.count;

    for (let i = 0; i < totalPages; i++) {
      doc.switchToPage(range.start + i);
      drawFooter(doc, i + 1, totalPages, generatedDate);
    }

    // Flush buffered pages then end the document
    doc.flushPages();
    doc.end();
  });
}
