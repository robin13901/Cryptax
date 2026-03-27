# Phase 07: Exchange API + Security - Research

**Researched:** 2026-03-23
**Domain:** Authentication, AES-256-GCM encryption, ccxt Bitget API, React settings UI
**Confidence:** HIGH (auth + crypto), MEDIUM (ccxt Bitget futures pagination)

---

## Summary

Phase 07 covers three distinct technical areas that must integrate cleanly:

**1. Authentication (SECU-01):** A single-user password login using `node:crypto` scrypt for password hashing (no extra dependency), Hono's built-in `jwt` middleware for protecting all `/api/*` routes, and signed session cookies (httpOnly) set via Hono's cookie helper. The setup/login/logout flow fits in a single auth route module; the rest of the API is guarded by one `app.use('/api/*', jwt(...))` call with the `cookie` option.

**2. Credential Encryption (SECU-02, SECU-03):** `node:crypto` AES-256-GCM with PBKDF2 key derivation — no new dependencies. Bitget requires three credentials (apiKey, secret, password/passphrase), all stored as a single JSON blob encrypted on disk. The encryption key is derived from the user's login password at request time and is never persisted; only the ciphertext+iv+salt+authTag blob is written to the `exchange_connections.encrypted_credentials` column.

**3. ccxt Bitget Sync (EXCH-01 to EXCH-05):** ccxt v4.5.44 is current. The `bitget` class name is lowercase, requires three credentials (apiKey, secret, password), and uses `fetchMyTrades()` for both spot and swap/futures markets. Spot calls the `v2/spot/trade/fills` endpoint; futures requires `{ type: 'swap' }` in params, routing to `v2/mix/order/fills`. Pagination uses the `since` timestamp parameter in a while loop. API-fetched trades bypass the CSV parsing layer but must still flow through `normalizeToTransaction` → `batchInsert` for deduplication.

**Primary recommendation:** Use `node:crypto` throughout (no bcrypt, no argon2) — scrypt for password hashing, PBKDF2 + AES-256-GCM for credential encryption. Use Hono's built-in `jwt` middleware with cookie option for sessions. Use ccxt `bitget` named export for exchange access.

---

## Standard Stack

### Core (Backend)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `node:crypto` | built-in | Scrypt password hash + AES-256-GCM + PBKDF2 | Zero dependency, Node.js 23 built-in, covers all crypto needs |
| `hono/jwt` | (bundled with hono ^4.12.8) | JWT sign/verify + route middleware | Already in project, purpose-built for Hono |
| `hono/cookie` | (bundled with hono) | setSignedCookie / getSignedCookie | Already in project, httpOnly session cookie |
| `ccxt` | 4.5.44 | Bitget spot + futures trade history | Certified Bitget support, unified API |

### Core (Frontend)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `sonner` | latest | Toast notifications for sync progress | Lightweight, React-first, promise API, auto-dismiss |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `node:crypto` scrypt | `bcryptjs` | bcryptjs adds a dependency; scrypt is built-in and memory-hard |
| `node:crypto` PBKDF2 | `node:crypto` scrypt | Either works for key derivation; PBKDF2 is simpler and spec'd in requirement |
| `sonner` | `react-hot-toast` | Both are fine; sonner has better promise API and description field |
| `hono/jwt` cookie | `hono/cookie` signed cookie only | JWT gives us a structured payload; signed cookie alone works too but JWT is cleaner |

**Installation:**
```bash
npm install ccxt sonner --workspace=packages/backend   # ccxt: backend only
npm install sonner --workspace=packages/frontend       # sonner: frontend only
```

---

## Architecture Patterns

### Recommended Project Structure

