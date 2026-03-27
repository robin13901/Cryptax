---
phase: 04-fifo-engine-tax-calculation
verified: 2026-03-22T22:06:22Z
status: passed
score: 5/5 must-haves verified
---

# Phase 4: FIFO Engine + Tax Calculation Verification Report

**Phase Goal:** Running the tax engine produces correct, Finanzamt-compliant tax summaries for every imported year with FIFO lot tracking per coin, Haltefrist applied correctly, three tax buckets kept strictly separate, and the Freigrenze implemented as a cliff (not a deduction).
**Verified:** 2026-03-22T22:06:22Z
**Status:** passed
**Re-verification:** No, initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | 3 BTC buys, 1 partial sell crossing two lots: Haltefrist-met lot produces zero taxable gain; recent lot produces correct partial gain | VERIFIED | golden-master.test.ts Scenario 1: consumptionA.haltefristMet=true (427 days) gainLossEur=17500 excluded; consumptionB.haltefristMet=false (199 days) taxableAmountEur=4000 asserted with toBe. All pass. |
| 2 | Futures P&L rows never enter the FIFO lot pool; spot and futures produce separate summaries with no cross-contamination | VERIFIED | tax-calculator.ts lines 151-162: only earn types create synthetic buys for FIFO. FIFO engine handles only buy/sell; others go to skipped[]. Scenario 3 asserts 3 summary rows: futures_pnl, private_sale, staking_earn. |
| 3 | Gains of 999.99 produce 0 EUR taxable; gains of 1000.01 produce 1000.01 taxable (entire amount, cliff behavior) | VERIFIED | Scenario 2: (a) 999.99=0 (toBe); (b) 1000.00=0 (toBe); (c) 1000.01=1000.01 (toBeCloseTo 2dp). spot-tax-calculator.ts line 79: netGain.greaterThan(freigrenze) strict cliff. |
| 4 | Engine refuses to run if any transaction has NULL eurPrice; error message identifies which transactions | VERIFIED | tax-calculator.ts lines 61-74: checkNullPrices(db) first; errors include transactionId/symbol/tradedAt. Scenario 4: errors.length=1, reason matches /Missing EUR price/, 5 derived tables confirmed empty. |
| 5 | Truncating derived tables and rerunning produces identical tax summaries (stateless idempotency) | VERIFIED | tax-calculator.ts step 3: tx.delete() on all 5 tables inside db.transaction() before writes. Scenario 5: two-run string toBe on taxableAmountEur/totalGainsEur/netEur; 5-run test verifies row counts stay at 1. |

**Score:** 5/5 truths verified

---

### Required Artifacts

| Artifact | Exists | Substantive | Wired | Status |
|----------|--------|-------------|-------|--------|
| packages/shared/src/constants/index.ts | Yes | 40 lines, HALTEFRIST_DAYS=366 | Imported by fifo-engine.ts, spot-tax-calculator.ts | VERIFIED |
| packages/backend/src/engine/types.ts | Yes | All required types exported | Imported by all engine modules | VERIFIED |
| packages/backend/src/engine/null-price-gate.ts | Yes | 114 lines | Imported by tax-calculator.ts, routes/engine.ts | VERIFIED |
| packages/backend/src/engine/fifo-engine.ts | Yes | 216 lines | Imported by tax-calculator.ts | VERIFIED |
| packages/backend/src/engine/spot-tax-calculator.ts | Yes | 101 lines | Imported by tax-calculator.ts | VERIFIED |
| packages/backend/src/engine/futures-pnl-engine.ts | Yes | 95 lines | Imported by tax-calculator.ts | VERIFIED |
| packages/backend/src/engine/earn-income-engine.ts | Yes | Substantive | Imported by tax-calculator.ts | VERIFIED |
| packages/backend/src/engine/tax-calculator.ts | Yes | 404 lines | Imported by routes/engine.ts | VERIFIED |
| packages/backend/src/routes/engine.ts | Yes | 91 lines | Registered in index.ts line 18 | VERIFIED |
| packages/backend/src/engine/golden-master.test.ts | Yes | 742 lines, 11 tests | Runs in test suite | VERIFIED |
| packages/backend/src/engine/property-tests.test.ts | Yes | 453 lines, 11 tests | Runs in test suite | VERIFIED |

