"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Activity, AlertCircle, Copy, Loader2, Radio, SlidersHorizontal, Users } from "lucide-react";
import { onAuthStateChanged, User } from "firebase/auth";
import { onValue, ref } from "firebase/database";
import AccountShell from "@/components/account/AccountShell";
import { auth, database } from "@/lib/firebase";

type LiveAccount = {
    id: string;
    ownerUid?: string;
    userId?: string;
    productName?: string;
    mt5Account?: string | number;
    broker?: string;
    server?: string;
    balance?: number;
    equity?: number;
    floatingProfit?: number;
    drawdown?: number;
    allowCopyTrading?: boolean;
    lastHeartbeatAt?: number;
    copyTradingOverride?: {
        allowBeCopied?: boolean;
        allowBeFollowed?: boolean;
        isBeingCopiedDisabled?: boolean;
        canBeListed?: boolean;
    };
    eligibility?: {
        allowCopyTrading: boolean;
        allowBeCopied: boolean;
        allowBeFollowed: boolean;
        isFollowingDisabled: boolean;
        isBeingCopiedDisabled: boolean;
        canBeListed: boolean;
    };
    followerCount?: number;
    stats?: {
        winRate?: number;
        profitFactor?: number;
        totalTrades?: number;
        totalProfit?: number;
    };
};

type CopyConfig = {
    id: string;
    ownerUid: string;
    masterId?: string;
    masterMt5Account?: string | number;
    followerMt5Account?: string | number;
    isActive?: boolean;
    totalCopied?: number;
    totalProfit?: number;
    updatedAt?: number;
};

function formatMoney(value?: number) {
    const num = Number(value || 0);
    try {
        return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(num);
    } catch {
        return `$${num.toFixed(2)}`;
    }
}

function timeAgo(ms?: number) {
    if (!ms) return "No heartbeat";
    const diff = Math.max(0, Date.now() - ms);
    if (diff < 60_000) return "Live now";
    if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
    if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
    return `${Math.floor(diff / 86_400_000)}d ago`;
}

function resolveStatus(account: LiveAccount) {
    const online = Boolean(account.lastHeartbeatAt && Date.now() - Number(account.lastHeartbeatAt) < 60_000);
    const override = account.copyTradingOverride || {};

    if (!online) return { label: "Offline", tone: "muted" };
    if (override.isBeingCopiedDisabled || override.allowBeCopied === false) {
        return { label: "Admin restricted", tone: "danger" };
    }
    if (override.allowBeFollowed === false || override.canBeListed === false) {
        return { label: "Hidden", tone: "warning" };
    }
    if (account.allowCopyTrading) return { label: "Listed", tone: "success" };
    return { label: "Opted out", tone: "muted" };
}

