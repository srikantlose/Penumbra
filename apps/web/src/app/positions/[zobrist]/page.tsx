import { notFound } from 'next/navigation';
import { FogIndexCard } from '@/components/stitch/FogIndexCard';
import { TruthStatusCard } from '@/components/stitch/TruthStatusCard';
import { fetchPosition } from '@/lib/api';

function truncateMiddle(value: string, keep = 10): string {
  if (value.length <= keep * 2 + 1) return value;
  return `${value.slice(0, keep)}…${value.slice(-keep)}`;
}

export default async function PositionDetailPage({ params }: { params: Promise<{ zobrist: string }> }) {
  const { zobrist } = await params;
  const position = await fetchPosition(zobrist);
  if (!position) notFound();

  const fen = `${position.epd} 0 1`;

  return (
    <main className="relative z-10 pt-24 pb-16 px-gutter flex flex-col max-w-[1440px] mx-auto w-full gap-6">
      <div className="border-[2px] border-white bg-black/80 backdrop-blur-md p-6 flex flex-col gap-4">
        <div className="flex items-center justify-between flex-wrap gap-4">
          <h1 className="font-headline-md text-headline-md text-white uppercase">Position</h1>
          <span className="font-data-mono text-data-mono text-white border-[2px] border-white px-2 py-1">
            {position.pieceCount} PIECES
          </span>
        </div>
        <div className="flex items-center gap-2">
          <input
            className="bg-black/80 backdrop-blur-md border-[2px] border-white text-white text-[12px] p-2 flex-1 outline-none font-data-mono uppercase"
            readOnly
            type="text"
            value={fen}
          />
        </div>
        <div className="font-data-mono text-data-mono text-white uppercase">ZOBRIST {position.zobrist}</div>
      </div>

      {/* Provenance */}
      <div className="border-[2px] border-white bg-black/80 backdrop-blur-md p-6 flex flex-col gap-2">
        <div className="font-label-caps text-label-caps text-white mb-2 uppercase">Provenance</div>
        <div className="flex flex-col gap-2 font-data-mono text-data-mono uppercase text-white">
          <div className="flex justify-between gap-2">
            <span>First seen game id:</span>
            <span>{position.provenance.firstSeenGameId ?? '—'}</span>
          </div>
          <div className="flex justify-between gap-2">
            <span>Occurrences:</span>
            <span>
              {position.provenance.occurrenceCount.toLocaleString()}{' '}
              {position.provenance.occurrenceCount === 1 ? 'occurrence' : 'occurrences'}
            </span>
          </div>
          <div className="flex justify-between gap-2">
            <span>First seen:</span>
            <span>{new Date(position.provenance.createdAt).toISOString().slice(0, 10)}</span>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {position.fog ? (
          <FogIndexCard
            components={[
              { label: 'Disagreement', value: position.fog.components.disagreement.toFixed(2) },
              { label: 'Volatility', value: position.fog.components.depthVolatility.toFixed(2) },
              { label: 'Criticality', value: position.fog.components.moveCriticality.toFixed(2) },
              { label: 'Tablebase distance', value: position.fog.components.tablebaseDistance.toFixed(2) },
            ]}
            percentile={position.fog.percentile}
            score={position.fog.score}
          />
        ) : (
          <div className="border-[2px] border-white bg-black/80 backdrop-blur-md p-6 flex items-center justify-center">
            <span className="font-label-caps text-label-caps text-white uppercase">Not yet analyzed</span>
          </div>
        )}
        <TruthStatusCard
          description={
            position.truthStatus === 'PROVEN'
              ? 'Machine-verified via certificate or tablebase probe.'
              : 'Engine opinion only. No certificate or tablebase hit yet.'
          }
          status={position.truthStatus}
        />
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
                <th className="pb-2 font-bold">Score (cp)</th>
                <th className="pb-2 font-bold text-right">Fingerprint</th>
              </tr>
            </thead>
            <tbody>
              {position.evals.length === 0 ? (
                <tr>
                  <td className="py-3" colSpan={5}>
                    No evaluations yet.
                  </td>
                </tr>
              ) : (
                position.evals.map((row, i) => (
                  <tr key={i} className="border-b-[2px] border-white border-dashed">
                    <td className="py-3">{row.engine}</td>
                    <td className="py-3">{row.nodes?.toLocaleString() ?? '—'}</td>
                    <td className="py-3">{row.depth ?? '—'}</td>
                    <td className="py-3">{row.scoreMate !== null ? `#${row.scoreMate}` : row.scoreCp ?? '—'}</td>
                    <td className="py-3 text-right">{truncateMiddle(row.engineFingerprint, 8)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Proof Reference */}
      {position.proofRefs.length > 0 ? (
        <div className="border-[2px] border-white bg-black/80 backdrop-blur-md p-6 flex flex-col gap-3">
          <div className="font-label-caps text-label-caps text-white mb-2 uppercase">Proof Reference</div>
          {position.proofRefs.map((ref) => (
            <div
              key={ref.id}
              className="flex flex-col gap-2 font-data-mono text-data-mono uppercase text-white border-t-[2px] border-white pt-3 first:border-t-0 first:pt-0"
            >
              <div className="flex justify-between gap-2 flex-wrap">
                <span>Claim:</span>
                <span>
                  {ref.value}
                  {ref.bound ? ` (${ref.bound})` : ''}
                </span>
              </div>
              <div className="flex justify-between gap-2 flex-wrap">
                <span>Status:</span>
                <span>{ref.status}</span>
              </div>
              <div className="flex justify-between gap-2 flex-wrap">
                <span>Certificate SHA256:</span>
                <span>{ref.certificateSha256 ? truncateMiddle(ref.certificateSha256, 10) : '—'}</span>
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </main>
  );
}
