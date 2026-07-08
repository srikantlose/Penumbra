const COMPONENTS = [
  {
    name: 'Disagreement (d)',
    formula: 'd = clamp(|wp_SF − wp_Lc0| / 0.35, 0, 1)',
    note: 'Stockfish (NNUE) vs. Lc0 (neural policy/value) fail differently — their divergence is real epistemic signal.',
  },
  {
    name: 'Depth volatility (v)',
    formula: 'v = clamp(σ(wp across 1M/4M/16M/64M nodes) / 0.12, 0, 1)',
    note: 'Evals that swing wildly as search deepens are unstable — horizon effects, structures that improve under scrutiny.',
  },
  {
    name: 'Move criticality (c)',
    formula: 'c = (k − 1) / 3, k = MultiPV moves within 0.06 wp of best',
    note: 'One forced move (k=1) is low fog; four equally playable moves (k=4) is deep fog.',
  },
  {
    name: 'Tablebase distance (t)',
    formula: 't = clamp((n − 7) / 9, 0, 1)',
    note: 'n = piece count. n≤7 is the tablebase boundary; saturates at 16 pieces.',
  },
  {
    name: 'Proof gate (g)',
    formula: 'g = 0 if PROVEN, 0.85 if a child is PROVEN, else 1',
    note: 'Proven positions short-circuit fog computation entirely.',
  },
];

const PERCENTILES = [
  ['1st', 5], ['5th', 12], ['10th', 18], ['25th', 30],
  ['50th (median)', 45], ['75th', 62], ['90th', 78], ['95th', 87], ['99th', 94],
] as const;

export default function MethodologyPage() {
  return (
    <main className="relative z-10 pt-24 pb-16 px-gutter flex flex-col max-w-[1440px] mx-auto w-full gap-8">
      <div className="border-[2px] border-white bg-black/80 backdrop-blur-md p-6">
        <h1 className="font-display-lg text-display-lg text-white uppercase">Methodology</h1>
        <p className="font-body-md text-body-md text-white mt-4 max-w-3xl">
          The Fog Index is explicitly an EVALUATED-tier metric — an engine opinion with known
          error bars, never a claim about ground truth. It measures engine uncertainty, not
          game-theoretic solvedness. High Fog ≠ unsolved; low Fog ≠ solved.
        </p>
      </div>

      {/* Formula */}
      <div className="border-[2px] border-white bg-black/80 backdrop-blur-md p-6">
        <div className="font-label-caps text-label-caps text-white mb-4 uppercase">
          Fog Index v0.1 — Formula
        </div>
        <code className="font-data-mono text-data-mono text-white block">
          Fog = round(100 · g · (0.30·d + 0.25·v + 0.25·c + 0.20·t))
        </code>
      </div>

      {/* Components */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {COMPONENTS.map((c) => (
          <div key={c.name} className="border-[2px] border-white bg-black/80 backdrop-blur-md p-6 flex flex-col gap-3">
            <div className="font-headline-sm text-headline-sm text-white uppercase">{c.name}</div>
            <code className="font-data-mono text-[12px] text-white block">{c.formula}</code>
            <p className="font-body-md text-body-md text-white">{c.note}</p>
          </div>
        ))}
      </div>

      {/* Calibration */}
      <div className="border-[2px] border-white bg-black/80 backdrop-blur-md flex flex-col">
        <div className="p-4 border-b-[2px] border-white">
          <span className="font-label-caps text-label-caps text-white uppercase">
            Calibration CDF — 100k position corpus (Lichess elite, plies 10–80)
          </span>
        </div>
        <div className="p-4 overflow-x-auto">
          <table className="w-full text-left font-data-mono text-data-mono uppercase text-white">
            <thead>
              <tr className="border-b-[2px] border-white">
                <th className="pb-2 font-bold">Percentile</th>
                <th className="pb-2 font-bold text-right">Score</th>
              </tr>
            </thead>
            <tbody>
              {PERCENTILES.map(([p, score]) => (
                <tr key={p} className="border-b-[2px] border-white border-dashed">
                  <td className="py-2">{p}</td>
                  <td className="py-2 text-right">{score}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Certificate format */}
      <div className="border-[2px] border-white bg-black/80 backdrop-blur-md p-6 flex flex-col gap-4">
        <div className="font-label-caps text-label-caps text-white uppercase">
          Certificate Format v0.1 — AND/OR Proof Trees
        </div>
        <p className="font-body-md text-body-md text-white">
          A certificate proves <code className="font-data-mono">win(side)</code> or{' '}
          <code className="font-data-mono">at_least_draw(side)</code>. OR-nodes (the claiming
          side) supply one move; AND-nodes (the opponent) must cover every legal reply — the
          verifier regenerates the move list independently. Terminals land at checkmate,
          stalemate, or a Syzygy tablebase probe (≤7 pieces).
        </p>
        <div className="border-t-[2px] border-white pt-4 flex flex-col gap-2 font-data-mono text-data-mono uppercase text-white">
          <div className="flex justify-between gap-2">
            <span>win certificates:</span>
            <span>must be acyclic</span>
          </div>
          <div className="flex justify-between gap-2">
            <span>at_least_draw certificates:</span>
            <span>cycles allowed (fortress)</span>
          </div>
          <div className="flex justify-between gap-2">
            <span>identity:</span>
            <span>sha256(canonical_json)</span>
          </div>
        </div>
      </div>

      {/* Limitations */}
      <div className="border-[2px] border-white bg-black/80 backdrop-blur-md p-6 flex flex-col gap-2">
        <div className="font-label-caps text-label-caps text-white mb-2 uppercase">Limitations</div>
        <ul className="font-body-md text-body-md text-white list-disc list-inside flex flex-col gap-1">
          <li>Not a solve metric — measures engine uncertainty, not game-theoretic truth.</li>
          <li>Single-threaded fixed-node search only; SMP engines are nondeterministic.</li>
          <li>Lc0 network weights are pinned in the fingerprint to control for drift.</li>
          <li>Move criticality capped by MultiPV=4 in v0.1.</li>
          <li>Corpus calibrated on master-level games — may not transfer to endgame studies.</li>
        </ul>
      </div>
    </main>
  );
}
