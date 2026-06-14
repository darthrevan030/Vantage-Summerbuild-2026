import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { HoldingRow } from "@/types/holding";
import type { UserSettings } from "@/types/settings";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  computeCurrentValueSGD,
  computeCostBasisSGD,
  computeAssetGainSGD,
  computeFxGainSGD,
} from "@/lib/fx";

async function makeServerClient() {
  const cookieStore = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(list) {
          list.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options),
          );
        },
      },
    },
  );
}

type ServerClient = Awaited<ReturnType<typeof makeServerClient>>;

// ── Normalised DB row shapes ──────────────────────────────────────────────────
// User data lives in `lots` + `instruments`; shared market data in `ticker_quotes`
// / `ticker_dividends`; per-user yield tweaks in `holding_overrides`.

interface DbInstrument {
  id: string;
  symbol: string;
  exchange_code: string | null;
  asset_type: string;
  currency: string;
  name: string;
  flag: string;
  icon: string;
  par_value: number | null;
  coupon_rate: number | null;
  maturity_date: string | null;
}

interface DbLot {
  id: string;
  user_id: string;
  instrument_id: string;
  transaction_type: "buy" | "sell";
  quantity: number;
  price: number;
  trade_date: string;
  fx_rate: number;
  fees: number;
  source: string;
  broker: string;
  strategy: string;
  notes: string | null;
  created_at: string;
  updated_at: string;
  instruments?: DbInstrument | null; // FK embed via select("*, instruments(*)")
}

interface DbQuote {
  symbol: string;
  current_price: number | null;
  prev_price: number | null;
  prev_price_source: string | null;
  spark_data: number[];
  price_source: string | null;
  refreshed_at: string | null;
}

interface DbDividend {
  symbol: string;
  yield_ttm: number | null;
  source: string | null;
}

interface DbOverride {
  user_id: string;
  instrument_id: string;
  dividend_yield: number | null;
}

// Combine a lot with its instrument and the shared market data into the flat
// HoldingRow shape the rest of the app already consumes.
function toHoldingRow(
  lot: DbLot,
  inst: DbInstrument,
  quote: DbQuote | undefined,
  fxMap: Record<string, number>,
  override: DbOverride | undefined,
  dividend: DbDividend | undefined,
): HoldingRow {
  const base = {
    id: lot.id,
    userId: lot.user_id,
    ticker: inst.symbol,
    name: inst.name,
    assetType: inst.asset_type,
    broker: lot.broker,
    strategy: lot.strategy,
    units: Number(lot.quantity),
    currency: inst.currency,
    flag: inst.flag,
    icon: inst.icon,
    buyPrice: Number(lot.price),
    buyDate: lot.trade_date,
    buyFxRate: Number(lot.fx_rate),
    currentPrice: quote?.current_price != null ? Number(quote.current_price) : 0,
    currentFxRate: fxMap[inst.currency] ?? 1,
    sparkData: Array.isArray(quote?.spark_data)
      ? quote!.spark_data.map(Number)
      : [],
    createdAt: lot.created_at,
    updatedAt: lot.updated_at,
    priceRefreshedAt: quote?.refreshed_at ?? null,
    source: lot.source ?? "",
    dividendYield:
      override?.dividend_yield != null ? Number(override.dividend_yield) : null,
    dividendYieldAuto:
      dividend?.yield_ttm != null ? Number(dividend.yield_ttm) : null,
    prevPrice: quote?.prev_price != null ? Number(quote.prev_price) : null,
    prevPriceSource: quote?.prev_price_source ?? null,
    maturityDate: inst.maturity_date ?? null,
    parValue: inst.par_value != null ? Number(inst.par_value) : null,
    couponRate: inst.coupon_rate != null ? Number(inst.coupon_rate) : null,
    transactionType: lot.transaction_type ?? "buy",
    fees: Number(lot.fees ?? 0),
  };

  const valueSGD = computeCurrentValueSGD(base);
  const costSGD = computeCostBasisSGD(base);
  const assetGain = computeAssetGainSGD(base);
  const fxGain = computeFxGainSGD(base);
  const totalPct = costSGD > 0 ? ((valueSGD - costSGD) / costSGD) * 100 : 0;

  return {
    ...base,
    costSGD,
    valueSGD,
    assetGain,
    fxGain,
    totalPct,
    detail: {
      buyUnits: base.units,
      buyPx: base.buyPrice,
      buyDate: base.buyDate,
      buyFx: base.buyFxRate,
      curPx: base.currentPrice,
      curFx: base.currentFxRate,
      ccy: base.currency,
    },
  };
}

