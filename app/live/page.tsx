"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
    Activity,
    ArrowDown,
    ArrowLeft,
    ArrowUp,
    BarChart3,
    Bot,
    CircleDollarSign,
    Clock,
    ExternalLink,
    FileText,
    RefreshCw,
    ShieldCheck,
    Target,
    TrendingDown,
    TrendingUp,
    Trophy,
    Wallet,
} from "lucide-react";

import type { LucideIcon } from "lucide-react";

import {
    onAuthStateChanged,
    User,
} from "firebase/auth";

import {
    onValue,
    ref,
} from "firebase/database";

import {
    auth,
    database,
} from "@/lib/firebase";

import {
    ResponsiveContainer,
    AreaChart,
    Area,
    PieChart,
    Pie,
    Cell,
    Legend,
    XAxis,
    YAxis,
    Tooltip,
    CartesianGrid,
} from "recharts";

import ProGate from "@/components/subscription/ProGate";

type License = {
    productId?: string;
    licenseKey?: string;
    status?: string;
    mt5Account?: string | number;
    expiresAt?: number;
};

type Product = {
    id: string;
    name?: string;
    slug?: string;
    platform?: string;
    symbol?: string;
    description?: string;
    status?: string;
    performance?: {
        profit?: number | string;
        winRate?: number | string;
        profitFactor?: number | string;
        totalTrades?: number | string;
        backtestPeriod?: string;
        initialDeposit?: number | string;
        finalBalance?: number | string;
    };
    risk?: {
        maxDrawdown?: number | string;
    };
    branding?: {
        icon?: {
            path?: string;
        };
        logo?: {
            path?: string;
        };
    };
};

type Account = {
    productId?: string;
    mt5Account?: string;
    broker?: string;
    server?: string;
    currency?: string;
    balance?: number;
    equity?: number;
    floatingProfit?: number;
    peakEquity?: number;
    drawdown?: number;
    status?: string;
    lastHeartbeatAt?: number;
};

type Statistics = {
    totalTrades: number;
    winningTrades: number;
    losingTrades: number;
    breakevenTrades?: number;
    winRate: number;
    netProfit?: number;
    totalProfit: number;
    grossProfit: number;
    grossLoss: number;
    profitFactor: number;
    averageWin: number;
    averageLoss: number;
    largestWin?: number;
    largestLoss?: number;
    bestTrade: number;
    worstTrade: number;
    maxDrawdown?: number;
};

type Trade = {
    ticket?: string;
    symbol?: string;
    type?: string;
    volume?: number;
    openPrice?: number;
    closePrice?: number | null;
    profit?: number;
    commission?: number;
    swap?: number;
    netProfit?: number;
    openedAt?: number | null;
    closedAt?: number | null;
};

type OpenPosition = {
    ticket?: string;
    symbol?: string;
    type?: "BUY" | "SELL" | string;
    volume?: number;
    openPrice?: number;
    currentPrice?: number;
    profit?: number;
    swap?: number;
    openedAt?: number | null;
    magic?: string | number;
    lastSeenAt?: number;
};

type EquityPoint = {
    timestamp: number;
    balance: number;
    equity: number;
    floatingProfit: number;
    peakEquity: number;
    drawdown: number;
};

type PerformanceResponse = {
    success?: boolean;
    accountId?: string;
    productId?: string;
    mt5Account?: string;
    status?: string;
    online?: boolean;
    account?: Account | null;
    stats?: Statistics;
    statistics?: Statistics;
    trades?: Trade[];
};

const EMPTY_STATS: Statistics = {
    totalTrades: 0,
    winningTrades: 0,
    losingTrades: 0,
    winRate: 0,
    totalProfit: 0,
    grossProfit: 0,
    grossLoss: 0,
    profitFactor: 0,
    averageWin: 0,
    averageLoss: 0,
    bestTrade: 0,
    worstTrade: 0,
};

function formatMoney(
    value: number,
    currency = "USD"
) {
    try {
        return new Intl.NumberFormat(
            "en-US",
            {
                style: "currency",
                currency,
                maximumFractionDigits: 2,
            }
        ).format(value);
    } catch {
        return `${value.toFixed(2)} ${currency}`;
    }
}

function formatDate(
    timestamp?: number | null
) {
    if (!timestamp) {
        return "—";
    }

    return new Date(timestamp).toLocaleString();
}

function formatChartTime(
    timestamp: number
) {
    return new Date(
        timestamp
    ).toLocaleTimeString(
        [],
        {
            hour: "2-digit",
            minute: "2-digit",
        }
    );
}

function filterEquityByRange(
    equity: EquityPoint[],
    range: "1D" | "1W" | "1M" | "3M" | "1Y" | "All"
) {
    if (range === "All") return equity;
    const msMap: Record<string, number> = {
        "1D": 24 * 60 * 60 * 1000,
        "1W": 7 * 24 * 60 * 60 * 1000,
        "1M": 30 * 24 * 60 * 60 * 1000,
        "3M": 90 * 24 * 60 * 60 * 1000,
        "1Y": 365 * 24 * 60 * 60 * 1000,
    };
    const cutoff = Date.now() - msMap[range];
    return equity.filter((p) => p.timestamp >= cutoff);
}

function StatCard({
    title,
    value,
    icon: Icon,
    description,
}: {
    title: string;
    value: string;
    icon: LucideIcon;
    description?: string;
}) {
    return (
        <div className="rounded-2xl border border-border/30 bg-foreground/8 p-5">
            <div className="flex items-start justify-between">
                <div>
                    <p className="text-sm text-muted-foreground">
                        {title}
                    </p>

                    <p className="mt-2 text-2xl font-bold text-foreground">
                        {value}
                    </p>

                    {description && (
                        <p className="mt-1 text-xs text-muted-foreground">
                            {description}
                        </p>
                    )}
                </div>

                <div className="rounded-xl border border-border/30 bg-muted/5 p-2.5">
                    <Icon className="h-5 w-5 text-muted-foreground" />
                </div>
            </div>
        </div>
    );
}

