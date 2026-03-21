# Domain Pitfalls: Cryptax

**Domain:** Local crypto tax reporting tool — German tax law (EStG)
**Project:** Cryptax — Bitget CSV import, FIFO engine, Anlage SO / Anlage KAP reports
**Researched:** 2026-03-21
**Data sources used:** Direct inspection of actual Bitget CSV exports (raw-bitget-exports/), Python reference script (get_eur_prices_bitget.py), existing ARCHITECTURE.md + FEATURES.md, training data for German tax law (MEDIUM confidence — no official BMF source was fetchable)

---

## How to Read This File

Each pitfall entry includes:
- **Severity**: CRITICAL (causes wrong tax numbers / data corruption), HIGH (causes incorrect behavior), MEDIUM (causes bugs or rework), LOW (causes friction or suboptimal UX)
- **Phase**: Which development phase should build the prevention into its design
- **Warning signs**: How to detect the problem early
- **Prevention**: What to do instead

---

## Critical Pitfalls

### C1. Floating-Point Arithmetic for Monetary Values

**Severity:** CRITICAL
**Phase:** Phase 1 (Foundation) — must be correct from day one

**What goes wrong:**
Using JavaScript `number` type for any monetary calculation in the FIFO engine or tax summaries. IEEE 754 binary floats produce errors like `0.1 + 0.2 === 0.30000000000000004`. In a FIFO calculation processing 1,800+ `contract_main_settle_fee` rows (each tiny USDT amounts like `-0.0187735743`), these errors accumulate across hundreds of operations and produce a final sum that is wrong by several cents or euros.

**Why it happens:**
Developers write `const gain = proceeds - costBasis` using native numbers because it looks normal. The error only becomes visible in the final tax total, which is hard to trace back.

**Consequences:**
- Tax liability calculation is off by an amount that cannot be explained
- Generated PDF shows different totals than manual verification
- Finanzamt may query the discrepancy
- The error compounds when dealing with high-volume assets like USDE Interest rows (495 entries in 2024 alone, each at 0.00067825 USDE)

**Prevention:**
- Use `decimal.js` for every monetary operation without exception: `new Decimal(proceeds).minus(costBasis)`
- Store all monetary values in SQLite as `TEXT` strings, never as `REAL`
- Define a project-wide rule: `number` type is only used for display rounding and array indexing
- Write a test that verifies `new Decimal('0.1').plus('0.2').eq('0.3')` passes while `0.1 + 0.2 === 0.3` fails

**Warning signs:**
- Any `parseFloat()` or `Number()` call used in FIFO engine or tax calculation code
- SQLite schema using `REAL` type for any monetary column
- Test assertions using `.toBeCloseTo()` instead of exact string equality for EUR amounts

---

### C2. FIFO Lot Pool Not Isolated Per Asset

**Severity:** CRITICAL
**Phase:** Phase 4 (FIFO Engine)

**What goes wrong:**
Using a single global FIFO queue instead of one queue per coin. When disposing of BTC, the engine accidentally consumes USDE or SOL lots if the queue is not filtered correctly.

**Why it happens:**
Common mistake when implementing the query:
```sql
-- WRONG: missing asset filter
SELECT * FROM fifo_lots WHERE status != 'closed' ORDER BY acquired_at ASC

-- CORRECT
SELECT * FROM fifo_lots WHERE asset = ? AND status != 'closed' ORDER BY acquired_at ASC
```

**Consequences:**
- BTC cost basis is computed using SOL acquisition prices — completely wrong
- Negative lots appear for some coins while others remain overcounted
- Tax numbers are fundamentally wrong, not just slightly off

**Prevention:**
- The FIFO query must always include `WHERE asset = ?` with the specific coin being disposed
- Write a unit test with two different coins that verifies disposing coin A does not affect coin B's lot pool
- The `fifo_lots` table index `idx_lot_asset_status ON fifo_lots(asset, status)` enforces the right query pattern

**Warning signs:**
- FIFO query does not include an `asset` filter parameter
- Test suite does not have a multi-coin scenario

---

### C3. Treating Futures P&L as FIFO Lot Acquisitions/Disposals

**Severity:** CRITICAL
**Phase:** Phase 4 (FIFO Engine)

**What goes wrong:**
The FIFO engine processes all transaction types including futures `open_long`, `close_long`, etc. The engine creates a USDT "lot" every time a futures position is opened and consumes it on close. This causes USDT lot pollution: hundreds of tiny USDT lots from settlement fees get mixed into the USDT lot pool.

**Why it happens:**
The USDT transactions in the futures export look superficially like spot buy/sell transactions. The Type values `open_long` and `close_long` sound like acquisitions and disposals.

**Real data evidence:**
The 2025 futures file contains 1,814 `contract_main_settle_fee` rows — each is a funding rate payment in USDT. The 2024 futures file has 60 such rows. None of these are FIFO events. They are Abgeltungssteuer events under § 20 EStG.

**Consequences:**
- USDT lot pool becomes corrupted with thousands of tiny synthetic lots
- FIFO matching for legitimate USDT spot trades is nonsensical
- Futures gains get double-counted: once in the FIFO engine, once in the futures P&L engine
- Holding period (Haltefrist) is incorrectly applied to futures P&L (it does not apply under § 20 EStG)

**Prevention:**
- The FIFO engine must have a strict allowlist of `canonical_type` values that create lots or trigger disposals
- Lot-creating types: `buy`, `staking_reward`, `deposit` (own wallet), `exchange_income` (if taxable)
- Lot-consuming types: `sell`, `exchange_spending` (crypto-to-crypto swap)
- FIFO engine must reject: `open_long`, `close_long`, `open_short`, `close_short`, `contract_main_settle_fee`, `funding_fee`
- All futures types go to `FuturesPnlEngine`, never to `FifoEngine`

