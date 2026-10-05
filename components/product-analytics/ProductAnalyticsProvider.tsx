"use client";

/**
 * ProductAnalyticsProvider — mounts the analytics lifecycle.
 *
 * Two jobs, both required for the event pipeline to be reliable:
 *  1. Flush the buffered events when the page is hidden or closed, so a short
 *     session (read a chart, close the tab) is not silently lost.
 *  2. Replay the queued events when the browser comes back online, so a flaky
 *     connection does not permanently drop them.
 *
 * It renders nothing. Mounted once from the root layout.
 */

import { useEffect } from "react";
import { flush, installLifecycleFlush } from "@/lib/product-analytics/client";

export default function ProductAnalyticsProvider() {
    useEffect(() => installLifecycleFlush(), []);

    useEffect(() => {
        const onOnline = () => {
            void flush();
        };
        window.addEventListener("online", onOnline);
        return () => window.removeEventListener("online", onOnline);
    }, []);

    return null;
}
