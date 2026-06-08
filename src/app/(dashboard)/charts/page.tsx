"use client";

import { useMemo, useState } from "react";
import { usePortfolio } from "@/context/portfolio";
import { Donut } from "@/components/charts/Donut";
import { Legend } from "@/components/charts/Legend";
import { AreaTrend } from "@/components/charts/AreaTrend";
import { FXArea } from "@/components/charts/FXArea";
import { pct } from "@/lib/formatters";
import { useDateRange, RANGES } from "@/lib/useDateRange";

/** Maps portfolioSeries index → "YYYY-MM" (series starts Jan 2023) */
function seriesIndexToYM(i: number): string {
  const yr = 2023 + Math.floor(i / 12);
  const mo = (i % 12) + 1;
  return `${yr}-${String(mo).padStart(2, "0")}`;
}

function RangeBar({
  activePreset,
  showCustom,
  onPreset,
  onCustomToggle,
}: {
  activePreset: number;
  showCustom: boolean;
  onPreset: (n: number) => void;
  onCustomToggle: () => void;
}) {
  return (
    <div className="chart-range-row">
      <div className="rsel">
        {RANGES.map(([lab, n], i) => (
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
  const { portfolioSeries, fmtVal, fmtSigned } = usePortfolio();

  const seriesLabels = useMemo(
    () => portfolioSeries.map((_, i) => seriesIndexToYM(i)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [portfolioSeries.length]
  );

  const {
    startDate, endDate, minDate, maxDate,
    activePreset, showCustom,
    selectPreset, handleStartChange, handleEndChange, toggleCustom,
  } = useDateRange(seriesLabels);

  const data = useMemo(() => {
    const si = seriesLabels.indexOf(startDate);
    const ei = seriesLabels.indexOf(endDate);
    if (si < 0 || ei < 0 || si > ei) return portfolioSeries;
    return portfolioSeries.slice(si, ei + 1);
  }, [portfolioSeries, seriesLabels, startDate, endDate]);

  const first = data[0];
  const last  = data[data.length - 1];
  if (!first || !last) return null;
  const chg    = last.v - first.v;
  const chgPct = first.v > 0 ? (chg / first.v) * 100 : 0;
  const pos    = chg >= 0;

  return (
    <div className="card chart-card reveal" style={{ animationDelay: ".04s" }}>
      <div className="card-head">
        <span className="card-title">Portfolio Value Over Time</span>
      </div>
      <RangeBar
        activePreset={activePreset}
        showCustom={showCustom}
        onPreset={selectPreset}
        onCustomToggle={toggleCustom}
      />
      {showCustom && (
        <div className="date-range-row">
          <div className="date-field">
            <label className="date-label ui muted xs">From</label>
            <input type="month" className="date-inp mono" value={startDate} min={minDate} max={maxDate} onChange={(e) => handleStartChange(e.target.value)} />
          </div>
          <span className="date-sep ui muted">—</span>
          <div className="date-field">
            <label className="date-label ui muted xs">To</label>
            <input type="month" className="date-inp mono" value={endDate} min={minDate} max={maxDate} onChange={(e) => handleEndChange(e.target.value)} />
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
  const { fxSeries, fxColors, fxLabels, baseCurrency } = usePortfolio();

  const {
    startDate, endDate, minDate, maxDate,
    activePreset, showCustom,
    selectPreset, handleStartChange, handleEndChange, toggleCustom,
  } = useDateRange(fxLabels);

  const fxKeys = Object.keys(fxColors);

  const filteredSeries = useMemo(() => {
    const si = fxLabels.indexOf(startDate);
    const ei = fxLabels.indexOf(endDate);
    if (si === -1 || ei === -1 || si > ei) return fxSeries;
    return fxSeries.slice(si, ei + 1);
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
            activePreset={activePreset}
            showCustom={showCustom}
            onPreset={selectPreset}
            onCustomToggle={toggleCustom}
          />
          {showCustom && (
            <div className="date-range-row">
              <div className="date-field">
                <label className="date-label ui muted xs">From</label>
                <input type="month" className="date-inp mono" value={startDate} min={minDate} max={maxDate} onChange={(e) => handleStartChange(e.target.value)} />
              </div>
              <span className="date-sep ui muted">—</span>
              <div className="date-field">
                <label className="date-label ui muted xs">To</label>
                <input type="month" className="date-inp mono" value={endDate} min={minDate} max={maxDate} onChange={(e) => handleEndChange(e.target.value)} />
              </div>
              <button className="date-reset ui muted" onClick={() => selectPreset(999)}>Reset</button>
            </div>
          )}
          <FXArea key={startDate + endDate} data={filteredSeries} colors={fxColors} keys={fxKeys} height={210} />
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
