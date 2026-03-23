# Phase 6: Steuerreport + PDF Export - Research

**Researched:** 2026-03-23
**Domain:** PDF generation (PDFKit), CSV export, Hono API routes, React preview UI, Playwright E2E
**Confidence:** HIGH (stack verified via npm registry + official docs + live codebase inspection)

---

## Summary

Phase 6 adds report generation to an existing Hono + React + Vitest monorepo. The backend produces a PDF and a CSV from pre-computed tax data already stored in `tax_summaries`, `lot_consumptions`, `futures_positions`, and `earn_income` tables. The frontend adds a Steuerreport tab (already wired as an empty placeholder) with a year selector, HTML preview, and two download buttons.

**PDFKit 0.18.0** (latest, MIT) is the confirmed standard for Node.js PDF generation. It uses a streaming pipe API, supports embedded TTF fonts with full Latin Extended coverage, and has a chainable vector-graphics API for tables and styling. It ships as a CommonJS package — the backend uses ESM, so the import must use `createRequire` or a dynamic import wrapper.

Playwright 1.58.2 is the confirmed standard for E2E tests. The project has no existing E2E setup, so a new `playwright.config.ts` must be created at the root. Playwright runs independently of Vitest, using its own test runner (`npx playwright test`).

**Primary recommendation:** Use PDFKit 0.18.0 on the backend for PDF generation, native HTML rendering for browser preview (not embedded PDF), and @playwright/test 1.58.2 for the E2E test. The CSV route is a plain text response with proper MIME type — no library needed.

---

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| pdfkit | 0.18.0 (latest) | Server-side PDF generation | Only mature pure-JS PDF generator for Node.js with full TTF font embedding and vector graphics; MIT licensed |
| @playwright/test | 1.58.2 (latest) | E2E browser tests | Official Playwright test runner with built-in assertions and file download support; independent of Vitest |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| @types/pdfkit | latest | TypeScript types for PDFKit | Install in backend devDependencies |
| csv-stringify | already in node_modules via csv-parse | Structured CSV generation | Only if manual string building gets complex; manual construction is fine for flat data |

**Note on csv-stringify:** The project already has `csv-parse` installed. For CSV export, building the output manually (header row + data rows joined with `\n`) is sufficient and avoids a new dependency. If the CSV gains conditional columns or complex escaping needs, add `csv-stringify` from the same `csv` monorepo.

### PDFKit ESM Compatibility Note (CRITICAL)

The backend is `"type": "module"` (pure ESM). PDFKit 0.18.0 ships as CommonJS. The correct import in an ESM module is:

```typescript
// In ESM context (.ts with "type": "module")
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const PDFDocument = require('pdfkit') as typeof import('pdfkit');
```

Alternatively, use a dynamic import:

```typescript
const { default: PDFDocument } = await import('pdfkit');
```

Do NOT use `import PDFDocument from 'pdfkit'` directly — this will fail at runtime with a CJS interop error in the current Node.js/tsx setup.

### Installation

```bash
# Backend only — PDF runs server-side
npm install pdfkit --workspace packages/backend
npm install --save-dev @types/pdfkit --workspace packages/backend

# E2E — installed at root (or dedicated e2e package)
npm install --save-dev @playwright/test
npx playwright install chromium
```

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| PDFKit | react-pdf / @react-pdf/renderer | React-pdf runs client-side, requires heavy bundling, and has no streaming API; overkill for a server-generated document |
| PDFKit | puppeteer (HTML→PDF) | Requires launching a Chrome instance on the server; massive dependency; only worthwhile if the PDF must exactly match the browser preview |
| Native HTML preview | Embedded PDF in iframe | Embedded PDF has inconsistent behavior across browsers and requires serving the PDF as a URL, adding caching complexity |
| @playwright/test | cypress | Playwright is lighter, faster startup, better download testing API, supports multiple browsers; no React component runner needed here |

---

## Architecture Patterns

### Recommended Project Structure

