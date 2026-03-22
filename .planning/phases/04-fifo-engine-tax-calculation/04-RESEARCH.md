# Phase 4: FIFO Engine + Tax Calculation - Research

**Researched:** 2026-03-22
**Domain:** German crypto tax computation (FIFO lot tracking, Haltefrist, three-bucket tax engine)
**Confidence:** HIGH (domain logic is well-understood from codebase analysis + existing schema/types; German tax rules verified via multiple sources)

## Summary

Phase 4 implements the core tax computation engine for Cryptax. The codebase already has a comprehensive foundation: the database schema defines all 5 derived tables (`fifo_lots`, `lot_consumptions`, `futures_positions`, `earn_income`, `tax_summaries`), the `@cryptax/shared` package exports complete TypeScript types for all tax domain objects (`FifoLot`, `LotConsumption`, `FuturesPosition`, `EarnIncome`, `TaxSummary`, `TaxBucket`), and the `TAX_CONSTANTS` object provides all German tax law constants. The transactions table stores EUR prices from Phase 3, and the `canonicalType` field already classifies transactions into spot/futures/earn categories.

The engine is purely computational: it reads from the immutable `transactions` table, truncates all derived tables, and recomputes from scratch on every run. No external API calls, no network dependencies. The engine uses Decimal.js (already configured with 36-digit precision and ROUND_HALF_UP) for all monetary arithmetic, and date-fns (already installed) for Haltefrist day counting.

The primary complexity lies in three areas: (1) correctly extracting the base asset from heterogeneous `symbol` formats to group FIFO lots, (2) implementing the Haltefrist with the user's conservative >= 366 day interpretation while the existing constant says 365, and (3) ensuring the Freigrenze cliff behavior works correctly (not a deduction -- the entire amount becomes taxable once the threshold is exceeded).

**Primary recommendation:** Build five pure-function engine modules (`FifoEngine`, `SpotTaxCalculator`, `FuturesPnlEngine`, `EarnIncomeEngine`, `TaxCalculator` orchestrator), each accepting a Drizzle db instance via dependency injection. Follow the same DI pattern as `enrichment-engine.ts`. Use `db.transaction()` with `behavior: 'immediate'` for the truncate+recompute cycle to ensure atomicity.

## Standard Stack

The established libraries/tools for this domain:

### Core (Already Installed)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `decimal.js` | ^10.6.0 | All monetary arithmetic | Already configured in `@cryptax/shared` with 36-digit precision, ROUND_HALF_UP |
| `drizzle-orm` | ^0.45.1 | Database queries, transactions | Already used throughout backend for all DB operations |
| `better-sqlite3` | ^12.8.0 | SQLite driver | Already the project's DB engine with WAL mode |
| `date-fns` | ^4.1.0 | Haltefrist day calculation | Already installed, `differenceInCalendarDays` is the right function |
| `date-fns-tz` | ^3.2.0 | Europe/Berlin timezone | Already used in `prices/timezone.ts` for Berlin time handling |

### New (Phase 4 Only)
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `fast-check` | ^4.x | Property-based testing | Plan 04-08 only; devDependency for FIFO invariant tests |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| fast-check | Built-in fuzz loops | fast-check has shrinking, reproducibility, and arbitrary combinators -- vastly superior |
| Custom day counting | Moment.js | date-fns is already installed, lighter, tree-shakeable, and `differenceInCalendarDays` does exactly what we need |
| Raw SQL for truncate | Drizzle `db.delete()` | Drizzle `db.delete(table)` without a `.where()` clause deletes all rows -- equivalent to truncate for SQLite |

**Installation (new deps only):**
```bash
npm install -D fast-check -w packages/backend
```

## Architecture Patterns

