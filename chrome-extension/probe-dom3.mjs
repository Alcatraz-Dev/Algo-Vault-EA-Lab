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
  const w = window;
  const tvWidget = (w.tvWidget ?? w.tradingViewWidget) ?? null;
  let widgetData = null;
  if (tvWidget && typeof tvWidget === "object") {
    try {
      widgetData = {
        symbol: typeof tvWidget.getSymbol === "function" ? tvWidget.getSymbol() : "no getSymbol",
        interval: typeof tvWidget.getInterval === "function" ? tvWidget.getInterval() : "no getInterval",
        hasChart: typeof tvWidget.chart === "function",
      };
      const chart = typeof tvWidget.chart === "function" ? tvWidget.chart() : null;
      if (chart) widgetData.chartMethods = Object.getOwnPropertyNames(Object.getPrototypeOf(chart)).slice(0, 30);
    } catch (e) { widgetData = { err: String(e).slice(0, 200) }; }
  } else {
    widgetData = { absent: true, typeof: typeof tvWidget, keys: tvWidget ? Object.keys(tvWidget).slice(0, 10) : null };
  }

  const qa = (q) => {
    const el = document.querySelector(q);
    return el ? { text: (el.textContent || "").trim().slice(0, 60), html: el.outerHTML.slice(0, 260) } : null;
  };
  const serieEls = Array.from(document.querySelectorAll("[data-qa-id='legend-series-item']")).map((el) =>
    ({ outer: el.outerHTML.slice(0, 500), text: (el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 120) })
  );
  // interval switcher buttons + selected state
  const tfButtons = Array.from(document.querySelectorAll("button, [role='button'], [role='tab'], [role='option']"))
    .filter((b) => { const t = (b.textContent || "").trim(); return ["1","3","5","15","30","60","120","180","240","1H","4H","1D","1W","1M","1Y","5Y","1m","5m"].includes(t); })
    .map((b) => ({ text: (b.textContent || "").trim(), qa: b.getAttribute("data-qa-id"), ariaPressed: b.getAttribute("aria-pressed"), ariaSelected: b.getAttribute("aria-selected"), cls: (b.className || "").toString().slice(0, 80) }))
    .slice(0, 30);
  const headerSymbol = qa("[data-qa-id='legend-series-title']");
  const allQa = Array.from(document.querySelectorAll("[data-qa-id]")).map((el) => el.getAttribute("data-qa-id")).filter(Boolean).slice(0, 60);
  return { widgetData, serieEls, tfButtons, headerSymbol, allQa };
});
console.log(JSON.stringify(info, null, 1));
await ctx.close();
