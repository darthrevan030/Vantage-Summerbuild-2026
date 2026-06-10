"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
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

const STRAT_GRAY = "bg-[rgba(136,146,164,0.12)] text-secondary";
const STRAT: Record<string, { label: string; cls: string }> = {
  long_term:   { label: "long-term",    cls: "bg-[rgba(52,211,153,0.1)] text-gain"   },
  active:      { label: "active",       cls: "bg-tint text-gold"  },
  speculative: { label: "speculative",  cls: "bg-[rgba(229,138,208,0.12)] text-fx-down" },
  physical:    { label: "physical",     cls: STRAT_GRAY   },
};

const STRAT_BASE = "whitespace-nowrap rounded-md px-[9px] py-[3px] font-ui text-[11px]";

const TYPES = ["All", "Equity", "ETF", "REIT", "Gold", "RE"] as const;

const SORT_KEYS = ["name", "valueSGD", "assetGain", "fxGain", "totalPct"] as const;
type SortKey = typeof SORT_KEYS[number];

// .hrow + state variants (whole-class swaps)
const ROW_UNSEL = "cursor-pointer border-l-2 border-l-transparent transition-[background] duration-150 hover:bg-elevated";
const ROW_SEL = "cursor-pointer border-l-2 border-l-gold bg-elevated transition-[background] duration-150 hover:bg-elevated";
const ROW_GROUP_HD = "cursor-pointer border-l-2 border-l-[rgba(212,163,78,.18)] bg-[rgba(212,163,78,.03)] transition-[background] duration-150 hover:bg-[rgba(212,163,78,.07)]";
const ROW_LOT_UNSEL = "cursor-pointer border-l-2 border-l-transparent bg-surface transition-[background] duration-150";
const ROW_LOT_SEL = "cursor-pointer border-l-2 border-l-gold bg-surface transition-[background] duration-150";