```
packages/backend/src/
├── auth/
│   ├── auth-store.ts          # password hash read/write in app_settings table
│   ├── crypto.ts              # scrypt hash/verify helpers
│   ├── credential-cipher.ts   # AES-256-GCM encrypt/decrypt for exchange creds
│   └── auth-store.test.ts
├── routes/
│   ├── auth.ts                # POST /api/auth/login, POST /api/auth/logout, GET /api/auth/status
│   ├── auth.test.ts
│   ├── exchanges.ts           # CRUD for exchange_connections
│   ├── exchanges.test.ts
│   ├── sync.ts                # POST /api/exchanges/:id/sync
│   └── sync.test.ts
├── exchange/
│   ├── exchange-adapter.ts    # ExchangeAdapter interface
│   ├── bitget-adapter.ts      # ccxt bitget implementation
│   ├── bitget-adapter.test.ts
│   └── sync-engine.ts         # orchestrates fetch → normalize → batchInsert
└── db/
    └── schema.ts              # add app_settings table

packages/frontend/src/
├── components/
│   ├── Auth/
│   │   ├── LoginCard.tsx       # centered login form
│   │   ├── LoginCard.css
│   │   └── SetupCard.tsx       # first-run password creation
│   └── Settings/
│       ├── SettingsTab.tsx     # new tab: exchanges + app settings
│       ├── ExchangeCard.tsx    # per-exchange card (credentials, sync, status)
│       ├── CredentialForm.tsx  # masked apiKey/secret/passphrase inputs
│       └── SyncProgress.tsx    # live count update during sync
└── App.tsx                     # add 'settings' tab + auth gate
```

### Pattern 1: JWT Cookie Session

**What:** On login, the backend verifies the password hash, signs a JWT with no expiry (session-only), sets it as an httpOnly cookie. The JWT middleware reads the cookie on every `/api/*` request.

**When to use:** Single-user app served at localhost — no expiry timer needed (CONTEXT.md decision).

```typescript
// Source: hono.dev/docs/helpers/jwt + hono.dev/docs/helpers/cookie

// Login route
app.post('/api/auth/login', async (c) => {
  const { password } = await c.req.json<{ password: string }>();
  const valid = await verifyPassword(password);  // scrypt compare
  if (!valid) return c.json({ error: 'Falsches Passwort' }, 401);

  const token = await sign({ sub: 'user', iat: Math.floor(Date.now() / 1000) }, JWT_SECRET);
  await setSignedCookie(c, 'session', token, COOKIE_SECRET, {
    httpOnly: true,
    sameSite: 'Strict',
    path: '/',
  });
  return c.json({ ok: true });
});

// Global middleware (in index.ts, BEFORE all /api/* routes)
app.use('/api/*', (c, next) => {
  // Allow login + logout without auth
  if (c.req.path === '/api/auth/login' || c.req.path === '/api/auth/logout') return next();
  return jwt({ secret: JWT_SECRET, cookie: 'session' })(c, next);
});
```

### Pattern 2: Password Storage in app_settings Table

**What:** A simple key-value SQLite table stores the password hash and credential encryption salt. Created once on first launch; no migration needed for existing deployments that already have the table after migration.

**Schema:**
```typescript
// db/schema.ts addition
export const appSettings = sqliteTable('app_settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: text('updated_at').notNull(),
});
// Keys used: 'password_hash', 'credential_salt'
```

**First-launch detection:** `GET /api/auth/status` returns `{ hasPassword: boolean }`. Frontend renders SetupCard when `hasPassword === false`.

### Pattern 3: AES-256-GCM Credential Encryption

**What:** User's login password derives a 32-byte key via PBKDF2 (100,000 iterations, SHA-256). The key encrypts the credential JSON using AES-256-GCM. The stored blob is a JSON string containing `{ iv, salt, authTag, ciphertext }` (all hex-encoded).

**When to use:** Whenever exchange credentials are written to or read from the `exchange_connections.encrypted_credentials` column.

