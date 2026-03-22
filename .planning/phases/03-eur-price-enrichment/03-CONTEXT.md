# Phase 3: EUR Price Enrichment - Context

**Gathered:** 2026-03-22
**Status:** Ready for planning

<domain>
## Phase Boundary

Every imported transaction gets a EUR price resolved at its trade timestamp. Bitget public candle API is the primary source with CoinGecko as fallback. EUR prices are stored permanently on the transactions table. Europe/Berlin timezone handling for all timestamp conversions.

</domain>

<decisions>
## Implementation Decisions

### Unresolved price handling
- Warnings + hard blocker: show warning banners on relevant views AND block tax calculation until all prices are resolved
- Unresolved prices grouped by failure reason: 'no Bitget pair', 'CoinGecko miss', 'API error' — so user understands WHY each price failed
- Failed lookups auto-retry on subsequent enrichment runs (no strike limit)
- No exceptions for dust/small amounts — every transaction must have a resolved EUR price
- Unresolved prices visible in both places: badge on transaction list rows AND a dedicated 'Price Status' view for bulk resolution
- Progress bar showing 'X of Y transactions resolved' after enrichment completes

### Enrichment trigger & flow
- Auto-trigger after CSV import completes, plus manual re-trigger button for retries
- Incremental only: re-trigger resolves missing/unresolved prices, does not re-fetch already-resolved ones
- Live progress bar during enrichment: 'Resolving 142/500 — BTC/EUR from Bitget...' with current item indicator
- EUR price stored directly on the transactions table (permanent column, not a separate cache table) — this is persistent data, not a disposable cache

### Price accuracy & source preference
- Prefer 1-minute candle matching trade timestamp; fall back to 5-minute candle if 1-minute unavailable
- Bitget always takes priority over CoinGecko — CoinGecko only when Bitget has no data at all
- For spot orders where the CSV already contains the actual fill price (EUR or EUR-convertible pair): use the fill price directly from CSV — no API call needed
- USDT fallback path (COIN/USDT x USDT/EUR): use same-minute USDT/EUR rate, not daily average

### Manual price override
- Users can manually enter EUR prices, but only for unresolved transactions — cannot override API-resolved prices
- Manual entries tagged with 'manual' source so they're visually distinguishable from API-resolved prices
- Re-running enrichment overwrites manual entries if the API now returns a price — manual entries are not permanent locks

### Claude's Discretion
- Warning banner placement across tabs (context-dependent approach)
- Price source display (visible per-transaction or only in status view)
- UI for manual price entry (inline edit vs. detail dialog)
- Blocking vs. background enrichment UX pattern
- Exact progress bar design and animation

</decisions>

<specifics>
## Specific Ideas

- "Prices get fetched on import and this enriched data gets stored to the database — it's persisting, not caching"
- EUR price is a first-class column on the transactions table, not a linked cache table
- The user wants to understand WHY a price is missing (grouped failure reasons), not just that it's missing

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 03-eur-price-enrichment*
*Context gathered: 2026-03-22*
