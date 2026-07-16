import { beforeAll, describe, expect, it } from 'vitest';
import { encryptOAuthToken, decryptOAuthToken } from './lichessOAuth.js';

describe('encryptOAuthToken / decryptOAuthToken', () => {
  beforeAll(() => {
    process.env.TOKEN_ENCRYPTION_KEY = '0'.repeat(64);
  });

  it('round-trips a plaintext token', () => {
    const plaintext = JSON.stringify({ accessToken: 'lio_abc123', tokenType: 'Bearer' });
    const encrypted = encryptOAuthToken(plaintext);
    expect(decryptOAuthToken(encrypted)).toBe(plaintext);
  });

  it('never stores the plaintext token verbatim in the ciphertext blob', () => {
    const plaintext = 'lio_super_secret_token';
    expect(encryptOAuthToken(plaintext)).not.toContain(plaintext);
  });

  it('produces a different ciphertext each time (random iv) even for the same plaintext', () => {
    const plaintext = 'lio_same_token';
    expect(encryptOAuthToken(plaintext)).not.toBe(encryptOAuthToken(plaintext));
  });

  it('throws on a malformed stored value instead of returning garbage', () => {
    expect(() => decryptOAuthToken('not-the-right-shape')).toThrow('malformed encrypted oauth token');
  });

  it('throws a clear error when TOKEN_ENCRYPTION_KEY is unset', () => {
    const saved = process.env.TOKEN_ENCRYPTION_KEY;
    delete process.env.TOKEN_ENCRYPTION_KEY;
    try {
      expect(() => encryptOAuthToken('x')).toThrow('TOKEN_ENCRYPTION_KEY is not set');
    } finally {
      process.env.TOKEN_ENCRYPTION_KEY = saved;
    }
  });
});
