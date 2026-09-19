"use client";

import { useEffect, useState } from "react";
import {
    Activity,
    CheckCircle2,
    Clock,
    ShieldAlert,
    Sparkles,
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
            ? "text-blue-400 bg-blue-500/10 border-blue-500/30"
            : signal.status === "STOPPED"
            ? "text-red-400 bg-red-500/10 border-red-500/30"
            : signal.status === "EXPIRED"
            ? "text-muted-foreground bg-muted/10 border-border"
            : "text-emerald-400 bg-emerald-500/10 border-emerald-500/30";

    return (
        <div className="relative rounded-2xl border border-border/40 bg-card p-5 backdrop-blur-xl transition-all hover:border-border/70 shadow-lg">
            {/* Header / Title */}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <div
                        className={`flex h-11 w-11 items-center justify-center rounded-xl border ${
                            isBuy
                                ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
                                : "border-rose-500/30 bg-rose-500/10 text-rose-400"
                        }`}
                    >
                        {isBuy ? <TrendingUp className="h-6 w-6" /> : <TrendingDown className="h-6 w-6" />}
                    </div>
                    <div>
                        <div className="flex items-center gap-2">
                            <h3 className="text-lg font-extrabold tracking-tight text-foreground">
                                {signal.symbol}
                            </h3>
                            <span
                                className={`rounded-md border px-2 py-0.5 text-[10px] font-bold ${
                                    isBuy
                                        ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
                                        : "border-rose-500/30 bg-rose-500/10 text-rose-400"
                                }`}
                            >
                                {signal.direction}
                            </span>
                        </div>
                        <p className="text-xs text-muted-foreground flex items-center gap-1.5 flex-wrap mt-0.5">
                            <span>{signal.style} · {signal.timeframe}</span>
                            {signal.sourceMetadata?.channelName && (
                                <span className="rounded-md border border-amber-500/30 bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-bold text-amber-400">
                                    {signal.sourceMetadata.channelName}
                                </span>
                            )}
                        </p>
                    </div>
                </div>

                <div className="flex items-start gap-2">
                    <div className="text-right">
                        <span className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-bold ${statusColor}`}>
                            <Activity className="h-3 w-3 animate-pulse" />
                            {signal.status}
                        </span>
                        <div className="mt-1 flex items-center justify-end gap-1 text-[11px] text-muted-foreground">
                            <Clock className="h-3 w-3" />
                            <span>Age {ageStr}</span>
                        </div>
                    </div>

                    {onDelete && (
                        <button
                            onClick={(e) => {
                                e.stopPropagation();
                                onDelete(signal.id);
                            }}
                            title="Remove signal from feed"
                            className="rounded-lg border border-border/40 p-1 text-muted-foreground transition hover:border-red-500/30 hover:bg-red-500/10 hover:text-red-400"
                        >
                            <Trash2 className="h-3.5 w-3.5" />
                        </button>
                    )}
                </div>
            </div>

            {/* Entry & SL Levels */}
            <div className="mt-4 grid grid-cols-2 gap-3 rounded-xl border border-border/30 bg-muted/5 p-3 text-xs">
                <div>
                    <span className="block text-[10px] uppercase font-bold text-muted-foreground">Entry Zone</span>
                    <span className="font-mono text-sm font-extrabold text-foreground">
                        {signal.entryMin}
                        {signal.entryMax !== signal.entryMin ? ` – ${signal.entryMax}` : ""}
                    </span>
                </div>
                <div>
                    <span className="block text-[10px] uppercase font-bold text-muted-foreground">Stop Loss</span>
                    <span className="font-mono text-sm font-extrabold text-rose-400">
                        {signal.stopLoss}
                    </span>
                </div>
            </div>

            {/* Take Profit Targets */}
            <div className="mt-4">
                <span className="block text-[10px] uppercase font-bold text-muted-foreground mb-2">Targets</span>
                <div className="space-y-1.5">
                    {signal.takeProfits.map((tp) => (
                        <div
                            key={tp.index}
                            className={`flex items-center justify-between rounded-lg border px-3 py-1.5 text-xs font-mono transition-colors ${
                                tp.hit
                                    ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400 font-bold"
                                    : "border-border/20 bg-muted/5 text-foreground"
                            }`}
                        >
                            <span className="flex items-center gap-1.5">
                                <Target className="h-3.5 w-3.5 text-amber-400" />
                                TP{tp.index}
                            </span>
                            <div className="flex items-center gap-2">
                                <span>{tp.type === "OPEN" ? "OPEN RUNNER" : tp.price}</span>
                                {tp.hit && <CheckCircle2 className="h-4 w-4 text-emerald-400" />}
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}
