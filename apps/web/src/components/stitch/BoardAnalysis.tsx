'use client';

import { useState } from 'react';
import { computeZobristHash, zobristToHexString } from '@penumbra/core';
import { fetchPosition, type PositionDetail } from '@/lib/api';
import { useFogPoll } from '@/hooks/useFogPoll';
import { FogIndexCard } from './FogIndexCard';
import { TruthStatusCard } from './TruthStatusCard';

const DEFAULT_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

function truncateMiddle(value: string, keep = 10): string {
  if (value.length <= keep * 2 + 1) return value;
  return `${value.slice(0, keep)}…${value.slice(-keep)}`;
}

export function BoardAnalysis() {
  const [fenInput, setFenInput] = useState(DEFAULT_FEN);
  const [position, setPosition] = useState<PositionDetail | null>(null);
  const [zobrist, setZobrist] = useState<string | null>(null);
  const { state, poll } = useFogPoll();

  async function handleAnalyze(event: React.FormEvent) {
    event.preventDefault();
    const fen = fenInput.trim();
    if (!fen) return;

    const z = zobristToHexString(computeZobristHash(fen));
    setZobrist(z);
    setPosition(null);
    void poll(fen);
    setPosition(await fetchPosition(z));
  }

  return (
    <div className="flex-1 flex flex-col gap-6">
      <form className="flex items-center gap-2" onSubmit={handleAnalyze}>
        <input
          className="bg-black/80 backdrop-blur-md border-[2px] border-white text-white text-[12px] p-2 flex-1 outline-none font-data-mono uppercase"
          onChange={(event) => setFenInput(event.target.value)}
          placeholder="FEN"
          type="text"
          value={fenInput}
        />
        <button
          className="border-[2px] border-white bg-black text-white font-label-caps text-label-caps px-4 py-2 hover:bg-white hover:text-black transition-none uppercase"
          type="submit"
        >
          Analyze
        </button>
      </form>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {state.status === 'ready' ? (
          <FogIndexCard
            components={[
              { label: 'Disagreement', value: state.fog.components.disagreement.toFixed(2) },
              { label: 'Volatility', value: state.fog.components.depthVolatility.toFixed(2) },
              { label: 'Criticality', value: state.fog.components.moveCriticality.toFixed(2) },
            ]}
            percentile={state.fog.percentile}
            score={state.fog.score}
          />
        ) : (
          <div className="border-[2px] border-white bg-black/80 backdrop-blur-md p-6 flex items-center justify-center">
            <span className="font-label-caps text-label-caps text-white uppercase">
              {state.status === 'polling'
                ? 'Analyzing…'
                : state.status === 'error'
                  ? state.message
                  : 'Enter a FEN and analyze'}
            </span>
          </div>
        )}
        <TruthStatusCard
          description={
            state.status === 'ready'
              ? state.fog.status === 'PROVEN'
                ? 'Machine-verified via certificate or tablebase probe.'
                : 'Engine opinion only. No certificate or tablebase hit yet.'
              : 'Awaiting analysis.'
          }
          status={state.status === 'ready' ? state.fog.status : 'EVALUATED'}
        />
      </div>

      {/* Engine Ladder -- every eval row for this position's latest engine fingerprint */}
      <div className="border-[2px] border-white bg-black/80 backdrop-blur-md flex flex-col flex-1 min-h-[300px]">
        <div className="p-4 border-b-[2px] border-white flex justify-between items-center">
          <span className="font-label-caps text-label-caps text-white uppercase">ENGINE LADDER</span>
          {zobrist ? <span className="font-data-mono text-[10px] text-white uppercase">{zobrist}</span> : null}
        </div>
        <div className="p-4 overflow-x-auto">
          <table className="w-full text-left font-data-mono text-data-mono uppercase text-white">
            <thead>
              <tr className="border-b-[2px] border-white">
                <th className="pb-2 font-bold">Engine</th>
                <th className="pb-2 font-bold">Nodes</th>
                <th className="pb-2 font-bold">Depth</th>
                <th className="pb-2 font-bold text-right">Score</th>
              </tr>
            </thead>
            <tbody>
              {!position || position.evals.length === 0 ? (
                <tr>
                  <td className="py-3" colSpan={4}>
                    {position ? 'No evaluations yet.' : 'Analyze a position to see its evals.'}
                  </td>
                </tr>
              ) : (
                position.evals.map((row, i) => (
                  <tr key={i} className="border-b-[2px] border-white border-dashed">
                    <td className="py-3">{row.engine}</td>
                    <td className="py-3">{row.nodes?.toLocaleString() ?? '—'}</td>
                    <td className="py-3">{row.depth ?? '—'}</td>
                    <td className="py-3 text-right">{row.scoreMate !== null ? `#${row.scoreMate}` : row.scoreCp ?? '—'}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Archaeology List -- append-only proof references for this position */}
      <div className="border-[2px] border-white bg-black/80 backdrop-blur-md p-4">
        <div className="font-label-caps text-label-caps text-white mb-4 uppercase">ARCHAEOLOGY LIST</div>
        <div className="flex flex-col gap-2 font-data-mono text-data-mono uppercase">
          {!position || position.proofRefs.length === 0 ? (
            <span className="text-white">No proof references for this position.</span>
          ) : (
            position.proofRefs.map((ref) => (
              <div
                key={ref.id}
                className="flex justify-between items-center p-3 bg-black/80 backdrop-blur-md border-[2px] border-white"
              >
                <div className="flex gap-4 items-center">
                  <span className="text-white font-bold">
                    {ref.value}
                    {ref.bound ? ` (${ref.bound})` : ''}
                  </span>
                  <span className="text-white">{truncateMiddle(ref.certificateSha256 ?? '', 8)}</span>
                </div>
                <span className="font-label-caps text-[10px] px-2 py-0.5 border-[2px] border-white bg-white text-black">
                  {ref.status}
                </span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
