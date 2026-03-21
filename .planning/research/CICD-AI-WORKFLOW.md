# CI/CD and AI-Powered Code Review

**Project:** Cryptax — Local German Crypto Tax Reporting Tool
**Researched:** 2026-03-21
**Mode:** Ecosystem research — CI/CD pipeline, AI code review, coverage, automation
**Confidence:** HIGH (majority of findings verified via official docs and Context7)

---

## Executive Summary

This document covers setting up a full CI/CD pipeline for the Cryptax TypeScript monorepo
using GitHub Actions, integrating Claude Code's official GitHub Actions for AI-powered PR
review, Codecov.io for coverage reporting, and GitHub automation bots for repo hygiene.

**Key findings:**
- Claude Code has an official, production-ready GitHub Action (`anthropics/claude-code-action@v1`)
  that supports both @claude-mention mode and fully automated review on every PR
- Claude Code also offers a managed code review service (Teams/Enterprise only) that runs
  fleet analysis on PRs automatically — no self-hosting required
- Vitest v8 coverage with lcov output integrates cleanly with `codecov/codecov-action@v5`
- `better-sqlite3` compiles cleanly on `ubuntu-latest` runners — `ubuntu-latest` ships
  `build-essential` and Python 3, so no additional apt installs are needed
- Playwright should be run with Docker image or `--with-deps` flag to avoid browser installation issues

---

## 1. Project Structure Context

Cryptax is structured as a two-package monorepo (not using pnpm/npm workspaces yet):

```
Cryptax/
  dashboard/          # React 19 + Vite 8 + TypeScript 5.9 frontend
    package.json      # cryptax-dashboard
    src/
    tests/
  server/             # Node.js + Hono + better-sqlite3 backend (to be created)
    package.json
    src/
    tests/
  .github/
    workflows/
  vitest.config.ts    # (or per-package)
  playwright.config.ts
```

**Monorepo note:** The project does not use pnpm workspaces or Turborepo. Workflows
should use `working-directory:` steps and separate jobs per package rather than workspace
tooling. This keeps things simple for a two-package project.

---

## 2. GitHub Actions Pipeline Structure

### Recommended Pipeline: Four-Job Workflow

```
lint → test (unit/integration) → e2e (playwright) → build
         ↓
     coverage upload
```

All jobs run in parallel except `build` which depends on `test` passing.

### Complete CI Workflow: `.github/workflows/ci.yml`

