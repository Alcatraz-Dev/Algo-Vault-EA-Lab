"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
    Activity,
    AlertTriangle,
    ArrowLeft,
    BarChart3,
    Bell,
    Bot,
    Calculator,
    Calendar,
    Code,
    Copy,
    CreditCard,
    Crown,
    DollarSign,
    FileCode2,
    FileKey2,
    FileText,
    FlaskConical,
    Gift,
    Globe,
    LineChart,
    LogOut,
    Menu,
    Settings,
    RotateCcw,
    Target,
    Tag,
    TrendingUp,
    Wallet,
    X,
    Zap,
} from "lucide-react";
import { signOut, onAuthStateChanged, User } from "firebase/auth";
import { auth, database } from "@/lib/firebase";
import { ref, onValue } from "firebase/database";
import SiteLogo from "@/components/ui/site-logo";
import ThemeToggle from "@/components/theme/theme-toggle";

const NAV_SECTIONS = [
    {
        label: "Account",
        items: [
            { icon: CreditCard, label: "Purchases", href: "/account/purchases" },
            { icon: FileKey2, label: "Licenses", href: "/account/licenses" },
            { icon: FileCode2, label: "Set Files", href: "/account/setfiles" },
            { icon: Globe, label: "Trading Access", href: "/account/trading-access" },
            { icon: Gift, label: "Affiliates", href: "/account/affiliate" },
            { icon: Zap, label: "Upgrade", href: "/pricing" },
            { icon: Settings, label: "Settings", href: "/account/settings" },
        ],
    },
    {
        label: "Tools",
        items: [
            { icon: Calculator, label: "Calculators", href: "/tools/calculators" },
            { icon: Target, label: "Goals", href: "/goals" },
            { icon: Bell, label: "Alerts", href: "/alerts" },
            { icon: Zap, label: "Tool Alerts", href: "/alerts/tools" },
            { icon: Bell, label: "Alert History", href: "/alerts/history" },
            { icon: Tag, label: "Trade Tags", href: "/tags" },
            { icon: Globe, label: "Pip Reference", href: "/tools/pip-reference" },
            { icon: DollarSign, label: "Broker Fees", href: "/tools/broker-fees" },
            { icon: Globe, label: "Session Overlap", href: "/tools/overlap" },
        ],
    },
    {
        label: "Developer",
        items: [
            { icon: Code, label: "Dashboard", href: "/developer/dashboard" },
            { icon: Crown, label: "Subscription", href: "/developer/subscription" },
        ],
    },
    {
        label: "Analytics",
        items: [
            { icon: FileText, label: "Statement", href: "/statement" },
            { icon: TrendingUp, label: "Spreads", href: "/spreads" },
            { icon: Zap, label: "News", href: "/news" },
            { icon: Calendar, label: "Economic Calendar", href: "/economic-calendar" },
            { icon: Globe, label: "Sessions", href: "/tools/sessions" },
            { icon: TrendingUp, label: "Fibonacci", href: "/tools/fibonacci" },
            { icon: Target, label: "Currency Strength", href: "/tools/currency-strength" },
            { icon: AlertTriangle, label: "Risk of Ruin", href: "/tools/risk-of-ruin" },
            { icon: Activity, label: "Equity Curve", href: "/equity-curve" },
        ],
    },
    {
        label: "Trading",
        items: [
            { icon: Bot, label: "My Bots", href: "/account/bots" },
            { icon: Zap, label: "AI Signals", href: "/signals" },
            { icon: LineChart, label: "Trading Studio", href: "/account/tradingview" },
            { icon: RotateCcw, label: "Trade Replay", href: "/trade-replay" },
            { icon: FlaskConical, label: "Strategy Lab", href: "/strategy-lab" },
            { icon: Target, label: "Smart Management", href: "/trade-management" },
            { icon: Bell, label: "Alert Center", href: "/alert-center" },
            { icon: BarChart3, label: "Backtests", href: "/backtests" },
            { icon: LineChart, label: "Live", href: "/live" },
            { icon: Copy, label: "Copy Trading", href: "/copy-trading" },
            { icon: Wallet, label: "Compare Brokers", href: "/compare" },
            { icon: Activity, label: "Scanner", href: "/scanner" },
        ],
    },
];

