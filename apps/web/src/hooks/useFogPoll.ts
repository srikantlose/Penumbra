'use client';

import { useCallback, useRef, useState } from 'react';
import { fetchFog, type FogReady } from '@/lib/api';

const MAX_ATTEMPTS = 30;

export type FogPollState =
  | { status: 'idle' }
  | { status: 'polling' }
  | { status: 'ready'; fog: FogReady }
  | { status: 'error'; message: string };

/** Client-side 202->200 fog poll with the server-given retry_after_ms backoff (docs/ROADMAP.md Stage 6). */
export function useFogPoll() {
  const [state, setState] = useState<FogPollState>({ status: 'idle' });
  const requestId = useRef(0);

  const poll = useCallback(async (fen: string) => {
    const thisRequest = ++requestId.current;
    setState({ status: 'polling' });

    try {
      for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
        const result = await fetchFog(fen);
        if (thisRequest !== requestId.current) return; // a newer poll superseded this one

        if (result.status !== 'pending') {
          setState({ status: 'ready', fog: result });
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, result.retry_after_ms));
      }
      if (thisRequest === requestId.current) {
        setState({ status: 'error', message: 'Timed out waiting for a fog score.' });
      }
    } catch (err) {
      if (thisRequest === requestId.current) {
        setState({ status: 'error', message: err instanceof Error ? err.message : 'Unknown error.' });
      }
    }
  }, []);

  return { state, poll };
}
