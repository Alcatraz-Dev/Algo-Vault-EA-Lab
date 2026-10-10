"use client";

/**
 * Phase 11 — Mobile Trading Command Center.
 *
 * Three questions, in priority order:
 *   1. What is the market doing right now?
 *   2. What has Setup Intelligence noticed, and is it confirmed or just detected?
 *   3. Is my account within risk limits?
 *
 * Every value on this screen comes from `/api/mobile/command-center`, which reads
 * the canonical engines. This component invents nothing. When a sub-source is
 * unavailable it says so; when the canonical freshness engine says the data is
 * stale it says STALE. There is no "AI confidence" chip here because no engine
 * produced one — adding one would be the exact failure the brief forbids.
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle, ChevronRight, CircleSlash, RefreshCw, ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { FreshnessBadge, StaleDataNotice } from "@/components/mobile/FreshnessBadge";
import { describeFreshness } from "@/lib/mobile/freshness";
import { useTransportState } from "@/hooks/use-cross-device-sync";
import type { Timeframe } from "@/lib/market-data/types";

// ── Response shape (mirrors the route; kept narrow on purpose) ────────────────

type MarketEntry =
    | { symbol: string; available: false; reason: string }
    | {
          symbol: string;
          available: true;
          price: number;
          bid: number;
          ask: number;
          spread: number;
          trend: "bullish" | "bearish" | "neutral";
          structure: string;
          regime: string;
          session: string;
          marketStatus: "open" | "closed" | "pre_market" | "post_market";
          volatility: { atr: number; atrPercent: number; state: string };
          fvgCount: number;
          activeFvg: number;
          orderBlockCount: number;
          sweeps: Array<{ side: string; level: number; timestamp: number }>;
          liquidityLevels: Array<{ price: number; type: string; strength: number }>;
          provider: string;
          freshness: { fresh: boolean; status: string; dataAgeMs: number; thresholdMs: number; category: string };
          dataTimestamp: number;
      };

interface SetupRow {
    id: string;
    symbol?: string;
    timeframe?: string;
    status: string;
    updatedAt: number;
    matchedCount: number;
    totalCount: number;
}

interface CommandCenterPayload {
    generatedAt: number;
    elapsedMs: number;
    timeframe: Timeframe;
    workspace: {
        selectedSymbol: string | null;
        selectedTimeframe: Timeframe;
        activeWorkspace: string;
        revision: number;
        updatedAt: number;
        updatedByPlatform: string;
    } | null;
    markets: MarketEntry[];
    setups: SetupRow[];
    setupSource: { available: true } | { available: false; reason: string };
    alerts: Array<{ id: string; symbol: string; type: string; message: string; triggered: boolean; createdAt: number }>;
    alertSource: { available: true } | { available: false; reason: string };
    risk:
        | {
              available: true;
              account: {
                  balance: number;
                  equity: number;
                  freeMargin: number;
                  status: string;
                  openPositions: number;
                  exposure: Array<{ symbol: string; lots: number }>;
              };
          }
        | { available: false; reason: string };
    riskStatus: "normal" | "caution" | "restricted" | "halted" | "unavailable";
    limits: Record<string, unknown> | null;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function CommandCenter() {
    const [data, setData] = useState<CommandCenterPayload | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const transport = useTransportState();

    const load = useCallback(async () => {
        if (transport === "offline") {
            setLoading(false);
            return;
        }
        setLoading(true);
        try {
            const token = await getIdToken();
            if (!token) {
                setData(null);
                setError(null);
                setLoading(false);
                return;
            }
            const response = await fetch("/api/mobile/command-center", {
                headers: { Authorization: `Bearer ${token}` },
                cache: "no-store",
            });
            if (!response.ok) {
                setError(response.status === 401 ? "Session expired. Sign in again." : "Command centre unavailable.");
                return;
            }
            setData((await response.json()) as CommandCenterPayload);
            setError(null);
        } catch {
            setError("Could not reach AlgoVault. Check your connection.");
        } finally {
            setLoading(false);
        }
    }, [transport]);

    useEffect(() => {
        void load();
    }, [load]);

    if (loading && !data) return <CommandCenterSkeleton />;

    if (!data) {
        return (
            <div className="space-y-3 p-4">
                <UnavailableCard
                    title="Nothing to show yet"
                    body={error ?? "Sign in to see your markets, setups and risk."}
                />
                <Link
                    href="/login?redirect=%2Fmobile"
                    className="block rounded-lg border border-border bg-card p-3 text-center text-sm font-medium text-primary"
                >
                    Sign in
                </Link>
            </div>
        );
    }

    // The command centre's own freshness: the OLDEST live market it is showing.
    // Showing "LIVE" because one symbol updated while another is a minute old
    // would be a lie about the screen as a whole.
    const liveMarkets = data.markets.filter((m): m is Extract<MarketEntry, { available: true }> => m.available);
    const oldest =
        liveMarkets.length === 0
            ? null
            : liveMarkets.reduce((min, m) => (m.dataTimestamp < min ? m.dataTimestamp : min), liveMarkets[0].dataTimestamp);
    const overall = describeFreshness({
        dataTimestamp: oldest,
        now: Date.now(),
        transport,
        source: liveMarkets[0]?.provider ?? "unknown",
    });

    return (
        <div className="space-y-4 p-4 pb-8">
            <header className="flex items-start justify-between gap-3">
                <div>
                    <h1 className="text-lg font-semibold">Command Center</h1>
                    <p className="text-xs text-muted-foreground">
                        {data.timeframe} ·{" "}
                        {data.workspace
                            ? `continuing from ${data.workspace.updatedByPlatform}`
                            : "default workspace"}
                    </p>
                </div>
                <button
                    type="button"
                    onClick={() => void load()}
                    className="rounded-md border border-border p-1.5 text-muted-foreground hover:text-foreground"
                    aria-label="Refresh command centre"
                >
                    <RefreshCw className="size-4" aria-hidden />
                </button>
            </header>

            <StaleDataNotice descriptor={overall} />

            {/* ── Market overview ─────────────────────────────────────────── */}
            <Section title="Markets">
                {data.markets.length === 0 ? (
                    <UnavailableCard title="No instruments" body="No supported instruments in your watchlist." />
                ) : (
                    <ul className="divide-y divide-border">
                        {data.markets.map((market) => (
                            <li key={market.symbol}>
                                {market.available ? (
                                    <MarketRow market={market} timeframe={data.timeframe} />
                                ) : (
                                    <div className="flex items-center justify-between px-3 py-2.5">
                                        <span className="font-mono text-sm font-medium">{market.symbol}</span>
                                        <span className="text-xs text-muted-foreground">Unavailable</span>
                                    </div>
                                )}
                            </li>
                        ))}
                    </ul>
                )}
            </Section>

            {/* ── Setup intelligence ──────────────────────────────────────── */}
            <Section
                title="Setup Intelligence"
                action={
                    <Link href="/mobile/setups" className="text-xs text-primary">
                        All
                    </Link>
                }
            >
                {!data.setupSource.available ? (
                    <UnavailableCard title="Setups unavailable" body={data.setupSource.reason} />
                ) : data.setups.length === 0 ? (
                    <UnavailableCard
                        title="No setups tracked"
                        body="No setups are being monitored. Create one from a chart to start tracking it."
                    />
                ) : (
                    <ul className="divide-y divide-border">
                        {data.setups.slice(0, 6).map((setup) => (
                            <li key={setup.id}>
                                <Link
                                    href={`/setup/${encodeURIComponent(setup.id)}`}
                                    className="flex items-center gap-3 px-3 py-2.5 active:bg-muted/60"
                                >
                                    <div className="min-w-0 flex-1">
                                        <div className="flex items-center gap-2">
                                            <span className="font-mono text-sm font-medium">
                                                {setup.symbol ?? "—"}
                                            </span>
                                            <span className="text-micro text-muted-foreground">
                                                {setup.timeframe ?? ""}
                                            </span>
                                        </div>
                                        <p className="truncate text-micro text-muted-foreground">
                                            {setup.matchedCount}/{setup.totalCount} conditions matched
                                        </p>
                                    </div>
                                    <SetupStatusBadge status={setup.status} />
                                    <ChevronRight className="size-4 text-muted-foreground" aria-hidden />
                                </Link>
                            </li>
                        ))}
                    </ul>
                )}
            </Section>

            {/* ── Risk ────────────────────────────────────────────────────── */}
            <Section
                title="Risk"
                action={
                    <Link href="/mobile/risk" className="text-xs text-primary">
                        Risk Center
                    </Link>
                }
            >
                {!data.risk.available ? (
                    <UnavailableCard title="Account unavailable" body={data.risk.reason} />
                ) : (
                    <div className="space-y-3 p-3">
                        <div className="flex items-center justify-between">
                            <RiskBadge status={data.riskStatus} />
                            <span className="text-xs text-muted-foreground">
                                {data.risk.account.openPositions} open
                            </span>
                        </div>
                        <dl className="grid grid-cols-2 gap-2 text-xs">
                            <Metric label="Equity" value={data.risk.account.equity} kind="currency" />
                            <Metric label="Free margin" value={data.risk.account.freeMargin} kind="currency" />
                        </dl>
                        {data.limits === null && (
                            <p className="text-micro text-muted-foreground">
                                Risk limits are undefined for this account, so no limit can be reported.
                            </p>
                        )}
                    </div>
                )}
            </Section>
        </div>
    );
}

