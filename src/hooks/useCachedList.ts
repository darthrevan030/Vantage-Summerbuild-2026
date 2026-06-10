"use client";

import { useState, useEffect } from "react";

/**
 * Builds a hook that fetches `url` once per browser session (module-closure
 * cache shared across all components) and falls back to `initial` until data
 * arrives. `select` maps the raw rows to the hook's output; return null to
 * keep the fallback and skip caching (e.g. an empty active list).
 */
export function createCachedListHook<Row, Out>(
  url: string,
  initial: Out,
  select: (rows: Row[]) => Out | null
): () => Out {
  let cache: Out | null = null;

  return function useCachedList(): Out {
    const [value, setValue] = useState<Out>(cache ?? initial);

    useEffect(() => {
      if (cache) return;
      fetch(url)
        .then((r) => r.json())
        .then((rows: Row[]) => {
          const out = select(rows);
          if (out !== null) {
            cache = out;
            setValue(out);
          }
        })
        .catch(() => {});
    }, []);

    return value;
  };
}
