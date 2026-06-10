import { NextRequest } from "next/server";
import { requireAuth } from "@/lib/supabase/guards";

const REVALIDATE_SECONDS = 3600;
const CCY_RE = /^[A-Z]{3}$/;

export async function GET(req: NextRequest) {
  const { error } = await requireAuth();
  if (error) return error;

  const ccy = req.nextUrl.searchParams.get("ccy")?.toUpperCase();
  const base = (req.nextUrl.searchParams.get("base") ?? "SGD").toUpperCase();
  const days = Math.min(parseInt(req.nextUrl.searchParams.get("days") ?? "30"), 90);

  if (!ccy || !CCY_RE.test(ccy)) {
    return Response.json({ error: "invalid ccy" }, { status: 400 });
  }
  if (!CCY_RE.test(base)) {
    return Response.json({ error: "invalid base currency" }, { status: 400 });
  }

  const key = process.env.FINNHUB_API_KEY;
  // Soft fail — FX sparklines are an enhancement, not critical
  if (!key) return Response.json({ closes: [] });

  // Oanda symbol format: OANDA:USD_SGD means "SGD per 1 USD"
  const symbol = `OANDA:${ccy}_${base}`;
  const to = Math.floor(Date.now() / 1000);
  const from = to - days * 24 * 60 * 60;

  try {
    const res = await fetch(
      `https://finnhub.io/api/v1/forex/candle?symbol=${encodeURIComponent(symbol)}&resolution=D&from=${from}&to=${to}&token=${key}`,
      { next: { revalidate: REVALIDATE_SECONDS } }
    );
    if (!res.ok) return Response.json({ closes: [] });

    const json = await res.json();
    // Finnhub returns s:"no_data" when the pair has no history in the window
    if (json.s !== "ok" || !Array.isArray(json.c)) {
      return Response.json({ closes: [] });
    }

    return Response.json(
      { closes: json.c as number[] },
      { headers: { "Cache-Control": `public, s-maxage=${REVALIDATE_SECONDS}` } }
    );
  } catch {
    return Response.json({ closes: [] });
  }
}
