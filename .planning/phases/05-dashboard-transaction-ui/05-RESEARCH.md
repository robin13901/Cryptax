# Phase 5: Dashboard + Transaction UI - Research

**Researched:** 2026-03-23
**Domain:** React dashboard UI — Recharts v3, Hono REST APIs, Drizzle ORM, React Testing Library
**Confidence:** HIGH (all key findings verified from installed packages and source code)

---

## Summary

Phase 5 wires the frontend to live backend data. The codebase is already structurally ready: the backend has `tax_summaries`, `transactions`, `lot_consumptions`, `fifo_lots`, `earnIncome`, and `futuresPositions` tables fully populated after an engine run. The frontend has the tab shell (Dashboard / Transaktionen), GlassSurface wrapper, motion/react animations, and CSS design tokens. What is missing: two new backend route files (`summary.ts` and a filtered `transactions.ts` route), plus five to seven new frontend components.

The standard approach for charts is the installed Recharts 3.8.0, which introduces a native `responsive` prop (no longer requires the `<ResponsiveContainer>` wrapper), typed generics on data, and `Cell` deprecation in favour of the `shape` prop. The transaction list uses infinite scroll backed by `cursor`-style or `limit/offset` Drizzle queries. Testing uses the existing Vitest + jsdom + React Testing Library setup with a ResizeObserver mock added to `setup.ts` (currently absent but required for Recharts).

**Primary recommendation:** Add two Hono route files, seven React components, extend shared types, and add ResizeObserver mock to `setup.ts`. No new npm dependencies are needed — everything is already installed.

---

## Standard Stack

All libraries are already installed and locked. No additions required.

### Core (already installed)
| Library | Version | Purpose | Confidence |
|---------|---------|---------|------------|
| recharts | 3.8.0 | All 6 charts | HIGH — verified in `packages/frontend/package.json` |
| motion | 12.36.0 | Tab transitions, slide-in panel | HIGH — verified in `package.json` |
| react + react-dom | 19.2.4 | UI framework | HIGH |
| hono | 4.12.8 | Backend routes | HIGH |
| drizzle-orm | 0.45.1 | DB queries (filter, sort, paginate) | HIGH |
| better-sqlite3 | 12.8.0 | SQLite driver | HIGH |
| vitest | 3.2.4 | Test runner | HIGH |
| @testing-library/react | 16.3.2 | Component tests | HIGH |
| @testing-library/jest-dom | 6.9.1 | Custom matchers | HIGH |
| @testing-library/user-event | 14.6.1 | User interaction simulation | HIGH |
| jsdom | 27.0.1 | Browser environment for tests | HIGH |

### No new dependencies needed
The entire phase can be implemented with the existing stack. Verify before the execute phase: `recharts@3.8.0` is installed at root `node_modules/recharts`.

---

## Architecture Patterns

### Recommended Project Structure

```
packages/
  backend/src/
    routes/
      summary.ts           # NEW — GET /api/summary/:year
      transactions.ts      # NEW — GET /api/transactions (filtered, paginated)
    index.ts               # MODIFY — register two new routes
  shared/src/
    types/
      summary.ts           # NEW — SummaryResponse, ChartDataPoint types
      transaction.ts       # MODIFY — add TransactionDetailResponse, TransactionPage
    index.ts               # MODIFY — export new types
  frontend/src/
    components/
      Dashboard/
        Dashboard.tsx              # NEW — tab content, year selector, KPI + charts
        Dashboard.test.tsx         # NEW
        Dashboard.css
        KpiCards.tsx               # NEW — 4 cards with real data
        FreigrenzeBar.tsx          # NEW — dual progress bar
        charts/
          PnlLineChart.tsx         # NEW — DASH-02
          PortfolioDonutChart.tsx  # NEW — DASH-03
          GainLossBarChart.tsx     # NEW — DASH-04
          MonthlyBarChart.tsx      # NEW — DASH-05
          SpotFuturesChart.tsx     # NEW — DASH-06
          YearOverYearChart.tsx    # NEW — DASH-08
      Transactions/
        TransactionList.tsx        # NEW — sortable, infinite scroll
        TransactionList.test.tsx   # NEW
        TransactionList.css
        TransactionFilters.tsx     # NEW — type, coin, date range, search
        TransactionRow.tsx         # NEW — row with category badge
        TransactionDetail.tsx      # NEW — side panel with FIFO lot table
        TransactionDetail.test.tsx # NEW
        TransactionDetail.css
    App.tsx                        # MODIFY — replace placeholder dashboard, restructure transactions tab
```