export default function AccountShell({
    children,
    title,
    subtitle,
    onBack,
}: {
    children: React.ReactNode;
    title: string;
    subtitle?: string;
    onBack?: () => void;
}) {
    const pathname = usePathname();
    const router = useRouter();
    const [user, setUser] = useState<User | null>(null);
    const [mobileOpen, setMobileOpen] = useState(false);
    const [siteName, setSiteName] = useState("AlgoVault");

    useEffect(() => {
        const unsub = onAuthStateChanged(auth, (currentUser) => {
            setUser(currentUser);
        });
        return () => unsub();
    }, []);

    useEffect(() => {
        const settingsRef = ref(database, "settings/siteName");
        const unsub = onValue(settingsRef, (snap) => {
            const val = snap.val();
            if (val && typeof val === "string") setSiteName(val);
        });
        return () => unsub();
    }, []);

    const handleSignOut = async () => {
        await signOut(auth);
        router.push("/");
    };

    const isActive = (href: string) => {
        if (href === "/account") {
            return pathname === "/account";
        }
        return pathname?.startsWith(href) ?? false;
    };

    const nav = (
        <nav className="flex-1 space-y-5 overflow-y-auto px-3 py-4">
            {NAV_SECTIONS.map((section) => (
                <div key={section.label}>
                    <p className="px-3 pb-1.5 text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
                        {section.label}
                    </p>
                    <div className="space-y-0.5">
                        {section.items.map(({ icon: Icon, label, href }) => (
                            <Link
                                key={href}
                                href={href}
                                target={href.startsWith("http") ? "_blank" : undefined}
                                onClick={() => setMobileOpen(false)}
                                className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-colors ${isActive(href)
                                        ? "bg-foreground font-semibold text-background"
                                        : "text-muted-foreground hover:bg-muted hover:text-foreground"
                                    }`}
                            >
                                <Icon size={16} className={isActive(href) ? "" : "text-muted-foreground"} />
                                {label}
                            </Link>
                        ))}
                    </div>
                </div>
            ))}
        </nav>
    );

    const sidebarFooter = (
        <div className="space-y-1 border-t border-border px-3 py-4">
            {pathname !== "/account" && (
                <Link
                    href="/account"
                    className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-foreground transition hover:bg-muted"
                >
                    <ArrowLeft size={15} />
                    Account Home
                </Link>
            )}
            <Link
                href="/"
                className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-muted-foreground transition hover:bg-muted hover:text-foreground"
            >
                <Globe size={15} />
                Public Site
            </Link>
            {user && (
                <div className="mt-1 flex items-center justify-between rounded-xl bg-muted px-3 py-2.5">
                    <div className="min-w-0">
                        <p className="truncate text-sm font-medium">
                            {user.displayName || user.email || "Trader"}
                        </p>
                        <p className="truncate text-xs text-muted-foreground">{user.email}</p>
                    </div>
                    <button
                        type="button"
                        onClick={handleSignOut}
                        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border text-muted-foreground transition hover:text-foreground"
                        aria-label="Sign out"
                        title="Sign out"
                    >
                        <LogOut size={15} />
                    </button>
                </div>
            )}
        </div>
    );

    const sidebarInner = (
        <>
            <div className="border-b border-border">
                <Link href="/account" className="flex items-center gap-3 px-5 py-5">
                    <SiteLogo size={18} />
                    <div>
                        <p className="text-sm font-bold leading-none">{siteName}</p>
                        <p className="mt-0.5 text-[11px] text-muted-foreground">
                            Customer Area
                        </p>
                    </div>
                </Link>
            </div>
            {nav}
            {sidebarFooter}
        </>
    );

    return (
        <div className="flex min-h-screen bg-background text-foreground">
            {/* ── Sidebar (desktop) ── */}
            <aside className="hidden w-64 shrink-0 flex-col border-r border-border bg-card md:flex" data-guide="sidebar">
                {sidebarInner}
            </aside>

            {/* ── Mobile drawer ── */}
            {mobileOpen && (
                <div className="fixed inset-0 z-50 flex md:hidden">
                    <div
                        className="absolute inset-0 bg-background/70 backdrop-blur-sm"
                        onClick={() => setMobileOpen(false)}
                    />
                    <aside className="relative flex w-64 shrink-0 flex-col border-r border-border bg-card">
                        <button
                            type="button"
                            onClick={() => setMobileOpen(false)}
                            className="absolute right-3 top-4 flex h-8 w-8 items-center justify-center rounded-lg border border-border text-muted-foreground"
                            aria-label="Close navigation menu"
                        >
                            <X size={16} />
                        </button>
                        {sidebarInner}
                    </aside>
                </div>
            )}

            {/* ── Content ── */}
            <div className="flex flex-1 flex-col overflow-auto">
                {/* Header */}
                <header className="flex items-center justify-between border-b border-border bg-background px-6 py-4 md:px-8">
                    <div className="flex items-center gap-3">
                        {(onBack || pathname !== "/account") && (
                            <button
                                type="button"
                                onClick={() => {
                                    if (onBack) onBack();
                                    else router.push("/account");
                                }}
                                className="flex h-9 w-9 items-center justify-center rounded-xl border border-border text-muted-foreground hover:bg-muted hover:text-foreground transition"
                                aria-label="Back to Account"
                                title="Back to Account"
                            >
                                <ArrowLeft size={17} />
                            </button>
                        )}
                        <button
                            type="button"
                            onClick={() => setMobileOpen(true)}
                            className="flex h-9 w-9 items-center justify-center rounded-xl border border-border text-muted-foreground md:hidden"
                            aria-label="Open navigation menu"
                        >
                            <Menu size={17} />
                        </button>
                        <div data-guide="page-header">
                            <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
                                My Account
                            </p>
                            <h1 className="mt-0.5 text-xl font-bold">{title}</h1>
                            {subtitle && (
                                <p className="mt-0.5 text-sm text-muted-foreground">
                                    {subtitle}
                                </p>
                            )}
                        </div>
                    </div>
                    <div className="flex items-center gap-3">
                        <span className="hidden items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5 text-xs text-muted-foreground sm:flex">
                            <span className="relative flex h-2 w-2">
                                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500 opacity-60" />
                                <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
                            </span>
                            {user ? "Signed in" : "Signed out"}
                        </span>
                        <ThemeToggle />
                    </div>
                </header>

                {/* Page content */}
                <main className="flex-1 p-6 md:p-8">{children}</main>
            </div>
        </div>
    );
}
