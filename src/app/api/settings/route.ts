import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/guards";
import { fetchUserSettings, upsertUserSettings } from "@/lib/supabase/data";

const CCY_RE = /^[A-Z]{3}$/;

export async function GET() {
  const { user, error } = await requireAuth();
  if (error) return error;

  const settings = await fetchUserSettings(user.id);
  return NextResponse.json(settings);
}

export async function POST(req: NextRequest) {
  const { user, error } = await requireAuth();
  if (error) return error;

  const body = await req.json();
  const displayName =
    typeof body.displayName === "string" ? body.displayName.trim() : undefined;
  const baseCurrency =
    typeof body.baseCurrency === "string"
      ? body.baseCurrency.toUpperCase()
      : undefined;

  if (displayName !== undefined && displayName.length > 80) {
    return NextResponse.json({ error: "displayName too long" }, { status: 400 });
  }
  if (baseCurrency !== undefined && !CCY_RE.test(baseCurrency)) {
    return NextResponse.json({ error: "invalid baseCurrency" }, { status: 400 });
  }

  await upsertUserSettings(user.id, { displayName, baseCurrency });

  return NextResponse.json({ ok: true });
}
