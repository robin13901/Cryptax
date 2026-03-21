# Phase 2: CSV Import Pipeline - Research

**Researched:** 2026-03-21
**Domain:** CSV parsing, file upload (Hono + React), Drizzle ORM inserts, SQLite schema migration
**Confidence:** HIGH — all findings verified against actual CSV files in the repo and existing codebase

---

## Summary

Phase 2 imports 5 Bitget CSV export formats into SQLite. The codebase already has a `transactions`
table with a unique constraint on `(order_id, exchange, checksum)` — the deduplication story is
covered by `onConflictDoNothing()`. The main work is: (1) a new `import_batches` table + a
`batch_id` column on transactions for per-batch undo; (2) five parser modules differentiated by
header-signature detection; (3) a canonical type map covering all 22 raw Bitget type strings found
in the actual files; (4) a Hono `POST /api/import/csv` endpoint receiving multipart form data; and
(5) a React drag-and-drop + file picker UI that shows per-file progress.

The CSV encoding analysis of the actual files reveals a critical quirk: **all order ID fields
(across every format) have a leading tab character** (`\t`) that must be stripped. The 2024 spot
transaction CSV uses semicolons as delimiters while every other format uses commas. The
`csv-parse` library (v6.2.1, sync API) handles BOM, trim, and multi-delimiter detection natively.

**Primary recommendation:** Use `csv-parse/sync` on the backend for parsing. No frontend CSV
library needed. HTML5 FormData for file upload. Drizzle `onConflictDoNothing()` for deduplication.
Add one migration (0001_import_batches.sql) following the Phase 1 pattern: `drizzle-kit generate`
then manually add `STRICT` before migrating.

---

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| csv-parse | 6.2.1 | CSV parsing (sync API) | Handles BOM, trim, multi-delimiter, battle-tested Node.js CSV |
| node:crypto | built-in | SHA-256 checksum for dedup | No install required, deterministic checksums |
| drizzle-orm | 0.45.1 (installed) | Batch insert with conflict handling | Already used in Phase 1 |
| better-sqlite3 | 12.8.0 (installed) | SQLite driver with sync transactions | Already used in Phase 1 |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| hono | 4.12.8 (installed) | Multipart form handling | `c.req.formData()` for file upload endpoint |
| @hono/node-server | 1.19.11 (installed) | Node.js adapter for File/Blob | Required for file.text() to work |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| csv-parse/sync | papaparse | Papaparse is browser-first; csv-parse is Node.js-native with better BOM/encoding handling |
| csv-parse/sync | Node.js readline | Manual split is error-prone for quoted fields; csv-parse handles edge cases |
| Native HTML5 DnD | react-dropzone | No additional dependency needed for this use case |

### Installation
```bash
npm install csv-parse -w packages/backend
```

---

## Actual CSV File Analysis

This section is verified against the files in `raw-bitget-exports/`. All parsers MUST handle these
exact characteristics.

### Format 1: Spot Transactions (2024 — semicolon-delimited)
```
File: 2024 Export spot transactions.csv
BOM: YES (UTF-8 BOM, 0xEFBBBF)
Delimiter: SEMICOLON (;)
Headers: order;Date;Coin;Type;Amount;Fee;Available
Columns: 7
Order ID: Column 0, tab-prefixed (\t1258113040865390595)
Amount: signed (negative = outflow)
Price: NOT present — no price column
Available: running balance, not taxable
Row count: 572 data rows
```

### Format 2: Spot Transactions (2025 — comma-delimited)
```
File: Export spot transactions-2026-01-05 05_40_51.csv
BOM: YES (UTF-8 BOM)
Delimiter: COMMA (,)
Headers: order,Date,Coin,Type,Amount,Fee,Available
Columns: 7 (IDENTICAL header to 2024 spot, different delimiter)
Order ID: Column 0, tab-prefixed (\t1389824860071079940)
Amount: signed
Price: NOT present
Row count: 889 data rows
```

