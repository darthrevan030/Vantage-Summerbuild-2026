import { NextRequest } from "next/server";
import { requireAuth } from "@/lib/supabase/guards";
import { enforceRateLimit } from "@/lib/supabase/rate-limit";

const POS = /\b(surge|beat|record|gain|rise|profit|growth|upgrade|strong|soar|exceed|higher|boost|rally|outperform|rebound)\b/i;
const NEG = /\b(fall|miss|cut|loss|drop|plunge|downgrade|weak|decline|warn|disappoint|tumble|slide|concern|risk|below|slump)\b/i;

function tag(headline: string): "pos" | "neg" | "neu" {
  return POS.test(headline) ? "pos" : NEG.test(headline) ? "neg" : "neu";
}

function ago(unixSec: number): string {
  const s = Date.now() / 1000 - unixSec;
  if (s < 3600) return Math.max(1, Math.round(s / 60)) + "m";
  if (s < 86400) return Math.round(s / 3600) + "h";
  return Math.round(s / 86400) + "d";
}

// EODHD exchange suffix → Finnhub exchange prefix
const EODHD_TO_FINNHUB: Record<string, string> = {
  US:    "",       // US stocks use bare ticker
  LSE:   "LSE:",
  TSE:   "TSE:",
  HKEX:  "HKEX:",
  NSE:   "NSE:",
  BSE:   "BSE:",
  SG:    "SGX:",
  ASX:   "ASX:",
  XETRA: "XETRA:",
  PA:    "EPA:",
  MI:    "BIT:",
  SHG:   "SHG:",
  SHE:   "SHE:",
};

/** Convert EODHD ticker format (VWRA.LSE) to Finnhub format (LSE:VWRA). */
function toFinnhubNews(raw: string): string {
  if (!raw.includes(".")) return raw;
  const dot = raw.lastIndexOf(".");
  const base = raw.slice(0, dot);
  const exchange = raw.slice(dot + 1).toUpperCase();
  const prefix = EODHD_TO_FINNHUB[exchange] ?? "";
  return `${prefix}${base}`;
}

const SYMBOL_RE = /^[A-Za-z0-9.\-:]{1,30}$/;

export async function GET(req: NextRequest) {
  const { error } = await requireAuth();
  if (error) return error;

  const limited = await enforceRateLimit("news", 30, 60);
  if (limited) return limited;

  const symbol = req.nextUrl.searchParams.get("symbol");
  if (!symbol) return Response.json({ error: "symbol required" }, { status: 400 });
  if (!SYMBOL_RE.test(symbol))
    return Response.json({ error: "invalid symbol format" }, { status: 400 });

  const key = process.env.FINNHUB_API_KEY;
  // Return a special sentinel so the client knows the API is offline (vs. no results)
  if (!key || key.startsWith("placeholder")) return Response.json({ noKey: true }, { status: 200 });

  const finnhubSymbol = toFinnhubNews(symbol);
  const to = new Date();
  const from = new Date(to.getTime() - 30 * 86400 * 1000);
  const fmt = (d: Date) => d.toISOString().slice(0, 10);

  try {
    const res = await fetch(
      `https://finnhub.io/api/v1/company-news?symbol=${encodeURIComponent(finnhubSymbol)}&from=${fmt(from)}&to=${fmt(to)}&token=${key}`,
      { next: { revalidate: 900 } }
    );
    if (!res.ok) return Response.json([]);

    const news = await res.json();
    if (!Array.isArray(news)) return Response.json([]);

    const items = news
      .slice(0, 5)
      .map((n: { headline?: string; source?: string; datetime?: number }) => ({
        t: String(n.headline ?? "").trim().slice(0, 120),
        src: String(n.source ?? "").split(" ").slice(0, 2).join(" "),
        sent: tag(String(n.headline ?? "")),
        ago: ago(Number(n.datetime ?? 0)),
      }))
      .filter((n) => n.t);

    return Response.json(items, {
      headers: { "Cache-Control": "public, s-maxage=900" },
    });
  } catch {
    return Response.json([]);
  }
}
