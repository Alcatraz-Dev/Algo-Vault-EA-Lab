// scripts/build-content.mjs
//
// Bundles the TradingView content scripts as self-contained IIFE files.
//
// Chrome MV3 content scripts declared in manifest `content_scripts` run as
// CLASSIC scripts: they cannot contain static ESM `import` statements (the
// browser throws "Cannot use import statement outside a module" and the whole
// script silently fails to execute). The main `vite build` therefore builds
// only the popup/options pages + the module-type background service worker.
// This script builds each content entry separately in IIFE format so all
// dependencies (symbols, storage, chart-intelligence, React, ...) are inlined
// into a single classic-script-safe file.
import { build } from "vite";
import react from "@vitejs/plugin-react";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { statSync } from "node:fs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const distContent = resolve(root, "dist", "content");

const ENTRIES = [
  { name: "tradingview", file: "src/content/tradingview.ts", global: "AlgoVaultTradingView" },
  { name: "overlay", file: "src/content/overlay.tsx", global: "AlgoVaultOverlay" },
];

for (const entry of ENTRIES) {
  const started = Date.now();
  await build({
    root,
    configFile: false,
    plugins: [react()],
    resolve: { alias: { "@": resolve(root, "src") } },
    logLevel: "warn",
    build: {
      outDir: distContent,
      emptyOutDir: false,
      cssCodeSplit: false,
      minify: true,
      sourcemap: false,
      target: "es2020",
      lib: false,
      rollupOptions: {
        input: resolve(root, entry.file),
        output: {
          format: "iife",
          name: entry.global,
          entryFileNames: () => `${entry.name}.js`,
        },
      },
    },
  });

  const out = resolve(distContent, `${entry.name}.js`);
  const sizeKb = (statSync(out).size / 1024).toFixed(1);
  const ms = Date.now() - started;
  console.log(`[build-content] dist/content/${entry.name}.js  (${sizeKb} kB, ${ms}ms, IIFE/classic)`);
}