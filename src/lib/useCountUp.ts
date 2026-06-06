"use client";

import { useState, useEffect } from "react";

export function useCountUp(target: number, dur = 1200, run = true): number {
  const [v, setV] = useState(run ? 0 : target);

  useEffect(() => {
    if (!run) {
      setV(target);
      return;
    }
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setV(target);
      return;
    }

    let raf: number;
    let start: number | undefined;

    const tick = (t: number) => {
      if (!start) start = t;
      const p = Math.min(1, (t - start) / dur);
      // cubic ease-out: 1 - (1-p)^3
      setV(target * (1 - Math.pow(1 - p, 3)));
      if (p < 1) raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, run, dur]);

  return v;
}
