"use client";

import { useEffect, useRef, useState } from "react";

// Connectivity detection that trusts neither `navigator.onLine` nor a single
// failed request. `navigator.onLine` only reports whether some network
// interface claims a route — VPN handoffs, hotspot negotiation and sandboxed
// browser environments (Cypress, Playwright, iOS Safari) routinely report
// `false` while the network works fine, which used to trigger the "You're
// offline" banner for users who were actually online.
//
// Instead:
//   1. `offline` event → verify with a real fetch before showing the banner.
//   2. A failing probe re-checks twice more (debounced) so a single dropped
//      request never takes the app "offline".
//   3. `online` event → re-probe immediately so the banner clears fast.

const PROBE_TIMEOUT_MS = 8000;
const CONFIRM_PROBE_DELAY_MS = 2500;

export default function PwaRegister() {
    const [swRegistration, setSwRegistration] = useState<ServiceWorkerRegistration | null>(null);
    const [updateAvailable, setUpdateAvailable] = useState(false);
    const [offline, setOffline] = useState(false);

    const offlineRef = useRef(false);
    const probingRef = useRef(false);
    const confirmTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(() => {
        if (typeof window === "undefined") return;

        const clearConfirmTimer = () => {
            if (confirmTimerRef.current) {
                clearTimeout(confirmTimerRef.current);
                confirmTimerRef.current = null;
            }
        };

        // One reachability check. Resolves true only when a request to our own
        // origin actually succeeds — never from the navigator.onLine flag.
        const probeNetwork = (): Promise<boolean> => {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
            return fetch("/api/health", { cache: "no-store", signal: controller.signal })
                .then((res) => (res.ok ? true : false))
                .catch(() => false)
                .finally(() => clearTimeout(timer));
        };

        const setOfflineState = (value: boolean) => {
            if (offlineRef.current !== value) {
                offlineRef.current = value;
                setOffline(value);
            }
        };

        // Re-check before flipping state, so one dropped request or event
        // cannot show a false "offline" banner.
        const runProbe = async () => {
            if (probingRef.current) return;
            probingRef.current = true;
            try {
                const reachable = await probeNetwork();
                if (reachable) {
                    clearConfirmTimer();
                    setOfflineState(false);
                    return;
                }
                if (!offlineRef.current && confirmTimerRef.current === null) {
                    confirmTimerRef.current = setTimeout(() => {
                        confirmTimerRef.current = null;
                        // Second failure in a row → genuinely offline.
                        void probeNetwork().then((confirmed) => {
                            if (!confirmed) setOfflineState(true);
                        });
                    }, CONFIRM_PROBE_DELAY_MS);
                }
            } finally {
                probingRef.current = false;
            }
        };

        const handleOnline = () => {
            clearConfirmTimer();
            void runProbe();
        };

        const handleOfflineEvent = () => {
            // navigator.onLine is unreliable — verify with a real request
            // before believing the event.
            void runProbe();
        };

        const handleVisibility = () => {
            if (document.visibilityState === "visible") {
                clearConfirmTimer();
                void runProbe();
            }
        };

        // Seed state: assume online, then verify once in the background.
        setOfflineState(false);
        void runProbe();

        window.addEventListener("online", handleOnline);
        window.addEventListener("offline", handleOfflineEvent);
        document.addEventListener("visibilitychange", handleVisibility);

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

        if ("serviceWorker" in navigator) registerSW();

        return () => {
            window.removeEventListener("online", handleOnline);
            window.removeEventListener("offline", handleOfflineEvent);
            document.removeEventListener("visibilitychange", handleVisibility);
            clearConfirmTimer();
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
                    <span className="text-sm text-rose-300 flex-1">You&apos;re offline. Live data unavailable.</span>
                </div>
            )}
        </div>
    );
}