**Warning signs:**
- USDT lot pool growing with thousands of entries
- `fifo_lots` table has rows where `account_type = 'futures'`

---

### C4. Partial Lot Consumption Arithmetic Error

**Severity:** CRITICAL
**Phase:** Phase 4 (FIFO Engine)

**What goes wrong:**
When a disposal amount spans multiple lots (e.g., sell 1.5 BTC but the oldest lot only has 1.0 BTC remaining), the engine fails to correctly update the first lot's `remaining` amount and track how much of the disposal is still unsatisfied after consuming the first lot.

Common bug pattern:
```typescript
// BUGGY — uses original lot amount instead of remaining
const consumed = Math.min(lot.original_amount, remainingToDispose);

// CORRECT — must use the current remaining
const consumed = Decimal.min(new Decimal(lot.remaining), remainingToDispose);
```

**Consequences:**
- Lot remaining goes negative (0.0 BTC original lot shows -0.5 remaining)
- Or: disposal stops early — only 1.0 of 1.5 BTC is matched to lots, 0.5 BTC appears tax-free/unmatched
- Cost basis is off by exactly the partial amount

**Prevention:**
- Always query `lot.remaining`, never `lot.original_amount`, for the consumption calculation
- Verify `remaining` is updated atomically: `UPDATE fifo_lots SET remaining = remaining - consumed`
- Essential unit test: "buy 1 BTC, then buy 1 BTC, then sell 1.5 BTC — verify first lot has 0 remaining, second lot has 0.5 remaining, total cost basis is correct"
- Add a database CHECK constraint: `remaining >= 0`

**Warning signs:**
- Any lot with `remaining` value that is negative
- Sum of `lot_consumptions.amount_consumed` for a given `lot_id` exceeds `fifo_lots.original_amount`

---

### C5. Freigrenze Cliff vs. Freibetrag Confusion

**Severity:** CRITICAL
**Phase:** Phase 4 (Tax Calculation)

**What goes wrong:**
Implementing the Freigrenze as a Freibetrag (a deduction) instead of a cliff threshold.

**Freibetrag behavior (WRONG for this context):**
`taxable = max(0, totalGains - 1000)` → 1,001 EUR gains → 1 EUR taxable

**Freigrenze behavior (CORRECT):**
`taxable = totalGains > 1000 ? totalGains : 0` → 1,001 EUR gains → 1,001 EUR taxable

**German tax law context (MEDIUM confidence — training data, BMF source not fetched):**
- § 23 EStG Spot gains: Freigrenze of 1,000 EUR (raised from 600 EUR for tax year 2024+)
- § 22 Nr. 3 EStG Earn/Staking income: Freigrenze of 256 EUR
- Both are cliffs: below the threshold the entire amount is exempt; at or above it the entire amount is taxable
- The 1,000 EUR figure applies per person per year across ALL private Veräußerungsgeschäfte (not only crypto — also applies to gold, art, etc.)

**Consequences:**
- A user with 1,001 EUR gains is shown 1 EUR taxable instead of 1,001 EUR taxable — they under-report by 1,000 EUR
- Or: a user with 999 EUR gains is shown 999 EUR taxable when they actually owe nothing — they over-report

**Prevention:**
- The calculation must be a strict greater-than comparison: `if (totalGains.gt(FREIGRENZE)) return totalGains; return ZERO;`
- Define the threshold as named constants: `SPOT_FREIGRENZE = new Decimal('1000')` and `EARN_FREIGRENZE = new Decimal('256')`
- Test with boundary values: 999.99 EUR, 1000.00 EUR, 1000.01 EUR — all must produce the correct result
- Write the test scenario in the test file with an explicit comment: "this is a CLIFF, not a deduction"

**Warning signs:**
- Code using subtraction `totalGains - 1000` to compute taxable amount
- Missing boundary test at exactly 1,000 EUR and 1,000.01 EUR

---

### C6. Haltefrist Calculation Using Wrong Date Arithmetic

**Severity:** CRITICAL
**Phase:** Phase 4 (FIFO Engine)

**What goes wrong:**
Comparing dates incorrectly for the 1-year holding period:
1. Off-by-one: using `> 365` when the rule is `>= 365` days (or using calendar years instead of days)
2. Timezone bugs: the acquisition timestamp is stored in UTC but compared using local time, causing a 1-2 hour discrepancy that shifts the day boundary
3. Using `new Date()` subtraction with `.getTime()` instead of a proper day-difference function: leap years, DST changes, and timezone offsets can produce 364.999... days that truncate to 364

**German law context (MEDIUM confidence):**
The Haltefrist under § 23 Abs. 1 Nr. 2 EStG requires holding the asset for more than 1 year ("mehr als ein Jahr"). In practice this means >= 366 days? — the exact day count is ambiguous when a leap year is involved. The safe implementation: calculate `disposalDate - acquisitionDate` as a whole calendar-day difference in UTC, then check `days >= 365`.

**Real data example:**
The SOL staking entry was deposited 2024-12-16 and returned 2025-12-04 (from actual CSV data). That is 353 days — NOT tax-free under Haltefrist. But if timezone handling shifts one of these dates by a few hours, the day count could be 352 or 354.

**Consequences:**
- Tax-free lots counted as taxable (over-reporting, user pays too much — annoying but legal)
- Taxable lots counted as tax-free (under-reporting, user pays too little — potential tax fraud liability)

**Prevention:**
- Store ALL timestamps as ISO 8601 UTC strings in SQLite from the very first import step
- The Python reference script explicitly converts to UTC: `dt.astimezone(timezone.utc)` — replicate this in Node.js
- Implement `dateDiffDays(a: string, b: string): number` as: parse both strings to UTC Date objects, subtract full UTC days only (not hours)
- Test cross-midnight edge: acquired `2024-01-01T23:59:00Z`, disposed `2025-01-01T00:01:00Z` → 365 days → tax-free
- Test leap year: acquired `2024-02-28`, disposed `2025-02-28` → 365 days → tax-free (2024 is a leap year, 366 days in the year, but the difference is still 365)

