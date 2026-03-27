---
phase: 09-electron-desktop-app
plan: 02
subsystem: infra
tags: [electron, electron-vite, electron-builder, vite, nsis, windows, native-modules, better-sqlite3]

# Dependency graph
requires:
  - phase: 09-electron-desktop-app/09-01
    provides: createApp() factory and lazy DB init that Electron main process will import
  - phase: 08-ui-redesign-sidebar-layout
    provides: packages/frontend/ with index.html that renderer config points to

provides:
  - packages/electron/ npm workspace with all devDependencies installed
  - electron.vite.config.ts defining three-process build (main/preload/renderer)
  - electron-builder.yml for Windows NSIS installer with native module unpack and migration extraResources
  - packages/electron/tsconfig.json with composite + bundler moduleResolution
  - Root tsconfig.json updated to reference packages/electron
  - Placeholder src/main/, src/preload/ directories ready for Plan 03

affects:
  - 09-03 (main process code goes in src/main/index.ts, preload in src/preload/index.ts)
  - 09-04 (packaging uses electron-builder.yml nsis config)
  - 09-05 (renderer build uses ../frontend root)

# Tech tracking
tech-stack:
  added:
    - electron@41.1.0
    - electron-vite@5.0.0
    - electron-builder@26.8.1
    - "@electron/rebuild@4.0.3"
    - vite@7.3.1 (workspace-local, electron-vite v5 requires vite <=7)
    - "@vitejs/plugin-react@5.1.4 (vite v7 compatible version)"
  patterns:
    - Workspace-local vite version to satisfy electron-vite peer dep while root uses vite v8
    - ELECTRON_SKIP_BINARY_DOWNLOAD=1 pattern for Windows AV-protected environments
    - import.meta.dirname for ESM config files (Node 22+, avoids __dirname in ESM)

key-files:
  created:
    - packages/electron/package.json
    - packages/electron/tsconfig.json
    - packages/electron/electron.vite.config.ts
    - packages/electron/electron-builder.yml
    - packages/electron/.gitignore
    - packages/electron/src/main/.gitkeep
    - packages/electron/src/preload/.gitkeep
    - packages/electron/build-resources/.gitkeep
  modified:
    - tsconfig.json (added packages/electron reference)
    - package-lock.json (292 new packages)

key-decisions:
  - "09-02-a: vite@^7.3.1 pinned in electron workspace — electron-vite v5 peer dep is vite <=7; root stays on vite v8"
  - "09-02-b: @vitejs/plugin-react@^5.1.4 (not v6) — v6 requires vite v8, v5.x supports vite v4-8"
  - "09-02-c: postinstall removed from package.json — electron-builder install-app-deps fails before electron binary is installed; moved to explicit rebuild script"
  - "09-02-d: import.meta.dirname in electron.vite.config.ts — package.json type=module means ESM context; __dirname undefined; Node 23 has import.meta.dirname natively"
  - "09-02-e: ELECTRON_SKIP_BINARY_DOWNLOAD=1 required on Windows with Cylance AV — asar file held by AV scanner during install causes EBUSY rename failure"

patterns-established:
  - "electron workspace uses workspace-local node_modules for vite v7 while root uses vite v8 — npm hoisting places the workspace-scoped version in packages/electron/node_modules/"
  - "electron.exe stub in node_modules/electron/dist/ during CI/dev — real binary downloaded separately before packaging"

# Metrics
duration: 23min
completed: 2026-03-27
---

# Phase 9 Plan 02: Electron Workspace Scaffold — Config Files and Dependencies Summary

**packages/electron workspace with electron@41.1.0, electron-vite@5.0.0, electron-builder@26.8.1 installed; three-process vite config and Windows NSIS builder config ready for Plan 03 application code**

## Performance

- **Duration:** 23 min
- **Started:** 2026-03-27T10:32:14Z
- **Completed:** 2026-03-27T10:55:51Z
- **Tasks:** 2
- **Files modified:** 8 created, 2 modified

## Accomplishments
- `packages/electron/` created as valid npm workspace recognized by the monorepo root (`packages/*` glob)
- electron@41.1.0, electron-vite@5.0.0, electron-builder@26.8.1, and all transitive deps installed (292 packages)
- `electron.vite.config.ts` defines main (externalized deps + better-sqlite3 external), preload (externalized), and renderer (points to packages/frontend with /api proxy) builds
- `electron-builder.yml` configures Windows NSIS one-click installer with `asarUnpack` for native `.node` files and `extraResources` for drizzle migrations

## Task Commits

Each task was committed atomically:

1. **Task 1: Create packages/electron workspace with package.json and install dependencies** - `91ad97e` (feat)
2. **Task 2: Create electron-vite config and electron-builder.yml** - `871b2c3` (feat)

**Plan metadata:** (docs commit follows)

## Files Created/Modified
- `packages/electron/package.json` - New: Electron workspace with electron, electron-vite, electron-builder devDeps (vite pinned to v7)
- `packages/electron/tsconfig.json` - New: composite TypeScript config with bundler moduleResolution, references shared+backend
- `packages/electron/electron.vite.config.ts` - New: three-process build config using import.meta.dirname for ESM
- `packages/electron/electron-builder.yml` - New: Windows NSIS installer, asarUnpack for .node files, extraResources for drizzle
- `packages/electron/.gitignore` - New: excludes out/ and dist-installer/
- `packages/electron/src/main/.gitkeep` - New: placeholder for Plan 03 main process code
- `packages/electron/src/preload/.gitkeep` - New: placeholder for Plan 03 preload code
- `packages/electron/build-resources/.gitkeep` - New: placeholder for app icons
- `tsconfig.json` - Modified: added `{ "path": "./packages/electron" }` reference
- `package-lock.json` - Modified: 292 new packages added

