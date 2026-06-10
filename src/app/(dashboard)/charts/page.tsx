"use client";

import { useMemo, useState } from "react";
import { usePortfolio } from "@/context/portfolio";
import { Donut } from "@/components/charts/Donut";
import { Legend } from "@/components/charts/Legend";
import { AreaTrend } from "@/components/charts/AreaTrend";
import { FXArea } from "@/components/charts/FXArea";
import { pct } from "@/lib/formatters";
import { useDateRange, RANGES_DAILY } from "@/lib/useDateRange";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

function RangeBar({
  ranges,
  activePreset,
  showCustom,
  onPreset,
  onCustomToggle,
}: {
  ranges: [string, number][];
  activePreset: number;
  showCustom: boolean;
  onPreset: (n: number) => void;
  onCustomToggle: () => void;
}) {
  return (
    <div className="flex justify-end mb-2.5">
      <div className="flex gap-0.5 p-[3px] bg-elevated border border-subtle rounded-[9px] max-bp600:flex-wrap max-bp600:justify-center">
        {ranges.map(([lab, n], i) => (
          <button
            key={lab}
            className={
              "font-ui text-[11.5px] font-medium border-none rounded-md px-[11px] py-[5px] cursor-pointer transition-[color,background] duration-150 " +
              (i === activePreset
                ? "text-gold bg-wash shadow-[inset_0_0_0_1px_var(--border-gold)]"
                : "text-secondary hover:text-primary")
            }
            onClick={() => onPreset(n)}
          >
            {lab}
          </button>
        ))}
        <button
          className={
            "font-ui text-[11.5px] font-medium border-none rounded-md px-[11px] py-[5px] cursor-pointer transition-[color,background] duration-150 border-l border-subtle ml-0.5 pl-2.5 " +
            (showCustom
              ? "text-gold bg-wash shadow-[inset_0_0_0_1px_var(--border-gold)]"
              : "text-secondary hover:text-primary")
          }
          onClick={onCustomToggle}
        >
          Custom
        </button>
      </div>
    </div>
  );
}

