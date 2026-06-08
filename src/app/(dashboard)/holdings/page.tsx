"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { usePortfolio } from "@/context/portfolio";
import { Icon } from "@/components/Icon";
import { Select } from "@/components/Select";
import { Spark } from "@/components/charts/Spark";
import { Dumbbell } from "@/components/charts/Dumbbell";
import { pct, rate, NF } from "@/lib/formatters";
import { refreshHoldingPrices } from "@/lib/api-client";
import type { HoldingRow, GroupedHolding } from "@/types/holding";
import { groupHoldings } from "@/lib/group-holdings";

const ASSET_TYPES_EDIT = ["Equity", "ETF", "REIT", "Gold", "RE"];
const STRAT_LABEL_EDIT: Record<string, string> = {
  long_term: "Long Term", active: "Active", speculative: "Speculative", physical: "Physical",
};

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
  const { fmtVal, fmtSigned } = usePortfolio();
  const router = useRouter();
  const d = h.detail;
  const total = h.assetGain + h.fxGain;
  const assetGainNative = (d.curPx - d.buyPx) * d.buyUnits;

  type Mode = "view" | "edit" | "confirm-delete";
  const [mode, setMode] = useState<Mode>("view");
  const [saving, setSaving] = useState(false);
  const [editForm, setEditForm] = useState({
    name: h.name, ticker: h.ticker,
    asset_type: h.assetType, strategy: h.strategy,
    units: String(h.units),
    current_price: String(h.currentPrice), current_fx_rate: String(h.currentFxRate),
    buy_price: String(h.buyPrice), buy_date: h.buyDate, buy_fx_rate: String(h.buyFxRate),
  });
  const ef = editForm;
  const setEf = (k: string, v: string) => setEditForm(f => ({ ...f, [k]: v }));

  async function handleSave() {
    setSaving(true);
    try {
      await fetch(`/api/holdings?id=${h.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: ef.name, ticker: ef.ticker,
          asset_type: ef.asset_type, strategy: ef.strategy,
          units: Number(ef.units),
          current_price: Number(ef.current_price),
          current_fx_rate: Number(ef.current_fx_rate),
          buy_price: Number(ef.buy_price),
          buy_date: ef.buy_date,
          buy_fx_rate: Number(ef.buy_fx_rate),
        }),
      });
      router.refresh();
      onClose();
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    setSaving(true);
    try {
      await fetch(`/api/holdings?id=${h.id}`, { method: "DELETE" });
      router.refresh();
      onClose();
    } finally {
      setSaving(false);
    }
  }

  if (mode === "edit") return (
    <div className="detail-card reveal">
      <div className="dc-head">
        <div className="dc-id">
          <Icon name={h.icon as never} size={18} style={{ color: "var(--gold)" }} />
          <div className="ui dc-name">{h.name}</div>
        </div>
        <button className="dc-close" onClick={() => setMode("view")}><Icon name="x" size={15} /></button>
      </div>
      <div className="dc-form">
        <div className="dc-field full">
          <span className="dc-field-label">Name</span>
          <input className="dc-inp" value={ef.name} onChange={e => setEf("name", e.target.value)} />
        </div>
        <div className="dc-field">
          <span className="dc-field-label">Ticker</span>
          <input className="dc-inp" value={ef.ticker} onChange={e => setEf("ticker", e.target.value.toUpperCase())} />
        </div>
        <div className="dc-field">
          <span className="dc-field-label">Asset Type</span>
          <Select value={ef.asset_type} options={ASSET_TYPES_EDIT} onChange={v => setEf("asset_type", v)} />
        </div>
        <div className="dc-field">
          <span className="dc-field-label">Strategy</span>
          <Select
            value={STRAT_LABEL_EDIT[ef.strategy] ?? ef.strategy}
            options={Object.values(STRAT_LABEL_EDIT)}
            onChange={v => setEf("strategy", Object.entries(STRAT_LABEL_EDIT).find(([,l]) => l === v)?.[0] ?? ef.strategy)}
          />
        </div>
        <div className="dc-field">
          <span className="dc-field-label">Units</span>
          <input className="dc-inp" type="number" value={ef.units} onChange={e => setEf("units", e.target.value)} />
        </div>
        <div className="dc-field">
          <span className="dc-field-label">Buy Price</span>
          <input className="dc-inp" type="number" value={ef.buy_price} onChange={e => setEf("buy_price", e.target.value)} />
        </div>
        <div className="dc-field">
          <span className="dc-field-label">Buy Date</span>
          <input className="dc-inp" type="date" value={ef.buy_date} onChange={e => setEf("buy_date", e.target.value)} />
        </div>
        <div className="dc-field">
          <span className="dc-field-label">Buy FX Rate</span>
          <input className="dc-inp" type="number" value={ef.buy_fx_rate} onChange={e => setEf("buy_fx_rate", e.target.value)} />
        </div>
        <div className="dc-field">
          <span className="dc-field-label">Current Price</span>
          <input className="dc-inp" type="number" value={ef.current_price} onChange={e => setEf("current_price", e.target.value)} />
        </div>
        <div className="dc-field">
          <span className="dc-field-label">Current FX Rate</span>
          <input className="dc-inp" type="number" value={ef.current_fx_rate} onChange={e => setEf("current_fx_rate", e.target.value)} />
        </div>
      </div>
      <button className="dc-save" onClick={handleSave} disabled={saving}>
        {saving ? "Saving…" : "Save Changes"}
      </button>
    </div>
  );

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
          {fmtSigned(total)}
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
            {d.buyUnits.toLocaleString()} @ {d.ccy === "SGD" ? fmtVal(d.buyPx) : NF(d.buyPx, 2) + " " + d.ccy}
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
            {d.buyUnits.toLocaleString()} @ {d.ccy === "SGD" ? fmtVal(d.curPx) : NF(d.curPx, 2) + " " + d.ccy}
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
            {d.ccy !== "SGD" ? `+${NF(assetGainNative, 0)} ${d.ccy} = ` : ""}
            {fmtSigned(h.assetGain)}
          </span>
        </div>
        <div className="math-row">
          <span className="ui" style={{ color: h.fxGain >= 0 ? "var(--fx-positive)" : "var(--fx-negative)" }}>
            FX {h.fxGain >= 0 ? "gain" : "drag"}
          </span>
          <span className="mono" style={{ color: h.fxGain >= 0 ? "var(--fx-positive)" : "var(--fx-negative)" }}>
            {h.fxGain === 0 ? "—" : fmtSigned(h.fxGain)}
          </span>
        </div>
        <div className="math-row total">
          <span className="ui">Total gain</span>
          <span className="mono">
            {fmtSigned(total)}{" "}
            <span style={{ color: total >= 0 ? "var(--gain)" : "var(--loss)" }}>({pct(h.totalPct)})</span>
          </span>
        </div>
      </div>

      <div style={{ marginTop: 12 }}>
        <Dumbbell
          asset={h.assetGain}
          fx={h.fxGain}
          scale={Math.max(Math.abs(h.assetGain + h.fxGain), Math.abs(h.assetGain), 1) * 1.2}
        />
      </div>

      {mode === "confirm-delete" ? (
        <div className="dc-confirm">
          <span className="ui" style={{ fontSize: 12.5 }}>Delete <strong>{h.name}</strong> permanently?</span>
          <div className="dc-actions">
            <button className="dc-btn del" onClick={handleDelete} disabled={saving}>
              {saving ? "Deleting…" : "Yes, delete"}
            </button>
            <button className="dc-btn edit" onClick={() => setMode("view")}>Cancel</button>
          </div>
        </div>
      ) : (
        <div className="dc-actions">
          <button className="dc-btn edit" onClick={() => setMode("edit")}>
            <Icon name="sliders" size={13} />Edit
          </button>
          <button className="dc-btn del" onClick={() => setMode("confirm-delete")}>
            <Icon name="x" size={13} />Delete
          </button>
        </div>
      )}
    </div>
  );
}

export default function HoldingsPage() {
  const { holdings, fmtVal, fmtSigned } = usePortfolio();
  const router = useRouter();

  const [q, setQ] = useState("");
  const [typeFilter, setTypeFilter] = useState("All");
  const [sort, setSort] = useState<{ k: SortKey; dir: 1 | -1 }>({ k: "totalPct", dir: -1 });
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [refreshing, setRefreshing] = useState(false);
  const [refreshMsg, setRefreshMsg] = useState("");
  const [groupView, setGroupView] = useState(true);
  const [expandedTickers, setExpandedTickers] = useState<Set<string>>(new Set());
  const searchRef = useRef<HTMLInputElement>(null);

  async function handleRefresh() {
    setRefreshing(true);
    setRefreshMsg("");
    try {
      const { refreshed, skipped } = await refreshHoldingPrices();
      if (refreshed > 0) {
        setRefreshMsg(`Updated ${refreshed} holding${refreshed > 1 ? "s" : ""}${skipped > 0 ? ` · ${skipped} already fresh` : ""}`);
        router.refresh();
      } else {
        setRefreshMsg("All prices up to date");
      }
    } catch {
      setRefreshMsg("Refresh failed");
    } finally {
      setRefreshing(false);
    }
  }

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

  const gKey = (g: GroupedHolding) => g.ticker !== "—" ? g.ticker : g.lots[0].id;
  const isExpanded = (g: GroupedHolding) => q !== "" || expandedTickers.has(gKey(g));
  const toggleGroup = (k: string) =>
    setExpandedTickers((prev) => {
      const next = new Set(prev);
      next.has(k) ? next.delete(k) : next.add(k);
      return next;
    });

  function sortVal(item: { name: string; valueSGD: number; assetGain: number; fxGain: number; totalPct: number }, k: SortKey): string | number {
    switch (k) {
      case "name": return item.name;
      case "valueSGD": return item.valueSGD;
      case "assetGain": return item.assetGain;
      case "fxGain": return item.fxGain;
      case "totalPct": return item.totalPct;
    }
  }

  const filteredRows = holdings.filter((h) =>
    (typeFilter === "All" || h.assetType === typeFilter) &&
    (q === "" || (h.name + h.ticker).toLowerCase().includes(q.toLowerCase()))
  );

  const rows = [...filteredRows].sort((a, b) => {
    const va = sortVal(a, sort.k);
    const vb = sortVal(b, sort.k);
    return (va < vb ? -1 : va > vb ? 1 : 0) * sort.dir;
  });

  const groups = [...groupHoldings(filteredRows)].sort((a, b) => {
    const va = sortVal(a, sort.k);
    const vb = sortVal(b, sort.k);
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
        <button
          className={"icon-btn ghost" + (groupView ? " gview-active" : "")}
          onClick={() => setGroupView((v) => !v)}
          title={groupView ? "Switch to flat view" : "Switch to grouped view"}
        >
          <Icon name={groupView ? "layers" : "list"} size={15} />
          <span className="ui">{groupView ? "Grouped" : "Flat"}</span>
        </button>
        <button className="icon-btn ghost" onClick={handleCsvExport}>
          <Icon name="download" size={15} />
          <span className="ui">CSV</span>
        </button>
        <button className="icon-btn ghost" onClick={handleRefresh} disabled={refreshing}>
          <Icon name={refreshing ? "loader" : "refresh-cw"} size={15} style={refreshing ? { animation: "spin 1s linear infinite" } : undefined} />
          <span className="ui">{refreshing ? "Refreshing…" : "Refresh Prices"}</span>
        </button>
        {refreshMsg && <span className="ui muted xs refresh-msg">{refreshMsg}</span>}
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
            {groupView
              ? groups.flatMap((group) => {
                  const gk = gKey(group);
                  const isMulti = group.lots.length > 1;
                  const expanded = isExpanded(group);
                  const gTotal = group.assetGain + group.fxGain;
                  const gStrat = STRAT[group.lots[0].strategy] ?? { label: group.lots[0].strategy, cls: "st-gray" };

                  const groupRow = (
                    <tr
                      key={gk}
                      className={"hrow" + (isMulti ? " group-hd" : "") + (!isMulti && picked.has(group.lots[0].id) ? " sel" : "")}
                      onClick={() => isMulti ? toggleGroup(gk) : toggle(group.lots[0])}
                    >
                      <td>
                        <div className="cell-name">
                          {isMulti && (
                            <span className="group-chevron" style={{ transform: expanded ? "rotate(0deg)" : "rotate(-90deg)" }}>
                              <Icon name="chevron" size={14} />
                            </span>
                          )}
                          <span className="row-ic"><Icon name={group.icon as never} size={15} /></span>
                          <span className="ui" style={isMulti ? { fontWeight: 600 } : undefined}>{group.name}</span>
                          {group.ticker !== "—" && <span className="mono ticker">{group.ticker}</span>}
                          {isMulti && <span className="lots-badge">{group.lots.length} lots</span>}
                        </div>
                      </td>
                      <td><span className="ui dim">{group.assetType}</span></td>
                      <td><span className="ui dim">{group.lots[0].broker}</span></td>
                      <td><span className={"strat " + gStrat.cls}>{gStrat.label}</span></td>
                      <td className="r mono">{fmtVal(group.valueSGD)}</td>
                      <td className="r mono" style={{ color: group.assetGain >= 0 ? "var(--gain)" : "var(--loss)" }}>{fmtSigned(group.assetGain)}</td>
                      <td className="r mono" style={{ color: group.fxGain > 0 ? "var(--fx-positive)" : group.fxGain < 0 ? "var(--fx-negative)" : "var(--text-muted)" }}>
                        {group.fxGain === 0 ? "—" : fmtSigned(group.fxGain)}
                      </td>
                      <td className="r mono bold" style={{ color: gTotal >= 0 ? "var(--gain)" : "var(--loss)" }}>{pct(group.totalPct)}</td>
                      <td>
                        <span className="ccy-mini">
                          {group.flag} <span className="mono dim">{group.currency}</span>
                        </span>
                      </td>
                    </tr>
                  );

                  if (!isMulti || !expanded) return [groupRow];

                  const lotRows = group.lots.map((h) => {
                    const sel = picked.has(h.id);
                    const lotTotal = h.assetGain + h.fxGain;
                    const lStrat = STRAT[h.strategy] ?? { label: h.strategy, cls: "st-gray" };
                    return (
                      <tr
                        key={h.id}
                        className={"hrow lot-row" + (sel ? " sel" : "")}
                        onClick={(e) => { e.stopPropagation(); toggle(h); }}
                      >
                        <td>
                          <div className="cell-name lot-indent">
                            <span className="lot-connector" />
                            <span className="ui dim">{h.buyDate}</span>
                            <span className="mono dim">· {h.units.toLocaleString()} units</span>
                          </div>
                        </td>
                        <td><span className="ui dim">{h.assetType}</span></td>
                        <td><span className="ui dim">{h.broker}</span></td>
                        <td><span className={"strat " + lStrat.cls}>{lStrat.label}</span></td>
                        <td className="r mono">{fmtVal(h.valueSGD)}</td>
                        <td className="r mono" style={{ color: h.assetGain >= 0 ? "var(--gain)" : "var(--loss)" }}>{fmtSigned(h.assetGain)}</td>
                        <td className="r mono" style={{ color: h.fxGain > 0 ? "var(--fx-positive)" : h.fxGain < 0 ? "var(--fx-negative)" : "var(--text-muted)" }}>
                          {h.fxGain === 0 ? "—" : fmtSigned(h.fxGain)}
                        </td>
                        <td className="r mono bold" style={{ color: lotTotal >= 0 ? "var(--gain)" : "var(--loss)" }}>{pct(h.totalPct)}</td>
                        <td />
                      </tr>
                    );
                  });

                  return [groupRow, ...lotRows];
                })
              : rows.map((h) => {
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
                      <td className="r mono">{fmtVal(h.valueSGD)}</td>
                      <td className="r mono" style={{ color: "var(--gain)" }}>{fmtSigned(h.assetGain)}</td>
                      <td className="r mono" style={{ color: h.fxGain > 0 ? "var(--fx-positive)" : h.fxGain < 0 ? "var(--fx-negative)" : "var(--text-muted)" }}>
                        {h.fxGain === 0 ? "—" : fmtSigned(h.fxGain)}
                      </td>
                      <td className="r mono bold" style={{ color: total >= 0 ? "var(--gain)" : "var(--loss)" }}>{pct(h.totalPct)}</td>
                      <td>
                        <span className="ccy-mini">
                          {h.flag} <span className="mono dim">{h.currency}</span>
                        </span>
                      </td>
                    </tr>
                  );
                })
            }
            {(groupView ? groups : rows).length === 0 && (
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
