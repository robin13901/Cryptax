# Phase 1: Foundation + CI/CD - Research

**Researched:** 2026-03-21
**Domain:** npm workspaces monorepo, Hono, Drizzle ORM, Vitest, GitHub Actions CI/CD
**Confidence:** HIGH (most findings verified via official docs or WebFetch)

---

## Summary

Phase 1 lays the entire structural foundation for Cryptax. The research covers seven distinct
technical areas: monorepo scaffolding with npm workspaces + TypeScript project references, Hono
backend with Node.js adapter, Drizzle ORM with better-sqlite3 (including STRICT tables and WAL
mode), Decimal.js monetary arithmetic enforcement, the reactbits.dev Floating Lines component
(Three.js/WebGL, not just CSS), Vitest workspace configuration for monorepo coverage, and the
full GitHub Actions CI/CD pipeline including the Claude Code Action v1.

The standard approach is clear and well-supported: npm workspaces + TypeScript project references
for the monorepo, Hono serving both API and built static assets in production, Drizzle Kit
`generate + migrate` (not `push`) for auditability, Biome for linting/formatting (faster than
ESLint+Prettier, better monorepo support in v2), and the `codecov/codecov-action@v4` +
`anthropics/claude-code-action@v1` for CI gates.

**Primary recommendation:** Build a clean monorepo from scratch (not migrating dashboard/) with
`packages/frontend`, `packages/backend`, `packages/shared`. Port useful components (GlassSurface,
tab structure, KPI cards) from `dashboard/` manually. The Floating Lines component requires manual
copy-paste from react-bits source (it uses WebGL shaders via Three.js) — there is no dedicated
npm package for individual components.

---

## 1. npm Workspaces Monorepo Setup

### Root package.json
```json
{
  "name": "cryptax",
  "private": true,
  "workspaces": ["packages/*"],
  "scripts": {
    "dev": "concurrently \"npm run dev -w packages/backend\" \"npm run dev -w packages/frontend\"",
    "build": "npm run build --workspaces",
    "test": "vitest",
    "lint": "biome check .",
    "format": "biome format --write ."
  }
}
```

### Package layout (RECOMMENDED)
```
cryptax/
├── package.json               # root workspace config
├── tsconfig.json              # root TypeScript project references
├── biome.json                 # root Biome config
├── vitest.config.ts           # root Vitest workspace config
├── drizzle.config.ts          # Drizzle Kit config
├── .github/
│   └── workflows/
├── packages/
│   ├── shared/
│   │   ├── package.json       # name: "@cryptax/shared"
│   │   ├── tsconfig.json
│   │   └── src/
│   │       ├── types/         # Transaction, TaxSummary, etc.
│   │       └── decimal/       # Decimal.js utilities
│   ├── backend/
│   │   ├── package.json       # name: "@cryptax/backend"
│   │   ├── tsconfig.json
│   │   └── src/
│   │       ├── index.ts       # Hono app entry
│   │       ├── db/            # Drizzle schema + connection
│   │       └── routes/        # API route handlers
│   └── frontend/
│       ├── package.json       # name: "@cryptax/frontend"
│       ├── tsconfig.json
│       ├── vite.config.ts
│       └── src/
│           ├── components/    # GlassSurface, FloatingLines, etc.
│           └── App.tsx
```

### TypeScript project references (root tsconfig.json)
```json
{
  "compilerOptions": {
    "strict": true,
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext"
  },
  "references": [
    { "path": "./packages/shared" },
    { "path": "./packages/backend" },
    { "path": "./packages/frontend" }
  ],
  "files": []
}
```

### Each package tsconfig.json pattern (backend example)
```json
{
  "extends": "../../tsconfig.json",
  "compilerOptions": {
    "composite": true,
    "outDir": "dist",
    "rootDir": "src",
    "declaration": true,
    "declarationMap": true
  },
  "references": [
    { "path": "../shared" }
  ],
  "include": ["src/**/*"]
}
```

### Inter-package imports
Use workspace protocol in package.json:
```json
{
  "dependencies": {
    "@cryptax/shared": "*"
  }
}
```
Then import as: `import { Transaction } from '@cryptax/shared'`

**Confidence: HIGH** — npm workspaces docs, TypeScript docs

### Pitfall: `module` and `moduleResolution` mismatch
For Node.js with ES modules (`.ts` files with `"type": "module"`), use `"module": "NodeNext"` and
`"moduleResolution": "NodeNext"`. For Vite frontend, use `"module": "ESNext"` and
`"moduleResolution": "Bundler"`. Each package must have its own correct settings — do NOT try to
share one tsconfig for both Node and browser environments.

