/**
 * TradingView chart detection engine.
 *
 * Reads the active chart via legitimate browser mechanisms only:
 *   1. `window.tvWidget` public API (symbol / interval / visible range / studies)
 *   2. The chart legend DOM (`[data-name="legend-source-item"]` …) for the
 *      symbol, exchange, timeframe, last price and indicator names + values
 *   3. URL / document title as fallbacks on non-chart TradingView pages
 *
 * Crucially it does NOT invent indicator values, does not read canvas pixels,
 * and does not bypass TradingView auth or private APIs. Anything we cannot read
 * is marked `available: false` / `source: "unavailable"` so downstream
 * enrichment can compute it from market data instead.
 *
 * Every detected change is emitted as a full canonical `ChartContext` through
 * `TRADINGVIEW_CONTEXT_UPDATE` to the service worker, popup and overlay. A
 * single debounced MutationObserver (no duplicate polling + observer) keeps the
 * live context in sync with symbol / timeframe / navigation changes.
 */
import type { ChartContext, DetectedDrawing, DetectedIndicator, VisibleRange } from "@/types";
import { createEmptyChartContext } from "@/types/chart-context";
import { setCachedContext } from "@/storage/storage";
import {
  normalizeTradingViewTimeframe,
  parseSymbol,
  resolveMarketSymbol,
} from "@/utils/symbols";

const EXT_PREFIX = "[AlgoVault Extension]";

let currentContext: ChartContext = createEmptyChartContext();
let observer: MutationObserver | null = null;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let navigationId = 0;
let lastBroadcastAt = 0;
let lastIdentityKey = "";

/* ── helpers ─────────────────────────────────────────────────────────── */

function isTradingViewPage(): boolean {
  return window.location.hostname.includes("tradingview.com");
}

function identityKey(ctx: ChartContext): string {
  return `${ctx.exchange ?? ""}|${ctx.symbol ?? ""}|${ctx.timeframe ?? ""}`;
}

function queryAll(selector: string): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>(selector));
}

function cleanNumberText(text: string | null | undefined): number | null {
  if (!text) return null;
  let cleaned = text.replace(/[^0-9.,\-]/g, "");
  if (!cleaned) return null;
  const hasComma = cleaned.includes(",");
  const hasDot = cleaned.includes(".");
  if (hasComma && hasDot) {
    // The separator that appears LAST is the decimal separator (en "2,657.34"
    // vs eu "2.657,34"); the other one is a thousands separator.
    if (cleaned.lastIndexOf(",") > cleaned.lastIndexOf(".")) {
      cleaned = cleaned.replace(/\./g, "").replace(",", ".");
    } else {
      cleaned = cleaned.replace(/,/g, "");
    }
  } else if (hasComma) {
    cleaned = cleaned.replace(",", ".");
  }
  const value = parseFloat(cleaned);
  return Number.isFinite(value) && value > 0 ? value : null;
}

function parseIndicatorName(title: string): {
  type: string;
  name: string;
  parameters: Array<{ key: string; value: string | number }>;
} | null {
  const trimmed = title.trim();
  if (!trimmed) return null;

  const known: Array<{ re: RegExp; type: string; key: string }> = [
    { re: /^EMA/i, type: "ema", key: "length" },
    { re: /^SMA/i, type: "sma", key: "length" },
    { re: /^RSI/i, type: "rsi", key: "length" },
    { re: /^MACD/i, type: "macd", key: "length" },
    { re: /^VWAP/i, type: "vwap", key: "anchored" },
    { re: /^Vol(ume)?\b/i, type: "volume", key: "length" },
    { re: /^Supertrend/i, type: "supertrend", key: "length" },
    { re: /^Bollinger/i, type: "bollinger", key: "length" },
    { re: /^ATR/i, type: "atr", key: "length" },
    { re: /^Stoch/i, type: "stochastic", key: "length" },
    { re: /^Alligator/i, type: "alligator", key: "length" },
    { re: /^Ichimoku/i, type: "ichimoku", key: "length" },
  ];

  for (const { re, type, key } of known) {
    if (re.test(trimmed)) {
      const parameters: Array<{ key: string; value: string | number }> = [];
      const numMatch = trimmed.match(/(\d+(?:\.\d+)?)/);
      if (numMatch) parameters.push({ key, value: Number(numMatch[1]) });
      return { type, name: trimmed, parameters };
    }
  }
  return null;
}

