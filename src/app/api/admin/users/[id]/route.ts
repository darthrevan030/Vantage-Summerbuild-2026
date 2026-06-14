import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/supabase/guards";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { adminClient, user, error: authError } = await requireAdmin();
  if (authError) return authError;

  const { id: targetId } = await params;
  const { role } = await req.json();

  if (role !== "admin" && role !== "user") {
    return NextResponse.json({ error: "Invalid role" }, { status: 400 });
  }

  // Friendly fast path; the DB trigger is the race-proof backstop.
  if (role === "user") {
    const { count } = await adminClient
      .from("user_settings")
      .select("*", { count: "exact", head: true })
      .eq("role", "admin");

    if ((count ?? 0) <= 1) {
      return NextResponse.json(
        { error: "Cannot remove the last admin" },
        { status: 409 }
      );
    }
  }

  const { data, error } = await adminClient
    .from("user_settings")
    .update({ role })
    .eq("user_id", targetId)
    .select("user_id");

  if (error) {
    if (error.message.includes("cannot demote the last admin")) {
      return NextResponse.json(
        { error: "Cannot remove the last admin" },
        { status: 409 }
      );
    }
    console.error("[admin/users] DB error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  if (!data?.length) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  await adminClient.from("audit_log").insert({
    actor_id: user.id,
    action: "role_change",
    target_id: targetId,
    detail: { role },
  });

  return NextResponse.json({ role });
}
