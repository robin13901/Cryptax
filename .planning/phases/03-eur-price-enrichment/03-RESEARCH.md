# Phase 3: EUR Price Enrichment - Research

**Researched:** 2026-03-22
**Domain:** External price APIs (Bitget, CoinGecko), timezone handling, rate limiting, SQLite schema migration
**Confidence:** HIGH (most findings verified by direct API calls and authoritative sources)

---

## Summary

Phase 3 resolves EUR prices for all imported transactions using Bitget's public candle API as the primary source, with CoinGecko as fallback for delisted/obscure coins. Prices are stored directly on the `transactions` table (four new columns added via Drizzle migration). A `price_cache` table already exists in the schema to de-duplicate API calls — it was created in Phase 1's initial migration and is ready to use.

The primary complexity is the **symbol parsing layer**: `tradedAt` in the transactions table stores Europe/Berlin local time strings (e.g., `"2024-11-15 10:23:44"`) verbatim from the Bitget CSVs, not UTC. The enrichment phase must convert these to UTC millisecond timestamps before querying Bitget. Additionally, the `symbol` column takes different formats depending on source type (`"BTC/EUR"` for spot_order, `"BTC"` for spot_tx, `"BTCUSDT"` for futures), requiring per-source-type extraction of the base asset.

The Bitget candle endpoint is public (no auth), returns positional arrays `[timestamp_ms, open, high, low, close, baseVol, quoteVol, usdtVol]`, and supports max 200 candles per request. The non-existent pair error returns code `40034`. CoinGecko's free API is limited to 30 calls/minute and only covers the past 365 days of history — transactions older than one year cannot be resolved via CoinGecko's free tier.

**Primary recommendation:** Use `date-fns-tz` v3 (with `date-fns` v3 as peer dep) for Berlin→UTC conversion, `p-throttle` v8 for rate limiting, Node.js built-in `fetch` for HTTP calls (Node 23 confirmed), and Drizzle ALTER TABLE migration for adding four new columns to `transactions`.

---

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `date-fns-tz` | 3.2.0 | Europe/Berlin → UTC conversion, DST-aware | Wraps IANA tz database via Intl API; `fromZonedTime` handles DST ambiguity correctly; supports date-fns v3 and v4 |
| `date-fns` | 4.1.0 | Peer dependency for date-fns-tz | Required peer dep; already de-facto standard for date manipulation in TS ecosystem |
| `p-throttle` | 8.1.0 | Per-client rate limiting (10 req/s Bitget, 0.5 req/s CoinGecko) | Pure ESM; queue-based guarantees all calls run; supports `strict` mode; requires Node 20+ (project is Node 23) |
| Node built-in `fetch` | (Node 23) | HTTP client for both APIs | Already available — no extra install; avoids dependency for simple GET requests |
| `decimal.js` (already in project) | — | All EUR price arithmetic | Project-wide monetary standard; never use floating-point for prices |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `drizzle-kit` | 0.31.10 (already installed) | Generate + apply column-addition migration | Adding 4 new nullable columns to `transactions` table |
| `hono/streaming` | (Hono 4.12.8, already installed) | SSE for live progress updates | `streamSSE` from `hono/streaming` provides the progress-bar endpoint |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `date-fns-tz` | `@date-fns/tz` (v1.4.1, for date-fns v4+) or `luxon` | `@date-fns/tz` is the "next generation" approach bundled with date-fns v4, but date-fns-tz v3 is stable, simpler API (`fromZonedTime`), and supports both v3/v4 peer deps |
| `p-throttle` | `bottleneck`, `rate-limiter-flexible` | p-throttle is minimal (queue-only), sufficient for two distinct rate limits; bottleneck is heavier but would be justified for more complex queuing |
| Node built-in `fetch` | `got`, `axios`, `ofetch` | Project has no HTTP client today; for plain GET requests Node 23's built-in fetch is sufficient; no retry-with-backoff built in, but the enrichment engine handles retries explicitly |

### Installation

```bash
npm install date-fns date-fns-tz p-throttle --workspace=packages/backend
```

---

## Architecture Patterns

### Recommended Project Structure

