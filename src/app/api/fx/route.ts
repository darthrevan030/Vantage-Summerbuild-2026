import { NextRequest } from "next/server";

export async function GET(req: NextRequest) {
  const base = req.nextUrl.searchParams.get("base") ?? "SGD";
  const date = req.nextUrl.searchParams.get("date");

  const url = date
    ? `https://api.frankfurter.app/${date}?base=${base}`
    : `https://api.frankfurter.app/latest?base=${base}`;

  const res = await fetch(url, { next: { revalidate: 3600 } });
  if (!res.ok) return Response.json({ error: "FX fetch failed" }, { status: 502 });

  const json = await res.json();
  return Response.json(json.rates);
}