/* ── widget API (legitimate public client API) ───────────────────────── */

interface WidgetLike {
  getSymbol?: () => string;
  getInterval?: () => string;
  symbol?: () => string;
  interval?: () => string;
  activeSymbol?: () => string;
  activeInterval?: () => string;
  chart?: () => ChartApiLike;
}

interface ChartApiLike {
  getVisibleRange?: () => { from?: number; to?: number } | null;
  getAllStudies?: () => Array<Record<string, unknown>>;
  getAllShapes?: () => Array<Record<string, unknown>>;
}

function tryGetWidgetAPI(): {
  symbol: string | null;
  interval: string | null;
  visibleRange: { from: number | null; to: number | null } | null;
  studyNames: string[];
  drawingCount: number | null;
} {
  const win = window as unknown as Record<string, unknown>;
  const widget = (win.tvWidget ?? win.tradingViewWidget) as WidgetLike | undefined;

  if (!widget || typeof widget !== "object") {
    return { symbol: null, interval: null, visibleRange: null, studyNames: [], drawingCount: null };
  }

  let symbol: string | null = null;
  if (typeof widget.getSymbol === "function") symbol = widget.getSymbol();
  else if (typeof widget.symbol === "function") symbol = widget.symbol();
  else if (typeof widget.activeSymbol === "function") symbol = widget.activeSymbol();

  let interval: string | null = null;
  if (typeof widget.getInterval === "function") interval = widget.getInterval();
  else if (typeof widget.interval === "function") interval = widget.interval();
  else if (typeof widget.activeInterval === "function") interval = widget.activeInterval();

  let visibleRange: { from: number | null; to: number | null } | null = null;
  let studyNames: string[] = [];
  let drawingCount: number | null = null;

  try {
    const chart = typeof widget.chart === "function" ? widget.chart() : undefined;
    if (chart) {
      if (typeof chart.getVisibleRange === "function") {
        const range = chart.getVisibleRange();
        if (range && typeof range === "object") {
          visibleRange = {
            from: typeof range.from === "number" ? range.from : null,
            to: typeof range.to === "number" ? range.to : null,
          };
        }
      }
      if (typeof chart.getAllStudies === "function") {
        const studies = chart.getAllStudies();
        if (Array.isArray(studies)) {
          studyNames = studies
            .map((s) => s.name)
            .filter((n): n is string => typeof n === "string" && n.length > 0);
        }
      }
      if (typeof chart.getAllShapes === "function") {
        const shapes = chart.getAllShapes();
        if (Array.isArray(shapes)) drawingCount = shapes.length;
      }
    }
  } catch {
    /* public API methods may be guarded — never fail detection over this */
  }

  return { symbol, interval, visibleRange, studyNames, drawingCount };
}

/* ── legend / DOM detection ──────────────────────────────────────────── */

interface LegendDetection {
  symbol: string | null;
  exchange: string | null;
  timeframe: string | null;
  price: number | null;
  priceSource: ChartContext["priceSource"];
  indicators: DetectedIndicator[];
}