```
packages/backend/src/
├── prices/
│   ├── bitget-client.ts          # Bitget candle API client + rate limit wrapper
│   ├── coingecko-client.ts       # CoinGecko history API client + rate limit wrapper
│   ├── price-cache.ts            # price_cache table read/write helpers
│   ├── resolution-strategy.ts   # Orchestrates direct EUR → USDT-fallback → CoinGecko
│   ├── enrichment-engine.ts     # Bulk runner: SELECT unresolved → resolve → UPDATE
│   ├── symbol-parser.ts          # Extract base asset + Bitget symbol from tx.symbol
│   └── timezone.ts               # berlинToUtcMs(tradedAt: string): number
├── routes/
│   └── prices.ts                 # registerPriceRoutes: POST /enrich, GET /status, SSE
```

### Pattern 1: Bitget Candle Lookup

**What:** Fetch the 1-minute candle closest to a UTC millisecond timestamp for a given symbol. Return the close price (index 4 of the positional array).

**When to use:** Primary path for any transaction — try `{BASE}EUR` first, then `{BASE}USDT`.

**Verified response format (from live API call):**

```typescript
// Source: live curl against https://api.bitget.com/api/v2/spot/market/history-candles
// Response: {"code":"00000","msg":"success","data":[[ts_ms, open, high, low, close, baseVol, quoteVol, usdtVol], ...]}
// Array indices:  0         1      2       3      4       5         6          7

interface BitgetCandleRow extends Array<string> {
  0: string; // timestamp_ms (e.g., "1711900620000")
  1: string; // open
  2: string; // high
  3: string; // low
  4: string; // close  ← use this for EUR price
  5: string; // baseVol
  6: string; // quoteVol
  7: string; // usdtVol
}

async function fetchBitgetClose(
  symbol: string,         // e.g., "BTCEUR" or "BTCUSDT"
  targetMs: number,       // UTC milliseconds
  granularity: '1min' | '5min' = '1min',
): Promise<string | null> {
  const endTime = String(targetMs + 60_000); // include the target minute
  const url = new URL('https://api.bitget.com/api/v2/spot/market/history-candles');
  url.searchParams.set('symbol', symbol);
  url.searchParams.set('granularity', granularity);
  url.searchParams.set('endTime', endTime);
  url.searchParams.set('limit', '5'); // small window to minimize bandwidth

  const res = await fetch(url.toString());
  const json = await res.json() as { code: string; data: BitgetCandleRow[] | null };

  if (json.code === '40034') return null; // pair does not exist
  if (json.code !== '00000' || !json.data?.length) return null;

  // Find closest candle by timestamp
  const closest = json.data.reduce((best, row) =>
    Math.abs(Number(row[0]) - targetMs) < Math.abs(Number(best[0]) - targetMs) ? row : best
  );
  return closest[4]; // close price as string
}
```

**Key known error codes (verified live):**

| Code | Meaning | Action |
|------|---------|--------|
| `00000` | Success | Use `data` array |
| `40034` | Symbol does not exist | Try USDT fallback or CoinGecko |
| `400171` | Invalid granularity value | Fix code |
| `400172` | Missing required parameter | Fix code |
| `40020` | `limit` > 200 | Use max 200 |
| `429` (HTTP) | Rate limit exceeded | Back off with `Retry-After` header |

**Granularity options (verified):** `1min`, `3min`, `5min`, `15min`, `30min`, `1h`, `4h`, `6h`, `12h`, `1day`, `1week`, `1M` (and UTC variants). Phase 3 uses `1min` primary, `5min` fallback.

**Authentication:** None required. All market data endpoints are public.

**Historical depth:** Verified data available back to at least January 2021 (tested: `endTime=1609459200000` returned data).

**Max limit:** 200 candles per request (201 returns error code `40020`).

### Pattern 2: USDT Fallback (Two-Step Conversion)

**What:** When `{BASE}EUR` pair doesn't exist (error code `40034`), fetch `{BASE}USDT` close and `USDTEUR` close at the same target timestamp, then multiply.

**When to use:** Any coin without a direct EUR pair on Bitget (e.g., many altcoins).

**Verified:** `USDTEUR` pair exists and returns valid data. Both calls use identical `targetMs` — never use daily average for USDT/EUR rate.

