---
phase: 08-ui-redesign-sidebar-layout
plan: 02
subsystem: ui
tags: [react, sidebar, layout, css, app-shell, localstorage, framer-motion]

# Dependency graph
requires:
  - phase: 08-01
    provides: Sidebar component with TabId type, CSS variables for width (240px/64px), collapse/expand logic

provides:
  - App.tsx restructured to render Sidebar as primary navigation (replacing top pill tabs)
  - app-layout__content with margin-left offset matching sidebar widths
  - content-header showing active page title
  - Sidebar collapse state persisted in localStorage
  - Responsive CSS breakpoint collapsing sidebar at 768px
  - overflow-x: hidden on html/body for transition safety

affects:
  - 08-03 (sidebar CSS polish and theming)
  - 08-04 (any full-app layout E2E tests)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Sidebar-first layout: Sidebar is position:fixed, content area uses margin-left offset"
    - "TabId canonical source: imported from Sidebar.tsx, not redefined in App.tsx"
    - "localStorage with try/catch guard for SSR-safe state initialization"
    - "Page title in content-header derived from activeTab — no extra state"

key-files:
  created: []
  modified:
    - packages/frontend/src/App.tsx
    - packages/frontend/src/App.css
    - packages/frontend/src/index.css

key-decisions:
  - "08-02-a: margin-left approach for content offset — sidebar is position:fixed so content needs margin-left:240px (expanded) / 64px (collapsed); no CSS grid needed"
  - "08-02-b: TabId imported from Sidebar.tsx, local TabId type removed from App.tsx — single source of truth (established in 08-01-c)"
  - "08-02-c: content-header__title uses conditional rendering on activeTab — avoids extra mapping state, inline and readable"
  - "08-02-d: overflow: hidden removed from .app; overflow-x: hidden moved to html,body — allows sidebar transition without horizontal scrollbar"

patterns-established:
  - "App shell pattern: FloatingLines (z:0 fixed) → Sidebar (z:10 fixed) → app-layout__content (z:1, margin-left offset)"
  - "Auth states render full-screen without sidebar (no margin-left, centered layout)"

# Metrics
duration: 7min
completed: 2026-03-25
---

# Phase 8 Plan 02: App Layout Restructure Summary

**App.tsx refactored from pill-tab layout to Sidebar + content-area shell with localStorage-persisted collapse state and smooth 0.25s CSS transition**

## Performance

- **Duration:** 7 min
- **Started:** 2026-03-25T19:36:16Z
- **Completed:** 2026-03-25T19:43:00Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments

- Replaced top header + pill nav with Sidebar component as primary navigation
- Content area uses margin-left offset (240px expanded / 64px collapsed) with 0.25s cubic-bezier transition
- Sidebar collapse state persisted in localStorage with try/catch guard
- Auth states (loading/setup/login) remain full-screen without sidebar
- FloatingLines background stays at z-index:0, visible behind sidebar glass and content
- All 162 frontend tests pass — no regressions

## Task Commits

1. **Task 1: Restructure App.tsx to use Sidebar navigation** - `4c6dc36` (feat)
2. **Task 2: Update App.css and index.css for sidebar layout** - `e4d14b0` (feat)

## Files Created/Modified

- `packages/frontend/src/App.tsx` — Imports Sidebar + TabId from Sidebar.tsx; removes tabs array, header, pill nav; adds sidebarCollapsed state + handleToggleSidebar; authenticated layout now Sidebar + app-layout__content
- `packages/frontend/src/App.css` — Removes .content/.header/.tab-bar-container/.nav-pills classes; adds .app-layout__content, .app-layout__content--collapsed, .content-header, .content-header__title, .content-main; responsive breakpoint at 768px
- `packages/frontend/src/index.css` — Adds overflow-x: hidden to html,body to prevent horizontal scroll during sidebar transition

## Decisions Made

- **08-02-a:** margin-left approach for content offset — sidebar is position:fixed so content-area needs margin-left matching sidebar width. No CSS grid required. Transition on margin-left gives the smooth push effect.
- **08-02-b:** TabId imported from Sidebar.tsx and local redefinition removed — enforces 08-01-c decision (Sidebar.tsx is canonical source).
- **08-02-c:** Page title in content-header derived directly from activeTab conditionals — no mapping object needed, clean and readable.
- **08-02-d:** overflow-x moved from .app to html/body — .app had overflow:hidden which clipped the fixed sidebar on very narrow viewports; html/body level prevents horizontal scroll during transition without clipping.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Core layout transformation complete — sidebar renders on left, content area fills remaining width
- 08-03 (Sidebar CSS polish) can proceed: sidebar widths and class names established
- 08-04 (layout integration tests) can proceed: layout structure is stable

---
*Phase: 08-ui-redesign-sidebar-layout*
*Completed: 2026-03-25*
