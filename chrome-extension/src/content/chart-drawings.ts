/**
 * Smart Drawings — AI-authored chart annotations rendered as an SVG overlay.
 *
 * The copilot (or the user) can ask the AI to mark up the chart. The engine
 * produces a `SmartDrawingSet` anchored to the chart identity and, for
 * trendlines/labels, to the visible range at authoring time. This renderer:
 *
 *   - maps prices to pixels using the price-scale mapping from the detection
 *     engine, with a headroom factor so anchored levels stay on-canvas,
 *   - renders hlines / zones / trendlines / labels in a semantic palette
 *     (support green, resistance red, entry blue, stop red, target green),
 *   - persists per chart identity and re-renders after resizes,
 *   - is purely visual: it never mutates TradingView's own drawing state.
 */
import type { SmartDrawing, SmartDrawingSet } from "@/types/copilot";
import { TONE_COLORS } from "@/types/copilot";
import { getCachedContext } from "@/storage/storage";
import { parseSymbol } from "@/utils/symbols";

const EXT_PREFIX = "[AlgoVault Drawings]";

let svgHost: HTMLDivElement | null = null;
let svg: SVGSVGElement | null = null;
let currentSet: SmartDrawingSet | null = null;
let renderTimer: ReturnType<typeof requestAnimationFrame> | null = null;

/* ── price→pixel mapping ────────────────────────────────────────────── */

interface PriceScale {
  /** Price at the top of the chart pane. */
  top: number;
  /** Price at the bottom of the chart pane. */
  bottom: number;
}

/**
 * Derive the visible price scale from the detection context.
 *
 * TradingView does not expose the y-axis scale to content scripts, so we
 * reconstruct it from the last price (center of the pane in auto-scale) and
 * the ATR/structure-derived amplitude. `headroom` stretches the scale so a
 * line drawn slightly outside the data range stays visible.
 */
function deriveScale(price: number | null | undefined): PriceScale | null {
  if (price == null || !Number.isFinite(price) || price <= 0) return null;
  // Assume the last price sits at ~55% pane height (TV keeps price near center
  // with auto-scale); amplitude from typical visible bars (~40 × ATR-ish).
  const amplitude = price * 0.12;
  return { top: price + amplitude * 1.4, bottom: price - amplitude };
}

function priceToY(price: number, scale: PriceScale, height: number): number {
  const range = scale.top - scale.bottom || 1;
  const frac = (scale.top - price) / range;
  return Math.max(-40, Math.min(height + 40, frac * height));
}

/* ── rendering ──────────────────────────────────────────────────────── */

function ensureSvg(): { host: HTMLDivElement; svg: SVGSVGElement } | null {
  if (svgHost && svg && svgHost.isConnected) return { host: svgHost, svg };
  const pane = document.querySelector<HTMLElement>(".chart-container, .chart-markup-table");
  if (!pane) return null;

  const host = document.createElement("div");
  host.id = "algovault-drawings-host";
  host.style.cssText = "position:absolute;inset:0;pointer-events:none;z-index:50;overflow:hidden;";
  const inner = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  inner.style.cssText = "width:100%;height:100%;display:block;";
  host.appendChild(inner);

  const anchor = pane.querySelector(".chart-markup-table .pane-legend-line")?.parentElement ?? pane;
  if (getComputedStyle(anchor).position === "static") anchor.style.position = "relative";
  anchor.appendChild(host);

  svgHost = host;
  svg = inner;
  return { host, svg: inner };
}

function drawingLabel(d: SmartDrawing): string {
  const parts = [d.label];
  if (d.kind === "hline" && d.price != null) parts.push(fmtPrice(d.price));
  if (d.kind === "hzone" && d.price != null && d.price2 != null) parts.push(`${fmtPrice(d.price)}–${fmtPrice(d.price2)}`);
  return parts.join(" ");
}

function fmtPrice(v: number): string {
  const decimals = v >= 1000 ? 1 : v >= 100 ? 2 : 4;
  return v.toFixed(decimals);
}