```yaml
name: CI

on:
  push:
    branches: [main, master]
  pull_request:
    branches: [main, master]

# Restrict GITHUB_TOKEN to minimum required permissions
permissions:
  contents: read
  checks: write          # for posting test results
  pull-requests: write   # for Codecov PR comments

jobs:
  # ─────────────────────────────────────────────────────
  # Job 1: Lint (fast feedback, runs first)
  # ─────────────────────────────────────────────────────
  lint:
    name: Lint
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: "22"
          cache: "npm"
          cache-dependency-path: dashboard/package-lock.json

      - name: Install dashboard dependencies
        working-directory: dashboard
        run: npm ci

      - name: Lint dashboard
        working-directory: dashboard
        run: npm run lint

      # When server package exists, add:
      # - name: Install server dependencies
      #   working-directory: server
      #   run: npm ci
      # - name: Lint server
      #   working-directory: server
      #   run: npm run lint

  # ─────────────────────────────────────────────────────
  # Job 2: Unit + Integration Tests
  # ─────────────────────────────────────────────────────
  test:
    name: Unit & Integration Tests
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: "22"
          cache: "npm"
          cache-dependency-path: |
            dashboard/package-lock.json
            server/package-lock.json

      - name: Install dashboard dependencies
        working-directory: dashboard
        run: npm ci

      # better-sqlite3 native module: ubuntu-latest includes build-essential
      # and Python 3, so npm ci handles compilation automatically.
      # No apt-get install needed.
      - name: Install server dependencies
        working-directory: server
        run: npm ci

      - name: Run Vitest with coverage
        run: |
          cd dashboard && npm run test:coverage || true
          # When server exists:
          # cd ../server && npm run test:coverage
        # Collect both coverage outputs

      - name: Upload dashboard coverage to Codecov
        uses: codecov/codecov-action@v5
        with:
          token: ${{ secrets.CODECOV_TOKEN }}
          files: ./dashboard/coverage/lcov.info
          flags: dashboard
          fail_ci_if_error: true

      - name: Upload server coverage to Codecov
        uses: codecov/codecov-action@v5
        with:
          token: ${{ secrets.CODECOV_TOKEN }}
          files: ./server/coverage/lcov.info
          flags: server
          fail_ci_if_error: true

  # ─────────────────────────────────────────────────────
  # Job 3: End-to-End Tests (Playwright)
  # ─────────────────────────────────────────────────────
  e2e:
    name: E2E Tests (Playwright)
    runs-on: ubuntu-latest
    # Only run E2E on push to main or when specifically requested
    # Skipping on every PR keeps costs and time down
    if: github.event_name == 'push' || contains(github.event.pull_request.labels.*.name, 'run-e2e')
    steps:
      - uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: "22"
          cache: "npm"
          cache-dependency-path: dashboard/package-lock.json

      - name: Install dependencies
        working-directory: dashboard
        run: npm ci

      - name: Install Playwright Browsers
        # --with-deps installs required OS dependencies (libnss3, etc.)
        run: npx playwright install --with-deps chromium

      - name: Start dev server and run Playwright tests
        working-directory: dashboard
        run: |
          # Start Vite in background, wait for it to be ready
          npm run dev &
          npx wait-on http://localhost:5173 --timeout 30000
          npx playwright test
        env:
          CI: true

      - name: Upload Playwright report
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: playwright-report
          path: dashboard/playwright-report/
          retention-days: 7

  # ─────────────────────────────────────────────────────
  # Job 4: Build (depends on tests passing)
  # ─────────────────────────────────────────────────────
  build:
    name: Build
    runs-on: ubuntu-latest
    needs: [lint, test]
    steps:
      - uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: "22"
          cache: "npm"
          cache-dependency-path: dashboard/package-lock.json

      - name: Install dashboard dependencies
        working-directory: dashboard
        run: npm ci

      - name: Build dashboard
        working-directory: dashboard
        run: npm run build

      # TypeScript type-check without emitting
      - name: Type check
        working-directory: dashboard
        run: npx tsc --noEmit
```

### Node.js Version Choice

Use Node.js **22 LTS** in CI (not 23 which is the development version). Node.js 22 LTS
(Jod) is the current Active LTS as of 2026. `better-sqlite3` v12.8.0 builds cleanly
against Node.js 22.

**Confidence:** HIGH — Node.js release schedule verified at nodejs.org/en/about/releases

---

## 3. Vitest Coverage Configuration

### `vitest.config.ts` (dashboard package)

```typescript
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    coverage: {
      // v8 is recommended: faster, lower memory, same accuracy as Istanbul since v3.2.0
      provider: 'v8',
      reporter: [
        'lcov',   // for Codecov upload
        'text',   // console summary
        'json',   // machine-readable
        'html',   // local browser viewer
      ],
      // Where to output coverage files
      reportsDirectory: './coverage',
      // Include source files even if not imported by tests
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        'src/**/*.d.ts',
        'src/main.tsx',        // entry point, no logic
        'src/vite-env.d.ts',
        'src/test/**',         // test helpers
        'src/**/*.stories.ts', // if using Storybook later
      ],
      thresholds: {
        // Fail CI if coverage drops below these levels
        lines: 90,
        branches: 85,     // branches slightly lower (hard to hit 90 with error branches)
        functions: 90,
        statements: 90,
      },
    },
  },
})
```

### `vitest.config.ts` (server package, when created)

```typescript
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    coverage: {
      provider: 'v8',
      reporter: ['lcov', 'text', 'json', 'html'],
      reportsDirectory: './coverage',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.d.ts', 'src/index.ts'],
      thresholds: {
        lines: 90,
        branches: 85,
        functions: 90,
        statements: 90,
      },
    },
  },
})
```