```typescript
// Both legs use same targetMs
const baseInUsdt = await fetchBitgetClose(`${base}USDT`, targetMs, '1min');
const usdtInEur  = await fetchBitgetClose('USDTEUR', targetMs, '1min');
// Multiply using Decimal.js (never native multiplication for monetary values)
const eurPrice = new Decimal(baseInUsdt).mul(new Decimal(usdtInEur)).toString();
```

### Pattern 3: Europe/Berlin → UTC Conversion

**What:** The `tradedAt` column stores Europe/Berlin local time strings verbatim from Bitget CSVs (e.g., `"2024-11-15 10:23:44"`). These MUST be converted to UTC milliseconds before querying the Bitget API.

**Library:** `date-fns-tz` v3 provides `fromZonedTime(date, timeZone)` which replaces the old `zonedTimeToUtc` from v2.

**DST handling:** The 2024 spring-forward moment for Europe/Berlin is 2024-03-31T02:00:00+01:00 → 03:00:00+02:00. A `tradedAt` value of `"2024-03-31 02:30:00"` represents a non-existent local time. `fromZonedTime` resolves ambiguous/non-existent times by using the pre-transition offset (CET = UTC+1), producing `2024-03-31T01:30:00Z`. This is the correct behavior for the Bitget candle query (the API would not have data for a non-existent local time, but the closest candle will be returned).

```typescript
// Source: date-fns-tz v3 docs — fromZonedTime replaces zonedTimeToUtc from v2
import { fromZonedTime } from 'date-fns-tz';

function berlinsToUtcMs(tradedAt: string): number {
  // tradedAt format: "YYYY-MM-DD HH:mm:ss" (Europe/Berlin local time)
  // fromZonedTime treats the input as being in the given timezone
  const utcDate = fromZonedTime(
    tradedAt.replace(' ', 'T'), // normalize to ISO-like format
    'Europe/Berlin'
  );
  return utcDate.getTime(); // UTC milliseconds
}

// DST test: "2024-03-31 02:30:00" Berlin (spring-forward, non-existent time)
// fromZonedTime('2024-03-31T02:30:00', 'Europe/Berlin') → 2024-03-31T01:30:00.000Z
// UTC ms: 1711848600000 ✓ (uses CET offset = UTC+1)
```

**v2 → v3 breaking change:** `zonedTimeToUtc` → `fromZonedTime`. Do not use v2 API.

### Pattern 4: Rate Limiting with p-throttle

**What:** Wrap the Bitget fetch function at 10 req/s (600/min) and CoinGecko at 0.5 req/s (30/min).

```typescript
// Source: p-throttle v8 readme
import pThrottle from 'p-throttle';

// Bitget: 600 req/min = 10 req/s
const bitgetThrottle = pThrottle({ limit: 10, interval: 1000 });
const throttledBitgetFetch = bitgetThrottle(fetchBitgetClose);

// CoinGecko: 30 req/min = 0.5 req/s (1 call every 2 seconds)
const coingeckoThrottle = pThrottle({ limit: 1, interval: 2000 });
const throttledCoinGeckoFetch = coingeckoThrottle(fetchCoinGeckoPrice);
```

**Note:** p-throttle queues all calls — nothing is dropped. The queue could grow large for bulk enrichment. For 500 transactions needing CoinGecko fallback: ~1000 seconds estimated wait. This is expected behavior; progress bar should show remaining items.

### Pattern 5: CoinGecko Fallback

**What:** Use `/api/v3/coins/{id}/history?date=DD-MM-YYYY` for a daily EUR price when Bitget has no data at all.

**Limitations (verified):**
- Free tier only covers the past 365 days (hard limit: transactions before ~March 2025 will return a 10012 error).
- Rate limit: 30 calls/minute (verified from pricing page).
- Symbol-to-ID mapping: requires pre-loading `/api/v3/coins/list` (~1 MB response with all 10,000+ coins). Cache this in memory at startup.

**Response path for EUR price:**

```typescript
// Source: live CoinGecko API call (response verified)
// GET /api/v3/coins/bitcoin/history?date=01-06-2025&localization=false
// Response: { market_data: { current_price: { eur: 92254.82, usd: 104687.51, ... } } }

interface CoinGeckoHistoryResponse {
  market_data?: {
    current_price?: Record<string, number>;
  };
}

function extractEurPrice(response: CoinGeckoHistoryResponse): string | null {
  const eur = response.market_data?.current_price?.eur;
  return eur != null ? new Decimal(eur).toString() : null;
}
```

