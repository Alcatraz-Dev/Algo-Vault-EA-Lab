"use client";

// Order ticket — submits INTENT only (symbol, side, size, stop/TP). Prices,
// costs, fills, PnL and rule evaluation are computed server-side. Rule
// rejections (422 RULE_VIOLATION) render with the engine's own messages.

import { useEffect, useState } from "react";
import { ArrowDownRight, ArrowUpRight, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { RuleEvent } from "@/lib/performance-arena/types";
import { arenaSymbolSpec } from "@/lib/performance-arena/execution";

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
    selectedSymbol,
    onSymbolChange,
    currentQuote,
    policyStepLots = 0.01,
}: {
    attemptId: string;
    symbols: string[];
    disabled: boolean;
    maxLots: number;
    onPlaced: () => void;
    selectedSymbol?: string;
    onSymbolChange?: (symbol: string) => void;
    currentQuote?: { price: number; timestamp: number } | null;
    policyStepLots?: number;
}) {
    const [localSymbol, setLocalSymbol] = useState(symbols[0] ?? "EURUSD");
    const [localQuote, setLocalQuote] = useState<{ price: number; timestamp: number } | null>(null);
    const symbol = selectedSymbol ?? localSymbol;
    const quote = currentQuote === undefined ? localQuote : currentQuote;
    const [side, setSide] = useState<"long" | "short">("long");
    const [size, setSize] = useState("0.10");
    const [stopLoss, setStopLoss] = useState("");
    const [takeProfit, setTakeProfit] = useState("");
    const [orderType, setOrderType] = useState<"market" | "limit" | "stop">("market");
    const [entryPrice, setEntryPrice] = useState("");
    const [busy, setBusy] = useState(false);
    const [result, setResult] = useState<OrderTicketResult | null>(null);
    const instrument = arenaSymbolSpec(symbol);
    const lotStep = Math.max(instrument?.lotStep ?? 0.01, policyStepLots);
    const minLot = Math.max(instrument?.minLot ?? 0.01, policyStepLots);
    const effectiveMaxLots = Math.min(maxLots, instrument?.maxLot ?? maxLots);
    const quoteIsFresh = Boolean(quote && quote.timestamp <= Date.now() + 5_000 && Date.now() - quote.timestamp <= 60_000);
    const sizeNumber = Number(size);
    const stepUnits = sizeNumber / lotStep;
    const validSize = Number.isFinite(sizeNumber) && sizeNumber >= minLot && sizeNumber <= effectiveMaxLots && Math.abs(stepUnits - Math.round(stepUnits)) <= 1e-7;

    useEffect(() => {
        if (selectedSymbol || symbols.length === 0) return;
        let cancelled = false;
        const refreshQuote = async () => {
            try {
                const response = await fetch(`/api/market/quotes?symbols=${encodeURIComponent(symbol)}`, { cache: "no-store" });
                const body = await response.json() as { quotes?: Record<string, { price: number; timestamp: number }> };
                if (!cancelled) setLocalQuote(body.quotes?.[symbol] ?? null);
            } catch {
                if (!cancelled) setLocalQuote(null);
            }
        };
        void refreshQuote();
        const timer = window.setInterval(() => void refreshQuote(), 2_000);
        return () => { cancelled = true; window.clearInterval(timer); };
    }, [symbol, selectedSymbol, symbols.length]);

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
                    action: orderType,
                    symbol,
                    side,
                    sizeLots: Number(size),
                    ...(orderType !== "market" ? { entryPrice: Number(entryPrice) } : {}),
                    stopLoss: stopLoss === "" ? undefined : Number(stopLoss),
                    takeProfit: takeProfit === "" ? undefined : Number(takeProfit),
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
                <h3 className="text-sm font-semibold">Order ticket</h3>
                <p className="text-[11px] text-muted-foreground">Virtual execution · market fills use the server’s latest quote and configured costs.</p>
            </div>

            <div className="space-y-3 p-4">
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    <label className="text-xs text-muted-foreground">
                        Symbol
                        <select
                            value={symbol}
                            onChange={(e) => { setLocalSymbol(e.target.value); onSymbolChange?.(e.target.value); }}
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
                            step={lotStep}
                            min={minLot}
                            max={effectiveMaxLots}
                            value={size}
                            onChange={(e) => setSize(e.target.value)}
                            disabled={disabled}
                            className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1.5 font-mono text-sm text-foreground"
                        />
                    </label>
                </div>

                <label className="block text-xs text-muted-foreground">
                    Order type
                    <select value={orderType} onChange={(event) => setOrderType(event.target.value as typeof orderType)} disabled={disabled} className="mt-1 w-full rounded-md border border-border bg-background px-2 py-2 text-sm text-foreground">
                        <option value="market">Market</option>
                        <option value="limit">Limit</option>
                        <option value="stop">Stop</option>
                    </select>
                </label>
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-muted/40 px-3 py-2 text-xs">
                    <span className="text-muted-foreground">{symbol} live quote</span>
                    {quote && quoteIsFresh ? <span className="font-mono font-medium text-foreground">{quote.price.toLocaleString(undefined, { maximumFractionDigits: 6 })} <span className="text-[10px] text-muted-foreground">{new Date(quote.timestamp).toLocaleTimeString()} · live</span></span> : <span className="text-amber-600">{quote ? "Quote stale" : "Quote unavailable"}</span>}
                </div>
                {orderType !== "market" ? (
                    <label className="block text-xs text-muted-foreground">
                        Pending entry price
                        <input type="number" inputMode="decimal" step="any" min="0" value={entryPrice} onChange={(event) => setEntryPrice(event.target.value)} disabled={disabled} placeholder="Price" className="mt-1 w-full rounded-md border border-border bg-background px-2 py-2 font-mono text-sm text-foreground" />
                    </label>
                ) : null}
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

                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
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

                <p className="text-[11px] leading-relaxed text-muted-foreground">{orderType === "market" ? "Market orders fill only when the server has a fresh quote. SL/TP are checked server-side." : "Pending orders are checked against live quotes while this challenge is being monitored; rules are reevaluated at trigger time and orders expire after 7 days or at challenge end."}</p>
                <p className="text-[10px] text-muted-foreground">Size limits for {symbol}: {minLot}–{effectiveMaxLots} lots · step {lotStep}</p>
                {!validSize ? <p role="alert" className="text-[11px] text-amber-600">Enter a valid size in {lotStep}-lot increments.</p> : null}
                <Button className={`w-full ${side === "long" ? "bg-emerald-600 text-white hover:bg-emerald-700" : "bg-red-600 text-white hover:bg-red-700"}`} disabled={disabled || busy || !quoteIsFresh || !validSize || (orderType !== "market" && (!entryPrice || !Number.isFinite(Number(entryPrice)) || Number(entryPrice) <= 0))} onClick={() => void submit()}>
                    {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                    {busy ? "Submitting…" : `${orderType === "market" ? "Place market" : `Place ${orderType}`} ${side === "long" ? "buy" : "sell"}`}
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
                        {orderType === "market" ? "Market order accepted by the simulated execution engine. Check position and trade state below." : "Pending order accepted. It will fill only if the live quote triggers it and current challenge rules still permit entry."}
                    </p>
                ) : null}
            </div>
        </div>
    );
}
