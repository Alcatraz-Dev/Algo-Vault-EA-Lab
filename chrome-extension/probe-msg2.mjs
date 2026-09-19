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
await page.waitForTimeout(10000);

const r = await sw?.evaluate(async () => {
  const tabs = await chrome.tabs.query({});
  const out = tabs.map((t) => ({ id: t.id, url: (t.url || "").slice(0, 60) }));
  const tv = tabs.find((t) => (t.url || "").includes("tradingview.com"));
  let tabResult = null;
  if (tv?.id != null) {
    try {
      const resp = await chrome.tabs.sendMessage(tv.id, { type: "REFRESH_CONTEXT" });
      tabResult = { ok: true, resp: JSON.stringify(resp).slice(0, 300) };
    } catch (e) {
      tabResult = { ok: false, err: String(e).slice(0, 200) };
    }
  }
  return { tabs: out, tabResult };
});
console.log(JSON.stringify(r, null, 1));
await ctx.close();
