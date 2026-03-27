/**
 * Security audit tests — SECU-04
 *
 * Validates that:
 * 1. No credentials/passwords appear in console output
 * 2. Auth route responses do not echo back submitted passwords
 * 3. Auth route responses expose only expected fields
 * 4. Source files contain no accidental console.log of sensitive data
 */

import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as schema from '../db/schema.js';

// ---------------------------------------------------------------------------
// DB mock — must be declared before importing the module under test
// ---------------------------------------------------------------------------

let mockDb: ReturnType<typeof drizzle<typeof schema>>;

vi.mock('../db/client.js', () => ({
  get db() {
    return mockDb;
  },
  get sqlite() {
    return undefined;
  },
}));

import { registerAuthRoutes } from '../routes/auth.js';
// Import after mock is registered
import { hashPassword, verifyPassword } from './crypto.js';

// ---------------------------------------------------------------------------
// Migration helper
// ---------------------------------------------------------------------------

function applyMigrations(sqlite: ReturnType<typeof Database>): void {
  const migrationsDir = path.resolve(process.cwd(), 'packages/backend/drizzle');
  for (const file of [
    '0000_initial.sql',
    '0001_import_batches.sql',
    '0002_eur_price_columns.sql',
    '0003_app_settings.sql',
  ]) {
    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
    const statements = sql
      .split('--> statement-breakpoint')
      .map((s) => s.trim())
      .filter(Boolean);
    for (const stmt of statements) {
      sqlite.exec(stmt);
    }
  }
}

// ---------------------------------------------------------------------------
// Auth directory path (for source code static analysis)
// ---------------------------------------------------------------------------

const AUTH_SRC_DIR = path.resolve(process.cwd(), 'packages/backend/src/auth');
const AUTH_ROUTES_FILE = path.resolve(process.cwd(), 'packages/backend/src/routes/auth.ts');

function readAuthSourceFiles(): { file: string; content: string }[] {
  const authDir = AUTH_SRC_DIR;
  const files = fs.readdirSync(authDir).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'));
  const results = files.map((f) => ({
    file: f,
    content: fs.readFileSync(path.join(authDir, f), 'utf8'),
  }));
  // Also include the routes/auth.ts file
  results.push({
    file: 'routes/auth.ts',
    content: fs.readFileSync(AUTH_ROUTES_FILE, 'utf8'),
  });
  return results;
}

// ---------------------------------------------------------------------------
// Tests: Log leakage via crypto functions
// ---------------------------------------------------------------------------

describe('Security Audit: Log leakage — crypto functions', () => {
  const TEST_PASSWORD = 'my-secret-password-SECU04';

  let consoleLogs: ReturnType<typeof vi.spyOn>;
  let consoleErrors: ReturnType<typeof vi.spyOn>;
  let consoleWarns: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleLogs = vi.spyOn(console, 'log').mockImplementation(() => {});
    consoleErrors = vi.spyOn(console, 'error').mockImplementation(() => {});
    consoleWarns = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleLogs.mockRestore();
    consoleErrors.mockRestore();
    consoleWarns.mockRestore();
  });

  it('hashPassword does not log the password string', () => {
    hashPassword(TEST_PASSWORD);

    const allOutput = [
      ...consoleLogs.mock.calls.flat(),
      ...consoleErrors.mock.calls.flat(),
      ...consoleWarns.mock.calls.flat(),
    ]
      .map(String)
      .join(' ');

    expect(allOutput).not.toContain(TEST_PASSWORD);
  });

  it('verifyPassword does not log the password string (valid hash)', () => {
    const validHash = hashPassword(TEST_PASSWORD);

    // Clear spy state captured during hashPassword call
    consoleLogs.mockClear();
    consoleErrors.mockClear();
    consoleWarns.mockClear();

    verifyPassword(TEST_PASSWORD, validHash);

    const allOutput = [
      ...consoleLogs.mock.calls.flat(),
      ...consoleErrors.mock.calls.flat(),
      ...consoleWarns.mock.calls.flat(),
    ]
      .map(String)
      .join(' ');

    expect(allOutput).not.toContain(TEST_PASSWORD);
  });

  it('verifyPassword does not log the password string (invalid hash)', () => {
    verifyPassword(TEST_PASSWORD, 'invalid:hash');

    const allOutput = [
      ...consoleLogs.mock.calls.flat(),
      ...consoleErrors.mock.calls.flat(),
      ...consoleWarns.mock.calls.flat(),
    ]
      .map(String)
      .join(' ');

    expect(allOutput).not.toContain(TEST_PASSWORD);
  });
});

// ---------------------------------------------------------------------------
// Tests: Log leakage via auth route handlers
// ---------------------------------------------------------------------------

