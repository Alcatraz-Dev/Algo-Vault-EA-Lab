"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, CheckCircle2, Loader2, Plus, Save } from "lucide-react";
import AdminShell from "@/components/admin/AdminShell";
import { auth } from "@/lib/firebase";
import {
    CATEGORIES,
    EXTENSION_TYPE_LABELS,
    INTERVALS,
    INTERVAL_LABELS,
    permissionDescription,
    permissionLabel,
} from "@/lib/plugins/ui";
import { PluginCategory, PluginExtensionType, PluginInterval, PluginKind, PluginPermission, PluginPricingType } from "@/lib/plugins/types";
import { PERMISSION_CATALOG } from "@/lib/plugins/permissions";

const PRICING_TYPES: { value: PluginPricingType; label: string }[] = [
    { value: "free", label: "Free" },
    { value: "one_time", label: "One-time" },
    { value: "subscription", label: "Subscription (monthly)" },
];

const EXTENSION_TYPES: PluginExtensionType[] = ["browser", "tradingview", "webhook", "discord", "telegram", "api"];

async function getToken() {
    const user = auth.currentUser;
    if (!user) throw new Error("Authentication required.");
    return user.getIdToken();
}

export default function AdminCreatePluginPage() {
    const router = useRouter();
    const [id, setId] = useState("");
    const [displayName, setDisplayName] = useState("");
    const [description, setDescription] = useState("");
    const [type, setType] = useState<PluginKind>("plugin");
    const [extensionType, setExtensionType] = useState<PluginExtensionType>("browser");
    const [category, setCategory] = useState<PluginCategory>("trading-intelligence");
    const [pricingType, setPricingType] = useState<PluginPricingType>("free");
    const [price, setPrice] = useState("0");
    const [currency, setCurrency] = useState("usd");
    const [permissions, setPermissions] = useState<PluginPermission[]>([]);
    const [capabilities, setCapabilities] = useState("");
    const [interval, setInterval] = useState<PluginInterval>("5m");
    const [timeoutMs, setTimeoutMs] = useState("15000");
    const [handler, setHandler] = useState("");
    const [status, setStatus] = useState<"draft" | "testing" | "published" | "disabled">("draft");
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState("");

    // Support "/admin/plugins/create?type=extension" so the Extensions page can deep-link here.
    useEffect(() => {
        const queryType = new URLSearchParams(window.location.search).get("type");
        if (queryType === "extension") {
            void Promise.resolve().then(() => setType("extension"));
        }
    }, []);

    const togglePermission = (permission: PluginPermission) => {
        setPermissions((prev) => (prev.includes(permission) ? prev.filter((p) => p !== permission) : [...prev, permission]));
    };

    async function handleSubmit() {
        setSaving(true);
        setError("");
        try {
            const slug = id.trim().toLowerCase().replace(/[^a-z0-9_-]/g, "-").replace(/-+/g, "-") || null;
            if (!slug) throw new Error("A valid plugin id is required (lowercase letters, numbers, dashes).");
            if (!displayName.trim()) throw new Error("Display name is required.");

            const permissionSet = permissions.reduce<Record<string, boolean>>((acc, p) => {
                acc[p] = true;
                return acc;
            }, {});

            const record = {
                id: slug,
                name: slug,
                slug,
                displayName: displayName.trim(),
                description: description.trim() || "No description provided.",
                type,
                ...(type === "extension" ? { extensionType } : {}),
                category,
                pricing: {
                    type: pricingType,
                    price: pricingType === "free" ? 0 : Number(price) || 0,
                    currency: currency.trim().toLowerCase() || "usd",
                    intervalMonths: pricingType === "subscription" ? 1 : undefined,
                },
                permissions: permissionSet,
                capabilities: capabilities.split(",").map((c) => c.trim()).filter(Boolean).slice(0, 20),
                supportedMarkets: [],
                supportedNotifications: [],
                creator: { uid: "admin", name: "AlgoVault Admin", kind: "admin" },
                isAIGenerated: false,
                status,
                manifest: {
                    name: slug,
                    displayName: displayName.trim(),
                    version: "1.0.0",
                    type,
                    category,
                    pricing: {
                        type: pricingType,
                        price: pricingType === "free" ? 0 : Number(price) || 0,
                        currency: currency.trim().toLowerCase() || "usd",
                        intervalMonths: pricingType === "subscription" ? 1 : undefined,
                    },
                    permissions: permissionSet,
                    subscribes: [],
                    emits: [],
                    runtime: {
                        handler: handler.trim() || undefined,
                        interval,
                        timeoutMs: Number(timeoutMs) || 15000,
                        sources: [],
                        requires: [],
                    },
                },
            };

            const token = await getToken();
            const res = await fetch("/api/admin/plugins", {
                method: "POST",
                headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
                body: JSON.stringify({ record }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data?.error || "Unable to create the plugin.");
            router.push(`/admin/plugins/${data.record.id}`);
        } catch (err) {
            setError(err instanceof Error ? err.message : "Unable to create the plugin.");
            setSaving(false);
        }
    }

    return (
        <AdminShell title="Create Plugin" subtitle="Register a new plugin or extension record in the catalog.">
            <div className="mb-5">
                <Link href="/admin/plugins" className="inline-flex items-center gap-1.5 text-xs text-muted-foreground transition hover:text-foreground">
                    <ArrowLeft size={14} /> Back to Plugins
                </Link>
            </div>

            {error && (
                <div className="mb-5 rounded-2xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-300">{error}</div>
            )}

            <div className="rounded-2xl border border-border/30 bg-muted/50 p-6">
                <h3 className="text-sm font-semibold">Identity</h3>
                <div className="mt-4 grid gap-4 lg:grid-cols-2">
                    <Field label="Plugin id (slug — lowercase letters, digits, dash)">
                        <input
                            value={id}
                            onChange={(e) => setId(e.target.value)}
                            placeholder="e.g. momentum-guard"
                            className="w-full rounded-xl border border-border/30 bg-muted/50 p-3 text-sm outline-none placeholder:text-muted-foreground focus:border-border/50"
                        />
                    </Field>
                    <Field label="Display name">
                        <input
                            value={displayName}
                            onChange={(e) => setDisplayName(e.target.value)}
                            placeholder="e.g. Momentum Guard"
                            className="w-full rounded-xl border border-border/30 bg-muted/50 p-3 text-sm outline-none placeholder:text-muted-foreground focus:border-border/50"
                        />
                    </Field>
                    <div className="lg:col-span-2">
                        <Field label="Description">
                            <textarea
                                value={description}
                                onChange={(e) => setDescription(e.target.value)}
                                rows={3}
                                placeholder="What does this plugin analyze?"
                                className="w-full rounded-xl border border-border/30 bg-muted/50 p-3 text-sm outline-none placeholder:text-muted-foreground focus:border-border/50"
                            />
                        </Field>
                    </div>
                </div>
            </div>

            <div className="mt-5 rounded-2xl border border-border/30 bg-muted/50 p-6">
                <h3 className="text-sm font-semibold">Type, category & pricing</h3>
                <div className="mt-4 grid gap-4 lg:grid-cols-2">
                    <Field label="Type">
                        <div className="flex gap-2">
                            {(["plugin", "extension"] as PluginKind[]).map((t) => (
                                <button
                                    key={t}
                                    type="button"
                                    onClick={() => setType(t)}
                                    className={`rounded-lg border px-3 py-1.5 text-xs capitalize transition ${
                                        type === t ? "border-border/50 bg-background text-foreground" : "border-border/30 bg-muted/5 text-muted-foreground hover:text-foreground"
                                    }`}
                                >
                                    {t}
                                </button>
                            ))}
                        </div>
                    </Field>
                    <Field label="Category">
                        <select
                            value={category}
                            onChange={(e) => setCategory(e.target.value as PluginCategory)}
                            className="w-full rounded-xl border border-border/30 bg-muted/50 p-3 text-sm outline-none focus:border-border/50"
                        >
                            {CATEGORIES.map((c) => (
                                <option key={c.id} value={c.id}>
                                    {c.label}
                                </option>
                            ))}
                        </select>
                    </Field>
                    {type === "extension" && (
                        <Field label="Extension type (how it connects)">
                            <div className="flex flex-wrap gap-2">
                                {EXTENSION_TYPES.map((t) => (
                                    <button
                                        key={t}
                                        type="button"
                                        onClick={() => setExtensionType(t)}
                                        className={`rounded-lg border px-3 py-1.5 text-xs transition ${
                                            extensionType === t
                                                ? "border-border/50 bg-background text-foreground"
                                                : "border-border/30 bg-muted/5 text-muted-foreground hover:text-foreground"
                                        }`}
                                    >
                                        {EXTENSION_TYPE_LABELS[t] || t}
                                    </button>
                                ))}
                            </div>
                        </Field>
                    )}
                    <Field label="Pricing type">
                        <div className="flex flex-wrap gap-2">
                            {PRICING_TYPES.map((t) => (
                                <button
                                    key={t.value}
                                    type="button"
                                    onClick={() => setPricingType(t.value)}
                                    className={`rounded-lg border px-3 py-1.5 text-xs transition ${
                                        pricingType === t.value
                                            ? "border-border/50 bg-background text-foreground"
                                            : "border-border/30 bg-muted/5 text-muted-foreground hover:text-foreground"
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
                                <input
                                    type="number"
                                    min={0}
                                    value={price}
                                    onChange={(e) => setPrice(e.target.value)}
                                    className="w-full rounded-xl border border-border/30 bg-muted/50 p-3 text-sm outline-none focus:border-border/50"
                                />
                            </Field>
                            <Field label="Currency">
                                <input
                                    value={currency}
                                    onChange={(e) => setCurrency(e.target.value)}
                                    className="w-full rounded-xl border border-border/30 bg-muted/50 p-3 text-sm outline-none focus:border-border/50"
                                />
                            </Field>
                        </div>
                    )}
                </div>
            </div>

            <div className="mt-5 rounded-2xl border border-border/30 bg-muted/50 p-6">
                <h3 className="text-sm font-semibold">Runtime</h3>
                <div className="mt-4 grid gap-4 lg:grid-cols-2">
                    <Field label="Interval">
                        <select
                            value={interval}
                            onChange={(e) => setInterval(e.target.value as PluginInterval)}
                            className="w-full rounded-xl border border-border/30 bg-muted/50 p-3 text-sm outline-none focus:border-border/50"
                        >
                            {INTERVALS.map((i) => (
                                <option key={i} value={i}>
                                    {INTERVAL_LABELS[i] || i}
                                </option>
                            ))}
                        </select>
                    </Field>
                    <Field label="Timeout (ms, 1000–120000)">
                        <input
                            type="number"
                            min={1000}
                            max={120000}
                            value={timeoutMs}
                            onChange={(e) => setTimeoutMs(e.target.value)}
                            className="w-full rounded-xl border border-border/30 bg-muted/50 p-3 text-sm outline-none focus:border-border/50"
                        />
                    </Field>
                    <Field label="Handler (optional — registered analyzer name; leave empty for declarative conditions)">
                        <input
                            value={handler}
                            onChange={(e) => setHandler(e.target.value)}
                            placeholder="e.g. risk_guardian"
                            className="w-full rounded-xl border border-border/30 bg-muted/50 p-3 text-sm outline-none placeholder:text-muted-foreground focus:border-border/50"
                        />
                    </Field>
                    <Field label="Status">
                        <div className="flex flex-wrap gap-2">
                            {(["draft", "testing", "published", "disabled"] as const).map((s) => (
                                <button
                                    key={s}
                                    type="button"
                                    onClick={() => setStatus(s)}
                                    className={`rounded-lg border px-3 py-1.5 text-xs capitalize transition ${
                                        status === s ? "border-border/50 bg-background text-foreground" : "border-border/30 bg-muted/5 text-muted-foreground hover:text-foreground"
                                    }`}
                                >
                                    {s}
                                </button>
                            ))}
                        </div>
                    </Field>
                </div>
            </div>

            <div className="mt-5 rounded-2xl border border-border/30 bg-muted/50 p-6">
                <h3 className="text-sm font-semibold">Permissions</h3>
                <p className="mt-1 text-xs text-muted-foreground">
                    The runtime grants data access ONLY for permissions listed here.
                </p>
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
            </div>

            <div className="mt-5 rounded-2xl border border-border/30 bg-muted/50 p-6">
                <h3 className="text-sm font-semibold">Capabilities</h3>
                <div className="mt-4">
                    <Field label="Comma-separated capability list">
                        <input
                            value={capabilities}
                            onChange={(e) => setCapabilities(e.target.value)}
                            placeholder="e.g. Momentum detection, Regime filter, Alert throttling"
                            className="w-full rounded-xl border border-border/30 bg-muted/50 p-3 text-sm outline-none placeholder:text-muted-foreground focus:border-border/50"
                        />
                    </Field>
                </div>
            </div>

            <div className="mt-6 flex items-center justify-end gap-3">
                <Link href="/admin/plugins" className="rounded-xl border border-border/30 bg-muted/5 px-4 py-2.5 text-xs font-medium text-muted-foreground transition hover:text-foreground">
                    Cancel
                </Link>
                <button
                    type="button"
                    onClick={handleSubmit}
                    disabled={saving}
                    className="inline-flex items-center gap-2 rounded-xl bg-background px-5 py-2.5 text-xs font-medium text-foreground transition hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
                >
                    {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                    {saving ? "Creating..." : "Create Plugin"}
                </button>
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