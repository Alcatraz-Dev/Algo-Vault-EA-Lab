import { chromium } from "@playwright/test";
import { resolve } from "node:path";

const extPath = resolve("dist");
console.log("extPath", extPath);
const ctx = await chromium.launchPersistentContext("", {
  channel: "chromium",
  headless: true,
  args: [`--disable-extensions-except=${extPath}`, `--load-extension=${extPath}`],
});
ctx.on("serviceworker", (w) => console.log("SW event:", w.url()));
let workers = ctx.serviceWorkers();
console.log("initial serviceWorkers:", workers.map((w) => w.url()));

const page = await ctx.newPage();
page.on("pageerror", (e) => console.log("PAGEERROR:", String(e).slice(0, 200)));
page.on("console", (m) => {
  if (m.type() === "error") console.log("CONSOLE ERR:", m.text().slice(0, 160));
});
await page.goto("https://www.tradingview.com/chart/?symbol=OANDA:XAUUSD", { waitUntil: "domcontentloaded", timeout: 60000 }).catch((e) => console.log("goto err:", String(e).slice(0, 150)));
await page.waitForTimeout(10000);
console.log("title:", (await page.title()).slice(0, 80));
console.log("overlay-host present:", await page.evaluate(() => !!document.getElementById("algovault-overlay-host")));
workers = ctx.serviceWorkers();
console.log("serviceWorkers now:", workers.map((w) => w.url()));
await ctx.close();
