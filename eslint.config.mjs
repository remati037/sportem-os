import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import prettier from "eslint-config-prettier";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Gasi ESLint pravila koja se sudaraju sa Prettier-om (mora poslednje).
  prettier,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Serwist generisani service worker (build artefakt) — ne lintuje se.
    "public/sw.js",
    "public/swe-worker-*.js",
  ]),
]);

export default eslintConfig;
