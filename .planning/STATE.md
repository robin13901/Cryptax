# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-03-21)

**Core value:** Accurate German crypto tax calculation with FIFO-based holding period tracking, producing a Finanzamt-ready Steuerreport.
**Current focus:** Phase 2 — Transaction Ingestion (Phase 1 complete)

## Current Position

Phase: 2 of 7 (CSV Import Pipeline) — In progress
Plan: 7 of 8 in current phase
Status: In progress — Wave 1+2+3 complete, 02-07 complete
Last activity: 2026-03-21 — Completed 02-07-PLAN.md (format detection, type map, normalization, 210 tests)

Progress: [█████████░] 30% (15/50 plans complete)

## Performance Metrics

**Velocity:**
- Total plans completed: 15
- Average duration: ~5 min
- Total execution time: ~82 min

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 01-foundation-ci-cd | 7/7 COMPLETE | ~44 min | ~6 min |
| 02-csv-import-pipeline | 7/8 | ~38 min | ~5 min |

**Recent Trend:**
- Last 5 plans: 5 min
- Trend: consistent

*Updated after each plan completion*

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting current work:

- Roadmap: Testing distributed per-phase (not a separate phase) — TEST-* requirements assigned to the phase where the code lives
- Roadmap: CI/CD merged into Phase 1 so all subsequent phases benefit from the pipeline
- Roadmap: Security merged with Exchange API into Phase 7 (natural dependency — credentials needed for API access)
- Architecture: Decimal.js + TEXT storage rule must be established in Phase 1, not retrofitted later (critical correctness risk)
- Architecture: FIFO engine is stateless re-runnable — truncate derived tables and recompute from transactions on every run
- 01-01: Biome 2.4.8 uses `files.includes` with negation patterns (not `files.ignore`) — update any future Biome configs accordingly
- 01-01: Aurora WebGL (ogl) deferred to 01-05 — placeholder CSS gradient used in scaffold
- 01-01: All nav buttons must have explicit `type="button"` to satisfy Biome a11y rules
- 01-02: Route registration pattern: each feature exports `registerXxxRoutes(app: Hono)` — index.ts only wires middleware and route modules
- 01-02: Biome requires semicolons — apply `npx biome format --write` after writing TypeScript files
- 01-04: MoneyString = string alias used for all monetary fields — explicit intent in domain interfaces
- 01-04: Decimal.js configured globally (precision 36, ROUND_HALF_UP) in money.ts at module load
- 01-04: toDecimal() handles null/undefined/empty → ZERO; fromDecimal() uses .toFixed() for no exponential notation
- 01-04: TAX_CONSTANTS.SPOT_FREIGRENZE_EUR = '1000' (2024+ value); EARN_FREIGRENZE_EUR = '256'
- 01-05: FloatingLines implemented with Three.js orthographic camera — manual implementation, not reactbits CLI
- 01-05: mixBlendMode prop on FloatingLines applied in JSX only (not inside useEffect) — correct per React hooks exhaustive-deps rule
- 01-05: Aurora component fully removed — no files, imports, or CSS classes remain
- 01-03: drizzle-kit generate does NOT add STRICT — manual edit of migration SQL required after each generate run (critical workflow step)
- 01-03: Migration file renamed 0000_strange_runaways.sql → 0000_initial.sql; journal tag updated to match
- 01-03: WAL pragma runs in client.ts at app startup — migration-created DB starts in delete mode until first client connection
- 01-03: DB_PATH env var allows test isolation (set DB_PATH=:memory: or temp file in tests)
- 01-03: All monetary Drizzle columns use text() — matches MoneyString = string convention from 01-04
- 01-06: Vitest 3 used (not v4) — Node v23 is outside Vitest 4 engine range (^20 || ^22 || >=24)
- 01-06: Coverage thresholds omitted from vitest.config.ts — 90% enforced by codecov.yml patch threshold only (overall codebase not yet at 90%)
- 01-06: fromDecimal() used in test assertions for small decimals — Decimal.toString() returns 1e-8 form for 0.00000001
- 01-06: Inline test.projects pattern used (not vitest.workspace.ts) per Vitest v3 workspace API