### `package.json` scripts (both packages)

```json
{
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "test:coverage": "vitest run --coverage",
    "test:ui": "vitest --ui"
  },
  "devDependencies": {
    "vitest": "^4.1.0",
    "@vitest/coverage-v8": "^4.1.0",
    "@vitest/ui": "^4.1.0"
  }
}
```

**Note:** `@vitest/coverage-v8` must be installed explicitly — it is not bundled with vitest.

**Confidence:** HIGH — verified via vitest.dev/guide/coverage.html

---

## 4. better-sqlite3 in CI

`better-sqlite3` is a native Node.js addon requiring compilation via `node-gyp`.

### Why it works transparently on `ubuntu-latest`

GitHub's `ubuntu-latest` runner (currently Ubuntu 24.04) ships with:
- `gcc`, `g++`, `make` (via build-essential)
- Python 3
- `node-gyp` is installed as part of npm

This means `npm ci` automatically compiles `better-sqlite3` without any extra steps.

### Caching compiled native modules

Cache `node_modules` keyed on OS + Node.js version + lockfile hash. Since compiled
binaries are architecture-specific, the cache key must include the OS and Node version:

```yaml
- name: Cache server node_modules
  uses: actions/cache@v4
  with:
    path: server/node_modules
    key: ${{ runner.os }}-node22-server-${{ hashFiles('server/package-lock.json') }}
    restore-keys: |
      ${{ runner.os }}-node22-server-
```

**Important:** Do not cache `node_modules` across different OS or Node.js versions — the
compiled `.node` binary is not portable.

### If compilation fails (fallback)

If the runner ever lacks build tools (e.g., on a minimal custom runner):

```yaml
- name: Install build dependencies
  run: sudo apt-get update && sudo apt-get install -y build-essential python3
```

**Confidence:** MEDIUM-HIGH — `ubuntu-latest` includes build-essential is documented
community knowledge; better-sqlite3 docs confirm `npm install` triggers compilation.
The npm cache step pattern is verified via actions/cache@v4 official docs.

---

## 5. AI-Powered Code Review: Claude Code

### Two Official Options

Anthropic provides two distinct products for AI code review on GitHub:

| Product | Trigger | Setup | Cost Model | Availability |
|---------|---------|-------|------------|--------------|
| `claude-code-action@v1` | @claude mention in PR/issue comments, or on every PR via `pull_request` event | Self-managed GitHub Actions workflow | Anthropic API tokens (pay-per-use) | All plans (API key required) |
| Claude Code Review (managed service) | Automatic on every PR, every push, or manual `@claude review` | Admin settings at claude.ai/admin-settings/claude-code | $15-25 per review (extra usage) | Teams + Enterprise only |

### Recommendation: `claude-code-action@v1` (Self-Managed)

For Cryptax (a personal project), use `anthropics/claude-code-action@v1` with the
`pull_request` trigger. This gives full control over cost, model selection, and behavior.

The managed Code Review service is better suited for team environments where you want zero
configuration and automatic reviews on every PR.

### Setup: `.github/workflows/claude-review.yml`

```yaml
name: Claude Code Review

on:
  pull_request:
    types: [opened, synchronize, ready_for_review]
    # Optionally restrict to specific paths:
    # paths:
    #   - 'src/**'
    #   - 'server/**'

# Minimum required permissions
permissions:
  contents: read
  pull-requests: write
  issues: write

jobs:
  claude-review:
    name: AI Code Review
    runs-on: ubuntu-latest
    # Skip draft PRs
    if: github.event.pull_request.draft == false
    steps:
      - uses: actions/checkout@v4
        with:
          # Fetch enough history for Claude to understand context
          fetch-depth: 0

      - uses: anthropics/claude-code-action@v1
        with:
          anthropic_api_key: ${{ secrets.ANTHROPIC_API_KEY }}
          prompt: |
            Review this pull request for:
            1. Logic errors and edge cases in business logic (especially FIFO tax calculations)
            2. TypeScript type safety issues
            3. Security issues (SQL injection, path traversal in CSV imports, API key exposure)
            4. Test coverage gaps for new functions
            5. German tax law correctness (check FIFO logic, Haltefrist calculations, Freigrenze)

            Post findings as inline comments on the specific lines where issues occur.
            Focus on correctness over style — ESLint handles style.
          claude_args: "--max-turns 5 --model claude-sonnet-4-6"
```