```typescript
// Source: nodejs.org/api/crypto.html
// packages/backend/src/auth/credential-cipher.ts

import { createCipheriv, createDecipheriv, pbkdf2Sync, randomBytes } from 'node:crypto';

interface EncryptedBlob {
  iv: string;      // 12 bytes hex (96-bit IV recommended for GCM)
  salt: string;    // 16 bytes hex
  authTag: string; // 16 bytes hex
  ciphertext: string; // hex
}

export function encryptCredentials(plaintext: string, password: string): string {
  const salt = randomBytes(16);
  const iv = randomBytes(12);   // 12-byte IV is standard for GCM
  const key = pbkdf2Sync(password, salt, 100_000, 32, 'sha256');
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  const blob: EncryptedBlob = {
    iv: iv.toString('hex'),
    salt: salt.toString('hex'),
    authTag: authTag.toString('hex'),
    ciphertext: ciphertext.toString('hex'),
  };
  return JSON.stringify(blob);
}

export function decryptCredentials(blobJson: string, password: string): string {
  const { iv, salt, authTag, ciphertext } = JSON.parse(blobJson) as EncryptedBlob;
  const key = pbkdf2Sync(password, Buffer.from(salt, 'hex'), 100_000, 32, 'sha256');
  const decipher = createDecipheriv(
    'aes-256-gcm',
    key,
    Buffer.from(iv, 'hex'),
  );
  decipher.setAuthTag(Buffer.from(authTag, 'hex'));
  return decipher.update(Buffer.from(ciphertext, 'hex')) + decipher.final('utf8');
}
```

**Key insight:** The user's password must be passed through from the request to the decrypt call. Never cache or persist the derived key. The `password` parameter comes from the JWT payload (store just a salted session token, not the plaintext password) — or simpler: re-request the password only on credential save/use. See "Open Questions" section.

### Pattern 4: ccxt Bitget Adapter

**What:** Wraps ccxt's `bitget` class to fetch spot and futures trades, normalizing them to the `transactions.$inferInsert` shape.

```typescript
// Source: github.com/ccxt/ccxt, docs.ccxt.com
// packages/backend/src/exchange/bitget-adapter.ts

import { bitget as BitgetExchange } from 'ccxt';
import type { Trade } from 'ccxt';

interface BitgetCredentials {
  apiKey: string;
  secret: string;
  password: string;  // passphrase — Bitget requires this third credential
}

export class BitgetAdapter {
  private exchange: BitgetExchange;

  constructor(credentials: BitgetCredentials) {
    this.exchange = new BitgetExchange({
      apiKey: credentials.apiKey,
      secret: credentials.secret,
      password: credentials.password,
    });
  }

  // Fetch all spot trades since a given timestamp
  async fetchSpotTrades(since?: number): Promise<Trade[]> {
    return this.fetchAllTrades(undefined, since, {});
  }

  // Fetch all futures/swap trades since a given timestamp
  async fetchFuturesTrades(since?: number): Promise<Trade[]> {
    return this.fetchAllTrades(undefined, since, { type: 'swap' });
  }

  private async fetchAllTrades(
    symbol: string | undefined,
    since: number | undefined,
    params: Record<string, unknown>,
  ): Promise<Trade[]> {
    const all: Trade[] = [];
    let cursor = since;
    const limit = 100;

    while (true) {
      const batch = await this.exchange.fetchMyTrades(symbol, cursor, limit, params);
      if (batch.length === 0) break;
      all.push(...batch);
      // Advance cursor past last trade to avoid re-fetching it
      const lastTs = batch[batch.length - 1].timestamp;
      if (lastTs === undefined || lastTs === cursor) break;
      cursor = lastTs + 1;
      if (batch.length < limit) break;  // last page
    }
    return all;
  }
}
```

