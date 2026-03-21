# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-03-21)

**Core value:** Accurate German crypto tax calculation with FIFO-based holding period tracking, producing a Finanzamt-ready Steuerreport.
**Current focus:** Phase 1 — Foundation + CI/CD

## Current Position

Phase: 1 of 7 (Foundation + CI/CD)
Plan: 4 of 7 in current phase (01-05 complete)
Status: In progress
Last activity: 2026-03-21 — Completed 01-05-PLAN.md (FloatingLines WebGL background, Aurora removed)

Progress: [████░░░░░░] 8% (4/50 plans)

## Performance Metrics

**Velocity:**
- Total plans completed: 4
- Average duration: 7 min
- Total execution time: 29 min

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 01-foundation-ci-cd | 4/7 | 29 min | ~7 min |

**Recent Trend:**
- Last 5 plans: 6 min
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

### Pending Todos

None yet.

### Blockers/Concerns

- Phase 4 research flag: Complex FIFO edge cases and §22 vs §23 earn income classification — consider `/gsd:research-phase` before Phase 4 planning
- Phase 7 research flag: ccxt Bitget v2 deep history pagination is untested — consider `/gsd:research-phase` before Phase 7 planning
- German tax law: Haltefrist exact day count (≥365 interpretation used) and 10-year staking Haltefrist (1-year used per mainstream tools) — Steuerberater review recommended before relying on output

## Session Continuity

Last session: 2026-03-21T16:26:48Z
Stopped at: Completed 01-05-PLAN.md — FloatingLines WebGL background (Three.js), Aurora removed
Resume file: None
