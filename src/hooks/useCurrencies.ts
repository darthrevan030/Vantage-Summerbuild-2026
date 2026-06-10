"use client";

import { SUPPORTED_CURRENCIES } from "@/lib/formatters";
import { createCachedListHook } from "@/hooks/useCachedList";
import type { CurrencyRow } from "@/app/api/currencies/route";

export const useCurrencies = createCachedListHook<CurrencyRow, string[]>(
  "/api/currencies",
  [...SUPPORTED_CURRENCIES],
  (rows) => {
    const active = rows.filter((c) => c.active).map((c) => c.code);
    return active.length > 0 ? active : null;
  }
);