function TradeType({
    type,
}: {
    type?: string;
}) {
    const isBuy = type === "BUY";

    return (
        <span
            className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium ${isBuy
                ? "bg-emerald-500/10 text-emerald-400"
                : "bg-red-500/10 text-red-400"
                }`}
        >
            {isBuy ? (
                <ArrowUp className="h-3 w-3" />
            ) : (
                <ArrowDown className="h-3 w-3" />
            )}

            {type || "—"}
        </span>
    );
}

export default function LivePerformancePage() {
    const [user, setUser] =
        useState<User | null>(null);

    const [botLogo, setBotLogo] = useState<string | null>(null);

    const [licenses, setLicenses] =
        useState<License[]>([]);

    const [products, setProducts] =
        useState<Product[]>([]);

    const [selectedLicenseIndex, setSelectedLicenseIndex] =
        useState(0);

    const [performance, setPerformance] =
        useState<PerformanceResponse | null>(
            null
        );

    const [equity, setEquity] =
        useState<EquityPoint[]>([]);

    const [openPositions, setOpenPositions] =
        useState<OpenPosition[]>([]);

    const [loading, setLoading] =
        useState(true);

    const [refreshing, setRefreshing] =
        useState(false);

    const [error, setError] =
        useState("");

    const [dateRange, setDateRange] =
        useState<"1D" | "1W" | "1M" | "3M" | "1Y" | "All">("1D");

    /*
     * CLOCK
     */
    const [nowTimestamp, setNowTimestamp] =
        useState(0);

    useEffect(() => {
        void Promise.resolve().then(() => setNowTimestamp(Date.now()));

        const clockInterval =
            setInterval(() => {
                setNowTimestamp(Date.now());
            }, 60000);

        return () =>
            clearInterval(clockInterval);
    }, []);

    /*
     * AUTH
     */
    useEffect(() => {
        return onAuthStateChanged(
            auth,
            (currentUser) => {
                setUser(currentUser);
                if (!currentUser) {
                    setLoading(false);
                }
            }
        );
    }, []);

    /*
     * LOAD LICENSES + PRODUCTS
     */
    useEffect(() => {
        if (!user) {
            void Promise.resolve().then(() => {
                setLicenses([]);
                setProducts([]);
                setOpenPositions([]);
                setPerformance(null);
                setEquity([]);
                setLoading(false);
            });
            return;
        }

        const unsubscribeLicenses =
            onValue(
                ref(
                    database,
                    `licenses/${user.uid}`
                ),
                (snapshot) => {
                    const data =
                        snapshot.val() || {};

                    const list: License[] =
                        Object.values(data);

                    setLicenses(list);
                }
            );

        const unsubscribeProducts =
            onValue(
                ref(
                    database,
                    "bots"
                ),
                (snapshot) => {
                    const raw =
                        (snapshot.val() || {}) as Record<string, Product>;

                    const list: Product[] =
                        Object.entries(raw)
                            .map(
                                ([
                                    id,
                                    value,
                                ]) => ({
                                    ...value,
                                    id,
                                })
                            )
                            .filter(
                                (product) =>
                                    product.status ===
                                    "published"
                            );

                    setProducts(list);
                }
            );

        return () => {
            unsubscribeLicenses();
            unsubscribeProducts();
        };
    }, [user]);

    /*
     * ACTIVE LICENSES
     */
    const activeLicenses = useMemo(
        () =>
            licenses.filter(
                (license) =>
                    license.status ===
                    "active" &&
                    Number(
                        license.expiresAt ||
                        0
                    ) > nowTimestamp
            ),
        [licenses, nowTimestamp]
    );

    /*
     * SELECTED LICENSE
     */
    const selectedLicense =
        activeLicenses[
        selectedLicenseIndex
        ] || null;

    /*
     * SELECTED PRODUCT
     */
    const selectedProduct =
        selectedLicense
            ? products.find(
                (product) =>
                    product.id ===
                    selectedLicense.productId
            )
            : null;

    /*
     * LOAD LIVE PERFORMANCE
     */
    async function loadPerformance(
        showRefresh = false
    ) {
        if (!selectedProduct?.id) {

            setBotLogo(null);

            return;

        }

        const loadBotLogo = async () => {
            try {
                const logoUrl = `/api/products/branding?productId=${encodeURIComponent(
                    selectedProduct.id
                )}&type=logo`;

                const response = await fetch(logoUrl);

                if (response.ok) {
                    setBotLogo(logoUrl);
                    return;
                }

                const iconUrl = `/api/products/branding?productId=${encodeURIComponent(
                    selectedProduct.id
                )}&type=icon`;

                const iconResponse = await fetch(iconUrl);

                if (iconResponse.ok) {
                    setBotLogo(iconUrl);
                    return;
                }

                setBotLogo(null);
            } catch (error) {
                console.error("Failed to load bot logo:", error);
                setBotLogo(null);
            }
        };

        loadBotLogo();
        if (
            !selectedLicense ||
            !selectedProduct ||
            !user
        ) {
            setPerformance(null);
            setEquity([]);
            setOpenPositions([]);
            setLoading(false);
            return;
        }

        try {
            if (showRefresh) {
                setRefreshing(true);
            } else {
                setLoading(true);
            }

            setError("");

            const account =
                String(
                    selectedLicense.mt5Account ||
                    ""
                ).trim();

            const productId =
                selectedLicense.productId ||
                selectedProduct.id ||
                "";

            const licenseKey =
                selectedLicense.licenseKey ||
                "";

            const encodedProduct =
                encodeURIComponent(
                    productId
                );

            const encodedLicense =
                encodeURIComponent(
                    licenseKey
                );

            const encodedAccount =
                encodeURIComponent(
                    account
                );

            const [
                performanceResponse,
                equityResponse,
            ] = await Promise.all([
                fetch(
                    `/api/performance/account?productId=${encodedProduct}&licenseKey=${encodedLicense}&mt5Account=${encodedAccount}`,
                    {
                        cache: "no-store",
                    }
                ),

                fetch(
                    `/api/performance/equity?productId=${encodedProduct}&licenseKey=${encodedLicense}&mt5Account=${encodedAccount}&hours=24`,
                    {
                        cache: "no-store",
                    }
                ),
            ]);

            const performanceData =
                await performanceResponse.json();

            const equityData =
                await equityResponse.json();

            if (
                !performanceResponse.ok
            ) {
                throw new Error(
                    performanceData?.error ||
                    "Unable to load performance."
                );
            }

            if (!equityResponse.ok) {
                throw new Error(
                    equityData?.error ||
                    "Unable to load equity history."
                );
            }

            setPerformance(
                performanceData
            );

            setEquity(
                Array.isArray(
                    equityData?.points
                )
                    ? equityData.points
                    : []
            );

            /*
             * --------------------------------------------------
             * OPEN POSITIONS (Non-blocking)
             * --------------------------------------------------
             */
            try {
                const effectiveAccount = performanceData?.mt5Account || account;
                const positionsUrl =
                    `/api/performance/positions` +
                    `?productId=${encodedProduct}` +
                    `&licenseKey=${encodedLicense}` +
                    `&mt5Account=${encodeURIComponent(effectiveAccount)}`;

                const positionsResponse = await fetch(positionsUrl, {
                    cache: "no-store",
                });

                if (positionsResponse.ok) {
                    const positionsData = await positionsResponse.json();
                    if (positionsData?.success && Array.isArray(positionsData.positions)) {
                        setOpenPositions(positionsData.positions);
                    } else {
                        setOpenPositions([]);
                    }
                } else {
                    setOpenPositions([]);
                }
            } catch (posErr) {
                console.warn("[LIVE] Open positions fetch non-critical error:", posErr);
                setOpenPositions([]);
            }
        } catch (err: unknown) {
            console.error(
                "LIVE PERFORMANCE ERROR:",
                err
            );

            setError(
                err instanceof Error
                    ? err.message
                    : "Unable to load live performance."
            );
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    }

    /*
     * AUTO REFRESH
     */
    useEffect(() => {
        void Promise.resolve().then(() => loadPerformance());

        const interval =
            setInterval(() => {
                loadPerformance(true);
            }, 10000);

        return () =>
            clearInterval(interval);

        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [
        selectedLicense?.licenseKey,
        selectedLicense?.productId,
        selectedLicense?.mt5Account,
        selectedProduct?.id,
        user?.uid,
    ]);

    /*
     * ACCOUNT
     */
    const account =
        performance?.account || null;

    /*
     * STATS
     */
    const stats =
        performance?.stats ||
        performance?.statistics ||
        EMPTY_STATS;

    /*
     * CURRENCY
     */
    const currency =
        account?.currency || "USD";

    /*
     * TOTAL PROFIT
     */
    const totalProfit =
        Number(
            stats.totalProfit || 0
        );

    const profitPositive =
        totalProfit >= 0;

    const filteredEquity = useMemo(
        () => filterEquityByRange(equity, dateRange),
        [equity, dateRange]
    );

    /*
     * CHART
     */
    const chartData =
        filteredEquity.map(
            (point) => ({
                ...point,
                time: formatChartTime(
                    point.timestamp
                ),
            })
        );

    /*
     * NOT LOGGED IN
     */
    if (!user) {
        return (
            <main className="min-h-screen bg-background px-6 py-20 text-foreground">
                <div className="mx-auto max-w-2xl text-center">
                    <Activity className="mx-auto h-12 w-12 text-muted-foreground" />

                    <h1 className="mt-6 text-3xl font-bold">
                        Live Performance
                    </h1>

                    <p className="mt-3 text-muted-foreground">
                        Sign in to view live
                        trading performance.
                    </p>

                    <Link
                        href="/login?redirect=/live"
                        className="mt-7 inline-flex rounded-xl bg-background px-5 py-3 font-semibold text-foreground"
                    >
                        Sign In
                    </Link>
                </div>
            </main>
        );
    }

    return (
        <main className="min-h-screen bg-background text-foreground">
            <div className="mx-auto max-w-7xl px-6 py-8">

                {/* HEADER */}

                <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between" data-guide="page-header">
                    <div>
                        <Link
                            href="/account"
                            className="mb-6 inline-flex items-center gap-2 text-sm text-muted-foreground transition hover:text-foreground"
                        >
                            <ArrowLeft size={16} />
                            Back to Account
                        </Link>

                        <div className="flex items-center gap-2 text-sm text-muted-foreground">
                            <Activity className="h-4 w-4" />
                            Live Trading
                        </div>

                        <h1 className="mt-2 text-3xl font-bold">
                            Live Performance
                        </h1>

                        <p className="mt-2 text-muted-foreground">
                            Real-time performance
                            from connected MT5
                            accounts.
                        </p>
                    </div>

                    <div className="flex flex-wrap items-center gap-3">
                        <Link
                            href="/backtests"
                            className="inline-flex items-center gap-2 rounded-xl border border-amber-500/20 bg-amber-500/10 px-4 py-2.5 text-sm font-medium text-amber-400 hover:bg-amber-500/20 transition-colors"
                        >
                            <FileText className="h-4 w-4" />
                            <span>Backtest Reports</span>
                        </Link>

                        <Link
                            href="/marketplace"
                            className="rounded-xl border border-border/30 px-4 py-2.5 text-sm text-muted-foreground hover:bg-muted/5"
                        >
                            Marketplace
                        </Link>

                        <button
                            onClick={() =>
                                loadPerformance(
                                    true
                                )
                            }
                            disabled={
                                refreshing ||
                                !selectedLicense
                            }
                            className="inline-flex items-center gap-2 rounded-xl border border-border/30 px-4 py-2.5 text-sm text-foreground hover:bg-muted/5 disabled:opacity-50"
                        >
                            <RefreshCw
                                className={`h-4 w-4 ${refreshing
                                    ? "animate-spin"
                                    : ""
                                    }`}
                            />

                            Refresh
                        </button>
                    </div>
                </div>

                {/* LICENSE SELECTOR */}

                {activeLicenses.length >
                    0 && (
                        <div className="mt-8 rounded-2xl border border-border/30 bg-foreground/8 p-4" data-guide="account-selector">
                            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                                <div>
                                    <p className="text-sm font-medium text-foreground">
                                        Connected
                                        strategy
                                    </p>

                                    <p className="mt-1 text-xs text-muted-foreground">
                                        Select a licensed
                                        product to view
                                        its live account.
                                    </p>
                                </div>

                                <select
                                    value={
                                        selectedLicenseIndex
                                    }
                                    onChange={(
                                        event
                                    ) =>
                                        setSelectedLicenseIndex(
                                            Number(
                                                event
                                                    .target
                                                    .value
                                            )
                                        )
                                    }
                                    className="rounded-xl border border-border/30 bg-background px-4 py-2.5 text-sm text-foreground outline-none"
                                >
                                    {activeLicenses.map(
                                        (
                                            license,
                                            index
                                        ) => {
                                            const product =
                                                products.find(
                                                    (
                                                        item
                                                    ) =>
                                                        item.id ===
                                                        license.productId
                                                );

                                            return (
                                                <option
                                                    key={`${license.productId}-${license.mt5Account}-${index}`}
                                                    value={
                                                        index
                                                    }
                                                >
                                                    {product?.name ||
                                                        license.productId ||
                                                        "Product"}{" "}
                                                    — MT5{" "}
                                                    {license.mt5Account ||
                                                        "—"}
                                                </option>
                                            );
                                        }
                                    )}
                                </select>
                            </div>
                        </div>
                    )}

                {/* NO LICENSE */}

                {activeLicenses.length ===
                    0 && (
                        <div className="mt-10 rounded-2xl border border-border/30 bg-foreground/8 p-10 text-center">
                            <ShieldCheck className="mx-auto h-12 w-12 text-muted-foreground" />

                            <h2 className="mt-5 text-xl font-semibold">
                                No active live
                                licenses
                            </h2>

                            <p className="mx-auto mt-2 max-w-lg text-sm text-muted-foreground">
                                Purchase a supported
                                strategy and connect
                                its MT5 account to see
                                live performance here.
                            </p>

                            <Link
                                href="/marketplace"
                                className="mt-6 inline-flex rounded-xl bg-background px-5 py-3 font-semibold text-foreground"
                            >
                                Browse Marketplace
                            </Link>
                        </div>
                    )}

                {activeLicenses.length >
                    0 &&
                    selectedProduct && (
                        <>
                            {/* PRODUCT HEADER */}

                            <div className="mt-8 rounded-2xl border border-border/30 bg-gradient-to-br from-white/[0.07] to-white/[0.02] p-6">
                                <div className="flex flex-col gap-5 md:flex-row md:items-center md:justify-between">

                                    <div className="flex items-center gap-4">
                                        <div className="flex h-14 w-14 items-center justify-center overflow-hidden rounded-xl border border-border/30 bg-muted/5">
                                            {botLogo ? (
                                                <img
                                                    src={botLogo}
                                                    alt={selectedProduct?.name || "Bot logo"}
                                                    className="h-full w-full object-cover"
                                                    onError={() => setBotLogo(null)}
                                                />
                                            ) : (
                                                <Bot className="h-6 w-6 text-foreground/60" />
                                            )}
                                        </div>

                                        <div>
                                            <div className="flex flex-wrap items-center gap-2">
                                                <h2 className="text-2xl font-bold">
                                                    {selectedProduct.name ||
                                                        "Strategy"}
                                                </h2>

                                                <span
                                                    className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${performance?.online
                                                        ? "bg-emerald-500/10 text-emerald-400"
                                                        : "bg-muted/10 text-muted-foreground"
                                                        }`}
                                                >
                                                    <span
                                                        className={`h-1.5 w-1.5 rounded-full ${performance?.online
                                                            ? "bg-emerald-400"
                                                            : "bg-muted"
                                                            }`}
                                                    />

                                                    {performance?.online
                                                        ? "LIVE"
                                                        : "OFFLINE"}
                                                </span>
                                            </div>

                                            <div className="mt-2 flex flex-wrap gap-3 text-sm text-muted-foreground">
                                                <span>
                                                    {
                                                        selectedProduct.platform
                                                    }
                                                </span>

                                                <span>
                                                    {
                                                        selectedProduct.symbol
                                                    }
                                                </span>

                                                <span>
                                                    MT5{" "}
                                                    {
                                                        selectedLicense.mt5Account
                                                    }
                                                </span>
                                            </div>
                                        </div>
                                    </div>

                                    <div className="flex flex-col items-start gap-3 md:items-end">
                                        <div className="text-left md:text-right">
                                            <p className="text-xs uppercase tracking-wider text-muted-foreground">
                                                Last Heartbeat
                                            </p>

                                            <p className="mt-1 text-sm text-muted-foreground">
                                                {formatDate(
                                                    account?.lastHeartbeatAt
                                                )}
                                            </p>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            {/* LOADING */}

                            {loading && (
                                <div className="mt-8 rounded-2xl border border-border/30 bg-foreground/8 p-12 text-center">
                                    <RefreshCw className="mx-auto h-8 w-8 animate-spin text-muted-foreground" />

                                    <p className="mt-4 text-sm text-muted-foreground">
                                        Loading live
                                        performance...
                                    </p>
                                </div>
                            )}

                            {/* ERROR */}

                            {!loading &&
                                error && (
                                    <div className="mt-8 rounded-2xl border border-red-500/20 bg-red-500/5 p-5 text-sm text-red-300">
                                        {error}
                                    </div>
                                )}

                            {/* DASHBOARD */}

                            {!loading &&
                                !error &&
                                performance && (
                                    <>
                                        {/* MAIN METRICS */}

                                        {/* DATE RANGE FILTER */}

                                        <div className="mb-6 flex flex-wrap gap-2" data-guide="date-range">
                                            {(["1D", "1W", "1M", "3M", "1Y", "All"] as const).map((range) => (
                                                <button
                                                    key={range}
                                                    onClick={() => setDateRange(range)}
                                                    className={`rounded-xl px-4 py-2 text-sm font-medium transition-colors ${dateRange === range ? "bg-muted/10 text-foreground border border-border/50" : "text-muted-foreground hover:text-foreground hover:bg-muted/5"}`}
                                                >
                                                    {range}
                                                </button>
                                            ))}
                                        </div>

                                        <div className="mt-2 grid gap-4 sm:grid-cols-2 lg:grid-cols-4" data-guide="metrics">
                                            <StatCard
                                                title="Balance"
                                                value={formatMoney(
                                                    Number(
                                                        account?.balance ||
                                                        0
                                                    ),
                                                    currency
                                                )}
                                                icon={
                                                    Wallet
                                                }
                                            />

                                            <StatCard
                                                title="Equity"
                                                value={formatMoney(
                                                    Number(
                                                        account?.equity ||
                                                        0
                                                    ),
                                                    currency
                                                )}
                                                icon={
                                                    Activity
                                                }
                                            />

                                            <StatCard
                                                title="Total Profit"
                                                value={formatMoney(
                                                    totalProfit,
                                                    currency
                                                )}
                                                icon={
                                                    profitPositive
                                                        ? TrendingUp
                                                        : TrendingDown
                                                }
                                            />

                                            <StatCard
                                                title="Drawdown"
                                                value={`${Number(
                                                    account?.drawdown ||
                                                    0
                                                ).toFixed(
                                                    2
                                                )}%`}
                                                icon={
                                                    TrendingDown
                                                }
                                            />
                                        </div>

                                        {/* TRADING STATS */}

                                        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                                            <StatCard
                                                title="Win Rate"
                                                value={`${Number(
                                                    stats.winRate ||
                                                    0
                                                ).toFixed(
                                                    2
                                                )}%`}
                                                icon={
                                                    Target
                                                }
                                                description={`${stats.winningTrades} wins / ${stats.losingTrades} losses`}
                                            />

                                            <StatCard
                                                title="Profit Factor"
                                                value={
                                                    Number.isFinite(
                                                        Number(
                                                            stats.profitFactor
                                                        )
                                                    )
                                                        ? Number(
                                                            stats.profitFactor ||
                                                            0
                                                        ).toFixed(
                                                            2
                                                        )
                                                        : "∞"
                                                }
                                                icon={
                                                    BarChart3
                                                }
                                            />

                                            <StatCard
                                                title="Total Trades"
                                                value={String(
                                                    stats.totalTrades ||
                                                    0
                                                )}
                                                icon={
                                                    Trophy
                                                }
                                            />

                                            <StatCard
                                                title="Floating P/L"
                                                value={formatMoney(
                                                    Number(
                                                        account?.floatingProfit ||
                                                        0
                                                    ),
                                                    currency
                                                )}
                                                icon={
                                                    CircleDollarSign
                                                }
                                            />
                                        </div>

                                        {/* EQUITY CHART */}

                                        <div className="mt-8 rounded-2xl border border-border/30 bg-foreground/8 p-5 mb-10" data-guide="equity-chart">
                                            <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                                                <div>
                                                    <h3 className="text-lg font-semibold">
                                                        Equity Curve
                                                    </h3>

                                                    <p className="mt-1 text-sm text-muted-foreground">
                                                        Last 24
                                                        hours
                                                    </p>
                                                </div>

                                                <div className="text-sm text-muted-foreground">
                                                    Peak Equity:{" "}
                                                    <span className="font-semibold text-foreground">
                                                        {formatMoney(
                                                            Number(
                                                                account?.peakEquity ||
                                                                0
                                                            ),
                                                            currency
                                                        )}
                                                    </span>
                                                </div>
                                            </div>

                                            <div className="mt-6 h-[350px] w-full">
                                                {chartData.length >
                                                    0 ? (
                                                    <ResponsiveContainer
                                                        width="100%"
                                                        height="100%"
                                                    >
                                                        <AreaChart
                                                            data={
                                                                chartData
                                                            }
                                                        >
                                                            <defs>
                                                                <linearGradient
                                                                    id="equityGradient"
                                                                    x1="0"
                                                                    y1="0"
                                                                    x2="0"
                                                                    y2="1"
                                                                >
                                                                    <stop
                                                                        offset="5%"
                                                                        stopOpacity={
                                                                            0.35
                                                                        }
                                                                    />

                                                                    <stop
                                                                        offset="95%"
                                                                        stopOpacity={
                                                                            0
                                                                        }
                                                                    />
                                                                </linearGradient>
                                                            </defs>

                                                            <CartesianGrid
                                                                strokeDasharray="3 3"
                                                                strokeOpacity={
                                                                    0.1
                                                                }
                                                            />

                                                            <XAxis
                                                                dataKey="time"
                                                                tick={{
                                                                    fill: "#71717a",
                                                                    fontSize: 11,
                                                                }}
                                                                axisLine={
                                                                    false
                                                                }
                                                                tickLine={
                                                                    false
                                                                }
                                                            />

                                                            <YAxis
                                                                tick={{
                                                                    fill: "#71717a",
                                                                    fontSize: 11,
                                                                }}
                                                                axisLine={
                                                                    false
                                                                }
                                                                tickLine={
                                                                    false
                                                                }
                                                                width={
                                                                    70
                                                                }
                                                                tickFormatter={(
                                                                    value
                                                                ) =>
                                                                    Number(
                                                                        value
                                                                    ).toFixed(
                                                                        0
                                                                    )
                                                                }
                                                            />

                                                            <Tooltip
                                                                contentStyle={{
                                                                    background:
                                                                        "#09090b",
                                                                    border:
                                                                        "1px solid rgba(255,255,255,0.1)",
                                                                    borderRadius:
                                                                        "12px",
                                                                    color:
                                                                        "#fff",
                                                                }}
                                                                labelStyle={{
                                                                    color:
                                                                        "#a1a1aa",
                                                                }}
                                                                formatter={(
                                                                    value
                                                                ) =>
                                                                    formatMoney(
                                                                        Number(
                                                                            value
                                                                        ),
                                                                        currency
                                                                    )
                                                                }
                                                            />

                                                            <Area
                                                                type="monotone"
                                                                dataKey="equity"
                                                                strokeWidth={
                                                                    2
                                                                }
                                                                fill="url(#equityGradient)"
                                                                fillOpacity={
                                                                    1
                                                                }
                                                            />
                                                        </AreaChart>
                                                    </ResponsiveContainer>
                                                ) : (
                                                    <div className="flex h-full items-center justify-center rounded-xl border border-dashed border-border/30">
                                                        <div className="text-center">
                                                            <Activity className="mx-auto h-8 w-8 text-muted-foreground" />

                                                            <p className="mt-3 text-sm text-muted-foreground">
                                                                Waiting for
                                                                equity
                                                                data...
                                                            </p>
                                                        </div>
                                                    </div>
                                                )}
                                            </div>
                                        </div>

                                        {/* ANALYTICS - PRO ONLY */}

                                        <ProGate>
                                            <div className="grid gap-4 md:grid-cols-2">
                                                {/* Win/Loss Pie Chart */}
                                                <div className="rounded-2xl border border-border/30 bg-foreground/8 p-5">
                                                    <h3 className="font-semibold">Win / Loss Ratio</h3>
                                                    <div className="mt-4 h-[280px] w-full">
                                                        {stats.winningTrades + stats.losingTrades > 0 ? (
                                                            <ResponsiveContainer width="100%" height="100%">
                                                                <PieChart>
                                                                    <Pie
                                                                        data={[
                                                                            { name: "Wins", value: stats.winningTrades || 0, fill: "#22c55e" },
                                                                            { name: "Losses", value: stats.losingTrades || 0, fill: "#ef4444" },
                                                                        ]}
                                                                        cx="50%"
                                                                        cy="50%"
                                                                        innerRadius={60}
                                                                        outerRadius={100}
                                                                        dataKey="value"
                                                                        label={({ name, percent }) => `${String(name ?? "")} ${((percent ?? 0) * 100).toFixed(1)}%`}
                                                                        labelLine={false}
                                                                    >
                                                                        <Cell fill="#22c55e" />
                                                                        <Cell fill="#ef4444" />
                                                                    </Pie>
                                                                    <Legend
                                                                        layout="vertical"
                                                                        align="right"
                                                                        verticalAlign="middle"
                                                                        iconType="circle"
                                                                        iconSize={8}
                                                                        formatter={(value: string) => <span className="text-sm text-muted-foreground">{value}</span>}
                                                                    />
                                                                    <Tooltip
                                                                        contentStyle={{
                                                                            background: "#09090b",
                                                                            border: "1px solid rgba(255,255,255,0.1)",
                                                                            borderRadius: "12px",
                                                                            color: "#fff",
                                                                        }}
                                                                        formatter={(value) => [String(value), "Trades"]}
                                                                    />
                                                                </PieChart>
                                                            </ResponsiveContainer>
                                                        ) : (
                                                            <div className="flex h-full items-center justify-center rounded-xl border border-dashed border-border/30">
                                                                <div className="text-center">
                                                                    <Trophy className="mx-auto h-8 w-8 text-muted-foreground" />
                                                                    <p className="mt-3 text-sm text-muted-foreground">No trades yet</p>
                                                                </div>
                                                            </div>
                                                        )}
                                                    </div>
                                                </div>

                                                {/* Trade Distribution */}
                                                <div className="rounded-2xl border border-border/30 bg-foreground/8 p-5">
                                                    <h3 className="font-semibold">Trade Distribution</h3>
                                                    <div className="mt-4 grid gap-3">
                                                        {[
                                                            { label: "Average Win", value: formatMoney(Number(stats.averageWin || 0), currency), color: "text-emerald-400" },
                                                            { label: "Average Loss", value: formatMoney(Number(stats.averageLoss || 0), currency), color: "text-rose-400" },
                                                            { label: "Best Trade", value: formatMoney(Number(stats.bestTrade || 0), currency), color: "text-emerald-400" },
                                                            { label: "Worst Trade", value: formatMoney(Number(stats.worstTrade || 0), currency), color: "text-rose-400" },
                                                            { label: "Profit Factor", value: stats.profitFactor ? Number(stats.profitFactor).toFixed(2) : "—", color: "text-violet-400" },
                                                            { label: "Total Profit", value: formatMoney(Number(stats.totalProfit || 0), currency), color: "text-amber-400" },
                                                        ].map((item) => (
                                                            <div key={item.label} className="flex items-center justify-between rounded-lg border border-border bg-muted/30 px-4 py-2.5">
                                                                <span className="text-sm text-muted-foreground">{item.label}</span>
                                                                <span className={`text-sm font-semibold ${item.color}`}>{item.value}</span>
                                                            </div>
                                                        ))}
                                                    </div>
                                                </div>
                                            </div>

                                            {/* SECONDARY STATISTICS & BOT BACKTEST */}

                                            <div className="mt-8 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                                                <div className="rounded-2xl border border-border/30 bg-foreground/8 p-5">
                                                    <h3 className="font-semibold">
                                                        Performance
                                                        Statistics
                                                    </h3>

                                                    <div className="mt-5 space-y-4">
                                                        <div className="flex justify-between text-sm">
                                                            <span className="text-muted-foreground">
                                                                Gross Profit
                                                            </span>

                                                            <span className="text-emerald-400">
                                                                {formatMoney(
                                                                    Number(
                                                                        stats.grossProfit ||
                                                                        0
                                                                    ),
                                                                    currency
                                                                )}
                                                            </span>
                                                        </div>

                                                        <div className="flex justify-between text-sm">
                                                            <span className="text-muted-foreground">
                                                                Gross Loss
                                                            </span>

                                                            <span className="text-red-400">
                                                                {formatMoney(
                                                                    -Number(
                                                                        stats.grossLoss ||
                                                                        0
                                                                    ),
                                                                    currency
                                                                )}
                                                            </span>
                                                        </div>

                                                        <div className="flex justify-between text-sm">
                                                            <span className="text-muted-foreground">
                                                                Average Win
                                                            </span>

                                                            <span className="text-foreground">
                                                                {formatMoney(
                                                                    Number(
                                                                        stats.averageWin ||
                                                                        0
                                                                    ),
                                                                    currency
                                                                )}
                                                            </span>
                                                        </div>

                                                        <div className="flex justify-between text-sm">
                                                            <span className="text-muted-foreground">
                                                                Average Loss
                                                            </span>

                                                            <span className="text-foreground">
                                                                {formatMoney(
                                                                    -Number(
                                                                        stats.averageLoss ||
                                                                        0
                                                                    ),
                                                                    currency
                                                                )}
                                                            </span>
                                                        </div>

                                                        <div className="flex justify-between text-sm">
                                                            <span className="text-muted-foreground">
                                                                Best Trade
                                                            </span>

                                                            <span className="text-emerald-400">
                                                                {formatMoney(
                                                                    Number(
                                                                        stats.bestTrade ||
                                                                        0
                                                                    ),
                                                                    currency
                                                                )}
                                                            </span>
                                                        </div>

                                                        <div className="flex justify-between text-sm">
                                                            <span className="text-muted-foreground">
                                                                Worst Trade
                                                            </span>

                                                            <span className="text-red-400">
                                                                {formatMoney(
                                                                    Number(
                                                                        stats.worstTrade ||
                                                                        0
                                                                    ),
                                                                    currency
                                                                )}
                                                            </span>
                                                        </div>
                                                    </div>
                                                </div>

                                                <div className="rounded-2xl border border-border/30 bg-foreground/8 p-5">
                                                    <h3 className="font-semibold">
                                                        Account
                                                        Information
                                                    </h3>

                                                    <div className="mt-5 space-y-4">
                                                        <div className="flex justify-between gap-4 text-sm">
                                                            <span className="text-muted-foreground">
                                                                Broker
                                                            </span>

                                                            <span className="text-right text-foreground">
                                                                {account?.broker ||
                                                                    "—"}
                                                            </span>
                                                        </div>

                                                        <div className="flex justify-between gap-4 text-sm">
                                                            <span className="text-muted-foreground">
                                                                Server
                                                            </span>

                                                            <span className="text-right text-foreground">
                                                                {account?.server ||
                                                                    "—"}
                                                            </span>
                                                        </div>

                                                        <div className="flex justify-between gap-4 text-sm">
                                                            <span className="text-muted-foreground">
                                                                Currency
                                                            </span>

                                                            <span className="text-foreground">
                                                                {currency}
                                                            </span>
                                                        </div>

                                                        <div className="flex justify-between gap-4 text-sm">
                                                            <span className="text-muted-foreground">
                                                                MT5 Account
                                                            </span>

                                                            <span className="text-foreground">
                                                                {account?.mt5Account ||
                                                                    selectedLicense.mt5Account ||
                                                                    "—"}
                                                            </span>
                                                        </div>

                                                        <div className="flex justify-between gap-4 text-sm">
                                                            <span className="text-muted-foreground">
                                                                Peak Equity
                                                            </span>

                                                            <span className="text-foreground">
                                                                {formatMoney(
                                                                    Number(
                                                                        account?.peakEquity ||
                                                                        0
                                                                    ),
                                                                    currency
                                                                )}
                                                            </span>
                                                        </div>

                                                        <div className="flex justify-between gap-4 text-sm">
                                                            <span className="text-muted-foreground">
                                                                Last Update
                                                            </span>

                                                            <span className="text-right text-foreground">
                                                                {formatDate(
                                                                    account?.lastHeartbeatAt
                                                                )}
                                                            </span>
                                                        </div>
                                                    </div>
                                                </div>

                                                {/* BOT BACKTEST BENCHMARK */}
                                                <div className="rounded-2xl border border-border/30 bg-foreground/8 p-5">
                                                    <div className="flex items-center justify-between">
                                                        <h3 className="font-semibold text-foreground">
                                                            Bot Backtest Benchmark
                                                        </h3>
                                                        <span className="rounded-md border border-amber-500/20 bg-amber-500/10 px-2 py-0.5 text-xs font-medium text-amber-400">
                                                            Verified
                                                        </span>
                                                    </div>

                                                    <div className="mt-5 space-y-4">
                                                        <div className="flex justify-between text-sm">
                                                            <span className="text-muted-foreground">
                                                                Backtest Return
                                                            </span>

                                                            <span className="font-semibold text-emerald-400">
                                                                {selectedProduct.performance?.profit != null
                                                                    ? `${selectedProduct.performance.profit}%`
                                                                    : "—"}
                                                            </span>
                                                        </div>

                                                        <div className="flex justify-between text-sm">
                                                            <span className="text-muted-foreground">
                                                                Backtest Win Rate
                                                            </span>

                                                            <span className="font-semibold text-foreground">
                                                                {selectedProduct.performance?.winRate != null
                                                                    ? `${selectedProduct.performance.winRate}%`
                                                                    : "—"}
                                                            </span>
                                                        </div>

                                                        <div className="flex justify-between text-sm">
                                                            <span className="text-muted-foreground">
                                                                Profit Factor
                                                            </span>

                                                            <span className="font-semibold text-foreground">
                                                                {selectedProduct.performance?.profitFactor != null
                                                                    ? String(selectedProduct.performance.profitFactor)
                                                                    : "—"}
                                                            </span>
                                                        </div>

                                                        <div className="flex justify-between text-sm">
                                                            <span className="text-muted-foreground">
                                                                Max Drawdown
                                                            </span>

                                                            <span className="font-semibold text-red-400">
                                                                {selectedProduct.risk?.maxDrawdown != null
                                                                    ? `${selectedProduct.risk.maxDrawdown}%`
                                                                    : "—"}
                                                            </span>
                                                        </div>

                                                        <div className="flex justify-between text-sm">
                                                            <span className="text-muted-foreground">
                                                                Total Trades
                                                            </span>

                                                            <span className="font-semibold text-foreground">
                                                                {selectedProduct.performance?.totalTrades != null
                                                                    ? String(selectedProduct.performance.totalTrades)
                                                                    : "—"}
                                                            </span>
                                                        </div>

                                                        <div className="flex justify-between text-sm">
                                                            <span className="text-muted-foreground">
                                                                Backtest Period
                                                            </span>

                                                            <span className="text-muted-foreground">
                                                                {selectedProduct.performance?.backtestPeriod || "—"}
                                                            </span>
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>
                                        </ProGate>

                                        {/* OPEN POSITIONS */}

                                        <div className="mt-8 overflow-hidden rounded-2xl border border-border/60 bg-card/40">
                                            <div className="flex items-center justify-between border-b border-border/60 px-5 py-4">
                                                <div>
                                                    <h2 className="text-lg font-semibold text-foreground">
                                                        Open Trades
                                                    </h2>

                                                    <p className="text-sm text-muted-foreground">
                                                        Currently open positions from MT5
                                                    </p>
                                                </div>

                                                <div className="flex items-center gap-3">
                                                    <div className="flex items-center gap-1.5 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-3 py-1.5 text-sm font-medium text-emerald-400">
                                                        <span className="relative flex h-2 w-2">
                                                            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                                                            <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
                                                        </span>
                                                        {openPositions.length} Open
                                                    </div>

                                                    {openPositions.length > 0 && (() => {
                                                        const total = openPositions.reduce((s, p) => s + Number(p.profit || 0) + Number(p.swap || 0), 0);
                                                        return (
                                                            <div className="text-sm text-muted-foreground">
                                                                Floating:{" "}
                                                                <span className={`font-semibold ${total >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                                                                    {total >= 0 ? "+" : ""}{formatMoney(total, currency)}
                                                                </span>
                                                            </div>
                                                        );
                                                    })()}
                                                </div>
                                            </div>

                                            {openPositions.length ===
                                                0 ? (
                                                <div className="px-5 py-10 text-center text-muted-foreground">
                                                    No open trades right now.
                                                </div>
                                            ) : (
                                                <div className="overflow-x-auto">
                                                    <table className="w-full min-w-[900px] text-sm">
                                                        <thead>
                                                            <tr className="border-b border-border/60 text-muted-foreground">
                                                                <th className="px-5 py-4 text-left">
                                                                    Ticket
                                                                </th>

                                                                <th className="px-5 py-4 text-left">
                                                                    Type
                                                                </th>

                                                                <th className="px-5 py-4 text-left">
                                                                    Symbol
                                                                </th>

                                                                <th className="px-5 py-4 text-left">
                                                                    Volume
                                                                </th>

                                                                <th className="px-5 py-4 text-left">
                                                                    Open Price
                                                                </th>

                                                                <th className="px-5 py-4 text-left">
                                                                    Current Price
                                                                </th>

                                                                <th className="px-5 py-4 text-left">
                                                                    Floating P/L
                                                                </th>

                                                                <th className="px-5 py-4 text-left">
                                                                    Opened
                                                                </th>
                                                            </tr>
                                                        </thead>

                                                        <tbody>
                                                            {openPositions.map(
                                                                (
                                                                    position
                                                                ) => {
                                                                    const profit =
                                                                        Number(
                                                                            position.profit ||
                                                                            0
                                                                        ) +
                                                                        Number(
                                                                            position.swap ||
                                                                            0
                                                                        );

                                                                    const isBuy =
                                                                        position.type ===
                                                                        "BUY";

                                                                    return (
                                                                        <tr
                                                                            key={
                                                                                position.ticket
                                                                            }
                                                                            className="border-b border-border/60 last:border-0"
                                                                        >
                                                                            <td className="px-5 py-4 font-mono text-xs text-muted-foreground">
                                                                                {position.ticket ||
                                                                                    "—"}
                                                                            </td>

                                                                            <td className="px-5 py-4">
                                                                                <span
                                                                                    className={
                                                                                        isBuy
                                                                                            ? "inline-flex rounded-full bg-emerald-500/10 px-2.5 py-1 text-xs font-semibold text-emerald-400"
                                                                                            : "inline-flex rounded-full bg-red-500/10 px-2.5 py-1 text-xs font-semibold text-red-400"
                                                                                    }
                                                                                >
                                                                                    {position.type ||
                                                                                        "—"}
                                                                                </span>
                                                                            </td>

                                                                            <td className="px-5 py-4 font-semibold text-foreground">
                                                                                {position.symbol ||
                                                                                    "—"}
                                                                            </td>

                                                                            <td className="px-5 py-4 text-muted-foreground">
                                                                                {Number(
                                                                                    position.volume ||
                                                                                    0
                                                                                ).toFixed(
                                                                                    2
                                                                                )}
                                                                            </td>

                                                                            <td className="px-5 py-4 text-muted-foreground">
                                                                                {position.openPrice ??
                                                                                    "—"}
                                                                            </td>

                                                                            <td className="px-5 py-4 text-muted-foreground">
                                                                                {position.currentPrice ??
                                                                                    "—"}
                                                                            </td>

                                                                            <td
                                                                                className={`px-5 py-4 font-semibold tabular-nums ${profit >= 0 ? "text-emerald-400" : "text-red-400"}`}
                                                                            >
                                                                                {profit >= 0 ? "+" : ""}
                                                                                {formatMoney(profit, currency)}
                                                                            </td>

                                                                            <td className="px-5 py-4 text-xs text-muted-foreground">
                                                                                {formatDate(
                                                                                    position.openedAt
                                                                                )}
                                                                            </td>
                                                                        </tr>
                                                                    );
                                                                }
                                                            )}
                                                        </tbody>
                                                    </table>
                                                </div>
                                            )}
                                        </div>

                                        {/* TRADE HISTORY */}

                                        <div className="mt-8 rounded-2xl border border-border/30 bg-foreground/8">
                                            <div className="flex items-center justify-between border-b border-border/30 p-5">
                                                <div>
                                                    <h3 className="font-semibold">
                                                        Trade
                                                        History
                                                    </h3>

                                                    <p className="mt-1 text-sm text-muted-foreground">
                                                        Latest recorded closed trades
                                                    </p>
                                                </div>

                                                <span className="rounded-full border border-border/30 px-3 py-1 text-xs text-muted-foreground">
                                                    {
                                                        stats.totalTrades
                                                    }{" "}
                                                    trades
                                                </span>
                                            </div>

                                            <div className="overflow-x-auto">
                                                <table className="w-full min-w-[950px] text-left text-sm">
                                                    <thead>
                                                        <tr className="border-b border-border/30 text-xs uppercase tracking-wider text-muted-foreground">
                                                            <th className="px-5 py-4">
                                                                Ticket
                                                            </th>

                                                            <th className="px-5 py-4">
                                                                Symbol
                                                            </th>

                                                            <th className="px-5 py-4">
                                                                Type
                                                            </th>

                                                            <th className="px-5 py-4">
                                                                Volume
                                                            </th>

                                                            <th className="px-5 py-4">
                                                                Open
                                                            </th>

                                                            <th className="px-5 py-4">
                                                                Close
                                                            </th>

                                                            <th className="px-5 py-4">
                                                                Profit
                                                            </th>

                                                            <th className="px-5 py-4">
                                                                Closed
                                                            </th>
                                                        </tr>
                                                    </thead>

                                                    <tbody>
                                                        {(
                                                            performance.trades ||
                                                            []
                                                        )
                                                            .slice(
                                                                0,
                                                                50
                                                            )
                                                            .map(
                                                                (
                                                                    trade
                                                                ) => {
                                                                    const netProfit =
                                                                        Number(
                                                                            trade.netProfit ??
                                                                            (
                                                                                Number(
                                                                                    trade.profit ||
                                                                                    0
                                                                                ) +
                                                                                Number(
                                                                                    trade.commission ||
                                                                                    0
                                                                                ) +
                                                                                Number(
                                                                                    trade.swap ||
                                                                                    0
                                                                                )
                                                                            )
                                                                        );

                                                                    return (
                                                                        <tr
                                                                            key={
                                                                                trade.ticket
                                                                            }
                                                                            className="border-b border-border/10 last:border-0"
                                                                        >
                                                                            <td className="px-5 py-4 font-mono text-xs text-muted-foreground">
                                                                                {trade.ticket ||
                                                                                    "—"}
                                                                            </td>

                                                                            <td className="px-5 py-4 font-medium text-foreground">
                                                                                {trade.symbol ||
                                                                                    "—"}
                                                                            </td>

                                                                            <td className="px-5 py-4">
                                                                                <TradeType
                                                                                    type={
                                                                                        trade.type
                                                                                    }
                                                                                />
                                                                            </td>

                                                                            <td className="px-5 py-4 text-muted-foreground">
                                                                                {Number(
                                                                                    trade.volume ||
                                                                                    0
                                                                                ).toFixed(
                                                                                    2
                                                                                )}
                                                                            </td>

                                                                            <td className="px-5 py-4 text-muted-foreground">
                                                                                {trade.openPrice ??
                                                                                    "—"}
                                                                            </td>

                                                                            <td className="px-5 py-4 text-muted-foreground">
                                                                                {trade.closePrice ??
                                                                                    "—"}
                                                                            </td>

                                                                            <td
                                                                                className={`px-5 py-4 font-semibold ${netProfit >=
                                                                                    0
                                                                                    ? "text-emerald-400"
                                                                                    : "text-red-400"
                                                                                    }`}
                                                                            >
                                                                                {formatMoney(
                                                                                    netProfit,
                                                                                    currency
                                                                                )}
                                                                            </td>

                                                                            <td className="px-5 py-4 text-xs text-muted-foreground">
                                                                                {formatDate(
                                                                                    trade.closedAt
                                                                                )}
                                                                            </td>
                                                                        </tr>
                                                                    );
                                                                }
                                                            )}

                                                        {(
                                                            performance.trades ||
                                                            []
                                                        ).length ===
                                                            0 && (
                                                                <tr>
                                                                    <td
                                                                        colSpan={
                                                                            8
                                                                        }
                                                                        className="px-5 py-12 text-center text-sm text-muted-foreground"
                                                                    >
                                                                        No
                                                                        trades
                                                                        recorded
                                                                        yet.
                                                                    </td>
                                                                </tr>
                                                            )}
                                                    </tbody>
                                                </table>
                                            </div>
                                        </div>

                                        {/* RISK NOTICE */}

                                        <div className="mt-8 rounded-2xl border border-yellow-500/20 bg-yellow-500/5 p-5">
                                            <div className="flex gap-3">
                                                <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-yellow-400" />

                                                <div>
                                                    <h3 className="font-semibold text-yellow-300">
                                                        Performance
                                                        Disclaimer
                                                    </h3>

                                                    <p className="mt-1 text-sm leading-6 text-yellow-200/70">
                                                        Live
                                                        performance
                                                        data is
                                                        provided
                                                        for
                                                        informational
                                                        purposes
                                                        only.
                                                        Past
                                                        performance
                                                        does not
                                                        guarantee
                                                        future
                                                        results.
                                                        Trading
                                                        involves
                                                        substantial
                                                        risk of
                                                        loss.
                                                    </p>
                                                </div>
                                            </div>
                                        </div>
                                    </>
                                )}
                        </>
                    )}
            </div>
        </main>
    );
}