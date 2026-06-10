"use client";

import { useEffect, useRef, useState } from "react";
import { motion, useMotionValue, useSpring, useReducedMotion } from "motion/react";
import { Spark } from "@/components/charts/Spark";
import { SPRING_TILT } from "./motion-config";

const TREND = [
  34, 38, 36, 42, 40, 46, 44, 52, 49, 57, 54, 62,
  58, 66, 71, 68, 76, 74, 82, 88, 85, 94, 91, 104,
];
const HOLDINGS = [
  { ticker: "AAPL", name: "Apple Inc.", value: "S$48,210", pct: "+1.8%", up: true, pts: [3, 4, 3.6, 4.4, 4.2, 5, 5.4, 6] },
  { ticker: "VWRA", name: "Vanguard All-World", value: "S$112,480", pct: "−0.4%", up: false, pts: [5, 4.8, 5.2, 4.6, 4.9, 4.4, 4.6, 4.3] },
  { ticker: "BTC", name: "Bitcoin", value: "S$36,905", pct: "+3.1%", up: true, pts: [2, 2.6, 2.2, 3, 3.4, 3.1, 3.9, 4.6] },
  { ticker: "XAU", name: "Gold (spot)", value: "S$22,340", pct: "+0.6%", up: true, pts: [4, 4.2, 4.1, 4.4, 4.3, 4.6, 4.5, 4.8] },
];
const MONTHS = ["JAN", "MAR", "MAY", "JUL", "SEP", "NOV"];
const W = 560, H = 150, PAD = 14;

