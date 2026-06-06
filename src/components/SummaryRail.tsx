"use client";

import { Donut } from "@/components/charts/Donut";
import { Legend } from "@/components/charts/Legend";
import { sgdSigned, pct } from "@/lib/formatters";
import { usePortfolio } from "@/context/portfolio";

export function SummaryRail() {
  const { hero, assetAllocation } = usePortfolio();
  const top = assetAllocation[0];
  const fxUp = hero.fxImpact >= 0;
  const dayUp = hero.dayChange >= 0;

  return (
    <aside className="summary">
      <div className="sm-block">
        <div className="ui muted xs">Allocation</div>
        <div className="sm-donut">
          <Donut data={assetAllocation} size={132} thickness={18}>
            {top && (
              <div>
                <div className="ui muted xs">{top.label}</div>
                <div className="mono donut-pct sm">{top.value}%</div>
              </div>
            )}
          </Donut>
        </div>
        <Legend data={assetAllocation} />
      </div>

      <div className="sm-div" />

      <div className="sm-metrics">
        <div className="sm-metric">
          <span className="ui muted xs">Total Gain</span>
          <span className="mono sm-v" style={{ color: "var(--gain)" }}>{sgdSigned(hero.totalGain)}</span>
          <span className="mono sm-sub" style={{ color: "var(--gain)" }}>{pct(hero.totalGainPct)}</span>
        </div>
        <div className="sm-metric">
          <span className="ui muted xs">FX Impact</span>
          <span className="mono sm-v" style={{ color: fxUp ? "var(--fx-positive)" : "var(--fx-negative)" }}>{sgdSigned(hero.fxImpact)}</span>
          <span className="mono sm-sub" style={{ color: fxUp ? "var(--fx-positive)" : "var(--fx-negative)" }}>{pct(hero.fxPct)}</span>
        </div>
        <div className="sm-metric">
          <span className="ui muted xs">Today</span>
          <span className="mono sm-v" style={{ color: dayUp ? "var(--gain)" : "var(--loss)" }}>{sgdSigned(hero.dayChange)}</span>
          <span className="mono sm-sub" style={{ color: dayUp ? "var(--gain)" : "var(--loss)" }}>{pct(hero.dayPct)}</span>
        </div>
      </div>

      <div className="sm-div" />
      <div className="sm-foot">
        <span className="ui muted xs">Updated {hero.updated}</span>
        <span className="sm-live"><i />live</span>
      </div>
    </aside>
  );
}
