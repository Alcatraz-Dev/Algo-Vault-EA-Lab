"use client";

import { useEffect, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import {
    AlertTriangle,
    ArrowUpRight,
    CheckCircle2,
    Clock,
    Code2,
    ExternalLink,
    Loader2,
    Mail,
    RefreshCw,
    UserRound,
    Users,
    XCircle,
} from "lucide-react";
import Link from "next/link";
import { auth } from "@/lib/firebase";
import AdminShell from "@/components/admin/AdminShell";

type Developer = {
    id: string;
    email: string;
    displayName: string;
    photoURL: string;
    createdAt: number;
    hasDeveloperPlan: boolean;
    plan: string | null;
    accountId: string | null;
    chargesEnabled: boolean;
    payoutsEnabled: boolean;
    restrictions: {
        disabledReason: string | null;
    };
    requirements: {
        currentlyDue: string[];
        pastDue: string[];
        eventuallyDue: string[];
        currentDeadline: number | null;
    };
    onboardedAt: number | null;
    lastOnboardingLinkCreatedAt: number | null;
    status: string;
    updatedAt: number | null;
};

type DeveloperRequest = {
    uid: string;
    email: string;
    displayName: string;
    status: string;
    message: string | null;
    requestedAt: number | null;
    resolvedAt: number | null;
    currentRole: string;
};

type Stats = {
    totalDevelopers: number;
    connected: number;
    onboarding: number;
    notConnected: number;
};

function formatDate(ts?: number | null) {
    if (!ts) return "—";
    return new Intl.DateTimeFormat("en-US", {
        dateStyle: "medium",
        timeStyle: "short",
    }).format(new Date(ts));
}

function timeAgo(ms?: number | null, now = 0) {
    if (!ms) return "Never";
    const diff = Math.floor((now - ms) / 1000);
    if (diff < 60) return "just now";
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    return `${Math.floor(diff / 86400)}d ago`;
}

function statusMeta(status: string) {
    switch (status) {
        case "active":
            return {
                label: "Connected",
                dot: "bg-emerald-500",
                text: "text-emerald-600",
                bg: "bg-emerald-500/10",
                border: "border-emerald-500/25",
            };
        case "requirements":
            return {
                label: "Requirements",
                dot: "bg-amber-500",
                text: "text-amber-600",
                bg: "bg-amber-500/10",
                border: "border-amber-500/25",
            };
        case "onboarding":
            return {
                label: "Onboarding",
                dot: "bg-violet-500",
                text: "text-violet-600",
                bg: "bg-violet-500/10",
                border: "border-violet-500/25",
            };
        default:
            return {
                label: "Not Connected",
                dot: "bg-muted/40",
                text: "text-muted-foreground",
                bg: "bg-muted/40",
                border: "border-border",
            };
    }
}

export default function AdminDevelopersPage() {
    const [developers, setDevelopers] =
        useState<Developer[]>([]);
    const [devRequests, setDevRequests] =
        useState<DeveloperRequest[]>([]);
    const [stats, setStats] =
        useState<Stats | null>(null);
    const [loading, setLoading] =
        useState(true);
    const [refreshing, setRefreshing] =
        useState(false);
    const [error, setError] = useState("");
    const [now, setNow] = useState(0);
    const [showNotConnected, setShowNotConnected] =
        useState(false);
    const [search, setSearch] = useState("");
    const [actionLoading, setActionLoading] =
        useState<string | null>(null);

    async function load(refresh = false) {
        try {
            if (refresh) {
                setRefreshing(true);
            } else {
                setLoading(true);
            }

            setError("");

            const user = auth.currentUser;
            if (!user) throw new Error("You must be logged in.");

            const token = await user.getIdToken();

            const [devRes, reqRes] = await Promise.all([
                fetch("/api/admin/developers", {
                    headers: { Authorization: `Bearer ${token}` },
                    cache: "no-store",
                }),
                fetch("/api/admin/developer-requests", {
                    headers: { Authorization: `Bearer ${token}` },
                    cache: "no-store",
                }),
            ]);

            const devData = await devRes.json();
            if (!devRes.ok) throw new Error(devData.error || "Failed to load developers.");

            const reqData = await reqRes.json();

            setDevelopers(Array.isArray(devData.developers) ? devData.developers : []);
            setStats(devData.stats ?? null);
            setDevRequests(Array.isArray(reqData.requests) ? reqData.requests : []);
            setNow(Date.now());
        } catch (err) {
            console.error("ADMIN DEVELOPERS ERROR:", err);
            setError(err instanceof Error ? err.message : "Failed to load developers.");
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    }

    useEffect(() => {
        return onAuthStateChanged(auth, (user) => {
            if (!user) {
                setLoading(false);
                setError("You must be logged in.");
                return;
            }
            load();
        });
    }, []);

    async function handleRequestAction(uid: string, action: "approve" | "reject") {
        setActionLoading(uid);
        try {
            const user = auth.currentUser;
            if (!user) return;
            const token = await user.getIdToken();
            const res = await fetch("/api/admin/developer-requests", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify({ uid, action }),
            });
            if (res.ok) {
                await load(true);
            }
        } finally {
            setActionLoading(null);
        }
    }

    const pendingRequests = devRequests.filter((r) => r.status === "pending");
    const filtered = developers.filter((dev) => {
        if (!showNotConnected && dev.status === "not_connected") {
            return false;
        }
        const q = search.toLowerCase().trim();
        if (!q) return true;
        return (
            dev.displayName.toLowerCase().includes(q) ||
            dev.email.toLowerCase().includes(q) ||
            (dev.accountId ?? "").toLowerCase().includes(q) ||
            dev.id.toLowerCase().includes(q)
        );
    });

    return (
        <AdminShell
            title="Developers"
            subtitle="Developer requests, Stripe Connect onboarding & account status"
        >
            <div className="mb-6 flex items-center justify-end gap-3">
                <button
                    onClick={() => load(true)}
                    disabled={loading || refreshing}
                    className="flex items-center justify-center gap-2 rounded-xl border border-border px-4 py-2 text-sm text-muted-foreground hover:bg-muted/70 hover:text-foreground disabled:opacity-50"
                >
                    <RefreshCw
                        size={16}
                        className={refreshing ? "animate-spin" : ""}
                    />
                    Refresh
                </button>
            </div>

            {/* Error */}
            {error && (
                <div className="mb-6 rounded-xl border border-red-500/20 bg-red-500/10 p-4 text-sm text-red-600">
                    {error}
                </div>
            )}

            {/* Pending Developer Requests */}
            {pendingRequests.length > 0 && (
                <div className="mb-8">
                    <div className="flex items-center gap-2 mb-4">
                        <Clock size={16} className="text-amber-400" />
                        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                            Pending Developer Requests
                        </h2>
                        <span className="rounded-full bg-amber-500/10 border border-amber-500/25 px-2 py-0.5 text-[11px] font-medium text-amber-600">
                            {pendingRequests.length}
                        </span>
                    </div>
                    <div className="space-y-3">
                        {pendingRequests.map((req) => (
                            <div
                                key={req.uid}
                                className="rounded-2xl border border-border bg-muted/30 p-5"
                            >
                                <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                                    <div className="flex items-center gap-4 min-w-0">
                                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-medium">
                                            {(req.displayName || req.email || "?").charAt(0).toUpperCase()}
                                        </div>
                                        <div className="min-w-0">
                                            <p className="truncate font-medium text-foreground">
                                                {req.displayName || "Unnamed User"}
                                            </p>
                                            <p className="mt-0.5 truncate text-xs text-muted-foreground">
                                                {req.email || req.uid}
                                            </p>
                                            {req.message && (
                                                <p className="mt-1 text-xs text-muted-foreground italic max-w-md truncate">
                                                    &ldquo;{req.message}&rdquo;
                                                </p>
                                            )}
                                            <p className="mt-1 text-[11px] text-muted-foreground">
                                                Requested {timeAgo(req.requestedAt, now)}
                                            </p>
                                        </div>
                                    </div>

                                    <div className="flex items-center gap-2 shrink-0">
                                        <button
                                            type="button"
                                            onClick={() => handleRequestAction(req.uid, "approve")}
                                            disabled={actionLoading === req.uid}
                                            className="flex items-center gap-1.5 rounded-xl bg-emerald-600 px-4 py-2 text-xs font-semibold text-foreground transition hover:bg-emerald-500 disabled:opacity-50"
                                        >
                                                {actionLoading === req.uid ? (
                                                    <Loader2 size={13} className="animate-spin" />
                                                ) : (
                                                    <CheckCircle2 size={13} />
                                                )}
                                                Approve
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => handleRequestAction(req.uid, "reject")}
                                            disabled={actionLoading === req.uid}
                                            className="flex items-center gap-1.5 rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-2 text-xs font-semibold text-red-400 transition hover:bg-red-500/20 disabled:opacity-50"
                                        >
                                                {actionLoading === req.uid ? (
                                                    <Loader2 size={13} className="animate-spin" />
                                                ) : (
                                                    <XCircle size={13} />
                                                )}
                                                Reject
                                        </button>
                                        <Link
                                            href={`/admin/users/${req.uid}`}
                                            className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-border text-muted-foreground transition hover:bg-muted/70 hover:text-foreground"
                                            title="View user profile"
                                        >
                                            <Mail size={13} />
                                        </Link>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* Summary */}
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                {[
                    {
                        label: "Total Developers",
                        value: String(stats?.totalDevelopers ?? developers.length),
                        icon: Code2,
                    },
                    {
                        label: "Connected",
                        value: String(stats?.connected ?? 0),
                        icon: CheckCircle2,
                    },
                    {
                        label: "Onboarding / Requirements",
                        value: String(stats?.onboarding ?? 0),
                        icon: AlertTriangle,
                    },
                    {
                        label: "Not Connected",
                        value: String(stats?.notConnected ?? 0),
                        icon: UserRound,
                    },
                ].map(({ label, value, icon: Icon }) => (
                    <div
                        key={label}
                        className="rounded-2xl border border-border bg-muted/40 p-5"
                    >
                        <div className="flex items-center justify-between">
                            <div>
                                <p className="text-sm text-muted-foreground">
                                    {label}
                                </p>
                                <p className="mt-2 text-2xl font-bold">
                                    {value}
                                </p>
                            </div>
                            <div className="rounded-xl border border-border bg-muted/50 p-2.5">
                                <Icon className="h-5 w-5 text-foreground" />
                            </div>
                        </div>
                    </div>
                ))}
            </div>

            {/* Filters */}
            <div className="mt-8 flex flex-col gap-3 md:flex-row md:items-center">
                <div className="relative flex-1">
                    <input
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder="Search by name, email, account ID..."
                        className="h-11 w-full rounded-xl border border-border bg-muted/30 pl-4 pr-4 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-border"
                    />
                </div>

                <button
                    onClick={() => setShowNotConnected((v) => !v)}
                    className={`flex h-11 items-center gap-2 rounded-xl border px-4 text-sm transition ${
                        showNotConnected
                            ? "border-border bg-muted/40 text-foreground"
                            : "border-border text-muted-foreground hover:bg-muted/30"
                    }`}
                >
                    <Users size={14} />
                    Include not connected
                </button>
            </div>

            {/* Table */}
            {loading ? (
                <div className="mt-6 rounded-2xl border border-border bg-muted/30 p-16 text-center">
                    <Loader2 className="mx-auto h-8 w-8 animate-spin text-muted-foreground mb-3" />
                    <p className="text-sm text-muted-foreground">
                        Loading developers...
                    </p>
                </div>
            ) : filtered.length === 0 ? (
                <div className="mt-6 rounded-2xl border border-dashed border-border p-16 text-center">
                    <Code2 className="mx-auto h-10 w-10 text-muted-foreground mb-3" />
                    <h3 className="font-semibold">No developers found</h3>
                    <p className="mt-2 text-sm text-muted-foreground">
                        Developers appear here once their role is set to Developer.
                    </p>
                </div>
            ) : (
                <div className="mt-6 overflow-hidden rounded-2xl border border-border bg-muted/30">
                    <div className="overflow-x-auto">
                        <table className="w-full min-w-[1000px] text-sm">
                            <thead>
                                <tr className="border-b border-border text-xs uppercase tracking-wider text-muted-foreground">
                                    <th className="px-5 py-4 text-left">
                                        Developer
                                    </th>
                                    <th className="px-5 py-4 text-left">
                                        Status
                                    </th>
                                    <th className="px-5 py-4 text-left">
                                        Stripe Account
                                    </th>
                                    <th className="px-5 py-4 text-left">
                                        Plan
                                    </th>
                                    <th className="px-5 py-4 text-left">
                                        Requirements
                                    </th>
                                    <th className="px-5 py-4 text-left">
                                        Last Update
                                    </th>
                                    <th className="px-5 py-4 text-left">
                                        Onboarded
                                    </th>
                                    <th className="px-5 py-4 text-right">
                                        Actions
                                    </th>
                                </tr>
                            </thead>
                            <tbody>
                                {filtered.map((dev) => {
                                    const meta = statusMeta(dev.status);
                                    const pendingReqs =
                                        dev.requirements.currentlyDue.length +
                                        dev.requirements.pastDue.length;
                                    return (
                                        <tr
                                            key={dev.id}
                                            className="border-b border-border/60 last:border-0 hover:bg-muted/30"
                                        >
                                            <td className="px-5 py-4">
                                                <div className="flex items-center gap-3">
                                                    {dev.photoURL ? (
                                                        <img
                                                            src={dev.photoURL}
                                                            alt=""
                                                            className="h-9 w-9 rounded-full object-cover"
                                                        />
                                                    ) : (
                                                        <div className="flex h-9 w-9 items-center justify-center rounded-full bg-muted text-sm font-medium">
                                                            {dev.displayName
                                                                .charAt(0)
                                                                .toUpperCase()}
                                                        </div>
                                                    )}
                                                    <div className="min-w-0">
                                                        <p className="truncate font-medium text-foreground">
                                                            {dev.displayName}
                                                        </p>
                                                        <p className="mt-0.5 truncate text-xs text-muted-foreground">
                                                            {dev.email}
                                                        </p>
                                                    </div>
                                                </div>
                                            </td>

                                            <td className="px-5 py-4">
                                                <span
                                                    className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${meta.bg} ${meta.border} ${meta.text}`}
                                                >
                                                    <span
                                                        className={`h-1.5 w-1.5 rounded-full ${meta.dot}`}
                                                    />
                                                    {meta.label}
                                                </span>
                                                {dev.status === "requirements" && (
                                                    <p className="mt-1 text-[11px] text-amber-600">
                                                        {pendingReqs} pending
                                                    </p>
                                                )}
                                            </td>

                                            <td className="px-5 py-4">
                                                {dev.accountId ? (
                                                    <div>
                                                        <p className="font-mono text-xs text-foreground">
                                                            {dev.accountId}
                                                        </p>
                                                        {dev.payoutsEnabled && (
                                                            <p className="mt-1 text-[11px] text-emerald-600">
                                                                Payouts enabled
                                                            </p>
                                                        )}
                                                    </div>
                                                ) : (
                                                    <span className="text-xs text-muted-foreground">
                                                        —
                                                    </span>
                                                )}
                                            </td>

                                            <td className="px-5 py-4">
                                                {dev.hasDeveloperPlan ? (
                                                    <span className="rounded-lg border border-violet-500/25 bg-violet-500/10 px-2.5 py-1 text-xs font-medium text-violet-600">
                                                        {dev.plan || "Active"}
                                                    </span>
                                                ) : (
                                                    <span className="text-xs text-muted-foreground">
                                                        No plan
                                                    </span>
                                                )}
                                            </td>

                                            <td className="px-5 py-4">
                                                {pendingReqs > 0 ? (
                                                    <div>
                                                        <p className="text-xs font-medium text-foreground">
                                                            {dev.requirements.currentlyDue
                                                                .length > 0
                                                                ? `${dev.requirements.currentlyDue.length} currently due`
                                                                : `${dev.requirements.pastDue.length} past due`}
                                                        </p>
                                                        {dev.requirements
                                                            .eventuallyDue
                                                            .length > 0 && (
                                                            <p className="mt-1 text-[11px] text-muted-foreground">
                                                                {
                                                                    dev
                                                                        .requirements
                                                                        .eventuallyDue
                                                                        .length
                                                                }{" "}
                                                                eventually
                                                            </p>
                                                        )}
                                                    </div>
                                                ) : (
                                                    <span className="text-xs text-muted-foreground">
                                                        None
                                                    </span>
                                                )}
                                            </td>

                                            <td className="px-5 py-4 text-xs text-muted-foreground">
                                                <p>{timeAgo(dev.updatedAt, now)}</p>
                                                {dev.lastOnboardingLinkCreatedAt && (
                                                    <p className="mt-1 text-[11px] text-muted-foreground">
                                                        Link{" "}
                                                        {timeAgo(
                                                            dev.lastOnboardingLinkCreatedAt,
                                                            now
                                                        )}
                                                    </p>
                                                )}
                                            </td>

                                            <td className="px-5 py-4 text-xs text-muted-foreground">
                                                {dev.onboardedAt
                                                    ? formatDate(dev.onboardedAt)
                                                    : "—"}
                                            </td>

                                            <td className="px-5 py-4 text-right">
                                                <div className="flex items-center justify-end gap-2">
                                                    {dev.accountId && (
                                                        <a
                                                            href={`https://dashboard.stripe.com/connect/accounts/${dev.accountId}`}
                                                            target="_blank"
                                                            rel="noreferrer"
                                                            className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-border text-muted-foreground transition hover:bg-muted/70 hover:text-foreground"
                                                            title="Open in Stripe Dashboard"
                                                        >
                                                            <ExternalLink size={13} />
                                                        </a>
                                                    )}
                                                    <Link
                                                        href={`/admin/users/${dev.id}`}
                                                        className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs text-muted-foreground transition hover:bg-muted/70 hover:text-foreground"
                                                    >
                                                        View
                                                        <ArrowUpRight size={13} />
                                                    </Link>
                                                </div>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>

                    <div className="border-t border-border px-5 py-4">
                        <p className="text-xs text-muted-foreground">
                            Showing{" "}
                            <span className="text-foreground">
                                {filtered.length}
                            </span>{" "}
                            of{" "}
                            <span className="text-foreground">
                                {developers.length}
                            </span>{" "}
                            developers
                        </p>
                    </div>
                </div>
            )}
        </AdminShell>
    );
}