### Recommended Project Structure
```
packages/backend/src/
  engine/
    fifo-engine.ts           # FIFO lot creation + consumption (pure logic)
    fifo-engine.test.ts      # Unit tests for FIFO core
    spot-tax-calculator.ts   # Haltefrist + Freigrenze + fee deduction
    spot-tax-calculator.test.ts
    futures-pnl-engine.ts    # Futures P&L aggregation
    futures-pnl-engine.test.ts
    earn-income-engine.ts    # Earn/staking income recognition + lot creation
    earn-income-engine.test.ts
    tax-calculator.ts        # Orchestrator: truncate, dispatch to engines, write summaries
    tax-calculator.test.ts
    null-price-gate.ts       # Pre-flight check: reject if any tx has NULL eurPrice
    null-price-gate.test.ts
    types.ts                 # Engine-internal types (not shared)
    golden-master.test.ts    # Hand-verified complete scenarios (TEST-01)
    property-tests.test.ts   # fast-check property-based tests (TEST-03 / 04-08)
  routes/
    engine.ts                # POST /api/engine/run route
    engine.test.ts
```

### Pattern 1: Engine Module with Dependency Injection
**What:** Each engine module exports a function that accepts `db` (Drizzle instance) and returns a result object. No module-level state. Same pattern as `runEnrichment()` in Phase 3.
**When to use:** All engine modules.
**Example:**
```typescript
// Source: Established pattern in packages/backend/src/prices/enrichment-engine.ts
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import type * as schema from '../db/schema.js';

type Db = BetterSQLite3Database<typeof schema>;

export interface FifoEngineResult {
  lotsCreated: number;
  lotsConsumed: number;
  sellsWithoutLots: Array<{ transactionId: number; symbol: string; amount: string }>;
  skipped: Array<{ transactionId: number; reason: string }>;
}

export function runFifoEngine(db: Db, txs: SpotTransaction[]): FifoEngineResult {
  // Pure computation, no side effects beyond db writes
}
```

### Pattern 2: Stateless Truncate-and-Recompute
**What:** The orchestrator truncates all derived tables within a transaction, then recomputes everything from the immutable `transactions` table.
**When to use:** The `TaxCalculator` orchestrator.
**Example:**
```typescript
// Source: Drizzle ORM docs (https://orm.drizzle.team/docs/transactions)
import { fifoLots, lotConsumptions, futuresPositions, earnIncome, taxSummaries } from '../db/schema.js';

function truncateDerivedTables(db: Db): void {
  // Delete all rows -- Drizzle delete() without where() = truncate
  // Order matters: child tables first (FK constraints)
  db.delete(lotConsumptions).run();
  db.delete(fifoLots).run();
  db.delete(futuresPositions).run();
  db.delete(earnIncome).run();
  db.delete(taxSummaries).run();
}

export async function runTaxCalculation(db: Db): Promise<TaxCalculationResult> {
  return db.transaction(async (tx) => {
    truncateDerivedTables(tx);
    // ... recompute everything
  }, { behavior: 'immediate' });
}
```

### Pattern 3: Asset Symbol Normalization
**What:** Extract the base asset from heterogeneous `symbol` formats stored in the transactions table.
**When to use:** Grouping FIFO lots by asset. The `symbol` field varies by source: `"BTC"` (spot_tx, earn), `"BTC/USDT"` (spot_order), `"BTCUSDT"` (futures_order, futures_tx).
**Example:**
```typescript
// Source: packages/backend/src/prices/symbol-parser.ts (parseSymbol function)
import { parseSymbol } from '../prices/symbol-parser.js';
import type { SourceType } from '@cryptax/shared';

function getBaseAsset(symbol: string, sourceType: SourceType): string {
  return parseSymbol(symbol, sourceType).base;
}
// "BTC" from spot_tx -> "BTC"
// "BTC/USDT" from spot_order -> "BTC"
// "BTCUSDT" from futures_tx -> "BTC"
```

### Pattern 4: In-Memory Lot Pool (Not DB-per-Step)
**What:** Load all buy transactions, build an in-memory ordered lot pool per asset, process sells chronologically against the pool. Write lots to DB only after all processing is complete.
**When to use:** FIFO lot creation and consumption.
**Why:** Avoids N+1 DB queries per sell. The lot pool is a Map<string, FifoLot[]> keyed by base asset. Lots are ordered by `acquiredAt` ASC (FIFO). Sells consume from the front of the array.

