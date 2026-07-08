'use client';

import { useEffect, useRef } from 'react';

/**
 * Canvas-drawn static noise texture representing "the fog" — the unsolved
 * territory beyond the proven frontier coastline. Pure black/white pixels,
 * no gradients, matching the 8-bit dithered aesthetic.
 */
export function FrontierCanvas({ className }: { className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    function draw() {
      const dpr = window.devicePixelRatio || 1;
      const w = canvas!.clientWidth || 800;
      const h = canvas!.clientHeight || 400;
      canvas!.width = w * dpr;
      canvas!.height = h * dpr;

      const ctx = canvas!.getContext('2d');
      if (!ctx) return;
      ctx.scale(dpr, dpr);
      ctx.clearRect(0, 0, w, h);

      const cell = 3;
      for (let y = 0; y < h; y += cell) {
        for (let x = 0; x < w; x += cell) {
          // Denser noise near the top (closer to the frontier), sparser toward the bottom.
          const density = 0.35 - (y / h) * 0.25;
          if (Math.random() < density) {
            ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
            ctx.fillRect(x, y, 1, 1);
          }
        }
      }
    }

    draw();
    window.addEventListener('resize', draw);
    return () => window.removeEventListener('resize', draw);
  }, []);

  return <canvas ref={canvasRef} aria-hidden="true" className={className} />;
}