function detectFromLegend(): LegendDetection {
  const items = queryAll("[data-name='legend-source-item']");
  const indicators: DetectedIndicator[] = [];

  let symbol: string | null = null;
  let exchange: string | null = null;
  let timeframe: string | null = null;
  let price: number | null = null;
  let priceSource: ChartContext["priceSource"] = "unavailable";

  const collectIndicatorItem = (item: HTMLElement): void => {
    const titleEl = item.querySelector<HTMLElement>(
      "[data-name='legend-source-title'], [data-name='legend-source-title-value']"
    );
    const title = titleEl?.textContent?.trim() || "";
    if (!title) return;

    const parsed = parseIndicatorName(title);
    if (!parsed) return;

    // Determine the pane: separate-pane indicators (RSI, MACD, Volume) render
    // the same way in the legend; overlays (EMA, BB, Supertrend, VWAP).
    const overlayTypes = new Set(["ema", "sma", "vwap", "bollinger", "supertrend", "atr", "alligator", "ichimoku"]);
    const pane: DetectedIndicator["pane"] = overlayTypes.has(parsed.type) ? "overlay" : "separate";

    const values: DetectedIndicator["values"] = [];
    const valueRows = queryAllIn(item, "[data-name='legend-values-row']");
    for (const row of valueRows) {
      const label = row.querySelector<HTMLElement>("[class*='legendValuesRowTitle']")?.textContent?.trim() || null;
      const rawValue = row.querySelector<HTMLElement>("[class*='legendValuesRowValue']")?.textContent?.trim() ?? null;
      const numeric = cleanNumberText(rawValue);
      values.push({ label, value: numeric ?? rawValue, available: numeric !== null });
    }

    // Fall back to the bare legend value element when no expanded rows exist.
    let value: number | null = null;
    if (values.length > 0) value = values[values.length - 1].available ? (values[values.length - 1].value as number) : null;
    if (value === null) {
      const lastValueEl = item.querySelector<HTMLElement>("[data-name='legend-value']");
      value = cleanNumberText(lastValueEl?.textContent);
    }

    indicators.push({
      id: `ind_${indicators.length}`,
      name: parsed.name,
      type: parsed.type,
      parameters: parsed.parameters,
      pane,
      source: "tradingview-legend",
      value,
      displayValue: value != null ? String(value) : values.length > 0 ? String(values[values.length - 1].value ?? "") : null,
      available: value !== null,
      values,
      timeframe: null,
    });
    item.dataset.algovaultIndicator = "true";
  };

  let mainItem: HTMLElement | null = null;
  for (const item of items) {
    if (item.dataset.algovaultIndicator === "true") continue;

    const symbolEl = item.querySelector<HTMLElement>("[data-name='legend-source-title-value']");
    const titleEl = item.querySelector<HTMLElement>("[data-name='legend-source-title']");
    const title = titleEl?.textContent?.trim() || "";
    const isIndicator = parseIndicatorName(title) !== null;

    if (isIndicator) {
      collectIndicatorItem(item);
      continue;
    }

    if (symbolEl?.textContent) {
      if (!mainItem) mainItem = item;
      if (!symbol && symbolEl.textContent.trim()) {
        // Keep the RAW identifier ("OANDA:XAUUSD"); the detection pipeline
        // re-parses it into ticker + exchange so rawSymbol is preserved.
        symbol = symbolEl.textContent.trim();
        exchange = parseSymbol(symbol)?.exchange ?? null;
      }
    }
  }

  const main = mainItem ?? items[0] ?? null;
  if (main) {
    const tfEl = main.querySelector<HTMLElement>("[data-name='legend-timeframe-value']");
    if (tfEl?.textContent) timeframe = tfEl.textContent.trim();
    const priceEl = main.querySelector<HTMLElement>("[data-name='legend-last-value']");
    if (priceEl?.textContent) {
      const parsedPrice = cleanNumberText(priceEl.textContent);
      if (parsedPrice !== null) {
        price = parsedPrice;
        priceSource = "tradingview-legend";
      }
    }
    if (main.dataset.algovaultIndicator) {
      /* item re-used as indicator — skip */
    }
  }

  return { symbol, exchange, timeframe, price, priceSource, indicators };
}

function queryAllIn(root: HTMLElement, selector: string): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(selector));
}

/**
 * Extract the leading numeric token from an element's raw text.
 *
 * The real TradingView header price element reads like
 * `"4,378.385RUSD+36.545+0.84%"` (value, currency mark, change, change %) —
 * only the FIRST token, the last price, is ours to take.
 */
function extractLeadingNumber(text: string | null | undefined): string | null {
  if (!text) return null;
  const match = text.trim().match(/^\s*[\d][\d.,]*/);
  return match ? match[0] : null;
}

/**
 * Real TradingView chart legend (stable `data-qa-id` hooks).
 *
 * Production TradingView CSS classes are hashed per build
 * (`legend-quatTGAC`, …), but the DOM keeps stable QA attributes:
 *
 *   main series   → `[data-qa-id="legend-series-item"]`
 *   interval      → `title-wrapper legend-source-interval`  ("1D", "15", "240")
 *   exchange      → `title-wrapper legend-source-exchange`  ("OANDA")
 *   header symbol → `[data-qa-id="details-element symbol"]` ("XAUUSD")
 *   header price  → `[data-qa-id="details-element price"]`  ("4,378.385RUSD+…")
 *   indicator row → `[data-qa-id="legend-source-item"]` (separate from series)
 *   indicator val → `[data-test-id-value-title="…"]` + its value div ("698.3 K")
 *
 * The synthetic detection tests use the legacy `data-name="…"` legend shape
 * (see `detectFromLegend`); both are merged by `detectFromDom`.
 */
