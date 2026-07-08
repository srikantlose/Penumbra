import { EngineSidebar } from '@/components/stitch/EngineSidebar';
import { FogIndexCard } from '@/components/stitch/FogIndexCard';
import { TruthStatusCard } from '@/components/stitch/TruthStatusCard';

const LIGHT = 'sq-light';
const DARK = 'sq-dark';
// Standard 8x8 alternating pattern, row 8 (top) to row 1 (bottom).
const BOARD_ROWS = Array.from({ length: 8 }, (_, row) =>
  Array.from({ length: 8 }, (_, col) => ((row + col) % 2 === 0 ? LIGHT : DARK)),
);

const ENGINE_LADDER = [
  { nodes: '1M', sf: '52.1%', sfMove: 'Nd4+', lc0: '-', delta: '-', current: false },
  { nodes: '4M', sf: '54.3%', sfMove: 'Nd4+', lc0: '-', delta: '-', current: false },
  { nodes: '64M', sf: '41.0%', sfMove: 'Kf8', lc0: '78.5%', lc0Move: 'Nd4+', delta: '37.5', current: true },
];

const ARCHAEOLOGY = [
  { ply: '38.', move: 'Nxe5', status: 'PROVEN' as const },
  { ply: '38...', move: 'dxe5', status: 'PROVEN' as const },
  { ply: '39.', move: 'Re7+', status: 'EVALUATED' as const, highlighted: true },
];