**Symbol mapping strategy:** Load `/api/v3/coins/list` once at enrichment start, build a `Map<string, string>` from `symbol` → `id`. Handle ambiguity (multiple coins with same symbol) by preferring the first entry or by rank. Example: `{ "btc": "bitcoin", "eth": "ethereum" }`. This file is ~1 MB and must be cached in memory, not refetched per-transaction.

**Historical depth caveat:** Free tier is limited to 365 days. Any crypto tax calculation covering 2022 or earlier cannot use CoinGecko's free public API. These transactions will fail with a `'coingecko-miss'` reason and require manual price entry.

### Pattern 6: CSV Fill-Price Shortcut

**What:** For `spot_order` transactions where the quote asset is `EUR`, the `price` column (Average Price) already contains the EUR fill price. No API call needed.

**Detection logic:**

```typescript
// symbol format for spot_order: "BTC/EUR", "ETH/USDT"
function extractSymbolParts(tx: Transaction): { base: string; quote: string } | null {
  if (tx.symbol.includes('/')) {
    const [base, quote] = tx.symbol.split('/');
    return { base, quote };
  }
  return null; // spot_tx, futures — no slash
}

function usesCsvFillPrice(tx: Transaction): boolean {
  const parts = extractSymbolParts(tx);
  return (
    tx.sourceType === 'spot_order' &&
    parts?.quote === 'EUR' &&
    tx.price !== '0' &&    // '0' means no price in CSV
    tx.price !== ''
  );
}
```

When `usesCsvFillPrice` returns true: set `eurPrice = tx.price`, `priceSource = 'csv-fill'`, skip API calls.

### Pattern 7: Drizzle Schema Migration

**What:** Add four nullable columns to the `transactions` table via `ALTER TABLE ADD COLUMN`.

**Workflow:**
1. Add columns to `packages/backend/src/db/schema.ts`
2. Run `npm run db:generate` (root) — generates `0002_eur_price_columns.sql`
3. Run `npm run db:migrate` — applies migration

**Schema addition:**

```typescript
// Add to transactions table in schema.ts
eurPrice: text('eur_price'),                    // null = unresolved
priceSource: text('price_source'),              // 'bitget-direct' | 'bitget-usdt' | 'csv-fill' | 'coingecko' | 'manual'
priceResolvedAt: text('price_resolved_at'),     // ISO string
priceFailureReason: text('price_failure_reason'), // 'no-bitget-pair' | 'coingecko-miss' | 'api-error'
```

**Generated SQL shape (based on existing migration pattern from 0001):**

```sql
ALTER TABLE `transactions` ADD `eur_price` text;--> statement-breakpoint
ALTER TABLE `transactions` ADD `price_source` text;--> statement-breakpoint
ALTER TABLE `transactions` ADD `price_resolved_at` text;--> statement-breakpoint
ALTER TABLE `transactions` ADD `price_failure_reason` text;
```

SQLite `ALTER TABLE ADD COLUMN` cannot add NOT NULL columns without a default — all four columns must be nullable, which is correct since existing rows will have `NULL`.

### Pattern 8: SSE Progress Endpoint

**What:** Use `hono/streaming`'s `streamSSE` to push live enrichment progress to the frontend.

```typescript
// Source: Hono 4 docs — https://hono.dev/docs/helpers/streaming
import { streamSSE } from 'hono/streaming';

app.get('/api/prices/enrich/progress', (c) => {
  return streamSSE(c, async (stream) => {
    // enrichmentEngine emits events via an EventEmitter or callback
    for await (const event of enrichmentProgressIterator()) {
      await stream.writeSSE({
        data: JSON.stringify(event),
        event: 'progress',
        id: String(event.processed),
      });
    }
  });
});
```

### Anti-Patterns to Avoid

