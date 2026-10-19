/**
 * AlgoVault quick launcher — the tiny draggable orb that stays on TradingView
 * charts so the extension can be reopened with ONE click after it was closed.
 *
 * Lives in its own content script so it survives TradingView's SPA
 * navigations: the overlay unmounts/remounts as the page swaps views, while
 * this script re-creates the orb whenever its host element disappears and
 * re-clamps it into the viewport on resize. Position is persisted per browser
 * via chrome.storage.local, and a click opens the last overlay state.
 */
import { getOverlayState, setOverlayState } from "@/storage/storage";
import { shadowTokenCSS } from "./shadow-tokens";

/** Window event fired by the quick launcher to bring the overlay panel back. */
export const OVERLAY_CLOSED_EVENT = "algovault:reopen-overlay";

const SIZE = 34;
const MARGIN = 8;

function clamp(p: { x: number; y: number }): { x: number; y: number } {
  const maxX = Math.max(MARGIN, window.innerWidth - SIZE - MARGIN);
  const maxY = Math.max(MARGIN, window.innerHeight - SIZE - MARGIN);
  return { x: Math.min(Math.max(MARGIN, p.x), maxX), y: Math.min(Math.max(MARGIN, p.y), maxY) };
}

function isTradingViewPage(): boolean {
  return window.location.hostname.includes("tradingview.com");
}

/* Container of the currently mounted orb, so the theme listener can reach it. */
let launcherContainer: HTMLDivElement | null = null;

/* Theme follows the extension's persisted preference (light / dark / system),
   same source as the floating panel and overlay. */
function applyLauncherTheme(container: HTMLDivElement): void {
  try {
    chrome.storage.local.get(["avTheme"], (r) => {
      const mode = (r?.avTheme as string) || "system";
      const isLight =
        mode === "light" ||
        (mode === "system" && !!window.matchMedia?.("(prefers-color-scheme: light)").matches);
      container.classList.toggle("dark", !isLight);
    });
  } catch {
    container.classList.add("dark");
  }
}

try {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes.avTheme && launcherContainer) applyLauncherTheme(launcherContainer);
  });
} catch { /* storage unavailable — keep current theme */ }

function mountHost(): HTMLDivElement {
  const existing = document.getElementById("algovault-quick-launcher-host");
  if (existing) return existing.querySelector("div") as HTMLDivElement;

  const host = document.createElement("div");
  host.id = "algovault-quick-launcher-host";
  host.style.cssText = "position: fixed; top: 0; left: 0; width: 0; height: 0; z-index: 2147483646;";

  const shadow = host.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  style.textContent = `
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    :host { all: initial; }
    button { font: inherit; }
    ${shadowTokenCSS}
  `;
  const container = document.createElement("div");
  container.className = "av-tokens";
  container.style.cssText = "position: fixed; top: 0; left: 0; width: 0; height: 0; overflow: visible;";
  applyLauncherTheme(container);
  launcherContainer = container;
  shadow.appendChild(style);
  shadow.appendChild(container);
  document.documentElement.appendChild(host);

  return container;
}