- 01-07: codecov/codecov-action@v4 with fail_ci_if_error: false — CI does not hard-fail if Codecov is unreachable
- 01-07: actions/labeler@v5 on pull_request_target — write permissions needed for labeling fork PRs
- 01-07: Build job uses needs: [lint, test] — prevents broken builds from running unnecessarily
- 01-07: Claude review prompt includes FIFO correctness check in addition to Decimal.js/SQL rules
- 01-07: ANTHROPIC_API_KEY deferred — company proxy prevents direct API access; claude-review.yml is in place and activates once key is added

- 02-01: importBatches defined before transactions in schema.ts — Drizzle requires FK target tables declared before referencing tables
- 02-01: Migration auto-name renamed (0001_overconfident_banshee → 0001_import_batches); journal tag updated — same rename workflow as 0000_initial
- 02-01: Biome organizeImports sorts export blocks alphabetically by source path — import.js before tax.js before transaction.js in barrel files

- 02-04: Average Price (not Price column) used for price field — Price is the limit order entry price; Average Price is the actual fill price
- 02-04: Direction column mapped to rawType (not Type column) — Type in spot order history is Limit/Market; Direction is Buy/Sell
- 02-04: Symbol derived as baseAsset + '/' + quoteAsset — Trading pair column lacks slash separator (e.g. 'BTCEUR' vs 'BTC/EUR')
- 02-04: Biome useLiteralKeys — single-word normalised map keys use dot notation; multi-word keys (e.g. 'order id') stay bracket notation

- 02-05: Average Price stored as empty string (not null) for Market futures orders — avoids null-checks in downstream normalisation
- 02-05: Map-based normalised column lookup (Map not Record) used for 'realized p/l', 'order source' — avoids Biome useLiteralKeys on keys with special chars/spaces
- 02-05: parseFuturesOrder get() helper trims values — safe even when csv-parse trim:true already ran upstream

- 02-06: earn Reference column requires no tab stripping — csv-parse trim: true is a no-op on already-clean fields; normaliseRow() handles cased and lowercased keys uniformly
- 02-06: ParsedEarn keeps coin (staked asset) and interestCoin (received asset) as separate fields — both needed for tax classification
- 02-06: Biome organizeImports assist rule not applied by `--write` flag — must fix import order manually (type imports before value imports from same module)

- 02-02: CANONICAL_DISPLAY map for error field names — when required field key absent from row, returns Bitget casing ('Date'/'Coin'/'Type'/'Amount') not lowercase fallback; 'order' stays lowercase to match actual header
- 02-02: First-missing-field early exit per row — reports one error per invalid row, skips remaining fields for that row
- 02-02: Tab-stripping on orderId as defensive guard even though csv-parse trim handles it

- 02-07: checksum uses JSON.stringify(row) — safer than Object.values().join('|') for values containing pipe characters
- 02-07: normalizeToTransaction receives raw csv-parse rows (Record<string,string>), not typed parser objects — keeps normalizer decoupled from parsers
- 02-07: price and totalValue default to '0' (not null) — transactions table has NOT NULL on both columns; Phase 3+ will enrich with EUR price
- 02-07: deriveSide: close_short -> 'buy', close_long -> 'sell' — closing a short = buying back the contract

### Pending Todos

None yet.

### Blockers/Concerns

- Phase 4 research flag: Complex FIFO edge cases and §22 vs §23 earn income classification — consider `/gsd:research-phase` before Phase 4 planning
- Phase 7 research flag: ccxt Bitget v2 deep history pagination is untested — consider `/gsd:research-phase` before Phase 7 planning
- German tax law: Haltefrist exact day count (>=365 interpretation used) and 10-year staking Haltefrist (1-year used per mainstream tools) — Steuerberater review recommended before relying on output
- Migration workflow: After any future `npm run db:generate`, developer MUST manually add STRICT to new CREATE TABLE statements before running `npm run db:migrate`

## Session Continuity

Last session: 2026-03-21T21:06:29Z
Stopped at: 02-07-PLAN.md complete — format detection, canonical type map, normalization, barrel index (210 tests, 12 min)
Resume file: None
