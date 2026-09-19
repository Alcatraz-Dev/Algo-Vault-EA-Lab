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

const info = await page.evaluate(() => {
  // tvWidget / tradingViewWidget availability
  const w = window;
  const names = Object.keys(w).filter((k) => /widget/i.test(k)).slice(0, 20);
  const tvWidget = (w.tvWidget ?? w.tradingViewWidget) ?? null;
  let widgetData = null;
  if (tvWidget && typeof tvWidget === "object") {
    try {
      widgetData = {
        symbol: typeof tvWidget.getSymbol === "function" ? tvWidget.getSymbol() : null,
        interval: typeof tvWidget.getInterval === "function" ? tvWidget.getInterval() : null,
        hasChart: typeof tvWidget.chart === "function",
      };
    } catch (e) { widgetData = { err: String(e).slice(0, 100) }; }
  }
  // interval switcher: find selected button
  const selectedTf = Array.from(document.querySelectorAll("[aria-pressed='true'], [aria-selected='true'], [data-name='timeframe']"))
    .map((el) => ({ attr: el.hasAttribute("aria-pressed") ? "aria-pressed" : el.hasAttribute("aria-selected") ? "aria-selected" : "data-name", text: (el.textContent||"").trim().slice(0, 20), cls: (el.className||"").toString().slice(0, 60) }))
    .slice(0, 10);
  // Where does "1D"/"D" appear relative to aria?
  const tfButtons = Array.from(document.querySelectorAll("button"))
    .filter((b) => ["1","3","5","15","30","60","120","180","240","1D","D","1W","1M","1Y","5Y"].includes((b.textContent||"").trim()))
    .map((b) => ({ text: (b.textContent||"").trim(), ariaPressed: b.getAttribute("aria-pressed"), cls: (b.className||"").toString().slice(0, 50) }))
    .slice(0, 25);
  // price: look for the big quote number near SELL/BUY
  const legendTree = [];
  const lq = document.querySelector("div[class^='legend-']");
  const legendHtml = lq ? lq.outerHTML.slice(0, 400) : null;
  // The ticker price in header toolbar: element with number and 'last-price'?
  const lastPriceEls = Array.from(document.querySelectorAll("[data-name*='price'], [class*='last-price'], [class*='lastPrice'], [class*='priceBar'], [class*='price' i]"))
    .slice(0, 15)
    .map((el) => ({ cls: (el.className||"").toString().slice(0,60), tag: el.tagName, text: (el.textContent||"").trim().slice(0,30) }));
  return { globalWidgetKeys: names, widgetData, selectedTf, tfButtons, legendHtml, lastPriceEls };
});
console.log(JSON.stringify(info, null, 1));
await ctx.close();