// SGD-anchored FX map { SGD: 1, USD: 1.36, ... } from the currencies table.
async function fetchFxMap(
  supabase: ServerClient,
): Promise<Record<string, number>> {
  const { data } = await supabase.from("currencies").select("code, rate_sgd");
  const fxMap: Record<string, number> = { SGD: 1 };
  for (const c of (data ?? []) as { code: string; rate_sgd: number | null }[]) {
    if (c.rate_sgd != null) fxMap[c.code] = Number(c.rate_sgd);
  }
  return fxMap;
}

// Build a full HoldingRow for a single lot (used after insert/update).
async function hydrateLot(
  supabase: ServerClient,
  lot: DbLot,
): Promise<HoldingRow | null> {
  const inst = lot.instruments;
  if (!inst) return null;
  const [quoteRes, divRes, overrideRes, fxMap] = await Promise.all([
    supabase.from("ticker_quotes").select("*").eq("symbol", inst.symbol).maybeSingle(),
    supabase.from("ticker_dividends").select("*").eq("symbol", inst.symbol).maybeSingle(),
    supabase
      .from("holding_overrides")
      .select("*")
      .eq("user_id", lot.user_id)
      .eq("instrument_id", lot.instrument_id)
      .maybeSingle(),
    fetchFxMap(supabase),
  ]);
  return toHoldingRow(
    lot,
    inst,
    (quoteRes.data as DbQuote) ?? undefined,
    fxMap,
    (overrideRes.data as DbOverride) ?? undefined,
    (divRes.data as DbDividend) ?? undefined,
  );
}

export async function fetchHoldings(userId: string): Promise<HoldingRow[]> {
  const supabase = await makeServerClient();

  // 1. lots + embedded instrument (single FK join)
  const { data: lotsData, error } = await supabase
    .from("lots")
    .select("*, instruments(*)")
    .eq("user_id", userId)
    .order("created_at", { ascending: true });

  if (error) {
    console.error("[fetchHoldings]", error.message);
    return [];
  }

  const lots = (lotsData ?? []) as DbLot[];
  if (lots.length === 0) return [];

  const symbols = [
    ...new Set(lots.map((l) => l.instruments?.symbol).filter(Boolean) as string[]),
  ];

  // 2-4. shared market data + per-user overrides + FX, fetched in parallel
  const [quotesRes, dividendsRes, overridesRes, fxMap] = await Promise.all([
    supabase.from("ticker_quotes").select("*").in("symbol", symbols),
    supabase.from("ticker_dividends").select("*").in("symbol", symbols),
    supabase.from("holding_overrides").select("*").eq("user_id", userId),
    fetchFxMap(supabase),
  ]);

  const quoteMap = new Map<string, DbQuote>();
  for (const q of (quotesRes.data ?? []) as DbQuote[]) quoteMap.set(q.symbol, q);
  const divMap = new Map<string, DbDividend>();
  for (const d of (dividendsRes.data ?? []) as DbDividend[]) divMap.set(d.symbol, d);
  const overrideMap = new Map<string, DbOverride>();
  for (const o of (overridesRes.data ?? []) as DbOverride[])
    overrideMap.set(o.instrument_id, o);

  return lots
    .filter((lot) => lot.instruments)
    .map((lot) =>
      toHoldingRow(
        lot,
        lot.instruments!,
        quoteMap.get(lot.instruments!.symbol),
        fxMap,
        overrideMap.get(lot.instrument_id),
        divMap.get(lot.instruments!.symbol),
      ),
    );
}

// ── Instrument writes (shared data → service-role admin client) ───────────────

export interface InstrumentInput {
  symbol: string;
  exchangeCode?: string | null;
  assetType: string;
  currency: string;
  name: string;
  flag?: string;
  icon?: string;
  parValue?: number | null;
  couponRate?: number | null;
  maturityDate?: string | null;
}

// Insert-or-update the security and return its id. Admin client only: instrument
// metadata is shared across users, so user clients may read but never write it.
export async function upsertInstrument(
  data: InstrumentInput,
): Promise<string | null> {
  const admin = createAdminClient();
  const { data: row, error } = await admin
    .from("instruments")
    .upsert(
      {
        symbol: data.symbol,
        exchange_code: data.exchangeCode ?? null,
        asset_type: data.assetType,
        currency: data.currency,
        name: data.name,
        flag: data.flag ?? "🌐",
        icon: data.icon ?? "briefcase",
        par_value: data.parValue ?? null,
        coupon_rate: data.couponRate ?? null,
        maturity_date: data.maturityDate ?? null,
      },
      { onConflict: "symbol,exchange_code" },
    )
    .select("id")
    .single();
  if (error) {
    console.error("[upsertInstrument]", error.message);
    return null;
  }
  return row.id as string;
}

