"use client";

import { usePortfolio } from "@/context/portfolio";
import { Icon } from "@/components/Icon";
import { Spark } from "@/components/charts/Spark";
import { useCountUp } from "@/lib/useCountUp";
import { pct, rate } from "@/lib/formatters";
import { useFxSparks } from "@/hooks/useFxSparks";
import type { CurrencyCard, WaterfallItem } from "@/types/portfolio";

function CcyCard({
  c,
  delay,
  sparkOverride,
}: {
  c: CurrencyCard;
  delay: string;
  sparkOverride?: number[];
}) {
  const { fmtVal, fmtSigned } = usePortfolio();
  const pos = c.impact >= 0;
  const col = pos ? "var(--fx-positive)" : "var(--fx-negative)";
  const sparkPts =
    sparkOverride && sparkOverride.length >= 2 ? sparkOverride : c.spark;
  return (
    <div
      className="card p-[18px] animate-reveal"
      style={{ animationDelay: delay }}
    >
      <div className="flex items-center justify-between mb-4">
        <span className="flex items-center gap-2.5">
          <span className="font-flag text-[20px]">{c.flag}</span>
          <span className="font-mono text-[15px] font-semibold">{c.code}</span>
        </span>
        <span
          className="font-mono text-[13px] font-semibold"
          style={{ color: col }}
        >
          {pos ? "▲" : "▼"} {pct(Math.abs(c.deltaPct))}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-3.5 mb-4">
        <div>
          <div className="font-ui text-secondary text-[11px] tracking-[.04em]">
            Exposure
          </div>
          <div className="font-mono text-[15px] font-semibold my-0.5">
            {fmtVal(c.exposure)}
          </div>
          <div className="font-ui text-secondary text-[11px] tracking-[.04em]">
            {c.exposurePct.toFixed(1)}% of book
          </div>
        </div>
        <div>
          <div className="font-ui text-secondary text-[11px] tracking-[.04em]">
            Avg / Current
          </div>
          <div className="font-mono text-[15px] font-semibold my-0.5">
            {rate(c.avg)} → {rate(c.cur)}
          </div>
          <div className="font-ui text-secondary text-[11px] tracking-[.04em]">
            SGD per {c.code}
          </div>
        </div>
      </div>
      <div className="flex items-end justify-between gap-3 pt-3.5 border-t border-subtle max-bp600:flex-col max-bp600:gap-2">
        <div>
          <div className="font-ui text-secondary text-[11px] tracking-[.04em]">
            FX Impact
          </div>
          <div
            className="font-mono text-[19px] font-semibold mt-0.5 max-bp480:text-[16px]"
            style={{ color: col }}
          >
            {fmtSigned(c.impact)}
          </div>
        </div>
        <div>
          {sparkPts.length > 0 && (
            <Spark pts={sparkPts} color={col} w={132} h={40} />
          )}
        </div>
      </div>
    </div>
  );
}

function Waterfall({
  items,
  netImpact,
  netPct,
}: {
  items: WaterfallItem[];
  netImpact: number;
  netPct: number;
}) {
  const { fmtSigned, baseCurrency } = usePortfolio();
  const max = Math.max(...items.map((i) => Math.abs(i.value)), 1);
  return (
    <div
      className="card px-5 py-4.5 max-bp768:overflow-hidden max-bp480:p-3.5 max-bp380:p-3 animate-reveal"
      style={{ animationDelay: ".28s" }}
    >
      <div className="flex items-baseline justify-between mb-4 max-bp600:flex-wrap max-bp600:gap-2 max-bp600:items-center">
        <span className="text-[13px] font-semibold text-primary tracking-[.01em]">
          Currency Contribution to Portfolio
        </span>
        <span className="font-ui text-secondary text-[11px]">
          {baseCurrency}
        </span>
      </div>
      <div className="flex flex-col gap-3">
        {items.map((it) => {
          const pos = it.value >= 0;
          const w = (Math.abs(it.value) / max) * 50;
          return (
            <div
              className="grid grid-cols-[48px_1fr_110px] items-center gap-3.5 max-bp600:grid-cols-[40px_1fr_88px] max-bp600:gap-2 max-bp380:grid-cols-[36px_1fr_80px] max-bp380:gap-1.5"
              key={it.code}
            >
              <span className="font-mono text-[13px] font-semibold text-secondary">
                {it.code}
              </span>
              <div className="relative h-4">
                <div className="absolute left-1/2 top-[-3px] bottom-[-3px] w-px bg-muted" />
                <div
                  className="absolute top-0 h-full rounded-[4px]"
                  style={{
                    [pos ? "left" : "right"]: "50%",
                    width: w + "%",
                    background: pos
                      ? "var(--fx-positive)"
                      : "var(--fx-negative)",
                  }}
                />
              </div>
              <span
                className="font-mono text-[13px] font-semibold text-right max-bp600:text-[12px]"
                style={{
                  color: pos ? "var(--fx-positive)" : "var(--fx-negative)",
                }}
              >
                {fmtSigned(it.value)}
              </span>
            </div>
          );
        })}
        <div className="flex items-center justify-between mt-1.5 pt-3.5 border-t border-subtle text-[14px]">
          <span className="font-ui text-secondary">Net FX effect</span>
          <span
            className="font-mono font-semibold text-[15px]"
            style={{
              color:
                netImpact >= 0 ? "var(--fx-positive)" : "var(--fx-negative)",
            }}
          >
            {fmtSigned(netImpact)}{" "}
            <span className="text-secondary">({pct(netPct)})</span>
          </span>
        </div>
      </div>
    </div>
  );
}

