"use client";

import { useState } from "react";
import { toast } from "sonner";

interface CpfLifeRates {
  basic: Record<string, number>;
  standard: Record<string, number>;
}

const PLANS = ["basic", "standard"] as const;
const AGES = ["65", "70", "80"] as const;

type Plan = (typeof PLANS)[number];

// Editable rate table for the CPF LIFE calculator. Values are stored as
// dollars of monthly payout per $1,000 of Retirement Account balance — the
// server validator (validateCpfLifeRates in /api/admin/config/[key]) enforces
// 0.1–100 per cell so we don't need to gate here beyond formatting.
export function CpfLifeRatesEditor({ initial }: { initial: CpfLifeRates }) {
  const toForm = (r: CpfLifeRates): Record<Plan, Record<string, string>> => ({
    basic: Object.fromEntries(AGES.map((a) => [a, String(r.basic[a] ?? "")])),
    standard: Object.fromEntries(
      AGES.map((a) => [a, String(r.standard[a] ?? "")]),
    ),
  });

  const [form, setForm] = useState(() => toForm(initial));
  const [saving, setSaving] = useState(false);
  const [baseline, setBaseline] = useState(() => toForm(initial));

  const dirty = PLANS.some((p) =>
    AGES.some((a) => form[p][a] !== baseline[p][a]),
  );

  const set = (plan: Plan, age: string, v: string) =>
    setForm((f) => ({ ...f, [plan]: { ...f[plan], [age]: v } }));

  async function handleSave() {
    setSaving(true);
    try {
      const rates: CpfLifeRates = { basic: {}, standard: {} };
      for (const plan of PLANS) {
        for (const age of AGES) {
          const n = parseFloat(form[plan][age]);
          if (!Number.isFinite(n)) {
            throw new Error(`Invalid value for ${plan} · age ${age}`);
          }
          rates[plan][age] = n;
        }
      }
      const res = await fetch("/api/admin/config/cpf_life_rates", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rates }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(body.error ?? "Save failed");
      }
      toast.success("CPF LIFE rates saved");
      setBaseline(toForm(rates));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  function handleReset() {
    setForm(baseline);
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="text-[11px] text-secondary">
        Monthly payout per S$1,000 of Retirement Account balance. Update when
        CPF Board revises the tables.
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[360px] border-collapse text-[12.5px]">
          <thead>
            <tr>
              <th className="border-b border-subtle px-2 py-2 text-left font-ui text-[10.5px] font-semibold uppercase tracking-[.08em] text-muted">
                Plan
              </th>
              {AGES.map((a) => (
                <th
                  key={a}
                  className="border-b border-subtle px-2 py-2 text-right font-ui text-[10.5px] font-semibold uppercase tracking-[.08em] text-muted"
                >
                  Age {a}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {PLANS.map((plan) => (
              <tr key={plan}>
                <td className="border-b border-subtle px-2 py-2 font-ui capitalize text-primary">
                  {plan}
                </td>
                {AGES.map((age) => (
                  <td
                    key={age}
                    className="border-b border-subtle px-2 py-2 text-right"
                  >
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={form[plan][age]}
                      onChange={(e) => set(plan, age, e.target.value)}
                      className="w-20 rounded-[6px] border border-subtle bg-surface px-2 py-1 text-right font-mono text-[12px] tabular-nums text-primary outline-none transition-[border-color] duration-150 focus:border-gold-soft"
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex items-center gap-2">
        <button
          onClick={handleSave}
          disabled={saving || !dirty}
          className="cursor-pointer rounded-[8px] border border-subtle bg-surface px-[13px] py-[6px] font-ui text-[12px] text-primary transition-all duration-150 hover:border-gold-soft hover:text-gold disabled:cursor-not-allowed disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save rates"}
        </button>
        <button
          onClick={handleReset}
          disabled={saving || !dirty}
          className="cursor-pointer rounded-[8px] border border-subtle bg-transparent px-[13px] py-[6px] font-ui text-[12px] text-secondary transition-all duration-150 hover:text-primary disabled:cursor-not-allowed disabled:opacity-50"
        >
          Reset
        </button>
      </div>
    </div>
  );
}
