# Phase 9: Electron Desktop App - Research

**Researched:** 2026-03-27
**Domain:** Electron 41, electron-vite 5, electron-builder, better-sqlite3 native rebuild, ESM bundling
**Confidence:** HIGH (core architecture), MEDIUM (native module rebuild path), HIGH (security model)

---

## Summary

Phase 9 wraps the existing Cryptax monorepo into a native Electron desktop app. The Hono backend runs as an embedded localhost HTTP server inside the Electron main process; the Vite-built React frontend loads from that server (dev) or from bundled static files via a custom protocol (prod). SQLite lives in `app.getPath('userData')` instead of the project directory.

The primary complexity is not Electron itself but the interplay of three existing constraints: (1) the backend uses `"type": "module"` ESM with NodeNext module resolution, (2) `better-sqlite3` is a native C++ addon that must be rebuilt against Electron's ABI, and (3) Drizzle migration files must exist outside the asar archive at runtime. All three have well-established solutions documented below.

**Recommended toolchain:** `electron-vite 5` (build + dev), `electron-builder` (packaging/installer), `@electron-forge/plugin-auto-unpack-natives` replaced by `asarUnpack` in electron-builder, `@electron/rebuild` for the native module rebuild step.

**Primary recommendation:** Create a new `packages/electron` workspace that owns the main process entry, preload script, and `electron-vite` + `electron-builder` configuration. The existing `packages/backend` and `packages/frontend` packages are consumed as-is; do not restructure them.

---

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `electron` | `^41.x` (latest stable 41.1.0, Mar 2026) | Runtime — Chromium 146 + Node 24.14 | Newest stable with current Node; Electron 28+ required for ESM main process support |
| `electron-vite` | `^5.x` | Build tool for all three Electron processes | Purpose-built for Electron + Vite; handles main/preload/renderer separation with HMR |
| `electron-builder` | `^25.x` | Packaging + NSIS Windows installer | Most mature packaging tool; supports asarUnpack, npmRebuild, NSIS out of box |
| `@electron/rebuild` | `^3.x` | Rebuild native `.node` addons against Electron ABI | Official Electron tool; integrated automatically by electron-builder |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `electron-updater` | `^6.x` | Auto-update via GitHub Releases | If auto-update is desired; included in electron-builder ecosystem |
| `electron-squirrel-startup` | `^1.x` | Handle Squirrel install/update events | Only if using Squirrel maker (not needed for NSIS) |
| `cross-env` | `^7.x` | Set `DB_PATH` env var cross-platform for dev | Needed until env handling is wired in main process |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| electron-builder | Electron Forge | Forge has first-party Vite plugin but is marked "experimental" as of v7.5; electron-builder is more stable for production packaging |
| electron-vite | vite-plugin-electron | vite-plugin-electron requires wiring into the existing root Vite config; electron-vite provides a separate `electron.vite.config.ts` that doesn't touch the frontend's `vite.config.ts` |
| NSIS installer | Squirrel.Windows | Squirrel produces a NuGet-based flow; NSIS gives a conventional Windows installer with custom options, no dependency on Squirrel events |
| localhost HTTP server | Electron `protocol.handle()` | Custom protocol avoids the HTTP stack but requires porting the entire Hono router to a request-handler shim. The localhost approach reuses the backend 100% unchanged. |

### Installation (new `packages/electron` workspace)

```bash
# In packages/electron
npm install --save-dev electron electron-vite electron-builder @electron/rebuild
# electron-updater is a runtime dep (ships in the app)
npm install electron-updater
```

---

## Architecture Patterns

### Recommended Project Structure

```
packages/
  electron/                   # NEW workspace
    src/
      main/
        index.ts              # Electron main process entry
        server.ts             # Starts Hono backend, returns close()
        db-path.ts            # Resolves userData SQLite path + copies migrations
      preload/
        index.ts              # contextBridge API surface (minimal)
    electron.vite.config.ts   # Three-process vite config (main/preload/renderer)
    electron-builder.yml      # Packaging config (Windows NSIS, asarUnpack)
    forge.config.ts           # Optional: only if using Forge instead of builder
    package.json              # "main": "./out/main/index.js", electron scripts
  backend/                    # UNCHANGED
  frontend/                   # UNCHANGED
  shared/                     # UNCHANGED
```

### Pattern 1: Embedded Hono Server (Localhost HTTP)