**Bitget credentials required:** `apiKey`, `secret`, `password` (Bitget calls this a "passphrase" — it is the API passphrase set in the Bitget dashboard, not the user's app password).

### Pattern 5: Sync Engine Integration

**What:** API-fetched trades cannot use `importCSVFile` (which expects CSV text). Instead, a new `importTransactions` function accepts pre-normalized `transactions.$inferInsert[]` rows and calls `batchInsert` directly — bypassing CSV parsing but reusing deduplication.

```typescript
// packages/backend/src/exchange/sync-engine.ts
export async function syncExchange(
  connectionId: number,
  password: string,  // user's login password for decryption
): Promise<SyncResult> {
  const connection = getExchangeConnection(connectionId);
  const credentials = decryptCredentials(connection.encryptedCredentials, password);
  const adapter = new BitgetAdapter(JSON.parse(credentials));

  const since = connection.lastSyncAt
    ? new Date(connection.lastSyncAt).getTime()
    : undefined;

  // Partial import: run spot and futures independently
  const results = await Promise.allSettled([
    adapter.fetchSpotTrades(since),
    adapter.fetchFuturesTrades(since),
  ]);

  // Normalize ccxt Trade[] → transactions.$inferInsert[]
  // batchInsert handles deduplication via onConflictDoNothing
  // Update last_sync_at after successful fetch
}
```

### Pattern 6: Frontend Auth Gate

**What:** App.tsx wraps all content in an auth check. On mount, calls `GET /api/auth/status`. If `hasPassword === false`, renders SetupCard. If `hasPassword === true` but no session cookie, renders LoginCard. Otherwise renders normal app.

```typescript
// React auth state machine: 'loading' | 'setup' | 'login' | 'authenticated'
const [authState, setAuthState] = useState<AuthState>('loading');
```

### Anti-Patterns to Avoid

- **Storing the decryption password in JWT payload:** The user's login password must NOT be stored in the JWT — JWT cookies are readable by the server but should not carry sensitive material. Use the session to identify the user, but require re-entry or a separate server-side session secret for decryption. See "Open Questions" for the recommended approach.
- **Using `bcrypt` or `argon2` packages:** Node.js 23 has `scryptSync` which is memory-hard and needs no dependency. Bcrypt adds a native module that complicates CI.
- **Using ccxt `fetchClosedOrders` instead of `fetchMyTrades`:** `fetchMyTrades` maps to the fills endpoint; `fetchClosedOrders` maps to order history — these are different data with different fields.
- **Logging credentials or decrypted values:** Never log the plaintext credentials, derived key, or raw password at any log level.
- **Fetching all symbols in a loop:** Call `fetchMyTrades(undefined, since, limit, params)` with `symbol = undefined` to get all trades across all pairs in one sweep.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| JWT creation/verification | Custom base64 + HMAC | `hono/jwt` sign/verify | Handles edge cases, already in project |
| Cookie signing | Manual HMAC cookie | `hono/cookie` setSignedCookie | Tamper-proof, follows RFC, already in Hono |
| Exchange API pagination | Custom Bitget REST pagination | ccxt `fetchMyTrades` with since loop | ccxt handles rate limiting, error mapping, auth headers |
| Toast notifications | Custom React toast | `sonner` | Auto-dismiss, promise API, accessible |
| AES-GCM boilerplate | None — write it once | Use the `credential-cipher.ts` pattern exactly | The pattern is well-specified; centralise it |
| Password comparison | `===` | `crypto.timingSafeEqual` | Prevents timing attacks |

**Key insight:** `node:crypto` handles ALL cryptographic needs for this phase. There is no need for any crypto-related npm package.

---

## Common Pitfalls

### Pitfall 1: Bitget Requires Three Credentials

**What goes wrong:** ccxt exchange instantiation with only `apiKey` and `secret` fails for Bitget. Authentication headers will be rejected with error 30004.

**Why it happens:** Bitget's API requires an `OK_ACCESS_PASSPHRASE` header. ccxt maps this to the `password` field.

**How to avoid:** Always store and require three fields: `apiKey`, `secret`, `password` (the Bitget API passphrase). The credential form must have three inputs.

**Warning signs:** ccxt throws `AuthenticationError` with message about missing passphrase.

### Pitfall 2: ccxt fetchMyTrades Futures Requires params.type

**What goes wrong:** Calling `fetchMyTrades(symbol, since, limit)` without `{ type: 'swap' }` in params for futures trades returns spot data or fails.

**Why it happens:** Bitget has separate API endpoints for spot (`v2/spot/trade/fills`) and swap (`v2/mix/order/fills`). ccxt routes based on the `type` param.

**How to avoid:** Always pass `{ type: 'swap' }` in params for futures trade fetches.

**Warning signs:** Zero futures results or wrong trade types.

### Pitfall 3: Pagination Cursor Must Advance Past Last Trade

**What goes wrong:** Using `since = batch[last].timestamp` (without +1) causes the same last trade to appear in the next page, creating an infinite loop.

**Why it happens:** The `since` parameter means "trades with timestamp >= since". If the last trade's timestamp equals the new cursor, it gets fetched again.

**How to avoid:** Use `cursor = lastTrade.timestamp + 1`. Also break if `batch.length < limit` (last page indicator).

**Warning signs:** Sync never finishes, duplicate trade detection fires on every page.

### Pitfall 4: JWT Cookie Without Session Expiry on Tab Close

**What goes wrong:** Session cookie set with `maxAge` will persist after tab close. Session cookie set without `maxAge` or `expires` will be discarded when the browser session ends.

**Why it happens:** The CONTEXT.md decision is "session lasts until browser tab closes." This means a session cookie (no `maxAge`, no `expires`) — the default browser behavior.

**How to avoid:** Do NOT set `maxAge` or `expires` on the cookie. Use just `httpOnly: true, sameSite: 'Strict', path: '/'`.

**Warning signs:** User complains session persists after closing browser, or is lost prematurely.

### Pitfall 5: Migration Must Add STRICT to New Tables

**What goes wrong:** `npm run db:generate` generates `CREATE TABLE` without `STRICT`. All existing tables in this project use `STRICT` mode.

**Why it happens:** Drizzle Kit does not emit `STRICT` by default.

**How to avoid:** After generating migrations for `app_settings` and any other new tables, manually add `STRICT` to the `CREATE TABLE` statement in the SQL file before running `db:migrate`.

**Warning signs:** Integer columns accept text values silently.

### Pitfall 6: ccxt Trade.id May Not Match Bitget Order ID

**What goes wrong:** The deduplication constraint in `transactions` uses `(orderId, exchange, checksum)`. The `Trade.id` from ccxt is the fill ID, not the order ID. Multiple fills can have the same `Trade.order` (order ID) but different `Trade.id`.

**Why it happens:** ccxt maps `Trade.id` to the exchange's fill/trade ID and `Trade.order` to the order ID. For Bitget, use `Trade.id` as the `orderId` for uniqueness, since each fill has a unique fill ID.

**How to avoid:** Map ccxt `Trade.id` to `transactions.orderId`, not `Trade.order`. This ensures each fill is a unique row.

**Warning signs:** Duplicate fill records or missing fills.

### Pitfall 7: Credential Decryption Key From Password

**What goes wrong:** The exchange credential decryption requires the user's login password to derive the AES key. The JWT session cookie does not store the password. This creates a design tension: the sync endpoint needs the password, but the session token does not contain it.

**Why it happens:** SECU-03 specifies "decrypt only in memory using user password via PBKDF2 key derivation." The password must come from somewhere at sync time.

**How to avoid:** Use a two-layer approach:
1. A separate `CREDENTIAL_MASTER_KEY` env var (randomly generated once, stored in `.env` which is gitignored) is used as the "password" for PBKDF2. This decouples credential encryption from the user's login password.
2. Alternatively, store the derived encryption key in the server-side session (in memory, not in the cookie).

**Recommended approach:** Use a random `CREDENTIAL_MASTER_KEY` from `.env` as the PBKDF2 password. This satisfies "encrypted at rest" (AES-256-GCM), "cannot be read from SQLite file" (ciphertext only), and avoids the need to pass the user's password to every API call.

**Warning signs:** Sync endpoint 401s because it cannot retrieve the password, or the password is awkwardly re-sent in the sync request body.

---

## Code Examples

### Password Setup and Verification

```typescript
// Source: nodejs.org/api/crypto.html
// packages/backend/src/auth/crypto.ts

import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

const SALT_BYTES = 16;
const KEY_BYTES = 64;
const SCRYPT_N = 16384;

export function hashPassword(password: string): string {
  const salt = randomBytes(SALT_BYTES);
  const hash = scryptSync(password, salt, KEY_BYTES, { N: SCRYPT_N });
  return `${salt.toString('hex')}:${hash.toString('hex')}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [saltHex, hashHex] = stored.split(':');
  const salt = Buffer.from(saltHex, 'hex');
  const storedHash = Buffer.from(hashHex, 'hex');
  const computedHash = scryptSync(password, salt, KEY_BYTES, { N: SCRYPT_N });
  return timingSafeEqual(computedHash, storedHash);
}
```

### Hono JWT Route Protection

```typescript
// Source: hono.dev/docs/middleware/builtin/jwt
// packages/backend/src/index.ts additions

