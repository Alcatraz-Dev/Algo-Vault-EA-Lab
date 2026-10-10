"use client";

import { useEffect, useState } from "react";
import {
    BarChart3,
    ChevronDown,
    Layers,
    Loader2,
    Lock,
    Shield,
    Sparkles,
    TrendingUp,
    Activity,
    Clock,
    Zap,
    Target,
    Droplets,
    Monitor,
    Wallet,
    RefreshCw,
    AlertTriangle,
} from "lucide-react";
import { onAuthStateChanged, User } from "firebase/auth";
import { auth } from "@/lib/firebase";
import { SupportedSymbol, Timeframe } from "@/lib/market-data/types";
import { useLiveQuote } from "@/hooks/useLiveCandles";
import { ProTerminalChartWorkspace } from "@/components/pro-scalping-terminal/ProTerminalChartWorkspace";

import MarketHeader from "@/components/analytics/MarketHeader";
import MarketStructurePanel from "@/components/analytics/MarketStructurePanel";
import LiquidityMap from "@/components/analytics/LiquidityMap";
import VolumePanel from "@/components/analytics/VolumePanel";
import VWAPPanel from "@/components/analytics/VWAPPanel";
import SessionPanel from "@/components/analytics/SessionPanel";
import VolatilityPanel from "@/components/analytics/VolatilityPanel";
import MarketRegimePanel from "@/components/analytics/MarketRegimePanel";
import InstitutionalZonesPanel from "@/components/analytics/InstitutionalZonesPanel";
import MarketScorePanel from "@/components/analytics/MarketScorePanel";
import { cn } from "@/lib/utils";
import {
    MarketStructureEvent,
    LiquidityLevel,
    LiquiditySweep,
    VolumeData,
    VWAPData,
    VolatilityData,
    RegimeData,
    Zone,
    MarketScore,
    MultiTimeframeBias,
} from "@/lib/market-data/types";

type SessionInfo = { current: string; name: string; high: number; low: number; range: number };

type AnalyticsData = {
    success: boolean;
    symbol: string;
    timeframe: string;
    quote?: { symbol: string; bid: number; ask: number; spread: number; change: number; changePercent: number; timestamp: number };
    structure: MarketStructureEvent[];
    liquidity: LiquidityLevel[];
    liquiditySweeps: LiquiditySweep[];
    volume: VolumeData;
    vwap: VWAPData;
    session: SessionInfo;
    volatility: VolatilityData;
    regime: RegimeData;
    zones: Zone[];
    score: MarketScore;
    multiTimeframe: MultiTimeframeBias[];
    timestamp: number;
};

type MT5Account = {
    id: string;
    accountId: string;
    mt5Account: string;
    broker: string;
    server: string;
    currency: string;
    leverage: string;
    balance: number;
    equity: number;
    margin: number;
    freeMargin: number;
    marginLevel: number;
    positionsCount: number;
    pendingOrdersCount: number;
    status: string;
    lastHeartbeatAt: number;
};

type MT5Position = {
    ticket: string;
    symbol: string;
    type: string;
    volume: number;
    openPrice: number;
    currentPrice: number;
    sl: number;
    tp: number;
    profit: number;
    swap: number;
    magic: number;
    openedAt: number;
};

type OHLCData = {
    success: boolean;
    symbol: string;
    timeframe: string;
    candles: { timestamp: number; open: number; high: number; low: number; close: number; volume?: number }[];
    quote?: { symbol: string; bid: number; ask: number; spread: number; change: number; changePercent: number; timestamp: number };
    candleCount: number;
};

type PanelConfig = { id: string; label: string; icon: React.ElementType; defaultOpen: boolean };

