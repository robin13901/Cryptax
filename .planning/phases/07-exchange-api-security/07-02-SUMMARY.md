---
phase: 07-exchange-api-security
plan: 02
subsystem: auth
tags: [aes-256-gcm, pbkdf2, node-crypto, hono, sqlite, credentials, encryption]

# Dependency graph
requires:
  - phase: 07-01
    provides: app_settings table with credential_master_key, auth middleware, DB patterns
  - phase: 01-foundation-ci-cd
    provides: Hono server setup, Drizzle ORM, SQLite schema, migration infrastructure
provides:
  - encryptCredentials/decryptCredentials with AES-256-GCM + PBKDF2 (100k iterations, SHA-256)
  - getCredentialMasterKey reading from app_settings
  - Exchange CRUD API: GET/POST/DELETE /api/exchanges, POST /api/exchanges/:id/test
  - ExchangeConnection, ExchangeCredentials, SyncResult, ConnectionTestResult shared types
affects:
  - 07-03 (security audit uses credential-cipher directly)
  - 07-04 (ExchangeManager UI calls all CRUD endpoints)
  - 07-05 (sync engine calls /test and reads connections)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - AES-256-GCM with random 12-byte IV and 16-byte salt per encrypt call (unique blobs)
    - PBKDF2/100k/SHA-256 key derivation — masterKey + per-blob salt produces derived key
    - returning() clause in Drizzle insert for single-query insert+return without re-select
    - satisfies operator for compile-time type checks on Drizzle query results

key-files:
  created:
    - packages/backend/src/auth/credential-cipher.ts
    - packages/backend/src/auth/credential-cipher.test.ts
    - packages/backend/src/routes/exchanges.ts
    - packages/backend/src/routes/exchanges.test.ts
    - packages/shared/src/types/exchange.ts
  modified:
    - packages/backend/src/index.ts
    - packages/shared/src/index.ts

key-decisions:
  - "07-02-a: 12-byte IV (96-bit) for AES-256-GCM — NIST recommendation; 16-byte salt separate for PBKDF2"
  - "07-02-b: Each encrypt call generates fresh random IV + salt — same plaintext produces different blobs"
  - "07-02-c: POST /api/exchanges accepts only 'bitget' — other exchanges not yet supported"
  - "07-02-d: POST /api/exchanges/:id/test stubs ccxt-not-yet-installed — ccxt wired in 07-05"
  - "07-02-e: satisfies operator for type safety on Drizzle .returning() — avoids cast/any"

patterns-established:
  - "seedMasterKey(sqlite) test helper inserts credential_master_key for cipher tests needing DB"
  - "Drizzle .returning() for insert: single query returns the inserted row without re-select"
  - "NEVER include encryptedCredentials in any API response — explicit column selection in all SELECT queries"

# Metrics
duration: 5min
completed: 2026-03-23
---

# Phase 7 Plan 2: Credential Cipher + Exchange CRUD Summary

**AES-256-GCM credential encryption with PBKDF2/100k key derivation and full exchange connection CRUD API (GET/POST/DELETE/test)**

## Performance

- **Duration:** ~5 min
- **Started:** 2026-03-23T18:44:27Z
- **Completed:** 2026-03-23T18:49:45Z
- **Tasks:** 2
- **Files modified:** 7 (5 created, 2 modified)

## Accomplishments

- `credential-cipher.ts`: AES-256-GCM encrypt/decrypt with per-call random 12-byte IV + 16-byte salt, PBKDF2/100k/SHA-256 key derivation. Wrong key or tampered ciphertext throws immediately (GCM auth tag validation).
- `exchanges.ts`: Four CRUD endpoints wired into Hono — GET returns ExchangeConnection array (no creds), POST validates exchange/label/credentials, encrypts on write, returns 201; DELETE removes connection without affecting transactions; POST /test stubs ccxt stub.
- Shared types `ExchangeConnection`, `ExchangeCredentials`, `SyncResult`, `ConnectionTestResult` exported from `@cryptax/shared`.
- 23 new tests (8 cipher + 15 route) — total project tests: 819 (up from 765).

## Task Commits

1. **Task 1: Credential cipher + shared exchange types** - `8299e20` (feat)
2. **Task 2: Exchange connection CRUD routes** - `a88fcc4` (feat)

**Plan metadata:** (included in docs commit below)

## Files Created/Modified

- `packages/backend/src/auth/credential-cipher.ts` — AES-256-GCM encrypt/decrypt + getCredentialMasterKey
- `packages/backend/src/auth/credential-cipher.test.ts` — 8 tests: roundtrip, wrong-key throw, blob fields, unique IVs, no plaintext leak
- `packages/shared/src/types/exchange.ts` — ExchangeConnection, ExchangeCredentials, SyncResult, ConnectionTestResult
- `packages/shared/src/index.ts` — exports new exchange types
- `packages/backend/src/routes/exchanges.ts` — GET/POST/DELETE /api/exchanges + POST /api/exchanges/:id/test
- `packages/backend/src/routes/exchanges.test.ts` — 15 tests: all endpoints, validation, credential exclusion
- `packages/backend/src/index.ts` — registerExchangeRoutes wired in

## Decisions Made

- **07-02-a: 12-byte IV for AES-256-GCM** — NIST SP 800-38D recommends 96-bit (12-byte) IV for GCM; 16-byte salt is separate for PBKDF2 key derivation only.
- **07-02-b: Fresh random IV + salt per encrypt** — ensures identical plaintexts produce distinct ciphertexts; attacker cannot correlate credentials across connections.
- **07-02-c: bitget-only POST validation** — returns 400 for any other exchange value; prevents undefined behavior until more exchanges are supported.
- **07-02-d: ccxt stub in /test** — route validates credential decryption works but does not call live API until ccxt integration (07-05).
- **07-02-e: satisfies operator** — Drizzle's column-selection objects are structurally compatible with ExchangeConnection; satisfies verifies the shape at compile time without casting.

## Deviations from Plan

None — plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- Credential cipher ready for use by sync engine (07-05) and security audit (07-03)
- Exchange CRUD API ready for ExchangeManager UI (07-04)
- `/api/exchanges/:id/test` will be upgraded from stub to live ccxt call in 07-05
- 819 tests passing, zero regressions

---
*Phase: 07-exchange-api-security*
*Completed: 2026-03-23*