// .htable td (+ .r / .bold) variants
const CELL = "border-b border-subtle px-4 py-3.5 text-[13px] light:border-b-black/[.06]";
const CELL_R = CELL + " text-right font-mono";
const CELL_R_BOLD = CELL_R + " font-semibold";
const SEL_SHADOW = " shadow-[inset_2px_0_0_var(--gold)]";
// .hrow.lot-row td (10px 16px / 12px) + first-child pl 44px
const LOT_CELL = "border-b border-subtle px-4 py-2.5 text-xs light:border-b-black/[.06]";
const LOT_CELL_FIRST = "border-b border-subtle py-2.5 pr-4 pl-11 text-xs light:border-b-black/[.06]";
const LOT_CELL_R = LOT_CELL + " text-right font-mono";
const LOT_CELL_R_BOLD = LOT_CELL_R + " font-semibold";

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
      const res = await fetch(`/api/holdings?id=${h.id}`, {
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
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as { error?: string }).error ?? "Update failed");
      }
      toast.success(`${ef.name} updated`);
      router.refresh();
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Update failed");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    setSaving(true);
    try {
      const res = await fetch(`/api/holdings?id=${h.id}`, { method: "DELETE" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as { error?: string }).error ?? "Delete failed");
      }
      toast.success(`${h.name} removed from portfolio`);
      router.refresh();
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Delete failed");
    } finally {
      setSaving(false);
    }
  }

  if (mode === "edit") return (
    <div className="flex flex-[0_0_300px] flex-col gap-[13px] rounded-[13px] border border-subtle bg-elevated p-4 light:border-black/10 max-bp768:flex-[0_0_280px] max-bp600:flex-[0_0_calc(100vw_-_56px)] animate-reveal">
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-2.5">
          <Icon name={h.icon as never} size={18} style={{ color: "var(--gold)" }} />
          <div className="font-ui text-[13.5px] font-semibold overflow-hidden text-ellipsis whitespace-nowrap">{h.name}</div>
        </div>
        <button className="cursor-pointer rounded-[5px] border-none bg-transparent p-0.5 text-muted transition-[color] duration-150 hover:text-loss" onClick={() => setMode("view")}><Icon name="x" size={15} /></button>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div className="col-span-2 flex flex-col gap-1">
          <span className="text-[10px] font-semibold uppercase tracking-[.08em] text-muted">Name</span>
          <input className="w-full rounded-[7px] border border-subtle bg-surface px-[9px] py-[7px] font-ui text-[12.5px] text-primary outline-none transition-[border-color] duration-150 focus:border-gold-soft" value={ef.name} onChange={e => setEf("name", e.target.value)} />
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-[10px] font-semibold uppercase tracking-[.08em] text-muted">Ticker</span>
          <input className="w-full rounded-[7px] border border-subtle bg-surface px-[9px] py-[7px] font-ui text-[12.5px] text-primary outline-none transition-[border-color] duration-150 focus:border-gold-soft" value={ef.ticker} onChange={e => setEf("ticker", e.target.value.toUpperCase())} />
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-[10px] font-semibold uppercase tracking-[.08em] text-muted">Asset Type</span>
          <Select value={ef.asset_type} options={ASSET_TYPES_EDIT} onChange={v => setEf("asset_type", v)} />
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-[10px] font-semibold uppercase tracking-[.08em] text-muted">Strategy</span>
          <Select
            value={STRAT_LABEL_EDIT[ef.strategy] ?? ef.strategy}
            options={Object.values(STRAT_LABEL_EDIT)}
            onChange={v => setEf("strategy", Object.entries(STRAT_LABEL_EDIT).find(([,l]) => l === v)?.[0] ?? ef.strategy)}
          />
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-[10px] font-semibold uppercase tracking-[.08em] text-muted">Units</span>
          <input className="w-full rounded-[7px] border border-subtle bg-surface px-[9px] py-[7px] font-ui text-[12.5px] text-primary outline-none transition-[border-color] duration-150 focus:border-gold-soft" type="number" value={ef.units} onChange={e => setEf("units", e.target.value)} />
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-[10px] font-semibold uppercase tracking-[.08em] text-muted">Buy Price</span>
          <input className="w-full rounded-[7px] border border-subtle bg-surface px-[9px] py-[7px] font-ui text-[12.5px] text-primary outline-none transition-[border-color] duration-150 focus:border-gold-soft" type="number" value={ef.buy_price} onChange={e => setEf("buy_price", e.target.value)} />
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-[10px] font-semibold uppercase tracking-[.08em] text-muted">Buy Date</span>
          <input className="w-full rounded-[7px] border border-subtle bg-surface px-[9px] py-[7px] font-ui text-[12.5px] text-primary outline-none transition-[border-color] duration-150 focus:border-gold-soft [&::-webkit-calendar-picker-indicator]:cursor-pointer [&::-webkit-calendar-picker-indicator]:opacity-50 [&::-webkit-calendar-picker-indicator]:[filter:invert(0.65)_brightness(1.4)]" type="date" value={ef.buy_date} onChange={e => setEf("buy_date", e.target.value)} />
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-[10px] font-semibold uppercase tracking-[.08em] text-muted">Buy FX Rate</span>
          <input className="w-full rounded-[7px] border border-subtle bg-surface px-[9px] py-[7px] font-ui text-[12.5px] text-primary outline-none transition-[border-color] duration-150 focus:border-gold-soft" type="number" value={ef.buy_fx_rate} onChange={e => setEf("buy_fx_rate", e.target.value)} />
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-[10px] font-semibold uppercase tracking-[.08em] text-muted">Current Price</span>
          <input className="w-full rounded-[7px] border border-subtle bg-surface px-[9px] py-[7px] font-ui text-[12.5px] text-primary outline-none transition-[border-color] duration-150 focus:border-gold-soft" type="number" value={ef.current_price} onChange={e => setEf("current_price", e.target.value)} />
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-[10px] font-semibold uppercase tracking-[.08em] text-muted">Current FX Rate</span>
          <input className="w-full rounded-[7px] border border-subtle bg-surface px-[9px] py-[7px] font-ui text-[12.5px] text-primary outline-none transition-[border-color] duration-150 focus:border-gold-soft" type="number" value={ef.current_fx_rate} onChange={e => setEf("current_fx_rate", e.target.value)} />
        </div>
      </div>
      <button className="w-full cursor-pointer rounded-[9px] border-none bg-gold p-[9px] font-ui text-[13px] font-semibold text-[#15130c] transition-[filter] duration-150 hover:brightness-[1.08] disabled:cursor-not-allowed disabled:opacity-50" onClick={handleSave} disabled={saving}>
        {saving ? "Saving…" : "Save Changes"}
      </button>
    </div>
  );

  return (
    <div className="flex flex-[0_0_300px] flex-col gap-[13px] rounded-[13px] border border-subtle bg-elevated p-4 light:border-black/10 max-bp768:flex-[0_0_280px] max-bp600:flex-[0_0_calc(100vw_-_56px)] animate-reveal">
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-2.5">
          <Icon name={h.icon as never} size={18} style={{ color: "var(--gold)" }} />
          <div>
            <div className="font-ui text-[13.5px] font-semibold overflow-hidden text-ellipsis whitespace-nowrap">{h.name}</div>
            <div className="font-mono text-[10.5px] tracking-[.05em] text-muted">{h.ticker !== "—" ? h.ticker : h.assetType.toUpperCase()}</div>
          </div>
        </div>
        <button className="cursor-pointer rounded-[5px] border-none bg-transparent p-0.5 text-muted transition-[color] duration-150 hover:text-loss" onClick={onClose}><Icon name="x" size={15} /></button>
      </div>

      <div className="flex flex-wrap items-baseline gap-2.5">
        <div className="font-mono text-[22px] font-semibold tracking-[-.01em]" style={{ color: total >= 0 ? "var(--gain)" : "var(--loss)" }}>
          {fmtSigned(total)}
        </div>
        <div className="font-mono text-[13px] font-semibold" style={{ color: total >= 0 ? "var(--gain)" : "var(--loss)" }}>
          {pct(h.totalPct)}
        </div>
        <span className="ml-auto flex items-center gap-[5px] rounded-[7px] border border-subtle bg-surface px-2 py-[3px] text-[11px]">
          <span className="font-flag">{h.flag}</span>
          <span className="font-mono">{h.currency}</span>
        </span>
      </div>

      <div className="py-0.5 max-bp600:[&_svg]:w-full">
        <Spark pts={h.sparkData} color={total >= 0 ? "var(--gain)" : "var(--loss)"} w={260} h={48} />
      </div>

      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between gap-3 text-[12.5px]">
          <span className="font-ui text-secondary">Purchase</span>
          <span className="font-mono text-primary text-[12.5px]">
            {d.buyUnits.toLocaleString()} @ {d.ccy === "SGD" ? "S$" + NF(d.buyPx, 2) : NF(d.buyPx, 2) + " " + d.ccy}
          </span>
        </div>
        <div className="flex items-center justify-between gap-3 text-[12.5px] -mt-1">
          <span className="font-ui text-secondary text-[11px]">
            {d.buyDate}{d.ccy !== "SGD" ? ` · FX ${rate(d.buyFx)}` : ""}
          </span>
          <span />
        </div>
        <div className="flex items-center justify-between gap-3 text-[12.5px]">
          <span className="font-ui text-secondary">Current</span>
          <span className="font-mono text-primary text-[12.5px]">
            {d.buyUnits.toLocaleString()} @ {d.ccy === "SGD" ? "S$" + NF(d.curPx, 2) : NF(d.curPx, 2) + " " + d.ccy}
          </span>
        </div>
        {d.ccy !== "SGD" && (
          <div className="flex items-center justify-between gap-3 text-[12.5px] -mt-1">
            <span className="font-ui text-secondary text-[11px]">FX {rate(d.curFx)}</span>
            <span />
          </div>
        )}
        <div className="my-1 h-px bg-subtle" />
        <div className="flex items-center justify-between gap-3 text-[12.5px]">
          <span className="font-ui" style={{ color: h.assetGain >= 0 ? "var(--gain)" : "var(--loss)" }}>
            Asset {h.assetGain >= 0 ? "gain" : "loss"}
          </span>
          <span className="font-mono text-[12.5px]" style={{ color: h.assetGain >= 0 ? "var(--gain)" : "var(--loss)" }}>
            {d.ccy !== "SGD" ? `${assetGainNative < 0 ? "−" : "+"}${NF(assetGainNative, 0)} ${d.ccy} = ` : ""}
            {fmtSigned(h.assetGain)}
          </span>
        </div>
        <div className="flex items-center justify-between gap-3 text-[12.5px]">
          <span className="font-ui" style={{ color: h.fxGain >= 0 ? "var(--fx-positive)" : "var(--fx-negative)" }}>
            FX {h.fxGain >= 0 ? "gain" : "drag"}
          </span>
          <span className="font-mono text-[12.5px]" style={{ color: h.fxGain >= 0 ? "var(--fx-positive)" : "var(--fx-negative)" }}>
            {h.fxGain === 0 ? "—" : fmtSigned(h.fxGain)}
          </span>
        </div>
        <div className="flex items-center justify-between gap-3 text-[12.5px] mt-[3px] border-t border-subtle pt-[7px]">
          <span className="font-ui text-primary font-semibold">Total gain</span>
          <span className="font-mono text-primary text-[12.5px] font-semibold">
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
        <div className="flex flex-col gap-2.5 rounded-[10px] border border-[rgba(239,68,68,0.18)] bg-[rgba(239,68,68,0.05)] px-3.5 py-3">
          <span className="font-ui" style={{ fontSize: 12.5 }}>Delete <strong>{h.name}</strong> permanently?</span>
          <div className="flex gap-2">
            <button className="flex flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-[9px] border border-subtle bg-transparent p-[9px] font-ui text-[12.5px] font-medium transition-all duration-150 text-secondary hover:border-[rgba(239,68,68,0.35)] hover:text-loss disabled:cursor-not-allowed disabled:opacity-50" onClick={handleDelete} disabled={saving}>
              {saving ? "Deleting…" : "Yes, delete"}
            </button>
            <button className="flex flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-[9px] border border-subtle bg-transparent p-[9px] font-ui text-[12.5px] font-medium transition-all duration-150 text-secondary hover:border-gold-soft hover:text-gold disabled:cursor-not-allowed disabled:opacity-50" onClick={() => setMode("view")}>Cancel</button>
          </div>
        </div>
      ) : (
        <div className="flex gap-2">
          <button className="flex flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-[9px] border border-subtle bg-transparent p-[9px] font-ui text-[12.5px] font-medium transition-all duration-150 text-secondary hover:border-gold-soft hover:text-gold disabled:cursor-not-allowed disabled:opacity-50" onClick={() => setMode("edit")}>
            <Icon name="sliders" size={13} />Edit
          </button>
          <button className="flex flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-[9px] border border-subtle bg-transparent p-[9px] font-ui text-[12.5px] font-medium transition-all duration-150 text-secondary hover:border-[rgba(239,68,68,0.35)] hover:text-loss disabled:cursor-not-allowed disabled:opacity-50" onClick={() => setMode("confirm-delete")}>
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
      const msg =
        refreshed > 0
          ? `Updated ${refreshed} holding${refreshed > 1 ? "s" : ""}${skipped > 0 ? ` · ${skipped} already fresh` : ""}`
          : "Prices up to date — snapshot recorded";
      setRefreshMsg(msg);
      toast.success(msg);
      router.refresh();
    } catch {
      setRefreshMsg("Refresh failed");
      toast.error("Refresh failed");
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
      className={"select-none border-b border-subtle px-4 py-3.5 font-ui text-[10.5px] font-semibold uppercase tracking-[.08em] text-muted light:border-b-black/[.12] " + (right ? "text-right" : "text-left")}
      onClick={k ? () => sortBy(k) : undefined}
      style={{ cursor: k ? "pointer" : "default" }}
    >
      {children}
      {k && (
        <span className="text-gold text-[11px]">
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
    <div className="flex w-full min-w-0 flex-col gap-[18px]">
      {/* filter bar */}
      <div className="flex flex-wrap items-center gap-3 max-bp768:gap-2 max-bp600:flex-col max-bp600:items-stretch animate-reveal">
        <div className="flex flex-1 items-center gap-[9px] rounded-[10px] border border-subtle bg-surface px-[13px] py-[9px] text-muted min-w-[220px] max-bp600:w-full max-bp600:min-w-0">
          <Icon name="search" size={15} />
          <input
            ref={searchRef}
            className="flex-1 border-none bg-transparent font-ui text-[13px] text-primary outline-none placeholder:text-muted"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search holdings…"
          />
          <kbd className="rounded-[4px] border border-subtle px-1.5 py-px font-mono text-[10px] text-muted">/</kbd>
        </div>
        <div className="flex flex-wrap gap-1.5 max-bp768:gap-1">
          {TYPES.map((t) => (
            <button
              key={t}
              className={"cursor-pointer rounded-lg border px-[13px] py-[7px] font-ui text-xs transition-all duration-150 max-bp768:px-2.5 max-bp768:py-1.5 max-bp768:text-[11.5px] " + (typeFilter === t ? "border-gold-soft bg-wash text-gold" : "border-subtle bg-surface text-secondary hover:border-muted hover:text-primary")}
              onClick={() => setTypeFilter(t)}
            >
              {t}
            </button>
          ))}
        </div>
        <button
          className={"flex cursor-pointer items-center gap-[7px] rounded-[9px] border bg-surface px-[13px] py-2 font-ui text-[12.5px] transition-all duration-150 hover:border-gold-soft hover:text-gold disabled:cursor-not-allowed disabled:opacity-50 " + (groupView ? "border-gold-soft text-gold" : "border-subtle text-secondary")}
          onClick={() => setGroupView((v) => !v)}
          title={groupView ? "Switch to flat view" : "Switch to grouped view"}
        >
          <Icon name={groupView ? "layers" : "list"} size={15} />
          <span className="font-ui">{groupView ? "Grouped" : "Flat"}</span>
        </button>
        <button className="flex cursor-pointer items-center gap-[7px] rounded-[9px] border border-subtle bg-surface px-[13px] py-2 font-ui text-[12.5px] text-secondary transition-all duration-150 hover:border-gold-soft hover:text-gold disabled:cursor-not-allowed disabled:opacity-50" onClick={handleCsvExport}>
          <Icon name="download" size={15} />
          <span className="font-ui">CSV</span>
        </button>
        <button className="flex cursor-pointer items-center gap-[7px] rounded-[9px] border border-subtle bg-surface px-[13px] py-2 font-ui text-[12.5px] text-secondary transition-all duration-150 hover:border-gold-soft hover:text-gold disabled:cursor-not-allowed disabled:opacity-50" onClick={handleRefresh} disabled={refreshing}>
          <Icon name={refreshing ? "loader" : "refresh-cw"} size={15} style={refreshing ? { animation: "spin 1s linear infinite" } : undefined} />
          <span className="font-ui">{refreshing ? "Refreshing…" : "Refresh Prices"}</span>
        </button>
        {refreshMsg && <span className="font-ui text-secondary text-[11px] tracking-[.04em] opacity-70 transition-opacity duration-300">{refreshMsg}</span>}
      </div>

      {/* table */}
      <div className="card p-0 overflow-x-auto overflow-y-hidden max-bp768:overflow-y-visible animate-reveal" style={{ animationDelay: ".05s" }}>
        <table className="w-full border-collapse max-bp768:min-w-[620px] [&_tbody_tr:last-child>td]:border-b-0">
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
                  const gStrat = STRAT[group.lots[0].strategy] ?? { label: group.lots[0].strategy, cls: STRAT_GRAY };
                  const gSel = !isMulti && picked.has(group.lots[0].id);

                  const groupRow = (
                    <tr
                      key={gk}
                      className={isMulti ? ROW_GROUP_HD : (gSel ? ROW_SEL : ROW_UNSEL)}
                      onClick={() => isMulti ? toggleGroup(gk) : toggle(group.lots[0])}
                    >
                      <td className={CELL + (gSel ? SEL_SHADOW : "")}>
                        <div className="flex items-center gap-2.5">
                          {isMulti && (
                            <span className="flex shrink-0 text-muted transition-transform duration-200" style={{ transform: expanded ? "rotate(0deg)" : "rotate(-90deg)" }}>
                              <Icon name="chevron" size={14} />
                            </span>
                          )}
                          <span className="grid size-7 shrink-0 place-items-center rounded-[7px] border border-subtle bg-elevated text-gold"><Icon name={group.icon as never} size={15} /></span>
                          <span className="font-ui text-[13px] overflow-hidden text-ellipsis whitespace-nowrap" style={isMulti ? { fontWeight: 600 } : undefined}>{group.name}</span>
                          {group.ticker !== "—" && <span className="font-mono text-[10.5px] tracking-[.05em] text-muted">{group.ticker}</span>}
                          {isMulti && <span className="ml-1 inline-flex items-center rounded-[5px] bg-[rgba(212,163,78,.12)] px-[7px] py-0.5 font-ui text-[10.5px] font-semibold tracking-[.04em] text-gold">{group.lots.length} lots</span>}
                        </div>
                      </td>
                      <td className={CELL}><span className="font-ui text-secondary">{group.assetType}</span></td>
                      <td className={CELL}><span className="font-ui text-secondary">{group.lots[0].broker}</span></td>
                      <td className={CELL}><span className={STRAT_BASE + " " + gStrat.cls}>{gStrat.label}</span></td>
                      <td className={CELL_R}>{fmtVal(group.valueSGD)}</td>
                      <td className={CELL_R} style={{ color: group.assetGain >= 0 ? "var(--gain)" : "var(--loss)" }}>{fmtSigned(group.assetGain)}</td>
                      <td className={CELL_R} style={{ color: group.fxGain > 0 ? "var(--fx-positive)" : group.fxGain < 0 ? "var(--fx-negative)" : "var(--text-muted)" }}>
                        {group.fxGain === 0 ? "—" : fmtSigned(group.fxGain)}
                      </td>
                      <td className={CELL_R_BOLD} style={{ color: gTotal >= 0 ? "var(--gain)" : "var(--loss)" }}>{pct(group.totalPct)}</td>
                      <td className={CELL}>
                        <span className="text-xs whitespace-nowrap">
                          {group.flag} <span className="font-mono text-secondary">{group.currency}</span>
                        </span>
                      </td>
                    </tr>
                  );

                  if (!isMulti || !expanded) return [groupRow];

                  const lotRows = group.lots.map((h) => {
                    const sel = picked.has(h.id);
                    const lotTotal = h.assetGain + h.fxGain;
                    const lStrat = STRAT[h.strategy] ?? { label: h.strategy, cls: STRAT_GRAY };
                    return (
                      <tr
                        key={h.id}
                        className={sel ? ROW_LOT_SEL : ROW_LOT_UNSEL}
                        onClick={(e) => { e.stopPropagation(); toggle(h); }}
                      >
                        <td className={LOT_CELL_FIRST + (sel ? SEL_SHADOW : "")}>
                          <div className="flex items-center gap-[7px]">
                            <span className="mb-[3px] size-2.5 shrink-0 rounded-bl-[2px] border-b-[1.5px] border-l-[1.5px] border-subtle" />
                            <span className="font-ui text-[13px] text-secondary overflow-hidden text-ellipsis whitespace-nowrap">{h.buyDate}</span>
                            <span className="font-mono text-secondary">· {h.units.toLocaleString()} units</span>
                          </div>
                        </td>
                        <td className={LOT_CELL}><span className="font-ui text-secondary">{h.assetType}</span></td>
                        <td className={LOT_CELL}><span className="font-ui text-secondary">{h.broker}</span></td>
                        <td className={LOT_CELL}><span className={STRAT_BASE + " " + lStrat.cls}>{lStrat.label}</span></td>
                        <td className={LOT_CELL_R}>{fmtVal(h.valueSGD)}</td>
                        <td className={LOT_CELL_R} style={{ color: h.assetGain >= 0 ? "var(--gain)" : "var(--loss)" }}>{fmtSigned(h.assetGain)}</td>
                        <td className={LOT_CELL_R} style={{ color: h.fxGain > 0 ? "var(--fx-positive)" : h.fxGain < 0 ? "var(--fx-negative)" : "var(--text-muted)" }}>
                          {h.fxGain === 0 ? "—" : fmtSigned(h.fxGain)}
                        </td>
                        <td className={LOT_CELL_R_BOLD} style={{ color: lotTotal >= 0 ? "var(--gain)" : "var(--loss)" }}>{pct(h.totalPct)}</td>
                        <td className={LOT_CELL} />
                      </tr>
                    );
                  });

                  return [groupRow, ...lotRows];
                })
              : rows.map((h) => {
                  const sel = picked.has(key(h));
                  const total = h.assetGain + h.fxGain;
                  const strat = STRAT[h.strategy] ?? { label: h.strategy, cls: STRAT_GRAY };
                  return (
                    <tr key={key(h)} className={sel ? ROW_SEL : ROW_UNSEL} onClick={() => toggle(h)}>
                      <td className={CELL + (sel ? SEL_SHADOW : "")}>
                        <div className="flex items-center gap-2.5">
                          <span className="grid size-7 shrink-0 place-items-center rounded-[7px] border border-subtle bg-elevated text-gold"><Icon name={h.icon as never} size={15} /></span>
                          <span className="font-ui text-[13px] overflow-hidden text-ellipsis whitespace-nowrap">{h.name}</span>
                          <span className="font-mono text-[10.5px] tracking-[.05em] text-muted">{h.ticker}</span>
                        </div>
                      </td>
                      <td className={CELL}><span className="font-ui text-secondary">{h.assetType}</span></td>
                      <td className={CELL}><span className="font-ui text-secondary">{h.broker}</span></td>
                      <td className={CELL}><span className={STRAT_BASE + " " + strat.cls}>{strat.label}</span></td>
                      <td className={CELL_R}>{fmtVal(h.valueSGD)}</td>
                      <td className={CELL_R} style={{ color: "var(--gain)" }}>{fmtSigned(h.assetGain)}</td>
                      <td className={CELL_R} style={{ color: h.fxGain > 0 ? "var(--fx-positive)" : h.fxGain < 0 ? "var(--fx-negative)" : "var(--text-muted)" }}>
                        {h.fxGain === 0 ? "—" : fmtSigned(h.fxGain)}
                      </td>
                      <td className={CELL_R_BOLD} style={{ color: total >= 0 ? "var(--gain)" : "var(--loss)" }}>{pct(h.totalPct)}</td>
                      <td className={CELL}>
                        <span className="text-xs whitespace-nowrap">
                          {h.flag} <span className="font-mono text-secondary">{h.currency}</span>
                        </span>
                      </td>
                    </tr>
                  );
                })
            }
            {(groupView ? groups : rows).length === 0 && (
              <tr>
                <td className="text-[13px]" colSpan={9} style={{ textAlign: "center", padding: "32px 0" }}>
                  <span className="font-ui text-secondary">No holdings match.</span>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* compare / inspector tray */}
      <div className="flex flex-col gap-3 animate-reveal" style={{ animationDelay: ".1s" }}>
        <div className="flex items-baseline justify-between">
          <span className="text-[13px] font-semibold tracking-[.01em] text-primary">Inspector</span>
          <span className="font-ui text-secondary text-[11.5px]">
            {compareCards.length
              ? `Comparing ${compareCards.length} holding${compareCards.length > 1 ? "s" : ""} · click rows to add or remove`
              : "Click a holding to inspect — open several to compare side by side"}
          </span>
        </div>
        {compareCards.length > 0 ? (
          <div className="flex gap-3.5 overflow-x-auto pb-1.5">
            {compareCards.map((h) => (
              <DetailCard key={key(h)} h={h} onClose={() => toggle(h)} />
            ))}
          </div>
        ) : (
          <div className="rounded-xl border border-dashed border-subtle bg-surface p-6 text-center text-[13px] font-ui text-secondary">No holdings selected.</div>
        )}
      </div>
    </div>
  );
}
