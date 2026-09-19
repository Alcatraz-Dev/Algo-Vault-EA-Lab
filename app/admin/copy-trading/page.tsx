"use client";

import { useCallback, useEffect, useState } from "react";
import {
    Ban,
    Copy,
    Eye,
    EyeOff,
    Pause,
    Play,
    RefreshCw,
    Shield,
    X,
} from "lucide-react";
import { onAuthStateChanged } from "firebase/auth";
import { onValue, ref } from "firebase/database";
import { auth, database } from "@/lib/firebase";
import AdminShell from "@/components/admin/AdminShell";

function formatMoney(v: number) {
    try { return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(v); }
    catch { return `$${v.toFixed(2)}`; }
}

type CopyConfig = {
    id: string;
    userId: string;
    userEmail?: string;
    masterId: string;
    masterMt5Account: string | number;
    followerMt5Account: string | number;
    isActive: boolean;
    lotMultiplier: number;
    maxLot: number;
    maxOpenTrades: number;
    reverseSignals: boolean;
    copyStopLoss: boolean;
    copyTakeProfit: boolean;
    createdAt?: number;
    totalCopied?: number;
    totalProfit?: number;
};

type CopiedTradeLike = {
    copyConfigId?: unknown;
    status?: unknown;
    profit?: unknown;
    closedAt?: unknown;
    openedAt?: unknown;
};

type LiveAccountLike = {
    id?: string;
    ownerUid?: string | null;
    productName?: string | null;
    lastHeartbeatAt?: unknown;
    mt5Account?: unknown;
    allowCopyTrading?: boolean;
    online?: boolean;
    eligibility?: {
        allowBeCopied?: boolean;
        allowBeFollowed?: boolean;
        isBeingCopiedDisabled?: boolean;
        canBeListed?: boolean;
    };
};

