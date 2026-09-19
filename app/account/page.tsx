"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { onAuthStateChanged, User as FirebaseUser } from "firebase/auth";
import { onValue, ref } from "firebase/database";
import { auth, database } from "@/lib/firebase";
import Link from "next/link";
import {
    Award,
    Activity,
    BarChart3,
    Calendar,
    Calculator,
    CheckCircle2,
    ChevronRight,
    Clock,
    Copy,
    CreditCard,
    Eye,
    FileKey2,
    FileText,
    Gift,
    Heart,
    Package,
    Settings,
    Settings2,
    Shield,
    ShieldCheck,
    Sparkles,
    TrendingUp,
    User,
    WalletCards,
    XCircle,
    Brain,
} from "lucide-react";
import AccountShell from "@/components/account/AccountShell";
import BarCompareChart from "@/components/charts/BarCompareChart";
import MiniSparkline from "@/components/charts/MiniSparkline";

type UserProfile = {
    uid?: string;
    email?: string;
    displayName?: string;
    role?: string;
    createdAt?: number;
};

type Order = {
    id: string;
    status?: string;
    paymentStatus?: string;
    amount?: number;
    currency?: string;
    createdAt?: number;
    paidAt?: number;
};

type LicenseState = {
    active: number;
    total: number;
    expiringSoon: number;
};

const currencyCode = "USD";