export default function BoardPage() {
  return (
    <>
      <EngineSidebar />
      <main className="relative z-10 pt-16 md:pl-sidebar-width min-h-screen flex flex-col xl:flex-row gap-gutter p-gutter pb-32">
        <div className="flex flex-col gap-4 w-full xl:w-board-size-lg shrink-0">
          <div className="flex justify-between items-end">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-black/80 backdrop-blur-md border-[2px] border-white flex items-center justify-center">
                <span className="material-symbols-outlined text-white">person</span>
              </div>
              <div>
                <div className="font-body-md text-body-md text-white uppercase">Magnus_Carlsen</div>
                <div className="font-data-mono text-data-mono text-white">2882</div>
              </div>
            </div>
            <div className="font-data-mono text-data-mono bg-black/80 backdrop-blur-md px-2 py-1 border-[2px] border-white text-white">
              +0.35
            </div>
          </div>

          {/* Chessboard (static demo position, not wired to real game state yet) */}
          <div className="relative w-full aspect-square bg-black/80 backdrop-blur-md select-none border-[12px] border-black">
            <div className="absolute top-0 left-[-24px] bottom-0 w-[20px] flex flex-col justify-around text-center font-data-mono text-[12px] text-white font-bold">
              {['8', '7', '6', '5', '4', '3', '2', '1'].map((rank) => (
                <span key={rank}>{rank}</span>
              ))}
            </div>
            <div className="absolute bottom-[-24px] left-0 right-0 h-[20px] flex justify-around items-center font-data-mono text-[12px] text-white font-bold">
              {['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'].map((file) => (
                <span key={file}>{file}</span>
              ))}
            </div>
            <div className="grid-board w-full h-full relative z-0 shadow-[8px_8px_0px_rgba(255,255,255,0.2)]">
              {BOARD_ROWS.flat().map((sq, i) => (
                <div key={i} className={sq} />
              ))}
            </div>
            <div className="absolute inset-0 fog-overlay z-10 mix-blend-multiply" />
            <div className="absolute top-[12.5%] left-[25%] w-[12.5%] h-[12.5%] flex items-center justify-center z-20">
              <span className="material-symbols-outlined text-[48px] text-black drop-shadow-[2px_2px_0px_white]">
                chess_knight
              </span>
            </div>
            <div className="absolute top-[87.5%] left-[50%] w-[12.5%] h-[12.5%] flex items-center justify-center z-20">
              <span className="material-symbols-outlined text-[48px] text-white drop-shadow-[2px_2px_0px_black]">
                chess_king
              </span>
            </div>
          </div>

          <div className="flex items-start justify-between mt-2">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-black/80 backdrop-blur-md border-[2px] border-white flex items-center justify-center">
                <span className="material-symbols-outlined text-white">person_outline</span>
              </div>
              <div>
                <div className="font-body-md text-body-md text-white uppercase">Hikaru_Nakamura</div>
                <div className="font-data-mono text-data-mono text-white">2875</div>
              </div>
            </div>
          </div>

          {/* Fog Timeline */}
          <div className="mt-6 flex flex-col gap-2">
            <div className="flex justify-between items-end">
              <span className="font-label-caps text-label-caps text-white">FOG TIMELINE</span>
              <span className="font-data-mono text-[10px] text-white">INDEX v0.1</span>
            </div>
            <div className="h-6 w-full border-[2px] border-white bg-black/80 backdrop-blur-md flex relative overflow-hidden">
              <div className="h-full w-[20%] bg-black/80 backdrop-blur-md border-r-[2px] border-white" />
              <div className="h-full w-[35%] dither-bg border-r-[2px] border-white" />
              <div className="h-full w-[10%] dither-bg-dark relative border-r-[2px] border-white">
                <div className="absolute top-0 bottom-0 left-1/2 w-[4px] bg-white -translate-x-1/2" />
              </div>
              <div className="h-full w-[35%] dither-bg" />
            </div>
            <div className="flex justify-between font-data-mono text-[10px] text-white uppercase">
              <span>Ply 10</span>
              <span>Ply 40 (Current)</span>
              <span>Ply 80</span>
            </div>
          </div>
        </div>

        <div className="flex-1 flex flex-col gap-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <FogIndexCard
              score={82}
              components={[
                { label: 'Disagreement', value: '0.92' },
                { label: 'Volatility', value: '0.78' },
                { label: 'Criticality', value: '1.00' },
              ]}
            />
            <TruthStatusCard
              status="EVALUATED"
              description="Position unresolved. Engine divergence exceeds threshold. No tablebase hit."
            />
          </div>

          {/* Engine Ladder */}
          <div className="border-[2px] border-white bg-black/80 backdrop-blur-md flex flex-col flex-1 min-h-[400px]">
            <div className="p-4 border-b-[2px] border-white flex justify-between items-center">
              <span className="font-label-caps text-label-caps text-white uppercase">ENGINE LADDER</span>
              <div className="flex gap-2">
                <span className="font-data-mono text-[10px] border-[2px] border-white px-2 py-1 text-white uppercase">
                  SF 16.1
                </span>
                <span className="font-data-mono text-[10px] border-[2px] border-white px-2 py-1 text-white uppercase">
                  Lc0 v0.30
                </span>
              </div>
            </div>
            <div className="p-4 overflow-x-auto">
              <table className="w-full text-left font-data-mono text-data-mono uppercase text-white">
                <thead>
                  <tr className="border-b-[2px] border-white">
                    <th className="pb-2 font-bold w-16">Nodes</th>
                    <th className="pb-2 font-bold">Stockfish (WP)</th>
                    <th className="pb-2 font-bold">Lc0 (WP)</th>
                    <th className="pb-2 font-bold text-right">Delta</th>
                  </tr>
                </thead>
                <tbody>
                  {ENGINE_LADDER.map((row) => (
                    <tr
                      key={row.nodes}
                      className={
                        row.current
                          ? 'bg-white text-black border-b-[2px] border-white'
                          : 'border-b-[2px] border-white border-dashed'
                      }
                    >
                      <td className={`py-3 ${row.current ? 'font-bold' : ''}`}>{row.nodes}</td>
                      <td className={`py-3 ${row.current ? 'font-bold' : ''}`}>
                        {row.sf}{' '}
                        {row.sfMove ? <span className="text-[10px] ml-2 opacity-80">{row.sfMove}</span> : null}
                      </td>
                      <td className={`py-3 ${row.current ? 'font-bold' : ''}`}>
                        {row.lc0}{' '}
                        {row.lc0Move ? <span className="text-[10px] ml-2 opacity-80">{row.lc0Move}</span> : null}
                      </td>
                      <td className={`py-3 text-right ${row.current ? 'font-bold' : ''}`}>{row.delta}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Archaeology List */}
          <div className="border-[2px] border-white bg-black/80 backdrop-blur-md p-4">
            <div className="font-label-caps text-label-caps text-white mb-4 uppercase">ARCHAEOLOGY LIST</div>
            <div className="flex flex-col gap-2 font-data-mono text-data-mono uppercase">
              {ARCHAEOLOGY.map((entry) => (
                <div
                  key={entry.ply}
                  className={`flex justify-between items-center p-3 bg-black/80 backdrop-blur-md ${
                    entry.highlighted ? 'border-[4px] border-white' : 'border-[2px] border-white'
                  }`}
                >
                  <div className="flex gap-4 items-center">
                    <span className="text-white w-6 text-right">{entry.ply}</span>
                    <span className="text-white font-bold">{entry.move}</span>
                  </div>
                  <span
                    className={`font-label-caps text-[10px] px-2 py-0.5 border-[2px] border-white ${
                      entry.status === 'PROVEN' ? 'bg-white text-black' : 'text-white'
                    }`}
                  >
                    {entry.status}
                  </span>
                </div>
              ))}
              <div className="flex items-center gap-2 mt-2">
                <input
                  className="bg-black/80 backdrop-blur-md border-[2px] border-white text-white text-[12px] p-2 flex-1 outline-none font-data-mono uppercase"
                  readOnly
                  type="text"
                  value="8/4R3/2k5/4p3/8/8/5K2/8 b - - 0 39"
                />
                <button className="w-10 h-10 border-[2px] border-white flex items-center justify-center hover:bg-white hover:text-black transition-none text-white">
                  <span className="material-symbols-outlined text-[18px]">content_copy</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      </main>
    </>
  );
}