// ── Pieces ───────────────────────────────────────────────────────────────────

function Section({
    title,
    action,
    children,
}: {
    title: string;
    action?: React.ReactNode;
    children: React.ReactNode;
}) {
    return (
        <section>
            <div className="mb-1.5 flex items-center justify-between px-0.5">
                <h2 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{title}</h2>
                {action}
            </div>
            <Card size="sm" className="p-0">
                {children}
            </Card>
        </section>
    );
}

function MarketRow({
    market,
    timeframe,
}: {
    market: Extract<MarketEntry, { available: true }>;
    timeframe: Timeframe;
}) {
    const descriptor = describeFreshness({
        dataTimestamp: market.dataTimestamp,
        now: Date.now(),
        transport: "online",
        source: market.provider,
    });

    return (
        <Link
            href={`/mobile/terminal/${encodeURIComponent(market.symbol)}?tf=${timeframe}`}
            className="flex items-center gap-3 px-3 py-2.5 active:bg-muted/60"
        >
            <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                    <span className="font-mono text-sm font-medium">{market.symbol}</span>
                    <TrendPill trend={market.trend} />
                </div>
                <p className="truncate text-micro text-muted-foreground">
                    {market.structure.replace(/_/g, " ")} · {market.volatility.state} vol
                    {market.activeFvg > 0 ? ` · ${market.activeFvg} active FVG` : ""}
                    {market.sweeps.length > 0 ? ` · ${market.sweeps.length} sweep(s)` : ""}
                </p>
            </div>
            <div className="text-right">
                <p className="font-mono text-sm tabular-nums">{formatPrice(market.symbol, market.price)}</p>
                <FreshnessBadge descriptor={descriptor} compact showAge />
            </div>
        </Link>
    );
}

