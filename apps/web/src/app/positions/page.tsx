import { FogIndexCard } from '@/components/stitch/FogIndexCard';
import { TruthStatusCard } from '@/components/stitch/TruthStatusCard';

const EVAL_HISTORY = [
  { engine: 'Stockfish 16', nodes: '1M', depth: '28', score: '+9.14', fingerprint: '0x7a3f…' },
  { engine: 'Stockfish 16', nodes: '64M', depth: '41', score: '+9.02', fingerprint: '0x7a3f…' },
  { engine: 'Lc0 v0.31.0', nodes: '30k', depth: '-', score: '+8.87', fingerprint: '0xc19e…' },
];

export default function PositionsPage() {
  return (
    <main className="relative z-10 pt-24 pb-16 px-gutter flex flex-col max-w-[1440px] mx-auto w-full gap-6">
      <div className="border-[2px] border-white bg-black/80 backdrop-blur-md p-6 flex flex-col gap-4">
        <div className="flex items-center justify-between flex-wrap gap-4">
          <h1 className="font-headline-md text-headline-md text-white uppercase">Position</h1>
          <span className="font-data-mono text-data-mono text-white border-[2px] border-white px-2 py-1">
            4 PIECES
          </span>
        </div>
        <div className="flex items-center gap-2">
          <input
            className="bg-black/80 backdrop-blur-md border-[2px] border-white text-white text-[12px] p-2 flex-1 outline-none font-data-mono uppercase"
            readOnly
            type="text"
            value="4k3/8/4K3/8/8/8/8/3Q4 w - - 0 1"
          />
          <button className="w-10 h-10 border-[2px] border-white flex items-center justify-center hover:bg-white hover:text-black transition-none text-white">
            <span className="material-symbols-outlined text-[18px]">content_copy</span>
          </button>
        </div>
        <div className="font-data-mono text-data-mono text-white uppercase">
          ZOBRIST 0x9f3c1a7b0e2d4568
        </div>
      </div>

      {/* Provenance */}
      <div className="border-[2px] border-white bg-black/80 backdrop-blur-md p-6 flex flex-col gap-2">
        <div className="font-label-caps text-label-caps text-white mb-2 uppercase">Provenance</div>
        <div className="flex flex-col gap-2 font-data-mono text-data-mono uppercase text-white">
          <div className="flex justify-between gap-2">
            <span>First seen:</span>
            <span>Carlsen vs. Nakamura, 2026-03-14</span>
          </div>
          <div className="flex justify-between gap-2">
            <span>Occurrences:</span>
            <span>1,204 games</span>
          </div>
          <div className="flex justify-between gap-2">
            <span>Source:</span>
            <span>Lichess elite database</span>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <FogIndexCard
          score={0}
          components={[
            { label: 'Disagreement', value: '0.00' },
            { label: 'Volatility', value: '0.00' },
            { label: 'Tablebase distance', value: '0.00' },
          ]}
        />
        <TruthStatusCard status="PROVEN" description="Tablebase win. Verified via Syzygy 4-piece probe." />
      </div>

      {/* Eval History */}
      <div className="border-[2px] border-white bg-black/80 backdrop-blur-md flex flex-col">
        <div className="p-4 border-b-[2px] border-white">
          <span className="font-label-caps text-label-caps text-white uppercase">Eval History</span>
        </div>
        <div className="p-4 overflow-x-auto">
          <table className="w-full text-left font-data-mono text-data-mono uppercase text-white">
            <thead>
              <tr className="border-b-[2px] border-white">
                <th className="pb-2 font-bold">Engine</th>
                <th className="pb-2 font-bold">Nodes</th>
                <th className="pb-2 font-bold">Depth</th>
                <th className="pb-2 font-bold">Score</th>
                <th className="pb-2 font-bold text-right">Fingerprint</th>
              </tr>
            </thead>
            <tbody>
              {EVAL_HISTORY.map((row, i) => (
                <tr key={i} className="border-b-[2px] border-white border-dashed">
                  <td className="py-3">{row.engine}</td>
                  <td className="py-3">{row.nodes}</td>
                  <td className="py-3">{row.depth}</td>
                  <td className="py-3">{row.score}</td>
                  <td className="py-3 text-right">{row.fingerprint}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Proof Reference */}
      <div className="border-[2px] border-white bg-black/80 backdrop-blur-md p-6 flex flex-col gap-3">
        <div className="font-label-caps text-label-caps text-white mb-2 uppercase">Proof Reference</div>
        <div className="flex flex-col gap-2 font-data-mono text-data-mono uppercase text-white">
          <div className="flex justify-between gap-2">
            <span>Claim:</span>
            <span>win(white)</span>
          </div>
          <div className="flex justify-between gap-2">
            <span>Format version:</span>
            <span>0.1</span>
          </div>
          <div className="flex justify-between gap-2 flex-wrap">
            <span>Certificate SHA256:</span>
            <span>0x4e1f9c2b7a3d…</span>
          </div>
        </div>
        <button className="self-start border-[2px] border-white bg-black text-white font-label-caps text-label-caps px-4 py-2 hover:bg-white hover:text-black transition-none uppercase mt-2">
          Download certificate
        </button>
      </div>
    </main>
  );
}
