"use client";

// Order ticket — submits INTENT only (symbol, side, size, stop/TP). Prices,
// costs, fills, PnL and rule evaluation are computed server-side. Rule
// rejections (422 RULE_VIOLATION) render with the engine's own messages.
//
// SIZING IS RISK-FIRST, and the preview is the shared solve
// ───────────────────────────────────────────────────────────────────────────
// A prop desk does not size by notional; it sizes by how much the position can
// lose if the stop is hit. The ticket therefore offers TWO equivalent inputs:
//
//   • Risk %  — "I want to risk 1% of equity"; lots are solved from the stop.
//   • Lots    — "I want 0.35 lots"; the risk it commits is displayed.
//
// Both run through `previewPosition` from lib/performance-arena/sizing — the
// SAME pure function the server rule gate calls — so the number shown here is
// the number enforced, and the ceilings reported are the ceilings that will
// reject the order. That shared solve is the whole point: the old ticket showed
// a bare lot number while the server silently compared notional against a
// percentage, which is how users hit "rejected, 41.6% of equity" on an order
// they believed was tiny.
//
// The preview is advisory-but-loud: `clamped` means a ceiling will shrink the
// size, and the ticket says so and shows the binding gate rather than letting
// the trader discover it as a rejection.

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, ArrowDownRight, ArrowUpRight, Loader2, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ChallengeMetrics, ChallengePolicy, RuleEvent } from "@/lib/performance-arena/types";
import { arenaSymbolSpec } from "@/lib/performance-arena/execution";
import { toPriceMicros } from "@/lib/performance-arena/money";
import { CENTI_LOT } from "@/lib/performance-arena/money";
import {
    centiLotsToLots,
    effectiveAggregateRiskPct,
    floorToCentiLotStep,
    previewPosition,
    type SizingPreview,
} from "@/lib/performance-arena/sizing";
import { cn } from "@/lib/utils";

export interface OrderTicketResult {
    ok: boolean;
    error?: string;
    violations?: RuleEvent[];
}

