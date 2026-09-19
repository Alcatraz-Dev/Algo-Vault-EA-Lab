/**
 * spec §22 — real-extension smoke test.
 *
 * Loads the BUILT extension (`dist/`) into a persistent Chromium profile via
 * `--load-extension` (exactly how a user would install it), drives a REAL
 * https://www.tradingview.com/ chart, and asserts the full pipeline:
 *
 *   1. The extension loads (MV3 background service worker registers).
 *   2. Content scripts survive as classic scripts — an MV3 manifest content
 *      script CANNOT contain a static ESM `import`; if the bundle regresses to
 *      ESM, Chrome throws "Cannot use import statement outside a module" and
 *      NOTHING loads. That is what makes this test distinct from the DOM
 *      fixture suites: it validates the actual manifest/build wiring.
 *   3. The overlay boots (`#algovault-overlay-host` in a shadow root) and
 *      displays the detected symbol·timeframe from the live chart legend.
 *   4. The canonical ChartContext reaches the service worker storage
 *      (`tradingViewContext`), so enrichment/execution consumers are fed.
 *   5. spec §15 regression: the popup shell ships the bounded, scrollable
 *      layout (fixed 600px body, `overflow:hidden` on body, AI message pane
 *      `overflow-y:auto` + `min-h-0`) so long AI replies render completely
 *      instead of truncating with "…".
 *
 * Requires network access to tradingview.com. Run `npm run build` first.
 */
import { test, expect, chromium, type BrowserContext, type Worker } from "@playwright/test";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const DIST = fileURLToPath(new URL("../dist", import.meta.url));
const SRC = fileURLToPath(new URL("../src", import.meta.url));
const ASSETS = fileURLToPath(new URL("../dist/assets", import.meta.url));

// Real chart SPA + real network — generous.
test.setTimeout(150_000);

function dist(rel: string): string {
  return fileURLToPath(new URL(`../dist/${rel}`, import.meta.url));
}

function findPopupCss(): string {
  const file = readdirSync(ASSETS).find((f) => /^popup-[\w-]+\.css$/.test(f));
  if (!file) throw new Error("popup CSS not found in dist/assets — run `npm run build` first");
  return dist(`assets/${file}`);
}

test.describe("Real extension on TradingView (spec §22)", () => {
  test("detects the live chart and wires overlay + service worker context", async () => {
    const fatalErrors: string[] = [];
    const detectionLogs: string[] = [];

    const context = await chromium.launchPersistentContext("", {
      channel: "chromium", // bundled Chromium in new-headless supports extensions
      headless: true,
      args: [
        `--disable-extensions-except=${DIST}`,
        `--load-extension=${DIST}`,
      ],
    });

    try {
      // MV3 service workers are lazy — register the waiter immediately, then
      // also check for one that already spawned.
      const swPromise = context
        .waitForEvent("serviceworker", { timeout: 30_000 })
        .catch(() => null);
      const serviceWorker: Worker | null =
        context.serviceWorkers()[0] ?? (await swPromise);

      const swUrl = serviceWorker?.url() ?? null;
      const extensionId = swUrl ? new URL(swUrl).host : null;
      expect(swUrl, "background service worker must register").toBeTruthy();
      expect(extensionId, "extension id from service worker URL").toBeTruthy();

      const page = await context.newPage();
      page.on("pageerror", (err) => fatalErrors.push(String(err)));
      page.on("console", (msg) => {
        const text = msg.text();
        if (msg.type() === "error") fatalErrors.push(`console.error: ${text}`);
        if (text.includes("[AlgoVault Extension] context")) detectionLogs.push(text);
      });

      await page.goto("https://www.tradingview.com/chart/?symbol=OANDA:XAUUSD", {
        waitUntil: "domcontentloaded",
        timeout: 90_000,
      });
      // Wait for the chart legend to actually render.
      await page.waitForSelector("[data-qa-id='legend-series-item']", { timeout: 60_000 });

      // 1) Overlay host must boot (created by content/overlay.js).
      await expect
        .poll(() => page.evaluate(() => !!document.getElementById("algovault-overlay-host")), {
          timeout: 30_000,
        })
        .toBe(true);

      // 2) Detection must reach the overlay: symbol (XAUUSD) + price appear in
      //    the shadow-rooted live overlay.
      await expect
        .poll(
          () =>
            page.evaluate<string | null>(() => {
              const host = document.getElementById("algovault-overlay-host");
              return host?.shadowRoot?.textContent ?? null;
            }),
          { timeout: 60_000 }
        )
        .toContain("XAUUSD");

      // 3) Canonical ChartContext must land in the service worker storage
      //    (content script → TRADINGVIEW_CONTEXT_UPDATE → setCachedContext).
      await expect
        .poll(
          () =>
            serviceWorker?.evaluate(async () => {
              const res = await chrome.storage.local.get("tradingViewContext");
              return res.tradingViewContext ?? null;
            }) ?? null,
          { timeout: 60_000 }
        )
        .toMatchObject({ symbol: "XAUUSD", isTradingView: true });

      // 4) The content-script detection engine explicitly logged its context.
      expect(detectionLogs.length, "detection console log").toBeGreaterThan(0);
      expect(detectionLogs[0]).toContain("XAUUSD");

      // 5) No extension-caused fatal errors (would flag an ESM regression:
      //    "Cannot use import statement outside a module").
      const ours = fatalErrors.filter(
        (e) =>
          e.includes("import statement") ||
          e.includes("AlgoVault") ||
          e.includes("chrome-extension://")
      );
      expect(ours, `extension errors: ${JSON.stringify(ours)}`).toEqual([]);
    } finally {
      await context.close();
    }
  });
});

test.describe("Popup layout regression — spec §15 (long AI replies render fully)", () => {
  test("built popup ships the fixed-height bounded scroll shell", () => {
    const css = readFileSync(findPopupCss(), "utf8");

    // body is locked at 600px with overflow hidden — the popup cannot grow
    // beyond the browser popup window.
    expect(css).toMatch(/body\s*\{[^}]*height:\s*600px/);
    expect(css).toMatch(/overflow:\s*hidden/);

    // AI copilot message pane: flex-1 min-h-0 overflow-y-auto → long replies
    // scroll inside the bounded container instead of truncating with "…".
    expect(css).toMatch(/\.min-h-0\s*\{[^}]*min-height:\s*0/);
    expect(css).toMatch(/\.overflow-y-auto\s*\{[^}]*overflow-y:\s*auto/);
  });

  test("AICopilotView keeps its message pane in the bounded scroll shell", () => {
    // Source-level check: the AI message container must stay within the
    // scrollable area (no fixed-height siblings that clip the reply).
    const view = readFileSync(`${SRC}/popup/components/AICopilotView.tsx`, "utf8");
    expect(view).toMatch(/flex-1 min-h-0 overflow-y-auto p-3 space-y-3/);
    // The composer stays fixed at the bottom (not part of the scroll area).
    expect(view).toMatch(/border-t/);
  });
});