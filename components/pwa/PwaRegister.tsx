"use client";

import { useEffect, useState } from "react";

export default function PwaRegister() {
  const [swRegistration, setSwRegistration] = useState<ServiceWorkerRegistration | null>(null);
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;

    const registerSW = async () => {
      try {
        const registration = await navigator.serviceWorker.register("/sw.js", {
          scope: "/",
        });
        setSwRegistration(registration);

        registration.addEventListener("updatefound", () => {
          const newWorker = registration.installing;
          if (!newWorker) return;

          newWorker.addEventListener("statechange", () => {
            if (newWorker.state === "installed" && navigator.serviceWorker.controller) {
              setUpdateAvailable(true);
            }
          });
        });
      } catch (error) {
        console.warn("[PWA] Service worker registration failed:", error);
      }
    };

    registerSW();

    const handleOnline = () => setOffline(false);
    const handleOffline = () => setOffline(true);

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    setOffline(!navigator.onLine);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  const applyUpdate = () => {
    if (swRegistration?.waiting) {
      swRegistration.waiting.postMessage({ type: "SKIP_WAITING" });
      window.location.reload();
    }
  };

  if (!updateAvailable && !offline) return null;

  return (
    <div
      className="fixed bottom-4 left-4 right-4 md:left-auto md:right-4 md:bottom-4 md:w-auto z-50 flex flex-col gap-2 pointer-events-none"
      role="status"
      aria-live="polite"
    >
      {updateAvailable && (
        <div
          className="pointer-events-auto rounded-xl border border-amber-500/30 bg-amber-500/10 backdrop-blur-sm px-4 py-3 shadow-lg flex items-center gap-3 max-w-sm animate-slide-up"
          role="alert"
        >
          <svg className="h-5 w-5 text-amber-400 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
          </svg>
          <span className="text-sm text-amber-300 flex-1">A new version of AlgoVault is available.</span>
          <button
            onClick={applyUpdate}
            className="shrink-0 rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-400 transition"
          >
            Update
          </button>
          <button
            onClick={() => setUpdateAvailable(false)}
            className="shrink-0 rounded-lg bg-transparent px-2 py-1.5 text-xs text-amber-300 hover:bg-amber-500/10 transition"
            aria-label="Dismiss"
          >
            Later
          </button>
        </div>
      )}

      {offline && (
        <div
          className="pointer-events-auto rounded-xl border border-rose-500/30 bg-rose-500/10 backdrop-blur-sm px-4 py-3 shadow-lg flex items-center gap-3 max-w-sm animate-slide-up"
          role="alert"
        >
          <svg className="h-5 w-5 text-rose-400 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="1" y1="1" x2="23" y2="23" />
            <path d="M16.72 11.06A10.94 10.94 0 0 1 19 12.55" />
            <path d="M5 12.55a10.94 10.94 0 0 1 5.17-2.39" />
            <path d="M10.71 5.05A16 16 0 0 1 22.58 9" />
            <path d="M1.42 9a15.91 15.91 0 0 1 4.7-2.88" />
            <path d="M8.53 16.11a6 6 0 0 1 6.95 0" />
            <line x1="12" y1="20" x2="12.01" y2="20" />
          </svg>
          <span className="text-sm text-rose-300 flex-1">You're offline. Live data unavailable.</span>
        </div>
      )}
    </div>
  );
}