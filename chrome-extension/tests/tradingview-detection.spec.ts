/**
 * spec §22 — TradingView chart detection fixture tests.
 *
 * Serves a TradingView-like chart page (legend DOM) at a real
 * `https://www.tradingview.com/...` URL (so the content script's
 * `isTradingViewPage()` hostname gate passes), stubs the chrome.* messaging
 * API, injects the BUILT content script (`dist/content/tradingview.js`) and
 * asserts on the canonical ChartContext it reports via GET_CONTEXT.
 *
 * Run: `npm run build && npm run test`
 */
import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const CONTENT_SCRIPT_PATH = fileURLToPath(
  new URL("../dist/content/tradingview.js", import.meta.url)
);

/** In-memory chrome.* stub injected before the content script runs. */
const CHROME_STUB = `(() => {
  const store = {};
  const listeners = [];
  const sent = [];
  window.__algovaultFixture = { listeners, sent, getContextResponse: null };
  window.chrome = {
    runtime: {
      onMessage: { addListener: (fn) => listeners.push(fn), removeListener: () => {} },
      sendMessage: (msg, cb) => { sent.push(msg); if (typeof cb === "function") cb({ ok: true }); },
    },
    storage: {
      local: {
        get: (_keys, cb) => { if (typeof cb === "function") cb(store); },
        set: (obj, cb) => { Object.assign(store, obj); if (typeof cb === "function") cb(); },
        remove: (_keys, cb) => { if (typeof cb === "function") cb(); },
      },
    },
  };
})();`;

interface FixtureLegend {
  title: string;         // e.g. "OANDA:XAUUSD" inside [data-name=legend-source-title-value]
  timeframe: string;     // raw value inside [data-name=legend-timeframe-value]
  price: string;         // raw text inside [data-name=legend-last-value]
  indicators?: Array<{ title: string; value: string }>;
}

function legendPage(legend: FixtureLegend): string {
  const indicatorItems = (legend.indicators ?? [])
    .map(
      (ind) => `
      <div data-name="legend-source-item">
        <span data-name="legend-source-title">${ind.title}</span>
        <div data-name="legend-values-row">
          <span class="legendValuesRowTitle">${ind.title}</span>
          <span class="legendValuesRowValue">${ind.value}</span>
        </div>
      </div>`
    )
    .join("\n");

  return `<!DOCTYPE html>
<html>
<head><title>${legend.title} — TradingView</title></head>
<body>
  <div class="chart-container">
    <div data-name="legend">
      <div data-name="legend-source-item">
        <button data-name="legend-source-title">
          <span data-name="legend-source-title-value">${legend.title}</span>
        </button>
        <span data-name="legend-timeframe-value">${legend.timeframe}</span>
        <span data-name="legend-last-value">${legend.price}</span>
      </div>
${indicatorItems}
    </div>
    <div class="chart-toolbar">
      <button data-name="timeframe" aria-pressed="true">${legend.timeframe}</button>
    </div>
    <div class="quote-price">
      <span data-name="legend-value">${legend.price}</span>
    </div>
    <div class="chart-markup-table" style="height:400px"><div class="timeAxis">
      <span class="apply-overflow-tooltip">02:00</span>
      <span class="apply-overflow-tooltip">03:00</span>
    </div></div>
  </div>
  <!-- content script, injected as an ES module (the vite bundle keeps imports) -->
  <script type="module" src="./content/tradingview.js"></script>
</body>
</html>`;
}

async function detectContext(
  page: import("@playwright/test").Page,
  legend: FixtureLegend
): Promise<Record<string, unknown>> {
  const pageErrors: string[] = [];
  page.on("pageerror", (err) => pageErrors.push(String(err)));
  page.on("console", (msg) => {
    if (msg.type() === "error") pageErrors.push(`console.error: ${msg.text()}`);
  });

  await page.addInitScript(CHROME_STUB);
  await page.route("https://www.tradingview.com/**", async (route) => {
    const url = new URL(route.request().url());
    const pathname = url.pathname;
    const file = pathname.split("/").pop() ?? "";
    const mime = route.request().resourceType();
    // Serve the built content script and its shared chunks from dist/.
    if (pathname.endsWith("/content/tradingview.js")) {
      return route.fulfill({ status: 200, contentType: "application/javascript", path: CONTENT_SCRIPT_PATH });
    }
    if (pathname.endsWith(`/assets/${file}`) && /^\w[\w-]+\.js$/.test(file)) {
      const chunk = fileURLToPath(new URL(`../dist/assets/${file}`, import.meta.url));
      return route.fulfill({ status: 200, contentType: "application/javascript", path: chunk });
    }
    if (route.request().resourceType() === "document") {
      return route.fulfill({ status: 200, contentType: "text/html", body: legendPage(legend) });
    }
    // Everything else (favicon, etc.) — silence instead of aborting to avoid
    // console error noise that Playwright surfaces.
    return route.fulfill({ status: 204, contentType: "text/plain", body: "" });
  });

  await page.goto("https://www.tradingview.com/chart/", { waitUntil: "load" });

  // Give the scheduled detection passes (800ms) a chance to run.
  await page.waitForTimeout(1300);

  const result = await page.evaluate(() => {
    const win = window as unknown as Record<string, unknown>;
    const fixture = win.__algovaultFixture as
      | { listeners: Array<(...args: unknown[]) => void>; sent: Array<unknown> }
      | undefined;
    const handler = fixture?.listeners?.[0];
    if (typeof handler !== "function") {
      return {
        __diagnostics: {
          hasFixture: !!fixture,
          listenerCount: fixture?.listeners?.length ?? -1,
          sentCount: fixture?.sent?.length ?? -1,
          hostname: window.location.hostname,
          readyState: document.readyState,
        },
      } as Record<string, unknown>;
    }
    let response: { context?: Record<string, unknown> } | null = null;
    handler({ type: "GET_CONTEXT" }, {}, (resp: unknown) => {
      response = resp as { context?: Record<string, unknown> };
    });
    return response?.context ?? {};
  });

  if (result.__diagnostics && pageErrors.length === 0) {
    pageErrors.push(`diagnostics: ${JSON.stringify(result.__diagnostics)}`);
  }
  expect(pageErrors, "page errors during detection").toEqual([]);
  return result;
}

