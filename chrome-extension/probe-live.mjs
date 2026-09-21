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
const avLogs = [];
page.on("console", (m) => { const t = m.text(); if (t.includes("[AlgoVault")) avLogs.push(t.slice(0, 160)); });

await page.goto("https://www.tradingview.com/chart/?symbol=OANDA:XAUUSD", { waitUntil: "domcontentloaded", timeout: 90000 });
await page.waitForSelector("[data-qa-id='legend-series-item']", { timeout: 60000 });
await page.waitForTimeout(15000);

const overlay = await page.evaluate(() => {
  const host = document.getElementById("algovault-overlay-host");
  const text = host?.shadowRoot?.textContent?.replace(/\s+/g, " ").trim().slice(0, 500) ?? null;
  const isLive = text?.includes("● LIVE") ?? false;
  return { isLive, text };
});
console.log("--- overlay ---");
console.log(JSON.stringify(overlay, null, 1));
console.log("--- AlgoVault logs ---");
console.log(avLogs.slice(0, 12).join("\n") || "(none)");
const swLog = await sw?.evaluate(async () => {
  const res = await chrome.storage.local.get("chartIntel");
  return res.chartIntel ? { symbol: res.chartIntel.chart?.symbol, setup: res.chartIntel.setup?.label, score: res.chartIntel.market?.score?.total } : null;
});
console.log("--- SW chartIntel (enriched) ---");
console.log(JSON.stringify(swLog));
await ctx.close();
