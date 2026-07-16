import { NextResponse, type NextRequest } from 'next/server';
import { postBffLichessOAuthCallback } from '@/lib/api';
import { createSession } from '@/lib/session';

/**
 * Where Lichess redirects back to after the user accepts/declines the
 * consent screen (redirect_uri registered in apps/api's
 * lichessOAuthRedirectUri() -- must match exactly). A GET route handler,
 * not a Server Action, because Lichess navigates the browser here directly;
 * nothing else in this app can invoke it.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const { searchParams } = request.nextUrl;
  const oauthError = searchParams.get('error');
  if (oauthError) {
    return NextResponse.redirect(new URL(`/journey?error=${encodeURIComponent(oauthError)}`, request.url));
  }

  const code = searchParams.get('code');
  const state = searchParams.get('state');
  if (!code || !state) {
    return NextResponse.redirect(new URL('/journey?error=missing_code', request.url));
  }

  try {
    const { userId, lichessUsername } = await postBffLichessOAuthCallback(code, state);
    await createSession({ userId, lichessUsername });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'oauth callback failed';
    return NextResponse.redirect(new URL(`/journey?error=${encodeURIComponent(message)}`, request.url));
  }

  return NextResponse.redirect(new URL('/journey?connected=1', request.url));
}