---

## 2. Hono with @hono/node-server

### Installation
```bash
npm install hono @hono/node-server -w packages/backend
npm install -D @types/node -w packages/backend
```

### Basic server (packages/backend/src/index.ts)
```typescript
import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { logger } from 'hono/logger'

const app = new Hono()

app.use('*', logger())
app.use('/api/*', cors())

// Health endpoint
app.get('/api/health', (c) => c.json({ status: 'ok', ts: Date.now() }))

// Serve frontend static build in production
app.use('/*', serveStatic({ root: '../frontend/dist' }))
// SPA fallback — serve index.html for all unmatched routes
app.get('/*', serveStatic({ path: '../frontend/dist/index.html' }))

serve({ fetch: app.fetch, port: 3001 })
```

### Vite dev proxy (packages/frontend/vite.config.ts)
```typescript
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5174,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
        // NO rewrite — Hono routes are already prefixed with /api
      },
    },
  },
})
```

**In dev mode:** Frontend on `:5174`, backend on `:3001`. Vite proxies `/api/*` to backend.
**In production:** Backend serves the Vite-built `dist/` folder + handles all API routes.

### Root `npm run dev` using concurrently
```bash
npm install -D concurrently -w . # install at root
```
Root script: `"dev": "concurrently -n 'backend,frontend' \"npm run dev -w packages/backend\" \"npm run dev -w packages/frontend\""`

**Confidence: HIGH** — verified via Hono official docs and Vite docs

### Gotcha: `serveStatic` root path resolution
`serveStatic({ root: './' })` resolves relative to process working directory (where Node is started
from), NOT the source file. Use `import.meta.url` with `fileURLToPath` to get an absolute path:
```typescript
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
const __dirname = dirname(fileURLToPath(import.meta.url))
app.use('/*', serveStatic({ root: resolve(__dirname, '../../frontend/dist') }))
```

---

## 3. Drizzle ORM with better-sqlite3

### Installation
```bash
npm install drizzle-orm better-sqlite3 -w packages/backend
npm install -D drizzle-kit @types/better-sqlite3 -w packages/backend
```

### Database connection (packages/backend/src/db/client.ts)
```typescript
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import * as schema from './schema'

const sqlite = new Database('cryptax.db')

// WAL mode — set once at startup for better concurrent read performance
sqlite.pragma('journal_mode = WAL')
sqlite.pragma('foreign_keys = ON')

export const db = drizzle(sqlite, { schema })
```

### Schema definition with STRICT tables + TEXT monetary columns
Drizzle ORM currently supports STRICT mode via the `extra` table option:
```typescript
import { sqliteTable, text, integer, real } from 'drizzle-orm/sqlite-core'

// Example: transactions table
export const transactions = sqliteTable(
  'transactions',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    // Monetary values — TEXT to preserve precision via Decimal.js
    amount:       text('amount').notNull(),
    price:        text('price').notNull(),
    fee:          text('fee').notNull().default('0'),
    totalValue:   text('total_value').notNull(),
    // Non-monetary
    symbol:       text('symbol').notNull(),
    side:         text('side', { enum: ['buy', 'sell'] }).notNull(),
    type:         text('type').notNull(),
    exchange:     text('exchange').notNull().default('bitget'),
    tradedAt:     integer('traded_at', { mode: 'timestamp' }).notNull(),
    importedAt:   integer('imported_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
    sourceFile:   text('source_file'),
    rawRow:       text('raw_row'),  // JSON blob of original CSV row
  },
  // STRICT mode as SQLite table option
  (t) => ({ strict: true })   // NOTE: verify exact Drizzle syntax — see gotcha below
)
```

**CRITICAL GOTCHA on STRICT mode:** Drizzle ORM does not have a first-class `{ strict: true }`
table option in its current API as of early 2026. The `sqliteTable` third argument is for indexes
and constraints only. To get STRICT mode, you need one of:

**Option A (Recommended): Custom SQL in migration files**
After running `drizzle-kit generate`, edit the generated SQL to add `STRICT` at the end of the
`CREATE TABLE` statement:
```sql
CREATE TABLE `transactions` (
  `id` INTEGER PRIMARY KEY AUTOINCREMENT,
  `amount` TEXT NOT NULL,
  ...
) STRICT;
```

**Option B: Raw SQL execution at startup**
Not viable for new tables — STRICT must be declared at `CREATE TABLE` time.

**Option C: Use `sql` raw template in schema**
Drizzle allows inline SQL via `sql` tagged template literal for complex scenarios, but table-level
STRICT mode requires it at the DDL level in the migration SQL file.

