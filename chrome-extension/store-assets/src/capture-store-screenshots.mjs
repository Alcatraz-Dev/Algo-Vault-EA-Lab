// Captures store-compliant (1280x800) screenshots of genuinely available,
// unauthenticated extension surfaces from the packaged v3.0.0 build.
// Run: node src/capture-store-screenshots.mjs  (from store-assets/)
// Output: screenshots/options-1280x800.png, screenshots/sidepanel-1280x800.png
//
// The live-chart shot (TradingView + overlay) already exists at the compliant
// size: ../../release/screenshots/03-tradingview-overlay.png — copy it here
// with: cp ../../release/screenshots/03-tradingview-overlay.png screenshots/
//
// Signed-in surfaces (Copilot, signals, alerts, execution) CANNOT be captured
// without a real authenticated session — see ASSET_MANIFEST.md. Nothing here
// fakes authentication or invents product UI.

import { chromium } from "@playwright/test";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const dir = dirname(fileURLToPath(import.meta.url));
const DIST = resolve(dir, "..", "..", "dist");
const OUT = resolve(dir, "..", "screenshots");

const context = await chromium.launchPersistentContext("", {
  channel: "chromium",
  headless: true,
  viewport: { width: 1280, height: 800 },
  args: [`--disable-extensions-except=${DIST}`, `--load-extension=${DIST}`],
});

try {
  const sw =
    context.serviceWorkers()[0] ??
    (await context.waitForEvent("serviceworker", { timeout: 30_000 }));
  const extensionId = new URL(sw.url()).host;
  console.log("extension id:", extensionId);

  const options = await context.newPage();
  await options.goto(`chrome-extension://${extensionId}/options/index.html`);
  await options.waitForTimeout(1200);
  await options.screenshot({ path: `${OUT}/options-1280x800.png` });
  console.log("captured options-1280x800.png");

  const sidepanel = await context.newPage();
  await sidepanel.goto(`chrome-extension://${extensionId}/sidepanel/index.html`);
  await sidepanel.waitForTimeout(1500);
  await sidepanel.screenshot({ path: `${OUT}/sidepanel-1280x800.png` });
  console.log("captured sidepanel-1280x800.png");
} finally {
  await context.close();
}
console.log("done ->", OUT);
