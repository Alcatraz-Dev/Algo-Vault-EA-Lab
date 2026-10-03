"use client";

// Admin · Performance Arena — configuration & inspection center.
//
// What admins CAN do here: create/edit/enable challenge definitions, inspect
// reward policies and the ledger, inspect attempts/events, review fraud flags,
// read aggregate analytics.
// What admins CANNOT do: enable cash rewards (env-only flag, server-side),
// edit balances/results/records (engine outputs are read-only).

import { useCallback, useEffect, useState } from "react";
import { onAuthStateChanged, type User } from "firebase/auth";
import { Activity, BadgeCheck, Coins, Flame, Loader2, RefreshCw, ShieldAlert, Trophy } from "lucide-react";
import AdminShell from "@/components/admin/AdminShell";
import { auth } from "@/lib/firebase";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { ChallengeDefinition, FraudFlag, RewardLedgerEntry, RewardPolicy } from "@/lib/performance-arena/types";

type Tab = "overview" | "challenges" | "rewards" | "fraud";

interface AnalyticsResponse {
    flags: {
        performanceArenaEnabled: boolean;
        challengeCatalogEnabled: boolean;
        paidChallengesEnabled: boolean;
        leaderboardsEnabled: boolean;
        platformRewardsEnabled: boolean;
        cashRewardsEnabled: boolean;
    };
    definitions: Array<{ id: string; name: string; enabled: boolean; status: string; access: string }>;
    totals: {
        challengeStarts: number;
        challengeCompletions: number;
        passes: number;
        failures: number;
        expiries: number;
        cancellations: number;
        rewardsGranted: number;
        pointsIssued: number;
        aiGuardianRuns: number;
        passRatePct: number;
        settledCount: number;
        avgDurationMs: number;
        avgDrawdownPct: number;
        avgReturnPct: number;
    };
    failureReasons: Record<string, number>;
    daily: Array<{ dayKey: string; challengeStarts: number; passes: number; failures: number; rewardsGranted: number }>;
    generatedAt: number;
}

interface RewardsResponse {
    policies: RewardPolicy[];
    ledger: RewardLedgerEntry[];
    cashRewardsEnabled: boolean;
    cashRewardsMutableViaApi: boolean;
}