**Warning signs:**
- `dateDiffDays()` function not covered by timezone edge case tests
- Timestamps stored without explicit 'Z' suffix (ambiguous timezone)
- Using `moment.js` `diff('days')` without verifying it uses UTC

---

## High Pitfalls

### H1. Tab Prefix on ID Column Not Stripped

**Severity:** HIGH
**Phase:** Phase 2 (CSV Import)

**What goes wrong:**
Every data row in Bitget CSV exports has a leading tab character `\t` before the order/reference ID. This is visible in the raw hex: the second line starts with `0x09` (tab) before the numeric ID. If the tab is not stripped, the IDs are stored as `"\t1258113040865390595"` instead of `"1258113040865390595"`.

**Real data evidence (from direct file inspection):**
```
First line (header, no tab): order;Date;Coin;Type;Amount;Fee;Available
Second line (data, tab present): \t1258113040865390595;2024-12-31 23:17:21;USDE;Interest;...
```
This pattern exists in ALL five Bitget CSV export types: spot transactions, futures transactions, spot order history, futures order history, and earn.

**Consequences:**
- Duplicate detection (SHA256 checksum on order ID) fails to identify the same order across imports
- Database constraint `UNIQUE (external_id)` does not catch duplicates if one has `\t` prefix and another does not
- The checksum approach works at file level, but if two files overlap in rows, the tab-prefixed ID will cause double-counting

**Prevention:**
- In every CSV parser: `external_id = row.orderId.trim()` (trim removes both leading tabs and trailing whitespace/CR)
- Apply `.trim()` to ALL string fields, not just IDs — other fields may have similar artifacts
- Add a parser unit test that asserts `parseSpotTxRow` with a tab-prefixed ID row produces the correct trimmed ID
- The architecture document already documents this: "ID columns trimmed" — enforce it in code review

**Warning signs:**
- `external_id` values in the database that start with `\t` or contain whitespace
- Duplicate rows appearing after re-import of an overlapping date range

---

### H2. BOM Character Corrupting First Column Name

**Severity:** HIGH
**Phase:** Phase 2 (CSV Import)

**What goes wrong:**
All Bitget CSV files start with a UTF-8 BOM (`\xEF\xBB\xBF`). If the CSV parser does not explicitly handle BOM, the first header column name becomes `"\uFEFForder"` or `"\uFEFFDate"` instead of `"order"` or `"Date"`. Format detection then fails to recognize the header signature, throwing an "unknown CSV format" error or silently producing null values for the first column.

**Real data evidence:**
Direct hex inspection confirms `EF BB BF` as the first three bytes of every CSV file in the dataset.

**2025 delimiter change:** The 2025 spot transactions file uses commas (`order,Date,Coin,...`) while the 2024 spot transactions file uses semicolons (`order;Date;Coin;...`). Both have the BOM prefix. The BOM must be stripped before delimiter detection, not after.

**Prevention:**
- Use `csv-parse` with the `bom: true` option — it strips BOM automatically
- If implementing a custom reader: detect BOM at byte level, strip before passing to CSV parser
- Format detection logic operates on the cleaned header, never the raw bytes
- Unit test: parse a CSV string that starts with `\uFEFF` and verify the first column header is clean

**Warning signs:**
- Format detection throwing `Unknown CSV format` on files that should be recognized
- First column values being null while all other columns parse correctly
- `headers.includes('order')` returning false even though the file has an `order` column

---

### H3. 2024/2025 Spot Delimiter Change Not Handled

**Severity:** HIGH
**Phase:** Phase 2 (CSV Import)

**What goes wrong:**
The 2024 spot transactions file uses semicolons: `order;Date;Coin;Type;Amount;Fee;Available`
The 2025 spot transactions file uses commas: `order,Date,Coin,Type,Amount,Fee,Available`

These have identical column structure but different delimiters. A parser hardcoded to semicolons will fail silently on 2025 data: it will see the entire header as a single column named `"order,Date,Coin,Type,Amount,Fee,Available"` and produce no output rows.

**Real data evidence:** Confirmed by direct inspection of both files.

**Consequences:**
- 889 rows from 2025 spot transactions silently not imported
- User sees no error, just 0 spot transactions for 2025
- Tax calculation for 2025 spot gains is completely wrong (0 instead of actual)

**Prevention:**
- The format detector must attempt delimiter detection before comparing header columns
- Strategy: try parsing with `;` first, then `,` — if the semicolon parse produces only 1 column, switch to comma
- Or use `csv-parse`'s `delimiter` option with auto-detection: pass both `','` and `';'` and pick the one that produces the right column count
- Unit test: parse the same schema with both semicolons and commas — both must produce identical output

**Warning signs:**
- Parser hardcoded to a single delimiter character
- Missing test coverage for both delimiter variants of the same format

---

### H4. Unknown Transaction Types Silently Dropped

**Severity:** HIGH
**Phase:** Phase 2 (CSV Import)

**What goes wrong:**
Transaction types in real Bitget exports include many types not present in documentation: `Position profit`, `Exchange spending`, `Exchange income`, `Automatic deposit`, `Automatic withdrawal`, `Gains`, `Consumption`, `Financial`, `burst_close_short`, `risk_captital_user_transfer`, `transfer_from_future_copytrade`.

If the parser maps transaction types via a lookup table or switch statement, any unlisted type is either silently dropped (producing incomplete data) or throws an unhandled error (breaking the import).

**Real data evidence (2025 spot transactions):**
- 288 `Position profit` rows
- 7 `Exchange spending` rows (crypto-to-crypto swaps — these ARE taxable events)
- 7 `Exchange income` rows (proceeds of crypto-to-crypto swap)
- 8 `Automatic deposit` rows (staking product close returning coins)
- 2 `Automatic withdrawal` rows
- 2 `Financial` rows (staking product open/close, maps to USDE→earn deposit)
- 1 `Gains`, 1 `Consumption` (USDE earn product settlement)

