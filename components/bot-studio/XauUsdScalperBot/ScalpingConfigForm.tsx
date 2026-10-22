"use client";

import { useCallback, useState } from "react";
import { primitiveXauUsdScalpingConfigSchema } from "../config-form-schema";
import type { XauUsdScalpingConfig } from "@/lib/bot-studio/scalping";
import { XAUUSD_SCALPING_DEFAULTS } from "@/lib/bot-studio/scalping";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { TrendingUp, Shield, Wrench, DollarSign } from "lucide-react";

interface ScalpingConfigFormProps {
    config: XauUsdScalpingConfig;
    onChange: (next: XauUsdScalpingConfig) => void;
    className?: string;
}

export function ScalpingConfigForm({ config, onChange, className }: ScalpingConfigFormProps) {
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

    const field = (
        label: React.ReactNode,
        input: React.ReactNode,
        error?: string,
        hint?: React.ReactNode,
    ) => (
        <div className="space-y-1.5">
            <div className="flex items-center gap-1 text-xs font-medium text-foreground">
                {label}
            </div>
            {input}
            {error && <p className="text-[11px] text-warning">{error}</p>}
            {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
        </div>
    );

    return (
        <div className={cn("space-y-4", className)}>
            <div className="flex items-center gap-2">
                <Wrench className="size-4 text-muted-foreground" />
                <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Scalping Configuration
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
                    <option value="long">Long (buy dips, sell rallies)</option>
                    <option value="short">Short (sell rallies, buy dips)</option>
                </Select>,
            )}

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
                        className={cn(errors.tp1Pips && "border-warning")}
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
                        className={cn(errors.tp2Pips && "border-warning")}
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
                        className={cn(errors.slPips && "border-warning")}
                    />,
                    errors.slPips,
                )}
            </div>

            {/* Risk, spread cap, magic */}
            <div className="grid gap-3 sm:grid-cols-3">
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
            </div>

            {/* Max positions + enabled */}
            <div className="flex items-center gap-4">
                {field(
                    "Max positions",
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
                    "Enabled",
                    <input
                        type="checkbox"
                        checked={draft.enabled}
                        onChange={(e) => set("enabled", e.target.checked)}
                        className="h-4 w-4 rounded border-input accent-primary"
                    />,
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
                    Apply config
                </Button>
            </div>
        </div>
    );
}