### Pattern 5: Sorted Transaction Processing
**What:** Process all transactions in strict chronological order (`tradedAt` ASC) with buys-before-sells tiebreak for same-timestamp transactions.
**When to use:** The FIFO engine must process buys before sells at the same timestamp to ensure lots exist before consumption.
**Example:**
```typescript
// Sort: chronological, buys before sells at same timestamp
transactions.sort((a, b) => {
  const dateCompare = a.tradedAt.localeCompare(b.tradedAt);
  if (dateCompare !== 0) return dateCompare;
  // Buys first: buy < sell in sort order
  const sideOrder = { buy: 0, sell: 1 };
  return (sideOrder[a.side] ?? 2) - (sideOrder[b.side] ?? 2);
});
```

### Anti-Patterns to Avoid
- **Mixing Decimal and Number:** Never use JavaScript `number` for monetary values. Always use `toDecimal()` / `fromDecimal()` from `@cryptax/shared`. The Decimal.js config is already set globally.
- **Using `lot.original_amount` instead of `lot.remaining_amount`:** When consuming a lot, always check and decrement `remaining_amount`. The `original_amount` is immutable for audit trail.
- **Querying DB per sell:** Do not SELECT lots from DB for each sell transaction. Build the in-memory lot pool once and process against it.
- **Floating-point day counting:** Use `differenceInCalendarDays()` from date-fns, not manual millisecond math. Calendar day difference correctly handles DST and leap seconds.
- **Mixing tax buckets:** Never let futures transactions create FIFO lots. Never let earn transactions feed into the spot P&L summary. The three engines must be completely isolated.

## Don't Hand-Roll

Problems that look simple but have existing solutions:

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Monetary arithmetic | Manual parseFloat/toFixed | `toDecimal()` / `fromDecimal()` / `addMoney()` / `subtractMoney()` / `multiplyMoney()` from `@cryptax/shared` | Floating-point errors, rounding issues, precision loss |
| Day counting | `(dateB - dateA) / 86400000` | `differenceInCalendarDays(dateB, dateA)` from date-fns | DST transitions cause 23h or 25h days; calendar days are correct |
| Tax constants | Magic numbers in code | `TAX_CONSTANTS` from `@cryptax/shared` | Already has HALTEFRIST_DAYS, SPOT_FREIGRENZE_EUR, EARN_FREIGRENZE_EUR, ABGELTUNGSSTEUER_RATE |
| Symbol parsing | Regex per source type | `parseSymbol()` from `prices/symbol-parser.ts` | Already handles all 5 source types correctly |
| DB transactions | Manual BEGIN/COMMIT/ROLLBACK | `db.transaction(async (tx) => { ... })` from Drizzle | Handles rollback on error, supports behavior modes |
| Property-based tests | Manual random loops | fast-check | Shrinking, reproducibility, rich arbitrary combinators |
| Timezone handling | Manual UTC offset | `berlinToUtcMs()` from `prices/timezone.ts` | Already handles CET/CEST transitions |

**Key insight:** The codebase already provides most of the building blocks. The engine's job is to compose them correctly, not to build primitives.

## Common Pitfalls

### Pitfall 1: HALTEFRIST_DAYS Constant vs User Decision
**What goes wrong:** The existing `TAX_CONSTANTS.HALTEFRIST_DAYS` is set to 365, but the user decided >= 366 days (conservative interpretation: bought Jan 1, tax-free from Jan 2 next year).
**Why it happens:** The constant was set during Phase 1 before the user made the conservative decision in Phase 4 context discussion.
**How to avoid:** Update `TAX_CONSTANTS.HALTEFRIST_DAYS` to 366 during this phase. The Haltefrist check becomes `differenceInCalendarDays(sellDate, buyDate) >= TAX_CONSTANTS.HALTEFRIST_DAYS` which evaluates to `>= 366`.
**Warning signs:** Tests with 365-day holding periods passing as tax-free when they should be taxable.

### Pitfall 2: Symbol Normalization for Lot Grouping
**What goes wrong:** FIFO lots are grouped by the raw `symbol` field, creating separate lot pools for "BTC", "BTC/USDT", "BTC/EUR", and "BTCUSDT" -- which should all be the same asset.
**Why it happens:** Different CSV formats store symbols differently. spot_tx uses "BTC", spot_order uses "BTC/USDT", futures uses "BTCUSDT".
**How to avoid:** Always normalize to base asset using `parseSymbol(symbol, sourceType).base` before creating or consuming FIFO lots. The FIFO lot's `symbol` column in the DB should store the base asset (e.g., "BTC"), not the trading pair.
**Warning signs:** Sells that should consume existing lots instead report "no matching lot" errors because the symbol doesn't match.

