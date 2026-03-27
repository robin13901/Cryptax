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
 *             Handelsanhang — Spot (trade appendix — grouped by sell, paginated)
 *             Handelsanhang — Futures (futures positions, paginated)
 *
 * Every page has a footer: "Seite X von Y  |  Erstellt: dd.MM.yyyy"
 * injected post-hoc via PDFKit bufferPages.
 *
 * German character support: DejaVu Sans TTF files embedded at build time.
 * The fonts are SIL Open Font License — free to bundle.
 */

import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FuturesAppendixRow, ReportData, TradeAppendixRow } from '@cryptax/shared';

// ---------------------------------------------------------------------------
// PDFKit — CJS module, must use createRequire in ESM context
// ---------------------------------------------------------------------------

const require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
const PDFDocument = require('pdfkit') as new (
  options?: Record<string, unknown>
) => PDFKit.PDFDocument;

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

  doc.rect(MARGIN, y, CONTENT_WIDTH, BAR_HEIGHT).fill(CRYPTO_BLUE);

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
  valueColor: string = COLOR_TEXT
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
 * Draws footer on the new page using the tracked page counter.
 */
function newPage(doc: PDFKit.PDFDocument, pageCounter: { count: number }, dateStr: string): number {
  doc.addPage();
  pageCounter.count += 1;
  drawFooter(doc, pageCounter.count, dateStr);
  return MARGIN;
}

/**
 * Draw footer directly at fixed position using low-level save/restore
 * to avoid PDFKit's automatic page-break behavior.
 */
function drawFooter(doc: PDFKit.PDFDocument, pageNum: number, dateStr: string): void {
  const text = `Seite ${pageNum}  |  Erstellt: ${dateStr}`;
  // Save graphics state, position text absolutely, restore
  doc.save();
  doc.font('Regular').fontSize(SIZE_TINY).fillColor(COLOR_MUTED);
  // Use low-level _fragment to avoid auto-pagination
  const textWidth = doc.widthOfString(text);
  const x = MARGIN + (CONTENT_WIDTH - textWidth) / 2;
  doc.text(text, x, FOOTER_Y, { lineBreak: false });
  doc.restore();
}

// ---------------------------------------------------------------------------
// Cover page
// ---------------------------------------------------------------------------

function buildCoverPage(
  doc: PDFKit.PDFDocument,
  data: ReportData,
  pageCounter: { count: number },
  _dateStr: string
): void {
  doc.addPage();
  pageCounter.count += 1;
  const generatedDate = formatDateGerman(new Date(data.generatedAt));

  // Top accent bar
  doc.rect(0, 0, PAGE_WIDTH, 6).fill(CRYPTO_BLUE);

  // Logo area / brand block
  doc.rect(MARGIN, 80, 4, 60).fill(CRYPTO_BLUE);

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
  doc.rect(MARGIN, 185, CONTENT_WIDTH, 1.5).fill(CRYPTO_BLUE);

  // Summary cards — quick overview
  const cardY = 215;
  const cardW = (CONTENT_WIDTH - 20) / 3;

  const cards = [
    { label: 'Spot-Trades', value: `${data.spotSummary.tradeCount} Transaktionen` },
    { label: 'Futures-Positionen', value: `${data.futuresSummary.tradeCount} Positionen` },
    { label: 'Staking-Erträge', value: `${data.earnSummary.recordCount} Einträge` },
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
  doc.rect(MARGIN, disclaimerY, CONTENT_WIDTH, 80).fillAndStroke('#FFF8DC', '#E5C100');

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
      'Dieser Report dient ausschließlich der Dokumentation und stellt keine steuerliche Beratung dar. ' +
        'Bitte konsultieren Sie Ihren Steuerberater oder Steuerfachmann für eine verbindliche Auskunft. ' +
        'Angaben ohne Gewähr.',
      MARGIN + 12,
      disclaimerY + 25,
      { width: CONTENT_WIDTH - 24 }
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

  y = sectionHeader(
    doc,
    y,
    'Anlage SO \u2014 Private Ver\u00e4u\u00dferungsgesch\u00e4fte (\u00a723 EStG)'
  );

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
      { width: CONTENT_WIDTH }
    );

  y += 28;
  y = separatorLine(doc, y);

  y = keyValueLine(
    doc,
    y,
    'Gesamtgewinn (Verkaufe mit Gewinn)',
    formatEurPdf(spot.totalGainsEur),
    COLOR_GREEN
  );
  y = keyValueLine(
    doc,
    y,
    'Gesamtverlust (Verkaeufe mit Verlust)',
    formatEurPdf(spot.totalLossesEur),
    COLOR_RED
  );

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
    .fill(spot.freigrenzeStatus === 'under' ? '#E8F5E9' : '#FFEBEE');

  doc
    .font('Bold')
    .fontSize(SIZE_SMALL)
    .fillColor(freiBadgeColor)
    .text(freiLabel, MARGIN + 8, y + 5, { width: CONTENT_WIDTH - 16, lineBreak: false });

  y += 28;
  y = separatorLine(doc, y);

  y = keyValueLine(doc, y, 'Anzahl Trades (steuerpflichtig)', String(spot.tradeCount));
  y = keyValueLine(
    doc,
    y,
    'Steuerfreie Trades (Haltefrist erf\u00fcllt)',
    String(spot.taxFreeTradeCount),
    COLOR_GREEN
  );
  y = keyValueLine(doc, y, 'Freigrenze-Schwelle', formatEurPdf(spot.freigrenzeLimitEur));

  return y + 16;
}

