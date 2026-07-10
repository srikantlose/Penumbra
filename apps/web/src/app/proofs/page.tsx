import { fetchProofs, fetchLedger } from '@/lib/api';

interface RawClaim {
  fen: string;
  value: 'win' | 'at_least_draw';
  side: 'white' | 'black';
}

function truncateMiddle(value: string, keep = 10): string {
  if (value.length <= keep * 2 + 1) return value;
  return `${value.slice(0, keep)}…${value.slice(-keep)}`;
}

export default async function ProofsPage() {
  const [{ proofs }, { entries }] = await Promise.all([fetchProofs({ limit: 100 }), fetchLedger()]);
  const ledgerDescending = [...entries].reverse();

  return (
    <main className="relative z-10 pt-24 pb-16 px-gutter flex flex-col max-w-[1440px] mx-auto w-full gap-8">
      <div className="border-[2px] border-white bg-black/80 backdrop-blur-md p-6">
        <h1 className="font-display-lg text-display-lg text-white uppercase">Proofs</h1>
        <p className="font-body-md text-body-md text-white mt-4 max-w-3xl">
          Every certificate is an AND/OR proof tree, machine-verified offline against Syzygy
          tablebases — no trust in the prover required. Win certificates are acyclic; at-least-draw
          certificates may contain cycles (a confined, non-losing fortress).
        </p>
      </div>

      <div className="border-[2px] border-white bg-black/80 backdrop-blur-md flex flex-col">
        <div className="p-4 border-b-[2px] border-white flex justify-between items-center">
          <span className="font-label-caps text-label-caps text-white uppercase">Certificates</span>
          <span className="font-data-mono text-data-mono text-white">{proofs.length} published</span>
        </div>
        <div className="p-4 overflow-x-auto">
          <table className="w-full text-left font-data-mono text-data-mono uppercase text-white">
            <thead>
              <tr className="border-b-[2px] border-white">
                <th className="pb-2 font-bold">Claim</th>
                <th className="pb-2 font-bold">FEN</th>
                <th className="pb-2 font-bold text-right">SHA256</th>
                <th className="pb-2 font-bold text-right">Download</th>
              </tr>
            </thead>
            <tbody>
              {proofs.map((proof) => {
                const claim = proof.claim as RawClaim;
                return (
                  <tr key={proof.id} className="border-b-[2px] border-white border-dashed">
                    <td className="py-3">
                      <span className="bg-white text-black border-[2px] border-white px-2 py-0.5 font-label-caps text-[10px]">
                        {claim.value}({claim.side})
                      </span>
                    </td>
                    <td className="py-3">{truncateMiddle(claim.fen, 16)}</td>
                    <td className="py-3 text-right">{truncateMiddle(proof.certificateSha256 ?? '', 10)}</td>
                    <td className="py-3 text-right">
                      {proof.downloadUrl ? (
                        <a className="underline hover:no-underline" href={proof.downloadUrl}>
                          .pnbcert
                        </a>
                      ) : (
                        '—'
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="p-4 border-t-[2px] border-white">
          <code className="font-data-mono text-data-mono text-white block">
            penumbra-verify verify cert.pnbcert --syzygy ./tb
          </code>
        </div>
      </div>

      {/* Ledger */}
      <div className="border-[2px] border-white bg-black/80 backdrop-blur-md flex flex-col">
        <div className="p-4 border-b-[2px] border-white flex justify-between items-center">
          <span className="font-label-caps text-label-caps text-white uppercase">The Ledger</span>
          <span className="font-data-mono text-data-mono text-white">
            entry_hash = sha256(prev_hash ‖ payload)
          </span>
        </div>
        <div className="flex flex-col">
          {ledgerDescending.map((entry) => (
            <div
              key={entry.seq}
              className="flex justify-between items-center px-4 py-3 border-b-[2px] border-white border-dashed last:border-b-0 font-data-mono text-data-mono uppercase text-white"
            >
              <span className="w-16">#{entry.seq}</span>
              <span>{truncateMiddle(entry.entryHash, 8)}</span>
              <span className="text-right">prev: {truncateMiddle(entry.prevHash ?? '', 8)}</span>
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}
