import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/guards";
import { parsePdfText } from "@/lib/pdf-parsers";

export async function POST(req: NextRequest) {
  const { error } = await requireAuth();
  if (error) return error;

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
      const { PDFParse } = await import("pdf-parse");
      const parser = new PDFParse({ data: new Uint8Array(buffer) });
      const result = await parser.getText();
      pdfText = result.text as string;
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
  return NextResponse.json(result);
}
