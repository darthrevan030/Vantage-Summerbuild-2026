"use client";

import { useMemo, useState } from "react";
import { usePortfolio } from "@/context/portfolio";
import { Donut } from "@/components/charts/Donut";
import { Legend } from "@/components/charts/Legend";
import { AreaTrend } from "@/components/charts/AreaTrend";
import { FXArea } from "@/components/charts/FXArea";
import { pct } from "@/lib/formatters";
import { useDateRange, RANGES, RANGES_DAILY } from "@/lib/useDateRange";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/Toast";

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
    <div className="chart-range-row">
      <div className="rsel">
        {ranges.map(([lab, n], i) => (
          <button
            key={lab}
            className={"rseg" + (i === activePreset ? " active" : "")}
            onClick={() => onPreset(n)}
          >
            {lab}
          </button>
        ))}
        <button
          className={"rseg rseg-custom" + (showCustom ? " active" : "")}
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
  const { toast } = useToast();
  const [backfilling, setBackfilling] = useState(false);

  const handleBackfill = async () => {
    setBackfilling(true);
    try {
      const r = await fetch("/api/holdings/backfill", { method: "POST" });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "Backfill failed");
      toast(`Loaded ${j.inserted} historical snapshot${j.inserted !== 1 ? "s" : ""}`);
      router.refresh();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Backfill failed", "error");
    } finally {
      setBackfilling(false);
    }
  };

  const seriesLabels = useMemo(
    () => portfolioSeriesDaily.map((p) => p.date),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [portfolioSeriesDaily.length]
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
    <div className="card chart-card reveal" style={{ animationDelay: ".04s" }}>
      <div className="card-head"><span className="card-title">Portfolio Value Over Time</span></div>
      <div className="ui muted" style={{ padding: "32px 0", textAlign: "center" }}>
        Add holdings to see portfolio value over time.
      </div>
    </div>
  );
  const chg    = last.v - first.v;
  const chgPct = first.v > 0 ? (chg / first.v) * 100 : 0;
  const pos    = chg >= 0;

  return (
    <div className="card chart-card reveal" style={{ animationDelay: ".04s" }}>
      <div className="card-head">
        <span className="card-title">Portfolio Value Over Time</span>
        {(() => {
          const today = new Date().toISOString().slice(0, 10);
          const latest = portfolioSeriesDaily[portfolioSeriesDaily.length - 1]?.date ?? "";
          const needsSync = portfolioSeriesDaily.length < 30 || latest < today;
          if (!needsSync) return null;
          const label = portfolioSeriesDaily.length < 30 ? "Load history" : "Sync to today";
          return (
            <button className="icon-btn ghost sm" onClick={handleBackfill} disabled={backfilling}>
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
        <div className="date-range-row">
          <div className="date-field">
            <label className="date-label ui muted xs">From</label>
            <input type="month" className="date-inp mono" value={startDate.slice(0, 7)} onChange={(e) => handleStartChange(e.target.value)} />
          </div>
          <span className="date-sep ui muted">—</span>
          <div className="date-field">
            <label className="date-label ui muted xs">To</label>
            <input type="month" className="date-inp mono" value={endDate.slice(0, 7)} onChange={(e) => handleEndChange(e.target.value)} />
          </div>
          <button className="date-reset ui muted" onClick={() => selectPreset(999)}>Reset</button>
        </div>
      )}
      <div className="trend-meta">
        <span className="ui muted xs">{first.label} – {last.label}</span>
        <span className="mono xs" style={{ color: pos ? "var(--gain)" : "var(--loss)" }}>
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
    <div className="perf">
      {rows.map((r, i) => {
        const pos = r.pct >= 0;
        const w   = (Math.abs(r.pct) / max) * 100;
        return (
          <div className="perf-row" key={i}>
            <span className="ui perf-name">{r.name}</span>
            <div className="perf-track">
              <div
                className="perf-bar"
                style={{ width: w + "%", background: pos ? "var(--gain)" : "var(--loss)" }}
              />
            </div>
            <span
              className="mono perf-pct"
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
    startDate, endDate, minDate, maxDate,
    activePreset, showCustom,
    selectPreset, handleStartChange, handleEndChange, toggleCustom,
  } = useDateRange(fxLabels);

  const fxKeys = Object.keys(fxColors);

  const { filteredSeries, filteredLabels } = useMemo(() => {
    const si = fxLabels.findIndex((l) => l >= startDate);
    const eiRev = [...fxLabels].reverse().findIndex((l) => l <= endDate);
    const ei = eiRev < 0 ? -1 : fxLabels.length - 1 - eiRev;
    if (si < 0 || ei < 0 || si > ei) return { filteredSeries: fxSeries, filteredLabels: fxLabels };
    const slicedSeries = fxSeries.slice(si, ei + 1);
    const slicedLabels = fxLabels.slice(si, ei + 1);
    if (slicedSeries.length < 2) return { filteredSeries: fxSeries, filteredLabels: fxLabels };
    return { filteredSeries: slicedSeries, filteredLabels: slicedLabels };
  }, [fxSeries, fxLabels, startDate, endDate]);

  return (
    <div className="card chart-card reveal" style={{ animationDelay: ".19s" }}>
      <div className="card-head">
        <div>
          <span className="card-title">FX Impact Over Time</span>
          <span className="ui muted xs" style={{ display: "block", marginTop: 2 }}>
            cumulative · {baseCurrency}
          </span>
        </div>
      </div>

      {fxSeries.length > 0 ? (
        <>
          <RangeBar
            ranges={RANGES}
            activePreset={activePreset}
            showCustom={showCustom}
            onPreset={selectPreset}
            onCustomToggle={toggleCustom}
          />
          {showCustom && (
            <div className="date-range-row">
              <div className="date-field">
                <label className="date-label ui muted xs">From</label>
                <input type="month" className="date-inp mono" value={startDate} onChange={(e) => handleStartChange(e.target.value)} />
              </div>
              <span className="date-sep ui muted">—</span>
              <div className="date-field">
                <label className="date-label ui muted xs">To</label>
                <input type="month" className="date-inp mono" value={endDate} onChange={(e) => handleEndChange(e.target.value)} />
              </div>
              <button className="date-reset ui muted" onClick={() => selectPreset(999)}>Reset</button>
            </div>
          )}
          <FXArea key={startDate + endDate} data={filteredSeries} colors={fxColors} keys={fxKeys} labels={filteredLabels} height={210} valFmt={fmtSigned} />
          <div className="fx-legend">
            {fxKeys.map((k) => (
              <span key={k}>
                <i style={{ background: fxColors[k] }} />
                <span className="ui">{k.toUpperCase()}</span>
              </span>
            ))}
          </div>
        </>
      ) : (
        <div className="ui muted" style={{ padding: "32px 0", textAlign: "center" }}>
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
    <div className="tab-body">
      <div className="charts-grid">
        <PortfolioTrend />

        <div className="card chart-card reveal" style={{ animationDelay: ".09s" }}>
          <div className="card-head">
            <span className="card-title">Asset Allocation</span>
            <span className="ui muted">click to isolate</span>
          </div>
          <div className="donut-block lg">
            <Donut
              data={assetAllocation}
              size={190}
              thickness={30}
              highlight={hl}
              onSlice={(i) => setHl(i === hl ? -1 : i)}
            >
              <div>
                <div className="ui muted xs">{hl >= 0 ? assetAllocation[hl]?.label : "Total"}</div>
                <div className="mono donut-pct">
                  {hl >= 0 ? assetAllocation[hl]?.value + "%" : fmtVal(hero.total)}
                </div>
              </div>
            </Donut>
            <Legend
              data={assetAllocation}
              highlight={hl}
              onItem={(i) => setHl(i === hl ? -1 : i)}
            />
          </div>
        </div>

        <div className="card chart-card reveal" style={{ animationDelay: ".14s" }}>
          <div className="card-head">
            <span className="card-title">Per-Asset Performance</span>
            <span className="ui muted">total return %</span>
          </div>
          <PerfBars />
        </div>

        <FXImpactCard />
      </div>
    </div>
  );
}
