'use server';

import { postBffImport, type BffImportResult } from '@/lib/api';

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
