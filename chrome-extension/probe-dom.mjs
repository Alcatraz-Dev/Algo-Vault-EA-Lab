import { chromium } from "@playwright/test";
import { resolve } from "node:path";

const extPath = resolve("dist");
const ctx = await chromium.launchPersistentContext("", {
  channel: "chromium",
  headless: true,
  args: [`--disable-extensions-except=${extPath}`, `--load-extension=${extPath}`],
});
const page = await ctx.newPage();
page.on("console", (m) => { if (m.type() === "error") console.log("CONSOLE ERR:", m.text().slice(0,120)); });
await page.goto("https://www.tradingview.com/chart/?symbol=OANDA:XAUUSD", { waitUntil: "domcontentloaded", timeout: 90000 });
await page.waitForTimeout(15000);
console.log("title:", (await page.title()).slice(0, 80));
const dom = await page.evaluate(() => {
  const legend = document.querySelector("[data-name='legend']");
  const items = Array.from(document.querySelectorAll("[data-name='legend-source-item']")).map((el) => {
    const r = el.getBoundingClientRect();
    return { tag: el.tagName, visible: r.width > 0 && r.height > 0, text: (el.textContent||"").trim().slice(0,80) };
  });
  // probe for any element matching 'legend' data attrs
  const anyLegend = Array.from(document.querySelectorAll("[data-name*='legend']")).slice(0, 12).map((el) => el.getAttribute("data-name"));
  const tvContainer = !!document.querySelector("#tv_chart_container, .chart-container, .tv-chart");
  const datasetAttrs = Array.from(document.querySelectorAll("[class*='legend']")).slice(0, 5).map((el) => `${el.tagName}.${(el.className||"").toString().slice(0,60)}`);
  return {
    hasLegendContainer: !!legend,
    items,
    anyLegend,
    tvContainer,
    datasetAttrs,
    readyState: document.readyState,
    bodyTextSample: document.body.innerText.slice(0, 300),
  };
});
console.log(JSON.stringify(dom, null, 1));
await ctx.close();