export default function AccountPage() {
    const router = useRouter();

    const [firebaseUser, setFirebaseUser] = useState<FirebaseUser | null>(null);
    const [profile, setProfile] = useState<UserProfile | null>(null);
    const [orders, setOrders] = useState<Order[]>([]);
    const [licenseState, setLicenseState] = useState<LicenseState | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const unsubscribe = onAuthStateChanged(auth, (user) => {
            if (!user) {
                router.replace("/login");
                return;
            }

            setFirebaseUser(user);

            const userRef = ref(database, `users/${user.uid}`);
            const unsubscribeProfile = onValue(userRef, (snapshot) => {
                if (snapshot.exists()) {
                    setProfile(snapshot.val());
                } else {
                    setProfile({
                        uid: user.uid,
                        email: user.email || "",
                        displayName: user.displayName || "Trader",
                        role: "customer",
                    });
                }
                setLoading(false);
            });

            const ordersRef = ref(database, `orders/${user.uid}`);
            const unsubscribeOrders = onValue(ordersRef, (snapshot) => {
                const data = snapshot.val() as Record<string, Order> | undefined;
                if (!data) {
                    setOrders([]);
                    return;
                }
                setOrders(
                    Object.entries(data).map(([id, value]) => ({
                        ...value,
                        id,
                    }))
                );
            });

            const licensesRef = ref(database, `licenses/${user.uid}`);
            const unsubscribeLicenses = onValue(licensesRef, (snapshot) => {
                const data = snapshot.val() as
                    | Record<string, { status?: string; expiresAt?: number }>
                    | undefined;
                if (!data) {
                    setLicenseState({ active: 0, total: 0, expiringSoon: 0 });
                    return;
                }

                const values = Object.values(data);
                const now = Date.now();
                const active = values.filter(
                    (license) =>
                        license?.status === "active" &&
                        (!license.expiresAt || license.expiresAt > now)
                ).length;
                const expiringSoon = values.filter(
                    (license) =>
                        license?.status === "active" &&
                        license.expiresAt &&
                        license.expiresAt > now &&
                        license.expiresAt - now < 7 * 24 * 60 * 60 * 1000
                ).length;

                setLicenseState({ active, total: values.length, expiringSoon });
            });

            const unsubscribeAll = [
                unsubscribeProfile,
                unsubscribeOrders,
                unsubscribeLicenses,
            ];
            return () => {
                unsubscribeAll.forEach((fn) => fn());
            };
        });

        return () => unsubscribe();
    }, [router]);

    const paidOrders = useMemo(
        () => orders.filter((o) => o.status === "paid" || o.paymentStatus === "paid" || o.status === "completed" || o.status === "success" || o.status === "active" || o.paymentStatus === "completed"),
        [orders]
    );

    const totalSpent = useMemo(
        () =>
            paidOrders.reduce((sum, o) => sum + (Number(o.amount) || 0), 0),
        [paidOrders]
    );

    const paidCurrencies = useMemo(
        () => Array.from(new Set(paidOrders.map((o) => o.currency || currencyCode))),
        [paidOrders]
    );

    const monthlySpend = useMemo(() => {
        const now = new Date();
        const buckets: { label: string; value: number; key: string }[] = [];
        for (let i = 5; i >= 0; i--) {
            const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
            const label = d.toLocaleDateString("en-US", { month: "short" });
            const key = `${d.getFullYear()}-${d.getMonth()}`;
            buckets.push({ label, value: 0, key });
        }

        paidOrders.forEach((o) => {
            const ts = o.paidAt || o.createdAt;
            if (!ts) return;
            const tsNum = typeof ts === "string" ? new Date(ts).getTime() : Number(ts);
            if (!tsNum || isNaN(tsNum)) return;
            const d = new Date(tsNum);
            const key = `${d.getFullYear()}-${d.getMonth()}`;
            const bucket = buckets.find((b) => b.key === key);
            if (bucket) bucket.value += Number(o.amount) || 0;
        });

        return buckets.map(({ label, value }) => ({ label, value }));
    }, [paidOrders]);

    if (loading) {
        return (
            <AccountShell title="Dashboard">
                <div className="flex h-[50vh] items-center justify-center">
                    <div className="h-8 w-8 animate-spin rounded-full border-2 border-border border-t-foreground" />
                </div>
            </AccountShell>
        );
    }

    if (!firebaseUser) {
        return null;
    }

    const displayName = profile?.displayName || firebaseUser.displayName || "Trader";
    const email = profile?.email || firebaseUser.email || "";
    const role = profile?.role || "customer";
    const activeCount = licenseState?.active ?? 0;

    return (
        <AccountShell
            title="Dashboard"
            subtitle={`Welcome back, ${displayName}`}
        >
            <div className="space-y-8">
                {/* Stats */}
                <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                    <StatCard
                        icon={<Package className="h-5 w-5 text-blue-400" />}
                        label="Orders"
                        value={`${paidOrders.length}`}
                        spark={paidOrders.map((o, i) => i + 1)}
                        sparkColor="var(--chart-2)"
                    />
                    <StatCard
                        icon={<CreditCard className="h-5 w-5 text-emerald-500" />}
                        label="Total Spent"
                        value={formatMoney(totalSpent, paidCurrencies[0] || currencyCode)}
                        spark={monthlySpend.map((m) => m.value)}
                        sparkColor="var(--chart-1)"
                    />
                    <StatCard
                        icon={<ShieldCheck className="h-5 w-5 text-purple-400" />}
                        label="Active Licenses"
                        value={`${activeCount}`}
                        spark={licenseState ? [licenseState.total - activeCount, activeCount] : [0, 0]}
                        sparkColor="var(--chart-3)"
                    />
                    <StatCard
                        icon={<TrendingUp className="h-5 w-5 text-amber-400" />}
                        label="Total Licenses"
                        value={`${licenseState?.total ?? 0}`}
                        spark={[]}
                        sparkColor="var(--chart-4)"
                    />
                </div>

                {/* Chart + Profile */}
                <div className="grid gap-6 lg:grid-cols-3">
                    {/* Activity chart */}
                    <div className="rounded-2xl border border-border bg-muted/30 p-6 lg:col-span-2">
                        <div className="flex items-center justify-between">
                            <div>
                                <h2 className="font-semibold">Spending Overview</h2>
                                <p className="mt-1 text-sm text-muted-foreground">
                                    Your purchases over the last 6 months
                                </p>
                            </div>
                            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500/10">
                                <BarChart3 className="h-5 w-5 text-emerald-500" />
                            </div>
                        </div>

                        {paidOrders.length > 0 ? (
                            <div className="mt-6">
                                <BarCompareChart
                                    data={monthlySpend}
                                    xKey="label"
                                    valueKey="value"
                                    height={240}
                                    colorVar="var(--chart-1)"
                                    formatValue={(v) => formatMoney(v, currencyCode)}
                                />
                            </div>
                        ) : (
                            <div className="mt-6 flex h-[240px] items-center justify-center rounded-xl border border-dashed border-border">
                                <div className="text-center">
                                    <CreditCard className="mx-auto h-8 w-8 text-muted-foreground" />
                                    <p className="mt-3 text-sm font-medium">
                                        No purchase activity yet
                                    </p>
                                    <p className="mt-1 text-xs text-muted-foreground">
                                        Your spending appears here after your first purchase.
                                    </p>
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Profile summary */}
                    <div className="rounded-2xl border border-border bg-muted/30 p-6" data-guide="licenses-card">
                        <div className="flex items-center gap-4">
                            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-muted">
                                <User className="h-7 w-7 text-muted-foreground" />
                            </div>
                            <div className="min-w-0">
                                <h2 className="truncate font-semibold">{displayName}</h2>
                                <p className="truncate text-sm text-muted-foreground">{email}</p>
                            </div>
                        </div>

                        <div className="mt-5 flex flex-wrap gap-2">
                            <span className="rounded-full border border-emerald-500/20 bg-emerald-500/10 px-3 py-1 text-xs font-medium capitalize text-emerald-600">
                                {role}
                            </span>
                            {licenseState?.active === 0 && (
                                <Link
                                    href="/marketplace"
                                    className="rounded-full border border-border px-3 py-1 text-xs text-muted-foreground transition hover:text-foreground"
                                >
                                    No active license — browse marketplace
                                </Link>
                            )}
                        </div>

                        <div className="mt-6 space-y-3 border-t border-border pt-5">
                            <div className="flex items-center justify-between text-sm">
                                <span className="text-muted-foreground">Account status</span>
                                {licenseState === null ? (
                                    <span className="text-muted-foreground">Checking...</span>
                                ) : activeCount > 0 ? (
                                    <span className="flex items-center gap-1.5 font-medium text-emerald-600">
                                        <CheckCircle2 className="h-4 w-4" />
                                        Active ({activeCount})
                                    </span>
                                ) : (
                                    <span className="flex items-center gap-1.5 text-muted-foreground">
                                        <XCircle className="h-4 w-4" />
                                        No active license
                                    </span>
                                )}
                            </div>
                            {licenseState && licenseState.expiringSoon > 0 && (
                                <div className="flex items-center justify-between text-sm">
                                    <span className="text-muted-foreground">Expiring soon</span>
                                    <span className="font-medium text-amber-500">
                                        {licenseState.expiringSoon}
                                    </span>
                                </div>
                            )}
                        </div>

                        <Link
                            href="/marketplace"
                            className="mt-6 flex items-center justify-center gap-2 rounded-xl bg-foreground px-4 py-2.5 text-sm font-medium text-background transition hover:opacity-90"
                        >
                            Browse Marketplace
                            <ChevronRight size={15} />
                        </Link>
                    </div>
                </div>

                {/* Quick cards */}
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5" data-guide="quick-access">
                    <QuickCard
                        href="/account/purchases"
                        icon={<Package className="h-5 w-5 text-blue-400" />}
                        iconClass="bg-blue-500/10"
                        title="Purchases"
                        text="View your purchased products."
                    />
                    <QuickCard
                        href="/account/licenses"
                        icon={<FileKey2 className="h-5 w-5 text-purple-400" />}
                        iconClass="bg-purple-500/10"
                        title="Licenses"
                        text="Manage your active licenses."
                    />
                    <QuickCard
                        href="/live"
                        icon={<BarChart3 className="h-5 w-5 text-emerald-500" />}
                        iconClass="bg-emerald-500/10"
                        title="Live Performance"
                        text="Track live strategy performance."
                    />
                    <QuickCard
                        href="/account/settings"
                        icon={<Settings className="h-5 w-5 text-orange-400" />}
                        iconClass="bg-orange-500/10"
                        title="Settings"
                        text="Manage your account settings."
                    />
                    <QuickCard
                        href="/account/tools"
                        icon={<Calculator className="h-5 w-5 text-violet-400" />}
                        iconClass="bg-violet-500/10"
                        title="Trader Tools"
                        text="Notebook, journal & calculators."
                    />
                    <QuickCard
                        href="/ai-copilot"
                        icon={<Brain className="h-5 w-5 text-violet-400" />}
                        iconClass="bg-violet-500/10"
                        title="AI Copilot"
                        text="Get AI-powered market analysis & insights."
                    />
                    <QuickCard
                        href="/scanner"
                        icon={<Activity className="h-5 w-5 text-emerald-400" />}
                        iconClass="bg-emerald-500/10"
                        title="Market Scanner"
                        text="Scan assets across multiple markets."
                    />
                    <QuickCard
                        href="/insights"
                        icon={<Sparkles className="h-5 w-5 text-sky-400" />}
                        iconClass="bg-sky-500/10"
                        title="AI Insights"
                        text="AI-powered market intelligence."
                    />
                </div>

                {/* Trading tools */}
                <div className="rounded-2xl border border-border bg-muted/30 p-6" data-guide="tools-card">
                    <h2 className="font-semibold">Trading Tools & Market Utilities</h2>

                    <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                        <ToolLink
                            href="/marketplace"
                            icon={<WalletCards className="h-5 w-5 text-muted-foreground" />}
                            title="Browse marketplace"
                            text="Find EAs and indicators"
                        />
                        <ToolLink
                            href="/backtests"
                            icon={<BarChart3 className="h-5 w-5 text-muted-foreground" />}
                            title="Explore backtests"
                            text="Review historical reports"
                        />
                        <ToolLink
                            href="/sessions"
                            icon={<Clock className="h-5 w-5 text-blue-400" />}
                            title="Trading Sessions"
                            text="Live market hours clock"
                        />
                        <ToolLink
                            href="/compare"
                            icon={<Award className="h-5 w-5 text-purple-400" />}
                            title="Compare Brokers"
                            text="ECN spreads & VPS latency"
                        />
                        <ToolLink
                            href="/copy-trading"
                            icon={<Copy className="h-5 w-5 text-violet-400" />}
                            title="Copy Trading"
                            text="Mirror trades from master accounts"
                        />
                        <ToolLink
                            href="/signals"
                            icon={<Sparkles className="h-5 w-5 text-emerald-500" />}
                            title="AI Signals Engine"
                            text="Real-time AI SL/TP signals"
                        />
                        <ToolLink
                            href="/economic-calendar"
                            icon={<Calendar className="h-5 w-5 text-red-500" />}
                            title="Economic Calendar"
                            text="News impact & EA pause alerts"
                        />
                        <ToolLink
                            href="/account/tradingview"
                            icon={<TrendingUp className="h-5 w-5 text-cyan-400" />}
                            title="Trading Studio"
                            text="Advanced charts, indicators, and real-time data"
                        />
                        <ToolLink
                            href="/scanner"
                            icon={<Activity className="h-5 w-5 text-emerald-400" />}
                            title="Market Scanner"
                            text="Scan assets across multiple markets"
                        />
                        <ToolLink
                            href="/account/tools"
                            icon={<Sparkles className="h-5 w-5 text-violet-400" />}
                            title="Strategy Optimizer"
                            text="AI-powered strategy parameter optimization"
                        />
                        <ToolLink
                            href="/account/tools"
                            icon={<Shield className="h-5 w-5 text-emerald-400" />}
                            title="Risk Manager"
                            text="Position sizing and drawdown control"
                        />
                        <ToolLink
                            href="/account/setfiles"
                            icon={<Settings2 className="h-5 w-5 text-violet-400" />}
                            title="Set Files"
                            text="EA .set configuration files"
                        />
                        <ToolLink
                            href="/donate"
                            icon={<Heart className="h-5 w-5 fill-pink-400 text-pink-400" />}
                            title="Donate & Get Free Tools"
                            text="Support us, unlock free EAs"
                            className="border-pink-500/15 bg-pink-500/[0.05] hover:bg-pink-500/10"
                        />
                        <ToolLink
                            href="/account/tools"
                            icon={<Calculator className="h-5 w-5 text-violet-400" />}
                            title="Notebook & Calculators"
                            text="Trade journal, risk & position size"
                        />
                        <ToolLink
                            href="/account/affiliate"
                            icon={<Gift className="h-5 w-5 text-emerald-500" />}
                            title="Referral Program"
                            text="Refer traders and earn 15%"
                        />
                        <ToolLink
                            href="/ai-historical"
                            icon={<Activity className="h-5 w-5 text-sky-400" />}
                            title="AI Historical Analysis"
                            text="Deep historical market data analysis"
                        />
                        <ToolLink
                            href="/report-generator"
                            icon={<FileText className="h-5 w-5 text-violet-400" />}
                            title="Report Generator"
                            text="Generate AI-powered performance reports"
                        />
                        <ToolLink
                            href="/signal-transparency"
                            icon={<Eye className="h-5 w-5 text-emerald-400" />}
                            title="Signal Transparency"
                            text="Verify signal integrity and model accountability"
                        />
                        <ToolLink
                            href="/verified-performance"
                            icon={<Shield className="h-5 w-5 text-amber-400" />}
                            title="Verified Performance"
                            text="Audited trading performance metrics"
                        />
                    </div>
                </div>

                {/* Risk */}
                <div className="rounded-xl border border-amber-500/10 bg-amber-500/[0.03] p-5">
                    <p className="text-xs leading-5 text-muted-foreground">
                        <span className="font-semibold text-foreground">Risk Disclosure:</span>{" "}
                        Trading involves substantial risk of loss. Backtests, historical
                        results and simulated performance do not guarantee future results.
                        AlgoVault does not guarantee profits or trading success.
                    </p>
                </div>
            </div>
        </AccountShell>
    );
}

