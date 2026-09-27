/**
 * Chart command engine — the automation half of the AI copilot.
 *
 * Executes chart-level commands requested by the side panel / popup:
 *   - set_symbol      → navigate the chart to a new symbol
 *   - set_timeframe   → switch the chart interval
 *   - get_state       → report the current chart identity for verification
 *
 * Strategies, in order of preference:
 *   1. `window.tvWidget` public API when present (setSymbol / setInterval).
 *   2. TradingView keyboard shortcuts — typing an interval applies it when the
 *      chart has focus (synthetic KeyboardEvents reach TV's own handlers).
 *   3. URL navigation (`/chart/?symbol=EXCHANGE:SYM`) — always reliable for
 *      symbol changes; costs a page reload, so only used as a fallback.
 *
 * Commands arrive as runtime messages from the service worker; results are
 * reported back through sendResponse and broadcast as CHART_COMMAND_RESULT.
 */
import { normalizeTradingViewTimeframe } from "@/utils/symbols";

const EXT_PREFIX = "[AlgoVault Commands]";

interface CommandPayload {
  command?: string;
  symbol?: string;
  timeframe?: string;
}

/* ── helpers ─────────────────────────────────────────────────────────── */

function tvInterval(raw: string | null | undefined): string | null {
  if (!raw) return null;
  // Canonical AlgoVault timeframes (M15, H1, …) map directly; TradingView-style
  // inputs ("1H", "60", "240") go through the normalizer as a fallback.
  const canonical: Record<string, string> = {
    M1: "1", M3: "3", M5: "5", M15: "15", M30: "30",
    H1: "60", H4: "240", D1: "D", W1: "W", MN1: "M",
  };
  const direct = canonical[raw.trim().toUpperCase()];
  if (direct) return direct;
  const tf = normalizeTradingViewTimeframe(raw);
  if (!tf) return null;
  return canonical[tf] ?? raw;
}

function tryWidgetApi(): { setSymbol?: (s: string, r: string, cb: () => void) => void; setInterval?: (r: string, cb: () => void) => void } | null {
  const win = window as unknown as Record<string, unknown>;
  const widget = win.tvWidget as { setSymbol?: unknown; setActiveSymbol?: unknown; chart?: () => { setInterval?: unknown } } | undefined;
  if (!widget || typeof widget !== "object") return null;
  const api: { setSymbol?: (s: string, r: string, cb: () => void) => void; setInterval?: (r: string, cb: () => void) => void } = {};
  if (typeof widget.setSymbol === "function") api.setSymbol = widget.setSymbol.bind(widget);
  const chart = typeof widget.chart === "function" ? widget.chart() : null;
  if (chart && typeof chart.setInterval === "function") api.setInterval = chart.setInterval.bind(chart);
  return api;
}

function dispatchTyping(text: string): void {
  const target = document.activeElement instanceof HTMLElement ? document.activeElement : document.body;
  for (const ch of text) {
    target.dispatchEvent(new KeyboardEvent("keydown", { key: ch, bubbles: true, cancelable: true }));
  }
  target.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", keyCode: 13, which: 13, bubbles: true, cancelable: true }));
}

/** Focus the chart canvas so TV global shortcuts apply. */
function focusChart(): void {
  const pane = document.querySelector<HTMLElement>(".chart-container, .chart-markup-table, [class*='chart-gui']");
  pane?.click();
}

/* ── commands ────────────────────────────────────────────────────────── */

