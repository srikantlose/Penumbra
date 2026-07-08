import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import './globals.css';
import { ShaderBackground } from '@/components/stitch/ShaderBackground';
import { ClickEffects } from '@/components/stitch/ClickEffects';
import { TopNavBar } from '@/components/stitch/TopNavBar';
import { Footer } from '@/components/stitch/Footer';

export const metadata: Metadata = {
  title: 'Penumbra | The Unsolved Frontier',
  description: 'Mapping the solved frontier of chess.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html className="dark" lang="en">
      <head>
        <link href="https://fonts.googleapis.com" rel="preconnect" />
        <link crossOrigin="" href="https://fonts.gstatic.com" rel="preconnect" />
        <link
          href="https://fonts.googleapis.com/css2?family=Press+Start+2P&display=swap"
          rel="stylesheet"
        />
        <link
          href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="bg-background text-on-surface font-body-md text-body-md min-h-screen flex flex-col relative overflow-x-hidden selection:bg-white selection:text-black">
        <ShaderBackground />
        <ClickEffects />
        <TopNavBar />
        <div className="flex-1 flex flex-col">{children}</div>
        <Footer />
      </body>
    </html>
  );
}
