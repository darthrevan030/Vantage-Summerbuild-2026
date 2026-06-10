import { NextRequest } from "next/server";
import { requireAuth } from "@/lib/supabase/guards";

const CCY_RE = /^[A-Z]{3}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(req: NextRequest) {
  const { error } = await requireAuth();
  if (error) return error;

  const base = (req.nextUrl.searchParams.get("base") ?? "SGD").toUpperCase();
  const date = req.nextUrl.searchParams.get("date");

  if (!CCY_RE.test(base)) {
    return Response.json({ error: "invalid base currency" }, { status: 400 });
  }
  if (date && !DATE_RE.test(date)) {
    return Response.json({ error: "invalid date, expected YYYY-MM-DD" }, { status: 400 });
  }

  const url = date
    ? `https://api.frankfurter.app/${date}?base=${base}`
    : `https://api.frankfurter.app/latest?base=${base}`;

  const res = await fetch(url, { next: { revalidate: 3600 } });
  if (!res.ok) return Response.json({ error: "FX fetch failed" }, { status: 502 });

  const json = await res.json();
  return Response.json(json.rates);
}
