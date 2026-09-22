"use client";

import { useEffect, useState, useRef } from "react";
import { auth, database } from "@/lib/firebase";
import { ref, onValue } from "firebase/database";
import { useRouter } from "next/navigation";
import SignalCard from "@/components/signals/SignalCard";
import { Loader2, Radio } from "lucide-react";
import { getSymbolCategory } from "@/lib/ai-signals/symbol-specs";
import type { ProSignal, SignalTimeframe, SignalStatus as ProSignalStatus } from "../types";
import type { AISignal, SignalStrength, MarketRegime, SignalAnalysis, ConfidenceBreakdown, SignalStatus } from "@/lib/ai-signals/types";

export type FollowActionResult = {
    signalId: string;
    followed: boolean;
    followCount?: number;
};

export type TradeActionResult = {
    signalId: string;
    tradeCount?: number;
};

export type CompleteActionResult = {
    signalId: string;
    status?: SignalStatus;
};

interface RealtimeFeedProps {
    uid: string;
    onTrade?: (signal: AISignal) => Promise<TradeActionResult | void> | void;
    onComplete?: (signal: AISignal) => Promise<CompleteActionResult | void> | void;
    onView?: (signal: AISignal) => void;
    onFollow?: (signalId: string) => Promise<FollowActionResult | void> | void;
    followedIds?: Set<string>;
    followLoadingIds?: Set<string>;
    tradeLoadingIds?: Set<string>;
    completeLoadingIds?: Set<string>;
    showHeader?: boolean;
}

function deriveStrengthFromConfidence(confidence: number): SignalStrength {
    if (confidence >= 95) return "HIGH_CONVICTION";
    if (confidence >= 85) return "VERY_STRONG";
    if (confidence >= 75) return "STRONG";
    if (confidence >= 65) return "GOOD";
    if (confidence >= 50) return "MODERATE";
    return "WEAK";
}

function normalizeProSignal(signal: ProSignal): AISignal {
    const tp1 = signal.takeProfits.find((target) => target.index === 1)?.price ?? undefined;
    const tp2 = signal.takeProfits.find((target) => target.index === 2)?.price ?? undefined;
    const tp3 = signal.takeProfits.find((target) => target.index === 3)?.price ?? undefined;
    const confidence = signal.parserMetadata?.confidence ?? 0;
    const riskReward = signal.stopLoss != null && signal.stopLoss !== 0 && signal.entry !== 0 && tp1 != null && tp1 !== 0
        ? Number((Math.abs(signal.entry - signal.stopLoss) / Math.abs(signal.entry - tp1)).toFixed(2))
        : 0;
    const confidenceBreakdown: ConfidenceBreakdown = {
        trendAlignment: { score: 0, max: 100, detail: "" },
        marketStructure: { score: 0, max: 100, detail: "" },
        liquidity: { score: 0, max: 100, detail: "" },
        momentum: { score: 0, max: 100, detail: "" },
        volume: { score: 0, max: 100, detail: "" },
        orderFlow: { score: 0, max: 100, detail: "" },
        entryConfirmation: { score: 0, max: 100, detail: "" },
        total: 0,
    };
    const sourceMessageId = signal.sourceMetadata?.messageId;

    return {
        id: signal.id,
        symbol: signal.symbol,
        direction: signal.direction,
        timeframe: signal.timeframe,
        category: getSymbolCategory(signal.symbol),
        tier: "PRO",
        entry: signal.entry,
        stopLoss: signal.stopLoss,
        tp1,
        tp2,
        tp3,
        confidence,
        suggestedRiskPercent: 0,
        followCount: signal.followCount ?? 0,
        strength: deriveStrengthFromConfidence(confidence),
        marketRegime: "UNCERTAIN",
        riskReward,
        status: mapProStatusToAISignalStatus(signal.status),
        result: "PENDING",
        resultR: 0,
        profitPoints: 0,
        tp1Hit: false,
        tp2Hit: false,
        tp3Hit: false,
        analysis: {
            trend: "",
            structure: "",
            liquidity: "",
            momentum: "",
            volume: "",
            orderFlow: "",
            higherTimeframe: "",
            regime: "",
        },
        confidenceBreakdown,
        reasoning: "",
        currentPrice: 0,
        distanceToEntry: 0,
        distanceToSL: Math.abs(signal.entry - signal.stopLoss),
        createdAt: signal.createdAt,
        updatedAt: signal.lastUpdateAt || signal.createdAt,
        expiresAt: signal.expirationAt,
        engineVersion: "",
        strategyVersion: "",
        analysisVersion: "",
        generatedBy: "Telegram Signal Engine",
        lastCheckedAt: signal.lastUpdateAt || signal.createdAt,
        tradeCount: signal.events?.filter((event) => event.type === "ORDER_QUEUED").length ?? 0,
        pipValue: 0,
        contractSize: 0,
        typicalSpread: 0,
        digits: 0,
        timeline: [],
        sourceType: mapGatewaySourceType(signal.sourceMetadata?.sourceType),
        sourceId: signal.sourceMetadata?.sourceId,
        sourceChannel: signal.sourceMetadata?.channelName,
        sourceMessageId: sourceMessageId == null ? undefined : String(sourceMessageId),
    };
}

/**
 * Maps the ingestion gateway's source-type enumeration onto the canonical
 * AISignal SignalSourceType. Telegram channels/bots → TELEGRAM;
 * custom webhook submissions are externally authored → MANUAL.
 */
