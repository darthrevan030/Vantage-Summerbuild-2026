"use client";

import { useState, useEffect } from "react";
import { Donut } from "@/components/charts/Donut";
import { Legend } from "@/components/charts/Legend";
import { InfoTip } from "@/components/InfoTip";
import { pct, NF } from "@/lib/formatters";
import { usePortfolio } from "@/context/portfolio";

const LABEL = "font-ui text-[11px] tracking-[.04em] text-secondary";

export function SummaryRail() {
  const { hero, assetAllocation, fmtVal, fmtSigned } = usePortfolio();
  const top = assetAllocation.length > 0
    ? assetAllocation.reduce((max, s) => s.value > max.value ? s : max, assetAllocation[0])
    : null;
  const fxUp = hero.fxImpact >= 0;
  const dayUp = hero.dayChange >= 0;
  const invested = hero.total - hero.totalGain;

  const [activeSlice, setActiveSlice] = useState<number | null>(null);
  const activeData = activeSlice !== null ? assetAllocation[activeSlice] : null;

  // Sharpe lives in the snapshot-derived analytics, not the portfolio context.
  // Until it resolves (or if there isn't enough history), the metric stays
  // visually muted rather than showing a misleading zero.
  const [sharpe, setSharpe] = useState<number | null>(null);
  useEffect(() => {
    let alive = true;
    fetch("/api/portfolio/analytics")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (alive && d && d.days >= 2) setSharpe(d.actualSharpe);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  return (
    <aside className="sticky top-[110px] flex h-[calc(100vh-110px)] flex-[0_0_248px] flex-col gap-4.5 self-start overflow-y-auto border-r border-subtle px-5 py-[22px] max-bp1080:hidden light:border-r-black/[.09]">
      <div className="flex flex-col gap-3">
        <div className={LABEL}>Allocation</div>
        <div className="mt-1 grid place-items-center [filter:drop-shadow(0_6px_18px_rgba(150,110,255,0.16))]">
          <Donut
            data={assetAllocation}
            size={132}
            thickness={18}
            highlight={activeSlice ?? -1}
            onHover={(i) => setActiveSlice(i)}
            onLeave={() => setActiveSlice(null)}
          >
            {activeData ? (
              <div>
                <div className={LABEL}>{activeData.label}</div>
                <div className="font-mono text-[19px] font-semibold tracking-[-.02em]">
                  {activeData.value}%
                </div>
              </div>
            ) : (
              top && (
                <div>
                  <div className={LABEL}>{top.label}</div>
                  <div className="font-mono text-[19px] font-semibold tracking-[-.02em]">
                    {top.value}%
                  </div>
                </div>
              )
            )}
          </Donut>
        </div>
        <Legend data={assetAllocation} size="sm" />
      </div>

      <div className="h-px bg-subtle" />

      {/* Group 1 — portfolio value context */}
      <div className="flex flex-col gap-3.5">
        <div className="flex flex-col gap-0.5">
          <span className={LABEL}>Total Invested</span>
          <span className="font-mono text-[17px] font-semibold text-primary max-bp480:text-[15px]">
            {fmtVal(invested)}
          </span>
          <span className="font-ui text-[11px] text-muted">cost basis</span>
        </div>
        <div className="flex flex-col gap-0.5">
          <span className={LABEL}>Total Gain</span>
          <span
            className="font-mono text-[17px] font-semibold max-bp480:text-[15px]"
            style={{
              color: hero.totalGain >= 0 ? "var(--gain)" : "var(--loss)",
            }}
          >
            {fmtSigned(hero.totalGain)}
          </span>
          <span
            className="font-mono text-xs"
            style={{
              color: hero.totalGain >= 0 ? "var(--gain)" : "var(--loss)",
            }}
          >
            {pct(hero.totalGainPct)}
          </span>
        </div>
        <div className="flex flex-col gap-0.5">
          <span className={LABEL}>FX Impact</span>
          <span
            className="font-mono text-[17px] font-semibold max-bp480:text-[15px]"
            style={{
              color: fxUp ? "var(--fx-positive)" : "var(--fx-negative)",
            }}
          >
            {fmtSigned(hero.fxImpact)}
          </span>
          <span
            className="font-mono text-xs"
            style={{
              color: fxUp ? "var(--fx-positive)" : "var(--fx-negative)",
            }}
          >
            {pct(hero.fxPct)}
          </span>
        </div>
        <div className="flex flex-col gap-0.5">
          <span className={LABEL}>Today</span>
          <span
            className="font-mono text-[17px] font-semibold max-bp480:text-[15px]"
            style={{ color: dayUp ? "var(--gain)" : "var(--loss)" }}
          >
            {fmtSigned(hero.dayChange)}
          </span>
          <span
            className="font-mono text-xs"
            style={{ color: dayUp ? "var(--gain)" : "var(--loss)" }}
          >
            {pct(hero.dayPct)}
          </span>
        </div>
      </div>

      <div className="h-px bg-subtle" />

      {/* Group 2 — dividend cash flow */}
      <div className="flex flex-col gap-3.5">
        <div className="flex flex-col gap-0.5">
          <span className={LABEL + " flex items-center gap-1"}>
            Portfolio Yield
            <InfoTip text="Estimated annual yield, weighted by position value. Includes auto-derived TTM yields and manual overrides." />
          </span>
          <span className="font-mono text-[17px] font-semibold text-gold max-bp480:text-[15px]">
            {hero.portfolioYield > 0 ? NF(hero.portfolioYield, 2) + "%" : "—"}
          </span>
        </div>
        <div className="flex flex-col gap-0.5">
          <span className={LABEL + " flex items-center gap-1"}>
            Annual Income
            <InfoTip text="Estimated annual dividend income at current yields and position sizes, shown in your base currency." />
          </span>
          <span className="font-mono text-[17px] font-semibold text-primary max-bp480:text-[15px]">
            {hero.annualIncome > 0 ? fmtVal(hero.annualIncome) : "—"}
          </span>
        </div>
      </div>

      <div className="h-px bg-subtle" />

      {/* Group 3 — risk metric (muted until backend resolves Sharpe) */}
      <div
        className={
          "flex flex-col gap-0.5 transition-opacity duration-300 " +
          (sharpe == null ? "opacity-50" : "opacity-100")
        }
      >
        <span className={LABEL + " flex items-center gap-1"}>
          Sharpe Ratio
          <InfoTip text="Annualised risk-adjusted return from your portfolio history, using a 3% risk-free rate. Higher is better; needs at least two days of recorded data." />
        </span>
        <span className="font-mono text-[17px] font-semibold text-primary max-bp480:text-[15px]">
          {sharpe == null ? "—" : NF(sharpe, 2)}
        </span>
      </div>

      <div className="h-px bg-subtle" />
      <div className="flex items-center justify-between">
        <span className={LABEL}>Updated {hero.updated}</span>
        <span className="flex items-center gap-1.5 text-[11px] text-secondary">
          <i className="size-1.5 rounded-full bg-gain animate-pulse-dot" />
          live
        </span>
      </div>
    </aside>
  );
}