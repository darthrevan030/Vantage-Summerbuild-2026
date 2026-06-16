// Three-tier role model. Higher tiers are a strict superset of lower ones:
//   user        — ordinary account
//   admin       — manages shared data + can delete plain users
//   superadmin  — manages the admin roster: the ONLY tier that can promote,
//                 demote, or delete admins (and other superadmins)
//
// This module is pure and import-free so both client UI and server routes can
// enforce the exact same matrix — the UI hides what the API would reject.

export type Role = "user" | "admin" | "superadmin";

export const ROLES: Role[] = ["user", "admin", "superadmin"];

/** Both admin tiers get admin-level access (data RLS, admin dashboard). */
export function isAdminRole(role: string | null | undefined): boolean {
  return role === "admin" || role === "superadmin";
}

export function isSuperadminRole(role: string | null | undefined): boolean {
  return role === "superadmin";
}

/**
 * Can `actor` delete an account whose role is `target`?
 * Superadmins can delete anyone (the last-superadmin lockout is guarded
 * separately); plain admins may only delete ordinary users.
 */
export function canDeleteRole(actor: string, target: string): boolean {
  if (actor === "superadmin") return true;
  if (actor === "admin") return target === "user";
  return false;
}

/**
 * Can `actor` change a role (promote/demote)? Reserved to superadmins —
 * every role change touches the admin roster (creating, demoting, or deleting
 * an admin/superadmin), which is exactly what only superadmins may do. The
 * last-superadmin demotion is blocked separately by a DB trigger.
 */
export function canSetRole(actor: string): boolean {
  return actor === "superadmin";
}
