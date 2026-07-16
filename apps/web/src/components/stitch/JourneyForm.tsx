'use client';

import { useActionState, useEffect, useState } from 'react';
import { importJourney, connectLichess, disconnectLichess, type ImportActionState } from '@/app/journey/actions';
import { fetchGame, type Game } from '@/lib/api';
import { FogTimelineBar } from './FogTimelineBar';

const initialState: ImportActionState = { status: 'idle' };

export function JourneyForm({ connectedUsername }: { connectedUsername: string | null }) {
  const [state, formAction, isPending] = useActionState(importJourney, initialState);
  const [games, setGames] = useState<Game[]>([]);

  useEffect(() => {
    if (state.status !== 'success' || !state.result) return;
    let cancelled = false;

    (async () => {
      const fetched = await Promise.all(state.result!.gameIds.map((id) => fetchGame(id)));
      if (!cancelled) setGames(fetched.filter((g): g is Game => g !== null));
    })();

    return () => {
      cancelled = true;
    };
  }, [state]);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        {connectedUsername ? (
          <>
            <span className="font-data-mono text-data-mono text-white uppercase">
              Connected as {connectedUsername}
            </span>
            <form action={disconnectLichess}>
              <button
                className="border-[2px] border-white bg-black text-white font-label-caps text-label-caps px-4 py-2 hover:bg-white hover:text-black transition-none uppercase"
                type="submit"
              >
                Disconnect
              </button>
            </form>
          </>
        ) : (
          <form action={connectLichess}>
            <button
              className="border-[2px] border-white bg-black text-white font-label-caps text-label-caps px-4 py-2 hover:bg-white hover:text-black transition-none uppercase"
              type="submit"
            >
              Connect Lichess Account
            </button>
          </form>
        )}
      </div>

      <form action={formAction} className="flex items-center gap-2">
        <input
          className="bg-black/80 backdrop-blur-md border-[2px] border-white text-white text-[12px] p-2 flex-1 outline-none font-data-mono uppercase placeholder:text-white/50"
          defaultValue={connectedUsername ?? undefined}
          disabled={isPending}
          name="username"
          placeholder="LICHESS USERNAME"
          type="text"
        />
        <button
          className="border-[2px] border-white bg-black text-white font-label-caps text-label-caps px-4 py-2 hover:bg-white hover:text-black transition-none uppercase disabled:opacity-50"
          disabled={isPending}
          type="submit"
        >
          {isPending ? 'Importing…' : 'Import'}
        </button>
      </form>

      {state.status === 'error' ? (
        <p className="font-data-mono text-data-mono text-white uppercase">{state.error}</p>
      ) : null}

      {state.status === 'success' && state.result ? (
        <p className="font-data-mono text-data-mono text-white uppercase">
          Imported {state.result.imported} game(s) for {state.result.username}.
        </p>
      ) : null}

      {games.map((game) => (
        <div key={game.id} className="border-[2px] border-white bg-black/80 backdrop-blur-md p-6 flex flex-col gap-4">
          <div className="flex justify-between items-center flex-wrap gap-2 font-data-mono text-data-mono uppercase text-white">
            <span>
              {game.white ?? '?'} vs. {game.black ?? '?'}
            </span>
            <span>{game.result ?? '—'}</span>
          </div>
          {game.analysis?.fogTimeline && game.analysis.fogTimeline.length > 0 ? (
            <FogTimelineBar
              entries={game.analysis.fogTimeline.map((entry) => ({
                ply: entry.ply,
                fog: entry.fog,
                status: entry.status,
              }))}
              proofEntryPly={game.analysis.proofEntryPly}
            />
          ) : (
            <span className="font-data-mono text-[10px] text-white uppercase">
              Not yet analyzed. Run analyze-game for this game to see its fog timeline.
            </span>
          )}
        </div>
      ))}
    </div>
  );
}
