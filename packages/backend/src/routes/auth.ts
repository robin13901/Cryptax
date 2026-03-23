import { randomBytes } from 'node:crypto';
import type { Hono } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { sign, verify } from 'hono/jwt';
import { getPasswordHash, hasPassword, setPasswordHash } from '../auth/auth-store.js';
import { hashPassword, verifyPassword } from '../auth/crypto.js';
import { db } from '../db/client.js';
import { appSettings } from '../db/schema.js';

// JWT secret: use env var or generate ephemeral secret on startup
export const JWT_SECRET =
  process.env.JWT_SECRET ?? randomBytes(32).toString('hex');

export function registerAuthRoutes(app: Hono): void {
  /**
   * GET /api/auth/status
   * Returns whether a password is configured and whether the current request
   * has a valid session. Exempt from JWT middleware.
   */
  app.get('/api/auth/status', async (c) => {
    const passwordSet = hasPassword();
    const token = getCookie(c, 'session');
    let authenticated = false;
    if (token) {
      try {
        await verify(token, JWT_SECRET, 'HS256');
        authenticated = true;
      } catch {
        authenticated = false;
      }
    }
    return c.json({ hasPassword: passwordSet, authenticated });
  });

  /**
   * POST /api/auth/setup
   * Body: { password: string }
   * Sets the application password for the first time.
   * Returns 409 if already set, 400 if password too short.
   */
  app.post('/api/auth/setup', async (c) => {
    if (hasPassword()) {
      return c.json({ error: 'Password already set' }, 409);
    }

    const body = await c.req.json<{ password?: string }>();
    const password = body?.password;

    if (typeof password !== 'string' || password.length < 8) {
      return c.json({ error: 'Password must be at least 8 characters' }, 400);
    }

    const hash = hashPassword(password);
    setPasswordHash(hash);

    // Generate and store credential master key for 07-02 use
    const masterKey = randomBytes(32).toString('hex');
    db.insert(appSettings)
      .values({
        key: 'credential_master_key',
        value: masterKey,
        updatedAt: new Date().toISOString(),
      })
      .onConflictDoUpdate({
        target: appSettings.key,
        set: {
          value: masterKey,
          updatedAt: new Date().toISOString(),
        },
      })
      .run();

    return c.json({ ok: true }, 201);
  });

  /**
   * POST /api/auth/login
   * Body: { password: string }
   * Verifies the password and sets an httpOnly session cookie.
   */
  app.post('/api/auth/login', async (c) => {
    const body = await c.req.json<{ password?: string }>();
    const password = body?.password;

    const storedHash = getPasswordHash();
    if (!storedHash || typeof password !== 'string' || !verifyPassword(password, storedHash)) {
      return c.json({ error: 'Falsches Passwort' }, 401);
    }

    const token = await sign(
      { sub: 'user', iat: Math.floor(Date.now() / 1000) },
      JWT_SECRET,
      'HS256'
    );

    setCookie(c, 'session', token, {
      httpOnly: true,
      sameSite: 'Strict',
      path: '/',
    });

    return c.json({ ok: true });
  });

  /**
   * POST /api/auth/logout
   * Clears the session cookie.
   */
  app.post('/api/auth/logout', (c) => {
    deleteCookie(c, 'session', { path: '/' });
    return c.json({ ok: true });
  });
}