function detectRealLegendFromDom(): LegendDetection {
  const indicators: DetectedIndicator[] = [];
  let symbol: string | null = null;
  let exchange: string | null = null;
  let timeframe: string | null = null;
  let price: number | null = null;
  let priceSource: ChartContext["priceSource"] = "unavailable";

  const seriesItem = document.querySelector<HTMLElement>(
    "[data-qa-id='legend-series-item']"
  );
  const headerSymbol = document.querySelector<HTMLElement>(
    "[data-qa-id='details-element symbol']"
  );
  const headerPrice = document.querySelector<HTMLElement>(
    "[data-qa-id='details-element price']"
  );

  if (seriesItem) {
    const intervalEl = seriesItem.querySelector<HTMLElement>(
      "[data-qa-id='title-wrapper legend-source-interval']"
    );
    if (intervalEl?.textContent?.trim()) {
      timeframe = intervalEl.textContent.trim();
    }

    const exchangeEl = seriesItem.querySelector<HTMLElement>(
      "[data-qa-id='title-wrapper legend-source-exchange']"
    );
    if (exchangeEl?.textContent?.trim()) {
      exchange = exchangeEl.textContent.trim();
    }
  }

  if (headerSymbol?.textContent?.trim()) {
    symbol = headerSymbol.textContent.trim();
  }

  if (headerPrice?.textContent) {
    const leading = extractLeadingNumber(headerPrice.textContent);
    const parsedPrice = cleanNumberText(leading);
    if (parsedPrice !== null) {
      price = parsedPrice;
      priceSource = "tradingview-legend";
    }
  }

  // Indicators / studies: each renders its own `legend-source-item` row.
  const studyItems = queryAll("[data-qa-id='legend-source-item']");
  for (const item of studyItems) {
    const titleEl = item.querySelector<HTMLElement>(
      "[data-qa-id='title-wrapper legend-source-title']"
    );
    const title = titleEl?.textContent?.trim() || "";
    const parsed = parseIndicatorName(title);
    if (!parsed) continue;

    const overlayTypes = new Set(["ema", "sma", "vwap", "bollinger", "supertrend", "atr", "alligator", "ichimoku"]);
    const pane: DetectedIndicator["pane"] = overlayTypes.has(parsed.type) ? "overlay" : "separate";

    const values: DetectedIndicator["values"] = [];
    const valueCells = queryAllIn(item, "[data-test-id-value-title]");
    let bestValue: number | null = null;
    let bestRaw: string | null = null;

    for (const cell of valueCells) {
      const label = cell.getAttribute("data-test-id-value-title");
      const valueEl = cell.querySelector<HTMLElement>("[class*='valueValue']");
      const raw = valueEl?.textContent?.trim() ?? cell.textContent?.trim() ?? null;
      const unavailable = raw === null || raw === "" || raw === "∅";
      const numeric = cleanNumberText(raw);
      values.push({
        label,
        value: unavailable ? null : (numeric ?? raw),
        available: !unavailable && numeric !== null,
      });
      if (numeric !== null) {
        bestValue = numeric;
        bestRaw = raw;
      }
    }

    indicators.push({
      id: `ind_${indicators.length}`,
      name: parsed.name,
      type: parsed.type,
      parameters: parsed.parameters,
      pane,
      source: "tradingview-legend",
      value: bestValue,
      displayValue: bestValue != null ? String(bestValue) : bestRaw,
      available: bestValue !== null,
      values,
      timeframe: null,
    });
  }

  return { symbol, exchange, timeframe, price, priceSource, indicators };
}

/**
 * Merge the real-page legend and the legacy `data-name` legend.
 *
 * Real TradingView wagons the `data-qa-id` hooks; the fixture/synthetic pages
 * (and older TV builds) use `data-name` selectors. Whichever yields the most
 * data wins, with missing fields filled from the other.
 */
function detectFromDom(): LegendDetection {
  const real = detectRealLegendFromDom();
  const classic = detectFromLegend();

  const realHasContent =
    real.symbol !== null ||
    real.exchange !== null ||
    real.timeframe !== null ||
    real.price !== null ||
    real.indicators.length > 0;

  if (!realHasContent) return classic;

  return {
    symbol: real.symbol ?? classic.symbol,
    exchange: real.exchange ?? classic.exchange,
    timeframe: real.timeframe ?? classic.timeframe,
    price: real.price ?? classic.price,
    priceSource:
      real.priceSource !== "unavailable" ? real.priceSource : classic.priceSource,
    indicators: real.indicators.length > 0 ? real.indicators : classic.indicators,
  };
}

