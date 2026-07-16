import crypto from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  generateCodeVerifier,
  computeCodeChallenge,
  generateOAuthState,
  buildLichessAuthorizeUrl,
} from './lichessOAuth.js';

describe('generateCodeVerifier', () => {
  it('produces a url-safe string with no padding characters', () => {
    const verifier = generateCodeVerifier();
    expect(verifier).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(verifier).not.toContain('=');
  });

  it('is not reused across calls', () => {
    expect(generateCodeVerifier()).not.toBe(generateCodeVerifier());
  });
});

describe('computeCodeChallenge', () => {
  it('matches an independently computed sha256/base64url digest (RFC 7636 S256)', () => {
    const verifier = 'a-fixed-test-verifier-value';
    const expected = crypto.createHash('sha256').update(verifier).digest('base64url');
    expect(computeCodeChallenge(verifier)).toBe(expected);
  });

  it('is deterministic for the same verifier', () => {
    const verifier = generateCodeVerifier();
    expect(computeCodeChallenge(verifier)).toBe(computeCodeChallenge(verifier));
  });
});

describe('generateOAuthState', () => {
  it('is not reused across calls', () => {
    expect(generateOAuthState()).not.toBe(generateOAuthState());
  });
});

describe('buildLichessAuthorizeUrl', () => {
  it('builds the authorize URL with every required PKCE query param', () => {
    const url = new URL(
      buildLichessAuthorizeUrl({
        clientId: 'penumbra-test',
        redirectUri: 'https://example.test/journey/connect/callback',
        codeChallenge: 'challenge-value',
        state: 'state-value',
      })
    );

    expect(url.origin + url.pathname).toBe('https://lichess.org/oauth');
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('client_id')).toBe('penumbra-test');
    expect(url.searchParams.get('redirect_uri')).toBe('https://example.test/journey/connect/callback');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('code_challenge')).toBe('challenge-value');
    expect(url.searchParams.get('state')).toBe('state-value');
  });
});
