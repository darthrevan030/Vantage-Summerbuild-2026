"use client";

import { useState } from "react";
import type { ExchangeRow } from "@/app/api/exchanges/route";

export function ExchangeToggle({ exchange }: { exchange: ExchangeRow }) {
  const [active, setActive] = useState(exchange.active);
  const [busy, setBusy]     = useState(false);
  const [error, setError]   = useState<string | null>(null);

  const toggle = async () => {
    if (busy) return;
    const next = !active;
    const prev = active;
    setActive(next);
    setBusy(true);
    setError(null);

    try {
      const res = await fetch(`/api/admin/exchanges/${encodeURIComponent(exchange.code)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active: next }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as { error?: string }).error ?? res.statusText);
      }
    } catch (e) {
      setActive(prev);
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  };

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
        <span className="mono" style={{ fontSize: 12, minWidth: 48 }}>{exchange.code}</span>
        <span className="ui muted" style={{ fontSize: 12 }}>{exchange.label}</span>
        <span
          className="ui muted xs"
          style={{
            fontSize: 10,
            padding: "2px 6px",
            borderRadius: 4,
            background: "var(--bg-subtle, rgba(255,255,255,.06))",
          }}
        >
          {exchange.region}
        </span>
        {error && <span style={{ fontSize: 10, color: "var(--loss)" }}>{error}</span>}
      </div>
      <button
        onClick={toggle}
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