async function runSetSymbol(symbol: string): Promise<string> {
  const raw = symbol.trim();
  if (!raw) throw new Error("Empty symbol");

  // 1) widget API
  const api = tryWidgetApi();
  if (api?.setSymbol) {
    const resolution = (document.querySelector<HTMLElement>("[data-name='legend-timeframe-value']")?.textContent?.trim()) || "60";
    api.setSymbol(raw, resolution, () => {});
    return `Symbol switched to ${raw} via chart API`;
  }

  // 2) symbol search hotkey (comma opens TV symbol search) then type + Enter
  focusChart();
  document.body.focus();
  dispatchTyping(",");
  await new Promise((r) => setTimeout(r, 600));
  const searchInput =
    document.querySelector<HTMLInputElement>("input[data-name='symbol-search-items-input']") ??
    document.querySelector<HTMLInputElement>("[data-dialog-name='symbol-search'] input") ??
    document.querySelector<HTMLInputElement>("input[placeholder*='ymbol'], input[placeholder*='icker']");
  if (searchInput) {
    searchInput.value = raw;
    searchInput.dispatchEvent(new Event("input", { bubbles: true }));
    await new Promise((r) => setTimeout(r, 500));
    // Pick the first result if present, else press Enter.
    const first = document.querySelector<HTMLElement>("[data-name='symbol-search-items-dialog'] [data-item-token], .symbol-search-dialog [role='listitem']");
    if (first) {
      first.click();
      return `Symbol switched to ${raw} via symbol search`;
    }
    dispatchTyping("\n");
    await new Promise((r) => setTimeout(r, 400));
    if (searchInput.isConnected) {
      // Dialog still open — fall through to URL navigation.
      searchInput.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    } else {
      return `Symbol switched to ${raw}`;
    }
  }

  // 3) URL navigation — always reliable, costs a reload. Preserve the current
  //    interval via the `interval` URL param so the timeframe survives reload.
  const url = new URL(window.location.href);
  url.searchParams.set("symbol", raw);
  const currentTf = document.querySelector<HTMLElement>("[data-qa-id='title-wrapper legend-source-interval']")?.textContent?.trim();
  if (currentTf) url.searchParams.set("interval", currentTf);
  window.location.assign(url.toString());
  return `Navigating to ${raw}…`;
}

async function runSetTimeframe(timeframe: string): Promise<string> {
  const interval = tvInterval(timeframe);
  if (!interval) throw new Error(`Unsupported timeframe: ${timeframe}`);

  // 1) widget API
  const api = tryWidgetApi();
  if (api?.setInterval) {
    api.setInterval(interval, () => {});
    return `Timeframe switched to ${interval} via chart API`;
  }

  // 2) TV interval typing: focus chart, type the interval, Enter.
  focusChart();
  dispatchTyping(interval);
  return `Timeframe switched to ${interval}`;
}

function runGetState(): Record<string, unknown> {
  const series = document.querySelector<HTMLElement>("[data-qa-id='legend-series-item']");
  const symbolEl =
    document.querySelector<HTMLElement>("[data-qa-id='details-element symbol']") ??
    document.querySelector<HTMLElement>("[data-name='legend-source-title-value']");
  const intervalEl =
    series?.querySelector<HTMLElement>("[data-qa-id='title-wrapper legend-source-interval']") ??
    document.querySelector<HTMLElement>("[data-name='legend-timeframe-value']");
  const exchangeEl =
    series?.querySelector<HTMLElement>("[data-qa-id='title-wrapper legend-source-exchange']") ??
    null;
  return {
    symbol: symbolEl?.textContent?.trim() ?? null,
    exchange: exchangeEl?.textContent?.trim() ?? null,
    timeframe: intervalEl?.textContent?.trim() ?? null,
    url: window.location.href,
  };
}

/* ── message plumbing ───────────────────────────────────────────────── */

function broadcastResult(command: string, ok: boolean, message: string): void {
  try {
    chrome.runtime.sendMessage({ type: "CHART_COMMAND_RESULT", payload: { command, ok, message, at: Date.now() } });
  } catch { /* SW asleep */ }
}

async function execute(payload: CommandPayload): Promise<{ ok: boolean; message: string }> {
  switch (payload.command) {
    case "set_symbol": {
      const message = await runSetSymbol(payload.symbol ?? "");
      return { ok: true, message };
    }
    case "set_timeframe": {
      const message = await runSetTimeframe(payload.timeframe ?? "");
      return { ok: true, message };
    }
    case "get_state": {
      const state = runGetState();
      return { ok: true, message: JSON.stringify(state) };
    }
    default:
      return { ok: false, message: `Unknown command: ${payload.command}` };
  }
}

chrome.runtime.onMessage.addListener((message: { type?: string; payload?: CommandPayload }, _sender, sendResponse) => {
  if (message?.type !== "RUN_CHART_COMMAND") return false;
  execute(message.payload ?? {})
    .then((result) => {
      broadcastResult(message.payload?.command ?? "?", result.ok, result.message);
      sendResponse(result);
    })
    .catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      broadcastResult(message.payload?.command ?? "?", false, msg);
      sendResponse({ ok: false, message: msg });
    });
  return true; // async response
});

console.log(`${EXT_PREFIX} ready`);
export {};