### Pitfall 3: Freigrenze is a Cliff, Not a Deduction
**What goes wrong:** Implementing Freigrenze as a deduction (subtract 1000 EUR from gains) instead of a cliff (if gains <= 1000, tax is 0; if gains > 1000, the ENTIRE amount is taxable).
**Why it happens:** Common misunderstanding -- Freibetrag (deduction) vs Freigrenze (cliff) are different concepts in German tax law.
**How to avoid:** The check is: `if (netGain > SPOT_FREIGRENZE_EUR) { taxableAmount = netGain } else { taxableAmount = 0 }`. Never subtract the Freigrenze from the gain.
**Warning signs:** Gains of 1500 EUR showing taxable amount of 500 EUR (wrong) instead of 1500 EUR (correct).

### Pitfall 4: Earn Income Creates FIFO Lots AND Is Taxable Income
**What goes wrong:** Treating earn/staking as only income (recording EUR value at Zufluss) but forgetting to create a FIFO lot for the received coins.
**Why it happens:** Earn income is §22 Nr. 3 EStG (income tax at receipt). But the received coins also have a cost basis (= EUR value at receipt) and will be subject to §23 Haltefrist if later sold.
**How to avoid:** EarnIncomeEngine does TWO things: (1) records income in `earn_income` table, (2) creates a FIFO lot in `fifo_lots` with cost_basis = EUR value at receipt. The FIFO lot then participates in normal spot disposal processing.
**Warning signs:** Selling staking rewards shows zero cost basis or "no matching lot" errors.

### Pitfall 5: Cross-Year Lot Continuity
**What goes wrong:** Processing each tax year independently, starting with an empty lot pool for each year.
**Why it happens:** Temptation to partition processing by tax year for simplicity.
**How to avoid:** Process ALL years in one chronological pass. Lots created in 2024 must be available for consumption in 2025. The engine processes all transactions sorted by `tradedAt`, not partitioned by `taxYear`.
**Warning signs:** Selling a coin bought in 2024 during 2025 reports "no matching lot" because 2024 lots were discarded.

### Pitfall 6: Fee Handling on Both Sides
**What goes wrong:** Only accounting for buy-side fees (added to cost basis) and forgetting sell-side fees (subtracted from proceeds).
**Why it happens:** Fee treatment is asymmetric and easy to forget one side.
**How to avoid:** Per the user's decision: fees on buy are added to cost basis (increasing cost per unit), fees on sell are subtracted from proceeds (decreasing gain). Non-EUR fees must be converted using the trade's eurPrice.
**Warning signs:** Tax calculations slightly off compared to manual computation; fees appearing doubled or absent.

### Pitfall 7: Futures Transactions Must Not Create FIFO Lots
**What goes wrong:** Futures open/close transactions being fed into the FIFO engine, creating lots for derivatives positions.
**Why it happens:** Futures transactions have `side: 'buy'` (for open_long/close_short) which could match the FIFO lot creation filter.
**How to avoid:** Filter by `sourceType` or `canonicalType` before FIFO processing. Only `spot_tx`, `spot_order`, and `earn` source types create/consume FIFO lots. Futures (`futures_tx`, `futures_order`) go exclusively to `FuturesPnlEngine`.
**Warning signs:** FIFO lot pool contains derivative positions; futures P&L appears in §23 bucket.

### Pitfall 8: SQLite STRICT Mode and TEXT Columns
**What goes wrong:** Attempting to insert a number into a TEXT column in STRICT mode.
**Why it happens:** SQLite STRICT tables reject type mismatches. All monetary values must be strings.
**How to avoid:** Always use `fromDecimal()` to convert Decimal.js values to strings before DB insertion.
**Warning signs:** Runtime error "cannot store REAL value in TEXT column" from SQLite.