export async function updateInstrument(
  id: string,
  patch: Partial<{
    name: string;
    par_value: number | null;
    coupon_rate: number | null;
    maturity_date: string | null;
  }>,
): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin.from("instruments").update(patch).eq("id", id);
  if (error) console.error("[updateInstrument]", error.message);
}

// ── Lot writes (user data → user-scoped client, RLS enforced) ─────────────────

export interface LotInput {
  transactionType?: "buy" | "sell";
  quantity: number;
  price: number;
  tradeDate: string;
  fxRate?: number;
  fees?: number;
  source?: string;
  broker?: string;
  strategy?: string;
  notes?: string | null;
}

export async function insertLot(
  userId: string,
  instrumentId: string,
  payload: LotInput,
): Promise<HoldingRow | null> {
  const supabase = await makeServerClient();
  const { data, error } = await supabase
    .from("lots")
    .insert({
      user_id: userId,
      instrument_id: instrumentId,
      transaction_type: payload.transactionType ?? "buy",
      quantity: payload.quantity,
      price: payload.price,
      trade_date: payload.tradeDate,
      fx_rate: payload.fxRate ?? 1,
      fees: payload.fees ?? 0,
      source: payload.source ?? "",
      broker: payload.broker ?? "",
      strategy: payload.strategy ?? "",
      notes: payload.notes ?? null,
    })
    .select("*, instruments(*)")
    .single();
  if (error) {
    console.error("[insertLot]", error.message);
    return null;
  }
  return hydrateLot(supabase, data as DbLot);
}

export async function updateLot(
  id: string,
  userId: string,
  patch: Partial<{
    transaction_type: "buy" | "sell";
    quantity: number;
    price: number;
    trade_date: string;
    fx_rate: number;
    fees: number;
    source: string;
    broker: string;
    strategy: string;
    notes: string | null;
  }>,
): Promise<HoldingRow | null> {
  const supabase = await makeServerClient();
  const { data, error } = await supabase
    .from("lots")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("user_id", userId)
    .select("*, instruments(*)")
    .single();
  if (error) {
    console.error("[updateLot]", error.message);
    return null;
  }
  return hydrateLot(supabase, data as DbLot);
}

// Edit instrument-level fields via a lot the caller owns. The ownership check
// (lot belongs to userId) gates the admin-client write, so a user can only edit
// instruments they actually hold.
export async function updateInstrumentForLot(
  lotId: string,
  userId: string,
  patch: Partial<{
    name: string;
    par_value: number | null;
    coupon_rate: number | null;
    maturity_date: string | null;
  }>,
): Promise<boolean> {
  const supabase = await makeServerClient();
  const { data } = await supabase
    .from("lots")
    .select("instrument_id")
    .eq("id", lotId)
    .eq("user_id", userId)
    .maybeSingle();
  if (!data) return false;
  await updateInstrument(data.instrument_id as string, patch);
  return true;
}

export async function deleteLot(id: string, userId: string): Promise<void> {
  const supabase = await makeServerClient();
  // Scope by id AND user_id — prevents IDOR. The instrument row is left intact
  // because it may still be referenced by other users' lots.
  await supabase.from("lots").delete().eq("id", id).eq("user_id", userId);
}

// Per-user manual dividend-yield override for an instrument. Passing null clears
// it (falls back to the auto TTM yield from ticker_dividends).
export async function upsertHoldingOverride(
  userId: string,
  instrumentId: string,
  dividendYield: number | null,
): Promise<void> {
  const supabase = await makeServerClient();
  await supabase
    .from("holding_overrides")
    .upsert(
      { user_id: userId, instrument_id: instrumentId, dividend_yield: dividendYield },
      { onConflict: "user_id,instrument_id" },
    );
}

// ── Shared market-cache writes (admin client; RLS allows reads only) ──────────

