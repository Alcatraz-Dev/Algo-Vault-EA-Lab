"use client";

// Order ticket — submits INTENT only (symbol, side, size, stop/TP). Prices,
// costs, fills, PnL and rule evaluation are computed server-side. Rule
// rejections (422 RULE_VIOLATION) render with the engine's own messages.

import { useState } from "react";
import { ArrowDownRight, ArrowUpRight, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { RuleEvent } from "@/lib/performance-arena/types";

export interface OrderTicketResult {
    ok: boolean;
    error?: string;
    violations?: RuleEvent[];
}

export function OrderTicket({
    attemptId,
    symbols,
    disabled,
    maxLots,
    onPlaced,
}: {
    attemptId: string;
    symbols: string[];
    disabled: boolean;
    maxLots: number;
    onPlaced: () => void;
}) {
    const [symbol, setSymbol] = useState(symbols[0] ?? "EURUSD");
    const [side, setSide] = useState<"long" | "short">("long");
    const [size, setSize] = useState("0.10");
    const [stopLoss, setStopLoss] = useState("");
    const [takeProfit, setTakeProfit] = useState("");
    const [busy, setBusy] = useState(false);
    const [result, setResult] = useState<OrderTicketResult | null>(null);

    const submit = async () => {
        setBusy(true);
        setResult(null);
        try {
            const token = await import("@/lib/firebase").then((m) => m.auth.currentUser?.getIdToken());
            if (!token) throw new Error("Sign in required.");
            const res = await fetch(`/api/performance-arena/attempts/${attemptId}/orders`, {
                method: "POST",
                headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
                body: JSON.stringify({
                    action: "market",
                    symbol,
                    side,
                    sizeLots: Number(size),
                    stopLoss: stopLoss ? Number(stopLoss) : null,
                    takeProfit: takeProfit ? Number(takeProfit) : null,
                    clientRequestId: `${attemptId}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
                }),
            });
            const body = (await res.json()) as { error?: string; violations?: RuleEvent[] };
            if (!res.ok) {
                setResult({ ok: false, error: body.error ?? "Order rejected.", violations: body.violations });
                return;
            }
            setResult({ ok: true });
            onPlaced();
        } catch (err) {
            setResult({ ok: false, error: err instanceof Error ? err.message : "Order failed." });
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className="rounded-lg border border-border bg-card">
            <div className="border-b border-border px-4 py-3">
                <h3 className="text-sm font-semibold">Simulated order</h3>
                <p className="text-[11px] text-muted-foreground">Market execution at the server-resolved live quote. Virtual only.</p>
            </div>

            <div className="space-y-3 p-4">
                <div className="grid grid-cols-2 gap-2">
                    <label className="text-xs text-muted-foreground">
                        Symbol
                        <select
                            value={symbol}
                            onChange={(e) => setSymbol(e.target.value)}
                            disabled={disabled}
                            className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground"
                        >
                            {symbols.map((s) => (
                                <option key={s} value={s}>{s}</option>
                            ))}
                        </select>
                    </label>
                    <label className="text-xs text-muted-foreground">
                        Size (lots)
                        <input
                            type="number"
                            step="0.01"
                            min="0.01"
                            max={maxLots}
                            value={size}
                            onChange={(e) => setSize(e.target.value)}
                            disabled={disabled}
                            className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1.5 font-mono text-sm text-foreground"
                        />
                    </label>
                </div>

                <div className="grid grid-cols-2 gap-2">
                    <Button
                        size="sm"
                        variant={side === "long" ? "default" : "outline"}
                        disabled={disabled}
                        onClick={() => setSide("long")}
                        className={side === "long" ? "bg-emerald-600 hover:bg-emerald-700 text-white" : ""}
                    >
                        <ArrowUpRight className="h-3.5 w-3.5" /> Long
                    </Button>
                    <Button
                        size="sm"
                        variant={side === "short" ? "default" : "outline"}
                        disabled={disabled}
                        onClick={() => setSide("short")}
                        className={side === "short" ? "bg-red-600 hover:bg-red-700 text-white" : ""}
                    >
                        <ArrowDownRight className="h-3.5 w-3.5" /> Short
                    </Button>
                </div>

                <div className="grid grid-cols-2 gap-2">
                    <label className="text-xs text-muted-foreground">
                        Stop-loss (optional)
                        <input
                            type="number"
                            step="0.00001"
                            value={stopLoss}
                            onChange={(e) => setStopLoss(e.target.value)}
                            disabled={disabled}
                            placeholder="price"
                            className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1.5 font-mono text-sm text-foreground"
                        />
                    </label>
                    <label className="text-xs text-muted-foreground">
                        Take-profit (optional)
                        <input
                            type="number"
                            step="0.00001"
                            value={takeProfit}
                            onChange={(e) => setTakeProfit(e.target.value)}
                            disabled={disabled}
                            placeholder="price"
                            className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1.5 font-mono text-sm text-foreground"
                        />
                    </label>
                </div>

                <Button className="w-full" disabled={disabled || busy} onClick={() => void submit()}>
                    {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                    {busy ? "Submitting…" : "Place simulated order"}
                </Button>

                {disabled ? (
                    <p className="text-[11px] text-muted-foreground">Trading is unavailable while the challenge is not ACTIVE.</p>
                ) : null}

                {result && !result.ok ? (
                    <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive">
                        <p>{result.error}</p>
                        {result.violations?.length ? (
                            <ul className="mt-1 space-y-0.5">
                                {result.violations.map((v, i) => (
                                    <li key={i}>• {v.message}</li>
                                ))}
                            </ul>
                        ) : null}
                    </div>
                ) : null}
                {result?.ok ? (
                    <p className="rounded-md border border-emerald-500/30 bg-emerald-500/10 p-3 text-xs text-emerald-600">
                        Order filled at the server-resolved quote. Rules evaluated — see rule events.
                    </p>
                ) : null}
            </div>
        </div>
    );
}