describe('Security Audit: Log leakage — auth route handlers', () => {
  const TEST_PASSWORD = 'route-handler-secret-SECU04';

  let app: Hono;
  let sqlite: ReturnType<typeof Database>;
  let consoleLogs: ReturnType<typeof vi.spyOn>;
  let consoleErrors: ReturnType<typeof vi.spyOn>;
  let consoleWarns: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    sqlite = new Database(':memory:');
    applyMigrations(sqlite);
    mockDb = drizzle(sqlite, { schema });
    app = new Hono();
    registerAuthRoutes(app);

    consoleLogs = vi.spyOn(console, 'log').mockImplementation(() => {});
    consoleErrors = vi.spyOn(console, 'error').mockImplementation(() => {});
    consoleWarns = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    sqlite.close();
    consoleLogs.mockRestore();
    consoleErrors.mockRestore();
    consoleWarns.mockRestore();
  });

  it('POST /api/auth/setup does not log the submitted password', async () => {
    await app.request('/api/auth/setup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: TEST_PASSWORD }),
    });

    const allOutput = [
      ...consoleLogs.mock.calls.flat(),
      ...consoleErrors.mock.calls.flat(),
      ...consoleWarns.mock.calls.flat(),
    ]
      .map(String)
      .join(' ');

    expect(allOutput).not.toContain(TEST_PASSWORD);
  });

  it('POST /api/auth/login does not log the submitted password', async () => {
    // Setup first (without spy concern — clear after)
    await app.request('/api/auth/setup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: TEST_PASSWORD }),
    });
    consoleLogs.mockClear();
    consoleErrors.mockClear();
    consoleWarns.mockClear();

    await app.request('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: TEST_PASSWORD }),
    });

    const allOutput = [
      ...consoleLogs.mock.calls.flat(),
      ...consoleErrors.mock.calls.flat(),
      ...consoleWarns.mock.calls.flat(),
    ]
      .map(String)
      .join(' ');

    expect(allOutput).not.toContain(TEST_PASSWORD);
  });

  it('POST /api/auth/login with wrong password does not log the submitted password', async () => {
    await app.request('/api/auth/setup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: TEST_PASSWORD }),
    });
    consoleLogs.mockClear();
    consoleErrors.mockClear();
    consoleWarns.mockClear();

    const WRONG_PASSWORD = 'wrong-route-handler-secret-SECU04';
    await app.request('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: WRONG_PASSWORD }),
    });

    const allOutput = [
      ...consoleLogs.mock.calls.flat(),
      ...consoleErrors.mock.calls.flat(),
      ...consoleWarns.mock.calls.flat(),
    ]
      .map(String)
      .join(' ');

    expect(allOutput).not.toContain(WRONG_PASSWORD);
    expect(allOutput).not.toContain(TEST_PASSWORD);
  });
});

// ---------------------------------------------------------------------------
// Tests: Response leakage — passwords must not appear in response bodies
// ---------------------------------------------------------------------------

describe('Security Audit: Response leakage — passwords not echoed in responses', () => {
  const TEST_PASSWORD = 'response-leak-secret-SECU04';

  let app: Hono;
  let sqlite: ReturnType<typeof Database>;

  beforeEach(() => {
    sqlite = new Database(':memory:');
    applyMigrations(sqlite);
    mockDb = drizzle(sqlite, { schema });
    app = new Hono();
    registerAuthRoutes(app);
  });

  afterEach(() => {
    sqlite.close();
  });

  it('POST /api/auth/login error response does not echo back the submitted password', async () => {
    // No setup — login will fail with 401
    const res = await app.request('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: TEST_PASSWORD }),
    });

    expect(res.status).toBe(401);
    const body = await res.text();
    expect(body).not.toContain(TEST_PASSWORD);
  });

  it('POST /api/auth/setup response does not echo back the submitted password', async () => {
    const res = await app.request('/api/auth/setup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: TEST_PASSWORD }),
    });

    expect(res.status).toBe(201);
    const body = await res.text();
    expect(body).not.toContain(TEST_PASSWORD);
  });

  it('GET /api/auth/status response contains only hasPassword and authenticated fields', async () => {
    const res = await app.request('/api/auth/status');
    expect(res.status).toBe(200);

    const body = await res.json<Record<string, unknown>>();
    const keys = Object.keys(body);

    expect(keys).toContain('hasPassword');
    expect(keys).toContain('authenticated');
    // Must not contain any extra fields (no tokens, no hashes, no internal data)
    expect(keys).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// Tests: Static source code analysis — no console.log of sensitive patterns
// ---------------------------------------------------------------------------

describe('Security Audit: Static analysis — no console.log of sensitive data in auth source', () => {
  let sourceFiles: { file: string; content: string }[];

  beforeEach(() => {
    sourceFiles = readAuthSourceFiles();
  });

  it('no auth source file contains console.log(.*password pattern', () => {
    const pattern = /console\.(log|error|warn)\s*\(.*password/i;
    for (const { file, content } of sourceFiles) {
      const match = pattern.test(content);
      expect(match, `${file} contains console output of 'password'`).toBe(false);
    }
  });

  it('no auth source file contains console.log(.*secret pattern', () => {
    const pattern = /console\.(log|error|warn)\s*\(.*secret/i;
    for (const { file, content } of sourceFiles) {
      const match = pattern.test(content);
      expect(match, `${file} contains console output of 'secret'`).toBe(false);
    }
  });

  it('no auth source file contains console.log(.*apiKey pattern', () => {
    const pattern = /console\.(log|error|warn)\s*\(.*apiKey/i;
    for (const { file, content } of sourceFiles) {
      const match = pattern.test(content);
      expect(match, `${file} contains console output of 'apiKey'`).toBe(false);
    }
  });

  it('no auth source file contains console.log(.*masterKey pattern', () => {
    const pattern = /console\.(log|error|warn)\s*\(.*masterKey/i;
    for (const { file, content } of sourceFiles) {
      const match = pattern.test(content);
      expect(match, `${file} contains console output of 'masterKey'`).toBe(false);
    }
  });

  it('no auth source file contains console.log(.*token pattern', () => {
    const pattern = /console\.(log|error|warn)\s*\(.*token/i;
    for (const { file, content } of sourceFiles) {
      const match = pattern.test(content);
      expect(match, `${file} contains console output of 'token'`).toBe(false);
    }
  });
});
