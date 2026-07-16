import { JourneyForm } from '@/components/stitch/JourneyForm';
import { getSession } from '@/lib/session';

interface JourneyPageProps {
  searchParams: Promise<{ connected?: string; error?: string }>;
}

export default async function JourneyPage({ searchParams }: JourneyPageProps) {
  const [session, params] = await Promise.all([getSession(), searchParams]);

  return (
    <main className="relative z-10 pt-24 pb-16 px-gutter flex flex-col max-w-[1440px] mx-auto w-full gap-8">
      <div className="border-[2px] border-white bg-black/80 backdrop-blur-md p-6">
        <h1 className="font-display-lg text-display-lg text-white uppercase">Your Journey</h1>
        <p className="font-body-md text-body-md text-white mt-4 max-w-3xl">
          Import your Lichess games and walk the fog timeline of each one — every ply&apos;s
          Fog Index, and the moment (if any) a position became machine-verified truth.
        </p>
      </div>

      {params.connected ? (
        <div className="border-[2px] border-white bg-black/80 backdrop-blur-md p-6">
          <p className="font-data-mono text-data-mono text-white uppercase">Lichess account connected.</p>
        </div>
      ) : null}

      {params.error ? (
        <div className="border-[2px] border-white bg-black/80 backdrop-blur-md p-6">
          <p className="font-data-mono text-data-mono text-white uppercase">Connect failed: {params.error}</p>
        </div>
      ) : null}

      <div className="border-[2px] border-white bg-black/80 backdrop-blur-md p-6">
        <JourneyForm connectedUsername={session?.lichessUsername ?? null} />
      </div>
    </main>
  );
}
