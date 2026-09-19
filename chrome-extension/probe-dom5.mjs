import { chromium } from "@playwright/test";
import { resolve } from "node:path";

const extPath = resolve("dist");
const ctx = await chromium.launchPersistentContext("", {
  channel: "chromium",
  headless: true,
  args: [`--disable-extensions-except=${extPath}`, `--load-extension=${extPath}`],
});
const page = await ctx.newPage();
const logs = [];
page.on("console", (m) => logs.push(m.text()));
await page.goto("https://www.tradingview.com/chart/?symbol=OANDA:XAUUSD", { waitUntil: "domcontentloaded", timeout: 90000 });
await page.waitForTimeout(15000);

// Try to add an indicator via keyboard? Too invasive. Just dump whatever studies exist.
const out = await page.evaluate(() => {
  const items = Array.from(document.querySelectorAll("[data-qa-id='legend-source-item']"));
  return items.map((el) => el.outerHTML.slice(0, 1200));
});
console.log("studies:", out.length);
for (const html of out) console.log(html + "\n=====");
await ctx.close();
