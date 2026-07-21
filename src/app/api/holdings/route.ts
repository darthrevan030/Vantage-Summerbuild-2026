import { NextRequest, NextResponse } from "next/server";
import {
  fetchHoldings,
  upsertInstrument,
  insertLot,
  deleteLot,
  deleteAllLotsForUser,
  updateLot,
  updateInstrumentForLot,
  upsertHoldingOverride,
  upsertHoldingOverrideForLot,
  seedTickerQuote,
  fetchUserSettings,
  fetchOpenBuyLots,
  insertRealizedLots,
  fetchLotById,
  fetchMatchedQuantityForBuyLot,
  fetchMatchedQuantityForSellLot,
  insertAutoCashTransaction,
  deleteCashTransactionsByLotId,
} from "@/lib/supabase/data";
import { requireAuth } from "@/lib/supabase/guards";
import { CCY_FLAG, SUPPORTED_CURRENCIES } from "@/lib/formatters";
import { ASSET_TYPES } from "@/types/holding";
import { matchSell, type ManualAllocation } from "@/lib/realized";
import type { CostBasisMethod } from "@/types/settings";

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

  const userSettings = await fetchUserSettings(user.id);

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

  // 3. If this is a sell, resolve the cost-basis method and match it against
  //    open buy lots BEFORE writing anything — an invalid/oversold match
  //    should reject the whole request, not leave an unmatched sell lot behind.
  let sellMatches: ReturnType<typeof matchSell> | undefined;
  let sellMethod: CostBasisMethod | undefined;
  if (transaction_type === "sell") {
    const { lot_allocations, cost_basis_method } = body;
    if (
      cost_basis_method !== undefined &&
      !["fifo", "average", "specific"].includes(String(cost_basis_method))
    ) {
      return NextResponse.json({ error: "invalid cost_basis_method" }, { status: 400 });
    }
    sellMethod =
      (cost_basis_method as CostBasisMethod | undefined) ??
      userSettings.costBasisMethod;

    let manualAllocations: ManualAllocation[] | undefined;
    if (sellMethod === "specific") {
      if (!Array.isArray(lot_allocations) || lot_allocations.length === 0) {
        return NextResponse.json(
          { error: "specific cost-basis method requires lot_allocations" },
          { status: 400 },
        );
      }
      if (lot_allocations.some((a) => typeof a !== "object" || a === null)) {
        return NextResponse.json(
          { error: "invalid lot_allocations entry" },
          { status: 400 },
        );
      }
      manualAllocations = lot_allocations.map(
        (a: { buyLotId: string; qty: number }) => ({
          buyLotId: String(a.buyLotId),
          quantity: Number(a.qty),
        }),
      );
    }

    const openBuyLots = await fetchOpenBuyLots(user.id, instrumentId);
    try {
      sellMatches = matchSell(
        {
          quantity: Number(units),
          price: Number(buy_price),
          fxRate: Number(buy_fx_rate ?? 1),
          fees: fees != null ? Number(fees) : 0,
        },
        openBuyLots,
        sellMethod,
        manualAllocations,
      );
    } catch (e) {
      return NextResponse.json(
        {
          error:
            e instanceof Error
              ? e.message
              : "Could not match sell against open lots",
        },
        { status: 400 },
      );
    }
  }

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

  if (transaction_type === "sell" && sellMatches && sellMethod) {
    await insertRealizedLots(
      user.id,
      instrumentId,
      row.id,
      sellMethod,
      String(buy_date),
      Number(buy_price),
      Number(buy_fx_rate ?? 1),
      sellMatches,
    );
  }

  if (userSettings.trackCash) {
    const grossAmount = Number(units) * Number(buy_price);
    const feeAmount = fees != null ? Number(fees) : 0;
    const cashAmount =
      transaction_type === "sell"
        ? grossAmount - feeAmount
        : -(grossAmount + feeAmount);
    await insertAutoCashTransaction(user.id, row.id, {
      date: String(buy_date),
      type: transaction_type === "sell" ? "sell" : "buy",
      currency: String(currency),
      amount: cashAmount,
      fxRate: Number(buy_fx_rate ?? 1),
      broker: String(broker ?? ""),
      source: source != null ? String(source) : "",
    });
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

  const existingLot = await fetchLotById(id, user.id);
  if (!existingLot) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const userSettings = await fetchUserSettings(user.id);

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

  const touchesFinancialFields = ["quantity", "price", "trade_date", "fx_rate", "fees"].some(
    (k) => lotPatch[k] !== undefined,
  );

  // Instrument-level fields (shared security metadata) → updated via admin client
  const instPatch: Record<string, unknown> = {};
  for (const k of ["name", "par_value", "coupon_rate", "maturity_date"]) {
    if (body[k] !== undefined) instPatch[k] = body[k];
  }
  // Ticker (→ symbol), currency and asset_type edit the shared instrument
  // record. Changing currency also realigns the flag so the UI stays consistent.
  if (body.ticker !== undefined) instPatch.symbol = body.ticker;
  if (body.asset_type !== undefined) instPatch.asset_type = body.asset_type;
  if (body.currency !== undefined) {
    instPatch.currency = body.currency;
    instPatch.flag = CCY_FLAG[String(body.currency)] ?? "🌐";
  }

  // Format guards
  if (body.name !== undefined && String(body.name).length > 200)
    return NextResponse.json({ error: "name too long" }, { status: 400 });
  if (
    instPatch.symbol !== undefined &&
    !TICKER_RE.test(String(instPatch.symbol))
  )
    return NextResponse.json({ error: "invalid ticker format" }, { status: 400 });
  if (
    instPatch.currency !== undefined &&
    !SUPPORTED_CURRENCIES.includes(
      String(instPatch.currency) as (typeof SUPPORTED_CURRENCIES)[number],
    )
  )
    return NextResponse.json({ error: "invalid currency" }, { status: 400 });
  if (
    instPatch.asset_type !== undefined &&
    !(ASSET_TYPES as string[]).includes(String(instPatch.asset_type))
  )
    return NextResponse.json({ error: "invalid asset_type" }, { status: 400 });
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

  // A buy lot that's already been matched by a realized sale can't have its
  // quantity reduced below the matched amount — realized_lots stores a frozen
  // price/fx snapshot, not a live join, but the remaining OPEN quantity must
  // still make physical sense.
  if (existingLot.transactionType === "buy" && lotPatch.quantity !== undefined) {
    const matched = await fetchMatchedQuantityForBuyLot(id, user.id);
    if (matched > 0 && Number(lotPatch.quantity) < matched) {
      return NextResponse.json(
        {
          error: `This lot has ${matched} unit(s) already matched to realized sales and can't be reduced below that.`,
        },
        { status: 409 },
      );
    }
  }

  // A sell lot that's already been matched can't have its financial terms
  // edited — the realized record is frozen at sell-commit time and editing
  // the sale afterward would make it inconsistent with what was recorded.
  // Delete and re-enter the sale instead (delete cascades realized_lots).
  if (existingLot.transactionType === "sell") {
    if (touchesFinancialFields) {
      const matched = await fetchMatchedQuantityForSellLot(id, user.id);
      if (matched > 0) {
        return NextResponse.json(
          {
            error:
              "This sale has already been matched to realized P&L. Delete it and record a new sale instead of editing the amount, price, date, FX rate, or fees.",
          },
          { status: 409 },
        );
      }
    }
  }

  // Dividend-yield override (per user + instrument). null clears it.
  const hasDividend = body.dividend_yield !== undefined;
  if (
    hasDividend &&
    body.dividend_yield !== null &&
    !finiteNonNeg(body.dividend_yield)
  )
    return NextResponse.json({ error: "invalid dividend_yield" }, { status: 400 });

  // Apply instrument edits first (ownership + sole-holder checked), then lot edits
  if (Object.keys(instPatch).length > 0) {
    const result = await updateInstrumentForLot(id, user.id, instPatch);
    if (result === "shared")
      return NextResponse.json(
        {
          error:
            "This security is held by other accounts, so its ticker, currency, and asset type can't be edited here.",
        },
        { status: 409 },
      );
    if (result !== "ok")
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

  if (userSettings.trackCash && touchesFinancialFields) {
    await deleteCashTransactionsByLotId(id, user.id);
    const grossAmount = row.units * row.buyPrice;
    const cashAmount =
      row.transactionType === "sell"
        ? grossAmount - row.fees
        : -(grossAmount + row.fees);
    await insertAutoCashTransaction(user.id, id, {
      date: row.buyDate,
      type: row.transactionType,
      currency: row.currency,
      amount: cashAmount,
      fxRate: row.buyFxRate,
      broker: row.broker,
      source: row.source,
    });
  }

  return NextResponse.json(row);
}

export async function DELETE(req: NextRequest) {
  const { user, error } = await requireAuth();
  if (error) return error;

  const { searchParams } = new URL(req.url);
  // Bulk wipe: DELETE /api/holdings?all=1. Kept as a query param on the same
  // route so the auth guard is shared — a separate route would duplicate it.
  if (searchParams.get("all") === "1") {
    const deleted = await deleteAllLotsForUser(user.id);
    return NextResponse.json({ ok: true, deleted });
  }

  const id = searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

  const existingLot = await fetchLotById(id, user.id);
  if (existingLot?.transactionType === "buy") {
    const matched = await fetchMatchedQuantityForBuyLot(id, user.id);
    if (matched > 0) {
      return NextResponse.json(
        {
          error: "This lot has units matched to realized sales and can't be deleted.",
        },
        { status: 409 },
      );
    }
  }

  await deleteLot(id, user.id);
  return NextResponse.json({ ok: true });
}