**Decision for planning:** Use Option A — generate migrations with Drizzle Kit, then edit the SQL
files to add `STRICT`. This is a one-time manual step per table, tracked in version control.

### Naming convention (RECOMMENDED: snake_case for DB columns)
Use `text('column_name')` with camelCase TypeScript key — Drizzle handles the mapping:
```typescript
tradedAt: integer('traded_at', { mode: 'timestamp' })
```
This follows Drizzle best practice: snake_case in DB, camelCase in TypeScript.

### Migration workflow (RECOMMENDED: generate + migrate)
**NOT `push`** — push bypasses SQL file generation, making rollbacks impossible and losing audit trail.

```bash
# drizzle.config.ts at repo root
import { defineConfig } from 'drizzle-kit'
export default defineConfig({
  dialect: 'sqlite',
  schema: './packages/backend/src/db/schema.ts',
  out: './packages/backend/drizzle',
  dbCredentials: {
    url: './cryptax.db'
  }
})
```

```bash
# Generate migration SQL from schema changes
npx drizzle-kit generate

# Apply all pending migrations
npx drizzle-kit migrate
```

Add to root scripts: `"db:generate": "drizzle-kit generate"`, `"db:migrate": "drizzle-kit migrate"`

**Confidence: HIGH** — Drizzle docs, verified via WebFetch

### WAL mode note
`PRAGMA journal_mode = WAL` must be set BEFORE any queries. Setting it in `client.ts` at module
load time is correct. WAL allows concurrent reads without blocking writes — important for a desktop
app that might have the browser and backend both accessing the DB.

---

## 4. Decimal.js + Shared Types

### Installation
```bash
npm install decimal.js -w packages/shared
```
No type package needed — Decimal.js ships with its own TypeScript declarations.

### Shared package structure (packages/shared/src/)
```
types/
  transaction.ts    # Transaction, NormalizedTransaction interfaces
  tax.ts            # TaxSummary, FifoLot interfaces
decimal/
  money.ts          # Decimal.js wrappers, serialization helpers
index.ts            # re-exports everything
```

### Monetary pattern (packages/shared/src/decimal/money.ts)
```typescript
import Decimal from 'decimal.js'

// Configure once globally — maximum precision for crypto
Decimal.set({ precision: 36, rounding: Decimal.ROUND_HALF_UP })

/** Parse a TEXT DB value to Decimal — never throws for valid numeric strings */
export function toDecimal(value: string): Decimal {
  return new Decimal(value)
}

/** Serialize Decimal to TEXT for DB storage */
export function fromDecimal(value: Decimal): string {
  return value.toString()
}

/** Zero sentinel */
export const ZERO = new Decimal(0)
```

### Type enforcement pattern
Interfaces use `string` for monetary fields (not `number`) to enforce TEXT storage:
```typescript
export interface Transaction {
  id: number
  symbol: string
  side: 'buy' | 'sell'
  amount: string      // TEXT — Decimal.js string representation
  price: string       // TEXT
  fee: string         // TEXT
  totalValue: string  // TEXT
  tradedAt: Date
}
```

### Gotcha: No `number` for monetary at compile time
Add ESLint/Biome rule to ban `number` in specific contexts — OR document the rule in a project
`CONTRIBUTING.md` convention. TypeScript alone cannot prevent `number` assignment to `string` fields
if someone coerces types. The discipline is: always use `new Decimal(dbTextValue)` for arithmetic,
always call `.toString()` before writing back.

**Confidence: HIGH** — Decimal.js ships its own types, pattern well-established

---

## 5. Floating Lines from reactbits.dev

### What it is
FloatingLines is a WebGL canvas-based background component from the react-bits open-source project
(github.com/DavidHDev/react-bits). It renders flowing animated line waves using Three.js shaders
with:
- Multiple wave layers (top, middle, bottom) animating independently
- Gradient color support via `linesGradient` prop (array of hex strings)
- Mouse parallax / cursor-bending interaction (can be disabled)
- `ResizeObserver` for responsive sizing
- `mixBlendMode` support (e.g., `'screen'` blends over dark background)

### How to install
React-bits components are **copy-paste only** — there is no dedicated npm package for individual
components. Installation is via shadcn-style CLI or manual copy:

```bash
# Option A: shadcn CLI (installs the component source into your project)
npx shadcn@latest add @react-bits/FloatingLines

# Option B: Manual copy from GitHub
# https://github.com/DavidHDev/react-bits/tree/main/src/content/Backgrounds/FloatingLines
```

The component uses **Three.js** for WebGL rendering. The existing Aurora component uses `ogl`
(already installed). FloatingLines may require:
```bash
npm install three -w packages/frontend
npm install -D @types/three -w packages/frontend
```