### Pitfall 9: Delete Order with Foreign Keys
**What goes wrong:** Truncating `fifo_lots` before `lot_consumptions` fails because `lot_consumptions.lot_id` references `fifo_lots.id`.
**Why it happens:** Foreign keys are enabled (`PRAGMA foreign_keys = ON` in client.ts).
**How to avoid:** Delete child tables first: `lot_consumptions` -> `fifo_lots` -> `futures_positions` -> `earn_income` -> `tax_summaries`.
**Warning signs:** Foreign key constraint violation errors during truncate.

## Code Examples

Verified patterns from the existing codebase and official sources:

### Haltefrist Day Calculation
```typescript
// Source: date-fns docs (differenceInCalendarDays)
import { differenceInCalendarDays, parseISO } from 'date-fns';
import { TAX_CONSTANTS } from '@cryptax/shared';

function isHaltefristMet(acquiredAt: string, disposedAt: string): boolean {
  const buyDate = parseISO(acquiredAt.replace(' ', 'T'));
  const sellDate = parseISO(disposedAt.replace(' ', 'T'));
  const heldDays = differenceInCalendarDays(sellDate, buyDate);
  return heldDays >= TAX_CONSTANTS.HALTEFRIST_DAYS; // >= 366 after update
}
```

### Freigrenze Cliff Logic
```typescript
// Source: German tax law §23 EStG
import { toDecimal, fromDecimal, ZERO } from '@cryptax/shared';

function applyFreigrenze(netGainEur: string, freigrenzeEur: string): string {
  const gain = toDecimal(netGainEur);
  const threshold = toDecimal(freigrenzeEur);
  // Cliff: if gain <= threshold, taxable = 0; if gain > threshold, taxable = full gain
  if (gain.lte(threshold)) return fromDecimal(ZERO);
  return netGainEur; // entire amount is taxable
}
```

### FIFO Lot Consumption (Partial Split)
```typescript
import { Decimal, toDecimal, fromDecimal, ZERO } from '@cryptax/shared';

interface InMemoryLot {
  id: number;
  transactionId: number;
  symbol: string;
  originalAmount: Decimal;
  remainingAmount: Decimal;
  costPerUnitEur: Decimal;
  feeEur: Decimal;
  acquiredAt: string;
  taxYear: number;
}

interface ConsumptionRecord {
  lotId: number;
  sellTransactionId: number;
  amountConsumed: Decimal;
  costBasisEur: Decimal;
  proceedsEur: Decimal;
  gainLossEur: Decimal;
  feeEur: Decimal;
  heldDays: number;
  haltefristMet: boolean;
  taxYear: number;
}

function consumeLots(
  lots: InMemoryLot[],
  sellAmount: Decimal,
  sellPricePerUnitEur: Decimal,
  sellFeeEur: Decimal,
  sellDate: string,
  sellTxId: number,
  sellTaxYear: number,
): ConsumptionRecord[] {
  const consumptions: ConsumptionRecord[] = [];
  let remaining = sellAmount;
  // Proportional fee allocation across consumed lots
  const totalSellFeePerUnit = sellFeeEur.div(sellAmount);

  for (const lot of lots) {
    if (remaining.lte(ZERO)) break;
    if (lot.remainingAmount.lte(ZERO)) continue;

    const consumed = Decimal.min(remaining, lot.remainingAmount);
    const costBasis = consumed.times(lot.costPerUnitEur);
    const proceeds = consumed.times(sellPricePerUnitEur);
    const allocatedSellFee = consumed.times(totalSellFeePerUnit);
    const gainLoss = proceeds.minus(costBasis).minus(allocatedSellFee);
    const heldDays = differenceInCalendarDays(
      parseISO(sellDate.replace(' ', 'T')),
      parseISO(lot.acquiredAt.replace(' ', 'T')),
    );
    const haltefristMet = heldDays >= TAX_CONSTANTS.HALTEFRIST_DAYS;

    consumptions.push({
      lotId: lot.id,
      sellTransactionId: sellTxId,
      amountConsumed: consumed,
      costBasisEur: costBasis,
      proceedsEur: proceeds,
      gainLossEur: gainLoss,
      feeEur: allocatedSellFee,
      heldDays,
      haltefristMet,
      taxYear: sellTaxYear,
    });

    lot.remainingAmount = lot.remainingAmount.minus(consumed);
    remaining = remaining.minus(consumed);
  }

  return consumptions;
}
```