// ---------------------------------------------------------------------------
// Anlage KAP — §20 EStG Futures P&L
// ---------------------------------------------------------------------------

function buildAnlageKAPSection(doc: PDFKit.PDFDocument, data: ReportData, startY: number): number {
  const futures = data.futuresSummary;
  let y = startY;

  y = sectionHeader(
    doc,
    y,
    'Anlage KAP \u2014 Einku\u0308nfte aus Kapitalverm\u00f6gen (\u00a720 EStG)'
  );

  doc
    .font('Regular')
    .fontSize(SIZE_SMALL)
    .fillColor(COLOR_MUTED)
    .text(
      'Gewinne aus Krypto-Futures unterliegen der Abgeltungssteuer (25% + 5,5% Solidarit\u00e4tszuschlag = 26,375%). ' +
        'Keine Freigrenze; positives Netto ist voll steuerpflichtig.',
      MARGIN,
      y,
      { width: CONTENT_WIDTH }
    );

  y += 28;
  y = separatorLine(doc, y);

  y = keyValueLine(
    doc,
    y,
    'Gesamtgewinn (profitable Positionen)',
    formatEurPdf(futures.totalGainsEur),
    COLOR_GREEN
  );
  y = keyValueLine(
    doc,
    y,
    'Gesamtverlust (Verlustpositionen)',
    formatEurPdf(futures.totalLossesEur),
    COLOR_RED
  );
  y = keyValueLine(
    doc,
    y,
    'Geb\u00fchren (Trading + Funding)',
    formatEurPdf(futures.totalFeesEur),
    COLOR_MUTED
  );

  y = separatorLine(doc, y);

  const futNetColor = parseFloat(futures.netEur) >= 0 ? COLOR_GREEN : COLOR_RED;
  y = keyValueLine(doc, y, 'Netto P&L', formatEurPdf(futures.netEur), futNetColor);
  y = keyValueLine(doc, y, 'Steuerpflichtiger Betrag', formatEurPdf(futures.taxableAmountEur));

  y = separatorLine(doc, y);

  y = keyValueLine(
    doc,
    y,
    'Gesch\u00e4tzte Abgeltungssteuer (26,375%)',
    formatEurPdf(futures.estimatedTaxEur),
    parseFloat(futures.estimatedTaxEur) > 0 ? COLOR_RED : COLOR_MUTED
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
      { width: CONTENT_WIDTH }
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
      { width: CONTENT_WIDTH }
    );

  y += 28;
  y = separatorLine(doc, y);

  const incomeColor = parseFloat(earn.totalIncomeEur) > 0 ? COLOR_TEXT : COLOR_MUTED;
  y = keyValueLine(
    doc,
    y,
    'Gesamteinkommen (EUR-Wert bei Erhalt)',
    formatEurPdf(earn.totalIncomeEur),
    incomeColor
  );
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
    .fill(earn.freigrenzeStatus === 'under' ? '#E8F5E9' : '#FFEBEE');

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
        .text(formatEurPdf(coin.totalEur), COL_BETRAG, y, {
          width: COL_W,
          align: 'right',
          lineBreak: false,
        })
        .text(String(coin.count), COL_ANZAHL, y, {
          width: COL_W,
          align: 'right',
          lineBreak: false,
        });

      y += 14;
    });
  }

  return y + 16;
}