**IMPORTANT DECISION POINT:** FloatingLines uses Three.js (heavyweight, ~600KB min+gz) while the
existing Aurora uses `ogl` (~13KB). Since ogl is already a dependency and the codebase has a
WebGL pattern established, there are two options:

**Option A (RECOMMENDED):** Copy the FloatingLines component source and adapt it to use `ogl`
instead of Three.js — the wave math is the same, just different WebGL API calls. This keeps bundle
size down and removes a large dependency.

**Option B:** Install Three.js as specified and use FloatingLines as-is from react-bits source.
Simpler implementation, larger bundle.

For Phase 1 (foundation), **Option B** (direct copy of react-bits FloatingLines) is simpler and
faster. Optimization is a Phase 5 concern.

### Props interface (from react-bits source analysis)
```typescript
interface FloatingLinesProps {
  enabledWaves?: { top: boolean; middle: boolean; bottom: boolean }
  lineCount?: number          // lines per wave layer, default ~20
  lineDistance?: number       // vertical spacing between lines
  animationSpeed?: number     // wave velocity, default 1.0
  bendRadius?: number         // cursor interaction radius
  bendStrength?: number       // cursor distortion intensity
  linesGradient?: string[]    // array of hex colors for line gradient
  mixBlendMode?: string       // CSS blend mode, 'screen' for dark bg
  className?: string
  style?: React.CSSProperties
}
```

### Recommended config for Cryptax dark theme
```tsx
<FloatingLines
  lineCount={30}
  animationSpeed={0.8}
  linesGradient={['#0070F2', '#354A5F', '#0070F2', '#5fdc8a']}
  mixBlendMode="screen"
  style={{ position: 'fixed', inset: 0, zIndex: 0 }}
/>
```
For per-tab variation: pass different `lineCount` or `animationSpeed` props based on active tab.

### Positioning: replace Aurora's `.aurora-bg` div
The existing App.tsx wraps Aurora in `<div className="aurora-bg">`. FloatingLines should replace
this entirely, positioned as `position: fixed; inset: 0; z-index: 0` behind the content layer.

**Confidence: MEDIUM** — Component behavior verified via GitHub repo analysis; exact prop names
need validation against copied source. The component is open source but installation method
(copy-paste vs CLI) needs testing.

---

## 6. Vitest + Coverage Setup

### Installation
```bash
npm install -D vitest @vitest/coverage-v8 jsdom -w .   # root workspace
npm install -D @testing-library/react @testing-library/user-event -w packages/frontend
```

### Root vitest.config.ts (workspace mode)
```typescript
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: 'frontend',
          include: ['packages/frontend/src/**/*.test.{ts,tsx}'],
          environment: 'jsdom',
          setupFiles: ['packages/frontend/src/test/setup.ts'],
        },
      },
      {
        extends: true,
        test: {
          name: 'backend',
          include: ['packages/backend/src/**/*.test.ts'],
          environment: 'node',
        },
      },
      {
        extends: true,
        test: {
          name: 'shared',
          include: ['packages/shared/src/**/*.test.ts'],
          environment: 'node',
        },
      },
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'lcov', 'html'],
      reportsDirectory: './coverage',
      include: ['packages/*/src/**/*.{ts,tsx}'],
      exclude: [
        '**/*.test.{ts,tsx}',
        '**/node_modules/**',
        '**/dist/**',
        '**/*.d.ts',
        '**/index.ts',         // barrel files
      ],
      thresholds: {
        lines: 80,
        branches: 80,
        functions: 80,
        statements: 80,
      },
    },
  },
})
```

**Note on thresholds:** Root vitest enforces 80% overall. Codecov enforces 90% on PR **diff** —
these are complementary. Vitest threshold fails the test run; Codecov PR diff threshold fails the
CI gate.

### Coverage format for Codecov
Codecov accepts `lcov` format. Include `lcov` in `reporter` array. The output file will be at
`./coverage/lcov.info`.

### Test structure per package
```
packages/
  backend/src/
    db/
      schema.ts
      schema.test.ts        # test schema exports, types
    routes/
      health.ts
      health.test.ts        # test route handler
  shared/src/
    decimal/
      money.ts
      money.test.ts         # test Decimal utilities
  frontend/src/
    components/
      GlassSurface/
        GlassSurface.tsx
        GlassSurface.test.tsx
    test/
      setup.ts              # @testing-library/jest-dom setup
```

**Confidence: HIGH** — Vitest docs verified via WebFetch

