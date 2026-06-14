import { NextRequest, NextResponse } from "next/server";
import { fetchHoldings, insertHolding, deleteHolding, updateHolding } from "@/lib/supabase/data";
import { requireAuth } from "@/lib/supabase/guards";

const TICKER_RE = /^[A-Za-z0-9.\-:]{1,20}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const NUM_MAX = 1e12;

const finiteNonNeg = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 && n <= NUM_MAX;
};

export async function GET() {
  const { user, error } = await requireAuth();
  if (error) return error;

  const holdings = await fetchHoldings(user.id);
  return NextResponse.json(holdings);
}

export async function POST(req: NextRequest) {
  const { user, error } = await requireAuth();
  if (error) return error;

  const body = await req.json();
  const {
    ticker, name, asset_type, broker, strategy, units, currency,
    flag, icon, buy_price, buy_date, buy_fx_rate,
    current_price, current_fx_rate, spark_data, notes,
  } = body;

  // Format guards
  if (ticker && !TICKER_RE.test(String(ticker)))
    return NextResponse.json({ error: "invalid ticker format" }, { status: 400 });
  if (name && String(name).length > 200)
    return NextResponse.json({ error: "name too long" }, { status: 400 });
  if (notes && String(notes).length > 2000)
    return NextResponse.json({ error: "notes too long" }, { status: 400 });
  if (buy_date && !DATE_RE.test(String(buy_date)))
    return NextResponse.json({ error: "invalid buy_date format" }, { status: 400 });

  if (!ticker || !name || !asset_type || !buy_price || !buy_date || !units || !currency) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

  // Numeric guards
  if (!finiteNonNeg(units) || Number(units) <= 0)
    return NextResponse.json({ error: "invalid units" }, { status: 400 });
  if (!finiteNonNeg(buy_price))
    return NextResponse.json({ error: "invalid buy_price" }, { status: 400 });
  if (buy_fx_rate !== undefined && !finiteNonNeg(buy_fx_rate))
    return NextResponse.json({ error: "invalid buy_fx_rate" }, { status: 400 });
  if (current_price !== undefined && !finiteNonNeg(current_price))
    return NextResponse.json({ error: "invalid current_price" }, { status: 400 });
  if (current_fx_rate !== undefined && !finiteNonNeg(current_fx_rate))
    return NextResponse.json({ error: "invalid current_fx_rate" }, { status: 400 });
  if (Array.isArray(spark_data) && spark_data.length > 400)
    return NextResponse.json({ error: "spark_data too large" }, { status: 400 });

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
    price_refreshed_at: null,
  });

  if (!row) {
    return NextResponse.json({ error: "Insert failed" }, { status: 500 });
  }

  return NextResponse.json(row, { status: 201 });
}

export async function PATCH(req: NextRequest) {
  const { user, error } = await requireAuth();
  if (error) return error;

  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

  const body = await req.json();
  const patch: Record<string, unknown> = {};
  const allowed = ["ticker","name","asset_type","broker","strategy","units","currency","buy_price","buy_date","buy_fx_rate","current_price","current_fx_rate"];
  for (const k of allowed) {
    if (body[k] !== undefined) patch[k] = body[k];
  }

  // Format guards
  if (patch.ticker !== undefined && !TICKER_RE.test(String(patch.ticker)))
    return NextResponse.json({ error: "invalid ticker format" }, { status: 400 });
  if (patch.name !== undefined && String(patch.name).length > 200)
    return NextResponse.json({ error: "name too long" }, { status: 400 });
  if (patch.buy_date !== undefined && !DATE_RE.test(String(patch.buy_date)))
    return NextResponse.json({ error: "invalid buy_date format" }, { status: 400 });

  // Numeric guards
  for (const k of ["units", "buy_price", "buy_fx_rate", "current_price", "current_fx_rate"]) {
    if (patch[k] !== undefined && !finiteNonNeg(patch[k])) {
      return NextResponse.json({ error: `invalid ${k}` }, { status: 400 });
    }
  }
  if (patch.units !== undefined && Number(patch.units) <= 0)
    return NextResponse.json({ error: "invalid units" }, { status: 400 });

  const row = await updateHolding(id, user.id, patch);
  if (!row) return NextResponse.json({ error: "Update failed" }, { status: 500 });
  return NextResponse.json(row);
}

export async function DELETE(req: NextRequest) {
  const { user, error } = await requireAuth();
  if (error) return error;

  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

  await deleteHolding(id, user.id);
  return NextResponse.json({ ok: true });
}