export async function upsertTickerQuote(
  symbol: string,
  data: {
    currentPrice?: number | null;
    prevPrice?: number | null;
    prevPriceSource?: string | null;
    sparkData?: number[];
    priceSource?: string | null;
  },
): Promise<void> {
  const admin = createAdminClient();
  const row: Record<string, unknown> = {
    symbol,
    refreshed_at: new Date().toISOString(),
  };
  if (data.currentPrice != null) row.current_price = data.currentPrice;
  if (data.prevPrice != null) row.prev_price = data.prevPrice;
  if (data.prevPriceSource != null) row.prev_price_source = data.prevPriceSource;
  if (data.sparkData && data.sparkData.length >= 2) row.spark_data = data.sparkData;
  if (data.priceSource != null) row.price_source = data.priceSource;
  const { error } = await admin
    .from("ticker_quotes")
    .upsert(row, { onConflict: "symbol" });
  if (error) console.error("[upsertTickerQuote]", error.message);
}

// Seed a quote for a freshly added ticker ONLY if none exists yet, so a new
// holding shows a sensible price before the first refresh. ignoreDuplicates
// means an existing shared quote (e.g. live MSFT price) is never clobbered.
export async function seedTickerQuote(
  symbol: string,
  price: number,
  sparkData?: number[],
): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin.from("ticker_quotes").upsert(
    {
      symbol,
      current_price: price,
      spark_data: sparkData && sparkData.length >= 2 ? sparkData : [],
      price_source: "seed",
      // Leave refreshed_at NULL so the quote is immediately "stale" and the next
      // price refresh replaces this seed (buy price) with the live market price.
      refreshed_at: null,
    },
    { onConflict: "symbol", ignoreDuplicates: true },
  );
  if (error) console.error("[seedTickerQuote]", error.message);
}

export async function upsertTickerDividend(
  symbol: string,
  yieldTtm: number,
  source: string,
): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin.from("ticker_dividends").upsert(
    {
      symbol,
      yield_ttm: yieldTtm,
      source,
      refreshed_at: new Date().toISOString(),
    },
    { onConflict: "symbol" },
  );
  if (error) console.error("[upsertTickerDividend]", error.message);
}

export async function upsertTickerHistory(
  symbol: string,
  dailyCloses: number[],
  monthlyCloses: number[],
): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin.from("ticker_history").upsert(
    {
      symbol,
      daily_closes: dailyCloses,
      monthly_closes: monthlyCloses,
      cached_date: new Date().toISOString().slice(0, 10),
    },
    { onConflict: "symbol" },
  );
  if (error) console.error("[upsertTickerHistory]", error.message);
}

// Read the full daily FX history cache: { currency: { "YYYY-MM-DD": rate } }.
export async function fetchFxRateHistory(): Promise<
  Record<string, Record<string, number>>
> {
  const supabase = await makeServerClient();
  const { data } = await supabase.from("fx_history").select("currency, rates");
  const out: Record<string, Record<string, number>> = {};
  for (const r of (data ?? []) as {
    currency: string;
    rates: Record<string, number>;
  }[]) {
    out[r.currency] = r.rates ?? {};
  }
  return out;
}

export async function upsertFxHistory(
  currency: string,
  rates: Record<string, number>,
): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin.from("fx_history").upsert(
    { currency, rates, refreshed_at: new Date().toISOString() },
    { onConflict: "currency" },
  );
  if (error) console.error("[upsertFxHistory]", error.message);
}

export async function updateFxRate(
  currency: string,
  rateSgd: number,
): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin
    .from("currencies")
    .update({ rate_sgd: rateSgd })
    .eq("code", currency);
  if (error) console.error("[updateFxRate]", error.message);
}

// ── Cash balances ─────────────────────────────────────────────────────────────

export async function fetchCashBalances(
  userId: string,
): Promise<{ currency: string; amount: number }[]> {
  const supabase = await makeServerClient();
  const { data } = await supabase
    .from("cash_balances")
    .select("currency, amount")
    .eq("user_id", userId)
    .order("currency");
  return (data ?? []).map((r) => ({
    currency: r.currency as string,
    amount: Number(r.amount),
  }));
}

export async function upsertCashBalance(
  userId: string,
  currency: string,
  amount: number,
): Promise<void> {
  const supabase = await makeServerClient();
  await supabase
    .from("cash_balances")
    .upsert({ user_id: userId, currency, amount }, { onConflict: "user_id,currency" });
}

// ── CPF balances ──────────────────────────────────────────────────────────────

export async function fetchCpfBalances(userId: string): Promise<{
  oa: number;
  sa: number;
  ma: number;
  ra: number;
  asAtDate: string;
} | null> {
  const supabase = await makeServerClient();
  const { data } = await supabase
    .from("cpf_balances")
    .select("oa, sa, ma, ra, as_at_date")
    .eq("user_id", userId)
    .maybeSingle();
  if (!data) return null;
  return {
    oa: Number(data.oa),
    sa: Number(data.sa),
    ma: Number(data.ma),
    ra: Number(data.ra),
    asAtDate: data.as_at_date as string,
  };
}

