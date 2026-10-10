"use client";

import Link from "next/link";
import { useState } from "react";
import {
    TrendingUp,
    TrendingDown,
    Eye,
    UserPlus,
    Zap,
    Clock,
    Target,
    Shield,
    BarChart3,
    CheckCircle2,
    Check,
    Loader2,
    AlertTriangle,
    ArrowRight,
    Activity,
    Calculator,
    Sparkles,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { StatusBadge, type StatusTone } from "@/components/ui/status-badge";
import { formatPrice } from "@/lib/ai-signals/symbol-specs";
import { calculateProfitUSD } from "@/lib/ai-signals/calculations";
import type { AISignal, SignalDirection, SignalStrength, SignalStatus } from "@/lib/ai-signals/types";

type Props = {
    signal: AISignal;
    viewHref?: string;
    onView?: (signal: AISignal) => void;
    onFollow?: (signalId: string) => Promise<void> | void;
    onTrade?: (signal: AISignal) => Promise<void> | void;
    onComplete?: (signal: AISignal) => Promise<void> | void;
    isFollowed?: boolean;
    followLoading?: boolean;
    tradeLoading?: boolean;
    completeLoading?: boolean;
    variant?: "standard" | "pro";
    isHighestConfidence?: boolean;
    currentPrice?: number;
};

/**
 * Direction is a semantic constant everywhere in the product:
 * BUY → positive (emerald), SELL → negative (red). No per-card accents.
 */
function directionConfig(direction: SignalDirection) {
    return direction === "BUY"
        ? {
              color: "text-positive",
              bg: "bg-positive/10",
              border: "border-positive/30",
              icon: TrendingUp,
          }
        : {
              color: "text-negative",
              bg: "bg-negative/10",
              border: "border-negative/30",
              icon: TrendingDown,
          };
}

/**
 * Signal strength maps onto the shared semantic scale — positive for the top
 * tier, info for strong, warning for moderate — instead of a five-colour set.
 */
function strengthConfig(strength: SignalStrength) {
    const map: Record<SignalStrength, string> = {
        HIGH_CONVICTION: "text-positive-foreground border-positive/30 bg-positive/10",
        VERY_STRONG: "text-info-foreground border-info/30 bg-info/10",
        STRONG: "text-info-foreground border-info/30 bg-info/10",
        GOOD: "text-foreground border-border bg-muted",
        MODERATE: "text-warning-foreground border-warning/30 bg-warning/10",
        WEAK: "text-muted-foreground border-border bg-muted",
    };
    return map[strength];
}

const STATUS_DISPLAY_MAP: Record<string, { label: string; tone: StatusTone; active: boolean }> = {
    ACTIVE: { label: "ACTIVE", tone: "live", active: true },
    READY: { label: "READY", tone: "info", active: false },
    NEW: { label: "NEW", tone: "warning", active: true },
    PENDING_ENTRY: { label: "PENDING ENTRY", tone: "info", active: true },
    ENTRY_TRIGGERED: { label: "ENTRY TRIGGERED", tone: "live", active: true },
    TP1_HIT: { label: "TP1 HIT", tone: "positive", active: true },
    TP2_HIT: { label: "TP2 HIT", tone: "positive", active: true },
    TP3_HIT: { label: "TP3 HIT", tone: "positive", active: true },
    RUNNER: { label: "RUNNER", tone: "positive", active: true },
    CANCELLED: { label: "CANCELLED", tone: "neutral", active: false },
    EXPIRED: { label: "EXPIRED", tone: "neutral", active: false },
    STOPPED: { label: "SL HIT", tone: "negative", active: false },
    COMPLETED: { label: "COMPLETED", tone: "neutral", active: false },
    WATCH: { label: "WATCH", tone: "neutral", active: false },
};

function statusConfig(status: string) {
    return (
        STATUS_DISPLAY_MAP[status] ?? {
            label: status.replaceAll("_", " "),
            tone: "neutral" as StatusTone,
            active: false,
        }
    );
}

function isTpHit(status: SignalStatus, tpIndex: number): boolean {
    if (tpIndex === 1) return ["TP1_HIT", "TP2_HIT", "TP3_HIT", "RUNNER", "COMPLETED"].includes(status);
    if (tpIndex === 2) return ["TP2_HIT", "TP3_HIT", "RUNNER", "COMPLETED"].includes(status);
    if (tpIndex === 3) return ["TP3_HIT", "RUNNER", "COMPLETED"].includes(status);
    return false;
}

function isSlHit(status: SignalStatus): boolean {
    return status === "STOPPED";
}

const TRADABLE_STATUSES = new Set([
    "ACTIVE",
    "READY",
    "RUNNER",
    "TP1_HIT",
    "TP2_HIT",
    "TP3_HIT",
]);

function formatTimeAgo(ts: number | undefined): string {
    if (!ts) return "—";
    const diff = Date.now() - ts;
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 30) return `${days}d ago`;
    return new Date(ts).toLocaleDateString();
}

