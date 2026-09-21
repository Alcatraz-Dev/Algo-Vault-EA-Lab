"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import {
    ArrowLeft,
    Braces,
    Cable,
    CheckCircle2,
    Download,
    Globe,
    Plug,
    Puzzle,
    Settings2,
    Shield,
    ShieldCheck,
    Sparkles,
    Zap,
} from "lucide-react";
import { onValue, ref } from "firebase/database";
import { auth, database } from "@/lib/firebase";
import { PluginRecord } from "@/lib/plugins/types";
import { CATEGORY_LABELS, EXTENSION_TYPE_LABELS, grantedPermissions, permissionDescription, permissionLabel } from "@/lib/plugins/ui";
import { StatusBadge } from "@/components/ui/status-badge";

export default function ExtensionDetailsPage() {
    const router = useRouter();
    const params = useParams();
    const slug = Array.isArray(params.slug) ? params.slug[0] : params.slug;

    const [extension, setExtension] = useState<PluginRecord | null>(null);
    const [loading, setLoading] = useState(true);
    const [busy, setBusy] = useState(false);
    const [actionError, setActionError] = useState("");

    useEffect(() => {
        if (!slug) return;
        const pluginsRef = ref(database, "plugins");
        const unsubscribe = onValue(
            pluginsRef,
            (snapshot) => {
                const data = snapshot.val() as Record<string, PluginRecord> | null;
                const found = data
                    ? Object.values(data).find((p) => p && (p.slug === slug || p.id === slug) && p.type === "extension" && p.status === "published")
                    : undefined;
                setExtension(found || null);
                setLoading(false);
            },
            () => setLoading(false)
        );
        return () => unsubscribe();
    }, [slug]);

    async function handleInstall() {
        if (!extension) return;
        setBusy(true);
        setActionError("");
        try {
            const user = auth.currentUser;
            if (!user) {
                router.push(`/login?redirect=/marketplace/extensions/${extension.slug || extension.id}`);
                return;
            }
            const token = await user.getIdToken();
            const res = await fetch("/api/extensions/install", {
                method: "POST",
                headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
                body: JSON.stringify({ extensionId: extension.id }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data?.error || "Unable to install the extension.");
            router.push(`/account/plugins?installedExtension=${extension.id}`);
        } catch (err) {
            setActionError(err instanceof Error ? err.message : "Unable to install the extension.");
            setBusy(false);
        }
    }

    if (loading) {
        return (
            <main className="min-h-screen bg-background text-foreground">
                <div className="mx-auto max-w-7xl px-6 py-12">
                    <div className="h-8 w-32 animate-pulse rounded bg-muted/5" />
                    <div className="mt-10 grid gap-8 lg:grid-cols-[1fr_360px]">
                        <div className="h-[400px] animate-pulse rounded-2xl border border-border/30 bg-muted/50" />
                        <div className="h-[320px] animate-pulse rounded-2xl border border-border/30 bg-muted/50" />
                    </div>
                </div>
            </main>
        );
    }

    if (!extension) {
        return (
            <main className="flex min-h-screen items-center justify-center bg-background px-6 text-foreground">
                <div className="text-center">
                    <Puzzle size={45} className="mx-auto text-muted-foreground" />
                    <h1 className="mt-5 text-2xl font-semibold">Extension not found</h1>
                    <p className="mt-2 text-sm text-muted-foreground">
                        This extension may have been removed or is no longer published.
                    </p>
                    <Link
                        href="/marketplace/extensions"
                        className="mt-6 inline-flex items-center gap-2 rounded-xl bg-background px-5 py-3 text-sm font-medium text-foreground"
                    >
                        <ArrowLeft size={16} />
                        Back to Extensions
                    </Link>
                </div>
            </main>
        );
    }

    const typed = extension as PluginRecord & { extensionType?: string };
    const extType = typed.extensionType || "browser";
    const perms = grantedPermissions(extension.permissions);
    const needWebhook = extType === "webhook" || extType === "api";
    const needTarget = extType === "tradingview";

    return (
        <main className="min-h-screen bg-background text-foreground">
            <div className="border-b border-border/30">
                <div className="mx-auto max-w-7xl px-6 py-5">
                    <div className="flex items-center gap-3">
                        <Link href="/marketplace/extensions" className="inline-flex items-center gap-1.5 text-xs text-muted-foreground transition hover:text-foreground">
                            <ArrowLeft size={14} />
                            Extensions
                        </Link>
                        <span className="text-muted-foreground/30">•</span>
                        <Link href="/marketplace/plugins" className="inline-flex items-center gap-1.5 text-xs text-muted-foreground transition hover:text-foreground">
                            Plugins
                        </Link>
                    </div>
                </div>
            </div>

            <div className="mx-auto max-w-7xl px-6 py-10">
                <div className="overflow-hidden rounded-3xl border border-border/30 bg-muted/50">
                    <div className="relative h-52 overflow-hidden bg-gradient-to-br from-emerald-500/15 via-background to-foreground md:h-60">
                        <div className="absolute left-20 top-10 h-48 w-48 rounded-full bg-muted/10 blur-3xl" />
                        <div className="absolute right-20 bottom-0 h-56 w-56 rounded-full bg-emerald-500/10 blur-3xl" />
                        <div className="absolute inset-0 bg-gradient-to-t from-muted via-transparent to-transparent" />
                        <div className="absolute inset-x-0 bottom-0">
                            <div className="p-6 md:p-9">
                                <div className="flex items-end gap-5">
                                    <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-2xl border border-border/30 bg-card/60 shadow-2xl backdrop-blur-xl">
                                        <Zap size={32} className="text-emerald-300" />
                                    </div>
                                    <div>
                                        <div className="flex flex-wrap items-center gap-2">
                                            <span className="rounded-lg border border-border/30 bg-background/950 px-2.5 py-1 text-[11px] text-muted-foreground backdrop-blur-md">
                                                {EXTENSION_TYPE_LABELS[extType]}
                                            </span>
                                            <span className="rounded-lg border border-border/30 bg-background/950 px-2.5 py-1 text-[11px] text-muted-foreground backdrop-blur-md">
                                                {CATEGORY_LABELS[extension.category]}
                                            </span>
                                        </div>
                                        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-foreground drop-shadow-xl md:text-4xl">
                                            {extension.displayName}
                                        </h1>
                                        <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                                            <span>by {extension.creator?.name || "AlgoVault Team"}</span>
                                            <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-300">
                                                <ShieldCheck size={11} />
                                                Platform Official
                                            </span>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div className="p-7 md:p-9">
                        <div>
                            <h2 className="text-sm font-medium">About this extension</h2>
                            <p className="mt-3 max-w-4xl text-sm leading-7 text-muted-foreground">{extension.description}</p>
                        </div>

                        {(extension.capabilities?.length || 0) > 0 && (
                            <div className="mt-8">
                                <h2 className="text-sm font-medium">Capabilities</h2>
                                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                                    {(extension.capabilities || []).map((cap) => (
                                        <div key={cap} className="flex items-center gap-3 rounded-xl border border-border/30 bg-muted/20 p-3">
                                            <CheckCircle2 size={15} className="shrink-0 text-emerald-400" />
                                            <span className="text-sm text-muted-foreground">{cap}</span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        {extension.permissions && (
                            <div className="mt-8">
                                <h2 className="text-sm font-medium">Permissions</h2>
                                <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                                    {perms.map((permission) => (
                                        <div key={permission} className="rounded-xl border border-border/30 bg-muted/20 p-4">
                                            <p className="text-sm font-medium">{permissionLabel(permission)}</p>
                                            <p className="mt-1 text-xs leading-5 text-muted-foreground">{permissionDescription(permission)}</p>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        {extension.documentation && (
                            <div className="mt-8">
                                <h2 className="text-sm font-medium">Setup documentation</h2>
                                <div className="mt-3 max-w-3xl rounded-2xl border border-border/30 bg-muted/20 p-5">
                                    {extension.documentation.split("\n").map((line, i) => {
                                        if (line.startsWith("## ")) {
                                            return (
                                                <h3 key={i} className="mt-4 text-sm font-semibold text-foreground first:mt-0">
                                                    {line.replace(/^##\s+/, "")}
                                                </h3>
                                            );
                                        }
                                        if (line.startsWith("- ")) {
                                            return (
                                                <p key={i} className="mt-1 text-xs leading-6 text-muted-foreground">
                                                    • {line.replace(/^-\s+/, "")}
                                                </p>
                                            );
                                        }
                                        if (!line.trim()) return <div key={i} className="h-2" />;
                                        return (
                                            <p key={i} className="mt-1 text-xs leading-6 text-muted-foreground">
                                                {line}
                                            </p>
                                        );
                                    })}
                                </div>
                            </div>
                        )}
                    </div>
                </div>

                <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_360px]">
                    <section className="rounded-3xl border border-border/30 bg-muted/50 p-7 md:p-9">
                        <div className="flex items-center gap-3">
                            <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-border/30 bg-muted/5">
                                <Settings2 size={18} />
                            </div>
                            <div>
                                <h2 className="font-medium">What happens after install</h2>
                                <p className="mt-1 text-xs text-muted-foreground">
                                    Extensions are configured once, then reused across every plugin alert.
                                </p>
                            </div>
                        </div>
                        <div className="mt-6 space-y-4">
                            <SetupStep n={1} text="Install the extension — it appears under My Plugins > Extensions." />
                            {needWebhook && (
                                <SetupStep
                                    n={2}
                                    text="Provide the destination URL (https://...) when the extension requires it. No credentials are stored."
                                />
                            )}
                            {needTarget && (
                                <SetupStep n={2} text="Provide the TradingView panel identifier you want the companion to use." />
                            )}
                            {!needWebhook && !needTarget && (
                                <SetupStep
                                    n={2}
                                    text="Connections are detected automatically from your existing AlgoVault Telegram / Discord setup where applicable."
                                />
                            )}
                            <SetupStep n={3} text="Enable the extension in the plugin's notification channels to start receiving intelligence." />
                        </div>
                    </section>

                    <aside className="lg:sticky lg:top-6 lg:self-start">
                        <div className="rounded-3xl border border-border/30 bg-muted p-6">
                            <p className="text-xs text-muted-foreground">Access</p>
                            <div className="mt-2 flex items-end justify-between">
                                <span className="text-3xl font-semibold">
                                    {extension.pricing?.type === "free" ? "Free" : `${extension.pricing?.price || 0} ${String(extension.pricing?.currency || "usd").toUpperCase()}`}
                                </span>
                            </div>
                            <div className="my-6 h-px bg-muted/10" />
                            <div className="space-y-4">
                                <Feature text={`${EXTENSION_TYPE_LABELS[extType]} integration`} />
                                <Feature text="Reuses your existing AlgoVault connections" />
                                <Feature text="No separate account or credentials" />
                                <Feature text={`${extension.capabilities?.length || 0} capabilities`} />
                            </div>
                            <button
                                type="button"
                                onClick={handleInstall}
                                disabled={busy}
                                className="mt-10 flex w-full items-center justify-center gap-2 rounded-xl bg-background px-5 py-3.5 text-sm font-medium text-foreground transition hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
                            >
                                <Download size={17} />
                                {busy ? "Installing..." : "Install Extension"}
                            </button>
                            {actionError && <p className="mt-3 text-sm text-red-400">{actionError}</p>}
                            <p className="mt-4 text-center text-[11px] leading-5 text-muted-foreground">
                                Installs instantly and can be removed at any time from My Plugins.
                            </p>
                        </div>
                        <div className="mt-4 rounded-2xl border border-border/30 bg-muted/50 p-5">
                            <div className="flex gap-3">
                                <Shield size={17} className="mt-0.5 shrink-0 text-muted-foreground" />
                                <p className="text-[11px] leading-5 text-muted-foreground">
                                    Extensions bridge data you already own to tools you already use.
                                    They never request credentials or access accounts.
                                </p>
                            </div>
                        </div>
                    </aside>
                </div>
            </div>
        </main>
    );
}

function SetupStep({ n, text }: { n: number; text: string }) {
    return (
        <div className="flex items-start gap-4">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-border/30 bg-muted/20 text-xs font-semibold text-muted-foreground">
                {n}
            </div>
            <p className="pt-1 text-sm leading-6 text-muted-foreground">{text}</p>
        </div>
    );
}

function Feature({ text }: { text: string }) {
    return (
        <div className="flex items-center gap-3">
            <div className="flex h-6 w-6 items-center justify-center rounded-full bg-muted/5">
                <CheckCircle2 size={14} />
            </div>
            <span className="text-sm text-muted-foreground">{text}</span>
        </div>
    );
}