function PortfolioTrend() {
  const { portfolioSeriesDaily, fmtVal, fmtSigned } = usePortfolio();
  const router = useRouter();
  const [backfilling, setBackfilling] = useState(false);

  const handleBackfill = async () => {
    setBackfilling(true);
    try {
      const r = await fetch("/api/holdings/backfill", { method: "POST" });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "Backfill failed");
      toast.success(`Loaded ${j.inserted} historical snapshot${j.inserted !== 1 ? "s" : ""}`);
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Backfill failed");
    } finally {
      setBackfilling(false);
    }
  };

  const seriesLabels = useMemo(
    () => portfolioSeriesDaily.map((p) => p.date),
    [portfolioSeriesDaily]
  );

  const {
    startDate, endDate,
    activePreset, showCustom,
    selectPreset, handleStartChange, handleEndChange, toggleCustom,
  } = useDateRange(seriesLabels, RANGES_DAILY);

  const data = useMemo(() => {
    // Normalise a YYYY-MM endDate to end-of-month so it includes all daily points in that month
    const endCmp = endDate.length === 7 ? endDate + "-31" : endDate;
    const si = seriesLabels.findIndex((l) => l >= startDate);
    const ei = [...seriesLabels].reverse().findIndex((l) => l <= endCmp);
    const eiActual = ei < 0 ? -1 : seriesLabels.length - 1 - ei;
    if (si < 0 || eiActual < 0 || si > eiActual) return portfolioSeriesDaily;
    const slice = portfolioSeriesDaily.slice(si, eiActual + 1);
    if (slice.length < 2) return portfolioSeriesDaily;
    return slice;
  }, [portfolioSeriesDaily, seriesLabels, startDate, endDate]);

  const first = data[0];
  const last  = data[data.length - 1];
  if (!first || !last) return (
    <div className="card flex flex-col min-h-[300px] px-5 py-4.5 animate-reveal max-bp768:overflow-hidden max-bp600:min-h-0 max-bp480:p-3.5 max-bp380:p-3" style={{ animationDelay: ".04s" }}>
      <div className="flex items-baseline justify-between mb-4"><span className="text-[13px] font-semibold text-primary tracking-[.01em]">Portfolio Value Over Time</span></div>
      <div className="font-ui text-secondary" style={{ padding: "32px 0", textAlign: "center" }}>
        Add holdings to see portfolio value over time.
      </div>
    </div>
  );
  const chg    = last.v - first.v;
  const chgPct = first.v > 0 ? (chg / first.v) * 100 : 0;
  const pos    = chg >= 0;

  return (
    <div className="card flex flex-col min-h-[300px] px-5 py-4.5 animate-reveal max-bp768:overflow-hidden max-bp600:min-h-0 max-bp480:p-3.5 max-bp380:p-3" style={{ animationDelay: ".04s" }}>
      <div className="flex items-baseline justify-between mb-4">
        <span className="text-[13px] font-semibold text-primary tracking-[.01em]">Portfolio Value Over Time</span>
        {(() => {
          const today = new Date().toISOString().slice(0, 10);
          const latest = portfolioSeriesDaily[portfolioSeriesDaily.length - 1]?.date ?? "";
          const needsSync = portfolioSeriesDaily.length < 30 || latest < today;
          if (!needsSync) return null;
          const label = portfolioSeriesDaily.length < 30 ? "Load history" : "Sync to today";
          return (
            <button className="flex items-center gap-[7px] cursor-pointer rounded-[9px] border border-subtle bg-surface px-2.5 py-1.5 font-ui text-[11.5px] text-secondary transition-all duration-150 hover:border-gold-soft hover:text-gold disabled:cursor-not-allowed disabled:opacity-50" onClick={handleBackfill} disabled={backfilling}>
              {backfilling ? "Loading…" : label}
            </button>
          );
        })()}
      </div>
      <RangeBar
        ranges={RANGES_DAILY}
        activePreset={activePreset}
        showCustom={showCustom}
        onPreset={selectPreset}
        onCustomToggle={toggleCustom}
      />
      {showCustom && (
        <div className="flex items-center gap-3 mb-2.5 flex-wrap">
          <div className="flex flex-col gap-[3px]">
            <label className="font-ui text-secondary text-[10px] uppercase tracking-[.07em]">From</label>
            <input type="month" className="font-mono bg-elevated border border-subtle rounded-[8px] px-2.5 py-[7px] text-primary text-xs outline-none transition-[border-color] duration-150 cursor-pointer focus:border-gold-soft" value={startDate.slice(0, 7)} onChange={(e) => handleStartChange(e.target.value)} />
          </div>
          <span className="font-ui text-secondary text-base mt-4">—</span>
          <div className="flex flex-col gap-[3px]">
            <label className="font-ui text-secondary text-[10px] uppercase tracking-[.07em]">To</label>
            <input type="month" className="font-mono bg-elevated border border-subtle rounded-[8px] px-2.5 py-[7px] text-primary text-xs outline-none transition-[border-color] duration-150 cursor-pointer focus:border-gold-soft" value={endDate.slice(0, 7)} onChange={(e) => handleEndChange(e.target.value)} />
          </div>
          <button className="font-ui text-muted bg-transparent border-none text-xs cursor-pointer px-2 py-1.5 rounded-[7px] transition-[color,background] duration-150 mt-3 hover:text-gold hover:bg-wash" onClick={() => selectPreset(999)}>Reset</button>
        </div>
      )}
      <div className="flex items-center justify-between mt-[-6px] mb-2 max-bp600:flex-col max-bp600:items-start max-bp600:gap-0.5">
        <span className="font-ui text-secondary text-[11px] tracking-[.04em]">{first.label} – {last.label}</span>
        <span className="font-mono text-[11px] tracking-[.04em]" style={{ color: pos ? "var(--gain)" : "var(--loss)" }}>
          {fmtSigned(chg)} ({pct(chgPct)})
        </span>
      </div>
      <AreaTrend key={startDate + endDate} data={data} color="var(--gold)" height={220} valFmt={(v) => fmtVal(v)} />
    </div>
  );
}

