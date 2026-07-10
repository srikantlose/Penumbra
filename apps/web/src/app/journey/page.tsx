import { JourneyForm } from '@/components/stitch/JourneyForm';

export default function JourneyPage() {
  return (
    <main className="relative z-10 pt-24 pb-16 px-gutter flex flex-col max-w-[1440px] mx-auto w-full gap-8">
      <div className="border-[2px] border-white bg-black/80 backdrop-blur-md p-6">
        <h1 className="font-display-lg text-display-lg text-white uppercase">Your Journey</h1>
        <p className="font-body-md text-body-md text-white mt-4 max-w-3xl">
          Import your Lichess games and walk the fog timeline of each one — every ply&apos;s
          Fog Index, and the moment (if any) a position became machine-verified truth.
        </p>
      </div>

      <div className="border-[2px] border-white bg-black/80 backdrop-blur-md p-6">
        <JourneyForm />
      </div>
    </main>
  );
}
