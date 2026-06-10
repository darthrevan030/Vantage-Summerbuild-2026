"use client";

import { useState } from "react";
import { toast } from "sonner";

/**
 * Optimistic remote value: applies `next` locally, sends the PATCH, and rolls
 * back with an error toast if the request fails. Shared by the admin toggles.
 */
export function useOptimisticValue<T>(
  initial: T,
  send: (next: T) => Promise<Response>,
  successMsg?: (next: T) => string
) {
  const [value, setValue] = useState(initial);
  const [busy, setBusy] = useState(false);

  const commit = async (next: T) => {
    if (busy) return;
    const prev = value;
    setValue(next);
    setBusy(true);

    try {
      const res = await send(next);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as { error?: string }).error ?? res.statusText);
      }
      if (successMsg) toast.success(successMsg(next));
    } catch (e) {
      setValue(prev);
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  };

  return { value, busy, commit };
}