**What:** Start the Hono server inside the Electron main process before creating the BrowserWindow. The frontend (whether dev server or static build) calls `http://localhost:PORT/api/...` exactly as it does in the web app.

**When to use:** Always — this approach means zero changes to the existing backend or frontend code. The Vite proxy already routes `/api` to `localhost:3001`.

**Example:**

```typescript
// packages/electron/src/main/server.ts
// Source: Hono Node.js docs + @hono/node-server API
import { serve } from '@hono/node-server';
import { createApp } from '@cryptax/backend/app'; // export the Hono app without calling serve()

let serverInstance: ReturnType<typeof serve> | null = null;

export function startBackendServer(port = 3001): Promise<void> {
  return new Promise((resolve) => {
    serverInstance = serve({ fetch: createApp().fetch, port }, () => resolve());
  });
}

export function stopBackendServer(): Promise<void> {
  return new Promise((resolve) => {
    if (serverInstance) serverInstance.close(() => resolve());
    else resolve();
  });
}
```

**Required backend change:** Extract the Hono `app` construction into a separate export (e.g., `packages/backend/src/app.ts`) so it can be imported without calling `serve()`. The existing `index.ts` becomes `serve(createApp(), ...)`.

### Pattern 2: BrowserWindow Loading Strategy

**What:** In development, load `http://localhost:5174` (Vite dev server). In production, load the bundled `index.html` via `loadFile()` or via a custom `app://` protocol that the renderer can use as an origin.

**When to use:**

- Dev: `loadURL(process.env.VITE_DEV_SERVER_URL)` — electron-vite sets this automatically
- Prod: `mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))`

**Example:**

```typescript
// packages/electron/src/main/index.ts
// Source: electron-vite getting-started guide
import { app, BrowserWindow } from 'electron';
import path from 'node:path';
import { startBackendServer, stopBackendServer } from './server';
import { resolveDbPath } from './db-path';

async function createWindow() {
  // Set DB_PATH before backend initializes
  process.env.DB_PATH = resolveDbPath();

  await startBackendServer(3001);

  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,   // DEFAULT (Electron 12+), must stay true
      nodeIntegration: false,   // DEFAULT (Electron 5+), must stay false
      sandbox: true,            // DEFAULT (Electron 20+)
    },
  });

  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  }
}

app.whenReady().then(createWindow);

app.on('window-all-closed', async () => {
  await stopBackendServer();
  if (process.platform !== 'darwin') app.quit();
});
```

### Pattern 3: SQLite Path Management

**What:** Resolve the database file path to `app.getPath('userData')` instead of the CWD. Copy Drizzle migration SQL files from the packaged `resources/drizzle/` folder into userData on first run so they exist outside the read-only asar archive.

**Why:** The asar archive is read-only. `better-sqlite3` opens a file; the file must be writable. Migration files are read by Drizzle from disk; they must be outside asar or in `asarUnpack`.

**Example:**

```typescript
// packages/electron/src/main/db-path.ts
// Source: Electron app.getPath() docs + Drizzle migration pattern
import { app } from 'electron';
import path from 'node:path';
import fs from 'node:fs';

export function resolveDbPath(): string {
  const userData = app.getPath('userData');
  return path.join(userData, 'cryptax.db');
}

export function ensureMigrations(): string {
  const userData = app.getPath('userData');
  const dest = path.join(userData, 'drizzle');

  if (!fs.existsSync(dest)) {
    // In prod: process.resourcesPath/drizzle (asarUnpack target)
    // In dev: use the source drizzle folder directly
    const src = app.isPackaged
      ? path.join(process.resourcesPath, 'drizzle')
      : path.join(__dirname, '../../../../backend/drizzle');

    fs.cpSync(src, dest, { recursive: true });
  }

  return dest;
}
```

The `DB_PATH` environment variable in `packages/backend/src/db/client.ts` already supports override — set `process.env.DB_PATH = resolveDbPath()` in main before the backend module is imported.

For migration folder path, the backend's `db/client.ts` currently computes `__dirname + /../../drizzle`. This must be made configurable (add a `MIGRATIONS_PATH` env var or accept it as a parameter).

### Pattern 4: electron-vite Configuration

**What:** A single `electron.vite.config.ts` in `packages/electron` that defines builds for main, preload, and renderer processes. The renderer section points to the frontend's existing `index.html` and Vite config.

**Example:**

