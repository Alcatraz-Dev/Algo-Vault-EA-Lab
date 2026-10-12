import { test, expect, type Page } from "@playwright/test";

/**
 * Landing-page light system smoke test (real Chromium).
 *
 *   SMOKE_BASE_URL=http://localhost:3000 \
 *     chrome-extension/node_modules/.bin/playwright test \
 *       -c e2e/playwright.config.ts e2e/landing-light-system.smoke.spec.ts
 *
 * DESIGN.md §21 records the landing page as the one surface allowed translucent
 * glass panels and the shared marketing light layers. §21.4 makes the page owe
 * the checks below, and the in-app preview panel cannot prove them: it does not
 * composite screenshots, and it cannot emulate `prefers-reduced-motion`. So the
 * assertions run here, against computed styles in a real browser.
 *
 * Covered:
 *   1. `.glass-panel` is genuinely translucent and reuses the *shared* effects
 *      (`av-edge-glow` on ::before, `av-panel-sweep` on ::after) rather than
 *      defining a new decorative animation.
 *   2. The aurora layers use the shared `av-aurora-drift`.
 *   3. Data surfaces stay crisp: the live ticker is opaque with no blur.
 *   4. The landing type ladder resolves (11px gold eyebrow, 700-weight hero).
 *   5. Light theme re-tints from the same tokens (no theme-specific hardcoding).
 *   6. `prefers-reduced-motion` stops every landing animation.
 *   7. No horizontal overflow at 390 / 768 / 1440.
 */

const BASE_URL = process.env.SMOKE_BASE_URL || "http://localhost:3000";

const PROBE = () => {
  const panel = document.querySelector<HTMLElement>(".glass-panel");
  const eyebrow = document.querySelector<HTMLElement>(".home-eyebrow");
  const sectionTitle = document.querySelector<HTMLElement>(".home-title");
  const heroTitle = document.querySelector<HTMLElement>(".home-hero-title");
  const ticker = document.querySelector<HTMLElement>("main > section");
  const bar = document.querySelector<HTMLElement>(".home-bar");
  const fill = document.querySelector<HTMLElement>(".home-fill");
  const aurora = [...document.querySelectorAll<HTMLElement>(".home-aurora > span")];

  // rgb/rgba (or color(srgb r g b / a)) → the alpha channel, so "translucent"
  // is measured rather than assumed from the class name.
  const alphaOf = (color: string): number => {
    const slash = color.match(/\/\s*([\d.]+)\s*\)/);
    if (slash) return Number(slash[1]);
    const rgba = color.match(/rgba?\(([^)]+)\)/);
    if (!rgba) return 1;
    const parts = rgba[1].split(",").map((p) => Number(p.trim()));
    return parts.length === 4 ? parts[3] : 1;
  };

  const pc = panel ? getComputedStyle(panel) : null;
  // Alphas per variant, not one pooled set: the `--solid` panels are more opaque
  // than the plain ones in *both* themes, so a min/max over the mixed set proves
  // nothing. These are also the settled token values — if the theme class were
  // applied after paint, these would be caught mid-transition instead.
  const alphaFor = (selector: string): number | null => {
    const el = document.querySelector<HTMLElement>(selector);
    return el ? alphaOf(getComputedStyle(el).backgroundColor) : null;
  };
  return {
    panelAlpha: alphaFor(".glass-panel:not(.glass-panel--solid)"),
    solidAlpha: alphaFor(".glass-panel--solid"),
    theme: document.documentElement.classList.contains("light") ? "light" : "dark",
    bodyColor: getComputedStyle(document.body).color,
    panel: pc
      ? {
          alpha: alphaOf(pc.backgroundColor),
          radius: pc.borderRadius,
          edge: getComputedStyle(panel!, "::before").animationName,
          sweep: getComputedStyle(panel!, "::after").animationName,
          sweepOpacity: Number(getComputedStyle(panel!, "::after").opacity),
        }
      : null,
    panelCount: document.querySelectorAll(".glass-panel").length,
    auroraCount: aurora.length,
    auroraAnim: [...new Set(aurora.map((a) => getComputedStyle(a).animationName))],
    ticker: ticker
      ? {
          alpha: alphaOf(getComputedStyle(ticker).backgroundColor),
          blur: getComputedStyle(ticker).backdropFilter,
        }
      : null,
    eyebrow: eyebrow
      ? {
          size: getComputedStyle(eyebrow).fontSize,
          color: getComputedStyle(eyebrow).color,
          display: getComputedStyle(eyebrow).display,
        }
      : null,
    heroTitle: heroTitle
      ? { weight: getComputedStyle(heroTitle).fontWeight, size: getComputedStyle(heroTitle).fontSize }
      : null,
    sectionTitleSize: sectionTitle ? getComputedStyle(sectionTitle).fontSize : null,
    barAnim: bar ? getComputedStyle(bar).animationName : null,
    fillWidth: fill ? getComputedStyle(fill).width : null,
    fillTarget: fill ? getComputedStyle(fill).getPropertyValue("--w").trim() : null,
    overflow: document.documentElement.scrollWidth - window.innerWidth,
  };
};

async function probe(page: Page) {
  return page.evaluate(PROBE);
}