import { jwt } from 'hono/jwt';
import { setSignedCookie, deleteCookie } from 'hono/cookie';
import { sign } from 'hono/jwt';

const JWT_SECRET = process.env.JWT_SECRET ?? 'dev-secret-change-me';
const COOKIE_SECRET = process.env.COOKIE_SECRET ?? 'dev-cookie-secret';

// Auth middleware (add before other /api/* routes)
app.use('/api/*', async (c, next) => {
  const path = new URL(c.req.url).pathname;
  if (path === '/api/auth/login' || path === '/api/auth/logout' || path === '/api/auth/status') {
    return next();
  }
  return jwt({ secret: JWT_SECRET, cookie: 'session' })(c, next);
});

// Login
app.post('/api/auth/login', async (c) => {
  const { password } = await c.req.json<{ password: string }>();
  if (!verifyPassword(password, getStoredHash())) {
    return c.json({ error: 'Falsches Passwort' }, 401);
  }
  const token = await sign({ sub: 'user' }, JWT_SECRET);
  await setSignedCookie(c, 'session', token, COOKIE_SECRET, {
    httpOnly: true, sameSite: 'Strict', path: '/',
  });
  return c.json({ ok: true });
});
```

### ccxt Bitget Import (ESM)

```typescript
// Source: github.com/ccxt/ccxt (js/ccxt.d.ts exports)
import { bitget as BitgetExchange } from 'ccxt';
import type { Trade } from 'ccxt';

