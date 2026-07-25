import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    environment: "node",
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: ["src/lib/**/*.ts"],
      exclude: [
        "src/lib/seed.ts",
        "src/lib/api-client.ts",
        "src/lib/snapshots/fetch.ts", // network fetcher (EODHD/Frankfurter/Yahoo), like prices.ts/providers
        "src/lib/reconcile-cash.ts", // thin DB-orchestration glue over the excluded supabase/data layer
        "src/lib/supabase/**",
        "src/lib/providers/**",
        "src/lib/pdf-parsers/**",
        "src/lib/prices.ts",
        "src/lib/useCountUp.ts",
        "src/lib/useDateRange.ts",
        "src/lib/api/**",
        "src/lib/positions.ts",
        "src/lib/hexA.ts",
      ],
    },
  },
});
