---
phase: 01-foundation-ci-cd
plan: "01"
subsystem: infra
tags: [npm-workspaces, typescript, biome, vite, react, monorepo]

# Dependency graph
requires: []
provides:
  - npm workspaces monorepo with packages/shared, packages/backend, packages/frontend
  - TypeScript project references (composite builds) across all three packages
  - Biome 2.4.8 lint + format config with recommended rules
  - Ported Cryptax UI (tabs, KPI grid, GlassSurface component, Aurora placeholder)
  - Working `npm install`, `tsc -b`, and `biome check .` pipeline
affects:
  - 01-02 (backend scaffold builds on packages/backend)
  - 01-03 (CI/CD pipeline lints and builds this monorepo)
  - 01-04 (database setup adds to packages/backend)
  - 01-05 (Aurora WebGL replaces placeholder in packages/frontend)
  - All future phases (every package depends on this structure)

# Tech tracking
tech-stack:
  added:
    - "@biomejs/biome@2.4.8 — lint + format"
    - "concurrently@9.x — parallel dev server runner"
    - "typescript@~5.9.3 — root dev dep"
    - "react@19.2.4 + react-dom — frontend UI"
    - "vite@8.0.0 + @vitejs/plugin-react@6.0.0 — frontend bundler"
    - "motion@12.36.0 — animation library"
    - "recharts@3.8.0 — chart library (ready for future use)"
    - "tsx@4.x — TypeScript runner for backend dev"
  patterns:
    - "Monorepo: npm workspaces with packages/* glob"
    - "TypeScript: composite project references (tsc -b at root builds all)"
    - "Module resolution: Bundler for frontend/shared, NodeNext for backend"
    - "Biome: single source of truth for lint+format (replaces ESLint+Prettier)"

key-files:
  created:
    - package.json — root workspace config
    - tsconfig.json — root project references
    - biome.json — lint + format config
    - packages/shared/package.json — @cryptax/shared definition
    - packages/shared/src/index.ts — barrel file
    - packages/backend/package.json — @cryptax/backend definition
    - packages/backend/src/index.ts — placeholder entry
    - packages/frontend/package.json — @cryptax/frontend definition
    - packages/frontend/vite.config.ts — Vite config (port 5174)
    - packages/frontend/src/App.tsx — tab UI with KPI grid
    - packages/frontend/src/components/GlassSurface/GlassSurface.tsx — glass card component
    - packages/frontend/src/components/Aurora/Aurora.tsx — placeholder (CSS gradient)
  modified:
    - .gitignore — added node_modules, dist, coverage, *.db, .env patterns

key-decisions:
  - "Biome 2.4.8 (not 2.0.0): installed version was 2.4.8, schema and files.includes syntax updated accordingly"
  - "Aurora placeholder (CSS gradient) instead of full WebGL — ogl dependency deferred to 01-05 to keep scaffold minimal"
  - "noNonNullAssertion suppressed with biome-ignore comment in main.tsx — root element guaranteed by index.html"
  - "button type='button' added to nav pills — satisfies a11y/useButtonType rule correctly"

patterns-established:
  - "Biome ignore: use biome-ignore lint/rule/name: reason comment for justified suppressions"
  - "Workspace deps: @cryptax/shared referenced as '*' in dependent packages"
  - "TypeScript composite: all packages use composite:true for incremental builds"

# Metrics
duration: 8min
completed: 2026-03-21
---

# Phase 1 Plan 01: Monorepo Scaffold Summary

**npm workspaces monorepo with @cryptax/shared, @cryptax/backend, @cryptax/frontend, TypeScript project references, Biome 2.4.8 lint/format, and ported Cryptax dashboard UI**

## Performance

- **Duration:** 8 min
- **Started:** 2026-03-21T16:05:55Z
- **Completed:** 2026-03-21T16:14:01Z
- **Tasks:** 1
- **Files modified:** 29

## Accomplishments

- Full monorepo scaffold: 3 packages under `packages/*`, npm workspaces, `npm install` succeeds
- TypeScript project references configured — `tsc -b` at root compiles all packages with zero errors
- Biome 2.4.8 configured with recommended rules, single-quote JS, 100-char line width — `biome check .` passes
- Ported Cryptax dashboard UI (tabs, KPI grid, GlassSurface, Aurora placeholder) into packages/frontend

## Task Commits

Each task was committed atomically:

1. **Task 1: Create monorepo root and package scaffolds** - `177102f` (feat)

**Plan metadata:** (see final commit below)

## Files Created/Modified

