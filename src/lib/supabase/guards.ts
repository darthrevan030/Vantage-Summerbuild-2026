import { NextResponse } from "next/server";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isAdminRole, type Role } from "@/lib/roles";

export async function getAuthUser(): Promise<User | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
}

type GuardResult<T> =
  | (T & { error?: never })
  | ({ [K in keyof T]?: never } & { error: NextResponse });

/** 401 JSON response unless a session exists. */
export async function requireAuth(): Promise<GuardResult<{ user: User }>> {
  const user = await getAuthUser();
  if (!user) {
    return {
      error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }
  return { user };
}

/**
 * 401 without a session, 403 unless the user is an admin or superadmin.
 * Returns the viewer's `role` (so routes can enforce tier-specific rules) and
 * the service-role client for writes that must bypass RLS — the anon-key client
 * silently matches zero rows on tables without a write policy.
 */
export async function requireAdmin(): Promise<
  GuardResult<{ user: User; adminClient: SupabaseClient; role: Role }>
> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return {
      error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }

  const { data: settings } = await supabase
    .from("user_settings")
    .select("role")
    .eq("user_id", user.id)
    .single();

  if (!isAdminRole(settings?.role)) {
    return {
      error: NextResponse.json({ error: "Forbidden" }, { status: 403 }),
    };
  }

  let adminClient: SupabaseClient;
  try {
    adminClient = createAdminClient();
  } catch {
    return {
      error: NextResponse.json(
        { error: "Server is missing SUPABASE_ADMIN_KEY" },
        { status: 500 },
      ),
    };
  }

  return { user, adminClient, role: (settings?.role ?? "admin") as Role };
}
