# Phase 4: FIFO Engine + Tax Calculation - Context

**Gathered:** 2026-03-22
**Status:** Ready for planning

<domain>
## Phase Boundary

Three-bucket German tax engine producing correct, Finanzamt-compliant tax summaries for every imported year. FIFO lot tracking per coin, Haltefrist applied correctly, three tax buckets kept strictly separate (§23 Spot, §20 Futures, §22 Earn), and Freigrenze implemented as a cliff. Engine is stateless and re-runnable.

</domain>

<decisions>
## Implementation Decisions

### Edge case handling
- **Missing buy lots (sell without matching buy):** Reject the sell and flag it as an error requiring manual review — do not create synthetic zero-cost lots
- **Invalid/unprocessable transactions:** Skip the problematic transaction, continue processing remaining transactions, report all skipped items at the end with reasons
- **Dust amounts:** Process every amount identically regardless of size — no special dust thresholds, a 0.0001 EUR transaction gets a lot like any other
- **Same-timestamp ordering:** Claude's discretion — choose the most correct approach for German tax law (likely buys-before-sells tiebreak)

### Haltefrist interpretation
- **Day counting:** >= 366 days (safest interpretation) — bought Jan 1 2024, tax-free from Jan 2 2025 onward
- **Timezone for day boundaries:** Claude's discretion — decide based on standard German tax software behavior (likely Europe/Berlin for consistency with existing timestamp handling)
- **Staking Haltefrist:** 1-year for everything — follow the 2022 BMF letter, no 10-year extended Haltefrist for staked coins
- **Partial lot splits:** Remaining sub-lot inherits the original buy date — Haltefrist tracks from the original acquisition, not the split event

### Fee treatment
- **Spot trading fees:** Reduce the gain (Werbungskosten) — fees added to cost basis on buy, subtracted from proceeds on sell
- **Non-EUR fees:** Convert to EUR at the same timestamp as the trade using the trade's EUR price
- **Buy-side fee lot sizing:** Claude's discretion — decide whether lot is created at gross or net amount based on what's most accurate
- **Futures fees:** Claude's discretion — decide based on Abgeltungssteuer (§20) rules

### Engine run behavior
- **Re-run semantics:** Always truncate derived tables and recompute from scratch — fully stateless, no incremental
- **Missing price gate:** Hard gate with diagnostics — engine refuses to run if ANY transaction has NULL EUR price, error identifies exactly which transactions are missing prices
- **API result structure:** Claude's discretion — structure for cleanest downstream use by Dashboard (Phase 5)
- **Cross-year processing:** Always process all available years in one run, chronological order — lots from 2024 carry forward to 2025 disposals automatically

</decisions>

<specifics>
## Specific Ideas

- Freigrenze is a cliff: 999.99 EUR = tax-free, 1000.01 EUR = full amount taxable (not a deduction)
- Three buckets must never cross-contaminate: futures P&L stays in §20, spot gains in §23, earn income in §22
- Engine must be idempotent: truncate + rerun on same data = byte-identical results
- Haltefrist >= 366 days is the conservative/safe interpretation — user prefers safety over aggressiveness

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 04-fifo-engine-tax-calculation*
*Context gathered: 2026-03-22*