### Gotcha: Vitest `projects` vs old `workspaces`
In Vitest v1.x, workspace config used a separate `vitest.workspace.ts` file. In Vitest v2+,
workspace projects are configured inline in `vitest.config.ts` under `test.projects`. Use the
inline approach for new projects — the separate workspace file is still supported but the inline
approach is cleaner for monorepos.

---

## 7. GitHub Actions CI/CD Pipeline

### Main CI workflow (.github/workflows/ci.yml)
```yaml
name: CI

on:
  pull_request:
    branches: [main]
  push:
    branches: [main]

jobs:
  lint:
    name: Lint
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
          cache: 'npm'
      - run: npm ci
      - run: npx biome check .

  test:
    name: Test & Coverage
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
          cache: 'npm'
      - run: npm ci
      - run: npm test -- --coverage --run
      - name: Upload coverage to Codecov
        uses: codecov/codecov-action@v4
        with:
          token: ${{ secrets.CODECOV_TOKEN }}
          files: ./coverage/lcov.info
          fail_ci_if_error: true

  build:
    name: Build
    runs-on: ubuntu-latest
    needs: [lint, test]
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
          cache: 'npm'
      - run: npm ci
      - run: npm run build --workspaces
```

### Claude Code Action workflow (.github/workflows/claude-review.yml)
```yaml
name: Claude Code Review

on:
  pull_request:
    types: [opened, synchronize, reopened]
  pull_request_review_comment:
    types: [created]
  issue_comment:
    types: [created]

jobs:
  claude-review:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      pull-requests: write
      issues: write
    steps:
      - uses: anthropics/claude-code-action@v1
        with:
          anthropic_api_key: ${{ secrets.ANTHROPIC_API_KEY }}
          prompt: |
            Review this PR for:
            1. Correctness of monetary arithmetic (must use Decimal.js, never native number for money)
            2. Type safety (no `any`, no monetary values typed as `number`)
            3. SQL injection risks or unsafe DB queries
            4. Missing error handling in API routes
            Provide constructive feedback in German or English.
```

### Auto-labeler (.github/labeler.yml)
```yaml
frontend:
  - changed-files:
      - any-glob-to-any-file: 'packages/frontend/**'

backend:
  - changed-files:
      - any-glob-to-any-file: 'packages/backend/**'

shared:
  - changed-files:
      - any-glob-to-any-file: 'packages/shared/**'

ci:
  - changed-files:
      - any-glob-to-any-file: '.github/**'

database:
  - changed-files:
      - any-glob-to-any-file: 'packages/backend/drizzle/**'
      - any-glob-to-any-file: 'packages/backend/src/db/**'
```

Auto-labeler workflow:
```yaml
name: Pull Request Labeler
on: [pull_request_target]
jobs:
  labeler:
    permissions:
      contents: read
      pull-requests: write
    runs-on: ubuntu-latest
    steps:
      - uses: actions/labeler@v6
```

### Release-drafter (.github/release-drafter.yml)
```yaml
name-template: 'v$RESOLVED_VERSION'
tag-template: 'v$RESOLVED_VERSION'
categories:
  - title: 'Features'
    labels: ['feature', 'enhancement']
  - title: 'Bug Fixes'
    labels: ['fix', 'bug']
  - title: 'Infrastructure'
    labels: ['ci', 'database', 'shared']
change-template: '- $TITLE (#$NUMBER)'
version-resolver:
  major:
    labels: ['major']
  minor:
    labels: ['feature']
  patch:
    labels: ['fix', 'bug', 'ci']
  default: patch
template: |
  ## Changes
  $CHANGES
```

### Branch protection rules (manual GitHub UI setup — not automatable in YAML)
Settings to enable on `main`:
- Require pull request before merging
- Require status checks: `lint`, `test`, `build`
- Require branches to be up to date before merging
- Dismiss stale reviews when new commits are pushed
- Block direct pushes to main

**NOTE on Claude Code Action as blocking gate:** The `anthropics/claude-code-action@v1` posts a PR
review comment but does NOT natively block merge as a required status check. To make it blocking,
the action must be added as a required status check in branch protection settings. This requires the
job to explicitly fail (`exit 1`) or you configure it as a required check. The simpler approach is:
require CI status checks (lint/test/build) as blocking, and configure the Claude review as
informational (non-blocking) with a note that the team reviews its comments before merging. This is
the more pragmatic setup for a solo project.

**Confidence: HIGH** — verified via GitHub Actions docs, Codecov docs, claude-code-action GitHub repo

---

## 8. Linting Toolchain: Biome (RECOMMENDED)

**Decision: Use Biome v2** over ESLint + Prettier.

