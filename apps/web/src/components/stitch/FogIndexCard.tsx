type FogIndexCardProps = {
  score: number;
  components: { label: string; value: string }[];
};

/** Reused on /board and /positions — the Fog Index score + component breakdown. */
export function FogIndexCard({ score, components }: FogIndexCardProps) {
  return (
    <div className="border-[2px] border-white bg-black/80 backdrop-blur-md p-6 flex flex-col justify-between">
      <div className="font-label-caps text-label-caps text-white mb-4 uppercase">CURRENT FOG INDEX</div>
      <div className="flex items-baseline gap-2">
        <span className="font-display-lg text-display-lg text-white">{score}</span>
        <span className="font-data-mono text-data-mono text-white">/100</span>
      </div>
      <div className="mt-4 pt-4 border-t-[2px] border-white flex flex-col gap-2 font-data-mono text-data-mono uppercase text-white">
        {components.map((c) => (
          <div key={c.label} className="flex justify-between gap-2">
            <span>{c.label}:</span>
            <span>{c.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
