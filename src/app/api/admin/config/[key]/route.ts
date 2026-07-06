import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/supabase/guards";

// Boolean provider flags. Each row's `value` is a JSONB true/false.
const BOOLEAN_KEYS = new Set([
  "sgx",
  "eodhd",
  "yahoo",
  "coingecko",
  "goldapi",
  "finnhub",
  "frankfurter",
  "anthropic",
  "openrouter",
  "alphavantage",
  "newsapi",
]);

// Structured (JSONB object) keys. Each has its own validator below.
const OBJECT_KEYS = new Set(["cpf_life_rates"]);

const CPF_PLANS = ["basic", "standard"] as const;
const CPF_AGES = ["65", "70", "80"] as const;
// Payout rates are dollars per $1,000 of RA. Real-world figures sit in the
// 6–18 range; we bracket 0.1–100 so admins have room for future CPF Board
// revisions while still rejecting obviously-broken values (negatives, NaN,
// two-orders-of-magnitude typos).
const CPF_RATE_MIN = 0.1;
const CPF_RATE_MAX = 100;

interface CpfLifeRates {
  basic: Record<string, number>;
  standard: Record<string, number>;
}

// Validates the CPF LIFE rate structure. Returns the cleaned object on
// success or a user-safe error string on failure.
function validateCpfLifeRates(body: unknown): CpfLifeRates | string {
  if (!body || typeof body !== "object") return "rates must be an object";
  const b = body as Record<string, unknown>;
  const out: CpfLifeRates = { basic: {}, standard: {} };
  for (const plan of CPF_PLANS) {
    const rec = b[plan];
    if (!rec || typeof rec !== "object")
      return `${plan} must be an object of ages → rates`;
    const r = rec as Record<string, unknown>;
    for (const age of CPF_AGES) {
      const raw = r[age];
      const n = Number(raw);
      if (!Number.isFinite(n) || n < CPF_RATE_MIN || n > CPF_RATE_MAX)
        return `${plan}.${age} must be a number between ${CPF_RATE_MIN} and ${CPF_RATE_MAX}`;
      out[plan][age] = n;
    }
  }
  return out;
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ key: string }> },
) {
  const { adminClient, user, error: authError } = await requireAdmin();
  if (authError) return authError;

  const { key } = await params;
  if (!BOOLEAN_KEYS.has(key) && !OBJECT_KEYS.has(key)) {
    return NextResponse.json({ error: "Unknown config key" }, { status: 400 });
  }

  const body = await req.json();

  let nextValue: unknown;
  let auditDetail: Record<string, unknown>;

  if (BOOLEAN_KEYS.has(key)) {
    const { active } = body ?? {};
    if (typeof active !== "boolean") {
      return NextResponse.json(
        { error: "active must be a boolean" },
        { status: 400 },
      );
    }
    nextValue = active;
    auditDetail = { active };
  } else {
    // key === "cpf_life_rates" — validate nested plan/age structure.
    const validated = validateCpfLifeRates(body?.rates);
    if (typeof validated === "string") {
      return NextResponse.json({ error: validated }, { status: 400 });
    }
    nextValue = validated;
    auditDetail = { rates: validated };
  }

  const { error } = await adminClient
    .from("app_config")
    .update({ value: nextValue, updated_at: new Date().toISOString() })
    .eq("key", key);

  if (error) {
    console.error("[admin/config] DB error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }

  await adminClient.from("audit_log").insert({
    actor_id: user.id,
    action: "config_update",
    target_id: key,
    detail: auditDetail,
  });

  return NextResponse.json({ key, value: nextValue });
}
