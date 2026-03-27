import { eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { appSettings } from '../db/schema.js';

const PASSWORD_HASH_KEY = 'password_hash';

/**
 * Returns true if a password hash has been stored in app_settings.
 */
export function hasPassword(): boolean {
  const row = db
    .select({ key: appSettings.key })
    .from(appSettings)
    .where(eq(appSettings.key, PASSWORD_HASH_KEY))
    .get();
  return row !== undefined;
}

/**
 * Returns the stored password hash or null if not set.
 */
export function getPasswordHash(): string | null {
  const row = db
    .select({ value: appSettings.value })
    .from(appSettings)
    .where(eq(appSettings.key, PASSWORD_HASH_KEY))
    .get();
  return row?.value ?? null;
}

/**
 * Stores (or overwrites) the password hash in app_settings.
 */
export function setPasswordHash(hash: string): void {
  db.insert(appSettings)
    .values({
      key: PASSWORD_HASH_KEY,
      value: hash,
      updatedAt: new Date().toISOString(),
    })
    .onConflictDoUpdate({
      target: appSettings.key,
      set: {
        value: hash,
        updatedAt: new Date().toISOString(),
      },
    })
    .run();
}
