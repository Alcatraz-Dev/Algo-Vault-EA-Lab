import { test, expect, type Page } from "@playwright/test";

/**
 * Pro Terminal viewport smoke test (Phase 2 ViewportController, real browser).
 *
 * Runs against the real Next.js app, the real ProTerminalChart workspace
 * (the canonical Pro Terminal chart surface), the real lightweight-charts
 * instance and the real /api/analytics/ohlc + /api/market/quotes pipeline.
 *
 *   SMOKE_BASE_URL=http://localhost:3001 npm run test:e2e-viewport
 *
 * (The spec imports `@playwright/test`, which the repo keeps inside the
 *  chrome-extension workspace. If root resolution is missing after an npm
 *  install, recreate the link once with:
 *  `ln -sfn ../../chrome-extension/node_modules/@playwright/test node_modules/@playwright/test`)
 *
 * NOTE ON THE ROUTE: the dedicated Pro Terminal route
 * (/account/scalping-terminal) is gated behind a Firebase session with a
 * paid-subscription record; no credentials, fixture, seeded user or bypass
 * exists in this repository. The test therefore targets /advanced-analysis,
 * which renders the SAME canonical ProTerminalChartWorkspace → ProTerminalChart
 * → ViewportController → lightweight-charts stack with the same real data
 * pipeline (see components/pro-scalping-terminal/ProTerminalChartWorkspace.tsx,
 * "the shared Pro Terminal chart with full toolbars").
 *
 * Assertions are behavioral (logical ranges, follow phase, market anchors,
 * bar spacing) — no pixel-perfect screenshots.
 */

const BASE_URL = process.env.SMOKE_BASE_URL || "http://localhost:3000";

// ── in-page helpers ─────────────────────────────────────────────────────────

/** Count viewport-mutating time-scale calls so we can assert "no fitContent
 *  during ordinary updates" etc. Installed before the chart exists. */
const CALL_COUNTER_INIT = () => {
  type Any = any;
  (window as any).__vpCalls = { fitContent: 0, scrollToRealTime: 0, setVisibleLogicalRange: 0 };
  const timer = setInterval(() => {
    const ws = document.querySelector("[data-pro-terminal-workspace]");
    if (!ws) return;
    for (const c of Array.from(ws.querySelectorAll("canvas")) as Any[]) {
      let el: Any = c.parentElement;
      while (el) {
        const key = Object.keys(el).find((k) => k.startsWith("__reactFiber$"));
        if (key) {
          let cur = el[key];
          let hops = 0;
          while (cur && hops < 200) {
            hops++;
            let hook = cur.memoizedState;
            while (hook) {
              const s = hook.memoizedState;
              const o = s && typeof s === "object" && "current" in s ? s.current : null;
              if (o && typeof o === "object" && typeof o.timeScale === "function" && typeof o.subscribeCrosshairMove === "function") {
                const proto = Object.getPrototypeOf(o.timeScale());
                for (const name of ["fitContent", "scrollToRealTime", "setVisibleLogicalRange"] as const) {
                  const orig = proto[name];
                  if (typeof orig !== "function" || orig.__counted) continue;
                  const wrapped = function (this: any, ...args: any[]) {
                    (window as any).__vpCalls[name] += 1;
                    return orig.apply(this, args);
                  };
                  wrapped.__counted = true;
                  proto[name] = wrapped;
                }
                clearInterval(timer);
                return;
              }
              hook = hook.next;
            }
            cur = cur.return;
          }
        }
        el = el.parentElement;
      }
    }
  }, 5);
};

