import { chromium } from "@playwright/test";
import { resolve } from "node:path";
const extPath = resolve("dist");
const ctx = await chromium.launchPersistentContext("", {
  channel: "chromium",
  headless: true,
  args: [`--disable-extensions-except=${extPath}`, `--load-extension=${extPath}`],
});
const page = await ctx.newPage();
await page.goto("https://www.tradingview.com/chart/?symbol=OANDA:XAUUSD", { waitUntil: "domcontentloaded", timeout: 90000 });
await page.waitForTimeout(15000);
const out = await page.evaluate(() => {
  const el = document.querySelector("[data-qa-id='legend-source-item']");
  const html = el?.outerHTML ?? "";
  // find values-like containers
  const valueCandidates = Array.from(el?.querySelectorAll("[class*='value' i], [data-qa-id*='value' i]") ?? [])
    .map((v) => ({ qa: v.getAttribute("data-qa-id"), cls: (v.className||"").toString().slice(0,60), text: (v.textContent||"").trim().slice(0,40) }));
  return { tail: html.slice(html.length - 1500), valueCandidates };
});
console.log(JSON.stringify(out, null, 1));
await ctx.close();
