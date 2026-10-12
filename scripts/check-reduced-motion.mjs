import { chromium } from "/Users/haythem_dhahri/Desktop/projects/website/trading-platform/chrome-extension/node_modules/playwright/index.mjs";

const url = process.argv[2] || "http://localhost:3000/";
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });
const page = await ctx.newPage();
const errors = [];
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text().slice(0, 160)); });
page.on("pageerror", (e) => errors.push("PAGEERROR: " + String(e).slice(0, 160)));
await page.goto(url, { waitUntil: "networkidle", timeout: 60000 }).catch(() => {});
await page.waitForTimeout(3000);

// scroll to bottom to trigger any whileInView, then back
await page.evaluate(async () => {
  const h = document.body.scrollHeight;
  for (let y = 0; y < h; y += 800) { window.scrollTo(0, y); await new Promise(r => setTimeout(r, 60)); }
  window.scrollTo(0, 0);
});
await page.waitForTimeout(600);

const report = await page.evaluate(() => {
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  // every reveal wrapper must be fully visible
  const hidden = [];
  for (const el of document.querySelectorAll("[style*='opacity'], .reveal, [class*='reveal']")) {
    const s = getComputedStyle(el);
    if (parseFloat(s.opacity) < 0.99) hidden.push({ cls: (el.className || "").toString().slice(0, 60), op: s.opacity });
  }
  // running CSS animations (decorative ones should be frozen)
  const running = [];
  for (const el of document.querySelectorAll("body *")) {
    const s = getComputedStyle(el);
    if (s.animationName !== "none" && s.animationPlayState === "running" && parseFloat(s.animationDuration) > 0.05) {
      running.push({ cls: (typeof el.className === "string" ? el.className : "").slice(0, 50), anim: s.animationName, dur: s.animationDuration });
    }
  }
  return { reduced, hiddenCount: hidden.length, hidden: hidden.slice(0, 5), runningCount: running.length, running: running.slice(0, 6) };
});

// static-frame proof: two shots 1.2s apart must be byte-identical
const a = await page.screenshot();
await page.waitForTimeout(1200);
const b = await page.screenshot();
const identical = Buffer.compare(a, b) === 0;

console.log(JSON.stringify({ ...report, staticFrame: identical, consoleErrors: [...new Set(errors)].slice(0, 4) }, null, 1));
await browser.close();
