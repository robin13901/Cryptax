import { createCipheriv, createDecipheriv, pbkdf2Sync, randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { appSettings } from '../db/schema.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CredentialBlob {
  iv: string;
  salt: string;
  authTag: string;
  ciphertext: string;
}

// ---------------------------------------------------------------------------
// Key derivation
// ---------------------------------------------------------------------------

const PBKDF2_ITERATIONS = 100_000;
const KEY_LEN = 32;
const HASH = 'sha256';
const IV_LEN = 12; // 96-bit IV is standard for AES-256-GCM
const SALT_LEN = 16;

function deriveKey(masterKey: string, salt: Buffer): Buffer {
  return pbkdf2Sync(masterKey, salt, PBKDF2_ITERATIONS, KEY_LEN, HASH);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Encrypts a plaintext string using AES-256-GCM with PBKDF2 key derivation.
 * Returns a JSON string containing iv, salt, authTag, and ciphertext (all hex).
 */
export function encryptCredentials(plaintext: string, masterKey: string): string {
  const salt = randomBytes(SALT_LEN);
  const iv = randomBytes(IV_LEN);
  const key = deriveKey(masterKey, salt);

  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  const blob: CredentialBlob = {
    iv: iv.toString('hex'),
    salt: salt.toString('hex'),
    authTag: authTag.toString('hex'),
    ciphertext: encrypted.toString('hex'),
  };

  return JSON.stringify(blob);
}

/**
 * Decrypts a credential blob produced by encryptCredentials.
 * Throws if the master key is wrong (authTag mismatch) or the blob is malformed.
 */
export function decryptCredentials(blobJson: string, masterKey: string): string {
  const blob: CredentialBlob = JSON.parse(blobJson) as CredentialBlob;

  const salt = Buffer.from(blob.salt, 'hex');
  const iv = Buffer.from(blob.iv, 'hex');
  const authTag = Buffer.from(blob.authTag, 'hex');
  const ciphertext = Buffer.from(blob.ciphertext, 'hex');

  const key = deriveKey(masterKey, salt);

  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return decrypted.toString('utf8');
}

/**
 * Returns the credential master key stored in app_settings.
 * Throws if the key has not been generated (requires POST /api/auth/setup first).
 */
export function getCredentialMasterKey(): string {
  const row = db
    .select({ value: appSettings.value })
    .from(appSettings)
    .where(eq(appSettings.key, 'credential_master_key'))
    .get();

  if (!row) {
    throw new Error('No credential master key configured. Run setup first.');
  }

  return row.value;
}