function StatCard({
    icon,
    label,
    value,
    spark,
    sparkColor,
}: {
    icon: React.ReactNode;
    label: string;
    value: string;
    spark: number[];
    sparkColor: string;
}) {
    return (
        <div className="rounded-2xl border border-border bg-muted/30 p-5">
            <div className="flex items-center justify-between">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-muted">
                    {icon}
                </div>
            </div>
            <p className="mt-4 text-2xl font-semibold tabular-nums tracking-tight">{value}</p>
            <p className="mt-1 text-sm text-muted-foreground">{label}</p>
            {spark.length >= 2 ? (
                <div className="mt-3 opacity-90">
                    <MiniSparkline values={spark} colorVar={sparkColor} height={36} />
                </div>
            ) : (
                <div className="mt-3 h-[36px]" />
            )}
        </div>
    );
}

function QuickCard({
    href,
    icon,
    iconClass,
    title,
    text,
}: {
    href: string;
    icon: React.ReactNode;
    iconClass: string;
    title: string;
    text: string;
}) {
    return (
        <Link
            href={href}
            className="group rounded-2xl border border-border bg-muted/30 p-5 transition hover:bg-muted/60"
        >
            <div className="flex items-center justify-between">
                <div className={`flex h-10 w-10 items-center justify-center rounded-xl ${iconClass}`}>
                    {icon}
                </div>
                <ChevronRight className="h-4 w-4 text-muted-foreground transition group-hover:translate-x-1 group-hover:text-foreground" />
            </div>
            <h3 className="mt-5 font-semibold">{title}</h3>
            <p className="mt-1 text-sm text-muted-foreground">{text}</p>
        </Link>
    );
}

function ToolLink({
    href,
    icon,
    title,
    text,
    className = "",
}: {
    href: string;
    icon: React.ReactNode;
    title: string;
    text: string;
    className?: string;
}) {
    return (
        <Link
            href={href}
            className={`flex items-center justify-between rounded-xl border border-border bg-muted px-4 py-4 transition hover:bg-muted/60 ${className}`}
        >
            <div className="flex items-center gap-3">
                {icon}
                <div>
                    <p className="text-sm font-medium">{title}</p>
                    <p className="text-xs text-muted-foreground">{text}</p>
                </div>
            </div>
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
        </Link>
    );
}

function formatMoney(amount: number, currency = currencyCode): string {
    return new Intl.NumberFormat("en-US", {
        style: "currency",
        currency,
        maximumFractionDigits: amount >= 100 ? 0 : 2,
    }).format(amount);
}
