"use client";

// Partial close — the two modes are NEVER one ambiguous percentage.
//
//   Volume  "close 50% of the position" → close 50% of the size.
//   Profit  "lock 50% of the profit"    → close the quantity whose ACTUAL
//                                         expected net realized P&L equals 50%
//                                         of the position's current net
//                                         unrealized P&L, solved against the
//                                         executable price and the lot grid.
//
// Every number shown here comes from the server's `planPartialClose` — the
// exact plan the close will execute. The client never computes a P&L.

import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, Lock, Scissors, ShieldAlert } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { KV, Money } from "./primitives";
import { centiLotsToNumber, formatCents } from "@/lib/performance-arena/money";
import type { MarkedTrade } from "@/lib/performance-arena/types";
import type { PartialClosePlan } from "@/lib/performance-arena/partial-close";

type CloseMode = "VOLUME" | "PROFIT_PRESERVATION";

const PERCENT_PRESETS = [25, 50, 75, 100];

export function PartialCloseDialog({
    trade,
    attemptId,
    token,
    open,
    onOpenChange,
    onClosed,
    initialMode = "PROFIT_PRESERVATION",
    initialPercent = 50,
}: {
    trade: MarkedTrade | null;
    attemptId: string;
    token: string | null;
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onClosed: () => void;
    /** The shortcut that opened the dialog pre-selects its mode. */
    initialMode?: CloseMode;
    initialPercent?: number;
}) {
    const [mode, setMode] = useState<CloseMode>(initialMode);
    const [percent, setPercent] = useState(initialPercent);
    const [plan, setPlan] = useState<PartialClosePlan | null>(null);
    const [loading, setLoading] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const tradeId = trade?.trade.tradeId ?? null;

    // Mode/percent/plan initialize from the shortcut that opened the dialog;
    // the parent remounts this component (key) per intent, so no reset effect
    // is needed and no state write happens during an effect body.

    // A fresh server plan whenever the intent changes. The plan IS the preview.
    const loadPreview = useCallback(async (): Promise<void> => {
        if (!token || !tradeId) return;
        setLoading(true);
        setError(null);
        try {
            const res = await fetch(`/api/performance-arena/attempts/${attemptId}/orders`, {
                method: "POST",
                headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
                body: JSON.stringify({
                    action: "previewClose",
                    tradeId,
                    ...(mode === "PROFIT_PRESERVATION" ? { profitPercent: percent } : { percent }),
                }),
            });
            const body = (await res.json()) as { plan?: PartialClosePlan; error?: string };
            if (!res.ok || !body.plan) {
                setError(body.error ?? "Could not price this close.");
                setPlan(null);
                return;
            }
            setPlan(body.plan);
        } catch {
            setError("Could not price this close.");
            setPlan(null);
        } finally {
            setLoading(false);
        }
    }, [attemptId, token, tradeId, mode, percent]);

    useEffect(() => {
        if (!open) return;
        const kick = setTimeout(() => void loadPreview(), 120);
        return () => clearTimeout(kick);
    }, [open, loadPreview]);

    // Re-price right before confirming: the market moved since the last preview.
    const confirm = async () => {
        if (!token || !tradeId) return;
        setSubmitting(true);
        setError(null);
        try {
            await loadPreview();
            const res = await fetch(`/api/performance-arena/attempts/${attemptId}/orders`, {
                method: "POST",
                headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
                body: JSON.stringify({
                    action: "close",
                    tradeId,
                    ...(mode === "PROFIT_PRESERVATION" ? { profitPercent: percent } : { percent }),
                    clientRequestId: `close_${tradeId}_${Date.now()}`,
                }),
            });
            if (!res.ok) {
                const body = (await res.json()) as { error?: string };
                setError(body.error ?? "Close failed.");
                return;
            }
            onOpenChange(false);
            onClosed();
        } finally {
            setSubmitting(false);
        }
    };

    const body = useMemo(() => {
        if (!trade) return null;
        return {
            symbol: trade.trade.symbol,
            side: trade.trade.side,
            size: centiLotsToNumber(trade.trade.sizeCentiLots),
            unrealized: trade.unrealizedPnLCents,
        };
    }, [trade]);

    if (!trade || !body) return null;

    const blocked = plan?.blocked ?? [];
    const canConfirm = plan?.ok === true && plan.closeCentiLots > 0 && !submitting;

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-md">
                <DialogHeader>
                    <DialogTitle>
                        Close {body.symbol} · {body.side === "long" ? "Long" : "Short"} {body.size.toFixed(2)}
                    </DialogTitle>
                    <DialogDescription>
                        A percentage here means one of two different things. Pick the one you mean.
                    </DialogDescription>
                </DialogHeader>

                {/* Mode switch — the distinction is the whole point of this dialog. */}
                <div role="radiogroup" aria-label="Partial close mode" className="grid grid-cols-2 gap-2">
                    <button
                        type="button"
                        role="radio"
                        aria-checked={mode === "PROFIT_PRESERVATION"}
                        onClick={() => setMode("PROFIT_PRESERVATION")}
                        className={`flex flex-col items-start gap-0.5 rounded-md border p-2.5 text-left ${mode === "PROFIT_PRESERVATION" ? "border-primary bg-primary/10" : "border-border hover:bg-muted"}`}
                    >
                        <span className="flex items-center gap-1.5 text-xs font-medium">
                            <Lock className="h-3 w-3" /> Lock % of profit
                        </span>
                        <span className="text-micro text-muted-foreground">Realize a share of the open profit; the rest keeps running.</span>
                    </button>
                    <button
                        type="button"
                        role="radio"
                        aria-checked={mode === "VOLUME"}
                        onClick={() => setMode("VOLUME")}
                        className={`flex flex-col items-start gap-0.5 rounded-md border p-2.5 text-left ${mode === "VOLUME" ? "border-primary bg-primary/10" : "border-border hover:bg-muted"}`}
                    >
                        <span className="flex items-center gap-1.5 text-xs font-medium">
                            <Scissors className="h-3 w-3" /> Close % of volume
                        </span>
                        <span className="text-micro text-muted-foreground">Sell a share of the position size, profit or not.</span>
                    </button>
                </div>

                <div className="space-y-1.5">
                    <label className="text-xs text-muted-foreground" htmlFor="partial-close-percent">
                        {mode === "PROFIT_PRESERVATION" ? "Percent of current profit to lock" : "Percent of position volume to close"}
                    </label>
                    <div className="flex items-center gap-2">
                        <input
                            id="partial-close-percent"
                            type="number"
                            min={1}
                            max={100}
                            step={1}
                            value={percent}
                            onChange={(event) => setPercent(Math.min(100, Math.max(1, Number(event.target.value) || 0)))}
                            className="w-20 rounded-md border border-border bg-background px-2 py-1 font-mono text-xs"
                        />
                        <span className="text-xs text-muted-foreground">%</span>
                        <div className="ml-auto flex gap-1">
                            {PERCENT_PRESETS.map((preset) => (
                                <button
                                    key={preset}
                                    type="button"
                                    onClick={() => setPercent(preset)}
                                    className={`rounded border px-2 py-1 font-mono text-micro ${percent === preset ? "border-primary text-primary" : "border-border text-muted-foreground hover:bg-muted"}`}
                                >
                                    {preset}%
                                </button>
                            ))}
                        </div>
                    </div>
                </div>

                <div className="rounded-md border border-border bg-muted/40 p-3">
                    <div className="mb-1 flex items-center justify-between text-xs">
                        <span className="text-muted-foreground">Current unrealized</span>
                        <Money cents={body.unrealized} signed />
                    </div>
                    {loading ? (
                        <p className="flex items-center gap-1.5 py-3 text-xs text-muted-foreground">
                            <Loader2 className="h-3 w-3 animate-spin" /> Pricing against the live executable price…
                        </p>
                    ) : plan ? (
                        <>
                            <KV label="Execution price" value={plan.executionPrice ? plan.executionPrice.toLocaleString(undefined, { maximumFractionDigits: 6 }) : "—"} />
                            {mode === "PROFIT_PRESERVATION" ? (
                                <KV
                                    label={`Target profit (${percent}%)`}
                                    value={plan.targetCents === null ? "—" : <Money cents={plan.targetCents} signed />}
                                />
                            ) : null}
                            <KV label="Quantity to close" value={centiLotsToNumber(plan.closeCentiLots).toFixed(2)} />
                            <KV label="Quantity remaining" value={centiLotsToNumber(plan.remainingCentiLots).toFixed(2)} />
                            <KV label="Estimated fees" value={<Money cents={-plan.expectedCostCents} signed />} />
                            <KV
                                label={plan.isFullClose ? "Expected realized (full close)" : "Estimated realized P&L"}
                                value={<Money cents={plan.expectedNetCents} signed />}
                            />
                            {plan.remainingNetCents !== 0 && !plan.isFullClose ? (
                                <KV label="Remaining unrealized" value={<Money cents={plan.remainingNetCents} signed />} />
                            ) : null}
                            <p className="mt-2 border-t border-border pt-2 text-micro text-muted-foreground">{plan.message}</p>
                            {plan.warnings.map((warning) => (
                                <p key={warning} className="mt-1 text-micro text-warning">{warning}</p>
                            ))}
                        </>
                    ) : (
                        <p className="py-3 text-xs text-muted-foreground">{error ?? "Preview unavailable."}</p>
                    )}
                </div>

                {blocked.length > 0 ? (
                    <p role="alert" className="flex items-start gap-1.5 rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">
                        <ShieldAlert className="mt-0.5 h-3 w-3 shrink-0" />
                        {plan?.message ?? "This close cannot be executed safely."}
                    </p>
                ) : null}
                {error && plan ? <p role="alert" className="text-xs text-destructive">{error}</p> : null}

                <DialogFooter>
                    <Button variant="outline" size="xs" onClick={() => onOpenChange(false)} disabled={submitting}>
                        Cancel
                    </Button>
                    <Button
                        size="xs"
                        onClick={() => void confirm()}
                        disabled={!canConfirm}
                        title={blocked.length > 0 ? (plan?.message ?? "Blocked") : undefined}
                    >
                        {submitting ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
                        {mode === "PROFIT_PRESERVATION" ? `Lock ${percent}% profit (${formatCents(Math.max(0, plan?.expectedNetCents ?? 0))})` : `Close ${percent}% volume`}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}