- **Floating-point arithmetic for prices:** Always use `Decimal.js`. `0.1 + 0.2 !== 0.3` — monetary multiplication errors compound across thousands of transactions.
- **Granularity string `"1m"` or `"5m"`:** Bitget requires `"1min"` and `"5min"` (with `min` suffix). Incorrect granularity returns error `400171`.
- **Querying Bitget with local time:** `tradedAt` is Berlin local time. Pass UTC milliseconds to the API, not the raw string.
- **Re-fetching the symbol list on every CoinGecko call:** Load `/api/v3/coins/list` once per enrichment run and hold in memory.
- **Assuming all symbols have a slash:** `spot_tx` symbols are bare coin names (`"BTC"`, `"USDT"`). Only `spot_order` and `futures_order` use slash notation.
- **Overwriting resolved prices in incremental mode:** Check `WHERE eur_price IS NULL OR price_source = 'manual'` when selecting transactions to enrich (manual entries are overwritten by API per the CONTEXT decision).

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Berlin→UTC with DST | String offset arithmetic (`+01:00`, `+02:00`) | `date-fns-tz` `fromZonedTime` | Spring-forward creates non-existent times; fall-back creates ambiguous times; IANA tz database handles both; hand-rolled offset is always wrong for at least one DST boundary |
| Rate limiting | `setTimeout` delays between calls | `p-throttle` | setTimeout drift causes bunching; p-throttle uses a strict token-bucket queue with drift correction (v8.1.0 fix) |
| Price arithmetic | `parseFloat` and `*` | `Decimal.js` (already in project) | IEEE 754 errors in tax calculations are a legal problem |
| Candle time matching | Fetch many candles and search | Narrow `startTime`/`endTime` window | Bitget returns up to 200 candles ascending; a 5-minute window with `limit=5` returns ≤5 rows for cheap lookup |

**Key insight:** The Berlin timezone conversion is the single most dangerous hand-roll risk. The spring-forward gap (02:00→03:00) means `"2024-03-31 02:30:00"` is a non-existent clock time. Without `fromZonedTime`, a naive `new Date("2024-03-31 02:30:00")` produces either UTC or system-timezone output depending on runtime, not the correct UTC+1 interpretation.

---

## Common Pitfalls

### Pitfall 1: tradedAt is Berlin Local Time, Not UTC

**What goes wrong:** Passing `tradedAt` directly to Bitget's `endTime` parameter (which expects Unix milliseconds UTC). The lookup would target the wrong timestamp by ±1–2 hours, potentially fetching a price from a different trading session.

**Why it happens:** The Bitget CSV exports use the account's local time (Europe/Berlin). The normalize step stores the raw CSV string unchanged.

**How to avoid:** Always run `berlinsToUtcMs(tx.tradedAt)` before constructing any API call. Add a test asserting the DST edge case converts correctly.

**Warning signs:** Prices look slightly off from expected values; test with a transaction from 2024-03-31 near 02:00 Berlin time.

### Pitfall 2: Symbol Format Varies by Source Type

**What goes wrong:** Using `tx.symbol` directly as the Bitget API symbol parameter. `"BTC/EUR"` is not a valid Bitget symbol; `"BTCEUR"` is.

**Why it happens:** Different CSV formats produce different symbol shapes:
- `spot_order`: `"BTC/EUR"` → split on `/`, take base
- `spot_tx`: `"BTC"` → already just the coin
- `futures_order`: `"BTCUSDT"` → this is the Bitget futures contract name, not the spot symbol

**How to avoid:** Build a `symbolParser.ts` that normalizes by `sourceType`:
- `spot_order`: split on `/`, return `{ base, quote }`
- `spot_tx`: return `{ base: symbol, quote: null }`
- `futures_order`/`futures_tx`: strip `USDT`/`EUR` suffix to extract base (e.g., `"BTCUSDT"` → `"BTC"`)

**Warning signs:** Many `40034` (symbol not found) errors for transactions that should be resolvable.

### Pitfall 3: CoinGecko 365-Day Free Tier Limit

**What goes wrong:** Attempting to resolve prices for 2022–2023 transactions via CoinGecko. The API returns error code `10012` with the message about exceeding the allowed time range.

**Why it happens:** CoinGecko's free public API does not provide history older than 365 days from today.