**Consequences:**
- `Exchange spending` rows dropped = crypto-to-crypto swap disposals not recorded = gains not taxed
- `Position profit` rows dropped = USDE earn income not recorded
- Audit trail is incomplete — raw import looks like complete data but is missing taxable events

**Prevention:**
- The parser must have an explicit UNKNOWN_TYPE handler that does NOT silently drop rows
- All unknown types must be imported with `canonical_type = 'unclassified'` and flagged in the UI
- After importing, show a warning: "3 rows with unknown type 'XYZ' — please classify manually"
- Define the complete canonical_type taxonomy upfront and map all observed types to it
- Canonical type map (from actual data):

| Bitget Type | canonical_type |
|------------|----------------|
| Interest | staking_reward |
| Buy | buy |
| Sell | sell |
| Deposit | deposit |
| Automatic withdrawal | withdrawal |
| Transfer out | transfer_out |
| Financial (negative amount) | staking_deposit |
| Financial (positive amount) | staking_withdrawal |
| Exchange spending | swap_out |
| Exchange income | swap_in |
| Position profit | earn_yield |
| Gains | earn_settlement_gain |
| Consumption | earn_settlement_spend |
| Automatic deposit | staking_return |
| Deposit credited | deposit |

**Warning signs:**
- Parser using `throw new Error('Unknown type')` on unknown types — this breaks the whole import
- Parser using a default case that returns null — rows are silently dropped

---

### H5. Crypto-to-Crypto Swap Taxability Not Modeled

**Severity:** HIGH
**Phase:** Phase 4 (FIFO Engine)

**What goes wrong:**
Bitget records a crypto-to-crypto swap as two rows: one `Exchange spending` (disposal) and one `Exchange income` (acquisition). If either row is misclassified — or if swaps are treated as non-taxable transfers — the disposal side is missed and gains on the swapped asset are not taxed.

**Real data evidence:**
Looking at the 2025 spot data: `Exchange spending` removes assets like TRUMP, MOZ, 0X0 at the same timestamp as `Exchange income` adds BGB. This is a taxable disposal of TRUMP/MOZ/0X0 (if held < 365 days), with the EUR value at the time of the swap as both the proceeds for the outgoing coins and the acquisition cost for the incoming BGB.

**German law context (MEDIUM confidence):**
Under § 23 EStG, exchanging one cryptocurrency for another is a taxable disposal event, even though no EUR is received. The "proceeds" are the EUR value of the received coin at the time of the exchange. This is the same as if you sold the first coin for EUR and immediately bought the second coin with EUR.

**Consequences:**
- Gains on TRUMP/MOZ/0X0 unreported
- BGB cost basis is set to 0 (no acquisition cost recorded) — future BGB disposal will show inflated gains

**Prevention:**
- `Exchange spending` rows must trigger FIFO lot consumption with proceeds = EUR value of corresponding `Exchange income` rows at the same timestamp
- Link the two rows by timestamp + grouping: all `Exchange spending` and `Exchange income` rows with identical timestamps are part of one swap event
- The BGB acquisition lot must have cost_basis_eur = EUR value at the swap time
- Write a test scenario: swap TRUMP for BGB, verify TRUMP lot is consumed, BGB lot is created, gain on TRUMP is computed

**Warning signs:**
- `Exchange spending` classified as non-taxable transfer
- No logic to pair spending/income rows at the same timestamp
- BGB lot created with `cost_basis_eur = '0'`

---

### H6. Financial Type Represents Staking Principal Movement, Not Income

**Severity:** HIGH
**Phase:** Phase 2 (CSV Import) and Phase 4 (FIFO Engine)

**What goes wrong:**
The Bitget `Financial` transaction type appears in BOTH the 2024 and 2025 spot files with opposite amount signs:
- 2024: `Financial, -0.2393504, SOL` — sending SOL principal into the staking product
- 2025: `Financial, +0.2393504, SOL` — receiving SOL principal back from staking

This is NOT income. It is the movement of the principal stake. Classifying this as staking income would double-count the SOL that was already accounted for in the earn CSV.

Additionally, the earn CSV records the staking entry separately: `Reference,Start time,Coin,Type,Amount,Handling fee,Status` — `Staking, 0.2393504 SOL`. The `Financial` rows are the spot account's view of the same movement.

**Consequences:**
- `Financial -0.2393504 SOL` misclassified as "sell" → FIFO engine consumes a lot for a staking deposit (incorrect)
- `Financial +0.2393504 SOL` misclassified as "staking_reward" → income is over-reported, a second SOL lot is created

**Prevention:**
- `Financial` with negative amount = `staking_deposit` — remove from FIFO lot pool, track as "locked" in earn product
- `Financial` with positive amount = `staking_withdrawal` — coins return to the FIFO lot pool with their original acquisition cost basis (they were never disposed, just locked)
- The staking_deposit/withdrawal do NOT generate taxable events — only the interest rows do
- Write a full round-trip test: stake 1 SOL (Financial -1), earn 0.001 SOL interest, unstake 1 SOL (Financial +1) → only 0.001 SOL is taxable income

**Warning signs:**
- `Financial` rows mapped to the same canonical_type regardless of amount sign
- SOL lot pool doubling after staking round-trip

---

### H7. Price Timestamp Mismatch Causing Wrong EUR Conversion

**Severity:** HIGH
**Phase:** Phase 3 (Price Enrichment)

**What goes wrong:**
The Python reference script reveals the timezone assumption: all Bitget CSV timestamps are assumed to be Europe/Berlin time and converted to UTC before API lookup. If the Node.js port uses `new Date(dateString)` directly without timezone specification, Node.js may interpret the string as local time (which could be UTC on a CI server) or as UTC (wrong for Berlin time which is UTC+1 in winter, UTC+2 in summer).

