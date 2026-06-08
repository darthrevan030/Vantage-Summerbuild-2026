import { NextRequest, NextResponse } from "next/server";
import { fetchHoldings, insertHolding, deleteHolding, updateHolding } from "@/lib/supabase/data";
import { createClient } from "@/lib/supabase/server";

async function getAuthUser() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  return user;
}

export async function GET() {
  const user = await getAuthUser();
  const holdings = await fetchHoldings(user?.id);
  return NextResponse.json(holdings);
}

export async function POST(req: NextRequest) {
  const user = await getAuthUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

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
    user_id: user.id,
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

export async function PATCH(req: NextRequest) {
  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

  const body = await req.json();
  const patch: Record<string, unknown> = {};
  const allowed = ["ticker","name","asset_type","broker","strategy","units","currency","buy_price","buy_date","buy_fx_rate","current_price","current_fx_rate"];
  for (const k of allowed) {
    if (body[k] !== undefined) patch[k] = body[k];
  }

  const row = await updateHolding(id, user.id, patch);
  if (!row) return NextResponse.json({ error: "Update failed" }, { status: 500 });
  return NextResponse.json(row);
}

export async function DELETE(req: NextRequest) {
  const user = await getAuthUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

  await deleteHolding(id, user.id);
  return NextResponse.json({ ok: true });
}
