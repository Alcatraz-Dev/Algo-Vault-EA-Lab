"use client";

import { useEffect, useState } from "react";
import {
    Activity,
    CheckCircle2,
    Clock,
    Target,
    TrendingDown,
    TrendingUp,
    Trash2,
} from "lucide-react";
import type { ProSignal } from "../types";

interface SignalCardProps {
    signal: ProSignal;
    onDelete?: (signalId: string) => void;
}

export function SignalCard({ signal, onDelete }: SignalCardProps) {
    const [ageStr, setAgeStr] = useState<string>("");

    useEffect(() => {
        const updateAge = () => {
            const diffMs = Math.max(0, Date.now() - signal.createdAt);
            const totalSec = Math.floor(diffMs / 1000);
            const hrs = Math.floor(totalSec / 3600);
            const mins = Math.floor((totalSec % 3600) / 60);
            const secs = totalSec % 60;
            if (hrs > 0) {
                setAgeStr(`${hrs}h ${mins}m`);
            } else {
                setAgeStr(`${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`);
            }
        };

        updateAge();
        const interval = setInterval(updateAge, 1000);
        return () => clearInterval(interval);
    }, [signal.createdAt]);

    const isBuy = signal.direction === "BUY";
    const statusColor =
        signal.status === "CLOSED"
            ? "text-info-foreground bg-info/10 border-info/30"
            : signal.status === "STOPPED"
            ? "text-negative-foreground bg-negative/10 border-negative/30"
            : signal.status === "EXPIRED"
            ? "text-muted-foreground bg-muted/40 border-border"
            : "text-positive-foreground bg-positive/10 border-positive/30";

    return (
        <div className="relative rounded-lg border border-border bg-card p-5 transition-colors hover:border-border/70">
            {/* Header / Title */}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <div
                        className={`flex h-11 w-11 items-center justify-center rounded-md border ${
                            isBuy
                                ? "border-positive/30 bg-positive/10 text-positive"
                                : "border-negative/30 bg-negative/10 text-negative"
                        }`}
                    >
                        {isBuy ? <TrendingUp className="h-6 w-6" /> : <TrendingDown className="h-6 w-6" />}
                    </div>
                    <div>
                        <div className="flex items-center gap-2">
                            <h3 className="text-lg font-semibold tracking-tight text-foreground">
                                {signal.symbol}
                            </h3>
                            <span
                                className={`rounded-md border px-2 py-0.5 text-micro font-semibold ${
                                    isBuy
                                        ? "border-positive/30 bg-positive/10 text-positive-foreground"
                                        : "border-negative/30 bg-negative/10 text-negative-foreground"
                                }`}
                            >
                                {signal.direction}
                            </span>
                        </div>
                        <p className="text-xs text-muted-foreground flex items-center gap-1.5 flex-wrap mt-0.5">
                            <span>{signal.style} · {signal.timeframe}</span>
                            {signal.sourceMetadata?.channelName && (
                                <span className="rounded-md border border-warning/30 bg-warning/10 px-1.5 py-0.5 text-micro font-semibold text-warning-foreground">
                                    {signal.sourceMetadata.channelName}
                                </span>
                            )}
                        </p>
                    </div>
                </div>

                <div className="flex items-start gap-2">
                    <div className="text-right">
                        <span className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold ${statusColor}`}>
                            <Activity className="h-3 w-3" />
                            {signal.status}
                        </span>
                        <div className="mt-1 flex items-center justify-end gap-1 text-micro text-muted-foreground">
                            <Clock className="h-3 w-3" />
                            <span className="font-numeric">Age {ageStr}</span>
                        </div>
                    </div>

                    {onDelete && (
                        <button
                            onClick={(e) => {
                                e.stopPropagation();
                                onDelete(signal.id);
                            }}
                            title="Remove signal from feed"
                            className="rounded-md border border-border p-1 text-muted-foreground transition-colors hover:border-negative/30 hover:bg-negative/10 hover:text-negative"
                        >
                            <Trash2 className="h-3.5 w-3.5" />
                        </button>
                    )}
                </div>
            </div>

            {/* Entry & SL Levels */}
            <div className="mt-4 grid grid-cols-2 gap-3 rounded-lg border border-border bg-muted/40 p-3 text-xs">
                <div>
                    <span className="block text-micro uppercase font-semibold text-muted-foreground">Entry Zone</span>
                    <span className="font-numeric text-sm font-semibold text-foreground">
                        {signal.entryMin}
                        {signal.entryMax !== signal.entryMin ? ` – ${signal.entryMax}` : ""}
                    </span>
                </div>
                <div>
                    <span className="block text-micro uppercase font-semibold text-muted-foreground">Stop Loss</span>
                    <span className="font-numeric text-sm font-semibold text-negative-foreground">
                        {signal.stopLoss}
                    </span>
                </div>
            </div>

            {/* Take Profit Targets */}
            <div className="mt-4">
                <span className="block text-micro uppercase font-semibold text-muted-foreground mb-2">Targets</span>
                <div className="space-y-1.5">
                    {signal.takeProfits.map((tp) => (
                        <div
                            key={tp.index}
                            className={`flex items-center justify-between rounded-md border px-3 py-1.5 text-xs font-numeric transition-colors ${
                                tp.hit
                                    ? "border-positive/30 bg-positive/10 text-positive-foreground font-semibold"
                                    : "border-border bg-muted/40 text-foreground"
                            }`}
                        >
                            <span className="flex items-center gap-1.5">
                                <Target className="h-3.5 w-3.5 text-warning" />
                                TP{tp.index}
                            </span>
                            <div className="flex items-center gap-2">
                                <span>{tp.type === "OPEN" ? "OPEN RUNNER" : tp.price}</span>
                                {tp.hit && <CheckCircle2 className="h-4 w-4 text-positive" />}
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}