// ---------------------------------------------------------------------------
// Trade Appendix — Handelsanhang (grouped by sell, paginated)
// ---------------------------------------------------------------------------

// Table column definitions for the trade appendix (10 columns)
const TRADE_COLUMNS = [
  'Symbol',
  'Datum',
  'Richtung',
  'Kurs',
  'Menge',
  'Einstandswert',
  'Erl\u00f6s',
  'G/V EUR',
  'Tage',
  'Haltefrist',
] as const;

// Column widths must sum to CONTENT_WIDTH (495pt)
// 42 + 66 + 40 + 48 + 44 + 60 + 60 + 56 + 26 + 53 = 495
const TRADE_COL_WIDTHS = [42, 66, 40, 48, 44, 60, 60, 56, 26, 53];

// Row height in points (7pt font + padding)
const TRADE_ROW_H = 14;

// Sell header row height (slightly taller)
const TRADE_SELL_ROW_H = 15;

// Header row height
const TRADE_HEADER_H = 16;

// Bottom threshold: rows below this y trigger a new page
const TRADE_PAGE_BOTTOM = 770;

// Table header background color
const TABLE_HEADER_BG = CRYPTO_NAVY;

// Alternating row colors
const ROW_BG_EVEN = '#FFFFFF';
const ROW_BG_ODD = '#F5F5F5';

// Sell header background
const SELL_HEADER_BG = '#EBF2FC';

// Buy sub-row background
const BUY_SUB_BG = '#FAFAFA';

// Gain/loss colors (more legible on small text than the branding green/red)
const GAIN_COLOR = '#1a7a40';
const LOSS_COLOR = '#c0392b';

// Tax-free row left-border accent color
const TAX_FREE_ACCENT = '#1a7a40';

/**
 * Convert an ISO date string to dd.MM.yyyy format.
 */
export function formatDateDe(isoDate: string): string {
  const datePart = isoDate.slice(0, 10); // "YYYY-MM-DD"
  const [year, month, day] = datePart.split('-');
  return `${day}.${month}.${year}`;
}

/**
 * Convert an ISO datetime string to "dd.MM.yyyy HH:MM" format.
 * Omits time part if it's 00:00.
 */
export function formatDateTimeDe(isoDate: string): string {
  const datePart = isoDate.slice(0, 10);
  const [year, month, day] = datePart.split('-');
  const dateStr = `${day}.${month}.${year}`;
  const time = isoDate.slice(11, 16);
  return time && time !== '00:00' ? `${dateStr} ${time}` : dateStr;
}

// Sell group type for PDF grouping
interface PdfSellGroup {
  sellTransactionId: number;
  symbol: string;
  sellDate: string;
  exchange: string;
  totalAmount: number;
  totalCostBasis: number;
  totalProceeds: number;
  totalGainLoss: number;
  allHaltefristMet: boolean;
  rows: TradeAppendixRow[];
}

function groupRowsBySell(rows: TradeAppendixRow[]): PdfSellGroup[] {
  const groups: PdfSellGroup[] = [];
  let current: PdfSellGroup | null = null;

  for (const row of rows) {
    if (!current || current.sellTransactionId !== row.sellTransactionId) {
      current = {
        sellTransactionId: row.sellTransactionId,
        symbol: row.symbol,
        sellDate: row.sellDate,
        exchange: row.exchange,
        totalAmount: 0,
        totalCostBasis: 0,
        totalProceeds: 0,
        totalGainLoss: 0,
        allHaltefristMet: true,
        rows: [],
      };
      groups.push(current);
    }
    current.totalAmount += parseFloat(row.amountConsumed);
    current.totalCostBasis += parseFloat(row.costBasisEur);
    current.totalProceeds += parseFloat(row.proceedsEur);
    current.totalGainLoss += parseFloat(row.gainLossEur);
    if (!row.haltefristMet) current.allHaltefristMet = false;
    current.rows.push(row);
  }

  return groups;
}

