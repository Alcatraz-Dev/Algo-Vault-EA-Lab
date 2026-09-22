"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import {
    AlertCircle,
    CheckCircle2,
    ChevronLeft,
    Clock,
    Loader2,
    Pause,
    Play,
    Plug,
    PlayCircle,
    RefreshCw,
    Settings2,
    Terminal,
    Trash2,
} from "lucide-react";
import { onValue, ref } from "firebase/database";
import { database } from "@/lib/firebase";
import AccountShell from "@/components/account/AccountShell";
import { StatusBadge } from "@/components/ui/status-badge";
import { EmptyState } from "@/components/ui/empty-state";
import { PluginRecord, PluginConfig, PluginInstallation, PluginRuntimeState, PluginExecutionRecord, PluginLicenseRecord } from "@/lib/plugins/types";
import {
    CATEGORY_LABELS,
    formatDate,
    installStatusTone,
    INTERVALS,
    INTERVAL_LABELS,
    nextRunLabel,
    pluginFetchJSON,
    severityLabel,
    severityTone,
    timeAgo,
} from "@/lib/plugins/ui";

const TIMEFRAMES = ["M1", "M3", "M5", "M15", "M30", "H1", "H4", "D1"];
const CHANNELS = ["in-app", "email", "telegram", "discord", "webhook"];

type LogEntry = { id: string; level?: string; message?: string; createdAt?: number; meta?: Record<string, unknown> };
type NotificationRecord = { id: string; title?: string; message?: string; severity?: string; timestamp?: number; deliveredChannels?: string[] };

