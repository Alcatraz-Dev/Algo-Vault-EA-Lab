"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
    HeartPulse,
    Activity,
    ArrowLeft,
    BarChart3,
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
    Zap,
    Trophy,
    RotateCcw,
    Settings,
    Shield,
    ShoppingCart,
    Sparkles,
    Target,
    Users,
    Search,
    X,
    Brain,
    Gauge,
    ShieldCheck,
    Database,
    Server,
} from "lucide-react";
import { onAuthStateChanged, type User as FirebaseUser } from "firebase/auth";
import { auth, database } from "@/lib/firebase";
import { ref, onValue } from "firebase/database";
import SiteLogo from "@/components/ui/site-logo";
import ThemeToggle from "@/components/theme/theme-toggle";
import { NotificationsMenu } from "@/components/layout/NotificationsMenu";
import { cn } from "@/lib/utils";

const NAV_ITEMS = [
    { icon: LayoutDashboard, label: "Dashboard", href: "/admin" },
    { icon: BarChart3, label: "Market Analysis", href: "/admin/analysis" },
    { icon: Target, label: "Growth", href: "/admin/growth" },
    { icon: DollarSign, label: "Monetization", href: "/admin/monetization" },
    { icon: Radio, label: "Telegram Signals", href: "/admin/telegram" },
    { icon: Bot, label: "Bots / Products", href: "/admin/bots" },
    { icon: Activity, label: "Live Accounts", href: "/admin/live" },
    { icon: Sparkles, label: "Live Map", href: "/admin/livemap" },
    { icon: Zap, label: "Scalping Terminal", href: "/admin/scalping" },
    { icon: Shield, label: "Account Health", href: "/admin/intelligence/account-health" },
    { icon: Brain, label: "Intelligence", href: "/admin/intelligence" },
    { icon: Bot, label: "AI Agents", href: "/admin/ai-agents" },
    { icon: Sparkles, label: "AI Trading Teams", href: "/admin/ai-trading-teams" },
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
    { icon: Activity, label: "Trading Providers", href: "/admin/trading-providers" },
    { icon: FileKey2, label: "Trading Licenses", href: "/admin/trading-licenses" },
    { icon: FileCode2, label: "Set Files", href: "/admin/setfiles" },
    { icon: Users, label: "Users", href: "/admin/users" },
    { icon: Code2, label: "Developers", href: "/admin/developers" },
    { icon: Copy, label: "Copy Trading", href: "/admin/copy-trading" },
    { icon: LineChart, label: "Trading Studio", href: "/admin/tradingview" },
    { icon: RotateCcw, label: "Trade Replay", href: "/trade-replay" },
    { icon: DollarSign, label: "Affiliates", href: "/admin/affiliates" },
    { icon: Activity, label: "Business Operations", href: "/admin/business-operations" },
    { icon: ShieldCheck, label: "Business Events", href: "/admin/business-events" },
    { icon: Database, label: "Financial Overview", href: "/admin/business-operations/financial" },
    { icon: Server, label: "ERPNext", href: "/admin/erpnext" },
    { icon: MessageSquare, label: "Reviews", href: "/admin/reviews" },
    { icon: Sparkles, label: "Agent IDE", href: "/agent" },
    { icon: Trophy, label: "Performance Arena", href: "/admin/performance-arena" },
    { icon: Target, label: "Goals", href: "/goals" },
    { icon: Settings, label: "Settings", href: "/admin/settings" },
];

