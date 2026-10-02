import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles.css";
import { initTheme } from "@/theme";

/* Signal readiness to a potential host page: when the copilot runs inside the
   floating-panel iframe on TradingView, the content script waits for this
   postMessage — if it never arrives (e.g. the page's CSP blocks extension
   frames) the floating panel tears itself down with a hint to use the docked
   side panel. Harmless no-op when top-level (side panel / popup). */
try {
  if (window.parent && window.parent !== window) {
    window.parent.postMessage({ type: "AV_FLOATING_PANEL_READY" }, "*");
  }
} catch { /* cross-origin parent — nothing to announce */ }

initTheme().finally(() => {
  ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
});
