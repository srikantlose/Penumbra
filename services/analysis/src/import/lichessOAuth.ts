import crypto from 'node:crypto';

const LICHESS_OAUTH_BASE = 'https://lichess.org';
const REQUEST_TIMEOUT_MS = 30_000;

/** 32 random bytes, base64url-encoded per RFC 7636 -- the PKCE code_verifier. */
export function generateCodeVerifier(): string {
  return crypto.randomBytes(32).toString('base64url');
}

/** BASE64URL(SHA256(code_verifier)) -- the PKCE code_challenge, method S256 (the only one Lichess accepts). */
export function computeCodeChallenge(verifier: string): string {
  return crypto.createHash('sha256').update(verifier).digest('base64url');
}

/** Opaque per-attempt value echoed back by Lichess, used as the Redis lookup key for the stashed verifier (also doubles as CSRF protection). */
export function generateOAuthState(): string {
  return crypto.randomBytes(16).toString('base64url');
}

export interface BuildAuthorizeUrlInput {
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  state: string;
}

/**
 * Lichess's unregistered-client PKCE flow (RFC 7636, no client_secret, any
 * unique client_id): https://lichess.org/oauth is the authorization endpoint.
 */
export function buildLichessAuthorizeUrl(input: BuildAuthorizeUrlInput): string {
  const url = new URL(`${LICHESS_OAUTH_BASE}/oauth`);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', input.clientId);
  url.searchParams.set('redirect_uri', input.redirectUri);
  url.searchParams.set('code_challenge_method', 'S256');
  url.searchParams.set('code_challenge', input.codeChallenge);
  url.searchParams.set('state', input.state);
  return url.toString();
}

export interface ExchangeCodeInput {
  clientId: string;
  redirectUri: string;
  code: string;
  codeVerifier: string;
}

export interface LichessTokenResponse {
  accessToken: string;
  tokenType: string;
}

/**
 * Token exchange has no client_secret (public/unregistered client) -- the
 * code_verifier is what proves this request came from whoever started the
 * flow. Lichess access tokens are long-lived (~1 year) with no refresh
 * token support, so there's no refresh path to implement.
 */
export async function exchangeLichessCode(input: ExchangeCodeInput): Promise<LichessTokenResponse> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code: input.code,
    redirect_uri: input.redirectUri,
    client_id: input.clientId,
    code_verifier: input.codeVerifier,
  });

  const response = await fetch(`${LICHESS_OAUTH_BASE}/api/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(`lichess token exchange failed: ${response.status} ${response.statusText}`);
  }

  const json = (await response.json()) as { access_token?: string; token_type?: string };
  if (!json.access_token) throw new Error('lichess token exchange response missing access_token');
  return { accessToken: json.access_token, tokenType: json.token_type ?? 'Bearer' };
}

export interface LichessAccount {
  id: string;
  username: string;
}

/** Identifies the connected account -- GET /api/account with the bearer token, no scope required. */
export async function fetchLichessAccount(accessToken: string): Promise<LichessAccount> {
  const response = await fetch(`${LICHESS_OAUTH_BASE}/api/account`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(`lichess account fetch failed: ${response.status} ${response.statusText}`);
  }

  const json = (await response.json()) as { id?: string; username?: string };
  if (!json.id || !json.username) throw new Error('lichess account response missing id/username');
  return { id: json.id, username: json.username };
}
