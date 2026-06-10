"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { usePortfolio } from "@/context/portfolio";
import { Icon } from "@/components/Icon";
import { CCY_SYMBOL } from "@/lib/formatters";
import { useCurrencies } from "@/hooks/useCurrencies";

type SaveState = "idle" | "saving" | "saved" | "error";

const BTN_GOLD =
  "flex items-center justify-center gap-2 cursor-pointer rounded-[10px] bg-gold p-[13px] mt-1 font-ui text-[13.5px] font-semibold text-[#15130c] [transition:filter_.15s,transform_.1s] hover:brightness-[1.08] active:translate-y-px disabled:opacity-60 disabled:saturate-[.7] disabled:cursor-default";

export default function SettingsPage() {
  const { displayName, baseCurrency, baseFxRates, fxColors, role, setDisplayName, setBaseCurrency } = usePortfolio();
  const currencies = useCurrencies();
  const router = useRouter();

  const [nameInput, setNameInput] = useState(displayName);
  const [ccyInput, setCcyInput] = useState(baseCurrency);
  const [saveState, setSaveState] = useState<SaveState>("idle");

  const isLiveRate = (c: string) => c === "SGD" || c.toLowerCase() in fxColors;

  const isDirty = nameInput !== displayName || ccyInput !== baseCurrency;

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaveState("saving");

    const res = await fetch("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ displayName: nameInput, baseCurrency: ccyInput }),
    });

    if (res.ok) {
      setDisplayName(nameInput);
      setBaseCurrency(ccyInput);
      setSaveState("saved");
      toast.success("Preferences saved");
      setTimeout(() => setSaveState("idle"), 2000);
    } else {
      setSaveState("error");
      const body = await res.json().catch(() => ({}));
      toast.error((body as { error?: string }).error ?? "Failed to save preferences");
      setTimeout(() => setSaveState("idle"), 3000);
    }
  }

  const previewWordmark = nameInput.trim() ? `${nameInput.trim()}'s Portfolio` : "PORTFOLIO";

  return (
    <div className="flex flex-col gap-4.5 min-w-0 w-full">
      <div className="mb-1 animate-reveal">
        <div>
          <div className="font-ui text-secondary text-[11px] tracking-[.04em]" style={{ letterSpacing: ".12em", textTransform: "uppercase", marginBottom: 6 }}>User Settings</div>
          <h2 className="font-serif font-normal text-[28px] m-0 text-primary">Preferences</h2>
          <p className="font-ui text-secondary" style={{ fontSize: 13, marginTop: 4 }}>
            Personalise your portfolio terminal.
          </p>
        </div>
      </div>

      <form onSubmit={handleSave} className="flex flex-col gap-4.5 animate-reveal" style={{ animationDelay: ".06s" }}>

        {/* Display Name */}
        <div className="card flex flex-col gap-4 px-5 py-4.5 max-bp480:p-3.5 max-bp380:p-3">
          <div className="flex items-baseline justify-between mb-4">
            <span className="text-[13px] font-semibold text-primary tracking-[.01em]">Display Name</span>
            <span className="font-ui text-secondary text-[11px]">shown in the top-left wordmark</span>
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs text-secondary">Your name</label>
            <input
              type="text"
              className="inp"
              value={nameInput}
              onChange={(e) => setNameInput(e.target.value)}
              placeholder="e.g. Alex"
              maxLength={40}
            />
          </div>
          <div className="flex items-center gap-3 mt-1.5 px-3.5 py-2.5 bg-elevated border border-subtle rounded-[10px]">
            <span className="font-ui text-secondary text-[11px] tracking-[.04em]">Preview:</span>
            <span className="font-serif font-normal text-[18px] text-gold tracking-[.3px] [text-shadow:0_0_14px_var(--accent-glow)]">{previewWordmark}</span>
          </div>
        </div>

        {/* Base Currency */}
        <div className="card flex flex-col gap-4 px-5 py-4.5 max-bp480:p-3.5 max-bp380:p-3">
          <div className="flex items-baseline justify-between mb-4">
            <span className="text-[13px] font-semibold text-primary tracking-[.01em]">Base Currency</span>
            <span className="font-ui text-secondary text-[11px]">all portfolio totals convert to this currency</span>
          </div>
          <div className="flex flex-wrap gap-2.5">
            {currencies.map((c) => (
              <button
                key={c}
                type="button"
                className={
                  "bg-elevated border rounded-[11px] px-4 py-3 cursor-pointer flex flex-col gap-[3px] [transition:border-color_.15s,background_.15s,box-shadow_.15s] text-left min-w-[110px] " +
                  (ccyInput === c
                    ? "border-gold-soft bg-wash shadow-[inset_0_0_0_1px_var(--border-gold)]"
                    : "border-subtle hover:border-muted")
                }
                onClick={() => setCcyInput(c)}
              >
                <span className="font-mono text-base font-bold text-primary">{CCY_SYMBOL[c] ?? c}</span>
                <span className="font-ui text-xs text-secondary">{c}</span>
                {c !== "SGD" && baseFxRates[c] && (
                  <span className="font-mono text-[10px] mt-0.5 text-secondary">
                    {isLiveRate(c) ? "" : "~"}{baseFxRates[c].toFixed(4)} SGD
                  </span>
                )}
              </button>
            ))}
          </div>
          {ccyInput !== "SGD" && (
            <p className="font-ui text-secondary" style={{ fontSize: 12, marginTop: 12 }}>
              {isLiveRate(ccyInput)
                ? "Rate from your current holdings. Refreshes on page reload."
                : "Approximate static rate — add a holding in this currency for a live rate."}
            </p>
          )}
        </div>

        {/* Save */}
        <div className="flex items-center gap-3 flex-wrap">
          <button
            type="submit"
            className={BTN_GOLD}
            disabled={!isDirty || saveState === "saving"}
            style={{ gridColumn: "auto", opacity: !isDirty ? 0.5 : 1 }}
          >
            {saveState === "saving" ? (
              <><Icon name="refresh" size={15} className="animate-spin-slow" /> Saving…</>
            ) : saveState === "saved" ? (
              <><Icon name="check" size={15} /> Saved</>
            ) : saveState === "error" ? (
              "Error — try again"
            ) : (
              "Save preferences"
            )}
          </button>
          {isDirty && saveState === "idle" && (
            <button
              type="button"
              className="flex items-center gap-[7px] cursor-pointer rounded-[9px] px-[13px] py-2 font-ui text-[12.5px] transition-all duration-150 bg-surface border border-subtle text-secondary hover:text-gold hover:border-gold-soft"
              onClick={() => { setNameInput(displayName); setCcyInput(baseCurrency); }}
            >
              Discard changes
            </button>
          )}
        </div>

      </form>

      {role === "admin" && (
        <div className="card px-5 py-4.5 max-bp480:p-3.5 max-bp380:p-3 animate-reveal" style={{ animationDelay: ".14s" }}>
          <div className="flex items-baseline justify-between mb-4">
            <span className="text-[13px] font-semibold text-primary tracking-[.01em]">Admin</span>
            <span className="font-ui text-[11px] font-semibold px-[11px] py-1 rounded-full whitespace-nowrap tracking-[.02em] bg-[rgba(70,216,160,.14)] text-gain">admin</span>
          </div>
          <p className="font-ui text-secondary" style={{ fontSize: 13, marginBottom: 14 }}>
            Manage users, price cache health, and supported currencies.
          </p>
          <button
            className={BTN_GOLD}
            style={{ margin: 0, padding: "11px 20px", gridColumn: "auto" }}
            onClick={() => router.push("/admin")}
          >
            <Icon name="sliders" size={14} /> Admin Dashboard
          </button>
        </div>
      )}
    </div>
  );
}
