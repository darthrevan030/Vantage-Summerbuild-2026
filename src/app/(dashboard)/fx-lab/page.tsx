"use client";

import { usePortfolio } from "@/context/portfolio";
import { Icon } from "@/components/Icon";
import { Spark } from "@/components/charts/Spark";
import { useCountUp } from "@/lib/useCountUp";
import { sgd, sgdSigned, pct, rate } from "@/lib/formatters";
import type { CurrencyCard, WaterfallItem } from "@/types/portfolio";

function CcyCard({ c, delay }: { c: CurrencyCard; delay: string }) {
  const pos = c.impact >= 0;
  const col = pos ? "var(--fx-positive)" : "var(--fx-negative)";
  return (
    <div className="card ccy-card reveal" style={{ animationDelay: delay }}>
      <div className="cc-head">
        <span className="cc-title">
          <span className="flag big">{c.flag}</span>
          <span className="mono code">{c.code}</span>
        </span>
        <span className="mono cc-delta" style={{ color: col }}>
          {pos ? "▲" : "▼"} {pct(Math.abs(c.deltaPct))}
        </span>
      </div>
      <div className="cc-grid">
        <div>
          <div className="ui muted xs">Exposure</div>
          <div className="mono cc-v">{sgd(c.exposure)}</div>
          <div className="ui muted xs">{c.exposurePct.toFixed(1)}% of book</div>
        </div>
        <div>
          <div className="ui muted xs">Avg / Current</div>
          <div className="mono cc-v">{rate(c.avg)} → {rate(c.cur)}</div>
          <div className="ui muted xs">SGD per {c.code}</div>
        </div>
      </div>
      <div className="cc-foot">
        <div>
          <div className="ui muted xs">FX Impact</div>
          <div className="mono cc-impact" style={{ color: col }}>{sgdSigned(c.impact)}</div>
        </div>
        <div className="cc-spark">
          {c.spark.length > 0 && <Spark pts={c.spark} color={col} w={132} h={40} />}
        </div>
      </div>
    </div>
  );
}

function Waterfall({ items, netImpact, netPct }: { items: WaterfallItem[]; netImpact: number; netPct: number }) {
  const max = Math.max(...items.map((i) => Math.abs(i.value)), 1);
  return (
    <div className="card reveal" style={{ animationDelay: ".28s" }}>
      <div className="card-head">
        <span className="card-title">Currency Contribution to Portfolio</span>
        <span className="ui muted">SGD</span>
      </div>
      <div className="waterfall">
        {items.map((it) => {
          const pos = it.value >= 0;
          const w = (Math.abs(it.value) / max) * 50;
          return (
            <div className="wf-row" key={it.code}>
              <span className="mono wf-code">{it.code}</span>
              <div className="wf-track">
                <div className="wf-zero" />
                <div
                  className="wf-bar"
                  style={{
                    [pos ? "left" : "right"]: "50%",
                    width: w + "%",
                    background: pos ? "var(--fx-positive)" : "var(--fx-negative)",
                  }}
                />
              </div>
              <span
                className="mono wf-val"
                style={{ color: pos ? "var(--fx-positive)" : "var(--fx-negative)" }}
              >
                {sgdSigned(it.value)}
              </span>
            </div>
          );
        })}
        <div className="wf-net">
          <span className="ui muted">Net FX effect</span>
          <span className="mono" style={{ color: netImpact >= 0 ? "var(--fx-positive)" : "var(--fx-negative)" }}>
            {sgdSigned(netImpact)}{" "}
            <span className="muted">({pct(netPct)})</span>
          </span>
        </div>
      </div>
    </div>
  );
}

export default function FXLabPage() {
  const { hero, currencyCards, waterfallData } = usePortfolio();
  const actual  = useCountUp(hero.total,   1100);
  const neutral = useCountUp(hero.neutral, 1100);

  if (currencyCards.length === 0) {
    return (
      <div className="tab-body">
        <div className="card">
          <div className="card-head">
            <span className="card-title">FX Lab</span>
            <span className="ui muted">No foreign-currency holdings found</span>
          </div>
          <p className="ui muted" style={{ padding: "20px 0" }}>
            Add holdings in USD, EUR, AUD, or other foreign currencies to see FX analysis here.
          </p>
        </div>
      </div>
    );
  }

  const verdictPositive = hero.fxImpact >= 0;

  return (
    <div className="tab-body">
      {/* versus banner */}
      <div className="versus reveal">
        <div className="vs-side">
          <div className="ui muted label">Actual Portfolio</div>
          <div className="serif vs-num">{sgd(actual)}</div>
        </div>
        <div className="vs-mid">
          <div className="vs-vs ui">vs</div>
        </div>
        <div className="vs-side right">
          <div className="ui muted label">FX-Neutral Portfolio</div>
          <div className="serif vs-num dim">{sgd(neutral)}</div>
        </div>
        <div className="vs-verdict">
          <Icon name={verdictPositive ? "up" : "down"} size={16} style={{ color: verdictPositive ? "var(--fx-positive)" : "var(--fx-negative)" }} />
          <span className="ui">
            Currency has{" "}
            {verdictPositive ? "added" : "cost"}{" "}
            <b className="mono" style={{ color: verdictPositive ? "var(--fx-positive)" : "var(--fx-negative)" }}>
              {sgdSigned(hero.fxImpact)}
            </b>{" "}
            <span className="mono" style={{ color: verdictPositive ? "var(--fx-positive)" : "var(--fx-negative)" }}>
              ({pct(hero.fxPct)})
            </span>{" "}
            to your returns
          </span>
        </div>
      </div>

      {/* currency cards grid */}
      <div className="ccy-grid">
        {currencyCards.map((c, i) => (
          <CcyCard key={c.code} c={c} delay={(0.06 + i * 0.05) + "s"} />
        ))}
      </div>

      <Waterfall items={waterfallData} netImpact={hero.fxImpact} netPct={hero.fxPct} />
    </div>
  );
}