test("landing glass panels reuse the shared sweep + edge effects (dark)", async ({ page }) => {
  await page.goto(`${BASE_URL}/`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".glass-panel", { timeout: 30_000 });

  const p = await probe(page);

  expect(p.theme).toBe("dark");
  expect(p.panelCount, "the landing page renders glass panels").toBeGreaterThan(10);
  expect(p.panel!.radius, "panels stay on the one radius system (8px)").toBe("8px");

  // Translucent: the scene must read through it (and not be fully transparent).
  expect(p.panel!.alpha, "panel is translucent").toBeGreaterThan(0.3);
  expect(p.panel!.alpha, "panel is not opaque").toBeLessThan(1);

  // The shared effects, not new ones.
  expect(p.panel!.edge, "top edge uses the shared av-edge-glow").toBe("av-edge-glow");
  expect(p.panel!.sweep, "surface sweep uses the shared av-panel-sweep").toBe("av-panel-sweep");

  expect(p.auroraCount, "hero + CTA carry aurora layers").toBeGreaterThanOrEqual(4);
  expect(p.auroraAnim, "aurora reuses av-aurora-drift").toEqual(["av-aurora-drift"]);

  // Type ladder.
  expect(p.eyebrow!.size).toBe("11px");
  expect(p.eyebrow!.color, "eyebrow is the brand accent").toBe("rgb(222, 102, 28)");
  expect(p.eyebrow!.display, "badge layout survives the eyebrow class").toBe("inline-flex");
  expect(p.heroTitle!.weight).toBe("700");
  expect(Number.parseFloat(p.sectionTitleSize!)).toBeLessThan(Number.parseFloat(p.heroTitle!.size));

  // Readable data stays crisp (§21.3): opaque ticker, no blur.
  expect(p.ticker!.alpha, "the live ticker is an opaque surface").toBe(1);
  expect(p.ticker!.blur, "the live ticker is not blurred").toBe("none");
});

test("light theme re-tints the same tokens", async ({ page }) => {
  await page.goto(`${BASE_URL}/`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".glass-panel", { timeout: 30_000 });

  const dark = await probe(page);

  // Flip through the app's own theme mechanism (`THEME_INIT_SCRIPT` reads this
  // key before paint) rather than poking the class, which React re-asserts.
  await page.evaluate(() => localStorage.setItem("algovault-theme", "light"));
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector(".glass-panel", { timeout: 30_000 });
  await page.waitForTimeout(600);
  const light = await probe(page);

  expect(light.theme).toBe("light");
  // Light panels are more opaque so ink stays legible over the daylight scene —
  // per variant, and settled (0.82/0.93 are the light token values; a
  // post-paint theme flip would show an in-flight value like 0.788 here).
  expect(light.panelAlpha, `light plain panel alpha ${light.panelAlpha}`).toBe(0.82);
  expect(dark.panelAlpha, `dark plain panel alpha ${dark.panelAlpha}`).toBe(0.74);
  expect(light.solidAlpha, `light solid panel alpha ${light.solidAlpha}`).toBe(0.93);
  expect(dark.solidAlpha, `dark solid panel alpha ${dark.solidAlpha}`).toBe(0.9);
  expect(light.panelAlpha!, "light plain panels are more opaque").toBeGreaterThan(dark.panelAlpha!);
  expect(light.solidAlpha!, "light solid panels are more opaque").toBeGreaterThan(dark.solidAlpha!);
  expect(light.solidAlpha!, "a readable panel stays more opaque than a light panel").toBeGreaterThan(
    light.panelAlpha!
  );
  expect(light.panel!.edge, "the shared edge effect is theme-agnostic").toBe("av-edge-glow");
  expect(light.auroraAnim).toEqual(["av-aurora-drift"]);
  // Ink on the light surface is dark (the token swap cascaded).
  const ink = Number(light.bodyColor.match(/\d+/)?.[0] ?? 255);
  expect(ink, "light theme renders dark ink").toBeLessThan(120);
  expect(light.ticker!.alpha, "the ticker stays opaque in light theme").toBe(1);
});

test("no horizontal overflow at 390 / 768 / 1440", async ({ browser }) => {
  for (const width of [390, 768, 1440]) {
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    const page = await context.newPage();
    await page.goto(`${BASE_URL}/`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector(".glass-panel", { timeout: 30_000 });
    await page.waitForTimeout(400);
    const p = await probe(page);
    expect(p.overflow, `no horizontal overflow at ${width}px`).toBeLessThanOrEqual(1);
    await context.close();
  }
});

test("reduced motion stops every landing animation", async ({ browser }) => {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    reducedMotion: "reduce",
  });
  const page = await context.newPage();
  await page.goto(`${BASE_URL}/`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".glass-panel", { timeout: 30_000 });
  await page.waitForTimeout(1500);

  const p = await probe(page);

  expect(p.panel!.edge, "edge pulse is off").toBe("none");
  expect(p.panel!.sweep, "panel sweep is off").toBe("none");
  expect(p.panel!.sweepOpacity, "the sweep is fully hidden").toBe(0);
  expect(p.auroraAnim, "aurora drift is off").toEqual(["none"]);
  expect(p.barAnim, "the dashboard bars do not grow").toBe("none");
  // The fill must still show its value (the animation ended at `--w`).
  expect(p.fillTarget, "fills keep their recorded target").not.toBe("");
  expect(Number.parseFloat(p.fillWidth!), "fills render at their target width").toBeGreaterThan(0);

  await context.close();
});