**Critical:** The 2024 and 2025 spot transaction files have IDENTICAL headers but different
delimiters. Delimiter detection must happen BEFORE format detection.

### Format 3: Futures Transactions
```
Files: 2024 Export futures transactions.csv
       Export futures transactions-2026-01-05 05_41_22.csv
BOM: YES
Delimiter: COMMA (,)
Headers: Order,Date,Coin,Futures,Margin Mode,Type,Amount,Fee,Wallet balance
Columns: 9
Order ID: Column 0, tab-prefixed
Amount: signed (negative = fee, positive = PnL settled)
Price: NOT present
Symbol: from "Futures" column (e.g., "POPCATUSDT")
```

### Format 4: On-chain Earn
```
File: 2024 Bitget On-chain Earn.csv
BOM: YES
Delimiter: COMMA (,)
Headers: Reference,Start time,Coin,Type,Interest coin,Amount,Handling fee,Status
Columns: 8
Reference (order ID): Column 0, NO tab prefix (unlike all other formats)
Amount: positive only
Price: NOT present
```

### Format 5: Spot Order History
```
File: Export spot order history-2026-01-05 05_53_08.csv
BOM: YES
Delimiter: COMMA (,)
Headers: Date,Type,Order Id,Trading pair,Base Asset,Quote Asset,Direction,Price,Order amount,Executed,Average Price,Trading volume,Status
Columns: 13
Order ID: Column 2, tab-prefixed
Price: Column 7 (per unit), Average Price: Column 10
Symbol: derived from Base Asset + "/" + Quote Asset
```

### Format 6: Futures Order History
```
File: Export futures order history-2026-01-05 05_53_28.csv
BOM: YES
Delimiter: COMMA (,)
Headers: Date,Order ID,Direction,Coin,Futures,order source,Transaction type,Price,Average Price,Order amount,Executed,Trading volume,Realized P/L,NetProfits,Status
Columns: 15
Order ID: Column 1, tab-prefixed
Price: Column 7 (empty for Market orders), Average Price: Column 8
Symbol: from "Futures" column
```

---

## Architecture Patterns

### Recommended Project Structure
```
packages/backend/src/
├── routes/
│   └── import.ts              # registerImportRoutes(app: Hono) - POST /api/import/csv
│                               # GET  /api/import/batches
│                               # DELETE /api/import/batches/:id
├── import/
│   ├── index.ts               # orchestrate: detectFormat, parse, normalize, insert
│   ├── detect-format.ts       # detectFormat(headerLine: string): SourceType
│   ├── parse-csv.ts           # parseCSV(rawText: string, format: SourceType): ParsedRow[]
│   ├── normalize.ts           # normalizeRows(rows, format) → NormalizedTransaction[]
│   ├── type-map.ts            # CANONICAL_TYPE_MAP: Record<SourceType, Record<string, CanonicalType>>
│   ├── checksum.ts            # computeChecksum(row: ParsedRow): string
│   └── insert.ts              # batchInsert(rows, batchId) → InsertResult
└── db/
    ├── schema.ts              # + import_batches table, + batch_id on transactions

packages/shared/src/
└── types/
    ├── transaction.ts         # Already has ImportSummary, ImportError (extend if needed)
    └── import.ts              # ImportBatch type, PerFileResult type

packages/backend/src/import/ tests:
packages/backend/src/import/
    └── *.test.ts              # One test file per parser module
```

### Pattern 1: Format Detection by Header Signature

**What:** Before parsing, identify which of the 5 formats a file contains by normalizing the
header row to lowercase and checking for unique column names.

**When to use:** Always — called first with the raw text, returns a `SourceType`.

