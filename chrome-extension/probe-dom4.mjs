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
  const series = document.querySelector("[data-qa-id='legend-series-item']");
  const walk = (el, depth = 0, out = []) => {
    if (!el || depth > 6 || out.length > 60) return out;
    const qa = el.getAttribute?.("data-qa-id");
    const dn = el.getAttribute?.("data-name");
    const txt = (el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 60);
    if (qa || dn) {
      out.push(`${"  ".repeat(depth)}[${el.tagName}] qa="${qa ?? ""}" name="${dn ?? ""}" text="${txt}"`);
    }
    for (const c of el.children) walk(c, depth + 1, out);
    return out;
  };
  const tree = series ? walk(series) : ["no series item"];
  // header details area
  const details = Array.from(document.querySelectorAll("[data-qa-id^='details-element']")).map((el) => ({
    qa: el.getAttribute("data-qa-id"),
    value: (el.getAttribute("data-qa-id") || "").startsWith("details-element price") ? el.textContent?.replace(/\s+/g, " ").slice(0, 80) : (el.textContent || "").trim().slice(0, 40),
  }));
  // what is inside legend-source-item (indicators / sources)?
  const srcItems = Array.from(document.querySelectorAll("[data-qa-id='legend-source-item']")).map((el) =>
    el.outerHTML.slice(0, 300)
  );
  const toggler = document.querySelector("[data-qa-id='legend-toggler']");
  return { tree, details, srcItems: srcItems.slice(0, 5), toggler: toggler ? { text: toggler.textContent, qa: toggler.getAttribute("data-qa-id"), cls: toggler.className } : null };
});
console.log(JSON.stringify(info, null, 1));
await ctx.close();
