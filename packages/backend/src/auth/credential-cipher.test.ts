import { describe, expect, it } from 'vitest';
import { decryptCredentials, encryptCredentials } from './credential-cipher.js';

// Note: getCredentialMasterKey() is tested via integration (exchanges.test.ts) because
// it requires a live DB. The pure crypto functions are tested here without DB dependencies.

const MASTER_KEY = 'test-master-key-abcdefghijklmnopqrstuvwxyz012345';

describe('credential-cipher', () => {
  describe('encryptCredentials', () => {
    it('produces a JSON blob with all 4 required fields', () => {
      const blob = encryptCredentials('{"apiKey":"abc","secret":"xyz"}', MASTER_KEY);
      const parsed = JSON.parse(blob) as Record<string, unknown>;

      expect(parsed).toHaveProperty('iv');
      expect(parsed).toHaveProperty('salt');
      expect(parsed).toHaveProperty('authTag');
      expect(parsed).toHaveProperty('ciphertext');
    });

    it('produces hex strings for all fields', () => {
      const blob = encryptCredentials('plaintext', MASTER_KEY);
      const parsed = JSON.parse(blob) as Record<string, string>;

      // All fields should be valid hex strings
      expect(parsed.iv).toMatch(/^[0-9a-f]+$/);
      expect(parsed.salt).toMatch(/^[0-9a-f]+$/);
      expect(parsed.authTag).toMatch(/^[0-9a-f]+$/);
      expect(parsed.ciphertext).toMatch(/^[0-9a-f]+$/);
    });

    it('two encryptions of the same plaintext produce different blobs (random IV/salt)', () => {
      const plaintext = 'same-credentials-each-time';
      const blob1 = encryptCredentials(plaintext, MASTER_KEY);
      const blob2 = encryptCredentials(plaintext, MASTER_KEY);

      expect(blob1).not.toBe(blob2);

      const p1 = JSON.parse(blob1) as Record<string, string>;
      const p2 = JSON.parse(blob2) as Record<string, string>;
      expect(p1.iv).not.toBe(p2.iv);
      expect(p1.salt).not.toBe(p2.salt);
    });

    it('encrypted blob does not contain the plaintext', () => {
      const plaintext = 'supersecretapikey12345';
      const blob = encryptCredentials(plaintext, MASTER_KEY);

      expect(blob).not.toContain(plaintext);
      // Also check the individual hex fields don't decode to the plaintext
      const parsed = JSON.parse(blob) as Record<string, string>;
      expect(Buffer.from(parsed.ciphertext, 'hex').toString('utf8')).not.toBe(plaintext);
    });
  });

  describe('decryptCredentials', () => {
    it('encrypt then decrypt with same key returns original text', () => {
      const original = JSON.stringify({ apiKey: 'mykey', secret: 'mysecret', password: 'mypass' });
      const blob = encryptCredentials(original, MASTER_KEY);
      const decrypted = decryptCredentials(blob, MASTER_KEY);

      expect(decrypted).toBe(original);
    });

    it('decrypt with wrong key throws (authTag mismatch)', () => {
      const blob = encryptCredentials('credentials', MASTER_KEY);
      const wrongKey = 'completely-different-wrong-key-for-testing-purposes';

      expect(() => decryptCredentials(blob, wrongKey)).toThrow();
    });

    it('decrypt with slightly modified ciphertext throws', () => {
      const blob = encryptCredentials('credentials', MASTER_KEY);
      const parsed = JSON.parse(blob) as Record<string, string>;

      // Flip one hex character in the ciphertext
      const badCiphertext = `${parsed.ciphertext.slice(0, -2)}ff`;
      const tampered = JSON.stringify({ ...parsed, ciphertext: badCiphertext });

      expect(() => decryptCredentials(tampered, MASTER_KEY)).toThrow();
    });

    it('handles unicode/special characters in plaintext', () => {
      const plaintext = '{"password":"GermanUmlautÄÖÜß123!@#$%"}';
      const blob = encryptCredentials(plaintext, MASTER_KEY);
      const decrypted = decryptCredentials(blob, MASTER_KEY);

      expect(decrypted).toBe(plaintext);
    });
  });
});
