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
