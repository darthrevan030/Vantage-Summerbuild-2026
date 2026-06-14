import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/guards";
import { fetchCashBalances, upsertCashBalance } from "@/lib/supabase/data";

const CCY_RE = /^[A-Z]{3}$/;
const NUM_MAX = 1e12;

export async function GET() {
  const { user, error } = await requireAuth();
  if (error) return error;
  const balances = await fetchCashBalances(user.id);
  return NextResponse.json(balances);
}

export async function PATCH(req: NextRequest) {
  const { user, error } = await requireAuth();
  if (error) return error;

  const { currency, amount } = await req.json();
  if (!currency || !CCY_RE.test(String(currency)))
    return NextResponse.json({ error: "invalid currency" }, { status: 400 });
  const amt = Number(amount);
  if (!Number.isFinite(amt) || amt < 0 || amt > NUM_MAX)
    return NextResponse.json({ error: "invalid amount" }, { status: 400 });

  await upsertCashBalance(user.id, String(currency), amt);
  return NextResponse.json({ ok: true });
}
