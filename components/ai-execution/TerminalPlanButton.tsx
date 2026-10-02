"use client";

/**
 * AI Execution × Pro Scalping Terminal — integration component.
 *
 * A qualifying terminal signal can produce a TradePlan (SETUP → EVIDENCE →
 * TRADE PLAN → RISK → EXECUTION MODE → EXECUTION STATUS). This button calls
 * /api/ai-execution/generate, which gathers deterministic evidence server-side
 * and runs the AI interpretation pass through the canonical router. It never
 * executes anything: the plan lands on the AI Execution dashboard, where the
 * configured mode (approval / automation) governs what happens next.
 *
 * Additive: the terminal's existing logic is untouched.
 */

import { useState } from "react";
import { FilePlus2, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

export interface TerminalSignalLike {
    id: string;
    symbol: string;
    direction: "long" | "short" | "BUY" | "SELL";
    entry: number;
    stop: number;
    target: number;
    timeframe: string;
    evidence?: string[];
}

const RISK_PERCENT_PLACEHOLDER = 1;

export function GenerateTradePlanButton({ signal, token }: { signal: TerminalSignalLike; token: string | null }) {
    const [busy, setBusy] = useState(false);
    const [result, setResult] = useState<string | null>(null);
    const [isError, setIsError] = useState(false);

    const direction = signal.direction === "SELL" || signal.direction === "short" ? "SELL" : "BUY";

    const generate = async () => {
        if (!token || busy) return;
        setBusy(true);
        setResult(null);
        setIsError(false);
        try {
            const res = await fetch("/api/ai-execution/generate", {
                method: "POST",
                headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
                body: JSON.stringify({
                    instrument: signal.symbol,
                    direction,
                    entry: signal.entry,
                    stopLoss: signal.stop,
                    takeProfit: signal.target,
                    riskPercent: RISK_PERCENT_PLACEHOLDER,
                    timeframe: signal.timeframe,
                    signalId: signal.id,
                    executionMode: "APPROVAL",
                }),
            });
            const data = await res.json();
            if (!res.ok) {
                setIsError(true);
                setResult(data.error ?? "Plan generation failed.");
            } else {
                setResult(`TradePlan ${String(data.plan?.id ?? "").slice(0, 18)}… created — review it on the AI Execution dashboard.`);
            }
        } catch {
            setIsError(true);
            setResult("Network error generating the plan.");
        } finally {
            setBusy(false);
        }
    };

    return (
        <span className="inline-flex flex-col items-start gap-1">
            <button
                type="button"
                onClick={generate}
                disabled={!token || busy}
                title="Generate an evidence-grounded TradePlan from this signal (no execution)"
                className={cn(
                    "inline-flex items-center gap-1 rounded-md border border-primary/40 bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary transition hover:bg-primary/20",
                    (!token || busy) && "opacity-50"
                )}
            >
                {busy ? <Loader2 className="size-3 animate-spin" /> : <FilePlus2 className="size-3" />}
                Trade Plan
            </button>
            {result && (
                <span className={cn("max-w-64 text-[10px] leading-3", isError ? "text-negative" : "text-muted-foreground")} role="status">
                    {result}
                </span>
            )}
        </span>
    );
}