type SizingMode = "risk" | "lots";

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
    policy,
    metrics,
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
    policy?: ChallengePolicy;
    metrics?: ChallengeMetrics;
}) {
    const [localSymbol, setLocalSymbol] = useState(symbols[0] ?? "EURUSD");
    const [localQuote, setLocalQuote] = useState<{ price: number; timestamp: number } | null>(null);
    // Wall clock, kept in state so freshness is a pure read of props+state.
    // Calling Date.now() during render makes the component non-idempotent: two
    // renders with identical inputs could disagree about whether the quote is
    // still fresh, which flips the submit button under the trader.
    const [now, setNow] = useState<number | null>(null);
    const symbol = selectedSymbol ?? localSymbol;
    const quote = currentQuote === undefined ? localQuote : currentQuote;
    const [side, setSide] = useState<"long" | "short">("long");
    // Risk mode is the default because it is the input a risk-managed account
    // actually thinks in; lots stay one tap away.
    const [sizingMode, setSizingMode] = useState<SizingMode>("risk");
    const [riskPctInput, setRiskPctInput] = useState("1");
    const [lotsInput, setLotsInput] = useState("0.10");
    const [stopLoss, setStopLoss] = useState("");
    const [takeProfit, setTakeProfit] = useState("");
    const [orderType, setOrderType] = useState<"market" | "limit" | "stop">("market");
    const [entryPrice, setEntryPrice] = useState("");
    const [busy, setBusy] = useState(false);
    const [result, setResult] = useState<OrderTicketResult | null>(null);

    const instrument = arenaSymbolSpec(symbol);
    const lotStep = Math.max(instrument?.lotStep ?? 0.01, policyStepLots);
    const minLot = Math.max(instrument?.minLot ?? 0.01, policyStepLots);
    const policyMaxLots = Math.min(maxLots, instrument?.maxLot ?? maxLots);
    // Freshness is indeterminate until the first tick lands — that renders as
    // "quote stale", never as a false "live".
    const quoteIsFresh = Boolean(now !== null && quote && quote.timestamp <= now + 5_000 && now - quote.timestamp <= 60_000);

    // Interval only — the first tick establishes the clock. Until then `now`
    // is null and freshness reads as indeterminate, never as a false "live".
    useEffect(() => {
        const timer = window.setInterval(() => setNow(Date.now()), 2_000);
        return () => window.clearInterval(timer);
    }, []);

    // Standalone fallback poll for hosts that do not supply `currentQuote`.
    // The arena dashboard passes the chart's live quote, so this only runs when
    // the ticket is used on its own.
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

    // ── The shared solve ──────────────────────────────────────────────────
    // Everything the ticket shows — legal size, notional, risk, R:R, ceilings —
    // comes from one `previewPosition` call against the live quote and the
    // server's own metrics. No second implementation of the maths.
    const quotePrice = quoteIsFresh && quote ? quote.price : null;
    const pendingEntry = orderType !== "market" ? Number(entryPrice) : null;
    // A market order fills at the live quote; a pending order fills at its own
    // trigger. Preview the price the position will actually open at.
    const referencePrice = orderType === "market" ? quotePrice : pendingEntry !== null && Number.isFinite(pendingEntry) && pendingEntry > 0 ? pendingEntry : quotePrice;

    const openRiskCents = metrics?.openRiskCents ?? 0;
    const signedSymbolExposureCents = metrics?.symbolNetExposureCents?.[symbol] ?? 0;
    // Account-level signed net notional: sum the per-symbol signed book. The
    // metrics map is already signed per instrument, so summing it is the
    // account net the leverage ceiling solves against.
    const signedTotalExposureCents = useMemo(
        () => Object.values(metrics?.symbolNetExposureCents ?? {}).reduce((sum, cents) => sum + cents, 0),
        [metrics?.symbolNetExposureCents]
    );
    const equityCents = metrics?.equityCents ?? 0;

    const entryPriceMicros = referencePrice !== null ? toPriceMicros(referencePrice) : null;
    const stopMicros = stopLoss !== "" && Number.isFinite(Number(stopLoss)) && Number(stopLoss) > 0
        ? toPriceMicros(Number(stopLoss))
        : null;
    const takeProfitMicros = takeProfit !== "" && Number.isFinite(Number(takeProfit)) && Number(takeProfit) > 0
        ? toPriceMicros(Number(takeProfit))
        : null;

    const solve = useCallback(
        (requestedCentiLots: number): SizingPreview | null => {
            if (!instrument || !policy || equityCents <= 0 || entryPriceMicros === null) return null;
            return previewPosition(
                {
                    spec: instrument,
                    policy,
                    equityCents,
                    entryPriceMicros,
                    stopLossMicros: stopMicros,
                    takeProfitMicros,
                    side,
                    currentSignedSymbolExposureCents: signedSymbolExposureCents,
                    openRiskCents,
                    currentSignedTotalExposureCents: signedTotalExposureCents,
                },
                requestedCentiLots
            );
        },
        [instrument, policy, equityCents, entryPriceMicros, stopMicros, takeProfitMicros, side, signedSymbolExposureCents, openRiskCents, signedTotalExposureCents]
    );

    // Ask for an unbounded size so the ceilings alone decide the legal maximum;
    // this is what powers "max lots" and the quick buttons.
    const ceilingSolve = useMemo(() => solve(Number.MAX_SAFE_INTEGER), [solve]);
    const maxLotsNow = ceilingSolve ? centiLotsToLots(ceilingSolve.ceilings.maxCentiLots) : policyMaxLots;

    /**
     * Invert the risk solve: "risk X% of equity" → centi-lots.
     *
     * Solved from a ONE centi-lot probe of the same `previewPosition` the
     * preview uses, then scaled by the risk budget. Deriving risk-per-lot here
     * rather than re-deriving the contract maths is the point: entering 1% and
     * switching to lots can never disagree with the risk the ticket displays.
     * Returns 0 when no stop makes risk unmeasurable — the caller then shows
     * "no stop — unmanaged" instead of inventing a size.
     */
    const lotsForRiskPct = useCallback(
        (pct: number): number => {
            if (!instrument || !policy || equityCents <= 0 || entryPriceMicros === null) return 0;
            const budgetCents = Math.max(0, Math.round((equityCents * pct) / 100));
            if (budgetCents <= 0) return 0;
            const probe = previewPosition(
                { spec: instrument, policy, equityCents, entryPriceMicros, stopLossMicros: stopMicros, takeProfitMicros, side },
                CENTI_LOT
            );
            const riskPerCentiLot = probe.centiLots > 0 && probe.riskCents !== null ? probe.riskCents / probe.centiLots : 0;
            if (riskPerCentiLot <= 0) return 0;
            return floorToCentiLotStep(Math.floor(budgetCents / riskPerCentiLot), lotStep);
        },
        [instrument, policy, equityCents, entryPriceMicros, stopMicros, takeProfitMicros, side, lotStep]
    );

    // Risk mode owns `lotsInput` (it is derived); lots mode owns it directly.
    const requestedLots = sizingMode === "risk"
        ? centiLotsToLots(lotsForRiskPct(Number(riskPctInput)))
        : Number(lotsInput);
    const requestedCentiLots = Number.isFinite(requestedLots) && requestedLots > 0
        ? floorToCentiLotStep(Math.round(requestedLots * CENTI_LOT), lotStep)
        : 0;
    const preview = useMemo(() => solve(requestedCentiLots), [solve, requestedCentiLots]);

    // Snap an out-of-grid or oversized typed size down rather than letting the
    // trader submit something the engine will reject for arithmetic reasons.
    const effectiveLots = preview?.centiLots ?? 0;
    const effectiveLotsNumber = centiLotsToLots(effectiveLots);
    const sizeBelowMin = effectiveLots <= 0;
    const oversizeOnly = preview !== null && preview.clamped && effectiveLots > 0;

    const entryPriceValid = orderType === "market"
        ? quoteIsFresh
        : Number.isFinite(Number(entryPrice)) && Number(entryPrice) > 0;
    const canSubmit = !disabled && !busy && entryPriceValid && effectiveLots > 0 && instrument !== null;

    const submit = async () => {
        if (!canSubmit) return;
        setBusy(true);
        setResult(null);
        try {
            const token = await import("@/lib/firebase").then((m) => m.auth.currentUser?.getIdToken());
            if (!token) throw new Error("Sign in required.");
            const res = await fetch(`/api/performance-arena/attempts/${attemptId}/orders`, {
                method: "POST",
                headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
                // Submit the SOLVED size, not the typed one. The ticket has
                // already applied every ceiling the server would, so the order
                // that reaches the engine is the one the trader was shown.
                body: JSON.stringify({
                    action: orderType,
                    symbol,
                    side,
                    sizeLots: effectiveLotsNumber,
                    ...(orderType !== "market" ? { entryPrice: Number(entryPrice) } : {}),
                    stopLoss: stopLoss === "" ? undefined : Number(stopLoss),
                    takeProfit: takeProfit === "" ? undefined : Number(takeProfit),
                    clientRequestId: newClientRequestId(attemptId),
                }),
            });
            const body = (await res.json()) as { error?: string; violations?: RuleEvent[]; trade?: unknown; reducedCentiLots?: number };
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
                        Order type
                        <select
                            value={orderType}
                            onChange={(event) => setOrderType(event.target.value as typeof orderType)}
                            disabled={disabled}
                            className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground"
                        >
                            <option value="market">Market</option>
                            <option value="limit">Limit</option>
                            <option value="stop">Stop</option>
                        </select>
                    </label>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-muted/40 px-3 py-2 text-xs">
                    <span className="text-muted-foreground">{symbol} live quote</span>
                    {quote && quoteIsFresh
                        ? <span className="font-mono font-medium text-foreground">{quote.price.toLocaleString(undefined, { maximumFractionDigits: 6 })} <span className="text-[10px] text-muted-foreground">{new Date(quote.timestamp).toLocaleTimeString()} · live</span></span>
                        : <span className="text-amber-600">{quote ? "Quote stale" : "Quote unavailable"}</span>}
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

                {/* ── Sizing ─────────────────────────────────────────────── */}
                <div className="space-y-2 rounded-md border border-border bg-background/60 p-3">
                    <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-medium text-muted-foreground">Position size</span>
                        <div className="inline-flex rounded-md border border-border p-0.5" role="group" aria-label="Sizing mode">
                            {(["risk", "lots"] as const).map((mode) => (
                                <button
                                    key={mode}
                                    type="button"
                                    aria-pressed={sizingMode === mode}
                                    onClick={() => {
                                        // Seed the lots input with the size the risk
                                        // mode currently solves, so switching modes
                                        // does not silently discard the position size
                                        // the trader just configured.
                                        if (mode === "lots" && sizingMode === "risk" && preview && preview.centiLots > 0) {
                                            setLotsInput(String(roundLots(centiLotsToLots(preview.centiLots))));
                                        }
                                        setSizingMode(mode);
                                    }}
                                    disabled={disabled}
                                    className={cn(
                                        "rounded px-2 py-0.5 text-[11px] font-medium capitalize transition",
                                        sizingMode === mode ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"
                                    )}
                                >
                                    {mode === "risk" ? "Risk %" : "Lots"}
                                </button>
                            ))}
                        </div>
                    </div>

                    {sizingMode === "risk" ? (
                        <>
                            <label className="block text-xs text-muted-foreground">
                                Risk (% of equity)
                                <input
                                    type="number"
                                    step="0.1"
                                    min="0.01"
                                    max={policy ? effectiveAggregateRiskPct(policy) : undefined}
                                    value={riskPctInput}
                                    onChange={(e) => setRiskPctInput(e.target.value)}
                                    disabled={disabled}
                                    className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1.5 font-mono text-sm text-foreground"
                                />
                            </label>
                            {/* The solved size is DERIVED, not stored: showing it here
                                (rather than mirroring it back into the lots input in
                                an effect) keeps one source of truth for the number the
                                trader is shown and the number that gets submitted. */}
                            <div className="flex items-baseline justify-between gap-3 text-xs">
                                <span className="text-muted-foreground">= {roundLots(effectiveLotsNumber)} lots</span>
                                <span className="font-mono tabular-nums text-muted-foreground">
                                    {stopMicros === null ? "needs a stop-loss" : "solved from stop distance"}
                                </span>
                            </div>
                            {stopMicros === null ? (
                                <p className="text-[10px] text-amber-600">
                                    Without a stop-loss the risk cannot be measured, so no lot size can be solved from a risk percentage.
                                </p>
                            ) : null}
                        </>
                    ) : (
                        <label className="block text-xs text-muted-foreground">
                            Size (lots)
                            <input
                                type="number"
                                step={lotStep}
                                min={minLot}
                                max={maxLotsNow}
                                value={lotsInput}
                                onChange={(e) => setLotsInput(e.target.value)}
                                disabled={disabled}
                                className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1.5 font-mono text-sm text-foreground"
                            />
                        </label>
                    )}

                    {/* Quick size buttons — the common desk actions, solved live. */}
                    <div className="flex flex-wrap items-center gap-1.5">
                        {policy ? [0.25, 0.5, 1, 2].map((pct) => (
                            <button
                                key={pct}
                                type="button"
                                disabled={disabled || !quoteIsFresh}
                                onClick={() => { setSizingMode("risk"); setRiskPctInput(String(pct)); }}
                                title={`Risk ${pct}% of equity`}
                                className="rounded border border-border bg-card px-2 py-0.5 font-mono text-[11px] text-muted-foreground transition hover:border-primary/40 hover:text-foreground disabled:opacity-40"
                            >
                                {pct}%
                            </button>
                        )) : null}
                        <button
                            type="button"
                            disabled={disabled || maxLotsNow <= 0}
                            onClick={() => {
                                setSizingMode("lots");
                                setLotsInput(String(roundLots(centiLotsToLots(ceilingSolve?.ceilings.maxCentiLots ?? 0))));
                            }}
                            title={`Largest legal size right now (${ceilingSolve?.ceilings.bindingGate ?? "n/a"} limit)`}
                            className="ml-auto rounded border border-border bg-card px-2 py-0.5 font-mono text-[11px] text-muted-foreground transition hover:border-primary/40 hover:text-foreground disabled:opacity-40"
                        >
                            Max
                        </button>
                    </div>
                </div>

                {/* ── Live sizing preview ────────────────────────────────── */}
                <SizingPreviewPanel
                    preview={preview}
                    symbol={symbol}
                    side={side}
                    riskBudgetPct={policy ? effectiveAggregateRiskPct(policy) : null}
                    signedSymbolExposureCents={signedSymbolExposureCents}
                />

                <p className="text-[11px] leading-relaxed text-muted-foreground">{orderType === "market" ? "Market orders fill only when the server has a fresh quote. SL/TP are checked server-side." : "Pending orders are checked against live quotes while this challenge is being monitored; rules are reevaluated at trigger time and orders expire after 7 days or at challenge end."}</p>
                <p className="text-[10px] text-muted-foreground">
                    Size limits for {symbol}: {minLot}–{roundLots(maxLotsNow)} lots · step {lotStep}
                    {policy ? ` · max risk/trade ${policy.maxRiskPerTradePct}% · max open risk ${effectiveAggregateRiskPct(policy)}%` : ""}
                </p>

                {sizeBelowMin ? <p role="alert" className="text-[11px] text-amber-600">Enter a size of at least {minLot} lots{policy ? ` — risk ceilings currently allow ${roundLots(maxLotsNow)} lots max` : ""}.</p> : null}
                {oversizeOnly ? (
                    <p className="flex items-start gap-1.5 text-[11px] text-amber-600">
                        <ShieldAlert className="mt-0.5 h-3 w-3 shrink-0" />
                        <span>Size reduced to {roundLots(effectiveLotsNumber)} lots by the {gateLabel(preview?.ceilings.bindingGate)} limit ({policy ? effectiveAggregateRiskPct(policy) : "?"}% open-risk budget).</span>
                    </p>
                ) : null}

                <Button
                    className={cn("w-full", side === "long" ? "bg-emerald-600 text-white hover:bg-emerald-700" : "bg-red-600 text-white hover:bg-red-700")}
                    disabled={!canSubmit}
                    onClick={() => void submit()}
                >
                    {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                    {busy
                        ? "Submitting…"
                        : `${orderType === "market" ? "Place market" : `Place ${orderType}`} ${side === "long" ? "buy" : "sell"} ${effectiveLotsNumber > 0 ? `${roundLots(effectiveLotsNumber)} lots` : ""}`}
                </Button>

                {disabled ? (
                    <p className="text-[11px] text-muted-foreground">Trading is unavailable while the challenge is not ACTIVE.</p>
                ) : null}
                {!quoteIsFresh && !disabled ? (
                    <p className="flex items-start gap-1.5 text-[11px] text-amber-600">
                        <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                        <span>A live quote is required before orders can be sized or placed.</span>
                    </p>
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

// ── helpers ───────────────────────────────────────────────────────────────

function roundLots(value: number): string {
    return Number.isFinite(value) ? String(Math.round(value * 100) / 100) : "0";
}

/**
 * Idempotency key for one submission. Built at submit time (an event handler,
 * not render) so the component stays a pure function of its props and state.
 */
function newClientRequestId(attemptId: string): string {
    return `${attemptId}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

const GATE_LABEL: Record<string, string> = {
    aggregate_risk: "open-risk",
    per_trade_risk: "per-trade risk",
    notional: "notional",
    leverage: "leverage",
    hard_max: "size",
};
function gateLabel(gate: string | undefined): string {
    return gate ? GATE_LABEL[gate] ?? gate : "risk";
}

/**
 * The numbers a trader checks before clicking Buy. Reads like a deal ticket:
 * what it costs, what it risks, what it could make, and — critically — which
 * ceiling is currently the binding constraint on size.
 */
function SizingPreviewPanel({
    preview,
    symbol,
    side,
    riskBudgetPct,
    signedSymbolExposureCents,
}: {
    preview: SizingPreview | null;
    symbol: string;
    side: "long" | "short";
    riskBudgetPct: number | null;
    signedSymbolExposureCents: number;
}) {
    if (!preview || preview.centiLots <= 0) {
        return (
            <div className="rounded-md border border-border bg-muted/20 p-3 text-[11px] text-muted-foreground">
                Enter a size (or a risk %) to see notional, risk and reward before placing the order.
            </div>
        );
    }
    const rows: Array<[string, React.ReactNode]> = [
        ["Size", `${roundLots(preview.lots)} lots`],
        ["Notional", `${formatMoney(preview.notionalCents)} (${preview.notionalPctOfEquity.toFixed(1)}% equity)`],
    ];
    if (preview.stopDistancePips !== null) rows.push(["Stop distance", `${preview.stopDistancePips.toFixed(1)} pips`]);
    rows.push([
        "Risk",
        preview.riskCents === null
            ? "no stop — unmanaged"
            : `${formatMoney(preview.riskCents)} (${preview.riskPctOfEquity?.toFixed(2)}%)`,
    ]);
    if (preview.rewardRiskRatio !== null) rows.push(["Reward:risk", `1 : ${preview.rewardRiskRatio.toFixed(2)}`]);
    if (riskBudgetPct !== null) {
        rows.push([
            "Open risk after",
            `${preview.projectedAggregateRiskPct.toFixed(2)}% of ${riskBudgetPct}% budget`,
        ]);
    }
    rows.push(["Net exposure", `${preview.projectedLeverageMultiple.toFixed(2)}× equity`]);

    return (
        <div className="space-y-1.5 rounded-md border border-border bg-background/60 p-3">
            <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-medium text-muted-foreground">Sizing preview</p>
                <span className="rounded border border-border px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                    limit: {gateLabel(preview.ceilings.bindingGate)}
                </span>
            </div>
            <dl className="space-y-1">
                {rows.map(([label, value]) => (
                    <div key={label} className="flex items-baseline justify-between gap-3 text-[11px]">
                        <dt className="text-muted-foreground">{label}</dt>
                        <dd className="text-right font-mono tabular-nums text-foreground">{value}</dd>
                    </div>
                ))}
            </dl>
            {signedSymbolExposureCents !== 0 ? (
                // One-way netting: an order on the opposite side of the open
                // position FLATTENS it rather than stacking an opposite trade.
                // Saying so up front is the difference between a trader
                // understanding why their "sell 0.5" closed a long instead of
                // opening a short, and thinking the platform is broken.
                <p className="border-t border-border pt-1.5 text-[10px] text-muted-foreground">
                    Netting: you already hold {signedSymbolExposureCents > 0 ? "long" : "short"} {symbol}. This {side} order{" "}
                    {(signedSymbolExposureCents > 0) === (side === "long")
                        ? "adds to that position."
                        : "reduces it first; only the size beyond the open position opens the opposite side. Reducing is never blocked by these ceilings."}
                </p>
            ) : null}
        </div>
    );
}

function formatMoney(cents: number): string {
    const value = cents / 100;
    const sign = value < 0 ? "-" : "";
    return `${sign}$${Math.abs(value).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
