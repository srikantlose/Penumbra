import { EngineSidebar } from '@/components/stitch/EngineSidebar';
import { BoardAnalysis } from '@/components/stitch/BoardAnalysis';
import { FogTimelineBar } from '@/components/stitch/FogTimelineBar';

const LIGHT = 'sq-light';
const DARK = 'sq-dark';
// Standard 8x8 alternating pattern, row 8 (top) to row 1 (bottom).
const BOARD_ROWS = Array.from({ length: 8 }, (_, row) =>
  Array.from({ length: 8 }, (_, col) => ((row + col) % 2 === 0 ? LIGHT : DARK)),
);

// Static demo timeline until a real game is loaded (see /journey for the
// real, per-game fog timeline using this same component).
const DEMO_TIMELINE = [
  { ply: 10, fog: 20, status: 'EVALUATED' as const },
  { ply: 20, fog: 35, status: 'EVALUATED' as const },
  { ply: 40, fog: 10, status: 'PROVEN' as const },
  { ply: 80, fog: 35, status: 'EVALUATED' as const },
];

export default function BoardPage() {
  return (
    <>
      <EngineSidebar />
      <main className="relative z-10 pt-16 md:pl-sidebar-width min-h-screen flex flex-col xl:flex-row gap-gutter p-gutter pb-32">
        <div className="flex flex-col gap-4 w-full xl:w-board-size-lg shrink-0">
          <div className="flex justify-between items-end">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-black/80 backdrop-blur-md border-[2px] border-white flex items-center justify-center overflow-hidden">
                <img alt="" className="w-full h-full object-contain" src="/avatar.svg" />
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

          {/* Chessboard (static demo position, not wired to real game state yet -- Stage 6 wires
              the analysis panel below, not a real board renderer) */}
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
              <div className="w-10 h-10 bg-black/80 backdrop-blur-md border-[2px] border-white flex items-center justify-center overflow-hidden">
                <img alt="" className="w-full h-full object-contain" src="/avatar.svg" />
              </div>
              <div>
                <div className="font-body-md text-body-md text-white uppercase">Hikaru_Nakamura</div>
                <div className="font-data-mono text-data-mono text-white">2875</div>
              </div>
            </div>
          </div>

          {/* Fog Timeline: static demo until a real game is loaded -- see /journey for the real, per-game version of this same component. */}
          <div className="mt-6">
            <FogTimelineBar entries={DEMO_TIMELINE} proofEntryPly={40} />
          </div>
        </div>

        <BoardAnalysis />
      </main>
    </>
  );
}