```
packages/backend/src/
├── routes/
│   └── report.ts          # New: GET /api/report/:year/preview, /pdf, /csv
├── engine/
│   └── report-generator.ts # New: ReportGenerator class — aggregates DB data
└── (existing files unchanged)

packages/frontend/src/
├── components/
│   └── Report/            # New component directory
│       ├── ReportTab.tsx   # Top-level: year selector + preview + buttons
│       ├── ReportTab.css
│       ├── ReportPreview.tsx  # Renders JSON preview data as HTML sections
│       ├── ReportPreview.css
│       └── ReportTab.test.tsx
└── (App.tsx updated to render <ReportTab /> instead of empty placeholder)

packages/shared/src/types/
└── report.ts              # New: ReportData, ReportSummarySection, TradeAppendixRow

e2e/                       # New top-level directory
├── playwright.config.ts
└── report.spec.ts
```

### Pattern 1: ReportGenerator Class (Backend Service)

**What:** A class that queries the DB and builds a typed `ReportData` object containing all sections. Separated from PDF/CSV rendering.
**When to use:** The same data model feeds the JSON preview API, the PDF route, and the CSV route. Build it once, use three times.

```typescript
// Source: codebase pattern — matches existing engine architecture
export class ReportGenerator {
  constructor(private db: Db) {}

  generate(taxYear: number): ReportData | null {
    // Queries: tax_summaries, lot_consumptions + join transactions + fifo_lots,
    //          futures_positions + join transactions, earn_income
    // Returns null if no tax_summaries found for the year
  }
}
```

**ReportData model** (proposed shape for `packages/shared/src/types/report.ts`):

```typescript
export interface ReportData {
  taxYear: number;
  generatedAt: string;          // ISO timestamp
  spotSummary: SpotSummary;     // Anlage SO (§23 EStG)
  futuresSummary: FuturesSummary; // Anlage KAP (§20 EStG)
  earnSummary: EarnSummary;     // §22 Nr. 3 EStG
  tradeAppendix: TradeAppendixRow[];  // All trades (taxable + tax-free)
}

export interface SpotSummary {
  totalGainsEur: string;
  totalLossesEur: string;
  netEur: string;
  taxableAmountEur: string;
  freigrenzeLimitEur: string;   // '1000'
  freigrezeStatus: 'under' | 'over'; // under = tax-free
  tradeCount: number;
  taxFreeTradeCount: number;    // haltefrist met
}

export interface FuturesSummary {
  totalGainsEur: string;
  totalLossesEur: string;
  netEur: string;
  taxableAmountEur: string;
  estimatedTaxEur: string;      // 26.375% Abgeltungssteuer
  tradeCount: number;
}

export interface EarnSummary {
  totalEurValueAtReceipt: string;
  freigrenzeLimitEur: string;   // '256'
  freigrezeStatus: 'under' | 'over';
  recordCount: number;
}

export interface TradeAppendixRow {
  id: number;
  symbol: string;
  buyDate: string;
  sellDate: string;
  amountConsumed: string;
  costBasisEur: string;
  proceedsEur: string;
  gainLossEur: string;
  heldDays: number;
  haltefristMet: boolean;       // true = tax-free, show as "Steuerfrei"
  feeEur: string;
  exchange: string;
}
```

### Pattern 2: PDFKit Document Building

**What:** Chainable API for streaming PDF to HTTP response. Build document imperatively, pipe to response.
**When to use:** For the GET /api/report/:year/pdf route.

```typescript
// Source: PDFKit official docs + GitHub README
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const PDFDocument = require('pdfkit');

export function buildPdf(data: ReportData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',           // 595.28 x 841.89 points
      margins: { top: 50, bottom: 50, left: 50, right: 50 },
      bufferPages: true,    // enables page number injection after all pages added
    });

    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    // Register font with Latin Extended (German Umlauts)
    doc.registerFont('Regular', path.join(import.meta.dirname, '../assets/fonts/NotoSans-Regular.ttf'));
    doc.registerFont('Bold', path.join(import.meta.dirname, '../assets/fonts/NotoSans-Bold.ttf'));
    doc.font('Regular');

    buildCoverPage(doc, data);
    buildSpotSection(doc, data.spotSummary);
    buildFuturesSection(doc, data.futuresSummary);
    buildEarnSection(doc, data.earnSummary);
    buildTradeAppendix(doc, data.tradeAppendix);
    injectPageNumbers(doc);

    doc.end();
  });
}
```

**Returning from Hono route:**