### Why Biome for this project
| Factor | Biome | ESLint + Prettier |
|--------|-------|-------------------|
| Performance | 10-100x faster | Slow on large TS projects |
| Config complexity | Single `biome.json` | Multiple config files |
| Monorepo support | Native nested configs in v2 | Requires per-package configs |
| TypeScript support | Built-in, no plugins needed | Requires typescript-eslint |
| Format + lint together | `biome check --write` | Two separate tools, two configs |
| The existing project uses | ESLint (dashboard/) | N/A |

The existing `dashboard/` uses ESLint with `@eslint/js` + `typescript-eslint` + react-hooks. Since
we're rebuilding clean, Biome is the better choice. Biome v2 adds type-aware rules that previously
required TypeScript compiler integration — the main reason teams stuck with ESLint.

### Root biome.json
```json
{
  "$schema": "https://biomejs.dev/schemas/2.0.0/schema.json",
  "root": true,
  "vcs": { "enabled": true, "clientKind": "git", "useIgnoreFile": true },
  "formatter": {
    "enabled": true,
    "indentStyle": "space",
    "indentWidth": 2,
    "lineWidth": 100
  },
  "linter": {
    "enabled": true,
    "rules": {
      "recommended": true,
      "suspicious": { "noExplicitAny": "error" },
      "complexity": { "noForEach": "warn" }
    }
  },
  "javascript": {
    "formatter": {
      "quoteStyle": "single",
      "trailingCommas": "es5",
      "semicolons": "always"
    }
  },
  "files": {
    "ignore": ["**/dist/**", "**/node_modules/**", "**/drizzle/**", "coverage/**"]
  }
}
```

### Installation
```bash
npm install -D @biomejs/biome -w .
```

**Confidence: MEDIUM-HIGH** — Biome v2 announced with monorepo support; exact config syntax needs
validation against biome.json schema for v2.

---

## Standard Stack

| Library | Version | Purpose | Notes |
|---------|---------|---------|-------|
| hono | ^4.x | HTTP server framework | Lightweight, fast, TypeScript-first |
| @hono/node-server | ^1.x | Node.js adapter for Hono | Required for `serve()` |
| drizzle-orm | ^0.36+ | ORM for SQLite | Type-safe, better-sqlite3 driver |
| drizzle-kit | ^0.28+ | Migration CLI | `generate` + `migrate` workflow |
| better-sqlite3 | ^9.x | SQLite driver | Synchronous, ideal for desktop app |
| decimal.js | ^10.x | Monetary arithmetic | Ships own TS types |
| concurrently | ^9.x | Run parallel npm scripts | `npm run dev` starts both servers |
| @biomejs/biome | ^2.x | Lint + format | Replaces ESLint + Prettier |
| vitest | ^3.x | Test runner | Workspace support, fast |
| @vitest/coverage-v8 | ^3.x | Coverage with V8 | Faster than Istanbul, accurate |
| @testing-library/react | ^16.x | React component testing | jsdom environment |

---

## Architecture Patterns

### API Route organization
```typescript
// packages/backend/src/routes/health.ts
import type { Hono } from 'hono'
export function registerHealthRoutes(app: Hono) {
  app.get('/api/health', (c) => c.json({ status: 'ok', ts: Date.now() }))
}

// packages/backend/src/index.ts
import { Hono } from 'hono'
import { serve } from '@hono/node-server'
import { registerHealthRoutes } from './routes/health'

const app = new Hono()
registerHealthRoutes(app)
serve({ fetch: app.fetch, port: 3001 })
```

### DB client singleton pattern
Create `packages/backend/src/db/client.ts` as a module-level singleton. Import `db` everywhere.
Do not re-create the Database connection on each request.

### Shared type boundary
What goes in `packages/shared`:
- Domain interfaces: `Transaction`, `NormalizedTransaction`, `TaxSummary`, `FifoLot`
- Decimal utilities: `toDecimal()`, `fromDecimal()`, `ZERO`
- Constants: exchange names, transaction types enum

What stays local to `packages/backend`:
- Drizzle schema (DB implementation detail)
- Route handlers
- Migration files

What stays local to `packages/frontend`:
- React components
- CSS
- Vite config

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Running multiple dev servers | Shell `&` or custom scripts | `concurrently` | Cross-platform, output labeling, kill-others flag |
| SQL migrations | Manual SQL files | Drizzle Kit `generate + migrate` | Tracked, repeatable, type-safe |
| Monetary arithmetic | `number` + `toFixed()` | `decimal.js` | Floating point errors are correctness bugs in tax software |
| Lint + format config | Two separate tool configs | Biome single config | Less config, faster, consistent |
| WAL mode per-request | Repeated PRAGMA calls | Single `pragma()` at module load | PRAGMA is session-scoped for WAL |
| SPA routing in production | Custom route handlers | `serveStatic` + fallback to `index.html` | Hono has this built in |

