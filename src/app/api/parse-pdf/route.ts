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
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { PDFParse } = require("pdf-parse");
    const parser = new PDFParse({ data: buffer });
    const result = await parser.getText();
    pdfText = result.text as string;
  } catch {
    return NextResponse.json(
      { error: "Could not read PDF — make sure the file is a valid, text-based PDF." },
      { status: 422 },
    );
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