For a transaction at `2024-12-31 17:00:05` (Berlin time, UTC+1 in December), the correct UTC timestamp is `2024-12-31 16:00:05Z`. If interpreted as UTC, the price lookup is 1 hour off — which can produce a price from a different hourly candle.

**Real data evidence:**
The Python script explicitly: `dt.replace(tzinfo=ZoneInfo('Europe/Berlin')).astimezone(timezone.utc)`

For USDE interest payments (constant 0.00067825 USDE every hour), the EUR price of USDE fluctuates slightly. A 1-hour offset won't cause large errors. But for volatile assets like SOL or POPCAT at a specific trade timestamp, a 1-hour offset could mean a meaningfully different price.

**Consequences:**
- Cost basis for spot buys is slightly wrong (wrong hourly candle)
- Gain/loss calculations are off by the price difference between the correct and incorrect candle
- For assets with high intraday volatility (POPCAT, PEPE), the error can be several percent

**Prevention:**
- Parse all Bitget CSV timestamps as `Europe/Berlin` (not UTC, not local) — this is what the Python script does
- In Node.js: use the `Temporal` API (Node.js 21+) or `date-fns-tz` for explicit timezone handling
- Store the UTC-normalized timestamp in SQLite immediately after parsing
- Conversion: `import { zonedTimeToUtc } from 'date-fns-tz'; zonedTimeToUtc(dateStr, 'Europe/Berlin')`
- Write a test: `parseTimestamp('2024-12-31 17:00:05')` must return `'2024-12-31T16:00:05.000Z'`

**Warning signs:**
- CSV parser using `new Date(row.Date)` without timezone specification
- Price lookup function that accepts a bare date string without timezone context

---

### H8. Missing EUR Price Not Properly Handled

**Severity:** HIGH
**Phase:** Phase 3 (Price Enrichment)

**What goes wrong:**
Some assets in the dataset (0X0, ALCH, MOZ, APPA, TURBO) are small-cap tokens that may have limited or no trading history on Bitget's EUR or USDT pairs. When the Bitget API returns no candle data, the price resolution strategy currently falls through to "mark as unresolved." If unresolved prices are silently left as NULL and the FIFO engine runs anyway, the cost basis for those lots is either NULL (engine crashes) or 0 (lot is created with zero cost, inflating apparent gains).

**Real data evidence:** The Python script explicitly handles the `None` return case — it increments a `failures` counter and leaves the price column empty. The Node.js port must do the same but make it visible to the user.

**Consequences:**
- NULL cost basis in `fifo_lots` causes the FIFO engine to throw a NaN or type error mid-calculation
- OR: zero cost basis means any future disposal of that asset shows 100% gain (over-reporting)
- OR: entire engine run fails and no tax summary is generated

**Prevention:**
- Before the FIFO engine runs, assert that `price_eur IS NOT NULL` for all transactions that create or consume lots
- The engine route `POST /api/engine/run` must return an error listing all transactions with missing prices
- UI must show a warning: "Price missing for 3 transactions — resolve before generating tax report"
- Allow manual price entry for unresolvable tokens: user can input the EUR price they observed at trade time
- Alternative: CoinGecko fallback for tokens not on Bitget (if the token has a CoinGecko ID)

**Warning signs:**
- FIFO engine run succeeds even when `price_eur IS NULL` for some transactions
- `cost_basis_eur = '0'` in `fifo_lots` for non-zero-cost acquisitions

---

### H9. Negative Balance / Missing Earlier Import Data

**Severity:** HIGH
**Phase:** Phase 4 (FIFO Engine)

**What goes wrong:**
The FIFO engine processes a disposal transaction for an asset but there are no open lots with sufficient `remaining` balance to match. This happens when:
1. The user imported 2024 data but is missing earlier transaction history (trades before 2024)
2. The user imported only some CSV file types (e.g., only spot transactions, missing spot order history)
3. Cross-exchange activity: user bought on another exchange, transferred in, now sells on Bitget

**Consequences:**
- FIFO engine cannot match the disposal to any lot
- If the engine silently assigns zero cost basis: gain is inflated (100% of proceeds is taxable)
- If the engine crashes: no tax summary generated at all

**Prevention:**
- The engine must have a `recordDataGap(txId, remainingAmount)` function as specified in ARCHITECTURE.md
- Data gaps must be surfaced in the UI: "Cannot compute cost basis for 0.5 BTC disposal on 2024-12-13 — no acquisition history found"
- The generated tax report must note which disposals have incomplete cost basis and that the user must resolve them manually
- The data gap does NOT stop the engine — it records the problem and continues processing other transactions
- Consider a "zero-cost lot floor" warning: "We have applied 0 EUR cost basis to 0.5 BTC — this inflates your taxable gain. If you have historical acquisition data, import it."

**Warning signs:**
- FIFO engine crashing on disposal with "no lots available" error (should be a handled case, not a crash)
- Tax summary generated without any mention of unmatched disposals

---

## Moderate Pitfalls

### M1. USDT→EUR Conversion Applies Different Timestamps

**Severity:** MEDIUM
**Phase:** Phase 3 (Price Enrichment)

**What goes wrong:**
For coins with no EUR pair, the price strategy is `price_COIN_USDT × rate_USDT_EUR`. The Python script correctly fetches both at the same timestamp (within the same minute). A naive implementation might fetch the USDT rate at a different time or use a daily USDT/EUR rate when a 1-minute rate is needed.

**Prevention:**
- Both API calls (COINUSDT and USDTEUR) must use the same millisecond-aligned timestamp
- Cache the USDTEUR rate per minute separately in `price_cache` to avoid redundant lookups
- Unit test: mock both API calls and verify the same timestamp is passed to both

---

### M2. Duplicate Import Not Caught Because Checksum Is Missing

