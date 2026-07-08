export function Footer() {
  return (
    <footer className="w-full py-gutter px-gutter flex flex-col md:flex-row justify-between items-center gap-4 bg-black/80 backdrop-blur-md border-t-[2px] border-white relative z-10">
      <div className="font-data-mono text-data-mono text-white">
        © 2024 PENUMBRA ARCHIVES. NO RIGHTS RESERVED. GPL-3.0.
      </div>
      <div className="flex items-center gap-6">
        <a
          className="font-data-mono text-data-mono text-white hover:bg-white hover:text-black px-2 py-1 transition-none"
          href="#"
        >
          VERIFIER CLI
        </a>
        <a
          className="font-data-mono text-data-mono text-white hover:bg-white hover:text-black px-2 py-1 transition-none"
          href="#"
        >
          SCHEMA
        </a>
        <a
          className="font-data-mono text-data-mono text-white hover:bg-white hover:text-black px-2 py-1 transition-none"
          href="#"
        >
          API
        </a>
        <a
          className="font-data-mono text-data-mono text-white hover:bg-white hover:text-black px-2 py-1 transition-none"
          href="#"
        >
          AUDITS
        </a>
      </div>
    </footer>
  );
}
