"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
    ArrowDown,
    ArrowLeft,
    ArrowRight,
    ArrowUp,
    Bot,
    CheckCircle2,
    Copy,
    Info,
    Loader2,
    Lock,
    Pause,
    Play,
    Plus,
    RefreshCw,
    Settings2,
    Shield,
    Sliders,
    Users,
    X,
    Zap,
} from "lucide-react";
import { onAuthStateChanged, User } from "firebase/auth";
import { onValue, ref } from "firebase/database";
import { auth, database } from "@/lib/firebase";

// ─── Types ───────────────────────────────────────────────────────────────────

type MasterAccount = {
    id: string;
    productId?: string;
    productName?: string;
    mt5Account?: string | number;
    broker?: string;
    server?: string;
    balance?: number;
    equity?: number;
    floatingProfit?: number;
    status?: string;
    online?: boolean;
    allowCopyTrading?: boolean;
    lastHeartbeatAt?: number;
    stats?: {
        winRate?: number;
        profitFactor?: number;
        totalTrades?: number;
        totalProfit?: number;
        drawdown?: number;
    };
    followerCount?: number;
    totalCopiedProfit?: number;
    isFollowing?: boolean;
    followingConfigIds?: string[];
};

type FollowerConfig = {
    id?: string;
    masterId: string;
    masterMt5Account: string | number;
    followerMt5Account: string | number;
    licenseKey?: string;
    isActive: boolean;
    lotMultiplier: number;
    maxLot: number;
    maxOpenTrades: number;
    reverseSignals: boolean;
    copyStopLoss: boolean;
    copyTakeProfit: boolean;
    createdAt?: number;
    updatedAt?: number;
    totalCopied?: number;
    totalProfit?: number;
};

type License = {
    id?: string;
    productId?: string;
    productName?: string;
    licenseKey?: string;
    status?: string;
    mt5Account?: string | number;
    expiresAt?: number;
};

type CopiedTrade = {
    ticket: string;
    masterTicket: string;
    symbol: string;
    type: "BUY" | "SELL";
    volume: number;
    openPrice: number;
    currentProfit: number;
    profit?: number;
    closePrice?: number | null;
    closedAt?: number;
    openedAt: number;
    status: "open" | "closed";
};

