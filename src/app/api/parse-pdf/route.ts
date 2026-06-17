import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/guards";
import { enforceRateLimit } from "@/lib/supabase/rate-limit";
import { parsePdfText } from "@/lib/pdf-parsers";
import { fetchEodhdAssetTypes, resolveTickersFromNames } from "@/lib/prices";
import { fetchCurrentSgdRates } from "@/lib/providers/fx";

export async function POST(req: NextRequest) {
  const { error } = await requireAuth();
  if (error) return error;

  const limited = await enforceRateLimit("parse-pdf", 5, 60, { failClosed: true });
  if (limited) return limited;

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json({ error: "Invalid form data" }, { status: 400 });
  }

  const file = formData.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No PDF file provided" }, { status: 400 });
  }
  if (!file.name.toLowerCase().endsWith(".pdf")) {
    return NextResponse.json({ error: "File must be a PDF" }, { status: 400 });
  }
  if (file.size > 10 * 1024 * 1024) {
    return NextResponse.json({ error: "File too large (max 10 MB)" }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());

  let pdfText = "";

  const isPdf = buffer[0] === 0x25 && buffer[1] === 0x50 && buffer[2] === 0x44 && buffer[3] === 0x46;

  if (isPdf) {
    try {
      // pdf-parse v1 bundles pdfjs-dist v2 internally — no native deps, no
      // DOMMatrix requirement, works on Vercel. serverExternalPackages prevents
      // webpack from bundling it (which would break its internal require() calls).
      const pdfParse = (await import("pdf-parse")).default;
      const data = await pdfParse(buffer);
      pdfText = data.text;
    } catch (err) {
      console.error("[parse-pdf] PDF parsing failed:", err);
      return NextResponse.json(
        { error: "Could not read PDF — make sure the file is a valid, text-based PDF." },
        { status: 422 },
      );
    }
  } else {
    // Chrome/Edge on Windows saves PDFs as HTML when using Save Page As.
    // The rendered text is present as HTML text nodes — strip tags to recover it.
    const html = buffer.toString("utf-8");
    const looksLikeHtml = /<!doctype\s+html|<html[\s>]/i.test(html);
    if (!looksLikeHtml) {
      return NextResponse.json(
        { error: "Could not read file — make sure it is a valid PDF." },
        { status: 422 },
      );
    }
    pdfText = html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/\s+/g, " ")
      .trim();
  }

  if (!pdfText.trim()) {
    return NextResponse.json(
      { error: "PDF appears to be a scanned image — only text-based PDFs are supported." },
      { status: 422 },
    );
  }

  const result = parsePdfText(pdfText);

  if (result.trades.length > 0) {
    // Resolve missing tickers from company names. The DBS Vickers holdings
    // snapshot lists names but no symbols; we fill only confident Yahoo matches
    // and leave the rest blank for the user to complete in the import rows.
    const needTicker = result.trades.filter((t) => !t.ticker);
    if (needTicker.length > 0) {
      const resolved = await resolveTickersFromNames(needTicker.map((t) => t.name));
      for (const t of needTicker) {
        const sym = resolved[t.name];
        if (sym) t.ticker = sym;
      }
    }

    // Enrich asset types from EODHD: broker statements (esp. DBS Vickers contract
    // notes) often lack an asset descriptor, so an ETF lands as "Equity". This
    // only ever upgrades to ETF (EODHD reports REITs as stock), so it never
    // clobbers a type the parser detected from statement text. Best-effort — a
    // failure or missing key leaves parser defaults for the refresh heal to fix.
    const etfTypes = await fetchEodhdAssetTypes(
      result.trades.map((t) => t.ticker),
    );
    for (const trade of result.trades) {
      const detected = etfTypes[trade.ticker];
      if (detected) trade.asset_type = detected;
    }

    // Fill FX rate for non-SGD trades that carry none (the holdings snapshot has
    // no exchange rate). Without this the import coerces buy_fx_rate to 1, which
    // would wrongly treat a USD position as SGD. Best-effort; field stays
    // editable. buy_fx_rate is SGD per 1 unit of the asset currency.
    const needFx = result.trades.filter(
      (t) => t.buy_fx_rate === 0 && t.currency !== "SGD",
    );
    if (needFx.length > 0) {
      const rates = await fetchCurrentSgdRates(needFx.map((t) => t.currency));
      for (const t of needFx) {
        const rate = rates[t.currency];
        if (rate) t.buy_fx_rate = Math.round(rate * 10000) / 10000;
      }
    }
  }

  return NextResponse.json(result);
}
