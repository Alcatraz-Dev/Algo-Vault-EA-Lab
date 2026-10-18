// scripts/prod-manifest.mjs
//
// Web Store release step (runs ONLY in `npm run build:prod`, after vite +
// content build + post-build). Rewrites dist/manifest.json so the packaged
// extension never requests dev-only origins:
//
//   • removes http://localhost / 127.0.0.1 entries (dev workflow only —
//     store review rejects localhost host permissions);
//   • replaces the dead https://algovault.dev host (NXDOMAIN, never resolves)
//     with the verified production deployment;
//   • keeps https://*.tradingview.com (content scripts + overlay).
//
// The source manifest.json in the repo is intentionally left untouched so
// local development keeps working.

import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const manifestPath = resolve(root, "dist", "manifest.json");

const PROD_HOSTS = ["https://algo-vault-ea-lab.vercel.app/*"];
const TV_HOSTS = ["https://*.tradingview.com/*"];

const raw = readFileSync(manifestPath, "utf8");
const manifest = JSON.parse(raw);

const isDevHost = (m) => /localhost|127\.0\.0\.1/i.test(m);
const isDeadHost = (m) => /algovault\.dev/i.test(m);

// `scripting` is declared in the dev manifest but never called anywhere in
// src/ or the built output (verified by grep) — drop it for least privilege.
if (Array.isArray(manifest.permissions)) {
  manifest.permissions = manifest.permissions.filter((p) => p !== "scripting");
}

manifest.host_permissions = [
  ...PROD_HOSTS,
  ...TV_HOSTS,
];

if (manifest.externally_connectable?.matches) {
  manifest.externally_connectable.matches = [...PROD_HOSTS];
}

writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

const leaked = [...(manifest.host_permissions ?? []), ...(manifest.externally_connectable?.matches ?? [])].filter(
  (m) => isDevHost(m) || isDeadHost(m)
);
if (leaked.length > 0) {
  console.error(`prod-manifest: dev/dead hosts still present: ${leaked.join(", ")}`);
  process.exit(1);
}
console.log("prod-manifest: dist/manifest.json normalized for release");
console.log(`  host_permissions: ${manifest.host_permissions.join(", ")}`);
console.log(`  externally_connectable: ${(manifest.externally_connectable?.matches ?? []).join(", ")}`);
