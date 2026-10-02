/**
 * AlgoVault floating copilot panel — a draggable in-page popup on TradingView.
 *
 * The Side Panel button opens Chrome's docked side panel; this script powers
 * the DRAGGABLE alternative: a floating window anchored on the chart page that
 * embeds the full side-panel UI (sidepanel/index.html) in an iframe. It can be
 * dragged by its header, resized from its bottom-right corner, and its
 * position/size persist across sessions via chrome.storage.local.
 *
 * Lives in its own content script (IIFE) so it stays independent from the
 * overlay/launcher and survives TradingView's SPA navigations (MutationObserver
 * re-mount, same pattern as quick-launcher.ts).
 *
 * CSP note: some sites (possibly TradingView) block chrome-extension:// iframes
 * via their frame-src policy. The embedded app signals readiness with an
 * AV_FLOATING_PANEL_READY postMessage; if it never arrives the panel is torn
 * down and the service worker shows the "use the docked side panel" hint.
 */

const HOST_ID = "algovault-floating-panel-host";
const PANEL_ID = "algovault-floating-panel";
const RECT_KEY = "floatingPanelRect";
const READY_TIMEOUT_MS = 4000;

const DEFAULT_WIDTH = 400;
const DEFAULT_HEIGHT = 640;
const MIN_WIDTH = 320;
const MIN_HEIGHT = 420;
const MARGIN = 8;

interface PanelRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

function isTradingViewPage(): boolean {
  return window.location.hostname.includes("tradingview.com");
}

function clampRect(rect: PanelRect): PanelRect {
  const width = Math.min(Math.max(MIN_WIDTH, rect.width), Math.max(MIN_WIDTH, window.innerWidth - 2 * MARGIN));
  const height = Math.min(Math.max(MIN_HEIGHT, rect.height), Math.max(MIN_HEIGHT, window.innerHeight - 2 * MARGIN));
  const left = Math.min(Math.max(MARGIN, rect.left), Math.max(MARGIN, window.innerWidth - width - MARGIN));
  const top = Math.min(Math.max(MARGIN, rect.top), Math.max(MARGIN, window.innerHeight - height - MARGIN));
  return { left, top, width, height };
}

function defaultRect(): PanelRect {
  return clampRect({
    left: Math.max(MARGIN, window.innerWidth - DEFAULT_WIDTH - 16),
    top: Math.max(MARGIN, Math.round(window.innerHeight * 0.08)),
    width: DEFAULT_WIDTH,
    height: DEFAULT_HEIGHT,
  });
}

function loadRect(): Promise<PanelRect> {
  return new Promise((resolve) => {
    try {
      chrome.storage.local.get([RECT_KEY], (data) => {
        const saved = data?.[RECT_KEY] as Partial<PanelRect> | undefined;
        if (
          saved &&
          typeof saved.left === "number" &&
          typeof saved.top === "number" &&
          typeof saved.width === "number" &&
          typeof saved.height === "number"
        ) {
          resolve(clampRect(saved as PanelRect));
        } else {
          resolve(defaultRect());
        }
      });
    } catch {
      resolve(defaultRect());
    }
  });
}

function saveRect(rect: PanelRect): void {
  try {
    chrome.storage.local.set({ [RECT_KEY]: rect });
  } catch {
    /* storage unavailable — position just won't persist */
  }
}

function mountHost(): HTMLDivElement {
  const existing = document.getElementById(HOST_ID);
  if (existing) return existing.shadowRoot?.querySelector("div") as HTMLDivElement;

  const host = document.createElement("div");
  host.id = HOST_ID;
  host.style.cssText = "position: fixed; top: 0; left: 0; width: 0; height: 0; z-index: 2147483646;";

  const shadow = host.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  style.textContent = `
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    :host { all: initial; }
  `;
  const container = document.createElement("div");
  container.style.cssText = "position: fixed; top: 0; left: 0; width: 0; height: 0; overflow: visible;";
  shadow.appendChild(style);
  shadow.appendChild(container);
  document.documentElement.appendChild(host);

  return container;
}