```typescript
// packages/electron/electron.vite.config.ts
// Source: electron-vite guide
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()], // auto-externalizes all deps in package.json
    build: {
      rollupOptions: {
        // better-sqlite3 MUST be external (native .node file)
        external: ['better-sqlite3'],
        input: { index: path.resolve(__dirname, 'src/main/index.ts') },
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: { index: path.resolve(__dirname, 'src/preload/index.ts') },
      },
    },
  },
  renderer: {
    root: path.resolve(__dirname, '../frontend'),
    build: {
      rollupOptions: {
        input: { index: path.resolve(__dirname, '../frontend/index.html') },
      },
    },
    plugins: [react()],
    server: {
      port: 5174,
      proxy: {
        '/api': { target: 'http://localhost:3001', changeOrigin: true },
      },
    },
  },
});
```

### Pattern 5: electron-builder Packaging Configuration

**What:** `electron-builder.yml` in `packages/electron` that produces a Windows NSIS installer, unpacks native `.node` files from asar, and bundles migration SQL files as extra resources.

```yaml
# packages/electron/electron-builder.yml
appId: com.cryptax.app
productName: Cryptax
directories:
  output: dist-installer
  buildResources: build-resources

# Drizzle SQL migration files — copied from backend, must live outside asar
extraResources:
  - from: ../backend/drizzle
    to: drizzle
    filter: ["**/*.sql", "**/meta/*.json"]

# Native .node files must NOT be inside asar
asarUnpack:
  - "**/*.node"
  - "**/node_modules/better-sqlite3/**"

# Rebuild native modules against Electron's ABI before packaging
npmRebuild: true

files:
  - out/**/*
  - package.json

win:
  target:
    - target: nsis
      arch: [x64]

nsis:
  oneClick: false
  allowToChangeInstallationDirectory: true
  perMachine: false
  createDesktopShortcut: true
  createStartMenuShortcut: true
```

### Anti-Patterns to Avoid

- **Starting Hono with `serve()` from backend's `index.ts`:** `index.ts` calls `serve()` at import time, triggering the server before `DB_PATH` is set. Extract app construction from server start.
- **Relying on `__dirname` for migration paths in packaged mode:** `__dirname` inside an asar resolves to virtual paths. Use `process.resourcesPath` for files placed via `extraResources`.
- **Importing `@cryptax/backend` as a workspace dep from the main process without transpilation:** electron-vite handles transpilation but the `NodeNext` module resolution in backend's tsconfig may conflict. Use a bundled copy (electron-vite compiles it).
- **Setting `nodeIntegration: true`:** Completely unnecessary since the backend runs in main process, not the renderer. Never enable this.
- **Loading `file://` directly for production frontend:** Works but loses `fetch` CORS origin and `localStorage`; using `loadFile()` with the built `index.html` is the correct approach (Electron auto-sets the origin).

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Native module rebuild | Custom `node-gyp` script | `@electron/rebuild` (auto-runs in electron-builder when `npmRebuild: true`) | Handles Electron ABI target, headers download, multi-arch |
| Detecting packaged vs dev | Custom `__dirname` heuristic | `app.isPackaged` (official API) | Reliable, documented, cross-platform |
| Finding available port | Port-scanning logic | Start on a fixed port (3001); if busy, use `detect-port` npm package | Port conflicts are rare for local apps; fixed port simplifies frontend config |
| Auto-update | Custom update checker | `electron-updater` from electron-builder | Handles GitHub Releases, delta updates, code signature validation |
| Windows installer | Raw NSIS scripts | electron-builder NSIS target | Handles architecture detection, uninstall registry entries, shortcuts |
| ASAR-safe file access | Manual `process.noAsar` hacks | `asarUnpack` + `extraResources` in electron-builder | These are the intended APIs; `noAsar` disables all asar support globally |

**Key insight:** The hardest Electron packaging problems (native rebuild, asar exclusion, installer creation) are all solved by electron-builder's configuration. The main coding work is the main-process entry, db-path management, and the backend refactor to separate app construction from server start.

---

## Common Pitfalls

### Pitfall 1: better-sqlite3 ABI Mismatch

**What goes wrong:** `Error: The module '.../better_sqlite3.node' was compiled against a different Node.js version` at app startup.

**Why it happens:** `better-sqlite3` ships a prebuilt binary for the system Node.js ABI. Electron 41 bundles Node 24.14 but uses a different V8 embedding — even if the Node versions match, the ABI differs.