### Pattern 1: Hono Route with Query Params

All filtering, sorting, and pagination is done server-side. The route function reads query params, constructs a Drizzle query with dynamic `.where()` conditions, and returns JSON.

```typescript
// Source: verified from drizzle-orm@0.45.1 types + existing routes/prices.ts pattern
import { and, asc, desc, between, eq, like, or } from 'drizzle-orm';

app.get('/api/transactions', (c) => {
  const year    = c.req.query('year');
  const coin    = c.req.query('coin');
  const type    = c.req.query('type');
  const from    = c.req.query('from');   // ISO date string
  const to      = c.req.query('to');
  const search  = c.req.query('search');
  const sortBy  = c.req.query('sortBy') ?? 'tradedAt';
  const sortDir = c.req.query('sortDir') ?? 'desc';
  const limit   = Math.min(Number(c.req.query('limit') ?? '50'), 200);
  const offset  = Number(c.req.query('offset') ?? '0');

  const conditions = [];
  if (year)   conditions.push(eq(transactions.taxYear, Number(year)));
  if (coin)   conditions.push(eq(transactions.symbol, coin));
  if (type)   conditions.push(eq(transactions.canonicalType, type));
  if (from && to) conditions.push(between(transactions.tradedAt, from, to));
  if (search) conditions.push(
    or(
      like(transactions.symbol, `%${search}%`),
      like(transactions.orderId, `%${search}%`),
    )
  );

  const orderCol = sortBy === 'amount' ? transactions.amount : transactions.tradedAt;
  const orderFn  = sortDir === 'asc' ? asc : desc;

  const rows = db
    .select({ /* projection */ })
    .from(transactions)
    .where(and(...conditions))
    .orderBy(orderFn(orderCol))
    .limit(limit)
    .offset(offset)
    .all();

  return c.json({ items: rows, total: count, hasMore: offset + limit < count });
});
```

**Important:** `like` in SQLite is case-insensitive for ASCII by default. No need for `ilike`. For search across both `symbol` and `orderId`, use `or(like(...), like(...))`.

### Pattern 2: Summary API Aggregation

The `/api/summary/:year` endpoint reads from `tax_summaries` (already populated by engine) and aggregates:

```typescript
// Source: verified from db/schema.ts — tax_summaries table exists, fields confirmed
import { eq } from 'drizzle-orm';

app.get('/api/summary/:year', (c) => {
  const year = Number(c.req.param('year'));

  // Tax summaries by bucket (private_sale, futures_pnl, staking_earn)
  const summaries = db.select().from(taxSummaries)
    .where(eq(taxSummaries.taxYear, year)).all();

  // Available years (for year selector)
  const years = db.selectDistinct({ year: taxSummaries.taxYear })
    .from(taxSummaries).all();

  // Monthly P&L for line chart — from lot_consumptions grouped by month
  const monthlySpot = db.select({
    month: sql`strftime('%Y-%m', ${lotConsumptions.taxYear})`.as('month'),
    gainLoss: sql`SUM(CAST(${lotConsumptions.gainLossEur} AS REAL))`.as('gain_loss'),
  }).from(lotConsumptions)
    .where(eq(lotConsumptions.taxYear, year))
    .groupBy(sql`strftime('%Y-%m', ...)`)
    .all();

  return c.json({ summaries, monthlySpot, years: years.map(r => r.year) });
});
```

**For chart data that requires date grouping:** Use Drizzle's `sql` template literal with SQLite `strftime()`. The `tradedAt` field is stored as ISO string (`2024-04-01T10:00:00.000Z`), so `strftime('%Y-%m', traded_at)` works directly.

### Pattern 3: Recharts v3 Chart Components

