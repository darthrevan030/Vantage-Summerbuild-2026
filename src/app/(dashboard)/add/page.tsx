"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/Icon";
import { Select } from "@/components/Select";
import { fetchFx } from "@/lib/api-client";
import { toast } from "sonner";
import { useCurrencies } from "@/hooks/useCurrencies";
import { useExchanges } from "@/hooks/useExchanges";

const ASSET_TYPES = ["Equity", "ETF", "REIT", "Gold", "RE", "Bond", "T-Bill"];

const PHYSICAL_TYPES = new Set(["Gold", "RE"]);
const FIXED_INCOME_TYPES = new Set(["Bond", "T-Bill"]);

// Fund-source options (maps the human label ↔ the value the API expects)
const SOURCE_LABEL: Record<string, string> = {
  "": "— None",
  Cash: "Cash",
  CPF: "CPF",
  SRS: "SRS",
};
const TXN_LABEL: Record<string, string> = { buy: "Buy", sell: "Sell" };

const STRAT_LABEL: Record<string, string> = {
  long_term: "Long Term",
  active: "Active",
  speculative: "Speculative",
  physical: "Physical",
};

const CCY_FLAGS: Record<string, string> = {
  SGD: "🇸🇬",
  USD: "🇺🇸",
  EUR: "🇪🇺",
  AUD: "🇦🇺",
  GBP: "🇬🇧",
  INR: "🇮🇳",
  JPY: "🇯🇵",
  HKD: "🇭🇰",
};

const TYPE_ICON: Record<string, string> = {
  Equity: "briefcase",
  ETF: "layers",
  REIT: "landmark",
  Gold: "gem",
  RE: "building",
  Bond: "landmark",
  "T-Bill": "landmark",
};

// ---- reusable field primitive ----
function Field({
  label,
  full,
  children,
}: {
  label: string;
  full?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className={"flex flex-col gap-1.5" + (full ? " col-span-full" : "")}>
      <span className="font-ui text-[12px] text-secondary">{label}</span>
      {children}
    </label>
  );
}

// ---- CSV column mapper ----
interface CsvRow {
  [key: string]: string;
}

const CSV_FIELD_MAP: Record<string, string> = {
  Name: "name",
  "Asset Name": "name",
  "Stock Name": "name",
  Ticker: "ticker",
  Symbol: "ticker",
  "Asset Type": "asset_type",
  Type: "asset_type",
  Strategy: "strategy",
  Broker: "broker",
  Units: "units",
  Qty: "units",
  Quantity: "units",
  Shares: "units",
  Currency: "currency",
  CCY: "currency",
  "Purchase Price": "buy_price",
  "Buy Price": "buy_price",
  Price: "buy_price",
  "Purchase Date": "buy_date",
  "Date Bought": "buy_date",
  Date: "buy_date",
  "FX Rate": "buy_fx_rate",
  "Purchase FX Rate": "buy_fx_rate",
};

function parseCsv(text: string): { headers: string[]; rows: CsvRow[] } {
  const lines = text.trim().split("\n");
  const headers = lines[0]
    .split(",")
    .map((h) => h.trim().replace(/^"|"$/g, ""));
  const rows = lines.slice(1).map((line) => {
    const vals = line.split(",").map((v) => v.trim().replace(/^"|"$/g, ""));
    return Object.fromEntries(headers.map((h, i) => [h, vals[i] ?? ""]));
  });
  return { headers, rows };
}

const TODAY = new Date().toISOString().slice(0, 10);

const EMPTY_FORM = {
  name: "",
  ticker: "",
  exchange: "US",
  asset_type: "Equity",
  strategy: "long_term",
  broker: "",
  units: "",
  currency: "USD",
  buy_price: "",
  buy_date: TODAY,
  buy_fx_rate: "",
  notes: "",
  // SGX / lot fields
  transaction_type: "buy",
  source: "",
  fees: "",
  dividend_yield: "",
  dividend_unit: "pct", // "pct" = % yield · "dps" = dividend per share
  // Fixed-income (Bond / T-Bill) fields
  maturity_date: "",
  par_value: "",
  coupon_rate: "",
};

