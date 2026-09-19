"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { onAuthStateChanged } from "firebase/auth";
import { auth } from "@/lib/firebase";
import AdminShell from "@/components/admin/AdminShell";
import { Database, Search, Eye, Ban, CheckCircle } from "lucide-react";

type TradingAccountItem = {
    userId: string;
    userEmail?: string;
    userName?: string;
    accountId: string;
    mt5Account: string;
    broker: string;
    server: string;
    status: string;
    balance: number;
    equity: number;
    lastHeartbeatAt: number;
    gatewayVersion: string;
};

function formatDate(timestamp: number): string {
    if (!timestamp) return "—";
    return new Date(timestamp).toLocaleString("en-US", {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
    });
}

function formatCurrency(value: number): string {
    return value.toLocaleString("en-US", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    });
}

function formatRelativeTime(timestamp: number): string {
    if (!timestamp) return "Never";
    const diff = Math.floor((Date.now() - timestamp) / 1000);
    if (diff < 5) return "just now";
    if (diff < 60) return `${diff}s ago`;
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    return `${Math.floor(diff / 86400)}d ago`;
}

function StatusBadge({ status }: { status: string }) {
    const s = status.toLowerCase();
    return (
        <span
            className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold border ${
                s === "connected"
                    ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-600"
                    : s === "offline"
                    ? "border-amber-500/30 bg-amber-500/10 text-amber-400"
                    : "border-rose-500/30 bg-rose-500/10 text-rose-400"
            }`}
        >
            {status}
        </span>
    );
}

export default function AdminTradingAccountsPage() {
    const router = useRouter();
    const [accounts, setAccounts] = useState<TradingAccountItem[]>([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState("");
    const [statusFilter, setStatusFilter] = useState<string>("all");
    const [actionLoading, setActionLoading] = useState<string | null>(null);

    useEffect(() => {
        const unsubscribe = onAuthStateChanged(auth, async (user) => {
            if (!user) {
                router.replace("/login");
                return;
            }

            try {
                const token = await user.getIdToken();
                const idTokenResult = await user.getIdTokenResult();
                const isAdmin =
                    idTokenResult.claims.role === "admin" ||
                    (await fetch(`/api/admin/trading-accounts`, {
                        headers: { Authorization: `Bearer ${token}` },
                    }).then((r) => r.ok));

                if (!isAdmin) {
                    router.replace("/account");
                    return;
                }

                fetchAccounts(token);
            } catch {
                router.replace("/account");
            }
        });
        return () => unsubscribe();
    }, [router]);

    async function fetchAccounts(token?: string) {
        setLoading(true);
        try {
            const user = auth.currentUser;
            const t = token || (await user?.getIdToken());
            if (!t) return;

            const res = await fetch("/api/admin/trading-accounts", {
                headers: { Authorization: `Bearer ${t}` },
                cache: "no-store",
            });
            if (!res.ok) throw new Error("Failed to load trading accounts");
            const data = await res.json();
            setAccounts(Array.isArray(data?.accounts) ? data.accounts : []);
        } catch (err) {
            console.error("Error loading trading accounts:", err);
        } finally {
            setLoading(false);
        }
    }

    async function handleAction(
        action: "disable" | "enable",
        account: TradingAccountItem
    ) {
        const confirmMsg =
            action === "disable"
                ? `Disable trading for ${account.mt5Account}?`
                : `Re-enable trading for ${account.mt5Account}?`;
        if (!confirm(confirmMsg)) return;

        setActionLoading(account.accountId);
        try {
            const user = auth.currentUser;
            if (!user) return;
            const token = await user.getIdToken();
            const res = await fetch("/api/admin/trading-accounts", {
                method: "PATCH",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify({
                    accountId: account.accountId,
                    userId: account.userId,
                    action,
                }),
            });
            if (res.ok) {
                setAccounts((prev) =>
                    prev.map((a) =>
                        a.accountId === account.accountId
                            ? {
                                  ...a,
                                  status:
                                      action === "disable"
                                          ? "disabled"
                                          : "connected",
                              }
                            : a
                    )
                );
            }
        } catch (err) {
            console.error(`Failed to ${action} account:`, err);
        } finally {
            setActionLoading(null);
        }
    }

    const filtered = accounts.filter((a) => {
        const q = search.toLowerCase();
        const matchesSearch =
            a.mt5Account?.toLowerCase().includes(q) ||
            a.userEmail?.toLowerCase().includes(q) ||
            a.userName?.toLowerCase().includes(q) ||
            a.broker?.toLowerCase().includes(q) ||
            a.server?.toLowerCase().includes(q);
        const matchesStatus =
            statusFilter === "all" || a.status === statusFilter;
        return matchesSearch && matchesStatus;
    });

    return (
        <AdminShell
            title="Trading Accounts"
            subtitle="Manage connected MT5 trading accounts"
        >
            {/* Controls */}
            <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex flex-1 items-center gap-3 max-w-xl">
                    <div className="relative flex-1">
                        <Search
                            className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
                            size={16}
                        />
                        <input
                            type="text"
                            placeholder="Search account, email, broker..."
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            className="w-full rounded-xl border border-border bg-muted pl-10 pr-4 py-2 text-sm text-foreground placeholder:text-muted-foreground/70 focus:border-emerald-500 focus:outline-none"
                        />
                    </div>
                    <select
                        value={statusFilter}
                        onChange={(e) => setStatusFilter(e.target.value)}
                        className="rounded-xl border border-border bg-muted px-3 py-2 text-sm text-foreground focus:border-emerald-500 focus:outline-none"
                    >
                        <option value="all">All Status</option>
                        <option value="connected">Connected</option>
                        <option value="offline">Offline</option>
                        <option value="disabled">Disabled</option>
                    </select>
                </div>
                <button
                    onClick={() => fetchAccounts()}
                    disabled={loading}
                    className="flex items-center gap-2 rounded-xl border border-border px-4 py-2 text-sm text-muted-foreground hover:bg-muted/70 hover:text-foreground disabled:opacity-50"
                >
                    Refresh
                </button>
            </div>

            {/* Table */}
            {loading ? (
                <div className="flex justify-center py-20">
                    <div className="h-8 w-8 animate-spin rounded-full border-2 border-emerald-500 border-t-transparent" />
                </div>
            ) : filtered.length === 0 ? (
                <div className="rounded-2xl border border-border bg-card p-12 text-center">
                    <Database size={40} className="mx-auto text-muted-foreground mb-3" />
                    <h3 className="text-lg font-bold text-foreground">
                        No Trading Accounts Found
                    </h3>
                    <p className="text-sm text-muted-foreground mt-1 max-w-sm mx-auto">
                        Trading accounts appear here when users connect their MT5 terminals
                        via the Gateway EA.
                    </p>
                </div>
            ) : (
                <div className="overflow-hidden rounded-2xl border border-border bg-card">
                    <div className="overflow-x-auto">
                        <table className="w-full text-left text-sm text-foreground">
                            <thead className="border-b border-border bg-muted text-xs uppercase font-semibold text-muted-foreground">
                                <tr>
                                    <th className="px-6 py-4">User</th>
                                    <th className="px-6 py-4">MT5 Account</th>
                                    <th className="px-6 py-4">Broker</th>
                                    <th className="px-6 py-4">Server</th>
                                    <th className="px-6 py-4">Status</th>
                                    <th className="px-6 py-4 text-right">Balance</th>
                                    <th className="px-6 py-4 text-right">Equity</th>
                                    <th className="px-6 py-4">Last Heartbeat</th>
                                    <th className="px-6 py-4">Gateway</th>
                                    <th className="px-6 py-4 text-right">Actions</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-white/5">
                                {filtered.map((item) => (
                                    <tr
                                        key={item.accountId}
                                        className="hover:bg-muted/30"
                                    >
                                        <td className="px-6 py-4">
                                            <div>
                                                <p className="font-medium">
                                                    {item.userName || "—"}
                                                </p>
                                                <p className="text-xs text-muted-foreground">
                                                    {item.userEmail || item.userId}
                                                </p>
                                            </div>
                                        </td>
                                        <td className="px-6 py-4 font-mono font-bold">
                                            {item.mt5Account}
                                        </td>
                                        <td className="px-6 py-4 font-medium">
                                            {item.broker}
                                        </td>
                                        <td className="px-6 py-4 text-muted-foreground">
                                            {item.server}
                                        </td>
                                        <td className="px-6 py-4">
                                            <StatusBadge status={item.status} />
                                        </td>
                                        <td className="px-6 py-4 text-right font-mono tabular-nums">
                                            ${formatCurrency(item.balance)}
                                        </td>
                                        <td className="px-6 py-4 text-right font-mono tabular-nums">
                                            ${formatCurrency(item.equity)}
                                        </td>
                                        <td className="px-6 py-4 text-xs text-muted-foreground">
                                            {formatRelativeTime(item.lastHeartbeatAt)}
                                        </td>
                                        <td className="px-6 py-4 font-mono text-xs">
                                            v{item.gatewayVersion}
                                        </td>
                                        <td className="px-6 py-4 text-right">
                                            <div className="flex items-center justify-end gap-1">
                                                {item.status !== "disabled" ? (
                                                    <button
                                                        onClick={() =>
                                                            handleAction("disable", item)
                                                        }
                                                        disabled={
                                                            actionLoading === item.accountId
                                                        }
                                                        className="inline-flex items-center gap-1.5 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-1.5 text-xs font-semibold text-rose-400 hover:bg-rose-500/20 transition disabled:opacity-50"
                                                    >
                                                        <Ban size={13} /> Disable
                                                    </button>
                                                ) : (
                                                    <button
                                                        onClick={() =>
                                                            handleAction("enable", item)
                                                        }
                                                        disabled={
                                                            actionLoading === item.accountId
                                                        }
                                                        className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5 text-xs font-semibold text-emerald-500 hover:bg-emerald-500/20 transition disabled:opacity-50"
                                                    >
                                                        <CheckCircle size={13} /> Enable
                                                    </button>
                                                )}
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}
        </AdminShell>
    );
}
