// ─────────────────────────────────────────────────────────────────────────────
// jiti runner with @/ path aliases + Next.js env loading.
//
// The plain `jiti` CLI does not resolve tsconfig `paths` and does not load
// .env.local, which some app modules need at import time (e.g. firebase-admin).
// This bootstrap replicates the app's import environment so tests can import
// canonical modules directly.
//
// Usage: node scripts/jiti-tsrun.mjs <path-to-test-runner.ts>
// ─────────────────────────────────────────────────────────────────────────────

import { resolve } from "node:path";
import nextEnv from "@next/env";
import { createJiti } from "jiti";

const { loadEnvConfig } = nextEnv;

const script = process.argv[2];
if (!script) {
    console.error("Usage: node scripts/jiti-tsrun.mjs <path-to-test-runner.ts>");
    process.exit(1);
}

// Load .env.local / .env the same way `next dev` does.
loadEnvConfig(process.cwd());

const jiti = createJiti(process.cwd(), {
    // Enable tsconfig `paths` resolution ("@/*" → repo root).
    tsconfigPaths: true,
    moduleCache: false,
});

await jiti.import(resolve(process.cwd(), script)).catch((error) => {
    console.error(error);
    process.exit(1);
});