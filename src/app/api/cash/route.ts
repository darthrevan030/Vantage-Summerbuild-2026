import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/guards";
import {
  fetchCashBalancesLive,
  insertCashTransaction,
  insertTransferPair,
  deleteCashTransaction,
} from "@/lib/supabase/data";
import type { CashTransactionType } from "@/types/cash";

const CCY_RE = /^[A-Z]{3}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const NUM_MAX = 1e12;
const MANUAL_TYPES = new Set<CashTransactionType>([
  "deposit",
  "withdrawal",
  "fee",
  "dividend_cash",
]);

export async function GET() {
  const { user, error } = await requireAuth();
  if (error) return error;
  const balances = await fetchCashBalancesLive(user.id);
  return NextResponse.json(balances);
}

export async function POST(req: NextRequest) {
  const { user, error } = await requireAuth();
  if (error) return error;

  const body = await req.json();
  const { type, currency, amount, date, broker, source, note } = body;

  if (!currency || !CCY_RE.test(String(currency)))
    return NextResponse.json({ error: "invalid currency" }, { status: 400 });
  if (!date || !DATE_RE.test(String(date)))
    return NextResponse.json({ error: "invalid date" }, { status: 400 });
  const amt = Number(amount);
  if (!Number.isFinite(amt) || amt <= 0 || amt > NUM_MAX)
    return NextResponse.json({ error: "invalid amount" }, { status: 400 });
  const fxRate = body.fx_rate != null ? Number(body.fx_rate) : 1;
  if (!Number.isFinite(fxRate) || fxRate <= 0)
    return NextResponse.json({ error: "invalid fx_rate" }, { status: 400 });

  if (type === "transfer") {
    const toBroker = body.to_broker;
    if (typeof toBroker !== "string" || !toBroker.trim())
      return NextResponse.json(
        { error: "transfer requires to_broker" },
        { status: 400 },
      );
    const pair = await insertTransferPair(user.id, {
      date: String(date),
      currency: String(currency),
      amount: amt,
      fxRate,
      fromBroker: broker != null ? String(broker) : "",
      toBroker: String(toBroker),
      note: note ? String(note) : null,
    });
    if (!pair) return NextResponse.json({ error: "Insert failed" }, { status: 500 });
    return NextResponse.json(pair, { status: 201 });
  }

  if (!MANUAL_TYPES.has(type)) {
    return NextResponse.json({ error: "invalid type" }, { status: 400 });
  }

  const signedAmount = type === "withdrawal" || type === "fee" ? -amt : amt;
  const row = await insertCashTransaction(user.id, {
    date: String(date),
    type,
    currency: String(currency),
    amount: signedAmount,
    fxRate,
    broker: broker != null ? String(broker) : "",
    source: source != null ? String(source) : "",
    note: note ? String(note) : null,
  });
  if (!row) return NextResponse.json({ error: "Insert failed" }, { status: 500 });
  return NextResponse.json(row, { status: 201 });
}

export async function DELETE(req: NextRequest) {
  const { user, error } = await requireAuth();
  if (error) return error;

  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

  const result = await deleteCashTransaction(id, user.id);
  if (result === "not_found")
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (result === "auto_derived")
    return NextResponse.json(
      {
        error:
          "This entry is linked to a buy/sell lot — delete the lot instead of this entry.",
      },
      { status: 409 },
    );
  return NextResponse.json({ ok: true });
}