// ---- CPF balance editor ----
// CPF isn't a tradable instrument — OA/SA/MA/RA are running balances on one
// account, snapshotted at a date. So this writes to cpf_balances via /api/cpf,
// not to holdings. Existing balances preload so you edit rather than overwrite.
const CPF_ACCOUNTS: [keyof typeof EMPTY_CPF, string, string][] = [
  ["oa", "Ordinary Account (OA)", "45000"],
  ["sa", "Special Account (SA)", "28000"],
  ["ma", "MediSave (MA)", "12500"],
  ["ra", "Retirement Account (RA)", "0"],
];
const EMPTY_CPF = { oa: "", sa: "", ma: "", ra: "", asAtDate: TODAY };

function CpfForm() {
  const router = useRouter();
  const [form, setForm] = useState(EMPTY_CPF);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const set = (k: keyof typeof form, v: string) =>
    setForm((f) => ({ ...f, [k]: v }));

  useEffect(() => {
    let alive = true;
    fetch("/api/cpf")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (alive && d?.balances) {
          const b = d.balances;
          setForm({
            oa: b.oa ? String(b.oa) : "",
            sa: b.sa ? String(b.sa) : "",
            ma: b.ma ? String(b.ma) : "",
            ra: b.ra ? String(b.ra) : "",
            asAtDate: b.asAtDate || TODAY,
          });
        }
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  const handleSubmit = async () => {
    setError("");
    const num = (v: string) => (v.trim() === "" ? 0 : parseFloat(v));
    const vals = { oa: num(form.oa), sa: num(form.sa), ma: num(form.ma), ra: num(form.ra) };
    if (Object.values(vals).some((n) => isNaN(n) || n < 0)) {
      const msg = "Balances must be zero or positive.";
      setError(msg);
      toast.error(msg);
      return;
    }
    if (vals.oa + vals.sa + vals.ma + vals.ra <= 0) {
      const msg = "Enter at least one balance.";
      setError(msg);
      toast.error(msg);
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/cpf", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...vals, asAtDate: form.asAtDate }),
      });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        throw new Error((e as { error?: string }).error ?? "Save failed");
      }
      toast.success("CPF balances saved");
      setForm(EMPTY_CPF);
      router.refresh();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Save failed";
      setError(msg);
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="grid grid-cols-2 gap-3.5 max-bp768:grid-cols-1">
      {CPF_ACCOUNTS.map(([k, label, ph]) => (
        <Field key={k} label={label}>
          <input
            className="inp"
            type="number"
            min="0"
            step="any"
            placeholder={ph}
            value={form[k]}
            onChange={(e) => set(k, e.target.value)}
          />
        </Field>
      ))}
      <Field label="As at date" full>
        <input
          className="inp"
          type="date"
          max={TODAY}
          value={form.asAtDate}
          onChange={(e) => set("asAtDate", e.target.value)}
        />
      </Field>
      {error && (
        <div
          className="font-ui"
          style={{ color: "var(--loss)", gridColumn: "1 / -1", fontSize: 12 }}
        >
          {error}
        </div>
      )}
      <button
        className="col-span-full mt-1 flex items-center justify-center gap-2 cursor-pointer rounded-[10px] bg-gold p-[13px] font-ui text-[13.5px] font-semibold text-[#15130c] [transition:filter_.15s,transform_.1s] hover:brightness-[1.08] active:translate-y-px disabled:opacity-60 disabled:saturate-[.7] disabled:cursor-default"
        onClick={handleSubmit}
        disabled={saving}
      >
        <Icon name="plus" size={16} />
        {saving ? "Saving…" : "Save CPF Balances"}
      </button>
    </div>
  );
}

