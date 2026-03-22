---
phase: 01-foundation-ci-cd
plan: 05
subsystem: ui
tags: [three.js, webgl, react, animation, vite, typescript, biome]

# Dependency graph
requires:
  - phase: 01-01
    provides: monorepo scaffold with Aurora placeholder component in packages/frontend
provides:
  - FloatingLines WebGL background component using Three.js with Cryptax color palette
  - Aurora component fully removed (files, imports, CSS class)
  - App.tsx renders FloatingLines as fixed background behind all content
affects:
  - future ui phases: FloatingLines is the established background pattern

# Tech tracking
tech-stack:
  added: [three@0.183.2, "@types/three@0.183.1"]
  patterns: [Three.js orthographic camera for 2D canvas overlay, ResizeObserver for responsive WebGL canvas]

key-files:
  created:
    - packages/frontend/src/components/FloatingLines/FloatingLines.tsx
    - packages/frontend/src/components/FloatingLines/FloatingLines.css
  modified:
    - packages/frontend/src/App.tsx
    - packages/frontend/src/App.css
    - packages/frontend/src/main.tsx
    - packages/frontend/package.json

key-decisions:
  - "FloatingLines implemented manually with Three.js orthographic camera (reactbits CLI not reliable in this env)"
  - "mixBlendMode prop applied on canvas element JSX only (not inside useEffect), removed from effect deps per Biome correctness rule"
  - "attributes.position used (literal key access) per Biome complexity rule over attributes['position']"

patterns-established:
  - "WebGL canvas: position fixed, inset 0, z-index 0; content layer z-index 1"
  - "ResizeObserver pattern for responsive Three.js renderer sizing"

# Metrics
duration: 12min
completed: 2026-03-21
---

# Phase 1 Plan 05: FloatingLines WebGL Background Summary

**Three.js animated floating lines background replacing Aurora placeholder, using Cryptax blue/navy/green palette across all three tabs**

## Performance

- **Duration:** 12 min
- **Started:** 2026-03-21T16:17:47Z
- **Completed:** 2026-03-21T16:29:00Z
- **Tasks:** 3 of 3 complete (human verify approved)
- **Files modified:** 6

## Accomplishments
- Installed Three.js and @types/three in packages/frontend
- FloatingLines.tsx: WebGL canvas with 35 animated sine-wave lines, Cryptax color palette (blues, navy, green), mixBlendMode screen
- Aurora component completely removed (files deleted, imports removed, CSS class replaced)
- All TypeScript and Biome checks pass cleanly

## Task Commits

Each task was committed atomically:

1. **Task 1: Install Three.js and add FloatingLines component** - `cb8d500` (feat)
2. **Task 2: Replace Aurora with FloatingLines in App.tsx** - `6c251c2` (feat)
3. **Task 3: Human verify checkpoint** - approved by user

## Files Created/Modified
- `packages/frontend/src/components/FloatingLines/FloatingLines.tsx` - Three.js WebGL animated lines component
- `packages/frontend/src/components/FloatingLines/FloatingLines.css` - Full-size canvas positioning styles
- `packages/frontend/src/App.tsx` - FloatingLines replaces Aurora in background layer
- `packages/frontend/src/App.css` - .floating-lines-bg replaces .aurora-bg
- `packages/frontend/src/main.tsx` - Updated comment
- `packages/frontend/package.json` - Added three and @types/three

## Decisions Made
- Implemented FloatingLines manually with Three.js rather than using reactbits CLI (CLI tooling not reliable in this environment)
- Used orthographic camera (-1 to 1 on both axes) for simple 2D canvas coordinate system
- `mixBlendMode` prop applied only on the canvas JSX element, not inside useEffect (correct per React hooks rules)
- Used `attributes.position` literal key access per Biome complexity lint rule

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed lines.indexOf() reference bug**
- **Found during:** Task 1 (initial FloatingLines implementation)
- **Issue:** First draft used `lines.indexOf({ mesh, data })` inside animation loop — always returns -1 due to object reference inequality
- **Fix:** Stored `yBase` in each LineData object and accessed by index `lineDataArr[i]` with parallel arrays
- **Files modified:** packages/frontend/src/components/FloatingLines/FloatingLines.tsx
- **Verification:** TypeScript compiles cleanly
- **Committed in:** cb8d500

**2. [Rule 2 - Missing Critical] Removed extra useEffect dep (mixBlendMode)**
- **Found during:** Task 2 (Biome check)
- **Issue:** Biome correctness/useExhaustiveDependencies flagged mixBlendMode as unnecessary dep since it's not used inside the effect
- **Fix:** Removed mixBlendMode from the useEffect dependency array
- **Files modified:** packages/frontend/src/components/FloatingLines/FloatingLines.tsx
- **Verification:** Biome passes cleanly
- **Committed in:** 6c251c2

---

**Total deviations:** 2 auto-fixed (1 bug, 1 lint correctness)
**Impact on plan:** Both fixes necessary for correctness. No scope creep.

## Issues Encountered
- Biome `check --write` only applies safe fixes by default; unsafe fixes (literal key, remove dep) had to be applied manually. Both were correct and safe to apply.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- FloatingLines background visually verified and approved
- Phase 01-06 and beyond can build on this visual foundation
- Aurora is fully removed — no references remain in codebase

---
*Phase: 01-foundation-ci-cd*
*Completed: 2026-03-21*
