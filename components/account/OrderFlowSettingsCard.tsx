"use client";

/**
 * Order Flow settings card — account settings → Integrations tab.
 *
 * Edits the user's calculation parameters (value area %, imbalance threshold,
 * sensitivity knobs, heatmap/L2 options) through useOrderFlowSettings, which
 * persists to Firebase Realtime DB via /api/order-flow/settings and caches in
 * localStorage. Matches the compact 1px-border SaaS design language.
 */

import { useState } from "react";
import { Activity, RotateCcw } from "lucide-react";
import { useOrderFlowSettings } from "@/hooks/use-order-flow-settings";
import { ORDER_FLOW_FLAGS } from "@/lib/order-flow/settings";

function NumField({
    label,
    value,
    min,
    max,
    step,
    onChange,
    hint,
}: {
    label: string;
    value: number;
    min: number;
    max: number;
    step: number;
    onChange: (v: number) => void;
    hint?: string;
}) {
    return (
        <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-muted-foreground">{label}</span>
            <input
                type="number"
                value={value}
                min={min}
                max={max}
                step={step}
                onChange={(e) => {
                    const n = Number(e.target.value);
                    if (Number.isFinite(n)) onChange(n);
                }}
                className="w-full rounded-xl border border-border bg-muted/50 px-3 py-2 text-sm tabular-nums text-foreground focus:border-foreground/40 focus:outline-none focus:ring-1 focus:ring-border/50"
            />
            {hint ? <span className="text-micro leading-4 text-muted-foreground">{hint}</span> : null}
        </label>
    );
}

export function OrderFlowSettingsCard() {
    const { settings, update, reset, synced } = useOrderFlowSettings();
    const [savedFlash, setSavedFlash] = useState(false);

    const flash = () => {
        setSavedFlash(true);
        setTimeout(() => setSavedFlash(false), 1200);
    };

    return (
        <div className="rounded-lg border border-border bg-foreground/[0.035] p-6 backdrop-blur-xl">
            <div className="mb-1 flex items-center justify-between gap-2">
                <h2 className="flex items-center gap-2 text-lg font-semibold text-foreground">
                    <Activity className="size-4 text-primary" />
                    Order Flow Intelligence
                </h2>
                <span className="rounded-full border border-border px-2 py-0.5 text-micro uppercase tracking-wide text-muted-foreground">
                    {ORDER_FLOW_FLAGS["orderFlow.enabled"] ? "Enabled" : "Disabled by flag"}
                </span>
            </div>
            <p className="mb-5 text-xs text-muted-foreground">
                Calculation parameters for Volume Profile, delta and behavioural event detection. Values apply to the chart
                overlays, Scalping Terminal panel and AI evidence pipeline. Data-quality states never change with these
                settings — unavailable data stays unavailable.
            </p>

            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <NumField
                    label="Value area %"
                    value={settings.valueAreaPercent}
                    min={50}
                    max={95}
                    step={1}
                    onChange={(v) => {
                        update({ valueAreaPercent: v });
                        flash();
                    }}
                    hint="Volume area around the POC (default 70%)."
                />
                <NumField
                    label="Profile bins"
                    value={settings.profileBins}
                    min={8}
                    max={200}
                    step={1}
                    onChange={(v) => {
                        update({ profileBins: v });
                        flash();
                    }}
                    hint="Price levels in the volume profile."
                />
                <NumField
                    label="Imbalance threshold"
                    value={settings.imbalanceThreshold}
                    min={1.2}
                    max={20}
                    step={0.1}
                    onChange={(v) => {
                        update({ imbalanceThreshold: v });
                        flash();
                    }}
                    hint="Dominance ratio (e.g. 3 = 3:1) for footprint imbalances."
                />
                <NumField
                    label="Absorption sensitivity"
                    value={settings.absorptionSensitivity}
                    min={0}
                    max={1}
                    step={0.05}
                    onChange={(v) => {
                        update({ absorptionSensitivity: v });
                        flash();
                    }}
                    hint="Higher fires more events (looser evidence gates)."
                />
                <NumField
                    label="Exhaustion sensitivity"
                    value={settings.exhaustionSensitivity}
                    min={0}
                    max={1}
                    step={0.05}
                    onChange={(v) => {
                        update({ exhaustionSensitivity: v });
                        flash();
                    }}
                    hint="Higher flags extensions earlier."
                />
                <NumField
                    label="Large-trade percentile"
                    value={settings.largeTradePercentile}
                    min={0.5}
                    max={1}
                    step={0.01}
                    onChange={(v) => {
                        update({ largeTradePercentile: v });
                        flash();
                    }}
                    hint="Requires the trade tape (currently unavailable on this feed)."
                />
                <NumField
                    label="Liquidity wall size"
                    value={settings.liquidityWallThreshold}
                    min={0}
                    max={1_000_000}
                    step={10}
                    onChange={(v) => {
                        update({ liquidityWallThreshold: v });
                        flash();
                    }}
                    hint="Resting size that marks a wall — needs Level 2 data."
                />
                <NumField
                    label="Heatmap intensity"
                    value={settings.heatmapIntensity}
                    min={0.05}
                    max={1}
                    step={0.05}
                    onChange={(v) => {
                        update({ heatmapIntensity: v });
                        flash();
                    }}
                    hint="Renderer alpha for the L2 heatmap (needs Level 2 data)."
                />
                <NumField
                    label="Heatmap history depth"
                    value={settings.heatmapHistoryDepth}
                    min={10}
                    max={1000}
                    step={10}
                    onChange={(v) => {
                        update({ heatmapHistoryDepth: v });
                        flash();
                    }}
                    hint="Snapshots retained for the heatmap."
                />
            </div>

            <div className="mt-5 flex items-center gap-3">
                <button
                    type="button"
                    onClick={reset}
                    className="inline-flex items-center gap-1.5 rounded-xl border border-border px-3 py-1.5 text-xs text-muted-foreground transition hover:bg-muted"
                >
                    <RotateCcw className="size-3" />
                    Reset to defaults
                </button>
                <span className="text-micro text-muted-foreground">
                    {savedFlash ? "Saved ✓" : synced ? "Synced to your account" : "Saving to this device until you sign in"}
                </span>
            </div>

            <p className="mt-4 border-t border-border/60 pt-3 text-micro leading-4 text-muted-foreground">
                Current feed provides OHLCV only. True bid/ask delta, footprint, Level 2 liquidity/heatmap and GEX stay
                explicitly unavailable until a provider with that data is connected — the platform never substitutes
                estimates for those capabilities.
            </p>
        </div>
    );
}
