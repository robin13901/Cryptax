# Phase 1: Foundation + CI/CD - Context

**Gathered:** 2026-03-21
**Status:** Ready for planning

<domain>
## Phase Boundary

Monorepo scaffold with npm workspaces, SQLite database with Drizzle ORM migrations, Hono API server skeleton, Decimal.js enforced as monetary arithmetic standard, Floating Lines background replacing Aurora, Vitest with coverage thresholds, and a GitHub Actions CI pipeline gating all future changes. This is pure foundation — no business logic, no data import, no tax calculation.

</domain>

<decisions>
## Implementation Decisions

### Floating Lines visual
- Color palette: Claude's choice — should complement the existing dark theme (#1a2332 background, #0070F2 blue accent, glassmorphism cards)
- Density & animation: Dense and active — tech-forward feel, not a calm ambient background
- Per-tab variation: Subtle variation across Dashboard, Transaktionen, and Steuerreport tabs (different seed/density per tab, same component)
- Performance: Smooth first — prioritize 60fps; if device struggles, reduce density automatically rather than dropping frames
- Replaces the existing Aurora WebGL component entirely

### CI/CD strictness
- Coverage thresholds: 90% on PR diff (Codecov) + 80% overall project minimum
- Merge gates: CI must pass (lint + test + build) AND Claude Code AI review must approve (blocking) — no merge without both
- PR extras: Both auto-labeler and release-drafter enabled
- Linting/formatting: Claude's choice based on ecosystem fit

### Monorepo conventions
- Package layout: Claude's choice (packages/* or apps/ + packages/ — whichever is cleanest)
- Existing dashboard/ code: Fresh start — rebuild the frontend scaffold clean, port useful components (GlassSurface, tab structure, KPI cards) as needed
- Shared package contents: Claude's choice on what belongs in shared vs local packages
- Import style between packages: Claude's choice (aliases vs workspace protocol)

### Database naming & schema style
- Naming convention: Claude's choice based on Drizzle ORM best practices
- Monetary columns: TEXT for all financial values (amounts, prices, fees, P&L) — Decimal.js serialization for zero precision loss
- Non-financial columns: Normal types (INTEGER for counts/IDs, appropriate types for timestamps)
- STRICT mode: Enabled on all SQLite tables — enforces column types at insert time
- Migration strategy: Claude's choice (generate vs push workflow)

### Claude's Discretion
- Floating Lines color palette selection
- Linting/formatting toolchain choice (ESLint+Prettier vs Biome)
- Monorepo package layout and import style
- Database column naming convention (snake_case vs camelCase)
- Migration workflow (Drizzle Kit generate vs push)
- Shared package boundary (what goes in shared vs stays local)

</decisions>

<specifics>
## Specific Ideas

- Existing dashboard/ has working components: Aurora.tsx (WebGL shader), GlassSurface.tsx (glassmorphism), App.tsx with 3 tabs (Dashboard, Transaktionen, Steuerreport), and KPI card grid — port what's useful
- Dark theme only: color-scheme: dark, --crypto-blue: #0070F2, --crypto-navy: #354A5F, --crypto-dark: #1a2332, --crypto-green: #5fdc8a, --crypto-red: #E50000
- Floating Lines source: reactbits.dev
- The user values strict correctness: STRICT tables + TEXT monetary columns + blocking AI review + 90% diff coverage

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 01-foundation-ci-cd*
*Context gathered: 2026-03-21*
