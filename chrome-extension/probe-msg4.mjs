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
const errs = [];
page.on("pageerror", (e) => errs.push("[PAGEERROR] " + String(e).slice(0, 160)));
page.on("console", (m) => { if (m.type() === "error") errs.push("[CONSOLE.ERROR] " + m.text().slice(0, 160)); });
await page.goto("https://www.tradingview.com/chart/?symbol=OANDA:XAUUSD", { waitUntil: "domcontentloaded", timeout: 90000 });
await page.waitForSelector("[data-qa-id='legend-series-item']", { timeout: 60000 });
await page.waitForTimeout(12000);

const dump = () => page.evaluate(() => {
  const host = document.getElementById("algovault-overlay-host");
  if (!host?.shadowRoot) return "no host";
  const spans = Array.from(host.shadowRoot.querySelectorAll("span")).map((s) => s.textContent).filter(Boolean);
  return { full: host.shadowRoot.textContent.replace(/\s+/g, " ").trim().slice(0, 400), spans: spans.slice(0, 12) };
});

console.log("BEFORE:", JSON.stringify(await dump(), null, 1));
await sw?.evaluate(async () => {
  const tabs = await chrome.tabs.query({});
  const tv = tabs.find((t) => (t.url || "").includes("tradingview.com"));
  await chrome.tabs.sendMessage(tv.id, { type: "TRADINGVIEW_CONTEXT_UPDATE", payload: { symbol: "TESTMARK", exchange: "TST", timeframe: "M5", isTradingView: true } });
});
await page.waitForTimeout(2500);
console.log("AFTER:", JSON.stringify(await dump(), null, 1));
console.log("errors:", errs.length ? errs.join("\n") : "(none)");
await ctx.close();