function trendPaths() {
  const min = Math.min(...TREND), max = Math.max(...TREND);
  const step = W / (TREND.length - 1);
  const y = (v: number) => H - PAD - ((v - min) / (max - min)) * (H - PAD * 2);
  const line = TREND.map((v, i) => `${i === 0 ? "M" : "L"}${(i * step).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  return { line, area: `${line} L${W},${H} L0,${H} Z` };
}

export function LiveTerminal() {
  const reduce = useReducedMotion();
  const { line, area } = trendPaths();
  const [total, setTotal] = useState(1248930);

  // subtle live tick (gated by reduced-motion)
  useEffect(() => {
    if (reduce) return;
    const id = setInterval(() => {
      setTotal((t) => t + Math.round((Math.random() - 0.45) * 180));
    }, 2600);
    return () => clearInterval(id);
  }, [reduce]);

  // cursor tilt
  const rx = useMotionValue(0), ry = useMotionValue(0);
  const srx = useSpring(rx, SPRING_TILT), sry = useSpring(ry, SPRING_TILT);
  const wrapRef = useRef<HTMLDivElement>(null);
  function onMove(e: React.PointerEvent) {
    if (reduce) return;
    const el = wrapRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const px = (e.clientX - r.left) / r.width - 0.5;
    const py = (e.clientY - r.top) / r.height - 0.5;
    ry.set(px * 6);
    rx.set(-py * 6);
  }
  function reset() { rx.set(0); ry.set(0); }

  return (
    <div ref={wrapRef} aria-hidden className="mx-auto max-w-[920px] [perspective:1400px]" onPointerMove={onMove} onPointerLeave={reset}>
      <div className="pointer-events-none absolute" />
      <motion.div
        style={{ rotateX: srx, rotateY: sry, transformStyle: "preserve-3d" }}
        className="overflow-hidden rounded-2xl border border-subtle bg-surface/80 shadow-[0_40px_90px_-45px_rgba(0,0,0,0.85)] backdrop-blur-xl"
      >
        {/* title bar */}
        <div className="relative flex items-center border-b border-subtle px-4 py-3">
          <div className="flex gap-1.5">
            <i className="size-2.5 rounded-full border border-subtle bg-elevated" />
            <i className="size-2.5 rounded-full border border-subtle bg-elevated" />
            <i className="size-2.5 rounded-full border border-subtle bg-elevated" />
          </div>
          <div className="absolute left-1/2 -translate-x-1/2 rounded-md border border-subtle bg-elevated px-3 py-1 font-mono text-[10px] tracking-[.06em] text-muted">
            portfolio / overview
          </div>
        </div>

        {/* hero stat strip */}
        <div className="flex flex-wrap items-end justify-between gap-4 border-b border-subtle px-6 py-5">
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-[.12em] text-muted">Total value</div>
            <div className="mt-1 flex items-baseline gap-3">
              <span className="font-mono text-[26px] font-semibold tabular-nums text-primary max-bp480:text-[21px]">
                S${total.toLocaleString("en-SG")}
              </span>
              <span className="flex items-center gap-1.5 rounded-full bg-gain/10 px-2.5 py-0.5 font-mono text-[11.5px] font-semibold text-gain">
                {!reduce && <i className="size-1.5 rounded-full bg-gain animate-pulse-dot" />}+1.2% today
              </span>
            </div>
          </div>
          <div className="flex gap-7 max-bp480:gap-5">
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-[.12em] text-muted">FX impact</div>
              <div className="mt-1 font-mono text-[15px] font-semibold tabular-nums text-fx-up">+S$12,480</div>
            </div>
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-[.12em] text-muted">Holdings</div>
              <div className="mt-1 font-mono text-[15px] font-semibold tabular-nums text-primary">24</div>
            </div>
          </div>
        </div>

        {/* chart + holdings */}
        <div className="grid gap-0 md:grid-cols-[1.4fr_1fr]">
          <div className="border-b border-subtle p-6 md:border-b-0 md:border-r">
            <div className="mb-4 flex items-center justify-between">
              <span className="text-[10px] font-semibold uppercase tracking-[.12em] text-muted">Portfolio value · 1Y</span>
              <span className="font-mono text-[10.5px] text-muted">SGD</span>
            </div>
            <svg viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full overflow-visible">
              <defs>
                <linearGradient id="lt-trend" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--gold)" stopOpacity="0.26" />
                  <stop offset="100%" stopColor="var(--gold)" stopOpacity="0" />
                </linearGradient>
              </defs>
              <motion.path
                d={area}
                fill="url(#lt-trend)"
                initial={reduce ? false : { opacity: 0 }}
                whileInView={{ opacity: 1 }}
                viewport={{ once: true }}
                transition={{ duration: 0.8, delay: 0.5 }}
              />
              <motion.path
                d={line}
                fill="none"
                stroke="var(--gold)"
                strokeWidth="2"
                strokeLinejoin="round"
                strokeLinecap="round"
                initial={reduce ? false : { pathLength: 0 }}
                whileInView={{ pathLength: 1 }}
                viewport={{ once: true }}
                transition={{ duration: 1.1, ease: [0.2, 0.7, 0.2, 1] }}
              />
            </svg>
            <div className="mt-3 flex justify-between font-mono text-[9.5px] tracking-[.08em] text-muted">
              {MONTHS.map((m) => <span key={m}>{m}</span>)}
            </div>
          </div>

          <div className="flex flex-col justify-center p-3">
            {HOLDINGS.map((h, i) => (
              <div key={h.ticker} className={"flex items-center gap-3 px-3 py-3 " + (i < HOLDINGS.length - 1 ? "border-b border-subtle" : "")}>
                <span className="grid h-7 w-11 shrink-0 place-items-center rounded-[7px] border border-subtle bg-elevated font-mono text-[10px] font-semibold text-gold">{h.ticker}</span>
                <span className="min-w-0 flex-1 truncate font-ui text-[12px] text-secondary max-bp480:hidden">{h.name}</span>
                <Spark pts={h.pts} color={h.up ? "var(--gain)" : "var(--loss)"} w={64} h={20} sw={1.5} />
                <span className="font-mono text-[12px] tabular-nums text-primary">{h.value}</span>
                <span className={"w-12 text-right font-mono text-[11.5px] font-semibold tabular-nums " + (h.up ? "text-gain" : "text-loss")}>{h.pct}</span>
              </div>
            ))}
          </div>
        </div>
      </motion.div>
    </div>
  );
}
