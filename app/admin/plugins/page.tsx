"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
    CheckCircle2,
    Database,
    ExternalLink,
    LayoutGrid,
    Loader2,
    Plug,
    Plus,
    Puzzle,
    RefreshCw,
    Settings2,
    Sparkles,
    Star,
    Trash2,
    Users,
} from "lucide-react";
import AdminShell from "@/components/admin/AdminShell";
import { StatusBadge } from "@/components/ui/status-badge";
import { EmptyState } from "@/components/ui/empty-state";
import { auth } from "@/lib/firebase";
import { PluginRecord } from "@/lib/plugins/types";
import { CATEGORY_LABELS, EXTENSION_TYPE_LABELS, pluginFetchJSON, pluginStatusTone, formatNumber } from "@/lib/plugins/ui";

type Summary = {
    plugins: number;
    extensions: number;
    published: number;
    drafts: number;
    totalInstalls: number;
    totalActiveUsers: number;
};

type AdminPluginsData = {
    records: PluginRecord[];
    summary: Summary;
    drafts: Record<string, unknown>[];
    pendingReviews: number;
};

function getToken() {
    const user = auth.currentUser;
    if (!user) throw new Error("Authentication required.");
    return user.getIdToken();
}

export default function AdminPluginsPage() {
    const [data, setData] = useState<AdminPluginsData | null>(null);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState("");
    const [seeding, setSeeding] = useState(false);
    const [seedNotice, setSeedNotice] = useState("");
    const [deletingId, setDeletingId] = useState("");

    const load = useCallback(async () => {
        setLoading(true);
        setData(null);
        setLoadError("");
        try {
            const token = await getToken();
            const res = await fetch("/api/admin/plugins", { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
            if (!res.ok) throw new Error((await res.json())?.error ?? "Unable to load plugins.");
            setData(await res.json());
        } catch (err) {
            setLoadError(err instanceof Error ? err.message : "Unable to load plugins.");
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        void Promise.resolve().then(() => load());
    }, [load]);

    async function deleteRecord(record: PluginRecord) {
        const name = record.displayName || record.id;
        if (!window.confirm(`Delete "${name}"?\n\nThis removes the catalog record and every installation, config, runtime state, execution log and alert tied to it. Licenses and order history are kept for financial integrity. This cannot be undone.`)) return;
        setDeletingId(record.id);
        setLoadError("");
        try {
            const token = await getToken();
            const res = await fetch(`/api/admin/plugins/${record.id}`, {
                method: "DELETE",
                headers: { Authorization: `Bearer ${token}` },
            });
            const json = await res.json();
            if (!res.ok) throw new Error(json?.error ?? "Delete failed.");
            setSeedNotice(`Deleted "${name}" from the catalog.`);
            await load();
        } catch (err) {
            setLoadError(err instanceof Error ? err.message : "Delete failed.");
        } finally {
            setDeletingId("");
        }
    }

    function marketplaceUrl(record: PluginRecord): string {
        return record.type === "extension" ? `/marketplace/extensions/${record.slug || record.id}` : `/marketplace/plugins/${record.slug || record.id}`;
    }

    async function seedCatalog() {
        setSeeding(true);
        setSeedNotice("");
        try {
            const token = await getToken();
            const res = await fetch("/api/admin/plugins/seed", {
                method: "POST",
                headers: { Authorization: `Bearer ${token}` },
            });
            const json = await res.json();
            if (!res.ok) throw new Error(json?.error ?? "Seeding failed.");
            setSeedNotice(`Catalog seeded: ${json.seeded} new, ${json.updated} updated, ${json.unchanged} unchanged, ${json.categories} categories.`);
            await load();
        } catch (err) {
            setLoadError(err instanceof Error ? err.message : "Seeding failed.");
        } finally {
            setSeeding(false);
        }
    }

    const summary = data?.summary;
    const records = data?.records || [];
    const plugins = records.filter((r) => r.type === "plugin");
    const extensions = records.filter((r) => r.type === "extension");
    const pendingReviews = Number(data?.pendingReviews || 0);

    return (
        <AdminShell title="Plugins & Extensions" subtitle="Catalog administration, lifecycle and runtime control.">
            {loadError && (
                <div className="mb-5 flex items-start justify-between gap-3 rounded-2xl border border-red-500/30 bg-red-500/10 p-4">
                    <p className="text-sm text-red-300">{loadError}</p>
                    <button type="button" onClick={load} className="inline-flex items-center gap-1.5 rounded-lg border border-red-500/30 px-3 py-1.5 text-xs text-red-300 transition hover:bg-red-500/20">
                        <RefreshCw size={12} /> Retry
                    </button>
                </div>
            )}
            {seedNotice && (
                <div className="mb-5 flex items-start gap-3 rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm text-emerald-100">
                    <CheckCircle2 size={16} className="mt-0.5 shrink-0" />
                    {seedNotice}
                </div>
            )}

            {/* Summary */}
            <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
                <MetricCard icon={<Plug size={16} />} label="Plugins" value={summary ? String(summary.plugins) : "—"} />
                <MetricCard icon={<Puzzle size={16} />} label="Extensions" value={summary ? String(summary.extensions) : "—"} />
                <MetricCard icon={<CheckCircle2 size={16} />} label="Published" value={summary ? String(summary.published) : "—"} />
                <MetricCard icon={<Sparkles size={16} />} label="Drafts / testing" value={summary ? String(summary.drafts) : "—"} />
                <MetricCard icon={<LayoutGrid size={16} />} label="Total installs" value={summary ? formatNumber(summary.totalInstalls) : "—"} />
                <MetricCard icon={<Users size={16} />} label="Active users" value={summary ? formatNumber(summary.totalActiveUsers) : "—"} />
                <MetricCard icon={<Star size={16} />} label="Pending reviews" value={String(pendingReviews)} />
                <MetricCard icon={<Database size={16} />} label="Catalog records" value={String(records.length)} />
            </div>

            {/* Actions */}
            <div className="mb-6 flex flex-wrap items-center gap-2">
                <Link href="/admin/plugins/create" className="inline-flex items-center gap-2 rounded-xl bg-background px-4 py-2.5 text-xs font-medium text-foreground transition hover:bg-muted">
                    <Plus size={14} /> Create Plugin
                </Link>
                <Link href="/admin/plugins/ai-studio" className="inline-flex items-center gap-2 rounded-xl bg-background px-4 py-2.5 text-xs font-medium text-foreground transition hover:bg-muted">
                    <Sparkles size={14} /> AI Plugin Studio
                </Link>
                <Link href="/admin/extensions" className="inline-flex items-center gap-2 rounded-xl bg-background px-4 py-2.5 text-xs font-medium text-foreground transition hover:bg-muted">
                    <Puzzle size={14} /> Extensions
                </Link>
                <button
                    type="button"
                    onClick={seedCatalog}
                    disabled={seeding}
                    className="inline-flex items-center gap-2 rounded-xl border border-border/30 bg-muted/5 px-4 py-2.5 text-xs font-medium text-muted-foreground transition hover:text-foreground disabled:opacity-50"
                >
                    {seeding ? <Loader2 size={14} className="animate-spin" /> : <Database size={14} />}
                    {seeding ? "Seeding..." : "Seed built-in catalog"}
                </button>
            </div>

            {loading ? (
                <div className="grid gap-3">
                    {[1, 2, 3].map((n) => (
                        <div key={n} className="h-20 animate-pulse rounded-2xl border border-border/30 bg-muted/50" />
                    ))}
                </div>
            ) : records.length === 0 ? (
                <EmptyState
                    icon={<Plug size={18} />}
                    title="No catalog records yet"
                    description="Seed the built-in catalog below to load the 10 plugins and 5 extensions, then manage their lifecycle from here."
                />
            ) : (
                <div className="overflow-hidden rounded-2xl border border-border/30 bg-muted/50">
                    <div className="overflow-x-auto">
                        <table className="w-full text-left">
                            <thead>
                                <tr className="border-b border-border/30 text-[11px] uppercase tracking-wide text-muted-foreground">
                                    <th className="px-4 py-3">Record</th>
                                    <th className="px-4 py-3">Type</th>
                                    <th className="px-4 py-3">Status</th>
                                    <th className="px-4 py-3">Version</th>
                                    <th className="px-4 py-3">Price</th>
                                    <th className="px-4 py-3">Installs</th>
                                    <th className="px-4 py-3">Active</th>
                                    <th className="px-4 py-3">Rating</th>
                                    <th className="px-4 py-3 text-right">Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                {records.map((record) => {
                                    const extType = (record as PluginRecord & { extensionType?: string }).extensionType;
                                    return (
                                        <tr key={record.id} className="border-b border-border/20 last:border-0 hover:bg-muted/20">
                                            <td className="px-4 py-3">
                                                <p className="text-sm font-medium text-foreground">{record.displayName}</p>
                                                <p className="text-[11px] text-muted-foreground">{record.id}</p>
                                            </td>
                                            <td className="px-4 py-3">
                                                {record.type === "extension" ? (
                                                    <span className="text-xs text-emerald-300">{EXTENSION_TYPE_LABELS[extType || "browser"]}</span>
                                                ) : (
                                                    <span className="text-xs text-violet-300">{CATEGORY_LABELS[record.category]}</span>
                                                )}
                                            </td>
                                            <td className="px-4 py-3">
                                                <StatusBadge tone={pluginStatusTone(record.status)} label={record.status} dot />
                                            </td>
                                            <td className="px-4 py-3 text-xs text-muted-foreground">v{record.version}</td>
                                            <td className="px-4 py-3 text-xs text-muted-foreground">
                                                {record.pricing?.type === "free" ? "Free" : `${record.pricing?.currency?.toUpperCase() || "USD"} ${Number(record.pricing?.price || 0).toFixed(2)}`}
                                            </td>
                                            <td className="px-4 py-3 text-xs text-muted-foreground">{formatNumber(record.installs)}</td>
                                            <td className="px-4 py-3 text-xs text-muted-foreground">{formatNumber(record.activeUsers)}</td>
                                            <td className="px-4 py-3 text-xs text-muted-foreground">
                                                {record.rating?.count ? `${record.rating.average.toFixed(1)} (${record.rating.count})` : "—"}
                                            </td>
                                            <td className="px-4 py-3">
                                                <div className="flex items-center justify-end gap-2">
                                                    {record.status === "published" && (
                                                        <Link href={marketplaceUrl(record)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 rounded-lg border border-border/30 px-2.5 py-2 text-xs text-muted-foreground transition hover:text-foreground">
                                                            View <ExternalLink size={11} />
                                                        </Link>
                                                    )}
                                                    <Link href={`/admin/plugins/${record.id}`} className="inline-flex items-center gap-1.5 rounded-lg bg-background px-2.5 py-2 text-xs font-medium text-foreground transition hover:bg-muted">
                                                        Manage <Settings2 size={12} />
                                                    </Link>
                                                    <button
                                                        type="button"
                                                        disabled={deletingId === record.id}
                                                        onClick={() => deleteRecord(record)}
                                                        className="inline-flex items-center gap-1.5 rounded-lg border border-red-500/30 px-2.5 py-2 text-xs text-red-300 transition hover:bg-red-500/10 disabled:opacity-50"
                                                    >
                                                        {deletingId === record.id ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                                                        Delete
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

function MetricCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
    return (
        <div className="rounded-2xl border border-border/30 bg-muted/50 p-4">
            <div className="flex items-center gap-2 text-muted-foreground">
                {icon}
                <span className="text-[11px]">{label}</span>
            </div>
            <p className="mt-2 text-xl font-semibold">{value}</p>
        </div>
    );
}