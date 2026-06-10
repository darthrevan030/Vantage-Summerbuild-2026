"use client";

import { useEffect, useRef } from "react";
import { animate, useInView, useReducedMotion } from "motion/react";

/* Animates a number to `to` — once when scrolled into view, and again whenever
   `to` changes (so the dashboard can reuse it for currency-switch transitions).
   Writes textContent directly (off the React render path) for 60fps.
   Reduced-motion → snaps to the final value. */
export function CountUp({
  to,
  format,
  suffix = "",
  durationMs = 900,
  className = "",
  startOnView = true,
}: {
  to: number;
  /** Custom formatter (client callers only — functions can't cross the server boundary). */
  format?: (v: number) => string;
  /** Serializable alternative to `format`, safe to pass from a Server Component. */
  suffix?: string;
  durationMs?: number;
  className?: string;
  startOnView?: boolean;
}) {
  const reduce = useReducedMotion();
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, amount: 0.4 });
  const fromRef = useRef(0);
  const fmt = format ?? ((v: number) => Math.round(v).toLocaleString() + suffix);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const from = fromRef.current;
    const settle = () => { fromRef.current = to; };

    if (reduce || (startOnView && !inView)) {
      el.textContent = fmt(startOnView && !inView ? from : to);
      if (!startOnView || inView) settle();
      return;
    }
    const controls = animate(from, to, {
      duration: durationMs / 1000,
      ease: [0.2, 0.7, 0.2, 1],
      onUpdate: (v) => { el.textContent = fmt(v); },
    });
    settle();
    return () => controls.stop();
  // fmt is derived from format/suffix; depend on those instead.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [to, inView, reduce, startOnView, durationMs, format, suffix]);

  return <span ref={ref} className={"tabular-nums " + className}>{fmt(to)}</span>;
}
