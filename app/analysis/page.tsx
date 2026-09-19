"use client";

import { useEffect, useState, useRef } from "react";
import {
    BarChart3,
    ChevronDown,
    ChevronRight,
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
} from "lucide-react";
import { onAuthStateChanged, User } from "firebase/auth";
import { auth } from "@/lib/firebase";
import { SupportedSymbol, Timeframe } from "@/lib/market-data/types";
import SiteNavbar from "@/components/navbar/SiteNavbar";
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

function CollapsiblePanel({ panel, isOpen, onToggle, children }: { panel: PanelConfig; isOpen: boolean; onToggle: () => void; children: React.ReactNode }) {
    const Icon = panel.icon;
    return (
        <div className="border-b border-border/20">
            <button type="button" onClick={onToggle} className="flex w-full items-center gap-2 px-4 py-2.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground hover:bg-muted/50 hover:text-muted-foreground transition">
                {isOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                <Icon size={13} />
                {panel.label}
            </button>
            {isOpen && <div className="px-4 pb-3">{children}</div>}
        </div>
    );
}

export default function AnalysisPage() {
    const [user, setUser] = useState<User | null>(null);
    const [authLoading, setAuthLoading] = useState(true);
    const [symbol, setSymbol] = useState<SupportedSymbol>("XAUUSD");
    const [timeframe, setTimeframe] = useState<Timeframe>("H1");
    const [data, setData] = useState<AnalyticsData | null>(null);
    const [ohlcData, setOhlcData] = useState<OHLCData | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [accounts, setAccounts] = useState<MT5Account[]>([]);
    const [selectedAccount, setSelectedAccount] = useState<MT5Account | null>(null);
    const [positions, setPositions] = useState<MT5Position[]>([]);
    const [positionsLoading, setPositionsLoading] = useState(false);
    const [openPanels, setOpenPanels] = useState<Record<string, boolean>>(() => {
        const initial: Record<string, boolean> = {};
        PANELS.forEach((p) => { initial[p.id] = p.defaultOpen; });
        return initial;
    });
    const chartRef = useRef<HTMLCanvasElement>(null);

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
                    const [marketRes, ohlcRes, accountsRes] = await Promise.all([
                        fetch(`/api/analytics/market?symbol=${symbol}&timeframe=${timeframe}`, { headers: { Authorization: `Bearer ${token}` } }),
                        fetch(`/api/analytics/ohlc?symbol=${symbol}&timeframe=${timeframe}&limit=200`, { headers: { Authorization: `Bearer ${token}` } }),
                        fetch("/api/analytics/accounts", { headers: { Authorization: `Bearer ${token}` } }),
                    ]);
                    const marketJson = await marketRes.json();
                    const ohlcJson = await ohlcRes.json();
                    const accountsJson = await accountsRes.json();
                    if (!marketRes.ok) throw new Error(marketJson.error || "Failed to load analytics");
                    setData(marketJson);
                    if (ohlcRes.ok) setOhlcData(ohlcJson);
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
            } catch {} finally { setPositionsLoading(false); }
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
            const [marketRes, ohlcRes] = await Promise.all([
                fetch(`/api/analytics/market?symbol=${symbol}&timeframe=${timeframe}`, { headers: { Authorization: `Bearer ${token}` } }),
                fetch(`/api/analytics/ohlc?symbol=${symbol}&timeframe=${timeframe}&limit=200`, { headers: { Authorization: `Bearer ${token}` } }),
            ]);
            const marketJson = await marketRes.json();
            const ohlcJson = await ohlcRes.json();
            if (!marketRes.ok) throw new Error(marketJson.error || "Failed to load analytics");
            setData(marketJson);
            if (ohlcRes.ok) setOhlcData(ohlcJson);
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : "Failed to load market intelligence");
        } finally {
            setLoading(false);
        }
    };
    const togglePanel = (id: string) => { setOpenPanels((prev) => ({ ...prev, [id]: !prev[id] })); };

    useEffect(() => {
        if (!ohlcData?.candles?.length || !chartRef.current) return;
        const canvas = chartRef.current;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;

        const dpr = window.devicePixelRatio || 1;
        const rect = canvas.getBoundingClientRect();
        canvas.width = rect.width * dpr;
        canvas.height = rect.height * dpr;
        ctx.scale(dpr, dpr);

        const w = rect.width;
        const h = rect.height;
        const candles = ohlcData.candles;
        const padding = { top: 20, right: 60, bottom: 30, left: 10 };
        const chartW = w - padding.left - padding.right;
        const chartH = h - padding.top - padding.bottom;

        const allHighs = candles.map((c) => c.high);
        const allLows = candles.map((c) => c.low);
        const maxPrice = Math.max(...allHighs);
        const minPrice = Math.min(...allLows);
        const priceRange = maxPrice - minPrice || 1;

        const candleWidth = Math.max(1, (chartW / candles.length) * 0.7);
        const gapWidth = chartW / candles.length;

        ctx.fillStyle = "#080c13";
        ctx.fillRect(0, 0, w, h);

        ctx.strokeStyle = "rgba(255,255,255,0.04)";
        ctx.lineWidth = 0.5;
        for (let i = 0; i <= 5; i++) {
            const y = padding.top + (chartH / 5) * i;
            ctx.beginPath();
            ctx.moveTo(padding.left, y);
            ctx.lineTo(w - padding.right, y);
            ctx.stroke();
            const price = maxPrice - (priceRange / 5) * i;
            ctx.fillStyle = "#52525b";
            ctx.font = "10px monospace";
            ctx.textAlign = "left";
            ctx.fillText(price.toFixed(price >= 100 ? 2 : 5), w - padding.right + 4, y + 3);
        }

        candles.forEach((candle, i) => {
            const x = padding.left + i * gapWidth + gapWidth / 2;
            const openY = padding.top + ((maxPrice - candle.open) / priceRange) * chartH;
            const closeY = padding.top + ((maxPrice - candle.close) / priceRange) * chartH;
            const highY = padding.top + ((maxPrice - candle.high) / priceRange) * chartH;
            const lowY = padding.top + ((maxPrice - candle.low) / priceRange) * chartH;

            const isBull = candle.close >= candle.open;
            const color = isBull ? "#10b981" : "#f43f5e";

            ctx.strokeStyle = color;
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(x, highY);
            ctx.lineTo(x, lowY);
            ctx.stroke();

            ctx.fillStyle = color;
            const bodyTop = Math.min(openY, closeY);
            const bodyH = Math.max(1, Math.abs(closeY - openY));
            ctx.fillRect(x - candleWidth / 2, bodyTop, candleWidth, bodyH);
        });

        if (data?.vwap?.vwap) {
            const vwapY = padding.top + ((maxPrice - data.vwap.vwap) / priceRange) * chartH;
            ctx.strokeStyle = "rgba(139,92,246,0.5)";
            ctx.lineWidth = 1;
            ctx.setLineDash([4, 3]);
            ctx.beginPath();
            ctx.moveTo(padding.left, vwapY);
            ctx.lineTo(w - padding.right, vwapY);
            ctx.stroke();
            ctx.setLineDash([]);
            ctx.fillStyle = "#8b5cf6";
            ctx.font = "9px monospace";
            ctx.fillText(`VWAP ${data.vwap.vwap.toFixed(data.vwap.vwap >= 100 ? 2 : 5)}`, w - padding.right + 4, vwapY + 3);
        }

        if (data?.liquidity) {
            data.liquidity.slice(0, 5).forEach((level) => {
                const y = padding.top + ((maxPrice - level.price) / priceRange) * chartH;
                if (y < padding.top || y > padding.top + chartH) return;
                ctx.strokeStyle = level.type.includes("high") ? "rgba(244,63,94,0.3)" : "rgba(16,185,129,0.3)";
                ctx.lineWidth = 0.5;
                ctx.setLineDash([2, 2]);
                ctx.beginPath();
                ctx.moveTo(padding.left, y);
                ctx.lineTo(w - padding.right, y);
                ctx.stroke();
                ctx.setLineDash([]);
            });
        }

        if (data?.zones) {
            data.zones.filter((z) => z.status === "active").slice(0, 3).forEach((zone) => {
                const highY = padding.top + ((maxPrice - zone.high) / priceRange) * chartH;
                const lowY = padding.top + ((maxPrice - zone.low) / priceRange) * chartH;
                ctx.fillStyle = zone.direction === "bullish" ? "rgba(16,185,129,0.06)" : "rgba(244,63,94,0.06)";
                ctx.fillRect(padding.left, highY, chartW, lowY - highY);
            });
        }
    }, [ohlcData, data]);

    if (authLoading) {
        return (<div className="flex min-h-screen flex-col bg-background text-foreground"><SiteNavbar /><div className="flex flex-1 items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-violet-400" /></div></div>);
    }

    if (!user) {
        return (
            <div className="flex min-h-screen flex-col bg-background text-foreground">
                <SiteNavbar />
                <div className="flex flex-1 flex-col items-center justify-center gap-4">
                    <Lock size={40} className="text-muted-foreground" />
                    <h1 className="text-xl font-semibold text-foreground">Sign in required</h1>
                    <p className="text-sm text-muted-foreground">Sign in to access Market Intelligence</p>
                    <a href="/login" className="rounded-xl bg-violet-600 px-6 py-2.5 text-sm font-semibold text-foreground hover:bg-violet-500 transition">Sign In</a>
                </div>
            </div>
        );
    }

    const totalFloatingPnl = positions.reduce((sum, p) => sum + p.profit, 0);

    return (
        <div className="flex min-h-screen flex-col bg-background text-foreground">
            <SiteNavbar />
            <MarketHeader symbol={symbol} timeframe={timeframe} quote={data?.quote} session={data?.session} volatility={data?.volatility} regime={data?.regime} onSymbolChange={setSymbol} onTimeframeChange={setTimeframe} isLoading={loading} isConnected={!!data} onRefresh={handleRefresh} />

            <div className="flex flex-1 overflow-hidden">
                <div className="flex-1 overflow-y-auto">
                    {loading && !data && (<div className="flex h-96 items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-violet-400" /></div>)}
                    {error && !data && (
                        <div className="flex h-96 flex-col items-center justify-center gap-3">
                            <p className="text-sm text-rose-400">{error}</p>
                            <button type="button" onClick={handleRefresh} className="rounded-lg bg-muted/20 px-4 py-2 text-xs text-muted-foreground hover:bg-muted/40 transition">Retry</button>
                        </div>
                    )}

                    {data && (
                        <div className="p-4" data-guide="page-header">
                            {/* Account selector + stats */}
                            {accounts.length > 0 && (
                                <div className="mb-4 rounded-xl border border-border/30 bg-muted/50 p-3">
                                    <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-3">
                                            <Monitor size={14} className="text-violet-400" />
                                            <span className="text-xs font-semibold text-muted-foreground">MT5 Account</span>
                                            <select
                                                value={selectedAccount?.id || ""}
                                                onChange={(e) => { const acc = accounts.find((a) => a.id === e.target.value); if (acc) setSelectedAccount(acc); }}
                                                className="rounded-lg border border-border/40 bg-muted px-2 py-1 text-xs text-foreground focus:border-violet-500 focus:outline-none"
                                            >
                                                {accounts.map((acc) => (
                                                    <option key={acc.id} value={acc.id}>{acc.broker} — {acc.mt5Account} ({acc.currency})</option>
                                                ))}
                                            </select>
                                            {selectedAccount && (
                                                <span className={cn("flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium", selectedAccount.status === "connected" ? "bg-emerald-500/10 text-emerald-400" : "bg-muted/10 text-muted-foreground")}>
                                                    <span className={cn("h-1.5 w-1.5 rounded-full", selectedAccount.status === "connected" ? "bg-emerald-400" : "bg-muted")} />
                                                    {selectedAccount.status}
                                                </span>
                                            )}
                                        </div>
                                        <button type="button" onClick={handleRefresh} className="rounded-lg p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted/20 transition"><RefreshCw size={13} /></button>
                                    </div>
                                    {selectedAccount && (
                                        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-5">
                                            <MiniStat label="Balance" value={`$${selectedAccount.balance.toLocaleString(undefined, { minimumFractionDigits: 2 })}`} />
                                            <MiniStat label="Equity" value={`$${selectedAccount.equity.toLocaleString(undefined, { minimumFractionDigits: 2 })}`} />
                                            <MiniStat label="Margin" value={`$${selectedAccount.margin.toLocaleString(undefined, { minimumFractionDigits: 2 })}`} />
                                            <MiniStat label="Free Margin" value={`$${selectedAccount.freeMargin.toLocaleString(undefined, { minimumFractionDigits: 2 })}`} />
                                            <MiniStat label="Margin Level" value={`${selectedAccount.marginLevel.toFixed(0)}%`} color={selectedAccount.marginLevel < 200 ? "text-rose-400" : "text-muted-foreground"} />
                                        </div>
                                    )}
                                </div>
                            )}

                            {/* Price summary */}
                            <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6" data-guide="stats">
                                <StatCard label="Bid" value={data.quote?.bid?.toFixed(data.quote.bid >= 100 ? 2 : 5) || "—"} />
                                <StatCard label="Ask" value={data.quote?.ask?.toFixed(data.quote.ask >= 100 ? 2 : 5) || "—"} />
                                <StatCard label="Spread" value={data.quote?.spread?.toFixed(data.quote.spread >= 1 ? 2 : 5) || "—"} />
                                <StatCard label="Change" value={`${(data.quote?.changePercent || 0) >= 0 ? "+" : ""}${(data.quote?.changePercent || 0).toFixed(2)}%`} color={(data.quote?.changePercent || 0) >= 0 ? "text-emerald-400" : "text-rose-400"} />
                                <StatCard label="ATR" value={data.volatility?.atr?.toFixed(data.volatility.atr >= 100 ? 2 : 5) || "—"} />
                                <StatCard label="Regime" value={data.regime?.regime?.replace(/_/g, " ") || "—"} />
                            </div>

                            {/* Multi-timeframe */}
                            {data.multiTimeframe && data.multiTimeframe.length > 0 && (
                                <div className="mb-4 rounded-xl border border-border/30 bg-muted/50 p-3">
                                    <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Multi-Timeframe Bias</p>
                                    <div className="flex gap-3">
                                        {data.multiTimeframe.map((mtf) => (
                                            <div key={mtf.timeframe} className="flex items-center gap-1.5 text-xs">
                                                <span className="text-muted-foreground">{mtf.timeframe}:</span>
                                                <span className={cn("font-medium", mtf.bias === "bullish" ? "text-emerald-400" : mtf.bias === "bearish" ? "text-rose-400" : "text-muted-foreground")}>{mtf.bias}</span>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {/* Real OHLC Chart */}
                            <div className="mb-4 rounded-xl border border-border/30 bg-muted/50 overflow-hidden">
                                <div className="flex items-center justify-between border-b border-border/20 px-3 py-2">
                                    <div className="flex items-center gap-2">
                                        <BarChart3 size={14} className="text-violet-400" />
                                        <span className="text-xs font-semibold text-muted-foreground">{symbol} — {timeframe}</span>
                                        <span className="text-[10px] text-muted-foreground">{ohlcData?.candleCount || 0} candles</span>
                                    </div>
                                    <span className="text-[10px] text-muted-foreground">Biquote.io OHLC</span>
                                </div>
                                <canvas ref={chartRef} className="w-full" style={{ height: "400px" }} />
                            </div>

                            {/* Open positions from MT5 */}
                            {selectedAccount && (
                                <div className="mb-4 rounded-xl border border-border/30 bg-muted/50">
                                    <div className="flex items-center justify-between border-b border-border/20 px-4 py-2.5">
                                        <div className="flex items-center gap-2">
                                            <Wallet size={14} className="text-violet-400" />
                                            <span className="text-xs font-semibold text-muted-foreground">Open Positions</span>
                                            <span className="rounded-full bg-muted/30 px-2 py-0.5 text-[10px] text-muted-foreground">{positions.length}</span>
                                        </div>
                                        {totalFloatingPnl !== 0 && (
                                            <span className={cn("font-mono text-xs font-bold", totalFloatingPnl >= 0 ? "text-emerald-400" : "text-rose-400")}>
                                                {totalFloatingPnl >= 0 ? "+" : ""}${totalFloatingPnl.toFixed(2)}
                                            </span>
                                        )}
                                    </div>
                                    {positionsLoading ? (
                                        <div className="flex items-center justify-center py-6"><Loader2 size={16} className="animate-spin text-muted-foreground" /></div>
                                    ) : positions.length === 0 ? (
                                        <div className="py-6 text-center text-xs text-muted-foreground">No open positions</div>
                                    ) : (
                                        <div className="overflow-x-auto">
                                            <table className="w-full text-xs">
                                                <thead>
                                                    <tr className="border-b border-border/20 text-[10px] uppercase text-muted-foreground">
                                                        <th className="px-4 py-2 text-left">Symbol</th>
                                                        <th className="px-4 py-2 text-left">Type</th>
                                                        <th className="px-4 py-2 text-right">Volume</th>
                                                        <th className="px-4 py-2 text-right">Open</th>
                                                        <th className="px-4 py-2 text-right">Current</th>
                                                        <th className="px-4 py-2 text-right">SL</th>
                                                        <th className="px-4 py-2 text-right">TP</th>
                                                        <th className="px-4 py-2 text-right">P/L</th>
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    {positions.map((pos) => (
                                                        <tr key={pos.ticket} className="border-b border-border/10 hover:bg-muted/50">
                                                            <td className="px-4 py-2 font-mono font-medium text-foreground">{pos.symbol}</td>
                                                            <td className={cn("px-4 py-2 font-medium", pos.type === "BUY" ? "text-emerald-400" : "text-rose-400")}>{pos.type}</td>
                                                            <td className="px-4 py-2 text-right font-mono text-muted-foreground">{pos.volume.toFixed(2)}</td>
                                                            <td className="px-4 py-2 text-right font-mono text-muted-foreground">{pos.openPrice.toFixed(pos.openPrice >= 100 ? 2 : 5)}</td>
                                                            <td className="px-4 py-2 text-right font-mono text-muted-foreground">{pos.currentPrice.toFixed(pos.currentPrice >= 100 ? 2 : 5)}</td>
                                                            <td className="px-4 py-2 text-right font-mono text-muted-foreground">{pos.sl > 0 ? pos.sl.toFixed(pos.sl >= 100 ? 2 : 5) : "—"}</td>
                                                            <td className="px-4 py-2 text-right font-mono text-muted-foreground">{pos.tp > 0 ? pos.tp.toFixed(pos.tp >= 100 ? 2 : 5) : "—"}</td>
                                                            <td className={cn("px-4 py-2 text-right font-mono font-medium", pos.profit >= 0 ? "text-emerald-400" : "text-rose-400")}>{pos.profit >= 0 ? "+" : ""}${pos.profit.toFixed(2)}</td>
                                                        </tr>
                                                    ))}
                                                </tbody>
                                            </table>
                                        </div>
                                    )}
                                </div>
                            )}

                            {/* Risk disclaimer */}
                            <div className="rounded-xl border border-amber-500/10 bg-amber-500/[0.03] p-3 text-[11px] text-amber-400/60">
                                <Shield size={12} className="mr-1 inline" />
                                Analytical tool — not financial advice. Scores and indicators are model-based estimates. Data from Biquote.io and your connected MT5 account.
                            </div>
                        </div>
                    )}
                </div>

                <aside className="w-72 shrink-0 overflow-y-auto border-l border-border/30 bg-background xl:w-80">
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
                        <div className="flex h-full items-center justify-center"><p className="text-xs text-muted-foreground">Sign in to view analytics</p></div>
                    )}
                </aside>
            </div>
        </div>
    );
}

function StatCard({ label, value, color }: { label: string; value: string; color?: string }) {
    return (
        <div className="rounded-lg border border-border/30 bg-muted/50 px-3 py-2">
            <p className="text-[10px] font-semibold uppercase text-muted-foreground">{label}</p>
            <p className={cn("mt-0.5 font-mono text-sm font-medium", color || "text-muted-foreground")}>{value}</p>
        </div>
    );
}

function MiniStat({ label, value, color }: { label: string; value: string; color?: string }) {
    return (
        <div className="rounded-lg bg-muted/50 px-2.5 py-1.5">
            <p className="text-[9px] font-semibold uppercase text-muted-foreground">{label}</p>
            <p className={cn("mt-0.5 font-mono text-xs font-medium", color || "text-muted-foreground")}>{value}</p>
        </div>
    );
}
