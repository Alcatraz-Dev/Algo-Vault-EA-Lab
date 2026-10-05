"use client";

/**
 * useChartSettings — the single source of truth for the Pro Terminal chart's
 * user preferences (theme preset, colors, display flags, drawing-tool style).
 *
 * State is loaded once from localStorage and written back on every change, so
 * the same toolbar + chart settings apply across symbols, reloads and both
 * terminal surfaces (ProScalpingTerminal and ProTerminalChartWorkspace).
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
    defaultChartSettings,
    loadChartSettings,
    saveChartSettings,
    type ChartSettings,
} from "@/components/pro-scalping-terminal/chart-settings";

export interface UseChartSettingsResult {
    settings: ChartSettings;
    /** Functional update; the result is validated/merged onto the defaults. */
    update: (fn: (prev: ChartSettings) => ChartSettings) => void;
    /** Restore the active preset's defaults (keeps nothing user-customised). */
    reset: () => void;
}

export function useChartSettings(): UseChartSettingsResult {
    const [settings, setSettings] = useState<ChartSettings>(() => defaultChartSettings());
    const hydrated = useRef(false);
    const dirty = useRef(false);

    // Hydrate after mount (localStorage is unavailable during SSR).
    useEffect(() => {
        if (hydrated.current) return;
        hydrated.current = true;
        setSettings(loadChartSettings());
    }, []);

    // Persist only genuine user changes — the hydration pass must never
    // clobber the stored preferences with the initial defaults.
    useEffect(() => {
        if (!dirty.current) return;
        saveChartSettings(settings);
    }, [settings]);

    const update = useCallback((fn: (prev: ChartSettings) => ChartSettings) => {
        dirty.current = true;
        setSettings((prev) => fn(prev));
    }, []);

    const reset = useCallback(() => {
        dirty.current = true;
        setSettings((prev) => defaultChartSettings(prev.preset));
    }, []);

    return { settings, update, reset };
}
