import { chromium } from "@playwright/test";
import { resolve } from "node:path";

const extPath = resolve("dist");
const ctx = await chromium.launchPersistentContext("", {
  channel: "chromium",
  headless: true,
  args: [`--disable-extensions-except=${extPath}`, `--load-extension=${extPath}`],
});
const page = await ctx.newPage();
const avLogs = [];
page.on("console", (m) => { const t = m.text(); if (t.includes("[AlgoVault Extension] context")) avLogs.push(t.slice(0, 140)); });
await page.goto("https://www.tradingview.com/chart/?symbol=BINANCE:BTCUSDT", { waitUntil: "domcontentloaded", timeout: 90000 });
await page.waitForSelector("[data-qa-id='legend-series-item']", { timeout: 60000 });
await page.waitForTimeout(14000);
const overlay = await page.evaluate(() => {
  const host = document.getElementById("algovault-overlay-host");
  const text = host?.shadowRoot?.textContent?.replace(/\s+/g, " ").trim().slice(0, 460) ?? null;
  return { isLive: text?.includes("● LIVE") ?? false, text };
});
console.log(JSON.stringify(overlay, null, 1));
console.log("logs:", avLogs.join("\n") || "(none)");
await ctx.close();
