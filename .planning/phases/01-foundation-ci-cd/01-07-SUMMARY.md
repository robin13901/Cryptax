---
phase: 01-foundation-ci-cd
plan: 07
subsystem: infra
tags: [github-actions, ci-cd, biome, vitest, codecov, claude-code-action, release-drafter, labeler]

# Dependency graph
requires:
  - phase: 01-foundation-ci-cd/01-06
    provides: "Vitest workspace + coverage generating lcov.info at ./coverage/lcov.info, npm test works at root"
  - phase: 01-foundation-ci-cd/01-01
    provides: "Biome 2.4.8 configured with biome.json, npx biome check . command available"
  - phase: 01-foundation-ci-cd/01-03
    provides: "npm workspaces structure, npm run build --workspaces command"
provides:
  - "GitHub Actions CI workflow (lint -> test -> build) gating PRs to main"
  - "Codecov integration uploading ./coverage/lcov.info on every CI run"
  - "Claude Code Action reviewing every PR with Cryptax-specific prompt"
  - "Auto-labeler assigning frontend/backend/shared/ci/database/testing labels by file path"
  - "Release-drafter generating changelog from PR labels"
affects: [02-transaction-ingestion, 03-fifo-engine, 04-tax-rules, 05-reporting-dashboard, 06-exchange-api, 07-security-hardening]

# Tech tracking
tech-stack:
  added:
    - "actions/checkout@v4 (GitHub Actions checkout)"
    - "actions/setup-node@v4 (Node.js setup with npm cache)"
    - "codecov/codecov-action@v4 (coverage upload)"
    - "anthropics/claude-code-action@v1 (AI PR review)"
    - "actions/labeler@v5 (auto-label by file path)"
    - "release-drafter/release-drafter@v6 (changelog generation)"
  patterns:
    - "CI jobs split into lint/test/build — build depends on lint+test passing first"
    - "fail_ci_if_error: false on Codecov — graceful degradation if Codecov unreachable"
    - "pull_request_target for labeler (has write permissions to fork PRs)"
    - "GITHUB_TOKEN for release-drafter; CODECOV_TOKEN + ANTHROPIC_API_KEY from repo secrets"

key-files:
  created:
    - ".github/workflows/ci.yml"
    - ".github/workflows/claude-review.yml"
    - ".github/workflows/labeler.yml"
    - ".github/workflows/release-drafter.yml"
    - ".github/labeler.yml"
    - ".github/release-drafter.yml"
  modified: []

key-decisions:
  - "01-07: codecov/codecov-action@v4 with fail_ci_if_error: false — CI does not hard-fail if Codecov is unreachable"
  - "01-07: actions/labeler@v5 on pull_request_target — provides write permissions needed for labeling fork PRs"
  - "01-07: Build job uses needs: [lint, test] — prevents broken builds from running unnecessarily"
  - "01-07: Claude review prompt includes FIFO correctness check in addition to Decimal.js/SQL rules"

patterns-established:
  - "CI pattern: lint -> test (+coverage) -> build, all on ubuntu-latest Node 22"
  - "Labels map: packages/frontend/** -> frontend, packages/backend/** -> backend, etc."
  - "Version resolver: feature label -> minor bump, fix/bug/ci label -> patch bump"

# Metrics
duration: 3min
completed: 2026-03-21
---

# Phase 1 Plan 7: GitHub Actions CI/CD Pipeline Summary

**Four GitHub Actions workflows (CI lint/test/build, Claude review, auto-labeler, release-drafter) plus Codecov integration and labeler/release-drafter configs — all PRs to main now gate on automated checks**

## Performance

- **Duration:** 3 min
- **Started:** 2026-03-21T16:54:04Z
- **Completed:** 2026-03-21T16:56:11Z
- **Tasks:** 3 (2 auto + 1 checkpoint verified, all complete)
- **Files modified:** 6

## Accomplishments
- CI workflow with lint (Biome), test + coverage upload (Codecov), and build (npm workspaces) jobs — build depends on lint+test
- Claude Code Action on every PR with Cryptax-specific rules: Decimal.js for money, no raw SQL, TEXT columns, FIFO correctness
- Auto-labeler mapping file paths to 6 labels (frontend, backend, shared, ci, database, testing)
- Release-drafter with 5 changelog categories and semantic version resolver from PR labels
- All YAML ignored by Biome as expected — `npx biome check .` still passes clean

## Task Commits

Each task was committed atomically:

1. **Task 1: Create CI workflow and Codecov integration** - `abecde4` (feat)
2. **Task 2: Create Claude review, auto-labeler, and release-drafter workflows** - `5593109` (feat)

**Plan metadata:** TBD (docs commit follows this update)

## Files Created/Modified
- `.github/workflows/ci.yml` - Three-job pipeline: lint (Biome), test+coverage (Codecov upload), build (workspaces)
- `.github/workflows/claude-review.yml` - AI review on PR open/sync/comment with Cryptax-specific prompt
- `.github/workflows/labeler.yml` - Auto-label on pull_request_target using actions/labeler@v5
- `.github/workflows/release-drafter.yml` - Changelog generation on push/PR to main
- `.github/labeler.yml` - File path to label mapping config
- `.github/release-drafter.yml` - Categories, version resolver, changelog template config

## Decisions Made
- Used `fail_ci_if_error: false` on Codecov action — CI does not hard-fail if Codecov is unreachable (graceful degradation for optional reporting service)
- Used `actions/labeler@v5` on `pull_request_target` — provides the write permissions required to label PRs including those from forks
- Build job uses `needs: [lint, test]` — prevents unnecessary build runs when lint or tests fail
- Added FIFO correctness check to Claude review prompt (transaction date ordering) in addition to the Decimal.js/SQL rules from the plan — directly relevant to core correctness

## Deviations from Plan

None - plan executed exactly as written. One minor enhancement to the Claude review prompt (added FIFO correctness check) which is additive and directly within the stated Cryptax domain context.

## Issues Encountered
None.

## User Setup Completed

User confirmed the following setup on 2026-03-21:

1. **CODECOV_TOKEN** — Added to GitHub repo secrets. Coverage upload active on all CI runs.
2. **Branch protection on `main`** — Ruleset configured: PR required before merging, status checks required (CI / lint, test, build), restrict deletions, block force pushes.
3. **ANTHROPIC_API_KEY** — Not added (company proxy prevents direct Anthropic API access). Claude Code Action workflow is in place; key can be added when accessible. Claude review will silently skip until the secret is present.

## Next Phase Readiness
- Phase 1 Foundation + CI/CD is complete — all 7 plans executed
- Phase 2 (Transaction Ingestion) can begin — all PRs will automatically run lint/test/build, get auto-labeling, and generate release notes
- Claude review is wired and ready; activate by adding ANTHROPIC_API_KEY secret when company proxy situation changes
- codecov.yml 90% patch threshold (from 01-06) already in place at repo root

---
*Phase: 01-foundation-ci-cd*
*Completed: 2026-03-21*
