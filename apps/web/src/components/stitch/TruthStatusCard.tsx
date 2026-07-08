type TruthStatusCardProps = {
  status: 'EVALUATED' | 'PROVEN';
  description: string;
};

/** Reused on /board and /positions — badge follows the established convention:
 * PROVEN = solid fill, EVALUATED = outline only. */
export function TruthStatusCard({ status, description }: TruthStatusCardProps) {
  return (
    <div className="border-[2px] border-white bg-black/80 backdrop-blur-md p-6 flex flex-col justify-between">
      <div className="font-label-caps text-label-caps text-white mb-4 uppercase">TRUTH STATUS</div>
      <div className="flex-1 flex items-center">
        <span
          className={`font-label-caps text-label-caps px-4 py-2 inline-block uppercase border-[2px] border-white ${
            status === 'PROVEN' ? 'bg-white text-black' : 'text-white'
          }`}
        >
          {status}
        </span>
      </div>
      <div className="mt-4 font-data-mono text-[12px] text-white leading-relaxed uppercase">{description}</div>
    </div>
  );
}
