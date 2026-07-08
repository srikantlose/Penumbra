'use client';

import { useEffect } from 'react';

const SPARK_COUNT = 8;

/**
 * Sitewide screen-shake + pixel-spark feedback on button/link clicks, from the
 * Stitch retro design system. Mounted once in the root layout (not per-page).
 */
export function ClickEffects() {
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      const target = (e.target as HTMLElement).closest('button, a');
      if (!target) return;

      document.body.classList.remove('shake-active');
      void document.body.offsetWidth; // trigger reflow so the animation restarts
      document.body.classList.add('shake-active');
      setTimeout(() => document.body.classList.remove('shake-active'), 100);

      for (let i = 0; i < SPARK_COUNT; i++) {
        const spark = document.createElement('div');
        spark.className = 'pixel-spark';
        document.body.appendChild(spark);

        const angle = (i / SPARK_COUNT) * Math.PI * 2;
        const velocity = 2 + Math.random() * 4;
        const vx = Math.cos(angle) * velocity;
        const vy = Math.sin(angle) * velocity;

        let x = e.clientX;
        let y = e.clientY;
        let opacity = 1;

        const animate = () => {
          x += vx;
          y += vy;
          opacity -= 0.05;
          spark.style.left = `${x}px`;
          spark.style.top = `${y}px`;
          spark.style.opacity = String(opacity);

          if (opacity > 0) {
            requestAnimationFrame(animate);
          } else {
            spark.remove();
          }
        };
        requestAnimationFrame(animate);
      }
    }

    document.addEventListener('click', handleClick);
    return () => document.removeEventListener('click', handleClick);
  }, []);

  return null;
}
