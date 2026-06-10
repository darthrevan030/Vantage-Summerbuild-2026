"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/Icon";
import { Select } from "@/components/Select";
import { fetchFx } from "@/lib/api-client";
import { toast } from "sonner";
import { useCurrencies } from "@/hooks/useCurrencies";
import { useExchanges } from "@/hooks/useExchanges";

const ASSET_TYPES = ["Equity", "ETF", "REIT", "Gold", "RE"];

const PHYSICAL_TYPES = new Set(["Gold", "RE"]);

const STRAT_LABEL: Record<string, string> = {
  long_term: "Long Term", active: "Active", speculative: "Speculative", physical: "Physical",
};

const CCY_FLAGS: Record<string, string> = {
  SGD: "🇸🇬", USD: "🇺🇸", EUR: "🇪🇺", AUD: "🇦🇺", GBP: "🇬🇧", INR: "🇮🇳", JPY: "🇯🇵", HKD: "🇭🇰",
};

const TYPE_ICON: Record<string, string> = {
  Equity: "briefcase", ETF: "layers", REIT: "landmark", Gold: "gem", RE: "building",
};

// ---- reusable field primitive ----
function Field({ label, full, children }: { label: string; full?: boolean; children: React.ReactNode }) {
  return (
    <label className={"flex flex-col gap-1.5" + (full ? " col-span-full" : "")}>
      <span className="font-ui text-[12px] text-secondary">{label}</span>
      {children}
    </label>
  );
}

// ---- CSV column mapper ----
interface CsvRow { [key: string]: string }

const CSV_FIELD_MAP: Record<string, string> = {
  Name: "name", "Asset Name": "name", "Stock Name": "name",
  Ticker: "ticker", Symbol: "ticker",
  "Asset Type": "asset_type", Type: "asset_type",
  Strategy: "strategy",
  Broker: "broker",
  Units: "units", Qty: "units", Quantity: "units", Shares: "units",
  Currency: "currency", CCY: "currency",
  "Purchase Price": "buy_price", "Buy Price": "buy_price", Price: "buy_price",
  "Purchase Date": "buy_date", "Date Bought": "buy_date", Date: "buy_date",
  "FX Rate": "buy_fx_rate", "Purchase FX Rate": "buy_fx_rate",
};

function parseCsv(text: string): { headers: string[]; rows: CsvRow[] } {
  const lines = text.trim().split("\n");
  const headers = lines[0].split(",").map((h) => h.trim().replace(/^"|"$/g, ""));
  const rows = lines.slice(1).map((line) => {
    const vals = line.split(",").map((v) => v.trim().replace(/^"|"$/g, ""));
    return Object.fromEntries(headers.map((h, i) => [h, vals[i] ?? ""]));
  });
  return { headers, rows };
}

const TODAY = new Date().toISOString().slice(0, 10);

const EMPTY_FORM = {
  name: "", ticker: "", exchange: "US", asset_type: "Equity", strategy: "long_term",
  broker: "", units: "", currency: "USD", buy_price: "",
  buy_date: TODAY,
  buy_fx_rate: "", notes: "",
};