```typescript
app.get('/api/report/:year/pdf', async (c) => {
  const year = parseInt(c.req.param('year'), 10);
  const data = new ReportGenerator(db).generate(year);
  if (!data) return c.json({ error: 'No data for year' }, 404);

  const pdfBuffer = await buildPdf(data);
  c.header('Content-Type', 'application/pdf');
  c.header('Content-Disposition', `attachment; filename="cryptax-steuerreport-${year}.pdf"`);
  return c.body(pdfBuffer);
});
```

### Pattern 3: PDFKit A4 Coordinate System

**What:** PDFKit uses points (1 inch = 72 points). A4 = 595.28 × 841.89 pts.
With 50pt margins each side, the printable area is 495.28 pts wide × 741.89 pts tall.

**Key coordinates:**
- Left margin: x = 50
- Right edge: x = 545
- Content width: 495 pts
- Top margin: y = 50
- Bottom threshold (trigger new page): y > 770

**Drawing a colored header bar:**
```typescript
// Source: PDFKit vector docs
doc.save()
   .fillColor('#0070F2')
   .rect(50, doc.y, 495, 24)
   .fill()
   .fillColor('#ffffff')
   .fontSize(11)
   .font('Bold')
   .text('Anlage SO — Private Veraeusserungsgeschaefte (§23 EStG)', 55, doc.y + 6)
   .restore();
doc.moveDown(1.5);
```

**Drawing a table row:**
```typescript
// Source: PDFKit vector + text docs
function tableRow(doc: PDFKit.PDFDocument, cols: string[], widths: number[], y: number) {
  let x = 50;
  doc.fontSize(8).font('Regular');
  for (let i = 0; i < cols.length; i++) {
    doc.text(cols[i], x + 4, y + 3, {
      width: widths[i] - 8,
      lineBreak: false,
      ellipsis: true,
    });
    x += widths[i];
  }
}
```

### Pattern 4: Page Number Injection (bufferPages)

```typescript
// Source: PDFKit getting_started docs
function injectPageNumbers(doc: PDFKit.PDFDocument) {
  const totalPages = doc.bufferedPageRange().count;
  for (let i = 0; i < totalPages; i++) {
    doc.switchToPage(i);
    doc.fillColor('rgba(0,0,0,0.4)')
       .fontSize(7)
       .text(
         `Seite ${i + 1} von ${totalPages}  |  Erstellt: ${new Date().toLocaleDateString('de-DE')}`,
         50, 820, { align: 'center', width: 495 }
       );
  }
  doc.flushPages();
}
```

### Pattern 5: CSV Export

**What:** Plain text response with CSV MIME type. No library needed for flat tabular data.
**Format:** UTF-8 BOM prefix (`\uFEFF`) ensures Excel (German) opens it correctly.

```typescript
app.get('/api/report/:year/csv', async (c) => {
  const year = parseInt(c.req.param('year'), 10);
  const data = new ReportGenerator(db).generate(year);
  if (!data) return c.json({ error: 'No data for year' }, 404);

  const header = 'Symbol,Kaufdatum,Verkaufdatum,Menge,Einstandswert EUR,Erloes EUR,Gewinn/Verlust EUR,Haltedauer (Tage),Haltefrist erfuellt,Gebuehr EUR,Boerse\n';
  const rows = data.tradeAppendix.map(r =>
    [r.symbol, r.buyDate, r.sellDate, r.amountConsumed,
     r.costBasisEur, r.proceedsEur, r.gainLossEur,
     r.heldDays, r.haltefristMet ? 'Ja' : 'Nein',
     r.feeEur, r.exchange].join(',')
  ).join('\n');

  c.header('Content-Type', 'text/csv; charset=utf-8');
  c.header('Content-Disposition', `attachment; filename="cryptax-steuerberater-${year}.csv"`);
  return c.body('\uFEFF' + header + rows);
});
```

### Pattern 6: React Preview UI (Native HTML)