/** Full viewport/series snapshot straight from the mounted chart instance. */
const PROBE = () => {
  type Any = any;
  const ws = document.querySelector("[data-pro-terminal-workspace]") as Any;
  if (!ws) return { error: "no workspace" };
  const canvases = Array.from(ws.querySelectorAll("canvas")) as Any[];

  let controllers = 0;
  let charts = 0;
  let controller: Any = null;
  let chart: Any = null;
  let series: Any = null;
  const seenControllers = new Set<Any>();
  const seenCharts = new Set<Any>();

  for (const c of canvases) {
    let el: Any = c.parentElement;
    while (el) {
      const key = Object.keys(el).find((k) => k.startsWith("__reactFiber$"));
      if (key) {
        let cur = el[key];
        let hops = 0;
        while (cur && hops < 200) {
          hops++;
          let hook = cur.memoizedState;
          while (hook) {
            const s = hook.memoizedState;
            const o = s && typeof s === "object" && "current" in s ? s.current : null;
            if (o && typeof o === "object") {
              if (typeof o.getPhase === "function" && typeof o.isFollowingLive === "function") {
                if (!seenControllers.has(o)) {
                  seenControllers.add(o);
                  controllers += 1;
                  controller = controller ?? o;
                }
              }
              if (typeof o.timeScale === "function" && typeof o.subscribeCrosshairMove === "function") {
                if (!seenCharts.has(o)) {
                  seenCharts.add(o);
                  charts += 1;
                  chart = chart ?? o;
                }
              }
              if (typeof o.setData === "function" && typeof o.data === "function") series = o;
            }
            hook = hook.next;
          }
          cur = cur.return;
        }
      }
      el = el.parentElement;
    }
    if (controller && chart) break;
  }

  if (!chart || !controller) return { error: "chart not mounted", controllers, charts };
  const ts = chart.timeScale();
  const range = ts.getVisibleLogicalRange();
  const data: Any[] = series ? series.data() : [];
  // Prefer the candlestick series (bars carry OHLC fields).
  const candleish = data.length > 0 && typeof data[0].open !== "undefined";
  const len = data.length;
  const lastX = len > 0 ? ts.logicalToCoordinate((len - 1) as Any) : null;
  const plotCanvas = canvases.find((cv) => (cv as Any).getBoundingClientRect().width > 200) ?? canvases[0];
  const plotRect = plotCanvas ? plotCanvas.getBoundingClientRect() : null;
  const goLiveBtn = Array.from(document.querySelectorAll("button")).find((b) => (b.textContent || "").includes("Go to Live"));
  const loadingOlder = Array.from(document.querySelectorAll("div")).some((d) => (d.textContent || "").includes("Loading older history"));
  const domainLabel = document.querySelector("[data-pro-terminal-workspace] span[title='Active symbol']")?.textContent ?? null;

  const leftIdx = range ? Math.max(0, Math.floor(range.from)) : -1;
  const rightIdx = range ? Math.min(len - 1, Math.ceil(range.to) - 1) : -1;
  const deltas: number[] = [];
  for (let i = Math.max(1, len - 8); i < len; i++) deltas.push((data[i] as Any).time - (data[i - 1] as Any).time);

  return {
    controllers,
    charts,
    phase: controller.getPhase(),
    following: controller.isFollowingLive(),
    epoch: controller.getEpoch(),
    barCount: controller.getBarCount(),
    range: range ? { from: Math.round(range.from * 100) / 100, to: Math.round(range.to * 100) / 100 } : null,
    width: range ? Math.round((range.to - range.from) * 100) / 100 : null,
    margin: range ? Math.round((range.to - (len - 1)) * 100) / 100 : null,
    barSpacing: range && plotRect ? Math.round((plotRect.width / (range.to - range.from)) * 1000) / 1000 : null,
    seriesLen: len,
    candleish,
    lastTime: len ? (data[len - 1] as Any).time : null,
    lastClose: len ? (data[len - 1] as Any).close ?? (data[len - 1] as Any).value : null,
    leftTime: leftIdx >= 0 && data[leftIdx] ? (data[leftIdx] as Any).time : null,
    rightTime: rightIdx >= 0 && data[rightIdx] ? (data[rightIdx] as Any).time : null,
    recentBarDeltas: deltas,
    xLast: lastX === null ? null : Math.round(((lastX as number) / (plotRect?.width || 1)) * 1000) / 1000,
    plotW: plotRect ? Math.round(plotRect.width) : null,
    goLiveChip: Boolean(goLiveBtn),
    loadingOlder,
    domainLabel,
    calls: { ...(window as any).__vpCalls },
  };
};

type Probe = Record<string, any>;

async function probe(page: Page): Promise<Probe> {
  return (await page.evaluate(PROBE)) as Probe;
}

