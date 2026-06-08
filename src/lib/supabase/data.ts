import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { HoldingRow } from "@/types/holding";
import {
  computeCurrentValueSGD,
  computeCostBasisSGD,
  computeAssetGainSGD,
  computeFxGainSGD,
} from "@/lib/fx";

const DEMO_USER = "demo";

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

export async function fetchHoldings(userId = DEMO_USER): Promise<HoldingRow[]> {
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

export async function updateHoldingPrice(
  id: string,
  currentPrice: number,
  currentFxRate: number
): Promise<void> {
  const supabase = await makeServerClient();
  await supabase
    .from("holdings")
    .update({ current_price: currentPrice, current_fx_rate: currentFxRate })
    .eq("id", id);
}

export async function deleteHolding(id: string, userId = DEMO_USER): Promise<void> {
  const supabase = await makeServerClient();
  // Scope by both id AND user_id — prevents IDOR when multiple users share the table
  await supabase.from("holdings").delete().eq("id", id).eq("user_id", userId);
}
