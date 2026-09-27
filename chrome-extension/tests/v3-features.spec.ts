/**
 * spec §22 — v3 feature tests: chart commands + smart drawings.
 *
 * Follows the fixture approach of tradingview-detection.spec.ts: serve a
 * TradingView-like page at a real tradingview.com URL, stub chrome.*, inject
 * the BUILT content scripts from dist/ and drive them via their message
 * listeners.
 *
 *   chart-commands.js — RUN_CHART_COMMAND { get_state | set_timeframe }
 *   chart-drawings.js — SET_SMART_DRAWINGS renders SVG on the chart pane
 *
 * Run: `npm run build && npx playwright test tests/v3-features.spec.ts`
 */
import { test, expect } from "@playwright/test";
import { fileURLToPath } from "node:url";

const CHART_COMMANDS_PATH = fileURLToPath(new URL("../dist/content/chart-commands.js", import.meta.url));
const CHART_DRAWINGS_PATH = fileURLToPath(new URL("../dist/content/chart-drawings.js", import.meta.url));

/** In-memory chrome.* stub capturing messages, with per-message handlers. */
const CHROME_STUB = `(() => {
  const listeners = [];
  window.__algovaultFixture = { listeners, sent: [], responses: {} };
  window.chrome = {
    runtime: {
      onMessage: {
        addListener: (fn) => listeners.push(fn),
        removeListener: () => {},
      },
      sendMessage: (msg, cb) => {
        window.__algovaultFixture.sent.push(msg);
        if (typeof cb === "function") cb({ ok: true });
      },
      lastError: null,
    },
    storage: {
      local: {
        get: (_keys, cb) => { if (typeof cb === "function") cb({}); },
        set: (_obj, cb) => { if (typeof cb === "function") cb(); },
        remove: (_keys, cb) => { if (typeof cb === "function") cb(); },
      },
    },
  };
})();`;

function chartPage(): string {
  return `<!DOCTYPE html>
<html>
<head><title>XAUUSD — TradingView</title></head>
<body>
  <div class="chart-container" style="position:relative;height:400px">
    <div class="chart-markup-table">
      <div data-name="legend">
        <div data-name="legend-source-item">
          <span data-name="legend-source-title-value">OANDA:XAUUSD</span>
          <span data-name="legend-timeframe-value">60</span>
        </div>
      </div>
      <div class="timeAxis"><span class="apply-overflow-tooltip">02:00</span></div>
    </div>
  </div>
  <script type="module" src="./content/chart-commands.js"></script>
  <script type="module" src="./content/chart-drawings.js"></script>
</body>
</html>`;
}

async function openFixture(page: import("@playwright/test").Page): Promise<void> {
  const pageErrors: string[] = [];
  page.on("pageerror", (err) => pageErrors.push(String(err)));
  page.on("console", (msg) => {
    if (msg.type() === "error") pageErrors.push(`console.error: ${msg.text()}`);
  });
  page.__pageErrors = pageErrors;

  await page.addInitScript(CHROME_STUB);
  await page.route("https://www.tradingview.com/**", async (route) => {
    const url = new URL(route.request().url());
    const pathname = url.pathname;
    if (pathname.endsWith("/content/chart-commands.js")) {
      return route.fulfill({ status: 200, contentType: "application/javascript", path: CHART_COMMANDS_PATH });
    }
    if (pathname.endsWith("/content/chart-drawings.js")) {
      return route.fulfill({ status: 200, contentType: "application/javascript", path: CHART_DRAWINGS_PATH });
    }
    if (route.request().resourceType() === "document") {
      return route.fulfill({ status: 200, contentType: "text/html", body: chartPage() });
    }
    return route.fulfill({ status: 204, contentType: "text/plain", body: "" });
  });

  await page.goto("https://www.tradingview.com/chart/", { waitUntil: "load" });
  await page.waitForTimeout(300);
}

declare module "@playwright/test" {
  interface Page {
    __pageErrors?: string[];
  }
}

