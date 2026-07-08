const NAV_LINKS = [
  { icon: 'memory', label: 'Engine', active: true },
  { icon: 'format_list_bulleted', label: 'Queue', active: false },
  { icon: 'filter_list', label: 'Filters', active: false },
  { icon: 'blur_on', label: 'Fog Settings', active: false },
  { icon: 'terminal', label: 'CLI Docs', active: false },
];

/** Analysis-page-scoped sidebar (not sitewide — engine job management only). */
export function EngineSidebar() {
  return (
    <aside className="fixed left-0 top-16 bottom-0 w-sidebar-width z-40 hidden md:flex flex-col bg-black/80 backdrop-blur-md border-r-[2px] border-white">
      <div className="p-6 border-b-[2px] border-white flex flex-col gap-1">
        <h2 className="font-label-caps text-label-caps text-white">ENGINE_CORE</h2>
        <span className="font-data-mono text-data-mono text-white">V2.1.0-STABLE</span>
      </div>
      <nav className="flex-1 overflow-y-auto py-4 flex flex-col gap-1 px-2 font-data-mono text-data-mono">
        {NAV_LINKS.map((link) => (
          <a
            key={link.label}
            className={`flex items-center gap-3 px-4 py-2 border-[2px] ${
              link.active
                ? 'bg-white text-black border-white'
                : 'text-white border-transparent hover:border-white'
            }`}
            href="#"
          >
            <span className="material-symbols-outlined text-[18px]">{link.icon}</span> {link.label}
          </a>
        ))}
      </nav>
      <div className="p-6 border-t-[2px] border-white">
        <button className="w-full py-2 border-[2px] border-white bg-black text-white font-label-caps text-label-caps flex items-center justify-center gap-2 hover:bg-white hover:text-black transition-none">
          <span className="material-symbols-outlined text-[16px]">add</span> NEW JOB
        </button>
      </div>
    </aside>
  );
}