```typescript
// Source: verified against actual CSV files in raw-bitget-exports/
function detectDelimiter(firstLine: string): string {
  // The 2024 spot CSV is the ONLY semicolon-delimited format
  const semiCount = (firstLine.match(/;/g) ?? []).length;
  const commaCount = (firstLine.match(/,/g) ?? []).length;
  return semiCount > commaCount ? ';' : ',';
}

function detectFormat(rawText: string): SourceType {
  const bom = rawText.startsWith('\uFEFF') ? rawText.slice(1) : rawText;
  const firstLine = bom.split('\n')[0];
  const delim = detectDelimiter(firstLine);
  const cols = firstLine
    .split(delim)
    .map(c => c.trim().toLowerCase().replace(/\r$/, ''));

  const has = (col: string) => cols.includes(col);

  if (has('interest coin') && has('reference'))    return 'earn';
  if (has('netprofits') && has('realized p/l'))    return 'futures_order';
  if (has('trading pair') && has('base asset'))    return 'spot_order';
  if (has('futures') && has('wallet balance'))     return 'futures_tx';
  if (has('available'))                            return 'spot_tx';

  throw new Error(`Unknown CSV format. Headers: ${firstLine}`);
}
```

### Pattern 2: csv-parse Sync API with BOM and Trim

```typescript
// Source: csv.js.org/parse/api/sync/ and options docs (verified 2026-03-21)
import { parse } from 'csv-parse/sync';

function parseCSVText(rawText: string, format: SourceType): Record<string, string>[] {
  const delimiter = detectDelimiter(rawText.replace(/^\uFEFF/, '').split('\n')[0]);

  return parse(rawText, {
    bom: true,              // strips UTF-8 BOM automatically
    delimiter,              // ';' for 2024 spot, ',' for all others
    columns: true,          // use header row as keys
    skip_empty_lines: true,
    trim: true,             // CRITICAL: strips leading tab on all order ID fields
    relax_column_count: true, // don't fail on trailing \r or empty last col
  }) as Record<string, string>[];
}
```

**Critical:** `trim: true` strips tabs, spaces, and all whitespace chars from field values. This
handles the `\t1258113040865390595` tab-prefix on ALL order ID columns (verified: all 5 formats
except earn have tab-prefixed IDs, earn has clean numeric IDs).

### Pattern 3: Checksum Computation for Deduplication

The `transactions` table has `UNIQUE(order_id, exchange, checksum)`. The checksum provides
conflict detection for rows with the same order ID but different content (edge case).

```typescript
// Source: Node.js built-in crypto, verified available
import { createHash } from 'node:crypto';

function computeChecksum(row: Record<string, string>): string {
  // Hash the entire raw row values concatenated in column order
  // This detects content changes if Bitget ever re-exports with corrections
  const content = Object.values(row).join('|');
  return createHash('sha256').update(content).digest('hex');
}
```

### Pattern 4: Batch Insert with Conflict Detection

```typescript
// Source: Drizzle ORM insert.d.ts — onConflictDoNothing() confirmed available
import { db } from '../db/client.js';
import { transactions } from '../db/schema.js';

function chunkArray<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

function batchInsert(rows: NewTransaction[], batchId: number): { inserted: number } {
  let inserted = 0;
  const chunks = chunkArray(rows, 200); // 200 rows per INSERT statement
  db.transaction((tx) => {
    for (const chunk of chunks) {
      const result = tx
        .insert(transactions)
        .values(chunk)
        .onConflictDoNothing()
        .run();
      inserted += result.changes; // changes = rows actually inserted (not skipped)
    }
  });
  const duplicates = rows.length - inserted;
  return { inserted, duplicates };
}
```

### Pattern 5: Hono Multipart File Upload Endpoint

```typescript
// Source: verified against Hono 4.12.8 dist/utils/body.js
import type { Hono } from 'hono';

export function registerImportRoutes(app: Hono) {
  app.post('/api/import/csv', async (c) => {
    const formData = await c.req.formData();
    const files = formData.getAll('files') as File[];

    const results: PerFileResult[] = [];
    for (const file of files) {
      const text = await file.text();  // File.text() available in Hono node-server adapter
      const result = await importCSVFile(text, file.name);
      results.push(result);
    }

    return c.json({ results, summary: aggregateSummary(results) });
  });
}
```

### Pattern 6: Import Batch Table Schema Addition

