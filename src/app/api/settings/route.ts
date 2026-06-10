import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/guards";
import { fetchUserSettings, upsertUserSettings } from "@/lib/supabase/data";

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
  await upsertUserSettings(user.id, {
    displayName: typeof body.displayName === "string" ? body.displayName : undefined,
    baseCurrency: typeof body.baseCurrency === "string" ? body.baseCurrency : undefined,
  });

  return NextResponse.json({ ok: true });
}
