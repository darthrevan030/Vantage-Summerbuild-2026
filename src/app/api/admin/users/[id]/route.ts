import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/supabase/guards";
import {
  purgeUser,
  isLastSuperadmin,
  getUserRole,
} from "@/lib/supabase/delete-user";
import { ROLES, canSetRole, canDeleteRole } from "@/lib/roles";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { adminClient, user, role: actorRole, error: authError } =
    await requireAdmin();
  if (authError) return authError;

  const { id: targetId } = await params;
  const { role } = await req.json();

  if (!ROLES.includes(role)) {
    return NextResponse.json({ error: "Invalid role" }, { status: 400 });
  }

  // Only superadmins manage the admin roster — promoting, demoting, or changing
  // any role. Plain admins get 403 here (this is also the demotion guard: an
  // admin can't demote an admin to 'user' as a precursor to deleting them).
  if (!canSetRole(actorRole)) {
    return NextResponse.json(
      { error: "Only superadmins can change roles" },
      { status: 403 },
    );
  }

  // The admin list is built from auth.users, but user_settings rows are created
  // lazily on first login — so a listed user may have no row yet. Verify the
  // account really exists in Auth (keeps a true 404 for bogus IDs and avoids
  // creating orphan rows), then upsert so the role applies either way.
  const { data: authUser, error: lookupError } =
    await adminClient.auth.admin.getUserById(targetId);
  if (lookupError || !authUser?.user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  // Friendly fast path for demoting the last superadmin; the DB trigger is the
  // race-proof backstop.
  if (role !== "superadmin" && (await isLastSuperadmin(adminClient, targetId))) {
    return NextResponse.json(
      { error: "Cannot demote the last superadmin" },
      { status: 409 },
    );
  }

  // Upsert: updates an existing row's role, or materializes the row for a
  // never-logged-in account. Only user_id/role are in the payload, so an
  // existing row's display_name/base_currency are untouched and a new row
  // gets base_currency's DEFAULT. The last-superadmin trigger fires on the
  // UPDATE branch; the INSERT branch can only create a row, never demote anyone.
  const { error } = await adminClient
    .from("user_settings")
    .upsert({ user_id: targetId, role }, { onConflict: "user_id" });

  if (error) {
    if (error.message.includes("cannot remove the last superadmin")) {
      return NextResponse.json(
        { error: "Cannot demote the last superadmin" },
        { status: 409 },
      );
    }
    console.error("[admin/users] DB error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }

  await adminClient.from("audit_log").insert({
    actor_id: user.id,
    action: "role_change",
    target_id: targetId,
    detail: { role },
  });

  return NextResponse.json({ role });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { adminClient, user, role: actorRole, error: authError } =
    await requireAdmin();
  if (authError) return authError;

  const { id: targetId } = await params;

  // An admin nuking their own account through the admin panel is almost always
  // a mistake; self-deletion has its own deliberate path in account settings.
  if (targetId === user.id) {
    return NextResponse.json(
      { error: "Use account settings to delete your own account" },
      { status: 400 },
    );
  }

  // Confirm the account exists in Auth (true 404 for bogus IDs).
  const { data: authUser, error: lookupError } =
    await adminClient.auth.admin.getUserById(targetId);
  if (lookupError || !authUser?.user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  // Plain admins may only delete ordinary users; deleting an admin or
  // superadmin is reserved to superadmins.
  const targetRole = await getUserRole(adminClient, targetId);
  if (!canDeleteRole(actorRole, targetRole)) {
    return NextResponse.json(
      { error: "Only superadmins can delete admins" },
      { status: 403 },
    );
  }

  if (await isLastSuperadmin(adminClient, targetId)) {
    return NextResponse.json(
      { error: "Cannot delete the last superadmin" },
      { status: 409 },
    );
  }

  const { error } = await purgeUser(adminClient, targetId);
  if (error) {
    return NextResponse.json({ error }, { status: 500 });
  }

  // user_settings is gone, but audit_log is a separate, un-purged table.
  await adminClient.from("audit_log").insert({
    actor_id: user.id,
    action: "user_deleted",
    target_id: targetId,
    detail: { email: authUser.user.email ?? null },
  });

  return NextResponse.json({ deleted: true });
}