/* ─────────────────────────────────────────────────────────────────
   RISK TRACK — horizontal bar showing SL → Entry → TP1 with a live
   price cursor dot. Presentation only; geometry is unchanged.
───────────────────────────────────────────────────────────────── */
interface RiskTrackProps {
    entry: number;
    stopLoss: number;
    tp1: number;
    currentPrice: number;
    direction: SignalDirection;
    symbol: string;
}

function RiskTrack({ entry, stopLoss, tp1, currentPrice, direction, symbol }: RiskTrackProps) {
    const isBuy = direction === "BUY";
    const left = isBuy ? stopLoss : tp1;
    const right = isBuy ? tp1 : stopLoss;
    const range = Math.abs(right - left);
    if (range === 0) return null;

    const entryPct = Math.min(100, Math.max(0, ((entry - left) / range) * 100));
    const currentPct = Math.min(100, Math.max(0, ((currentPrice - left) / range) * 100));
    const fillFrom = isBuy ? 0 : currentPct;
    const fillWidth = isBuy ? currentPct : 100 - currentPct;
    const inProfit = isBuy ? currentPrice >= entry : currentPrice <= entry;
    const fillColor = inProfit ? "bg-positive/60" : "bg-negative/50";

    return (
        <div className="border-t border-border px-3.5 py-3">
            <div className="mb-1.5 flex items-center justify-between text-micro">
                <span className="font-numeric text-negative-foreground">{isBuy ? "SL" : "TP1"}</span>
                <span className="flex items-center gap-1 text-muted-foreground">
                    <Activity className="h-3 w-3 text-primary" />
                    <span className="font-medium">Live track</span>
                </span>
                <span className="font-numeric text-positive-foreground">{isBuy ? "TP1" : "SL"}</span>
            </div>

            <div className="relative h-3 overflow-hidden rounded-full bg-muted">
                <div
                    className={cn("absolute top-0 h-full rounded-full transition-[width,left] duration-700", fillColor)}
                    style={{ left: `${fillFrom}%`, width: `${fillWidth}%` }}
                />
                <div
                    className="absolute top-0 h-full w-0.5 bg-foreground/50"
                    style={{ left: `${entryPct}%` }}
                    title={`Entry: ${entry}`}
                />
                <div
                    className={cn(
                        "absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-background transition-[left] duration-700",
                        inProfit ? "bg-positive" : "bg-negative"
                    )}
                    style={{ left: `${currentPct}%` }}
                    title={`Current: ${currentPrice}`}
                />
            </div>

            <div className="mt-1.5 flex items-center justify-between text-micro font-numeric text-muted-foreground">
                <ArrowRight className="h-3 w-3 rotate-180 text-negative-foreground/60" />
                <span>
                    Entry: <span className="font-medium text-foreground">{formatPrice(entry, symbol)}</span>
                </span>
                <ArrowRight className="h-3 w-3 text-positive-foreground/60" />
            </div>
        </div>
    );
}