function detectSymbolFromUrl(): { symbol: string | null; exchange: string | null } {
  const url = window.location.href;
  const patterns = [/\/symbol\/([A-Za-z0-9%._:-]+)/, /\/ticker\/([A-Za-z0-9%._:-]+)/, /\/symbols\/([A-Za-z0-9%._:-]+)/];
  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) {
      const raw = decodeURIComponent(match[1]);
      const parsed = parseSymbol(raw);
      if (parsed) return { symbol: parsed.ticker, exchange: parsed.exchange };
    }
  }
  const querySymbol = new URLSearchParams(window.location.search).get("symbol");
  if (querySymbol) {
    const parsed = parseSymbol(querySymbol);
    if (parsed?.ticker) return { symbol: parsed.ticker, exchange: parsed.exchange };
  }
  return { symbol: null, exchange: null };
}

function detectSymbolFromTitle(): { symbol: string | null; exchange: string | null } {
  const title = document.title;
  if (!title || title === "TradingView") return { symbol: null, exchange: null };
  const working = title
    .replace(/\s*[—–-]\s*TradingView$/, "")
    .replace(/\s*[·•]\s*TradingView$/, "")
    .trim();
  const token = working.split(/[\s·•—–/]+/).find((part) => {
    const t = part.trim().toUpperCase().replace(/[^A-Z0-9:]/g, "");
    return t.length >= 2 && t.length <= 16;
  });
  if (!token) return { symbol: null, exchange: null };
  const parsed = parseSymbol(token);
  return parsed ? { symbol: parsed.ticker, exchange: parsed.exchange } : { symbol: null, exchange: null };
}

function detectTimeframeFromToolbar(): string | null {
  const selectors = [
    "[data-name='legend-timeframe-value']",
    "[data-qa-id='title-wrapper legend-source-interval']",
    "button[data-name='timeframe'][aria-pressed='true']",
    ".chart-toolbar .apply-overflow-tooltip",
  ];
  for (const selector of selectors) {
    const el = document.querySelector<HTMLElement>(selector);
    if (el?.textContent) {
      const normalized = normalizeTradingViewTimeframe(el.textContent.trim());
      if (normalized) return normalized;
    }
  }
  return null;
}

function detectVisibleRange(widgetRange: { from: number | null; to: number | null } | null): VisibleRange {
  if (widgetRange && (widgetRange.from !== null || widgetRange.to !== null)) {
    return {
      from: widgetRange.from,
      to: widgetRange.to,
      fromLabel: widgetRange.from != null ? new Date(widgetRange.from).toLocaleString() : null,
      toLabel: widgetRange.to != null ? new Date(widgetRange.to).toLocaleString() : null,
      bars: widgetRange.from != null && widgetRange.to != null ? null : null,
      source: "tradingview-widget",
    };
  }

  // DOM fallback: first and last `apply-overflow-tooltip` labels on the time axis.
  const labels = queryAll(".chart-markup-table .timeAxis .apply-overflow-tooltip");
  const firstText = labels[0]?.textContent?.trim() ?? null;
  const lastText = labels[labels.length - 1]?.textContent?.trim() ?? null;
  const parseLabel = (label: string | null): number | null => {
    if (!label) return null;
    // Try explicit timestamp labels (ISO) first.
    const numeric = Date.parse(label);
    if (!Number.isNaN(numeric)) return numeric;
    // Time-of-day labels ("08:00") have no date — leave bars unknown.
    return null;
  };
  return {
    from: parseLabel(firstText),
    to: parseLabel(lastText),
    fromLabel: firstText,
    toLabel: lastText,
    bars: null,
    source: "tradingview-time-axis",
  };
}

function detectDrawings(widgetCount: number | null): DetectedDrawing[] {
  if (widgetCount !== null) {
    return [
      {
        id: "drawings",
        type: widgetCount > 0 ? "drawing" : "none",
        label: widgetCount > 0 ? `${widgetCount} drawing(s)` : "No drawings",
        price: null,
        source: "tradingview-widget",
        available: widgetCount > 0,
      },
    ];
  }
  // TradingView exposes drawing count only via canvas / proprietary state,
  // which we do not scrape. Mark genuinely unavailable so enrichment can
  // fall back to market-computed structure instead.
  return [
    {
      id: "drawings",
      type: "unknown",
      label: null,
      price: null,
      source: "unavailable",
      available: false,
    },
  ];
}

