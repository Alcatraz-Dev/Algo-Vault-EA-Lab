import { chromium } from "@playwright/test";
import { resolve } from "node:path";

const extPath = resolve("dist");
const ctx = await chromium.launchPersistentContext("", {
  channel: "chromium",
  headless: true,
  args: [`--disable-extensions-except=${extPath}`, `--load-extension=${extPath}`],
});
const swPromise = ctx.waitForEvent("serviceworker", { timeout: 30000 }).catch(() => null);
const sw = ctx.serviceWorkers()[0] ?? (await swPromise);
const page = await ctx.newPage();
await page.goto("https://www.tradingview.com/chart/?symbol=OANDA:XAUUSD", { waitUntil: "domcontentloaded", timeout: 90000 });
await page.waitForSelector("[data-qa-id='legend-series-item']", { timeout: 60000 });
await page.waitForTimeout(8000);

// 1) tabs.sendMessage with the overlay's message type
const r1 = await sw?.evaluate(async () => {
  const tabs = await chrome.tabs.query({});
  const tv = tabs.find((t) => (t.url || "").includes("tradingview.com"));
  try {
    await chrome.tabs.sendMessage(tv.id, {
      type: "TRADINGVIEW_CONTEXT_UPDATE",
      payload: { symbol: "TESTMARK", exchange: "TST", timeframe: "M5", isTradingView: true },
    });
    return "sent via tabs.sendMessage";
  } catch (e) {
    return "ERR " + String(e).slice(0, 120);
  }
});
console.log("1:", r1);
await page.waitForTimeout(2500);
let text = await page.evaluate(() => document.getElementById("algovault-overlay-host")?.shadowRoot?.textContent?.slice(0, 80) ?? null);
console.log("overlay after tabs.sendMessage:", JSON.stringify(text));

// 2) runtime.sendMessage broadcast variant
const r2 = await sw?.evaluate(async () => {
  chrome.runtime.sendMessage({
    type: "TRADINGVIEW_CONTEXT_UPDATE",
    payload: { symbol: "BRDCST", exchange: "X", timeframe: "H1", isTradingView: true },
  });
  await new Promise((r) => setTimeout(r, 500));
  return "sent broadcast";
});
console.log("2:", r2);
await page.waitForTimeout(2500);
text = await page.evaluate(() => document.getElementById("algovault-overlay-host")?.shadowRoot?.textContent?.slice(0, 80) ?? null);
console.log("overlay after runtime broadcast:", JSON.stringify(text));
await ctx.close();