export default function SignalCard({
    signal,
    viewHref,
    onView,
    onFollow,
    onTrade,
    onComplete,
    isFollowed,
    followLoading,
    tradeLoading,
    completeLoading,
    variant = "standard",
    isHighestConfidence = false,
    currentPrice = 0,
}: Props) {
    const [lotSize, setLotSize] = useState(0.01);
    const dir = directionConfig(signal.direction);
    const DirIcon = dir.icon;
    const status = statusConfig(signal.status);
    const isPro = variant === "pro";
    const isBuy = signal.direction === "BUY";
    const tradable = TRADABLE_STATUSES.has(signal.status) && Boolean(onTrade);
    const isCompletable = TRADABLE_STATUSES.has(signal.status) && Boolean(onComplete);
    const slHit = isSlHit(signal.status);

    const livePrice = currentPrice || signal.currentPrice || 0;
    const hasLive = livePrice > 0;
    const deltaPct = hasLive && signal.entry ? ((livePrice - signal.entry) / signal.entry) * 100 : null;
    const inProfit = deltaPct !== null ? (isBuy ? deltaPct >= 0 : deltaPct <= 0) : null;

    return (
        <article className="flex flex-col rounded-lg border border-border bg-card transition-colors hover:border-foreground/20">
            {isPro ? <div className="h-px w-full bg-primary/60" aria-hidden="true" /> : null}

            <div className="flex flex-1 flex-col gap-4 p-4">
                {/* Header */}
                <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-3">
                        <span
                            className={cn(
                                "flex h-10 w-10 shrink-0 items-center justify-center rounded-md border",
                                dir.bg,
                                dir.border,
                                dir.color
                            )}
                        >
                            <DirIcon className="h-5 w-5" />
                        </span>
                        <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-1.5">
                                <h3 className="truncate text-sm font-semibold text-foreground">{signal.symbol}</h3>
                                {isPro ? (
                                    <span className="inline-flex shrink-0 items-center rounded border border-primary/30 bg-primary/10 px-1 text-micro font-semibold uppercase tracking-wide text-primary">
                                        Pro
                                    </span>
                                ) : null}
                                {isHighestConfidence ? (
                                    <span className="inline-flex shrink-0 items-center rounded border border-primary/30 bg-primary/10 px-1 text-micro font-semibold uppercase tracking-wide text-primary">
                                        Top
                                    </span>
                                ) : null}
                            </div>
                            <p className="mt-0.5 text-micro text-muted-foreground">
                                {signal.timeframe} · {signal.category || "market"}
                            </p>
                        </div>
                    </div>
                    <span
                        className={cn(
                            "inline-flex shrink-0 items-center gap-1 rounded-pill border px-2.5 py-1 text-xs font-semibold",
                            dir.bg,
                            dir.border,
                            dir.color
                        )}
                    >
                        <DirIcon className="h-3 w-3" />
                        {signal.direction}
                    </span>
                </div>

                {/* Live price delta */}
                {hasLive && inProfit !== null ? (
                    <div className="flex items-center gap-2">
                        <span className="font-numeric text-sm font-semibold text-foreground">
                            {formatPrice(livePrice, signal.symbol)}
                        </span>
                        {deltaPct !== null ? (
                            <span
                                className={cn(
                                    "font-numeric text-micro font-medium",
                                    inProfit ? "text-positive" : "text-negative"
                                )}
                            >
                                {deltaPct >= 0 ? "+" : ""}
                                {deltaPct.toFixed(2)}%
                            </span>
                        ) : null}
                        <span className="ml-auto inline-flex items-center gap-1 text-micro text-muted-foreground">
                            <Activity className="h-3 w-3" /> live
                        </span>
                    </div>
                ) : null}

                {/* Confidence + strength */}
                <div className="space-y-2">
                    <div className="flex items-center justify-between gap-3">
                        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                            <Sparkles className="h-3.5 w-3.5 text-primary" /> Confidence
                        </span>
                        <span className="font-numeric text-xs font-semibold text-foreground">
                            {signal.confidence ?? 0}%
                        </span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                        <div
                            className="h-full rounded-full bg-primary transition-[width] duration-700 ease-out"
                            style={{ width: `${Math.min(100, Math.max(0, signal.confidence ?? 0))}%` }}
                        />
                    </div>
                </div>

                {/* SL / TP panel */}
                <div className="overflow-hidden rounded-md border border-border">
                    <div className="flex items-center justify-between gap-3 border-b border-border px-3.5 py-2.5">
                        <span className="text-micro font-medium uppercase tracking-wide text-muted-foreground">Entry</span>
                        <span className="font-numeric text-sm font-semibold text-foreground">
                            {signal.entry ? formatPrice(signal.entry, signal.symbol) : "—"}
                        </span>
                    </div>
                    <div className={cn("flex items-center justify-between gap-3 border-b border-border px-3.5 py-2.5", slHit && "bg-negative/5")}>
                        <span className="inline-flex items-center gap-2 text-micro font-medium uppercase tracking-wide text-muted-foreground">
                            Stop loss
                            {slHit ? (
                                <span className="inline-flex items-center gap-1 rounded-pill bg-negative px-1.5 py-0.5 text-micro font-semibold normal-case text-background">
                                    <AlertTriangle className="h-3 w-3" /> hit
                                </span>
                            ) : null}
                        </span>
                        <span className="font-numeric text-sm font-semibold text-negative-foreground">
                            {signal.stopLoss ? formatPrice(signal.stopLoss, signal.symbol) : "—"}
                        </span>
                    </div>
                    {[
                        { label: "TP1", value: signal.tp1, hit: isTpHit(signal.status, 1) },
                        { label: "TP2", value: signal.tp2, hit: isTpHit(signal.status, 2) },
                        { label: "TP3", value: signal.tp3, hit: isTpHit(signal.status, 3) },
                    ]
                        .filter((tp) => tp.value != null && tp.value !== 0)
                        .map((tp) => (
                            <div
                                key={tp.label}
                                className={cn(
                                    "flex items-center justify-between gap-3 border-b border-border px-3.5 py-2.5 last:border-b-0",
                                    tp.hit && "bg-positive/5"
                                )}
                            >
                                <span className="inline-flex items-center gap-2 text-micro font-medium uppercase tracking-wide text-muted-foreground">
                                    {tp.label}
                                    {tp.hit ? (
                                        <span className="inline-flex items-center gap-1 rounded-pill bg-positive px-1.5 py-0.5 text-micro font-semibold normal-case text-background">
                                            <Check className="h-3 w-3" /> hit
                                        </span>
                                    ) : null}
                                </span>
                                <span className="font-numeric text-sm font-semibold text-positive-foreground">
                                    {formatPrice(tp.value as number, signal.symbol)}
                                </span>
                            </div>
                        ))}
                </div>

                {/* Risk track */}
                {hasLive && signal.stopLoss && signal.tp1 ? (
                    <div className="overflow-hidden rounded-md border border-border">
                        <RiskTrack
                            entry={signal.entry}
                            stopLoss={signal.stopLoss}
                            tp1={signal.tp1}
                            currentPrice={livePrice}
                            direction={signal.direction}
                            symbol={signal.symbol}
                        />
                    </div>
                ) : null}

                {/* P&L calculator */}
                {signal.entry ? (
                    <div className="rounded-md border border-border bg-muted/30 p-3">
                        <div className="flex items-center justify-between gap-2">
                            <span className="inline-flex items-center gap-1.5 text-micro font-medium uppercase tracking-wide text-muted-foreground">
                                <Calculator className="h-3.5 w-3.5" /> Risk calculator
                            </span>
                            <div className="flex items-center gap-1">
                                {[0.01, 0.05, 0.1, 0.5, 1].map((preset) => (
                                    <button
                                        key={preset}
                                        type="button"
                                        onClick={() => setLotSize(preset)}
                                        aria-pressed={lotSize === preset}
                                        className={cn(
                                            "rounded-button px-1.5 py-0.5 font-numeric text-micro font-semibold transition-colors",
                                            lotSize === preset
                                                ? "bg-primary text-primary-foreground"
                                                : "text-muted-foreground hover:bg-muted hover:text-foreground"
                                        )}
                                    >
                                        {preset}
                                    </button>
                                ))}
                                <div className="relative ml-1 flex items-center">
                                    <input
                                        type="number"
                                        step="0.01"
                                        min="0.001"
                                        max="100"
                                        value={lotSize}
                                        onChange={(e) => setLotSize(Math.max(0.001, parseFloat(e.target.value) || 0.01))}
                                        aria-label="Lot size"
                                        className="w-14 rounded-button border border-input bg-background px-1.5 py-0.5 text-right font-numeric text-micro font-semibold text-foreground focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring/50"
                                    />
                                    <span className="ml-1 text-micro text-muted-foreground">lot</span>
                                </div>
                            </div>
                        </div>

                        <div className="mt-3 grid grid-cols-2 gap-2 border-t border-border pt-3 sm:grid-cols-4">
                            <div className="rounded-md border border-negative/20 bg-negative/10 px-2.5 py-1.5 text-center">
                                <div className="text-micro font-medium text-negative-foreground/80">Risk (SL)</div>
                                <div className="font-numeric text-xs font-semibold text-negative-foreground">
                                    −${slProfitUSD(signal, lotSize)}
                                </div>
                            </div>
                            {[
                                { label: "TP1", value: signal.tp1 },
                                { label: "TP2", value: signal.tp2 },
                                { label: "TP3", value: signal.tp3 },
                            ]
                                .filter((tp) => tp.value != null && tp.value !== 0)
                                .map((tp) => (
                                    <div key={tp.label} className="rounded-md border border-positive/20 bg-positive/10 px-2.5 py-1.5 text-center">
                                        <div className="text-micro font-medium text-positive-foreground/80">{tp.label} profit</div>
                                        <div className="font-numeric text-xs font-semibold text-positive-foreground">
                                            +${formatMoney(calculateProfitUSD(signal.symbol, signal.direction, signal.entry, tp.value!, lotSize))}
                                        </div>
                                    </div>
                                ))}
                        </div>
                    </div>
                ) : null}

                {/* Status + strength */}
                <div className="flex flex-wrap items-center gap-1.5">
                    <StatusBadge tone={status.tone} label={status.label} dot={status.active} pulse={status.active} />
                    <span
                        className={cn(
                            "inline-flex items-center gap-2 rounded-pill border px-2.5 py-0.5 text-micro font-semibold",
                            strengthConfig(signal.strength ?? "MODERATE")
                        )}
                    >
                        {signal.strength?.replaceAll("_", " ") || "Moderate"}
                    </span>
                    <span className="ml-auto inline-flex items-center gap-1 text-micro text-muted-foreground">
                        <Clock className="h-3 w-3" /> {formatTimeAgo(signal.createdAt)}
                    </span>
                </div>

                {/* Meta */}
                <div className="flex flex-wrap items-center gap-2 text-micro text-muted-foreground">
                    {signal.riskReward != null ? (
                        <span className="inline-flex items-center gap-1">
                            <Target className="h-3 w-3" /> R:R {signal.riskReward.toFixed(1)}
                        </span>
                    ) : null}
                    <span className="inline-flex items-center gap-1">
                        <Shield className="h-3 w-3" /> {signal.suggestedRiskPercent ?? "—"}% risk
                    </span>
                    <span className="ml-auto inline-flex items-center gap-1">
                        <BarChart3 className="h-3 w-3" /> {signal.followCount ?? 0} following
                    </span>
                </div>

                {/* Actions */}
                {onView || viewHref || onFollow || tradable || isCompletable ? (
                    <div className="flex flex-wrap gap-2 border-t border-border pt-3">
                        {onView ? (
                            <button
                                type="button"
                                onClick={() => onView(signal)}
                                className="inline-flex h-8 flex-1 items-center justify-center gap-1.5 rounded-md border border-border bg-background px-3 text-xs font-medium text-foreground transition-colors hover:bg-muted"
                            >
                                <Eye className="h-3.5 w-3.5" /> View
                            </button>
                        ) : null}
                        {viewHref ? (
                            <Link
                                href={viewHref}
                                className="inline-flex h-8 flex-1 items-center justify-center gap-1.5 rounded-md border border-border bg-background px-3 text-xs font-medium text-foreground transition-colors hover:bg-muted"
                            >
                                <Eye className="h-3.5 w-3.5" /> View
                            </Link>
                        ) : null}
                        {onFollow ? (
                            <button
                                type="button"
                                onClick={() => onFollow(signal.id)}
                                disabled={followLoading}
                                className={cn(
                                    "inline-flex h-8 flex-1 items-center justify-center gap-1.5 rounded-md border px-3 text-xs font-medium transition-colors",
                                    isFollowed
                                        ? "border-positive/30 bg-positive/10 text-positive-foreground"
                                        : "border-border bg-background text-foreground hover:bg-muted"
                                )}
                            >
                                {followLoading ? (
                                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                ) : isFollowed ? (
                                    <Check className="h-3.5 w-3.5" />
                                ) : (
                                    <UserPlus className="h-3.5 w-3.5" />
                                )}
                                {isFollowed ? "Following" : "Follow"}
                            </button>
                        ) : null}
                        {tradable ? (
                            <button
                                type="button"
                                onClick={() => onTrade?.(signal)}
                                disabled={tradeLoading}
                                className={cn(
                                    "inline-flex h-8 flex-1 items-center justify-center gap-1.5 rounded-md px-3 text-xs font-semibold transition-colors",
                                    isBuy
                                        ? "bg-positive text-background hover:opacity-90"
                                        : "bg-negative text-background hover:opacity-90"
                                )}
                            >
                                {tradeLoading ? (
                                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                ) : (
                                    <Zap className="h-3.5 w-3.5" />
                                )}
                                Trade
                            </button>
                        ) : null}
                        {isCompletable ? (
                            <button
                                type="button"
                                onClick={() => onComplete?.(signal)}
                                disabled={completeLoading}
                                className="inline-flex h-8 flex-1 items-center justify-center gap-1.5 rounded-md border border-border bg-background px-3 text-xs font-medium text-foreground transition-colors hover:bg-muted"
                            >
                                {completeLoading ? (
                                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                ) : (
                                    <CheckCircle2 className="h-3.5 w-3.5" />
                                )}
                                Complete
                            </button>
                        ) : null}
                    </div>
                ) : null}
            </div>
        </article>
    );
}

/* ─────────────────────────────────────────────────────────────────
   Small local helpers (kept identical to the previous implementation).
───────────────────────────────────────────────────────────────── */

function formatMoney(amount: number): string {
    const abs = Math.abs(amount);
    if (abs >= 10000) return abs.toFixed(0);
    if (abs >= 1000) return abs.toFixed(1);
    return abs.toFixed(2);
}

function slProfitUSD(signal: AISignal, lotSize: number): string {
    if (!signal.stopLoss) return "0.00";
    const usd = calculateProfitUSD(signal.symbol, signal.direction, signal.entry, signal.stopLoss, lotSize);
    return formatMoney(Math.abs(usd));
}