// ---- Cash balance editor ----
// Plain cash per currency → cash_balances via /api/cash (one currency at a
// time). Existing balances are listed so the user has context; picking a
// currency that already has a value preloads the amount for editing.
function CashForm() {
  const router = useRouter();
  const currencies = useCurrencies();
  const [existing, setExisting] = useState<
    { currency: string; amount: number }[]
  >([]);
  const [currency, setCurrency] = useState("SGD");
  const [amount, setAmount] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const load = () =>
    fetch("/api/cash")
      .then((r) => (r.ok ? r.json() : []))
      .then((rows) => setExisting(Array.isArray(rows) ? rows : []))
      .catch(() => {});
  useEffect(() => {
    load();
  }, []);

  const pickCurrency = (c: string) => {
    setCurrency(c);
    const ex = existing.find((r) => r.currency === c);
    setAmount(ex ? String(ex.amount) : "");
  };

  const handleSubmit = async () => {
    setError("");
    const amt = parseFloat(amount);
    if (isNaN(amt) || amt < 0) {
      const msg = "Amount must be zero or positive.";
      setError(msg);
      toast.error(msg);
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/cash", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currency, amount: amt }),
      });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        throw new Error((e as { error?: string }).error ?? "Save failed");
      }
      toast.success(`${currency} cash balance saved`);
      setAmount("");
      await load();
      router.refresh();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Save failed";
      setError(msg);
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="grid grid-cols-2 gap-3.5 max-bp768:grid-cols-1">
      <Field label="Currency">
        <Select
          value={CCY_FLAGS[currency] + " " + currency}
          options={currencies.map((c) => (CCY_FLAGS[c] ?? "🌐") + " " + c)}
          onChange={(v) => pickCurrency(v.split(" ")[1])}
        />
      </Field>
      <Field label="Amount">
        <input
          className="inp"
          type="number"
          min="0"
          step="any"
          placeholder="10000"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
      </Field>
      {existing.length > 0 && (
        <div className="col-span-full flex flex-wrap gap-2">
          {existing.map((c) => (
            <span
              key={c.currency}
              className="flex items-center gap-1.5 rounded-[9px] border border-subtle bg-elevated px-2.5 py-1.5 font-mono text-[12px] text-secondary"
            >
              {c.currency} {c.amount.toLocaleString()}
            </span>
          ))}
        </div>
      )}
      {error && (
        <div
          className="font-ui"
          style={{ color: "var(--loss)", gridColumn: "1 / -1", fontSize: 12 }}
        >
          {error}
        </div>
      )}
      <button
        className="col-span-full mt-1 flex items-center justify-center gap-2 cursor-pointer rounded-[10px] bg-gold p-[13px] font-ui text-[13.5px] font-semibold text-[#15130c] [transition:filter_.15s,transform_.1s] hover:brightness-[1.08] active:translate-y-px disabled:opacity-60 disabled:saturate-[.7] disabled:cursor-default"
        onClick={handleSubmit}
        disabled={saving}
      >
        <Icon name="plus" size={16} />
        {saving ? "Saving…" : "Save Cash Balance"}
      </button>
    </div>
  );
}

// ---- manual entry form ----
const ENTRY_TYPES: [string, string][] = [
  ["holding", "Holding"],
  ["cpf", "CPF"],
  ["cash", "Cash"],
];
const ENTRY_SUBTITLE: Record<string, string> = {
  holding: "add a position",
  cpf: "update CPF balances",
  cash: "update cash balances",
};

