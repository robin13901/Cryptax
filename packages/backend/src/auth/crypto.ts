import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

/**
 * Hashes a password using scrypt with a random salt.
 * Returns a string in the format `saltHex:hashHex`.
 */
export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 64, { N: 16384 });
  return `${salt.toString('hex')}:${hash.toString('hex')}`;
}

/**
 * Verifies a password against a stored `saltHex:hashHex` string.
 * Uses timingSafeEqual to prevent timing attacks.
 */
export function verifyPassword(password: string, stored: string): boolean {
  const colonIdx = stored.indexOf(':');
  if (colonIdx === -1) return false;

  const saltHex = stored.slice(0, colonIdx);
  const hashHex = stored.slice(colonIdx + 1);

  let salt: Buffer;
  let expectedHash: Buffer;
  try {
    salt = Buffer.from(saltHex, 'hex');
    expectedHash = Buffer.from(hashHex, 'hex');
  } catch {
    return false;
  }

  if (expectedHash.length === 0) return false;

  let actualHash: Buffer;
  try {
    actualHash = scryptSync(password, salt, 64, { N: 16384 }) as Buffer;
  } catch {
    return false;
  }

  if (actualHash.length !== expectedHash.length) return false;

  return timingSafeEqual(actualHash, expectedHash);
}