**Decision (Claude's discretion):** Use native HTML rendering, not an embedded PDF iframe. Reasons:
1. PDFKit runs server-side; showing it in an iframe requires serving the binary over a GET request, adding a loading delay before any content is visible.
2. Native HTML gives instant rendering, matches the glassmorphism design system, and is easier to test.
3. The user confirmed single-scroll layout with two separate download buttons.

**Preview fetch pattern** (mirrors Dashboard.tsx):
```typescript
// GET /api/report/:year/preview returns ReportData as JSON
const [reportData, setReportData] = useState<ReportData | null>(null);
useEffect(() => {
  fetch(`/api/report/${selectedYear}/preview`)
    .then(res => res.ok ? res.json() : null)
    .then(setReportData);
}, [selectedYear]);
```

**Download button pattern:**
```typescript
// Trigger browser download via anchor + object URL
async function downloadPdf() {
  const res = await fetch(`/api/report/${selectedYear}/pdf`);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `cryptax-steuerreport-${selectedYear}.pdf`;
  a.click();
  URL.revokeObjectURL(url);
}
```

### Pattern 7: Playwright E2E Setup

**Structure:** Playwright runs independently at the project root. Its tests live in `e2e/` to avoid conflicts with the Vitest `packages/*/src/**/*.test.{ts,tsx}` glob.

```typescript
// e2e/playwright.config.ts
// Source: playwright.dev/docs/test-webserver
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  retries: 0,
  use: {
    baseURL: 'http://localhost:5174',
  },
  webServer: [
    {
      command: 'npm run dev -w packages/backend',
      url: 'http://localhost:3001/api/health',
      reuseExistingServer: true,
      timeout: 30_000,
    },
    {
      command: 'npm run dev -w packages/frontend',
      url: 'http://localhost:5174',
      reuseExistingServer: true,
      timeout: 30_000,
    },
  ],
});
```

**File download test pattern:**
```typescript
// Source: playwright.dev/docs/downloads
test('PDF download works', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Steuerreport' }).click();
  // ... select year, generate report ...
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'PDF herunterladen' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/\.pdf$/);
});
```

### Anti-Patterns to Avoid

- **String interpolating German Umlauts directly into PDFKit without a TTF font:** Built-in PDFKit fonts (Helvetica, Times-Roman) only cover Windows-1252 Latin-1. Characters like `ä ö ü ß` will render as boxes or be silently dropped. Always use an embedded TTF with Latin Extended coverage.
- **Piping PDFKit to Hono's stream:** Hono's streaming API expects a ReadableStream (Web Streams API), not a Node.js Readable. Collect chunks into a Buffer and use `c.body(buffer)` instead.
- **Placing E2E tests inside `packages/frontend/src/`:** Vitest will try to run them in jsdom, not a real browser. Keep E2E in `e2e/` at the root.
- **Using `doc.text()` for table cells without `lineBreak: false`:** Text will overflow into adjacent columns. Always pass `{ lineBreak: false, ellipsis: true, width: colWidth - padding }`.
- **Generating the PDF synchronously:** `doc.end()` is async (events). Always wrap in a `Promise` with `doc.on('end', resolve)`.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| German character encoding in PDF | Custom encoding table | PDFKit + TTF font with Latin Extended | Latin-1 subset of built-in fonts misses ä, ö, ü, ß; TTF embedding solves this completely |
| Page number injection post-hoc | Second render pass | PDFKit `bufferPages: true` + `switchToPage()` + `flushPages()` | PDFKit has first-class support for this pattern |
| CSV escaping (fields with commas) | Custom escape logic | Either csv-stringify or double-quote wrapping | Fields with EUR values (comma as decimal separator in German) can collide with CSV delimiter; use semicolons as delimiter or quote all fields |
| E2E test runner | Vitest browser mode | @playwright/test standalone | Playwright has native file download assertions, real browser control, and a dedicated webServer launcher |
| PDF preview in browser | Embedding binary PDF in iframe | Native HTML + JSON preview endpoint | JSON renders instantly, matches design system, and is independently testable |

**Key insight:** The German locale uses comma as decimal separator (`1.234,56 EUR`). CSV files consumed by German Excel should use semicolons (`;`) as the column delimiter, not commas. This is the most common bug in German financial CSV exports.

---

## Common Pitfalls

### Pitfall 1: German CSV Decimal Separator Collision

**What goes wrong:** CSV uses comma as field separator. EUR values like `1.234,56` contain a comma, causing parsers to split the field.
**Why it happens:** German locale formats numbers with comma as decimal separator.
**How to avoid:** Use semicolon (`;`) as the CSV delimiter. This is the German Excel standard. Change the header row and row joins to use `;` instead of `,`.
**Warning signs:** Steuerberater reports columns splitting in Excel, extra ghost columns in import.

### Pitfall 2: PDFKit CJS/ESM Import Failure

**What goes wrong:** `import PDFDocument from 'pdfkit'` throws `ERR_REQUIRE_ESM` or a named export error at runtime.
**Why it happens:** PDFKit 0.18.0 is CommonJS. The backend is `"type": "module"`. Node.js ESM cannot statically import a CJS default export in all configurations.
**How to avoid:** Use `createRequire(import.meta.url)` to require pdfkit, or use `await import('pdfkit')` with `{ default: PDFDocument }` destructuring.
**Warning signs:** TypeError at module load time before any route handler executes.

### Pitfall 3: Built-in PDFKit Fonts Drop German Characters

**What goes wrong:** `ä`, `ö`, `ü`, `ß` appear as boxes or question marks in the output PDF.
**Why it happens:** PDFKit's built-in standard fonts (Helvetica, Times-Roman, Courier) use Windows-1252 Latin-1 encoding which does not include U+00E4 (ä), U+00F6 (ö), U+00FC (ü), U+00DF (ß).
**How to avoid:** Ship a TTF font file in `packages/backend/src/assets/fonts/`. Register it with `doc.registerFont()` before any text operation. Noto Sans (variable TTF) or DejaVu Sans cover the full Latin Extended block.
**Warning signs:** PDF looks correct for ASCII but German words appear mangled.

### Pitfall 4: bufferPages Required for Footer Page Numbers

**What goes wrong:** Footer shows "Seite 1 von ?" because total page count is unknown when page 1 is being written.
**Why it happens:** PDFKit writes pages to the stream as they are created; by default there is no way to go back.
**How to avoid:** Pass `{ bufferPages: true }` to the `PDFDocument` constructor. Then after all content is added, iterate `doc.bufferedPageRange()`, call `doc.switchToPage(i)` for each, write the footer, then call `doc.flushPages()` before `doc.end()`.
**Warning signs:** Footers show wrong counts or the `switchToPage` call throws "page not found".

### Pitfall 5: Playwright webServer Health Check URL

**What goes wrong:** Playwright starts the backend but begins tests before the backend is ready, causing 404s.
**Why it happens:** The `url` in `webServer` config must return HTTP 200 before Playwright proceeds. The backend's `/api/health` endpoint must exist.
**How to avoid:** Point `url` to `/api/health` (already implemented in the project). The health route returns 200 with a JSON body.
**Warning signs:** First E2E test fails with ECONNREFUSED or fetch errors.

### Pitfall 6: Trade Appendix Pagination — Row Height Overflow

**What goes wrong:** Long symbol names or unusual values cause a row to overflow the bottom margin, getting clipped.
**Why it happens:** PDFKit auto-adds a new page for text that flows past the page boundary, but manual table rows drawn with `doc.text()` at explicit y-coordinates do not trigger this automatically.
**How to avoid:** Track the current `doc.y` position after each row. If `doc.y + rowHeight > pageBottom` (e.g., y > 770), call `doc.addPage()` and redraw the table header before continuing rows.
**Warning signs:** Last row of a page is clipped or missing.

### Pitfall 7: Fetch-based PDF Download in React

**What goes wrong:** Using `window.open('/api/report/year/pdf')` works in some browsers but blocks popups, loses cookies/headers, and cannot detect errors.
**Why it happens:** Direct URL navigation for binary downloads does not allow handling auth headers or error states.
**How to avoid:** Use the `fetch()` + `Blob` + `URL.createObjectURL()` + dynamic `<a>` click pattern. This handles errors, shows loading state, and works consistently.
**Warning signs:** Download fails silently in Firefox; no loading spinner possible with window.open.

---

## Code Examples

### PDFKit: Collect Output as Buffer

```typescript
// Source: PDFKit README / Node.js stream pattern
export function pdfToBuffer(doc: PDFKit.PDFDocument): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });
}
```

### PDFKit: Register Font and Handle German Umlauts

```typescript
// Source: PDFKit text docs
const fontsDir = path.join(import.meta.dirname, '../assets/fonts');
doc.registerFont('Regular', path.join(fontsDir, 'NotoSans-Regular.ttf'));
doc.registerFont('Bold', path.join(fontsDir, 'NotoSans-Bold.ttf'));
doc.font('Regular').fontSize(10);

// German text renders correctly when TTF font is registered:
doc.text('Steuerpflichtige Veraeusserungsgeschaefte: Gewinne aus §23 EStG');
// With proper TTF: ä ö ü ß all render correctly
```

### PDFKit: Colored Section Header

```typescript
// Source: PDFKit vector docs (fill + text combination)
function sectionHeader(doc: PDFKit.PDFDocument, title: string) {
  const x = 50, width = 495;
  const y = doc.y;
  doc.save()
     .fillColor('#0070F2')
     .rect(x, y, width, 22)
     .fill()
     .restore();
  doc.fillColor('#ffffff')
     .font('Bold')
     .fontSize(9)
     .text(title, x + 6, y + 6, { width: width - 12, lineBreak: false });
  doc.moveDown(1.8);
  doc.fillColor('#000000').font('Regular');
}
```

### PDFKit: Manual Table with Column Widths

```typescript
// Source: PDFKit text docs (positioning + lineBreak: false pattern)
const COL_WIDTHS = [55, 65, 65, 55, 70, 70, 65, 50]; // sum = 495

function tableHeader(doc: PDFKit.PDFDocument, labels: string[]) {
  const y = doc.y;
  doc.save().fillColor('#354A5F').rect(50, y, 495, 16).fill().restore();
  let x = 50;
  doc.fillColor('#ffffff').font('Bold').fontSize(7);
  for (let i = 0; i < labels.length; i++) {
    doc.text(labels[i], x + 3, y + 4, {
      width: COL_WIDTHS[i] - 6, lineBreak: false
    });
    x += COL_WIDTHS[i];
  }
  doc.moveDown(1.2).fillColor('#000000').font('Regular');
}

function tableDataRow(doc: PDFKit.PDFDocument, cells: string[], isGrey: boolean) {
  const y = doc.y;
  if (isGrey) {
    doc.save().fillColor('#f5f5f5').rect(50, y - 1, 495, 14).fill().restore();
  }
  let x = 50;
  doc.fontSize(7);
  for (let i = 0; i < cells.length; i++) {
    doc.fillColor(i === 5 ? (parseFloat(cells[5]) >= 0 ? '#1a7a40' : '#c0392b') : '#222222')
       .text(cells[i], x + 3, y + 2, {
         width: COL_WIDTHS[i] - 6, lineBreak: false, ellipsis: true
       });
    x += COL_WIDTHS[i];
  }
  doc.moveDown(0.8).fillColor('#000000');
}
```

### Playwright: Full E2E Test Skeleton

```typescript
// Source: playwright.dev/docs/downloads
import { test, expect } from '@playwright/test';

test.describe('Report generation flow', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('Steuerreport tab shows year selector and empty state', async ({ page }) => {
    await page.getByRole('button', { name: 'Steuerreport' }).click();
    await expect(page.getByText('Keine Daten')).toBeVisible();
  });

  test('Full flow: import -> calculate -> preview -> PDF download', async ({ page }) => {
    // ... import CSV, run engine, switch to Steuerreport tab ...
    await page.getByRole('button', { name: 'Steuerreport' }).click();
    await page.getByRole('button', { name: 'Report generieren' }).click();
    await expect(page.getByText('Anlage SO')).toBeVisible();

    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'PDF herunterladen' }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/cryptax-steuerreport-\d{4}\.pdf/);
  });
});
```

### Hono Route: PDF Response

```typescript
// Source: Hono context docs + PDFKit streaming pattern
app.get('/api/report/:year/pdf', async (c) => {
  const taxYear = parseInt(c.req.param('year'), 10);
  if (Number.isNaN(taxYear)) return c.json({ error: 'Invalid year' }, 400);

  const generator = new ReportGenerator(db);
  const data = generator.generate(taxYear);
  if (!data) return c.json({ error: `No report data for year ${taxYear}` }, 404);

  const pdfBuffer = await buildPdf(data);
  c.header('Content-Type', 'application/pdf');
  c.header('Content-Disposition', `attachment; filename="cryptax-steuerreport-${taxYear}.pdf"`);
  return c.body(pdfBuffer);
});
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| PDFKit `doc.output()` / `doc.write()` methods | Pipe to streams, collect chunks | PDFKit < 0.5 | These methods are removed; must use event-based buffer collection |
| Playwright separate install script | `npx playwright install` per browser | Playwright 1.x | Only install browsers you need (chromium is sufficient for CI) |
| CSV with comma separator for German locale | CSV with semicolon separator | Excel 2016+ | German Excel uses semicolons by default; commas cause column splitting |

**Deprecated/outdated:**
- `doc.output()` in PDFKit: removed in 0.5+, use event-based chunk collection
- `doc.write(filename)`: removed, use `doc.pipe(fs.createWriteStream(...))`
- `bufferPages` was added in PDFKit 0.8; safe to use in 0.18.0

---

## Existing Codebase Integration Points

The following are confirmed facts from reading the codebase:

### DB Tables Available for Report Generation
- `tax_summaries` — buckets: `private_sale`, `futures_pnl`, `staking_earn`; fields: `totalGainsEur`, `totalLossesEur`, `netEur`, `taxableAmountEur`, `estimatedTaxEur`, `tradeCount`
- `lot_consumptions` — fields: `amountConsumed`, `costBasisEur`, `proceedsEur`, `gainLossEur`, `feeEur`, `heldDays`, `haltefristMet`, `taxYear`; FK to `fifo_lots` (for `symbol`) and `transactions` (for `tradedAt`, `exchange`)
- `futures_positions` — fields: `symbol`, `realizedPnlEur`, `feeEur`, `taxYear`; FK to `transactions`
- `earn_income` — fields: `symbol`, `amount`, `eurValueAtReceipt`, `receivedAt`, `taxYear`

### Available Years
Query `SELECT DISTINCT tax_year FROM tax_summaries ORDER BY tax_year` — matches the pattern already used in `summary.ts`.

### Frontend Tab Already Wired
`App.tsx` already has `type TabId = 'dashboard' | 'transactions' | 'report'` and renders a placeholder `<div>` for `activeTab === 'report'`. Replace with `<ReportTab />`.

### YearSelector Component is Reusable
`packages/frontend/src/components/Dashboard/YearSelector.tsx` is a generic controlled select component. Import it in `ReportTab.tsx` — no need to duplicate.

### Design Tokens Available
CSS custom properties defined in `index.css`:
- `--crypto-blue: #0070F2` — use for PDF header color
- `--crypto-navy: #354A5F` — use for PDF table header
- `--crypto-green: #5fdc8a` — use for positive gains
- `--crypto-red: #e50000` — use for losses/warnings
- `--crypto-dark: #1a2332` — background
- `GlassSurface` component with `backdropFilter: blur(12px)` is the standard card wrapper

### TAX_CONSTANTS Already Defined in Shared
- `SPOT_FREIGRENZE_EUR: '1000'`
- `EARN_FREIGRENZE_EUR: '256'`
- `ABGELTUNGSSTEUER_RATE: '0.26375'`

### API Pattern
All existing routes use `registerXxxRoutes(app: Hono)` functions imported in `index.ts`. The new report routes should follow the same pattern: `registerReportRoutes(app)` in `packages/backend/src/routes/report.ts`.

### Test Pattern
- Backend: vitest with node environment, test file at `src/routes/report.test.ts`
- Frontend: vitest with jsdom, test file at `src/components/Report/ReportTab.test.tsx`, uses `@testing-library/react`
- E2E: `@playwright/test` at `e2e/report.spec.ts` with `playwright.config.ts` at project root

### German Number Formatting
`packages/frontend/src/utils/format.ts` has `formatEur()` and `formatNumber()` using `Intl.NumberFormat('de-DE')`. PDF generation on the backend needs its own formatting — copy the logic as a utility function in the report generator (or move it to `@cryptax/shared`).

---

## Font Decision

**Recommended font: Noto Sans (variable TTF from Google Fonts)**
- License: SIL Open Font License (OFL) — free for commercial use, can be bundled in applications
- Full Latin Extended coverage including: ä (U+00E4), ö (U+00F6), ü (U+00FC), ß (U+00DF), Ä (U+00C4), Ö (U+00D6), Ü (U+00DC)
- Download: The variable font `NotoSans[wdth,wght].ttf` is available from Google Fonts GitHub at `https://raw.githubusercontent.com/google/fonts/main/ofl/notosans/NotoSans%5Bwdth%2Cwght%5D.ttf`
- PDFKit supports variable fonts via its `fontkit` dependency (fontkit ^2.0.4 is a PDFKit dependency)
- File size: ~500KB for the variable font — acceptable for a server-side asset
- **Alternative:** DejaVu Sans (also OFL, static TTF, 756KB) is widely used in PDF generation and has been bundled in many Node.js PDF projects. Download from `https://dejavu-fonts.github.io/Download.html`. More predictable than a variable font.

**Recommended choice: DejaVu Sans** — static TTF, proven compatibility with PDFKit, well-known in the PDF generation ecosystem, contains all required German characters.

Font files should be committed to the repository at `packages/backend/src/assets/fonts/` to avoid runtime downloads.

---

## Open Questions

1. **Abgeltungssteuer display on Anlage KAP summary**
   - What we know: `estimatedTaxEur` is stored in `tax_summaries` for `futures_pnl` bucket; it's 26.375% of taxable net
   - What's unclear: Should the PDF show effective rate breakdown (25% + 5.5% Soli = 26.375%) or just the estimated total amount?
   - Recommendation: Show total estimated tax amount with a footnote "25% + 5,5% Solidaritätszuschlag = 26,375%"

2. **Freigrenze display for Spot (§23 EStG): cliff vs. threshold**
   - What we know: Spot Freigrenze is 1000 EUR — if net gains ≤ 1000 EUR, no tax owed at all (cliff, not deduction)
   - What's unclear: Should the PDF show a progress bar (like the dashboard FreigrenzeBar) or a text status?
   - Recommendation: Use a visual indicator with the amount and a clear "Freigrenze eingehalten" / "Freigrenze überschritten" status line with color coding (green/red)

3. **Font bundling in CI**
   - What we know: Font files are large binary assets (~500KB)
   - What's unclear: Whether the CI pipeline has any constraints on binary file size
   - Recommendation: Commit font files to git (binary, but small); add to `.gitattributes` as `linguist-vendored` if needed

---

## Sources

### Primary (HIGH confidence)
- `npm show pdfkit` — confirmed version 0.18.0 is latest, MIT license
- `npm show @playwright/test` — confirmed version 1.58.2
- `https://pdfkit.org/docs/getting_started.html` — constructor options, streaming API, bufferPages
- `https://pdfkit.org/docs/text.html` — text methods, font registration, positioning
- `https://pdfkit.org/docs/vector.html` — drawing API: rect, fill, stroke, save/restore, colors
- `https://playwright.dev/docs/test-webserver` — webServer config with multiple servers
- `https://playwright.dev/docs/downloads` — file download testing pattern
- `https://github.com/foliojs/pdfkit/blob/master/README.md` — HTTP streaming pattern
- Codebase inspection: schema.ts, summary.ts, tax-calculator.ts, App.tsx, package.json files

### Secondary (MEDIUM confidence)
- `https://playwright.dev/docs/intro` — installation and configuration
- `https://playwright.dev/docs/test-configuration` — globalSetup, reporters, timeout
- `https://hono.dev/docs/api/context` — `c.body()`, `c.header()` API

### Tertiary (LOW confidence, flagged)
- Font recommendation (DejaVu Sans vs Noto Sans): based on documentation + npm ecosystem knowledge, not live testing with PDFKit. Verify by running a test render before committing to font choice.
- PDFKit ESM/CJS interop: `createRequire` approach is standard Node.js pattern (HIGH confidence), but the specific error message depends on Node version — test this first in the implementation.

---

## Metadata

**Confidence breakdown:**
- Standard stack (PDFKit + Playwright): HIGH — versions confirmed via npm registry
- PDFKit API (streaming, fonts, vector): HIGH — verified against official docs
- Architecture patterns: HIGH — derived directly from codebase inspection + official docs
- Font recommendation: MEDIUM — documented capability, not live-tested with this exact setup
- German CSV semicolon convention: HIGH — well-established German Excel behavior
- ESM/CJS interop pattern: HIGH — standard Node.js documented approach

**Research date:** 2026-03-23
**Valid until:** 2026-06-23 (PDFKit and Playwright are stable; 90-day window is conservative)