**How to avoid:** Check for error code `10012` and record `priceFailureReason = 'coingecko-miss'` with a note that the data is out of free-tier range. Do not retry these — they will always fail without a paid API key. Log a specific failure reason so users understand they need to enter prices manually for older transactions.

**Warning signs:** All 2022/2023 transactions show `priceFailureReason = 'coingecko-miss'`.

### Pitfall 4: p-throttle Queue Starvation

**What goes wrong:** Creating a single throttle instance for both Bitget and CoinGecko. All requests queue together; CoinGecko's 0.5 req/s rate applies to the combined pool, making Bitget calls slow.

**Why it happens:** Using one `pThrottle` instance for both clients.

**How to avoid:** Create two separate throttle instances — one for Bitget (10 req/s), one for CoinGecko (0.5 req/s). The two instances are independent.

### Pitfall 5: Bitget USDT Fallback Uses Different Timestamps for Each Leg

**What goes wrong:** Fetching `{BASE}USDT` price at the trade timestamp but fetching `USDTEUR` at the current time or a daily average.

**Why it happens:** Treating USDT/EUR as a "near-constant" and optimizing by not fetching it per-transaction.

**How to avoid:** Use the same `targetMs` for both the `{BASE}USDT` and `USDTEUR` API calls. USDT/EUR fluctuates and was as low as 0.88 and as high as 0.96 in 2024. Both calls must be at the same timestamp.

### Pitfall 6: price_cache Unique Key Collision

**What goes wrong:** Inserting a price_cache row fails with a unique constraint error when the same (symbol, timestamp, source) was already cached.

**Why it happens:** Bulk enrichment calls the same symbol+timestamp multiple times across different transactions (e.g., many BTC/EUR trades in the same minute).

**How to avoid:** Use `INSERT OR IGNORE` (Drizzle: `.onConflictDoNothing()`) when writing to `price_cache`. Always check cache before fetching.

---

## Code Examples

### Berlin to UTC Conversion

```typescript
// Source: date-fns-tz v3 README — fromZonedTime API
import { fromZonedTime } from 'date-fns-tz';

/**
 * Converts a Europe/Berlin local timestamp string to UTC milliseconds.
 * Handles DST transitions (spring-forward and fall-back) correctly.
 *
 * @param tradedAt "YYYY-MM-DD HH:mm:ss" in Europe/Berlin local time
 * @returns UTC milliseconds suitable for Bitget's endTime parameter
 */
export function berlinToUtcMs(tradedAt: string): number {
  const utcDate = fromZonedTime(
    new Date(tradedAt.replace(' ', 'T')),
    'Europe/Berlin'
  );
  return utcDate.getTime();
}
```

### Bitget API Client (Core Fetch)

```typescript
// Source: verified against live https://api.bitget.com/api/v2/spot/market/history-candles
// No authentication required

const BITGET_BASE = 'https://api.bitget.com';

export async function fetchBitgetCandleClose(
  symbol: string,
  targetMs: number,
  granularity: '1min' | '5min' = '1min',
): Promise<string | null> {
  const url = new URL(`${BITGET_BASE}/api/v2/spot/market/history-candles`);
  url.searchParams.set('symbol', symbol);
  url.searchParams.set('granularity', granularity);
  url.searchParams.set('endTime', String(targetMs + 60_000));
  url.searchParams.set('limit', '5');

  const res = await fetch(url.toString());
  if (!res.ok) return null;

  const json = await res.json() as {
    code: string;
    data: Array<[string, string, string, string, string, ...string[]]> | null;
  };

  if (json.code === '40034') return null; // symbol does not exist
  if (json.code !== '00000' || !json.data?.length) return null;

  // Find candle closest to targetMs
  const closest = json.data.reduce((best, row) =>
    Math.abs(Number(row[0]) - targetMs) < Math.abs(Number(best[0]) - targetMs) ? row : best
  );
  return closest[4]; // close price
}
```

### Rate-Limited Wrapper

```typescript
// Source: p-throttle v8 readme
import pThrottle from 'p-throttle';
import { fetchBitgetCandleClose } from './bitget-client.js';

const bitgetThrottle = pThrottle({ limit: 10, interval: 1000 });
export const throttledBitgetClose = bitgetThrottle(fetchBitgetCandleClose);

const coingeckoThrottle = pThrottle({ limit: 1, interval: 2000 });
export const throttledCoinGeckoFetch = coingeckoThrottle(fetchCoinGeckoPrice);
```

