/**
 * Open the AlgoVault side panel from an extension page (popup / options).
 *
 * `chrome.sidePanel.open()` must run inside a LIVE user gesture: extension
 * APIs do not carry the gesture across async boundaries, so the call has to
 * happen synchronously inside the click handler. Calling it inside a
 * `chrome.windows.getCurrent` callback (or after any await) loses the gesture
 * and Chrome rejects with "may only be called in response to a user gesture".
 *
 * Strategy:
 *   1. Prime the current window id at mount (async is fine — no gesture yet).
 *   2. On click, call open() synchronously with the cached id.
 *   3. If the direct call is rejected, hand off to the service worker along
 *      with the window id — the SW listener calls open() synchronously too.
 */

let cachedWindowId: number | null = null;

/** Call once when an extension page mounts so clicks can open synchronously. */
export function primeSidePanelWindowId(): void {
  try {
    chrome.windows.getCurrent((win) => {
      if (win?.id != null) cachedWindowId = win.id;
    });
  } catch {
    /* popup context without windows access — fallbacks still apply */
  }
}

/** Must be invoked directly from a click handler — do not await before it. */
export function openSidePanelFromExtensionPage(): void {
  const fallback = (windowId?: number) => {
    try {
      chrome.runtime.sendMessage({ type: "OPEN_SIDE_PANEL", windowId });
    } catch {
      /* SW unavailable — nothing else we can do */
    }
  };

  const attempt = (windowId: number) => {
    try {
      chrome.sidePanel
        .open({ windowId })
        .catch(() => fallback(windowId));
    } catch {
      fallback(windowId);
    }
  };

  // Synchronous path first: cached id, else the CURRENT-window constant
  // (resolves inside the popup's own browser window; keeps the gesture alive).
  if (cachedWindowId != null) {
    attempt(cachedWindowId);
    return;
  }
  try {
    attempt(chrome.windows.WINDOW_ID_CURRENT);
  } catch {
    fallback();
  }
}
