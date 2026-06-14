import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/supabase/guards";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ code: string }> }
) {
  const { adminClient, user, error: authError } = await requireAdmin();
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

  if (error) {
    console.error("[admin/currencies] DB error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
  if (!data?.length) {
    return NextResponse.json({ error: "Currency not found" }, { status: 404 });
  }

  await adminClient.from("audit_log").insert({
    actor_id: user.id,
    action: "currency_update",
    target_id: code,
    detail: { active },
  });

  return NextResponse.json({ code, active });
}
