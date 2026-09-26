"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
    HeartPulse,
    Activity,
    ArrowLeft,
    Bot,
    Code2,
    Copy,
    DollarSign,
    Download,
    ExternalLink,
    FileCode2,
    FileKey2,
    GitBranch,
    LayoutDashboard,
    LineChart,
    Menu,
    MessageSquare,
    Plug,
    Puzzle,
    Radio,
    RotateCcw,
    Settings,
    ShoppingCart,
    Sparkles,
    Target,
    Users,
    X,
    Gauge,
} from "lucide-react";
import { onAuthStateChanged, type User as FirebaseUser } from "firebase/auth";
import { auth, database } from "@/lib/firebase";
import { ref, onValue } from "firebase/database";
import SiteLogo from "@/components/ui/site-logo";
import ThemeToggle from "@/components/theme/theme-toggle";
import { NotificationsMenu } from "@/components/layout/NotificationsMenu";

const NAV_ITEMS = [
    { icon: LayoutDashboard, label: "Dashboard", href: "/admin" },
    { icon: Target, label: "Growth", href: "/admin/growth" },
    { icon: DollarSign, label: "Monetization", href: "/admin/monetization" },
    { icon: Radio, label: "Telegram Signals", href: "/admin/telegram" },
    { icon: Bot, label: "Bots / Products", href: "/admin/bots" },
    { icon: Activity, label: "Live Accounts", href: "/admin/live" },
    { icon: HeartPulse, label: "AI Provider Health", href: "/admin/intelligence/ai-health" },
    { icon: Gauge, label: "AI Usage & Budgets", href: "/admin/intelligence/ai-usage" },
    { icon: Download, label: "Backtests", href: "/admin/backtests" },
    { icon: GitBranch, label: "Workflow Automation", href: "/admin/workflows" },
    { icon: Plug, label: "Plugins", href: "/admin/plugins" },
    { icon: Sparkles, label: "AI Plugin Studio", href: "/admin/plugins/ai-studio" },
    { icon: Puzzle, label: "Extensions", href: "/admin/extensions" },
    { icon: ShoppingCart, label: "Orders", href: "/admin/orders" },
    { icon: FileKey2, label: "Licenses", href: "/admin/licenses" },
    { icon: Radio, label: "Trading Accounts", href: "/admin/trading-accounts" },
    { icon: FileKey2, label: "Trading Licenses", href: "/admin/trading-licenses" },
    { icon: FileCode2, label: "Set Files", href: "/admin/setfiles" },
    { icon: Users, label: "Users", href: "/admin/users" },
    { icon: Code2, label: "Developers", href: "/admin/developers" },
    { icon: Copy, label: "Copy Trading", href: "/admin/copy-trading" },
    { icon: LineChart, label: "Trading Studio", href: "/admin/tradingview" },
    { icon: RotateCcw, label: "Trade Replay", href: "/trade-replay" },
    { icon: DollarSign, label: "Affiliates", href: "/admin/affiliates" },
    { icon: MessageSquare, label: "Reviews", href: "/admin/reviews" },
    { icon: Target, label: "Goals", href: "/goals" },
    { icon: Settings, label: "Settings", href: "/admin/settings" },
];

export default function AdminShell({
    children,
    title,
    subtitle,
}: {
    children: React.ReactNode;
    title: string;
    subtitle?: string;
}) {
    const pathname = usePathname();
    const [user, setUser] = useState<FirebaseUser | null>(null);
    const [mobileOpen, setMobileOpen] = useState(false);
    const [siteName, setSiteName] = useState("AlgoVault");

    useEffect(() => {
        const unsub = onAuthStateChanged(auth, (currentUser) => setUser(currentUser));
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

    const logo = (
        <Link href="/admin" className="flex items-center gap-3 px-5 py-5">
            <SiteLogo size={18} />
            <div>
                <p className="text-sm font-bold leading-none">{siteName}</p>
                <p className="mt-0.5 text-micro text-muted-foreground">Admin Panel</p>
            </div>
        </Link>
    );

    const nav = (
        <nav className="flex-1 space-y-0.5 overflow-y-auto px-3 py-4">
            {NAV_ITEMS.map(({ icon: Icon, label, href }) => {
                const isActive =
                    pathname === href ||
                    (href !== "/admin" && pathname?.startsWith(href));
                return (
                    <Link
                        key={href}
                        href={href}
                        onClick={() => setMobileOpen(false)}
                        className={`flex items-center gap-3 rounded-md px-3 py-2 text-xs transition-colors ${isActive
                                ? "bg-accent-muted font-semibold text-primary"
                                : "text-muted-foreground hover:bg-muted hover:text-foreground"
                            }`}
                    >
                        <Icon
                            size={16}
                            className={isActive ? "" : "text-muted-foreground"}
                        />
                        {label}
                    </Link>
                );
            })}
        </nav>
    );

    const sidebarFooter = (
        <div className="space-y-1 border-t border-border px-3 py-4">
            <Link
                href="/"
                className="flex items-center gap-3 rounded-md px-3 py-2.5 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
                <ArrowLeft size={15} />
                Back to Site
            </Link>
            <Link
                href="/live"
                className="flex items-center gap-3 rounded-md px-3 py-2.5 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
                <ExternalLink size={15} />
                View Live Page
            </Link>
        </div>
    );

    const sidebarInner = (
        <>
            <div className="border-b border-border">{logo}</div>
            {nav}
            {sidebarFooter}
        </>
    );

    return (
        <div className="flex min-h-screen bg-background text-foreground">
            {/* ── Sidebar (desktop) ── */}
            <aside className="hidden w-60 shrink-0 flex-col border-r border-border bg-sidebar md:flex">
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
                <header className="flex items-center justify-between border-b border-border bg-background px-4 py-3.5 sm:px-6 md:px-8">
                    <div className="flex items-center gap-3">
                        <button
                            type="button"
                            onClick={() => setMobileOpen(true)}
                            className="flex h-9 w-9 items-center justify-center rounded-xl border border-border text-muted-foreground md:hidden"
                            aria-label="Open navigation menu"
                        >
                            <Menu size={17} />
                        </button>
                        <div data-guide="page-header">
                            <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                                Administration
                            </p>
                            <h1 className="mt-0.5 text-lg font-semibold">{title}</h1>
                            {subtitle && (
                                <p className="mt-0.5 hidden text-sm text-muted-foreground sm:block">
                                    {subtitle}
                                </p>
                            )}
                        </div>
                    </div>
                    <div className="flex items-center gap-1.5">
                        <NotificationsMenu key={user?.uid ?? "signed-out"} user={user} />
                        <ThemeToggle />
                    </div>
                </header>

                {/* Page content */}
                <main className="flex-1 animate-page-enter p-4 sm:p-5 md:p-8">{children}</main>
            </div>
        </div>
    );
}
