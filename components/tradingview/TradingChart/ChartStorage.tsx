"use client";

import { useCallback, useEffect, useRef } from "react";
import type { ChartLayout } from "./types";

const STORAGE_KEY = "trading_chart_layout";

export default function ChartStorage({
    layout,
    onLoad,
}: {
    layout: ChartLayout;
    onLoad?: (layout: ChartLayout) => void;
}) {
    const isFirstLoad = useRef(true);

    useEffect(() => {
        try {
            const saved = localStorage.getItem(STORAGE_KEY);
            if (saved) {
                const parsed = JSON.parse(saved) as ChartLayout;
                onLoad?.(parsed);
            }
        } catch {
            // Ignore parse errors
        }
    }, [onLoad]);

    const save = useCallback(
        (layoutToSave: ChartLayout = layout) => {
            try {
                localStorage.setItem(STORAGE_KEY, JSON.stringify(layoutToSave));
            } catch {
                // Ignore storage errors
            }
        },
        [layout]
    );

    useEffect(() => {
        if (isFirstLoad.current) {
            isFirstLoad.current = false;
            return;
        }
        save();
    }, [layout, save]);

    return null;
}
