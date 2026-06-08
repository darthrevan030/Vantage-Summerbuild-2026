"use client";

import { useState } from "react";
import { usePortfolio } from "@/context/portfolio";
import { Donut } from "@/components/charts/Donut";
import { Legend } from "@/components/charts/Legend";
import { AreaTrend } from "@/components/charts/AreaTrend";
import { FXArea } from "@/components/charts/FXArea";
import { sgd, sgdSigned, pct } from "@/lib/formatters";

const RANGES: [string, number][] = [["6M", 6], ["1Y", 12], ["3Y", 36], ["All", 999]];

function PortfolioTrend() {
  const { portfolioSeries } = usePortfolio();
  const [ri, setRi] = useState(1);
  const n = Math.min(RANGES[ri][1], portfolioSeries.length);
  const data = portfolioSeries.slice(portfolioSeries.length - n);
  const first = data[0];
  const last  = data[data.length - 1];
  if (!first || !last) return null;
  const chg    = last.v - first.v;
  const chgPct = (chg / first.v) * 100;
  const pos    = chg >= 0;

  return (
    <div className="card chart-card reveal" style={{ animationDelay: ".04s" }}>
      <div className="card-head">
        <span className="card-title">Portfolio Value Over Time</span>
        <div className="rsel">
          {RANGES.map(([lab], i) => (
            <button
              key={lab}
              className={"rseg" + (i === ri ? " active" : "")}
              onClick={() => setRi(i)}
            >
              {lab}
            </button>
          ))}
        </div>
      </div>
      <div className="trend-meta">
        <span className="ui muted xs">{first.label} – {last.label}</span>
        <span className="mono xs" style={{ color: pos ? "var(--gain)" : "var(--loss)" }}>
          {sgdSigned(chg)} ({pct(chgPct)})
        </span>
      </div>
      <AreaTrend key={ri} data={data} color="var(--gold)" height={232} valFmt={(v) => sgd(v)} />
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

export default function ChartsPage() {
  const { hero, assetAllocation, fxSeries, fxColors } = usePortfolio();
  const [hl, setHl] = useState(-1);

  const fxKeys = Object.keys(fxColors);

  return (
    <div className="tab-body">
      <div className="charts-grid">
        {/* portfolio value over time */}
        <PortfolioTrend />

        {/* asset allocation donut */}
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
                  {hl >= 0 ? assetAllocation[hl]?.value + "%" : sgd(hero.total / 1000) + "k"}
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

        {/* per-asset performance */}
        <div className="card chart-card reveal" style={{ animationDelay: ".14s" }}>
          <div className="card-head">
            <span className="card-title">Per-Asset Performance</span>
            <span className="ui muted">total return %</span>
          </div>
          <PerfBars />
        </div>

        {/* fx impact over time */}
        <div className="card chart-card reveal" style={{ animationDelay: ".19s" }}>
          <div className="card-head">
            <span className="card-title">FX Impact Over Time</span>
            <span className="ui muted">cumulative, SGD</span>
          </div>
          {fxSeries.length > 0 ? (
            <>
              <FXArea data={fxSeries} colors={fxColors} keys={fxKeys} height={210} />
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
      </div>
    </div>
  );
}