// ---- manual entry form ----
function ManualForm() {
  const router = useRouter();
  const currencies = useCurrencies();
  const exchanges  = useExchanges();
  const [form, setForm] = useState(EMPTY_FORM);
  const [fetchingFx, setFetchingFx] = useState(false);
  const [fxAuto, setFxAuto]         = useState(false);
  const [saving, setSaving]         = useState(false);
  const [error, setError]           = useState("");
  const fxDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }));

  // Auto-fetch historical FX rate when date or currency changes.
  // All state updates run inside the scheduled callback (SGD with 0 delay,
  // others debounced) so none fire synchronously during the effect.
  useEffect(() => {
    if (fxDebounce.current) clearTimeout(fxDebounce.current);
    const isSgd = form.currency === "SGD";
    if (!isSgd && form.buy_date.length < 10) return;

    fxDebounce.current = setTimeout(async () => {
      if (isSgd) { set("buy_fx_rate", "1"); setFxAuto(true); return; }
      setFetchingFx(true);
      try {
        const today = new Date().toISOString().slice(0, 10);
        const date = form.buy_date <= today ? form.buy_date : undefined;
        const rates = await fetchFx("SGD", date);
        const rate = rates[form.currency];
        if (rate) { set("buy_fx_rate", (1 / rate).toFixed(4)); setFxAuto(true); }
      } catch { /* silent — user can still type manually */ }
      finally { setFetchingFx(false); }
    }, isSgd ? 0 : 400);

    return () => { if (fxDebounce.current) clearTimeout(fxDebounce.current); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.buy_date, form.currency]);

  const handleFetchFx = async () => {
    if (form.currency === "SGD") { set("buy_fx_rate", "1"); setFxAuto(true); return; }
    setFetchingFx(true);
    try {
      const rates = await fetchFx("SGD", form.buy_date || undefined);
      const rate = rates[form.currency];
      if (rate) { set("buy_fx_rate", (1 / rate).toFixed(4)); setFxAuto(true); }
    } catch {
      setError("Could not fetch rate.");
    } finally {
      setFetchingFx(false);
    }
  };

  const handleSubmit = async () => {
    setError(""); setSaving(true);
    try {
      const units     = parseFloat(form.units);
      const buy_price = parseFloat(form.buy_price);

      if (!form.name.trim())           throw new Error("Asset name is required");
      if (isNaN(units) || units <= 0)  throw new Error("Units must be a positive number");
      if (isNaN(buy_price) || buy_price <= 0) throw new Error("Purchase price must be a positive number");
      if (!form.buy_date)              throw new Error("Purchase date is required");
      if (form.buy_date > TODAY)       throw new Error("Purchase date cannot be in the future");

      // Append exchange suffix so EODHD/Finnhub know which market to query
      const baseTicker = form.ticker.toUpperCase() || "—";
      const tickerWithExchange = baseTicker !== "—" && form.exchange
        ? `${baseTicker}.${form.exchange}`
        : baseTicker;

      const fxRate = parseFloat(form.buy_fx_rate || "1") || 1;
      const payload = {
        ticker:          tickerWithExchange,
        name:            form.name.trim(),
        asset_type:      form.asset_type,
        broker:          form.broker,
        strategy:        form.strategy,
        units,
        currency:        form.currency,
        flag:            CCY_FLAGS[form.currency] ?? "🌐",
        icon:            TYPE_ICON[form.asset_type] ?? "briefcase",
        buy_price,
        buy_date:        form.buy_date,
        buy_fx_rate:     fxRate,
        current_price:   buy_price,
        current_fx_rate: fxRate,
        spark_data:      [buy_price],
        notes:           form.notes || null,
      };
      const res = await fetch("/api/holdings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) { const e = await res.json(); throw new Error(e.error ?? "Save failed"); }
      toast.success(`${form.name.trim()} added to portfolio`);
      setForm(EMPTY_FORM);
      setFxAuto(false);
      router.refresh();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Save failed";
      setError(msg);
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="card animate-reveal px-5 py-4.5 max-bp768:overflow-hidden max-bp480:p-3.5 max-bp380:p-3">
      <div className="flex items-baseline justify-between mb-4 max-bp600:flex-wrap max-bp600:gap-2 max-bp600:items-center">
        <span className="text-[13px] font-semibold text-primary tracking-[.01em]">Manual Entry</span>
        <span className="font-ui text-secondary text-[11px]">add a position</span>
      </div>
      <div className="grid grid-cols-2 gap-3.5 max-bp768:grid-cols-1">
        <Field label="Asset Name" full>
          <input className="inp" placeholder="e.g. Microsoft Corp." value={form.name} onChange={(e) => set("name", e.target.value)} />
        </Field>
        <Field label="Ticker">
          <input className="inp" placeholder="MSFT" value={form.ticker} onChange={(e) => set("ticker", e.target.value.toUpperCase())} />
        </Field>
        {!PHYSICAL_TYPES.has(form.asset_type) && (
          <Field label="Exchange">
            <Select
              value={exchanges.find((ex) => ex.code === form.exchange)?.label ?? "— No exchange (physical / unlisted)"}
              options={exchanges.map((ex) => ex.label)}
              onChange={(label) => set("exchange", exchanges.find((ex) => ex.label === label)?.code ?? "")}
            />
          </Field>
        )}
        <Field label="Asset Type">
          <Select value={form.asset_type} options={ASSET_TYPES} onChange={(v) => {
            set("asset_type", v);
            if (PHYSICAL_TYPES.has(v)) set("exchange", "");
          }} />
        </Field>
        <Field label="Strategy">
          <Select value={STRAT_LABEL[form.strategy]} options={Object.values(STRAT_LABEL)} onChange={(v) => {
            const k = Object.entries(STRAT_LABEL).find(([, lbl]) => lbl === v)?.[0] ?? "long_term";
            set("strategy", k);
          }} />
        </Field>
        <Field label="Broker / Custodian">
          <input className="inp" placeholder="Tiger" value={form.broker} onChange={(e) => set("broker", e.target.value)} />
        </Field>
        <Field label="Units">
          <input className="inp" type="number" placeholder="100" min="0" step="any" value={form.units} onChange={(e) => set("units", e.target.value)} />
        </Field>
        <Field label="Currency">
          <Select value={CCY_FLAGS[form.currency] + " " + form.currency} options={currencies.map((c) => (CCY_FLAGS[c] ?? "🌐") + " " + c)} onChange={(v) => set("currency", v.split(" ")[1])} />
        </Field>
        <Field label="Purchase Price">
          <input className="inp" type="number" placeholder="412.50" min="0" step="any" value={form.buy_price} onChange={(e) => set("buy_price", e.target.value)} />
        </Field>
        <Field label="Purchase Date">
          <input className="inp" type="date" value={form.buy_date} max={TODAY} onChange={(e) => set("buy_date", e.target.value)} />
        </Field>
        <Field label="Purchase FX Rate" full>
          <div className="flex gap-2.5 items-stretch">
            <div style={{ position: "relative", flex: 1 }}>
              <input
                className="inp"
                type="number"
                placeholder={form.currency === "SGD" ? "1.0000" : "1.3690"}
                value={form.buy_fx_rate}
                onChange={(e) => { set("buy_fx_rate", e.target.value); setFxAuto(false); }}
                style={{ width: "100%", paddingRight: fxAuto ? "46px" : undefined }}
              />
              {fxAuto && (
                <span style={{
                  position: "absolute", right: "10px", top: "50%", transform: "translateY(-50%)",
                  fontSize: "9px", letterSpacing: ".08em", color: "var(--gain)",
                  fontFamily: "var(--mono)", pointerEvents: "none",
                }}>AUTO</span>
              )}
            </div>
            <button className="flex items-center gap-[7px] cursor-pointer rounded-[9px] border border-subtle bg-surface px-2.5 py-1.5 font-ui text-[11.5px] text-secondary transition-all duration-150 hover:border-gold-soft hover:text-gold disabled:cursor-not-allowed disabled:opacity-50" onClick={handleFetchFx} disabled={fetchingFx}>
              <Icon name="refresh" size={14} />
              <span className="font-ui">{fetchingFx ? "Fetching…" : "Fetch rate"}</span>
            </button>
          </div>
        </Field>
        <Field label="Notes" full>
          <input className="inp" placeholder="optional" value={form.notes} onChange={(e) => set("notes", e.target.value)} />
        </Field>

        {error && <div className="font-ui" style={{ color: "var(--loss)", gridColumn: "1 / -1", fontSize: 12 }}>{error}</div>}

        <button className="col-span-full mt-1 flex items-center justify-center gap-2 cursor-pointer rounded-[10px] bg-gold p-[13px] font-ui text-[13.5px] font-semibold text-[#15130c] [transition:filter_.15s,transform_.1s] hover:brightness-[1.08] active:translate-y-px disabled:opacity-60 disabled:saturate-[.7] disabled:cursor-default" onClick={handleSubmit} disabled={saving || !form.name.trim() || !form.buy_price}>
          <Icon name="plus" size={16} />
          {saving ? "Saving…" : "Add Holding"}
        </button>
      </div>
    </div>
  );
}

// ---- import & backup panel ----
function ImportPanel() {
  const router       = useRouter();
  const fileRef      = useRef<HTMLInputElement>(null);
  const [drag, setDrag]     = useState(false);
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows]       = useState<CsvRow[]>([]);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [importing, setImporting] = useState(false);
  const [result, setResult]       = useState("");

  const handleFile = (file: File) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      const parsed = parseCsv(text);
      setHeaders(parsed.headers);
      setRows(parsed.rows);
      // auto-map known column names
      const autoMap: Record<string, string> = {};
      for (const h of parsed.headers) {
        const target = CSV_FIELD_MAP[h];
        if (target) autoMap[h] = target;
      }
      setMapping(autoMap);
      setResult("");
    };
    reader.readAsText(file);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault(); setDrag(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  };

  const handleImport = async () => {
    setImporting(true); setResult("");
    let ok = 0, fail = 0;
    for (const row of rows) {
      const name = row[Object.entries(mapping).find(([, v]) => v === "name")?.[0] ?? ""] ?? "";
      const ticker = row[Object.entries(mapping).find(([, v]) => v === "ticker")?.[0] ?? ""] ?? "—";
      const asset_type = row[Object.entries(mapping).find(([, v]) => v === "asset_type")?.[0] ?? ""] || "Equity";
      const buy_price = parseFloat(row[Object.entries(mapping).find(([, v]) => v === "buy_price")?.[0] ?? ""] ?? "0");
      const buy_date = row[Object.entries(mapping).find(([, v]) => v === "buy_date")?.[0] ?? ""] || new Date().toISOString().slice(0, 10);
      const units = parseFloat(row[Object.entries(mapping).find(([, v]) => v === "units")?.[0] ?? ""] ?? "0");
      const currency = row[Object.entries(mapping).find(([, v]) => v === "currency")?.[0] ?? ""] || "SGD";
      if (!name || !buy_price) { fail++; continue; }
      try {
        const res = await fetch("/api/holdings", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name, ticker: ticker || "—", asset_type, broker: "Imported", strategy: "long_term",
            units: units || 1, currency, flag: CCY_FLAGS[currency] ?? "🌐",
            icon: TYPE_ICON[asset_type] ?? "briefcase",
            buy_price, buy_date, buy_fx_rate: 1, current_price: buy_price, current_fx_rate: 1,
            spark_data: [buy_price],
          }),
        });
        if (res.ok) ok++; else fail++;
      } catch { fail++; }
    }
    const summary = `Imported ${ok} holding${ok !== 1 ? "s" : ""}${fail > 0 ? ` · ${fail} failed` : ""}.`;
    setResult(summary);
    setImporting(false);
    if (fail > 0) toast.error(summary);
    else if (ok > 0) toast.success(summary);
    if (ok > 0) router.refresh();
  };

  const FIELD_OPTIONS = ["(ignore)", "name", "ticker", "asset_type", "strategy", "broker", "units", "currency", "buy_price", "buy_date", "buy_fx_rate"];

  return (
    <div className="card animate-reveal px-5 py-4.5 max-bp768:overflow-hidden max-bp480:p-3.5 max-bp380:p-3" style={{ animationDelay: ".06s" }}>
      <div className="flex items-baseline justify-between mb-4 max-bp600:flex-wrap max-bp600:gap-2 max-bp600:items-center">
        <span className="text-[13px] font-semibold text-primary tracking-[.01em]">Import &amp; Backup</span>
        <span className="font-ui text-secondary text-[11px]">CSV · XLSX · JSON</span>
      </div>

      <input ref={fileRef} type="file" accept=".csv,.txt" style={{ display: "none" }} onChange={(e) => { if (e.target.files?.[0]) handleFile(e.target.files[0]); }} />

      <div
        className={
          "flex flex-col items-center gap-[7px] text-center border-[1.5px] border-dashed rounded-[13px] cursor-pointer px-5 py-[30px] [transition:background_.2s,border-color_.2s] " +
          (drag
            ? "bg-elevated border-gold"
            : "bg-surface border-gold-soft hover:bg-elevated hover:border-gold")
        }
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={handleDrop}
        onClick={() => fileRef.current?.click()}
        style={{ cursor: "pointer" }}
      >
        <Icon name="upload" size={26} style={{ color: "var(--gold)" }} />
        <div className="font-ui text-[14px] font-semibold mt-1">Drop CSV here</div>
        <div className="font-ui text-secondary">or click to browse</div>
        <div className="font-ui text-secondary text-[11px] tracking-[.04em] mt-2">Supported: Tiger · Saxo · DBS Vickers · IBKR · Moomoo</div>
      </div>

      {headers.length > 0 && (
        <div className="mt-[18px] flex flex-col gap-[9px]">
          <div className="flex justify-between text-[10.5px] uppercase tracking-[.08em] pb-1 font-ui text-secondary">
            <span>Your Column</span><span>Maps To</span>
          </div>
          {headers.map((h) => (
            <div className="grid grid-cols-[1fr_18px_1fr] items-center gap-2.5" key={h}>
              <span className="font-mono text-[12.5px] text-secondary">&quot;{h}&quot;</span>
              <Icon name="arrow" size={13} className="text-muted" />
              <div className="relative">
                <select
                  value={mapping[h] ?? "(ignore)"}
                  onChange={(e) => setMapping((m) => ({ ...m, [h]: e.target.value }))}
                  style={{ position: "absolute", inset: 0, opacity: 0, cursor: "pointer", width: "100%", height: "100%" }}
                >
                  {FIELD_OPTIONS.map((o) => <option key={o} value={o}>{o}</option>)}
                </select>
                <span className="font-ui">{mapping[h] ?? "(ignore)"}</span>
                <Icon name="chevron" size={14} />
              </div>
            </div>
          ))}
          <div className="flex items-center gap-[7px] text-[12px] text-secondary mt-1 font-ui">
            <Icon name="check" size={13} style={{ color: "var(--gain)" }} />
            {Object.values(mapping).filter((v) => v !== "(ignore)").length} of {headers.length} columns mapped
          </div>
          {result && <div className="font-ui" style={{ color: result.includes("failed") ? "var(--loss)" : "var(--gain)", marginTop: 8 }}>{result}</div>}
          <button className="col-span-full mt-1 flex items-center justify-center gap-2 cursor-pointer rounded-[10px] bg-gold p-[13px] font-ui text-[13.5px] font-semibold text-[#15130c] [transition:filter_.15s,transform_.1s] hover:brightness-[1.08] active:translate-y-px disabled:opacity-60 disabled:saturate-[.7] disabled:cursor-default" style={{ marginTop: 8 }} onClick={handleImport} disabled={importing || rows.length === 0}>
            <Icon name="upload" size={15} />
            {importing ? "Importing…" : `Import ${rows.length} rows`}
          </button>
        </div>
      )}

      <div className="flex gap-3 mt-5">
        <button className="flex flex-1 items-center justify-center gap-[7px] cursor-pointer rounded-[9px] border border-subtle p-[11px] font-ui text-[12.5px] text-secondary transition-all duration-150 hover:border-gold-soft hover:text-primary light:border-black/[.12]" onClick={() => {
          fetch("/api/holdings").then((r) => r.json()).then((data) => {
            const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
            const a = document.createElement("a"); a.href = url; a.download = "portfolio-backup.json"; a.click();
            URL.revokeObjectURL(url);
          });
        }}>
          <Icon name="download" size={15} />Export JSON
        </button>
      </div>
      <div className="font-ui text-secondary text-[11px] tracking-[.04em] text-center mt-3">Your data is stored in Supabase — export anytime to keep a local copy.</div>
    </div>
  );
}

export default function AddPage() {
  return (
    <div className="flex flex-col gap-4.5 min-w-0 w-full">
      <div className="grid grid-cols-2 gap-4.5 items-start max-bp1080:grid-cols-1">
        <ManualForm />
        <ImportPanel />
      </div>
    </div>
  );
}
