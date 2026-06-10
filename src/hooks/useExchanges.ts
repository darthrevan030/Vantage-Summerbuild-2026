"use client";

import { createCachedListHook } from "@/hooks/useCachedList";
import type { ExchangeRow } from "@/app/api/exchanges/route";

const NONE: ExchangeRow = { code: "", label: "— No exchange (physical / unlisted)", region: "", active: true, display_order: 0 };

export const useExchanges = createCachedListHook<ExchangeRow, ExchangeRow[]>(
  "/api/exchanges",
  [NONE],
  (rows) => [NONE, ...rows.filter((e) => e.active)]
);