function TrendPill({ trend }: { trend: "bullish" | "bearish" | "neutral" }) {
    const tone =
        trend === "bullish"
            ? "bg-positive/10 text-positive"
            : trend === "bearish"
              ? "bg-negative/10 text-negative"
              : "bg-muted text-muted-foreground";
    return (
        <span className={cn("rounded px-1 py-0.5 text-micro font-medium uppercase", tone)}>
            {trend}
        </span>
    );
}

function SetupStatusBadge({ status }: { status: string }) {
    const tone: Record<string, string> = {
        ACTIVE: "bg-positive/10 text-positive",
        TRIGGERED: "bg-info/10 text-info",
        PARTIALLY_MATCHED: "bg-warning/10 text-warning",
        WAITING: "bg-muted text-muted-foreground",
        EXPIRED: "bg-muted text-muted-foreground",
        INVALIDATED: "bg-negative/10 text-negative",
        CANCELLED: "bg-muted text-muted-foreground",
    };
    return (
        <span className={cn("rounded px-1.5 py-0.5 text-micro font-medium", tone[status] ?? "bg-muted text-muted-foreground")}>
            {status.replace(/_/g, " ")}
        </span>
    );
}

function RiskBadge({ status }: { status: CommandCenterPayload["riskStatus"] }) {
    const map = {
        normal: { label: "NORMAL", className: "bg-positive/10 text-positive" },
        caution: { label: "CAUTION", className: "bg-warning/10 text-warning" },
        restricted: { label: "RESTRICTED", className: "bg-warning/10 text-warning" },
        halted: { label: "HALTED", className: "bg-negative/10 text-negative" },
        unavailable: { label: "UNAVAILABLE", className: "bg-muted text-muted-foreground" },
    } as const;
    const entry = map[status];
    return (
        <span className={cn("inline-flex items-center gap-1.5 rounded px-1.5 py-0.5 text-micro font-medium", entry.className)}>
            {status === "unavailable" ? (
                <CircleSlash className="size-3" aria-hidden />
            ) : (
                <ShieldCheck className="size-3" aria-hidden />
            )}
            {entry.label}
        </span>
    );
}

function Metric({ label, value, kind }: { label: string; value: number; kind: "currency" }) {
    return (
        <div>
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="font-mono text-sm tabular-nums">
                {kind === "currency"
                    ? new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(value)
                    : value}
            </dd>
        </div>
    );
}

function UnavailableCard({ title, body }: { title: string; body: string }) {
    return (
        <div className="flex items-start gap-2 p-3">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" aria-hidden />
            <div>
                <p className="text-xs font-medium">{title}</p>
                <p className="text-micro text-muted-foreground">{body}</p>
            </div>
        </div>
    );
}

function CommandCenterSkeleton() {
    return (
        <div className="space-y-4 p-4" aria-busy="true" aria-label="Loading command centre">
            <div className="h-5 w-40 animate-pulse rounded bg-muted" />
            {[0, 1, 2].map((i) => (
                <div key={i} className="h-28 animate-pulse rounded-lg bg-muted/60" />
            ))}
        </div>
    );
}

function formatPrice(symbol: string, price: number): string {
    const decimals = symbol.includes("JPY") ? 3 : symbol.includes("XAU") || symbol.includes("XAG") ? 2 : 5;
    return price.toFixed(decimals);
}

// ── Auth ──────────────────────────────────────────────────────────────────────

async function getIdToken(): Promise<string | null> {
    const { auth } = await import("@/lib/firebase");
    const user = auth.currentUser;
    return user ? user.getIdToken() : null;
}
