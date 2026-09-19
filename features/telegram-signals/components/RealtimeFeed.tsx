"use client";

import { useEffect, useState, useRef } from "react";
import { auth, database } from "@/lib/firebase";
import { ref, onValue } from "firebase/database";
import { useRouter } from "next/navigation";
import SignalCard from "@/components/signals/SignalCard";
import { Loader2, Radio } from "lucide-react";
import type { ProSignal, SignalTimeframe, SignalStatus as ProSignalStatus } from "../types";
import type { AISignal, SignalStrength, MarketRegime, SignalAnalysis, ConfidenceBreakdown, SignalStatus } from "@/lib/ai-signals/types";

interface RealtimeFeedProps {
    uid: string;
    onTrade?: (signal: AISignal) => void;
    onComplete?: (signal: AISignal) => void;
    onView?: (signal: AISignal) => void;
    onFollow?: (signalId: string) => void;
    followedIds?: Set<string>;
}

function deriveStrengthFromConfidence(confidence: number): SignalStrength {
    if (confidence >= 95) return "HIGH_CONVICTION";
    if (confidence >= 85) return "VERY_STRONG";
    if (confidence >= 75) return "STRONG";
    if (confidence >= 65) return "GOOD";
    if (confidence >= 50) return "MODERATE";
    return "WEAK";
}

function deriveMarketRegime(timeframe: SignalTimeframe): MarketRegime {
    if (timeframe === "M1" || timeframe === "M5") return "HIGH_VOLATILITY";
    if (timeframe === "H1" || timeframe === "H4" || timeframe === "D1") return "TRENDING_BULLISH";
    return "RANGING";
}

function normalizeProSignal(signal: ProSignal): AISignal {
    const tp1 = signal.takeProfits.find((t) => t.index === 1)?.price ?? undefined;
    const tp2 = signal.takeProfits.find((t) => t.index === 2)?.price ?? undefined;
    const tp3 = signal.takeProfits.find((t) => t.index === 3)?.price ?? undefined;
    const riskReward = signal.stopLoss != null && signal.stopLoss !== 0 && signal.entry !== 0
        ? Number((Math.abs(signal.entry - signal.stopLoss) / Math.abs(signal.entry - (tp1 ?? signal.entry))).toFixed(2))
        : 2.0;
    const normalizedStatus = mapProStatusToAISignalStatus(signal.status);
    const analysis: SignalAnalysis = {
        trend: "",
        structure: "",
        liquidity: "",
        momentum: "",
        volume: "",
        orderFlow: "",
        higherTimeframe: "",
        regime: "",
    };
    const confidenceBreakdown: ConfidenceBreakdown = {
        trendAlignment: { score: signal.parserMetadata?.confidence ?? 0, max: 100, detail: "" },
        marketStructure: { score: 0, max: 100, detail: "" },
        liquidity: { score: 0, max: 100, detail: "" },
        momentum: { score: 0, max: 100, detail: "" },
        volume: { score: 0, max: 100, detail: "" },
        orderFlow: { score: 0, max: 100, detail: "" },
        entryConfirmation: { score: signal.parserMetadata?.confidence ?? 0, max: 100, detail: "" },
        total: signal.parserMetadata?.confidence ?? 0,
    };

    return {
        id: signal.id,
        symbol: signal.symbol,
        direction: signal.direction,
        timeframe: signal.timeframe,
        entry: signal.entry,
        stopLoss: signal.stopLoss,
        tp1,
        tp2,
        tp3,
        confidence: signal.parserMetadata?.confidence ?? 0,
        suggestedRiskPercent: 1,
        followCount: signal.events?.length ?? 0,
        category: "forex",
        tier: "PRO",
        strength: deriveStrengthFromConfidence(signal.parserMetadata?.confidence ?? 0),
        marketRegime: deriveMarketRegime(signal.timeframe),
        riskReward,
        status: normalizedStatus,
        result: "PENDING",
        resultR: 0,
        profitPoints: 0,
        tp1Hit: false,
        tp2Hit: false,
        tp3Hit: false,
        analysis,
        confidenceBreakdown,
        reasoning: "",
        currentPrice: signal.entry,
        distanceToEntry: 0,
        distanceToSL: Math.abs(signal.entry - signal.stopLoss),
        createdAt: signal.createdAt,
        updatedAt: signal.lastUpdateAt || signal.createdAt,
        expiresAt: signal.expirationAt,
        engineVersion: "",
        strategyVersion: "",
        analysisVersion: "",
        generatedBy: "Telegram Signal Engine",
        lastCheckedAt: Date.now(),
        tradeCount: 0,
        pipValue: 0.01,
        contractSize: 100000,
        typicalSpread: 1,
        digits: 5,
        timeline: [],
    };
}

function mapProStatusToAISignalStatus(status: ProSignalStatus): SignalStatus {
    const mapping: Record<string, SignalStatus> = {
        CREATED: "NEW",
        PENDING_ENTRY: "ACTIVE",
        ENTRY_TRIGGERED: "ACTIVE",
        TP1_HIT: "TP1_HIT",
        BE_PROFIT_LOCK: "RUNNER",
        TP2_HIT: "TP2_HIT",
        TP3_HIT: "TP3_HIT",
        TP4_HIT: "TP3_HIT",
        TP5_OPEN_RUNNER: "RUNNER",
        CLOSED: "COMPLETED",
        STOPPED: "STOPPED",
        EXPIRED: "EXPIRED",
        CANCELLED: "CANCELLED",
        NEEDS_REVIEW: "READY",
        INVALID: "CANCELLED",
    };
    return mapping[status] ?? "WATCH";
}