Recharts 3.8.0 introduces the `responsive` prop on all chart components, eliminating the need for `<ResponsiveContainer>` in most cases. However, `<ResponsiveContainer>` still works. Use `responsive={true}` with `width="100%"`:

```tsx
// Source: verified from node_modules/recharts/types/util/types.d.ts
// responsive prop: "This is similar to ResponsiveContainer but without the need for an extra wrapper"
import { LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts';

function PnlLineChart({ data }: { data: Array<{ month: string; cumulative: number }> }) {
  return (
    <LineChart
      data={data}
      width={500}
      height={280}
      responsive={true}   // v3.x native responsive — fills container width
      margin={{ top: 10, right: 20, left: 10, bottom: 5 }}
    >
      <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" />
      <XAxis dataKey="month" stroke="rgba(255,255,255,0.4)" tick={{ fill: 'rgba(255,255,255,0.6)', fontSize: 11 }} />
      <YAxis stroke="rgba(255,255,255,0.4)" tick={{ fill: 'rgba(255,255,255,0.6)', fontSize: 11 }}
             tickFormatter={(v) => `${v.toLocaleString('de-DE')} EUR`} />
      <Tooltip
        contentStyle={{ background: 'rgba(26,35,50,0.95)', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 8 }}
        formatter={(value: number) => [value.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' }), 'P&L']}
      />
      <Line type="monotone" dataKey="cumulative" stroke="#5fdc8a" strokeWidth={2} dot={false} />
    </LineChart>
  );
}
```

**For donut chart** (portfolio distribution):
```tsx
// Source: verified from node_modules/recharts/types/polar/Pie.d.ts
import { PieChart, Pie, Cell, Tooltip, Legend } from 'recharts';
// Note: Cell is deprecated in v3.7+ in favour of shape prop, but still works.
// Use Cell for now until shape-prop pattern is stable.

<PieChart width={300} height={280} responsive={true}>
  <Pie data={data} dataKey="value" nameKey="coin"
       cx="50%" cy="50%"
       innerRadius="55%"    // donut hole
       outerRadius="80%"
       paddingAngle={3}>
    {data.map((entry, i) => <Cell key={entry.coin} fill={COLORS[i % COLORS.length]} />)}
  </Pie>
  <Tooltip formatter={(v: number) => v.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' })} />
  <Legend />
</PieChart>
```

**For grouped bar chart** (spot vs futures):
```tsx
// Source: verified from node_modules/recharts/types/chart/BarChart.d.ts
import { BarChart, Bar, XAxis, YAxis, Tooltip, Legend, CartesianGrid } from 'recharts';

<BarChart data={data} width={500} height={280} responsive={true}>
  <XAxis dataKey="year" />
  <YAxis />
  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" />
  <Tooltip />
  <Legend />
  <Bar dataKey="spot" fill="#5fdc8a" name="Spot (§23)" />
  <Bar dataKey="futures" fill="#0070f2" name="Futures (§20)" />
</BarChart>
```

### Pattern 4: Infinite Scroll with IntersectionObserver

The transaction list uses infinite scroll (not pagination buttons). The standard approach in React without a library:

```tsx
// Source: browser standard API, no library needed
const sentinelRef = useRef<HTMLDivElement>(null);

useEffect(() => {
  const observer = new IntersectionObserver(
    (entries) => {
      if (entries[0].isIntersecting && hasMore && !loading) {
        loadMore(); // fetch next page with offset += limit
      }
    },
    { threshold: 0.1 }
  );
  if (sentinelRef.current) observer.observe(sentinelRef.current);
  return () => observer.disconnect();
}, [hasMore, loading]);

// At bottom of transaction list:
<div ref={sentinelRef} style={{ height: 1 }} />
```

**In tests:** IntersectionObserver must be mocked in `setup.ts`. jsdom 27 does not implement it.

### Pattern 5: Slide-in Side Panel with motion/react

