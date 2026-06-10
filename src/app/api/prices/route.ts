import { fetchLivePrices } from "@/lib/prices";
import { requireAuth } from "@/lib/supabase/guards";

const MAX_TICKERS = 50;
const TICKER_RE = /^[A-Za-z0-9.\-:]{1,20}$/;

export async function POST(req: Request) {
  const { error } = await requireAuth();
  if (error) return error;

  const body = await req.json().catch(() => null);
  const tickers = body?.tickers;

  if (!Array.isArray(tickers) || tickers.length > MAX_TICKERS) {
    return Response.json(
      { error: `tickers must be an array of at most ${MAX_TICKERS}` },
      { status: 400 }
    );
  }
  if (!tickers.every((t) => typeof t === "string" && TICKER_RE.test(t))) {
    return Response.json({ error: "invalid ticker format" }, { status: 400 });
  }

  const prices = await fetchLivePrices(tickers);
  return Response.json(prices);
}
