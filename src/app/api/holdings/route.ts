import { NextRequest, NextResponse } from "next/server";
import {
  fetchHoldings,
  deleteLot,
  deleteAllLotsForUser,
  updateLot,
  updateInstrumentForLot,
  upsertHoldingOverrideForLot,
  fetchUserSettings,
  fetchLotById,
  fetchMatchedQuantityForBuyLot,
  fetchMatchedQuantityForSellLot,
  insertAutoCashTransaction,
  deleteCashTransactionsByLotId,
} from "@/lib/supabase/data";
import { requireAuth } from "@/lib/supabase/guards";
import { CCY_FLAG, SUPPORTED_CURRENCIES } from "@/lib/formatters";
import { ASSET_TYPES } from "@/types/holding";
import { InvalidAllocationError, InsufficientOpenQuantityError } from "@/lib/realized";
import { commitLot, validateLotInput, type LotCommitInput } from "@/lib/holdings/commit-lot";

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
  const body = (await req.json()) as LotCommitInput;

  const invalid = validateLotInput(body);
  if (invalid) return NextResponse.json({ error: invalid }, { status: 400 });

  try {
    const row = await commitLot(user.id, body, userSettings);
    return NextResponse.json(row, { status: 201 });
  } catch (e) {
    if (
      e instanceof InvalidAllocationError ||
      e instanceof InsufficientOpenQuantityError ||
      (e instanceof Error &&
        e.message === "specific cost-basis method requires lot_allocations")
    ) {
      return NextResponse.json({ error: e.message }, { status: 400 });
    }
    console.error("[POST /api/holdings]", e);
    return NextResponse.json({ error: "Insert failed" }, { status: 500 });
  }
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