```tsx
// Source: verified — motion@12.36.0 in package.json, pattern from App.tsx AnimatePresence usage
import { AnimatePresence, motion } from 'motion/react';

function TransactionDetail({ transaction, onClose }) {
  return (
    <AnimatePresence>
      {transaction && (
        <motion.div
          key="detail-panel"
          initial={{ x: '100%' }}
          animate={{ x: 0 }}
          exit={{ x: '100%' }}
          transition={{ duration: 0.3, ease: 'easeOut' }}
          style={{ position: 'fixed', right: 0, top: 0, bottom: 0, width: '400px', zIndex: 100 }}
        >
          {/* GlassSurface wrapper for glassmorphism */}
          <GlassSurface width="100%" height="100%" borderRadius={0} backgroundOpacity={0.18}>
            {/* content */}
          </GlassSurface>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
```

### Pattern 6: German Number Formatting

Use `Intl.NumberFormat` consistently. Define a shared utility:

```typescript
// Create packages/frontend/src/utils/format.ts
export function formatEur(value: string | number, showSign = false): string {
  const num = typeof value === 'string' ? parseFloat(value) : value;
  return new Intl.NumberFormat('de-DE', {
    style: 'currency',
    currency: 'EUR',
    signDisplay: showSign ? 'exceptZero' : 'auto',
  }).format(num);
}

export function formatEurShort(value: string | number): string {
  // For KPI cards: "1.234,56 EUR" without currency symbol redundancy
  const num = typeof value === 'string' ? parseFloat(value) : value;
  return new Intl.NumberFormat('de-DE', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(num) + ' EUR';
}
```

### Pattern 7: React Testing Library Component Tests

The existing vitest config uses `environment: 'jsdom'` and `setupFiles: ['packages/frontend/src/test/setup.ts']` for all frontend tests. The setup file currently only imports `@testing-library/jest-dom/vitest`.

Two mocks must be added to `setup.ts` before Recharts tests will pass:

```typescript
// packages/frontend/src/test/setup.ts — MUST ADD:
import '@testing-library/jest-dom/vitest';

// Mock ResizeObserver — not in jsdom 27, required by Recharts ResponsiveContainer
// and by the responsive prop internals
global.ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
};

// Mock IntersectionObserver — not in jsdom, required by infinite scroll
global.IntersectionObserver = class IntersectionObserver {
  constructor(private cb: IntersectionObserverCallback) {}
  observe() {}
  unobserve() {}
  disconnect() {}
  root = null;
  rootMargin = '';
  thresholds = [];
} as unknown as typeof IntersectionObserver;
```

Component test pattern using `vi.mock` for fetch:

```tsx
// Source: pattern from existing import.test.ts + RTL docs
import { render, screen, waitFor } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import Dashboard from './Dashboard';

const mockSummaryData = { /* ... */ };

beforeEach(() => {
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => mockSummaryData,
  } as Response);
});

it('renders KPI cards with real data after fetch', async () => {
  render(<Dashboard />);
  await waitFor(() => {
    expect(screen.getByText(/1\.234,56 EUR/)).toBeInTheDocument();
  });
});
```

### Anti-Patterns to Avoid

- **`<ResponsiveContainer>` is not wrong but redundant in v3.x.** Using `responsive={true}` on the chart component is the v3 idiomatic approach. Either works, but don't mix both.
- **Do not use `Cell` for color arrays.** While `Cell` still works, the v3.7+ approach is `shape` prop. However since `Cell` is still functional (only deprecated, not removed in 3.8.0), using it avoids churn for now.
- **Do not build a custom sort/filter store.** Keep filter state local to the Transactions tab component or in a simple `useReducer`. No Redux/Zustand needed — the codebase has no state management library installed.
- **Do not call `/api/engine/run` from the UI on every page load.** The summary data comes from `tax_summaries` which is populated when the engine runs. The engine is triggered manually. The summary API should serve pre-computed data only.
- **Do not return all transactions without pagination.** The transaction list must use `limit/offset`. Return `{ items, total, hasMore }` from the API.
- **Do not hardcode chart heights as fixed px values.** With `responsive={true}`, set `width={500}` as a hint and let CSS override with `width: 100%` on the parent container.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Chart rendering | Custom SVG charts | recharts@3.8.0 (already installed) | Axis scaling, tooltip, animation, accessibility all handled |
| Number formatting | String manipulation | `Intl.NumberFormat('de-DE', ...)` | Locale-aware grouping/decimal separators built in |
| Infinite scroll detection | scroll event listeners + math | `IntersectionObserver` API | More performant, no scroll math, works with fixed containers |
| Animation/slide panel | CSS transitions only | `motion/react` AnimatePresence (already used in App.tsx) | Consistent with existing tab animation pattern |
| Date range comparisons | String slicing | Drizzle `between(col, from, to)` | Handles ISO string comparison correctly in SQLite |
| Case-insensitive search | Manual toLowerCase | SQLite `LIKE` (already case-insensitive for ASCII) | No extra logic needed for coin name/order ID search |
| Decimal formatting for MoneyString | Custom parser | `parseFloat(moneyString)` then `Intl.NumberFormat` | MoneyString is already a valid JS number string |

