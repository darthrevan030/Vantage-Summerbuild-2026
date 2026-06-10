"use client";

import { useState } from "react";
import { usePortfolio } from "@/context/portfolio";
import { Donut } from "@/components/charts/Donut";
import { Legend } from "@/components/charts/Legend";
import { Dumbbell } from "@/components/charts/Dumbbell";
import { Icon } from "@/components/Icon";
import { CountUp } from "@/components/landing/CountUp";
import { pct, ccyFmt, ccySigned } from "@/lib/formatters";
import { computeMovers, computeCurrencyCards } from "@/lib/portfolio";
import type { MoverItem } from "@/types/portfolio";

function MoverRow({ m, scale, open, onToggle }: { m: MoverItem; scale: number; open: boolean; onToggle: () => void }) {
  const total = m.asset + m.fx;
  const pos = total >= 0;
  return (
    <div className="border-b border-subtle last:border-b-0">
      <button className="grid w-full cursor-pointer grid-cols-[1.15fr_1.35fr_auto_16px] items-center gap-3 border-none border-l-2 border-l-transparent bg-transparent px-1 py-[11px] text-left font-ui transition-[background,border-color] duration-150 hover:border-l-gold hover:bg-elevated max-bp600:grid-cols-[1fr_1fr_auto_14px] max-bp600:gap-2 max-bp380:grid-cols-[1fr_auto_12px] max-bp380:gap-1.5" onClick={onToggle}>
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="overflow-hidden text-ellipsis whitespace-nowrap font-ui text-[13px] text-primary">{m.name}</span>
          <span className="font-mono text-[10.5px] tracking-[.05em] text-muted">{m.ticker}</span>
        </div>
        <Dumbbell asset={m.asset} fx={m.fx} scale={scale} />
        <span className="text-right font-mono text-[13.5px] font-semibold tabular-nums" style={{ color: pos ? "var(--gain)" : "var(--loss)" }}>{pct(total)}</span>
        <Icon name="chevron" size={14} className={open ? "rotate-180 text-muted transition-transform duration-200" : "text-muted transition-transform duration-200"} />
      </button>
      {open && (
        <div className="flex flex-col gap-[7px] rounded-b-[6px] border-t border-gold-soft bg-elevated px-3.5 pb-4 pt-3 animate-reveal">
          <div className="flex items-center justify-between gap-3 text-[12.5px]"><span className="font-ui text-secondary">Asset return</span><span className="font-mono text-[12.5px] tabular-nums text-primary" style={{ color: m.asset >= 0 ? "var(--gain)" : "var(--loss)" }}>{pct(m.asset)}</span></div>
          <div className="flex items-center justify-between gap-3 text-[12.5px]"><span className="font-ui text-secondary">FX effect</span><span className="font-mono text-[12.5px] tabular-nums text-primary" style={{ color: m.fx >= 0 ? "var(--fx-positive)" : "var(--fx-negative)" }}>{m.fx === 0 ? "—" : pct(m.fx)}</span></div>
          <div className="mt-[3px] flex items-center justify-between gap-3 border-t border-subtle pt-[7px] text-[12.5px]"><span className="font-ui font-semibold text-primary">Total return</span><span className="font-mono text-[12.5px] font-semibold tabular-nums text-primary" style={{ color: pos ? "var(--gain)" : "var(--loss)" }}>{pct(total)}</span></div>
          <div className="mt-1 font-ui text-[11.5px] text-muted">
            {m.fx > 0 ? "Currency tailwind boosted the asset return." : m.fx < 0 ? "Currency headwind partially offset the asset return." : "No FX exposure on this position."}
          </div>
        </div>
      )}
    </div>
  );
}

function MoverColumn({ title, list, tone }: { title: string; list: MoverItem[]; tone: "up" | "down" }) {
  const [openIdx, setOpenIdx] = useState<number | null>(null);
  const scale = Math.max(...list.map((m) => Math.abs(m.asset + m.fx)), 1);
  return (
    <div className="card min-w-0 px-5 py-4.5 max-bp768:overflow-hidden max-bp480:p-3.5 max-bp380:p-3">
      <div className="mb-2 flex items-baseline justify-between max-bp600:flex-wrap max-bp600:items-center max-bp600:gap-2">
        <span className="text-[13px] font-semibold tracking-[.01em] text-primary">{title}</span>
        <Icon name={tone} size={15} style={{ color: tone === "up" ? "var(--gain)" : "var(--loss)" }} />
      </div>
      <div className="flex flex-col">
        {list.map((m, i) => (
          <MoverRow key={i} m={m} scale={scale} open={openIdx === i} onToggle={() => setOpenIdx(openIdx === i ? null : i)} />
        ))}
      </div>
    </div>
  );
}

