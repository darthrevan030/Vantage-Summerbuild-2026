import { NextRequest } from "next/server";
import { requireAuth } from "@/lib/supabase/guards";

export async function GET(req: NextRequest) {
  const { error } = await requireAuth();
  if (error) return error;

  const symbol = req.nextUrl.searchParams.get("symbol");
  if (!symbol) return Response.json({ error: "symbol required" }, { status: 400 });

  const key = process.env.FINNHUB_API_KEY;
  if (!key) return Response.json({ error: "FINNHUB_API_KEY not set" }, { status: 500 });

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