**Key insight:** The entire problem domain (charts, formatting, filtering, animation) has existing solutions already installed. This phase is integration work, not library selection work.

---

## Common Pitfalls

### Pitfall 1: Recharts in jsdom — ResizeObserver not defined

**What goes wrong:** Tests throw `ReferenceError: ResizeObserver is not defined` when any Recharts chart renders with `responsive={true}` or inside a `<ResponsiveContainer>`.

**Why it happens:** jsdom 27 does not implement ResizeObserver. Recharts uses it to measure container dimensions.

**How to avoid:** Add `global.ResizeObserver = class { observe(){} unobserve(){} disconnect(){} }` to `packages/frontend/src/test/setup.ts` before writing any chart component tests.

**Warning signs:** Any test file that imports a Recharts chart component will fail immediately in the current setup.

### Pitfall 2: `tradedAt` grouping — strftime on ISO strings

**What goes wrong:** Grouping by month using `strftime('%Y-%m', traded_at)` fails or returns wrong results if the stored timestamp includes timezone offset (e.g., `2024-04-01T10:00:00+02:00`).

**Why it happens:** SQLite's `strftime` expects UTC-based ISO strings. The `tradedAt` field stores strings as-is from CSV import.

**How to avoid:** Use `strftime('%Y-%m', substr(traded_at, 1, 10))` to extract just the date part, which is unambiguous. Or use `strftime('%Y-%m', traded_at)` — SQLite will parse ISO 8601 strings with timezone offsets correctly since SQLite 3.38.

**Warning signs:** Monthly chart data showing wrong months for transactions near midnight in European timezone.

### Pitfall 3: Empty state vs. no engine run

**What goes wrong:** The summary API returns empty arrays when no engine run has happened. The UI must distinguish between "no data imported" and "data imported but engine not run" vs "engine ran, genuinely zero gains".

**Why it happens:** `tax_summaries` is empty until `POST /api/engine/run` has been called at least once.

**How to avoid:** The summary API should return `{ summaries: [], engineHasRun: false }` based on whether `tax_summaries` has any rows. The UI should show a "Run the engine first" CTA when `engineHasRun === false`.

**Warning signs:** KPI cards showing "0.00 EUR" instead of "--" or a helpful empty state.

### Pitfall 4: Year selector — available years from summaries only

**What goes wrong:** The year selector shows no options if no engine run has happened. It might crash or show `NaN` if `years` is an empty array.

**Why it happens:** Available years come from `tax_summaries.taxYear` distinct values. No summaries = no years.

**How to avoid:** Fall back to `new Date().getFullYear()` if no years available. Default selected year = max year in available list.

### Pitfall 5: MoneyString arithmetic in frontend

**What goes wrong:** Summing multiple `MoneyString` values (e.g., `totalGainsEur + totalLossesEur`) using `+` operator concatenates strings instead of adding.

**Why it happens:** `MoneyString = string`. All monetary fields from the API are strings.

**How to avoid:** Always `parseFloat(moneyString)` before arithmetic. For the KPI display values, compute all numbers before formatting. The shared `@cryptax/shared` `toDecimal()` utility can be used if exact Decimal arithmetic is needed (for taxes it is), but for display purposes `parseFloat` is sufficient.