---

## Common Pitfalls

### Pitfall 1: TypeScript module/moduleResolution mismatch between packages
**What goes wrong:** Frontend (Vite/bundler) and backend (Node.js) need different TS module settings.
Using `"module": "NodeNext"` for the frontend breaks Vite. Using `"module": "ESNext"` for the backend
breaks Node.js native ESM.
**How to avoid:** Each package has its own `tsconfig.json`. Backend: `NodeNext`/`NodeNext`. Frontend:
`ESNext`/`Bundler`. Shared: `ESNext`/`Bundler` (consumed by bundler, not Node directly).

### Pitfall 2: `drizzle-kit push` used instead of `generate + migrate`
**What goes wrong:** `push` applies schema directly without creating migration files. Future schema
changes lose history, rollback is impossible, CI can't verify DB state.
**How to avoid:** Always use `generate` + `migrate`. Add `drizzle/` output directory to git. Never
use `push` after the first migration.

### Pitfall 3: STRICT mode not applied to SQLite tables
**What goes wrong:** SQLite without STRICT mode silently coerces types. Inserting a number into a
TEXT column works — defeating the entire purpose of TEXT monetary columns.
**How to avoid:** After `drizzle-kit generate`, manually edit each migration SQL file to add
`STRICT` to `CREATE TABLE` statements.

### Pitfall 4: `serveStatic` root path resolves from CWD
**What goes wrong:** `serveStatic({ root: '../frontend/dist' })` breaks when Node is started from
a different directory.
**How to avoid:** Use `fileURLToPath(import.meta.url)` + `resolve()` for absolute path resolution.

### Pitfall 5: Coverage reports not generated in CI format
**What goes wrong:** Vitest generates `text` report only. Codecov needs `lcov` format.
**How to avoid:** Always include `'lcov'` in the `reporter` array. Check that `lcov.info` is
generated at `./coverage/lcov.info` and matches the path in the Codecov action.

### Pitfall 6: FloatingLines Three.js dependency conflicts with ogl
**What goes wrong:** `ogl` (existing Aurora dep) and `three` can coexist but add ~600KB to bundle.
If FloatingLines is copied verbatim, Three.js must be installed.
**How to avoid:** Either install `three` as documented, or adapt the component to use `ogl` patterns
consistent with the existing codebase. The math (wave animation) is pure JS and portable.

### Pitfall 7: npm workspaces + TypeScript composite projects require `tsc -b` not `tsc`
**What goes wrong:** `tsc` (without `-b`) only compiles one package. TypeScript project references
require `tsc -b` (build mode) to compile the dependency graph in order.
**How to avoid:** Build scripts use `tsc -b` in the root. Individual packages may still use `tsc`
for their own compilation.

### Pitfall 8: Claude Code Action requires ANTHROPIC_API_KEY secret
**What goes wrong:** The workflow silently fails if the secret is not set.
**How to avoid:** Add `ANTHROPIC_API_KEY` to GitHub repository secrets before merging the workflow
file. The CI workflow should NOT hard-fail on Claude review to avoid blocking PRs when the key
expires.

---

## Code Examples

### WAL mode + foreign keys at startup
```typescript
// Source: better-sqlite3 docs + SQLite docs
const sqlite = new Database('cryptax.db')
sqlite.pragma('journal_mode = WAL')
sqlite.pragma('foreign_keys = ON')
```

### Decimal.js monetary round-trip
```typescript
// Write to DB:
const amount = new Decimal('0.00000001')  // 1 satoshi
const dbValue = amount.toString()  // '1e-8' or '0.00000001' depending on config

// Read from DB:
const restored = new Decimal(dbValue)  // exact, no floating point error

// Arithmetic:
const fee = new Decimal('0.0001')
const total = amount.plus(fee)  // Decimal arithmetic, no precision loss
```

### Hono health endpoint test (Vitest)
```typescript
// packages/backend/src/routes/health.test.ts
import { describe, it, expect } from 'vitest'
import { Hono } from 'hono'
import { registerHealthRoutes } from './health'

describe('GET /api/health', () => {
  it('returns 200 with status ok', async () => {
    const app = new Hono()
    registerHealthRoutes(app)
    const res = await app.request('/api/health')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.status).toBe('ok')
  })
})
```