### NULL Price Gate
```typescript
import { isNull } from 'drizzle-orm';
import { transactions } from '../db/schema.js';

interface NullPriceError {
  transactionId: number;
  symbol: string;
  tradedAt: string;
  sourceType: string;
}

function checkNullPrices(db: Db): NullPriceError[] {
  const nullRows = db
    .select({
      id: transactions.id,
      symbol: transactions.symbol,
      tradedAt: transactions.tradedAt,
      sourceType: transactions.sourceType,
    })
    .from(transactions)
    .where(isNull(transactions.eurPrice))
    .all();

  return nullRows.map(r => ({
    transactionId: r.id,
    symbol: r.symbol,
    tradedAt: r.tradedAt,
    sourceType: r.sourceType,
  }));
}
```

### Drizzle Transaction with Immediate Behavior
```typescript
// Source: https://orm.drizzle.team/docs/transactions
const result = await db.transaction(async (tx) => {
  // Truncate derived tables (child first for FK compliance)
  tx.delete(lotConsumptions).run();
  tx.delete(fifoLots).run();
  tx.delete(futuresPositions).run();
  tx.delete(earnIncome).run();
  tx.delete(taxSummaries).run();

  // Recompute...
  const fifoResult = runFifoEngine(tx, spotTransactions);
  const futuresResult = runFuturesPnlEngine(tx, futuresTransactions);
  const earnResult = runEarnIncomeEngine(tx, earnTransactions);

  // Write summaries
  writeTaxSummaries(tx, fifoResult, futuresResult, earnResult);

  return { fifoResult, futuresResult, earnResult };
}, { behavior: 'immediate' });
```

