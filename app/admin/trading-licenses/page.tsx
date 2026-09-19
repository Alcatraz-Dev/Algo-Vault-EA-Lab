"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { onAuthStateChanged } from "firebase/auth";
import { auth } from "@/lib/firebase";
import AdminShell from "@/components/admin/AdminShell";
import { Shield, Search, Ban, RotateCcw } from "lucide-react";

type TradingLicense = {
    id: string;
    userId: string;
    userEmail: string;
    userName?: string;
    plan: string;
    status: string;
    maxAccounts: number;
    startedAt: number;
    expiresAt: number;
};

function formatDate(ts: number): string {
    if (!ts) return "—";
    return new Date(ts).toLocaleDateString("en-US", {
        year: "numeric",
        month: "short",
        day: "numeric",
    });
}

function StatusBadge({ status }: { status: string }) {
    const s = status.toLowerCase();
    return (
        <span
            className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold border ${
                s === "active"
                    ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-600"
                    : s === "expired"
                    ? "border-amber-500/30 bg-amber-500/10 text-amber-400"
                    : "border-rose-500/30 bg-rose-500/10 text-rose-400"
            }`}
        >
            {status.toUpperCase()}
        </span>
    );
}

export default function AdminTradingLicensesPage() {
    const router = useRouter();
    const [licenses, setLicenses] = useState<TradingLicense[]>([]);
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
                    (await fetch(`/api/admin/trading-licenses`, {
                        headers: { Authorization: `Bearer ${token}` },
                    }).then((r) => r.ok));

                if (!isAdmin) {
                    router.replace("/account");
                    return;
                }

                fetchLicenses(token);
            } catch {
                router.replace("/account");
            }
        });
        return () => unsubscribe();
    }, [router]);

    async function fetchLicenses(token?: string) {
        setLoading(true);
        try {
            const user = auth.currentUser;
            const t = token || (await user?.getIdToken());
            if (!t) return;

            const res = await fetch("/api/admin/trading-licenses", {
                headers: { Authorization: `Bearer ${t}` },
                cache: "no-store",
            });
            if (!res.ok) throw new Error("Failed to load trading licenses");
            const data = await res.json();
            setLicenses(Array.isArray(data?.licenses) ? data.licenses : []);
        } catch (err) {
            console.error("Error loading trading licenses:", err);
        } finally {
            setLoading(false);
        }
    }

    async function handleRevoke(license: TradingLicense) {
        if (
            !confirm(
                `Revoke trading access for ${license.userEmail}? They will lose access to the trading terminal.`
            )
        )
            return;

        setActionLoading(license.id);
        try {
            const user = auth.currentUser;
            if (!user) return;
            const token = await user.getIdToken();
            const res = await fetch("/api/admin/trading-licenses", {
                method: "PATCH",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify({
                    id: license.id,
                    userId: license.userId,
                    status: "revoked",
                }),
            });
            if (res.ok) {
                setLicenses((prev) =>
                    prev.map((l) =>
                        l.id === license.id ? { ...l, status: "revoked" } : l
                    )
                );
            }
        } catch (err) {
            console.error("Failed to revoke license:", err);
        } finally {
            setActionLoading(null);
        }
    }

    async function handleReactivate(license: TradingLicense) {
        setActionLoading(license.id);
        try {
            const user = auth.currentUser;
            if (!user) return;
            const token = await user.getIdToken();
            const res = await fetch("/api/admin/trading-licenses", {
                method: "PATCH",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify({
                    id: license.id,
                    userId: license.userId,
                    status: "active",
                }),
            });
            if (res.ok) {
                setLicenses((prev) =>
                    prev.map((l) =>
                        l.id === license.id ? { ...l, status: "active" } : l
                    )
                );
            }
        } catch (err) {
            console.error("Failed to reactivate license:", err);
        } finally {
            setActionLoading(null);
        }
    }

    const filtered = licenses.filter((l) => {
        const q = search.toLowerCase();
        const matchesSearch =
            l.userEmail?.toLowerCase().includes(q) ||
            l.userName?.toLowerCase().includes(q) ||
            l.plan?.toLowerCase().includes(q) ||
            l.id?.toLowerCase().includes(q);
        const matchesStatus =
            statusFilter === "all" || l.status === statusFilter;
        return matchesSearch && matchesStatus;
    });

    return (
        <AdminShell
            title="Trading Licenses"
            subtitle="Manage trading access licenses for users"
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
                            placeholder="Search email, name, or plan..."
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
                        <option value="active">Active</option>
                        <option value="expired">Expired</option>
                        <option value="revoked">Revoked</option>
                    </select>
                </div>
                <button
                    onClick={() => fetchLicenses()}
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
                    <Shield
                        size={40}
                        className="mx-auto text-muted-foreground mb-3"
                    />
                    <h3 className="text-lg font-bold text-foreground">
                        No Trading Licenses Found
                    </h3>
                    <p className="text-sm text-muted-foreground mt-1 max-w-sm mx-auto">
                        Trading access licenses are created when users activate trading
                        access from their account panel.
                    </p>
                </div>
            ) : (
                <div className="overflow-hidden rounded-2xl border border-border bg-card">
                    <div className="overflow-x-auto">
                        <table className="w-full text-left text-sm text-foreground">
                            <thead className="border-b border-border bg-muted text-xs uppercase font-semibold text-muted-foreground">
                                <tr>
                                    <th className="px-6 py-4">User</th>
                                    <th className="px-6 py-4">Email</th>
                                    <th className="px-6 py-4">Plan</th>
                                    <th className="px-6 py-4">Status</th>
                                    <th className="px-6 py-4 text-right">Max Accounts</th>
                                    <th className="px-6 py-4">Start</th>
                                    <th className="px-6 py-4">Expiration</th>
                                    <th className="px-6 py-4 text-right">Actions</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-white/5">
                                {filtered.map((item) => (
                                    <tr
                                        key={item.id}
                                        className="hover:bg-muted/30"
                                    >
                                        <td className="px-6 py-4">
                                            <p className="font-medium">
                                                {item.userName || "—"}
                                            </p>
                                        </td>
                                        <td className="px-6 py-4 text-muted-foreground">
                                            {item.userEmail}
                                        </td>
                                        <td className="px-6 py-4 font-medium">
                                            <span className="rounded-lg bg-muted px-2.5 py-1 text-xs font-semibold">
                                                {item.plan}
                                            </span>
                                        </td>
                                        <td className="px-6 py-4">
                                            <StatusBadge status={item.status} />
                                        </td>
                                        <td className="px-6 py-4 text-right font-mono tabular-nums">
                                            {item.maxAccounts}
                                        </td>
                                        <td className="px-6 py-4 text-xs text-muted-foreground">
                                            {formatDate(item.startedAt)}
                                        </td>
                                        <td className="px-6 py-4 text-xs text-muted-foreground">
                                            {formatDate(item.expiresAt)}
                                        </td>
                                        <td className="px-6 py-4 text-right">
                                            <div className="flex items-center justify-end gap-1">
                                                {item.status === "active" ? (
                                                    <button
                                                        onClick={() =>
                                                            handleRevoke(item)
                                                        }
                                                        disabled={
                                                            actionLoading === item.id
                                                        }
                                                        className="inline-flex items-center gap-1.5 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-1.5 text-xs font-semibold text-rose-400 hover:bg-rose-500/20 transition disabled:opacity-50"
                                                    >
                                                        <Ban size={13} /> Revoke
                                                    </button>
                                                ) : item.status === "revoked" ? (
                                                    <button
                                                        onClick={() =>
                                                            handleReactivate(item)
                                                        }
                                                        disabled={
                                                            actionLoading === item.id
                                                        }
                                                        className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5 text-xs font-semibold text-emerald-500 hover:bg-emerald-500/20 transition disabled:opacity-50"
                                                    >
                                                        <RotateCcw size={13} /> Reactivate
                                                    </button>
                                                ) : (
                                                    <span className="text-xs text-muted-foreground">
                                                        —
                                                    </span>
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