### CoinGecko History Lookup

```typescript
// Source: verified against live https://api.coingecko.com/api/v3/coins/bitcoin/history
// Response: market_data.current_price.eur contains the daily EUR price

const COINGECKO_BASE = 'https://api.coingecko.com/api/v3';

export async function fetchCoinGeckoPrice(
  coinId: string,       // CoinGecko ID, e.g., "bitcoin" (not "BTC")
  utcMs: number,        // UTC milliseconds — only date portion is used (daily granularity)
): Promise<string | null> {
  // CoinGecko history requires DD-MM-YYYY format
  const date = new Date(utcMs);
  const day = String(date.getUTCDate()).padStart(2, '0');
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const year = date.getUTCFullYear();
  const dateStr = `${day}-${month}-${year}`;

  const url = `${COINGECKO_BASE}/coins/${coinId}/history?date=${dateStr}&localization=false`;
  const res = await fetch(url);

  if (res.status === 429) return null; // rate limited — p-throttle should prevent this
  if (!res.ok) return null;

  const json = await res.json() as {
    error?: { status: { error_code: number } };
    market_data?: { current_price?: Record<string, number> };
  };

  if (json.error?.status?.error_code === 10012) {
    // Exceeded 365-day free tier limit
    throw new Error('COINGECKO_OUT_OF_RANGE');
  }

  const eur = json.market_data?.current_price?.eur;
  return eur != null ? new Decimal(eur).toString() : null;
}
```

### Drizzle price_cache Upsert Pattern

```typescript
// Source: Drizzle ORM docs — onConflictDoNothing for SQLite
import { db } from '../db/client.js';
import { priceCache } from '../db/schema.js';

export function upsertPriceCache(entry: {
  symbol: string;
  timestamp: string;    // "minute-precision UTC ISO" e.g. "2024-03-31T10:23:00.000Z"
  eurPrice: string;
  source: 'bitget-direct' | 'bitget-usdt' | 'coingecko';
  usdtPrice?: string;
  usdtEurRate?: string;
}) {
  db.insert(priceCache)
    .values({ ...entry, fetchedAt: new Date().toISOString() })
    .onConflictDoNothing()  // unique key: (symbol, timestamp, source)
    .run();
}
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `zonedTimeToUtc` (date-fns-tz v2) | `fromZonedTime` (date-fns-tz v3) | date-fns-tz v3.0.0 (2024) | Breaking rename; v2 code will import-error on v3 |
| `utcToZonedTime` | `toZonedTime` | date-fns-tz v3.0.0 | Same breaking rename |
| date-fns v2 default exports | Named exports only | date-fns v3 | `import format from 'date-fns/format'` → `import { format } from 'date-fns'` |
| p-throttle v4 (Node 12+) | p-throttle v8 (Node 20+) | v8.0.0 | Requires Node 20+; project uses Node 23 ✓; pure ESM only |

**Deprecated/outdated:**
- `zonedTimeToUtc`: Removed in date-fns-tz v3. Use `fromZonedTime`.
- `node-fetch`: Not needed in Node 18+. Use built-in `fetch`.
- CoinGecko `/api/v3/coins/{id}/market_chart/range` for exact-minute prices on free tier: does not support sub-daily granularity for historical dates; use `/history` endpoint for daily prices instead.

---

## Open Questions

1. **CoinGecko symbol ambiguity**
   - What we know: Multiple tokens share the same symbol (e.g., "COMP" appears multiple times in `coins/list`). The first match in the list may not be the correct one.
   - What's unclear: For a user importing from Bitget, which CoinGecko ID corresponds to a Bitget-listed `COMP`? This could require a manual override table or a secondary Bitget API call to get the full coin name.
   - Recommendation: Build a small `SYMBOL_OVERRIDES` map (modeled on the Python reference script's `BITGET_SYMBOL_OVERRIDES`). Start with a minimal set and document how to extend it.

2. **Futures symbol base extraction**
   - What we know: `futures_order` symbol is `"BTCUSDT"` (concatenated, no separator). Stripping `"USDT"` suffix works for USDT-settled contracts but may fail for COIN-margined contracts or non-standard pairs.
   - What's unclear: Are there COIN-margined futures in the Bitget CSV exports (e.g., `"BTCUSD"`)?
   - Recommendation: Extract base by stripping known quote suffixes (`USDT`, `USD`, `EUR`, `BTC`) and falling back to the last 3–4 characters heuristic. Add a test for each known futures format.

3. **Bitget rate limit for authenticated vs public endpoints**
   - What we know: The Python reference script comments "Bitget public endpoints allow higher rates" at 600 req/min (10 req/s). The v1 API documentation mentioned "20 times/1s per IP" for market endpoints.
   - What's unclear: Whether the v2 endpoint has the same 20 req/s limit or higher. The 10 req/s used in the reference script is conservative.
   - Recommendation: Start with 10 req/s. If rate limit errors (HTTP 429) appear, adjust. The script's conservative rate never triggered 429 in production.

---

## Sources

### Primary (HIGH confidence)
- **Live Bitget API calls** — `https://api.bitget.com/api/v2/spot/market/history-candles` — confirmed endpoint URL, parameters, response format, error codes, granularity values, max limit (200), authentication (none), historical depth (2021+), USDTEUR pair existence
- **Live CoinGecko API calls** — `https://api.coingecko.com/api/v3/coins/{id}/history` — confirmed EUR price path in response, 365-day limit (error 10012), 429 rate limiting behavior
- **CoinGecko pricing page** — `https://www.coingecko.com/en/api/pricing` — confirmed 30 calls/minute free tier limit
- **Project codebase** — schema.ts, migration SQLs, normalize.ts, parsers — confirmed tradedAt format (Berlin local time string), symbol format per source type, existing price_cache table structure, Decimal.js usage, Hono route pattern
- **Python reference script** — `/references/get_eur_prices_bitget.py` — confirmed 600 req/min rate, endpoint URL, strategy (EUR → USDT → fail), `closest[4]` close price index, 10 retries with exponential backoff

