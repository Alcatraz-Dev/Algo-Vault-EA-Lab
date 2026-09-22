"use client";

import { useState } from "react";
import Link from "next/link";
import {
    Plug,
    Puzzle,
    Sparkles,
    CheckCircle2,
    AlertCircle,
    Loader2,
    Trash2,
    Copy,
    Edit,
    ChevronDown,
    ChevronUp,
    Search,
    Filter,
    ExternalLink,
    Settings2,
    Play,
} from "lucide-react";
import AdminShell from "@/components/admin/AdminShell";
import { StatusBadge } from "@/components/ui/status-badge";
import { onValue, ref } from "firebase/database";
import { database } from "@/lib/firebase";
import { useEffect } from "react";
import { PluginRecord, PluginStatus, PluginCategory, ExtensionRecord } from "@/lib/plugins/types";
import { CATEGORIES, CATEGORY_LABELS, formatPrice, grantedPermissions, pluginStatusTone } from "@/lib/plugins/ui";

export default function AdminPluginsPage() {
    const [plugins, setPlugins] = useState<PluginRecord[]>([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState("");
    const [filterStatus, setFilterStatus] = useState<string>("all");
    const [filterCategory, setFilterCategory] = useState<string>("all");
    const [filterType, setFilterType] = useState<string>("all");
    const [expanded, setExpanded] = useState<string | null>(null);

    useEffect(() => {
        const pluginsRef = ref(database, "plugins");
        const unsubscribe = onValue(
            pluginsRef,
            (snapshot) => {
                const data = snapshot.val() as Record<string, PluginRecord> | null;
                if (!data) {
                    setPlugins([]);
                    setLoading(false);
                    return;
                }
                const list = Object.values(data).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
                setPlugins(list);
                setLoading(false);
            },
            () => setLoading(false)
        );
        return () => unsubscribe();
    }, []);

    const filtered = plugins.filter((p) => {
        const matchesSearch = !search ||
            p.displayName?.toLowerCase().includes(search.toLowerCase()) ||
            p.description?.toLowerCase().includes(search.toLowerCase()) ||
            p.id?.toLowerCase().includes(search.toLowerCase());
        const matchesStatus = filterStatus === "all" || p.status === filterStatus;
        const matchesCategory = filterCategory === "all" || p.category === filterCategory;
        const matchesType = filterType === "all" || p.type === filterType;
        return matchesSearch && matchesStatus && matchesCategory && matchesType;
    });

    return (
        <AdminShell
            title="Plugin Catalog"
            subtitle="Manage all plugins and extensions in the marketplace."
        >
            <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                <div className="relative w-full max-w-md">
                    <Search size={17} className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground" />
                    <input
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder="Search plugins..."
                        className="w-full rounded-xl border border-border/30 bg-muted py-3 pl-11 pr-4 text-sm outline-none placeholder:text-muted-foreground focus:border-border/50"
                    />
                </div>
                <div className="flex flex-wrap items-center gap-2">
                    <select
                        value={filterType}
                        onChange={(e) => setFilterType(e.target.value)}
                        className="rounded-xl border border-border/30 bg-muted px-4 py-2.5 text-xs outline-none"
                    >
                        <option value="all">All Types</option>
                        <option value="plugin">Plugins</option>
                        <option value="extension">Extensions</option>
                    </select>
                    <select
                        value={filterStatus}
                        onChange={(e) => setFilterStatus(e.target.value)}
                        className="rounded-xl border border-border/30 bg-muted px-4 py-2.5 text-xs outline-none"
                    >
                        <option value="all">All Statuses</option>
                        {(["draft", "testing", "pending_review", "published", "disabled"] as PluginStatus[]).map((s) => (
                            <option key={s} value={s}>{s}</option>
                        ))}
                    </select>
                    <select
                        value={filterCategory}
                        onChange={(e) => setFilterCategory(e.target.value)}
                        className="rounded-xl border border-border/30 bg-muted px-4 py-2.5 text-xs outline-none"
                    >
                        <option value="all">All Categories</option>
                        {CATEGORIES.map((c) => (
                            <option key={c.id} value={c.id}>{c.label}</option>
                        ))}
                    </select>
                </div>
            </div>

            {loading ? (
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                    {[1, 2, 3].map((n) => (
                        <div key={n} className="h-40 animate-pulse rounded-2xl border border-border/30 bg-muted/50" />
                    ))}
                </div>
            ) : filtered.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-border/30 bg-muted/50 px-6 py-20 text-center">
                    <Plug size={40} className="mx-auto text-muted-foreground" />
                    <h3 className="mt-3 text-lg font-medium">No plugins found</h3>
                    <p className="mt-1 text-sm text-muted-foreground">Try adjusting your filters or search query.</p>
                </div>
            ) : (
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                    {filtered.map((plugin) => (
                        <PluginCard
                            key={plugin.id}
                            plugin={plugin}
                            isExpanded={expanded === plugin.id}
                            onToggle={() => setExpanded(expanded === plugin.id ? null : plugin.id)}
                        />
                    ))}
                </div>
            )}
        </AdminShell>
    );
}

function PluginCard({
    plugin,
    isExpanded,
    onToggle,
}: {
    plugin: PluginRecord;
    isExpanded: boolean;
    onToggle: () => void;
}) {
    const perms = grantedPermissions(plugin.permissions);
    const isFree = plugin.pricing?.type === "free";
    const isExtension = plugin.type === "extension";
    const extType = (plugin as ExtensionRecord).extensionType;

    return (
        <div className="rounded-2xl border border-border/30 bg-muted/50 overflow-hidden transition hover:border-border/50">
            <div className="p-5">
                <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-4">
                        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-border/30 bg-muted/5">
                            {isExtension ? (
                                <Puzzle size={20} className="text-amber-300" />
                            ) : (
                                <Plug size={20} className="text-violet-300" />
                            )}
                        </div>
                        <div className="min-w-0">
                            <div className="flex items-center gap-2">
                                <Link
                                    href={`/admin/intelligence/plugins/${plugin.id}`}
                                    className="text-sm font-semibold text-foreground transition hover:text-violet-300 truncate"
                                >
                                    {plugin.displayName}
                                </Link>
                                <StatusBadge tone={pluginStatusTone(plugin.status)} label={plugin.status} />
                                {isExtension && (
                                    <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium text-amber-300">
                                        {extType}
                                    </span>
                                )}
                            </div>
                            <p className="mt-1 max-w-xl text-xs text-muted-foreground truncate">{plugin.description}</p>
                            <div className="mt-2 flex items-center gap-2 text-[11px] text-muted-foreground">
                                <span>v{plugin.version}</span>
                                <span className="text-muted-foreground/30">•</span>
                                <span className="rounded-full bg-muted px-2 py-0.5">{CATEGORY_LABELS[plugin.category] || plugin.category}</span>
                                <span className="text-muted-foreground/30">•</span>
                                <span>{formatPrice(plugin.pricing?.price, plugin.pricing?.currency)}</span>
                                <span className="text-muted-foreground/30">•</span>
                                <span>Interval: {plugin.manifest?.runtime?.interval || "manual"}</span>
                            </div>
                        </div>
                    </div>
                    <button
                        onClick={onToggle}
                        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-border/30 bg-muted/5 transition hover:bg-muted/10"
                    >
                        {isExpanded ? <ChevronUp size={16} className="text-muted-foreground" /> : <ChevronDown size={16} className="text-muted-foreground" />}
                    </button>
                </div>

                {isExpanded && (
                    <div className="mt-4 rounded-xl border border-border/30 bg-muted/30 p-4">
                        <div className="grid gap-3 md:grid-cols-2">
                            <DetailRow label="ID" value={plugin.id} copyable />
                            <DetailRow label="Slug" value={plugin.slug || plugin.id} copyable />
                            <DetailRow label="Type" value={plugin.type} />
                            <DetailRow label="Category" value={plugin.category} />
                            <DetailRow label="Created" value={plugin.createdAt ? new Date(plugin.createdAt).toLocaleString() : "—"} />
                            <DetailRow label="Updated" value={plugin.updatedAt ? new Date(plugin.updatedAt).toLocaleString() : "—"} />
                            <DetailRow label="Created By" value={plugin.creator?.name || plugin.creator?.uid || "admin"} />
                            <DetailRow label="AI Generated" value={plugin.isAIGenerated ? "yes" : "no"} />
                            <DetailRow
                                label="Permissions"
                                value={perms.join(", ") || "none"}
                            />
                            <DetailRow
                                label="Capabilities"
                                value={plugin.capabilities?.join(", ") || "none"}
                            />
                            <DetailRow
                                label="Supported Markets"
                                value={plugin.supportedMarkets?.join(", ") || "any"}
                            />
                            <DetailRow
                                label="Handler"
                                value={plugin.manifest?.runtime?.handler || "declarative"}
                            />
                        </div>
                        {plugin.documentation && (
                            <div className="mt-4">
                                <h5 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Documentation</h5>
                                <pre className="text-xs bg-background/50 p-3 rounded text-foreground whitespace-pre-wrap line-clamp-4">{plugin.documentation}</pre>
                            </div>
                        )}
                        <div className="mt-4 flex flex-wrap items-center gap-2">
                            <Link
                                href={`/admin/intelligence/plugins/${plugin.id}`}
                                className="inline-flex items-center gap-1.5 rounded-xl bg-background px-3 py-2 text-xs font-medium text-foreground transition hover:bg-muted"
                            >
                                <Edit size={13} />
                                Edit
                            </Link>
                            <Link
                                href={`/marketplace/${isExtension ? "extensions" : "plugins"}/${plugin.slug || plugin.id}`}
                                target="_blank"
                                className="inline-flex items-center gap-1.5 rounded-xl border border-border/30 bg-muted/5 px-3 py-2 text-xs font-medium text-muted-foreground transition hover:text-foreground"
                            >
                                <ExternalLink size={13} />
                                View in Marketplace
                            </Link>
                            <Link
                                href={`/api/plugins/${plugin.id}`}
                                target="_blank"
                                className="inline-flex items-center gap-1.5 rounded-xl border border-border/30 bg-muted/5 px-3 py-2 text-xs font-medium text-muted-foreground transition hover:text-foreground"
                            >
                                <Copy size={13} />
                                Copy API
                            </Link>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}

function DetailRow({ label, value, copyable = false }: { label: string; value: string; copyable?: boolean }) {
    return (
        <div className="flex flex-col gap-1">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</span>
            <div className="flex items-center gap-2">
                <code className="flex-1 text-xs bg-background/50 px-2 py-1 rounded text-foreground break-all">{value}</code>
                {copyable && (
                    <button
                        onClick={() => navigator.clipboard.writeText(value)}
                        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-border/30 bg-muted/5 transition hover:bg-muted/10"
                        title="Copy"
                    >
                        <Copy size={12} className="text-muted-foreground" />
                    </button>
                )}
            </div>
        </div>
    );
}