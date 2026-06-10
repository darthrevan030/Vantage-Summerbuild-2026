"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "react-toastify";
import { usePortfolio } from "@/context/portfolio";
import { Icon } from "@/components/Icon";
import { CCY_SYMBOL } from "@/lib/formatters";
import { useCurrencies } from "@/hooks/useCurrencies";

type SaveState = "idle" | "saving" | "saved" | "error";

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
    <div className="tab-body">
      <div className="settings-header reveal">
        <div>
          <div className="ui muted xs" style={{ letterSpacing: ".12em", textTransform: "uppercase", marginBottom: 6 }}>User Settings</div>
          <h2 className="serif settings-title">Preferences</h2>
          <p className="ui muted" style={{ fontSize: 13, marginTop: 4 }}>
            Personalise your portfolio terminal.
          </p>
        </div>
      </div>

      <form onSubmit={handleSave} className="settings-form reveal" style={{ animationDelay: ".06s" }}>

        {/* Display Name */}
        <div className="card settings-card">
          <div className="card-head">
            <span className="card-title">Display Name</span>
            <span className="ui muted">shown in the top-left wordmark</span>
          </div>
          <div className="field full">
            <label className="field-label">Your name</label>
            <input
              type="text"
              className="inp"
              value={nameInput}
              onChange={(e) => setNameInput(e.target.value)}
              placeholder="e.g. Alex"
              maxLength={40}
            />
          </div>
          <div className="settings-preview">
            <span className="ui muted xs">Preview:</span>
            <span className="serif settings-wordmark-preview">{previewWordmark}</span>
          </div>
        </div>

        {/* Base Currency */}
        <div className="card settings-card">
          <div className="card-head">
            <span className="card-title">Base Currency</span>
            <span className="ui muted">all portfolio totals convert to this currency</span>
          </div>
          <div className="ccy-picker">
            {currencies.map((c) => (
              <button
                key={c}
                type="button"
                className={"ccy-opt" + (ccyInput === c ? " active" : "")}
                onClick={() => setCcyInput(c)}
              >
                <span className="mono ccy-sym">{CCY_SYMBOL[c] ?? c}</span>
                <span className="ui ccy-code">{c}</span>
                {c !== "SGD" && baseFxRates[c] && (
                  <span className="mono ccy-rate muted">
                    {isLiveRate(c) ? "" : "~"}{baseFxRates[c].toFixed(4)} SGD
                  </span>
                )}
              </button>
            ))}
          </div>
          {ccyInput !== "SGD" && (
            <p className="ui muted" style={{ fontSize: 12, marginTop: 12 }}>
              {isLiveRate(ccyInput)
                ? "Rate from your current holdings. Refreshes on page reload."
                : "Approximate static rate — add a holding in this currency for a live rate."}
            </p>
          )}
        </div>

        {/* Save */}
        <div className="settings-actions">
          <button
            type="submit"
            className="btn-gold"
            disabled={!isDirty || saveState === "saving"}
            style={{ gridColumn: "auto", opacity: !isDirty ? 0.5 : 1 }}
          >
            {saveState === "saving" ? (
              <><Icon name="refresh" size={15} className="spin-icon" /> Saving…</>
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
              className="icon-btn ghost"
              onClick={() => { setNameInput(displayName); setCcyInput(baseCurrency); }}
            >
              Discard changes
            </button>
          )}
        </div>

      </form>

      {role === "admin" && (
        <div className="card reveal" style={{ animationDelay: ".14s" }}>
          <div className="card-head">
            <span className="card-title">Admin</span>
            <span className="sent-pill bull">admin</span>
          </div>
          <p className="ui muted" style={{ fontSize: 13, marginBottom: 14 }}>
            Manage users, price cache health, and supported currencies.
          </p>
          <button
            className="btn-gold"
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
