import { NextRequest } from "next/server";

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

export async function GET(req: NextRequest) {
  const symbol = req.nextUrl.searchParams.get("symbol");
  if (!symbol) return Response.json({ error: "symbol required" }, { status: 400 });

  const key = process.env.FINNHUB_API_KEY;
  if (!key) return Response.json([], { status: 200 });

  const to = new Date();
  const from = new Date(to.getTime() - 30 * 86400 * 1000);
  const fmt = (d: Date) => d.toISOString().slice(0, 10);

  try {
    const res = await fetch(
      `https://finnhub.io/api/v1/company-news?symbol=${encodeURIComponent(symbol)}&from=${fmt(from)}&to=${fmt(to)}&token=${key}`,
      { next: { revalidate: 900 } }
    );
    if (!res.ok) return Response.json([]);

    const news = await res.json();
    if (!Array.isArray(news)) return Response.json([]);

    const items = news
      .slice(0, 5)
      .map((n: { headline?: string; source?: string; datetime?: number }) => ({
        t: String(n.headline ?? "").trim().slice(0, 100),
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
