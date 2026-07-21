import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/guards";
import {
  fetchOpenBuyLots,
  resolveInstrumentIdForTicker,
} from "@/lib/supabase/data";

export async function GET(req: NextRequest) {
  const { user, error } = await requireAuth();
  if (error) return error;

  const ticker = new URL(req.url).searchParams.get("ticker");
  if (!ticker) return NextResponse.json({ error: "Missing ticker" }, { status: 400 });

  const instrumentId = await resolveInstrumentIdForTicker(user.id, ticker);
  if (!instrumentId) return NextResponse.json([]);

  const openLots = await fetchOpenBuyLots(user.id, instrumentId);
  return NextResponse.json(openLots);
}
