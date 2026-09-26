"use client";

/**
 * Admin — Account Health.
 *
 * Reads exclusively from the admin-only `/api/admin/account-health`, which
 * authenticates with the project's existing `requireAdmin`. No direct Realtime
 * Database access: routing through the server keeps user profile data out of the
 * browser and keeps uid/path construction server-side.
 *
 * ── No uid lookup required ────────────────────────────────────────────────────
 * The page loads the whole directory on mount, with each account already
 * resolved to its email and display name, and the operator filters and picks.
 * Requiring a typed email first meant the view was unusable unless you already
 * knew who you were looking for — which is the wrong default for a risk console.
 * The email/uid search is still there, but it filters what is already loaded
 * rather than being the only way in.
 *
 * ── Worst first ───────────────────────────────────────────────────────────────
 * The server sorts by risk so the accounts that need attention are at the top,
 * rather than in an alphabetical list where a blown account hides behind a name.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { RefreshCw, Search, Shield, Users } from "lucide-react";
import AdminShell from "@/components/admin/AdminShell";
import { AccountHealthReportView } from "@/components/account-health/report-view";
import { NoDataPill, StatusPill } from "@/components/account-health/status-pill";
import { adminFetch } from "@/components/growth/admin/session";
import { cn } from "@/lib/utils";
import type {
    AccountHealthDirectory,
    AccountHealthDirectoryEntry,
    AccountHealthReport,
    RiskLevel,
} from "@/lib/account-health/types";

type DetailResponse = {
    uid: string;
    email: string | null;
    displayName: string | null;
    health: AccountHealthReport;
};

function money(value: number, currency = "USD"): string {
    const symbol = currency === "USD" ? "$" : `${currency} `;
    return `${value < 0 ? "-" : ""}${symbol}${Math.abs(value).toLocaleString("en-US", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    })}`;
}

export default function AdminAccountHealthPage() {
    const [directory, setDirectory] = useState<AccountHealthDirectory | null>(null);
    const [listLoading, setListLoading] = useState(true);
    const [listError, setListError] = useState<string | null>(null);

    const [query, setQuery] = useState("");
    const [selected, setSelected] = useState<string | null>(null);
    const [detail, setDetail] = useState<DetailResponse | null>(null);
    const [detailLoading, setDetailLoading] = useState(false);

    const loadDirectory = useCallback(async () => {
        setListLoading(true);
        setListError(null);
        try {
            const res = await adminFetch<{ directory: AccountHealthDirectory }>("/api/admin/account-health");
            setDirectory(res.directory);
        } catch (e) {
            setListError(e instanceof Error ? e.message : "Failed to load accounts.");
        } finally { setListLoading(false); }
    }, []);

    // The directory is fetched on mount: the page's whole point is that an
    // operator lands on the accounts without having to search for one first.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    useEffect(() => { void loadDirectory(); }, [loadDirectory]);

    // Client-side filter only: the directory is already loaded, so this never
    // costs a request and never needs a round trip to type.
    const filtered = useMemo(() => {
        const all = directory?.accounts ?? [];
        const q = query.trim().toLowerCase();
        if (!q) return all;
        return all.filter((a) =>
            a.uid.toLowerCase().includes(q)
            || (a.email ?? "").toLowerCase().includes(q)
            || (a.displayName ?? "").toLowerCase().includes(q),
        );
    }, [directory, query]);

    const openAccount = useCallback(async (uid: string) => {
        setSelected(uid);
        setDetailLoading(true);
        setDetail(null);
        try {
            setDetail(await adminFetch<DetailResponse>(`/api/admin/account-health?uid=${encodeURIComponent(uid)}`));
        } catch {
            setDetail(null);
        } finally { setDetailLoading(false); }
    }, []);

    const t = directory?.totals;
    const d = directory?.distribution;

    return (
        <AdminShell title="Account Health" subtitle="Leverage safety, drawdown and exposure across every account.">
            <div className="space-y-3">
                {/* Summary strip */}
                <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-5">
                    <Stat label="Accounts" value={t ? String(t.accounts) : "—"} />
                    <Stat label="Active" value={t ? String(t.active) : "—"} />
                    <Stat label="High risk" value={t ? String(t.highRisk) : "—"} tone={t?.highRisk ? "negative" : undefined} />
                    <Stat label="Moderate" value={t ? String(t.moderateRisk) : "—"} tone={t?.moderateRisk ? "warning" : undefined} />
                    <Stat label="Low risk" value={t ? String(t.lowRisk) : "—"} tone={t?.lowRisk ? "positive" : undefined} />
                </div>

                {/* Risk distribution, drawn from the server-computed shares */}
                {d && t && t.active > 0 && (
                    <div className="rounded-2xl border border-border/30 bg-muted/50 p-3.5">
                        <div className="flex h-1.5 overflow-hidden rounded-full bg-muted/20">
                            {(["HIGH", "MODERATE", "LOW"] as RiskLevel[]).map((level) => {
                                const share = d[level];
                                if (share <= 0) return null;
                                return (
                                    <div
                                        key={level}
                                        className={cn(
                                            "h-full transition-[width] duration-700 ease-out",
                                            level === "HIGH" && "bg-rose-500",
                                            level === "MODERATE" && "bg-amber-500",
                                            level === "LOW" && "bg-emerald-500",
                                        )}
                                        style={{ width: `${share}%` }}
                                        title={`${level}: ${share}%`}
                                    />
                                );
                            })}
                        </div>
                        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-muted-foreground">
                            {(["HIGH", "MODERATE", "LOW"] as RiskLevel[]).map((level) => (
                                <span key={level} className="inline-flex items-center gap-1.5">
                                    <span
                                        className={cn(
                                            "h-1.5 w-1.5 rounded-full",
                                            level === "HIGH" && "bg-rose-500",
                                            level === "MODERATE" && "bg-amber-500",
                                            level === "LOW" && "bg-emerald-500",
                                        )}
                                    />
                                    {level.toLowerCase()} {d[level]}%
                                </span>
                            ))}
                        </div>
                    </div>
                )}

                {t?.allImpaired && (
                    <div className="rounded-2xl border border-rose-500/30 bg-rose-500/10 px-3.5 py-2.5 text-[11px] text-rose-400">
                        Every active account is rated HIGH risk. No account is currently in good standing.
                    </div>
                )}

                {listError && (
                    <div className="rounded-2xl border border-destructive/30 bg-destructive-muted px-3.5 py-2.5 text-[11px] text-destructive-foreground">
                        {listError}
                    </div>
                )}

                {/* Search + refresh */}
                <div className="flex flex-wrap items-center gap-2">
                    <div className="flex min-w-0 flex-1 items-center gap-2 rounded-xl border border-border/30 bg-muted/50 px-3 py-2">
                        <Search size={13} className="shrink-0 text-muted-foreground" />
                        <input
                            value={query}
                            onChange={(e) => setQuery(e.target.value)}
                            placeholder="Filter by email, name or uid"
                            aria-label="Filter accounts"
                            className="min-w-0 flex-1 bg-transparent text-[11px] text-foreground outline-none placeholder:text-muted-foreground"
                        />
                    </div>
                    <button
                        onClick={() => void loadDirectory()}
                        disabled={listLoading}
                        className="inline-flex items-center gap-1.5 rounded-xl border border-border/30 bg-muted/50 px-3 py-2 text-[11px] font-medium text-muted-foreground transition hover:text-foreground disabled:opacity-50"
                    >
                        <RefreshCw size={12} className={listLoading ? "animate-spin" : ""} /> Refresh
                    </button>
                </div>

                <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
                    {/* Account list */}
                    <div className="rounded-2xl border border-border/30 bg-muted/50">
                        <div className="flex items-center justify-between border-b border-border/20 px-3.5 py-2.5">
                            <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                                Accounts
                            </span>
                            <span className="text-[10px] text-muted-foreground">
                                {filtered.length}{directory ? ` of ${directory.totals.accounts}` : ""}
                            </span>
                        </div>

                        {listLoading && !directory && (
                            <div className="px-3.5 py-10 text-center text-[11px] text-muted-foreground">Loading accounts…</div>
                        )}

                        {!listLoading && filtered.length === 0 && (
                            <div className="px-3.5 py-10 text-center">
                                <Users size={22} className="mx-auto mb-2 text-muted-foreground" />
                                <p className="text-[11px] text-muted-foreground">
                                    {query ? "No account matches that filter." : "No accounts yet."}
                                </p>
                            </div>
                        )}

                        <div className="max-h-[560px] overflow-y-auto">
                            {filtered.map((account) => (
                                <AccountRow
                                    key={account.uid}
                                    account={account}
                                    active={account.uid === selected}
                                    onSelect={() => void openAccount(account.uid)}
                                />
                            ))}
                        </div>
                    </div>

                    {/* Detail */}
                    <div>
                        {detailLoading && (
                            <div className="rounded-2xl border border-border/30 bg-muted/50 px-3.5 py-12 text-center text-[11px] text-muted-foreground">
                                Loading account…
                            </div>
                        )}

                        {!detailLoading && detail && (
                            <AccountHealthReportView
                                health={detail.health}
                                compact
                                header={
                                    <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-border/30 bg-muted/50 px-3.5 py-2.5">
                                        <span className="text-[12px] font-medium text-foreground">
                                            {detail.displayName || detail.email || "Unnamed account"}
                                        </span>
                                        {detail.displayName && detail.email && (
                                            <span className="text-[10px] text-muted-foreground">{detail.email}</span>
                                        )}
                                        <span className="ml-auto font-mono text-[10px] text-muted-foreground">{detail.uid}</span>
                                    </div>
                                }
                            />
                        )}

                        {!detailLoading && !detail && (
                            <div className="rounded-2xl border border-border/30 bg-muted/50 px-3.5 py-12 text-center">
                                <Shield size={24} className="mx-auto mb-2 text-muted-foreground" />
                                <p className="text-[11px] font-medium text-foreground">Select an account</p>
                                <p className="mt-1 text-[10px] text-muted-foreground">
                                    Pick any account on the left to see its full report.
                                </p>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </AdminShell>
    );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "negative" | "warning" | "positive" }) {
    return (
        <div className="rounded-xl border border-border/30 bg-muted/50 px-3 py-2.5">
            <p className="text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
            <p
                className={cn(
                    "mt-1 font-mono text-base font-semibold tabular-nums",
                    tone === "negative" && "text-rose-400",
                    tone === "warning" && "text-amber-400",
                    tone === "positive" && "text-emerald-400",
                    !tone && "text-foreground",
                )}
            >
                {value}
            </p>
        </div>
    );
}

