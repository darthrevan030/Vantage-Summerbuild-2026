"use client";

import { useRef, useState } from "react";
import {
  motion,
  animate,
  useMotionValue,
  useSpring,
  useTransform,
  useScroll,
  useMotionValueEvent,
  useReducedMotion,
  type MotionValue,
} from "motion/react";
import { SPRING_SMOOTH } from "./motion-config";

const TOTAL = 4420; // S$ — the headline gain
const MIN = 0.08;
const MAX = 0.92;
const clamp = (v: number) => Math.min(MAX, Math.max(MIN, v));
const fmt = (v: number) => "S$" + Math.round(v).toLocaleString("en-SG");

function MotionNumber({ mv, className = "" }: { mv: MotionValue<number>; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  useMotionValueEvent(mv, "change", (v) => { if (ref.current) ref.current.textContent = fmt(v); });
  return <span ref={ref} className={"font-mono tabular-nums " + className}>{fmt(mv.get())}</span>;
}

export function HeroFxSplit() {
  const reduce = useReducedMotion();
  const sectionRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const engagedRef = useRef(false);
  const [assetPct, setAssetPct] = useState(62); // for aria + verdict (low-freq)

  const split = useMotionValue(0.62);
  const springSplit = useSpring(split, SPRING_SMOOTH);

  const assetW = useTransform(springSplit, (v) => `${(v * 100).toFixed(2)}%`);
  const fxW = useTransform(springSplit, (v) => `${((1 - v) * 100).toFixed(2)}%`);
  const assetGain = useTransform(springSplit, (v) => Math.round(TOTAL * v));
  const fxGain = useTransform(springSplit, (v) => TOTAL - Math.round(TOTAL * v));

  // verdict / aria — update only on integer-percent change
  useMotionValueEvent(springSplit, "change", (v) => {
    const p = Math.round(v * 100);
    setAssetPct((prev) => (prev === p ? prev : p));
  });

  // ── scroll demo (only until the user engages) ──
  const { scrollYProgress } = useScroll({ target: sectionRef, offset: ["start 0.85", "end 0.4"] });
  const demo = useTransform(scrollYProgress, [0, 0.5, 1], [0.62, 0.4, 0.62]);
  useMotionValueEvent(demo, "change", (v) => {
    if (!engagedRef.current && !reduce) split.set(v);
  });

  function setFromClientX(clientX: number) {
    const t = trackRef.current;
    if (!t) return;
    const r = t.getBoundingClientRect();
    split.set(clamp((clientX - r.left) / r.width));
  }

  function onPointerDown(e: React.PointerEvent) {
    engagedRef.current = true;
    setFromClientX(e.clientX);
    const move = (ev: PointerEvent) => setFromClientX(ev.clientX);
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move, { passive: true });
    window.addEventListener("pointerup", up);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    const step = e.shiftKey ? 0.1 : 0.02;
    let next: number | null = null;
    if (e.key === "ArrowLeft" || e.key === "ArrowDown") next = clamp(split.get() - step);
    if (e.key === "ArrowRight" || e.key === "ArrowUp") next = clamp(split.get() + step);
    if (next !== null) {
      e.preventDefault();
      engagedRef.current = true;
      if (reduce) split.set(next);
      else animate(split, next, { duration: 0.18 });
    }
  }

  const fxPct = 100 - assetPct;

  return (
    <div ref={sectionRef} className="relative mx-auto w-full max-w-[640px]">
      {/* accent halo */}
      <div className="pointer-events-none absolute -inset-x-8 -top-10 bottom-0 -z-10 bg-[radial-gradient(60%_60%_at_50%_0%,var(--accent-glow),transparent_70%)] blur-2xl" />

      <div className="rounded-2xl border border-subtle bg-surface/80 p-7 shadow-[0_40px_80px_-40px_rgba(0,0,0,0.8)] backdrop-blur-xl max-bp480:p-5">
        <p className="font-ui text-[15px] leading-relaxed text-secondary">
          Your <span className="font-mono font-semibold text-gain">+{fmt(TOTAL)}</span> gain
          {" — "}how much is <span className="italic text-primary">actually</span> real?
        </p>

        {/* split track */}
        <div className="mt-7">
          <div
            ref={trackRef}
            className="relative h-4 w-full overflow-visible rounded-full"
            onPointerDown={onPointerDown}
          >
            {/* asset segment */}
            <motion.div
              style={{ width: assetW }}
              className="absolute inset-y-0 left-0 rounded-l-full bg-[linear-gradient(90deg,color-mix(in_oklab,var(--gain),black_12%),var(--gain))]"
            />
            {/* fx segment */}
            <motion.div
              style={{ width: fxW }}
              className="absolute inset-y-0 right-0 rounded-r-full bg-[linear-gradient(90deg,var(--fx-positive),color-mix(in_oklab,var(--fx-positive),white_22%))]"
            />
            {/* handle */}
            <motion.div
              role="slider"
              tabIndex={0}
              aria-label="Share of the gain from the asset versus the currency"
              aria-valuemin={Math.round(MIN * 100)}
              aria-valuemax={Math.round(MAX * 100)}
              aria-valuenow={assetPct}
              aria-valuetext={`${assetPct}% asset, ${fxPct}% currency`}
              onKeyDown={onKeyDown}
              style={{ left: assetW, touchAction: "none" }}
              whileTap={reduce ? undefined : { scale: 1.12 }}
              className="absolute top-1/2 z-10 size-6 -translate-x-1/2 -translate-y-1/2 cursor-ew-resize rounded-full border-2 border-[color-mix(in_oklab,var(--gold),white_30%)] bg-base shadow-[0_0_18px_var(--accent-glow)] outline-none focus-visible:ring-2 focus-visible:ring-gold-soft"
            />
          </div>

          {/* labels */}
          <div className="mt-5 flex items-end justify-between">
            <div>
              <div className="text-[10.5px] font-semibold uppercase tracking-[.14em] text-muted">Your asset</div>
              <MotionNumber mv={assetGain} className="mt-1 block text-[19px] font-semibold text-gain" />
            </div>
            <div className="text-right">
              <div className="text-[10.5px] font-semibold uppercase tracking-[.14em] text-muted">The currency</div>
              <MotionNumber mv={fxGain} className="mt-1 block text-[19px] font-semibold text-fx-up" />
            </div>
          </div>

          <div className="mt-6 border-t border-subtle pt-4 font-ui text-[13px] text-secondary">
            <span className="font-semibold text-gain">{assetPct}%</span> your asset
            <span className="mx-2 text-muted">·</span>
            <span className="font-semibold text-fx-up">{fxPct}%</span> the currency
          </div>
        </div>

        <p className="mt-5 font-ui text-[12px] leading-relaxed text-muted">
          Drag the handle — the FX Lab decomposes every position like this, so a weak
          dollar never masquerades as a winning stock.
        </p>
      </div>
    </div>
  );
}
