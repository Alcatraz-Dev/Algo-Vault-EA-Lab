/**
 * Open the AlgoVault side panel from an extension page (popup / options).
 *
 * Gesture rules (Chrome MV3): `chrome.sidePanel.open()` must run inside a LIVE
 * user gesture. The gesture survives a `runtime.sendMessage` hop to the
 * service worker (official Chromium pattern) but does NOT survive promise
 * boundaries — the SW therefore must be able to call open() SYNCHRONOUSLY in
 * its onMessage handler, which requires a real windowId to already be known.
 *
 * Strategy (ordered):
 *   1. Direct synchronous open() from this page when a real window id is
 *      cached (popups prime it on mount). This keeps the gesture in-page.
 *   2. Relay to the service worker, which continuously tracks the last
 *      focused window via windows.onFocusChanged and can therefore also call
 *      open() synchronously with a concrete id (never the -2 sentinel —
 *      WINDOW_ID_CURRENT is NOT a valid sidePanel.open() target).
 *   3. If both fail (stale window id, API rejection), the SW shows a
 *      notification — the button is never silently dead.
 */

let cachedWindowId: number | null = null;

/** Call once when an extension page mounts so clicks can pass a real id. */
export function primeSidePanelWindowId(): void {
  try {
    chrome.windows.getCurrent((win) => {
      if (win?.id != null && win.id !== chrome.windows.WINDOW_ID_NONE) {
        cachedWindowId = win.id;
      }
    });
  } catch {
    /* popup context without windows access — SW relay still applies */
  }
}

/**
 * Open the copilot as a DRAGGABLE floating popup on the TradingView tab.
 *
 * Preferred surface for the popup's Side Panel button: the panel floats over
 * the chart, is draggable/resizable and embeds the full side-panel app. When
 * no TradingView tab acknowledges the toggle (or the SW is unreachable), fall
 * back to the docked Chrome side panel so the button is never dead.
 */
export function openCopilotFloatingPanel(): void {
  try {
    chrome.runtime.sendMessage({ type: "TOGGLE_FLOATING_PANEL" }, (resp) => {
      const delivered = !chrome.runtime.lastError && (resp as { ok?: boolean } | null)?.ok === true;
      if (!delivered) openSidePanelFromExtensionPage();
    });
  } catch {
    openSidePanelFromExtensionPage();
  }
}

/** Must be invoked directly from a click handler — do not await before it. */
export function openSidePanelFromExtensionPage(): void {
  // 1) Direct synchronous attempt with a REAL window id. Never pass the
  //    WINDOW_ID_CURRENT (-2) sentinel: sidePanel.open() rejects it.
  if (cachedWindowId != null) {
    try {
      const result = chrome.sidePanel.open({ windowId: cachedWindowId });
      Promise.resolve(result).catch(() => {
        /* rare rejection (e.g. window closed since priming) — the SW relay
           below already fired with its own tracked id */
      });
    } catch {
      /* API missing or context closing — SW relay below */
    }
  }

  // 2) Service-worker relay — the gesture rides the message and the SW calls
  //    open() synchronously using its continuously-tracked focused window.
  try {
    void chrome.runtime.sendMessage({
      type: "OPEN_SIDE_PANEL",
      windowId: cachedWindowId ?? undefined,
    }).catch(() => {
      /* SW unreachable — nothing else we can do from this context */
    });
  } catch {
    /* SW unavailable */
  }
}
