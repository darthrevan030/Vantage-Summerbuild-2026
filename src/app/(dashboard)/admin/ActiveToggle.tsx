"use client";

import { useOptimisticValue } from "@/hooks/useOptimisticToggle";

interface ActiveToggleProps {
  code: string;
  label: string;
  region?: string;
  initialActive: boolean;
  endpoint: string; // e.g. "/api/admin/currencies"
  codeMinWidth?: number;
}

export function ActiveToggle({
  code,
  label,
  region,
  initialActive,
  endpoint,
  codeMinWidth = 36,
}: ActiveToggleProps) {
  const { value: active, busy, commit } = useOptimisticValue(
    initialActive,
    (next) =>
      fetch(`${endpoint}/${encodeURIComponent(code)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active: next }),
      }),
    (next) => `${code} ${next ? "activated" : "deactivated"}`
  );

  return (
    <div className="flex items-center justify-between border-b border-subtle py-2.5">
      <div className="flex items-center gap-2.5">
        <span className="font-mono text-xs tabular-nums" style={{ minWidth: codeMinWidth }}>{code}</span>
        <span className="font-ui text-xs text-secondary">{label}</span>
        {region && (
          <span className="rounded bg-[var(--bg-subtle,rgba(255,255,255,.06))] px-1.5 py-0.5 font-ui text-[10px] tracking-[.04em] text-secondary">
            {region}
          </span>
        )}
      </div>
      <button
        onClick={() => commit(!active)}
        disabled={busy}
        className={
          "rounded-md border border-subtle px-3 py-1 font-[inherit] text-[11px] transition-all duration-150 " +
          (busy ? "cursor-wait " : "cursor-pointer ") +
          (active ? "bg-[var(--gain-dim,rgba(74,222,128,.12))] text-gain" : "bg-transparent text-muted")
        }
      >
        {busy ? "…" : active ? "Active" : "Inactive"}
      </button>
    </div>
  );
}
