"use client";

/**
 * DesktopConnectionBanner — shows a non-intrusive offline banner inside
 * the Next.js renderer when the Electron main process reports that the
 * OS network connection is offline.
 *
 * Uses the algovault bridge if available; falls back to browser
 * navigator.onLine events so the component is safe to render on web too.
 */
import { useEffect, useState } from "react";
import { WifiOff, X } from "lucide-react";
import { getDesktopBridge } from "@/hooks/use-desktop";
import { cn } from "@/lib/utils";

export function DesktopConnectionBanner() {
  const [offline, setOffline] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    const bridge = getDesktopBridge();

    if (bridge) {
      // Native OS network status from Electron
      const cleanup = bridge.connection.onStatusChange(({ online }) => {
        setOffline(!online);
        if (online) setDismissed(false); // auto-show banner again when offline
      });

      // Read initial state
      bridge.connection.getStatus().then(({ online }) => {
        setOffline(!online);
      });

      return cleanup;
    } else {
      // Browser fallback
      const onOnline = () => { setOffline(false); setDismissed(false); };
      const onOffline = () => setOffline(true);
      window.addEventListener("online", onOnline);
      window.addEventListener("offline", onOffline);
      setOffline(!navigator.onLine);
      return () => {
        window.removeEventListener("online", onOnline);
        window.removeEventListener("offline", onOffline);
      };
    }
  }, []);

  if (!offline || dismissed) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        "fixed bottom-4 left-1/2 z-[9999] flex -translate-x-1/2 items-center gap-3",
        "rounded-xl border border-border bg-card px-4 py-3 shadow-xl",
        "animate-in fade-in slide-in-from-bottom-2 duration-200"
      )}
    >
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-warning/10">
        <WifiOff size={14} className="text-warning" />
      </div>
      <div className="min-w-0">
        <p className="text-xs font-semibold text-foreground">No network connection</p>
        <p className="text-xs text-muted-foreground">
          Reconnect to resume live data feeds.
        </p>
      </div>
      <button
        type="button"
        onClick={() => setDismissed(true)}
        aria-label="Dismiss"
        className="ml-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        <X size={12} />
      </button>
    </div>
  );
}
