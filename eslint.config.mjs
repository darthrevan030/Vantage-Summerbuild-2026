import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Generated vitest coverage output — never source.
    "coverage/**",
    // remember plugin scratch directory — not source.
    ".remember/**",
    // Old .jsx mockups — prototype leftovers, nothing in src/ imports them (see AGENTS.md).
    "design/**",
  ]),
]);

export default eslintConfig;