async function dispatch(
  page: import("@playwright/test").Page,
  msg: Record<string, unknown>
): Promise<Record<string, unknown> | null> {
  return page.evaluate((payload) => {
    const fixture = (window as unknown as { __algovaultFixture?: { listeners: Array<(...args: unknown[]) => void> } }).__algovaultFixture;
    const handlers = fixture?.listeners ?? [];
    return new Promise((resolve) => {
      let resolved = false;
      let pending = 0;
      const results: Array<Record<string, unknown> | undefined> = [];
      const finish = () => {
        if (resolved) return;
        resolved = true;
        // Prefer the first defined response — a listener that handled the
        // message answers; uninterested listeners reply undefined.
        resolve(results.find((r) => r !== undefined) ?? null);
      };
      for (const handler of handlers) {
        pending++;
        try {
          handler(payload, {}, (resp: Record<string, unknown>) => {
            results.push(resp);
            if (--pending <= 0) finish();
          });
        } catch {
          if (--pending <= 0) finish();
        }
      }
      setTimeout(finish, 3000);
    });
  }, msg);
}

test.describe("v3 chart commands", () => {
  test("get_state reports the current chart identity", async ({ page }) => {
    await openFixture(page);
    const resp = (await dispatch(page, { type: "RUN_CHART_COMMAND", payload: { command: "get_state" } })) as { ok?: boolean; message?: string } | null;
    expect(resp?.ok).toBe(true);
    const state = JSON.parse(resp?.message ?? "{}") as { symbol?: string };
    // Raw exchange-qualified symbol, matching TradingView's own legend text.
    expect(state.symbol).toBe("OANDA:XAUUSD");
  });

  test("set_timeframe via interval typing applies and resolves", async ({ page }) => {
    await openFixture(page);
    const resp = (await dispatch(page, { type: "RUN_CHART_COMMAND", payload: { command: "set_timeframe", timeframe: "M15" } })) as { ok?: boolean; message?: string } | null;
    expect(resp?.ok).toBe(true);
    expect(resp?.message).toContain("15");
  });

  test("unknown command reports failure", async ({ page }) => {
    await openFixture(page);
    const resp = (await dispatch(page, { type: "RUN_CHART_COMMAND", payload: { command: "explode" } })) as { ok?: boolean; message?: string } | null;
    expect(resp?.ok).toBe(false);
    expect(resp?.message).toContain("Unknown");
  });
});

test.describe("v3 smart drawings", () => {
  test("SET_SMART_DRAWINGS renders SVG levels on the chart pane", async ({ page }) => {
    await openFixture(page);

    const resp = (await dispatch(page, {
      type: "SET_SMART_DRAWINGS",
      payload: {
        id: "sd-test",
        symbol: "XAUUSD",
        timeframe: "H1",
        drawings: [
          { id: "d1", kind: "hline", label: "Resistance", tone: "resistance", price: 2650 },
          { id: "d2", kind: "hzone", label: "Demand", tone: "support", price: 2600, price2: 2580 },
          { id: "d3", kind: "label", label: "Bias: Long", tone: "info", price: 2620, x: 0.05 },
        ],
        createdAt: Date.now(),
      },
    })) as { ok?: boolean } | null;
    expect(resp?.ok).toBe(true);

    await page.waitForTimeout(400);

    const rendered = await page.evaluate(() => {
      const host = document.getElementById("algovault-drawings-host");
      const svg = host?.querySelector("svg");
      return {
        hostPresent: !!host,
        svgChildren: svg?.children.length ?? 0,
        text: svg?.textContent ?? "",
      };
    });
    expect(rendered.hostPresent).toBe(true);
    expect(rendered.svgChildren).toBeGreaterThan(0);
    expect(rendered.text).toContain("Resistance");
    expect(rendered.text).toContain("Demand");
  });

  test("CLEAR_SMART_DRAWINGS removes rendered SVG", async ({ page }) => {
    await openFixture(page);
    await dispatch(page, {
      type: "SET_SMART_DRAWINGS",
      payload: {
        id: "sd-test2",
        symbol: "XAUUSD",
        timeframe: "H1",
        drawings: [{ id: "d1", kind: "hline", label: "Support", tone: "support", price: 2600 }],
        createdAt: Date.now(),
      },
    });
    await page.waitForTimeout(300);

    await dispatch(page, { type: "CLEAR_SMART_DRAWINGS" });
    await page.waitForTimeout(200);

    const rendered = await page.evaluate(() => {
      const svg = document.getElementById("algovault-drawings-host")?.querySelector("svg");
      return svg?.children.length ?? -1;
    });
    expect(rendered).toBe(0);
  });
});