export default function AccountCopyTradingPage() {
    const [user, setUser] = useState<User | null>(null);
    const [loading, setLoading] = useState(true);
    const [accounts, setAccounts] = useState<LiveAccount[]>([]);
    const [configs, setConfigs] = useState<CopyConfig[]>([]);
    const [savingId, setSavingId] = useState<string | null>(null);
    const [copyTradingEnabled, setCopyTradingEnabled] = useState(true);
    const [errorMessage, setErrorMessage] = useState("");

    useEffect(() => {
        return onAuthStateChanged(auth, (currentUser) => {
            setUser(currentUser);
            setLoading(false);
        });
    }, []);

    const loadMasterAccounts = useCallback(async (currentUser = user) => {
        if (!currentUser) return;
        try {
            const token = await currentUser.getIdToken();
            const res = await fetch("/api/copy-trading/master", {
                headers: { Authorization: `Bearer ${token}` },
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data?.error || "Failed to load master accounts.");
            setAccounts(data.accounts || []);
            setCopyTradingEnabled(data.enabled !== false);
            setErrorMessage("");
        } catch (err: unknown) {
            setErrorMessage(err instanceof Error ? err.message : "Failed to load master accounts.");
            setAccounts([]);
        }
    }, [user]);

    useEffect(() => {
        const timeout = setTimeout(() => {
            void loadMasterAccounts(user);
        }, 0);
        return () => clearTimeout(timeout);
    }, [loadMasterAccounts, user]);

    useEffect(() => {
        return onValue(ref(database, "copy_trading"), (snap) => {
            const data = snap.val() || {};
            const list: CopyConfig[] = [];
            for (const [ownerUid, userConfigs] of Object.entries(data as Record<string, Record<string, Partial<CopyConfig>>>)) {
                for (const [id, cfg] of Object.entries(userConfigs || {})) {
                    list.push({ id, ownerUid, ...cfg });
                }
            }
            setConfigs(list);
        });
    }, []);

    const metrics = useMemo(() => {
        const accountIds = new Set(accounts.map((account) => String(account.id)));
        const mt5Accounts = new Set(accounts.map((account) => String(account.mt5Account || "")));
        const followers = configs.filter((cfg) => {
            const masterKey = String(cfg.masterId || "");
            const masterMt5 = String(cfg.masterMt5Account || "");
            return accountIds.has(masterKey) || mt5Accounts.has(masterMt5);
        });
        return {
            activeFollowers: followers.filter((cfg) => cfg.isActive !== false).length,
            pausedFollowers: followers.filter((cfg) => cfg.isActive === false).length,
            totalCopied: followers.reduce((sum, cfg) => sum + Number(cfg.totalCopied || 0), 0),
            totalProfit: followers.reduce((sum, cfg) => sum + Number(cfg.totalProfit || 0), 0),
            followers,
        };
    }, [accounts, configs]);

    async function toggleAllowCopyTrading(account: LiveAccount) {
        setSavingId(account.id);
        try {
            if (!user) return;
            const token = await user.getIdToken();
            const res = await fetch("/api/copy-trading/master", {
                method: "PATCH",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify({
                    accountId: account.id,
                    allowCopyTrading: !account.allowCopyTrading,
                }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data?.error || "Failed to update copy trading status.");
            setAccounts((items) =>
                items.map((item) =>
                    item.id === account.id
                        ? { ...item, allowCopyTrading: !account.allowCopyTrading, eligibility: data.eligibility || item.eligibility }
                        : item
                )
            );
            setErrorMessage("");
            await loadMasterAccounts(user);
        } catch (err: unknown) {
            setErrorMessage(err instanceof Error ? err.message : "Failed to update copy trading status.");
        } finally {
            setSavingId(null);
        }
    }

    if (loading) {
        return (
            <AccountShell title="Master Copy Trading" subtitle="Manage your marketplace visibility and follower activity">
                <div className="flex min-h-[40vh] items-center justify-center">
                    <Loader2 className="h-7 w-7 animate-spin text-muted-foreground" />
                </div>
            </AccountShell>
        );
    }

    return (
        <AccountShell title="Master Copy Trading" subtitle="Control which of your live MT5 accounts can be copied">
            <div className="mx-auto max-w-6xl space-y-6" data-guide="page-header">
                {!copyTradingEnabled && (
                    <div className="rounded-xl border border-amber-500/20 bg-amber-500/10 p-4 text-sm text-amber-700 dark:text-amber-300">
                        Copy trading is disabled platform-wide. Master controls are read-only until an admin enables it again.
                    </div>
                )}
                {errorMessage && (
                    <div className="rounded-xl border border-red-500/20 bg-red-500/10 p-4 text-sm text-red-600">
                        {errorMessage}
                    </div>
                )}
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4" data-guide="stats">
                    <div className="rounded-xl border border-border bg-muted/30 p-5">
                        <p className="text-xs text-muted-foreground">Master accounts</p>
                        <p className="mt-2 text-2xl font-bold text-foreground">{accounts.length}</p>
                    </div>
                    <div className="rounded-xl border border-border bg-muted/30 p-5">
                        <p className="text-xs text-muted-foreground">Active followers</p>
                        <p className="mt-2 text-2xl font-bold text-foreground">{metrics.activeFollowers}</p>
                    </div>
                    <div className="rounded-xl border border-border bg-muted/30 p-5">
                        <p className="text-xs text-muted-foreground">Copied trades</p>
                        <p className="mt-2 text-2xl font-bold text-foreground">{metrics.totalCopied}</p>
                    </div>
                    <div className="rounded-xl border border-border bg-muted/30 p-5">
                        <p className="text-xs text-muted-foreground">Follower P/L</p>
                        <p className={`mt-2 text-2xl font-bold ${metrics.totalProfit >= 0 ? "text-emerald-600" : "text-red-500"}`}>
                            {formatMoney(metrics.totalProfit)}
                        </p>
                    </div>
                </div>

                {accounts.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-border bg-muted/20 p-12 text-center">
                        <Radio className="mx-auto h-9 w-9 text-muted-foreground" />
                        <h2 className="mt-4 text-lg font-semibold text-foreground">No live master accounts yet</h2>
                        <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
                            Start the EA on a licensed MT5 account. Once the first heartbeat arrives, the account appears here with copy-trading controls.
                        </p>
                    </div>
                ) : (
                    <div className="space-y-4">
                        {accounts.map((account) => {
                            const status = resolveStatus(account);
                            const accountFollowers = metrics.followers.filter(
                                (cfg) =>
                                    String(cfg.masterId || "") === String(account.id) ||
                                    String(cfg.masterMt5Account || "") === String(account.mt5Account || "")
                            );
                            const disabled =
                                !copyTradingEnabled ||
                                status.label === "Offline" ||
                                status.label === "Admin restricted" ||
                                savingId === account.id;

                            return (
                                <div key={account.id} className="rounded-xl border border-border bg-foreground/[0.035] p-5">
                                    <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
                                        <div className="min-w-0">
                                            <div className="flex flex-wrap items-center gap-2">
                                                <h2 className="text-lg font-semibold text-foreground">
                                                    {account.productName || "Master Account"}
                                                </h2>
                                                <span
                                                    className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${
                                                        status.tone === "success"
                                                            ? "bg-emerald-500/10 text-emerald-600"
                                                            : status.tone === "danger"
                                                              ? "bg-red-500/10 text-red-500"
                                                              : status.tone === "warning"
                                                                ? "bg-amber-500/10 text-amber-500"
                                                                : "bg-muted text-muted-foreground"
                                                    }`}
                                                >
                                                    {status.label}
                                                </span>
                                            </div>
                                            <p className="mt-1 text-xs text-muted-foreground">
                                                MT5 #{account.mt5Account || "Unknown"} · {account.broker || "Broker not set"}
                                                {account.server ? ` · ${account.server}` : ""}
                                            </p>
                                            <p className="mt-1 text-xs text-muted-foreground">Last heartbeat: {timeAgo(account.lastHeartbeatAt)}</p>
                                        </div>

                                        <button
                                            type="button"
                                            onClick={() => toggleAllowCopyTrading(account)}
                                            disabled={disabled}
                                            className={`inline-flex min-w-44 items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 ${
                                                account.allowCopyTrading
                                                    ? "bg-emerald-600 text-foreground hover:bg-emerald-500"
                                                    : "border border-border bg-muted text-foreground hover:bg-muted/70"
                                            }`}
                                        >
                                            {savingId === account.id ? <Loader2 size={15} className="animate-spin" /> : <Copy size={15} />}
                                            {account.allowCopyTrading ? "Allow Copying On" : "Allow Copying Off"}
                                        </button>
                                    </div>

                                    <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                                        <div className="rounded-lg border border-border bg-muted/30 p-3">
                                            <p className="text-[11px] text-muted-foreground">Balance</p>
                                            <p className="mt-1 text-sm font-semibold text-foreground">{formatMoney(account.balance)}</p>
                                        </div>
                                        <div className="rounded-lg border border-border bg-muted/30 p-3">
                                            <p className="text-[11px] text-muted-foreground">Equity</p>
                                            <p className="mt-1 text-sm font-semibold text-foreground">{formatMoney(account.equity)}</p>
                                        </div>
                                        <div className="rounded-lg border border-border bg-muted/30 p-3">
                                            <p className="text-[11px] text-muted-foreground">Drawdown</p>
                                            <p className="mt-1 text-sm font-semibold text-foreground">{Number(account.drawdown || 0).toFixed(2)}%</p>
                                        </div>
                                        <div className="rounded-lg border border-border bg-muted/30 p-3">
                                            <p className="text-[11px] text-muted-foreground">Win rate</p>
                                            <p className="mt-1 text-sm font-semibold text-foreground">
                                                {account.stats?.winRate != null ? `${Number(account.stats.winRate).toFixed(1)}%` : "Pending"}
                                            </p>
                                        </div>
                                        <div className="rounded-lg border border-border bg-muted/30 p-3">
                                            <p className="text-[11px] text-muted-foreground">Followers</p>
                                            <p className="mt-1 text-sm font-semibold text-foreground">{accountFollowers.length}</p>
                                        </div>
                                    </div>

                                    {accountFollowers.length > 0 ? (
                                        <div className="mt-5 overflow-hidden rounded-xl border border-border">
                                            <div className="grid grid-cols-4 gap-3 border-b border-border bg-muted/30 px-4 py-3 text-xs font-semibold text-muted-foreground">
                                                <span>Follower</span>
                                                <span>Status</span>
                                                <span>Copied</span>
                                                <span>P/L</span>
                                            </div>
                                            {accountFollowers.slice(0, 5).map((cfg) => (
                                                <div key={`${cfg.ownerUid}_${cfg.id}`} className="grid grid-cols-4 gap-3 px-4 py-3 text-xs">
                                                    <span className="font-mono text-foreground">#{cfg.followerMt5Account}</span>
                                                    <span className={cfg.isActive === false ? "text-amber-500" : "text-emerald-600"}>
                                                        {cfg.isActive === false ? "Paused" : "Active"}
                                                    </span>
                                                    <span className="text-muted-foreground">{cfg.totalCopied || 0}</span>
                                                    <span className={Number(cfg.totalProfit || 0) >= 0 ? "text-emerald-600" : "text-red-500"}>
                                                        {formatMoney(Number(cfg.totalProfit || 0))}
                                                    </span>
                                                </div>
                                            ))}
                                        </div>
                                    ) : (
                                        <div className="mt-5 flex items-start gap-3 rounded-xl border border-border bg-muted/20 p-4">
                                            <Users className="mt-0.5 h-4 w-4 text-muted-foreground" />
                                            <p className="text-xs leading-5 text-muted-foreground">
                                                No followers yet. Once this account is listed, followers can discover it from the Copy Trading marketplace.
                                            </p>
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                )}

                <div className="rounded-xl border border-border bg-muted/20 p-5">
                    <div className="flex items-start gap-3">
                        <AlertCircle className="mt-0.5 h-5 w-5 text-amber-500" />
                        <div>
                            <h2 className="text-sm font-semibold text-foreground">Listing rules</h2>
                            <p className="mt-1 text-xs leading-5 text-muted-foreground">
                                A master appears in discovery only when it is online, explicitly opted in, not admin restricted, and copy trading is enabled globally.
                            </p>
                            <Link href="/copy-trading" className="mt-3 inline-flex items-center gap-2 text-xs font-semibold text-foreground hover:underline">
                                <Activity size={13} />
                                View follower marketplace
                            </Link>
                        </div>
                    </div>
                </div>

                <div className="rounded-xl border border-border bg-muted/20 p-5">
                    <div className="flex items-start gap-3">
                        <SlidersHorizontal className="mt-0.5 h-5 w-5 text-muted-foreground" />
                        <div>
                            <h2 className="text-sm font-semibold text-foreground">Specification</h2>
                            <p className="mt-1 text-xs leading-5 text-muted-foreground">
                                The copy-trading technical specification is saved in the repository under docs/copy-trading-technical-spec.md.
                            </p>
                        </div>
                    </div>
                </div>
            </div>
        </AccountShell>
    );
}