**How to avoid:** Ensure `npmRebuild: true` in `electron-builder.yml` (the default) AND that `@electron/rebuild` is installed as a devDependency in the electron workspace. electron-builder runs it automatically.

**Warning signs:** If `npm install` completes but the app crashes on startup with a "wrong module" error, the native rebuild did not run.

### Pitfall 2: Migration Files Inside asar (Drizzle Cannot Read Them)

**What goes wrong:** `Error: ENOENT: no such file or directory, open '/path/to/app.asar/drizzle/0000_initial.sql'` — Drizzle's migrator tries to `fs.readdir()` the migrations folder, which fails inside asar.

**Why it happens:** By default, electron-builder packs everything into `app.asar`. `fs.readdir` works inside asar for listing, but `migrate()` may try to open files in ways that trigger the unpacking overhead, and on some Electron versions/platforms the virtual path fails for SQLite's migrator.

**How to avoid:** Use `extraResources` to copy `drizzle/*.sql` + `drizzle/meta/*.json` into `resources/drizzle/` (outside asar). Point the migrator at `process.resourcesPath + '/drizzle'` in packaged mode and at the source folder in dev mode.

**Warning signs:** Works in `electron-vite dev` but crashes after `electron-builder` packaging.

### Pitfall 3: DB_PATH Set After Module Import

**What goes wrong:** SQLite database file is created in the wrong location (CWD of the Electron process, e.g., `C:\Program Files\Cryptax\`) which is not writable.

**Why it happens:** `packages/backend/src/db/client.ts` reads `process.env.DB_PATH` at module evaluation time (top level). If the backend module is imported before `process.env.DB_PATH` is set, the default `'cryptax.db'` is used.

**How to avoid:** Set `process.env.DB_PATH = resolveDbPath()` in `packages/electron/src/main/index.ts` **before** any `import` from `@cryptax/backend`. Because ESM imports are hoisted, this requires either: (a) a dynamic `import()` of the backend after setting the env var, or (b) moving DB_PATH resolution into the backend's own startup function that is called explicitly.

**Option (b) is cleaner:** Add a `initDb(path: string)` function to `packages/backend/src/db/client.ts` that accepts the path explicitly, called from the electron main process before starting the server.

**Warning signs:** Database file appears in `C:\Program Files\Cryptax\` or the app's installation directory after packaging.

### Pitfall 4: ESM + Electron 41 Timing

**What goes wrong:** Electron APIs called before `app.whenReady()` because top-level `await` in ESM completes asynchronously after the ready event fires.

**Why it happens:** Electron 28+ supports ESM natively, but `app.getPath()` can only be called after the app is initialized. ESM dynamic imports at the module level may execute after `ready` fires.

**How to avoid:** All startup logic goes inside `app.whenReady().then(async () => { ... })`. Do not call `app.getPath()` at module scope — only inside the `whenReady` callback.

**Warning signs:** `Error: Failed to get 'userData' path. App is not ready.`

### Pitfall 5: Frontend API Calls Fail in Production (CORS / Origin Mismatch)

**What goes wrong:** `loadFile()` sets origin to `null` or `file://`, and the Hono backend's CORS middleware rejects these origins.

**Why it happens:** The Hono backend uses `cors()` middleware. In the web app context, the origin is `http://localhost:5174`. When loaded via `loadFile()`, the renderer origin is `file://`.

**How to avoid:** Configure Hono CORS to allow the `file://` origin OR (better) configure Hono to allow all origins for the local-only server (it's not exposed to the internet). Since this is a localhost-only embedded server, open CORS is acceptable:

```typescript
app.use('/api/*', cors({ origin: '*' }));
```

**Warning signs:** All API calls return 403 in the packaged app but work in dev.

### Pitfall 6: Monorepo Hoisted Dependencies and electron-builder

**What goes wrong:** electron-builder doesn't find `node_modules` for the electron workspace because npm workspaces hoist packages to the root `node_modules`.

**Why it happens:** electron-builder by default looks for `node_modules` relative to the app package. With npm workspaces, dependencies are in the root.

**How to avoid:** Configure electron-builder `directories.buildResources` correctly and use electron-vite to pre-bundle everything into `out/`. Since electron-vite bundles main/preload code, the output in `out/main/index.js` and `out/preload/index.js` only contains code; runtime deps (like `better-sqlite3`) remain external and are picked up from the hoisted `node_modules` via `files` patterns.

Include `"../../node_modules/better-sqlite3/**"` in the `files` array if needed, or rely on electron-builder's automatic dependency detection.

---

## Code Examples

### Starting Hono in Main Process (Verified Pattern)

```typescript
// Source: @hono/node-server docs (hono.dev/docs/getting-started/nodejs)
import { serve } from '@hono/node-server';
import type { ServerType } from '@hono/node-server';

let server: ServerType | null = null;

export function startServer(app: Hono, port: number): Promise<void> {
  return new Promise((resolve) => {
    server = serve({ fetch: app.fetch, port }, () => {
      console.log(`Backend running on http://localhost:${port}`);
      resolve();
    });
  });
}

