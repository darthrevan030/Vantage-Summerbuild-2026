import type { SupabaseClient } from "@supabase/supabase-js";

// Every table keyed on a user's text `user_id`. There is no FK cascade from
// auth.users (user_id is text, auth.users.id is uuid), so deletion must clear
// these explicitly. Order is data-first, account-last: a mid-way failure then
// leaves a still-loginable account rather than orphaned, unreachable data.
//   - instruments is global/shared (no user_id) — never touched.
//   - audit_log is the accountability trail — preserved; the deletion is logged.
//   - holdings_backup_* is an out-of-band snapshot — left alone.
const USER_SCOPED_TABLES = [
  "lots",
  "holding_overrides",
  "portfolio_snapshots",
  "cash_balances",
  "cpf_balances",
  "rate_limits",
  "user_settings",
] as const;

/**
 * Hard-deletes all of a user's app data, then their Auth account.
 * Requires a service-role client (bypasses RLS). Returns the first failure, if
 * any, so the caller can surface it without claiming a partial wipe succeeded.
 */
export async function purgeUser(
  adminClient: SupabaseClient,
  userId: string,
): Promise<{ error: string | null }> {
  for (const table of USER_SCOPED_TABLES) {
    const { error } = await adminClient
      .from(table)
      .delete()
      .eq("user_id", userId);
    if (error) {
      console.error(`[purgeUser] failed clearing ${table}:`, error);
      return { error: `Failed to clear ${table}` };
    }
  }

  const { error: authError } = await adminClient.auth.admin.deleteUser(userId);
  if (authError) {
    console.error("[purgeUser] failed deleting auth account:", authError);
    return { error: "Failed to delete the auth account" };
  }

  return { error: null };
}

/** A user's stored role, or "user" if no settings row exists yet. */
export async function getUserRole(
  adminClient: SupabaseClient,
  userId: string,
): Promise<string> {
  const { data } = await adminClient
    .from("user_settings")
    .select("role")
    .eq("user_id", userId)
    .single();
  return data?.role ?? "user";
}

/**
 * True when `userId` is a superadmin AND the only one left — deleting (or
 * demoting) them would lock the system out of the top tier. The DB trigger
 * guards both paths; this app-level check produces the friendly 409 first.
 */
export async function isLastSuperadmin(
  adminClient: SupabaseClient,
  userId: string,
): Promise<boolean> {
  if ((await getUserRole(adminClient, userId)) !== "superadmin") return false;

  const { count } = await adminClient
    .from("user_settings")
    .select("*", { count: "exact", head: true })
    .eq("role", "superadmin");

  return (count ?? 0) <= 1;
}
