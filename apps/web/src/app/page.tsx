export default function HomePage() {
  return (
    <main className="flex-1 relative z-10 pt-24 pb-16 px-gutter flex flex-col max-w-[1440px] mx-auto w-full gap-16">
      {/* Hero Section */}
      <section className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-12 pt-12">
        <div className="flex flex-col gap-6 max-w-2xl border-[2px] border-white p-6 bg-black/80 backdrop-blur-md">
          <img
            alt="RetroByte Studios Logo"
            className="w-16 h-16 object-contain rounded-none grayscale contrast-200 brightness-200"
            src="https://lh3.googleusercontent.com/aida/AP1WRLsmarowsYQ9YSSwBze-l4e_6_vDQ8Ss33Q0vgIxJabtTsvnqw8siBtYthAgnkgpu0BIJ_hgJ3WEmF77xHOrymukLwsOmB_LZ8YNs0fYLni_8HKCyrq1TXmDAbO6hM5Wjrf2egHwkqMdjh7XPcpNa4ou5x_4qZG4ckMfc-MbkeHl8cT0z_DVJyTtIaQ87qXUikKiT4MrUmegGF5MdqITCdx3g41485FhBsp6QbTWs9BQPhXdPEFqYME9CA"
          />
          <h1 className="font-display-lg text-display-lg text-white uppercase">
            The Unsolved Frontier of Chess
          </h1>
          <p className="font-body-lg text-body-lg text-white max-w-xl">
            A cryptographic and engineering challenge mapping the boundary between the proven and
            the evaluated. Explore the measurable murkiness of deep analysis.
          </p>
          <div className="pt-4">
            <button className="border-[2px] border-white bg-black text-white font-body-md text-body-md px-6 py-3 hover:bg-white hover:text-black transition-none flex items-center gap-3 group uppercase">
              Connect with Lichess
              <span className="material-symbols-outlined group-hover:translate-x-1 transition-transform">
                arrow_forward
              </span>
            </button>
          </div>
        </div>

        {/* Fog Gauge Interactive Element */}
        <div className="w-full lg:w-[480px] border-[2px] border-white bg-black/80 backdrop-blur-md p-6 flex flex-col gap-6">
          <div className="flex justify-between items-center border-b-[2px] border-white pb-4">
            <span className="font-label-caps text-label-caps text-white">
              GLOBAL PLATFORM MURKINESS
            </span>
            <span className="font-data-mono text-data-mono text-white bg-black px-2 py-1 border border-white">
              FOG_IDX v0.1
            </span>
          </div>
          <div className="relative w-full h-12 bg-black border-[2px] border-white flex items-center px-4 overflow-hidden group cursor-crosshair">
            {/* Gauge Track */}
            <div className="absolute left-0 top-0 bottom-0 dither-bg w-[68%] border-r-[2px] border-black transition-all duration-1000" />
            <div className="relative z-10 w-full flex justify-between font-data-mono text-data-mono text-black mix-blend-difference">
              <span className="text-white">0.00</span>
              <span className="text-white">68.41%</span>
              <span className="text-white">100.00</span>
            </div>
          </div>
          <p className="font-data-mono text-data-mono text-white text-sm uppercase">
            Aggregated volatility across 4-rung ladder (1M/4M/16M/64M nodes). Calibrated against
            reference corpus.
          </p>
        </div>
      </section>

      {/* Features Section (Technical Cards) */}
      <section className="grid grid-cols-1 md:grid-cols-3 gap-gutter pt-8">
        {/* Card 1: Fog Index */}
        <div className="border-[2px] border-white bg-black/80 backdrop-blur-md p-gutter flex flex-col gap-4 transition-none">
          <div className="flex justify-between items-start">
            <span className="material-symbols-outlined text-white">blur_on</span>
            <span className="border border-white text-white font-label-caps text-label-caps px-2 py-1 rounded-none dither-bg-dark">
              EVALUATED
            </span>
          </div>
          <h3 className="font-headline-sm text-headline-sm mt-4 uppercase">Fog Index</h3>
          <p className="font-body-md text-body-md flex-1">
            A measurable metric of engine disagreement, depth volatility, and move criticality.
            Identifies the &ldquo;murkiness&rdquo; of any position across standard WDL space.
          </p>
          <div className="border-t-[2px] border-white pt-4 mt-2">
            <code className="font-data-mono text-data-mono text-xs block">
              d = clamp(|wp_SF − wp_Lc0| / 0.35, 0, 1)
            </code>
          </div>
        </div>

        {/* Card 2: Certificates */}
        <div className="border-[2px] border-white bg-black/80 backdrop-blur-md p-gutter flex flex-col gap-4 transition-none">
          <div className="flex justify-between items-start">
            <span className="material-symbols-outlined text-white">verified_user</span>
            <span className="bg-white text-black border border-white font-label-caps text-label-caps px-2 py-1 rounded-none">
              PROVEN
            </span>
          </div>
          <h3 className="font-headline-sm text-headline-sm mt-4 uppercase">Certificates</h3>
          <p className="font-body-md text-body-md flex-1">
            Cryptographic proof of game theoretic values. AND/OR DAG representations of fortress
            claims and terminal truths, verified offline.
          </p>
          <div className="border-t-[2px] border-white pt-4 mt-2">
            <code className="font-data-mono text-data-mono text-xs block">
              penumbra-verify verify cert.pnbcert
            </code>
          </div>
        </div>

        {/* Card 3: The Ledger */}
        <div className="border-[2px] border-white bg-black/80 backdrop-blur-md p-gutter flex flex-col gap-4 transition-none">
          <div className="flex justify-between items-start">
            <span className="material-symbols-outlined text-white">account_tree</span>
            <span className="border border-white text-white font-label-caps text-label-caps px-2 py-1 rounded-none">
              SYSTEM
            </span>
          </div>
          <h3 className="font-headline-sm text-headline-sm mt-4 uppercase">The Ledger</h3>
          <p className="font-body-md text-body-md flex-1">
            An append-only, hash-chained record of all certified truths. Ensuring historical
            analysis paths survive and remain auditable forever.
          </p>
          <div className="border-t-[2px] border-white pt-4 mt-2">
            <code className="font-data-mono text-data-mono text-xs block">
              entry_hash = sha256(prev_hash ‖ payload)
            </code>
          </div>
        </div>
      </section>
    </main>
  );
}