function renderOrb(container: HTMLDivElement): void {
  container.innerHTML = "";

  const orb = document.createElement("div");
  orb.setAttribute("data-algovault-launcher", "");
  orb.title = "Open AlgoVault";
  orb.style.cssText = [
    "position: fixed",
    `width: ${SIZE}px`,
    `height: ${SIZE}px`,
    "display: flex",
    "align-items: center",
    "justify-content: center",
    "border-radius: 50%",
    "background: hsl(var(--card) / 0.92)",
    "border: 1px solid hsl(var(--border) / 0.9)",
    "box-shadow: 0 4px 14px hsl(var(--foreground) / 0.18)",
    "color: #ff6b26",
    "cursor: grab",
    "backdrop-filter: blur(10px)",
    "touch-action: none",
    "user-select: none",
    "transition: border-color 0.15s ease, box-shadow 0.2s ease, transform 0.15s ease",
  ].join(";");

  const icon = document.createElement("img");
  icon.src = chrome.runtime.getURL("logos/logo.png");
  icon.alt = "AlgoVault";
  icon.draggable = false;
  icon.style.cssText = "width: 20px; height: 20px; object-fit: contain; border-radius: 5px; pointer-events: none;";
  orb.appendChild(icon);

  let pos = { x: -1, y: -1 };
  let dragging = false;
  let moved = false;
  let pointerId: number | null = null;
  const offset = { x: 0, y: 0 };

  /* The orb is the reopen affordance: visible only while the full overlay
     panel is closed or hidden, so the two never stack on the chart. */
  function applyVisibility(s: { closed: boolean; visible: boolean } | null): void {
    const show = !s || s.closed || !s.visible;
    orb.style.display = show ? "flex" : "none";
  }

  orb.style.display = "none"; // avoid a flash before the persisted state lands

  getOverlayState().then((s) => {
    pos = s.launcher && s.launcher.x >= 0 ? clamp(s.launcher) : clamp({ x: window.innerWidth - SIZE - 16, y: Math.round(window.innerHeight * 0.35) });
    apply();
    applyVisibility(s);
  }).catch(() => {
    pos = clamp({ x: window.innerWidth - SIZE - 16, y: Math.round(window.innerHeight * 0.35) });
    apply();
    applyVisibility(null);
  });

  /* Live-follow the overlay panel: opening it hides the orb, minimizing or
     hiding the panel brings the orb back. */
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || !changes.overlayState) return;
    const next = changes.overlayState.newValue as { closed?: boolean; visible?: boolean } | undefined;
    applyVisibility({ closed: next?.closed === true, visible: next?.visible !== false });
  });

  function apply(): void {
    orb.style.left = `${pos.x}px`;
    orb.style.top = `${pos.y}px`;
  }

  orb.addEventListener("pointerdown", (e) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    const rect = orb.getBoundingClientRect();
    offset.x = e.clientX - rect.left;
    offset.y = e.clientY - rect.top;
    pointerId = e.pointerId;
    moved = false;
    dragging = true;
    orb.style.cursor = "grabbing";
    orb.style.boxShadow = "0 10px 28px rgba(0,0,0,0.55), 0 0 0 3px rgba(255,77,0,0.18)";
    orb.style.transition = "none";
    e.preventDefault();

    const onMove = (ev: PointerEvent) => {
      if (pointerId != null && ev.pointerId !== pointerId) return;
      moved = true;
      pos = clamp({ x: ev.clientX - offset.x, y: ev.clientY - offset.y });
      apply();
    };
    const onUp = (ev: PointerEvent) => {
      if (pointerId != null && ev.pointerId !== pointerId) return;
      dragging = false;
      pointerId = null;
      orb.style.cursor = "grab";
      orb.style.boxShadow = "0 4px 14px hsl(var(--foreground) / 0.18)";
      orb.style.transition = "border-color 0.15s ease, box-shadow 0.2s ease, transform 0.15s ease";
      void setOverlayState({ launcher: pos });
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  });

  orb.addEventListener("click", () => {
    if (moved) return; // a drag ending on the orb is not a click
    void setOverlayState({ closed: false, visible: true });
    window.dispatchEvent(new CustomEvent(OVERLAY_CLOSED_EVENT));
  });

  orb.addEventListener("mouseenter", () => {
    if (dragging) return;
    orb.style.border = "1px solid rgba(255, 77, 0, 0.7)";
    orb.style.transform = "scale(1.08)";
  });
  orb.addEventListener("mouseleave", () => {
    orb.style.border = "1px solid hsl(var(--border) / 0.9)";
    orb.style.transform = "scale(1)";
  });

  /* keep the orb on-screen when the window resizes */
  window.addEventListener("resize", () => {
    pos = clamp(pos);
    apply();
  });

  container.appendChild(orb);
}

function init(): void {
  if (!isTradingViewPage()) return;
  if (document.getElementById("algovault-quick-launcher-host")) return;

  const container = mountHost();
  renderOrb(container);

  /* TradingView swaps views without reloading — re-create the orb whenever
     the host is removed from the DOM. */
  const keepAlive = new MutationObserver(() => {
    if (!document.getElementById("algovault-quick-launcher-host")) {
      const next = mountHost();
      renderOrb(next);
    }
  });
  keepAlive.observe(document.documentElement, { childList: true, subtree: true });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
