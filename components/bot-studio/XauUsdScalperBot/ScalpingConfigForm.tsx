"use client";

import { useCallback, useState, useMemo } from "react";
import { primitiveXauUsdScalpingConfigSchema } from "../config-form-schema";
import type { XauUsdScalpingConfig } from "@/lib/bot-studio/scalping";
import { XAUUSD_SCALPING_DEFAULTS, deriveLevels, formatPipDistance } from "@/lib/bot-studio/scalping";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { TrendingUp, Shield, Wrench, DollarSign, Zap } from "lucide-react";

interface ScalpingConfigFormProps {
    config: XauUsdScalpingConfig;
    onChange: (next: XauUsdScalpingConfig) => void;
    /** Live market price from the chart feed, if available. */
    currentPrice?: number;
    className?: string;
}

export function ScalpingConfigForm({ config, onChange, currentPrice, className }: ScalpingConfigFormProps) {
    const [draft, setDraft] = useState<XauUsdScalpingConfig>(config);
    const [errors, setErrors] = useState<Record<string, string>>({});

    const validate = useCallback((): boolean => {
        const result = primitiveXauUsdScalpingConfigSchema.safeParse(draft);
        if (!result.success) {
            const fieldErrors: Record<string, string> = {};
            for (const issue of result.error.issues) {
                const path = issue.path[0];
                if (typeof path === "string") {
                    fieldErrors[path] = issue.message;
                }
            }
            setErrors(fieldErrors);
            return false;
        }
        setErrors({});
        return true;
    }, [draft]);

    const commit = useCallback(() => {
        if (validate()) {
            onChange(draft);
        }
    }, [validate, draft, onChange]);

    const set = useCallback(
        <K extends keyof XauUsdScalpingConfig>(key: K, value: XauUsdScalpingConfig[K]) => {
            setDraft((prev) => ({ ...prev, [key]: value }));
        },
        [],
    );

    const preview = useMemo(() => {
        // Use live market price when available so the level readout is meaningful.
        const entry = currentPrice != null && currentPrice > 0 ? currentPrice : 2650.00;
        const levels = deriveLevels(entry, config.tp1Pips, config.tp2Pips, config.slPips, config.direction);
        return { entry, ...levels };
    }, [config.direction, config.tp1Pips, config.tp2Pips, config.slPips, currentPrice]);

    const field = (
        label: React.ReactNode,
        input: React.ReactNode,
        error?: string,
        hint?: React.ReactNode,
    ) => (
        <div className="space-y-1.5">
            <div className="flex items-center gap-1.5 text-xs font-medium text-foreground">
                {label}
            </div>
            {input}
            {error && <p className="text-[11px] text-destructive">{error}</p>}
            {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
        </div>
    );

    return (
        <div className={cn("space-y-4", className)}>
            <div className="flex items-center gap-2">
                <Zap className="size-4 text-muted-foreground" />
                <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Scalper Config
                </h3>
            </div>

            {/* Direction */}
            {field(
                "Direction",
                <Select
                    className="text-sm"
                    value={draft.direction}
                    onChange={(e) => set("direction", e.target.value as "long" | "short")}
                >
                    <option value="long">Long — buy dips, exit rallies</option>
                    <option value="short">Short — sell rallies, exit dips</option>
                </Select>,
            )}

            {/* Level preview */}
            <div className="rounded-lg border border-border bg-muted/40 p-3 text-[11px]">
                <div className="mb-2 flex items-center justify-between">
                    <span className="font-medium text-foreground">Level preview</span>
                    <span className="text-muted-foreground">
                        {currentPrice != null && currentPrice > 0
                            ? `entry {currentPrice.toFixed(2)}`
                            : `entry ≈ ${preview.entry.toFixed(2)}`}
                    </span>
                </div>
                <div className="grid grid-cols-3 gap-2 text-center font-mono">
                    <div className="bg-positive/10 rounded px-2 py-1 text-positive">
                        <div className="text-[10px] text-muted-foreground">TP1</div>
                        <div className="text-sm font-semibold">{preview.tp1.toFixed(2)}</div>
                        <div className="text-[10px] text-muted-foreground">{formatPipDistance(config.tp1Pips)}</div>
                    </div>
                    <div className="bg-positive/10 rounded px-2 py-1 text-positive">
                        <div className="text-[10px] text-muted-foreground">TP2</div>
                        <div className="text-sm font-semibold">{preview.tp2.toFixed(2)}</div>
                        <div className="text-[10px] text-muted-foreground">{formatPipDistance(config.tp2Pips)}</div>
                    </div>
                    <div className="bg-negative/10 rounded px-2 py-1 text-negative">
                        <div className="text-[10px] text-muted-foreground">SL</div>
                        <div className="text-sm font-semibold">{preview.sl.toFixed(2)}</div>
                        <div className="text-[10px] text-muted-foreground">{formatPipDistance(config.slPips)}</div>
                    </div>
                </div>
                <p className="mt-2 text-[10px] text-muted-foreground">
                    TP1 closes 50% of the position, TP2 closes the remainder.
                    SL is firm for the full position.
                </p>
            </div>

            {/* TP1 / TP2 / SL */}
            <div className="grid gap-3 sm:grid-cols-3">
                {field(
                    <>
                        <TrendingUp className="size-3" />
                        TP1 (pips)
                    </>,
                    <Input
                        type="number"
                        min={1}
                        max={200}
                        step={1}
                        value={draft.tp1Pips}
                        onChange={(e) => set("tp1Pips", Number(e.target.value))}
                        className={cn(errors.tp1Pips && "border-destructive")}
                    />,
                    errors.tp1Pips,
                )}
                {field(
                    <>
                        <TrendingUp className="size-3" />
                        TP2 (pips)
                    </>,
                    <Input
                        type="number"
                        min={1}
                        max={400}
                        step={1}
                        value={draft.tp2Pips}
                        onChange={(e) => set("tp2Pips", Number(e.target.value))}
                        className={cn(errors.tp2Pips && "border-destructive")}
                    />,
                    errors.tp2Pips,
                )}
                {field(
                    <>
                        <Shield className="size-3" />
                        SL (pips)
                    </>,
                    <Input
                        type="number"
                        min={1}
                        max={400}
                        step={1}
                        value={draft.slPips}
                        onChange={(e) => set("slPips", Number(e.target.value))}
                        className={cn(errors.slPips && "border-destructive")}
                    />,
                    errors.slPips,
                )}
            </div>

            {/* Risk, spread cap, magic, warmup */}
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {field(
                    <>
                        <DollarSign className="size-3" />
                        Risk % / trade
                    </>,
                    <Input
                        type="number"
                        min={0.1}
                        max={10}
                        step={0.1}
                        value={draft.riskPercent}
                        onChange={(e) => set("riskPercent", Number(e.target.value))}
                    />,
                    undefined,
                    "Of free margin; server caps final lot",
                )}
                {field(
                    <>
                        <Shield className="size-3" />
                        Max spread (pts)
                    </>,
                    <Input
                        type="number"
                        min={0}
                        max={100}
                        step={1}
                        value={draft.maxSpreadPoints}
                        onChange={(e) => set("maxSpreadPoints", Number(e.target.value))}
                    />,
                    undefined,
                    "Skip signal when spread exceeds this",
                )}
                {field(
                    <>
                        <Wrench className="size-3" />
                        Magic number
                    </>,
                    <Input
                        type="number"
                        min={1}
                        max={999999}
                        step={1}
                        value={draft.magicNumber}
                        onChange={(e) => set("magicNumber", Number(e.target.value))}
                    />,
                    undefined,
                    "Isolates bot orders from manual trades",
                )}
                {field(
                    <>
                        <Wrench className="size-3" />
                        Warm-up (candles)
                    </>,
                    <Input
                        type="number"
                        min={0}
                        max={500}
                        step={1}
                        value={draft.warmUpCandles}
                        onChange={(e) => set("warmUpCandles", Number(e.target.value))}
                    />,
                    undefined,
                    "Bars to load before first signal",
                )}
            </div>

            {/* Max positions + enabled */}
            <div className="flex items-center gap-4">
                {field(
                    "Max open positions",
                    <Select
                        className="text-sm w-24"
                        value={String(draft.maxPositions)}
                        onChange={(e) => set("maxPositions", Number(e.target.value))}
                    >
                        {[1, 2, 3, 5].map((n) => (
                            <option key={n} value={String(n)}>
                                {n}
                            </option>
                        ))}
                    </Select>,
                )}
                {field(
                    "Bot enabled",
                    <input
                        type="checkbox"
                        checked={draft.enabled}
                        onChange={(e) => set("enabled", e.target.checked)}
                        className="h-4 w-4 rounded border-input accent-primary"
                    />,
                    undefined,
                    "Disabled bots skip signals but keep config",
                )}
            </div>

            <Separator />

            <div className="flex items-center justify-end gap-2">
                <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setDraft(XAUUSD_SCALPING_DEFAULTS)}
                >
                    Reset defaults
                </Button>
                <Button
                    type="button"
                    size="sm"
                    onClick={commit}
                    className="bg-primary text-white hover:bg-primary/90"
                >
                    Save config
                </Button>
            </div>
        </div>
    );
}
