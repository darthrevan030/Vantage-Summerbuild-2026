import { Spark } from "@/components/charts/Spark";

/* Stylised, CSS-built dashboard preview for the landing hero. Pure
   decoration (aria-hidden); every colour comes from the app tokens so
   it renders correctly in both themes. */

const TREND = [
  34, 38, 36, 42, 40, 46, 44, 52, 49, 57, 54, 62,
  58, 66, 71, 68, 76, 74, 82, 88, 85, 94, 91, 104,
];

const HOLDINGS = [
  { ticker: "AAPL", name: "Apple Inc.", value: "S$48,210", pct: "+1.8%", up: true, pts: [3, 4, 3.6, 4.4, 4.2, 5, 5.4, 6] },
  { ticker: "VWRA", name: "Vanguard FTSE All-World", value: "S$112,480", pct: "−0.4%", up: false, pts: [5, 4.8, 5.2, 4.6, 4.9, 4.4, 4.6, 4.3] },
  { ticker: "BTC", name: "Bitcoin", value: "S$36,905", pct: "+3.1%", up: true, pts: [2, 2.6, 2.2, 3, 3.4, 3.1, 3.9, 4.6] },
  { ticker: "XAU", name: "Gold (spot)", value: "S$22,340", pct: "+0.6%", up: true, pts: [4, 4.2, 4.1, 4.4, 4.3, 4.6, 4.5, 4.8] },
];

const MONTHS = ["JAN", "MAR", "MAY", "JUL", "SEP", "NOV"];

function trendPath(w: number, h: number, pad: number): { line: string; area: string } {
  const min = Math.min(...TREND);
  const max = Math.max(...TREND);
  const step = w / (TREND.length - 1);
  const y = (v: number) => h - pad - ((v - min) / (max - min)) * (h - pad * 2);
  const line = TREND.map((v, i) => `${i === 0 ? "M" : "L"}${(i * step).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  return { line, area: `${line} L${w},${h} L0,${h} Z` };
}

export function HeroMock() {
  const { line, area } = trendPath(560, 150, 14);

  return (
    <div aria-hidden="true" className="relative mx-auto max-w-[980px]">
      {/* accent halo behind the window */}
      <div className="absolute -inset-x-10 -top-16 bottom-0 -z-10 bg-[radial-gradient(60%_60%_at_50%_0%,var(--accent-glow),transparent_70%)] blur-2xl" />

      <div className="overflow-hidden rounded-2xl border border-subtle bg-surface/80 shadow-[0_40px_80px_-40px_rgba(0,0,0,0.8)] backdrop-blur-xl">
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
              <span className="font-mono text-[26px] font-semibold text-primary max-bp480:text-[21px]">S$1,248,930</span>
              <span className="rounded-full bg-gain/10 px-2.5 py-0.5 font-mono text-[11.5px] font-semibold text-gain">
                +1.2% today
              </span>
            </div>
          </div>
          <div className="flex gap-7 max-bp480:gap-5">
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-[.12em] text-muted">FX impact</div>
              <div className="mt-1 font-mono text-[15px] font-semibold text-fx-up">+S$12,480</div>
            </div>
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-[.12em] text-muted">Holdings</div>
              <div className="mt-1 font-mono text-[15px] font-semibold text-primary">24</div>
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
            <svg viewBox="0 0 560 150" className="block h-auto w-full overflow-visible">
              <defs>
                <linearGradient id="lm-trend" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--gold)" stopOpacity="0.26" />
                  <stop offset="100%" stopColor="var(--gold)" stopOpacity="0" />
                </linearGradient>
              </defs>
              <path d={area} fill="url(#lm-trend)" />
              <path d={line} fill="none" stroke="var(--gold)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
              <circle cx="560" cy="14" r="3" fill="var(--gold)" />
            </svg>
            <div className="mt-3 flex justify-between font-mono text-[9.5px] tracking-[.08em] text-muted">
              {MONTHS.map((m) => (
                <span key={m}>{m}</span>
              ))}
            </div>
          </div>

          <div className="flex flex-col justify-center p-3">
            {HOLDINGS.map((h, i) => (
              <div
                key={h.ticker}
                className={
                  "flex items-center gap-3 px-3 py-3 " +
                  (i < HOLDINGS.length - 1 ? "border-b border-subtle" : "")
                }
              >
                <span className="grid h-7 w-11 shrink-0 place-items-center rounded-[7px] border border-subtle bg-elevated font-mono text-[10px] font-semibold text-gold">
                  {h.ticker}
                </span>
                <span className="min-w-0 flex-1 truncate font-ui text-[12px] text-secondary max-bp480:hidden">
                  {h.name}
                </span>
                <Spark pts={h.pts} color={h.up ? "var(--gain)" : "var(--loss)"} w={64} h={20} sw={1.5} />
                <span className="font-mono text-[12px] text-primary">{h.value}</span>
                <span className={"w-12 text-right font-mono text-[11.5px] font-semibold " + (h.up ? "text-gain" : "text-loss")}>
                  {h.pct}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