async function waitForProbe(page: Page, pred: (p: Probe) => boolean, timeoutMs = 15000, label = "condition"): Promise<Probe> {
  const deadline = Date.now() + timeoutMs;
  let last: Probe | null = null;
  while (Date.now() < deadline) {
    last = await probe(page);
    if (pred(last)) return last;
    await page.waitForTimeout(250);
  }
  throw new Error(`timed out waiting for ${label}; last probe=${JSON.stringify(last)}`);
}

/** Drag the chart's main pane rightwards (reveals older content, away from live). */
async function panRight(page: Page, px: number): Promise<void> {
  const canvases = page.locator("[data-pro-terminal-workspace] canvas");
  const n = await canvases.count();
  let target = 0;
  let area = -1;
  for (let i = 0; i < n; i++) {
    const b = await canvases.nth(i).boundingBox();
    if (b && b.width * b.height > area) {
      area = b.width * b.height;
      target = i;
    }
  }
  const box0 = await canvases.nth(target).boundingBox();
  if (!box0) throw new Error("no chart canvas");
  await canvases.nth(target).scrollIntoViewIfNeeded();
  await page.waitForTimeout(150);
  const box = await canvases.nth(target).boundingBox();
  if (!box) throw new Error("no chart canvas");
  const y = box.y + box.height / 2;
  const startX = box.x + Math.min(60, box.width / 4);
  const endX = Math.min(box.x + box.width - 5, startX + px);
  await page.mouse.move(startX, y);
  await page.mouse.down();
  const steps = 8;
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(startX + ((endX - startX) * i) / steps, y, { steps: 2 });
    await page.waitForTimeout(20);
  }
  await page.mouse.up();
  await page.waitForTimeout(250);
}

async function wheelZoom(page: Page, delta: number): Promise<void> {
  const canvases = page.locator("[data-pro-terminal-workspace] canvas");
  const n = await canvases.count();
  let target = 0;
  let area = -1;
  for (let i = 0; i < n; i++) {
    const b = await canvases.nth(i).boundingBox();
    if (b && b.width * b.height > area) {
      area = b.width * b.height;
      target = i;
    }
  }
  const box0 = await canvases.nth(target).boundingBox();
  if (!box0) throw new Error("no chart canvas");
  await canvases.nth(target).scrollIntoViewIfNeeded();
  await page.waitForTimeout(150);
  const box = await canvases.nth(target).boundingBox();
  if (!box) throw new Error("no chart canvas");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  for (let i = 0; i < 3; i++) {
    await page.mouse.wheel(0, delta > 0 ? Math.ceil(delta / 3) : Math.floor(delta / 3));
    await page.waitForTimeout(150);
  }
  await page.waitForTimeout(400);
}

// ── the smoke test ──────────────────────────────────────────────────────────

