export interface FogTimelineSegment {
  ply: number;
  fog: number;
  status: 'EVALUATED' | 'PROVEN';
}

type FogTimelineBarProps = {
  entries: FogTimelineSegment[];
  proofEntryPly?: number | null;
};

/** Shared between /board (static demo until a game is loaded) and /journey (real per-game data). */
export function FogTimelineBar({ entries, proofEntryPly }: FogTimelineBarProps) {
  if (entries.length === 0) return null;
  const segmentWidth = 100 / entries.length;
  const proofEntryIndex = proofEntryPly != null ? entries.findIndex((e) => e.ply === proofEntryPly) : -1;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex justify-between items-end">
        <span className="font-label-caps text-label-caps text-white">FOG TIMELINE</span>
        <span className="font-data-mono text-[10px] text-white">INDEX v0.1</span>
      </div>
      <div className="h-6 w-full border-[2px] border-white bg-black/80 backdrop-blur-md flex relative overflow-hidden">
        {entries.map((entry) => (
          <div
            key={entry.ply}
            className={`h-full border-r border-black/40 ${entry.status === 'PROVEN' ? 'bg-white' : 'dither-bg'}`}
            style={{ width: `${segmentWidth}%` }}
            title={`ply ${entry.ply}: fog ${entry.fog}`}
          />
        ))}
        {proofEntryIndex >= 0 ? (
          <div
            className="absolute top-0 bottom-0 w-[4px] bg-white"
            style={{ left: `${proofEntryIndex * segmentWidth}%` }}
          />
        ) : null}
      </div>
      <div className="flex justify-between font-data-mono text-[10px] text-white uppercase">
        <span>Ply {entries[0].ply}</span>
        <span>Ply {entries[entries.length - 1].ply}</span>
      </div>
    </div>
  );
}