export default function FXLabPage() {
  const { hero, currencyCards, waterfallData, fmtVal } = usePortfolio();
  const actual = useCountUp(hero.total, 1100);
  const neutral = useCountUp(hero.neutral, 1100);
  const fxSparks = useFxSparks(currencyCards.map((c) => c.code));

  if (currencyCards.length === 0) {
    return (
      <div className="flex flex-col gap-[18px] min-w-0 w-full max-bp768:box-border">
        <div className="card px-5 py-4.5 max-bp768:overflow-hidden max-bp480:p-3.5 max-bp380:p-3">
          <div className="flex items-baseline justify-between mb-4 max-bp600:flex-wrap max-bp600:gap-2 max-bp600:items-center">
            <span className="text-[13px] font-semibold text-primary tracking-[.01em]">
              FX Lab
            </span>
            <span className="font-ui text-secondary text-[11px]">
              No foreign-currency holdings found
            </span>
          </div>
          <p className="font-ui text-secondary" style={{ padding: "20px 0" }}>
            Add holdings in USD, EUR, AUD, or other foreign currencies to see FX
            analysis here.
          </p>
        </div>
      </div>
    );
  }

  const verdictPositive = hero.fxImpact >= 0;

  return (
    <div className="flex flex-col gap-[18px] min-w-0 w-full max-bp768:box-border">
      {/* versus banner */}
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-5 bg-surface border border-subtle rounded-[16px] px-8 py-7 relative animate-reveal max-bp600:grid-cols-1 max-bp600:gap-3 max-bp600:px-5 max-bp600:py-[22px] max-bp600:text-center">
        <div>
          <div className="font-ui text-secondary text-[11px] uppercase tracking-[.1em] mb-2">
            Actual Portfolio
          </div>
          <div className="font-serif text-[40px] leading-none tracking-[-.01em] max-bp900:text-[32px] max-bp600:text-[26px] max-bp480:text-[22px]">
            {fmtVal(actual)}
          </div>
        </div>
        <div className="grid place-items-center max-bp600:hidden">
          <div className="w-[42px] h-[42px] rounded-full border border-subtle grid place-items-center text-muted text-[13px] italic font-ui">
            vs
          </div>
        </div>
        <div className="text-right max-bp600:text-center">
          <div className="font-ui text-secondary text-[11px] uppercase tracking-[.1em] mb-2">
            FX-Neutral Portfolio
          </div>
          <div className="font-serif text-[40px] leading-none tracking-[-.01em] text-muted max-bp900:text-[32px] max-bp600:text-[26px] max-bp480:text-[22px]">
            {fmtVal(neutral)}
          </div>
        </div>
        <div className="col-span-full flex items-center justify-center gap-2.5 mt-[18px] pt-[18px] border-t border-subtle text-[14px] text-secondary max-bp600:flex-col max-bp600:gap-1.5 max-bp600:text-center">
          <Icon
            name={verdictPositive ? "up" : "down"}
            size={16}
            style={{
              color: verdictPositive
                ? "var(--fx-positive)"
                : "var(--fx-negative)",
            }}
          />
          <span className="font-ui">
            Currency has {verdictPositive ? "added" : "cost"}{" "}
            <b
              className="font-mono font-semibold"
              style={{
                color: verdictPositive
                  ? "var(--fx-positive)"
                  : "var(--fx-negative)",
              }}
            >
              {fmtVal(Math.abs(hero.fxImpact))}
            </b>{" "}
            <span
              className="font-mono"
              style={{
                color: verdictPositive
                  ? "var(--fx-positive)"
                  : "var(--fx-negative)",
              }}
            >
              ({pct(hero.fxPct)})
            </span>{" "}
            to your returns
          </span>
        </div>
      </div>

      {/* currency cards grid */}
      <div className="grid grid-cols-2 gap-4 max-bp1080:grid-cols-1">
        {currencyCards.map((c, i) => (
          <CcyCard
            key={c.code}
            c={c}
            delay={0.06 + i * 0.05 + "s"}
            sparkOverride={fxSparks[c.code]}
          />
        ))}
      </div>

      <Waterfall
        items={waterfallData}
        netImpact={hero.fxImpact}
        netPct={hero.fxPct}
      />
    </div>
  );
}