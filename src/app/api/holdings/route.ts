import { NextRequest, NextResponse } from "next/server";
import {
  fetchHoldings,
  upsertInstrument,
  insertLot,
  deleteLot,
  updateLot,
  updateInstrumentForLot,
  upsertHoldingOverride,
  upsertHoldingOverrideForLot,
  seedTickerQuote,
} from "@/lib/supabase/data";
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
    ticker,
    name,
    asset_type,
    broker,
    strategy,
    units,
    currency,
    flag,
    icon,
    buy_price,
    buy_date,
    buy_fx_rate,
    current_price,
    current_fx_rate,
    spark_data,
    notes,
  } = body;

  // Format guards
  if (ticker && !TICKER_RE.test(String(ticker)))
    return NextResponse.json(
      { error: "invalid ticker format" },
      { status: 400 },
    );
  if (name && String(name).length > 200)
    return NextResponse.json({ error: "name too long" }, { status: 400 });
  if (notes && String(notes).length > 2000)
    return NextResponse.json({ error: "notes too long" }, { status: 400 });
  if (buy_date && !DATE_RE.test(String(buy_date)))
    return NextResponse.json(
      { error: "invalid buy_date format" },
      { status: 400 },
    );

  if (
    !ticker ||
    !name ||
    !asset_type ||
    !buy_price ||
    !buy_date ||
    !units ||
    !currency
  ) {
    return NextResponse.json(
      { error: "Missing required fields" },
      { status: 400 },
    );
  }

  // Numeric guards
  if (!finiteNonNeg(units) || Number(units) <= 0)
    return NextResponse.json({ error: "invalid units" }, { status: 400 });
  if (!finiteNonNeg(buy_price))
    return NextResponse.json({ error: "invalid buy_price" }, { status: 400 });
  if (buy_fx_rate !== undefined && !finiteNonNeg(buy_fx_rate))
    return NextResponse.json({ error: "invalid buy_fx_rate" }, { status: 400 });
  if (current_price !== undefined && !finiteNonNeg(current_price))
    return NextResponse.json(
      { error: "invalid current_price" },
      { status: 400 },
    );
  if (current_fx_rate !== undefined && !finiteNonNeg(current_fx_rate))
    return NextResponse.json(
      { error: "invalid current_fx_rate" },
      { status: 400 },
    );
  if (Array.isArray(spark_data) && spark_data.length > 400)
    return NextResponse.json(
      { error: "spark_data too large" },
      { status: 400 },
    );

  // Extra lot / instrument fields (optional)
  const {
    exchange_code,
    source,
    fees,
    transaction_type,
    maturity_date,
    par_value,
    coupon_rate,
    dividend_yield,
  } = body;

  if (source !== undefined && !["CPF", "SRS", "Cash", ""].includes(String(source)))
    return NextResponse.json({ error: "invalid source" }, { status: 400 });
  if (
    transaction_type !== undefined &&
    !["buy", "sell"].includes(String(transaction_type))
  )
    return NextResponse.json({ error: "invalid transaction_type" }, { status: 400 });
  if (fees !== undefined && !finiteNonNeg(fees))
    return NextResponse.json({ error: "invalid fees" }, { status: 400 });
  if (maturity_date !== undefined && maturity_date !== null && !DATE_RE.test(String(maturity_date)))
    return NextResponse.json({ error: "invalid maturity_date" }, { status: 400 });
  if (par_value !== undefined && par_value !== null && !finiteNonNeg(par_value))
    return NextResponse.json({ error: "invalid par_value" }, { status: 400 });
  if (coupon_rate !== undefined && coupon_rate !== null && !finiteNonNeg(coupon_rate))
    return NextResponse.json({ error: "invalid coupon_rate" }, { status: 400 });
  if (dividend_yield !== undefined && dividend_yield !== null && !finiteNonNeg(dividend_yield))
    return NextResponse.json({ error: "invalid dividend_yield" }, { status: 400 });

  // 1. Upsert the shared security record → instrument id
  const instrumentId = await upsertInstrument({
    symbol: String(ticker),
    exchangeCode: exchange_code ? String(exchange_code) : null,
    assetType: String(asset_type),
    currency: String(currency),
    name: String(name),
    flag: String(flag ?? "🌐"),
    icon: String(icon ?? "briefcase"),
    parValue: par_value != null ? Number(par_value) : null,
    couponRate: coupon_rate != null ? Number(coupon_rate) : null,
    maturityDate: maturity_date ? String(maturity_date) : null,
  });
  if (!instrumentId)
    return NextResponse.json({ error: "Insert failed" }, { status: 500 });

  // 2. Seed a quote so the holding shows a price before the first refresh
  //    (no-op if a shared quote already exists for this symbol)
  await seedTickerQuote(
    String(ticker),
    Number(current_price ?? buy_price),
    Array.isArray(spark_data) ? spark_data : undefined,
  );

  // 3. Insert the user's transaction leg
  const row = await insertLot(user.id, instrumentId, {
    transactionType: transaction_type === "sell" ? "sell" : "buy",
    quantity: Number(units),
    price: Number(buy_price),
    tradeDate: String(buy_date),
    fxRate: Number(buy_fx_rate ?? 1),
    fees: fees != null ? Number(fees) : 0,
    source: source != null ? String(source) : "",
    broker: String(broker ?? ""),
    strategy: String(strategy ?? "long_term"),
    notes: notes ? String(notes) : null,
  });

  if (!row) {
    return NextResponse.json({ error: "Insert failed" }, { status: 500 });
  }

  // Persist a manual dividend-yield override if one was supplied
  if (dividend_yield !== undefined && dividend_yield !== null) {
    await upsertHoldingOverride(user.id, instrumentId, Number(dividend_yield));
    row.dividendYield = Number(dividend_yield);
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

  // Lot-level fields (user's transaction leg) → mapped to lots columns
  const LOT_MAP: Record<string, string> = {
    broker: "broker",
    strategy: "strategy",
    source: "source",
    units: "quantity",
    buy_price: "price",
    buy_date: "trade_date",
    buy_fx_rate: "fx_rate",
    fees: "fees",
    transaction_type: "transaction_type",
    notes: "notes",
  };
  const lotPatch: Record<string, unknown> = {};
  for (const [bodyKey, col] of Object.entries(LOT_MAP)) {
    if (body[bodyKey] !== undefined) lotPatch[col] = body[bodyKey];
  }

  // Instrument-level fields (shared security metadata) → updated via admin client
  const instPatch: Record<string, unknown> = {};
  for (const k of ["name", "par_value", "coupon_rate", "maturity_date"]) {
    if (body[k] !== undefined) instPatch[k] = body[k];
  }

  // Format guards
  if (body.name !== undefined && String(body.name).length > 200)
    return NextResponse.json({ error: "name too long" }, { status: 400 });
  if (lotPatch.trade_date !== undefined && !DATE_RE.test(String(lotPatch.trade_date)))
    return NextResponse.json({ error: "invalid buy_date format" }, { status: 400 });
  if (
    instPatch.maturity_date !== undefined &&
    instPatch.maturity_date !== null &&
    !DATE_RE.test(String(instPatch.maturity_date))
  )
    return NextResponse.json({ error: "invalid maturity_date" }, { status: 400 });
  if (lotPatch.notes !== undefined && lotPatch.notes !== null && String(lotPatch.notes).length > 2000)
    return NextResponse.json({ error: "notes too long" }, { status: 400 });
  if (
    lotPatch.source !== undefined &&
    !["CPF", "SRS", "Cash", ""].includes(String(lotPatch.source))
  )
    return NextResponse.json({ error: "invalid source" }, { status: 400 });
  if (
    lotPatch.transaction_type !== undefined &&
    !["buy", "sell"].includes(String(lotPatch.transaction_type))
  )
    return NextResponse.json({ error: "invalid transaction_type" }, { status: 400 });

  // Numeric guards
  for (const k of ["quantity", "price", "fx_rate", "fees"]) {
    if (lotPatch[k] !== undefined && !finiteNonNeg(lotPatch[k]))
      return NextResponse.json({ error: `invalid ${k}` }, { status: 400 });
  }
  for (const k of ["par_value", "coupon_rate"]) {
    if (instPatch[k] !== undefined && instPatch[k] !== null && !finiteNonNeg(instPatch[k]))
      return NextResponse.json({ error: `invalid ${k}` }, { status: 400 });
  }
  if (lotPatch.quantity !== undefined && Number(lotPatch.quantity) <= 0)
    return NextResponse.json({ error: "invalid units" }, { status: 400 });

  // Dividend-yield override (per user + instrument). null clears it.
  const hasDividend = body.dividend_yield !== undefined;
  if (
    hasDividend &&
    body.dividend_yield !== null &&
    !finiteNonNeg(body.dividend_yield)
  )
    return NextResponse.json({ error: "invalid dividend_yield" }, { status: 400 });

  // Apply instrument edits first (ownership-checked), then lot edits
  if (Object.keys(instPatch).length > 0) {
    const ok = await updateInstrumentForLot(id, user.id, instPatch);
    if (!ok)
      return NextResponse.json({ error: "Update failed" }, { status: 500 });
  }

  if (hasDividend) {
    const ok = await upsertHoldingOverrideForLot(
      id,
      user.id,
      body.dividend_yield === null ? null : Number(body.dividend_yield),
    );
    if (!ok)
      return NextResponse.json({ error: "Update failed" }, { status: 500 });
  }

  if (Object.keys(lotPatch).length === 0) {
    // Only instrument fields changed — return the refreshed row
    const rows = await fetchHoldings(user.id);
    const row = rows.find((r) => r.id === id);
    return row
      ? NextResponse.json(row)
      : NextResponse.json({ error: "Update failed" }, { status: 500 });
  }

  const row = await updateLot(id, user.id, lotPatch);
  if (!row)
    return NextResponse.json({ error: "Update failed" }, { status: 500 });
  return NextResponse.json(row);
}

export async function DELETE(req: NextRequest) {
  const { user, error } = await requireAuth();
  if (error) return error;

  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

  await deleteLot(id, user.id);
  return NextResponse.json({ ok: true });
}