const exchange = new BitgetExchange({
  apiKey: 'your-key',
  secret: 'your-secret',
  password: 'your-passphrase',  // required for Bitget
});
```

### Sonner Toast for Sync Progress

```typescript
// Source: sonner.emilkowal.ski/toast
import { toast } from 'sonner';

// In <App /> root: <Toaster position="bottom-right" richColors />

// During sync:
const syncPromise = triggerSync(connectionId);
toast.promise(syncPromise, {
  loading: 'Synchronisierung läuft...',
  success: (result) => ({
    message: `Sync abgeschlossen`,
    description: `${result.imported} neue Trades, ${result.duplicates} Duplikate`,
  }),
  error: (err) => `Sync fehlgeschlagen: ${err.message}`,
});
```

---

## Database Changes Required

### New Table: app_settings

```sql
-- After db:generate, manually add STRICT
CREATE TABLE `app_settings` (
  `key` text PRIMARY KEY NOT NULL,
  `value` text NOT NULL,
  `updated_at` text NOT NULL
) STRICT;
```

Keys used:
- `password_hash`: scrypt hash in format `saltHex:hashHex`
- `credential_master_key`: (ALTERNATIVELY: stored in .env, not DB)

### Existing Table: exchange_connections

Already defined in schema with `encrypted_credentials TEXT NOT NULL`. No new columns needed for basic sync. Consider adding a `sync_status` or `last_error` TEXT column (optional for error reporting).

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| bcrypt for password hashing | `node:crypto` scryptSync | Node.js 10+ (stable in 22+) | No native module dependency |
| Manual Bitget REST API | ccxt unified API | ccxt v4, Bitget v2 API | Rate limits, auth, pagination handled |
| Bitget API v1 | Bitget API v2 (ccxt 4.x) | Mid-2024 | New endpoint paths, v2 required |
| JWT in Authorization header | JWT in cookie (`httpOnly`) | Modern practice | Prevents XSS token theft |
| Separate encryption libraries | `node:crypto` AES-256-GCM | Node.js 16+ GCM support | Zero dependencies |

**Deprecated/outdated:**
- ccxt `fetchTrades` (public market trades): Use `fetchMyTrades` for personal trade history
- Bitget API v1 endpoints: ccxt 4.x exclusively uses v2, reflected in `apiVersion: 'v2'` in the bitget class

---

## Open Questions

1. **Credential decryption key source**
   - What we know: SECU-03 says "decrypt using user password via PBKDF2". Storing the user's password in the JWT is unsafe. The sync endpoint needs a key at runtime.
   - What's unclear: Does "user password" mean the literal login password, or a derived key from it?
   - Recommendation: Use a random `CREDENTIAL_MASTER_KEY` environment variable as the PBKDF2 "password". This is generated once on setup, stored in `.env` (gitignored), and used by the backend at startup. This satisfies the "encrypted at rest" requirement without requiring the user to re-enter their password on every sync. Add `CREDENTIAL_MASTER_KEY` generation to the first-launch setup flow.

2. **ccxt Bitget deep history pagination limit**
   - What we know: ccxt `fetchMyTrades` with `since` works for incremental sync. Deep history (all-time) is untested per the phase research flag.
   - What's unclear: Bitget API may have a maximum lookback window per request or a total history limit.
   - Recommendation: In 07-04/07-05 plans, include a test with real Bitget credentials against a live (or sandbox) account. Start with 90-day history for initial validation. Document in the adapter that full history on first sync may require multiple session-spanning runs if Bitget imposes undocumented date limits.

3. **ccxt null symbol for all-trades fetch**
   - What we know: Calling `fetchMyTrades(undefined, since, limit, params)` with `symbol = undefined` should return all trades. The ccxt source shows this is supported but Bitget's endpoint behavior with null symbol is untested.
   - What's unclear: Whether Bitget's `v2/spot/trade/fills` requires a symbol or allows all-symbol queries.
   - Recommendation: Implement with `symbol = undefined` first. If Bitget requires a symbol, fall back to fetching all known markets and iterating — but first confirm with a live test.

4. **Session security for localhost-only app**
   - What we know: The app runs at localhost. `sameSite: 'Strict'` and `httpOnly: true` are appropriate.
   - What's unclear: Whether `secure: true` should be set (requires HTTPS, which localhost dev doesn't have).
   - Recommendation: Do NOT set `secure: true` for localhost dev. Add a comment noting this would be required for production deployment.

---

## Sources

### Primary (HIGH confidence)
- `nodejs.org/api/crypto.html` — scrypt, PBKDF2, AES-256-GCM, timingSafeEqual documentation
- `hono.dev/docs/middleware/builtin/jwt` — JWT middleware with cookie option
- `hono.dev/docs/helpers/cookie` — setSignedCookie, getCookie API
- `hono.dev/docs/helpers/jwt` — sign(), verify() function signatures
- `github.com/ccxt/ccxt` (package.json) — version 4.5.44, ESM exports confirmed
- `github.com/ccxt/ccxt` (bitget.ts) — requiredCredentials: apiKey+secret+password; fetchMyTrades: true; spot endpoint `v2/spot/trade/fills`; swap endpoint `v2/mix/order/fills`
- `github.com/ccxt/ccxt` (types.ts) — Trade interface: id, timestamp, symbol, side, price, amount, cost, fee

### Secondary (MEDIUM confidence)
- `dcodeIO/bcrypt.js README` — confirmed bcryptjs as alternative (not used; scrypt preferred)
- `sonner.emilkowal.ski` — promise toast API, description field, positioning options

### Tertiary (LOW confidence)
- ccxt fetchMyTrades pagination pattern (`since + 1`, break on `batch.length < limit`) — derived from ccxt source structure and standard pagination patterns; not found in a single authoritative code example; validate with live test
- ccxt `symbol = undefined` for all-trade fetch — mentioned in ccxt docs structure but not confirmed for Bitget specifically

---

## Metadata

**Confidence breakdown:**
- Standard Stack: HIGH — all libraries verified via official sources
- Authentication: HIGH — Hono JWT/cookie docs confirmed
- Crypto (AES-GCM + scrypt): HIGH — Node.js official docs
- ccxt Bitget spot: HIGH — endpoint and credentials confirmed from source
- ccxt Bitget futures pagination: MEDIUM — endpoint confirmed, deep pagination behavior unverified
- Frontend patterns: HIGH — sonner confirmed, React patterns are project-consistent
- Pitfalls: HIGH — most verified from official source code

**Research date:** 2026-03-23
**Valid until:** 2026-04-23 (30 days; ccxt releases frequently but breaking changes are rare within minor versions)
