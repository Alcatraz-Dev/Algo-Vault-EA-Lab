"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import {
    Activity,
    AlertCircle,
    ArrowLeft,
    CheckCircle2,
    Clock,
    ExternalLink,
    FileText,
    FlaskConical,
    Loader2,
    Lock,
    PlayCircle,
    Plug,
    RefreshCw,
    Save,
    ScrollText,
    Settings2,
    Shield,
    Sparkles,
    Tag,
    Terminal,
    Trash2,
    Users,
} from "lucide-react";
import AdminShell from "@/components/admin/AdminShell";
import { StatusBadge } from "@/components/ui/status-badge";
import { EmptyState } from "@/components/ui/empty-state";
import { auth } from "@/lib/firebase";
import { PluginRecord, PluginStatus, PluginPermission, PluginPricingType, PluginAuditLog, PluginExecutionRecord } from "@/lib/plugins/types";
import { PERMISSION_CATALOG } from "@/lib/plugins/permissions";
import {
    CATEGORY_LABELS,
    CATEGORIES,
    EXTENSION_TYPE_LABELS,
    formatDate,
    formatNumber,
    formatPrice,
    permissionDescription,
    permissionLabel,
    pluginStatusTone,
    timeAgo,
} from "@/lib/plugins/ui";

const STATUS_ORDER: PluginStatus[] = ["draft", "testing", "pending_review", "published", "disabled"];

const PRICING_TYPES: { value: PluginPricingType; label: string }[] = [
    { value: "free", label: "Free" },
    { value: "one_time", label: "One-time" },
    { value: "subscription", label: "Subscription" },
];

type AdminDetailData = {
    record: PluginRecord;
    audit: PluginAuditLog[];
};

function getToken() {
    const user = auth.currentUser;
    if (!user) throw new Error("Authentication required.");
    return user.getIdToken();
}