**Severity:** MEDIUM
**Phase:** Phase 2 (CSV Import)

**What goes wrong:**
The SHA256 checksum approach described in ARCHITECTURE.md must be computed on the raw file bytes before BOM stripping and delimiter normalization — not on the parsed content. If checksum is computed on normalized content, two files that differ only in line endings or BOM will get the same checksum but produce the same data.

Also: if a user exports a CSV for "Dec 2024" and later exports "Nov-Dec 2024," the second file contains the same December rows but with a different filename and thus a different file-level checksum. Row-level deduplication by `external_id` (order ID) is required in addition to file-level checksum.

**Prevention:**
- File-level checksum prevents exact duplicate file imports
- Row-level deduplication on `external_id` prevents overlapping date-range imports from creating duplicate rows
- `INSERT OR IGNORE INTO transactions (external_id, ...)` handles this gracefully

---

### M3. SQLite WAL Mode Not Enabled

**Severity:** MEDIUM
**Phase:** Phase 1 (Foundation)

**What goes wrong:**
SQLite's default journal mode is DELETE (rollback journal). Under concurrent read/write access (frontend querying transactions while backend import is writing), this can cause "database is locked" errors that surface as HTTP 500 errors in the UI mid-import.

**Prevention:**
- Enable WAL mode on database initialization: `PRAGMA journal_mode = WAL`
- Also set: `PRAGMA synchronous = NORMAL` (safe with WAL, faster than FULL)
- `better-sqlite3` runs synchronously, so there is no true concurrency within a single Node.js process, but WAL mode is still beneficial when multiple HTTP requests are handled between event loop ticks

---

### M4. PDFKit Table API Is New and Undertested

**Severity:** MEDIUM
**Phase:** Phase 6 (PDF Export)

**What goes wrong:**
PDFKit 0.17.0 added table support (the feature is being used in v0.18.0). Native table support in a PDF library is complex — edge cases around cell overflow, long text truncation, column width calculation, and page breaks within tables are commonly buggy in early versions.

**Real risk:** The Steuerreport appendix contains one row per taxable disposal. With 50+ trades in a year, the table spans multiple pages. PDFKit's table pagination behavior is unproven at scale.

**Prevention:**
- Test PDF generation with 50, 100, and 200 rows to validate pagination
- Have a fallback: if table API fails or produces bad output, manually position each cell with `doc.text(value, x, y)` — tedious but reliable
- Test German Umlauts (ä, ö, ü, ß) in text — custom font or embedded Latin font required for PDFKit to render these correctly

---

### M5. Bitget API Rate Limiting During Bulk Price Fetch

**Severity:** MEDIUM
**Phase:** Phase 3 (Price Enrichment)

**What goes wrong:**
The Python script operates at 600 requests/minute (10 req/s). For 3,400 transactions, this is ~6 minutes. But some transactions require 2 API calls (COINUSDT + USDTEUR), and each call can retry up to 10 times on failure. Aggressive parallelism in the Node.js port (using `Promise.all`) can hit rate limits and cause cascading retries.

**Prevention:**
- Use `p-throttle` with a conservative limit: 10 req/s max
- Process price enrichment in serial or with small concurrency (4-8 parallel requests max, not Promise.all on all 3,400)
- The Python script's incremental save-after-every-success pattern is correct — port this to Node.js (update `price_eur` in the transaction row after each successful API call, so partial progress is preserved on failure)
- Progress reporting to frontend: SSE or polling endpoint showing "enriched 200/3400 transactions"

---

### M6. Earn CSV Has Only One Row in 2024 Data

**Severity:** MEDIUM
**Phase:** Phase 2 (CSV Import)

**What goes wrong:**
The 2024 earn CSV has exactly 1 data row: the SOL staking entry. The USDE interest income is recorded in the spot transactions CSV as `Interest` type rows (495 rows in 2024), NOT in the earn CSV. A naive assumption that "earn income = earn CSV only" misses 495 rows of interest income.

**Real data evidence:**
- `2024 Bitget On-chain Earn.csv`: 1 row (SOL staking deposit)
- `2024 Export spot transactions.csv`: 495 rows of Type=`Interest` for USDE, plus 288 rows of Type=`Position profit` in 2025

**Consequences:**
- Staking/earn income under § 22 Nr. 3 EStG is massively under-reported
- User thinks they earned 0 EUR from staking when they actually earned hundreds of EUR from USDE interest

**Prevention:**
- The `spot transactions` parser must classify `Interest` type as `staking_reward` and route it to the earn income calculation
- `Position profit` in the 2025 spot file is the same type of income — also classify as `earn_yield`
- Earn income calculation aggregates from: earn CSV (staking principal tracking) + spot transactions CSV (interest/yield rows)

---

### M7. Futures Funding Rate Direction and Sign Handling

**Severity:** MEDIUM
**Phase:** Phase 4 (FIFO Engine / Futures P&L Engine)

**What goes wrong:**
Funding rates (`contract_main_settle_fee`) can be positive OR negative in the USDT amount column. A positive amount means the trader RECEIVED funding (profitable for the position direction). A negative amount means the trader PAID funding (a cost).

In the 2024 data: amounts like `-0.0187735743` (paid) and `+0.001688094096` (received) both appear. The net P&L for a futures position must sum all these signed values correctly.

**Prevention:**
- Do not take absolute value of the Amount column for settlement fees
- Net P&L = sum(close_long.Amount) + sum(close_short.Amount) + sum(contract_main_settle_fee.Amount) + sum(open_long.Amount) + sum(open_short.Amount)
- Sign indicates direction: positive = income, negative = expense
- Test: a position with mixed positive and negative funding fees must produce the correct signed net

---

### M8. GitHub Actions Monorepo npm Workspace Caching

**Severity:** MEDIUM
**Phase:** CI/CD setup (cross-cutting)

