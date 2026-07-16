'use server';

import { redirect } from 'next/navigation';
import { postBffImport, postBffLichessOAuthStart, type BffImportResult } from '@/lib/api';
import { clearSession } from '@/lib/session';

export interface ImportActionState {
  status: 'idle' | 'success' | 'error';
  result?: BffImportResult;
  error?: string;
}

const DEFAULT_IMPORT_MAX = 10;

export async function importJourney(_prevState: ImportActionState, formData: FormData): Promise<ImportActionState> {
  const username = String(formData.get('username') ?? '').trim();
  if (!username) return { status: 'error', error: 'Enter a Lichess username.' };

  try {
    const result = await postBffImport(username, DEFAULT_IMPORT_MAX);
    return { status: 'success', result };
  } catch (err) {
    return { status: 'error', error: err instanceof Error ? err.message : 'Import failed.' };
  }
}

/** Kicks off the PKCE flow and sends the browser to Lichess's consent screen. */
export async function connectLichess(): Promise<void> {
  const { authorizeUrl } = await postBffLichessOAuthStart();
  redirect(authorizeUrl);
}

/** Forgets the local session only -- does not revoke the Lichess grant (the user can do that from lichess.org themselves). */
export async function disconnectLichess(): Promise<void> {
  await clearSession();
  redirect('/journey');
}
