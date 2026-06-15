import { createAdminClient } from "@/lib/supabase/admin";

export interface ProviderFlags {
  sgx:         boolean;
  eodhd:       boolean;
  yahoo:       boolean;
  coingecko:   boolean;
  goldapi:     boolean;
  finnhub:     boolean;
  frankfurter: boolean;
  anthropic: boolean;
}

const DEFAULT: ProviderFlags = {
  sgx: true, eodhd: true, yahoo: true, coingecko: true, goldapi: true,
  finnhub: true, frankfurter: true, anthropic: true,
};

// CPF LIFE monthly payout rates: dollars of payout per $1,000 of Retirement
// Account balance, keyed by plan then by payout-start age. Deferring the start
// age raises the rate (the deferral premium is baked into the figures).
export interface CpfLifeRates {
  basic: Record<string, number>;
  standard: Record<string, number>;
}

const DEFAULT_CPF_LIFE_RATES: CpfLifeRates = {
  basic: { "65": 7.58, "70": 9.21, "80": 14.47 },
  standard: { "65": 8.94, "70": 10.89, "80": 17.08 },
};

export async function getCpfLifeRates(): Promise<CpfLifeRates> {
  try {
    const admin = createAdminClient();
    const { data, error } = await admin
      .from("app_config")
      .select("value")
      .eq("key", "cpf_life_rates")
      .maybeSingle();
    if (error || !data?.value) return DEFAULT_CPF_LIFE_RATES;
    const v = data.value as Partial<CpfLifeRates>;
    return {
      basic: v.basic ?? DEFAULT_CPF_LIFE_RATES.basic,
      standard: v.standard ?? DEFAULT_CPF_LIFE_RATES.standard,
    };
  } catch {
    return DEFAULT_CPF_LIFE_RATES;
  }
}

export async function getProviderFlags(): Promise<ProviderFlags> {
  try {
    const admin = createAdminClient();
    const { data, error } = await admin.from("app_config").select("key, value");
    if (error || !data) return DEFAULT;

    const flags = { ...DEFAULT };
    for (const row of data) {
      const k = row.key as keyof ProviderFlags;
      if (k in flags) flags[k] = Boolean(row.value);
    }
    return flags;
  } catch {
    return DEFAULT;
  }
}