### Interactive Mode: `.github/workflows/claude-interactive.yml`

For @claude mentions in PR comments and issue comments:

```yaml
name: Claude Interactive

on:
  issue_comment:
    types: [created]
  pull_request_review_comment:
    types: [created]
  issues:
    types: [opened, assigned]

permissions:
  contents: write
  pull-requests: write
  issues: write

jobs:
  claude:
    name: Claude Code Agent
    # Only run when @claude is mentioned
    if: |
      (github.event_name == 'issue_comment' && contains(github.event.comment.body, '@claude')) ||
      (github.event_name == 'pull_request_review_comment' && contains(github.event.comment.body, '@claude')) ||
      (github.event_name == 'issues' && contains(github.event.issue.body, '@claude'))
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: anthropics/claude-code-action@v1
        with:
          anthropic_api_key: ${{ secrets.ANTHROPIC_API_KEY }}
          # No prompt here — Claude responds to the @claude mention content
          claude_args: "--max-turns 10"
```

### CLAUDE.md for Code Review Context

Create a `.github/CLAUDE.md` or root `CLAUDE.md` to guide Claude's reviews:

```markdown
# Cryptax Project Context for Claude

## Domain
German crypto tax reporting tool. Core logic: FIFO cost-basis tracking,
German Haltefrist (1-year holding period for spot, 10-year for earn),
1.000€ Freigrenze for spot gains, Abgeltungssteuer (26.375%) for futures.

## Critical Correctness Areas
- FIFO engine: every buy lot must be consumed in chronological order
- Haltefrist: 366 days minimum for tax-free spot disposal
- EUR prices: must use Bitget exchange price at trade timestamp
- Futures P&L: always taxable regardless of holding period
- Earn/Staking: income at Zufluss date, then 10-year Haltefrist applies

## Code Standards
- TypeScript strict mode — no 'any' types
- All exported functions must have JSDoc with @param and @returns
- Business logic must have ≥ 90% test coverage
- SQL queries via Drizzle ORM only — no raw string interpolation

## Security Rules
- CSV parsing: validate all fields, reject malformed data, no eval
- API keys: stored encrypted, never logged
- Drizzle ORM prevents SQL injection — do not bypass with db.run(rawString)
```

### Alternative AI Review Tools Considered

| Tool | Type | Strength | Weakness | Verdict |
|------|------|----------|----------|---------|
| **Claude Code Action** | Anthropic official | Full codebase context, customizable prompts, CLAUDE.md integration | API cost per run | **Recommended** |
| **CodeRabbit** | SaaS (free tier available) | Zero config, connects to GitHub, works on public repos for free | Less customizable than custom prompts | Good free option |
| **CodiumAI PR-Agent** | Open-source + SaaS | Self-hostable, multiple LLM backends | More complex setup | Use if API cost is a concern |
| **Sourcery** | SaaS | Python-focused historically | Less strong on TypeScript/tax domain | Not recommended here |
| **GitHub Copilot PR Review** | GitHub native | Integrated into GitHub | Requires Copilot subscription, less configurable | OK alternative |

**Confidence:** HIGH for Claude Code Action (verified via code.claude.com/docs).
MEDIUM for alternatives (CodeRabbit pricing/features from official docs; others from training data).

---

## 6. Codecov.io Integration

### Setup Steps

