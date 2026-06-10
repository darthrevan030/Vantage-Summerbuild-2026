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
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "10px 0",
        borderBottom: "1px solid var(--border-subtle)",
      }}
    >
      <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
        <span className="mono" style={{ fontSize: 12, minWidth: codeMinWidth }}>{code}</span>
        <span className="ui muted" style={{ fontSize: 12 }}>{label}</span>
        {region && (
          <span
            className="ui muted xs"
            style={{
              fontSize: 10,
              padding: "2px 6px",
              borderRadius: 4,
              background: "var(--bg-subtle, rgba(255,255,255,.06))",
            }}
          >
            {region}
          </span>
        )}
      </div>
      <button
        onClick={() => commit(!active)}
        disabled={busy}
        style={{
          cursor: busy ? "wait" : "pointer",
          border: "1px solid var(--border-subtle)",
          borderRadius: 6,
          padding: "4px 12px",
          fontSize: 11,
          fontFamily: "inherit",
          background: active ? "var(--gain-dim, rgba(74,222,128,.12))" : "transparent",
          color: active ? "var(--gain)" : "var(--text-muted)",
          transition: "all .15s",
        }}
      >
        {busy ? "…" : active ? "Active" : "Inactive"}
      </button>
    </div>
  );
}