export default function OverviewPage() {
  const { hero, holdings, assetAllocation, geoAllocation, fmtSigned, toBase, baseCurrency } = usePortfolio();
  const { gainers, losers } = computeMovers(holdings);
  const ccyCards = computeCurrencyCards(holdings);
  const assetGain = hero.totalGain - hero.fxImpact;
  const acTop = assetAllocation[0];
  const geoTop = geoAllocation[0];

  return (
    <div className="flex w-full min-w-0 flex-col gap-[18px]">
      <div className="grid grid-cols-4 gap-3.5 animate-reveal max-bp1080:grid-cols-2 max-bp480:grid-cols-2">
        <div className="relative flex flex-col gap-[5px] rounded-[14px] border border-l-2 border-subtle border-l-gold bg-[linear-gradient(180deg,rgba(255,255,255,0.025),transparent_42%),var(--bg-surface)] px-[18px] py-4 shadow-[var(--card-shadow),-14px_0_36px_-28px_var(--accent-glow)] transition-[transform,border-color,box-shadow] duration-[260ms] ease-[cubic-bezier(.2,.7,.2,1)] hover:-translate-y-[3px] hover:border-[rgba(186,170,255,0.18)] hover:shadow-[0_22px_44px_-26px_rgba(0,0,0,0.9),-16px_0_40px_-26px_var(--accent-glow)] max-bp600:px-3.5 max-bp600:py-[13px] max-bp480:px-3 max-bp480:py-[11px]">
          <span className="text-[10.5px] font-semibold uppercase tracking-[.09em] text-muted">Total Value</span>
          <span className="font-mono text-[23px] font-semibold tracking-[-.01em] tabular-nums max-bp600:text-[19px] max-bp480:text-[17px] max-bp380:text-[15px]"><CountUp to={toBase(hero.total)} format={(v) => ccyFmt(v, baseCurrency)} startOnView={false} /></span>
          <span className="font-ui text-xs text-secondary">Personal wealth</span>
        </div>
        <div className="relative flex flex-col gap-[5px] rounded-[14px] border border-subtle bg-[linear-gradient(180deg,rgba(255,255,255,0.025),transparent_42%),var(--bg-surface)] px-[18px] py-4 shadow-card transition-[transform,border-color,box-shadow] duration-[260ms] ease-[cubic-bezier(.2,.7,.2,1)] hover:-translate-y-[3px] hover:border-[rgba(186,170,255,0.18)] hover:shadow-[0_22px_44px_-26px_rgba(0,0,0,0.9)] max-bp600:px-3.5 max-bp600:py-[13px] max-bp480:px-3 max-bp480:py-[11px]">
          <span className="text-[10.5px] font-semibold uppercase tracking-[.09em] text-muted">Total Gain</span>
          <span className="font-mono text-[23px] font-semibold tracking-[-.01em] tabular-nums max-bp600:text-[19px] max-bp480:text-[17px] max-bp380:text-[15px]" style={{ color: hero.totalGain >= 0 ? "var(--gain)" : "var(--loss)" }}><CountUp to={toBase(hero.totalGain)} format={(v) => ccySigned(v, baseCurrency)} startOnView={false} /></span>
          <span className="font-mono text-xs tabular-nums" style={{ color: hero.totalGain >= 0 ? "var(--gain)" : "var(--loss)" }}>{pct(hero.totalGainPct)}</span>
        </div>
        <div className="relative flex flex-col gap-[5px] rounded-[14px] border border-subtle bg-[linear-gradient(180deg,rgba(255,255,255,0.025),transparent_42%),var(--bg-surface)] px-[18px] py-4 shadow-card transition-[transform,border-color,box-shadow] duration-[260ms] ease-[cubic-bezier(.2,.7,.2,1)] hover:-translate-y-[3px] hover:border-[rgba(186,170,255,0.18)] hover:shadow-[0_22px_44px_-26px_rgba(0,0,0,0.9)] max-bp600:px-3.5 max-bp600:py-[13px] max-bp480:px-3 max-bp480:py-[11px]">
          <span className="text-[10.5px] font-semibold uppercase tracking-[.09em] text-muted">FX Impact</span>
          <span className="font-mono text-[23px] font-semibold tracking-[-.01em] tabular-nums max-bp600:text-[19px] max-bp480:text-[17px] max-bp380:text-[15px]" style={{ color: hero.fxImpact >= 0 ? "var(--fx-positive)" : "var(--fx-negative)" }}><CountUp to={toBase(hero.fxImpact)} format={(v) => ccySigned(v, baseCurrency)} startOnView={false} /></span>
          <span className="font-mono text-xs tabular-nums" style={{ color: hero.fxImpact >= 0 ? "var(--fx-positive)" : "var(--fx-negative)" }}>{pct(hero.fxPct)}</span>
        </div>
        <div className="relative flex flex-col gap-[5px] rounded-[14px] border border-subtle bg-[linear-gradient(180deg,rgba(255,255,255,0.025),transparent_42%),var(--bg-surface)] px-[18px] py-4 shadow-card transition-[transform,border-color,box-shadow] duration-[260ms] ease-[cubic-bezier(.2,.7,.2,1)] hover:-translate-y-[3px] hover:border-[rgba(186,170,255,0.18)] hover:shadow-[0_22px_44px_-26px_rgba(0,0,0,0.9)] max-bp600:px-3.5 max-bp600:py-[13px] max-bp480:px-3 max-bp480:py-[11px]">
          <span className="text-[10.5px] font-semibold uppercase tracking-[.09em] text-muted">Today</span>
          <span className="font-mono text-[23px] font-semibold tracking-[-.01em] tabular-nums max-bp600:text-[19px] max-bp480:text-[17px] max-bp380:text-[15px]" style={{ color: hero.dayChange >= 0 ? "var(--gain)" : "var(--loss)" }}><CountUp to={toBase(hero.dayChange)} format={(v) => ccySigned(v, baseCurrency)} startOnView={false} /></span>
          <span className="font-mono text-xs tabular-nums" style={{ color: hero.dayChange >= 0 ? "var(--gain)" : "var(--loss)" }}>{pct(hero.dayPct)}</span>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-[18px] animate-reveal max-bp1080:grid-cols-1 max-bp480:gap-3" style={{ animationDelay: ".05s" }}>
        <div className="card px-5 py-4.5 max-bp768:overflow-hidden max-bp480:p-3.5 max-bp380:p-3">
          <div className="mb-4 flex items-baseline justify-between max-bp600:flex-wrap max-bp600:items-center max-bp600:gap-2"><span className="text-[13px] font-semibold tracking-[.01em] text-primary">By Asset Class</span><span className="font-ui text-[11px] text-secondary">allocation</span></div>
          <div className="flex items-center gap-[22px] [&_svg]:[filter:drop-shadow(0_8px_22px_rgba(150,110,255,0.16))] max-bp600:flex-col max-bp600:items-center max-bp480:gap-3">
            <Donut data={assetAllocation} size={150} thickness={22}>
              {acTop && <div><div className="font-ui text-[11px] tracking-[.04em] text-secondary">{acTop.label}</div><div className="font-mono text-[22px] font-semibold tracking-[-.02em] tabular-nums">{acTop.value}%</div></div>}
            </Donut>
            <Legend data={assetAllocation} layout="column" />
          </div>
        </div>
        <div className="card px-5 py-4.5 max-bp768:overflow-hidden max-bp480:p-3.5 max-bp380:p-3">
          <div className="mb-4 flex items-baseline justify-between max-bp600:flex-wrap max-bp600:items-center max-bp600:gap-2"><span className="text-[13px] font-semibold tracking-[.01em] text-primary">By Geography</span><span className="font-ui text-[11px] text-secondary">exposure</span></div>
          <div className="flex items-center gap-[22px] [&_svg]:[filter:drop-shadow(0_8px_22px_rgba(150,110,255,0.16))] max-bp600:flex-col max-bp600:items-center max-bp480:gap-3">
            <Donut data={geoAllocation} size={150} thickness={22}>
              {geoTop && <div><div className="font-ui text-[11px] tracking-[.04em] text-secondary">{geoTop.label}</div><div className="font-mono text-[22px] font-semibold tracking-[-.02em] tabular-nums">{geoTop.value}%</div></div>}
            </Donut>
            <Legend data={geoAllocation} layout="column" />
          </div>
        </div>
      </div>

      <div className="card px-5 py-4.5 animate-reveal max-bp768:overflow-hidden max-bp480:p-3.5 max-bp380:p-3" style={{ animationDelay: ".1s" }}>
        <div className="mb-4 flex items-baseline justify-between max-bp600:flex-wrap max-bp600:items-center max-bp600:gap-2"><span className="text-[13px] font-semibold tracking-[.01em] text-primary">Return Attribution</span><span className="font-ui text-[11px] text-secondary">life-to-date · asset vs currency</span></div>
        <div className="flex flex-col gap-4">
          <div className="flex h-3.5 gap-0.5 overflow-hidden rounded-[7px]">
            <div className="h-full rounded-[3px]" style={{ flex: Math.max(assetGain, 0), background: "var(--gain)" }} />
            <div className="h-full rounded-[3px]" style={{ flex: Math.max(hero.fxImpact, 0), background: "var(--fx-positive)" }} />
          </div>
          <div className="flex flex-wrap gap-x-6 gap-y-2.5">
            <div className="flex items-start gap-[9px]"><i className="mt-1 size-2.5 rounded-[3px]" style={{ background: assetGain >= 0 ? "var(--gain)" : "var(--loss)" }} /><div><div className="font-ui text-[11px] tracking-[.04em] text-secondary">Asset gain</div><div className="mt-0.5 font-mono text-base font-semibold tabular-nums max-bp480:text-[14px]" style={{ color: assetGain >= 0 ? "var(--gain)" : "var(--loss)" }}>{fmtSigned(assetGain)}</div></div></div>
            <div className="flex items-start gap-[9px]"><i className="mt-1 size-2.5 rounded-[3px]" style={{ background: "var(--fx-positive)" }} /><div><div className="font-ui text-[11px] tracking-[.04em] text-secondary">FX gain</div><div className="mt-0.5 font-mono text-base font-semibold tabular-nums max-bp480:text-[14px]" style={{ color: hero.fxImpact >= 0 ? "var(--fx-positive)" : "var(--fx-negative)" }}>{fmtSigned(hero.fxImpact)}</div></div></div>
            <div className="ml-auto flex items-start gap-[9px]"><div><div className="font-ui text-[11px] tracking-[.04em] text-secondary">Total gain</div><div className="mt-0.5 font-mono text-base font-semibold tabular-nums max-bp480:text-[14px]">{fmtSigned(hero.totalGain)} <span style={{ color: hero.totalGain >= 0 ? "var(--gain)" : "var(--loss)" }}>{pct(hero.totalGainPct)}</span></div></div></div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-[18px] animate-reveal max-bp1080:grid-cols-1 max-bp480:gap-3" style={{ animationDelay: ".15s" }}>
        <MoverColumn title="Top Gainers" list={gainers} tone="up" />
        <MoverColumn title="Top Losers" list={losers} tone="down" />
      </div>

      {ccyCards.length > 0 && (
        <div className="card px-5 py-4.5 animate-reveal max-bp768:overflow-hidden max-bp480:p-3.5 max-bp380:p-3" style={{ animationDelay: ".2s" }}>
          <div className="mb-4 flex items-baseline justify-between max-bp600:flex-wrap max-bp600:items-center max-bp600:gap-2"><span className="text-[13px] font-semibold tracking-[.01em] text-primary">Currency Impact</span><span className="font-ui text-[11px] text-secondary">FX P&amp;L by exposure</span></div>
          <div className="flex flex-wrap gap-2.5">
            {ccyCards.map((c) => (
              <div className="flex items-center gap-[9px] rounded-[11px] border border-subtle bg-elevated px-3.5 py-[9px] max-bp480:px-2.5 max-bp480:py-[7px]" key={c.code}>
                <span className="font-flag text-[15px] max-bp480:text-[13px]">{c.flag}</span>
                <span className="font-mono text-xs text-secondary">{c.code}</span>
                <span className="font-mono text-[13px] font-semibold tabular-nums" style={{ color: c.impact >= 0 ? "var(--fx-positive)" : "var(--fx-negative)" }}>{fmtSigned(c.impact)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