function ManualForm() {
  const router = useRouter();
  const currencies = useCurrencies();
  const exchanges = useExchanges();
  const [entryType, setEntryType] = useState("holding");
  const [form, setForm] = useState(EMPTY_FORM);
  const [fetchingFx, setFetchingFx] = useState(false);
  const [fxAuto, setFxAuto] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const fxDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  const set = (k: keyof typeof form, v: string) =>
    setForm((f) => ({ ...f, [k]: v }));

  // Auto-fetch historical FX rate when date or currency changes.
  // All state updates run inside the scheduled callback (SGD with 0 delay,
  // others debounced) so none fire synchronously during the effect.
  useEffect(() => {
    if (fxDebounce.current) clearTimeout(fxDebounce.current);
    const isSgd = form.currency === "SGD";
    if (!isSgd && form.buy_date.length < 10) return;

    fxDebounce.current = setTimeout(
      async () => {
        if (isSgd) {
          set("buy_fx_rate", "1");
          setFxAuto(true);
          return;
        }
        setFetchingFx(true);
        try {
          const today = new Date().toISOString().slice(0, 10);
          const date = form.buy_date <= today ? form.buy_date : undefined;
          const rates = await fetchFx("SGD", date);
          const rate = rates[form.currency];
          if (rate) {
            set("buy_fx_rate", (1 / rate).toFixed(4));
            setFxAuto(true);
          }
        } catch {
          /* silent — user can still type manually */
        } finally {
          setFetchingFx(false);
        }
      },
      isSgd ? 0 : 400,
    );

    return () => {
      if (fxDebounce.current) clearTimeout(fxDebounce.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.buy_date, form.currency]);

  const handleFetchFx = async () => {
    if (form.currency === "SGD") {
      set("buy_fx_rate", "1");
      setFxAuto(true);
      return;
    }
    setFetchingFx(true);
    try {
      const rates = await fetchFx("SGD", form.buy_date || undefined);
      const rate = rates[form.currency];
      if (rate) {
        set("buy_fx_rate", (1 / rate).toFixed(4));
        setFxAuto(true);
      }
    } catch {
      setError("Could not fetch rate.");
    } finally {
      setFetchingFx(false);
    }
  };

  const handleSubmit = async () => {
    setError("");
    setSaving(true);
    try {
      const units = parseFloat(form.units);
      const buy_price = parseFloat(form.buy_price);

      if (!form.name.trim()) throw new Error("Asset name is required");
      if (isNaN(units) || units <= 0)
        throw new Error("Units must be a positive number");
      if (isNaN(buy_price) || buy_price <= 0)
        throw new Error("Purchase price must be a positive number");
      if (!form.buy_date) throw new Error("Purchase date is required");
      if (form.buy_date > TODAY)
        throw new Error("Purchase date cannot be in the future");

      // Append exchange suffix so EODHD/Finnhub know which market to query
      const baseTicker = form.ticker.toUpperCase() || "—";
      const tickerWithExchange =
        baseTicker !== "—" && form.exchange
          ? `${baseTicker}.${form.exchange}`
          : baseTicker;

      const fxRate = parseFloat(form.buy_fx_rate || "1") || 1;
      const isFixedIncome = FIXED_INCOME_TYPES.has(form.asset_type);
      const num = (v: string) => (v.trim() === "" ? null : parseFloat(v));
      // Dividend stored as % yield; a $/share entry converts via the buy price
      // (yield% = DPS / price × 100), which is the current price for a new lot.
      const divNum = num(form.dividend_yield);
      const dividendYield =
        divNum == null
          ? null
          : form.dividend_unit === "dps"
            ? buy_price > 0
              ? (divNum / buy_price) * 100
              : divNum
            : divNum;
      const payload = {
        ticker: tickerWithExchange,
        name: form.name.trim(),
        asset_type: form.asset_type,
        broker: form.broker,
        strategy: form.strategy,
        units,
        currency: form.currency,
        flag: CCY_FLAGS[form.currency] ?? "🌐",
        icon: TYPE_ICON[form.asset_type] ?? "briefcase",
        buy_price,
        buy_date: form.buy_date,
        buy_fx_rate: fxRate,
        current_price: buy_price,
        current_fx_rate: fxRate,
        spark_data: [buy_price],
        notes: form.notes || null,
        // Lot fields
        transaction_type: form.transaction_type,
        source: form.source,
        fees: num(form.fees) ?? 0,
        dividend_yield: dividendYield,
        // Fixed-income instrument fields (only sent for Bond / T-Bill)
        maturity_date: isFixedIncome ? form.maturity_date || null : null,
        par_value: isFixedIncome ? num(form.par_value) : null,
        coupon_rate: isFixedIncome ? num(form.coupon_rate) : null,
      };
      const res = await fetch("/api/holdings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const e = await res.json();
        throw new Error(e.error ?? "Save failed");
      }
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
        <span className="text-[13px] font-semibold text-primary tracking-[.01em]">
          Manual Entry
        </span>
        <span className="font-ui text-secondary text-[11px]">
          {ENTRY_SUBTITLE[entryType]}
        </span>
      </div>
      <div className="mb-4 flex gap-1.5">
        {ENTRY_TYPES.map(([val, label]) => (
          <button
            key={val}
            className={
              "cursor-pointer rounded-lg border px-[13px] py-[7px] font-ui text-xs transition-all duration-150 " +
              (entryType === val
                ? "border-gold-soft bg-wash text-gold"
                : "border-subtle bg-surface text-secondary hover:border-muted hover:text-primary")
            }
            onClick={() => setEntryType(val)}
          >
            {label}
          </button>
        ))}
      </div>

      {entryType === "cpf" && <CpfForm />}
      {entryType === "cash" && <CashForm />}

      {entryType === "holding" && (
        <div className="grid grid-cols-2 gap-3.5 max-bp768:grid-cols-1">
        <Field label="Asset Name" full>
          <input
            className="inp"
            placeholder="e.g. Microsoft Corp."
            value={form.name}
            onChange={(e) => set("name", e.target.value)}
          />
        </Field>
        <Field label="Ticker">
          <input
            className="inp"
            placeholder="MSFT"
            value={form.ticker}
            onChange={(e) => set("ticker", e.target.value.toUpperCase())}
          />
        </Field>
        {!PHYSICAL_TYPES.has(form.asset_type) && (
          <Field label="Exchange">
            <Select
              value={
                exchanges.find((ex) => ex.code === form.exchange)?.label ??
                "— No exchange (physical / unlisted)"
              }
              options={exchanges.map((ex) => ex.label)}
              onChange={(label) =>
                set(
                  "exchange",
                  exchanges.find((ex) => ex.label === label)?.code ?? "",
                )
              }
            />
          </Field>
        )}
        <Field label="Asset Type">
          <Select
            value={form.asset_type}
            options={ASSET_TYPES}
            onChange={(v) => {
              set("asset_type", v);
              if (PHYSICAL_TYPES.has(v)) set("exchange", "");
            }}
          />
        </Field>
        <Field label="Strategy">
          <Select
            value={STRAT_LABEL[form.strategy]}
            options={Object.values(STRAT_LABEL)}
            onChange={(v) => {
              const k =
                Object.entries(STRAT_LABEL).find(([, lbl]) => lbl === v)?.[0] ??
                "long_term";
              set("strategy", k);
            }}
          />
        </Field>
        <Field label="Broker / Custodian">
          <input
            className="inp"
            placeholder="Tiger"
            value={form.broker}
            onChange={(e) => set("broker", e.target.value)}
          />
        </Field>
        <Field label="Units">
          <input
            className="inp"
            type="number"
            placeholder="100"
            min="0"
            step="any"
            value={form.units}
            onChange={(e) => set("units", e.target.value)}
          />
        </Field>
        <Field label="Currency">
          <Select
            value={CCY_FLAGS[form.currency] + " " + form.currency}
            options={currencies.map((c) => (CCY_FLAGS[c] ?? "🌐") + " " + c)}
            onChange={(v) => set("currency", v.split(" ")[1])}
          />
        </Field>
        <Field label="Purchase Price">
          <input
            className="inp"
            type="number"
            placeholder="412.50"
            min="0"
            step="any"
            value={form.buy_price}
            onChange={(e) => set("buy_price", e.target.value)}
          />
        </Field>
        <Field label="Purchase Date">
          <input
            className="inp"
            type="date"
            value={form.buy_date}
            max={TODAY}
            onChange={(e) => set("buy_date", e.target.value)}
          />
        </Field>
        <Field label="Purchase FX Rate" full>
          <div className="flex gap-2.5 items-stretch">
            <div style={{ position: "relative", flex: 1 }}>
              <input
                className="inp"
                type="number"
                placeholder={form.currency === "SGD" ? "1.0000" : "1.3690"}
                value={form.buy_fx_rate}
                onChange={(e) => {
                  set("buy_fx_rate", e.target.value);
                  setFxAuto(false);
                }}
                style={{
                  width: "100%",
                  paddingRight: fxAuto ? "46px" : undefined,
                }}
              />
              {fxAuto && (
                <span
                  style={{
                    position: "absolute",
                    right: "10px",
                    top: "50%",
                    transform: "translateY(-50%)",
                    fontSize: "9px",
                    letterSpacing: ".08em",
                    color: "var(--gain)",
                    fontFamily: "var(--mono)",
                    pointerEvents: "none",
                  }}
                >
                  AUTO
                </span>
              )}
            </div>
            <button
              className="flex items-center gap-[7px] cursor-pointer rounded-[9px] border border-subtle bg-surface px-2.5 py-1.5 font-ui text-[11.5px] text-secondary transition-all duration-150 hover:border-gold-soft hover:text-gold disabled:cursor-not-allowed disabled:opacity-50"
              onClick={handleFetchFx}
              disabled={fetchingFx}
            >
              <Icon name="refresh" size={14} />
              <span className="font-ui">
                {fetchingFx ? "Fetching…" : "Fetch rate"}
              </span>
            </button>
          </div>
        </Field>
        <Field label="Transaction">
          <Select
            value={TXN_LABEL[form.transaction_type]}
            options={Object.values(TXN_LABEL)}
            onChange={(v) => set("transaction_type", v === "Sell" ? "sell" : "buy")}
          />
        </Field>
        <Field label="Fund Source">
          <Select
            value={SOURCE_LABEL[form.source]}
            options={Object.values(SOURCE_LABEL)}
            onChange={(v) =>
              set(
                "source",
                Object.entries(SOURCE_LABEL).find(([, lbl]) => lbl === v)?.[0] ??
                  "",
              )
            }
          />
        </Field>
        <Field label="Fees">
          <input
            className="inp"
            type="number"
            placeholder="0"
            min="0"
            step="any"
            value={form.fees}
            onChange={(e) => set("fees", e.target.value)}
          />
        </Field>
        <Field label="Dividend (optional)">
          <div className="flex gap-1.5">
            <input
              className="inp flex-1"
              type="number"
              placeholder={form.dividend_unit === "dps" ? "0.42" : "auto"}
              min="0"
              step="any"
              value={form.dividend_yield}
              onChange={(e) => set("dividend_yield", e.target.value)}
            />
            <div className="flex shrink-0 overflow-hidden rounded-[8px] border border-subtle">
              {(["pct", "dps"] as const).map((u) => (
                <button
                  key={u}
                  type="button"
                  className={
                    "cursor-pointer px-2.5 py-1.5 font-ui text-[11.5px] transition-colors duration-150 " +
                    (form.dividend_unit === u
                      ? "bg-wash text-gold"
                      : "bg-surface text-secondary hover:text-primary")
                  }
                  onClick={() => set("dividend_unit", u)}
                >
                  {u === "pct" ? "%" : "$/sh"}
                </button>
              ))}
            </div>
          </div>
          {form.dividend_unit === "dps" &&
            form.dividend_yield.trim() !== "" &&
            parseFloat(form.buy_price) > 0 && (
              <span className="font-ui text-[10.5px] text-muted">
                ≈{" "}
                {(
                  (parseFloat(form.dividend_yield) / parseFloat(form.buy_price)) *
                  100
                ).toFixed(2)}
                % at this price
              </span>
            )}
        </Field>

        {FIXED_INCOME_TYPES.has(form.asset_type) && (
          <>
            <Field label="Maturity Date">
              <input
                className="inp"
                type="date"
                value={form.maturity_date}
                onChange={(e) => set("maturity_date", e.target.value)}
              />
            </Field>
            <Field label="Par Value">
              <input
                className="inp"
                type="number"
                placeholder="100"
                min="0"
                step="any"
                value={form.par_value}
                onChange={(e) => set("par_value", e.target.value)}
              />
            </Field>
            <Field label="Coupon Rate %">
              <input
                className="inp"
                type="number"
                placeholder="3.5"
                min="0"
                step="any"
                value={form.coupon_rate}
                onChange={(e) => set("coupon_rate", e.target.value)}
              />
            </Field>
          </>
        )}

        <Field label="Notes" full>
          <input
            className="inp"
            placeholder="optional"
            value={form.notes}
            onChange={(e) => set("notes", e.target.value)}
          />
        </Field>

        {error && (
          <div
            className="font-ui"
            style={{ color: "var(--loss)", gridColumn: "1 / -1", fontSize: 12 }}
          >
            {error}
          </div>
        )}

        <button
          className="col-span-full mt-1 flex items-center justify-center gap-2 cursor-pointer rounded-[10px] bg-gold p-[13px] font-ui text-[13.5px] font-semibold text-[#15130c] [transition:filter_.15s,transform_.1s] hover:brightness-[1.08] active:translate-y-px disabled:opacity-60 disabled:saturate-[.7] disabled:cursor-default"
          onClick={handleSubmit}
          disabled={saving || !form.name.trim() || !form.buy_price}
        >
          <Icon name="plus" size={16} />
          {saving ? "Saving…" : "Add Holding"}
        </button>
        </div>
      )}
    </div>
  );
}

// ---- import & backup panel ----
function ImportPanel() {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<CsvRow[]>([]);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState("");

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
    e.preventDefault();
    setDrag(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  };

  const handleImport = async () => {
    setImporting(true);
    setResult("");
    let ok = 0,
      fail = 0;
    for (const row of rows) {
      const name =
        row[Object.entries(mapping).find(([, v]) => v === "name")?.[0] ?? ""] ??
        "";
      const ticker =
        row[
          Object.entries(mapping).find(([, v]) => v === "ticker")?.[0] ?? ""
        ] ?? "—";
      const asset_type =
        row[
          Object.entries(mapping).find(([, v]) => v === "asset_type")?.[0] ?? ""
        ] || "Equity";
      const buy_price = parseFloat(
        row[
          Object.entries(mapping).find(([, v]) => v === "buy_price")?.[0] ?? ""
        ] ?? "0",
      );
      const buy_date =
        row[
          Object.entries(mapping).find(([, v]) => v === "buy_date")?.[0] ?? ""
        ] || new Date().toISOString().slice(0, 10);
      const units = parseFloat(
        row[
          Object.entries(mapping).find(([, v]) => v === "units")?.[0] ?? ""
        ] ?? "0",
      );
      const currency =
        row[
          Object.entries(mapping).find(([, v]) => v === "currency")?.[0] ?? ""
        ] || "SGD";
      if (!name || !buy_price) {
        fail++;
        continue;
      }
      try {
        const res = await fetch("/api/holdings", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name,
            ticker: ticker || "—",
            asset_type,
            broker: "Imported",
            strategy: "long_term",
            units: units || 1,
            currency,
            flag: CCY_FLAGS[currency] ?? "🌐",
            icon: TYPE_ICON[asset_type] ?? "briefcase",
            buy_price,
            buy_date,
            buy_fx_rate: 1,
            current_price: buy_price,
            current_fx_rate: 1,
            spark_data: [buy_price],
          }),
        });
        if (res.ok) ok++;
        else fail++;
      } catch {
        fail++;
      }
    }
    const summary = `Imported ${ok} holding${ok !== 1 ? "s" : ""}${fail > 0 ? ` · ${fail} failed` : ""}.`;
    setResult(summary);
    setImporting(false);
    if (fail > 0) toast.error(summary);
    else if (ok > 0) toast.success(summary);
    if (ok > 0) router.refresh();
  };

  const FIELD_OPTIONS = [
    "(ignore)",
    "name",
    "ticker",
    "asset_type",
    "strategy",
    "broker",
    "units",
    "currency",
    "buy_price",
    "buy_date",
    "buy_fx_rate",
  ];

  return (
    <div
      className="card animate-reveal px-5 py-4.5 max-bp768:overflow-hidden max-bp480:p-3.5 max-bp380:p-3"
      style={{ animationDelay: ".06s" }}
    >
      <div className="flex items-baseline justify-between mb-4 max-bp600:flex-wrap max-bp600:gap-2 max-bp600:items-center">
        <span className="text-[13px] font-semibold text-primary tracking-[.01em]">
          Import &amp; Backup
        </span>
        <span className="font-ui text-secondary text-[11px]">
          CSV · XLSX · JSON
        </span>
      </div>

      <input
        ref={fileRef}
        type="file"
        accept=".csv,.txt"
        style={{ display: "none" }}
        onChange={(e) => {
          if (e.target.files?.[0]) handleFile(e.target.files[0]);
        }}
      />

      <div
        className={
          "flex flex-col items-center gap-[7px] text-center border-[1.5px] border-dashed rounded-[13px] cursor-pointer px-5 py-[30px] [transition:background_.2s,border-color_.2s] " +
          (drag
            ? "bg-elevated border-gold"
            : "bg-surface border-gold-soft hover:bg-elevated hover:border-gold")
        }
        onDragOver={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={handleDrop}
        onClick={() => fileRef.current?.click()}
        style={{ cursor: "pointer" }}
      >
        <Icon name="upload" size={26} style={{ color: "var(--gold)" }} />
        <div className="font-ui text-[14px] font-semibold mt-1">
          Drop CSV here
        </div>
        <div className="font-ui text-secondary">or click to browse</div>
        <div className="font-ui text-secondary text-[11px] tracking-[.04em] mt-2">
          Supported: Tiger · Saxo · DBS Vickers · IBKR · Moomoo
        </div>
      </div>

      {headers.length > 0 && (
        <div className="mt-[18px] flex flex-col gap-[9px]">
          <div className="flex justify-between text-[10.5px] uppercase tracking-[.08em] pb-1 font-ui text-secondary">
            <span>Your Column</span>
            <span>Maps To</span>
          </div>
          {headers.map((h) => (
            <div
              className="grid grid-cols-[1fr_18px_1fr] items-center gap-2.5"
              key={h}
            >
              <span className="font-mono text-[12.5px] text-secondary">
                &quot;{h}&quot;
              </span>
              <Icon name="arrow" size={13} className="text-muted" />
              <div className="relative">
                <select
                  value={mapping[h] ?? "(ignore)"}
                  onChange={(e) =>
                    setMapping((m) => ({ ...m, [h]: e.target.value }))
                  }
                  style={{
                    position: "absolute",
                    inset: 0,
                    opacity: 0,
                    cursor: "pointer",
                    width: "100%",
                    height: "100%",
                  }}
                >
                  {FIELD_OPTIONS.map((o) => (
                    <option key={o} value={o}>
                      {o}
                    </option>
                  ))}
                </select>
                <span className="font-ui">{mapping[h] ?? "(ignore)"}</span>
                <Icon name="chevron" size={14} />
              </div>
            </div>
          ))}
          <div className="flex items-center gap-[7px] text-[12px] text-secondary mt-1 font-ui">
            <Icon name="check" size={13} style={{ color: "var(--gain)" }} />
            {
              Object.values(mapping).filter((v) => v !== "(ignore)").length
            } of {headers.length} columns mapped
          </div>
          {result && (
            <div
              className="font-ui"
              style={{
                color: result.includes("failed")
                  ? "var(--loss)"
                  : "var(--gain)",
                marginTop: 8,
              }}
            >
              {result}
            </div>
          )}
          <button
            className="col-span-full mt-1 flex items-center justify-center gap-2 cursor-pointer rounded-[10px] bg-gold p-[13px] font-ui text-[13.5px] font-semibold text-[#15130c] [transition:filter_.15s,transform_.1s] hover:brightness-[1.08] active:translate-y-px disabled:opacity-60 disabled:saturate-[.7] disabled:cursor-default"
            style={{ marginTop: 8 }}
            onClick={handleImport}
            disabled={importing || rows.length === 0}
          >
            <Icon name="upload" size={15} />
            {importing ? "Importing…" : `Import ${rows.length} rows`}
          </button>
        </div>
      )}

      <div className="flex gap-3 mt-5">
        <button
          className="flex flex-1 items-center justify-center gap-[7px] cursor-pointer rounded-[9px] border border-subtle p-[11px] font-ui text-[12.5px] text-secondary transition-all duration-150 hover:border-gold-soft hover:text-primary light:border-black/[.12]"
          onClick={() => {
            fetch("/api/holdings")
              .then((r) => r.json())
              .then((data) => {
                const url = URL.createObjectURL(
                  new Blob([JSON.stringify(data, null, 2)], {
                    type: "application/json",
                  }),
                );
                const a = document.createElement("a");
                a.href = url;
                a.download = "portfolio-backup.json";
                a.click();
                URL.revokeObjectURL(url);
              });
          }}
        >
          <Icon name="download" size={15} />
          Export JSON
        </button>
      </div>
      <div className="font-ui text-secondary text-[11px] tracking-[.04em] text-center mt-3">
        Your data is stored in Supabase — export anytime to keep a local copy.
      </div>
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
