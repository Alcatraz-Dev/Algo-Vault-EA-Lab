"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
    ArrowLeft,
    ArrowRight,
    Braces,
    Cable,
    CheckCircle2,
    Globe,
    LayoutGrid,
    Plug,
    Puzzle,
    Search,
    Shield,
    Sparkles,
} from "lucide-react";
import { onValue, ref } from "firebase/database";
import { database } from "@/lib/firebase";
import { PluginRecord } from "@/lib/plugins/types";
import { CATEGORY_LABELS, EXTENSION_TYPE_LABELS, grantedPermissions, permissionLabel } from "@/lib/plugins/ui";
import { StatusBadge } from "@/components/ui/status-badge";

const EXT_TYPE_ICONS: Record<string, React.ReactNode> = {
    webhook: <Cable size={20} className="text-emerald-300" />,
    telegram: <Globe size={20} className="text-sky-300" />,
    discord: <Globe size={20} className="text-indigo-300" />,
    browser: <Globe size={20} className="text-amber-300" />,
    tradingview: <Braces size={20} className="text-cyan-300" />,
    api: <Cable size={20} className="text-violet-300" />,
};

export default function ExtensionsMarketplacePage() {
    const [extensions, setExtensions] = useState<PluginRecord[]>([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState("");

    useEffect(() => {
        const pluginsRef = ref(database, "plugins");
        const unsubscribe = onValue(
            pluginsRef,
            (snapshot) => {
                const data = snapshot.val() as Record<string, PluginRecord> | null;
                if (!data) {
                    setExtensions([]);
                    setLoading(false);
                    return;
                }
                const list = Object.values(data)
                    .filter((p) => p && p.type === "extension" && p.status === "published")
                    .sort((a, b) => (b.installs || 0) - (a.installs || 0));
                setExtensions(list);
                setLoading(false);
            },
            () => setLoading(false)
        );
        return () => unsubscribe();
    }, []);

    const filtered = useMemo(() => {
        const query = search.trim().toLowerCase();
        return extensions.filter(
            (e) =>
                !query ||
                e.displayName?.toLowerCase().includes(query) ||
                e.description?.toLowerCase().includes(query) ||
                EXTENSION_TYPE_LABELS[(e as PluginRecord & { extensionType?: string }).extensionType || ""]
                    ?.toLowerCase()
                    .includes(query)
        );
    }, [extensions, search]);

    return (
        <main className="min-h-screen bg-background text-foreground">
            <section className="border-b border-border/30">
                <div className="mx-auto max-w-7xl px-6 py-10">
                    <Link
                        href="/marketplace"
                        className="mb-6 inline-flex items-center gap-2 text-sm text-muted-foreground transition hover:text-foreground"
                    >
                        <ArrowLeft size={16} />
                        Back to Marketplace
                    </Link>

                    <div className="flex flex-col gap-8 lg:flex-row lg:items-end lg:justify-between">
                        <div className="max-w-2xl">
                            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-emerald-400">
                                <Sparkles size={14} />
                                Plugins &amp; Extensions Ecosystem
                            </div>
                            <h1 className="mt-3 text-4xl font-semibold tracking-tight md:text-5xl">
                                Extensions that connect
                                <br />
                                AlgoVault to your workflow.
                            </h1>
                            <p className="mt-5 max-w-xl text-sm leading-7 text-muted-foreground">
                                Deliver plugin intelligence to the tools you already use — Telegram,
                                Discord, webhooks, your browser and TradingView. Extensions reuse your
                                existing AlgoVault connections; no separate accounts required.
                            </p>
                            <div className="mt-6 grid max-w-md grid-cols-3 gap-3">
                                <MiniStat icon={<Puzzle size={15} />} value={extensions.length} label="Extensions" />
                                <MiniStat icon={<CheckCircle2 size={15} />} value={extensions.filter((e) => e.pricing?.type === "free").length} label="Free" />
                                <MiniStat icon={<Cable size={15} />} value={extensions.filter((e) => (e.installs || 0) > 0).length} label="In use" />
                            </div>
                        </div>

                        <div className="flex flex-col gap-3 sm:flex-row">
                            <HubLink href="/marketplace" title="Trading Tools" subtitle="EAs, indicators & strategies" icon={<Braces size={18} />} />
                            <HubLink href="/marketplace/plugins" title="Plugins" subtitle="Background intelligence agents" icon={<Plug size={18} />} />
                            <HubLink href="/marketplace/extensions" title="Extensions" subtitle="Connect outside tools" icon={<Puzzle size={18} />} active />
                        </div>
                    </div>
                </div>
            </section>

            <section className="mx-auto max-w-7xl px-6 py-8">
                <div className="mb-5 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                    <div className="relative w-full max-w-md">
                        <Search size={17} className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground" />
                        <input
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            placeholder="Search extensions..."
                            className="w-full rounded-xl border border-border/30 bg-muted py-3 pl-11 pr-4 text-sm outline-none placeholder:text-muted-foreground focus:border-border/50"
                        />
                    </div>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <LayoutGrid size={14} />
                        {filtered.length} {filtered.length === 1 ? "extension" : "extensions"}
                    </div>
                </div>

                {loading && (
                    <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
                        {[1, 2, 3].map((item) => (
                            <div key={item} className="h-72 animate-pulse rounded-2xl border border-border/30 bg-muted/50" />
                        ))}
                    </div>
                )}

                {!loading && filtered.length === 0 && (
                    <div className="rounded-2xl border border-dashed border-border/30 bg-muted/50 px-6 py-20 text-center">
                        <Puzzle size={40} className="mx-auto text-muted-foreground" />
                        <h2 className="mt-5 text-lg font-medium">No extensions found</h2>
                        <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-muted-foreground">
                            Try another search. Published extensions will appear here automatically.
                        </p>
                    </div>
                )}

                {!loading && filtered.length > 0 && (
                    <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
                        {filtered.map((extension) => (
                            <ExtensionCard key={extension.id} extension={extension} />
                        ))}
                    </div>
                )}

                <div className="mt-10 rounded-2xl border border-border/30 bg-muted/50 p-5">
                    <div className="flex gap-3">
                        <Shield size={18} className="mt-0.5 shrink-0 text-muted-foreground" />
                        <p className="text-xs leading-6 text-muted-foreground">
                            Extensions only bridge data you already have with AlgoVault&apos;s existing
                            Telegram, Discord and webhook infrastructure — they never request or store
                            credentials, and each one declares exactly which capabilities it uses.
                        </p>
                    </div>
                </div>
            </section>
        </main>
    );
}

function HubLink({
    href,
    title,
    subtitle,
    icon,
    active = false,
}: {
    href: string;
    title: string;
    subtitle: string;
    icon: React.ReactNode;
    active?: boolean;
}) {
    return (
        <Link
            href={href}
            className={`w-full rounded-2xl border p-4 transition sm:w-56 ${
                active ? "border-emerald-500/40 bg-emerald-500/10" : "border-border/30 bg-muted/50 hover:border-border/50"
            }`}
        >
            <div className="flex items-center gap-2 text-sm font-medium">
                {icon}
                {title}
            </div>
            <p className="mt-1 text-[11px] leading-5 text-muted-foreground">{subtitle}</p>
        </Link>
    );
}

function ExtensionCard({ extension }: { extension: PluginRecord }) {
    const typed = extension as PluginRecord & { extensionType?: string };
    const extType = typed.extensionType || "browser";
    const perms = grantedPermissions(extension.permissions);
    return (
        <article className="group flex flex-col overflow-hidden rounded-2xl border border-border/30 bg-muted/50 transition hover:border-border/50 hover:bg-foreground/8">
            <div className="relative h-44 overflow-hidden border-b border-border/30 bg-gradient-to-br from-background via-muted to-foreground">
                <div className="absolute -left-10 -top-10 h-40 w-40 rounded-full bg-emerald-500/10 blur-3xl" />
                <div className="absolute bottom-0 right-0 h-40 w-40 rounded-full bg-cyan-500/10 blur-3xl" />
                <div className="relative z-10 flex h-full flex-col justify-between p-5">
                    <div className="flex items-start justify-between gap-3">
                        <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-border/50 bg-background/75 shadow-xl backdrop-blur-xl">
                            {EXT_TYPE_ICONS[extType] || <Puzzle size={20} />}
                        </div>
                        <span className="rounded-lg border border-border/30 bg-background/70 px-2.5 py-1 text-[11px] font-medium tracking-wide shadow-lg backdrop-blur-md">
                            {EXTENSION_TYPE_LABELS[extType]}
                        </span>
                    </div>
                    <div>
                        <span className="inline-block text-[10px] font-semibold uppercase tracking-wider text-emerald-400">
                            Extension
                        </span>
                        <h2 className="mt-0.5 line-clamp-1 text-lg font-semibold text-foreground drop-shadow-md transition group-hover:text-emerald-300">
                            {extension.displayName}
                        </h2>
                        <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
                            <span>v{extension.version}</span>
                            <span className="text-muted-foreground/30">•</span>
                            <span>{extension.installs || 0} installs</span>
                            <span className="text-muted-foreground/30">•</span>
                            <span>{CATEGORY_LABELS[extension.category]}</span>
                        </div>
                    </div>
                </div>
            </div>

            <div className="flex flex-1 flex-col p-5">
                <p className="min-h-[72px] text-sm leading-6 text-muted-foreground line-clamp-3">{extension.description}</p>

                <div className="mt-4 flex flex-wrap gap-2">
                    {perms.slice(0, 3).map((p) => (
                        <span key={p} className="rounded-lg bg-muted/5 px-2.5 py-1 text-[11px] text-muted-foreground">
                            {permissionLabel(p)}
                        </span>
                    ))}
                    {perms.length > 3 && (
                        <span className="rounded-lg bg-muted/5 px-2.5 py-1 text-[11px] text-muted-foreground">
                            +{perms.length - 3} more
                        </span>
                    )}
                </div>

                <div className="mt-5 flex items-center gap-2">
                    <StatusBadge tone="positive" label={extension.pricing?.type === "free" ? "Free" : "Paid"} />
                    <StatusBadge tone="live" label="Published" dot />
                </div>

                <div className="mt-5 flex items-center justify-between border-t border-border/30 pt-5">
                    <p className="text-[11px] text-muted-foreground">
                        {(extension.capabilities || []).length || 0} capabilities
                    </p>
                    <Link
                        href={`/marketplace/extensions/${extension.slug || extension.id}`}
                        className="flex items-center gap-2 rounded-xl bg-background px-4 py-2.5 text-xs font-medium text-foreground transition hover:bg-muted"
                    >
                        View Extension <ArrowRight size={14} />
                    </Link>
                </div>
            </div>
        </article>
    );
}

function MiniStat({ icon, value, label }: { icon: React.ReactNode; value: number; label: string }) {
    return (
        <div className="min-w-[90px] rounded-xl border border-border/30 bg-muted/50 p-3">
            <div className="flex items-center gap-2 text-muted-foreground">
                {icon}
                <span className="text-xs">{label}</span>
            </div>
            <p className="mt-2 text-lg font-semibold">{value}</p>
        </div>
    );
}