"use client";

/**
 * /live-performance — the signed-in user's connected MT5 live performance.
 *
 * Mirror of the live-data side of /backtests but stripped to only what the
 * operator needs on a live MT5 account: real equity curve, weekday/session
 * distribution, real-time KPI cards, and an "AI Signal" button that triggers
 * a fresh /api/ai-signals scan and links to the signal feed.
 *
 * The page is wrapped in AccountShell so it picks up the account sidebar
 * navigation (Live Performance + Verified Performance entries).
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
    Activity,
    ArrowLeft,
    BarChart3,
    ChevronRight,
    Clock,
    Loader2,
    Radio,
    RefreshCw,
    ShieldCheck,
    Sparkles,
    Target,
    TrendingDown,
    TrendingUp,
    Wifi,
    WifiOff,
    Zap,
} from "lucide-react";
import { onAuthStateChanged, User } from "firebase/auth";
import { onValue, ref } from "firebase/database";
import {
    AreaChart,
    Area,
    Bar,
    BarChart,
    CartesianGrid,
    Cell,
    ResponsiveContainer,
    Tooltip,
    XAxis,
    YAxis,
} from "recharts";

import { auth, database as rtdb } from "@/lib/firebase";
import AccountShell from "@/components/account/AccountShell";

type Product = {
    id: string;
    name?: string;
    performance?: {
        profit?: number | string;
        winRate?: number | string;
        profitFactor?: number | string;
        totalTrades?: number | string;
        initialDeposit?: number | string;
        finalBalance?: number | string;
        sharpeRatio?: number | string;
    };
    risk?: { maxDrawdown?: number | string };
};

type License = {
    id?: string;
    productId?: string;
    licenseKey?: string;
    status?: string;
    mt5Account?: string | number;
};

type EquityPoint = { timestamp: number; balance?: number; equity?: number; drawdown?: number };

type LiveTrade = {
    ticket?: number | string;
    symbol?: string;
    type?: string;
    profit?: number | string;
    netProfit?: number | string;
    openedAt?: number | string;
    closedAt?: number | string;
    createdAt?: number | string;
};

type LiveStats = {
    winRate?: number;
    profitFactor?: number | null;
    profitFactorUnbounded?: boolean;
    totalTrades?: number;
    winningTrades?: number;
    losingTrades?: number;
    netProfit?: number;
    totalProfit?: number;
    grossProfit?: number;
    grossLoss?: number;
};

type LiveAccount = { balance?: number | string; drawdown?: number | string };

type LiveData = { trades?: LiveTrade[]; stats?: LiveStats; account?: LiveAccount };

type ChartType = "equity" | "drawdown" | "weekday" | "session";

const POLL_MS = 60_000;

function formatMoney(v: number, currency = "USD") {
    try {
        return new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 2 }).format(v);
    } catch {
        return `$${v.toFixed(2)}`;
    }
}

export default function LivePerformancePage() {
    const router = useRouter();
    const [user, setUser] = useState<User | null>(null);
    const [authLoading, setAuthLoading] = useState(true);

    const [products, setProducts] = useState<Product[]>([]);
    const [licenses, setLicenses] = useState<License[]>([]);
    const [selectedProductId, setSelectedProductId] = useState<string>("");
    const [chartType, setChartType] = useState<ChartType>("equity");

    const [liveData, setLiveData] = useState<LiveData | null>(null);
    const [equityPoints, setEquityPoints] = useState<EquityPoint[]>([]);
    const [loadingLive, setLoadingLive] = useState(false);
    const [error, setError] = useState("");

    // AI Signal action state
    const [scanning, setScanning] = useState(false);
    const [scanResult, setScanResult] = useState<{ generated: number; message?: string; error?: string } | null>(null);

    // Auth listener
    useEffect(() => {
        const unsub = onAuthStateChanged(auth, (u) => {
            setUser(u);
            setAuthLoading(false);
        });
        return () => unsub();
    }, []);

    // Published products from RTDB
    useEffect(() => {
        const productsRef = ref(rtdb, "bots");
        const unsub = onValue(productsRef, (snap) => {
            const raw = (snap.val() || {}) as Record<string, Product>;
            const list = Object.entries(raw)
                .map(([id, val]) => ({ ...val, id }))
                .filter((p) => (p as Product & { status?: string }).status === "published") as Product[];
            setProducts(list);
            if (list.length > 0 && !selectedProductId) {
                setSelectedProductId(list[0].id);
            }
        });
        return () => unsub();
    }, [selectedProductId]);

    // User licenses
    useEffect(() => {
        if (!user) {
            void Promise.resolve().then(() => setLicenses([]));
            return;
        }
        const refLic = ref(rtdb, `licenses/${user.uid}`);
        const unsub = onValue(refLic, (snap) => {
            const raw = (snap.val() || {}) as Record<string, License>;
            const list = Object.entries(raw).map(([id, val]) => ({ id, ...val }));
            setLicenses(list);
        });
        return () => unsub();
    }, [user]);

    const selectedProduct = useMemo(
        () => products.find((p) => p.id === selectedProductId) || products[0] || null,
        [products, selectedProductId]
    );

    const matchingLicense = useMemo(() => {
        if (!selectedProduct || licenses.length === 0) return null;
        return licenses.find((l) => l.productId === selectedProduct.id && l.status === "active") || null;
    }, [selectedProduct, licenses]);

    // Live MT5 fetch
    const fetchLive = useCallback(async (silent = false) => {
        if (!selectedProduct || !matchingLicense?.licenseKey) return;
        if (!silent) setLoadingLive(true);
        await Promise.resolve();
        try {
            const params = new URLSearchParams({
                productId: selectedProduct.id,
                licenseKey: matchingLicense.licenseKey || "",
            });
            if (matchingLicense.mt5Account) params.append("mt5Account", String(matchingLicense.mt5Account));

            const res = await fetch(`/api/performance/account?${params.toString()}`);
            if (res.ok) {
                const data = await res.json();
                if (data.success) {
                    setLiveData(data);
                    setError("");
                } else if (data.error) {
                    setError(data.error);
                }
            } else {
                setError(`Live performance unavailable (${res.status}).`);
            }

            const eqParams = new URLSearchParams({
                productId: selectedProduct.id,
                licenseKey: matchingLicense.licenseKey || "",
                hours: "720",
            });
            if (matchingLicense.mt5Account) eqParams.append("mt5Account", String(matchingLicense.mt5Account));
            const eqRes = await fetch(`/api/performance/equity?${eqParams.toString()}`);
            if (eqRes.ok) {
                const eqData = await eqRes.json();
                if (eqData.success && Array.isArray(eqData.points)) setEquityPoints(eqData.points);
            }
        } catch (err) {
            console.error("Live performance fetch failed:", err);
            setError("Failed to reach the live performance endpoint.");
        } finally {
            setLoadingLive(false);
        }
    }, [selectedProduct, matchingLicense]);

    useEffect(() => {
        if (!selectedProduct || !matchingLicense?.licenseKey) {
            void Promise.resolve().then(() => {
                setLiveData(null);
                setEquityPoints([]);
            });
            return;
        }
        const t = setTimeout(() => void fetchLive(), 0);
        const id = setInterval(() => void fetchLive(true), POLL_MS);
        return () => {
            clearTimeout(t);
            clearInterval(id);
        };
    }, [selectedProduct, matchingLicense, fetchLive]);

    // Derived metrics from live data (no historical fallback — this page is live-only).
    // Every value either comes from /api/performance/account (real MT5 feed) or is null.
    const metrics = useMemo(() => {
        const liveStats = liveData?.stats || {};
        const isLive = liveStats != null && Object.keys(liveStats).length > 0;
        const balance = liveData?.account?.balance != null ? Number(liveData.account.balance) : null;
        const profit = liveStats.netProfit != null ? Number(liveStats.netProfit) : null;
        const winRate = liveStats.winRate != null ? Number(liveStats.winRate) : null;
        const maxDrawdown = liveData?.account?.drawdown != null ? Number(liveData.account.drawdown) : null;
        const totalTrades = liveStats.totalTrades != null ? Number(liveStats.totalTrades) : 0;
        const winningTrades = liveStats.winningTrades != null ? Number(liveStats.winningTrades) : 0;
        const losingTrades = liveStats.losingTrades != null ? Number(liveStats.losingTrades) : 0;

        const rawPf = liveStats.profitFactor;
        const isPfUnbounded =
            liveStats.profitFactorUnbounded === true ||
            rawPf === Infinity ||
            (typeof rawPf === "number" && rawPf >= 999) ||
            (winningTrades > 0 && losingTrades === 0);

        const profitFactor =
            isPfUnbounded
                ? null
                : rawPf != null && Number.isFinite(Number(rawPf))
                ? Number(rawPf)
                : null;

        const totalProfitVal = liveStats.totalProfit != null ? Number(liveStats.totalProfit) : profit;
        const expectedPayoff = totalTrades > 0 && totalProfitVal !== null
            ? (totalProfitVal / totalTrades).toFixed(2)
            : null;
        // Return % is only honest if we know the starting balance. We don't, so
        // we surface net profit in USD instead of an invented %.
        const hasBalanceForReturn = balance !== null && profit !== null && balance > 0;
        const returnPct = hasBalanceForReturn
            ? Number(((profit as number) / (balance as number)) * 100)
            : null;
        return {
            isLive,
            balance,
            profit,
            winRate,
            profitFactor,
            isPfUnbounded,
            maxDrawdown,
            totalTrades,
            winningTrades,
            losingTrades,
            expectedPayoff,
            returnPct,
        };
    }, [liveData]);

    const equityCurve = useMemo(() => {
        if (!equityPoints || equityPoints.length === 0) return [];
        return equityPoints.map((pt, idx) => ({
            point: idx,
            date: new Date(pt.timestamp).toLocaleDateString("en-US", { month: "short", day: "numeric" }),
            balance: Number(pt.balance || 0),
            equity: Number(pt.equity || 0),
            drawdown: Number(pt.drawdown || 0),
        }));
    }, [equityPoints]);

    const weekdayData = useMemo(() => {
        const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
        const map: Record<string, { profit: number; trades: number; wins: number }> = {
            Mon: { profit: 0, trades: 0, wins: 0 },
            Tue: { profit: 0, trades: 0, wins: 0 },
            Wed: { profit: 0, trades: 0, wins: 0 },
            Thu: { profit: 0, trades: 0, wins: 0 },
            Fri: { profit: 0, trades: 0, wins: 0 },
        };
        if (liveData?.trades && liveData.trades.length > 0) {
            for (const t of liveData.trades) {
                const date = t.openedAt ? new Date(t.openedAt) : t.createdAt ? new Date(t.createdAt) : null;
                if (!date) continue;
                const dayName = days[date.getDay()];
                if (!map[dayName]) continue;
                const p = Number(t.netProfit || t.profit || 0);
                map[dayName].profit += p;
                map[dayName].trades += 1;
                if (p > 0) map[dayName].wins += 1;
            }
            return Object.entries(map).map(([day, v]) => ({
                day,
                profit: Number(v.profit.toFixed(2)),
                trades: v.trades,
                winRate: v.trades > 0 ? Number(((v.wins / v.trades) * 100).toFixed(1)) : 0,
            }));
        }
        return [];
    }, [liveData]);

    const sessionData = useMemo(() => {
        if (!liveData?.trades || liveData.trades.length === 0) return [];
        const sessions: Record<string, { profit: number; trades: number; wins: number }> = {
            "Asian Session": { profit: 0, trades: 0, wins: 0 },
            "London Session": { profit: 0, trades: 0, wins: 0 },
            "NY Session": { profit: 0, trades: 0, wins: 0 },
            "London/NY Overlap": { profit: 0, trades: 0, wins: 0 },
        };
        for (const t of liveData.trades) {
            const date = t.openedAt ? new Date(t.openedAt) : null;
            if (!date) continue;
            const hour = date.getUTCHours();
            const p = Number(t.netProfit || t.profit || 0);
            let key = "Asian Session";
            if (hour >= 8 && hour < 13) key = "London Session";
            else if (hour >= 13 && hour <= 16) key = "London/NY Overlap";
            else if (hour >= 13 && hour <= 21) key = "NY Session";
            sessions[key].profit += p;
            sessions[key].trades += 1;
            if (p > 0) sessions[key].wins += 1;
        }
        return Object.entries(sessions).map(([session, v]) => ({
            session,
            profit: Number(v.profit.toFixed(2)),
            trades: v.trades,
            winRate: v.trades > 0 ? Number(((v.wins / v.trades) * 100).toFixed(1)) : 0,
        }));
    }, [liveData]);

    const tradeExecutionProfile = useMemo(() => {
        if (!liveData?.trades || liveData.trades.length === 0) {
            return {
                longWinsPct: 0,
                shortWinsPct: 0,
                avgWinDuration: "—" as string,
                avgLossDuration: "—" as string,
                maxConsecutiveWins: 0,
                maxConsecutiveLosses: 0,
                currentStreak: { kind: "win" as const, count: 0 },
            };
        }
        let buyCount = 0;
        let buyWins = 0;
        let sellCount = 0;
        let sellWins = 0;
        let winDurSum = 0;
        let winDurCount = 0;
        let lossDurSum = 0;
        let lossDurCount = 0;
        let maxWinStreak = 0;
        let maxLossStreak = 0;
        let curW = 0;
        let curL = 0;
        for (const t of liveData.trades) {
            const profit = Number(t.netProfit || t.profit || 0);
            const type = String(t.type || "").toLowerCase();
            const isBuy = type.includes("buy");
            const isSell = type.includes("sell");
            if (isBuy) {
                buyCount += 1;
                if (profit > 0) buyWins += 1;
            } else if (isSell) {
                sellCount += 1;
                if (profit > 0) sellWins += 1;
            }
            if (profit > 0) {
                curW += 1;
                curL = 0;
                if (curW > maxWinStreak) maxWinStreak = curW;
            } else if (profit < 0) {
                curL += 1;
                curW = 0;
                if (curL > maxLossStreak) maxLossStreak = curL;
            } else {
                curW = 0;
                curL = 0;
            }
            const opened = t.openedAt ? new Date(t.openedAt).getTime() : 0;
            const closed = t.closedAt ? new Date(t.closedAt).getTime() : 0;
            if (opened > 0 && closed > 0) {
                const ms = closed - opened;
                if (ms > 0) {
                    if (profit > 0) { winDurSum += ms; winDurCount += 1; }
                    else if (profit < 0) { lossDurSum += ms; lossDurCount += 1; }
                }
            }
        }
        const fmt = (ms: number): string => {
            if (ms <= 0) return "—";
            const mins = Math.floor(ms / (1000 * 60));
            const hrs = Math.floor(mins / 60);
            const rem = mins % 60;
            return hrs > 0 ? `${hrs}h ${rem}m` : `${rem}m`;
        };
        // Current streak from the most recent trade.
        const sorted = [...liveData.trades].sort((a, b) => {
            const aTs = Number(a.closedAt || a.createdAt || a.openedAt || 0);
            const bTs = Number(b.closedAt || b.createdAt || b.openedAt || 0);
            return bTs - aTs;
        });
        const newest = sorted[0];
        const newestProfit = Number(newest.netProfit || newest.profit || 0);
        let curStreak = 0;
        const newestKind = newestProfit > 0 ? "win" : newestProfit < 0 ? "loss" : null;
        if (newestKind) {
            for (const t of sorted) {
                const p = Number(t.netProfit || t.profit || 0);
                if (newestKind === "win" && p > 0) curStreak += 1;
                else if (newestKind === "loss" && p < 0) curStreak += 1;
                else break;
            }
        }
        return {
            longWinsPct: buyCount > 0 ? Number(((buyWins / buyCount) * 100).toFixed(1)) : 0,
            shortWinsPct: sellCount > 0 ? Number(((sellWins / sellCount) * 100).toFixed(1)) : 0,
            avgWinDuration: winDurCount > 0 ? fmt(winDurSum / winDurCount) : "—",
            avgLossDuration: lossDurCount > 0 ? fmt(lossDurSum / lossDurCount) : "—",
            maxConsecutiveWins: maxWinStreak,
            maxConsecutiveLosses: maxLossStreak,
            currentStreak: newestKind
                ? { kind: newestKind, count: curStreak }
                : { kind: "win", count: 0 },
        };
    }, [liveData]);

    // AI Signal scan — POST /api/ai-signals
    async function handleAiSignal() {
        if (!user) {
            setScanResult({ generated: 0, error: "Sign in to generate AI signals." });
            return;
        }
        setScanning(true);
        setScanResult(null);
        try {
            const token = await user.getIdToken(true);
            const res = await fetch("/api/ai-signals", {
                method: "POST",
                headers: { Authorization: `Bearer ${token}` },
            });
            const data = await res.json();
            const generated = Number(data.generated ?? data.signals?.length ?? 0);
            if (!res.ok || !data.success) {
                setScanResult({ generated: 0, error: data.error || `Signal scan failed (${res.status}).` });
            } else if (generated > 0) {
                setScanResult({
                    generated,
                    message: `${generated} new signal${generated !== 1 ? "s" : ""} generated successfully.`,
                });
            } else {
                setScanResult({
                    generated: 0,
                    message: data.message || "No qualifying setups right now — try again in a few minutes.",
                });
            }
        } catch (err) {
            console.error("AI signal scan failed:", err);
            setScanResult({ generated: 0, error: "Failed to reach the AI signal engine." });
        } finally {
            setScanning(false);
        }
    }

    if (authLoading) {
        return (
            <AccountShell title="Live Performance" subtitle="Real-time MT5 account performance">
                <div className="flex flex-1 items-center justify-center py-16">
                    <Loader2 className="h-8 w-8 animate-spin text-positive" />
                </div>
            </AccountShell>
        );
    }

    return (
        <AccountShell
            title="Live Performance"
            subtitle="Real-time MT5 execution metrics from your connected accounts"
            onBack={() => router.push("/account")}
        >
            <div className="space-y-6">
                {/* HEADER ACTIONS: AI SIGNAL + LIVE PERFORMANCE BUTTONS */}
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex items-center gap-2 text-sm text-positive font-medium">
                        <Radio className="h-4 w-4" />
                        Live MT5 Execution Stream
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                        <button
                            type="button"
                            onClick={handleAiSignal}
                            disabled={scanning}
                            data-guide="ai-signal"
                            className={`inline-flex shrink-0 items-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-semibold transition-colors ${
                                scanning
                                    ? "border-warning/30 bg-warning/10 text-warning cursor-wait"
                                    : "border-warning/40 bg-warning/10 text-warning hover:bg-warning/20"
                            }`}
                        >
                            {scanning ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                                <Sparkles className="h-4 w-4" />
                            )}
                            {scanning ? "Scanning markets…" : "AI Signal"}
                        </button>
                        <Link
                            href="/signals"
                            className="inline-flex shrink-0 items-center gap-2 rounded-xl border border-border/30 bg-muted/5 px-4 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-muted/10"
                        >
                            <Zap className="h-4 w-4 text-warning" />
                            View Signal Feed
                            <ChevronRight className="h-3.5 w-3.5" />
                        </Link>
                        <button
                            type="button"
                            onClick={() => void fetchLive()}
                            className="inline-flex shrink-0 items-center gap-2 rounded-xl border border-border/30 bg-muted/5 px-4 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-muted/10"
                        >
                            <RefreshCw className={`h-4 w-4 ${loadingLive ? "animate-spin" : ""}`} />
                            Live Performance
                        </button>
                    </div>
                </div>

                {/* AI SIGNAL RESULT */}
                {scanResult && (
                    <div
                        className={`rounded-xl border px-4 py-2.5 text-sm font-medium flex items-center gap-2 transition-all ${
                            scanResult.error
                                ? "border-negative/20 bg-negative/10 text-negative"
                                : scanResult.generated > 0
                                    ? "border-positive/20 bg-positive/10 text-positive"
                                    : "border-warning/20 bg-warning/10 text-warning"
                        }`}
                    >
                        {scanResult.error ? (
                            <>
                                <ShieldCheck className="h-4 w-4 shrink-0" />
                                {scanResult.error}
                            </>
                        ) : scanResult.generated > 0 ? (
                            <>
                                <Sparkles className="h-4 w-4 shrink-0" />
                                {scanResult.message || `${scanResult.generated} new signal${scanResult.generated !== 1 ? "s" : ""} generated successfully`}
                            </>
                        ) : (
                            <>
                                <Radio className="h-4 w-4 shrink-0" />
                                {scanResult.message || "No qualifying setups right now — try again in a few minutes"}
                            </>
                        )}
                    </div>
                )}

                {error && (
                    <div className="rounded-xl border border-negative/20 bg-negative/10 px-4 py-3 text-sm text-negative">
                        {error}
                    </div>
                )}

                {/* BOT SELECTOR */}
                {products.length > 0 && (
                    <div className="rounded-lg border border-border/30 bg-card/60 p-5 backdrop-blur-xl">
                        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                            <div>
                                <label className="text-xs uppercase tracking-wider text-muted-foreground font-medium">
                                    Connected Product
                                </label>
                                <div className="mt-1 flex flex-wrap items-center gap-3">
                                    <select
                                        value={selectedProductId}
                                        onChange={(e) => setSelectedProductId(e.target.value)}
                                        className="rounded-xl border border-border/30 bg-card px-3.5 py-2 text-sm font-bold text-foreground outline-none focus:border-positive/50"
                                    >
                                        {products.map((p) => (
                                            <option key={p.id} value={p.id}>
                                                {p.name || p.id}
                                            </option>
                                        ))}
                                    </select>
                                    {matchingLicense ? (
                                        <span className="inline-flex items-center gap-1.5 rounded-full border border-positive/30 bg-positive/10 px-3 py-1 text-xs font-semibold text-positive whitespace-nowrap shrink-0">
                                            <Wifi size={12} /> License Active
                                        </span>
                                    ) : (
                                        <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-muted px-3 py-1 text-xs font-semibold text-muted-foreground whitespace-nowrap shrink-0">
                                            <WifiOff size={12} /> No Active License
                                        </span>
                                    )}
                                </div>
                            </div>

                            <div className="flex items-center gap-2 overflow-x-auto rounded-xl border border-border/30 bg-background p-1 scrollbar-none">
                                {(["equity", "drawdown", "weekday", "session"] as ChartType[]).map((c) => (
                                    <button
                                        key={c}
                                        type="button"
                                        onClick={() => setChartType(c)}
                                        className={`rounded-lg px-3 py-1 text-xs font-medium transition-all whitespace-nowrap shrink-0 ${
                                            chartType === c
                                                    ? "bg-positive/20 text-positive border border-positive/30 font-semibold"
                                                    : "text-muted-foreground hover:text-foreground"
                                            }`}
                                    >
                                        {c === "equity" ? "Equity Curve" : c === "drawdown" ? "Drawdown" : c === "weekday" ? "By Weekday" : "By Session"}
                                    </button>
                                ))}
                            </div>
                        </div>
                    </div>
                )}

                {/* HONEST EMPTY STATE — no live data yet */}
                {!loadingLive && !metrics.isLive && matchingLicense && (
                    <div className="rounded-lg border border-dashed border-border bg-muted/20 p-8">
                        <div className="flex flex-col items-center text-center">
                            <Radio className="h-8 w-8 text-positive" />
                            <h3 className="mt-3 text-base font-semibold text-foreground">Awaiting first heartbeat</h3>
                            <p className="mt-2 max-w-md text-sm text-muted-foreground">
                                Your license is active but the MT5 terminal hasn&apos;t pushed a heartbeat yet. Once the EA
                                sends account balance, equity, and trade history, the KPIs, equity curve and analytics
                                below will populate from the real feed.
                            </p>
                        </div>
                    </div>
                )}

                {!matchingLicense && products.length > 0 && (
                    <div className="rounded-lg border border-dashed border-border bg-muted/20 p-8">
                        <div className="flex flex-col items-center text-center">
                            <WifiOff className="h-8 w-8 text-muted-foreground" />
                            <h3 className="mt-3 text-base font-semibold text-foreground">No active license</h3>
                            <p className="mt-2 max-w-md text-sm text-muted-foreground">
                                Activate a product license for the MT5 account you want to inspect. Live performance is
                                computed from your real executions — nothing here is synthetic.
                            </p>
                            <Link
                                href="/account/licenses"
                                className="mt-4 inline-flex items-center gap-2 rounded-xl bg-foreground px-4 py-2 text-sm font-medium text-background transition hover:opacity-90"
                            >
                                Manage Licenses
                            </Link>
                        </div>
                    </div>
                )}

                {/* KPI STAT CARDS — only show when there's real data */}
                {metrics.isLive && (
                    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                        <div className="rounded-lg border border-border/30 bg-gradient-to-br from-positive/10 via-background/60 to-background p-5 backdrop-blur-xl">
                            <div className="flex items-center justify-between text-xs text-muted-foreground">
                                <span>Net Profit</span>
                                <TrendingUp className="h-4 w-4 text-positive" />
                            </div>
                            <div className="mt-3 text-2xl font-black text-positive">
                                {metrics.profit !== null
                                    ? `${metrics.profit > 0 ? "+" : ""}${formatMoney(metrics.profit)}`
                                    : "—"}
                            </div>
                            <div className="mt-1 text-xs text-muted-foreground">
                                {metrics.returnPct !== null
                                    ? `${metrics.returnPct > 0 ? "+" : ""}${metrics.returnPct.toFixed(2)}% on reported balance`
                                    : "balance unavailable — % suppressed"}
                            </div>
                        </div>

                        <div className="rounded-lg border border-border/30 bg-gradient-to-br from-warning/10 via-background/60 to-background p-5 backdrop-blur-xl">
                            <div className="flex items-center justify-between text-xs text-muted-foreground">
                                <span>Win Rate</span>
                                <Target className="h-4 w-4 text-warning" />
                            </div>
                            <div className="mt-3 text-2xl font-black text-foreground">
                                {metrics.winRate !== null && metrics.winRate > 0
                                    ? `${metrics.winRate.toFixed(1)}%`
                                    : "—"}
                            </div>
                            <div className="mt-1 text-xs text-muted-foreground">
                                {metrics.totalTrades > 0
                                    ? `${metrics.winningTrades} wins / ${metrics.losingTrades} losses (${metrics.totalTrades} trades)`
                                    : "no closed trades yet"}
                            </div>
                        </div>

                        <div className="rounded-lg border border-border/30 bg-gradient-to-br from-info/10 via-background/60 to-background p-5 backdrop-blur-xl">
                            <div className="flex items-center justify-between text-xs text-muted-foreground">
                                <span>Profit Factor</span>
                                <BarChart3 className="h-4 w-4 text-info" />
                            </div>
                            <div className="mt-3 text-2xl font-black text-foreground">
                                {metrics.isPfUnbounded
                                    ? "∞"
                                    : metrics.profitFactor !== null && metrics.profitFactor > 0
                                    ? metrics.profitFactor.toFixed(2)
                                    : metrics.totalTrades > 0 && metrics.winningTrades === 0
                                    ? "0.00"
                                    : "—"}
                            </div>
                            <div className="mt-1 text-xs text-muted-foreground">
                                {metrics.totalTrades > 0 && metrics.expectedPayoff !== null
                                    ? `Payoff / trade: ${formatMoney(Number(metrics.expectedPayoff))}${metrics.isPfUnbounded ? " · no losses" : ""}`
                                    : "no closed trades yet"}
                            </div>
                        </div>

                        <div className="rounded-lg border border-border/30 bg-gradient-to-br from-negative/10 via-background/60 to-background p-5 backdrop-blur-xl">
                            <div className="flex items-center justify-between text-xs text-muted-foreground">
                                <span>Max Drawdown</span>
                                <TrendingDown className="h-4 w-4 text-negative" />
                            </div>
                            <div className="mt-3 text-2xl font-black text-negative">
                                {metrics.maxDrawdown !== null && metrics.maxDrawdown > 0
                                    ? `-${metrics.maxDrawdown.toFixed(2)}%`
                                    : "—"}
                            </div>
                            <div className="mt-1 text-xs text-muted-foreground">
                                {metrics.maxDrawdown !== null && metrics.maxDrawdown > 0
                                    ? `reported by EA on ${selectedProduct?.name || selectedProductId}`
                                    : "awaiting drawdown telemetry"}
                            </div>
                        </div>
                    </div>
                )}

                {/* EQUITY CURVE CHART */}
                <div className="rounded-lg border border-border/30 bg-card/60 p-6 backdrop-blur-xl">
                    <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                        <div>
                            <h2 className="text-lg font-bold text-foreground flex items-center gap-2">
                                <span>Live Performance Charts</span>
                                <span className="rounded-md border border-positive/30 bg-positive/10 px-2 py-0.5 text-micro text-positive font-semibold uppercase">
                                    {metrics.isLive ? "Real MT5 Data" : "Awaiting Heartbeat"}
                                </span>
                            </h2>
                            <p className="text-xs text-muted-foreground mt-1">
                                Period: Live MT5 Connected · Polled every {POLL_MS / 1000}s
                            </p>
                        </div>
                    </div>

                    <div className="mt-6 h-80 w-full">
                        {equityCurve.length === 0 && (chartType === "equity" || chartType === "drawdown") && (
                            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                                No live equity points yet. Connect an MT5 account to see real performance curves.
                            </div>
                        )}
                        {chartType === "weekday" && weekdayData.length === 0 && (
                            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                                No trade data available for weekday analysis.
                            </div>
                        )}
                        {chartType === "session" && sessionData.length === 0 && (
                            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                                No trade data available for session analysis.
                            </div>
                        )}
                        {((chartType === "equity" || chartType === "drawdown") && equityCurve.length > 0 ||
                            chartType === "weekday" && weekdayData.length > 0 ||
                            chartType === "session" && sessionData.length > 0) && (
                            <ResponsiveContainer width="100%" height="100%">
                                {chartType === "equity" ? (
                                    <AreaChart data={equityCurve}>
                                        <defs>
                                            <linearGradient id="livePerfGradient" x1="0" y1="0" x2="0" y2="1">
                                                <stop offset="5%" stopColor="#10b981" stopOpacity={0.35} />
                                                <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                                            </linearGradient>
                                        </defs>
                                        <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
                                        <XAxis dataKey="date" stroke="#71717a" fontSize={12} tickLine={false} />
                                        <YAxis
                                            stroke="#71717a"
                                            fontSize={12}
                                            tickLine={false}
                                            domain={["auto", "auto"]}
                                            tickFormatter={(v) => `$${v}`}
                                        />
                                        <Tooltip
                                            contentStyle={{ backgroundColor: "#09090b", borderColor: "#27272a", borderRadius: "12px", color: "#fff" }}
                                            formatter={(val) => [`$${val}`, "Equity"]}
                                        />
                                        <Area
                                            type="monotone"
                                            dataKey="equity"
                                            stroke="#10b981"
                                            strokeWidth={2.5}
                                            fillOpacity={1}
                                            fill="url(#livePerfGradient)"
                                        />
                                    </AreaChart>
                                ) : chartType === "drawdown" ? (
                                    <BarChart data={equityCurve}>
                                        <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
                                        <XAxis dataKey="date" stroke="#71717a" fontSize={12} tickLine={false} />
                                        <YAxis stroke="#71717a" fontSize={12} tickLine={false} tickFormatter={(v) => `-${v}%`} />
                                        <Tooltip
                                            contentStyle={{ backgroundColor: "#09090b", borderColor: "#27272a", borderRadius: "12px", color: "#fff" }}
                                            formatter={(val) => [`-${val}%`, "Drawdown"]}
                                        />
                                        <Bar dataKey="drawdown" fill="#ef4444" radius={[4, 4, 0, 0]} />
                                    </BarChart>
                                ) : chartType === "weekday" ? (
                                    <BarChart data={weekdayData}>
                                        <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
                                        <XAxis dataKey="day" stroke="#71717a" fontSize={12} tickLine={false} />
                                        <YAxis stroke="#71717a" fontSize={12} tickLine={false} tickFormatter={(v) => `$${v}`} />
                                        <Tooltip
                                            contentStyle={{ backgroundColor: "#09090b", borderColor: "#27272a", borderRadius: "12px", color: "#fff" }}
                                            formatter={(val) => [`$${val}`, "Net Profit"]}
                                        />
                                        <Bar dataKey="profit" radius={[6, 6, 0, 0]}>
                                            {weekdayData.map((entry, index) => (
                                                <Cell key={`cell-${index}`} fill={entry.profit >= 0 ? "#10b981" : "#ef4444"} />
                                            ))}
                                        </Bar>
                                    </BarChart>
                                ) : (
                                    <BarChart data={sessionData}>
                                        <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
                                        <XAxis dataKey="session" stroke="#71717a" fontSize={12} tickLine={false} />
                                        <YAxis stroke="#71717a" fontSize={12} tickLine={false} tickFormatter={(v) => `$${v}`} />
                                        <Tooltip
                                            contentStyle={{ backgroundColor: "#09090b", borderColor: "#27272a", borderRadius: "12px", color: "#fff" }}
                                            formatter={(val) => [`$${val}`, "Net Profit"]}
                                        />
                                        <Bar dataKey="profit" fill="#3b82f6" radius={[6, 6, 0, 0]} />
                                    </BarChart>
                                )}
                            </ResponsiveContainer>
                        )}
                    </div>
                </div>

                {/* RISK + RATIOS + EXECUTION PROFILE */}
                <div className="grid gap-6 md:grid-cols-3">
                    <div className="rounded-lg border border-border/30 bg-card/60 p-5 backdrop-blur-xl">
                        <div className="flex items-center justify-between border-b border-border/30 pb-3">
                            <h3 className="font-bold text-foreground flex items-center gap-2">
                                <Activity className="h-4 w-4 text-positive" />
                                <span>Risk Profile</span>
                            </h3>
                            <span className={`text-micro uppercase tracking-wider font-semibold px-2 py-0.5 rounded border ${
                                metrics.maxDrawdown === null || metrics.maxDrawdown === 0
                                    ? "text-muted-foreground bg-muted border-border"
                                    : metrics.maxDrawdown < 15
                                        ? "text-positive bg-positive/10 border-positive/20"
                                        : metrics.maxDrawdown < 25
                                            ? "text-warning bg-warning/10 border-warning/20"
                                            : "text-negative bg-negative/10 border-negative/20"
                            }`}>
                                {metrics.maxDrawdown === null || metrics.maxDrawdown === 0
                                    ? "Awaiting Data"
                                    : metrics.maxDrawdown < 15
                                        ? "Low Risk"
                                        : metrics.maxDrawdown < 25
                                            ? "Moderate Risk"
                                            : "Elevated Risk"}
                            </span>
                        </div>

                        <div className="mt-4 space-y-3.5 text-xs">
                            <div className="flex justify-between">
                                <span className="text-muted-foreground">Max Consecutive Wins:</span>
                                <span className="font-bold text-foreground">
                                    {tradeExecutionProfile.maxConsecutiveWins > 0
                                        ? `${tradeExecutionProfile.maxConsecutiveWins}`
                                        : metrics.isLive ? "0" : "—"}
                                </span>
                            </div>
                            <div className="flex justify-between">
                                <span className="text-muted-foreground">Max Consecutive Losses:</span>
                                <span className="font-bold text-foreground">
                                    {tradeExecutionProfile.maxConsecutiveLosses > 0
                                        ? `${tradeExecutionProfile.maxConsecutiveLosses}`
                                        : metrics.isLive ? "0" : "—"}
                                </span>
                            </div>
                            <div className="flex justify-between pt-2 border-t border-border/10">
                                <span className="text-muted-foreground">Heartbeat:</span>
                                <span className={`font-bold ${metrics.isLive ? "text-positive" : "text-warning"}`}>
                                    {metrics.isLive ? "Live" : matchingLicense ? "Awaiting" : "No License"}
                                </span>
                            </div>
                        </div>
                    </div>

                    <div className="rounded-lg border border-border/30 bg-card/60 p-5 backdrop-blur-xl">
                        <div className="flex items-center justify-between border-b border-border/30 pb-3">
                            <h3 className="font-bold text-foreground flex items-center gap-2">
                                <Zap className="h-4 w-4 text-info" />
                                <span>Trade Stats</span>
                            </h3>
                            <span className="text-micro uppercase tracking-wider font-semibold text-info bg-info/10 border border-info/20 px-2 py-0.5 rounded">
                                {metrics.isLive ? "Live" : "Idle"}
                            </span>
                        </div>

                        <div className="mt-4 space-y-3.5 text-xs">
                            <div className="flex justify-between">
                                <span className="text-muted-foreground">Payoff / Trade:</span>
                                <span className="font-bold text-warning">
                                    {metrics.expectedPayoff !== null
                                        ? formatMoney(Number(metrics.expectedPayoff))
                                        : "—"}
                                </span>
                            </div>
                            <div className="flex justify-between">
                                <span className="text-muted-foreground">Net Profit:</span>
                                <span className="font-bold text-foreground">
                                    {metrics.profit !== null
                                        ? `${metrics.profit > 0 ? "+" : ""}${formatMoney(metrics.profit)}`
                                        : "—"}
                                </span>
                            </div>
                            <div className="flex justify-between">
                                <span className="text-muted-foreground">Reported Balance:</span>
                                <span className="font-bold text-foreground">
                                    {metrics.balance !== null ? formatMoney(metrics.balance) : "—"}
                                </span>
                            </div>
                            <div className="flex justify-between pt-2 border-t border-border/10">
                                <span className="text-muted-foreground">Current Streak:</span>
                                <span className="font-bold text-foreground">
                                    {metrics.isLive && tradeExecutionProfile.currentStreak.count > 0
                                        ? `${tradeExecutionProfile.currentStreak.count}${tradeExecutionProfile.currentStreak.kind === "win" ? "W" : "L"}`
                                        : "—"}
                                </span>
                            </div>
                        </div>
                    </div>

                    <div className="rounded-lg border border-border/30 bg-card/60 p-5 backdrop-blur-xl">
                        <div className="flex items-center justify-between border-b border-border/30 pb-3">
                            <h3 className="font-bold text-foreground flex items-center gap-2">
                                <Clock className="h-4 w-4 text-positive" />
                                <span>Trade Execution Profile</span>
                            </h3>
                            <span className="text-micro uppercase tracking-wider font-semibold text-chart-4 bg-chart-4/10 border border-chart-4/20 px-2 py-0.5 rounded">
                                Real Trades
                            </span>
                        </div>

                        <div className="mt-4 space-y-3.5 text-xs">
                            <div className="flex justify-between">
                                <span className="text-muted-foreground">Avg Winning Hold Time:</span>
                                <span className="font-semibold text-positive">{tradeExecutionProfile.avgWinDuration}</span>
                            </div>
                            <div className="flex justify-between">
                                <span className="text-muted-foreground">Avg Losing Hold Time:</span>
                                <span className="font-semibold text-negative">{tradeExecutionProfile.avgLossDuration}</span>
                            </div>
                            <div className="flex justify-between">
                                <span className="text-muted-foreground">Longs Won Win %:</span>
                                <span className="font-bold text-foreground">
                                    {tradeExecutionProfile.longWinsPct ? `${tradeExecutionProfile.longWinsPct}%` : "—"}
                                </span>
                            </div>
                            <div className="flex justify-between pt-2 border-t border-border/10">
                                <span className="text-muted-foreground">Shorts Won Win %:</span>
                                <span className="font-bold text-foreground">
                                    {tradeExecutionProfile.shortWinsPct ? `${tradeExecutionProfile.shortWinsPct}%` : "—"}
                                </span>
                            </div>
                        </div>
                    </div>
                </div>

                {/* BACK LINK */}
                <div className="flex items-center gap-3 pt-2">
                    <Link
                        href="/backtests"
                        className="inline-flex items-center gap-2 text-sm text-muted-foreground transition hover:text-foreground"
                    >
                        <ArrowLeft size={14} />
                        Backtest comparison
                    </Link>
                    <span className="text-muted-foreground">·</span>
                    <Link
                        href="/verified-performance"
                        className="inline-flex items-center gap-2 text-sm text-muted-foreground transition hover:text-foreground"
                    >
                        Verified performance audit
                    </Link>
                </div>
            </div>
        </AccountShell>
    );
}