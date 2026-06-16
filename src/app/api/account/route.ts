import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/guards";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { purgeUser, isLastSuperadmin } from "@/lib/supabase/delete-user";

/**
 * Self-service account deletion. A signed-in user permanently removes their own
 * account and all associated data. Mirrors the admin DELETE, minus the role
 * check (you can always act on yourself) plus a session sign-out at the end.
 */
export async function DELETE() {
  const { user, error: authError } = await requireAuth();
  if (authError) return authError;

  let adminClient;
  try {
    adminClient = createAdminClient();
  } catch {
    return NextResponse.json(
      { error: "Server is missing SUPABASE_ADMIN_KEY" },
      { status: 500 },
    );
  }

  // The last superadmin can't delete themselves — that would lock out the top
  // tier. They must promote another superadmin first.
  if (await isLastSuperadmin(adminClient, user.id)) {
    return NextResponse.json(
      { error: "You are the last superadmin — promote another one first" },
      { status: 409 },
    );
  }

  const { error } = await purgeUser(adminClient, user.id);
  if (error) {
    return NextResponse.json({ error }, { status: 500 });
  }

  await adminClient.from("audit_log").insert({
    actor_id: user.id,
    action: "account_self_deleted",
    target_id: user.id,
    detail: { email: user.email ?? null },
  });

  // Clear the now-orphaned session cookie so the browser isn't left "logged in"
  // to a deleted account.
  const supabase = await createClient();
  await supabase.auth.signOut();

  return NextResponse.json({ deleted: true });
}
