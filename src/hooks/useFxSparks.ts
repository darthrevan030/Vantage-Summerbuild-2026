"use client";

import { useState, useEffect } from "react";

// Module-level cache — keyed by "USD_SGD", "EUR_SGD", etc. Shared across FX Lab mounts
const SPARK_CACHE: Record<string, number[]> = {};

export function useFxSparks(
  codes: string[],
  base: string = "SGD",
): Record<string, number[]> {
  const [sparks, setSparks] = useState<Record<string, number[]>>(() => {
    const cached: Record<string, number[]> = {};
    for (const c of codes) {
      const k = `${c}_${base}`;
      if (SPARK_CACHE[k]) cached[c] = SPARK_CACHE[k];
    }
    return cached;
  });

  useEffect(() => {
    if (codes.length === 0) return;

    const missing = codes.filter((c) => !(`${c}_${base}` in SPARK_CACHE));
    if (missing.length === 0) {
      const result: Record<string, number[]> = {};
      for (const c of codes) result[c] = SPARK_CACHE[`${c}_${base}`] ?? [];
      // Deferred (like the fetch branch below) so the update isn't a
      // synchronous setState call within the effect body itself.
      Promise.resolve().then(() => setSparks(result));
      return;
    }

    Promise.all(
      missing.map((ccy) =>
        fetch(`/api/fx/candles?ccy=${ccy}&base=${base}`)
          .then((r) => r.json())
          .then((d: { closes?: number[] }) => {
            SPARK_CACHE[`${ccy}_${base}`] = Array.isArray(d.closes)
              ? d.closes
              : [];
          })
          .catch(() => {
            SPARK_CACHE[`${ccy}_${base}`] = [];
          }),
      ),
    ).then(() => {
      const result: Record<string, number[]> = {};
      for (const c of codes) result[c] = SPARK_CACHE[`${c}_${base}`] ?? [];
      setSparks(result);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [codes.join(","), base]);

  return sparks;
}