export async function upsertCpfBalances(
  userId: string,
  patch: Partial<{ oa: number; sa: number; ma: number; ra: number; asAtDate: string }>,
): Promise<void> {
  const supabase = await makeServerClient();
  const row: Record<string, unknown> = {
    user_id: userId,
    updated_at: new Date().toISOString(),
  };
  if (patch.oa !== undefined) row.oa = patch.oa;
  if (patch.sa !== undefined) row.sa = patch.sa;
  if (patch.ma !== undefined) row.ma = patch.ma;
  if (patch.ra !== undefined) row.ra = patch.ra;
  if (patch.asAtDate !== undefined) row.as_at_date = patch.asAtDate;
  await supabase.from("cpf_balances").upsert(row, { onConflict: "user_id" });
}

export async function fetchUserSettings(userId: string): Promise<UserSettings> {
  const supabase = await makeServerClient();
  const { data } = await supabase
    .from("user_settings")
    .select("display_name, base_currency, role")
    .eq("user_id", userId)
    .single();
  return {
    displayName: data?.display_name ?? "",
    baseCurrency: data?.base_currency ?? "SGD",
    role: data?.role ?? "user",
  };
}

export interface SnapshotRow {
  recordedDate: string;
  valueSgd: number;
  costSgd: number;
  fxImpactSgd: number;
  fxByCurrency: Record<string, number>;
}

// PostgREST caps every response at the project's "Max rows" setting (default 1000),
// which silently truncates a client-side .limit(). Page with .range() so the full
// snapshot history comes through regardless of that cap or how many rows accrue.
const SNAPSHOT_PAGE = 1000;

export async function fetchSnapshots(userId: string): Promise<SnapshotRow[]> {
  const supabase = await makeServerClient();
  const rows: SnapshotRow[] = [];

  for (let from = 0; ; from += SNAPSHOT_PAGE) {
    const { data, error } = await supabase
      .from("portfolio_snapshots")
      .select(
        "recorded_date, value_sgd, cost_sgd, fx_impact_sgd, fx_by_currency",
      )
      .eq("user_id", userId)
      .order("recorded_date", { ascending: true })
      .range(from, from + SNAPSHOT_PAGE - 1);

    if (error) {
      console.error("[fetchSnapshots]", error.message);
      break;
    }
    if (!data || data.length === 0) break;

    for (const r of data) {
      rows.push({
        recordedDate: r.recorded_date as string,
        valueSgd: Number(r.value_sgd),
        costSgd: Number(r.cost_sgd),
        fxImpactSgd: Number(r.fx_impact_sgd),
        fxByCurrency: (r.fx_by_currency ?? {}) as Record<string, number>,
      });
    }

    // A short page means we've reached the end — no further request needed.
    if (data.length < SNAPSHOT_PAGE) break;
  }

  return rows;
}

export async function recordSnapshot(
  userId: string,
  holdings: HoldingRow[],
): Promise<void> {
  const valueSgd = holdings.reduce((s, h) => s + h.valueSGD, 0);
  const costSgd = holdings.reduce((s, h) => s + h.costSGD, 0);
  const fxImpactSgd = holdings.reduce((s, h) => s + h.fxGain, 0);
  const fxByCurrency: Record<string, number> = {};
  for (const h of holdings) {
    if (h.currency !== "SGD") {
      const k = h.currency.toLowerCase();
      fxByCurrency[k] = (fxByCurrency[k] ?? 0) + h.fxGain;
    }
  }
  const supabase = await makeServerClient();
  await supabase.from("portfolio_snapshots").upsert(
    {
      user_id: userId,
      recorded_date: new Date().toISOString().slice(0, 10),
      value_sgd: Math.round(valueSgd),
      cost_sgd: Math.round(costSgd),
      fx_impact_sgd: Math.round(fxImpactSgd),
      fx_by_currency: fxByCurrency,
    },
    { onConflict: "user_id,recorded_date" },
  );
}

export async function upsertUserSettings(
  userId: string,
  settings: Partial<UserSettings>,
): Promise<void> {
  const supabase = await makeServerClient();
  await supabase.from("user_settings").upsert(
    {
      user_id: userId,
      ...(settings.displayName !== undefined && {
        display_name: settings.displayName,
      }),
      ...(settings.baseCurrency !== undefined && {
        base_currency: settings.baseCurrency,
      }),
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" },
  );
}
