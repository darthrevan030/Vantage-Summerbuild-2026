"use client";

import { useRef } from "react";
import { useReducedMotion } from "motion/react";

/* Feature card with a cursor-tracking radial glow. Writes --mx/--my CSS vars on
   pointermove (rAF-throttled) — no React re-render. Reduced-motion → static. */
export function SpotlightCard({
  className = "",
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  const reduce = useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  const raf = useRef(0);

  function onMove(e: React.PointerEvent) {
    if (reduce) return;
    const el = ref.current;
    if (!el) return;
    const x = e.clientX, y = e.clientY;
    if (raf.current) return;
    raf.current = requestAnimationFrame(() => {
      raf.current = 0;
      const r = el.getBoundingClientRect();
      el.style.setProperty("--mx", `${x - r.left}px`);
      el.style.setProperty("--my", `${y - r.top}px`);
    });
  }
  function onLeave() {
    const el = ref.current;
    if (el) el.style.setProperty("--spot", "0");
  }
  function onEnter() {
    const el = ref.current;
    if (el && !reduce) el.style.setProperty("--spot", "1");
  }

  return (
    <div
      ref={ref}
      onPointerMove={onMove}
      onPointerEnter={onEnter}
      onPointerLeave={onLeave}
      className={
        "group relative overflow-hidden rounded-2xl border border-subtle bg-surface transition-colors duration-300 hover:border-gold-soft " +
        "before:pointer-events-none before:absolute before:inset-0 before:opacity-[var(--spot,0)] before:transition-opacity before:duration-300 " +
        "before:bg-[radial-gradient(280px_circle_at_var(--mx,50%)_var(--my,0%),var(--accent-glow),transparent_70%)] before:content-[''] " +
        className
      }
    >
      {children}
    </div>
  );
}
