---
phase: 01-foundation-ci-cd
plan: 06
subsystem: testing
tags: [vitest, coverage, v8, lcov, codecov, jsdom, testing-library, jest-dom]

# Dependency graph
requires:
  - phase: 01-02
    provides: Hono health endpoint (registerHealthRoutes) to write first backend test against
  - phase: 01-04
    provides: Decimal.js utilities (money.ts, constants/index.ts) to test monetary correctness

provides:
  - Vitest v3 workspace config with three projects (backend/shared=node, frontend=jsdom)
  - v8 coverage with text/json/lcov/html reporters at ./coverage/
  - lcov.info for Codecov CI integration
  - codecov.yml with 90% patch and project thresholds
  - 31 passing tests (2 backend, 24 shared/decimal, 5 shared/constants)
  - npm test / npm run test:run / npm run test:coverage scripts

affects:
  - all future phases that add tests (testing patterns established here)
  - 01-07 CI/CD pipeline (consumes lcov.info for Codecov upload step)

# Tech tracking
tech-stack:
  added:
    - vitest@3.2.4
    - "@vitest/coverage-v8@3.2.4"
    - jsdom (frontend testing)
    - "@testing-library/react"
    - "@testing-library/user-event"
    - "@testing-library/jest-dom"

  patterns:
    - Vitest inline workspace via test.projects (not vitest.workspace.ts file)
    - Backend/shared tests use node environment
    - Frontend tests use jsdom environment with @testing-library/jest-dom setup
    - Test files co-located with source (*.test.ts beside source file)
    - Hono app.request() for in-process backend endpoint testing (no HTTP server)
    - fromDecimal() used in assertions (not Decimal.toString()) to avoid scientific notation

