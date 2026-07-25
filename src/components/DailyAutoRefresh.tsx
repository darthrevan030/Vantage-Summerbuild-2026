"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { refreshHoldingPrices } from "@/lib/api-client";

// Fires the manual-refresh endpoint once, silently, on the first visit of the
// SGT day (trigger = no snapshot recorded today). The ref guards against React
// StrictMode's double-invoke and any re-render; after router.refresh() the
// server layout recomputes trigger=false, so this never loops.
export function DailyAutoRefresh({ trigger }: { trigger: boolean }) {
  const router = useRouter();
  const fired = useRef(false);

  useEffect(() => {
    if (!trigger || fired.current) return;
    fired.current = true;
    refreshHoldingPrices()
      .then(() => router.refresh())
      .catch(() => {
        // Best-effort: the manual refresh buttons remain available.
      });
  }, [trigger, router]);

  return null;
}
