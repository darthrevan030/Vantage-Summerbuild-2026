import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/supabase/guards";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ code: string }> }
) {
  const { adminClient, error: authError } = await requireAdmin();
  if (authError) return authError;

  const { code } = await params;
  const { active } = await req.json();

  if (typeof active !== "boolean") {
    return NextResponse.json({ error: "active must be a boolean" }, { status: 400 });
  }

  const { data, error } = await adminClient
    .from("currencies")
    .update({ active })
    .eq("code", code)
    .select("code");

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data?.length) {
    return NextResponse.json({ error: "Currency not found" }, { status: 404 });
  }

  return NextResponse.json({ code, active });
}