test.describe("TradingView legend detection (spec §22)", () => {
  test("detects OANDA:XAUUSD on H1 with price and indicators", async ({ page }) => {
    const ctx = await detectContext(page, {
      title: "OANDA:XAUUSD",
      timeframe: "1H",
      price: "2,657.34",
      indicators: [
        { title: "EMA 20", value: "2652.11" },
        { title: "RSI (14)", value: "62.45" },
      ],
    });

    expect(ctx.symbol).toBe("XAUUSD");
    expect(ctx.exchange).toBe("OANDA");
    expect(ctx.rawSymbol).toBe("OANDA:XAUUSD");
    expect(ctx.timeframe).toBe("H1");
    expect(ctx.rawTimeframe).toBe("1H");
    expect(ctx.price).toBe(2657.34);
    expect(ctx.isTradingView).toBe(true);
    expect(ctx.status).toBe("active");
    expect(ctx.source).toBe("tradingview");
    expect(ctx.market).toBe("metal");
    expect(ctx.marketSymbol).toBe("XAUUSD");
    expect(ctx.marketSync).toBe("matched");

    const indicators = ctx.indicators as Array<Record<string, unknown>>;
    expect(indicators.length).toBeGreaterThanOrEqual(2);
    const ema = indicators.find((i) => i.type === "ema");
    expect(ema).toBeTruthy();
    expect((ema as Record<string, unknown>).name).toBe("EMA 20");
    expect(ema?.available).toBe(true);
    expect(ema?.value).toBe(2652.11);
    const rsi = indicators.find((i) => i.type === "rsi");
    expect(rsi).toBeTruthy();
    expect(rsi?.available).toBe(true);
    expect(rsi?.value).toBe(62.45);
  });

  test("normalizes BINANCE:BTCUSDT to BTCUSD market data", async ({ page }) => {
    const ctx = await detectContext(page, {
      title: "BINANCE:BTCUSDT",
      timeframe: "240",
      price: "76,542.10",
    });

    expect(ctx.symbol).toBe("BTCUSDT");
    expect(ctx.exchange).toBe("BINANCE");
    expect(ctx.market).toBe("crypto");
    expect(ctx.marketSymbol).toBe("BTCUSD");
    expect(ctx.timeframe).toBe("H4");
  });

  test("resolves NASDAQ:AAPL equity with matched sync", async ({ page }) => {
    const ctx = await detectContext(page, {
      title: "NASDAQ:AAPL",
      timeframe: "D",
      price: "232.18",
    });

    expect(ctx.symbol).toBe("AAPL");
    expect(ctx.exchange).toBe("NASDAQ");
    expect(ctx.market).toBe("stock");
    expect(ctx.marketSymbol).toBe("AAPL");
    expect(ctx.marketSync).toBe("matched");
    expect(ctx.timeframe).toBe("D1");
  });

  test("broadcasts TRADINGVIEW_CONTEXT_UPDATE on detection", async ({ page }) => {
    await detectContext(page, {
      title: "FX_IDC:EURUSD",
      timeframe: "15",
      price: "1.08452",
    });

    const sent = await page.evaluate(() =>
      (window as unknown as { __algovaultFixture: { sent: Array<{ type?: string; payload?: Record<string, unknown> }> } })
        .__algovaultFixture.sent
        .filter((m) => m.type === "TRADINGVIEW_CONTEXT_UPDATE")
        .map((m) => m.payload)
    );
    expect(sent.length).toBeGreaterThan(0);
    expect(sent[0]?.symbol).toBe("EURUSD");
    expect(sent[0]?.exchange).toBe("FX_IDC");
    expect(sent[0]?.timeframe).toBe("M15");
  });
});