### Drizzle migration file (with STRICT manually added)
```sql
-- drizzle/0000_initial.sql (generated, then edited to add STRICT)
CREATE TABLE `transactions` (
  `id` INTEGER PRIMARY KEY AUTOINCREMENT,
  `amount` TEXT NOT NULL,
  `price` TEXT NOT NULL,
  `fee` TEXT NOT NULL DEFAULT '0',
  `total_value` TEXT NOT NULL,
  `symbol` TEXT NOT NULL,
  `side` TEXT NOT NULL,
  `type` TEXT NOT NULL,
  `exchange` TEXT NOT NULL DEFAULT 'bitget',
  `traded_at` INTEGER NOT NULL,
  `imported_at` INTEGER NOT NULL,
  `source_file` TEXT,
  `raw_row` TEXT
) STRICT;
```

---

## State of the Art

| Old Approach | Current Approach | Notes |
|--------------|------------------|-------|
| ESLint + Prettier | Biome (single tool) | Biome v2 adds type-aware rules |
| vitest.workspace.ts | Inline `test.projects` in vitest.config.ts | Cleaner, v2+ |
| `drizzle-kit push` | `generate + migrate` | Audit trail, rollback capability |
| `anthropics/claude-code-action@beta` | `anthropics/claude-code-action@v1` | v1 stable since Aug 2025 |
| `codecov/codecov-action@v3` | `codecov/codecov-action@v4` | v4 uses Codecov CLI |
| `actions/labeler@v5` | `actions/labeler@v6` | Requires Node 24 runner |

---

## Open Questions

1. **Exact Drizzle STRICT table syntax**
   - What we know: Drizzle does not have a first-class `strict: true` option in `sqliteTable`
   - What's unclear: Whether this was added in a recent minor release (0.36+)
   - Recommendation: Check `drizzle-orm/sqlite-core` `sqliteTable` type signature. If not available,
     use the "edit generated SQL" approach documented above.

2. **FloatingLines Three.js vs ogl**
   - What we know: react-bits FloatingLines uses Three.js; existing Aurora uses ogl
   - What's unclear: Exact npm install command (Three.js has ESM/CJS split), and whether react-bits
     CLI installation works for this component
   - Recommendation: Try `npx shadcn@latest add @react-bits/FloatingLines` first. Fall back to manual
     copy from GitHub source if CLI fails.

3. **Biome v2 exact config schema**
   - What we know: Biome v2 released with monorepo nested config support
   - What's unclear: Whether `"root": true` at project level is exactly correct vs `"extends": "//"`
   - Recommendation: Run `npx @biomejs/biome@2 init` to generate the baseline config, then customize.

4. **Codecov PR diff threshold configuration**
   - What we know: Codecov enforces coverage on PR diff via its web UI settings
   - What's unclear: Whether the 90% diff threshold requires a `codecov.yml` file in the repo or is
     configured only in the Codecov web dashboard
   - Recommendation: Create a `codecov.yml` at repo root:
     ```yaml
     coverage:
       precision: 2
       round: down
       range: "70...100"
       status:
         patch:
           default:
             target: 90%
             threshold: 5%
         project:
           default:
             target: 80%
     ```

---

## Sources

### Primary (HIGH confidence)
- Hono official docs (hono.dev/docs/getting-started/nodejs) — server setup, serveStatic
- Vite docs (vite.dev/config/server-options) — proxy configuration
- Drizzle ORM docs (orm.drizzle.team) — better-sqlite3 setup, schema, migrations, kit
- Vitest docs (vitest.dev) — workspace/projects config, coverage
- GitHub Anthropic (github.com/anthropics/claude-code-action) — action v1 usage guide
- release-drafter GitHub — release-drafter@v7 workflow
- actions/labeler GitHub — labeler@v6 workflow
- Biome docs (biomejs.dev) — v2 monorepo config

### Secondary (MEDIUM confidence)
- react-bits GitHub (github.com/DavidHDev/react-bits) — FloatingLines component behavior, props
- Codecov docs — codecov-action@v4 setup

### Tertiary (LOW confidence)
- TypeScript project references — based on official pattern docs but some specifics from training
- Drizzle STRICT mode workaround — based on known Drizzle SQLite dialect behavior

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all packages verified against official docs
- Architecture patterns: HIGH — derived from official library patterns
- Pitfalls: MEDIUM-HIGH — verified from official docs + known SQLite/Drizzle behaviors
- Floating Lines: MEDIUM — component source analyzed but exact API needs testing
- STRICT table workaround: MEDIUM — based on Drizzle SQLite dialect knowledge

**Research date:** 2026-03-21
**Valid until:** 2026-04-21 (30 days — stable tech stack)