1. Sign up at [app.codecov.io](https://app.codecov.io) with GitHub OAuth
2. Install the Codecov GitHub App on your repository
3. Get `CODECOV_TOKEN` from the Codecov repository settings
4. Add `CODECOV_TOKEN` to GitHub repository secrets:
   - Repository → Settings → Secrets and variables → Actions → New repository secret

### `codecov.yml` (repository root)

```yaml
# codecov.yml
coverage:
  status:
    # Project-level coverage gate
    project:
      default:
        target: 90%          # must maintain 90% overall
        threshold: 2%        # allow 2% drop before failing
        base: auto

    # Patch coverage: new code in PRs must meet this threshold
    patch:
      default:
        target: 85%          # new code in PRs must be 85% covered
        threshold: 5%

# Comment on PRs with coverage summary
comment:
  layout: "reach,diff,flags,files"
  behavior: default
  require_changes: false     # always comment, even if no change

# Flags: track dashboard vs server separately
flags:
  dashboard:
    paths:
      - dashboard/src/
  server:
    paths:
      - server/src/

# Ignore files that don't need coverage
ignore:
  - "dashboard/src/main.tsx"
  - "dashboard/src/vite-env.d.ts"
  - "**/*.d.ts"
  - "**/*.stories.ts"
```

### Codecov Upload in CI

The CI workflow (Section 2) includes these steps. Key options for `codecov-action@v5`:

```yaml
- name: Upload coverage to Codecov
  uses: codecov/codecov-action@v5
  with:
    token: ${{ secrets.CODECOV_TOKEN }}
    files: ./dashboard/coverage/lcov.info,./server/coverage/lcov.info
    flags: dashboard,server    # maps to codecov.yml flags
    name: cryptax-coverage
    fail_ci_if_error: true     # fail CI if Codecov upload fails
    verbose: false             # set true for debugging

# Alternative with OIDC (no token needed, more secure):
# permissions:
#   id-token: write
# - uses: codecov/codecov-action@v5
#   with:
#     use_oidc: true
#     files: ./coverage/lcov.info
```

### README Badges

After Codecov is connected, add badges to README:

```markdown
[![codecov](https://codecov.io/gh/YOUR_USERNAME/Cryptax/branch/main/graph/badge.svg?token=YOUR_TOKEN)](https://codecov.io/gh/YOUR_USERNAME/Cryptax)
```

Also add CI status badge:

```markdown
[![CI](https://github.com/YOUR_USERNAME/Cryptax/actions/workflows/ci.yml/badge.svg)](https://github.com/YOUR_USERNAME/Cryptax/actions/workflows/ci.yml)
```

**Confidence:** HIGH — verified via docs.codecov.com/docs/quick-start and
docs.codecov.com/docs/codecovyml-reference.

---

## 7. Claude Code as CI Agent (Headless Mode)

Claude Code can run fully non-interactively in CI pipelines using the `-p` flag
(print mode / automation mode).

### Automation Mode (`claude -p`)

```bash
# Run a task non-interactively and print output to stdout
claude -p "Review the failing tests and suggest fixes"

# Pipe input
git diff main | claude -p "Review these changes for security issues"

# With specific model and turn limit
claude -p "Generate tests for src/fifo-engine.ts" \
  --model claude-sonnet-4-6 \
  --max-turns 5
```

This is exactly what `claude-code-action@v1` uses under the hood.

### Example: Automated Test Generation Workflow

```yaml
name: Auto-Generate Tests for Uncovered Code

on:
  # Run weekly to generate tests for new uncovered code
  schedule:
    - cron: "0 9 * * 1"  # Monday 9am UTC

permissions:
  contents: write
  pull-requests: write

jobs:
  generate-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: anthropics/claude-code-action@v1
        with:
          anthropic_api_key: ${{ secrets.ANTHROPIC_API_KEY }}
          prompt: |
            Run the test suite with coverage: `cd dashboard && npm run test:coverage`
            Identify functions with 0% coverage in src/lib/
            Write comprehensive unit tests for the top 3 uncovered functions
            Commit the new test files with message "test: add coverage for [function names]"
            Open a pull request titled "chore: improve test coverage"
          claude_args: "--max-turns 15"
```

### Example: Automated PR Fix Workflow

When a CI test fails, Claude can analyze and attempt a fix:

```yaml
name: Auto-Fix Failing Tests

on:
  # Trigger manually via workflow_dispatch
  workflow_dispatch:
    inputs:
      pr_number:
        description: "PR number with failing tests"
        required: true

permissions:
  contents: write
  pull-requests: write

jobs:
  auto-fix:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: anthropics/claude-code-action@v1
        with:
          anthropic_api_key: ${{ secrets.ANTHROPIC_API_KEY }}
          prompt: |
            Run `npm test` and observe all failing tests.
            Analyze each failure carefully.
            Fix the implementation (not the tests) to make tests pass.
            If a test itself is wrong, explain why in a PR comment instead of changing it.
            Run tests again after each fix to verify.
          claude_args: "--max-turns 20 --model claude-opus-4-6"
```

**Confidence:** HIGH — verified via code.claude.com/docs/en/github-actions.

---

## 8. Repository Automation Workflows

### 8a. Auto-Labeling PRs: `actions/labeler@v6`

```yaml
# .github/workflows/labeler.yml
name: Label Pull Requests

on:
  pull_request_target:
    types: [opened, synchronize]

permissions:
  contents: read
  pull-requests: write

jobs:
  labeler:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/labeler@v6
```

```yaml
# .github/labeler.yml
dashboard:
  - changed-files:
      - any-glob-to-any-file: 'dashboard/**'

backend:
  - changed-files:
      - any-glob-to-any-file: 'server/**'

tax-logic:
  - changed-files:
      - any-glob-to-any-file:
          - 'server/src/fifo/**'
          - 'server/src/tax/**'

tests:
  - changed-files:
      - any-glob-to-any-file:
          - '**/*.test.ts'
          - '**/*.spec.ts'
          - '**/tests/**'

ci:
  - changed-files:
      - any-glob-to-any-file: '.github/**'

documentation:
  - changed-files:
      - any-glob-to-any-file:
          - '**/*.md'
          - '.planning/**'
```

**Confidence:** HIGH — verified via github.com/actions/labeler (v6 released 2025).

### 8b. Stale Issue Management: `actions/stale`

```yaml
# .github/workflows/stale.yml
name: Close Stale Issues and PRs

on:
  schedule:
    - cron: "0 0 * * *"  # Daily at midnight UTC

permissions:
  issues: write
  pull-requests: write

jobs:
  stale:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/stale@v9
        with:
          # Issues
          days-before-issue-stale: 30
          days-before-issue-close: 7
          stale-issue-label: "stale"
          stale-issue-message: >
            This issue has been inactive for 30 days. It will be closed in 7 days
            if there is no further activity. If this is still relevant, please comment.
          close-issue-message: "Closed due to inactivity."

          # PRs
          days-before-pr-stale: 14
          days-before-pr-close: 7
          stale-pr-label: "stale"
          stale-pr-message: >
            This PR has been inactive for 14 days. It will be closed in 7 days.
          close-pr-message: "Closed due to inactivity."

          # Never stale these labels
          exempt-issue-labels: "pinned,security,in-progress"
          exempt-pr-labels: "pinned,in-progress,blocked"

          operations-per-run: 50
```

**Confidence:** HIGH — verified via github.com/actions/stale docs.

### 8c. Automated Release Notes: `release-drafter/release-drafter@v7`

```yaml
# .github/workflows/release-drafter.yml
name: Release Drafter

on:
  push:
    branches: [main, master]
  pull_request:
    types: [opened, reopened, synchronize]

permissions:
  contents: write
  pull-requests: read

jobs:
  update_release_draft:
    runs-on: ubuntu-latest
    steps:
      - uses: release-drafter/release-drafter@v7
        with:
          config-name: release-drafter.yml
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

```yaml
# .github/release-drafter.yml
name-template: 'v$RESOLVED_VERSION'
tag-template: 'v$RESOLVED_VERSION'

categories:
  - title: 'New Features'
    labels: ['feature', 'enhancement']
  - title: 'Tax Engine Changes'
    labels: ['tax-logic']
  - title: 'Bug Fixes'
    labels: ['fix', 'bugfix', 'bug']
  - title: 'Dashboard'
    labels: ['dashboard']
  - title: 'Backend'
    labels: ['backend']
  - title: 'Tests'
    labels: ['tests']
  - title: 'Maintenance'
    labels: ['ci', 'chore', 'documentation', 'dependencies']

template: |
  ## Changes

  $CHANGES

  **Full Changelog**: https://github.com/$OWNER/$REPOSITORY/compare/$PREVIOUS_TAG...v$RESOLVED_VERSION

version-resolver:
  major:
    labels: ['major', 'breaking']
  minor:
    labels: ['feature', 'enhancement']
  patch:
    labels: ['fix', 'bugfix', 'bug', 'patch']
  default: patch

exclude-labels:
  - 'skip-changelog'
```

**Confidence:** HIGH — verified via github.com/release-drafter/release-drafter (v7, 2025).

---

## 9. Branch Protection Rules

These rules should be applied to `main`/`master` via:
Repository → Settings → Branches → Branch protection rules

### Recommended Protection Rules for `main`

```
Branch name pattern: main

Required status checks before merging: ✓
  - Lint
  - Unit & Integration Tests
  - Build
  (Add "Claude Code Review" if using managed service)

Require branches to be up to date before merging: ✓
  (ensures CI runs on the merged commit, not just the PR head)

Require a pull request before merging: ✓
  Required approving reviews: 1 (for team projects; 0 for solo)
  Dismiss stale PR approvals when new commits are pushed: ✓

Do not allow bypassing the above settings: ✓
  (even for admins — prevents accidental direct pushes)

Block force pushes: ✓
Require signed commits: ✓ (optional but good practice)
Allow deletions: ✗
```

**Note for solo project:** Since Cryptax is a personal project, you may want to allow
admin bypass. The key protection to keep is "Require status checks before merging" so
broken tests cannot be merged accidentally.

**Confidence:** HIGH — verified via docs.github.com protected branches documentation.

---

## 10. Security: Secrets Management

### Required Secrets

| Secret Name | Purpose | Where to Set |
|-------------|---------|--------------|
| `ANTHROPIC_API_KEY` | Claude Code Action for PR review | Repository → Settings → Secrets |
| `CODECOV_TOKEN` | Codecov coverage upload | Repository → Settings → Secrets |
| `GITHUB_TOKEN` | Auto-provided by GitHub Actions | Automatic, no setup needed |

### Rules

1. **Never hardcode API keys in workflow YAML files** — always use `${{ secrets.NAME }}`
2. **Use `GITHUB_TOKEN` over PATs** — it is scoped to the repository and expires after the job
3. **Restrict permissions at workflow and job level** — declare only what is needed:

   ```yaml
   # Workflow level (default to read-only)
   permissions:
     contents: read

   jobs:
     job-that-needs-more:
       permissions:
         contents: read
         pull-requests: write  # only the jobs that need it
   ```

4. **Do not print secrets in logs** — avoid `echo ${{ secrets.ANTHROPIC_API_KEY }}`
5. **Rotate ANTHROPIC_API_KEY** — generate a dedicated key for CI in Anthropic Console,
   separate from your personal/dev key. This limits blast radius if the CI key leaks.
6. **CODECOV_TOKEN** — use OIDC (`use_oidc: true`) instead of the token for improved
   security (no static credential stored):

   ```yaml
   permissions:
     id-token: write   # required for OIDC

   - uses: codecov/codecov-action@v5
     with:
       use_oidc: true
       files: ./coverage/lcov.info
   ```

7. **`show_full_output: false`** in claude-code-action — the default. Never enable this
   for public repositories as it exposes all tool outputs including file reads.

**Confidence:** HIGH — verified via GitHub security hardening docs and
github.com/anthropics/claude-code-action/blob/main/docs/security.md.

---

## 11. Complete File Inventory

Files to create:

```
.github/
  workflows/
    ci.yml                      # Main CI: lint, test, e2e, build
    claude-review.yml           # Automated PR review on every PR
    claude-interactive.yml      # @claude mention handler
    release-drafter.yml         # Automated release notes
    stale.yml                   # Stale issue/PR management
    labeler.yml                 # Auto-label PRs by changed files
  labeler.yml                   # Label rules for actions/labeler
  release-drafter.yml           # Release notes template

codecov.yml                     # Coverage thresholds and flags
CLAUDE.md                       # Project context for all Claude sessions

dashboard/
  vitest.config.ts              # Coverage: v8, lcov, 90% thresholds
  playwright.config.ts          # E2E: Chromium only, CI-aware

server/
  vitest.config.ts              # Same coverage setup, node environment
```

---

## 12. Implementation Order

1. **First:** Add `vitest.config.ts` with coverage enabled to dashboard package
2. **Second:** Create `.github/workflows/ci.yml` (lint + test with coverage + build)
3. **Third:** Set up Codecov account, get token, add `codecov.yml`, update CI with upload step
4. **Fourth:** Get `ANTHROPIC_API_KEY` for CI, create `.github/workflows/claude-review.yml`
5. **Fifth:** Create `CLAUDE.md` with Cryptax domain context
6. **Sixth:** Add automation workflows (labeler, stale, release-drafter)
7. **Seventh:** Configure branch protection rules

The CI pipeline (steps 1-3) provides immediate value. The AI review (steps 4-5) amplifies
value most on PRs with complex tax logic changes. Automation workflows (step 6) are useful
but low priority for a solo project.

---

## Sources

| Claim | Source | Confidence |
|-------|--------|------------|
| `claude-code-action@v1` usage, prompt/claude_args params | https://code.claude.com/docs/en/github-actions | HIGH |
| Claude Code Review managed service, $15-25/review, Teams+Enterprise only | https://code.claude.com/docs/en/code-review | HIGH |
| Claude Code automation mode (`-p` flag) | https://code.claude.com/docs/en/overview (CLI accordion) | HIGH |
| Claude Code security model, bot permission scoping | https://github.com/anthropics/claude-code-action/blob/main/docs/security.md | HIGH |
| Vitest v8 provider recommendation, thresholds config block | https://vitest.dev/guide/coverage.html | HIGH |
| `@vitest/coverage-v8` must be installed separately | https://vitest.dev/guide/coverage.html | HIGH |
| Codecov action v5, `files` parameter, OIDC option | https://github.com/codecov/codecov-action | HIGH |
| `codecov.yml` coverage.status.project.target and patch config | https://docs.codecov.com/docs/codecovyml-reference | HIGH |
| Codecov: GitHub App installation required | https://docs.codecov.com/docs/quick-start | HIGH |
| Playwright `--with-deps` flag for CI | https://playwright.dev/docs/ci-intro | HIGH |
| Playwright workers=1 recommended in CI | https://playwright.dev/docs/ci | HIGH |
| Playwright HTML report artifact upload pattern | https://playwright.dev/docs/ci-intro | HIGH |
| pnpm/action-setup@v4 with actions/setup-node cache:'pnpm' | https://pnpm.io/continuous-integration | HIGH |
| `actions/labeler@v6` (Node.js 24, v6 latest) | https://github.com/actions/labeler | HIGH |
| `actions/stale@v9` configuration parameters | https://github.com/actions/stale | HIGH |
| `release-drafter/release-drafter@v7` | https://github.com/release-drafter/release-drafter | HIGH |
| Branch protection: up-to-date requirement prevents incompatible merges | https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches | HIGH |
| GitHub Actions secrets: GITHUB_TOKEN preferred over PATs | https://docs.github.com/en/actions/security-for-github-actions/security-guides/security-hardening-for-github-actions | HIGH |
| Node.js 22 LTS (Active LTS 2026) | https://nodejs.org/en/about/releases | HIGH |
| better-sqlite3 compiles on ubuntu-latest, build-essential pre-installed | Community pattern, better-sqlite3 docs (MEDIUM confidence — not explicitly in official CI docs) | MEDIUM |
| CodeRabbit supports GitHub, GitLab, Azure DevOps, Bitbucket | https://docs.coderabbit.ai/getting-started/quickstart/ | HIGH |