function PerfBars() {
  const { holdings } = usePortfolio();
  const rows = [...holdings]
    .map((h) => ({ name: h.name, ticker: h.ticker, pct: h.totalPct }))
    .sort((a, b) => b.pct - a.pct);
  const max = Math.max(...rows.map((r) => Math.abs(r.pct)), 1);

  return (
    <div className="flex flex-col gap-3.5 pt-1.5">
      {rows.map((r, i) => {
        const pos = r.pct >= 0;
        const w   = (Math.abs(r.pct) / max) * 100;
        return (
          <div className="grid grid-cols-[130px_1fr_62px] items-center gap-3.5 max-bp768:grid-cols-[100px_1fr_54px] max-bp768:gap-2.5 max-bp480:grid-cols-[76px_1fr_46px] max-bp480:gap-1.5" key={i}>
            <span className="font-ui text-xs text-secondary whitespace-nowrap overflow-hidden text-ellipsis max-bp768:text-[11px] max-bp480:text-[10.5px]">{r.name}</span>
            <div className="h-3 bg-elevated rounded-md overflow-hidden">
              <div
                className="h-full rounded-md transition-[width] duration-[600ms] ease-[ease]"
                style={{ width: w + "%", background: pos ? "var(--gain)" : "var(--loss)" }}
              />
            </div>
            <span
              className="font-mono text-[13px] font-semibold text-right"
              style={{ color: pos ? "var(--gain)" : "var(--loss)" }}
            >
              {pct(r.pct)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function FXImpactCard() {
  const { fxSeries, fxColors, fxLabels, baseCurrency, fmtSigned } = usePortfolio();

  const {
    startDate, endDate,
    activePreset, showCustom,
    selectPreset, handleStartChange, handleEndChange, toggleCustom,
  } = useDateRange(fxLabels, RANGES_DAILY);

  const fxKeys = Object.keys(fxColors);

  const { filteredSeries, filteredLabels } = useMemo(() => {
    // Normalise a YYYY-MM endDate to end-of-month so it includes all daily points in that month
    const endCmp = endDate.length === 7 ? endDate + "-31" : endDate;
    const si = fxLabels.findIndex((l) => l >= startDate);
    const eiRev = [...fxLabels].reverse().findIndex((l) => l <= endCmp);
    const ei = eiRev < 0 ? -1 : fxLabels.length - 1 - eiRev;
    if (si < 0 || ei < 0 || si > ei) return { filteredSeries: fxSeries, filteredLabels: fxLabels };
    const slicedSeries = fxSeries.slice(si, ei + 1);
    const slicedLabels = fxLabels.slice(si, ei + 1);
    if (slicedSeries.length < 2) return { filteredSeries: fxSeries, filteredLabels: fxLabels };
    return { filteredSeries: slicedSeries, filteredLabels: slicedLabels };
  }, [fxSeries, fxLabels, startDate, endDate]);

  return (
    <div className="card flex flex-col min-h-[300px] px-5 py-4.5 animate-reveal max-bp768:overflow-hidden max-bp600:min-h-0 max-bp480:p-3.5 max-bp380:p-3" style={{ animationDelay: ".19s" }}>
      <div className="flex items-baseline justify-between mb-4">
        <div>
          <span className="text-[13px] font-semibold text-primary tracking-[.01em]">FX Impact Over Time</span>
          <span className="font-ui text-secondary text-[11px] tracking-[.04em]" style={{ display: "block", marginTop: 2 }}>
            cumulative · {baseCurrency}
          </span>
        </div>
      </div>

      {fxSeries.length > 0 ? (
        <>
          <RangeBar
            ranges={RANGES_DAILY}
            activePreset={activePreset}
            showCustom={showCustom}
            onPreset={selectPreset}
            onCustomToggle={toggleCustom}
          />
          {showCustom && (
            <div className="flex items-center gap-3 mb-2.5 flex-wrap">
              <div className="flex flex-col gap-[3px]">
                <label className="font-ui text-secondary text-[10px] uppercase tracking-[.07em]">From</label>
                <input type="month" className="font-mono bg-elevated border border-subtle rounded-[8px] px-2.5 py-[7px] text-primary text-xs outline-none transition-[border-color] duration-150 cursor-pointer focus:border-gold-soft" value={startDate.slice(0, 7)} onChange={(e) => handleStartChange(e.target.value)} />
              </div>
              <span className="font-ui text-secondary text-base mt-4">—</span>
              <div className="flex flex-col gap-[3px]">
                <label className="font-ui text-secondary text-[10px] uppercase tracking-[.07em]">To</label>
                <input type="month" className="font-mono bg-elevated border border-subtle rounded-[8px] px-2.5 py-[7px] text-primary text-xs outline-none transition-[border-color] duration-150 cursor-pointer focus:border-gold-soft" value={endDate.slice(0, 7)} onChange={(e) => handleEndChange(e.target.value)} />
              </div>
              <button className="font-ui text-muted bg-transparent border-none text-xs cursor-pointer px-2 py-1.5 rounded-[7px] transition-[color,background] duration-150 mt-3 hover:text-gold hover:bg-wash" onClick={() => selectPreset(999)}>Reset</button>
            </div>
          )}
          <FXArea key={startDate + endDate} data={filteredSeries} colors={fxColors} keys={fxKeys} labels={filteredLabels} height={210} valFmt={fmtSigned} />
          <div className="flex gap-[18px] justify-center mt-2.5">
            {fxKeys.map((k) => (
              <span key={k} className="flex items-center gap-1.5 text-xs text-secondary">
                <i className="size-[9px] rounded-[2px]" style={{ background: fxColors[k] }} />
                <span className="font-ui">{k.toUpperCase()}</span>
              </span>
            ))}
          </div>
        </>
      ) : (
        <div className="font-ui text-secondary" style={{ padding: "32px 0", textAlign: "center" }}>
          Add foreign-currency holdings to see FX impact over time.
        </div>
      )}
    </div>
  );
}

export default function ChartsPage() {
  const { hero, assetAllocation, fmtVal } = usePortfolio();
  const [hl, setHl] = useState(-1);

  return (
    <div className="flex w-full min-w-0 flex-col gap-[18px]">
      <div className="grid grid-cols-2 gap-[18px] max-bp1080:grid-cols-1 max-bp768:w-full">
        <PortfolioTrend />

        <div className="card flex flex-col min-h-[300px] px-5 py-4.5 animate-reveal max-bp768:overflow-hidden max-bp600:min-h-0 max-bp480:p-3.5 max-bp380:p-3" style={{ animationDelay: ".09s" }}>
          <div className="flex items-baseline justify-between mb-4">
            <span className="text-[13px] font-semibold text-primary tracking-[.01em]">Asset Allocation</span>
            <span className="font-ui text-secondary text-[11px]">click to isolate</span>
          </div>
          <div className="flex flex-col items-center gap-[18px] [&_svg]:[filter:drop-shadow(0_8px_22px_rgba(150,110,255,0.16))]">
            <Donut
              data={assetAllocation}
              size={190}
              thickness={30}
              highlight={hl}
              onSlice={(i) => setHl(i === hl ? -1 : i)}
            >
              <div>
                <div className="font-ui text-secondary text-[11px] tracking-[.04em]">{hl >= 0 ? assetAllocation[hl]?.label : "Total"}</div>
                <div className="font-mono text-[22px] font-semibold tracking-[-.02em]">
                  {hl >= 0 ? assetAllocation[hl]?.value + "%" : fmtVal(hero.total)}
                </div>
              </div>
            </Donut>
            <Legend
              data={assetAllocation}
              highlight={hl}
              onItem={(i) => setHl(i === hl ? -1 : i)}
              layout="rowCenter"
            />
          </div>
        </div>

        <div className="card flex flex-col min-h-[300px] px-5 py-4.5 animate-reveal max-bp768:overflow-hidden max-bp600:min-h-0 max-bp480:p-3.5 max-bp380:p-3" style={{ animationDelay: ".14s" }}>
          <div className="flex items-baseline justify-between mb-4">
            <span className="text-[13px] font-semibold text-primary tracking-[.01em]">Per-Asset Performance</span>
            <span className="font-ui text-secondary text-[11px]">total return %</span>
          </div>
          <PerfBars />
        </div>

        <FXImpactCard />
      </div>
    </div>
  );
}
