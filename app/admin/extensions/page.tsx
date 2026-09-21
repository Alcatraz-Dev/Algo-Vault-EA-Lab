"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, ExternalLink, Loader2, Puzzle, RefreshCw, Settings2, Sparkles, Trash2 } from "lucide-react";
import AdminShell from "@/components/admin/AdminShell";
import { StatusBadge } from "@/components/ui/status-badge";
import { EmptyState } from "@/components/ui/empty-state";
import { auth } from "@/lib/firebase";
import { PluginRecord } from "@/lib/plugins/types";
import { EXTENSION_TYPE_LABELS, formatNumber, pluginStatusTone } from "@/lib/plugins/ui";

function getToken() {
    const user = auth.currentUser;
    if (!user) throw new Error("Authentication required.");
    return user.getIdToken();
}

export default function AdminExtensionsPage() {
    const [extensions, setExtensions] = useState<PluginRecord[]>([]);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState("");
    const [deletingId, setDeletingId] = useState("");

    const load = useCallback(async () => {
        setLoading(true);
        setLoadError("");
        try {
            const token = await getToken();
            const res = await fetch("/api/admin/extensions", { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
            if (!res.ok) throw new Error(((await res.json()) as { error?: string })?.error ?? "Unable to load extensions.");
            const data = await res.json();
            setExtensions(Array.isArray(data.extensions) ? data.extensions : []);
        } catch (err) {
            setLoadError(err instanceof Error ? err.message : "Unable to load extensions.");
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        load();
    }, [load]);

    async function deleteExtension(ext: PluginRecord) {
        const name = ext.displayName || ext.id;
        if (!window.confirm(`Delete "${name}"?\n\nThis removes the catalog record and every installation, config, runtime state, execution log and alert tied to it. Licenses and order history are kept for financial integrity. This cannot be undone.`)) return;
        setDeletingId(ext.id);
        setLoadError("");
        try {
            const token = await getToken();
            const res = await fetch(`/api/admin/plugins/${ext.id}`, {
                method: "DELETE",
                headers: { Authorization: `Bearer ${token}` },
            });
            const json = await res.json();
            if (!res.ok) throw new Error(json?.error ?? "Delete failed.");
            setExtensions((prev) => prev.filter((e) => e.id !== ext.id));
        } catch (err) {
            setLoadError(err instanceof Error ? err.message : "Delete failed.");
        } finally {
            setDeletingId("");
        }
    }

    return (
        <AdminShell title="Extensions" subtitle="Extension records in the catalog — browser, TradingView, webhook, chat and API.">
            <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
                <Link href="/admin/plugins" className="inline-flex items-center gap-1.5 text-xs text-muted-foreground transition hover:text-foreground">
                    <ArrowLeft size={14} /> Back to Plugins
                </Link>
                <div className="flex flex-wrap items-center gap-2">
                    <Link href="/admin/plugins/create?type=extension" className="inline-flex items-center gap-2 rounded-xl bg-background px-4 py-2.5 text-xs font-medium text-foreground transition hover:bg-muted">
                        <Puzzle size={14} /> New Extension
                    </Link>
                    <Link href="/admin/plugins/ai-studio" className="inline-flex items-center gap-2 rounded-xl border border-border/30 bg-muted/5 px-4 py-2.5 text-xs font-medium text-muted-foreground transition hover:text-foreground">
                        <Sparkles size={14} /> AI Generate
                    </Link>
                </div>
            </div>

            {loadError && (
                <div className="mb-5 flex items-start justify-between gap-3 rounded-2xl border border-red-500/30 bg-red-500/10 p-4">
                    <p className="text-sm text-red-300">{loadError}</p>
                    <button type="button" onClick={load} className="inline-flex items-center gap-1.5 rounded-lg border border-red-500/30 px-3 py-1.5 text-xs text-red-300 transition hover:bg-red-500/20">
                        <RefreshCw size={12} /> Retry
                    </button>
                </div>
            )}

            {loading ? (
                <div className="grid gap-3">
                    {[1, 2, 3].map((n) => (
                        <div key={n} className="h-20 animate-pulse rounded-2xl border border-border/30 bg-muted/50" />
                    ))}
                </div>
            ) : extensions.length === 0 ? (
                <EmptyState
                    icon={<Puzzle size={18} />}
                    title="No extensions in the catalog"
                    description="Seed the built-in catalog from the Plugins page, or create extensions through the AI Plugin Studio."
                    action={
                        <div className="flex flex-wrap items-center justify-center gap-2">
                            <Link href="/admin/plugins" className="inline-flex items-center gap-2 rounded-xl bg-background px-4 py-2.5 text-xs font-medium text-foreground transition hover:bg-muted">
                                Go to Plugins
                            </Link>
                            <Link href="/admin/plugins/ai-studio" className="inline-flex items-center gap-2 rounded-xl border border-border/30 bg-muted/5 px-4 py-2.5 text-xs font-medium text-muted-foreground transition hover:text-foreground">
                                AI Plugin Studio
                            </Link>
                        </div>
                    }
                />
            ) : (
                <div className="overflow-hidden rounded-2xl border border-border/30 bg-muted/50">
                    <div className="overflow-x-auto">
                        <table className="w-full text-left">
                            <thead>
                                <tr className="border-b border-border/30 text-[11px] uppercase tracking-wide text-muted-foreground">
                                    <th className="px-4 py-3">Extension</th>
                                    <th className="px-4 py-3">Type</th>
                                    <th className="px-4 py-3">Status</th>
                                    <th className="px-4 py-3">Version</th>
                                    <th className="px-4 py-3">Installs</th>
                                    <th className="px-4 py-3">Active</th>
                                    <th className="px-4 py-3 text-right">Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                {extensions.map((ext) => {
                                    const type = (ext as PluginRecord & { extensionType?: string }).extensionType || "browser";
                                    return (
                                        <tr key={ext.id} className="border-b border-border/20 last:border-0 hover:bg-muted/20">
                                            <td className="px-4 py-3">
                                                <p className="text-sm font-medium text-foreground">{ext.displayName}</p>
                                                <p className="text-[11px] text-muted-foreground">{ext.id}</p>
                                            </td>
                                            <td className="px-4 py-3">
                                                <span className="text-xs text-emerald-300">{EXTENSION_TYPE_LABELS[type] || type}</span>
                                            </td>
                                            <td className="px-4 py-3">
                                                <StatusBadge tone={pluginStatusTone(ext.status)} label={ext.status} dot />
                                            </td>
                                            <td className="px-4 py-3 text-xs text-muted-foreground">v{ext.version}</td>
                                            <td className="px-4 py-3 text-xs text-muted-foreground">{formatNumber(ext.installs)}</td>
                                            <td className="px-4 py-3 text-xs text-muted-foreground">{formatNumber(ext.activeUsers)}</td>
                                            <td className="px-4 py-3">
                                                <div className="flex items-center justify-end gap-2">
                                                    {ext.status === "published" && (
                                                        <Link href={`/marketplace/extensions/${ext.slug || ext.id}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 rounded-lg border border-border/30 px-2.5 py-2 text-xs text-muted-foreground transition hover:text-foreground">
                                                            View <ExternalLink size={11} />
                                                        </Link>
                                                    )}
                                                    <Link href={`/admin/plugins/${ext.id}`} className="inline-flex items-center gap-1.5 rounded-lg bg-background px-2.5 py-2 text-xs font-medium text-foreground transition hover:bg-muted">
                                                        Manage <Settings2 size={12} />
                                                    </Link>
                                                    <button
                                                        type="button"
                                                        disabled={deletingId === ext.id}
                                                        onClick={() => deleteExtension(ext)}
                                                        className="inline-flex items-center gap-1.5 rounded-lg border border-red-500/30 px-2.5 py-2 text-xs text-red-300 transition hover:bg-red-500/10 disabled:opacity-50"
                                                    >
                                                        {deletingId === ext.id ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
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