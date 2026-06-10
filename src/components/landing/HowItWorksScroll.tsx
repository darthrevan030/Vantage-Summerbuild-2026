"use client";

import { useRef, useState } from "react";
import {
  motion,
  useScroll,
  useTransform,
  useMotionValueEvent,
  useReducedMotion,
  type MotionValue,
} from "motion/react";
import { Icon } from "@/components/Icon";
import { Spark } from "@/components/charts/Spark";

const STEPS = [
  { n: "1", title: "Sign in", copy: "Magic link or Google — no password to invent, store or forget." },
  { n: "2", title: "Add your holdings", copy: "A form that knows 32 exchanges and 8 currencies, or one CSV import." },
  { n: "3", title: "Read the insights", copy: "Live P&L, FX impact, allocation and AI commentary — from the first refresh." },
];

function MockSignIn() {
  return (
    <div className="w-full max-w-[340px] rounded-2xl border border-subtle bg-surface p-6 shadow-card">
      <div className="font-serif text-[18px] text-gold [text-shadow:0_0_18px_var(--accent-glow)]">Portfolio</div>
      <div className="mt-5 space-y-3">
        <div className="flex items-center gap-2 rounded-[10px] border border-subtle bg-elevated px-3 py-2.5 font-ui text-[12px] text-secondary">
          <Icon name="landmark" size={14} className="text-muted" /> you@example.com
        </div>
        <div className="flex items-center justify-center rounded-[10px] bg-gold py-2.5 font-ui text-[13px] font-semibold text-[#15130c]">
          Send magic link
        </div>
      </div>
    </div>
  );
}

function MockAdd() {
  const rows = [["AAPL", "Equity", "US$"], ["VWRA", "ETF", "US$"], ["XAU", "Gold", "S$"]];
  return (
    <div className="w-full max-w-[380px] rounded-2xl border border-subtle bg-surface p-5 shadow-card">
      <div className="grid grid-cols-3 gap-2 border-b border-subtle pb-2 text-[9.5px] font-semibold uppercase tracking-[.1em] text-muted">
        <span>Ticker</span><span>Type</span><span>CCY</span>
      </div>
      {rows.map(([a, b, c], i) => (
        <div key={i} className="grid grid-cols-3 gap-2 border-b border-subtle py-2.5 font-mono text-[12px] last:border-0">
          <span className="text-gold">{a}</span><span className="text-secondary">{b}</span><span className="text-secondary">{c}</span>
        </div>
      ))}
    </div>
  );
}

function MockInsights() {
  return (
    <div className="w-full max-w-[380px] rounded-2xl border border-subtle bg-surface p-5 shadow-card">
      <div className="text-[10px] font-semibold uppercase tracking-[.12em] text-muted">Portfolio · 1Y</div>
      <div className="mt-1 font-mono text-[22px] font-semibold tabular-nums text-primary">S$1,248,930</div>
      <div className="mt-3">
        <Spark pts={[3, 4, 3.4, 4.6, 4.2, 5.4, 5, 6.2, 5.8, 7]} color="var(--gold)" w={330} h={70} />
      </div>
      <div className="mt-3 flex gap-2">
        <span className="rounded-full bg-gain/10 px-2.5 py-0.5 font-mono text-[11px] font-semibold text-gain">+1.2% today</span>
        <span className="rounded-full bg-fx-up/10 px-2.5 py-0.5 font-mono text-[11px] font-semibold text-fx-up">FX +S$12,480</span>
      </div>
    </div>
  );
}

const MOCKS = [<MockSignIn key="0" />, <MockAdd key="1" />, <MockInsights key="2" />];

