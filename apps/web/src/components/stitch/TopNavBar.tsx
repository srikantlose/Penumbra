'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const NAV_ITEMS = [
  { label: 'MAP', href: '/frontier' },
  { label: 'PROOFS', href: '/proofs' },
  { label: 'ANALYSIS', href: '/board' },
  { label: 'METHODOLOGY', href: '/methodology' },
];

export function TopNavBar() {
  const pathname = usePathname();

  return (
    <nav className="fixed top-0 left-0 w-full z-50 flex justify-between items-center px-gutter h-16 bg-black/80 backdrop-blur-md border-b-[2px] border-white">
      <Link className="flex items-center gap-4" href="/">
        <img
          alt="Logo"
          className="h-8 w-8 object-contain rounded-none grayscale contrast-200 brightness-200"
          src="https://lh3.googleusercontent.com/aida/AP1WRLsmarowsYQ9YSSwBze-l4e_6_vDQ8Ss33Q0vgIxJabtTsvnqw8siBtYthAgnkgpu0BIJ_hgJ3WEmF77xHOrymukLwsOmB_LZ8YNs0fYLni_8HKCyrq1TXmDAbO6hM5Wjrf2egHwkqMdjh7XPcpNa4ou5x_4qZG4ckMfc-MbkeHl8cT0z_DVJyTtIaQ87qXUikKiT4MrUmegGF5MdqITCdx3g41485FhBsp6QbTWs9BQPhXdPEFqYME9CA"
        />
        <span className="font-headline-sm text-headline-sm tracking-tighter text-white">
          PENUMBRA
        </span>
      </Link>
      <div className="hidden md:flex items-center gap-8 h-full">
        {NAV_ITEMS.map((item) => {
          const active = pathname === item.href;
          return (
            <Link
              key={item.label}
              className={`h-full flex items-center font-label-caps text-label-caps text-white px-2 transition-none uppercase ${
                active ? 'border-b-4 border-white' : 'hover:bg-white hover:text-black'
              }`}
              href={item.href}
            >
              {item.label}
            </Link>
          );
        })}
      </div>
      <div className="flex items-center gap-4 text-white">
        <button className="hover:bg-white hover:text-black p-1 transition-none flex items-center justify-center border border-transparent hover:border-white">
          <span className="material-symbols-outlined">notifications</span>
        </button>
        <button className="hover:bg-white hover:text-black p-1 transition-none flex items-center justify-center border border-transparent hover:border-white">
          <span className="material-symbols-outlined">settings</span>
        </button>
      </div>
    </nav>
  );
}
