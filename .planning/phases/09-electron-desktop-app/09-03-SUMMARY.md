---
phase: 09-electron-desktop-app
plan: 03
subsystem: electron
tags: [electron, hono, sqlite, vite, electron-vite, contextBridge, security, db-path]

# Dependency graph
requires:
  - phase: 09-01
    provides: createApp() factory, initDb({ dbPath, migrationsPath }), triggerEngineBackground()
  - phase: 09-02
    provides: Electron workspace scaffold — package.json, tsconfig, electron.vite.config.ts, electron-builder.yml

provides:
  - Electron main process entry (index.ts) — lifecycle management, BrowserWindow creation, DB init, server start
  - db-path.ts — resolveDbPath() and resolveMigrationsPath() using app.getPath('userData')
  - server.ts — startBackendServer() and stopBackendServer() with dynamic import of createApp
  - preload/index.ts — minimal contextBridge exposing platform only (no Node.js API leakage)
  - backend package.json exports field — subpath imports for Electron main process

affects:
  - 09-04 (frontend integration — renderer URL and API base URL for Electron)
  - 09-05 (packaging — extraResources drizzle path used by resolveMigrationsPath)
  - 09-06 (distribution — main process is the entry point for packaged app)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - Dynamic import for backend after initDb() — prevents module-level side effects
    - resolveDbPath/resolveMigrationsPath called inside app.whenReady() — app.getPath only valid after ready
    - contextBridge minimal surface — renderer uses HTTP fetch, no IPC needed
    - Explicit security defaults pattern — contextIsolation/nodeIntegration/sandbox all explicit, not relied on as defaults

key-files:
  created:
    - packages/electron/src/main/index.ts
    - packages/electron/src/main/db-path.ts
    - packages/electron/src/main/server.ts
    - packages/electron/src/preload/index.ts
  modified:
    - packages/backend/package.json

key-decisions:
  - "09-03-a: initDb() called before dynamic import of createApp — DB path injected before any backend module access"
  - "09-03-b: Dynamic import for @cryptax/backend/app.js in server.ts — defers createApp() until after initDb() completes"
  - "09-03-c: resolveDbPath/resolveMigrationsPath called inside whenReady callback — app.getPath('userData') requires ready state"
  - "09-03-d: ELECTRON_RENDERER_URL env var for dev mode — electron-vite sets this automatically; falls back to out/renderer/index.html in prod"
  - "09-03-e: preload exposes only platform string — renderer uses HTTP fetch to localhost:3001, no IPC channels needed"
  - "09-03-f: stopBackendServer() in window-all-closed — graceful server shutdown before app.quit()"

patterns-established:
  - "DB-first init pattern: resolveDbPath() -> initDb() -> dynamic import of backend -> startBackendServer()"
  - "Security-explicit pattern: contextIsolation/nodeIntegration/sandbox all declared in webPreferences, not left as implicit defaults"
  - "Minimal preload surface: only expose what the renderer provably needs (platform string only)"

# Metrics
duration: 4min
completed: 2026-03-27
---

# Phase 9 Plan 03: Electron Main Process, Preload Script, and DB Path Resolver Summary

**Electron main process wires initDb() -> startBackendServer() -> BrowserWindow with contextIsolation=true/nodeIntegration=false/sandbox=true and minimal preload exposing only platform**

## Performance

- **Duration:** 4 min
- **Started:** 2026-03-27T11:00:11Z
- **Completed:** 2026-03-27T11:03:41Z
- **Tasks:** 2
- **Files modified:** 5 (4 created, 1 modified)

## Accomplishments
- Four source files written covering the complete Electron main process: db-path resolver, Hono server wrapper, app entry point, and preload script
- `packages/backend/package.json` exports field added with all required subpath mappings — enables `@cryptax/backend/app.js`, `@cryptax/backend/db/client.js`, `@cryptax/backend/routes/engine.js` imports from Electron main process
- Security defaults are explicit in webPreferences: `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`
- All 947 existing tests pass — no regressions

## Task Commits

Each task was committed atomically:

1. **Task 1: Create db-path.ts and server.ts modules, add exports field to backend package.json** - `e33ee51` (feat)
2. **Task 2: Create Electron main process entry and preload script** - `ac9240e` (feat)

**Plan metadata:** (docs commit follows)

## Files Created/Modified
- `packages/electron/src/main/db-path.ts` - resolveDbPath() and resolveMigrationsPath() using app.getPath('userData')
- `packages/electron/src/main/server.ts` - startBackendServer()/stopBackendServer() wrapping @hono/node-server with dynamic import of createApp
- `packages/electron/src/main/index.ts` - App entry: whenReady -> initDb -> startBackendServer -> BrowserWindow; window-all-closed -> stopBackendServer -> app.quit
- `packages/electron/src/preload/index.ts` - contextBridge.exposeInMainWorld('electronAPI', { platform }) only
- `packages/backend/package.json` - Added exports field with 7 subpath mappings

## Decisions Made
- Dynamic import for `createApp` in server.ts ensures the backend module is not evaluated until `initDb()` has been called — avoids Proxy auto-init reading wrong DB_PATH
- `app.whenReady()` callback is the correct place to call `resolveDbPath()`/`resolveMigrationsPath()` because `app.getPath('userData')` throws before the app is ready
- Preload script is intentionally minimal — renderer communicates entirely via HTTP fetch to `localhost:3001`; no IPC channels reduce attack surface
- `stopBackendServer()` on `window-all-closed` (not `before-quit`) — ensures clean shutdown in standard close flow on Windows/Linux

## Deviations from Plan

None — plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- Electron main process is complete and ready for `electron-vite dev` once the renderer is configured (09-04)
- `resolveDbPath()` uses `app.getPath('userData')` — correct location for 09-05 packaging with extraResources
- `resolveMigrationsPath()` handles both packaged (`process.resourcesPath/drizzle`) and dev (`backend/drizzle`) correctly
- Security defaults established as explicit code — 09-06 distribution packaging can rely on correct defaults without review

---
*Phase: 09-electron-desktop-app*
*Completed: 2026-03-27*