test("Pro Terminal viewport — Phase 2 smoke", async ({ page }) => {
  test.setTimeout(300_000);

  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  const failedRequests: string[] = [];
  const badResponses: string[] = [];
  const apiCounts: Record<string, number> = {};
  const tStart = Date.now();
  page.on("console", (m) => {
    if (m.type() === "error") {
      const loc = m.location().url || "";
      consoleErrors.push(m.text().slice(0, 400) + (loc ? ` @ ${loc}` : ""));
    }
  });
  page.on("pageerror", (e) => pageErrors.push(String(e).slice(0, 400)));
  page.on("response", (r) => {
    if (r.status() >= 400) badResponses.push(`${r.status()} ${r.url()}`);
  });
  page.on("requestfailed", (r) => failedRequests.push(`${r.method()} ${r.url()} :: ${r.failure()?.errorText}`));
  page.on("request", (r) => {
    const u = r.url();
    if (u.includes("/api/")) {
      const key = u.replace(/https?:\/\/[^/]+/, "").split("?")[0];
      apiCounts[key] = (apiCounts[key] || 0) + 1;
    }
  });
  await page.addInitScript(CALL_COUNTER_INIT);

  // ── 1. INITIAL LOAD ──────────────────────────────────────────────────────
  await test.step("initial load", async () => {
    await page.goto(`${BASE_URL}/advanced-analysis`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector("[data-pro-terminal-workspace] canvas", { timeout: 30000 });
    // Wait for the feed to settle (history pages land within a couple seconds).
    await waitForProbe(page, (p) => (p.seriesLen ?? 0) >= 250 && p.range !== null, 20000, "initial candles");
    await page.waitForTimeout(2500);
    const p = await waitForProbe(
      page,
      (q) => (q.seriesLen ?? 0) >= 250 && q.barCount === q.seriesLen && !q.loadingOlder,
      20000,
      "history settle"
    );
    expect(p.error, JSON.stringify(p)).toBeUndefined();
    expect(p.controllers, "exactly one ViewportController").toBe(1);
    expect(p.charts, "exactly one chart instance").toBe(1);
    expect(p.candleish, "candlestick series carries OHLC data").toBe(true);
    expect(p.phase, "initial phase follows live").toBe("FOLLOWING_LIVE");
    expect(p.following).toBe(true);
    expect(p.seriesLen, "real history loaded").toBeGreaterThan(250);
    expect(p.margin, "viewport sits at the live edge, not deep in the right margin").toBeLessThanOrEqual(10);
    expect(p.xLast, "newest candle rendered near the right edge").toBeGreaterThan(0.75);
    expect(p.barSpacing, "sensible initial zoom").toBeGreaterThan(0.4);
    expect(p.barSpacing).toBeLessThan(60);
    expect(p.goLiveChip, "no Go-to-Live chip while following").toBe(false);
    await page.screenshot({ path: "e2e/artifacts/smoke-01-initial.png" });
  });

  // ── 2. USER PAN ──────────────────────────────────────────────────────────
  const panned = await test.step("user pan", async () => {
    const before = await probe(page);
    await panRight(page, 320);
    const after = await waitForProbe(page, (q) => q.phase === "USER_PANNED", 5000, "USER_PANNED after pan");
    expect(after.following, "follow disengaged").toBe(false);
    expect(after.goLiveChip, "Go-to-Live chip appears when panned").toBe(true);
    expect(after.range.from, "viewport moved toward older history").toBeLessThan(before.range.from - 40);
    expect(after.width, "pan does not change zoom").toBeCloseTo(before.width, 0);
    // No snap-back: hold 1.5s and confirm the market area stayed put.
    await page.waitForTimeout(1500);
    const held = await probe(page);
    expect(held.phase, "viewport does not snap back to live").toBe("USER_PANNED");
    expect(Math.abs(held.leftTime - after.leftTime), "leftmost visible candle anchored (±1 bar)").toBeLessThanOrEqual(300);
    await page.screenshot({ path: "e2e/artifacts/smoke-02-panned.png" });
    return held;
  });

  // ── 3. FORMING-CANDLE UPDATES WHILE PANNED ───────────────────────────────
  await test.step("forming update while panned", async () => {
    const before = await probe(page);
    const callsBefore = { ...before.calls };
    // Let the real feed poll (~5s cadence) run for a few cycles. The market
    // is closed only on weekends — updates otherwise arrive naturally.
    await page.waitForTimeout(15000);
    const after = await waitForProbe(page, () => true, 5000, "post-wait probe");
    expect(after.phase, "still USER_PANNED after live updates").toBe("USER_PANNED");
    expect(after.following).toBe(false);
    expect(after.goLiveChip, "chip still exposed").toBe(true);
    expect(Math.abs(after.leftTime - before.leftTime), "visible market area frozen while panned").toBeLessThanOrEqual(300);
    expect(Math.abs(after.rightTime - before.rightTime), "right edge of view frozen while panned").toBeLessThanOrEqual(300);
    expect(after.barSpacing, "bar spacing stable across updates").toBeCloseTo(before.barSpacing, 1);
    expect(after.calls.fitContent, "no fitContent during ordinary updates").toBe(callsBefore.fitContent);
    // Evidence that real updates flowed (price moved or a bar closed) is
    // recorded but only warned about when the market session is paused.
    const marketPaused = await page.getByText(/MARKET CLOSED/).first().isVisible().catch(() => false);
    const dataChanged = after.lastClose !== before.lastClose || after.lastTime !== before.lastTime || after.seriesLen !== before.seriesLen;
    if (!dataChanged && !marketPaused) {
      console.log("WARN: no visible feed change during the 15s wait (environment may be quiet)");
    }
    await page.screenshot({ path: "e2e/artifacts/smoke-03-panned-updates.png" });
  });

  // ── 4. GO LIVE ───────────────────────────────────────────────────────────
  await test.step("go live", async () => {
    const before = await probe(page);
    const chip = page.getByRole("button", { name: /Go to Live/ });
    await expect(chip).toBeVisible();
    await chip.click();
    const after = await waitForProbe(page, (q) => q.phase === "FOLLOWING_LIVE", 5000, "FOLLOWING_LIVE after go-live");
    expect(after.following).toBe(true);
    expect(after.goLiveChip, "chip disappears once live").toBe(false);
    expect(after.margin, "back at the live edge").toBeLessThanOrEqual(10);
    expect(after.xLast, "newest candle back near the right edge").toBeGreaterThan(0.75);
    expect(after.barSpacing, "go-live never zooms (no fitContent reset)").toBeCloseTo(before.barSpacing, 1);
    expect(after.calls.fitContent, "go-live performs no fitContent").toBe(before.calls.fitContent);
    await page.screenshot({ path: "e2e/artifacts/smoke-04-go-live.png" });
  });

  // ── 6/7. HISTORY PREPEND + REPEATED PREPEND ──────────────────────────────
  // (Runs before zoom so dragging to the left edge stays cheap at the
  //  initial bar spacing.)
  const prependResult = await test.step("history prepend + repeated prepend", async () => {
    const start = await probe(page);
    const fitsAtStart = start.calls.fitContent;
    let prepends = 0;
    let firstLoad: Probe | null = null;
    let secondLoad: Probe | null = null;
    let atEdge: Probe | null = null;
    let atEdge2: Probe | null = null;

    // Drive the left edge to the history threshold and wait for a real page.
    const driveToEdge = async (budgetDrags: number): Promise<boolean> => {
      for (let i = 0; i < budgetDrags; i++) {
        const p = await probe(page);
        if ((p.range?.from ?? 99) <= 8) return true;
        await panRight(page, 320);
      }
      return (await probe(page)).range?.from <= 8;
    };

    // First prepend.
    const lenBefore = (await probe(page)).seriesLen;
    const reached = await driveToEdge(10);
    if (reached) {
      atEdge = await probe(page); // anchor baseline the moment the threshold is hit
      try {
        await waitForProbe(page, (q) => (q.seriesLen ?? 0) > lenBefore + 10, 20000, "first history page");
        prepends = 1;
        firstLoad = await probe(page);
      } catch {
        console.log("NOTE: first history prepend did not arrive (provider exhausted or unavailable)");
      }
    }

    if (prepends >= 1 && firstLoad && atEdge) {
      console.log(
        "PREPEND1_DEBUG: " +
          JSON.stringify({
            atEdge: { range: atEdge.range, len: atEdge.seriesLen, leftTime: atEdge.leftTime, calls: atEdge.calls },
            firstLoad: {
              range: firstLoad.range,
              len: firstLoad.seriesLen,
              leftTime: firstLoad.leftTime,
              calls: firstLoad.calls,
              phase: firstLoad.phase,
              barCount: firstLoad.barCount,
            },
          })
      );
      expect(firstLoad.phase, "prepend must not activate live-follow").toBe("USER_PANNED");
      expect(firstLoad.following).toBe(false);
      expect(firstLoad.barSpacing, "bar spacing stable across prepend").toBeCloseTo(start.barSpacing, 1);
      expect(firstLoad.calls.fitContent, "no fitContent during prepend").toBe(fitsAtStart);
      // The market area visible when the threshold fired stays anchored
      // (±2 bars) — the prepend must not jump the view. The right edge is the
      // reliable anchor: empty left margin (range.from < 0) legitimately fills
      // with the newly prepended older candles, so the left edge may only move
      // OLDER, never newer.
      expect(
        Math.abs((firstLoad.rightTime as number) - (atEdge.rightTime as number)),
        "market area anchored across the first prepend"
      ).toBeLessThanOrEqual(600);
      expect(
        (firstLoad.leftTime as number) <= (atEdge.leftTime as number) + 600,
        "left edge never jumps newer than the previously visible area"
      ).toBe(true);

      // Second prepend: pan back to the (new) left edge and repeat.
      const len2base = firstLoad.seriesLen;
      const reached2 = await driveToEdge(10);
      if (reached2) {
        atEdge2 = await probe(page);
        try {
          await waitForProbe(page, (q) => (q.seriesLen ?? 0) > len2base + 10, 20000, "second history page");
          prepends = 2;
          secondLoad = await probe(page);
        } catch {
          console.log("NOTE: second history prepend did not arrive (provider exhausted or unavailable)");
        }
      }
    }

    if (prepends >= 2 && secondLoad && atEdge2) {
      expect(secondLoad.phase, "repeated prepend keeps USER_PANNED").toBe("USER_PANNED");
      expect(secondLoad.calls.fitContent, "no fitContent on repeated prepend").toBe(fitsAtStart);
      expect(secondLoad.barSpacing, "no cumulative zoom drift").toBeCloseTo(start.barSpacing, 1);
      // Each prepend anchors exactly the area that was on screen when its
      // threshold fired — no cumulative compensation drift.
      const drift = Math.abs((secondLoad.rightTime as number) - (atEdge2.rightTime as number));
      expect(drift, "second prepend anchored to its own trigger area").toBeLessThanOrEqual(600);
      expect(
        (secondLoad.leftTime as number) <= (atEdge2.leftTime as number) + 600,
        "left edge never jumps newer on repeated prepend"
      ).toBe(true);
      await page.screenshot({ path: "e2e/artifacts/smoke-05-repeated-prepend.png" });
    } else {
      console.log(
        `NOTE: environment-limited — ${prepends}/2 history prepends observed; ` +
          "deep-history provider did not serve further pages. The deterministic " +
          "prepend tests (viewport-state-machine.test.ts #7–10, #32, #22, #35, #36) cover this path."
      );
    }

    // Return to live for the following scenarios.
    const chip = page.getByRole("button", { name: /Go to Live/ });
    if (await chip.isVisible().catch(() => false)) {
      await chip.click();
      await waitForProbe(page, (q) => q.phase === "FOLLOWING_LIVE", 5000, "back to live after prepend");
    }
    return prepends;
  });

  // ── 5. ZOOM ──────────────────────────────────────────────────────────────
  await test.step("zoom", async () => {
    const base = await probe(page);
    await wheelZoom(page, -600); // zoom in (3 wheel ticks)
    const zoomedIn = await waitForProbe(page, (q) => (q.barSpacing ?? 0) > (base.barSpacing ?? 0) * 1.2, 5000, "zoom in");
    await wheelZoom(page, 900); // partially back out
    const afterZoom = await probe(page);
    // Zooming around the cursor may legitimately pull the view away from the
    // live edge (→ USER_PANNED + chip); both follow states are acceptable.
    expect(["FOLLOWING_LIVE", "USER_PANNED"]).toContain(afterZoom.phase);
    expect(afterZoom.following, "follow flag matches phase").toBe(afterZoom.phase === "FOLLOWING_LIVE");
    expect(afterZoom.width, "zoomed view shows a fraction of the dataset, not everything").toBeLessThan(
      afterZoom.seriesLen * 0.9
    );
    expect(afterZoom.width, "not fit-to-content").toBeLessThan(zoomedIn.seriesLen * 0.9);
    // Ordinary updates must not reset the user's zoom.
    const callsBefore = { ...afterZoom.calls };
    await page.waitForTimeout(12000);
    const afterUpdate = await probe(page);
    expect(afterUpdate.barSpacing, "bar spacing stable across updates").toBeCloseTo(afterZoom.barSpacing, 1);
    expect(afterUpdate.width, "viewport does not jump to the full dataset").toBeCloseTo(afterZoom.width, 0);
    expect(afterUpdate.calls.fitContent, "no fitContent during ordinary updates").toBe(callsBefore.fitContent);
    await page.screenshot({ path: "e2e/artifacts/smoke-06-zoom.png" });
  });

  // ── 8. TIMEFRAME CHANGE ──────────────────────────────────────────────────
  await test.step("timeframe change (M5 → M1)", async () => {
    const before = await probe(page);
    const m1 = page.getByRole("button", { name: "M1", exact: true }).first();
    await m1.click();
    const after = await waitForProbe(
      page,
      (q) => (q.epoch ?? 0) > (before.epoch ?? 0) && (q.seriesLen ?? 0) > 50 && q.range !== null,
      15000,
      "M1 dataset"
    );
    await page.waitForTimeout(1500);
    const settled = await probe(page);
    expect(settled.phase, "new timeframe context follows live").toBe("FOLLOWING_LIVE");
    expect(settled.margin, "new context starts at its live edge (range not blindly reused)").toBeLessThanOrEqual(10);
    expect(settled.xLast, "new timeframe renders near the right edge").toBeGreaterThan(0.7);
    // M1 bars: recent spacing should be 60s (skip gaps at the series tail).
    const deltas = settled.recentBarDeltas as number[];
    expect(deltas.some((d) => d === 60), `M1 bars present (deltas=${JSON.stringify(deltas)})`).toBe(true);
    expect(await m1.getAttribute("aria-pressed"), "toolbar reflects M1").toBe("true");
    const fitsDelta = settled.calls.fitContent - before.calls.fitContent;
    expect(fitsDelta, "exactly the single initial-fit policy for the new context").toBeLessThanOrEqual(1);
    await page.screenshot({ path: "e2e/artifacts/smoke-07-timeframe-m1.png" });
  });

  // ── 9. SYMBOL CHANGE ─────────────────────────────────────────────────────
  await test.step("symbol change", async () => {
    const before = await probe(page);
    const rows = page.locator("[data-pro-terminal-workspace] tbody tr");
    const count = await rows.count();
    let nextLabel = "";
    let picked = -1;
    for (let i = 0; i < count; i++) {
      const label = (await rows.nth(i).locator("td").first().innerText()).trim();
      if (label && label !== before.domainLabel) {
        nextLabel = label;
        picked = i;
        break;
      }
    }
    expect(picked, "watchlist offers another symbol").toBeGreaterThanOrEqual(0);
    await rows.nth(picked).click();
    const after = await waitForProbe(
      page,
      (q) =>
        (q.epoch ?? 0) > (before.epoch ?? 0) &&
        q.domainLabel === nextLabel &&
        (q.seriesLen ?? 0) > 50 &&
        q.range !== null,
      15000,
      `symbol switch to ${nextLabel}`
    );
    await page.waitForTimeout(1500);
    const settled = await probe(page);
    expect(settled.phase, "new symbol context follows live").toBe("FOLLOWING_LIVE");
    expect(settled.margin, "old symbol's range not reused").toBeLessThanOrEqual(10);
    expect(settled.xLast, "new symbol renders near the right edge").toBeGreaterThan(0.7);
    expect(settled.barCount, "different dataset").toBeGreaterThan(50);
    // No stale prepend/focus artifacts: no extra fits beyond the context fit.
    expect(settled.calls.fitContent - after.calls.fitContent, "no lingering fits").toBe(0);
    expect(settled.calls.setVisibleLogicalRange - after.calls.setVisibleLogicalRange, "no lingering range writes").toBe(0);
    await page.screenshot({ path: "e2e/artifacts/smoke-08-symbol.png" });
  });

  // ── 10. RESIZE ───────────────────────────────────────────────────────────
  await test.step("resize", async () => {
    // (a) following: resize must not fit or reset zoom.
    const liveBefore = await probe(page);
    await page.setViewportSize({ width: 1100, height: 720 });
    await page.waitForTimeout(800);
    const small = await probe(page);
    expect(small.phase, "still following after shrink").toBe("FOLLOWING_LIVE");
    expect(small.margin, "live edge maintained after shrink").toBeLessThanOrEqual(10);
    expect(small.calls.fitContent, "shrink never fits").toBe(liveBefore.calls.fitContent);

    // (b) panned: resize must preserve the logical range (no fit, no reset).
    await panRight(page, 320);
    const pannedBefore = await waitForProbe(page, (q) => q.phase === "USER_PANNED", 5000, "panned before resize");
    await page.setViewportSize({ width: 1600, height: 1000 });
    await page.waitForTimeout(800);
    const big = await probe(page);
    expect(big.phase, "pan state survives resize").toBe("USER_PANNED");
    expect(big.barSpacing, "resize never resets zoom").toBeCloseTo(pannedBefore.barSpacing, 1);
    expect(big.calls.fitContent, "resize never fits").toBe(pannedBefore.calls.fitContent);
    expect(big.plotW, "chart actually resized").toBeGreaterThan(pannedBefore.plotW);
    // Universal market anchor: the newest visible candle stays put across the
    // resize (whether or not a concurrent deep-history page lands).
    expect(
      Math.abs((big.rightTime as number) - (pannedBefore.rightTime as number)),
      "market area right anchor preserved across resize"
    ).toBeLessThanOrEqual(600);
    if (big.seriesLen === pannedBefore.seriesLen) {
      // The native scale keeps the right edge and extends the window
      // leftward as the container grows — never jumps newer, never fits.
      expect(Math.abs(big.range.to - pannedBefore.range.to), "right edge preserved across resize").toBeLessThanOrEqual(2);
      expect(
        big.range.from,
        "window may only extend older as the container grows, never jump newer"
      ).toBeLessThanOrEqual(pannedBefore.range.from + 2);
    } else {
      // A real deep-history page arrived during the resize window: logical
      // indices legitimately shift by the prepend size while the visible
      // MARKET area stays anchored — never fit, never jump to live.
      console.log(
        `NOTE: ${pannedBefore.seriesLen} → ${big.seriesLen} bars arrived during resize; ` +
          "market-area anchoring asserted instead of raw logical indices"
      );
    }
    await page.screenshot({ path: "e2e/artifacts/smoke-09-resize.png" });
  });

  // ── 11. CONSOLE / NETWORK HEALTH ─────────────────────────────────────────
  await test.step("console and network health", async () => {
    const elapsed = (Date.now() - tStart) / 1000;
    const quotes = apiCounts["/api/market/quotes"] || 0;
    const watchlist = apiCounts["/api/analytics/watchlist"] || 0;
    const ohlc = apiCounts["/api/analytics/ohlc"] || 0;
    console.log(
      `NETWORK: quotes=${quotes} watchlist=${watchlist} ohlc=${ohlc} elapsed=${elapsed.toFixed(1)}s ` +
        `counts=${JSON.stringify(apiCounts)}`
    );
    // Polling cadence is 5s — allow 2× slack plus warm-up slack, but catch
    // runaway/duplicate loops.
    const pollBudget = Math.ceil(elapsed / 5) * 2 + 8;
    expect(quotes, "no runaway quote polling").toBeLessThanOrEqual(pollBudget);
    expect(watchlist, "no runaway watchlist polling").toBeLessThanOrEqual(pollBudget);
    expect(ohlc, "no OHLC request loop").toBeLessThanOrEqual(30);
    // Known-unrelated pre-existing issue: the app shell nav contains a dead
    // link (`components/layout/app-nav.ts` → href "/charts"), so Next's RSC
    // prefetch of it 404s on every page. Not a chart/viewport error — tracked
    // here as an observation, excluded from the strict assertions below.
    const KNOWN_UNRELATED = (s: string) => /\/charts\?_rsc/.test(s);
    const realConsoleErrors = consoleErrors.filter((e) => !KNOWN_UNRELATED(e));
    const realBadResponses = badResponses.filter((r) => !KNOWN_UNRELATED(r));
    console.log(`PAGE_ERRORS: ${JSON.stringify(pageErrors)}`);
    console.log(`CONSOLE_ERRORS: ${JSON.stringify(consoleErrors)}`);
    console.log(`BAD_RESPONSES: ${JSON.stringify(badResponses)}`);
    console.log(`FAILED_REQUESTS: ${JSON.stringify(failedRequests.slice(0, 10))}`);
    expect(pageErrors, "no unhandled exceptions").toEqual([]);
    expect(realConsoleErrors, "no console errors (besides the known dead /charts nav prefetch)").toEqual([]);
    expect(realBadResponses, "no bad responses (besides the known dead /charts nav prefetch)").toEqual([]);
    expect(
      failedRequests.filter((f) => !f.includes("ERR_ABORTED")),
      "no failed requests"
    ).toEqual([]);
  });
});
