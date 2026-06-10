"use client";

import { useOptimisticValue } from "@/hooks/useOptimisticToggle";

export function RoleToggle({ userId, initialRole }: { userId: string; initialRole: string }) {
  const { value: role, busy, commit } = useOptimisticValue(
    initialRole,
    (next) =>
      fetch(`/api/admin/users/${userId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: next }),
      }),
    (next) => `Role changed to ${next}`
  );

  return (
    <button
      className={"sent-pill " + (role === "admin" ? "bull" : "neut")}
      style={{ cursor: busy ? "wait" : "pointer", border: "none", background: "transparent" }}
      onClick={() => commit(role === "admin" ? "user" : "admin")}
      disabled={busy}
      title={role === "admin" ? "Click to demote to user" : "Click to promote to admin"}
    >
      {busy ? "…" : role}
    </button>
  );
}
