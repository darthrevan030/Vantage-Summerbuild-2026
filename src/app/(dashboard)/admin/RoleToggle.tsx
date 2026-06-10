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
      className={
        "whitespace-nowrap rounded-full border-none bg-transparent px-[11px] py-1 font-ui text-[11px] font-semibold tracking-[.02em] " +
        (busy ? "cursor-wait " : "cursor-pointer ") +
        (role === "admin" ? "text-gain" : "text-gold")
      }
      onClick={() => commit(role === "admin" ? "user" : "admin")}
      disabled={busy}
      title={role === "admin" ? "Click to demote to user" : "Click to promote to admin"}
    >
      {busy ? "…" : role}
    </button>
  );
}