export default function AdminCopyTradingPage() {
    const [configs, setConfigs] = useState<CopyConfig[]>([]);
    const [loading, setLoading] = useState(true);
    const [actionId, setActionId] = useState<string | null>(null);
    const [liveAccounts, setLiveAccounts] = useState<Record<string, LiveAccountLike>>({});
    const [copiedByOwner, setCopiedByOwner] = useState<Record<string, Record<string, CopiedTradeLike>>>({});
    const [now, setNow] = useState(0);
    const [userToken, setUserToken] = useState("");
    const [globalEnabled, setGlobalEnabled] = useState(true);
    const [adminAccounts, setAdminAccounts] = useState<LiveAccountLike[]>([]);
    const [errorMessage, setErrorMessage] = useState("");

    useEffect(() => {
        const t = setTimeout(() => setNow(Date.now()), 0);
        const id = setInterval(() => setNow(Date.now()), 30_000);
        return () => {
            clearTimeout(t);
            clearInterval(id);
        };
    }, []);

    const loadAdminOverview = useCallback(async (token = userToken) => {
        if (!token) return;
        try {
            const res = await fetch("/api/admin/copy-trading", {
                headers: { Authorization: `Bearer ${token}` },
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data?.error || "Failed to load copy trading overview.");
            setGlobalEnabled(data.enabled !== false);
            setAdminAccounts(data.accounts || []);
            const accountMap: Record<string, LiveAccountLike> = {};
            for (const account of data.accounts || []) {
                accountMap[account.id] = account;
            }
            setLiveAccounts(accountMap);
            setErrorMessage("");
        } catch (err: unknown) {
            setErrorMessage(err instanceof Error ? err.message : "Failed to load copy trading overview.");
        }
    }, [userToken]);

    useEffect(() => {
        return onValue(ref(database, "copied_trades"), (snap) => {
            setCopiedByOwner(snap.val() || {});
        });
    }, []);

    useEffect(() => {
        return onAuthStateChanged(auth, (user) => {
            if (!user) { setLoading(false); return; }
            user.getIdToken().then((token) => {
                setUserToken(token);
                void loadAdminOverview(token);
            });
            const copyRef = ref(database, "copy_trading");
            return onValue(copyRef, (snap) => {
                const data = snap.val() || {};
                const list: CopyConfig[] = [];
                for (const [userId, userConfigs] of Object.entries(data as Record<string, Record<string, CopyConfig>>)) {
                    for (const [id, cfg] of Object.entries(userConfigs)) {
                        list.push({ ...cfg, id, userId });
                    }
                }
                list.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
                setConfigs(list);
                setLoading(false);
            });
        });
    }, [loadAdminOverview]);

    async function toggleConfig(cfg: CopyConfig) {
        setActionId(cfg.id);
        try {
            const res = await fetch("/api/copy-trading/config", {
                method: "PATCH",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${userToken}`,
                },
                body: JSON.stringify({
                    userId: cfg.userId,
                    configId: cfg.id,
                    isActive: !cfg.isActive,
                }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data?.error || "Failed to update configuration.");
        } catch (err: unknown) {
            setErrorMessage(err instanceof Error ? err.message : "Failed to update configuration.");
        } finally { setActionId(null); }
    }

    async function deleteConfig(cfg: CopyConfig) {
        if (!confirm("Delete this copy config?")) return;
        setActionId(cfg.id);
        try {
            const res = await fetch("/api/copy-trading/config", {
                method: "DELETE",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${userToken}`,
                },
                body: JSON.stringify({
                    userId: cfg.userId,
                    configId: cfg.id,
                }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data?.error || "Failed to delete configuration.");
            void loadAdminOverview();
        } catch (err: unknown) {
            setErrorMessage(err instanceof Error ? err.message : "Failed to delete configuration.");
        } finally { setActionId(null); }
    }

    async function patchAdminCopyTrading(body: Record<string, unknown>, id = "admin") {
        setActionId(id);
        try {
            const res = await fetch("/api/admin/copy-trading", {
                method: "PATCH",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${userToken}`,
                },
                body: JSON.stringify(body),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data?.error || "Failed to update copy trading controls.");
            await loadAdminOverview();
        } catch (err: unknown) {
            setErrorMessage(err instanceof Error ? err.message : "Failed to update copy trading controls.");
        } finally {
            setActionId(null);
        }
    }

    const active = configs.filter(c => c.isActive).length;
    const totalCopied = configs.reduce((s, c) => s + (c.totalCopied || 0), 0);

    function configTrades(cfg: CopyConfig): CopiedTradeLike[] {
        const ownerTrades = copiedByOwner[cfg.userId] || {};
        return Object.values(ownerTrades).filter((t) => String(t.copyConfigId ?? "") === String(cfg.id));
    }

    function configStats(cfg: CopyConfig) {
        const trades = configTrades(cfg);
        const open = trades.filter((t) => String(t.status ?? "") === "open").length;
        const closed = trades.filter((t) => String(t.status ?? "") === "closed");
        const realized = closed.reduce((s, t) => s + Number(t.profit ?? 0), 0);
        const last = trades.reduce((m, t) => Math.max(m, Number(t.closedAt || t.openedAt || 0)), 0);
        return { total: trades.length, open, closed: closed.length, realized, last };
    }

    function masterHealth(cfg: CopyConfig) {
        const acct =
            liveAccounts[cfg.masterId] ||
            Object.values(liveAccounts).find((a) => String(a.mt5Account ?? "") === String(cfg.masterMt5Account));
        const last = Number(acct?.lastHeartbeatAt || 0);
        const online = now > 0 && last > 0 && now - last < 60_000;
        let label = "No heartbeats";
        if (last > 0) {
            label = online ? "Online" : `Seen ${Math.floor((now - last) / 1000)}s ago`;
        }
        return { online, lastHeartbeatAt: last, label };
    }

    const realizedTotal = configs.reduce((s, cfg) => s + configStats(cfg).realized, 0);

    return (
        <AdminShell title="Copy Trading Configurations" subtitle="Monitor active follower-master account copy trade rules">
            <div className="mb-2"></div>
                        {errorMessage && (
                            <div className="mb-4 rounded-xl border border-red-500/20 bg-red-500/10 p-4 text-sm text-red-600">
                                {errorMessage}
                            </div>
                        )}
                        <div className="mb-6 rounded-2xl border border-border bg-muted/30 p-5">
                            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                                <div>
                                    <p className="text-sm font-semibold text-foreground">Global Copy Trading</p>
                                    <p className="mt-1 text-xs text-muted-foreground">
                                        Controls marketplace discovery, new follower configs, and master signal fan-out.
                                    </p>
                                </div>
                                <button
                                    type="button"
                                    onClick={() => patchAdminCopyTrading({ global: !globalEnabled }, "global")}
                                    disabled={actionId === "global"}
                                    className={`inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition disabled:opacity-50 ${
                                        globalEnabled
                                            ? "bg-emerald-600 text-foreground hover:bg-emerald-500"
                                            : "border border-border bg-muted text-foreground hover:bg-muted/70"
                                    }`}
                                >
                                    {actionId === "global" ? <RefreshCw size={15} className="animate-spin" /> : <Shield size={15} />}
                                    {globalEnabled ? "Enabled" : "Disabled"}
                                </button>
                            </div>
                        </div>
                        {/* Summary */}
                        <div className="grid gap-4 sm:grid-cols-4 mb-8">
                            {[
                                { label: "Total Configs", value: String(configs.length) },
                                { label: "Active", value: String(active) },
                                { label: "Total Copied Trades", value: String(totalCopied) },
                                { label: "Realized P/L", value: formatMoney(realizedTotal) },
                            ].map(({ label, value }) => (
                                <div key={label} className="rounded-2xl border border-border bg-muted/40 p-5">
                                    <p className="text-sm text-muted-foreground">{label}</p>
                                    <p className="mt-2 text-2xl font-bold">{value}</p>
                                </div>
                            ))}
                        </div>

                        {adminAccounts.length > 0 && (
                            <div className="mb-8 rounded-2xl border border-border bg-muted/30 overflow-hidden">
                                <div className="border-b border-border px-5 py-4">
                                    <p className="text-sm font-semibold text-foreground">Master Account Controls</p>
                                    <p className="mt-1 text-xs text-muted-foreground">Hide accounts from discovery or block copying without deleting follower configs.</p>
                                </div>
                                <div className="overflow-x-auto">
                                    <table className="w-full min-w-[760px] text-sm">
                                        <thead>
                                            <tr className="border-b border-border text-xs uppercase tracking-wider text-muted-foreground">
                                                <th className="px-5 py-3 text-left">Master</th>
                                                <th className="px-5 py-3 text-left">Owner</th>
                                                <th className="px-5 py-3 text-left">State</th>
                                                <th className="px-5 py-3 text-right">Controls</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {adminAccounts.slice(0, 8).map((account) => {
                                                const eligibility = account.eligibility || {};
                                                const hidden = eligibility.allowBeFollowed === false || eligibility.canBeListed === false;
                                                const blocked = eligibility.allowBeCopied === false || eligibility.isBeingCopiedDisabled === true;
                                                return (
                                                    <tr key={String(account.id)} className="border-b border-border/60 last:border-0">
                                                        <td className="px-5 py-4">
                                                            <p className="font-medium text-foreground">{account.productName || "Master Account"}</p>
                                                            <p className="font-mono text-xs text-muted-foreground">#{String(account.mt5Account || "Unknown")}</p>
                                                        </td>
                                                        <td className="px-5 py-4 text-xs text-muted-foreground">
                                                            {account.ownerUid ? `${account.ownerUid.slice(0, 8)}…` : "Unknown"}
                                                        </td>
                                                        <td className="px-5 py-4">
                                                            <div className="flex flex-wrap gap-2">
                                                                <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${account.online ? "bg-emerald-500/10 text-emerald-600" : "bg-muted text-muted-foreground"}`}>
                                                                    {account.online ? "Online" : "Offline"}
                                                                </span>
                                                                <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${hidden ? "bg-amber-500/10 text-amber-600" : "bg-emerald-500/10 text-emerald-600"}`}>
                                                                    {hidden ? "Hidden" : "Listed"}
                                                                </span>
                                                                <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${blocked ? "bg-red-500/10 text-red-500" : "bg-emerald-500/10 text-emerald-600"}`}>
                                                                    {blocked ? "Blocked" : "Copy allowed"}
                                                                </span>
                                                            </div>
                                                        </td>
                                                        <td className="px-5 py-4">
                                                            <div className="flex justify-end gap-2">
                                                                <button
                                                                    type="button"
                                                                    onClick={() => patchAdminCopyTrading({
                                                                        accountId: account.id,
                                                                        allowBeFollowed: hidden,
                                                                        canBeListed: hidden,
                                                                    }, String(account.id))}
                                                                    disabled={actionId === account.id}
                                                                    className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted disabled:opacity-50"
                                                                >
                                                                    {hidden ? <Eye size={13} /> : <EyeOff size={13} />}
                                                                    {hidden ? "List" : "Hide"}
                                                                </button>
                                                                <button
                                                                    type="button"
                                                                    onClick={() => patchAdminCopyTrading({
                                                                        accountId: account.id,
                                                                        allowBeCopied: blocked,
                                                                        isBeingCopiedDisabled: !blocked,
                                                                    }, `${account.id}_block`)}
                                                                    disabled={actionId === `${account.id}_block`}
                                                                    className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted disabled:opacity-50"
                                                                >
                                                                    <Ban size={13} />
                                                                    {blocked ? "Unblock" : "Block"}
                                                                </button>
                                                            </div>
                                                        </td>
                                                    </tr>
                                                );
                                            })}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        )}

                        {loading ? (
                            <div className="flex items-center justify-center py-20">
                                <RefreshCw className="h-7 w-7 animate-spin text-muted-foreground" />
                            </div>
                        ) : configs.length === 0 ? (
                            <div className="rounded-2xl border border-dashed border-border p-16 text-center">
                                <Copy className="mx-auto h-10 w-10 text-muted-foreground mb-3" />
                                <p className="text-muted-foreground">No copy trading configurations yet.</p>
                            </div>
                        ) : (
                            <div className="rounded-2xl border border-border bg-muted/30 overflow-hidden">
                                <div className="overflow-x-auto">
                                    <table className="w-full min-w-[800px] text-sm">
                                        <thead>
                                            <tr className="border-b border-border text-xs uppercase tracking-wider text-muted-foreground">
                                                <th className="px-5 py-4 text-left">Status</th>
                                                <th className="px-5 py-4 text-left">Follower</th>
                                                <th className="px-5 py-4 text-left">Master</th>
                                                <th className="px-5 py-4 text-left">Settings</th>
                                                <th className="px-5 py-4 text-left">Copied</th>
                                                <th className="px-5 py-4 text-left">P/L</th>
                                                <th className="px-5 py-4 text-left">Last Activity</th>
                                                <th className="px-5 py-4 text-right">Actions</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {configs.map((cfg) => {
                                                const stats = configStats(cfg);
                                                const health = masterHealth(cfg);
                                                return (
                                                <tr key={`${cfg.userId}_${cfg.id}`} className="border-b border-border/60 last:border-0 hover:bg-muted/30">
                                                    <td className="px-5 py-4">
                                                        <span className={`rounded-full border px-2.5 py-1 text-xs font-medium ${cfg.isActive ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-600" : "border-border bg-muted/50 text-muted-foreground"}`}>
                                                            {cfg.isActive ? "Active" : "Paused"}
                                                        </span>
                                                    </td>
                                                    <td className="px-5 py-4">
                                                        <p className="font-mono text-foreground">#{cfg.followerMt5Account}</p>
                                                        <p className="text-xs text-muted-foreground">User: {cfg.userId.slice(0, 8)}…</p>
                                                    </td>
                                                    <td className="px-5 py-4">
                                                        <div className="flex items-center gap-2">
                                                            <span className={`h-2 w-2 rounded-full ${health.online ? "bg-emerald-500" : "bg-muted"}`} />
                                                            <span className="font-mono text-muted-foreground">#{cfg.masterMt5Account}</span>
                                                        </div>
                                                        <p className="text-xs text-muted-foreground">{health.label}</p>
                                                    </td>
                                                    <td className="px-5 py-4 text-muted-foreground text-xs space-y-0.5">
                                                        <p>Lot ×{cfg.lotMultiplier} · Max {cfg.maxLot}</p>
                                                        <p>
                                                            {cfg.reverseSignals && "Reversed · "}
                                                            {cfg.copyStopLoss && "SL "}
                                                            {cfg.copyTakeProfit && "TP"}
                                                        </p>
                                                    </td>
                                                    <td className="px-5 py-4 text-muted-foreground">
                                                        <p>{cfg.totalCopied || 0} total</p>
                                                        <p className="text-xs">
                                                            <span className="text-emerald-600">{stats.open} open</span>
                                                            {" · "}
                                                            <span>{stats.closed} closed</span>
                                                        </p>
                                                    </td>
                                                    <td className="px-5 py-4">
                                                        <p className={`font-semibold tabular-nums ${stats.realized >= 0 ? "text-emerald-600" : "text-red-500"}`}>
                                                            {formatMoney(stats.realized)}
                                                        </p>
                                                    </td>
                                                    <td className="px-5 py-4 text-xs text-muted-foreground">
                                                        {stats.last ? new Date(stats.last).toLocaleString() : "—"}
                                                    </td>
                                                    <td className="px-5 py-4">
                                                        <div className="flex items-center justify-end gap-2">
                                                            <button
                                                                onClick={() => toggleConfig(cfg)}
                                                                disabled={actionId === cfg.id}
                                                                className={`rounded-lg border px-2.5 py-1.5 text-xs font-medium transition ${cfg.isActive ? "border-amber-500/20 bg-amber-500/10 text-amber-600 hover:bg-amber-500/20" : "border-emerald-500/20 bg-emerald-500/10 text-emerald-600 hover:bg-emerald-500/20"}`}
                                                            >
                                                                {cfg.isActive ? <Pause size={12} /> : <Play size={12} />}
                                                            </button>
                                                            <button
                                                                onClick={() => deleteConfig(cfg)}
                                                                disabled={actionId === cfg.id}
                                                                className="rounded-lg border border-red-500/20 bg-red-500/10 p-1.5 text-red-500 hover:bg-red-500/20 transition"
                                                            >
                                                                <X size={12} />
                                                            </button>
                                                        </div>
                                                    </td>
                                                </tr>
                                                );
                                            })}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        )}
        </AdminShell>
    );
}