### fast-check Property Test for FIFO Invariants
```typescript
// Source: fast-check README (https://github.com/dubzzz/fast-check)
import fc from 'fast-check';
import { describe, it } from 'vitest';

describe('FIFO invariants (property-based)', () => {
  it('lot.remainingAmount is never negative', () => {
    fc.assert(
      fc.property(
        // Generate a list of buy amounts and a list of sell amounts
        fc.array(fc.double({ min: 0.001, max: 100, noNaN: true }), { minLength: 1, maxLength: 20 }),
        fc.array(fc.double({ min: 0.001, max: 50, noNaN: true }), { minLength: 0, maxLength: 10 }),
        (buyAmounts, sellAmounts) => {
          // Build lots from buys, consume with sells
          // Assert: no lot.remainingAmount < 0
        },
      ),
    );
  });

  it('total consumed never exceeds total acquired per asset', () => {
    fc.assert(
      fc.property(
        // ... arbitraries
        (buys, sells) => {
          // Assert: sum(consumed) <= sum(acquired) for each asset
        },
      ),
    );
  });
});
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Freigrenze 600 EUR | Freigrenze 1000 EUR | Tax year 2024 | `TAX_CONSTANTS.SPOT_FREIGRENZE_EUR` already set to '1000' |
| 10-year Haltefrist for staked coins | 1-year for all | BMF letter Feb 2022 | User decision: follow mainstream tools, 1-year for everything |
| Manual lot tracking | Automated FIFO in software | N/A | This is what we're building |

**Deprecated/outdated:**
- 600 EUR Freigrenze: Replaced by 1000 EUR from tax year 2024. The codebase already uses '1000'.
- 10-year staking Haltefrist: The 2021 draft legislation proposed extending to 10 years; the 2022 BMF letter clarified 1-year applies. User confirmed 1-year.

## Critical Design Decisions (from CONTEXT.md)

These are LOCKED decisions that constrain the implementation:

| Decision | Impact on Implementation |
|----------|--------------------------|
| >= 366 days Haltefrist | Update `TAX_CONSTANTS.HALTEFRIST_DAYS` from 365 to 366 |
| Missing buy lot = error | `FifoEngine` must track sells that cannot be matched and report them |
| Invalid tx = skip + report | Engine continues on errors, collects all skipped items |
| No dust threshold | Process every amount, no special cases |
| Buys-before-sells tiebreak | Sort transactions with buys first at same timestamp |
| Partial split inherits buy date | Sub-lot keeps original `acquiredAt` |
| Fees as Werbungskosten | Buy fees increase cost basis, sell fees reduce proceeds |
| Non-EUR fees converted at trade EUR price | Use transaction's `eurPrice` for fee conversion |
| Always truncate + recompute | No incremental engine -- full stateless recompute |
| Hard NULL price gate | Refuse to run if any transaction has NULL eurPrice |
| Process all years in one run | Chronological order, lots carry forward across years |

## Transaction Classification Map

Critical for routing transactions to the correct engine:

| canonicalType | Engine | Creates Lot? | Consumes Lot? | Notes |
|--------------|--------|-------------|--------------|-------|
| `buy` | FifoEngine | YES | NO | Spot purchase -- creates FIFO lot |
| `sell` | FifoEngine | NO | YES | Spot sale -- consumes oldest lots |
| `earn_interest` | EarnIncomeEngine | YES (new lot) | NO | Staking reward: income at Zufluss + new lot |
| `earn_deposit` | EarnIncomeEngine | YES (new lot) | NO | Same treatment as earn_interest |
| `earn_withdrawal` | SKIP | NO | NO | Internal Bitget transfer, not taxable |
| `transfer_in` | SKIP | NO | NO | Wallet transfer, not a taxable event |
| `transfer_out` | SKIP | NO | NO | Wallet transfer, not a taxable event |
| `futures_open_long` | FuturesPnlEngine | NO | NO | Opens position |
| `futures_open_short` | FuturesPnlEngine | NO | NO | Opens position |
| `futures_close_long` | FuturesPnlEngine | NO | NO | Closes position, realized P&L |
| `futures_close_short` | FuturesPnlEngine | NO | NO | Closes position, realized P&L |
| `futures_fee` | FuturesPnlEngine | NO | NO | Trading fee for futures |
| `futures_funding` | FuturesPnlEngine | NO | NO | Funding rate payment |
| `fee` | SKIP | NO | NO | General fee, handled via fee fields on trades |
| `unknown` | SKIP | NO | NO | Unrecognized, skip with warning |

## Futures P&L Calculation Approach

The existing `futures_positions` schema is simplified compared to the shared `FuturesPosition` type. The schema stores: `symbol`, `realized_pnl_eur`, `fee_eur`, `transaction_id`, `tax_year`.

**Recommended approach:** For each futures close transaction (`futures_close_long`, `futures_close_short`), the realized P&L in EUR is already captured in the transaction data. The `FuturesPnlEngine` records each close as a `futures_positions` row with the realized P&L. Fees from `futures_fee` and `futures_funding` rows are aggregated separately.

**Key insight:** Bitget's futures_tx CSV records the P&L as the `amount` field for close transactions (in the margin currency, typically USDT). The `eurPrice` field (from Phase 3) provides the EUR conversion rate. So realized P&L in EUR = `amount * eurPrice` for close transactions.

## Earn Income + FIFO Lot Dual Processing

Earn transactions have dual tax treatment:
1. **§22 Nr. 3 income:** EUR value at Zufluss timestamp is taxable income (if annual total > 256 EUR)
2. **§23 FIFO lot:** Received coins get a new FIFO lot with cost basis = EUR value at receipt

The `EarnIncomeEngine` must:
- Write to `earn_income` table (income tracking)
- Write to `fifo_lots` table (lot tracking)
- Use the same `eurPrice` from the transaction for both

## Database Schema Alignment

The existing schema and shared types have minor naming mismatches that need to be handled in the engine layer:

| Schema Column | Shared Type Field | Notes |
|--------------|------------------|-------|
| `fifo_lots.original_amount` | `FifoLot.quantity` | Same concept, different name |
| `fifo_lots.remaining_amount` | `FifoLot.remainingQuantity` | Same concept, different name |
| `fifo_lots.cost_per_unit_eur` | `FifoLot.costBasisPerUnit` | Same concept |
| `lot_consumptions.amount_consumed` | `LotConsumption.quantityConsumed` | Same concept |
| Schema `haltefrist_met` is integer (boolean) | Type `isTaxFree` is boolean | Same meaning |

The engine writes to the schema (Drizzle insert), and API responses use the shared types. The mapping happens at the route layer.

## Open Questions

Things that couldn't be fully resolved:

1. **Futures P&L extraction from transaction data**
   - What we know: futures_tx has `amount` field for close positions, and `eurPrice` from Phase 3
   - What's unclear: Whether the `amount` field for futures close transactions represents the realized P&L directly, or the position size. Need to verify against actual imported data.
   - Recommendation: Examine actual transaction data in the DB during implementation. The normalize.ts shows futures_tx amount comes from the CSV `amount` column, which for Bitget is the realized P&L for close events.

2. **Buy-side fee: gross vs net lot sizing**
   - What we know: User decided fees as Werbungskosten. Buy fees increase cost basis.
   - What's unclear: Whether the FIFO lot amount should be the gross amount (before fee deduction) or net amount (after fee). The CONTEXT.md says "Claude's discretion" for this.
   - Recommendation: Lot amount = gross (the amount field from the transaction). Fee is recorded separately in `fifo_lots.fee_eur`. Cost per unit = (totalValue + fee) / amount. This way the lot tracks the actual quantity acquired, and the fee increases the effective cost basis per unit.

3. **Futures fees: how to handle in Abgeltungssteuer bucket**
   - What we know: User marked "Claude's discretion" for futures fee treatment
   - What's unclear: Whether futures fees reduce realized P&L before Abgeltungssteuer, or are reported separately
   - Recommendation: Futures fees reduce the net P&L in the §20 bucket. Record `fee_eur` on each `futures_positions` row. Net P&L = realized_pnl_eur - fee_eur. This is standard Abgeltungssteuer treatment.

## Sources

### Primary (HIGH confidence)
- Codebase analysis: `packages/backend/src/db/schema.ts` -- all 5 derived tables already defined with correct columns
- Codebase analysis: `packages/shared/src/types/tax.ts` -- complete TypeScript types for FifoLot, LotConsumption, FuturesPosition, EarnIncome, TaxSummary
- Codebase analysis: `packages/shared/src/constants/index.ts` -- TAX_CONSTANTS with all German tax law constants
- Codebase analysis: `packages/shared/src/decimal/money.ts` -- Decimal.js configured with 36-digit precision
- Codebase analysis: `packages/backend/src/prices/enrichment-engine.ts` -- established DI pattern for engine modules
- Codebase analysis: `packages/backend/src/prices/symbol-parser.ts` -- symbol normalization utility
- Codebase analysis: `packages/backend/src/import/type-map.ts` -- complete canonical type mapping
- Codebase analysis: `packages/backend/src/import/normalize.ts` -- transaction normalization logic
- Official docs: Drizzle ORM delete (https://orm.drizzle.team/docs/delete) -- `db.delete(table)` without where = delete all
- Official docs: Drizzle ORM transactions (https://orm.drizzle.team/docs/transactions) -- `db.transaction()` with behavior option
- Official docs: date-fns differenceInCalendarDays (https://github.com/date-fns/date-fns) -- calendar day calculation

### Secondary (MEDIUM confidence)
- Koinly German crypto tax guide (https://koinly.io/guides/crypto-tax-germany/) -- confirmed Freigrenze 1000 EUR from 2024, §23/§20/§22 classification, Abgeltungssteuer 26.375%
- fast-check README (https://github.com/dubzzz/fast-check) -- v4.x API with fc.property, fc.assert, custom arbitraries

### Tertiary (LOW confidence)
- Futures P&L extraction from Bitget CSV `amount` field -- needs verification against actual imported data
- fast-check v4 exact API -- confirmed v4 exists but specific API details need verification during implementation

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- all core libraries already installed and used in the project
- Architecture: HIGH -- follows established patterns from Phase 3 (enrichment engine DI pattern)
- Tax law rules: HIGH -- §23 Haltefrist, §20 Abgeltungssteuer, §22 Nr.3 earn income confirmed from multiple sources
- FIFO algorithm: HIGH -- well-understood computer science algorithm, straightforward to implement with Decimal.js
- Pitfalls: HIGH -- identified from codebase analysis (symbol formats, FK ordering, constant mismatch)
- Futures P&L: MEDIUM -- needs verification against actual data during implementation
- fast-check integration: MEDIUM -- library confirmed but exact Vitest integration pattern needs validation

**Research date:** 2026-03-22
**Valid until:** 2026-04-22 (stable domain -- German tax law changes annually, not mid-year)