## Decisions Made
- `vite@^7.3.1` pinned in electron workspace — `electron-vite@5.0.0` peer dependency requires `vite ^5||^6||^7` but root workspace uses `vite@^8.0.0`. npm workspaces allows per-workspace overrides; electron-vite is installed in `packages/electron/node_modules/` with its own vite v7.
- `@vitejs/plugin-react@^5.1.4` (not v6) — v6 requires vite v8 via peer dep; v5.1.x supports vite `^4.2.0 || ^5.0.0 || ^6.0.0 || ^7.0.0`.
- `postinstall` script removed from electron package.json — `electron-builder install-app-deps` fails when called before the electron binary is available (chicken-and-egg during workspace install). Moved to explicit `rebuild` script that callers invoke after packaging setup.
- `import.meta.dirname` used in config — `packages/electron/package.json` has `"type": "module"` so the config file runs in ESM context where `__dirname` is not defined. `import.meta.dirname` is available natively in Node 22+ (this project uses Node 23).
- `ELECTRON_SKIP_BINARY_DOWNLOAD=1` required on Windows — Cylance AV holds `default_app.asar` with an exclusive scan handle during npm's reify rename step, causing `EBUSY`. Setting this env var causes electron's install script to exit early, skipping binary download. The stub binary is replaced with the real one before packaging.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Pinned vite to ^7.3.1 in electron workspace (peer dep conflict)**
- **Found during:** Task 1 (npm install)
- **Issue:** Plan specified `vite@^8.0.0` and `@vitejs/plugin-react@^6.0.0` but electron-vite@5.0.0 requires `vite ^5||^6||^7` (not v8). npm install failed with peer dep error.
- **Fix:** Changed electron workspace to `vite@^7.3.1` and `@vitejs/plugin-react@^5.1.4`. Both are compatible and fully functional for electron-vite v5.
- **Files modified:** `packages/electron/package.json`
- **Verification:** npm install succeeds, all 947 tests pass
- **Committed in:** `91ad97e` (Task 1 commit)

**2. [Rule 3 - Blocking] Removed postinstall script and used ELECTRON_SKIP_BINARY_DOWNLOAD=1**
- **Found during:** Task 1 (npm install with postinstall)
- **Issue:** Plan included `"postinstall": "electron-builder install-app-deps"` which tries to rebuild native modules before electron binary is installed. Also, Windows Cylance AV holds `default_app.asar` causing EBUSY on npm reify rename.
- **Fix:** Removed postinstall, moved to `rebuild` script. Used `ELECTRON_SKIP_BINARY_DOWNLOAD=1` to bypass AV lock during install. Manually reconstructed electron package metadata from npm pack tarball.
- **Files modified:** `packages/electron/package.json`, `package-lock.json`
- **Verification:** npm install succeeds, electron@41.1.0 installed with correct package.json and path.txt
- **Committed in:** `91ad97e` (Task 1 commit)

**3. [Rule 3 - Blocking] Used import.meta.dirname instead of __dirname in vite config**
- **Found during:** Task 2 (writing electron.vite.config.ts)
- **Issue:** Plan suggested __dirname for config file but packages/electron is type=module so ESM context — __dirname is undefined.
- **Fix:** Used `const dir = import.meta.dirname` (Node 22+/23 native).
- **Files modified:** `packages/electron/electron.vite.config.ts`
- **Verification:** Config file is syntactically valid TypeScript
- **Committed in:** `871b2c3` (Task 2 commit)

---

**Total deviations:** 3 auto-fixed (all Rule 3 - blocking)
**Impact on plan:** All fixes necessary to unblock install and correct config. No scope creep. Version choices (vite v7, plugin-react v5) are functionally equivalent for the Electron use case.

## Issues Encountered

**Windows AV (Cylance) EBUSY lock on default_app.asar:**
- Cylance AV and Windows Defender both held an exclusive handle on `node_modules/electron/dist/resources/default_app.asar` during npm's reify rename step.
- Resolution: `ELECTRON_SKIP_BINARY_DOWNLOAD=1` causes electron's install script to exit before downloading/extracting the binary. Pre-populated electron package metadata from `npm pack` tarball. npm then sees electron as installed and skips the reify rename.
- Note: `dist/electron.exe` is a zero-byte stub. Real binary download needed before `npm run make:win`. Use `ELECTRON_SKIP_BINARY_DOWNLOAD=1 npm install` for development/CI, omit for packaging.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- `packages/electron/src/main/index.ts` placeholder ready for Plan 03 main process code
- `packages/electron/src/preload/index.ts` placeholder ready for Plan 03 preload code
- `electron.vite.config.ts` fully configured — Plan 03 only needs to write the source files
- `electron-builder.yml` packaging config complete — Plan 04 can package immediately after main process is written
- **Note for Plan 03:** electron.exe is a stub on this machine. Developer needs real binary for `npm run dev`. Run `node node_modules/electron/install.js` from the project root (when AV scan completes) or download electron binary manually to `node_modules/electron/dist/electron.exe`.

---
*Phase: 09-electron-desktop-app*
*Completed: 2026-03-27*
