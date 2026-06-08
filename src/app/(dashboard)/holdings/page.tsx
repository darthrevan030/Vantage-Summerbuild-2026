"use client";

import { useState, useRef, useEffect } from "react";
import { usePortfolio } from "@/context/portfolio";
import { Icon } from "@/components/Icon";
import { Spark } from "@/components/charts/Spark";
import { Dumbbell } from "@/components/charts/Dumbbell";
import { sgd, sgdSigned, pct, rate, NF } from "@/lib/formatters";
import type { HoldingRow } from "@/types/holding";

const STRAT: Record<string, { label: string; cls: string }> = {
  long_term:   { label: "long-term",    cls: "st-teal"   },
  active:      { label: "active",       cls: "st-amber"  },
  speculative: { label: "speculative",  cls: "st-purple" },
  physical:    { label: "physical",     cls: "st-gray"   },
};

const TYPES = ["All", "Equity", "ETF", "REIT", "Gold", "RE"] as const;

const SORT_KEYS = ["name", "valueSGD", "assetGain", "fxGain", "totalPct"] as const;
type SortKey = typeof SORT_KEYS[number];

function DetailCard({ h, onClose }: { h: HoldingRow; onClose: () => void }) {
  const d = h.detail;
  const total = h.assetGain + h.fxGain;
  const assetGainNative = (d.curPx - d.buyPx) * d.buyUnits;

  return (
    <div className="detail-card reveal">
      <div className="dc-head">
        <div className="dc-id">
          <Icon name={h.icon as never} size={18} style={{ color: "var(--gold)" }} />
          <div>
            <div className="ui dc-name">{h.name}</div>
            <div className="mono ticker">{h.ticker !== "—" ? h.ticker : h.assetType.toUpperCase()}</div>
          </div>
        </div>
        <button className="dc-close" onClick={onClose}><Icon name="x" size={15} /></button>
      </div>

      <div className="dc-hero">
        <div className="mono dc-total" style={{ color: total >= 0 ? "var(--gain)" : "var(--loss)" }}>
          {sgdSigned(total)}
        </div>
        <div className="mono dc-pct" style={{ color: total >= 0 ? "var(--gain)" : "var(--loss)" }}>
          {pct(h.totalPct)}
        </div>
        <span className="ccy-chip">
          <span className="flag">{h.flag}</span>
          <span className="mono">{h.currency}</span>
        </span>
      </div>

      <div className="dc-spark">
        <Spark pts={h.sparkData} color={total >= 0 ? "var(--gain)" : "var(--loss)"} w={260} h={48} />
      </div>

      <div className="dc-math">
        <div className="math-row">
          <span className="ui">Purchase</span>
          <span className="mono">
            {d.buyUnits.toLocaleString()} @ {d.ccy === "SGD" ? sgd(d.buyPx, d.buyPx < 100 ? 2 : 0) : "$" + NF(d.buyPx, 2)}
          </span>
        </div>
        <div className="math-row sub">
          <span className="ui muted">
            {d.buyDate}{d.ccy !== "SGD" ? ` · FX ${rate(d.buyFx)}` : ""}
          </span>
          <span />
        </div>
        <div className="math-row">
          <span className="ui">Current</span>
          <span className="mono">
            {d.buyUnits.toLocaleString()} @ {d.ccy === "SGD" ? sgd(d.curPx, d.curPx < 100 ? 2 : 0) : "$" + NF(d.curPx, 2)}
          </span>
        </div>
        {d.ccy !== "SGD" && (
          <div className="math-row sub">
            <span className="ui muted">FX {rate(d.curFx)}</span>
            <span />
          </div>
        )}

        <div className="dc-div" />

        <div className="math-row">
          <span className="ui" style={{ color: "var(--gain)" }}>Asset gain</span>
          <span className="mono" style={{ color: "var(--gain)" }}>
            {d.ccy !== "SGD" ? `+$${NF(assetGainNative)} × ${rate(d.curFx)} = ` : ""}
            {sgdSigned(h.assetGain)}
          </span>
        </div>
        <div className="math-row">
          <span className="ui" style={{ color: h.fxGain >= 0 ? "var(--fx-positive)" : "var(--fx-negative)" }}>
            FX {h.fxGain >= 0 ? "gain" : "drag"}
          </span>
          <span className="mono" style={{ color: h.fxGain >= 0 ? "var(--fx-positive)" : "var(--fx-negative)" }}>
            {h.fxGain === 0 ? "—" : sgdSigned(h.fxGain)}
          </span>
        </div>
        <div className="math-row total">
          <span className="ui">Total gain</span>
          <span className="mono">
            {sgdSigned(total)}{" "}
            <span style={{ color: total >= 0 ? "var(--gain)" : "var(--loss)" }}>({pct(h.totalPct)})</span>
          </span>
        </div>
      </div>

      {/* dumbbell chart: asset vs fx contribution */}
      <div style={{ marginTop: 12 }}>
        <Dumbbell
          asset={h.assetGain}
          fx={h.fxGain}
          scale={Math.max(Math.abs(h.assetGain + h.fxGain), Math.abs(h.assetGain), 1) * 1.2}
        />
      </div>
    </div>
  );
}

