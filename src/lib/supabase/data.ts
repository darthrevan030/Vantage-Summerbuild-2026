import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { HoldingRow } from "@/types/holding";
import type { UserSettings } from "@/types/settings";
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
        getAll() { return cookieStore.getAll(); },
        setAll(list) { list.forEach(({ name, value, options }) => cookieStore.set(name, value, options)); },
      },
    }
  );
}

interface DbHolding {
  id: string;
  user_id: string;
  ticker: string;
  name: string;
  asset_type: string;
  broker: string;
  strategy: string;
  units: number;
  currency: string;
  flag: string;
  icon: string;
  buy_price: number;
  buy_date: string;
  buy_fx_rate: number;
  current_price: number;
  current_fx_rate: number;
  spark_data: number[];
  notes: string | null;
  created_at: string;
  updated_at: string;
  price_refreshed_at: string | null;
}

function toHoldingRow(db: DbHolding): HoldingRow {
  const base = {
    id: db.id,
    userId: db.user_id,
    ticker: db.ticker,
    name: db.name,
    assetType: db.asset_type,
    broker: db.broker,
    strategy: db.strategy,
    units: Number(db.units),
    currency: db.currency,
    flag: db.flag,
    icon: db.icon,
    buyPrice: Number(db.buy_price),
    buyDate: db.buy_date,
    buyFxRate: Number(db.buy_fx_rate),
    currentPrice: Number(db.current_price),
    currentFxRate: Number(db.current_fx_rate),
    sparkData: Array.isArray(db.spark_data) ? db.spark_data.map(Number) : [],
    createdAt: db.created_at,
    updatedAt: db.updated_at,
    priceRefreshedAt: db.price_refreshed_at,
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

export async function fetchHoldings(userId: string): Promise<HoldingRow[]> {
  const supabase = await makeServerClient();
  const { data, error } = await supabase
    .from("holdings")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: true });

  if (error) {
    console.error("[fetchHoldings]", error.message);
    return [];
  }

  return (data as DbHolding[]).map(toHoldingRow);
}

export async function insertHolding(
  payload: Omit<DbHolding, "id" | "created_at" | "updated_at">
): Promise<HoldingRow | null> {
  const supabase = await makeServerClient();
  const { data, error } = await supabase
    .from("holdings")
    .insert(payload)
    .select()
    .single();

  if (error) {
    console.error("[insertHolding]", error.message);
    return null;
  }

  return toHoldingRow(data as DbHolding);
}

export async function updateHolding(
  id: string,
  userId: string,
  patch: Partial<Pick<DbHolding,
    "ticker" | "name" | "asset_type" | "broker" | "strategy" | "units" |
    "currency" | "buy_price" | "buy_date" | "buy_fx_rate" | "current_price" | "current_fx_rate"
  >>
): Promise<HoldingRow | null> {
  const supabase = await makeServerClient();
  const { data, error } = await supabase
    .from("holdings")
    .update(patch)
    .eq("id", id)
    .eq("user_id", userId)
    .select()
    .single();
  if (error) { console.error("[updateHolding]", error.message); return null; }
  return toHoldingRow(data as DbHolding);
}

export async function updateHoldingPrice(
  id: string,
  currentPrice: number,
  currentFxRate: number,
  userId: string,
  sparkData?: number[]
): Promise<void> {
  const supabase = await makeServerClient();
  const patch: Record<string, unknown> = {
    current_price: currentPrice,
    current_fx_rate: currentFxRate,
    price_refreshed_at: new Date().toISOString(),
  };
  if (sparkData && sparkData.length >= 2) patch.spark_data = sparkData;
  await supabase.from("holdings").update(patch).eq("id", id).eq("user_id", userId);
}

export async function deleteHolding(id: string, userId: string): Promise<void> {
  const supabase = await makeServerClient();
  // Scope by both id AND user_id — prevents IDOR when multiple users share the table
  await supabase.from("holdings").delete().eq("id", id).eq("user_id", userId);
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
      .select("recorded_date, value_sgd, cost_sgd, fx_impact_sgd, fx_by_currency")
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

export async function recordSnapshot(userId: string, holdings: HoldingRow[]): Promise<void> {
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
    { onConflict: "user_id,recorded_date" }
  );
}

export async function upsertUserSettings(
  userId: string,
  settings: Partial<UserSettings>
): Promise<void> {
  const supabase = await makeServerClient();
  await supabase.from("user_settings").upsert(
    {
      user_id: userId,
      ...(settings.displayName !== undefined && { display_name: settings.displayName }),
      ...(settings.baseCurrency !== undefined && { base_currency: settings.baseCurrency }),
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" }
  );
}