const PANELS: PanelConfig[] = [
    { id: "score", label: "Market Score", icon: Sparkles, defaultOpen: true },
    { id: "structure", label: "Structure", icon: TrendingUp, defaultOpen: true },
    { id: "liquidity", label: "Liquidity", icon: Droplets, defaultOpen: true },
    { id: "volume", label: "Volume", icon: BarChart3, defaultOpen: false },
    { id: "vwap", label: "VWAP", icon: Activity, defaultOpen: false },
    { id: "session", label: "Session", icon: Clock, defaultOpen: true },
    { id: "volatility", label: "Volatility", icon: Zap, defaultOpen: false },
    { id: "regime", label: "Regime", icon: Target, defaultOpen: true },
    { id: "zones", label: "Zones", icon: Layers, defaultOpen: true },
];

function regimeColor(regime?: string): string {
    if (!regime) return "text-muted-foreground";
    if (regime.includes("bullish")) return "text-positive";
    if (regime.includes("bearish")) return "text-negative";
    if (regime.includes("breakout")) return "text-primary";
    return "text-warning";
}

function CollapsiblePanel({ panel, isOpen, onToggle, children }: { panel: PanelConfig; isOpen: boolean; onToggle: () => void; children: React.ReactNode }) {
    const Icon = panel.icon;
    return (
        <div className="border-b border-border/60 last:border-b-0">
            <button
                type="button"
                onClick={onToggle}
                aria-expanded={isOpen}
                className="flex w-full items-center gap-2 px-4 py-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
            >
                <Icon size={13} className={cn("transition-colors", isOpen ? "text-primary" : "text-muted-foreground")} />
                {panel.label}
                <ChevronDown size={13} className={cn("ml-auto transition-transform duration-200", isOpen ? "" : "-rotate-90")} />
            </button>
            {isOpen && <div className="px-4 pb-4">{children}</div>}
        </div>
    );
}

/**
 * AnalysisWorkspace — the full market analysis experience (header, MT5 account,
 * chart, positions, analytics panels). Rendered inside any shell (AppShell or
 * AdminShell) via the /analysis and /admin/analysis routes.
 */
