import { NextRequest } from "next/server";
import { requireAuth } from "@/lib/supabase/guards";
import { enforceRateLimit } from "@/lib/supabase/rate-limit";

const SYMBOL_RE = /^[A-Za-z0-9.\-:]{1,30}$/;

export async function GET(req: NextRequest) {
  const { error } = await requireAuth();
  if (error) return error;

  const limited = await enforceRateLimit("quotes", 30, 60);
  if (limited) return limited;

  const symbol = req.nextUrl.searchParams.get("symbol");
  if (!symbol) return Response.json({ error: "symbol required" }, { status: 400 });
  if (!SYMBOL_RE.test(symbol))
    return Response.json({ error: "invalid symbol format" }, { status: 400 });

  const key = process.env.FINNHUB_API_KEY;
  if (!key) return Response.json({ error: "Service unavailable" }, { status: 503 });

  const res = await fetch(
    `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(symbol)}&token=${key}`,
    { next: { revalidate: 60 } }
  );
  if (!res.ok) return Response.json({ error: "quote fetch failed" }, { status: 502 });

  const q = await res.json();
  return Response.json(
    { price: q.c, change: q.d, changePct: q.dp },
    { headers: { "Cache-Control": "public, s-maxage=60" } }
  );
}
