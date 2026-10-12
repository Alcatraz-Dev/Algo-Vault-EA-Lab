import { chromium } from "/Users/haythem_dhahri/Desktop/projects/website/trading-platform/chrome-extension/node_modules/playwright/index.mjs";

const out = process.argv[2] || "/tmp/lt";
const url = process.argv[3] || "http://localhost:3000/";
const theme = process.argv[4] || "light"; // click toggle to reach this theme

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
await page.goto(url, { waitUntil: "networkidle", timeout: 60000 }).catch(() => {});
await page.waitForTimeout(2500);

if (theme === "light") {
  await page.click('button[aria-label="Switch to light theme"]');
  await page.waitForTimeout(800);
}
const cls = await page.evaluate(() => document.documentElement.className);
console.log("html class:", cls);

await page.evaluate(async () => {
  const h = document.body.scrollHeight;
  for (let y = 0; y < h; y += 700) {
    window.scrollTo(0, y);
    await new Promise((r) => setTimeout(r, 70));
  }
  window.scrollTo(0, 0);
});
await page.waitForTimeout(800);
const h = await page.evaluate(() => document.body.scrollHeight);
let i = 0;
for (let y = 0; y < h; y += 850, i++) {
  await page.evaluate((yy) => window.scrollTo(0, yy), y);
  await page.waitForTimeout(320);
  await page.screenshot({ path: `${out}-${String(i).padStart(2, "0")}.png` });
}
console.log(`frames: ${i}, height: ${h}`);
await browser.close();
