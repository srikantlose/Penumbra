import { FrontierCanvas } from '@/components/stitch/FrontierCanvas';

// A jagged, hand-drawn-looking coastline boundary (sharp segments, no curves —
// matches the 8-bit aesthetic). Points trace the "known" frontier at y; the
// proven region is everything above this line, the fog everything below.
const VIEW_W = 1000;
const VIEW_H = 420;
const COASTLINE: [number, number][] = [
  [0, 200], [70, 165], [140, 210], [210, 150], [280, 190],
  [350, 130], [420, 175], [490, 145], [560, 200], [630, 160],
  [700, 210], [770, 170], [840, 145], [910, 185], [1000, 160],
];

const coastlinePoints = COASTLINE.map(([x, y]) => `${x},${y}`).join(' ');
const provenPolygon = `0,0 ${coastlinePoints} ${VIEW_W},0`;
const fogPolygon = `0,${VIEW_H} ${coastlinePoints} ${VIEW_W},${VIEW_H}`;

// Landmark positions plotted along the frontier — piece count drives the
// Fog Index's tablebase-distance component (t = clamp((n-7)/9, 0, 1)), so the
// 7-piece boundary is the literal frontier this map visualizes.
const LANDMARKS = [
  { x: 140, label: 'KPvK · 3pc', note: 'PROVEN' },
  { x: 350, label: 'KRvKB · 4pc', note: 'PROVEN' },
  { x: 560, label: '7-MAN BOUNDARY', note: 'PROVEN' },
  { x: 840, label: 'OPEN RESEARCH', note: 'EVALUATED' },
];

export default function FrontierPage() {
  return (
    <main className="relative z-10 pt-24 pb-16 px-gutter flex flex-col max-w-[1440px] mx-auto w-full gap-8">
      <div className="border-[2px] border-white bg-black/80 backdrop-blur-md p-6">
        <h1 className="font-display-lg text-display-lg text-white uppercase">The Frontier Map</h1>
        <p className="font-body-md text-body-md text-white mt-4 max-w-3xl">
          A coastline between the proven and the evaluated. Everything above the line is
          settled by tablebase or certificate; everything below is still fog — held by engine
          opinion alone, not machine-verified truth.
        </p>
      </div>

      <div className="border-[2px] border-white bg-black/80 backdrop-blur-md p-4">
        <div className="relative w-full aspect-[1000/420]">
          <svg
            className="absolute inset-0 h-full w-full"
            preserveAspectRatio="none"
            viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
          >
            <polygon fill="#ffffff" points={provenPolygon} />
            <polygon fill="#000000" points={fogPolygon} />
            <polyline fill="none" points={coastlinePoints} stroke="#ffffff" strokeWidth={3} />
            {LANDMARKS.map((mark) => {
              const y = COASTLINE.reduce((closest, [x, yy]) =>
                Math.abs(x - mark.x) < Math.abs(closest[0] - mark.x) ? [x, yy] : closest,
              )[1];
              return (
                <circle key={mark.label} cx={mark.x} cy={y} fill="#000000" r={6} stroke="#ffffff" strokeWidth={2} />
              );
            })}
          </svg>
          <FrontierCanvas className="absolute inset-0 h-full w-full" />
          {LANDMARKS.map((mark) => (
            <div
              key={mark.label}
              className="absolute flex flex-col items-center gap-1"
              style={{ left: `${(mark.x / VIEW_W) * 100}%`, top: '58%', transform: 'translateX(-50%)' }}
            >
              <span className="font-data-mono text-[10px] bg-black/80 backdrop-blur-md border border-white px-1 text-white whitespace-nowrap">
                {mark.label}
              </span>
            </div>
          ))}
        </div>
      </div>

      <div className="flex flex-col sm:flex-row gap-4">
        <div className="flex-1 border-[2px] border-white bg-black/80 backdrop-blur-md p-4 flex items-center gap-3">
          <span className="h-4 w-4 border-[2px] border-white bg-white shrink-0" />
          <span className="font-label-caps text-label-caps text-white uppercase">
            Proven territory — tablebase or certificate-verified
          </span>
        </div>
        <div className="flex-1 border-[2px] border-white bg-black/80 backdrop-blur-md p-4 flex items-center gap-3">
          <span className="h-4 w-4 border-[2px] border-white bg-black shrink-0" />
          <span className="font-label-caps text-label-caps text-white uppercase">
            The fog — engine-evaluated, not yet proven
          </span>
        </div>
      </div>
    </main>
  );
}
