const CERTIFICATES = [
  { claim: 'win(white)', fen: '4k3/8/4K3/8/8/8/8/3Q4 w - -…', sha: '0x4e1f9c2b7a3d…', nodes: 2 },
  { claim: 'at_least_draw(black)', fen: '7k/8/8/8/K7/8/8/8 w - - 0 1', sha: '0x0a7cd39ef812…', nodes: 3 },
  { claim: 'win(black)', fen: '8/8/4k3/8/8/4K3/4Q3/8 b - -…', sha: '0x91f2e0a6bb54…', nodes: 5 },
];

const LEDGER = [
  { seq: 1042, entryHash: '0x8ab3…f21c', prevHash: '0x71de…9a03' },
  { seq: 1041, entryHash: '0x71de…9a03', prevHash: '0x2c4f…7e18' },
  { seq: 1040, entryHash: '0x2c4f…7e18', prevHash: '0x9d0b…3f56' },
];

export default function ProofsPage() {
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
        <div className="p-4 border-b-[2px] border-white">
          <span className="font-label-caps text-label-caps text-white uppercase">Certificates</span>
        </div>
        <div className="p-4 overflow-x-auto">
          <table className="w-full text-left font-data-mono text-data-mono uppercase text-white">
            <thead>
              <tr className="border-b-[2px] border-white">
                <th className="pb-2 font-bold">Claim</th>
                <th className="pb-2 font-bold">FEN</th>
                <th className="pb-2 font-bold">Nodes</th>
                <th className="pb-2 font-bold text-right">SHA256</th>
              </tr>
            </thead>
            <tbody>
              {CERTIFICATES.map((cert) => (
                <tr key={cert.sha} className="border-b-[2px] border-white border-dashed">
                  <td className="py-3">
                    <span className="bg-white text-black border-[2px] border-white px-2 py-0.5 font-label-caps text-[10px]">
                      {cert.claim}
                    </span>
                  </td>
                  <td className="py-3">{cert.fen}</td>
                  <td className="py-3">{cert.nodes}</td>
                  <td className="py-3 text-right">{cert.sha}</td>
                </tr>
              ))}
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
          {LEDGER.map((entry) => (
            <div
              key={entry.seq}
              className="flex justify-between items-center px-4 py-3 border-b-[2px] border-white border-dashed last:border-b-0 font-data-mono text-data-mono uppercase text-white"
            >
              <span className="w-16">#{entry.seq}</span>
              <span>{entry.entryHash}</span>
              <span className="text-right">prev: {entry.prevHash}</span>
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}
