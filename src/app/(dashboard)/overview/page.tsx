"use client";

import { useState } from "react";
import { usePortfolio } from "@/context/portfolio";
import { Donut } from "@/components/charts/Donut";
import { Legend } from "@/components/charts/Legend";
import { Dumbbell } from "@/components/charts/Dumbbell";
import { Icon } from "@/components/Icon";
import { pct } from "@/lib/formatters";
import { computeMovers, computeCurrencyCards } from "@/lib/portfolio";
import type { MoverItem } from "@/types/portfolio";

function MoverRow({ m, scale, open, onToggle }: { m: MoverItem; scale: number; open: boolean; onToggle: () => void }) {
  const total = m.asset + m.fx;
  const pos = total >= 0;
  return (
    <div className={"mover" + (open ? " open" : "")}>
      <button className="mover-row" onClick={onToggle}>
        <div className="mv-name">
          <span className="ui">{m.name}</span>
          <span className="mono ticker">{m.ticker}</span>
        </div>
        <Dumbbell asset={m.asset} fx={m.fx} scale={scale} />
        <span className="mono mv-pct" style={{ color: pos ? "var(--gain)" : "var(--loss)" }}>{pct(total)}</span>
        <Icon name="chevron" size={14} className="mv-chev" />
      </button>
      {open && (
        <div className="mv-drawer">
          <div className="math-row"><span className="ui">Asset return</span><span className="mono" style={{ color: m.asset >= 0 ? "var(--gain)" : "var(--loss)" }}>{pct(m.asset)}</span></div>
          <div className="math-row"><span className="ui">FX effect</span><span className="mono" style={{ color: m.fx >= 0 ? "var(--fx-positive)" : "var(--fx-negative)" }}>{m.fx === 0 ? "—" : pct(m.fx)}</span></div>
          <div className="math-row total"><span className="ui">Total return</span><span className="mono" style={{ color: pos ? "var(--gain)" : "var(--loss)" }}>{pct(total)}</span></div>
          <div className="mv-note ui">
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
    <div className="card movers-col">
      <div className="card-head">
        <span className="card-title">{title}</span>
        <Icon name={tone} size={15} style={{ color: tone === "up" ? "var(--gain)" : "var(--loss)" }} />
      </div>
      <div className="movers-list">
        {list.map((m, i) => (
          <MoverRow key={i} m={m} scale={scale} open={openIdx === i} onToggle={() => setOpenIdx(openIdx === i ? null : i)} />
        ))}
      </div>
    </div>
  );
}

export default function OverviewPage() {
  const { hero, holdings, assetAllocation, geoAllocation, fmtVal, fmtSigned } = usePortfolio();
  const { gainers, losers } = computeMovers(holdings);
  const ccyCards = computeCurrencyCards(holdings);
  const assetGain = hero.totalGain - hero.fxImpact;
  const acTop = assetAllocation[0];
  const geoTop = geoAllocation[0];

  return (
    <div className="tab-body">
      <div className="stat-row reveal">
        <div className="stat-card accent">
          <span className="stat-label">Total Value</span>
          <span className="mono stat-value">{fmtVal(hero.total)}</span>
          <span className="ui stat-sub muted">Personal wealth</span>
        </div>
        <div className="stat-card">
          <span className="stat-label">Total Gain</span>
          <span className="mono stat-value" style={{ color: hero.totalGain >= 0 ? "var(--gain)" : "var(--loss)" }}>{fmtSigned(hero.totalGain)}</span>
          <span className="mono stat-sub" style={{ color: hero.totalGain >= 0 ? "var(--gain)" : "var(--loss)" }}>{pct(hero.totalGainPct)}</span>
        </div>
        <div className="stat-card">
          <span className="stat-label">FX Impact</span>
          <span className="mono stat-value" style={{ color: hero.fxImpact >= 0 ? "var(--fx-positive)" : "var(--fx-negative)" }}>{fmtSigned(hero.fxImpact)}</span>
          <span className="mono stat-sub" style={{ color: hero.fxImpact >= 0 ? "var(--fx-positive)" : "var(--fx-negative)" }}>{pct(hero.fxPct)}</span>
        </div>
        <div className="stat-card">
          <span className="stat-label">Today</span>
          <span className="mono stat-value" style={{ color: hero.dayChange >= 0 ? "var(--gain)" : "var(--loss)" }}>{fmtSigned(hero.dayChange)}</span>
          <span className="mono stat-sub" style={{ color: hero.dayChange >= 0 ? "var(--gain)" : "var(--loss)" }}>{pct(hero.dayPct)}</span>
        </div>
      </div>

      <div className="ov-grid reveal" style={{ animationDelay: ".05s" }}>
        <div className="card">
          <div className="card-head"><span className="card-title">By Asset Class</span><span className="ui muted">allocation</span></div>
          <div className="donut-block">
            <Donut data={assetAllocation} size={150} thickness={22}>
              {acTop && <div><div className="ui muted xs">{acTop.label}</div><div className="mono donut-pct">{acTop.value}%</div></div>}
            </Donut>
            <Legend data={assetAllocation} />
          </div>
        </div>
        <div className="card">
          <div className="card-head"><span className="card-title">By Geography</span><span className="ui muted">exposure</span></div>
          <div className="donut-block">
            <Donut data={geoAllocation} size={150} thickness={22}>
              {geoTop && <div><div className="ui muted xs">{geoTop.label}</div><div className="mono donut-pct">{geoTop.value}%</div></div>}
            </Donut>
            <Legend data={geoAllocation} />
          </div>
        </div>
      </div>

      <div className="card reveal" style={{ animationDelay: ".1s" }}>
        <div className="card-head"><span className="card-title">Return Attribution</span><span className="ui muted">life-to-date · asset vs currency</span></div>
        <div className="attr">
          <div className="attr-bar">
            <div className="ab-seg" style={{ flex: Math.max(assetGain, 0), background: "var(--gain)" }} />
            <div className="ab-seg" style={{ flex: Math.max(hero.fxImpact, 0), background: "var(--fx-positive)" }} />
          </div>
          <div className="attr-rows">
            <div className="attr-item"><i style={{ background: assetGain >= 0 ? "var(--gain)" : "var(--loss)" }} /><div><div className="ui muted xs">Asset gain</div><div className="mono attr-v" style={{ color: assetGain >= 0 ? "var(--gain)" : "var(--loss)" }}>{fmtSigned(assetGain)}</div></div></div>
            <div className="attr-item"><i style={{ background: "var(--fx-positive)" }} /><div><div className="ui muted xs">FX gain</div><div className="mono attr-v" style={{ color: hero.fxImpact >= 0 ? "var(--fx-positive)" : "var(--fx-negative)" }}>{fmtSigned(hero.fxImpact)}</div></div></div>
            <div className="attr-item total"><div><div className="ui muted xs">Total gain</div><div className="mono attr-v">{fmtSigned(hero.totalGain)} <span style={{ color: hero.totalGain >= 0 ? "var(--gain)" : "var(--loss)" }}>{pct(hero.totalGainPct)}</span></div></div></div>
          </div>
        </div>
      </div>

      <div className="movers-grid reveal" style={{ animationDelay: ".15s" }}>
        <MoverColumn title="Top Gainers" list={gainers} tone="up" />
        <MoverColumn title="Top Losers" list={losers} tone="down" />
      </div>

      {ccyCards.length > 0 && (
        <div className="card reveal" style={{ animationDelay: ".2s" }}>
          <div className="card-head"><span className="card-title">Currency Impact</span><span className="ui muted">FX P&amp;L by exposure</span></div>
          <div className="fx-pills">
            {ccyCards.map((c) => (
              <div className="fx-pill" key={c.code}>
                <span className="flag">{c.flag}</span>
                <span className="mono code">{c.code}</span>
                <span className="mono pill-val" style={{ color: c.impact >= 0 ? "var(--fx-positive)" : "var(--fx-negative)" }}>{fmtSigned(c.impact)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