function Layer({ p, index, count, children }: { p: MotionValue<number>; index: number; count: number; children: React.ReactNode }) {
  const seg = 1 / count;
  const s = index * seg;
  const isFirst = index === 0;
  const isLast = index === count - 1;
  // Offsets must stay within [0,1] and be non-decreasing — Motion compiles these
  // into a WAAPI ScrollTimeline, which rejects out-of-range/unsorted offsets.
  const inR = [
    Math.max(0, s - 0.02),
    Math.min(1, s + 0.04),
    Math.min(1, s + seg - 0.04),
    Math.min(1, s + seg + (isLast ? 0 : 0.02)),
  ];
  const opacity = useTransform(p, inR, [isFirst ? 1 : 0, 1, 1, isLast ? 1 : 0]);
  const y = useTransform(p, inR, [isFirst ? 0 : 30, 0, 0, isLast ? 0 : -30]);
  return (
    <motion.div style={{ opacity, y }} className="absolute inset-0 grid place-items-center">
      {children}
    </motion.div>
  );
}

export function HowItWorksScroll() {
  const reduce = useReducedMotion();
  const ref = useRef<HTMLElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start start", "end end"] });
  const [active, setActive] = useState(0);
  useMotionValueEvent(scrollYProgress, "change", (v) => {
    setActive(v < 0.34 ? 0 : v < 0.67 ? 1 : 2);
  });

  // Reduced-motion / no-JS-ish: a calm stacked layout, no pin, no scroll binding.
  if (reduce) {
    return (
      <section className="mx-auto max-w-[1140px] px-6 py-24">
        <SectionHead />
        <div className="mt-12 grid gap-12 md:grid-cols-3">
          {STEPS.map((s, i) => (
            <div key={s.n}>
              <StepBadge n={s.n} active />
              <h3 className="mt-4 font-ui text-[16px] font-semibold text-primary">{s.title}</h3>
              <p className="mt-2 font-ui text-[13.5px] leading-relaxed text-secondary">{s.copy}</p>
              <div aria-hidden className="pointer-events-none mt-6 grid select-none place-items-center">{MOCKS[i]}</div>
            </div>
          ))}
        </div>
      </section>
    );
  }

  return (
    <section ref={ref} className="relative h-[300vh]">
      <div className="sticky top-0 flex h-screen items-center overflow-hidden">
        <div className="mx-auto grid w-full max-w-[1140px] items-center gap-10 px-6 md:grid-cols-2">
          <div>
            <SectionHead />
            <ol className="mt-10 space-y-7">
              {STEPS.map((s, i) => (
                <li key={s.n} className="flex gap-4">
                  <StepBadge n={s.n} active={active === i} />
                  <motion.div animate={{ opacity: active === i ? 1 : 0.62 }} transition={{ duration: 0.3 }}>
                    <h3 className="font-ui text-[17px] font-semibold text-primary">{s.title}</h3>
                    <p className="mt-1 max-w-[42ch] font-ui text-[13.5px] leading-relaxed text-secondary">{s.copy}</p>
                  </motion.div>
                </li>
              ))}
            </ol>
          </div>
          <div aria-hidden className="pointer-events-none relative h-[340px] select-none max-bp768:hidden">
            {MOCKS.map((m, i) => <Layer key={i} p={scrollYProgress} index={i} count={MOCKS.length}>{m}</Layer>)}
          </div>
        </div>
      </div>
    </section>
  );
}

function SectionHead() {
  return (
    <>
      <div className="text-[11px] font-semibold uppercase tracking-[.16em] text-gold">How it works</div>
      <h2 className="mt-4 font-serif text-[clamp(34px,4.5vw,54px)] leading-[1.08] text-primary">
        Three steps to a clear picture
      </h2>
    </>
  );
}

function StepBadge({ n, active }: { n: string; active: boolean }) {
  return (
    <div
      className={
        "grid size-10 shrink-0 place-items-center rounded-full border font-serif text-[17px] transition-colors duration-300 " +
        (active ? "border-gold-soft text-gold [box-shadow:0_0_18px_var(--accent-glow)]" : "border-subtle text-muted")
      }
    >
      {n}
    </div>
  );
}
