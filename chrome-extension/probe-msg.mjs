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
const all = [];
page.on("console", (m) => all.push(`[${m.type()}] ${m.text().slice(0, 160)}`));
page.on("pageerror", (e) => all.push(`[PAGEERROR] ${String(e).slice(0, 200)}`));
await page.goto("https://www.tradingview.com/chart/?symbol=OANDA:XAUUSD", { waitUntil: "domcontentloaded", timeout: 90000 });
await page.waitForSelector("[data-qa-id='legend-series-item']", { timeout: 60000 });
await page.waitForTimeout(10000);

const overlayBefore = await page.evaluate(() => document.getElementById("algovault-overlay-host")?.shadowRoot?.textContent?.includes("XAUUSD") ?? false);
console.log("overlay has XAUUSD before manual broadcast:", overlayBefore);

// Ask the SW to broadcast a manual TRADINGVIEW_CONTEXT_UPDATE with a fake payload
const res = await sw?.evaluate(async () => {
  chrome.runtime.sendMessage({ type: "TRADINGVIEW_CONTEXT_UPDATE", payload: { symbol: "TESTMARK", exchange: "TESTX", timeframe: "M5", isTradingView: true } });
  return "sent";
});
console.log("manual broadcast:", res);
await page.waitForTimeout(3000);
const overlayText = await page.evaluate(() => document.getElementById("algovault-overlay-host")?.shadowRoot?.textContent?.slice(0, 200) ?? null);
console.log("overlay after manual broadcast:", JSON.stringify(overlayText));

// Try tabs.sendMessage from SW to the tab
const tab = page;
const tabRes = await sw?.evaluate(async (tabId) => {
  const response = await chrome.tabs.sendMessage(tabId, { type: "REFRESH_CONTEXT" });
  return response;
}, tab === null ? -1 : page.url().length);
console.log("SW→tab sendMessage result:", JSON.stringify(tabRes));

console.log("--- all console/page errors (AlgoVault-relevant) ---");
console.log(all.filter((l) => !l.includes("Not signed in") && !l.includes("GSI_LOGGER") && !l.includes("FedCM") && !l.includes("runtime.lastError")).join("\n") || "(none)");
await ctx.close();
