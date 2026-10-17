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

// When the test surface touches security/auth/monitoring modules we route the
// firebase-admin family to an in-memory test seam so the authorization
// gates under test never touch real credentials or the network:
//   tests/security/route-auth-negative.test.ts
//   tests/security/fakes.ts
// Any runner under tests/security/ gets the seam (path-based, so new security
// suites do not silently fall through to the real SDK).
const isSecurityTest = script.includes("tests/security/");

// `server-only` is a build-time marker: its default export throws so the module
// can never be pulled into a client bundle, while Next.js resolves the
// `react-server` condition to the package's empty entry on the server. jiti does
// not apply that condition, so a Node-side test runner importing real server
// modules (e.g. lib/firebase-admin.ts) crashed at import time before any test
// ran. Alias the marker to the same empty entry Next uses on the server. This
// only affects this runner — application bundling and the marker itself in
// application code are untouched.
const serverOnlyAlias = {
    "server-only": resolve(process.cwd(), "node_modules/server-only/empty.js"),
};

const securityAlias = isSecurityTest
    ? {
          "firebase-admin": resolve(process.cwd(), "tests/security/firebase-admin-stub.ts"),
          "firebase-admin/app": resolve(process.cwd(), "tests/security/firebase-admin-stub.ts"),
          "firebase-admin/auth": resolve(process.cwd(), "tests/security/firebase-admin-stub.ts"),
          "firebase-admin/database": resolve(process.cwd(), "tests/security/firebase-admin-stub.ts"),
      }
    : {};

const jiti = createJiti(process.cwd(), {
    // Enable tsconfig `paths` resolution ("@/*" → repo root).
    tsconfigPaths: true,
    moduleCache: false,
    // Parse JSX so tests can import catalog modules that live in .tsx files
    // (e.g. the dashboard widget catalog). Purely additive: files without
    // JSX are parsed exactly as before.
    jsx: true,
    alias: { ...serverOnlyAlias, ...securityAlias },
});

await jiti.import(resolve(process.cwd(), script)).catch((error) => {
    console.error(error);
    process.exit(1);
});