export default function AdminShell({
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
    const [user, setUser] = useState<FirebaseUser | null>(null);
    const [mobileOpen, setMobileOpen] = useState(false);
    const [siteName, setSiteName] = useState("AlgoVault");
    const [navSearch, setNavSearch] = useState("");

    // Same control language as the account-shell topbar (see AppShell): hairline
    // chip on the card surface, muted icon that brightens on hover, a bigger
    // touch target on phones and a visible keyboard focus ring.
    const controlChip =
        "h-10 w-10 shrink-0 rounded-full border border-border bg-card text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 sm:h-9 sm:w-9";

    // Every admin page is a sub-page, so the header always offers a way back: the
    // caller's explicit destination when given, otherwise real history, with the
    // admin dashboard as the fallback for deep links opened in a fresh tab.
    const handleBack = () => {
        if (onBack) {
            onBack();
            return;
        }
        if (typeof window !== "undefined" && window.history.length > 1) {
            router.back();
            return;
        }
        router.push("/admin");
    };

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

    const filteredItems = navSearch.trim()
        ? NAV_ITEMS.filter((item) =>
              item.label.toLowerCase().includes(navSearch.toLowerCase())
          )
        : NAV_ITEMS;

    const sidebarSearch = (
        <>
            <style>{`
                input[type="search"]::-webkit-search-cancel-button,
                input[type="search"]::-webkit-search-decoration {
                    -webkit-appearance: none;
                    appearance: none;
                }
            `}</style>
        <div className="border-b border-border px-3 py-2">
            <div className="relative">
                <Search
                    size={12}
                    className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
                />
                <input
                    type="search"
                    value={navSearch}
                    onChange={(e) => setNavSearch(e.target.value)}
                    placeholder="Search navigation…"
                    className="h-7 w-full rounded-full border border-border bg-muted/40 pl-7 pr-7 text-xs placeholder:text-muted-foreground focus:outline-none"
                />
                {navSearch ? (
                    <button
                        type="button"
                        onClick={() => setNavSearch("")}
                        className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                        aria-label="Clear search"
                    >
                        <X size={11} />
                    </button>
                ) : null}
            </div>
        </div>
        </>
    );

    const nav = (
        <nav className="flex-1 space-y-0.5 overflow-y-auto px-3 py-4">
            {filteredItems.length === 0 ? (
                <p className="px-3 py-4 text-center text-xs text-muted-foreground">
                    No navigation items found
                </p>
            ) : (
                filteredItems.map(({ icon: Icon, label, href }) => {
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
                })
            )}
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
            {sidebarSearch}
            {nav}
            {sidebarFooter}
        </>
    );

    return (
        <div className="flex min-h-screen bg-background text-foreground">
            {/* ── Sidebar (desktop) ── */}
            <aside className="hidden w-60 shrink-0 flex-col border-r border-border bg-card md:flex">
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
                            className="absolute right-3 top-4 flex h-8 w-8 items-center justify-center rounded-full border border-border text-muted-foreground"
                            aria-label="Close navigation menu"
                        >
                            <X size={16} />
                        </button>
                        {sidebarInner}
                    </aside>
                </div>
            )}

            {/* ── Content ──
                 No `overflow-auto` here: an unbounded overflow box never scrolls, but it
                 still becomes the sticky containing box, which pinned the page header to
                 a container that moves with the page. The window scrolls instead, exactly
                 like the account shell (see AppShell). */}
            <div className="flex flex-1 flex-col">
                {/* Header — page header: back/menu controls, title block, global actions.
                    Translucent + blurred instead of a bottom border, so the title stands
                    on its own (the sticky chrome may blur content passing underneath). */}
                <header
                    data-guide="page-header"
                    className="sticky top-0 z-40 bg-background/85 px-4 py-3 backdrop-blur-xl sm:px-6 sm:py-4 md:px-8"
                >
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-2.5 lg:flex-nowrap">
                        <div className="flex shrink-0 items-center gap-1.5">
                            <button
                                type="button"
                                onClick={() => setMobileOpen(true)}
                                className={cn("md:hidden", controlChip, "flex items-center justify-center")}
                                aria-label="Open navigation menu"
                                title="Open navigation menu"
                            >
                                <Menu size={17} />
                            </button>
                            <button
                                type="button"
                                onClick={handleBack}
                                className={cn(controlChip, "flex items-center justify-center")}
                                aria-label="Go back"
                                title="Go back"
                            >
                                <ArrowLeft size={16} aria-hidden="true" />
                            </button>
                        </div>

                        {/* On small screens the title takes its own full-width row under the
                            controls, so a long page name never collapses into an ellipsis. */}
                        <div className="order-last w-full min-w-0 lg:order-none lg:w-auto lg:flex-1">
                            <p className="mb-1 text-micro font-medium uppercase tracking-wider text-muted-foreground">
                                Administration
                            </p>
                            <h1 className="truncate text-xl font-semibold tracking-tight text-foreground sm:text-2xl">
                                {title}
                            </h1>
                            {subtitle ? (
                                <p className="mt-1 truncate text-body-sm text-muted-foreground">
                                    {subtitle}
                                </p>
                            ) : null}
                        </div>

                        <div className="ml-auto flex items-center gap-1.5 sm:gap-2">
                            <NotificationsMenu
                                key={user?.uid ?? "signed-out"}
                                user={user}
                                compact
                            />
                            <ThemeToggle compact />
                        </div>
                    </div>
                </header>

                {/* Page content */}
                <main className="flex-1 animate-page-enter p-4 sm:p-5 md:p-8">{children}</main>
            </div>
        </div>
    );
}
