"use client";

import { motion, useReducedMotion } from "motion/react";
import { useOptimisticValue } from "@/hooks/useOptimisticToggle";

export function RoleToggle({ userId, initialRole }: { userId: string; initialRole: string }) {
  const reduce = useReducedMotion();
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
    <motion.button
      className={
        "whitespace-nowrap rounded-full border-none bg-transparent px-[11px] py-1 font-ui text-[11px] font-semibold tracking-[.02em] " +
        (busy ? "cursor-wait " : "cursor-pointer ") +
        (role === "admin" ? "text-gain" : "text-gold")
      }
      whileTap={reduce ? undefined : { scale: 0.94 }}
      onClick={() => commit(role === "admin" ? "user" : "admin")}
      disabled={busy}
      title={role === "admin" ? "Click to demote to user" : "Click to promote to admin"}
    >
      {busy ? "…" : role}
    </motion.button>
  );
}