**What goes wrong:**
In a monorepo with npm workspaces, `npm ci` at the root installs all workspace dependencies into the root `node_modules/`. GitHub Actions cache keys that only cache the root `node_modules/` miss workspace-specific `node_modules/` directories (e.g., `packages/backend/node_modules/` for native addons like `better-sqlite3`).

`better-sqlite3` is a native addon that compiles C++ during `npm install`. If the cache key does not include the Node.js version and OS, the compiled binary from one environment will fail to load in another.

**Prevention:**
- Cache key must include: OS, Node.js version, and hash of the root `package-lock.json`
- `better-sqlite3` must be rebuilt for the correct platform: use `npm rebuild better-sqlite3` after restoring from cache if the platform might differ
- Simplest CI approach: use `setup-node` with `cache: 'npm'` — it automatically caches based on `package-lock.json` hash
- Consider using `better-sqlite3`'s prebuilt binaries option to avoid compile-time dependencies in CI

---

### M9. PDF German Encoding (Umlauts, Euro Sign)

**Severity:** MEDIUM
**Phase:** Phase 6 (PDF Export)

**What goes wrong:**
PDFKit's default built-in fonts (Helvetica, Times-Roman) do not support the full Latin-Extended character set required for German: ä, ö, ü, Ä, Ö, Ü, ß. Using the built-in fonts for German text produces replacement characters (`?` or ``) where Umlauts should appear.

The Euro sign (€) also requires a font that includes it.

**Prevention:**
- Embed an open-source TTF font that supports Latin Extended: `Helvetica Neue` replacement is `Inter` or `Roboto`
- `doc.font('./assets/Roboto-Regular.ttf')` — include the TTF in the project's assets directory
- Test the PDF generation with a string containing all required German characters: `"Ä Ö Ü ä ö ü ß € 1.234,56 €"`

---

### M10. Staking Coins Extending the 10-Year Haltefrist

**Severity:** MEDIUM
**Phase:** Phase 4 (FIFO Engine)

**What goes wrong:**
Under German tax law as interpreted for § 23 EStG, there is a minority interpretation (referenced in academic tax literature) that crypto assets used for staking may be subject to a 10-year Haltefrist instead of 1 year, because the activity constitutes "Einkunftserzielungsabsicht" (income generation intent). If implemented as 10-year, assets staked once would never benefit from the standard 1-year Haltefrist.

**German law context (MEDIUM confidence — training data, NOT verified via official BMF source):**
The mainstream interpretation (and the one used by most German tax software) is that the 1-year Haltefrist still applies to spot crypto disposals regardless of staking. The 10-year extension applies to other assets (like rented real estate), not crypto. The 2022 BMF letter on crypto taxation (Schreiben vom 10.05.2022) did not extend the Haltefrist for crypto that was staked.

**Consequences:**
- If implemented as 10 years: tax-free disposals become taxable — user over-reports
- If implemented as 1 year (mainstream): consistent with leading German crypto tax tools (Koinly, Blockpit, CoinTracking)

**Prevention:**
- Implement 1-year Haltefrist for ALL crypto disposals regardless of staking history
- Add a prominent disclaimer in the tax report: "Based on mainstream interpretation; consult a Steuerberater for staking-heavy portfolios"
- Document this choice explicitly in the tax report generation code

---

## Minor Pitfalls

### L1. Drizzle ORM Migration Conflicts

**Severity:** LOW
**Phase:** Phase 1 (Foundation)

**What goes wrong:**
Drizzle Kit generates migration files based on schema snapshots. If a developer modifies the schema file (`schema.ts`) without generating a migration first, then runs the app, the database may be out of sync with the ORM schema. `drizzle-kit push` (development mode) can silently lose data.

**Prevention:**
- Always use `drizzle-kit generate` to produce migration files, then `drizzle-kit migrate` to apply them
- Never use `drizzle-kit push` on a database with real data (it can drop and recreate tables)
- Add a startup check: compare schema hash to applied migrations; abort if schema has unapplied changes

---

### L2. SQLite STRICT Mode Not Enabled

**Severity:** LOW
**Phase:** Phase 1 (Foundation)

**What goes wrong:**
By default, SQLite allows inserting a string into an INTEGER column — it accepts any type. A bug in the parser that inserts `"2024-12-31"` into a `tax_year INTEGER` column is silently stored as text, causing aggregate queries to fail or produce wrong results.

**Prevention:**
- Declare tables with `STRICT` mode (SQLite 3.37.0+): `CREATE TABLE fifo_lots (...) STRICT`
- This enforces column types, catching type errors at insert time rather than at query time
- `better-sqlite3` 12.x bundles SQLite 3.51.3 — STRICT mode is available

---

### L3. `better-sqlite3` Not Available in Vitest Worker Threads

**Severity:** LOW
**Phase:** Testing setup

**What goes wrong:**
Vitest runs tests in worker threads by default. `better-sqlite3` is a native addon that creates database connections. In some configurations, the native addon cannot be loaded in a worker thread context, causing tests to fail with "Cannot find module better-sqlite3" or native module errors.

**Prevention:**
- Configure the backend Vitest project to use `pool: 'forks'` instead of `'threads'`:
  ```typescript
  // vitest.config.ts for backend
  test: { pool: 'forks' }
  ```
- Or configure `singleThread: true` for the backend test project
- Verify this works in CI — the worker thread issue may only manifest in certain Node.js versions

---

### L4. Recharts ResponsiveContainer Requires Non-Zero Parent Height

**Severity:** LOW
**Phase:** Phase 5 (Dashboard)

**What goes wrong:**
`<ResponsiveContainer width="100%" height="100%">` renders with height 0 if the parent container does not have an explicit height. The chart is invisible. This is a known Recharts gotcha that appears when the parent uses `display: flex` with `flex: 1` but no explicit height set.