type UnlistedMaster = {
    id: string;
    liveAccountId: string | null;
    mt5Account: string;
    online: boolean;
    allowCopyTrading: boolean;
    reason: string;
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatMoney(value: number, currency = "USD") {
    try {
        return new Intl.NumberFormat("en-US", {
            style: "currency",
            currency,
            maximumFractionDigits: 2,
        }).format(value);
    } catch {
        return `$${value.toFixed(2)}`;
    }
}

function timeAgo(ms?: number | null) {
    if (!ms) return "—";
    const diff = Math.floor((Date.now() - ms) / 1000);
    if (diff < 60) return `${diff}s ago`;
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    return `${Math.floor(diff / 86400)}d ago`;
}

function riskTone(dd?: number | null) {
    if (dd == null) return "text-muted-foreground";
    if (dd < 10) return "text-emerald-400";
    if (dd < 20) return "text-amber-400";
    return "text-red-400";
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function OnlineDot({ online }: { online?: boolean }) {
    return (
        <span className={`relative flex h-2 w-2`}>
            {online && (
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
            )}
            <span className={`relative inline-flex h-2 w-2 rounded-full ${online ? "bg-emerald-500" : "bg-muted"}`} />
        </span>
    );
}

function StatPill({ label, value, positive }: { label: string; value: string; positive?: boolean }) {
    return (
        <div className="rounded-xl border border-border/30 bg-muted px-3.5 py-2.5">
            <p className="text-[11px] text-muted-foreground">{label}</p>
            <p className={`mt-0.5 text-sm font-bold ${positive === undefined ? "text-foreground" : positive ? "text-emerald-400" : "text-red-400"}`}>
                {value}
            </p>
        </div>
    );
}

// ─── Main Page ───────────────────────────────────────────────────────────────

export default function CopyTradingPage() {
    const [user, setUser] = useState<User | null>(null);
    const [authLoading, setAuthLoading] = useState(true);
    const [licenses, setLicenses] = useState<License[]>([]);
    const [masterAccounts, setMasterAccounts] = useState<MasterAccount[]>([]);
    const [followerConfigs, setFollowerConfigs] = useState<FollowerConfig[]>([]);
    const [copiedTrades, setCopiedTrades] = useState<CopiedTrade[]>([]);
    const [unlistedMasters, setUnlistedMasters] = useState<UnlistedMaster[]>([]);
    const [loadingMasters, setLoadingMasters] = useState(true);
    const [savingId, setSavingId] = useState<string | null>(null);

    // Setup modal state
    const [showSetupModal, setShowSetupModal] = useState(false);
    const [setupMaster, setSetupMaster] = useState<MasterAccount | null>(null);
    const [setupForm, setSetupForm] = useState({
        followerMt5Account: "",
        licenseKey: "",
        lotMultiplier: "1.0",
        maxLot: "0.1",
        maxOpenTrades: "5",
        reverseSignals: false,
        copyStopLoss: true,
        copyTakeProfit: true,
    });
    const [setupError, setSetupError] = useState("");
    const [savingSetup, setSavingSetup] = useState(false);

    // ── Auth ────────────────────────────────────────────────────────────────
    useEffect(() => {
        const unsubscribe = onAuthStateChanged(auth, (u) => {
            setUser(u);
            setAuthLoading(false);
        });
        return () => unsubscribe();
    }, []);

    // ── Load licenses ───────────────────────────────────────────────────────
    useEffect(() => {
        if (!user) return;
        const licensesRef = ref(database, `licenses/${user.uid}`);
        return onValue(licensesRef, (snap) => {
            const data = snap.val() || {};
            const list: License[] = Object.entries(data).map(([id, val]) => ({ id, ...(val as Partial<License>) })) as License[];
            setLicenses(list.filter((l) => l.status === "active" && Number(l.expiresAt || 0) > Date.now()));
        });
    }, [user]);

    const loadMarketplaceMasters = useCallback(async (currentUser = user) => {
        setLoadingMasters(true);
        try {
            const token = currentUser ? await currentUser.getIdToken() : "";
            const res = await fetch("/api/copy-trading/marketplace", {
                headers: token ? { Authorization: `Bearer ${token}` } : undefined,
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data?.error || "Failed to load master accounts.");
            setMasterAccounts(data.masters || []);
            setUnlistedMasters(data.unlistedMasters || []);
        } catch (err: unknown) {
            setSetupError(err instanceof Error ? err.message : "Failed to load master accounts.");
            setMasterAccounts([]);
        } finally {
            setLoadingMasters(false);
        }
    }, [user]);

    // ── Load validated master marketplace ───────────────────────────────────
    useEffect(() => {
        const timeout = setTimeout(() => {
            void loadMarketplaceMasters(user);
        }, 0);
        return () => clearTimeout(timeout);
    }, [loadMarketplaceMasters, user]);

    // ── Load user's follower configs ─────────────────────────────────────────
    useEffect(() => {
        if (!user) return;
        const configRef = ref(database, `copy_trading/${user.uid}`);
        return onValue(configRef, (snap) => {
            const data = snap.val() || {};
            const configs: FollowerConfig[] = Object.entries(data).map(([id, val]) => ({ id, ...(val as Partial<FollowerConfig>) })) as FollowerConfig[];
            setFollowerConfigs(configs);
        });
    }, [user]);

    // ── Load copied trades ───────────────────────────────────────────────────
    useEffect(() => {
        if (!user) return;
        const tradesRef = ref(database, `copied_trades/${user.uid}`);
        return onValue(tradesRef, (snap) => {
            const data = snap.val() || {};
            const trades: CopiedTrade[] = Object.values(data) as CopiedTrade[];
            setCopiedTrades(trades.sort((a, b) => (b.openedAt || 0) - (a.openedAt || 0)));
        });
    }, [user]);

    // ── Setup Modal Handlers ─────────────────────────────────────────────────
    function openSetupModal(master: MasterAccount) {
        setSetupMaster(master);
        setSetupError("");
        setSetupForm({
            followerMt5Account: "",
            licenseKey: licenses[0]?.licenseKey || "",
            lotMultiplier: "1.0",
            maxLot: "0.1",
            maxOpenTrades: "5",
            reverseSignals: false,
            copyStopLoss: true,
            copyTakeProfit: true,
        });
        setShowSetupModal(true);
    }

    async function saveFollowerConfig() {
        if (!user || !setupMaster) return;

        if (!setupForm.followerMt5Account.trim()) {
            setSetupError("Enter your MT5 account number.");
            return;
        }

        setSavingSetup(true);
        setSetupError("");

        try {
            const token = await user.getIdToken();
            const res = await fetch("/api/copy-trading/config", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify({
                    masterId: setupMaster.id,
                    masterMt5Account: setupMaster.mt5Account || "",
                    followerMt5Account: setupForm.followerMt5Account.trim(),
                    licenseKey: setupForm.licenseKey || undefined,
                    lotMultiplier: Number(setupForm.lotMultiplier) || 1,
                    maxLot: Number(setupForm.maxLot) || 0.1,
                    maxOpenTrades: Number(setupForm.maxOpenTrades) || 5,
                    reverseSignals: setupForm.reverseSignals,
                    copyStopLoss: setupForm.copyStopLoss,
                    copyTakeProfit: setupForm.copyTakeProfit,
                    isActive: true,
                }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data?.error || "Failed to save configuration.");
            setShowSetupModal(false);
            await loadMarketplaceMasters(user);
        } catch (err: unknown) {
            setSetupError(err instanceof Error ? err.message : "Failed to save configuration.");
        } finally {
            setSavingSetup(false);
        }
    }

    async function toggleFollower(config: FollowerConfig) {
        if (!user || !config.id) return;
        setSavingId(config.id);
        try {
            const token = await user.getIdToken();
            const res = await fetch("/api/copy-trading/config", {
                method: "PATCH",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify({
                    configId: config.id,
                    isActive: !config.isActive,
                }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data?.error || "Failed to update configuration.");
        } finally {
            setSavingId(null);
        }
    }

    async function deleteFollower(config: FollowerConfig) {
        if (!user || !config.id) return;
        if (!confirm("Remove this copy trading configuration?")) return;
        setSavingId(config.id);
        try {
            const token = await user.getIdToken();
            const res = await fetch("/api/copy-trading/config", {
                method: "DELETE",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify({ configId: config.id }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data?.error || "Failed to remove configuration.");
            await loadMarketplaceMasters(user);
        } finally {
            setSavingId(null);
        }
    }

    // ── Derived ──────────────────────────────────────────────────────────────
    const openCopiedTrades = useMemo(() => copiedTrades.filter((t) => t.status === "open"), [copiedTrades]);
    const totalCopyProfit = useMemo(
        () => copiedTrades.reduce((s, t) => s + (t.status === "closed" ? t.profit || 0 : t.currentProfit || 0), 0),
        [copiedTrades]
    );

    // ── Auth guard ───────────────────────────────────────────────────────────
    if (authLoading) {
        return (
            <main className="flex min-h-screen items-center justify-center bg-background">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </main>
        );
    }

    if (!user) {
        return (
            <main className="flex min-h-screen flex-col items-center justify-center gap-5 bg-background text-foreground">
                <Lock className="h-12 w-12 text-muted-foreground" />
                <h1 className="text-2xl font-bold">Sign in to use Copy Trading</h1>
                <Link href="/login?redirect=/copy-trading" className="rounded-xl bg-background px-5 py-3 font-semibold text-foreground">
                    Sign In
                </Link>
            </main>
        );
    }

    // ─────────────────────────────────────────────────────────────────────────
    return (
        <main className="min-h-screen bg-background text-foreground">
            {/* Background blurs */}
            <div className="pointer-events-none fixed inset-0 overflow-hidden">
                <div className="absolute left-1/2 top-[-300px] h-[700px] w-[700px] -translate-x-1/2 rounded-full bg-violet-600/[0.07] blur-[140px]" />
                <div className="absolute bottom-[-200px] right-[-150px] h-[500px] w-[500px] rounded-full bg-blue-600/[0.06] blur-[140px]" />
            </div>

            <div className="relative mx-auto max-w-7xl px-5 py-10">

                {/* Back */}
                <Link href="/account" className="mb-8 inline-flex items-center gap-2 text-sm text-muted-foreground transition hover:text-foreground">
                    <ArrowLeft size={16} />
                    Back to Account
                </Link>

                {/* Header */}
                <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between" data-guide="page-header">
                    <div>
                        <div className="inline-flex items-center gap-2 rounded-full border border-border/30 bg-muted/5 px-3.5 py-1.5 text-xs font-medium text-muted-foreground">
                            <Copy size={13} className="text-violet-400" />
                            Automated Signal Mirroring
                        </div>
                        <h1 className="mt-4 text-3xl font-bold tracking-tight sm:text-4xl">Copy Trading</h1>
                        <p className="mt-2 text-sm leading-6 text-muted-foreground max-w-xl">
                            Mirror trades from master MT5 accounts to your own account in real time. Set custom lot sizing, risk limits, and filters.
                        </p>
                    </div>

                    {followerConfigs.length > 0 && (
                        <button
                            type="button"
                            onClick={() => {
                                if (masterAccounts.length > 0) openSetupModal(masterAccounts[0]);
                            }}
                            className="flex shrink-0 items-center gap-2 rounded-xl bg-violet-600 px-5 py-2.5 text-sm font-bold text-foreground transition hover:bg-violet-500"
                        >
                            <Plus size={16} />
                            Add Follower
                        </button>
                    )}
                </div>

                {/* Summary Stats */}
                {followerConfigs.length > 0 && (
                    <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4" data-guide="stats">
                        <StatPill label="Active Followers" value={String(followerConfigs.filter((c) => c.isActive).length)} />
                        <StatPill label="Open Copied Trades" value={String(openCopiedTrades.length)} />
                        <StatPill
                            label="Total Copy Profit"
                            value={formatMoney(totalCopyProfit)}
                            positive={totalCopyProfit >= 0}
                        />
                        <StatPill
                            label="Total Copied Trades"
                            value={String(copiedTrades.length)}
                        />
                    </div>
                )}

                {/* Active Follower Configs */}
                {followerConfigs.length > 0 && (
                    <div className="mt-10" data-guide="configs">
                        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                            Your Follower Accounts
                        </h2>

                        <div className="space-y-3">
                            {followerConfigs.map((config) => {
                                const master = masterAccounts.find((m) => m.id === config.masterId);
                                const isSaving = savingId === config.id;

                                return (
                                    <div
                                        key={config.id}
                                        className={`rounded-2xl border p-5 transition ${config.isActive ? "border-violet-500/20 bg-violet-500/[0.04]" : "border-border/30 bg-muted/50"}`}
                                    >
                                        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                                            <div className="flex items-center gap-4">
                                                <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${config.isActive ? "bg-violet-500/10" : "bg-muted/5"}`}>
                                                    <Copy size={18} className={config.isActive ? "text-violet-400" : "text-muted-foreground"} />
                                                </div>

                                                <div>
                                                    <div className="flex flex-wrap items-center gap-2">
                                                        <p className="font-semibold text-foreground">
                                                            MT5 #{config.followerMt5Account}
                                                        </p>
                                                        <span className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${config.isActive ? "border-violet-500/30 bg-violet-500/10 text-violet-300" : "border-border/30 bg-muted/5 text-muted-foreground"}`}>
                                                            {config.isActive ? "Active" : "Paused"}
                                                        </span>
                                                    </div>

                                                    <p className="mt-0.5 text-xs text-muted-foreground">
                                                        Following master: {master?.productName || config.masterMt5Account} (#{config.masterMt5Account})
                                                        {" · "}Lot ×{config.lotMultiplier}
                                                        {" · "}Max {config.maxLot} lots
                                                        {config.reverseSignals && " · Reversed"}
                                                    </p>
                                                </div>
                                            </div>

                                            <div className="flex items-center gap-2 shrink-0">
                                                <button
                                                    type="button"
                                                    onClick={() => toggleFollower(config)}
                                                    disabled={isSaving}
                                                    className={`flex items-center gap-2 rounded-xl border px-4 py-2 text-xs font-semibold transition ${config.isActive
                                                        ? "border-amber-500/30 bg-amber-500/10 text-amber-300 hover:bg-amber-500/20"
                                                        : "border-emerald-500/30 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20"}`}
                                                >
                                                    {isSaving ? <Loader2 size={13} className="animate-spin" /> : config.isActive ? <Pause size={13} /> : <Play size={13} />}
                                                    {config.isActive ? "Pause" : "Resume"}
                                                </button>

                                                <button
                                                    type="button"
                                                    onClick={() => deleteFollower(config)}
                                                    disabled={isSaving}
                                                    className="flex items-center gap-1.5 rounded-xl border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs font-semibold text-red-400 transition hover:bg-red-500/20 disabled:opacity-50"
                                                >
                                                    <X size={13} />
                                                    Remove
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                )}

                {/* Master Accounts Grid */}
                <div className="mt-10">
                    <div className="flex items-center justify-between mb-4">
                        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                            Available Master Accounts
                        </h2>
                        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                            <RefreshCw size={11} />
                            Server verified
                        </div>
                    </div>

                    {loadingMasters ? (
                        <div className="rounded-2xl border border-border/30 bg-muted/50 p-16 text-center">
                            <Loader2 className="mx-auto h-8 w-8 animate-spin text-muted-foreground mb-3" />
                            <p className="text-sm text-muted-foreground">Loading master accounts...</p>
                        </div>
                    ) : masterAccounts.length === 0 ? (
                        <div className="rounded-2xl border border-dashed border-border/30 bg-muted/50 p-14 text-center">
                            <Users className="mx-auto h-10 w-10 text-muted-foreground mb-3" />
                            <h3 className="font-semibold text-foreground">No master accounts yet</h3>
                            <p className="mt-2 text-sm text-muted-foreground max-w-md mx-auto">
                                Master accounts appear here once an AlgoVaultTradeGateway EA connects via heartbeat and the owner enables
                                {" "}<span className="text-muted-foreground">Allow being copied</span> from their Master Copy Trading page.
                            </p>

                            {unlistedMasters.length > 0 ? (
                                <div className="mx-auto mt-6 max-w-xl space-y-2 text-left">
                                    <p className="text-center text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                                        Your connected gateway account{unlistedMasters.length > 1 ? "s" : ""}
                                    </p>
                                    {unlistedMasters.map((acc) => (
                                        <div
                                            key={acc.id}
                                            className="flex items-center justify-between gap-3 rounded-xl border border-border/30 bg-muted px-4 py-3"
                                        >
                                            <div className="min-w-0">
                                                <p className="text-sm font-semibold text-foreground font-mono">
                                                    MT5 #{acc.mt5Account}
                                                </p>
                                                <p className="mt-0.5 text-xs text-muted-foreground">
                                                    {acc.reason}
                                                </p>
                                            </div>
                                            <span className={`shrink-0 rounded-full border px-2.5 py-1 text-[11px] font-medium ${
                                                acc.allowCopyTrading
                                                    ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
                                                    : "border-amber-500/30 bg-amber-500/10 text-amber-300"
                                            }`}>
                                                {acc.online ? (acc.allowCopyTrading ? "Listed" : "Copying disabled") : "Offline"}
                                            </span>
                                        </div>
                                    ))}
                                    <Link
                                        href="/account/copy-trading"
                                        className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-violet-600/20 border border-violet-500/30 px-5 py-2.5 text-sm font-semibold text-violet-200 transition hover:bg-violet-500/30"
                                    >
                                        Manage my master accounts
                                        <ArrowRight size={14} />
                                    </Link>
                                </div>
                            ) : (
                                <Link
                                    href="/marketplace"
                                    className="mt-5 inline-flex items-center gap-2 rounded-xl bg-muted/10 px-5 py-2.5 text-sm font-semibold text-foreground transition hover:bg-foreground/30"
                                >
                                    Browse Marketplace
                                    <ArrowRight size={14} />
                                </Link>
                            )}
                        </div>
                    ) : (
                        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                            {masterAccounts.map((master) => {
                                const alreadyFollowing = followerConfigs.some((c) => c.masterId === master.id && c.isActive);
                                const winRate = master.stats?.winRate;
                                const profit = master.stats?.totalProfit;
                                const risk = master.stats?.drawdown;
                                const totalTrades = master.stats?.totalTrades;
                                const profitFactor = master.stats?.profitFactor;

                                return (
                                    <div
                                        key={master.id}
                                        className="group rounded-2xl border border-border/30 bg-muted p-5 transition hover:border-border/50 hover:bg-muted/20"
                                    >
                                        {/* Header */}
                                        <div className="flex items-start justify-between gap-3">
                                            <div className="flex items-center gap-3">
                                                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-muted/5 border border-border/30">
                                                    <Bot size={18} className="text-violet-400" />
                                                </div>
                                                <div>
                                                    <p className="font-bold text-foreground text-sm leading-tight">
                                                        {master.productName || "EA Account"}
                                                    </p>
                                                    <p className="text-[11px] text-muted-foreground mt-0.5 font-mono">
                                                        MT5 #{master.mt5Account}
                                                    </p>
                                                </div>
                                            </div>

                                            <div className="flex items-center gap-1.5 shrink-0">
                                                <OnlineDot online={master.online} />
                                                <span className={`text-[11px] font-medium ${master.online ? "text-emerald-400" : "text-muted-foreground"}`}>
                                                    {master.online ? "LIVE" : "Offline"}
                                                </span>
                                            </div>
                                        </div>

                                        {/* Broker info */}
                                        {master.broker && (
                                            <div className="mt-3 flex items-center gap-2 text-[11px] text-muted-foreground">
                                                <Shield size={11} />
                                                {master.broker}
                                                {master.server && <span className="text-muted-foreground">· {master.server}</span>}
                                            </div>
                                        )}

                                        {/* Stats */}
                                        <div className="mt-4 grid grid-cols-3 gap-2">
                                            <div className="rounded-lg border border-border/30 bg-background/70 px-2.5 py-2 text-center">
                                                <p className="text-[11px] text-muted-foreground">Balance</p>
                                                <p className="mt-0.5 text-xs font-bold text-foreground">
                                                    {master.balance != null ? formatMoney(master.balance) : "—"}
                                                </p>
                                            </div>
                                            <div className="rounded-lg border border-border/30 bg-background/70 px-2.5 py-2 text-center">
                                                <p className="text-[11px] text-muted-foreground">Win Rate</p>
                                                <p className={`mt-0.5 text-xs font-bold ${winRate != null ? (winRate >= 50 ? "text-emerald-400" : "text-red-400") : "text-muted-foreground"}`}>
                                                    {winRate != null ? `${Number(winRate).toFixed(1)}%` : "—"}
                                                </p>
                                            </div>
                                            <div className="rounded-lg border border-border/30 bg-background/70 px-2.5 py-2 text-center">
                                                <p className="text-[11px] text-muted-foreground">Risk (Max DD)</p>
                                                <p className={`mt-0.5 text-xs font-bold ${riskTone(risk)}`}>
                                                    {risk != null ? `${Number(risk).toFixed(1)}%` : "—"}
                                                </p>
                                            </div>
                                        </div>

                                        {/* P/L bar */}
                                        <div className="mt-2 flex items-center justify-between gap-2 rounded-lg border border-border/30 bg-background/70 px-3 py-2">
                                            <span className="text-[11px] text-muted-foreground">Total P/L</span>
                                            <span className={`text-sm font-bold tabular-nums ${profit != null ? (profit >= 0 ? "text-emerald-400" : "text-red-400") : "text-muted-foreground"}`}>
                                                {profit != null ? `${profit >= 0 ? "+" : ""}${formatMoney(profit)}` : "—"}
                                            </span>
                                            <span className="text-[10px] text-muted-foreground">
                                                {totalTrades != null ? `${totalTrades} trades` : "no closed trades"}
                                                {profitFactor != null && totalTrades != null ? ` · PF ${Number(profitFactor).toFixed(2)}` : ""}
                                            </span>
                                        </div>

                                        {/* Last heartbeat */}
                                        <p className="mt-3 text-[11px] text-muted-foreground">
                                            Last seen: {timeAgo(master.lastHeartbeatAt)}
                                        </p>

                                        {/* CTA */}
                                        <button
                                            type="button"
                                            onClick={() => openSetupModal(master)}
                                            className={`mt-4 w-full flex items-center justify-center gap-2 rounded-xl py-2.5 text-sm font-bold transition ${alreadyFollowing
                                                ? "border border-violet-500/30 bg-violet-500/10 text-violet-300 hover:bg-violet-500/20"
                                                : "bg-gradient-to-r from-violet-600 to-blue-600 text-foreground hover:from-violet-500 hover:to-blue-500"}`}
                                        >
                                            {alreadyFollowing ? (
                                                <>
                                                    <Settings2 size={14} />
                                                    Add Another Follower
                                                </>
                                            ) : (
                                                <>
                                                    <Copy size={14} />
                                                    Start Copying
                                                </>
                                            )}
                                        </button>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>

                {/* Copied Trades Table */}
                {copiedTrades.length > 0 && (
                    <div className="mt-10">
                        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                            Copied Trade History
                        </h2>

                        <div className="rounded-2xl border border-border/30 bg-muted overflow-hidden">
                            <div className="flex items-center justify-between border-b border-border/30 px-5 py-4">
                                <div>
                                    <h3 className="font-semibold text-foreground">Trade Log</h3>
                                    <p className="text-xs text-muted-foreground mt-0.5">{copiedTrades.length} trades copied in total</p>
                                </div>
                                <span className={`rounded-full border px-3 py-1 text-xs font-medium ${openCopiedTrades.length > 0 ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-400" : "border-border/30 text-muted-foreground"}`}>
                                    {openCopiedTrades.length} open
                                </span>
                            </div>

                            <div className="overflow-x-auto">
                                <table className="w-full min-w-[700px] text-sm">
                                    <thead>
                                        <tr className="border-b border-border/30 text-xs uppercase tracking-wider text-muted-foreground">
                                            <th className="px-5 py-3 text-left">Symbol</th>
                                            <th className="px-5 py-3 text-left">Type</th>
                                            <th className="px-5 py-3 text-left">Volume</th>
                                            <th className="px-5 py-3 text-left">Open Price</th>
                                            <th className="px-5 py-3 text-left">Profit</th>
                                            <th className="px-5 py-3 text-left">Status</th>
                                            <th className="px-5 py-3 text-left">Opened</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {copiedTrades.slice(0, 50).map((trade) => (
                                            <tr key={trade.ticket} className="border-b border-border/10 last:border-0">
                                                <td className="px-5 py-3.5 font-semibold text-foreground">{trade.symbol}</td>
                                                <td className="px-5 py-3.5">
                                                    <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold ${trade.type === "BUY" ? "bg-emerald-500/10 text-emerald-400" : "bg-red-500/10 text-red-400"}`}>
                                                        {trade.type === "BUY" ? <ArrowUp size={11} /> : <ArrowDown size={11} />}
                                                        {trade.type}
                                                    </span>
                                                </td>
                                                <td className="px-5 py-3.5 text-muted-foreground">{Number(trade.volume || 0).toFixed(2)}</td>
                                                <td className="px-5 py-3.5 text-muted-foreground">{trade.openPrice}</td>
                                                <td className={`px-5 py-3.5 font-semibold tabular-nums ${(trade.status === "closed" ? trade.profit || 0 : trade.currentProfit) >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                                                    {(() => {
                                                        const p = trade.status === "closed" ? trade.profit || 0 : trade.currentProfit;
                                                        return `${p >= 0 ? "+" : ""}${formatMoney(p)}`;
                                                    })()}
                                                </td>
                                                <td className="px-5 py-3.5">
                                                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${trade.status === "open" ? "bg-emerald-500/10 text-emerald-400" : "bg-border text-muted-foreground"}`}>
                                                        {trade.status === "open" ? "OPEN" : "CLOSED"}
                                                    </span>
                                                </td>
                                                <td className="px-5 py-3.5 text-xs text-muted-foreground">
                                                    {trade.openedAt ? new Date(trade.openedAt).toLocaleString() : "—"}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    </div>
                )}

                {/* How It Works */}
                {followerConfigs.length === 0 && (
                    <div className="mt-10 rounded-2xl border border-border/30 bg-muted p-8">
                        <div className="flex items-center gap-2 mb-5">
                            <Info size={16} className="text-violet-400" />
                            <h2 className="font-bold text-foreground">How Copy Trading Works</h2>
                        </div>

                        <div className="grid gap-4 sm:grid-cols-3">
                            {[
                                {
                                    step: "1",
                                    icon: Bot,
                                    color: "text-violet-400",
                                    bg: "bg-violet-500/10",
                                    title: "Choose a Master",
                                    desc: "Select a live EA account from the grid above. Masters are real accounts sending heartbeats from MT5.",
                                },
                                {
                                    step: "2",
                                    icon: Sliders,
                                    color: "text-blue-400",
                                    bg: "bg-blue-500/10",
                                    title: "Configure Risk",
                                    desc: "Set your lot multiplier, max lot size, and max open trades. Optionally reverse signals or disable SL/TP copying.",
                                },
                                {
                                    step: "3",
                                    icon: Zap,
                                    color: "text-emerald-400",
                                    bg: "bg-emerald-500/10",
                                    title: "Trades Mirror Live",
                                    desc: "When the master EA opens or closes a trade, the signal is automatically sent to your MT5 account via the EA.",
                                },
                            ].map((item) => (
                                <div key={item.step} className="rounded-xl border border-border/30 bg-background/70 p-4">
                                    <div className={`flex h-9 w-9 items-center justify-center rounded-xl ${item.bg} mb-3`}>
                                        <item.icon size={18} className={item.color} />
                                    </div>
                                    <p className="font-bold text-foreground text-sm">{item.title}</p>
                                    <p className="mt-1.5 text-xs text-muted-foreground leading-5">{item.desc}</p>
                                </div>
                            ))}
                        </div>

                        <div className="mt-6 rounded-xl border border-amber-500/20 bg-amber-500/[0.06] p-4 text-xs text-amber-200/80 leading-5">
                            <strong>Note:</strong> Copy trading requires the AlgoVault EA running on your follower MT5 account with the server URL configured correctly. The EA polls for pending orders via the heartbeat endpoint and executes them automatically.
                        </div>
                    </div>
                )}
            </div>

            {/* ── Setup Modal ────────────────────────────────────────────────── */}
            {showSetupModal && (
                <div
                    className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/80 backdrop-blur-sm p-4"
                    onClick={(e) => e.target === e.currentTarget && setShowSetupModal(false)}
                >
                    <div className="w-full max-w-md rounded-2xl border border-border/30 bg-background p-6 shadow-2xl">
                        {/* Modal header */}
                        <div className="flex items-center justify-between mb-6">
                            <div>
                                <h2 className="font-bold text-foreground">Setup Follower Account</h2>
                                {setupMaster && (
                                    <p className="text-xs text-muted-foreground mt-0.5">
                                        Copying: {setupMaster.productName || "Master"} (#{setupMaster.mt5Account})
                                    </p>
                                )}
                            </div>
                            <button
                                type="button"
                                onClick={() => setShowSetupModal(false)}
                                className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted/10 hover:text-foreground"
                            >
                                <X size={18} />
                            </button>
                        </div>

                        <div className="space-y-4">
                            {/* Follower MT5 account */}
                            <div>
                                <label className="block text-xs font-medium text-muted-foreground mb-1.5">
                                    Your MT5 Account Number *
                                </label>
                                <input
                                    type="text"
                                    placeholder="e.g. 12345678"
                                    value={setupForm.followerMt5Account}
                                    onChange={(e) => setSetupForm((f) => ({ ...f, followerMt5Account: e.target.value }))}
                                    className="w-full rounded-xl border border-border/30 bg-background/950 px-3.5 py-2.5 text-sm text-foreground font-mono placeholder:text-muted-foreground/50 focus:border-violet-500 focus:outline-none"
                                />
                            </div>

                            {/* License key */}
                            {licenses.length > 0 && (
                                <div>
                                    <label className="block text-xs font-medium text-muted-foreground mb-1.5">
                                        License (for your EA)
                                    </label>
                                    <select
                                        value={setupForm.licenseKey}
                                        onChange={(e) => setSetupForm((f) => ({ ...f, licenseKey: e.target.value }))}
                                        className="w-full rounded-xl border border-border/30 bg-background/950 px-3.5 py-2.5 text-sm text-foreground focus:border-violet-500 focus:outline-none"
                                    >
                                        <option value="">None</option>
                                        {licenses.map((l) => (
                                            <option key={l.id} value={l.licenseKey}>
                                                {l.productName || l.productId} — #{l.mt5Account}
                                            </option>
                                        ))}
                                    </select>
                                </div>
                            )}

                            {/* Lot settings */}
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="block text-xs font-medium text-muted-foreground mb-1.5">Lot Multiplier</label>
                                    <input
                                        type="number"
                                        min="0.01"
                                        step="0.01"
                                        placeholder="1.0"
                                        value={setupForm.lotMultiplier}
                                        onChange={(e) => setSetupForm((f) => ({ ...f, lotMultiplier: e.target.value }))}
                                        className="w-full rounded-xl border border-border/30 bg-background/950 px-3.5 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/50 focus:border-violet-500 focus:outline-none"
                                    />
                                    <p className="text-[11px] text-muted-foreground mt-1">1.0 = same as master</p>
                                </div>
                                <div>
                                    <label className="block text-xs font-medium text-muted-foreground mb-1.5">Max Lot Size</label>
                                    <input
                                        type="number"
                                        min="0.01"
                                        step="0.01"
                                        placeholder="0.10"
                                        value={setupForm.maxLot}
                                        onChange={(e) => setSetupForm((f) => ({ ...f, maxLot: e.target.value }))}
                                        className="w-full rounded-xl border border-border/30 bg-background/950 px-3.5 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/50 focus:border-violet-500 focus:outline-none"
                                    />
                                </div>
                            </div>

                            <div>
                                <label className="block text-xs font-medium text-muted-foreground mb-1.5">Max Open Trades</label>
                                <input
                                    type="number"
                                    min="1"
                                    step="1"
                                    placeholder="5"
                                    value={setupForm.maxOpenTrades}
                                    onChange={(e) => setSetupForm((f) => ({ ...f, maxOpenTrades: e.target.value }))}
                                    className="w-full rounded-xl border border-border/30 bg-background/950 px-3.5 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/50 focus:border-violet-500 focus:outline-none"
                                />
                            </div>

                            {/* Toggles */}
                            <div className="space-y-2.5">
                                {[
                                { key: "reverseSignals", label: "Reverse signals (BUY → SELL)" },
                                { key: "copyStopLoss", label: "Copy Stop Loss" },
                                { key: "copyTakeProfit", label: "Copy Take Profit" },
                            ].map(({ key, label }) => {
                                const toggleKey = key as keyof typeof setupForm;
                                return (
                                    <label key={key} className="flex cursor-pointer items-center justify-between rounded-xl border border-border/30 bg-background/70 px-4 py-3">
                                        <span className="text-sm text-muted-foreground">{label}</span>
                                        <div
                                            className={`relative h-5 w-9 rounded-full transition ${
                                                setupForm[toggleKey]
                                                    ? key === "reverseSignals"
                                                        ? "bg-amber-500"
                                                        : "bg-violet-500"
                                                    : "bg-muted/50"
                                            }`}
                                            onClick={() => setSetupForm((f) => ({ ...f, [key]: !f[toggleKey] }))}
                                        >
                                            <div className={`absolute top-0.5 h-4 w-4 rounded-full bg-background shadow transition-transform ${setupForm[toggleKey] ? "translate-x-4" : "translate-x-0.5"}`} />
                                        </div>
                                    </label>
                                );
                            })}
                            </div>

                            {/* Review before starting */}
                            <div className="rounded-xl border border-violet-500/20 bg-violet-500/[0.05] p-4">
                                <div className="flex items-center gap-1.5 mb-3">
                                    <Info size={13} className="text-violet-400" />
                                    <p className="text-xs font-semibold text-foreground">Copy Trading Summary</p>
                                </div>
                                <div className="space-y-2 text-xs">
                                    <div className="flex items-center justify-between gap-2">
                                        <span className="text-muted-foreground">Master account</span>
                                        <span className="text-muted-foreground text-right">{setupMaster?.productName || "Master"} (#{setupMaster?.mt5Account})</span>
                                    </div>
                                    <div className="flex items-center justify-between gap-2">
                                        <span className="text-muted-foreground">Win rate</span>
                                        <span className={`font-semibold ${setupMaster?.stats?.winRate != null ? (setupMaster.stats.winRate >= 50 ? "text-emerald-400" : "text-red-400") : "text-muted-foreground"}`}>
                                            {setupMaster?.stats?.winRate != null ? `${Number(setupMaster.stats.winRate).toFixed(1)}%` : "—"}
                                        </span>
                                    </div>
                                    <div className="flex items-center justify-between gap-2">
                                        <span className="text-muted-foreground">Master P/L</span>
                                        <span className={`font-semibold ${setupMaster?.stats?.totalProfit != null ? (setupMaster.stats.totalProfit >= 0 ? "text-emerald-400" : "text-red-400") : "text-muted-foreground"}`}>
                                            {setupMaster?.stats?.totalProfit != null ? `${setupMaster.stats.totalProfit >= 0 ? "+" : ""}${formatMoney(setupMaster.stats.totalProfit)}` : "—"}
                                        </span>
                                    </div>
                                    <div className="flex items-center justify-between gap-2">
                                        <span className="text-muted-foreground">Lot multiplier</span>
                                        <span className="text-muted-foreground font-semibold">×{setupForm.lotMultiplier}</span>
                                    </div>
                                    <div className="flex items-center justify-between gap-2">
                                        <span className="text-muted-foreground">Max lot per trade</span>
                                        <span className="text-muted-foreground font-semibold">{setupForm.maxLot} lots</span>
                                    </div>
                                    <div className="flex items-center justify-between gap-2">
                                        <span className="text-muted-foreground">Max open trades</span>
                                        <span className="text-muted-foreground font-semibold">{setupForm.maxOpenTrades}</span>
                                    </div>
                                    <div className="flex items-center justify-between gap-2">
                                        <span className="text-muted-foreground">Copy settings</span>
                                        <span className="text-muted-foreground font-semibold text-right">
                                            {!setupForm.copyStopLoss && !setupForm.copyTakeProfit
                                                ? "No SL/TP"
                                                : [setupForm.copyStopLoss && "SL", setupForm.copyTakeProfit && "TP"].filter(Boolean).join(" + ")}
                                            {setupForm.reverseSignals && " · Reversed"}
                                        </span>
                                    </div>
                                </div>
                            </div>

                            {setupError && (
                                <div className="rounded-xl border border-red-500/20 bg-red-500/[0.08] p-3 text-xs text-red-300">
                                    {setupError}
                                </div>
                            )}

                            <button
                                type="button"
                                onClick={saveFollowerConfig}
                                disabled={savingSetup}
                                className="w-full flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-violet-600 to-blue-600 py-3 text-sm font-bold text-foreground transition hover:from-violet-500 hover:to-blue-500 disabled:opacity-50"
                            >
                                {savingSetup ? (
                                    <>
                                        <Loader2 size={15} className="animate-spin" />
                                        Saving...
                                    </>
                                ) : (
                                    <>
                                        <CheckCircle2 size={15} />
                                        Start Copying
                                    </>
                                )}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </main>
    );
}