export function stopServer(): Promise<void> {
  return new Promise((resolve) => {
    server ? server.close(() => resolve()) : resolve();
  });
}
```

### BrowserWindow Security Configuration (Verified)

```typescript
// Source: Electron security docs (electronjs.org/docs/latest/tutorial/security)
// contextIsolation: true   — DEFAULT since Electron 12, NEVER disable
// nodeIntegration: false   — DEFAULT since Electron 5, NEVER enable for renderer
// sandbox: true            — DEFAULT since Electron 20
const win = new BrowserWindow({
  webPreferences: {
    preload: path.join(__dirname, '../preload/index.js'),
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true,
  },
});
```

### Preload Script (Minimal — No native APIs Needed)

```typescript
// packages/electron/src/preload/index.ts
// Source: Electron contextBridge API docs
import { contextBridge } from 'electron';

// Expose ONLY what the renderer actually needs.
// For Cryptax, the renderer only needs HTTP API access (already via fetch to localhost).
// No special IPC needed — all interaction goes through HTTP.
contextBridge.exposeInMainWorld('electronAPI', {
  platform: process.platform,
});
```

### electron-builder Scripts in package.json

```json
{
  "scripts": {
    "dev": "electron-vite dev",
    "build": "electron-vite build",
    "package": "electron-vite build && electron-builder",
    "make:win": "electron-vite build && electron-builder --win --x64",
    "postinstall": "electron-builder install-app-deps"
  }
}
```

### Resolving Paths Correctly (packaged vs dev)

```typescript
// Source: Electron process.resourcesPath + app.isPackaged docs
import { app } from 'electron';
import path from 'node:path';

// Migrations folder path
const migrationsPath = app.isPackaged
  ? path.join(process.resourcesPath, 'drizzle')
  : path.join(__dirname, '../../../backend/drizzle');

// Database file path
const dbPath = path.join(app.getPath('userData'), 'cryptax.db');
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `electron-rebuild` (standalone) | `@electron/rebuild` (official scoped package) | 2021 | Use `@electron/rebuild`; the old package is a shim |
| `nodeIntegration: true` | `contextIsolation + contextBridge + preload` | Electron 5/12 | Security hardening; never use nodeIntegration for new apps |
| CJS main process (`require()`) | ESM main process (`import`/`await`) supported | Electron 28+ (2023) | Electron 41 fully supports ESM; use it (avoids CJS interop pain with existing ESM codebase) |
| `electron-forge` as primary packaging tool | `electron-builder` for stable builds; Forge Vite plugin still experimental | 2024–2025 | Forge Vite plugin marked experimental in v7.5; electron-builder is production-grade |
| `process.dlopen` for native modules | `asarUnpack: ["**/*.node"]` in electron-builder | ~2019 | Cleaner, automatic — no manual unpacking code needed |
| Squirrel.Windows installer | NSIS installer | 2018+ | NSIS is more conventional for Windows; no Squirrel startup events to handle |

**Deprecated/outdated:**
- `electron-rebuild` (unscoped): Replaced by `@electron/rebuild`; still works as a shim but use the official package
- `remote` module: Removed from Electron core in Electron 14; use IPC or direct main-process code
- `webSecurity: false`: Never disable web security; use `cors()` in Hono instead
- Electron < 28 for ESM: The project's existing ESM codebase requires Electron 28+; Electron 41 is the current stable

---

## Open Questions

