import { chromium } from "/Users/haythem_dhahri/Desktop/projects/website/trading-platform/chrome-extension/node_modules/playwright/index.mjs";

const url = process.argv[2] || "http://localhost:3000/";
const widths = process.argv[3] ? [Number(process.argv[3])] : [390, 768, 1440];

const browser = await chromium.launch();
for (const width of widths) {
  const ctx = await browser.newContext({ viewport: { width, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text().slice(0, 160)); });
  page.on("pageerror", (e) => errors.push("PAGEERROR: " + String(e).slice(0, 160)));
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(4000);
  const info = await page.evaluate(() => {
    const doc = document.documentElement;
    const clipped = (el) => {
      for (let p = el.parentElement; p; p = p.parentElement) {
        const s = getComputedStyle(p);
        if (s.overflowX !== "visible") return true;
      }
      return false;
    };
    const over = [];
    for (const el of document.querySelectorAll("body *")) {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.right > doc.clientWidth + 1 && !clipped(el)) {
        over.push({
          tag: el.tagName.toLowerCase(),
          cls: (typeof el.className === "string" ? el.className : "").slice(0, 80),
          right: Math.round(r.right),
        });
      }
    }
    return { scrollW: doc.scrollWidth, clientW: doc.clientWidth, unclippedOverflow: over.slice(0, 8), count: over.length };
  });
  const hOverflow = info.scrollW > info.clientW ? "H-OVERFLOW!" : "ok";
  console.log(`${width}px: scrollW=${info.scrollW} clientW=${info.clientW} [${hOverflow}] unclippedOverflow=${info.count}`);
  if (info.count) console.log("   ", JSON.stringify(info.unclippedOverflow));
  if (errors.length) console.log("   console errors:", JSON.stringify([...new Set(errors)].slice(0, 4)));
  await ctx.close();
}
await browser.close();