export default function HoldingsPage() {
  const { holdings } = usePortfolio();

  const [q, setQ] = useState("");
  const [typeFilter, setTypeFilter] = useState("All");
  const [sort, setSort] = useState<{ k: SortKey; dir: 1 | -1 }>({ k: "totalPct", dir: -1 });
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const searchRef = useRef<HTMLInputElement>(null);

  // Keyboard shortcut: "/" focuses search
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "/" && document.activeElement !== searchRef.current) {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const key = (h: HoldingRow) => h.id;

  const toggle = (h: HoldingRow) =>
    setPicked((prev) => {
      const next = new Set(prev);
      next.has(key(h)) ? next.delete(key(h)) : next.add(key(h));
      return next;
    });

  const sortBy = (k: SortKey) =>
    setSort((s) => ({ k, dir: s.k === k ? (-s.dir as 1 | -1) : -1 }));

  let rows = holdings.filter((h) =>
    (typeFilter === "All" || h.assetType === typeFilter) &&
    (q === "" || (h.name + h.ticker).toLowerCase().includes(q.toLowerCase()))
  );

  rows = [...rows].sort((a, b) => {
    const va = sort.k === "name" ? a.name : (a[sort.k as keyof HoldingRow] as number);
    const vb = sort.k === "name" ? b.name : (b[sort.k as keyof HoldingRow] as number);
    return (va < vb ? -1 : va > vb ? 1 : 0) * sort.dir;
  });

  const compareCards = holdings.filter((h) => picked.has(key(h)));

  const Th = ({ k, children, right }: { k?: SortKey; children: React.ReactNode; right?: boolean }) => (
    <th
      className={right ? "r" : ""}
      onClick={k ? () => sortBy(k) : undefined}
      style={{ cursor: k ? "pointer" : "default" }}
    >
      {children}
      {k && (
        <span className="sort-ar">
          {sort.k === k ? (sort.dir < 0 ? " ↓" : " ↑") : ""}
        </span>
      )}
    </th>
  );

  const handleCsvExport = () => {
    const cols = ["Name", "Ticker", "Type", "Broker", "Strategy", "Units", "Currency", "Value SGD", "Asset Gain", "FX Gain", "Total %"];
    const rowData = holdings.map((h) => [
      h.name, h.ticker, h.assetType, h.broker, STRAT[h.strategy]?.label ?? h.strategy,
      h.units, h.currency, h.valueSGD.toFixed(2), h.assetGain.toFixed(2), h.fxGain.toFixed(2), h.totalPct.toFixed(2),
    ]);
    const csv = [cols, ...rowData].map((r) => r.join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url; a.download = "portfolio.csv"; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="tab-body">
      {/* filter bar */}
      <div className="filterbar reveal">
        <div className="search">
          <Icon name="search" size={15} />
          <input
            ref={searchRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search holdings…"
          />
          <kbd>/</kbd>
        </div>
        <div className="fpills">
          {TYPES.map((t) => (
            <button
              key={t}
              className={"fpill" + (typeFilter === t ? " active" : "")}
              onClick={() => setTypeFilter(t)}
            >
              {t}
            </button>
          ))}
        </div>
        <button className="icon-btn ghost" onClick={handleCsvExport}>
          <Icon name="download" size={15} />
          <span className="ui">CSV</span>
        </button>
      </div>

      {/* table */}
      <div className="card no-pad reveal" style={{ animationDelay: ".05s" }}>
        <table className="htable">
          <thead>
            <tr>
              <Th k="name">Name / Ticker</Th>
              <Th>Type</Th>
              <Th>Broker</Th>
              <Th>Strategy</Th>
              <Th k="valueSGD" right>Value</Th>
              <Th k="assetGain" right>Asset Gain</Th>
              <Th k="fxGain" right>FX</Th>
              <Th k="totalPct" right>Total %</Th>
              <Th>CCY</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((h) => {
              const sel = picked.has(key(h));
              const total = h.assetGain + h.fxGain;
              const strat = STRAT[h.strategy] ?? { label: h.strategy, cls: "st-gray" };
              return (
                <tr key={key(h)} className={"hrow" + (sel ? " sel" : "")} onClick={() => toggle(h)}>
                  <td>
                    <div className="cell-name">
                      <span className="row-ic"><Icon name={h.icon as never} size={15} /></span>
                      <span className="ui">{h.name}</span>
                      <span className="mono ticker">{h.ticker}</span>
                    </div>
                  </td>
                  <td><span className="ui dim">{h.assetType}</span></td>
                  <td><span className="ui dim">{h.broker}</span></td>
                  <td><span className={"strat " + strat.cls}>{strat.label}</span></td>
                  <td className="r mono">{sgd(h.valueSGD)}</td>
                  <td className="r mono" style={{ color: "var(--gain)" }}>{sgdSigned(h.assetGain)}</td>
                  <td
                    className="r mono"
                    style={{ color: h.fxGain > 0 ? "var(--fx-positive)" : h.fxGain < 0 ? "var(--fx-negative)" : "var(--text-muted)" }}
                  >
                    {h.fxGain === 0 ? "—" : sgdSigned(h.fxGain)}
                  </td>
                  <td className="r mono bold" style={{ color: total >= 0 ? "var(--gain)" : "var(--loss)" }}>
                    {pct(h.totalPct)}
                  </td>
                  <td>
                    <span className="ccy-mini">
                      {h.flag} <span className="mono dim">{h.currency}</span>
                    </span>
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={9} style={{ textAlign: "center", padding: "32px 0" }}>
                  <span className="ui muted">No holdings match.</span>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* compare / inspector tray */}
      <div className="compare reveal" style={{ animationDelay: ".1s" }}>
        <div className="compare-head">
          <span className="card-title">Inspector</span>
          <span className="ui muted">
            {compareCards.length
              ? `Comparing ${compareCards.length} holding${compareCards.length > 1 ? "s" : ""} · click rows to add or remove`
              : "Click a holding to inspect — open several to compare side by side"}
          </span>
        </div>
        {compareCards.length > 0 ? (
          <div className="compare-tray">
            {compareCards.map((h) => (
              <DetailCard key={key(h)} h={h} onClose={() => toggle(h)} />
            ))}
          </div>
        ) : (
          <div className="compare-empty ui muted">No holdings selected.</div>
        )}
      </div>
    </div>
  );
}
