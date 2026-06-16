"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Icon } from "@/components/Icon";
import { canDeleteRole } from "@/lib/roles";

/**
 * Two-step delete affordance for the admin user table: a muted "Delete" reveals
 * an inline confirm/cancel pair, so a destructive, irreversible action can't
 * fire on a single stray click. Hidden for the admin's own row (self-deletion
 * lives in account settings) and for targets the viewer isn't allowed to delete
 * (plain admins can't delete admins/superadmins).
 */
export function DeleteUserButton({
  userId,
  email,
  targetRole,
  viewerRole,
  isSelf,
}: {
  userId: string;
  email: string;
  targetRole: string;
  viewerRole: string;
  isSelf: boolean;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  if (isSelf) {
    return (
      <span
        className="font-ui text-[11px] text-secondary opacity-50"
        title="Delete your own account from Settings"
      >
        you
      </span>
    );
  }

  // Plain admins can't delete admins/superadmins — show nothing rather than a
  // button the API would reject.
  if (!canDeleteRole(viewerRole, targetRole)) {
    return <span className="font-ui text-[11px] text-secondary opacity-30">—</span>;
  }

  async function handleDelete() {
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/users/${userId}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as { error?: string }).error ?? res.statusText);
      }
      toast.success(`Deleted ${email}`);
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to delete user");
      setBusy(false);
      setConfirming(false);
    }
  }

  if (confirming) {
    return (
      <span className="inline-flex items-center gap-2">
        <button
          onClick={handleDelete}
          disabled={busy}
          className={
            "rounded-full px-[11px] py-1 font-ui text-[11px] font-semibold tracking-[.02em] text-loss " +
            (busy ? "cursor-wait" : "cursor-pointer hover:brightness-110")
          }
          title="Confirm permanent deletion"
        >
          {busy ? "…" : "Confirm"}
        </button>
        <button
          onClick={() => setConfirming(false)}
          disabled={busy}
          className="cursor-pointer rounded-full px-2 py-1 font-ui text-[11px] text-secondary hover:text-primary"
          title="Cancel"
        >
          <Icon name="x" size={12} />
        </button>
      </span>
    );
  }

  return (
    <button
      onClick={() => setConfirming(true)}
      className="cursor-pointer rounded-full px-[11px] py-1 font-ui text-[11px] font-semibold tracking-[.02em] text-secondary transition-colors hover:text-loss"
      title={`Delete ${email}`}
    >
      Delete
    </button>
  );
}
