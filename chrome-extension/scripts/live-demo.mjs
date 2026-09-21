/**
 * Live interactive demo — spec §22.
 *
 * Launches a REAL, VISIBLE Google Chrome window with the built extension
 * loaded via `--load-extension` (identical to "Load unpacked" in
 * chrome://extensions), opens a live TradingView chart, waits for the
 * AlgoVault overlay to boot, dumps the detected context + screenshot, then
 * KEEPS THE WINDOW OPEN so you can click around, change symbol/timeframe,
 * open the popup, etc. The script exits when you close the Chrome window.
 *
 * Usage: node scripts/live-demo.mjs   (run `npm run build` first)
 */
import { chromium } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

const DIST = fileURLToPath(new URL("../dist", import.meta.url));
const SHOTS = fileURLToPath(new URL("../test-results", import.meta.url));
mkdirSync(SHOTS, { recursive: true });

const SYMBOL = process.env.DEMO_SYMBOL ?? "OANDA:XAUUSD";
const KEEP_OPEN_MS = Number(process.env.DEMO_KEEP_OPEN_MS ?? 15 * 60_000);

const context = await chromium.launchPersistentContext("", {
  channel: "chrome", // real Google Chrome → visible window, extensions supported (headed)
  headless: false,
  args: [
    `--disable-extensions-except=${DIST}`,
    `--load-extension=${DIST}`,
    "--no-first-run",
  ],
  viewport: { width: 1440, height: 900 },
});

const fatalErrors = [];
const detectionLogs = [];

try {
  // MV3 service workers are lazy — register the waiter immediately.
  const swPromise = context
    .waitForEvent("serviceworker", { timeout: 30_000 })
    .catch(() => null);
  const sw = context.serviceWorkers()[0] ?? (await swPromise);
  if (!sw) {
    console.error("[DEMO] ✗ background service worker never registered");
    process.exitCode = 1;
    await context.close();
    process.exit(1);
  }
  console.log(`[DEMO] ✓ extension loaded, sw: ${sw.url()}`);

  const page = context.pages()[0] ?? (await context.newPage());
  page.on("pageerror", (e) => fatalErrors.push(String(e)));
  page.on("console", (m) => {
    const t = m.text();
    if (m.type() === "error") fatalErrors.push(`console.error: ${t}`);
    if (t.includes("[AlgoVault Extension] context")) detectionLogs.push(t);
  });

  console.log(`[DEMO] opening live TradingView: ${SYMBOL}`);
  await page.goto(`https://www.tradingview.com/chart/?symbol=${encodeURIComponent(SYMBOL)}`, {
    waitUntil: "domcontentloaded",
    timeout: 90_000,
  });
  await page.waitForSelector("[data-qa-id='legend-series-item']", { timeout: 60_000 });

  await page.waitForFunction(
    () => !!document.getElementById("algovault-overlay-host"),
    { timeout: 30_000 }
  );

  const shadowText = await page.waitForFunction(
    () => document.getElementById("algovault-overlay-host")?.shadowRoot?.textContent ?? null,
    { timeout: 60_000 }
  ).then((h) => h.jsonValue());

  console.log(`[DEMO] ✓ overlay booted — detected context:`);
  for (const line of String(shadowText).split("\n").map((s) => s.trim()).filter(Boolean)) {
    console.log(`[DEMO]   · ${line}`);
  }
  if (detectionLogs.length) console.log(`[DEMO] detection engine log: ${detectionLogs[0]}`);

  const shot = join(SHOTS, "live-demo-overlay.png");
  await page.screenshot({ path: shot });
  console.log(`[DEMO] SCREENSHOT_READY ${shot}`);

  const ours = fatalErrors.filter(
    (e) => e.includes("import statement") || e.includes("AlgoVault") || e.includes("chrome-extension://")
  );
  if (ours.length) {
    console.warn(`[DEMO] ⚠ extension errors: ${JSON.stringify(ours)}`);
  } else {
    console.log("[DEMO] ✓ no extension errors on the page");
  }

  console.log(`[DEMO] ▶ Chrome window is OPEN — go play! Change symbol/timeframe,`);
  console.log(`[DEMO]   open the popup, drag the overlay. Close the window when done`);
  console.log(`[DEMO]   (auto-exits in ${KEEP_OPEN_MS / 60000} min).`);

  await Promise.race([
    context.waitForEvent("close").catch(() => {}),
    new Promise((r) => setTimeout(r, KEEP_OPEN_MS)),
  ]);
  console.log("[DEMO] demo session ended.");
} finally {
  await context.close().catch(() => {});
}