"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
    ArrowRight,
    Cable,
    CheckCircle2,
    ExternalLink,
    Loader2,
    Pause,
    Play,
    Plug,
    Puzzle,
    RefreshCw,
    Settings2,
    Trash2,
} from "lucide-react";
import AccountShell from "@/components/account/AccountShell";
import { EmptyState } from "@/components/ui/empty-state";
import { StatusBadge } from "@/components/ui/status-badge";
import { PluginInstallation, PluginRecord, PluginConfig, PluginRuntimeState, PluginLicenseRecord, ExtensionInstallation } from "@/lib/plugins/types";
import {
    CATEGORY_LABELS,
    EXTENSION_TYPE_LABELS,
    formatDate,
    installStatusTone,
    nextRunLabel,
    pluginFetchJSON,
    timeAgo,
} from "@/lib/plugins/ui";

type MineRow = {
    installation: PluginInstallation;
    plugin: PluginRecord | null;
    config: PluginConfig | null;
    runtime: PluginRuntimeState | null;
    license: PluginLicenseRecord | null;
};

type ExtensionRow = {
    install: ExtensionInstallation;
    extension: PluginRecord | null;
};

export default function AccountPluginsPage() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const [tab, setTab] = useState<"plugins" | "extensions">("plugins");
    const [rows, setRows] = useState<MineRow[]>([]);
    const [extensions, setExtensions] = useState<ExtensionRow[]>([]);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState("");
    const [busyId, setBusyId] = useState("");
    const [banner, setBanner] = useState("");

    const paymentSuccess = searchParams.get("payment") === "success";
    const installedExtension = searchParams.get("installedExtension");

    useEffect(() => {
        if (paymentSuccess) setBanner("Payment successful — your plugin license is now active. Install it to get started.");
        if (installedExtension) setBanner("Extension installed successfully.");
    }, [paymentSuccess, installedExtension]);

    const load = useCallback(async () => {
        setLoading(true);
        setLoadError("");
        try {
            const data = await pluginFetchJSON<{ rows: MineRow[] }>("/api/plugins/mine");
            const ext = await pluginFetchJSON<{ extensions: ExtensionRow[] }>("/api/extensions/mine");
            setRows(Array.isArray(data.rows) ? data.rows : []);
            setExtensions(Array.isArray(ext.extensions) ? ext.extensions : []);
        } catch (err) {
            setLoadError(err instanceof Error ? err.message : "Unable to load your plugins.");
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        load();
    }, [load]);

    async function setState(pluginId: string, action: "activate" | "pause" | "resume" | "disable") {
        setBusyId(`${pluginId}:${action}`);
        try {
            await pluginFetchJSON(`/api/plugins/${pluginId}/state`, {
                method: "POST",
                body: JSON.stringify({ action }),
            });
            await load();
        } catch (err) {
            setLoadError(err instanceof Error ? err.message : "Action failed.");
        } finally {
            setBusyId("");
        }
    }

    async function uninstallExtension(extensionId: string) {
        if (!window.confirm("Uninstall this extension? It can be reinstalled anytime.")) return;
        setBusyId(`ext:${extensionId}`);
        try {
            await pluginFetchJSON(`/api/extensions/${extensionId}`, { method: "DELETE" });
            await load();
        } catch (err) {
            setLoadError(err instanceof Error ? err.message : "Unable to uninstall.");
        } finally {
            setBusyId("");
        }
    }

    const pluginCount = rows.filter((r) => r.installation?.status !== "uninstalled").length;
    const activeCount = rows.filter((r) => r.installation?.status === "active").length;
    const extCount = extensions.length;

    return (
        <AccountShell
            title="My Plugins"
            subtitle="Install, configure and manage your intelligence plugins and extensions."
            onBack={() => router.push("/account")}
        >
            {banner && (
                <div className="mb-5 flex items-start gap-3 rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-4">
                    <CheckCircle2 size={17} className="mt-0.5 shrink-0 text-emerald-400" />
                    <div className="text-sm text-emerald-100">{banner}</div>
                </div>
            )}

            {loadError && (
                <div className="mb-5 rounded-2xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-300">{loadError}</div>
            )}

            {/* Header */}
            <div className="mb-6 flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
                <div className="flex flex-wrap items-center gap-2">
                    <button
                        type="button"
                        onClick={() => setTab("plugins")}
                        className={`flex items-center gap-2 rounded-xl border px-4 py-2.5 text-xs font-medium transition ${
                            tab === "plugins" ? "border-border/50 bg-background text-foreground" : "border-border/30 bg-muted/50 text-muted-foreground hover:bg-muted/5"
                        }`}
                    >
                        <Plug size={14} />
                        Plugins · {pluginCount}
                    </button>
                    <button
                        type="button"
                        onClick={() => setTab("extensions")}
                        className={`flex items-center gap-2 rounded-xl border px-4 py-2.5 text-xs font-medium transition ${
                            tab === "extensions" ? "border-border/50 bg-background text-foreground" : "border-border/30 bg-muted/50 text-muted-foreground hover:bg-muted/5"
                        }`}
                    >
                        <Puzzle size={14} />
                        Extensions · {extCount}
                    </button>
                </div>
                <Link
                    href="/marketplace/plugins"
                    className="inline-flex items-center gap-2 self-start rounded-xl bg-background px-4 py-2.5 text-xs font-medium text-foreground transition hover:bg-muted"
                >
                    Browse Plugins <ArrowRight size={14} />
                </Link>
            </div>

            {tab === "plugins" && (
                <>
                    {loading ? (
                        <div className="grid gap-4">
                            {[1, 2, 3].map((n) => (
                                <div key={n} className="h-36 animate-pulse rounded-2xl border border-border/30 bg-muted/50" />
                            ))}
                        </div>
                    ) : rows.filter((r) => r.installation?.status !== "uninstalled").length === 0 ? (
                        <EmptyState
                            icon={<Plug size={18} />}
                            title="No plugins installed yet"
                            description="Plugins run as background intelligence agents on your trading data — install one from the marketplace to begin."
                            action={
                                <Link href="/marketplace/plugins" className="inline-flex items-center gap-2 rounded-xl bg-background px-4 py-2.5 text-xs font-medium text-foreground transition hover:bg-muted">
                                    Explore the Plugin Marketplace <ArrowRight size={14} />
                                </Link>
                            }
                        />
                    ) : (
                        <div className="grid gap-4">
                            {rows
                                .filter((r) => r.installation?.status !== "uninstalled")
                                .sort((a, b) => (Number(b.installation?.lastActivityAt || 0)) - Number(a.installation?.lastActivityAt || 0))
                                .map(({ installation, plugin, config, runtime }) => {
                                    if (!plugin) return null;
                                    const isActive = installation.status === "active";
                                    return (
                                        <div key={installation.pluginId} className="rounded-2xl border border-border/30 bg-muted/50 p-5">
                                            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                                                <div className="flex items-start gap-4">
                                                    <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-border/30 bg-muted/5">
                                                        <Plug size={20} className="text-violet-300" />
                                                    </div>
                                                    <div>
                                                        <div className="flex flex-wrap items-center gap-2">
                                                            <Link href={`/account/plugins/${installation.pluginId}`} className="text-sm font-semibold text-foreground transition hover:text-violet-300">
                                                                {plugin.displayName}
                                                            </Link>
                                                            <StatusBadge tone={installStatusTone(installation.status)} label={installation.status} dot={isActive} pulse={isActive} />
                                                            {installation.licenseStatus === "expired" && <StatusBadge tone="expired" label="License expired" />}
                                                            {installation.licenseStatus === "active" && <StatusBadge tone="connected" label="Licensed" />}
                                                        </div>
                                                        <p className="mt-1 max-w-xl text-xs leading-5 text-muted-foreground line-clamp-1">
                                                            {plugin.description}
                                                        </p>
                                                        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
                                                            <span>{CATEGORY_LABELS[plugin.category]}</span>
                                                            <span>v{installation.installedVersion || plugin.version}</span>
                                                            <span>Interval: {config?.interval || plugin.manifest?.runtime?.interval || "manual"}</span>
                                                            <span>Next run: {nextRunLabel(runtime?.nextRunAt, runtime?.status)}</span>
                                                            <span>Last activity: {timeAgo(installation.lastActivityAt)}</span>
                                                            <span>Executions: {installation.executions || 0}</span>
                                                        </div>
                                                    </div>
                                                </div>
                                                <div className="flex flex-wrap items-center gap-2">
                                                    {isActive ? (
                                                        <button
                                                            type="button"
                                                            onClick={() => setState(installation.pluginId, "pause")}
                                                            disabled={busyId === `${installation.pluginId}:pause`}
                                                            className="inline-flex items-center gap-1.5 rounded-xl border border-border/30 bg-muted/5 px-3 py-2 text-xs font-medium text-muted-foreground transition hover:text-foreground disabled:opacity-50"
                                                        >
                                                            {busyId === `${installation.pluginId}:pause` ? <Loader2 size={13} className="animate-spin" /> : <Pause size={13} />}
                                                            Pause
                                                        </button>
                                                    ) : (
                                                        <button
                                                            type="button"
                                                            onClick={() => setState(installation.pluginId, installation.status === "disabled" ? "activate" : "resume")}
                                                            disabled={busyId === `${installation.pluginId}:resume`}
                                                            className="inline-flex items-center gap-1.5 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs font-medium text-emerald-300 transition hover:bg-emerald-500/20 disabled:opacity-50"
                                                        >
                                                            {busyId === `${installation.pluginId}:resume` ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} />}
                                                            {installation.status === "disabled" ? "Activate" : "Resume"}
                                                        </button>
                                                    )}
                                                    <button
                                                        type="button"
                                                        onClick={() => setState(installation.pluginId, "disable")}
                                                        disabled={busyId === `${installation.pluginId}:disable`}
                                                        className="inline-flex items-center gap-1.5 rounded-xl border border-border/30 bg-muted/5 px-3 py-2 text-xs font-medium text-muted-foreground transition hover:text-foreground disabled:opacity-50"
                                                    >
                                                        Disable
                                                    </button>
                                                    <Link
                                                        href={`/account/plugins/${installation.pluginId}`}
                                                        className="inline-flex items-center gap-1.5 rounded-xl bg-background px-3 py-2 text-xs font-medium text-foreground transition hover:bg-muted"
                                                    >
                                                        <Settings2 size={13} />
                                                        Manage
                                                    </Link>
                                                </div>
                                            </div>
                                        </div>
                                    );
                                })}
                        </div>
                    )}
                </>
            )}

            {tab === "extensions" && (
                <>
                    {loading ? (
                        <div className="grid gap-4">
                            {[1, 2].map((n) => (
                                <div key={n} className="h-28 animate-pulse rounded-2xl border border-border/30 bg-muted/50" />
                            ))}
                        </div>
                    ) : extensions.length === 0 ? (
                        <EmptyState
                            icon={<Puzzle size={18} />}
                            title="No extensions installed"
                            description="Extensions deliver plugin intelligence to the tools you already use — webhooks, Telegram, Discord, browser and TradingView."
                            action={
                                <Link href="/marketplace/extensions" className="inline-flex items-center gap-2 rounded-xl bg-background px-4 py-2.5 text-xs font-medium text-foreground transition hover:bg-muted">
                                    Explore Extensions <ArrowRight size={14} />
                                </Link>
                            }
                        />
                    ) : (
                        <div className="grid gap-4">
                            {extensions.map(({ install, extension }) => {
                                if (!extension) return null;
                                const typed = extension as PluginRecord & { extensionType?: string };
                                return (
                                    <div key={install.extensionId} className="rounded-2xl border border-border/30 bg-muted/50 p-5">
                                        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                                            <div className="flex items-start gap-4">
                                                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-border/30 bg-muted/5">
                                                    <Cable size={20} className="text-emerald-300" />
                                                </div>
                                                <div>
                                                    <div className="flex flex-wrap items-center gap-2">
                                                        <span className="text-sm font-semibold text-foreground">{extension.displayName}</span>
                                                        <StatusBadge tone={installStatusTone(install.status)} label={install.status} />
                                                        <span className="rounded-lg border border-border/30 bg-muted/5 px-2 py-0.5 text-[10px] text-muted-foreground">
                                                            {EXTENSION_TYPE_LABELS[typed.extensionType || "browser"]}
                                                        </span>
                                                    </div>
                                                    <p className="mt-1 max-w-xl text-xs leading-5 text-muted-foreground line-clamp-1">{extension.description}</p>
                                                    <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
                                                        <span>v{install.installedVersion || extension.version}</span>
                                                        <span>Installed {formatDate(install.installedAt)}</span>
                                                        {install.webhookUrl && <span className="max-w-[260px] truncate">Webhook: {install.webhookUrl}</span>}
                                                        {install.target && <span>Target: {install.target}</span>}
                                                        <span className="inline-flex items-center gap-1 text-emerald-400">
                                                            <ExternalLink size={11} /> Reuses existing connections
                                                        </span>
                                                    </div>
                                                </div>
                                            </div>
                                            <button
                                                type="button"
                                                onClick={() => uninstallExtension(install.extensionId)}
                                                disabled={busyId === `ext:${install.extensionId}`}
                                                className="inline-flex items-center gap-1.5 rounded-xl border border-border/30 bg-muted/5 px-3 py-2 text-xs font-medium text-muted-foreground transition hover:text-red-400 disabled:opacity-50"
                                            >
                                                {busyId === `ext:${install.extensionId}` ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
                                                Uninstall
                                            </button>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </>
            )}

            <div className="mt-8 flex items-center justify-center">
                <button
                    type="button"
                    onClick={load}
                    className="inline-flex items-center gap-2 rounded-xl border border-border/30 bg-muted/5 px-4 py-2.5 text-xs font-medium text-muted-foreground transition hover:text-foreground"
                >
                    <RefreshCw size={13} />
                    Refresh
                </button>
            </div>
        </AccountShell>
    );
}