---

### Key Link Verification

| From | To | Via | Status | Notes |
|------|----|-----|--------|-------|
| tax-calculator.ts | null-price-gate.ts | checkNullPrices(db) line 61 | WIRED | Early-return with errors before any DB writes |
| tax-calculator.ts | fifo-engine.ts | runFifoEngine(fifoInputTransactions) line 162 | WIRED | Spot buy/sell + synthetic earn-buy transactions |
| tax-calculator.ts | futures-pnl-engine.ts | runFuturesPnlEngine(allTransactions) line 167 | WIRED | Strictly separate; futures types skipped by FIFO engine |
| tax-calculator.ts | spot-tax-calculator.ts | calculateSpotTax(fifoResult.consumptions) line 172 | WIRED | ConsumptionRecord[] to SpotTaxResult[] |
| tax-calculator.ts | earn-income-engine.ts | runEarnIncomeEngine(allTransactions) line 140 | WIRED | Earn results to DB; earn lots merged into FIFO via synthetic buys |
| routes/engine.ts | tax-calculator.ts | runTaxCalculation(db) line 64 | WIRED | POST /api/engine/run calls full pipeline |
| routes/engine.ts | null-price-gate.ts | checkNullPrices(db) line 44 | WIRED | Route pre-flight; structured 422 with NullPriceError[] on failure |
| packages/backend/src/index.ts | routes/engine.ts | registerEngineRoutes(app) line 18 | WIRED | Routes mounted on Hono app |

---

### Requirements Coverage

| Requirement | Status | Evidence |
|-------------|--------|----------|
| SC1: 3 BTC scenario with Haltefrist boundary and correct taxable gain | SATISFIED | Scenario 1 exact numeric assertions with string toBe |
| SC2: Futures isolated from FIFO; separate bucket summaries with no cross-contamination | SATISFIED | FIFO engine processes only buy/sell; Scenario 3 confirms 3 distinct buckets |
| SC3: Freigrenze cliff at 999.99 / 1000.00 / 1000.01 boundaries | SATISFIED | Scenario 2 three sub-tests; greaterThan(freigrenze) in spot-tax-calculator.ts |
| SC4: NULL price gate with transaction identification in error message | SATISFIED | Scenario 4 verifies gate fires, tables stay empty, error identifies symbol and tradedAt |
| SC5: Stateless idempotent rerun produces identical summaries | SATISFIED | Scenario 5 row-count and string-value comparison; 5-run accumulation test |

---

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| packages/backend/src/engine/tax-calculator.ts | 301 | void taxable (unused variable suppression) | Info | Non-functional; no logic affected |

---

### Human Verification Required

**1. End-to-end API integration with real CSV data**
**Test:** Import real Bitget CSV transactions, run price enrichment, then POST /api/engine/run.
**Expected:** 200 response with summaries matching hand-calculated expected values.
**Why human:** Requires live database with real transaction data; golden master tests use in-memory fixtures only.

**2. computedAt field scope in idempotency criterion**
**Test:** Run engine twice on a real dataset and compare raw tax_summaries rows.
**Expected:** computed_at will differ between runs (audit timestamp); all seven tax-data columns will be string-identical.
**Why human:** The success criterion states byte-identical tax summaries. computed_at legitimately differs. The automated test correctly excludes this column.

---

### Gaps Summary

No gaps. All 5 success criteria are satisfied by implemented, substantive, and wired artifacts.
The entire test suite passes with 467 tests across 33 test files and 0 regressions.

Regarding criterion 5 (idempotency): the computed_at audit timestamp differs across runs by design.
This is correct behavior. The automated test compares all tax-relevant fields with string-exact equality.

---

_Verified: 2026-03-22T22:06:22Z_
_Verifier: Claude (gsd-verifier)_