- `package.json` — root workspace config with scripts (dev, build, lint, format, db:*)
- `tsconfig.json` — root project references (shared, backend, frontend)
- `biome.json` — Biome 2.4.8 config with recommended rules + JS formatter settings
- `.gitignore` — extended with node_modules, dist, coverage, *.db, .env
- `packages/shared/package.json` — @cryptax/shared with ESM exports
- `packages/shared/tsconfig.json` — composite, Bundler resolution
- `packages/shared/src/index.ts` — empty barrel with comment
- `packages/backend/package.json` — @cryptax/backend with tsx dev, @cryptax/shared dep
- `packages/backend/tsconfig.json` — composite, NodeNext resolution, references shared
- `packages/backend/src/index.ts` — console.log placeholder
- `packages/frontend/package.json` — @cryptax/frontend with React 19, Vite 8, motion, recharts
- `packages/frontend/tsconfig.json` — references app + node configs
- `packages/frontend/tsconfig.app.json` — composite, Bundler resolution, jsx react-jsx
- `packages/frontend/tsconfig.node.json` — composite, Bundler resolution, for vite.config.ts
- `packages/frontend/vite.config.ts` — react plugin, port 5174
- `packages/frontend/index.html` — HTML template (lang=de, title Cryptax)
- `packages/frontend/src/main.tsx` — createRoot entry point
- `packages/frontend/src/index.css` — CSS variables, dark theme
- `packages/frontend/src/App.tsx` — 3-tab nav, KPI grid, AnimatePresence transitions
- `packages/frontend/src/App.css` — full UI styles
- `packages/frontend/src/vite-env.d.ts` — vite/client types ref
- `packages/frontend/src/components/GlassSurface/GlassSurface.tsx` — glass morphism card
- `packages/frontend/src/components/GlassSurface/GlassSurface.css` — backdrop-filter styles
- `packages/frontend/src/components/Aurora/Aurora.tsx` — CSS gradient placeholder
- `packages/frontend/src/components/Aurora/Aurora.css` — placeholder styles
- `packages/frontend/public/vite.svg` — Cryptax favicon

## Decisions Made

- **Biome 2.4.8 schema**: Plan specified `2.0.0` but installed version is `2.4.8`. Updated schema URL and `files.includes` syntax (Biome 2.x uses negation patterns, not `files.ignore`).
- **Aurora placeholder**: Plan called for a minimal Aurora placeholder. Implemented as CSS gradient div — the full WebGL/ogl implementation is deferred to 01-05 as planned.
- **noNonNullAssertion in main.tsx**: Suppressed with `biome-ignore` comment since `#root` is guaranteed by `index.html`. This is the idiomatic React + Vite pattern.
- **Button type attribute**: Added `type="button"` to nav pill buttons to satisfy Biome's `a11y/useButtonType` rule correctly rather than suppressing it.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Biome schema version mismatch and `files.ignore` API change**

- **Found during:** Task 1 (biome check verification)
- **Issue:** Plan specified Biome schema `2.0.0` but installed package is `2.4.8`. Additionally, Biome 2.x changed `files.ignore` to `files.includes` with negation patterns, and folder ignore patterns no longer need `/**` suffix.
- **Fix:** Updated `$schema` to `2.4.8`, changed `files.ignore` to `files.includes` with `!pattern` negation, removed trailing `/**` from folder patterns.
- **Files modified:** `biome.json`
- **Verification:** `biome check .` exits with zero errors
- **Committed in:** `177102f` (part of task commit)

**2. [Rule 2 - Missing Critical] Added `type="button"` to nav pill buttons**

- **Found during:** Task 1 (biome check verification)
- **Issue:** Buttons without explicit `type` default to `type="submit"` which can cause unintended form submission — Biome `a11y/useButtonType` catches this correctly.
- **Fix:** Added `type="button"` to the tabs.map button element.
- **Files modified:** `packages/frontend/src/App.tsx`
- **Verification:** `biome check .` passes
- **Committed in:** `177102f` (part of task commit)

---

**Total deviations:** 2 auto-fixed (1 bug, 1 missing critical)
**Impact on plan:** Both fixes necessary for correct Biome config and proper HTML semantics. No scope creep.

## Issues Encountered

- Biome `biome check --write` auto-fixed 7 of the 9 issues (formatting, import ordering). Two required manual fixes (schema version, button type).

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Monorepo foundation complete — all subsequent Phase 1 plans can build on this structure
- `npm install` at root installs workspace deps for all three packages
- `tsc -b` compiles all packages (shared, backend, frontend)
- `biome check .` lints all packages with zero errors
- Frontend renders on `npm run dev -w packages/frontend` at localhost:5174
- Plan 01-02 (Hono backend + SQLite) can proceed immediately

---
*Phase: 01-foundation-ci-cd*
*Completed: 2026-03-21*
