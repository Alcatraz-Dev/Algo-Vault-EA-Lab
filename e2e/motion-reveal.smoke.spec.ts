import { test, expect, type Page } from "@playwright/test";

/**
 * Motion reveal + tw-animate-css smoke test (real Chromium).
 *
 *   npm run test:e2e-viewport -- e2e/motion-reveal.smoke.spec.ts
 *   # or: SMOKE_BASE_URL=http://localhost:3000 \
 *   #     chrome-extension/node_modules/.bin/playwright test \
 *   #       -c e2e/playwright.config.ts e2e/motion-reveal.smoke.spec.ts
 *
 * Covers the two things this pass changed:
 *   1. `<Reveal />` (components/home/Reveal.tsx) is now Motion-driven
 *      (`whileInView`). Its visible-in-viewport half must animate to opacity 1
 *      and its below-the-fold half must reveal on scroll. The headless preview
 *      panel does not service IntersectionObserver after programmatic scrolling,
 *      so this behavioural proof has to run in a real browser.
 *   2. The `animate-in` / `fade-in-0` / `zoom-in-95` / `slide-in-from-*`
 *      utilities that Base UI's dropdown and tooltip already referenced used to
 *      compile to nothing. They must now resolve to a real animation.
 *
 * Assertions are behavioural (computed opacity / animation-name), not
 * pixel-perfect screenshots.
 */

const BASE_URL = process.env.SMOKE_BASE_URL || "http://localhost:3000";

const REVEAL = "[data-motion-reveal]";

/** Opacity of every reveal wrapper, plus how many have settled and how many are stuck hidden. */
const REVEAL_STATE = () => {
  const els = [...document.querySelectorAll("[data-motion-reveal]")];
  const opacities = els.map((e) => Number(getComputedStyle(e).opacity));
  return {
    total: els.length,
    revealed: opacities.filter((o) => o === 1).length,
    stuckHidden: opacities.filter((o) => o === 0).length,
    inFlight: opacities.filter((o) => o > 0 && o < 1).length,
  };
};

/** Resolve the classes tw-animate-css supplies on a throwaway element. */
const UTILITY_PROBE = () => {
  const make = (cls: string) => {
    const d = document.createElement("div");
    d.className = cls;
    document.body.appendChild(d);
    const cs = getComputedStyle(d);
    const out = {
      animationName: cs.animationName,
      translateY: cs.getPropertyValue("--tw-enter-translate-y").trim(),
      scale: cs.getPropertyValue("--tw-enter-scale").trim(),
      opacityVar: cs.getPropertyValue("--tw-enter-opacity").trim(),
    };
    d.remove();
    return out;
  };
  return {
    enter: make("animate-in fade-in-0 zoom-in-95"),
    exit: make("animate-out fade-out-0 zoom-out-95"),
    slide: make("animate-in slide-in-from-top-2"),
    none: make(""),
  };
};

async function revealState(page: Page) {
  return page.evaluate(REVEAL_STATE);
}

test("home reveal animates in view and on scroll (Motion whileInView)", async ({ page }) => {
  test.setTimeout(120_000);

  const pageErrors: string[] = [];
  page.on("pageerror", (e) => pageErrors.push(String(e).slice(0, 400)));

  await page.goto(`${BASE_URL}/`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(REVEAL, { timeout: 30_000 });

  const total = (await revealState(page)).total;
  expect(total, "the home page renders its reveal wrappers").toBeGreaterThan(15);

  // 1. The wrappers already in view at mount must settle to fully opaque.
  await expect
    .poll(async () => (await revealState(page)).revealed, { timeout: 20_000 })
    .toBeGreaterThan(0);
  const atRest = await revealState(page);
  expect(atRest.stuckHidden, "visible wrappers are not left transparent").toBeLessThan(total);
  expect(
    await page.locator(REVEAL).first().evaluate((e) => getComputedStyle(e).opacity),
    "the first (hero) wrapper is opaque"
  ).toBe("1");

  // 2. Wrappers below the fold stay hidden until scrolled to...
  const hiddenBeforeScroll = atRest.stuckHidden;
  expect(hiddenBeforeScroll, "below-the-fold content starts hidden").toBeGreaterThan(0);

  // 3. ...and then reveal as they enter the viewport, page section by section.
  let revealedSoFar = atRest.revealed;
  let sawGrowth = false;
  for (let i = 0; i < 14; i++) {
    await page.mouse.wheel(0, 700);
    await page.waitForTimeout(600);
    const s = await revealState(page);
    if (s.revealed > revealedSoFar) sawGrowth = true;
    revealedSoFar = Math.max(revealedSoFar, s.revealed);
    if (s.stuckHidden === 0) break;
  }
  await page.waitForTimeout(1200);
  const end = await revealState(page);

  expect(sawGrowth, "scrolling reveals sections that were hidden").toBe(true);
  expect(
    end.revealed,
    `scrolling to the bottom reveals the page (revealed ${end.revealed}/${end.total}, stuck ${end.stuckHidden})`
  ).toBeGreaterThanOrEqual(Math.ceil(end.total * 0.8));

  await page.screenshot({ path: "e2e/artifacts/motion-01-revealed.png" });
  expect(pageErrors, "no unhandled exceptions").toEqual([]);
});

test("reduced motion shows all reveal content immediately", async ({ browser }) => {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    reducedMotion: "reduce",
  });
  const page = await context.newPage();

  await page.goto(`${BASE_URL}/`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(REVEAL, { timeout: 30_000 });
  await page.waitForTimeout(2500);

  const s = await revealState(page);
  expect(s.total).toBeGreaterThan(15);
  // The [data-motion-reveal] guard in globals.css must beat Motion's inline
  // opacity, so nothing is hidden when the user asks for reduced motion.
  expect(s.stuckHidden, "reduced motion leaves nothing transparent").toBe(0);

  await context.close();
});

test("animate-in utilities resolve to a real animation (tw-animate-css)", async ({ page }) => {
  await page.goto(`${BASE_URL}/`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("body", { timeout: 30_000 });

  const probe = await page.evaluate(UTILITY_PROBE);

  expect(probe.enter.animationName, "animate-in resolves to a real animation name").not.toBe("none");
  expect(probe.enter.animationName, "the enter keyframes come from tw-animate-css").toContain("enter");
  expect(probe.exit.animationName, "animate-out resolves").toContain("exit");
  expect(probe.none.animationName, "a plain element still has no animation").toBe("none");

  // fade-in-0 / zoom-in-95 / slide-in-from-top-2 drive the enter variables.
  // tw-animate-css emits the scale as a CSS number (".95"), so compare numerically.
  expect(probe.enter.opacityVar, "fade-in-0 sets the enter opacity").toBe("0");
  expect(Number(probe.enter.scale), "zoom-in-95 sets the enter scale").toBeCloseTo(0.95, 2);
  expect(probe.slide.translateY, "slide-in-from-top-2 sets the enter translate").not.toBe("");
});