### Pitfall 6: Transaction sort by amount — lexicographic vs numeric

**What goes wrong:** `ORDER BY amount ASC` in SQLite sorts `"10"` before `"9"` because `amount` is stored as `TEXT` (not NUMERIC).

**Why it happens:** All monetary fields use `text()` in the Drizzle schema (STRICT mode, text type).

**How to avoid:** For numeric sorts on text columns, use `sql\`CAST(${transactions.amount} AS REAL)\`` in the ORDER BY clause instead of the plain column reference.

```typescript
// Correct for numeric text sort
import { sql } from 'drizzle-orm';
const amountCast = sql<number>`CAST(${transactions.amount} AS REAL)`;
.orderBy(sortDir === 'asc' ? asc(amountCast) : desc(amountCast))
```

### Pitfall 7: Transaction detail — FIFO lot join

**What goes wrong:** The lot consumption join requires two joins: `lot_consumptions` → `fifo_lots` (for buy date, cost basis) and `lot_consumptions` → `transactions` (for the sell transaction itself).

**Why it happens:** `lot_consumptions.sell_transaction_id` references the sell transaction, while `lot_consumptions.lot_id` references `fifo_lots` which in turn references the buy transaction via `fifo_lots.transaction_id`.

**How to avoid:** The transaction detail endpoint should join: `lotConsumptions` LEFT JOIN `fifoLots` using `lotConsumptions.lotId = fifoLots.id`, then include `fifoLots.acquiredAt`, `fifoLots.costPerUnitEur`, `lotConsumptions.gainLossEur`, and `lotConsumptions.haltefristMet` directly.

---

## Code Examples

### Summary API Response Shape

```typescript
// New type to add to packages/shared/src/types/summary.ts
export interface YearSummaryResponse {
  taxYear: number;
  availableYears: number[];
  buckets: Array<{
    bucket: 'private_sale' | 'futures_pnl' | 'staking_earn';
    totalGainsEur: string;
    totalLossesEur: string;
    netEur: string;
    taxableAmountEur: string;
    estimatedTaxEur: string;
    tradeCount: number;
  }>;
  // Aggregated KPI values (derived from buckets)
  totalNetEur: string;               // sum of all bucket net
  totalTradeCount: number;
  totalTaxableEur: string;
  totalEstimatedTaxEur: string;
  // Chart data
  monthlySpot: Array<{ month: string; gains: string; losses: string }>;
  monthlyFutures: Array<{ month: string; pnl: string }>;
  perCoinGainLoss: Array<{ symbol: string; net: string }>;
  portfolioAllocation: Array<{ symbol: string; totalCost: string }>;
  // Freigrenze
  spotFreigrenzeEur: string;         // TAX_CONSTANTS.SPOT_FREIGRENZE_EUR = "1000"
  earnFreigrenzeEur: string;         // TAX_CONSTANTS.EARN_FREIGRENZE_EUR = "256"
  spotNetForFreigrenze: string;      // taxable net for §23
  earnTotalForFreigrenze: string;    // total earn for §22
  engineHasRun: boolean;
}
```

### Freigrenze Progress Bar Component

```tsx
// packages/frontend/src/components/Dashboard/FreigrenzeBar.tsx
interface FreigrenzeBarProps {
  label: string;        // "Spot §23" or "Earn §22"
  current: number;      // current EUR amount
  limit: number;        // 1000 or 256
}

function FreigrenzeBar({ label, current, limit }: FreigrenzeBarProps) {
  const pct = Math.min((current / limit) * 100, 100);
  const color = pct < 70 ? 'var(--crypto-green)' : pct < 90 ? '#f59e0b' : 'var(--crypto-red)';

  return (
    <div className="freigrenze-bar">
      <div className="freigrenze-bar__header">
        <span>{label}</span>
        <span style={{ color }}>{formatEur(current)} / {formatEur(limit)}</span>
      </div>
      <div className="freigrenze-bar__track">
        <div
          className="freigrenze-bar__fill"
          style={{ width: `${pct}%`, background: color }}
          role="progressbar"
          aria-valuenow={Math.round(pct)}
          aria-valuemin={0}
          aria-valuemax={100}
        />
      </div>
    </div>
  );
}
```