export default function AdminPluginDetailPage() {
    const router = useRouter();
    const params = useParams();
    const id = Array.isArray(params.id) ? params.id[0] : params.id;

    const [record, setRecord] = useState<PluginRecord | null>(null);
    const [audit, setAudit] = useState<PluginAuditLog[]>([]);
    const [loading, setLoading] = useState(true);
    const [busy, setBusy] = useState("");
    const [notice, setNotice] = useState("");
    const [noticeTone, setNoticeTone] = useState<"ok" | "error">("ok");
    const [tab, setTab] = useState<"overview" | "edit" | "sandbox" | "audit">("overview");

    // Version bump
    const [version, setVersion] = useState("");
    const [changelog, setChangelog] = useState("");

    // Edit form
    const [displayName, setDisplayName] = useState("");
    const [description, setDescription] = useState("");
    const [documentation, setDocumentation] = useState("");
    const [pricingType, setPricingType] = useState<PluginPricingType>("free");
    const [price, setPrice] = useState("0");
    const [currency, setCurrency] = useState("usd");
    const [permissions, setPermissions] = useState<PluginPermission[]>([]);
    const [capabilities, setCapabilities] = useState("");
    const [supportedMarkets, setSupportedMarkets] = useState("");
    const [saving, setSaving] = useState(false);

    // Sandbox test
    const [testSymbols, setTestSymbols] = useState("EURUSD");
    const [testResult, setTestResult] = useState<PluginExecutionRecord | null>(null);

    const load = useCallback(async () => {
        if (!id) return;
        setLoading(true);
        setRecord(null);
        setAudit([]);
        setNotice("");
        try {
            const token = await getToken();
            const res = await fetch(`/api/admin/plugins/${id}`, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
            if (!res.ok) throw new Error(((await res.json()) as { error?: string })?.error ?? "Unable to load plugin.");
            const data = (await res.json()) as AdminDetailData;
            setRecord(data.record);
            setAudit(Array.isArray(data.audit) ? data.audit : []);
            setVersion(data.record.version);
            setChangelog("");
            setDisplayName(data.record.displayName || "");
            setDescription(data.record.description || "");
            setDocumentation(data.record.documentation || "");
            setPricingType(data.record.pricing?.type || "free");
            setPrice(String(data.record.pricing?.price ?? 0));
            setCurrency(data.record.pricing?.currency || "usd");
            setPermissions(
                (Object.keys(data.record.permissions || {}) as PluginPermission[]).filter((p) => data.record.permissions?.[p])
            );
            setCapabilities((data.record.capabilities || []).join(", "));
            setSupportedMarkets((data.record.supportedMarkets || []).join(", "));
        } catch (err) {
            setNotice(err instanceof Error ? err.message : "Unable to load plugin.");
            setNoticeTone("error");
        } finally {
            setLoading(false);
        }
    }, [id]);

    useEffect(() => {
        void Promise.resolve().then(() => load());
    }, [load]);

    const tell = (message: string, tone: "ok" | "error" = "ok") => {
        setNotice(message);
        setNoticeTone(tone);
    };

    async function apiPut(body: Record<string, unknown>) {
        const token = await getToken();
        const pluginId = record?.id || id;
        const res = await fetch(`/api/admin/plugins/${pluginId}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
            body: JSON.stringify(body),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error ?? "Request failed.");
        return data;
    }

    async function setStatus(next: PluginStatus) {
        if (!record) return;
        setBusy(`status:${next}`);
        setNotice("");
        try {
            await apiPut({ status: next });
            tell(`Status changed from ${record.status} → ${next}.`);
            await load();
        } catch (err) {
            tell(err instanceof Error ? err.message : "Status change failed.", "error");
        } finally {
            setBusy("");
        }
    }

    async function bumpVersion() {
        setBusy("version");
        setNotice("");
        try {
            await apiPut({ action: "version", version: version.trim(), changelog: changelog.trim() });
            tell(`Released version ${version.trim()}.`);
            await load();
        } catch (err) {
            tell(err instanceof Error ? err.message : "Version bump failed.", "error");
        } finally {
            setBusy("");
        }
    }

    async function saveMetadata() {
        setSaving(true);
        setNotice("");
        try {
            const body: Record<string, unknown> = {
                displayName,
                description,
                pricing: {
                    type: pricingType,
                    price: pricingType === "free" ? 0 : Number(price) || 0,
                    currency: currency.trim().toLowerCase() || "usd",
                    intervalMonths: pricingType === "subscription" ? 1 : undefined,
                },
                permissions: permissions.reduce<Record<string, boolean>>((acc, p) => {
                    acc[p] = true;
                    return acc;
                }, {}),
                capabilities: capabilities.split(",").map((c) => c.trim()).filter(Boolean).slice(0, 20),
                supportedMarkets: supportedMarkets.split(",").map((c) => c.trim()).filter(Boolean).slice(0, 10),
            };
            if (documentation.trim()) body.documentation = documentation.trim();
            await apiPut(body);
            tell("Metadata saved and manifest re-validated.");
            await load();
        } catch (err) {
            tell(err instanceof Error ? err.message : "Save failed.", "error");
        } finally {
            setSaving(false);
        }
    }

    async function runSandboxTest() {
        setBusy("sandbox");
        setNotice("");
        setTestResult(null);
        try {
            const token = await getToken();
            const pluginId = record?.id || id;
            const res = await fetch(`/api/admin/plugins/${pluginId}/test`, {
                method: "POST",
                headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
                body: JSON.stringify({
                    symbols: testSymbols.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean).slice(0, 5),
                }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data?.error ?? "Sandbox test failed.");
            setTestResult(data.execution as PluginExecutionRecord);
            tell(data.execution?.status === "success" ? "Sandbox test completed." : "Sandbox test completed with errors.", data.execution?.status === "success" ? "ok" : "error");
        } catch (err) {
            tell(err instanceof Error ? err.message : "Sandbox test failed.", "error");
        } finally {
            setBusy("");
        }
    }

    const togglePermission = (permission: PluginPermission) => {
        setPermissions((prev) => (prev.includes(permission) ? prev.filter((p) => p !== permission) : [...prev, permission]));
    };

    async function deleteRecord() {
        if (!record) return;
        const name = record.displayName || record.id;
        if (
            !window.confirm(
                `Delete "${name}"?\n\nThis removes the catalog record plus every installation, config, runtime state, execution log and alert tied to it. Licenses and order history are kept for financial integrity. This cannot be undone.`
            )
        )
            return;
        setBusy("delete");
        setNotice("");
        try {
            const token = await getToken();
            const pluginId = record?.id || id;
            const res = await fetch(`/api/admin/plugins/${pluginId}`, {
                method: "DELETE",
                headers: { Authorization: `Bearer ${token}` },
            });
            const json = await res.json();
            if (!res.ok) throw new Error(json?.error ?? "Delete failed.");
            router.push("/admin/plugins");
        } catch (err) {
            tell(err instanceof Error ? err.message : "Delete failed.", "error");
        } finally {
            setBusy("");
        }
    }

    if (loading && !record) {
        return (
            <AdminShell title="Plugin" subtitle="Administration">
                <div className="grid gap-4">
                    {[1, 2, 3].map((n) => (
                        <div key={n} className="h-32 animate-pulse rounded-2xl border border-border/30 bg-muted/50" />
                    ))}
                </div>
            </AdminShell>
        );
    }

    if (!record) {
        return (
            <AdminShell title="Plugin not found" subtitle="Administration">
                <EmptyState
                    icon={<Plug size={18} />}
                    title="Plugin record not found"
                    description="No catalog record exists at this id."
                    action={
                        <Link href="/admin/plugins" className="inline-flex items-center gap-2 rounded-xl bg-background px-4 py-2.5 text-xs font-medium text-foreground transition hover:bg-muted">
                            <ArrowLeft size={14} /> Back to Plugins
                        </Link>
                    }
                />
            </AdminShell>
        );
    }

    const typeLabel = record.type === "extension" ? EXTENSION_TYPE_LABELS[(record as PluginRecord & { extensionType?: string }).extensionType || "browser"] : CATEGORY_LABELS[record.category];
    const isExtension = record.type === "extension";

    return (
        <AdminShell title={record.displayName} subtitle={`${record.id} · v${record.version} · ${isExtension ? "Extension" : "Plugin"}`}>
            <div className="mb-5">
                <Link href="/admin/plugins" className="inline-flex items-center gap-1.5 text-xs text-muted-foreground transition hover:text-foreground">
                    <ArrowLeft size={14} /> Back to Plugins
                </Link>
            </div>

            {notice && (
                <div
                    className={`mb-5 flex items-start gap-3 rounded-2xl border p-4 ${
                        noticeTone === "error" ? "border-red-500/30 bg-red-500/10 text-red-300" : "border-emerald-500/30 bg-emerald-500/10 text-emerald-100"
                    }`}
                >
                    <AlertCircle size={16} className="mt-0.5 shrink-0" />
                    <p className="text-sm">{notice}</p>
                </div>
            )}

            {/* Header */}
            <div className="mb-5 rounded-2xl border border-border/30 bg-muted/50 p-5">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                    <div className="flex items-start gap-4">
                        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-border/30 bg-muted/5">
                            {isExtension ? <Plug size={22} className="text-emerald-300" /> : <Sparkles size={22} className="text-violet-300" />}
                        </div>
                        <div>
                            <div className="flex flex-wrap items-center gap-2">
                                <h2 className="text-base font-semibold">{record.displayName}</h2>
                                <StatusBadge tone={pluginStatusTone(record.status)} label={record.status} dot />
                                {record.isAIGenerated && <StatusBadge tone="info" label="AI generated" />}
                            </div>
                            <p className="mt-1 max-w-2xl text-xs leading-5 text-muted-foreground line-clamp-2">{record.description}</p>
                        </div>
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-[11px] text-muted-foreground sm:grid-cols-4">
                        <MiniInfo label="Type" value={typeLabel} />
                        <MiniInfo label="Pricing" value={record.pricing?.type === "free" ? "Free" : formatPrice(record.pricing?.price, record.pricing?.currency)} />
                        <MiniInfo label="Installs" value={formatNumber(record.installs)} />
                        <MiniInfo label="Active users" value={formatNumber(record.activeUsers)} />
                        <MiniInfo label="Rating" value={record.rating?.count ? `${record.rating.average.toFixed(1)} (${record.rating.count})` : "—"} />
                        <MiniInfo label="Created" value={formatDate(record.createdAt)} />
                        <MiniInfo label="Last updated" value={timeAgo(record.updatedAt)} />
                        <MiniInfo label="Version history" value={String(record.versionHistory?.length || 1)} />
                    </div>
                </div>
            </div>

            {/* Marketplace + destructive actions */}
            <div className="mb-5 flex flex-wrap items-center gap-2">
                {record.status === "published" && (
                    <Link
                        href={isExtension ? `/marketplace/extensions/${record.slug || record.id}` : `/marketplace/plugins/${record.slug || record.id}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-2 rounded-xl bg-background px-4 py-2.5 text-xs font-medium text-foreground transition hover:bg-muted"
                    >
                        <ExternalLink size={14} /> View in marketplace
                    </Link>
                )}
                <button
                    type="button"
                    disabled={busy === "delete"}
                    onClick={() => deleteRecord()}
                    className="inline-flex items-center gap-2 rounded-xl border border-red-500/30 bg-muted/5 px-4 py-2.5 text-xs font-medium text-red-300 transition hover:bg-red-500/10 disabled:opacity-50"
                >
                    {busy === "delete" ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                    Delete plugin
                </button>
            </div>

            {/* Tabs */}
            <div className="mb-5 flex flex-wrap gap-2">
                {(
                    [
                        ["overview", "Overview", Activity],
                        ["edit", "Edit metadata", Settings2],
                        ["sandbox", "Sandbox test", FlaskConical],
                        ["audit", "Audit log", ScrollText],
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

            {tab === "overview" && (
                <div className="grid gap-6 lg:grid-cols-2">
                    {/* Lifecycle */}
                    <div className="rounded-2xl border border-border/30 bg-muted/50 p-6">
                        <h3 className="flex items-center gap-2 text-sm font-semibold">
                            <Activity size={14} /> Lifecycle status
                        </h3>
                        <p className="mt-1 text-xs text-muted-foreground">
                            Move the record through the lifecycle. Publishing with existing installations keeps them running; disabling stops new installs.
                        </p>
                        <div className="mt-5 flex flex-wrap items-center gap-2">
                            {STATUS_ORDER.map((status) => (
                                <button
                                    key={status}
                                    type="button"
                                    onClick={() => setStatus(status)}
                                    disabled={busy.startsWith("status") || status === record.status}
                                    className={`inline-flex items-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-50 ${
                                        status === record.status
                                            ? "border-border/50 bg-background text-foreground"
                                            : "border-border/30 bg-muted/5 text-muted-foreground hover:text-foreground"
                                    }`}
                                >
                                    {busy === `status:${status}` ? <Loader2 size={13} className="animate-spin" /> : <CheckCircle2 size={13} />}
                                    {status}
                                </button>
                            ))}
                        </div>
                        <div className="mt-5 rounded-xl border border-border/30 bg-muted/20 p-4">
                            <p className="text-xs leading-6 text-muted-foreground">
                                {record.status === "published"
                                    ? "Published — visible in the marketplace. Users can install and activate it; the scheduler runs active installations server-side."
                                    : "Not published — hidden from the marketplace. Users cannot install it until the record is published."}
                            </p>
                        </div>

                        <h3 className="mt-6 flex items-center gap-2 text-sm font-semibold">
                            <Clock size={14} /> Release version
                        </h3>
                        <div className="mt-3 space-y-3">
                            <Field label="Semantic version (e.g. 1.1.0)">
                                <input
                                    value={version}
                                    onChange={(e) => setVersion(e.target.value)}
                                    className="w-full rounded-xl border border-border/30 bg-muted/50 p-3 text-sm outline-none focus:border-border/50"
                                />
                            </Field>
                            <Field label="Changelog note">
                                <textarea
                                    value={changelog}
                                    onChange={(e) => setChangelog(e.target.value)}
                                    rows={2}
                                    className="w-full rounded-xl border border-border/30 bg-muted/50 p-3 text-sm outline-none focus:border-border/50"
                                />
                            </Field>
                            <button
                                type="button"
                                onClick={bumpVersion}
                                disabled={busy === "version"}
                                className="inline-flex items-center gap-2 rounded-xl bg-background px-4 py-2.5 text-xs font-medium text-foreground transition hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
                            >
                                {busy === "version" ? <Loader2 size={14} className="animate-spin" /> : <Tag size={14} />}
                                Bump version
                            </button>
                        </div>
                    </div>

                    {/* Manifest summary */}
                    <div className="rounded-2xl border border-border/30 bg-muted/50 p-6">
                        <h3 className="flex items-center gap-2 text-sm font-semibold">
                            <Shield size={14} /> Manifest contract
                        </h3>
                        <p className="mt-1 text-xs text-muted-foreground">
                            The manifest defines what the runtime may do. Grants follow this contract exactly.
                        </p>
                        <dl className="mt-5 space-y-3 text-sm">
                            <Row label="Runtime mode" value={record.manifest?.runtime?.handler ? "Built-in analyzer" : "Declarative condition"} />
                            <Row label="Interval" value={record.manifest?.runtime?.interval || "—"} />
                            <Row label="Timeout" value={`${record.manifest?.runtime?.timeoutMs || 0}ms`} />
                            <Row label="Subscribes" value={String(record.manifest?.subscribes?.length || 0)} />
                            <Row label="Emits" value={String(record.manifest?.emits?.length || 0)} />
                            <Row label="Requires (APIs)" value={record.manifest?.runtime?.requires?.length ? record.manifest.runtime.requires.join(", ") : "—"} />
                            <Row label="Sources" value={record.manifest?.runtime?.sources?.length ? record.manifest.runtime.sources.join(", ") : "—"} />
                        </dl>

                        <h3 className="mt-6 flex items-center gap-2 text-sm font-semibold">
                            <Lock size={14} /> Granted permissions
                        </h3>
                        <div className="mt-3 flex flex-wrap gap-2">
                            {(Object.keys(record.permissions || {}) as PluginPermission[]).filter((p) => record.permissions?.[p]).length === 0 ? (
                                <span className="text-xs text-muted-foreground">No permissions granted.</span>
                            ) : (
                                (Object.keys(record.permissions || {}) as PluginPermission[]).filter((p) => record.permissions?.[p]).map((p) => (
                                    <span key={p} className="rounded-lg bg-muted/5 px-2.5 py-1 text-[11px] text-muted-foreground">
                                        {permissionLabel(p)}
                                    </span>
                                ))
                            )}
                        </div>

                        <div className="mt-6 flex flex-wrap gap-2 border-t border-border/30 pt-4">
                            {(record.capabilities || []).slice(0, 8).map((cap) => (
                                <span key={cap} className="rounded-lg border border-border/30 bg-muted/20 px-2.5 py-1 text-[11px] text-muted-foreground">
                                    {cap}
                                </span>
                            ))}
                        </div>
                    </div>
                </div>
            )}

            {tab === "edit" && (
                <div className="rounded-2xl border border-border/30 bg-muted/50 p-6">
                    <h3 className="flex items-center gap-2 text-sm font-semibold">
                        <Settings2 size={14} /> Metadata & pricing
                    </h3>
                    <p className="mt-1 text-xs text-muted-foreground">
                        Saving re-validates the manifest contract. Counters cannot be edited — they reflect real installs and usage.
                    </p>

                    <div className="mt-6 grid gap-6 lg:grid-cols-2">
                        <Field label="Display name">
                            <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} className="w-full rounded-xl border border-border/30 bg-muted/50 p-3 text-sm outline-none focus:border-border/50" />
                        </Field>
                        <div className="lg:col-span-2">
                            <Field label="Description">
                                <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} className="w-full rounded-xl border border-border/30 bg-muted/50 p-3 text-sm outline-none focus:border-border/50" />
                            </Field>
                        </div>
                        <div className="lg:col-span-2">
                            <Field label="Documentation (markdown-ish)">
                                <textarea value={documentation} onChange={(e) => setDocumentation(e.target.value)} rows={6} className="w-full rounded-xl border border-border/30 bg-muted/50 p-3 font-mono text-xs outline-none focus:border-border/50" />
                            </Field>
                        </div>
                        <Field label="Pricing type">
                            <div className="flex flex-wrap gap-2">
                                {PRICING_TYPES.map((t) => (
                                    <button
                                        key={t.value}
                                        type="button"
                                        onClick={() => setPricingType(t.value)}
                                        className={`rounded-lg border px-3 py-1.5 text-xs transition ${
                                            pricingType === t.value ? "border-border/50 bg-background text-foreground" : "border-border/30 bg-muted/5 text-muted-foreground hover:text-foreground"
                                        }`}
                                    >
                                        {t.label}
                                    </button>
                                ))}
                            </div>
                        </Field>
                        {pricingType !== "free" && (
                            <div className="grid grid-cols-2 gap-3">
                                <Field label="Price">
                                    <input type="number" min={0} value={price} onChange={(e) => setPrice(e.target.value)} className="w-full rounded-xl border border-border/30 bg-muted/50 p-3 text-sm outline-none focus:border-border/50" />
                                </Field>
                                <Field label="Currency">
                                    <input value={currency} onChange={(e) => setCurrency(e.target.value)} className="w-full rounded-xl border border-border/30 bg-muted/50 p-3 text-sm outline-none focus:border-border/50" />
                                </Field>
                            </div>
                        )}
                        <Field label="Capabilities (comma separated)">
                            <input value={capabilities} onChange={(e) => setCapabilities(e.target.value)} className="w-full rounded-xl border border-border/30 bg-muted/50 p-3 text-sm outline-none focus:border-border/50" />
                        </Field>
                        <Field label="Supported markets (comma separated)">
                            <input value={supportedMarkets} onChange={(e) => setSupportedMarkets(e.target.value)} className="w-full rounded-xl border border-border/30 bg-muted/50 p-3 text-sm outline-none focus:border-border/50" />
                        </Field>
                    </div>

                    <h3 className="mt-6 text-sm font-semibold">Permissions</h3>
                    <p className="mt-1 text-xs text-muted-foreground">The runtime grants data access ONLY for permissions listed here.</p>
                    <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                        {(Object.keys(PERMISSION_CATALOG) as PluginPermission[]).map((permission) => {
                            const enabled = permissions.includes(permission);
                            return (
                                <button
                                    key={permission}
                                    type="button"
                                    onClick={() => togglePermission(permission)}
                                    className={`rounded-xl border p-4 text-left transition ${
                                        enabled ? "border-violet-500/40 bg-violet-500/10" : "border-border/30 bg-muted/20 hover:border-border/50"
                                    }`}
                                >
                                    <div className="flex items-center justify-between gap-2">
                                        <p className="text-sm font-medium">{permissionLabel(permission)}</p>
                                        {enabled && <CheckCircle2 size={14} className="text-violet-300" />}
                                    </div>
                                    <p className="mt-1 text-[11px] leading-5 text-muted-foreground">{permissionDescription(permission)}</p>
                                </button>
                            );
                        })}
                    </div>

                    <div className="mt-6 flex items-center justify-end gap-3">
                        <button
                            type="button"
                            onClick={load}
                            className="inline-flex items-center gap-2 rounded-xl border border-border/30 bg-muted/5 px-4 py-2.5 text-xs font-medium text-muted-foreground transition hover:text-foreground"
                        >
                            <RefreshCw size={13} />
                            Discard changes
                        </button>
                        <button
                            type="button"
                            onClick={saveMetadata}
                            disabled={saving}
                            className="inline-flex items-center gap-2 rounded-xl bg-background px-5 py-2.5 text-xs font-medium text-foreground transition hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
                        >
                            {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                            Save metadata
                        </button>
                    </div>
                </div>
            )}

            {tab === "sandbox" && (
                <div className="grid gap-6 lg:grid-cols-2">
                    <div className="rounded-2xl border border-border/30 bg-muted/50 p-6">
                        <h3 className="flex items-center gap-2 text-sm font-semibold">
                            <FlaskConical size={14} /> Sandbox test
                        </h3>
                        <p className="mt-1 text-xs text-muted-foreground">
                            Executes the plugin in test mode with synthetic market data. No alerts are delivered and no user state is touched.
                        </p>
                        <Field label="Symbols (comma separated, max 5)">
                            <input
                                value={testSymbols}
                                onChange={(e) => setTestSymbols(e.target.value)}
                                placeholder="EURUSD, XAUUSD"
                                className="w-full rounded-xl border border-border/30 bg-muted/50 p-3 text-sm outline-none placeholder:text-muted-foreground focus:border-border/50"
                            />
                        </Field>
                        <button
                            type="button"
                            onClick={runSandboxTest}
                            disabled={busy === "sandbox"}
                            className="mt-4 inline-flex items-center gap-2 rounded-xl bg-background px-5 py-2.5 text-xs font-medium text-foreground transition hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
                        >
                            {busy === "sandbox" ? <Loader2 size={14} className="animate-spin" /> : <PlayCircle size={14} />}
                            Run sandbox test
                        </button>
                        {testResult && (
                            <div className="mt-5 border-t border-border/30 pt-4">
                                <h4 className="text-xs font-medium">Latest result</h4>
                                <div className="mt-3 flex items-center gap-2">
                                    <StatusBadge tone={testResult.status === "success" ? "positive" : "error"} label={testResult.status} dot />
                                    <span className="text-xs text-muted-foreground">{testResult.durationMs}ms · trigger: {testResult.trigger}</span>
                                </div>
                                {testResult.summary && <p className="mt-2 text-xs leading-5 text-muted-foreground">{testResult.summary}</p>}
                                {testResult.error && <p className="mt-2 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-300">{testResult.error}</p>}
                                {testResult.findings && testResult.findings.length > 0 && (
                                    <div className="mt-3 space-y-2">
                                        {testResult.findings.map((f, i) => (
                                            <div key={i} className="rounded-lg border border-border/30 bg-muted/20 p-3">
                                                <p className="text-xs font-medium text-foreground">{f.title}</p>
                                                <p className="mt-0.5 text-[11px] text-muted-foreground">{f.detail}</p>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        )}
                    </div>

                    <div className="rounded-2xl border border-border/30 bg-muted/50 p-6">
                        <h3 className="flex items-center gap-2 text-sm font-semibold">
                            <FlaskConical size={14} /> What a test checks
                        </h3>
                        <ul className="mt-4 space-y-3 text-xs leading-6 text-muted-foreground">
                            <li className="flex gap-2"><CheckCircle2 size={14} className="mt-0.5 shrink-0 text-emerald-400" /> Conditions evaluate against the current market snapshot for the requested symbols.</li>
                            <li className="flex gap-2"><CheckCircle2 size={14} className="mt-0.5 shrink-0 text-emerald-400" /> Findings and alerts are produced but NOT delivered — test mode suppresses the notification hub.</li>
                            <li className="flex gap-2"><CheckCircle2 size={14} className="mt-0.5 shrink-0 text-emerald-400" /> Execution outcome is recorded in the audit log under <span className="text-foreground">plugin.sandbox.tested</span>.</li>
                            <li className="flex gap-2"><Shield size={14} className="mt-0.5 shrink-0 text-violet-400" /> Permission-gated data access is enforced exactly like production runs.</li>
                        </ul>
                    </div>
                </div>
            )}

            {tab === "audit" && (
                <div className="rounded-2xl border border-border/30 bg-muted/50 p-6">
                    <div className="flex items-center justify-between">
                        <h3 className="flex items-center gap-2 text-sm font-semibold">
                            <ScrollText size={14} /> Audit log
                        </h3>
                        <button type="button" onClick={load} className="inline-flex items-center gap-1.5 text-xs text-muted-foreground transition hover:text-foreground">
                            <RefreshCw size={12} />
                            Refresh
                        </button>
                    </div>
                    {audit.length === 0 ? (
                        <EmptyState compact icon={<Terminal size={18} />} title="No audit events yet" description="Status changes, version bumps, edits, sandbox tests and publishes are recorded here." />
                    ) : (
                        <div className="mt-4 overflow-hidden rounded-xl border border-border/30 bg-muted/20">
                            {audit.map((entry) => (
                                <div key={entry.id} className="flex flex-col gap-1 border-b border-border/30 p-3 last:border-0 sm:flex-row sm:items-center sm:justify-between">
                                    <div className="min-w-0">
                                        <p className="text-xs font-medium text-foreground">{entry.action}</p>
                                        <p className="mt-0.5 text-[11px] text-muted-foreground">
                                            actor: {entry.actor}
                                            {entry.detail && Object.keys(entry.detail).length > 0 && ` · ${JSON.stringify(entry.detail)}`}
                                        </p>
                                    </div>
                                    <span className="shrink-0 text-[11px] text-muted-foreground">{formatDate(entry.createdAt)}</span>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}

            <div className="mt-6">
                <Link href="/admin/plugins" className="inline-flex items-center gap-1.5 text-xs text-muted-foreground transition hover:text-foreground">
                    <ArrowLeft size={14} />
                    Back to Plugins
                </Link>
            </div>
        </AdminShell>
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