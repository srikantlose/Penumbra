// Signed session cookie for "connect Lichess account" (docs/ROADMAP.md
// deferred backlog). Deliberately not encrypted -- it only carries a userId
// and a public lichess username, neither secret -- just signed (HMAC) so a
// client can't forge or edit one. The actual Lichess access token never
// reaches the browser; it stays server-side in apps/api's users.oauth_tokens
// column (see apps/api/src/lichessOAuth.ts).

import crypto from 'node:crypto';
import { cookies } from 'next/headers';

const SESSION_COOKIE = 'pn_session';
// Lichess access tokens are themselves long-lived (~1 year, no refresh
// token support) -- match that so "connected" doesn't silently expire
// sooner than the credential backing it.
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

export interface SessionPayload {
  userId: number;
  lichessUsername: string;
}

function sessionSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error('SESSION_SECRET is not set on the web server');
  return secret;
}

function sign(value: string): string {
  return crypto.createHmac('sha256', sessionSecret()).update(value).digest('base64url');
}

function isValidSignature(value: string, signature: string): boolean {
  const expected = Buffer.from(sign(value));
  const actual = Buffer.from(signature);
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

export async function createSession(payload: SessionPayload): Promise<void> {
  const value = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const store = await cookies();
  store.set(SESSION_COOKIE, `${value}.${sign(value)}`, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: SESSION_MAX_AGE_SECONDS,
  });
}

export async function getSession(): Promise<SessionPayload | null> {
  const store = await cookies();
  const raw = store.get(SESSION_COOKIE)?.value;
  if (!raw) return null;

  const dotIndex = raw.lastIndexOf('.');
  if (dotIndex === -1) return null;
  const value = raw.slice(0, dotIndex);
  const signature = raw.slice(dotIndex + 1);
  if (!isValidSignature(value, signature)) return null;

  try {
    return JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as SessionPayload;
  } catch {
    return null;
  }
}

export async function clearSession(): Promise<void> {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
}