export default function PerformanceArenaAdminPage() {
    const [user, setUser] = useState<User | null>(null);
    const [tab, setTab] = useState<Tab>("overview");
    const [analytics, setAnalytics] = useState<AnalyticsResponse | null>(null);
    const [rewards, setRewards] = useState<RewardsResponse | null>(null);
    const [definitions, setDefinitions] = useState<ChallengeDefinition[]>([]);
    const [flags, setFlags] = useState<FraudFlag[]>([]);
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [busy, setBusy] = useState(false);

    const authHeader = useCallback(async () => {
        const token = await auth.currentUser?.getIdToken();
        return token ? { Authorization: `Bearer ${token}` } : null;
    }, []);

    const load = useCallback(async () => {
        const headers = await authHeader();
        if (!headers) return;
        setLoading(true);
        setError(null);
        try {
            const [analyticsRes, rewardsRes, defsRes, fraudRes] = await Promise.all([
                fetch("/api/admin/performance-arena/analytics", { headers, cache: "no-store" }),
                fetch("/api/admin/performance-arena/rewards", { headers, cache: "no-store" }),
                fetch("/api/admin/performance-arena/definitions", { headers, cache: "no-store" }),
                fetch("/api/admin/performance-arena/fraud", { headers, cache: "no-store" }),
            ]);
            if (!analyticsRes.ok) throw new Error("Failed to load arena analytics.");
            setAnalytics((await analyticsRes.json()) as AnalyticsResponse);
            if (rewardsRes.ok) setRewards((await rewardsRes.json()) as RewardsResponse);
            if (defsRes.ok) setDefinitions(((await defsRes.json()) as { definitions: ChallengeDefinition[] }).definitions ?? []);
            if (fraudRes.ok) setFlags(((await fraudRes.json()) as { flags: FraudFlag[] }).flags ?? []);
        } catch (err) {
            setError(err instanceof Error ? err.message : "Failed to load the arena admin data.");
        } finally {
            setLoading(false);
        }
    }, [authHeader]);

    useEffect(() => {
        const unsub = onAuthStateChanged(auth, (u) => {
            setUser(u);
            if (u) void load();
            else setLoading(false);
        });
        return () => unsub();
    }, [load]);

    const patchDefinition = async (id: string, patch: Partial<ChallengeDefinition>) => {
        const headers = await authHeader();
        if (!headers) return;
        setBusy(true);
        try {
            const res = await fetch(`/api/admin/performance-arena/definitions/${id}`, {
                method: "PATCH",
                headers: { ...headers, "Content-Type": "application/json" },
                body: JSON.stringify(patch),
            });
            if (!res.ok) {
                const body = (await res.json()) as { error?: string; errors?: string[] };
                throw new Error(body.errors?.join(" ") ?? body.error ?? "Update failed.");
            }
            await load();
        } catch (err) {
            setError(err instanceof Error ? err.message : "Update failed.");
        } finally {
            setBusy(false);
        }
    };

    const resolveFlag = async (flagId: string, status: "REVIEWED" | "DISMISSED") => {
        const headers = await authHeader();
        if (!headers) return;
        setBusy(true);
        try {
            const res = await fetch("/api/admin/performance-arena/fraud", {
                method: "PATCH",
                headers: { ...headers, "Content-Type": "application/json" },
                body: JSON.stringify({ flagId, status }),
            });
            if (!res.ok) throw new Error("Failed to update flag.");
            await load();
        } catch (err) {
            setError(err instanceof Error ? err.message : "Failed to update flag.");
        } finally {
            setBusy(false);
        }
    };

    const tabs: Array<{ id: Tab; label: string; icon: React.ReactNode }> = [
        { id: "overview", label: "Overview & analytics", icon: <Activity className="h-3.5 w-3.5" /> },
        { id: "challenges", label: "Challenges & policies", icon: <Trophy className="h-3.5 w-3.5" /> },
        { id: "rewards", label: "Rewards & ledger", icon: <Coins className="h-3.5 w-3.5" /> },
        { id: "fraud", label: "Fraud flags", icon: <ShieldAlert className="h-3.5 w-3.5" /> },
    ];

    return (
        <AdminShell title="Performance Arena" subtitle="Simulated challenges · rules · platform rewards · analytics">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-xs">
                    {analytics ? (
                        <>
                            <Badge variant="outline">Arena: {analytics.flags.performanceArenaEnabled ? "enabled" : "disabled"}</Badge>
                            <Badge variant="outline">Paid challenges: {analytics.flags.paidChallengesEnabled ? "enabled" : "off"}</Badge>
                            <Badge variant="success">Cash rewards: DISABLED (env-only, no UI switch)</Badge>
                        </>
                    ) : null}
                </div>
                <Button variant="outline" size="xs" onClick={() => void load()} disabled={!user || loading}>
                    {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />} Refresh
                </Button>
            </div>

            <div className="mb-4 flex flex-wrap gap-1 border-b border-border pb-2">
                {tabs.map((t) => (
                    <button
                        key={t.id}
                        type="button"
                        onClick={() => setTab(t.id)}
                        className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium ${
                            tab === t.id ? "bg-primary/15 text-primary" : "text-muted-foreground hover:bg-muted"
                        }`}
                    >
                        {t.icon} {t.label}
                    </button>
                ))}
            </div>

            {error ? <div className="mb-3 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">{error}</div> : null}
            {loading ? (
                <div className="rounded-lg border border-border bg-card p-8 text-center text-sm text-muted-foreground">Loading arena data…</div>
            ) : null}

            {!loading && tab === "overview" && analytics ? (
                <div className="space-y-4">
                    <div className="grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-6">
                        <Stat label="Challenge starts" value={analytics.totals.challengeStarts} />
                        <Stat label="Completions" value={analytics.totals.challengeCompletions} />
                        <Stat label="Pass rate" value={`${analytics.totals.passRatePct.toFixed(1)}%`} sub={`${analytics.totals.passes}/${analytics.totals.settledCount} settled`} />
                        <Stat label="Avg duration" value={`${Math.round(analytics.totals.avgDurationMs / 86_400_000)}d`} />
                        <Stat label="Avg drawdown" value={`${analytics.totals.avgDrawdownPct.toFixed(2)}%`} />
                        <Stat label="Avg return" value={`${analytics.totals.avgReturnPct.toFixed(2)}%`} />
                        <Stat label="Rewards granted" value={analytics.totals.rewardsGranted} />
                        <Stat label="AV Points issued" value={analytics.totals.pointsIssued.toLocaleString()} />
                        <Stat label="Guardian AI runs" value={analytics.totals.aiGuardianRuns} />
                        <Stat label="Cancellations" value={analytics.totals.cancellations} />
                        <Stat label="Expiries" value={analytics.totals.expiries} />
                        <Stat label="Failures" value={analytics.totals.failures} />
                    </div>

                    <div className="grid gap-4 lg:grid-cols-2">
                        <div className="rounded-lg border border-border bg-card p-4">
                            <h3 className="mb-2 text-sm font-semibold">Settlement reasons</h3>
                            {Object.keys(analytics.failureReasons).length === 0 ? (
                                <p className="text-xs text-muted-foreground">No settlements recorded yet.</p>
                            ) : (
                                <ul className="space-y-1 text-xs">
                                    {Object.entries(analytics.failureReasons).map(([reason, count]) => (
                                        <li key={reason} className="flex justify-between">
                                            <span className="font-mono text-muted-foreground">{reason}</span>
                                            <span className="font-mono">{count}</span>
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </div>
                        <div className="rounded-lg border border-border bg-card p-4">
                            <h3 className="mb-2 text-sm font-semibold">Challenge definitions</h3>
                            <ul className="space-y-1 text-xs">
                                {analytics.definitions.map((def) => (
                                    <li key={def.id} className="flex justify-between gap-2">
                                        <span className="font-mono">{def.name}</span>
                                        <span className="text-muted-foreground">
                                            {def.access} · {def.status} · {def.enabled ? "enabled" : "disabled"}
                                        </span>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    </div>
                </div>
            ) : null}

            {!loading && tab === "challenges" ? (
                <div className="rounded-lg border border-border bg-card">
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Challenge</TableHead>
                                <TableHead>Key</TableHead>
                                <TableHead className="text-right">Virtual capital</TableHead>
                                <TableHead className="text-right">Target</TableHead>
                                <TableHead className="text-right">Max DD</TableHead>
                                <TableHead className="text-right">Daily loss</TableHead>
                                <TableHead>Access</TableHead>
                                <TableHead>Status</TableHead>
                                <TableHead className="text-right">Actions</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {definitions.map((def) => (
                                <TableRow key={def.id}>
                                    <TableCell className="text-xs font-medium">{def.name}</TableCell>
                                    <TableCell className="font-mono text-xs">{def.key}</TableCell>
                                    <TableCell className="text-right font-mono text-xs">${(def.policy.startingBalanceCents / 100).toLocaleString()}</TableCell>
                                    <TableCell className="text-right font-mono text-xs">{def.policy.profitTargetPct}%</TableCell>
                                    <TableCell className="text-right font-mono text-xs">{def.policy.maxDrawdownPct}%</TableCell>
                                    <TableCell className="text-right font-mono text-xs">{def.policy.dailyLossLimitPct}%</TableCell>
                                    <TableCell><Badge variant="outline">{def.access.model}</Badge></TableCell>
                                    <TableCell>
                                        <Badge variant={def.status === "AVAILABLE" ? "success" : "secondary"}>{def.status}</Badge>
                                    </TableCell>
                                    <TableCell className="text-right">
                                        <div className="flex justify-end gap-1">
                                            <Button size="xs" variant="outline" disabled={busy} onClick={() => void patchDefinition(def.id, { enabled: !def.enabled })}>
                                                {def.enabled ? "Disable" : "Enable"}
                                            </Button>
                                            <Button
                                                size="xs"
                                                variant="outline"
                                                disabled={busy}
                                                onClick={() =>
                                                    void patchDefinition(def.id, {
                                                        status: def.status === "AVAILABLE" ? "DRAFT" : "AVAILABLE",
                                                        enabled: def.status === "AVAILABLE" ? false : true,
                                                    })
                                                }
                                            >
                                                {def.status === "AVAILABLE" ? "Unpublish" : "Publish"}
                                            </Button>
                                        </div>
                                    </TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                    <p className="border-t border-border px-4 py-2 text-[11px] text-muted-foreground">
                        Edits create a new policy version; existing attempts keep their immutable join-time policy snapshot. Full policy editing
                        (every rule field) is available via the definitions API with server-side validation.
                    </p>
                </div>
            ) : null}

            {!loading && tab === "rewards" && rewards ? (
                <div className="space-y-4">
                    <div className="rounded-lg border border-border bg-card p-4">
                        <div className="mb-3 flex items-center justify-between">
                            <h3 className="flex items-center gap-2 text-sm font-semibold">
                                <BadgeCheck className="h-4 w-4" /> Reward policies
                            </h3>
                            <Badge variant="success">Cash rewards: {rewards.cashRewardsEnabled ? "flag on (no provider — still blocked)" : "DISABLED"}</Badge>
                        </div>
                        {rewards.policies.map((policy) => (
                            <div key={policy.id} className="mb-3 rounded-md border border-border p-3">
                                <div className="mb-1 flex items-center gap-2 text-xs">
                                    <span className="font-medium">{policy.name}</span>
                                    <span className="font-mono text-muted-foreground">{policy.id} v{policy.version}</span>
                                    <Badge variant={policy.enabled ? "success" : "secondary"}>{policy.enabled ? "enabled" : "disabled"}</Badge>
                                </div>
                                <Table>
                                    <TableHeader>
                                        <TableRow>
                                            <TableHead>Trigger</TableHead>
                                            <TableHead>Reward</TableHead>
                                            <TableHead className="text-right">Amount</TableHead>
                                            <TableHead>Unit</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {policy.grants.map((grant, index) => (
                                            <TableRow key={`${grant.when}-${grant.type}-${index}`}>
                                                <TableCell className="font-mono text-xs">{grant.when}</TableCell>
                                                <TableCell className="text-xs">{grant.type}</TableCell>
                                                <TableCell className="text-right font-mono text-xs">{grant.amount}</TableCell>
                                                <TableCell className="text-xs text-muted-foreground">{grant.unit ?? "—"}</TableCell>
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </Table>
                            </div>
                        ))}
                    </div>

                    <div className="rounded-lg border border-border bg-card">
                        <h3 className="border-b border-border px-4 py-3 text-sm font-semibold">Reward ledger (latest {Math.min(rewards.ledger.length, 100)})</h3>
                        <div className="max-h-96 overflow-y-auto">
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead>User</TableHead>
                                        <TableHead>Source</TableHead>
                                        <TableHead>Reward</TableHead>
                                        <TableHead className="text-right">Amount</TableHead>
                                        <TableHead>Status</TableHead>
                                        <TableHead>Created</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {rewards.ledger.slice(0, 100).map((entry) => (
                                        <TableRow key={entry.rewardId}>
                                            <TableCell className="font-mono text-xs">{entry.userId.slice(-8)}</TableCell>
                                            <TableCell className="font-mono text-[11px] text-muted-foreground">{entry.sourceId.slice(0, 18)}</TableCell>
                                            <TableCell className="text-xs">{entry.rewardType}</TableCell>
                                            <TableCell className="text-right font-mono text-xs">{entry.amount}</TableCell>
                                            <TableCell>
                                                <Badge variant={entry.status === "GRANTED" ? "success" : entry.status === "REVOKED" ? "destructive" : "secondary"}>
                                                    {entry.status}
                                                </Badge>
                                            </TableCell>
                                            <TableCell className="font-mono text-[11px] text-muted-foreground">
                                                {new Date(entry.createdAt).toLocaleString()}
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        </div>
                        <p className="border-t border-border px-4 py-2 text-[11px] text-muted-foreground">
                            Ledger entries are immutable and idempotent (deterministic ids). Admin UI cannot configure or grant CASH rewards — that
                            flag is env-only and cash is rejected server-side.
                        </p>
                    </div>
                </div>
            ) : null}

            {!loading && tab === "fraud" ? (
                <div className="rounded-lg border border-border bg-card">
                    {flags.length === 0 ? (
                        <p className="p-6 text-center text-sm text-muted-foreground">No fraud flags recorded. 🎉</p>
                    ) : (
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Type</TableHead>
                                    <TableHead>Severity</TableHead>
                                    <TableHead>User</TableHead>
                                    <TableHead>Detail</TableHead>
                                    <TableHead>Status</TableHead>
                                    <TableHead className="text-right">Actions</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {flags.map((flag) => (
                                    <TableRow key={flag.flagId}>
                                        <TableCell className="font-mono text-xs">{flag.type}</TableCell>
                                        <TableCell>
                                            <Badge variant={flag.severity === "high" ? "destructive" : flag.severity === "medium" ? "warning" : "secondary"}>
                                                {flag.severity}
                                            </Badge>
                                        </TableCell>
                                        <TableCell className="font-mono text-xs">{flag.userId.slice(-8)}</TableCell>
                                        <TableCell className="max-w-md text-xs text-muted-foreground">{flag.detail}</TableCell>
                                        <TableCell><Badge variant="outline">{flag.status}</Badge></TableCell>
                                        <TableCell className="text-right">
                                            <div className="flex justify-end gap-1">
                                                <Button size="xs" variant="outline" disabled={busy || flag.status !== "OPEN"} onClick={() => void resolveFlag(flag.flagId, "REVIEWED")}>
                                                    Review
                                                </Button>
                                                <Button size="xs" variant="outline" disabled={busy || flag.status !== "OPEN"} onClick={() => void resolveFlag(flag.flagId, "DISMISSED")}>
                                                    Dismiss
                                                </Button>
                                            </div>
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    )}
                    <p className="border-t border-border px-4 py-2 text-[11px] text-muted-foreground">
                        <Flame className="mr-1 inline h-3 w-3" />
                        Flags are review signals stored separately from performance data — they never alter challenge accounting automatically.
                    </p>
                </div>
            ) : null}
        </AdminShell>
    );
}

function Stat({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
    return (
        <div className="rounded-lg border border-border bg-card p-3">
            <p className="text-[11px] text-muted-foreground">{label}</p>
            <p className="font-mono text-lg font-semibold tabular-nums">{value}</p>
            {sub ? <p className="text-[11px] text-muted-foreground">{sub}</p> : null}
        </div>
    );
}