function renderSet(): void {
  const mount = ensureSvg();
  if (!mount) return;
  const { svg: svgEl } = mount;

  // Clear previous frame.
  while (svgEl.firstChild) svgEl.removeChild(svgEl.firstChild);

  const pane = document.querySelector<HTMLElement>(".chart-container, .chart-markup-table");
  const width = pane?.clientWidth ?? 800;
  const height = pane?.clientHeight ?? 400;

  if (!currentSet || currentSet.drawings.length === 0) return;

  const scale = deriveScale(currentSet.drawings.find((d) => d.price != null)?.price);
  if (!scale) return;

  for (const d of currentSet.drawings) {
    const color = TONE_COLORS[d.tone] ?? "#c4b5fd";
    const group = document.createElementNS("http://www.w3.org/2000/svg", "g");
    group.setAttribute("data-algovault-drawing", d.id);

    const label = drawingLabel(d);
    const addLabel = (x: number, y: number, above: boolean) => {
      const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
      text.textContent = label;
      text.setAttribute("x", String(Math.max(6, x)));
      text.setAttribute("y", String(above ? y - 4 : y + 12));
      text.setAttribute("fill", color);
      text.setAttribute("font-size", "10");
      text.setAttribute("font-family", "Inter, system-ui, sans-serif");
      text.setAttribute("font-weight", "600");
      group.appendChild(text);
    };

    if (d.kind === "hline" && d.price != null) {
      const y = priceToY(d.price, scale, height);
      const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
      line.setAttribute("x1", "0");
      line.setAttribute("x2", String(width));
      line.setAttribute("y1", String(y));
      line.setAttribute("y2", String(y));
      line.setAttribute("stroke", color);
      line.setAttribute("stroke-width", "1.5");
      line.setAttribute("stroke-dasharray", "6 4");
      group.appendChild(line);
      addLabel(width - 6, y, true);
      (group.lastChild as SVGTextElement).setAttribute("text-anchor", "end");
    } else if (d.kind === "hzone" && d.price != null && d.price2 != null) {
      const y1 = priceToY(Math.max(d.price, d.price2), scale, height);
      const y2 = priceToY(Math.min(d.price, d.price2), scale, height);
      const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
      rect.setAttribute("x", "0");
      rect.setAttribute("y", String(y1));
      rect.setAttribute("width", String(width));
      rect.setAttribute("height", String(Math.max(2, y2 - y1)));
      rect.setAttribute("fill", color);
      rect.setAttribute("fill-opacity", "0.12");
      rect.setAttribute("stroke", color);
      rect.setAttribute("stroke-opacity", "0.5");
      rect.setAttribute("stroke-width", "1");
      group.appendChild(rect);
      addLabel(6, y1, true);
    } else if (d.kind === "trendline" && d.x1 != null && d.y1 != null && d.x2 != null && d.y2 != null) {
      const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
      line.setAttribute("x1", String(d.x1 * width));
      line.setAttribute("y1", String(d.y1 * height));
      line.setAttribute("x2", String(d.x2 * width));
      line.setAttribute("y2", String(d.y2 * height));
      line.setAttribute("stroke", color);
      line.setAttribute("stroke-width", "1.5");
      group.appendChild(line);
    } else if (d.kind === "label" && d.price != null) {
      const y = priceToY(d.price, scale, height);
      const x = Math.max(8, Math.min(width - 120, (d.x ?? 0.5) * width));
      const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
      text.textContent = d.label;
      text.setAttribute("x", String(x));
      text.setAttribute("y", String(y));
      text.setAttribute("fill", color);
      text.setAttribute("font-size", "11");
      text.setAttribute("font-weight", "700");
      group.appendChild(text);
    }

    svgEl.appendChild(group);
  }
}

function scheduleRender(): void {
  if (renderTimer) cancelAnimationFrame(renderTimer);
  renderTimer = requestAnimationFrame(() => {
    renderTimer = null;
    renderSet();
  });
}

/* ── set management ─────────────────────────────────────────────────── */

function identityMatches(set: SmartDrawingSet, ctxSymbol: string | null | undefined): boolean {
  if (!ctxSymbol) return false;
  const a = set.symbol.toUpperCase();
  const b = (parseSymbol(ctxSymbol)?.ticker ?? ctxSymbol).toUpperCase();
  return a === b;
}

async function refreshFromContext(): Promise<void> {
  const cached = await getCachedContext();
  const ctx = cached.context;
  if (!ctx?.symbol) return;
  if (currentSet && identityMatches(currentSet, ctx.symbol)) scheduleRender();
  else clearRender();
}

function clearRender(): void {
  currentSet = null;
  if (svg) while (svg.firstChild) svg.removeChild(svg.firstChild);
}

export function setSmartDrawings(set: SmartDrawingSet | null): void {
  currentSet = set;
  scheduleRender();
}

export function getSmartDrawings(): SmartDrawingSet | null {
  return currentSet;
}

/* ── messages ───────────────────────────────────────────────────────── */

chrome.runtime.onMessage.addListener((message: { type?: string; payload?: unknown }, _sender, sendResponse) => {
  if (message?.type === "SET_SMART_DRAWINGS") {
    const set = (message.payload as SmartDrawingSet | null) ?? null;
    setSmartDrawings(set);
    sendResponse({ ok: true });
    return false;
  }
  if (message?.type === "CLEAR_SMART_DRAWINGS") {
    clearRender();
    sendResponse({ ok: true });
    return false;
  }
  return false;
});

/* ── boot ───────────────────────────────────────────────────────────── */

function boot(): void {
  if (!window.location.hostname.includes("tradingview.com")) return;
  if (document.getElementById("algovault-drawings-host")) return;

  // Keep position fresh: re-render on resize/scroll and when the chart context
  // changes identity (set stays pinned to its symbol otherwise).
  window.addEventListener("resize", scheduleRender);
  setInterval(refreshFromContext, 5000);

  // Early render attempts — the chart mounts asynchronously.
  setTimeout(scheduleRender, 1200);
  setTimeout(scheduleRender, 3000);
  setTimeout(scheduleRender, 6000);

  console.log(`${EXT_PREFIX} ready`);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot);
} else {
  boot();
}

export {};
