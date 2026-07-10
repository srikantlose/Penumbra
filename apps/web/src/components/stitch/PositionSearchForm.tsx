'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { computeZobristHash, zobristToHexString } from '@penumbra/core';

/** Accepts either a zobrist ("0x...") or a full FEN, computing the zobrist client-side for a FEN input. */
export function PositionSearchForm() {
  const router = useRouter();
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    const trimmed = value.trim();
    if (!trimmed) return;

    if (/^0x[0-9a-f]+$/i.test(trimmed)) {
      router.push(`/positions/${trimmed.toLowerCase()}`);
      return;
    }

    try {
      const zobrist = zobristToHexString(computeZobristHash(trimmed));
      router.push(`/positions/${zobrist}`);
    } catch {
      setError('Could not parse that as a FEN or zobrist hash.');
    }
  }

  return (
    <form className="flex flex-col gap-2" onSubmit={handleSubmit}>
      <div className="flex items-center gap-2">
        <input
          className="bg-black/80 backdrop-blur-md border-[2px] border-white text-white text-[12px] p-2 flex-1 outline-none font-data-mono uppercase placeholder:text-white/50"
          onChange={(event) => {
            setValue(event.target.value);
            setError(null);
          }}
          placeholder="FEN OR ZOBRIST (0X...)"
          type="text"
          value={value}
        />
        <button
          className="border-[2px] border-white bg-black text-white font-label-caps text-label-caps px-4 py-2 hover:bg-white hover:text-black transition-none uppercase"
          type="submit"
        >
          Look up
        </button>
      </div>
      {error ? <span className="font-data-mono text-[10px] text-white uppercase">{error}</span> : null}
    </form>
  );
}