### Secondary (MEDIUM confidence)
- **date-fns-tz GitHub README** — `https://github.com/marnusw/date-fns-tz/blob/master/README.md` — `fromZonedTime` replaces `zonedTimeToUtc` in v3; API confirmed
- **p-throttle GitHub README** — `https://github.com/sindresorhus/p-throttle/blob/main/readme.md` — `pThrottle({ limit, interval })` API confirmed; v8.1.0 strict mode
- **npm registry** — version numbers: date-fns-tz@3.2.0, p-throttle@8.1.0, date-fns@4.1.0 — confirmed via `registry.npmjs.org` live queries
- **Hono streaming docs** — `https://hono.dev/docs/helpers/streaming` — `streamSSE` API confirmed

### Tertiary (LOW confidence)
- **Bitget v1 API docs** — mentions "20 times/1s" per IP for public market endpoints; v2 rate limit unconfirmed from official documentation. Using 10 req/s (conservative, matching reference script) as the planned rate.
- **CoinGecko market_chart/range granularity** — docs state "5-minute data for 1 day" on free tier; this may mean sub-daily granularity IS available for very recent dates only. Not tested; `/history` endpoint is sufficient for Phase 3's daily-precision fallback requirement.

---

## Metadata

**Confidence breakdown:**
- Bitget API endpoint + format: HIGH — verified via 12+ live API calls
- CoinGecko API: HIGH — verified response format; rate limit confirmed from pricing page
- date-fns-tz API: HIGH — README and npm version verified; v2→v3 breaking changes confirmed
- p-throttle API: HIGH — README verified; version confirmed via npm registry
- Drizzle migration workflow: HIGH — existing migration files provide clear pattern; drizzle-kit already installed
- Hono SSE: HIGH — official docs verified
- Timezone/DST handling: MEDIUM — `fromZonedTime` behavior for non-existent times (spring-forward gap) not directly verified with a unit test against the library; behavior deduced from IANA tz database semantics
- CoinGecko 365-day limit: HIGH — verified with live API call returning error 10012

**Research date:** 2026-03-22
**Valid until:** 2026-06-22 (APIs are stable; CoinGecko rate limits may change with tier restructuring)
