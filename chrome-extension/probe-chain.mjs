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
console.log("sw:", sw?.url());

const page = await ctx.newPage();
const avLogs = [];
page.on("console", (m) => { const t = m.text(); if (t.includes("[AlgoVault")) avLogs.push(t.slice(0, 200)); });
page.on("pageerror", (e) => console.log("PAGEERROR:", String(e).slice(0, 150)));
await page.goto("https://www.tradingview.com/chart/?symbol=OANDA:XAUUSD", { waitUntil: "domcontentloaded", timeout: 90000 });
await page.waitForSelector("[data-qa-id='legend-series-item']", { timeout: 60000 });
await page.waitForTimeout(12000);

const swState = await sw?.evaluate(async () => {
  const res = await chrome.storage.local.get(["tradingViewContext", "chartContext"]);
  return { tv: res.tradingViewContext ?? null, cc: res.chartContext ?? null };
});
console.log("--- SW storage after 12s ---");
console.log(JSON.stringify(swState, null, 1));

console.log("--- AlgoVault console logs ---");
console.log(avLogs.join("\n") || "(none)");

const overlay = await page.evaluate(() => {
  const host = document.getElementById("algovault-overlay-host");
  return host?.shadowRoot?.textContent ?? null;
});
console.log("--- overlay text ---");
console.log(overlay);
await ctx.close();