key-files:
  created:
    - vitest.config.ts
    - codecov.yml
    - packages/frontend/src/test/setup.ts
    - packages/backend/src/routes/health.test.ts
    - packages/shared/src/decimal/money.test.ts
    - packages/shared/src/constants/index.test.ts
  modified:
    - package.json (added test:run, test:coverage scripts; vitest/coverage-v8 devDeps)
    - packages/frontend/package.json (added jsdom and @testing-library/* devDeps)

key-decisions:
  - "Vitest 3 used (not v4) — Node v23 is outside v4 engine range (^20, ^22, >=24)"
  - "Coverage thresholds omitted from vitest.config.ts — 90% enforced by codecov.yml patch threshold only (codebase not yet at 90% overall; threshold will be meaningless until more phases complete)"
  - "fromDecimal() used for small decimal assertions — Decimal.toString() returns 1e-8 for 0.00000001"
  - "Inline test.projects pattern used (not vitest.workspace.ts) per Vitest v3 workspace API"

patterns-established:
  - "Test pattern: import { describe, expect, it } from 'vitest' — always named imports"
  - "Backend tests: create fresh Hono app, register routes, call app.request() — no supertest needed"
  - "Monetary assertion: use fromDecimal() or addMoney() etc. rather than raw Decimal.toString()"
  - "Biome organizeImports: run biome check --write to fix import order"

# Metrics
duration: 6min
completed: 2026-03-21
---

# Phase 1 Plan 06: Vitest Workspace and Initial Tests Summary

**Vitest v3 workspace with node/jsdom per-project environments, v8 lcov coverage, codecov.yml 90% patch gate, and 31 passing tests for health endpoint and Decimal.js utilities**

## Performance

- **Duration:** 6 min
- **Started:** 2026-03-21T16:45:13Z
- **Completed:** 2026-03-21T16:51:22Z
- **Tasks:** 2
- **Files modified:** 8

## Accomplishments

- Vitest 3 workspace configured with three separate projects: backend (node), shared (node), frontend (jsdom)
- Coverage via v8 provider generates text, JSON, lcov, and HTML reports to `./coverage/`; `lcov.info` ready for Codecov
- `codecov.yml` enforces 90% patch and project thresholds for PR-level gating
- 31 tests written and passing: 2 backend health endpoint tests, 24 Decimal.js utility tests, 5 TAX_CONSTANTS tests
- `npm test`, `npm run test:run`, and `npm run test:coverage` all work from repo root

## Task Commits

Each task was committed atomically:

1. **Task 1: Configure Vitest workspace with coverage and Codecov** - `599bbd9` (chore)
2. **Task 2: Write initial tests for health endpoint and decimal utilities** - `38cf198` (test)

**Plan metadata:** (see final commit below)

## Files Created/Modified

- `vitest.config.ts` - Root Vitest workspace config with 3 projects and v8 coverage
- `codecov.yml` - 90% patch threshold + project target, text/diff layout
- `packages/frontend/src/test/setup.ts` - Imports @testing-library/jest-dom/vitest for jsdom matchers
- `packages/backend/src/routes/health.test.ts` - 2 tests for GET /api/health using app.request()
- `packages/shared/src/decimal/money.test.ts` - 24 tests covering all money.ts exports
- `packages/shared/src/constants/index.test.ts` - 5 tests for all TAX_CONSTANTS fields
- `package.json` - Added test:run and test:coverage scripts; vitest + @vitest/coverage-v8 devDeps
- `packages/frontend/package.json` - Added jsdom and @testing-library/* devDeps

## Decisions Made

- **Vitest 3 over Vitest 4:** Node v23 is outside Vitest 4's engine range (`^20 || ^22 || >=24`). Installed v3.2.4 which supports Node 18+.
- **No coverage thresholds in vitest.config.ts:** The overall codebase is not at 90% yet (only 3 files tested). Global Vitest thresholds would fail immediately. The 90% enforcement is delegated to `codecov.yml` which gates on PR diff/patch coverage — exactly the right place for incremental enforcement.
- **fromDecimal() in small decimal assertions:** `new Decimal('0.00000001').toString()` returns `'1e-8'` (Decimal's internal toString uses exponential form). The test was corrected to use `fromDecimal()` which calls `.toFixed()` — matching the actual behavior documented in 01-04.
- **Inline test.projects, not vitest.workspace.ts:** The Vitest v3 inline workspace API (`test.projects` inside `defineConfig`) avoids a separate workspace file and is cleaner for a monorepo where the root config also defines coverage.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed toDecimal decimal string assertion using wrong toString method**

- **Found during:** Task 2 (writing money.test.ts)
- **Issue:** `toDecimal('0.00000001').toString()` returns `'1e-8'` — Decimal.js uses exponential notation for small numbers in `.toString()`. Test as written in plan would fail.
- **Fix:** Changed assertion to `fromDecimal(toDecimal('0.00000001'))` which calls `.toFixed()` — the same path used in production code for DB storage.
- **Files modified:** `packages/shared/src/decimal/money.test.ts`
- **Verification:** 24/24 money tests pass
- **Committed in:** `38cf198` (Task 2 commit)

**2. [Rule 3 - Blocking] vitest@^3.2.4 and @vitest/coverage-v8@^4.1.0 version mismatch**

- **Found during:** Task 1 (dependency install)
- **Issue:** package.json had pre-existing `vitest@^3.2.4` but the plan instructed `npm install -D vitest @vitest/coverage-v8` which resolved to v4.x — peer dependency conflict.
- **Fix:** Installed `vitest@3 @vitest/coverage-v8@3` explicitly to align versions on v3.x (Node v23 compatibility).
- **Files modified:** `package.json`, `package-lock.json`
- **Verification:** `npm run test:run` exits successfully after fix
- **Committed in:** `599bbd9` (Task 1 commit)

---

**Total deviations:** 2 auto-fixed (1 bug in test assertion, 1 blocking dependency version conflict)
**Impact on plan:** Both fixes necessary for correctness and functionality. No scope creep.

## Issues Encountered

- Biome `organizeImports` flagged import order in health.test.ts and money.test.ts — resolved with `npx biome check --write`.

## User Setup Required

None - no external service configuration required for test infrastructure itself. Codecov integration will be wired in 01-07 (CI/CD pipeline plan).

## Next Phase Readiness

- Test infrastructure complete and ready for 01-07 (GitHub Actions CI pipeline that uploads lcov.info to Codecov)
- Pattern established: all future plans can add `*.test.ts` files in any package and `npm test` will pick them up automatically
- Frontend jsdom setup ready for component tests when UI development begins in Phase 2

---
*Phase: 01-foundation-ci-cd*
*Completed: 2026-03-21*