function mapGatewaySourceType(
    sourceType: ProSignal["sourceMetadata"] extends { sourceType?: infer T } ? T : never
): AISignal["sourceType"] {
    if (sourceType === "telegram_channel" || sourceType === "telegram_bot") return "TELEGRAM";
    if (sourceType === "custom_webhook") return "MANUAL";
    return undefined;
}

function mapProStatusToAISignalStatus(status: ProSignalStatus | SignalTimeframe): SignalStatus {
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
    return mapping[String(status)] ?? "WATCH";
}

export function RealtimeFeed({
    uid,
    onTrade,
    onComplete,
    onView,
    onFollow,
    followedIds,
    followLoadingIds,
    tradeLoadingIds,
    completeLoadingIds,
    showHeader = true,
}: RealtimeFeedProps) {
    const router = useRouter();
    const [signals, setSignals] = useState<AISignal[]>([]);
    const [loading, setLoading] = useState(true);
    const useApiFallback = useRef(false);

    const fetchViaApi = async () => {
        try {
            const currentUser = auth.currentUser;
            if (!currentUser) return;
            const token = await currentUser.getIdToken();
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
            () => {
                useApiFallback.current = true;
                void fetchViaApi();
                pollInterval = setInterval(() => void fetchViaApi(), 5000);
            }
        );

        return () => {
            isUnmounted = true;
            unsubscribe();
            if (pollInterval) clearInterval(pollInterval);
        };
    }, [uid]);

    const handleClearAllSignals = async () => {
        if (!confirm("Are you sure you want to clear all signals from your feed?")) return;
        try {
            const currentUser = auth.currentUser;
            if (!currentUser) return;
            const token = await currentUser.getIdToken();
            await fetch("/api/pro-signals?clearAll=true", {
                method: "DELETE",
                headers: { Authorization: `Bearer ${token}` },
            });
            setSignals([]);
        } catch (err) {
            console.error("Clear signals error:", err);
        }
    };

    const handleTrade = async (signal: AISignal) => {
        const result = onTrade ? await onTrade(signal) : undefined;
        if (!result) return;
        setSignals((prev) => prev.map((item) =>
            item.id === result.signalId
                ? { ...item, tradeCount: result.tradeCount ?? item.tradeCount ?? 0 }
                : item
        ));
    };

    const handleComplete = async (signal: AISignal) => {
        const result = onComplete ? await onComplete(signal) : undefined;
        if (!result) return;
        setSignals((prev) => prev.map((item) =>
            item.id === result.signalId
                ? { ...item, status: result.status ?? item.status }
                : item
        ));
    };

    const handleView = (signal: AISignal) => {
        if (onView) {
            onView(signal);
        } else {
            router.push(`/signals/pro/${signal.id}`);
        }
    };

    const handleFollow = async (signalId: string) => {
        const result = onFollow ? await onFollow(signalId) : undefined;
        if (!result) return;
        setSignals((prev) => prev.map((signal) =>
            signal.id === result.signalId
                ? { ...signal, followCount: result.followCount ?? signal.followCount }
                : signal
        ));
    };

    const highestConfidence = signals.reduce((highest, signal) => Math.max(highest, signal.confidence), 0);

    if (loading) {
        return (
            <div className="flex min-h-72 flex-col items-center justify-center rounded-2xl border border-border/30 bg-linear-to-br from-background/80 via-background/40 to-background/80 p-8 text-center backdrop-blur-xl">
                <Loader2 className="h-7 w-7 animate-spin text-amber-400" />
                <p className="mt-3 text-sm font-medium text-foreground">Listening for live Pro Signals...</p>
                <p className="mt-1 text-xs text-muted-foreground">Connecting to your signal stream.</p>
            </div>
        );
    }

    if (signals.length === 0) {
        return (
            <div className="flex min-h-72 flex-col items-center justify-center rounded-2xl border border-border/30 bg-linear-to-br from-background/80 via-background/40 to-background/80 p-8 text-center backdrop-blur-xl">
                <Radio className="h-9 w-9 text-muted-foreground" />
                <h3 className="mt-3 text-base font-semibold text-foreground">No Pro Signals Received Yet</h3>
                <p className="mt-1 max-w-sm text-sm text-muted-foreground">
                    Live signals from configured sources will appear here when they are published.
                </p>
            </div>
        );
    }

    return (
        <div className="space-y-4">
            {showHeader && (
                <div className="flex items-center justify-between gap-3 px-1">
                    <span className="text-sm text-muted-foreground">
                        Showing <span className="font-semibold text-foreground">{signals.length}</span> Pro Signals
                    </span>
                    <button
                        type="button"
                        onClick={() => void handleClearAllSignals()}
                        className="min-h-9 rounded-xl px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:text-negative"
                    >
                        Clear All Signals
                    </button>
                </div>
            )}

            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-2">
                {signals.map((signal) => (
                    <SignalCard
                        key={signal.id}
                        signal={signal}
                        variant="pro"
                        isHighestConfidence={signal.confidence === highestConfidence && highestConfidence > 0}
                        viewHref={`/signals/pro/${signal.id}`}
                        onView={handleView}
                        onFollow={handleFollow}
                        onTrade={handleTrade}
                        onComplete={handleComplete}
                        isFollowed={followedIds?.has(signal.id) ?? false}
                        followLoading={followLoadingIds?.has(signal.id) ?? false}
                        tradeLoading={tradeLoadingIds?.has(signal.id) ?? false}
                        completeLoading={completeLoadingIds?.has(signal.id) ?? false}
                    />
                ))}
            </div>
        </div>
    );
}