The existing schema has no `import_batches` table. This must be added as migration `0001`.
Per Phase 1 pattern: run `drizzle-kit generate`, then manually add `STRICT` to the new table
statements before running `drizzle-kit migrate`.

```typescript
// To add to packages/backend/src/db/schema.ts
export const importBatches = sqliteTable('import_batches', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  filename: text('filename').notNull(),
  sourceType: text('source_type').notNull(),
  totalRows: integer('total_rows').notNull(),
  importedCount: integer('imported_count').notNull(),
  duplicatesCount: integer('duplicates_count').notNull(),
  errorsCount: integer('errors_count').notNull(),
  importedAt: text('imported_at').notNull(),
});

// And add batch_id to transactions:
// batchId: integer('batch_id').references(() => importBatches.id),
```

### Anti-Patterns to Avoid

- **String.split('\n') for CSV rows:** Does not handle quoted fields containing newlines. Use
  csv-parse exclusively.
- **Manual BOM strip before csv-parse:** Let `bom: true` handle it. Manual strip + csv-parse
  BOM stripping = double processing, no harm but unnecessary.
- **Delimiter sniffing on the entire file:** Only check the first line (header). Enough to decide.
- **Inserting rows one-by-one:** SQLite's WAL mode is fast but batch inserts are 10-50x faster.
  Always chunk-insert.
- **Checking duplicates with SELECT before INSERT:** The `onConflictDoNothing()` + `result.changes`
  pattern is atomic and performant. Pre-SELECT is redundant and slower.

---

## Complete Canonical Type Mapping

All raw type strings found in the actual CSV files, mapped to `CanonicalType`:

### Spot Transactions (`spot_tx`)
| Raw Bitget Type | Canonical Type | Notes |
|-----------------|----------------|-------|
| `Buy` | `buy` | Base asset purchase |
| `Sell` | `sell` | Base asset sale (amount is negative EUR value) |
| `Interest` | `earn_interest` | Earn/savings interest received |
| `Gains` | `earn_interest` | Similar to Interest — reward gains |
| `Financial` | `transfer_in` | Move between spot and earn/savings account |
| `Deposit` | `transfer_in` | Fiat or crypto deposit |
| `Deposit credited` | `transfer_in` | Deposit confirmed/credited |
| `Automatic deposit` | `transfer_in` | Auto-invest deposit |
| `Transfer out` | `transfer_out` | Withdrawal or internal transfer |
| `Automatic withdrawal` | `transfer_out` | Auto-invest withdrawal |
| `Consumption` | `transfer_out` | Asset spent/consumed |
| `Position profit` | `futures_funding` | Futures P&L settled to spot wallet |
| `Exchange income` | `buy` | One side of a swap (receiving side) |
| `Exchange spending` | `sell` | One side of a swap (spending side) |

### Futures Transactions (`futures_tx`)
| Raw Bitget Type | Canonical Type | Notes |
|-----------------|----------------|-------|
| `open_long` | `futures_open_long` | |
| `open_short` | `futures_open_short` | |
| `close_long` | `futures_close_long` | |
| `close_short` | `futures_close_short` | |
| `burst_close_short` | `futures_close_short` | Liquidation close of short position |
| `contract_main_settle_fee` | `futures_funding` | Daily funding rate settlement |
| `trans_from_exchange` | `transfer_in` | Transfer from spot to futures wallet |
| `transfer_from_future_copytrade` | `transfer_in` | Transfer from copy-trade |
| `risk_captital_user_transfer` | `transfer_in` | Risk margin transfer (note Bitget typo: "captital") |

### On-chain Earn (`earn`)
| Raw Bitget Type | Canonical Type | Notes |
|-----------------|----------------|-------|
| `Staking` | `earn_deposit` | Assets staked, reference = unique ID |

### Spot Order History (`spot_order`)
Canonical type derived from `Direction` column, not a `Type` column:
| Direction | Canonical Type |
|-----------|----------------|
| `Buy` | `buy` |
| `Sell` | `sell` |

