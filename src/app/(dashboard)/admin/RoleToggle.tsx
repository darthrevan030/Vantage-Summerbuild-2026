"use client";

import { motion, useReducedMotion } from "motion/react";
import { useOptimisticValue } from "@/hooks/useOptimisticToggle";
import { ROLES, canSetRole, type Role } from "@/lib/roles";

const ROLE_COLOR: Record<Role, string> = {
  superadmin: "text-gold",
  admin: "text-gain",
  user: "text-secondary",
};

export function RoleToggle({
  userId,
  initialRole,
  viewerRole,
}: {
  userId: string;
  initialRole: string;
  viewerRole: string;
}) {
  const reduce = useReducedMotion();
  const {
    value: role,
    busy,
    commit,
  } = useOptimisticValue(
    initialRole,
    (next) =>
      fetch(`/api/admin/users/${userId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: next }),
      }),
    (next) => `Role changed to ${next}`,
  );

  const color = ROLE_COLOR[role as Role] ?? "text-secondary";

  // Only superadmins manage roles; for everyone else the role is read-only.
  if (!canSetRole(viewerRole)) {
    return (
      <span
        className={
          "whitespace-nowrap px-[11px] py-1 font-ui text-[11px] font-semibold tracking-[.02em] " +
          color
        }
      >
        {role}
      </span>
    );
  }

  // Cycle user → admin → superadmin → user.
  const next = ROLES[(ROLES.indexOf(role as Role) + 1) % ROLES.length];

  return (
    <motion.button
      className={
        "whitespace-nowrap rounded-full border-none bg-transparent px-[11px] py-1 font-ui text-[11px] font-semibold tracking-[.02em] " +
        (busy ? "cursor-wait " : "cursor-pointer ") +
        color
      }
      whileTap={reduce ? undefined : { scale: 0.94 }}
      onClick={() => commit(next)}
      disabled={busy}
      title={`Click to change role to ${next}`}
    >
      {busy ? "…" : role}
    </motion.button>
  );
}
