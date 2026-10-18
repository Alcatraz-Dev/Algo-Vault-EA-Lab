// scripts/capture-screenshots.mjs
//
// Captures GENUINE Chrome Web Store screenshots from the packaged release
// build (dist/). Run manually after `npm run build:prod`:
//
//   node scripts/capture-screenshots.mjs
//
// Output: release/screenshots/*.png (1280x800 viewport for chart shots,
// native 400x600 popup size for the popup shot).
//
// What is captured (all unauthenticated — no test account needed):
//   01-popup-login.png    — the real popup (login view, dark theme)
//   02-options.png        — the real options page
//   03-tradingview-overlay.png — live TradingView chart with the AlgoVault
//                                overlay booted (symbol detection visible)
//
// These are honest "what you actually see" shots, not mockups. Signed-in
// surfaces (Copilot, signals) must be captured in an interactive session
// with a real account and are NOT faked here.

import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DIST = resolve(root, "dist");
const OUT = resolve(root, "release", "screenshots");
mkdirSync(OUT, { recursive: true });

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

  // 1) Popup (login view — unauthenticated by design).
  const popup = await context.newPage();
  await popup.setViewportSize({ width: 400, height: 600 });
  await popup.goto(`chrome-extension://${extensionId}/popup/index.html`);
  await popup.waitForTimeout(1500);
  await popup.screenshot({ path: `${OUT}/01-popup-login.png` });
  console.log("captured 01-popup-login.png");

  // 2) Options page.
  const options = await context.newPage();
  await options.setViewportSize({ width: 800, height: 600 });
  await options.goto(`chrome-extension://${extensionId}/options/index.html`);
  await options.waitForTimeout(1200);
  await options.screenshot({ path: `${OUT}/02-options.png` });
  console.log("captured 02-options.png");

  // 3) Live TradingView chart with the overlay booted.
  const chart = await context.newPage();
  await chart.setViewportSize({ width: 1280, height: 800 });
  await chart.goto("https://www.tradingview.com/chart/?symbol=OANDA:XAUUSD", {
    waitUntil: "domcontentloaded",
    timeout: 90_000,
  });
  await chart.waitForSelector("[data-qa-id='legend-series-item']", { timeout: 60_000 }).catch(() => null);
  // Wait for the AlgoVault overlay host to boot (best effort).
  const booted = await chart
    .waitForFunction(() => !!document.getElementById("algovault-overlay-host"), null, { timeout: 30_000 })
    .then(() => true)
    .catch(() => false);
  console.log("overlay booted:", booted);
  await chart.waitForTimeout(2500);
  await chart.screenshot({ path: `${OUT}/03-tradingview-overlay.png` });
  console.log("captured 03-tradingview-overlay.png");
} finally {
  await context.close();
}
console.log(`screenshots in ${OUT}`);