### Drizzle Query for Monthly P&L

```typescript
// Source: Drizzle ORM docs + verified sql`` template literal pattern
import { sql, eq, and } from 'drizzle-orm';
import { lotConsumptions } from '../db/schema.js';

const monthlySpot = db
  .select({
    month: sql<string>`strftime('%Y-%m', ${lotConsumptions.taxYear})`.as('month'),
    gains: sql<string>`CAST(SUM(CASE WHEN CAST(${lotConsumptions.gainLossEur} AS REAL) > 0
                           THEN CAST(${lotConsumptions.gainLossEur} AS REAL) ELSE 0 END) AS TEXT)`.as('gains'),
    losses: sql<string>`CAST(SUM(CASE WHEN CAST(${lotConsumptions.gainLossEur} AS REAL) < 0
                            THEN CAST(${lotConsumptions.gainLossEur} AS REAL) ELSE 0 END) AS TEXT)`.as('losses'),
  })
  .from(lotConsumptions)
  .where(eq(lotConsumptions.taxYear, year))
  .groupBy(sql`strftime('%Y-%m', ${lotConsumptions.taxYear})`)
  .orderBy(sql`strftime('%Y-%m', ${lotConsumptions.taxYear})`)
  .all();
```

**Correction:** `lotConsumptions` does not have a date column directly — it has `taxYear` (integer) and references `fifo_lots` and `transactions`. The actual date comes from the sell transaction's `tradedAt`. The monthly grouping query must join to `transactions`:

```typescript
// Correct version with join
const monthlySpot = db
  .select({
    month: sql<string>`strftime('%Y-%m', ${transactions.tradedAt})`.as('month'),
    gains: sql<string>`CAST(SUM(CASE WHEN CAST(${lotConsumptions.gainLossEur} AS REAL) > 0
                           THEN CAST(${lotConsumptions.gainLossEur} AS REAL) ELSE 0 END) AS TEXT)`.as('gains'),
    losses: sql<string>`CAST(SUM(CASE WHEN CAST(${lotConsumptions.gainLossEur} AS REAL) < 0
                            THEN CAST(${lotConsumptions.gainLossEur} AS REAL) ELSE 0 END) AS TEXT)`.as('losses'),
  })
  .from(lotConsumptions)
  .innerJoin(transactions, eq(lotConsumptions.sellTransactionId, transactions.id))
  .where(eq(lotConsumptions.taxYear, year))
  .groupBy(sql`strftime('%Y-%m', ${transactions.tradedAt})`)
  .orderBy(sql`strftime('%Y-%m', ${transactions.tradedAt})`)
  .all();
```

---

## State of the Art

| Old Approach | Current Approach | Version | Impact |
|--------------|------------------|---------|--------|
| `<ResponsiveContainer>` wrapper | `responsive={true}` prop on chart | Recharts 3.x | One less wrapper component |
| `Cell` for pie slice colors | `shape` prop on `Pie` | Recharts 3.7+ | `Cell` still works but deprecated |
| Framer Motion package | `motion/react` package | motion 12.x | App already uses `motion/react` correctly |
| Manual scroll position math | IntersectionObserver API | Browser standard | More reliable infinite scroll |

**Deprecated/outdated:**
- `framer-motion` package: replaced by `motion/react`. The app already uses `motion/react` correctly.
- `recharts@2.x` `<ResponsiveContainer>` as required wrapper: still works but no longer necessary with `responsive` prop.

---

## Open Questions

1. **Monthly chart date source for lot_consumptions**
   - What we know: `lot_consumptions` has `taxYear` (integer) but no date column. The date is on the referenced sell transaction.
   - What's unclear: The `sell_transaction_id` FK exists. A JOIN is required for monthly grouping.
   - Recommendation: Use `INNER JOIN transactions ON lot_consumptions.sell_transaction_id = transactions.id` and group by `strftime('%Y-%m', transactions.traded_at)`.