**Prevention:**
- Always use a fixed pixel height or percentage with a parent that has an explicit height:
  ```tsx
  <ResponsiveContainer width="100%" height={300}>
  ```
- Test charts in the actual glassmorphism card containers before declaring them complete

---

### L5. EUR Display Format vs. Calculation Format Confusion

**Severity:** LOW
**Phase:** Phase 5 (Dashboard)

**What goes wrong:**
German number format uses period as thousands separator and comma as decimal separator: `1.234,56 €`. If the display formatter is applied to a value that is then used in a calculation (e.g., formatting a string like `"1.234,56"` and then passing it to `new Decimal("1.234,56")`), `decimal.js` will parse `1.234` (truncating the decimal part).

**Prevention:**
- Keep a strict separation: calculation values are always English decimal strings (`"1234.56"`)
- Formatting for display is a one-way transformation that only happens in the UI layer
- No formatted strings ever flow back into the calculation engine

---

## Phase-Specific Warnings

| Phase | Topic | Likely Pitfall | Mitigation |
|-------|-------|---------------|------------|
| Phase 1: Foundation | SQLite schema | Monetary values as REAL float | Mandate TEXT type for all monetary columns from day 1 |
| Phase 1: Foundation | TypeScript strict mode | `price_eur` could be null and accidentally used in arithmetic | Strict null checks + runtime assertion before FIFO engine |
| Phase 2: CSV Import | BOM + tab prefix | Silent column name corruption, ID prefix not stripped | Strip both in every parser before any logic runs |
| Phase 2: CSV Import | Delimiter change 2024→2025 | 889 rows silently missing | Auto-detect delimiter, test both variants |
| Phase 2: CSV Import | Unknown types | Taxable events silently dropped | Unknown types flagged and stored, never silently dropped |
| Phase 2: CSV Import | `Financial` type sign meaning | Staking deposit vs. withdrawal misclassified | Amount sign determines direction, tested with round-trip scenario |
| Phase 3: Price Enrichment | Timestamp timezone | Prices fetched from wrong 1-hour window | Parse as Europe/Berlin, convert to UTC before API call |
| Phase 3: Price Enrichment | Missing prices | NULL cost basis causes engine crash or inflated gains | Block engine run until all prices resolved; UI shows resolution status |
| Phase 4: FIFO Engine | Per-coin lot isolation | BTC disposal consuming USDE lots | Asset filter on every FIFO query, tested with multi-coin scenario |
| Phase 4: FIFO Engine | Futures in FIFO | Settlement fees polluting lot pool | Canonical type allowlist for FIFO; futures never touch fifo_lots |
| Phase 4: FIFO Engine | Partial lot arithmetic | Remaining goes negative | Always use `lot.remaining`, not `lot.original_amount` |
| Phase 4: FIFO Engine | Freigrenze cliff | Freibetrag deduction implemented instead of cliff | Boundary tests at 999.99, 1000.00, 1000.01 EUR |
| Phase 4: FIFO Engine | Haltefrist day count | Timezone shifts the day boundary | UTC-only date arithmetic, tested with DST boundary dates |
| Phase 4: FIFO Engine | Crypto-to-crypto swap | Exchange spending rows skipped as non-taxable | swap_out triggers FIFO disposal; pair with swap_in for cost basis |
| Phase 5: Dashboard | Recharts heights | Charts invisible due to zero-height parent | Use fixed pixel heights in ResponsiveContainer |
| Phase 6: PDF | German Umlauts | Characters render as ? in default fonts | Embed TTF with Latin Extended support |
| Phase 6: PDF | Table pagination | PDFKit table API is new, may have page-break bugs | Test with 50+, 100+, 200+ row tables before shipping |
| CI/CD | Monorepo caching | better-sqlite3 native binary cached for wrong platform | Include Node.js version + OS in cache key |

---

## Sources

| Claim | Source | Confidence |
|-------|--------|------------|
| Tab prefix before order IDs in all CSV types | Direct hex inspection of Bitget CSV files in `raw-bitget-exports/` | HIGH |
| BOM prefix `\xEF\xBB\xBF` on all CSV files | Direct file inspection | HIGH |
| 2024 spot uses semicolons; 2025 spot uses commas | Direct header comparison of both files | HIGH |
| Unknown types: Position profit, Exchange spending, Exchange income, Automatic deposit, Financial | Direct `awk` extraction of Type column from all files | HIGH |
| Financial rows: negative in 2024 = staking deposit; positive in 2025 = staking withdrawal | Tracing same SOL amount (0.2393504) and USDE amount (39.61035) across 2024/2025 files | HIGH |
| 495 USDE Interest rows in spot transactions (not earn CSV) | Row count extraction | HIGH |
| 1,814 contract_main_settle_fee rows in 2025 futures | Row count extraction | HIGH |
| Python script timezone: Europe/Berlin to UTC | Direct reading of `get_eur_prices_bitget.py` | HIGH |
| Decimal.js for monetary arithmetic | ARCHITECTURE.md, anti-pattern documentation | HIGH |
| German tax law: Freigrenze 1,000 EUR cliff (not deduction) | FEATURES.md (verified via Blockpit tax guide) | HIGH |
| German tax law: Futures under § 20 EStG, spot under § 23 EStG | FEATURES.md | HIGH |
| German tax law: Haltefrist = 365 days for crypto spot | Training data + FEATURES.md cross-reference | MEDIUM |
| German tax law: staking income under § 22 Nr. 3 EStG | Training data — no official BMF source fetched | MEDIUM |
| German tax law: 1-year vs 10-year Haltefrist for staked assets | Training data — academic debate, mainstream tools use 1-year | LOW (verify with Steuerberater) |
| PDFKit table API added in 0.17.0, may have early-version bugs | STACK.md (GitHub releases verified) | MEDIUM |
| better-sqlite3 worker thread issue in Vitest | Training data — known community issue pattern | LOW (test in CI to verify) |
```