### Futures Order History (`futures_order`)
Canonical type derived from `Direction` column:
| Direction | Canonical Type |
|-----------|----------------|
| `Open long` | `futures_open_long` |
| `Close long` | `futures_close_long` |
| `Open short` | `futures_open_short` |
| `Close short` | `futures_close_short` |

**For any unrecognized type string:** set `canonicalType = 'unknown'`, set `rawType` in the
import error record. The transaction is still imported (per decision: import but flag as
'unmapped').

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| BOM stripping | Manual `slice(3)` | `csv-parse { bom: true }` | BOM can be multi-byte, library handles all BOM variants |
| Quoted field parsing | Manual string split | `csv-parse` | Quoted commas, escaped quotes, newlines in fields |
| Tab stripping from IDs | Manual `trim()` call | `csv-parse { trim: true }` | trim handles all whitespace chars uniformly |
| Duplicate detection | SELECT before INSERT | `onConflictDoNothing()` + `result.changes` | Atomic, no race condition, no extra round-trip |
| SHA-256 checksums | md5 or CRC | `node:crypto` SHA-256 | Built-in, no install, collision-resistant |

---

## Common Pitfalls

### Pitfall 1: Both Spot TX Formats Have Identical Headers
**What goes wrong:** Format detection based on headers returns `spot_tx` for both 2024 and 2025
files. But the 2024 file is semicolon-delimited — if you parse it with commas, every row becomes
one big column with no splits.
**Why it happens:** Same export screen, different Bitget version changed the delimiter.
**How to avoid:** Detect delimiter FIRST (count semicolons vs commas on header line), THEN parse.
**Warning signs:** `columns.length === 1` after parsing header row.

### Pitfall 2: Tab-Prefixed Order IDs Across All Formats
**What goes wrong:** The stored `orderId` includes the leading `\t` character. Duplicate detection
fails because `\t1234` != `1234`. Two different imports of the same file create duplicate rows.
**Why it happens:** Bitget exports order IDs with a leading tab (likely spreadsheet formatting).
**How to avoid:** Use `csv-parse { trim: true }`. Verify no `\t` in extracted orderId before insert.
**Warning signs:** `orderId.startsWith('\t')` in parsed output.

### Pitfall 3: On-chain Earn Has No Tab Prefix (Unlike All Others)
**What goes wrong:** Implementing a special `ltrim('\t')` call for IDs across all parsers, but the
earn format's Reference column has no tab — trimming a non-existent tab is fine, but assuming all
formats need manual tab removal (instead of relying on csv-parse trim) creates inconsistency.
**How to avoid:** Use `trim: true` universally. It's a no-op on already-clean fields.

### Pitfall 4: Spot TX Has No Price Column
**What goes wrong:** Trying to extract `price` from spot transaction rows — there is no price
column. `Buy` and `Sell` rows only have `Amount` (coin quantity, signed) and `Fee`.
**Why it happens:** Spot transactions show coin quantity changes, not the trade price.
**How to avoid:** Set `price = null` for spot_tx rows. The `spot_order_history` format DOES have
price — these are complementary formats (order history has price, tx history has amounts).
**Warning signs:** Accessing `row['Price']` on spot_tx returns `undefined`.

### Pitfall 5: Amount Can Be Negative in Spot and Futures TX
**What goes wrong:** Treating `amount` as always positive and using it for cost basis. Sell rows
in spot_tx have negative amounts (e.g., `-37.06153` for EUR outflow). Futures open_long rows may
have `0` amount with only a fee.
**How to avoid:** Use `Math.abs(amount)` for quantity calculations; preserve sign for audit trail.
**Warning signs:** Negative FIFO lot quantities.

### Pitfall 6: STRICT Table Requirement for New Migration
**What goes wrong:** `drizzle-kit generate` does NOT add `STRICT` to CREATE TABLE statements.
Running the generated migration creates tables without strict mode, which allows type coercions.
**Why it happens:** drizzle-kit doesn't know the project's STRICT convention.
**How to avoid:** After `drizzle-kit generate`, edit the `.sql` file to add `STRICT` before running
`drizzle-kit migrate`. This was already discovered in Phase 1 (documented in context).