/**
 * Draw the trade appendix table header row at position y.
 * Returns y position just below the header row.
 */
function drawTradeTableHeader(doc: PDFKit.PDFDocument, y: number): number {
  // Background bar
  doc.rect(MARGIN, y, CONTENT_WIDTH, TRADE_HEADER_H).fill(TABLE_HEADER_BG);

  let x = MARGIN;
  TRADE_COLUMNS.forEach((col, i) => {
    const w = TRADE_COL_WIDTHS[i];
    const isNumeric = i >= 3; // Kurs and onwards are right-aligned
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
 * Draw a sell header row (bold, blue background, aggregated values).
 */
function drawSellHeaderRow(doc: PDFKit.PDFDocument, group: PdfSellGroup, y: number): number {
  doc.rect(MARGIN, y, CONTENT_WIDTH, TRADE_SELL_ROW_H).fill(SELL_HEADER_BG);

  // Tax-free accent
  if (group.allHaltefristMet) {
    doc.rect(MARGIN, y, 3, TRADE_SELL_ROW_H).fill(TAX_FREE_ACCENT);
  }

  const glColor = group.totalGainLoss >= 0 ? GAIN_COLOR : LOSS_COLOR;
  const kurs = group.totalAmount !== 0 ? group.totalProceeds / group.totalAmount : 0;

  const cells = [
    group.symbol,
    formatDateTimeDe(group.sellDate),
    'Verkauf',
    formatEurPdf(String(kurs.toFixed(2))),
    group.totalAmount.toFixed(4),
    formatEurPdf(String(group.totalCostBasis.toFixed(2))),
    formatEurPdf(String(group.totalProceeds.toFixed(2))),
    formatEurPdf(String(group.totalGainLoss.toFixed(2))),
    '\u2014', // em dash for Tage
    group.allHaltefristMet ? 'Ja' : group.rows.some((r) => r.haltefristMet) ? 'Mix' : 'Nein',
  ];

  const cellColors = [
    COLOR_TEXT,
    COLOR_TEXT,
    COLOR_TEXT,
    COLOR_TEXT,
    COLOR_TEXT,
    COLOR_TEXT,
    COLOR_TEXT,
    glColor,
    COLOR_TEXT,
    group.allHaltefristMet ? GAIN_COLOR : COLOR_TEXT,
  ];

  let x = MARGIN;
  cells.forEach((cell, i) => {
    const w = TRADE_COL_WIDTHS[i];
    const isNumeric = i >= 3;
    doc
      .font('Bold')
      .fontSize(7)
      .fillColor(cellColors[i])
      .text(cell, x + (group.allHaltefristMet && i === 0 ? 5 : 2), y + 4, {
        width: w - (group.allHaltefristMet && i === 0 ? 7 : 4),
        align: isNumeric ? 'right' : 'left',
        lineBreak: false,
        ellipsis: true,
      });
    x += w;
  });

  return y + TRADE_SELL_ROW_H;
}

/**
 * Draw a buy sub-row (smaller, muted, indented).
 */
function drawBuySubRow(
  doc: PDFKit.PDFDocument,
  row: TradeAppendixRow,
  y: number,
  rowIndex: number
): number {
  const bgColor = rowIndex % 2 === 0 ? BUY_SUB_BG : ROW_BG_EVEN;
  doc.rect(MARGIN, y, CONTENT_WIDTH, TRADE_ROW_H).fill(bgColor);

  if (row.haltefristMet) {
    doc.rect(MARGIN, y, 3, TRADE_ROW_H).fill(TAX_FREE_ACCENT);
  }

  const gainLoss = parseFloat(row.gainLossEur);
  const glColor = gainLoss >= 0 ? GAIN_COLOR : LOSS_COLOR;
  const kurs =
    parseFloat(row.amountConsumed) !== 0
      ? parseFloat(row.costBasisEur) / parseFloat(row.amountConsumed)
      : 0;

  const cells = [
    '', // no symbol repeat (indented)
    formatDateTimeDe(row.buyDate),
    'Kauf',
    formatEurPdf(String(kurs.toFixed(2))),
    parseFloat(row.amountConsumed).toFixed(4),
    formatEurPdf(row.costBasisEur),
    formatEurPdf(row.proceedsEur),
    formatEurPdf(row.gainLossEur),
    String(row.heldDays),
    row.haltefristMet ? 'Ja' : 'Nein',
  ];

  const cellColors = [
    COLOR_MUTED,
    COLOR_MUTED,
    COLOR_MUTED,
    COLOR_MUTED,
    COLOR_MUTED,
    COLOR_MUTED,
    COLOR_MUTED,
    glColor,
    COLOR_MUTED,
    row.haltefristMet ? GAIN_COLOR : COLOR_MUTED,
  ];

  let x = MARGIN;
  cells.forEach((cell, i) => {
    const w = TRADE_COL_WIDTHS[i];
    const isNumeric = i >= 3;
    doc
      .font('Regular')
      .fontSize(6)
      .fillColor(cellColors[i])
      .text(cell, x + (i === 0 ? 8 : 2), y + 3, {
        width: w - (i === 0 ? 10 : 4),
        align: isNumeric ? 'right' : 'left',
        lineBreak: false,
        ellipsis: true,
      });
    x += w;
  });

  return y + TRADE_ROW_H;
}

/**
 * Build the trade appendix section (grouped by sell transactions).
 */
function buildTradeAppendix(
  doc: PDFKit.PDFDocument,
  rows: TradeAppendixRow[],
  pageCounter: { count: number },
  dateStr: string
): void {
  doc.addPage();
  pageCounter.count += 1;
  drawFooter(doc, pageCounter.count, dateStr);
  let y = MARGIN;

  // Section header bar
  doc.rect(MARGIN, y, CONTENT_WIDTH, 22).fill(CRYPTO_BLUE);

  doc
    .font('Bold')
    .fontSize(SIZE_H2)
    .fillColor(COLOR_WHITE)
    .text('Handelsanhang \u2014 Spot-Transaktionen', MARGIN + 8, y + 5, {
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
        'Verkaufszeilen fett, darunter die einzelnen Kauf-Lots. Steuerfreie Zeilen: gr\u00fcner Akzentstreifen links.',
      MARGIN,
      y,
      { width: CONTENT_WIDTH }
    );

  y += 16;

  if (rows.length === 0) {
    doc
      .font('Regular')
      .fontSize(SIZE_SMALL)
      .fillColor(COLOR_MUTED)
      .text('Keine Spot-Transaktionen vorhanden.', MARGIN, y, { width: CONTENT_WIDTH });
    return;
  }

  // Group rows by sell transaction
  const groups = groupRowsBySell(rows);

  // Draw initial table header
  y = drawTradeTableHeader(doc, y);

  // Render grouped rows with pagination
  for (const group of groups) {
    // Check if sell header + at least one sub-row fit on current page (widow protection)
    const neededHeight = TRADE_SELL_ROW_H + TRADE_ROW_H;
    if (y + neededHeight > TRADE_PAGE_BOTTOM) {
      doc.addPage();
      pageCounter.count += 1;
      drawFooter(doc, pageCounter.count, dateStr);
      y = MARGIN;
      y = drawTradeTableHeader(doc, y);
    }

    // Draw sell header
    y = drawSellHeaderRow(doc, group, y);

    // Draw buy sub-rows
    group.rows.forEach((row, i) => {
      if (y + TRADE_ROW_H > TRADE_PAGE_BOTTOM) {
        doc.addPage();
        pageCounter.count += 1;
        drawFooter(doc, pageCounter.count, dateStr);
        y = MARGIN;
        y = drawTradeTableHeader(doc, y);
      }
      y = drawBuySubRow(doc, row, y, i);
    });

    // Group spacing
    y += 3;
  }

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
    pageCounter.count += 1;
    drawFooter(doc, pageCounter.count, dateStr);
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
    .text(`Gesamt: ${groups.length} Verk\u00e4ufe (${rows.length} Lots)`, MARGIN, y, {
      width: 170,
      lineBreak: false,
    });

  doc
    .font('Regular')
    .fontSize(7.5)
    .fillColor(GAIN_COLOR)
    .text(`Gewinn: ${formatEurPdf(String(totalGains.toFixed(2)))}`, MARGIN + 175, y, {
      width: 120,
      lineBreak: false,
    });

  doc
    .font('Regular')
    .fontSize(7.5)
    .fillColor(LOSS_COLOR)
    .text(`Verlust: ${formatEurPdf(String(totalLosses.toFixed(2)))}`, MARGIN + 300, y, {
      width: 120,
      lineBreak: false,
    });

  doc
    .font('Bold')
    .fontSize(7.5)
    .fillColor(netColor)
    .text(`Netto: ${formatEurPdf(String(netTotal.toFixed(2)))}`, MARGIN + 415, y, {
      width: 80,
      lineBreak: false,
    });
}

// ---------------------------------------------------------------------------
// Futures Appendix — Handelsanhang Futures (paginated)
// ---------------------------------------------------------------------------

const FUTURES_COLUMNS = [
  'Symbol',
  'Datum',
  'Richtung',
  'Realisierter G/V',
  'Geb\u00fchr',
  'B\u00f6rse',
] as const;

// Column widths must sum to CONTENT_WIDTH (495pt)
// 55 + 80 + 75 + 110 + 80 + 95 = 495
const FUTURES_COL_WIDTHS = [55, 80, 75, 110, 80, 95];

const FUTURES_ROW_H = 14;

function drawFuturesTableHeader(doc: PDFKit.PDFDocument, y: number): number {
  doc.rect(MARGIN, y, CONTENT_WIDTH, TRADE_HEADER_H).fill(TABLE_HEADER_BG);

  let x = MARGIN;
  FUTURES_COLUMNS.forEach((col, i) => {
    const w = FUTURES_COL_WIDTHS[i];
    const isNumeric = i === 3 || i === 4; // G/V and Gebühr right-aligned
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

function drawFuturesRow(
  doc: PDFKit.PDFDocument,
  row: FuturesAppendixRow,
  y: number,
  rowIndex: number
): number {
  const bgColor = rowIndex % 2 === 0 ? ROW_BG_EVEN : ROW_BG_ODD;
  doc.rect(MARGIN, y, CONTENT_WIDTH, FUTURES_ROW_H).fill(bgColor);

  const pnl = parseFloat(row.realizedPnlEur);
  const pnlColor = pnl >= 0 ? GAIN_COLOR : LOSS_COLOR;

  const cells = [
    row.symbol,
    formatDateTimeDe(row.date),
    row.direction,
    formatEurPdf(row.realizedPnlEur),
    formatEurPdf(row.feeEur),
    row.exchange,
  ];

  const cellColors = [COLOR_TEXT, COLOR_TEXT, COLOR_TEXT, pnlColor, COLOR_TEXT, COLOR_TEXT];

  let x = MARGIN;
  cells.forEach((cell, i) => {
    const w = FUTURES_COL_WIDTHS[i];
    const isNumeric = i === 3 || i === 4;
    doc
      .font(i === 0 ? 'Bold' : 'Regular')
      .fontSize(7)
      .fillColor(cellColors[i])
      .text(cell, x + 2, y + 3, {
        width: w - 4,
        align: isNumeric ? 'right' : 'left',
        lineBreak: false,
        ellipsis: true,
      });
    x += w;
  });

  return y + FUTURES_ROW_H;
}

function buildFuturesAppendix(
  doc: PDFKit.PDFDocument,
  rows: FuturesAppendixRow[],
  pageCounter: { count: number },
  dateStr: string
): void {
  doc.addPage();
  pageCounter.count += 1;
  drawFooter(doc, pageCounter.count, dateStr);
  let y = MARGIN;

  // Section header bar
  doc.rect(MARGIN, y, CONTENT_WIDTH, 22).fill(CRYPTO_BLUE);

  doc
    .font('Bold')
    .fontSize(SIZE_H2)
    .fillColor(COLOR_WHITE)
    .text('Handelsanhang \u2014 Futures-Positionen', MARGIN + 8, y + 5, {
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
      'Alle geschlossenen Futures-Positionen, Funding-Zahlungen und Geb\u00fchren f\u00fcr das Steuerjahr.',
      MARGIN,
      y,
      { width: CONTENT_WIDTH }
    );

  y += 14;

  if (rows.length === 0) {
    doc
      .font('Regular')
      .fontSize(SIZE_SMALL)
      .fillColor(COLOR_MUTED)
      .text('Keine Futures-Positionen vorhanden.', MARGIN, y, { width: CONTENT_WIDTH });
    return;
  }

  // Draw initial table header
  y = drawFuturesTableHeader(doc, y);

  // Render rows with pagination
  rows.forEach((row, i) => {
    if (y + FUTURES_ROW_H > TRADE_PAGE_BOTTOM) {
      doc.addPage();
      pageCounter.count += 1;
      drawFooter(doc, pageCounter.count, dateStr);
      y = MARGIN;
      y = drawFuturesTableHeader(doc, y);
    }
    y = drawFuturesRow(doc, row, y, i);
  });

  // Summary row
  const totalGains = rows.reduce((sum, r) => {
    const v = parseFloat(r.realizedPnlEur);
    return v > 0 ? sum + v : sum;
  }, 0);
  const totalLosses = rows.reduce((sum, r) => {
    const v = parseFloat(r.realizedPnlEur);
    return v < 0 ? sum + v : sum;
  }, 0);
  const totalFees = rows.reduce((sum, r) => sum + parseFloat(r.feeEur), 0);
  const netTotal = totalGains + totalLosses;

  if (y + FUTURES_ROW_H + 8 > TRADE_PAGE_BOTTOM) {
    doc.addPage();
    pageCounter.count += 1;
    drawFooter(doc, pageCounter.count, dateStr);
    y = MARGIN;
  }

  y += 6;

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
    .text(`Gesamt: ${rows.length} Positionen`, MARGIN, y, { width: 130, lineBreak: false });

  doc
    .font('Regular')
    .fontSize(7.5)
    .fillColor(GAIN_COLOR)
    .text(`Gewinn: ${formatEurPdf(String(totalGains.toFixed(2)))}`, MARGIN + 135, y, {
      width: 110,
      lineBreak: false,
    });

  doc
    .font('Regular')
    .fontSize(7.5)
    .fillColor(LOSS_COLOR)
    .text(`Verlust: ${formatEurPdf(String(totalLosses.toFixed(2)))}`, MARGIN + 250, y, {
      width: 110,
      lineBreak: false,
    });

  doc
    .font('Bold')
    .fontSize(7.5)
    .fillColor(netColor)
    .text(`Netto: ${formatEurPdf(String(netTotal.toFixed(2)))}`, MARGIN + 365, y, {
      width: 80,
      lineBreak: false,
    });

  doc
    .font('Regular')
    .fontSize(7.5)
    .fillColor(COLOR_MUTED)
    .text(`Geb.: ${formatEurPdf(String(totalFees.toFixed(2)))}`, MARGIN + 440, y, {
      width: 55,
      lineBreak: false,
    });
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
      autoFirstPage: false,
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
    const pageCounter = { count: 0 };

    // -----------------------------------------------------------------------
    // Page 1: Cover
    // -----------------------------------------------------------------------
    buildCoverPage(doc, data, pageCounter, generatedDate);

    // -----------------------------------------------------------------------
    // Page 2+: Summary sections
    // -----------------------------------------------------------------------
    let y = newPage(doc, pageCounter, generatedDate);

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
      y = newPage(doc, pageCounter, generatedDate);
    }

    y = buildAnlageKAPSection(doc, data, y);
    y += 10;

    // Check if we need a new page for Staking section
    if (y > PAGE_HEIGHT - 220) {
      y = newPage(doc, pageCounter, generatedDate);
    }

    y = buildStakingSection(doc, data, y);

    // -----------------------------------------------------------------------
    // Trade Appendix — Spot (grouped by sell, paginated)
    // -----------------------------------------------------------------------
    buildTradeAppendix(doc, data.tradeAppendix, pageCounter, generatedDate);

    // -----------------------------------------------------------------------
    // Futures Appendix (if any futures data)
    // -----------------------------------------------------------------------
    if (data.futuresAppendix.length > 0) {
      buildFuturesAppendix(doc, data.futuresAppendix, pageCounter, generatedDate);
    }

    // Done — no post-hoc processing needed
    doc.end();
  });
}