function AccountRow({ account, active, onSelect }: {
    account: AccountHealthDirectoryEntry;
    active: boolean;
    onSelect: () => void;
}) {
    return (
        <button
            type="button"
            onClick={onSelect}
            aria-current={active || undefined}
            className={cn(
                "flex w-full items-center gap-2.5 border-b border-border/15 px-3.5 py-2.5 text-left transition",
                active ? "bg-accent/10" : "hover:bg-muted/40",
            )}
        >
            <div className="min-w-0 flex-1">
                <p className="truncate text-[11px] font-medium text-foreground">
                    {account.displayName || account.email || account.uid}
                </p>
                <p className="truncate text-[10px] text-muted-foreground">
                    {account.email && account.displayName ? account.uid : account.email || account.uid}
                </p>
            </div>

            {/* Only a linked account with a real balance counts as active, so the
                counts here can never exceed the number of accounts shown as
                funded. */}
            {account.hasData && (
                <div className="hidden shrink-0 text-right sm:block">
                    <p className="font-mono text-[11px] tabular-nums text-foreground">
                        {money(account.balance, account.currency)}
                    </p>
                    <p className="text-[9px] uppercase tracking-wide text-muted-foreground">
                        {account.accounts > 1
                            ? `${account.accounts} accounts`
                            : account.connected ? "connected" : "balance"}
                    </p>
                </div>
            )}

            {account.hasData && account.totalPositions > 0 && (
                <div className="hidden shrink-0 text-right md:block">
                    <p className="font-mono text-[11px] tabular-nums text-foreground">
                        {account.totalPositions}
                    </p>
                    <p className="text-[9px] uppercase tracking-wide text-muted-foreground">open</p>
                </div>
            )}

            <div className="shrink-0 text-right">
                <p
                    className={cn(
                        "font-mono text-[13px] font-semibold tabular-nums",
                        !account.hasData ? "text-muted-foreground"
                            : account.riskLevel === "HIGH" ? "text-rose-400"
                                : account.riskLevel === "MODERATE" ? "text-amber-400" : "text-emerald-400",
                    )}
                >
                    {account.hasData ? account.score : "—"}
                </p>
                <p className="text-[9px] uppercase tracking-wide text-muted-foreground">score</p>
            </div>

            <div className="shrink-0">
                {account.hasData
                    ? <StatusPill label="Risk" value={account.riskLevel} />
                    : <NoDataPill />}
            </div>
        </button>
    );
}
