"use client";

import { Donut } from "@/components/charts/Donut";
import { Legend } from "@/components/charts/Legend";
import { pct } from "@/lib/formatters";
import { usePortfolio } from "@/context/portfolio";

const LABEL = "font-ui text-[11px] tracking-[.04em] text-secondary";

export function SummaryRail() {
  const { hero, assetAllocation, fmtSigned } = usePortfolio();
  const top = assetAllocation[0];
  const fxUp = hero.fxImpact >= 0;
  const dayUp = hero.dayChange >= 0;

  return (
    <aside className="sticky top-[110px] flex h-[calc(100vh-110px)] flex-[0_0_248px] flex-col gap-4.5 self-start overflow-y-auto border-r border-subtle px-5 py-[22px] max-bp1080:hidden light:border-r-black/[.09]">
      <div className="flex flex-col gap-3">
        <div className={LABEL}>Allocation</div>
        <div className="mt-1 grid place-items-center [filter:drop-shadow(0_6px_18px_rgba(150,110,255,0.16))]">
          <Donut data={assetAllocation} size={132} thickness={18}>
            {top && (
              <div>
                <div className={LABEL}>{top.label}</div>
                <div className="font-mono text-[19px] font-semibold tracking-[-.02em]">{top.value}%</div>
              </div>
            )}
          </Donut>
        </div>
        <Legend data={assetAllocation} />
      </div>

      <div className="h-px bg-subtle" />

      <div className="flex flex-col gap-3.5">
        <div className="flex flex-col gap-0.5">
          <span className={LABEL}>Total Gain</span>
          <span className="font-mono text-[17px] font-semibold max-bp480:text-[15px]" style={{ color: hero.totalGain >= 0 ? "var(--gain)" : "var(--loss)" }}>{fmtSigned(hero.totalGain)}</span>
          <span className="font-mono text-xs" style={{ color: hero.totalGain >= 0 ? "var(--gain)" : "var(--loss)" }}>{pct(hero.totalGainPct)}</span>
        </div>
        <div className="flex flex-col gap-0.5">
          <span className={LABEL}>FX Impact</span>
          <span className="font-mono text-[17px] font-semibold max-bp480:text-[15px]" style={{ color: fxUp ? "var(--fx-positive)" : "var(--fx-negative)" }}>{fmtSigned(hero.fxImpact)}</span>
          <span className="font-mono text-xs" style={{ color: fxUp ? "var(--fx-positive)" : "var(--fx-negative)" }}>{pct(hero.fxPct)}</span>
        </div>
        <div className="flex flex-col gap-0.5">
          <span className={LABEL}>Today</span>
          <span className="font-mono text-[17px] font-semibold max-bp480:text-[15px]" style={{ color: dayUp ? "var(--gain)" : "var(--loss)" }}>{fmtSigned(hero.dayChange)}</span>
          <span className="font-mono text-xs" style={{ color: dayUp ? "var(--gain)" : "var(--loss)" }}>{pct(hero.dayPct)}</span>
        </div>
      </div>

      <div className="h-px bg-subtle" />
      <div className="flex items-center justify-between">
        <span className={LABEL}>Updated {hero.updated}</span>
        <span className="flex items-center gap-1.5 text-[11px] text-secondary">
          <i className="size-1.5 rounded-full bg-gain animate-pulse-dot" />live
        </span>
      </div>
    </aside>
  );
}