1. **Backend refactoring scope**
   - What we know: `packages/backend/src/index.ts` calls `serve()` at module level, making it hard to import without starting the server. `db/client.ts` reads `DB_PATH` at module evaluation.
   - What's unclear: Exact refactoring needed — whether to extract `createApp()` as a separate export or whether electron-vite's bundling can intercept the env var in time.
   - Recommendation: Add `packages/backend/src/app.ts` that exports `createApp()` without calling `serve()`. Modify `index.ts` to import and call it. Add `process.env.DB_PATH` override support via a startup initializer.

2. **`@cryptax/backend` import path in electron main**
   - What we know: electron-vite will bundle the main process code and resolve workspace paths.
   - What's unclear: Whether `@cryptax/backend` workspace resolution works correctly when electron-vite builds the main process bundle in `packages/electron/`.
   - Recommendation: Verify by aliasing in `electron.vite.config.ts` if needed: `resolve: { alias: { '@cryptax/backend': path.resolve('../backend/src') } }`.

3. **Migration files approach: extraResources vs asarUnpack**
   - What we know: Both work. `extraResources` copies files outside asar to `resources/`; `asarUnpack` extracts them from asar to `app.asar.unpacked/`.
   - What's unclear: Which is cleaner for the `process.resourcesPath` resolution pattern.
   - Recommendation: Use `extraResources` (simpler path: `path.join(process.resourcesPath, 'drizzle')`).

4. **Auto-update scope**
   - What we know: `electron-updater` integrates with electron-builder and GitHub Releases.
   - What's unclear: Whether the user wants auto-update in Phase 9 or to defer it.
   - Recommendation: Wire in `electron-updater` with a manual check-for-updates menu item; skip automatic silent updates for the first release.

---

## Sources

### Primary (HIGH confidence)
- Electron security docs (electronjs.org/docs/latest/tutorial/security) — contextIsolation, nodeIntegration, sandbox defaults
- Electron releases (releases.electronjs.org) — confirmed v41.1.0 as latest stable (Node 24.14), v28+ required for ESM
- Electron app.getPath() docs (electronjs.org/docs/latest/api/app) — userData path pattern
- Electron ASAR docs (electronjs.org/docs/latest/tutorial/asar-archives) — read-only constraints, asarUnpack
- Electron process docs (electronjs.org/docs/latest/api/process) — process.resourcesPath, app.isPackaged
- electron-vite docs (electron-vite.org) — v5.0.0, dependency handling, externalizeDepsPlugin, HMR
- electron-builder NSIS docs (electron.build/nsis) — oneClick, perMachine, allowToChangeInstallationDirectory
- electron-builder auto-update docs (electron.build/auto-update) — electron-updater, GitHub Releases support
- better-sqlite3 troubleshooting (github.com/WiseLibs/better-sqlite3) — explicit recommendation to use electron-rebuild
- @electron/rebuild docs (electronjs.org/docs/latest/tutorial/using-native-node-modules) — ABI rebuild pattern
- Electron Forge auto-unpack-natives plugin docs (electronforge.io/config/plugins/auto-unpack-natives) — verified asarUnpack behavior
- Electron Forge Vite plugin docs (electronforge.io/config/plugins/vite) — experimental status confirmed
- Hono Node.js server docs (hono.dev/docs/getting-started/nodejs) — serve() API, server.close() pattern

### Secondary (MEDIUM confidence)
- electron-vite.org troubleshooting — ESM support requires Electron 28+, "type": "module" in package.json
- electron-vite dependency handling guide — externalizeDepsPlugin behavior, native module external config

### Tertiary (LOW confidence)
- Drizzle migration pattern for Electron — derived from Drizzle migration docs + known asar constraints; no official Drizzle+Electron guide exists

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all libraries verified via official docs and official release pages
- Architecture (embedded server): HIGH — Hono serve() API is documented; pattern is standard in Electron apps
- Native module rebuild: HIGH — official @electron/rebuild docs confirm the pattern; electron-builder integration verified
- DB path management: HIGH — app.getPath('userData') is official documented API
- Migration path in packaged app: MEDIUM — extraResources pattern is documented; exact path resolution verified conceptually but not integration-tested
- ESM timing: HIGH — official Electron ESM docs explicitly warn about the async loading timing issue
- Pitfalls: HIGH for 1-4 (well-documented patterns); MEDIUM for 5-6 (derived from API docs)

**Research date:** 2026-03-27
**Valid until:** 2026-06-27 (Electron releases quarterly; electron-vite is active; electron-builder is stable)