function buildPanel(container: HTMLDivElement, rect: PanelRect): HTMLElement {
  const panel = document.createElement("div");
  panel.id = PANEL_ID;
  panel.style.cssText = [
    "position: fixed",
    `left: ${rect.left}px`,
    `top: ${rect.top}px`,
    `width: ${rect.width}px`,
    `height: ${rect.height}px`,
    "display: flex",
    "flex-direction: column",
    "border-radius: 14px",
    "overflow: hidden",
    "background: #0a0a0b",
    "border: 1px solid rgba(255, 255, 255, 0.09)",
    "box-shadow: 0 18px 48px rgba(0, 0, 0, 0.6)",
    "color: #e5e5e5",
    "font-family: ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, Arial, sans-serif",
    "touch-action: none",
  ].join(";");

  /* ── header (drag handle) ─────────────────────────────────────────── */
  const header = document.createElement("div");
  header.style.cssText = [
    "flex: 0 0 auto",
    "display: flex",
    "align-items: center",
    "gap: 8px",
    "height: 34px",
    "padding: 0 10px",
    "background: rgba(255, 255, 255, 0.04)",
    "border-bottom: 1px solid rgba(255, 255, 255, 0.08)",
    "cursor: grab",
    "user-select: none",
    "-webkit-user-select: none",
  ].join(";");

  const dot = document.createElement("span");
  dot.style.cssText = "width: 7px; height: 7px; border-radius: 50%; background: #ff6b26; box-shadow: 0 0 6px rgba(255, 107, 38, 0.8);";
  header.appendChild(dot);

  const title = document.createElement("span");
  title.textContent = "AlgoVault Copilot";
  title.style.cssText = "flex: 1 1 auto; font-size: 11px; font-weight: 600; letter-spacing: 0.2px; pointer-events: none;";
  header.appendChild(title);

  const dockButton = document.createElement("button");
  dockButton.textContent = "⇥ Dock";
  dockButton.title = "Open in Chrome's docked side panel instead";
  dockButton.style.cssText = [
    "flex: 0 0 auto",
    "display: inline-flex",
    "align-items: center",
    "justify-content: center",
    "gap: 4px",
    "min-width: 64px",
    "height: 26px",
    "padding: 0 10px",
    "border: 1px solid rgba(255, 255, 255, 0.12)",
    "background: transparent",
    "color: rgba(255, 255, 255, 0.7)",
    "font-size: 10.5px",
    "font-weight: 600",
    "line-height: 1",
    "cursor: pointer",
    "border-radius: 6px",
    "transition: background 0.15s ease, color 0.15s ease, transform 0.1s ease, border-color 0.15s ease",
  ].join(";");
  const dockHover = () => { dockButton.style.color = "#fff"; dockButton.style.background = "rgba(255,77,0,0.18)"; dockButton.style.borderColor = "rgba(255,77,0,0.5)"; };
  const dockLeave = () => { dockButton.style.color = "rgba(255, 255, 255, 0.7)"; dockButton.style.background = "transparent"; dockButton.style.borderColor = "rgba(255, 255, 255, 0.12)"; dockButton.style.transform = "scale(1)"; };
  dockButton.addEventListener("mouseenter", dockHover);
  dockButton.addEventListener("mouseleave", dockLeave);
  dockButton.addEventListener("pointerdown", () => { dockButton.style.transform = "scale(0.94)"; });
  dockButton.addEventListener("pointerup", dockHover);
  dockButton.addEventListener("pointercancel", dockLeave);
  dockButton.addEventListener("click", (e) => {
    e.stopPropagation();
    e.preventDefault();
    closePanel();
    try {
      void chrome.runtime.sendMessage({ type: "OPEN_SIDE_PANEL" }).catch(() => {});
    } catch { /* SW unavailable */ }
  });
  header.appendChild(dockButton);

  const closeButton = document.createElement("button");
  closeButton.textContent = "✕";
  closeButton.title = "Close panel";
  closeButton.style.cssText = [
    "flex: 0 0 auto",
    "display: inline-flex",
    "align-items: center",
    "justify-content: center",
    "width: 26px",
    "height: 26px",
    "padding: 0",
    "border: 1px solid rgba(255, 255, 255, 0.12)",
    "background: transparent",
    "color: rgba(255, 255, 255, 0.7)",
    "font-size: 14px",
    "line-height: 1",
    "cursor: pointer",
    "border-radius: 6px",
    "transition: background 0.15s ease, color 0.15s ease, transform 0.1s ease, border-color 0.15s ease",
  ].join(";");
  const closeHover = () => { closeButton.style.color = "#fff"; closeButton.style.background = "rgba(244, 63, 94, 0.22)"; closeButton.style.borderColor = "rgba(244, 63, 94, 0.5)"; };
  const closeLeave = () => { closeButton.style.color = "rgba(255, 255, 255, 0.7)"; closeButton.style.background = "transparent"; closeButton.style.borderColor = "rgba(255, 255, 255, 0.12)"; closeButton.style.transform = "scale(1)"; };
  closeButton.addEventListener("mouseenter", closeHover);
  closeButton.addEventListener("mouseleave", closeLeave);
  closeButton.addEventListener("pointerdown", () => { closeButton.style.transform = "scale(0.9)"; });
  closeButton.addEventListener("pointerup", closeHover);
  closeButton.addEventListener("pointercancel", closeLeave);
  closeButton.addEventListener("click", (e) => {
    e.stopPropagation();
    e.preventDefault();
    closePanel();
  });
  header.appendChild(closeButton);

  panel.appendChild(header);

  /* ── iframe body (the full side-panel app) ────────────────────────── */
  const frame = document.createElement("iframe");
  frame.src = chrome.runtime.getURL("sidepanel/index.html");
  frame.allow = "clipboard-write";
  frame.style.cssText = "flex: 1 1 auto; width: 100%; height: 100%; border: 0; background: #0a0a0b;";
  panel.appendChild(frame);

  /* ── resize handle (bottom-right corner) ──────────────────────────── */
  const resizer = document.createElement("div");
  resizer.style.cssText = [
    "position: absolute",
    "right: 0",
    "bottom: 0",
    "width: 16px",
    "height: 16px",
    "cursor: nwse-resize",
    "z-index: 2",
  ].join(";");

  let readyTimer: ReturnType<typeof setTimeout> | null = null;
  let ready = false;

  function onReadyMessage(event: MessageEvent): void {
    if (event.source !== frame.contentWindow) return;
    const data = event.data as { type?: string } | null;
    if (data?.type === "AV_FLOATING_PANEL_READY") {
      ready = true;
      if (readyTimer) clearTimeout(readyTimer);
      window.removeEventListener("message", onReadyMessage);
    }
  }

  window.addEventListener("message", onReadyMessage);

  readyTimer = setTimeout(() => {
    if (ready) return;
    // The iframe never signalled readiness — the page's CSP most likely
    // blocks chrome-extension:// frames. Tear down and point the user at the
    // docked side panel instead of leaving a dead empty window on the chart.
    window.removeEventListener("message", onReadyMessage);
    closePanel();
    try {
      void chrome.runtime.sendMessage({
        type: "NOTIFY",
        title: "AlgoVault",
        message: "This page blocks embedded panels. Open the copilot from the toolbar icon → \u201cOpen side panel\u201d.",
      }).catch(() => {});
    } catch { /* SW unavailable */ }
  }, READY_TIMEOUT_MS);

  /* ── dragging (header) ────────────────────────────────────────────── */
  header.addEventListener("pointerdown", (e) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    const target = e.target as HTMLElement;
    if (target.closest("button")) return; // buttons are not drag handles

    e.preventDefault();
    header.style.cursor = "grabbing";
    frame.style.pointerEvents = "none";
    try { header.setPointerCapture(e.pointerId); } catch { /* ignore */ }

    const startRect = panel.getBoundingClientRect();
    const offsetX = e.clientX - startRect.left;
    const offsetY = e.clientY - startRect.top;

    const onMove = (ev: PointerEvent) => {
      const next = clampRect({ ...startRect, left: ev.clientX - offsetX, top: ev.clientY - offsetY });
      panel.style.left = `${next.left}px`;
      panel.style.top = `${next.top}px`;
    };
    const onUp = (ev: PointerEvent) => {
      header.style.cursor = "grab";
      frame.style.pointerEvents = "auto";
      try { header.releasePointerCapture(ev.pointerId); } catch { /* ignore */ }
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      saveRect(currentRect());
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  });

  /* ── resizing (corner handle) ─────────────────────────────────────── */
  resizer.addEventListener("pointerdown", (e) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    frame.style.pointerEvents = "none";
    try { resizer.setPointerCapture(e.pointerId); } catch { /* ignore */ }

    const startRect = panel.getBoundingClientRect();
    const startX = e.clientX;
    const startY = e.clientY;

    const onMove = (ev: PointerEvent) => {
      const next = clampRect({
        left: startRect.left,
        top: startRect.top,
        width: startRect.width + (ev.clientX - startX),
        height: startRect.height + (ev.clientY - startY),
      });
      panel.style.width = `${next.width}px`;
      panel.style.height = `${next.height}px`;
    };
    const onUp = (ev: PointerEvent) => {
      frame.style.pointerEvents = "auto";
      try { resizer.releasePointerCapture(ev.pointerId); } catch { /* ignore */ }
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      saveRect(currentRect());
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  });

  panel.appendChild(resizer);

  /* Keep the panel on-screen when the window resizes. */
  const onWindowResize = () => {
    const next = clampRect(currentRect());
    panel.style.left = `${next.left}px`;
    panel.style.top = `${next.top}px`;
    panel.style.width = `${next.width}px`;
    panel.style.height = `${next.height}px`;
  };
  window.addEventListener("resize", onWindowResize);

  function currentRect(): PanelRect {
    return {
      left: parseInt(panel.style.left, 10) || 0,
      top: parseInt(panel.style.top, 10) || 0,
      width: parseInt(panel.style.width, 10) || DEFAULT_WIDTH,
      height: parseInt(panel.style.height, 10) || DEFAULT_HEIGHT,
    };
  }

  container.appendChild(panel);
  return panel;
}

function closePanel(): void {
  document.getElementById(HOST_ID)?.remove();
}

function togglePanel(): void {
  if (document.getElementById(PANEL_ID)) {
    closePanel();
    return;
  }

  void loadRect().then((rect) => {
    const container = mountHost();
    buildPanel(container, rect);
  });
}

/* ── message wiring (service worker relay) ───────────────────────────── */

chrome.runtime.onMessage.addListener(
  (message: { type?: string }, _sender, sendResponse: (resp: unknown) => void) => {
    if (message?.type === "TOGGLE_FLOATING_PANEL") {
      togglePanel();
      sendResponse({ ok: true, open: !!document.getElementById(PANEL_ID) });
    }
    return false;
  }
);

/* ── init (SPA-safe, same pattern as quick-launcher) ─────────────────── */

function init(): void {
  if (!isTradingViewPage()) return;
  mountHost(); // reserve the shadow host; the panel itself mounts on toggle

  // TradingView swaps views without reloading — re-create the host whenever
  // it is removed from the DOM so the toggle keeps working.
  const keepAlive = new MutationObserver(() => {
    if (!document.getElementById(HOST_ID)) {
      mountHost();
    }
  });
  keepAlive.observe(document.documentElement, { childList: true, subtree: true });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