export default function AccountPluginDetailPage() {
    const router = useRouter();
    const params = useParams();
    const pluginId = Array.isArray(params.id) ? params.id[0] : params.id;

    const [plugin, setPlugin] = useState<PluginRecord | null>(null);
    const [installation, setInstallation] = useState<PluginInstallation | null>(null);
    const [license, setLicense] = useState<PluginLicenseRecord | null>(null);
    const [runtime, setRuntime] = useState<PluginRuntimeState | null>(null);
    const [config, setConfig] = useState<PluginConfig | null>(null);

    const [loading, setLoading] = useState(true);
    const [busy, setBusy] = useState("");
    const [notice, setNotice] = useState("");
    const [tab, setTab] = useState<"config" | "run" | "logs">("config");

    // Config form state
    const [symbols, setSymbols] = useState("");
    const [timeframes, setTimeframes] = useState<string[]>(["M5"]);
    const [interval, setInterval] = useState<string>("5m");
    const [channels, setChannels] = useState<string[]>(["email"]);
    const [quietStart, setQuietStart] = useState("");
    const [quietEnd, setQuietEnd] = useState("");
    const [cooldown, setCooldown] = useState("5");
    const [maxAlerts, setMaxAlerts] = useState("10");
    const [severity, setSeverity] = useState("medium");
    const [saving, setSaving] = useState(false);

    // Executions / logs
    const [executions, setExecutions] = useState<PluginExecutionRecord[]>([]);
    const [logs, setLogs] = useState<LogEntry[]>([]);
    const [notifications, setNotifications] = useState<NotificationRecord[]>([]);

    useEffect(() => {
        if (!pluginId) return;
        const unsub = onValue(
            ref(database, `plugins/${pluginId}`),
            (snap) => {
                const val = snap.val() as PluginRecord | null;
                if (val && val.id) setPlugin(val);
            },
            () => {}
        );
        return () => unsub();
    }, [pluginId]);

    const load = useCallback(async () => {
        if (!pluginId) return;
        setLoading(true);
        try {
            const mine = await pluginFetchJSON<{ rows: { installation: PluginInstallation; plugin: PluginRecord | null; config: PluginConfig | null; runtime: PluginRuntimeState | null; license: PluginLicenseRecord | null }[] }>("/api/plugins/mine");
            const row = mine.rows?.find((r) => r.installation?.pluginId === pluginId);
            if (row) {
                setInstallation(row.installation);
                setLicense(row.license);
                setRuntime(row.runtime);
                if (row.plugin) setPlugin(row.plugin);
                const cfg = row.config;
                setConfig(cfg);
                if (cfg) {
                    setSymbols((cfg.symbols || []).join(", "));
                    setTimeframes(cfg.timeframes?.length ? cfg.timeframes : ["M5"]);
                    setInterval(cfg.interval || "5m");
                    setChannels(cfg.notificationChannels?.length ? cfg.notificationChannels : ["email"]);
                    setQuietStart(cfg.quietHoursStart || "");
                    setQuietEnd(cfg.quietHoursEnd || "");
                    setCooldown(String(cfg.cooldownMin ?? 5));
                    setMaxAlerts(String(cfg.maxAlertsPerDay ?? 10));
                    setSeverity(cfg.severity || "medium");
                }
            } else {
                setInstallation(null);
                setConfig(null);
            }
        } catch (err) {
            setNotice(err instanceof Error ? err.message : "Unable to load plugin details.");
        } finally {
            setLoading(false);
        }
    }, [pluginId]);

    useEffect(() => {
        void Promise.resolve().then(() => load());
    }, [load]);

    const loadLogs = useCallback(async () => {
        if (!pluginId) return;
        try {
            const data = await pluginFetchJSON<{ executions: PluginExecutionRecord[]; logs: LogEntry[]; notifications: NotificationRecord[] }>(
                `/api/plugins/${pluginId}/logs?limit=30`
            );
            setExecutions(Array.isArray(data.executions) ? data.executions : []);
            setLogs(Array.isArray(data.logs) ? data.logs : []);
            setNotifications(Array.isArray(data.notifications) ? data.notifications : []);
        } catch (err) {
            setNotice(err instanceof Error ? err.message : "Unable to load logs.");
        }
    }, [pluginId]);

    useEffect(() => {
        if (tab === "logs") {
            void Promise.resolve().then(() => loadLogs());
        }
    }, [tab, loadLogs]);

    const manifestInterval = plugin?.manifest?.runtime?.interval || "manual";
    const usableIntervals = useMemo(() => {
        if (manifestInterval === "manual") return ["manual", ...INTERVALS.filter((i) => i !== "manual")];
        return INTERVALS;
    }, [manifestInterval]);

    async function saveConfig() {
        setSaving(true);
        setNotice("");
        try {
            const symbolList = symbols
                .split(",")
                .map((s) => s.trim().toUpperCase())
                .filter(Boolean)
                .slice(0, 10);
            const updated = await pluginFetchJSON<{ config: PluginConfig }>(`/api/plugins/${pluginId}/config`, {
                method: "PUT",
                body: JSON.stringify({
                    symbols: symbolList,
                    timeframes,
                    interval,
                    notificationChannels: channels,
                    quietHoursStart: quietStart || undefined,
                    quietHoursEnd: quietEnd || undefined,
                    cooldownMin: Number(cooldown) || 5,
                    maxAlertsPerDay: Number(maxAlerts) || 10,
                    severity,
                }),
            });
            setConfig(updated.config);
            setNotice("Configuration saved.");
            await load();
        } catch (err) {
            setNotice(err instanceof Error ? err.message : "Unable to save configuration.");
        } finally {
            setSaving(false);
        }
    }

    async function runAction(action: "activate" | "pause" | "resume" | "disable" | "execute" | "uninstall") {
        setBusy(action);
        setNotice("");
        try {
            if (action === "uninstall") {
                if (!window.confirm("Uninstall this plugin? It will stop scheduling immediately and can be reinstalled.")) {
                    setBusy("");
                    return;
                }
                await pluginFetchJSON(`/api/plugins/${pluginId}/uninstall`, { method: "POST", body: JSON.stringify({}) });
                router.push("/account/plugins");
                return;
            }
            if (action === "execute") {
                const res = await pluginFetchJSON<{ execution: PluginExecutionRecord }>(`/api/plugins/${pluginId}/execute`, {
                    method: "POST",
                    body: JSON.stringify({}),
                });
                setNotice(res.execution?.status === "success" ? "Execution completed." : `Execution failed: ${res.execution?.error || "Unknown error"}`);
                await load();
                if (tab === "logs") loadLogs();
                return;
            }
            await pluginFetchJSON(`/api/plugins/${pluginId}/state`, { method: "POST", body: JSON.stringify({ action }) });
            setNotice(`Plugin ${action === "activate" || action === "resume" ? "activated" : action + "d"}.`);
            await load();
        } catch (err) {
            setNotice(err instanceof Error ? err.message : "Action failed.");
        } finally {
            setBusy("");
        }
    }

    const toggleArray = (list: string[], value: string, setter: (v: string[]) => void) => {
        setter(list.includes(value) ? list.filter((v) => v !== value) : [...list, value]);
    };

    const status = installation?.status || "not installed";
    const isActive = status === "active";

    if (loading) {
        return (
            <AccountShell title="Plugin" onBack={() => router.push("/account/plugins")}>
                <div className="grid gap-4">
                    {[1, 2, 3].map((n) => (
                        <div key={n} className="h-32 animate-pulse rounded-2xl border border-border/30 bg-muted/50" />
                    ))}
                </div>
            </AccountShell>
        );
    }

    if (!plugin) {
        return (
            <AccountShell title="Plugin not found" onBack={() => router.push("/account/plugins")}>
                <EmptyState
                    icon={<Plug size={18} />}
                    title="Plugin not found"
                    description="This plugin is no longer available in the catalog."
                    action={
                        <Link href="/account/plugins" className="inline-flex items-center gap-2 rounded-xl bg-background px-4 py-2.5 text-xs font-medium text-foreground transition hover:bg-muted">
                            Back to My Plugins
                        </Link>
                    }
                />
            </AccountShell>
        );
    }

    if (!installation || installation.status === "uninstalled") {
        return (
            <AccountShell title={plugin.displayName} onBack={() => router.push("/account/plugins")}>
                <EmptyState
                    icon={<Plug size={18} />}
                    title={`${plugin.displayName} is not installed`}
                    description="Install this plugin first, then configure and activate it."
                    action={
                        <Link href={`/marketplace/plugins/${plugin.slug || plugin.id}`} className="inline-flex items-center gap-2 rounded-xl bg-background px-4 py-2.5 text-xs font-medium text-foreground transition hover:bg-muted">
                            View in Marketplace
                        </Link>
                    }
                />
            </AccountShell>
        );
    }

    return (
        <AccountShell title={plugin.displayName} subtitle={`${plugin.capabilities?.length || 0} capabilities · v${installation.installedVersion || plugin.version}`} onBack={() => router.push("/account/plugins")}>
            {/* Status header */}
            <div className="mb-5 rounded-2xl border border-border/30 bg-muted/50 p-5">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                    <div className="flex items-start gap-4">
                        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-border/30 bg-muted/5">
                            <Plug size={22} className="text-violet-300" />
                        </div>
                        <div>
                            <div className="flex flex-wrap items-center gap-2">
                                <h2 className="text-base font-semibold">{plugin.displayName}</h2>
                                <StatusBadge tone={installStatusTone(status)} label={status} dot={isActive} pulse={isActive} />
                                {license && license.status === "active" && <StatusBadge tone="connected" label="License active" />}
                                {installation.licenseStatus === "expired" && <StatusBadge tone="expired" label="License expired" />}
                            </div>
                            <p className="mt-1 max-w-2xl text-xs leading-5 text-muted-foreground line-clamp-2">{plugin.description}</p>
                        </div>
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-[11px] text-muted-foreground sm:grid-cols-4">
                        <MiniInfo label="Category" value={CATEGORY_LABELS[plugin.category]} />
                        <MiniInfo label="Next run" value={nextRunLabel(runtime?.nextRunAt, runtime?.status)} />
                        <MiniInfo label="Executions" value={String(installation.executions || 0)} />
                        <MiniInfo label="Last activity" value={timeAgo(installation.lastActivityAt)} />
                    </div>
                </div>

                <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-border/30 pt-4">
                    {isActive ? (
                        <ActionButton onClick={() => runAction("pause")} busy={busy === "pause"} icon={<Pause size={14} />} label="Pause" />
                    ) : (
                        <ActionButton
                            onClick={() => runAction(status === "disabled" ? "activate" : "resume")}
                            busy={busy === "resume"}
                            icon={<Play size={14} />}
                            label={status === "disabled" ? "Activate" : "Resume"}
                            primary
                        />
                    )}
                    <ActionButton onClick={() => runAction("disable")} busy={busy === "disable"} icon={<Pause size={14} />} label="Disable" />
                    <ActionButton onClick={() => runAction("execute")} busy={busy === "execute"} icon={<PlayCircle size={14} />} label="Run now" />
                    <ActionButton onClick={() => runAction("uninstall")} busy={busy === "uninstall"} icon={<Trash2 size={14} />} label="Uninstall" danger />
                </div>
            </div>

            {notice && (
                <div
                    className={`mb-5 flex items-start gap-3 rounded-2xl border p-4 ${
                        notice.startsWith("Execution failed") || notice.includes("Unable") || notice.includes("failed")
                            ? "border-red-500/30 bg-red-500/10 text-red-300"
                            : "border-emerald-500/30 bg-emerald-500/10 text-emerald-100"
                    }`}
                >
                    <AlertCircle size={16} className="mt-0.5 shrink-0" />
                    <p className="text-sm">{notice}</p>
                </div>
            )}

            {/* Tabs */}
            <div className="mb-5 flex gap-2">
                {(
                    [
                        ["config", "Configuration", Settings2],
                        ["run", "Run & Lifecycle", PlayCircle],
                        ["logs", "Logs & Activity", Terminal],
                    ] as const
                ).map(([key, label, Icon]) => (
                    <button
                        key={key}
                        type="button"
                        onClick={() => setTab(key)}
                        className={`inline-flex items-center gap-2 rounded-xl border px-4 py-2.5 text-xs font-medium transition ${
                            tab === key ? "border-border/50 bg-background text-foreground" : "border-border/30 bg-muted/50 text-muted-foreground hover:bg-muted/5"
                        }`}
                    >
                        <Icon size={14} />
                        {label}
                    </button>
                ))}
            </div>

            {tab === "config" && (
                <div className="rounded-2xl border border-border/30 bg-muted/50 p-6">
                    <h3 className="text-sm font-semibold">Configuration</h3>
                    <p className="mt-1 text-xs text-muted-foreground">
                        Saving configuration moves the plugin to <span className="text-foreground">configured</span>, then you can activate it.
                    </p>

                    {manifestInterval === "manual" && config?.interval === "manual" && (
                        <div className="mt-4 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-200">
                            This plugin is designed for on-demand analysis — set an interval below if you want it to run in the background.
                        </div>
                    )}

                    <div className="mt-6 grid gap-6 lg:grid-cols-2">
                        <Field label="Symbols (comma separated)">
                            <input
                                value={symbols}
                                onChange={(e) => setSymbols(e.target.value)}
                                placeholder="EURUSD, XAUUSD, US30"
                                className="w-full rounded-xl border border-border/30 bg-muted/50 p-3 text-sm outline-none placeholder:text-muted-foreground focus:border-border/50"
                            />
                        </Field>

                        <Field label="Runtime interval">
                            <select
                                value={interval}
                                onChange={(e) => setInterval(e.target.value)}
                                className="w-full rounded-xl border border-border/30 bg-muted/50 p-3 text-sm outline-none focus:border-border/50"
                            >
                                {usableIntervals.map((i) => (
                                    <option key={i} value={i}>
                                        {(INTERVAL_LABELS as Record<string, string>)[i] || i}
                                    </option>
                                ))}
                            </select>
                        </Field>

                        <Field label="Timeframes">
                            <div className="flex flex-wrap gap-2">
                                {TIMEFRAMES.map((tf) => (
                                    <button
                                        key={tf}
                                        type="button"
                                        onClick={() => toggleArray(timeframes, tf, setTimeframes)}
                                        className={`rounded-lg border px-3 py-1.5 text-xs transition ${
                                            timeframes.includes(tf)
                                                ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
                                                : "border-border/30 bg-muted/5 text-muted-foreground hover:text-foreground"
                                        }`}
                                    >
                                        {tf}
                                    </button>
                                ))}
                            </div>
                        </Field>

                        <Field label="Notification channels">
                            <div className="flex flex-wrap gap-2">
                                {CHANNELS.map((ch) => (
                                    <button
                                        key={ch}
                                        type="button"
                                        onClick={() => toggleArray(channels, ch, setChannels)}
                                        className={`rounded-lg border px-3 py-1.5 text-xs transition ${
                                            channels.includes(ch)
                                                ? "border-violet-500/40 bg-violet-500/10 text-violet-300"
                                                : "border-border/30 bg-muted/5 text-muted-foreground hover:text-foreground"
                                        }`}
                                    >
                                        {ch}
                                    </button>
                                ))}
                            </div>
                            <p className="mt-1 text-[11px] text-muted-foreground">
                                {channels.includes("webhook") ? "Webhook delivery uses your plugin webhook URL from extensions." : ""}
                            </p>
                        </Field>

                        <Field label="Quiet hours start (HH:MM)">
                            <input
                                value={quietStart}
                                onChange={(e) => setQuietStart(e.target.value)}
                                placeholder="e.g. 22:00"
                                className="w-full rounded-xl border border-border/30 bg-muted/50 p-3 text-sm outline-none placeholder:text-muted-foreground focus:border-border/50"
                            />
                        </Field>
                        <Field label="Quiet hours end (HH:MM)">
                            <input
                                value={quietEnd}
                                onChange={(e) => setQuietEnd(e.target.value)}
                                placeholder="e.g. 07:00"
                                className="w-full rounded-xl border border-border/30 bg-muted/50 p-3 text-sm outline-none placeholder:text-muted-foreground focus:border-border/50"
                            />
                        </Field>

                        <Field label={`Cooldown between alerts (minutes) — currently ${cooldown}`}>
                            <input
                                type="number"
                                min={1}
                                max={1440}
                                value={cooldown}
                                onChange={(e) => setCooldown(e.target.value)}
                                className="w-full rounded-xl border border-border/30 bg-muted/50 p-3 text-sm outline-none focus:border-border/50"
                            />
                        </Field>
                        <Field label={`Max alerts per day — currently ${maxAlerts}`}>
                            <input
                                type="number"
                                min={1}
                                max={200}
                                value={maxAlerts}
                                onChange={(e) => setMaxAlerts(e.target.value)}
                                className="w-full rounded-xl border border-border/30 bg-muted/50 p-3 text-sm outline-none focus:border-border/50"
                            />
                        </Field>

                        <Field label="Alert severity">
                            <div className="flex gap-2">
                                {(["low", "medium", "high"] as const).map((s) => (
                                    <button
                                        key={s}
                                        type="button"
                                        onClick={() => setSeverity(s)}
                                        className={`rounded-lg border px-3 py-1.5 text-xs capitalize transition ${
                                            severity === s
                                                ? "border-border/50 bg-background text-foreground"
                                                : "border-border/30 bg-muted/5 text-muted-foreground hover:text-foreground"
                                        }`}
                                    >
                                        {severityLabel(s)}
                                    </button>
                                ))}
                            </div>
                        </Field>
                    </div>

                    <div className="mt-6 flex items-center justify-end gap-3">
                        <button
                            type="button"
                            onClick={() => load()}
                            className="inline-flex items-center gap-2 rounded-xl border border-border/30 bg-muted/5 px-4 py-2.5 text-xs font-medium text-muted-foreground transition hover:text-foreground"
                        >
                            <RefreshCw size={13} />
                            Reset form
                        </button>
                        <button
                            type="button"
                            onClick={saveConfig}
                            disabled={saving}
                            className="inline-flex items-center gap-2 rounded-xl bg-background px-5 py-2.5 text-xs font-medium text-foreground transition hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
                        >
                            {saving ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
                            Save Configuration
                        </button>
                    </div>
                </div>
            )}

            {tab === "run" && (
                <div className="grid gap-6 lg:grid-cols-2">
                    <div className="rounded-2xl border border-border/30 bg-muted/50 p-6">
                        <h3 className="text-sm font-semibold">Lifecycle</h3>
                        <p className="mt-1 text-xs text-muted-foreground">Current state and scheduling details.</p>
                        <dl className="mt-5 space-y-3 text-sm">
                            <Row label="Status" value={<StatusBadge tone={installStatusTone(status)} label={status} dot={isActive} pulse={isActive} />} />
                            <Row label="Scheduler" value={runtime?.status || "paused"} />
                            <Row label="Next run" value={runtime?.nextRunAt ? formatDate(runtime.nextRunAt) : "—"} />
                            <Row label="Last run" value={runtime?.lastRunAt ? formatDate(runtime.lastRunAt) : "never"} />
                            <Row label="Consecutive failures" value={String(runtime?.failures || 0)} />
                            <Row label="Alerts today" value={String(runtime?.alertedToday || 0)} />
                            <Row label="Installed" value={installation.installedAt ? formatDate(installation.installedAt) : "—"} />
                            <Row label="Version" value={installation.installedVersion || plugin.version} />
                        </dl>
                        <div className="mt-5 rounded-xl border border-border/30 bg-muted/20 p-4">
                            <p className="text-xs leading-6 text-muted-foreground">
                                {isActive
                                    ? "This plugin is active — the server-side scheduler runs it on the configured interval. Runs happen server-side; nothing executes in your browser."
                                    : "This plugin is not running. Configure it, then activate it to schedule background runs."}
                            </p>
                        </div>
                    </div>

                    <div className="rounded-2xl border border-border/30 bg-muted/50 p-6">
                        <h3 className="text-sm font-semibold">Run now</h3>
                        <p className="mt-1 text-xs text-muted-foreground">
                            Executes immediately with your saved configuration. Manual runs do not require an active schedule.
                        </p>
                        <button
                            type="button"
                            onClick={() => runAction("execute")}
                            disabled={busy === "execute"}
                            className="mt-4 inline-flex items-center gap-2 rounded-xl bg-background px-4 py-2.5 text-xs font-medium text-foreground transition hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
                        >
                            {busy === "execute" ? <Loader2 size={14} className="animate-spin" /> : <PlayCircle size={14} />}
                            Run plugin now
                        </button>
                        <div className="mt-6 border-t border-border/30 pt-4">
                            <h4 className="text-xs font-medium">Permission scope</h4>
                            <p className="mt-1 text-xs leading-5 text-muted-foreground">
                                This plugin is restricted to its declared permissions and the market data / history sources listed in its manifest.
                            </p>
                        </div>
                    </div>
                </div>
            )}

            {tab === "logs" && (
                <div className="space-y-6">
                    <div className="flex items-center justify-between">
                        <h3 className="text-sm font-semibold">Executions</h3>
                        <button type="button" onClick={loadLogs} className="inline-flex items-center gap-1.5 text-xs text-muted-foreground transition hover:text-foreground">
                            <RefreshCw size={12} />
                            Refresh
                        </button>
                    </div>

                    {executions.length === 0 ? (
                        <EmptyState compact icon={<Clock size={18} />} title="No executions yet" description="Run the plugin manually or wait for its scheduled run to see results here." />
                    ) : (
                        <div className="overflow-hidden rounded-2xl border border-border/30 bg-muted/50">
                            {executions.slice(0, 20).map((exec) => (
                                <div key={exec.id} className="flex flex-col gap-1 border-b border-border/30 p-4 last:border-0 sm:flex-row sm:items-center sm:justify-between">
                                    <div className="min-w-0">
                                        <div className="flex flex-wrap items-center gap-2">
                                            <StatusBadge tone={exec.status === "success" ? "positive" : "error"} label={exec.status} dot />
                                            <span className="text-xs font-medium text-foreground">Trigger: {exec.trigger}</span>
                                            <span className="text-[11px] text-muted-foreground">{formatDate(exec.startedAt)}</span>
                                        </div>
                                        <p className="mt-1 max-w-2xl truncate text-xs text-muted-foreground">
                                            {exec.summary || exec.error || (exec.findings?.length ? `${exec.findings.length} findings` : "No summary")}
                                        </p>
                                        {exec.alerts && exec.alerts.length > 0 && (
                                            <p className="mt-1 text-[11px] text-muted-foreground">
                                                {exec.alerts.length} alert{exec.alerts.length === 1 ? "" : "s"} generated
                                            </p>
                                        )}
                                    </div>
                                    <span className="shrink-0 text-[11px] text-muted-foreground">{exec.durationMs}ms · {exec.symbols?.length || 0} symbols</span>
                                </div>
                            ))}
                        </div>
                    )}

                    <div>
                        <h3 className="mb-3 text-sm font-semibold">Runtime logs</h3>
                        {logs.length === 0 ? (
                            <EmptyState compact icon={<Terminal size={18} />} title="No runtime logs" description="Logs appear after the plugin first executes." />
                        ) : (
                            <div className="overflow-hidden rounded-2xl border border-border/30 bg-muted/50">
                                {logs.map((log) => (
                                    <div key={log.id} className="flex items-start justify-between gap-3 border-b border-border/30 p-3 last:border-0">
                                        <div className="flex items-center gap-2 min-w-0">
                                            <span className={`h-2 w-2 shrink-0 rounded-full ${log.level === "error" ? "bg-red-400" : log.level === "warning" ? "bg-amber-400" : "bg-emerald-400"}`} />
                                            <p className="truncate text-xs text-muted-foreground">{log.message}</p>
                                        </div>
                                        <span className="shrink-0 text-[11px] text-muted-foreground">{log.createdAt ? formatDate(log.createdAt) : ""}</span>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>

                    <div>
                        <h3 className="mb-3 text-sm font-semibold">Notifications delivered</h3>
                        {notifications.length === 0 ? (
                            <EmptyState compact icon={<AlertCircle size={18} />} title="No notifications" description="Alerts generated by this plugin appear here once delivered." />
                        ) : (
                            <div className="overflow-hidden rounded-2xl border border-border/30 bg-muted/50">
                                {notifications.map((notif) => (
                                    <div key={notif.id} className="flex items-start justify-between gap-3 border-b border-border/30 p-3 last:border-0">
                                        <div className="min-w-0">
                                            <div className="flex items-center gap-2">
                                                <StatusBadge tone={severityTone(notif.severity)} label={severityLabel(notif.severity)} />
                                                <span className="text-xs font-medium text-foreground">{notif.title}</span>
                                            </div>
                                            <p className="mt-1 truncate text-xs text-muted-foreground">{notif.message}</p>
                                        </div>
                                        <div className="shrink-0 text-right text-[11px] text-muted-foreground">
                                            <span>{notif.deliveredChannels?.length ? notif.deliveredChannels.join(", ") : "in-app"}</span>
                                            <br />
                                            {notif.timestamp ? formatDate(notif.timestamp) : ""}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            )}

            <div className="mt-6">
                <Link href="/account/plugins" className="inline-flex items-center gap-1.5 text-xs text-muted-foreground transition hover:text-foreground">
                    <ChevronLeft size={14} />
                    Back to My Plugins
                </Link>
            </div>
        </AccountShell>
    );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <div>
            <label className="mb-2 block text-xs font-medium text-muted-foreground">{label}</label>
            {children}
        </div>
    );
}

function ActionButton({
    onClick,
    busy,
    icon,
    label,
    primary = false,
    danger = false,
}: {
    onClick: () => void;
    busy?: boolean;
    icon: React.ReactNode;
    label: string;
    primary?: boolean;
    danger?: boolean;
}) {
    const tone = danger
        ? "border-red-500/30 bg-red-500/10 text-red-300 hover:bg-red-500/20"
        : primary
          ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20"
          : "border-border/30 bg-muted/5 text-muted-foreground hover:text-foreground";
    return (
        <button
            type="button"
            onClick={onClick}
            disabled={busy}
            className={`inline-flex items-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-50 ${tone}`}
        >
            {busy ? <Loader2 size={13} className="animate-spin" /> : icon}
            {busy ? "Working..." : label}
        </button>
    );
}

function MiniInfo({ label, value }: { label: string; value: string }) {
    return (
        <div className="rounded-lg border border-border/30 bg-muted/20 p-2.5">
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
            <p className="mt-0.5 truncate text-xs font-medium text-foreground">{value}</p>
        </div>
    );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
    return (
        <div className="flex items-center justify-between gap-3 border-b border-border/20 pb-2 last:border-0">
            <dt className="text-xs text-muted-foreground">{label}</dt>
            <dd className="text-xs font-medium text-foreground">{value}</dd>
        </div>
    );
}