2. **Portfolio allocation data source**
   - What we know: The "portfolio distribution" chart (DASH-03) should show allocation by coin. This could mean current holdings (open FIFO lots) or cost basis of all buys.
   - What's unclear: "Portfolio distribution" is ambiguous — it could be current unrealized value by coin or historical cost allocation.
   - Recommendation: Use open FIFO lots (`remaining_amount > 0`) grouped by symbol, summed as `remaining_amount * cost_per_unit_eur`. This reflects current cost basis of holdings.

3. **Futures monthly data**
   - What we know: `futures_positions` has `taxYear` but the `transactionId` FK points to the close transaction which has `tradedAt`.
   - What's unclear: Monthly breakdown requires a join to `transactions` just like lot_consumptions.
   - Recommendation: `INNER JOIN transactions ON futures_positions.transaction_id = transactions.id` for monthly grouping.

4. **Year-over-year chart data shape (DASH-08)**
   - What we know: It compares multiple years side by side.
   - What's unclear: Which metric? The context says "year-over-year comparison" without specifying spot vs all buckets.
   - Recommendation: Show total net P&L per year as a grouped bar by bucket (private_sale, futures_pnl, staking_earn). Data comes directly from `tax_summaries` across all years.

---

## Sources

### Primary (HIGH confidence)
- `packages/frontend/package.json` — confirmed library versions: recharts@3.8.0, motion@12.36.0, @testing-library/react@16.3.2, vitest@3.2.4
- `node_modules/recharts/types/util/types.d.ts` — confirmed `responsive` prop exists on BaseChartProps, confirmed deprecation note for ResponsiveContainer
- `node_modules/recharts/types/polar/Pie.d.ts` — confirmed `innerRadius`/`outerRadius` props for donut
- `node_modules/recharts/types/cartesian/Line.d.ts` — confirmed `type`, `dataKey`, `stroke` props
- `node_modules/drizzle-orm/sql/expressions/conditions.d.ts` — confirmed `like`, `ilike`, `and`, `or`, `between`, `gte`, `lte` exports
- `node_modules/drizzle-orm/sqlite-core/query-builders/select.d.ts` — confirmed `.limit()`, `.offset()`, `.orderBy()` methods
- `packages/backend/src/db/schema.ts` — confirmed all table columns, FK relationships, index names
- `packages/backend/drizzle/0000_initial.sql` — confirmed all derived tables exist in migration (no new migrations needed)
- `packages/frontend/src/index.css` — confirmed CSS variables: `--crypto-green: #5fdc8a`, `--crypto-red: #e50000`, `--crypto-blue: #0070f2`
- `packages/frontend/src/test/setup.ts` — confirmed ResizeObserver and IntersectionObserver are NOT currently mocked (must be added)
- `packages/frontend/src/App.tsx` — confirmed tab structure, AnimatePresence pattern, GlassSurface usage, KPI placeholder structure
- `packages/shared/src/types/tax.ts` — confirmed `DashboardKpi` type exists but is not yet used by any route
- `packages/shared/src/constants/index.ts` — confirmed `SPOT_FREIGRENZE_EUR = '1000'`, `EARN_FREIGRENZE_EUR = '256'`

### Secondary (MEDIUM confidence)
- `node_modules/recharts/AGENTS.md` + `README.md` — Recharts v3 overview, composition pattern confirmed
- GitHub Recharts releases page — Cell deprecation in v3.7, `responsive` prop introduction confirmed

### Tertiary (LOW confidence)
- jsdom 27 ResizeObserver support: tested indirectly by checking `setup.ts` does not mock it; confirmed by absence in jsdom polyfills list

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all versions verified from installed node_modules
- Architecture (routes, query patterns): HIGH — verified from existing code patterns and Drizzle types
- Recharts API: HIGH — verified from installed node_modules types
- Test setup requirements: HIGH — verified from vitest.config.ts, setup.ts contents
- Chart data queries (monthly grouping): MEDIUM — schema verified, SQL template approach is standard but not tested against live data
- Open questions (portfolio allocation, YoY chart): LOW — ambiguous from requirements alone

**Research date:** 2026-03-23
**Valid until:** 2026-05-23 (stable ecosystem; Recharts v3 is active but not in major churn)
