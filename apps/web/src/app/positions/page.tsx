import Link from 'next/link';
import { PositionSearchForm } from '@/components/stitch/PositionSearchForm';
import { fetchRecentPositions } from '@/lib/api';

export default async function PositionsIndexPage() {
  const { positions } = await fetchRecentPositions(20);

  return (
    <main className="relative z-10 pt-24 pb-16 px-gutter flex flex-col max-w-[1440px] mx-auto w-full gap-8">
      <div className="border-[2px] border-white bg-black/80 backdrop-blur-md p-6 flex flex-col gap-4">
        <h1 className="font-display-lg text-display-lg text-white uppercase">Positions</h1>
        <p className="font-body-md text-body-md text-white max-w-3xl">
          Look up any position by FEN or zobrist hash, or browse the most recently seen.
        </p>
        <PositionSearchForm />
      </div>

      <div className="border-[2px] border-white bg-black/80 backdrop-blur-md flex flex-col">
        <div className="p-4 border-b-[2px] border-white">
          <span className="font-label-caps text-label-caps text-white uppercase">Recently Seen</span>
        </div>
        <div className="flex flex-col">
          {positions.length === 0 ? (
            <div className="p-4 font-data-mono text-data-mono text-white uppercase">No positions yet.</div>
          ) : (
            positions.map((position) => (
              <Link
                key={position.zobrist}
                className="flex justify-between items-center px-4 py-3 border-b-[2px] border-white border-dashed last:border-b-0 font-data-mono text-data-mono uppercase text-white hover:bg-white hover:text-black transition-none"
                href={`/positions/${position.zobrist}`}
              >
                <span className="truncate max-w-[60%]">{position.epd}</span>
                <span>{position.pieceCount}pc</span>
              </Link>
            ))
          )}
        </div>
      </div>
    </main>
  );
}