### Pitfall 7: Futures TX Bitget Typo — `risk_captital_user_transfer`
**What goes wrong:** Spelling it correctly as `risk_capital_user_transfer` in the type map. The
real CSV value has the typo "captital" (two t's).
**How to avoid:** Use the exact string from the file: `'risk_captital_user_transfer'`.

### Pitfall 8: `onConflictDoNothing` Counts
**What goes wrong:** Assuming `RunResult.changes` equals total rows attempted. It only counts
rows actually written. Rows skipped due to the unique constraint are NOT counted in `changes`.
**How to avoid:** `duplicates = totalAttempted - errors - result.changes`.

---

## Code Examples

### Delimiter Detection (Verified Against Actual Files)
```typescript
// Verified: 2024-spot.csv has 6 semicolons in header, 0 commas
// All other formats have commas and 0 semicolons in header
function detectDelimiter(headerLine: string): ';' | ',' {
  const semis = (headerLine.match(/;/g) ?? []).length;
  const commas = (headerLine.match(/,/g) ?? []).length;
  return semis > commas ? ';' : ',';
}
```

### Full CSV Parse Entry Point
```typescript
import { parse } from 'csv-parse/sync';

export function parseRawCSV(fileText: string): {
  format: SourceType;
  rows: Record<string, string>[];
} {
  const noBom = fileText.replace(/^\uFEFF/, '');
  const headerLine = noBom.split('\n')[0];
  const delimiter = detectDelimiter(headerLine);
  const format = detectFormat(fileText); // uses bom-aware detection

  const rows = parse(fileText, {
    bom: true,
    delimiter,
    columns: true,
    skip_empty_lines: true,
    trim: true,          // strips \t prefix from all order IDs
    relax_column_count: true,
  }) as Record<string, string>[];

  return { format, rows };
}
```

### Checksum and Normalization
```typescript
import { createHash } from 'node:crypto';
import { fromDecimal, toDecimal } from '@cryptax/shared';

function computeChecksum(row: Record<string, string>): string {
  return createHash('sha256')
    .update(JSON.stringify(row))
    .digest('hex');
}

// Tax year from timestamp: '2024-12-31 23:17:21' → 2024
function extractTaxYear(dateStr: string): number {
  return parseInt(dateStr.substring(0, 4), 10);
}
```

### Drizzle Insert with Dedup Counting
```typescript
// Confirmed available: db.insert(table).values([]).onConflictDoNothing().run()
// Returns RunResult with .changes property (rows actually inserted)
function insertRows(rows: typeof transactions.$inferInsert[]): {
  inserted: number;
  duplicates: number;
} {
  let inserted = 0;
  const chunks = chunkArray(rows, 200);
  db.transaction((tx) => {
    for (const chunk of chunks) {
      const r = tx.insert(transactions).values(chunk).onConflictDoNothing().run();
      inserted += r.changes;
    }
  });
  return { inserted, duplicates: rows.length - inserted };
}
```

### Frontend Drag-and-Drop (No External Library)
```typescript
// HTML5 DnD + file input — no react-dropzone needed
function ImportDropzone() {
  const [isDragging, setIsDragging] = useState(false);

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const files = Array.from(e.dataTransfer.files).filter(f => f.name.endsWith('.csv'));
    if (files.length > 0) uploadFiles(files);
  };

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (files.length > 0) uploadFiles(files);
  };

  async function uploadFiles(files: File[]) {
    const fd = new FormData();
    files.forEach(f => fd.append('files', f));
    const res = await fetch('/api/import/csv', { method: 'POST', body: fd });
    const data = await res.json();
    // show data.summary
  }

  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={handleDrop}
    >
      <input type="file" multiple accept=".csv" onChange={handleFileInput} />
    </div>
  );
}
```

---

## Schema Changes Required

The current schema (migration 0000_initial.sql) has no `import_batches` table and no `batch_id`
on `transactions`. Phase 2 requires migration `0001_import_batches.sql`.

### New Table: import_batches
```sql
CREATE TABLE `import_batches` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `filename` text NOT NULL,
  `source_type` text NOT NULL,
  `total_rows` integer NOT NULL,
  `imported_count` integer NOT NULL,
  `duplicates_count` integer NOT NULL,
  `errors_count` integer NOT NULL,
  `imported_at` text NOT NULL
) STRICT;
```

### Modified Table: transactions (add batch_id)
```sql
ALTER TABLE `transactions` ADD COLUMN `batch_id` integer
  REFERENCES `import_batches`(`id`) ON UPDATE no action ON DELETE set null;
CREATE INDEX `idx_transactions_batch_id` ON `transactions` (`batch_id`);
```

**Important:** The `batch_id` column must be nullable because existing transactions (pre-Phase 2)
will have no batch ID.

---

## Field Mapping Per Format

### spot_tx (both 2024 semicolon and 2025 comma)
| CSV Column | Schema Field | Notes |
|------------|-------------|-------|
| `order` (trimmed) | `orderId` | Tab prefix stripped by csv-parse trim |
| `Date` | `tradedAt` | ISO-like: '2024-12-31 23:17:21' |
| `Coin` | `symbol` | Asset symbol (e.g., 'USDE', 'EUR') |
| `Type` | → `canonicalType` | Via CANONICAL_TYPE_MAP |
| `Amount` | `amount` | Signed; use abs for quantity |
| `Fee` | `fee` | Usually '0' for spot tx |
| `Available` | `rawRow` (store) | Running balance — not stored as field, in rawRow JSON |
| — | `price` | `null` — not in this format |
| — | `side` | Derived: 'buy' if Buy, 'sell' if Sell, null for others |
| — | `totalValue` | `null` — not available in this format |
| — | `exchange` | `'bitget'` (hardcoded) |
| — | `sourceType` | `'spot_tx'` |
| — | `taxYear` | Extracted from `Date` year part |

### futures_tx
| CSV Column | Schema Field | Notes |
|------------|-------------|-------|
| `Order` (trimmed) | `orderId` | |
| `Date` | `tradedAt` | |
| `Coin` | `symbol` | Settlement coin (usually 'USDT') |
| `Futures` | `symbol` | Also used: the trading pair (e.g., 'POPCATUSDT') — prefer Futures |
| `Type` | → `canonicalType` | Via CANONICAL_TYPE_MAP |
| `Amount` | `amount` | Signed |
| `Fee` | `fee` | |
| `Wallet balance` | stored in rawRow | Running balance |
| — | `price` | `null` |
| — | `side` | Derived from canonicalType |

### earn
| CSV Column | Schema Field | Notes |
|------------|-------------|-------|
| `Reference` | `orderId` | No tab prefix (clean numeric ID) |
| `Start time` | `tradedAt` | |
| `Coin` | `symbol` | Staked asset |
| `Interest coin` | `symbol` | Use this for the asset received |
| `Type` | → `canonicalType` | 'Staking' → 'earn_deposit' |
| `Amount` | `amount` | Positive |
| `Handling fee` | `fee` | Usually '0' |
| `Status` | stored in rawRow | 'Staked' |

### spot_order
| CSV Column | Schema Field | Notes |
|------------|-------------|-------|
| `Order Id` (trimmed) | `orderId` | |
| `Date` | `tradedAt` | |
| `Base Asset` + `Quote Asset` | `symbol` | Concatenate: `BASE/QUOTE` |
| `Direction` | → `canonicalType` + `side` | Buy → buy/buy, Sell → sell/sell |
| `Average Price` | `price` | Use Average Price, not Price |
| `Order amount` | `amount` | In base asset units |
| `Trading volume` | `totalValue` | In quote asset units |

### futures_order
| CSV Column | Schema Field | Notes |
|------------|-------------|-------|
| `Order ID` (trimmed) | `orderId` | |
| `Date` | `tradedAt` | |
| `Futures` | `symbol` | Trading pair |
| `Direction` | → `canonicalType` + `side` | |
| `Average Price` | `price` | Empty for Market orders at open |
| `Order amount` | `amount` | Contract units |
| `Trading volume` | `totalValue` | Quote asset value |
| `Realized P/L` | stored in rawRow | For futures PnL tracking later |

---

## State of the Art

| Old Approach | Current Approach | Impact |
|--------------|------------------|--------|
| Manual CSV split | csv-parse/sync with options | Handles BOM, quotes, multi-char delimiters |
| Pre-insert SELECT for dedup | onConflictDoNothing() + changes count | Atomic, faster, no race condition |
| FormData with single file | `getAll('files')` | Multi-file batch in one request |

---

## Open Questions

1. **`Financial` type in spot_tx — exact semantics unclear**
   - What we know: appears 2 times in 2025 data, implies account-to-account transfer
   - What's unclear: whether it's always an internal Bitget transfer or could be external
   - Recommendation: map to `transfer_in` initially, flag for review if amount is large

2. **`Position profit` in spot_tx — is this taxable at receipt?**
   - What we know: mapped to `futures_funding` (daily settle from futures to spot)
   - What's unclear: German tax treatment — taxable when settled or when position closes?
   - Recommendation: store with `canonicalType = 'futures_funding'` and flag in import summary

3. **Price for spot_tx Buy/Sell rows**
   - What we know: no price in spot_tx format; spot_order_history has price for confirmed orders
   - What's unclear: are ALL spot_tx Buy/Sell rows guaranteed to have a corresponding spot_order?
   - Recommendation: set `price = null` for spot_tx; Phase 3+ will fetch EUR price via price API

4. **`Consumption` in 2025 spot_tx (1 row)**
   - What we know: only 1 occurrence, mapped to `transfer_out`
   - What's unclear: could be payment for Bitget service, trading fee, or internal spend
   - Recommendation: import as `transfer_out` but store raw type for user review

---

## Sources

### Primary (HIGH confidence)
- Actual CSV files in `raw-bitget-exports/` — all format characteristics verified by direct file
  analysis (encoding, BOM, delimiters, column names, row counts, type values)
- `packages/backend/src/db/schema.ts` — existing schema, unique constraints, column types
- `packages/shared/src/types/transaction.ts` — CanonicalType, SourceType, ImportSummary types
- `packages/backend/drizzle/0000_initial.sql` — migration pattern, STRICT keyword placement
- `node_modules/drizzle-orm/sqlite-core/query-builders/insert.d.ts` — onConflictDoNothing() API
- `node_modules/hono/dist/utils/body.js` — multipart formData() support verified
- `node_modules/hono/dist/request.js` — File.formData() and parseBody() available

### Secondary (MEDIUM confidence)
- https://csv.js.org/parse/api/sync/ — csv-parse sync API
- https://csv.js.org/parse/options/bom/ — bom: true option confirmed
- https://csv.js.org/parse/options/trim/ — trim strips tabs and spaces, confirmed
- https://csv.js.org/parse/options/delimiter/ — accepts string | Buffer | array, default ","
- npm registry: csv-parse@6.2.1 is current stable (checked 2026-03-21)

### Tertiary (LOW confidence)
- None required — all critical claims verified via primary sources

---

## Metadata

**Confidence breakdown:**
- CSV format analysis: HIGH — read actual files byte-by-byte
- Standard stack: HIGH — verified installed versions in node_modules
- Architecture patterns: HIGH — based on Phase 1 patterns in codebase + Drizzle API verified
- Canonical type mapping: HIGH — extracted from actual type values in CSV files
- Pitfalls: HIGH — discovered by direct inspection of file anomalies (tabs, BOM, delimiter change)

**Research date:** 2026-03-21
**Valid until:** 2026-06-21 (stable domain — CSV format changes only when Bitget changes exports)