export function RealtimeFeed({ uid, onTrade, onComplete, onView, onFollow, followedIds }: RealtimeFeedProps) {
    const router = useRouter();
    const [signals, setSignals] = useState<AISignal[]>([]);
    const [loading, setLoading] = useState(true);
    const useApiFallback = useRef(false);

    const fetchViaApi = async () => {
        try {
            const user = auth.currentUser;
            if (!user) return;
            const token = await user.getIdToken();
            const res = await fetch("/api/pro-signals", {
                headers: { Authorization: `Bearer ${token}` },
            });
            const data = await res.json();
            if (data.signals) {
                const list = (data.signals as ProSignal[]).map(normalizeProSignal);
                list.sort((a, b) => b.createdAt - a.createdAt);
                setSignals(list);
            }
        } catch (err) {
            console.error("API signals fetch fallback error:", err);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        if (!uid) return;
        let isUnmounted = false;
        let pollInterval: NodeJS.Timeout | null = null;

        const signalsRef = ref(database, `telegramSignals/${uid}`);
        const unsubscribe = onValue(
            signalsRef,
            (snapshot) => {
                if (isUnmounted || useApiFallback.current) return;
                if (snapshot.exists()) {
                    const data = snapshot.val();
                    const list = (Object.values(data) as ProSignal[]).map(normalizeProSignal);
                    list.sort((a, b) => b.createdAt - a.createdAt);
                    setSignals(list);
                } else {
                    setSignals([]);
                }
                setLoading(false);
            },
            (err) => {
                useApiFallback.current = true;
                fetchViaApi();
                pollInterval = setInterval(fetchViaApi, 5000);
            }
        );

        return () => {
            isUnmounted = true;
            unsubscribe();
            if (pollInterval) clearInterval(pollInterval);
        };
    }, [uid]);

    const handleDeleteSignal = async (signalId: string) => {
        try {
            const user = auth.currentUser;
            if (!user) return;
            const token = await user.getIdToken();
            await fetch(`/api/pro-signals?signalId=${signalId}`, {
                method: "DELETE",
                headers: { Authorization: `Bearer ${token}` },
            });
            setSignals((prev) => prev.filter((s) => s.id !== signalId));
        } catch (err) {
            console.error("Delete signal error:", err);
        }
    };

    const handleClearAllSignals = async () => {
        if (!confirm("Are you sure you want to clear all signals from your feed?")) return;
        try {
            const user = auth.currentUser;
            if (!user) return;
            const token = await user.getIdToken();
            await fetch("/api/pro-signals?clearAll=true", {
                method: "DELETE",
                headers: { Authorization: `Bearer ${token}` },
            });
            setSignals([]);
        } catch (err) {
            console.error("Clear signals error:", err);
        }
    };

    const handleTrade = (signal: AISignal) => {
        if (onTrade) onTrade(signal);
    };

    const handleComplete = (signal: AISignal) => {
        if (onComplete) onComplete(signal);
    };

    const handleView = (signal: AISignal) => {
        if (onView) {
            onView(signal);
        } else {
            router.push(`/signals/pro?id=${signal.id}`);
        }
    };

    const handleFollow = (signalId: string) => {
        if (onFollow) onFollow(signalId);
    };

    if (loading) {
        return (
            <div className="flex flex-col items-center justify-center rounded-2xl border border-border/30 bg-card/60 p-12 text-center backdrop-blur-xl">
                <Loader2 className="h-8 w-8 animate-spin text-amber-400 mb-3" />
                <p className="text-sm text-muted-foreground">Listening for live Pro Signals...</p>
            </div>
        );
    }

    if (signals.length === 0) {
        return (
            <div className="rounded-2xl border border-border/30 bg-card/60 p-12 text-center backdrop-blur-xl">
                <Radio className="mx-auto h-10 w-10 text-muted-foreground mb-3" />
                <h3 className="text-base font-bold text-foreground">No Pro Signals Received Yet</h3>
                <p className="mt-1 text-xs text-muted-foreground max-w-sm mx-auto">
                    Live signals from configured sources will automatically appear here in real time.
                </p>
            </div>
        );
    }

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between px-1">
                <span className="text-xs text-muted-foreground">Showing {signals.length} Pro Signals</span>
                <button
                    onClick={handleClearAllSignals}
                    className="text-xs text-muted-foreground hover:text-red-400 font-semibold transition"
                >
                    Clear All Signals
                </button>
            </div>

            <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
                {signals.map((signal) => (
                    <SignalCard
                        key={signal.id}
                        signal={signal}
                        onView={handleView}
                        onFollow={handleFollow}
                        onTrade={handleTrade}
                        onComplete={handleComplete}
                        isFollowed={followedIds?.has(signal.id) ?? false}
                    />
                ))}
            </div>
        </div>
    );
}