/* ── detection pipeline ──────────────────────────────────────────────── */

function detectFullContext(): ChartContext {
  const widget = tryGetWidgetAPI();
  const legend = detectFromDom();
  const urlResult = detectSymbolFromUrl();
  const titleResult = detectSymbolFromTitle();

  // ── symbol / raw symbol ─────────────────────────────────────────────
  const rawSymbol = widget.symbol || legend.symbol || urlResult.symbol || titleResult.symbol || null;
  const parsedRaw = parseSymbol(rawSymbol);
  const symbol = parsedRaw?.ticker ?? null;

  // ── exchange ────────────────────────────────────────────────────────
  const exchange =
    legend.exchange ||
    parsedRaw?.exchange ||
    urlResult.exchange ||
    (widget.symbol ? parseSymbol(widget.symbol)?.exchange ?? null : null) ||
    null;

  // ── timeframe ───────────────────────────────────────────────────────
  const rawTimeframe = legend.timeframe || widget.interval || detectTimeframeFromToolbar() || null;
  const timeframe = normalizeTradingViewTimeframe(rawTimeframe);

  // ── price ───────────────────────────────────────────────────────────
  let price = legend.price;
  let priceSource: ChartContext["priceSource"] = legend.priceSource;
  if (price === null) {
    const headerPriceEl = document.querySelector<HTMLElement>(
      "[data-qa-id='details-element price']"
    );
    if (headerPriceEl?.textContent) {
      const leading = extractLeadingNumber(headerPriceEl.textContent);
      const value = cleanNumberText(leading);
      if (value !== null) {
        price = value;
        priceSource = "tradingview-legend";
      }
    }
  }
  if (price === null) {
    const priceCandidates = [
      "[data-name='legend-source-item'] [data-name='legend-value']",
      "[data-name='legend-last-value']",
      "[class*='last-price']",
      "[data-name*='last-price']",
    ];
    for (const selector of priceCandidates) {
      const el = document.querySelector<HTMLElement>(selector);
      if (el?.textContent) {
        const value = cleanNumberText(el.textContent);
        if (value !== null) {
          price = value;
          priceSource = "tradingview-legend";
          break;
        }
      }
    }
  }

  // ── market resolution (validated against AlgoVault market data) ─────
  const resolved = resolveMarketSymbol(rawSymbol || symbol);

  const identityChanged =
    symbol !== currentContext.symbol ||
    exchange !== currentContext.exchange ||
    timeframe !== currentContext.timeframe;
  const navId = identityChanged ? navigationId + 1 : navigationId;
  if (identityChanged) navigationId = navId;

  const ctx: ChartContext = {
    ...currentContext,
    symbol,
    rawSymbol,
    ticker: symbol,
    exchange,
    rawTimeframe,
    timeframe,
    price,
    priceSource,
    priceDisplay: price != null ? String(price) : null,
    isTradingView: true,
    displayName: symbol ?? null,
    indicators: mergeIndicators(
      currentContext.indicators || [],
      legend.indicators,
      symbol === currentContext.symbol
    ),
    drawings: detectDrawings(widget.drawingCount),
    visibleRange: detectVisibleRange(widget.visibleRange),
    symbolSources: [
      ...(legend.symbol ? ["tradingview-legend" as const] : []),
      ...(widget.symbol ? ["tradingview-widget" as const] : []),
      ...(urlResult.symbol ? ["url" as const] : []),
      ...(titleResult.symbol ? ["title" as const] : []),
    ],
    timeframeSource: legend.timeframe ? "tradingview-legend" : widget.interval ? "tradingview-widget" : "tradingview-dom",
    navigationId: navId,
    source: "tradingview",
    status: symbol ? "active" : "unknown",
    market: "symbol" in resolved ? resolved.market : currentContext.market ?? "unknown",
    marketSymbol: "symbol" in resolved ? resolved.symbol : null,
    marketSync: "symbol" in resolved
      ? (resolved.symbol === symbol ? "matched" : "mismatched")
      : "unsupported",
    unsupportedReason: "reason" in resolved ? resolved.reason : null,
    timestamp: Date.now(),
    dataAgeMs: 0,
    manualOverride: currentContext.manualOverride ?? false,
  };

  return ctx;
}

