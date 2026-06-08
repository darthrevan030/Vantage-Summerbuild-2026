import { NextRequest, NextResponse } from "next/server";
import { fetchHoldings, insertHolding, deleteHolding } from "@/lib/supabase/data";

export async function GET() {
  const holdings = await fetchHoldings();
  return NextResponse.json(holdings);
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const {
    ticker, name, asset_type, broker, strategy, units, currency,
    flag, icon, buy_price, buy_date, buy_fx_rate,
    current_price, current_fx_rate, spark_data, notes,
  } = body;

  if (!ticker || !name || !asset_type || !buy_price || !buy_date || !units || !currency) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

  const row = await insertHolding({
    user_id: "demo",
    ticker: String(ticker),
    name: String(name),
    asset_type: String(asset_type),
    broker: String(broker ?? ""),
    strategy: String(strategy ?? "long_term"),
    units: Number(units),
    currency: String(currency),
    flag: String(flag ?? "🌐"),
    icon: String(icon ?? "briefcase"),
    buy_price: Number(buy_price),
    buy_date: String(buy_date),
    buy_fx_rate: Number(buy_fx_rate ?? 1),
    current_price: Number(current_price ?? buy_price),
    current_fx_rate: Number(current_fx_rate ?? buy_fx_rate ?? 1),
    spark_data: Array.isArray(spark_data) ? spark_data : [],
    notes: notes ? String(notes) : null,
  });

  if (!row) {
    return NextResponse.json({ error: "Insert failed" }, { status: 500 });
  }

  return NextResponse.json(row, { status: 201 });
}

export async function DELETE(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

  // TODO (Step 10): derive userId from supabase.auth.getUser() once auth is wired up.
  // Hard-coded to "demo" for now — the deleteHolding call scopes by user_id so this
  // is safe: a caller cannot delete a row belonging to a different user_id value.
  const userId = "demo";
  await deleteHolding(id, userId);
  return NextResponse.json({ ok: true });
}