export default function AnalysisWorkspace({ stickyTop = "top-[var(--shell-header-h,3.5rem)]" }: { stickyTop?: string }) {
    const [user, setUser] = useState<User | null>(null);
    const [authLoading, setAuthLoading] = useState(true);
    const [symbol, setSymbol] = useState<SupportedSymbol>("XAUUSD");
    const [timeframe, setTimeframe] = useState<Timeframe>("H1");
    const [data, setData] = useState<AnalyticsData | null>(null);
    // Kept for the candle-count readout; candles themselves are fetched by
    // ProTerminalChart against the same endpoint.
    const [ohlcData, setOhlcData] = useState<OHLCData | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [accounts, setAccounts] = useState<MT5Account[]>([]);
    const [selectedAccount, setSelectedAccount] = useState<MT5Account | null>(null);
    const [positions, setPositions] = useState<MT5Position[]>([]);
    const [positionsLoading, setPositionsLoading] = useState(false);
    const [intelligence, setIntelligence] = useState<import("@/lib/ai/analysis/intelligence").AdvancedAnalysisResult | null>(null);
    // Live price for the Bid/Ask cards — polls the shared quote endpoint so
    // the header numbers tick between full analytics refreshes (which stay on
    // manual/refresh-button cadence).
    const { quotes: liveQuotes } = useLiveQuote([symbol], 5000);
    const livePrice = liveQuotes[symbol]?.price;
    const [openPanels, setOpenPanels] = useState<Record<string, boolean>>(() => {
        const initial: Record<string, boolean> = {};
        PANELS.forEach((p) => { initial[p.id] = p.defaultOpen; });
        return initial;
    });

    useEffect(() => {
        const unsub = onAuthStateChanged(auth, (u) => { setUser(u); setAuthLoading(false); });
        return () => unsub();
    }, []);

    useEffect(() => {
        if (!authLoading && user) {
            const loadAll = async () => {
                setLoading(true);
                setError(null);
                try {
                    const token = await user.getIdToken();
                    const [marketRes, ohlcRes, accountsRes, intelRes] = await Promise.all([
                        fetch(`/api/analytics/market?symbol=${symbol}&timeframe=${timeframe}`, { headers: { Authorization: `Bearer ${token}` } }),
                        fetch(`/api/analytics/ohlc?symbol=${symbol}&timeframe=${timeframe}&limit=200`, { headers: { Authorization: `Bearer ${token}` } }),
                        fetch("/api/analytics/accounts", { headers: { Authorization: `Bearer ${token}` } }),
                        fetch(`/api/analysis/intelligence?symbol=${symbol}&timeframe=${timeframe}`, { headers: { Authorization: `Bearer ${token}` } }),
                    ]);
                    const marketJson = await marketRes.json();
                    const ohlcJson = await ohlcRes.json();
                    const accountsJson = await accountsRes.json();
                    const intelJson = intelRes.ok ? await intelRes.json() : null;
                    if (!marketRes.ok) throw new Error(marketJson.error || "Failed to load analytics");
                    setData(marketJson);
                    if (ohlcRes.ok) setOhlcData(ohlcJson);
                    setIntelligence(intelJson?.analysis ?? null);
                    if (accountsJson.success && accountsJson.accounts) {
                        setAccounts(accountsJson.accounts);
                        if (accountsJson.accounts.length > 0) setSelectedAccount(accountsJson.accounts[0]);
                    }
                } catch (err: unknown) {
                    setError(err instanceof Error ? err.message : "Failed to load market intelligence");
                } finally {
                    setLoading(false);
                }
            };
            loadAll();
        }
    }, [authLoading, user, symbol, timeframe]);

    useEffect(() => {
        if (!user || !selectedAccount) return;
        const loadPositions = async () => {
            setPositionsLoading(true);
            try {
                const token = await user.getIdToken();
                const res = await fetch(`/api/analytics/positions?accountId=${selectedAccount.id}`, { headers: { Authorization: `Bearer ${token}` } });
                const json = await res.json();
                if (json.success) setPositions(json.positions || []);
            } catch { } finally { setPositionsLoading(false); }
        };
        loadPositions();
        const interval = setInterval(loadPositions, 15000);
        return () => clearInterval(interval);
    }, [user, selectedAccount]);

    const handleRefresh = async () => {
        if (!user) return;
        setLoading(true);
        setError(null);
        try {
            const token = await user.getIdToken();
            const [marketRes, ohlcRes, intelRes] = await Promise.all([
                fetch(`/api/analytics/market?symbol=${symbol}&timeframe=${timeframe}`, { headers: { Authorization: `Bearer ${token}` } }),
                fetch(`/api/analytics/ohlc?symbol=${symbol}&timeframe=${timeframe}&limit=200`, { headers: { Authorization: `Bearer ${token}` } }),
                fetch(`/api/analysis/intelligence?symbol=${symbol}&timeframe=${timeframe}`, { headers: { Authorization: `Bearer ${token}` } }),
            ]);
            const marketJson = await marketRes.json();
            const ohlcJson = await ohlcRes.json();
            const intelJson = intelRes.ok ? await intelRes.json() : null;
            if (!marketRes.ok) throw new Error(marketJson.error || "Failed to load analytics");
            setData(marketJson);
            if (ohlcRes.ok) setOhlcData(ohlcJson);
            setIntelligence(intelJson?.analysis ?? null);
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : "Failed to load market intelligence");
        } finally {
            setLoading(false);
        }
    };
    const togglePanel = (id: string) => { setOpenPanels((prev) => ({ ...prev, [id]: !prev[id] })); };

    if (authLoading) {
        return (
            <div className="flex h-[60vh] items-center justify-center">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
        );
    }

    if (!user) {
        return (
            <div className="flex h-[60vh] flex-col items-center justify-center gap-4">
                <div className="flex h-16 w-16 items-center justify-center rounded-lg border border-border bg-card">
                    <Lock size={28} className="text-muted-foreground" />
                </div>
                <h2 className="text-xl font-semibold text-foreground">Sign in required</h2>
                <p className="text-sm text-muted-foreground">Sign in to access Market Analysis</p>
                <a href="/login" className="rounded-lg bg-primary px-6 py-2.5 text-sm font-semibold text-primary-foreground hover:bg-primary/90 transition">Sign In</a>
            </div>
        );
    }

    const totalFloatingPnl = positions.reduce((sum, p) => sum + p.profit, 0);

    return (
        <>
            <MarketHeader
                symbol={symbol}
                timeframe={timeframe}
                quote={data?.quote && livePrice !== undefined
                    ? { ...data.quote, bid: livePrice, ask: livePrice }
                    : data?.quote}
                session={data?.session}
                volatility={data?.volatility}
                regime={data?.regime}
                onSymbolChange={setSymbol}
                onTimeframeChange={setTimeframe}
                isLoading={loading}
                isConnected={!!data}
                onRefresh={handleRefresh}
                stickyTop={stickyTop}
            />

            <div className="flex flex-col xl:flex-row">
                {/* Main content */}
                <div className="min-w-0 flex-1 space-y-4 p-4 sm:p-6">
                    {loading && !data && (
                        <div className="space-y-4" aria-busy="true">
                            <div className="h-24 animate-pulse rounded-lg bg-muted/40" />
                            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
                                {Array.from({ length: 6 }).map((_, i) => (
                                    <div key={i} className="h-16 animate-pulse rounded-lg bg-muted/40" />
                                ))}
                            </div>
                            <div className="h-[440px] animate-pulse rounded-lg bg-muted/40" />
                        </div>
                    )}

                    {error && !data && (
                        <div className="flex h-80 flex-col items-center justify-center gap-3 rounded-lg border border-destructive/20 bg-destructive/5">
                            <AlertTriangle size={28} className="text-destructive" />
                            <p className="text-sm text-destructive">{error}</p>
                            <button type="button" onClick={handleRefresh} className="flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-2 text-xs font-medium text-foreground hover:bg-muted transition">
                                <RefreshCw size={12} /> Retry
                            </button>
                        </div>
                    )}

                    {data && (
                        <>
                            {/* MT5 account selector + stats */}
                            {accounts.length > 0 && (
                                <div className="rounded-lg border border-border bg-card p-4 shadow-sm" data-guide="page-header">
                                    <div className="flex flex-wrap items-center justify-between gap-3">
                                        <div className="flex flex-wrap items-center gap-3">
                                            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10">
                                                <Monitor size={14} className="text-primary" />
                                            </div>
                                            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">MT5 Account</span>
                                            <select
                                                value={selectedAccount?.id || ""}
                                                onChange={(e) => { const acc = accounts.find((a) => a.id === e.target.value); if (acc) setSelectedAccount(acc); }}
                                                className="rounded-lg border border-border bg-muted px-2 py-1.5 text-xs font-medium text-foreground transition focus:border-primary focus:outline-none"
                                            >
                                                {accounts.map((acc) => (
                                                    <option key={acc.id} value={acc.id}>{acc.broker} — {acc.mt5Account} ({acc.currency})</option>
                                                ))}
                                            </select>
                                            {selectedAccount && (
                                                <span className={cn(
                                                    "flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-micro font-medium",
                                                    selectedAccount.status === "connected"
                                                        ? "border-positive/20 bg-positive/10 text-positive"
                                                        : "border-border bg-muted text-muted-foreground"
                                                )}>
                                                    <span className={cn("h-1.5 w-1.5 rounded-full", selectedAccount.status === "connected" ? "bg-positive" : "bg-muted-foreground")} />
                                                    {selectedAccount.status}
                                                </span>
                                            )}
                                        </div>
                                        <button
                                            type="button"
                                            onClick={handleRefresh}
                                            className="flex items-center gap-1.5 rounded-lg border border-border bg-muted px-2.5 py-1.5 text-xs text-muted-foreground transition hover:bg-muted/70 hover:text-foreground"
                                        >
                                            <RefreshCw size={12} className={cn(loading && "animate-spin")} /> Refresh
                                        </button>
                                    </div>
                                    {selectedAccount && (
                                        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-5">
                                            <MiniStat label="Balance" value={`$${selectedAccount.balance.toLocaleString(undefined, { minimumFractionDigits: 2 })}`} />
                                            <MiniStat label="Equity" value={`$${selectedAccount.equity.toLocaleString(undefined, { minimumFractionDigits: 2 })}`} />
                                            <MiniStat label="Margin" value={`$${selectedAccount.margin.toLocaleString(undefined, { minimumFractionDigits: 2 })}`} />
                                            <MiniStat label="Free Margin" value={`$${selectedAccount.freeMargin.toLocaleString(undefined, { minimumFractionDigits: 2 })}`} />
                                            <MiniStat label="Margin Level" value={`${selectedAccount.marginLevel.toFixed(0)}%`} color={selectedAccount.marginLevel < 200 ? "text-negative" : "text-foreground"} />
                                        </div>
                                    )}
                                </div>
                            )}

                            {/* Price summary — Bid/Ask/Spread tick live; ATR/Regime refresh with analytics */}
                            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6" data-guide="stats">
                                <StatCard label="Bid" value={(livePrice ?? data.quote?.bid)?.toFixed((livePrice ?? data.quote?.bid ?? 0) >= 100 ? 2 : 5) || "—"} />
                                <StatCard label="Ask" value={(livePrice ?? data.quote?.ask)?.toFixed((livePrice ?? data.quote?.ask ?? 0) >= 100 ? 2 : 5) || "—"} />
                                <StatCard label="Spread" value={data.quote?.spread?.toFixed(data.quote.spread >= 1 ? 2 : 5) || "—"} />
                                <StatCard
                                    label="Change"
                                    value={`${(data.quote?.changePercent || 0) >= 0 ? "+" : ""}${(data.quote?.changePercent || 0).toFixed(2)}%`}
                                    color={(data.quote?.changePercent || 0) >= 0 ? "text-positive" : "text-negative"}
                                />
                                <StatCard label="ATR" value={data.volatility?.atr?.toFixed(data.volatility.atr >= 100 ? 2 : 5) || "—"} />
                                <StatCard label="Regime" value={data.regime?.regime?.replace(/_/g, " ") || "—"} color={regimeColor(data.regime?.regime)} />
                            </div>

                            {/* Multi-timeframe bias */}
                            {data.multiTimeframe && data.multiTimeframe.length > 0 && (
                                <div className="rounded-lg border border-border bg-card p-4 shadow-sm">
                                    <p className="mb-3 text-micro font-semibold uppercase tracking-wider text-muted-foreground">Multi-Timeframe Bias</p>
                                    <div className="flex flex-wrap gap-2">
                                        {data.multiTimeframe.map((mtf) => (
                                            <span
                                                key={mtf.timeframe}
                                                className={cn(
                                                    "flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium",
                                                    mtf.bias === "bullish"
                                                        ? "border-positive/20 bg-positive/10 text-positive"
                                                        : mtf.bias === "bearish"
                                                            ? "border-negative/20 bg-negative/10 text-negative"
                                                            : "border-border bg-muted text-muted-foreground"
                                                )}
                                            >
                                                <span className="font-numeric">{mtf.timeframe}</span>
                                                {mtf.bias}
                                            </span>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {/* Real OHLC chart with engine-backed overlays (shared Pro Terminal chart workspace) */}
                            <div className="space-y-2">
                                <div className="flex flex-wrap items-center gap-1.5">
                                    <span className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-2.5 py-1 text-xs text-muted-foreground">
                                        <Layers size={13} />
                                        <span className="font-numeric">{ohlcData?.candleCount ?? 0} candles</span>
                                    </span>
                                </div>
                                <ProTerminalChartWorkspace
                                    initialSymbol={symbol}
                                    initialTimeframe={timeframe}
                                    analysis={intelligence}
                                    height={440}
                                    hideWatchlist
                                    storageScope="analysis-workspace"
                                />
                            </div>

                            {/* Open positions from MT5 */}
                            {selectedAccount && (
                                <div className="overflow-hidden rounded-lg border border-border bg-card shadow-sm">
                                    <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
                                        <div className="flex items-center gap-2">
                                            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10">
                                                <Wallet size={13} className="text-primary" />
                                            </div>
                                            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Open Positions</span>
                                            <span className="rounded-full bg-muted px-2 py-0.5 text-micro text-muted-foreground">{positions.length}</span>
                                        </div>
                                        {totalFloatingPnl !== 0 && (
                                            <span className={cn("font-numeric text-xs font-bold tabular-nums", totalFloatingPnl >= 0 ? "text-positive" : "text-negative")}>
                                                {totalFloatingPnl >= 0 ? "+" : ""}${totalFloatingPnl.toFixed(2)}
                                            </span>
                                        )}
                                    </div>
                                    {positionsLoading && positions.length === 0 ? (
                                        <div className="flex items-center justify-center py-8"><Loader2 size={16} className="animate-spin text-muted-foreground" /></div>
                                    ) : positions.length === 0 ? (
                                        <div className="py-8 text-center text-xs text-muted-foreground">No open positions</div>
                                    ) : (
                                        <div className="overflow-x-auto">
                                            <table className="w-full text-xs">
                                                <thead>
                                                    <tr className="border-b border-border text-micro uppercase tracking-wider text-muted-foreground">
                                                        <th className="px-4 py-2.5 text-left font-semibold">Symbol</th>
                                                        <th className="px-4 py-2.5 text-left font-semibold">Type</th>
                                                        <th className="px-4 py-2.5 text-right font-semibold">Volume</th>
                                                        <th className="px-4 py-2.5 text-right font-semibold">Open</th>
                                                        <th className="px-4 py-2.5 text-right font-semibold">Current</th>
                                                        <th className="px-4 py-2.5 text-right font-semibold">SL</th>
                                                        <th className="px-4 py-2.5 text-right font-semibold">TP</th>
                                                        <th className="px-4 py-2.5 text-right font-semibold">P/L</th>
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    {positions.map((pos) => (
                                                        <tr key={pos.ticket} className="border-b border-border/50 last:border-b-0 transition-colors hover:bg-muted/50">
                                                            <td className="px-4 py-2.5 font-numeric font-semibold text-foreground">{pos.symbol}</td>
                                                            <td className={cn("px-4 py-2.5 font-medium", pos.type === "BUY" ? "text-positive" : "text-negative")}>{pos.type}</td>
                                                            <td className="px-4 py-2.5 text-right font-numeric text-muted-foreground tabular-nums">{pos.volume.toFixed(2)}</td>
                                                            <td className="px-4 py-2.5 text-right font-numeric text-muted-foreground tabular-nums">{pos.openPrice.toFixed(pos.openPrice >= 100 ? 2 : 5)}</td>
                                                            <td className="px-4 py-2.5 text-right font-numeric text-muted-foreground tabular-nums">{pos.currentPrice.toFixed(pos.currentPrice >= 100 ? 2 : 5)}</td>
                                                            <td className="px-4 py-2.5 text-right">
                                                                {pos.sl > 0 ? (
                                                                    <span className="inline-flex items-center gap-0.5 rounded-full border border-negative/25 bg-negative/10 px-2 py-0.5 font-numeric text-micro font-semibold text-negative">
                                                                        <Shield size={8} className="opacity-60" />
                                                                        {pos.sl.toFixed(pos.sl >= 100 ? 2 : 5)}
                                                                    </span>
                                                                ) : <span className="font-numeric text-muted-foreground">—</span>}
                                                            </td>
                                                            <td className="px-4 py-2.5 text-right">
                                                                {pos.tp > 0 ? (
                                                                    <span className="inline-flex items-center gap-0.5 rounded-full border border-positive/25 bg-positive/10 px-2 py-0.5 font-numeric text-micro font-semibold text-positive">
                                                                        <Target size={8} className="opacity-60" />
                                                                        {pos.tp.toFixed(pos.tp >= 100 ? 2 : 5)}
                                                                    </span>
                                                                ) : <span className="font-numeric text-muted-foreground">—</span>}
                                                            </td>
                                                            <td className={cn("px-4 py-2.5 text-right font-numeric font-semibold tabular-nums", pos.profit >= 0 ? "text-positive" : "text-negative")}>{pos.profit >= 0 ? "+" : ""}${pos.profit.toFixed(2)}</td>
                                                        </tr>
                                                    ))}
                                                </tbody>
                                            </table>
                                        </div>
                                    )}
                                </div>
                            )}

                            {/* Risk disclaimer */}
                            <div className="rounded-lg border border-warning/20 bg-warning/[0.03] p-3 text-micro text-warning/70">
                                <Shield size={12} className="mr-1 inline" />
                                Analytical tool — not financial advice. Scores and indicators are model-based estimates. Data from Biquote.io and your connected MT5 account.
                            </div>
                        </>
                    )}
                </div>

                {/* Analytics panels sidebar */}
                <aside className="w-full shrink-0 border-t border-border bg-card/40 xl:sticky xl:top-[var(--shell-header-h,3.5rem)] xl:max-h-[calc(100vh-var(--shell-header-h,3.5rem))] xl:w-80 xl:self-start xl:overflow-y-auto xl:border-l xl:border-t-0">
                    {data ? (
                        <div>
                            {PANELS.map((panel) => (
                                <CollapsiblePanel key={panel.id} panel={panel} isOpen={openPanels[panel.id]} onToggle={() => togglePanel(panel.id)}>
                                    {panel.id === "score" && data.score && <MarketScorePanel score={data.score} />}
                                    {panel.id === "structure" && <MarketStructurePanel events={data.structure} />}
                                    {panel.id === "liquidity" && <LiquidityMap levels={data.liquidity} sweeps={data.liquiditySweeps} currentPrice={data.quote?.bid || 0} />}
                                    {panel.id === "volume" && <VolumePanel volume={data.volume} />}
                                    {panel.id === "vwap" && <VWAPPanel vwap={data.vwap} currentPrice={data.quote?.bid || 0} />}
                                    {panel.id === "session" && <SessionPanel session={data.session} currentPrice={data.quote?.bid || 0} />}
                                    {panel.id === "volatility" && <VolatilityPanel volatility={data.volatility} />}
                                    {panel.id === "regime" && <MarketRegimePanel regime={data.regime} />}
                                    {panel.id === "zones" && <InstitutionalZonesPanel zones={data.zones} scores={[]} />}
                                </CollapsiblePanel>
                            ))}
                        </div>
                    ) : (
                        <div className="flex h-full items-center justify-center p-8">
                            <p className="text-xs text-muted-foreground">{error ? "Analytics unavailable" : "Loading analytics…"}</p>
                        </div>
                    )}
                </aside>
            </div>
        </>
    );
}

function StatCard({ label, value, color }: { label: string; value: string; color?: string }) {
    return (
        <div className="rounded-lg border border-border bg-card px-3.5 py-3 shadow-sm transition-colors hover:border-primary/30">
            <p className="text-micro font-semibold uppercase tracking-wider text-muted-foreground">{label}</p>
            <p className={cn("mt-1 font-numeric text-sm font-semibold tabular-nums capitalize", color || "text-foreground")}>{value}</p>
        </div>
    );
}

function MiniStat({ label, value, color }: { label: string; value: string; color?: string }) {
    return (
        <div className="rounded-lg bg-muted/60 px-2.5 py-1.5">
            <p className="text-micro font-semibold uppercase tracking-wider text-muted-foreground">{label}</p>
            <p className={cn("mt-0.5 font-numeric text-xs font-medium tabular-nums", color || "text-foreground")}>{value}</p>
        </div>
    );
}