function mergeIndicators(
  prev: DetectedIndicator[],
  next: DetectedIndicator[],
  sameIdentity: boolean
): DetectedIndicator[] {
  if (!sameIdentity) return next;
  // Keep previously detected indicators that temporarily dropped out of the
  // legend (collapsed panes) so the context stays stable; new legend items win.
  const merged = [...next];
  for (const ind of prev) {
    if (!merged.some((m) => m.type === ind.type && m.name === ind.name)) {
      merged.push({ ...ind, source: ind.source });
    }
  }
  return merged;
}

/* ── broadcast & lifecycle ───────────────────────────────────────────── */

function broadcastContext(): void {
  const changed = identityKey(currentContext) !== lastIdentityKey;

  // Throttle price-only updates to once per second to avoid flooding the SW.
  const now = Date.now();
  const priceOnly = !changed;
  if (priceOnly && now - lastBroadcastAt < 1000) return;

  lastIdentityKey = identityKey(currentContext);
  lastBroadcastAt = now;

  setCachedContext(currentContext).catch(() => { /* storage may be unavailable */ });

  try {
    chrome.runtime.sendMessage({ type: "TRADINGVIEW_CONTEXT_UPDATE", payload: currentContext });
  } catch { /* service worker may be asleep */ }

  console.log(
    `${EXT_PREFIX} context`,
    `${currentContext.exchange || ""}${currentContext.symbol || "?"} ${currentContext.timeframe || "?"} @ ${currentContext.price ?? "?"}`,
    `indicators=${currentContext.indicators?.length ?? 0} nav=${navigationId}`
  );
}

function updateContext(): void {
  if (!isTradingViewPage()) return;

  const next = detectFullContext();
  const identityChanged = identityKey(next) !== identityKey(currentContext);
  const priceChanged = next.price !== currentContext.price;

  if (!identityChanged && !priceChanged) {
    // Nothing user-relevant changed — but still refresh enrichment friendly data.
    return;
  }

  currentContext = next;
  broadcastContext();
}

function scheduleDetection(): void {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => updateContext(), 350);
}

function startObserving(): void {
  if (observer) observer.disconnect();
  observer = new MutationObserver(scheduleDetection);
  observer.observe(document.body, { childList: true, subtree: true, characterData: true });
}

function trackHistoryChanges(): void {
  window.addEventListener("popstate", () => setTimeout(updateContext, 500));
  const wrap = (original: typeof history.pushState) =>
    function (this: History, ...args: Parameters<typeof history.pushState>) {
      original.apply(this, args);
      setTimeout(updateContext, 500);
    };
  history.pushState = wrap(history.pushState);
  history.replaceState = wrap(history.replaceState);
}

/* ── message handling ────────────────────────────────────────────────── */

function handleMessage(
  message: { type: string; payload?: Record<string, unknown> },
  _sender: chrome.runtime.MessageSender,
  sendResponse: (response?: unknown) => void
): void {
  switch (message.type) {
    case "GET_CONTEXT":
      updateContext();
      sendResponse({ context: currentContext });
      return;
    case "REFRESH_CONTEXT":
      updateContext();
      sendResponse({ context: currentContext });
      return;
    case "TRADINGVIEW_CONTEXT_REQUEST":
      updateContext();
      sendResponse({ context: currentContext });
      return;
    case "ANALYZE_CHART":
    case "CREATE_SIGNAL":
    case "OPEN_STRATEGY_LAB":
    case "CALCULATE_RISK":
    case "OPEN_BACKTEST":
    case "OPEN_AI_COPILOT":
      // Actions are handled by the service worker (it opens the popup with a
      // pending action). Refresh our own context snapshot in passing.
      updateContext();
      sendResponse({ ok: true });
      return;
    default:
      sendResponse({ received: true });
  }
}

/* ── init ────────────────────────────────────────────────────────────── */

function init(): void {
  console.log(`${EXT_PREFIX} Loaded on ${window.location.hostname}${window.location.pathname}`);
  if (!isTradingViewPage()) return;

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    handleMessage(message, sender, sendResponse);
    return false;
  });

  startObserving();
  trackHistoryChanges();

  // The chart mounts asynchronously — detect in a few passes.
  setTimeout(() => updateContext(), 800);
  setTimeout(() => updateContext(), 2500);
  setTimeout(() => updateContext(), 5000);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}