import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from './crypto.js';

describe('hashPassword', () => {
  it('returns a saltHex:hashHex format string', () => {
    const hash = hashPassword('testpassword');
    const parts = hash.split(':');
    expect(parts).toHaveLength(2);
    const [salt, h] = parts;
    expect(salt).toMatch(/^[0-9a-f]+$/);
    expect(h).toMatch(/^[0-9a-f]+$/);
    // salt is 16 bytes = 32 hex chars; hash is 64 bytes = 128 hex chars
    expect(salt).toHaveLength(32);
    expect(h).toHaveLength(128);
  });

  it('produces different salts on repeated calls (non-deterministic)', () => {
    const hash1 = hashPassword('mypassword');
    const hash2 = hashPassword('mypassword');
    // Same password but different salt should produce different stored strings
    expect(hash1).not.toBe(hash2);
    // And specifically the salt portions should differ
    const salt1 = hash1.split(':')[0];
    const salt2 = hash2.split(':')[0];
    expect(salt1).not.toBe(salt2);
  });
});

describe('verifyPassword', () => {
  it('returns true for correct password', () => {
    const stored = hashPassword('correctpassword');
    expect(verifyPassword('correctpassword', stored)).toBe(true);
  });

  it('returns false for wrong password', () => {
    const stored = hashPassword('correctpassword');
    expect(verifyPassword('wrongpassword', stored)).toBe(false);
  });

  it('returns false when stored string has no colon separator', () => {
    expect(verifyPassword('anypassword', 'nocolon')).toBe(false);
  });

  it('returns false when stored hash is empty after colon', () => {
    // Salt is valid hex but hash portion is empty
    const saltHex = 'aabbccddeeff00112233445566778899';
    expect(verifyPassword('anypassword', `${saltHex}:`)).toBe(false);
  });

  it('returns false for wrong-length hash without crashing (timingSafeEqual safety)', () => {
    // Construct a stored string with a valid salt but truncated hash (not 64 bytes)
    const saltHex = 'aabbccddeeff00112233445566778899'; // 16 bytes
    const shortHash = 'deadbeef'; // 4 bytes, not 64
    expect(verifyPassword('anypassword', `${saltHex}:${shortHash}`)).toBe(false);
  });
});
