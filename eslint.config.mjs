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
    // Junk / worktree / artifact directories that are not part of the app:
    ".kilo/**",
    "graphify-out/**",
    "marketing-video/**",
    ".impeccable/**",
    // chrome-extension is a self-contained Vite project with its own lint:
    //   cd chrome-extension && npm run lint
    "chrome-extension/**",
    // Vendored third-party minified libraries & one-off diagnostic scripts.
    "public/account/vendor/html2canvas.min.js",
    "scripts/diag-final.cjs",
    "scripts/check_db.mjs",
  ]),
]);

export default eslintConfig;
