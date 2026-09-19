"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
    ArrowLeft,
    Sparkles,
    Save,
    RefreshCw,
    TrendingUp,
    Clock,
    Shield,
    BarChart3,
    AlertCircle,
    CheckCircle,
} from "lucide-react";
import { onAuthStateChanged } from "firebase/auth";
import { auth } from "@/lib/firebase";
import { SignalConfig, MarketSessionName } from "@/lib/ai-signals/types";

const SYMBOLS = [
    "XAUUSD", "EURUSD", "GBPUSD", "USDJPY", "USDCHF",
    "AUDUSD", "NZDUSD", "US30", "NAS100", "SPX500",
    "BTCUSD", "ETHUSD",
];

const TIMEFRAMES = ["M1", "M3", "M5", "M15", "M30", "H1", "H4", "D1"];

const SESSIONS: { value: string; label: string }[] = [
    { value: "asian", label: "Asian" },
    { value: "london", label: "London" },
    { value: "new_york", label: "New York" },
    { value: "overlap", label: "Overlap" },
];

const WEIGHT_KEYS = [
    "trendAlignment",
    "marketStructure",
    "liquidity",
    "momentum",
    "volume",
    "orderFlow",
    "entryConfirmation",
] as const;

const WEIGHT_LABELS: Record<string, string> = {
    trendAlignment: "Trend Alignment",
    marketStructure: "Market Structure",
    liquidity: "Liquidity",
    momentum: "Momentum",
    volume: "Volume",
    orderFlow: "Order Flow",
    entryConfirmation: "Entry Confirmation",
};

const DEFAULT_CONFIG: Partial<SignalConfig> = {
    symbols: [],
    timeframes: [],
    sessions: [],
    minimumConfidence: 70,
    minimumRiskReward: 2.0,
    signalCooldownMinutes: 15,
    signalExpirationHours: 4,
    freeSignalsPerDay: 3,
    proSignalsPerDay: 10,
    weights: {
        trendAlignment: 20,
        marketStructure: 20,
        liquidity: 15,
        momentum: 15,
        volume: 10,
        orderFlow: 10,
        entryConfirmation: 10,
    },
    riskDefaults: {
        riskPercent: 1,
        maxPositions: 5,
    },
};

export default function AdminSignalsPage() {
    const [config, setConfig] = useState<Partial<SignalConfig>>(DEFAULT_CONFIG);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [toast, setToast] = useState<{ type: "success" | "error"; message: string } | null>(null);
    const [isAdmin, setIsAdmin] = useState(false);

    useEffect(() => {
        const unsub = onAuthStateChanged(auth, async (user) => {
            if (!user) {
                setLoading(false);
                return;
            }
            try {
                const tokenResult = await user.getIdTokenResult();
                const adminClaim = tokenResult.claims.admin === true;
                setIsAdmin(adminClaim);
                if (!adminClaim) {
                    setLoading(false);
                    return;
                }
                const resp = await fetch("/api/ai-signals/admin", {
                    headers: { Authorization: `Bearer ${await user.getIdToken()}` },
                });
                const data = await resp.json();
                if (data.success && data.config) {
                    setConfig((prev) => ({ ...prev, ...data.config }));
                }
            } catch {
                // silently fail
            } finally {
                setLoading(false);
            }
        });
        return () => unsub();
    }, []);

    function showToast(type: "success" | "error", message: string) {
        setToast({ type, message });
        setTimeout(() => setToast(null), 4000);
    }

    function toggleArrayItem(key: "symbols" | "timeframes" | "sessions", value: string) {
        setConfig((prev) => {
            const current = (prev[key] as string[]) || [];
            const next = current.includes(value)
                ? current.filter((v) => v !== value)
                : [...current, value];
            return { ...prev, [key]: next } as Partial<SignalConfig>;
        });
    }

    function setWeight(key: string, value: number) {
        setConfig((prev) => {
            const weights = { ...(prev.weights || DEFAULT_CONFIG.weights!), [key]: value };
            return { ...prev, weights } as Partial<SignalConfig>;
        });
    }

    function setRiskDefaults(key: string, value: number) {
        setConfig((prev) => {
            const riskDefaults = { ...(prev.riskDefaults || DEFAULT_CONFIG.riskDefaults!), [key]: value };
            return { ...prev, riskDefaults } as Partial<SignalConfig>;
        });
    }

    async function handleSave() {
        setSaving(true);
        try {
            const user = auth.currentUser;
            if (!user) throw new Error("Not authenticated");
            const resp = await fetch("/api/ai-signals/admin", {
                method: "PUT",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${await user.getIdToken()}`,
                },
                body: JSON.stringify(config),
            });
            const data = await resp.json();
            if (data.success) {
                setConfig((prev) => ({ ...prev, ...data.config }));
                showToast("success", "Configuration saved successfully");
            } else {
                showToast("error", data.error || "Failed to save configuration");
            }
        } catch {
            showToast("error", "Failed to save configuration");
        } finally {
            setSaving(false);
        }
    }

    if (loading) {
        return (
            <div className="min-h-screen bg-background text-foreground selection:bg-amber-500/30">
                <div className="pointer-events-none fixed inset-0 overflow-hidden">
                    <div className="absolute -left-40 -top-40 h-96 w-96 rounded-full bg-amber-500/10 blur-[120px]" />
                    <div className="absolute -right-40 top-1/3 h-96 w-96 rounded-full bg-blue-500/10 blur-[120px]" />
                </div>
                <div className="relative mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8 flex items-center justify-center min-h-screen">
                    <RefreshCw className="h-8 w-8 animate-spin text-amber-400" />
                </div>
            </div>
        );
    }

    if (!isAdmin) {
        return (
            <div className="min-h-screen bg-background text-foreground selection:bg-amber-500/30">
                <div className="pointer-events-none fixed inset-0 overflow-hidden">
                    <div className="absolute -left-40 -top-40 h-96 w-96 rounded-full bg-amber-500/10 blur-[120px]" />
                    <div className="absolute -right-40 top-1/3 h-96 w-96 rounded-full bg-blue-500/10 blur-[120px]" />
                </div>
                <div className="relative mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8 flex flex-col items-center justify-center min-h-screen gap-4">
                    <AlertCircle className="h-12 w-12 text-red-400" />
                    <h1 className="text-2xl font-bold">Access Denied</h1>
                    <p className="text-muted-foreground">You do not have admin privileges.</p>
                    <Link href="/admin" className="text-amber-400 hover:underline text-sm">Return to Admin</Link>
                </div>
            </div>
        );
    }

    const weights = config.weights || DEFAULT_CONFIG.weights!;
    const totalWeight = Object.values(weights).reduce((a, b) => a + b, 0);

    return (
        <div className="min-h-screen bg-background text-foreground selection:bg-amber-500/30">
            {/* BACKGROUND GRADIENT GLOWS */}
            <div className="pointer-events-none fixed inset-0 overflow-hidden">
                <div className="absolute -left-40 -top-40 h-96 w-96 rounded-full bg-amber-500/10 blur-[120px]" />
                <div className="absolute -right-40 top-1/3 h-96 w-96 rounded-full bg-blue-500/10 blur-[120px]" />
            </div>

            {/* TOAST */}
            {toast && (
                <div className="fixed top-4 right-4 z-50 animate-in fade-in slide-in-from-top-4">
                    <div className={`flex items-center gap-2 rounded-xl border px-4 py-3 text-sm font-medium shadow-2xl backdrop-blur-xl ${
                        toast.type === "success"
                            ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
                            : "border-red-500/30 bg-red-500/10 text-red-400"
                    }`}>
                        {toast.type === "success" ? <CheckCircle className="h-4 w-4" /> : <AlertCircle className="h-4 w-4" />}
                        {toast.message}
                    </div>
                </div>
            )}

            <div className="relative mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
                {/* HEADER */}
                <div data-guide="page-header" className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
                    <div>
                        <Link
                            href="/admin"
                            className="mb-6 inline-flex items-center gap-2 text-sm text-muted-foreground transition hover:text-foreground"
                        >
                            <ArrowLeft size={16} />
                            Back to Admin
                        </Link>

                        <div className="flex items-center gap-2 text-sm text-amber-400 font-medium">
                            <Sparkles className="h-4 w-4" />
                            AI Signal Engine Configuration
                        </div>

                        <h1 className="mt-2 text-3xl font-extrabold tracking-tight sm:text-4xl">
                            AI Signal Configuration
                        </h1>

                        <p className="mt-2 text-sm text-muted-foreground max-w-2xl">
                            Configure symbols, timeframes, sessions, confidence thresholds, weight distribution, risk defaults, and signal limits for the AI signal engine.
                        </p>
                    </div>

                    <div className="flex flex-wrap items-center gap-3">
                        <button
                            onClick={handleSave}
                            disabled={saving}
                            className="inline-flex items-center gap-2 rounded-xl border border-amber-500/20 bg-amber-500/10 px-5 py-2.5 text-sm font-medium text-amber-400 transition-colors hover:bg-amber-500/20 disabled:opacity-50"
                        >
                            {saving ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                            {saving ? "Saving..." : "Save Configuration"}
                        </button>
                    </div>
                </div>

                {/* FORM SECTIONS */}
                <div className="mt-8 space-y-6">

                    {/* SYMBOLS */}
                    <Card title="Symbols" icon={<TrendingUp className="h-4 w-4 text-amber-400" />} description="Select which instruments the AI engine monitors.">
                        <div className="flex flex-wrap gap-2">
                            {SYMBOLS.map((sym) => (
                                <button
                                    key={sym}
                                    onClick={() => toggleArrayItem("symbols", sym)}
                                    className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
                                        (config.symbols || []).includes(sym)
                                            ? "border-amber-500/40 bg-amber-500/15 text-amber-400"
                                            : "border-border/30 bg-muted/5 text-muted-foreground hover:border-border/50 hover:text-foreground"
                                    }`}
                                >
                                    {sym}
                                </button>
                            ))}
                        </div>
                    </Card>

                    {/* TIMEFRAMES */}
                    <Card title="Timeframes" icon={<Clock className="h-4 w-4 text-blue-400" />} description="Select which candle timeframes to analyze.">
                        <div className="flex flex-wrap gap-2">
                            {TIMEFRAMES.map((tf) => (
                                <button
                                    key={tf}
                                    onClick={() => toggleArrayItem("timeframes", tf)}
                                    className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
                                        (config.timeframes || []).includes(tf)
                                            ? "border-blue-500/40 bg-blue-500/15 text-blue-400"
                                            : "border-border/30 bg-muted/5 text-muted-foreground hover:border-border/50 hover:text-foreground"
                                    }`}
                                >
                                    {tf}
                                </button>
                            ))}
                        </div>
                    </Card>

                    {/* SESSIONS */}
                    <Card title="Sessions" icon={<BarChart3 className="h-4 w-4 text-emerald-400" />} description="Select which market sessions to trade.">
                        <div className="flex flex-wrap gap-2">
                            {SESSIONS.map((s) => (
                                <button
                                    key={s.value}
                                    onClick={() => toggleArrayItem("sessions", s.value)}
                                    className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
                                        (config.sessions || []).includes(s.value as MarketSessionName)
                                            ? "border-emerald-500/40 bg-emerald-500/15 text-emerald-400"
                                            : "border-border/30 bg-muted/5 text-muted-foreground hover:border-border/50 hover:text-foreground"
                                    }`}
                                >
                                    {s.label}
                                </button>
                            ))}
                        </div>
                    </Card>

                    {/* CONFIDENCE SETTINGS */}
                    <Card title="Confidence Settings" icon={<Shield className="h-4 w-4 text-purple-400" />} description="Set minimum thresholds for signal generation.">
                        <div className="grid gap-6 sm:grid-cols-2">
                            <div>
                                <label className="mb-2 block text-xs font-medium text-muted-foreground">
                                    Minimum Confidence: <span className="text-foreground">{config.minimumConfidence ?? 70}%</span>
                                </label>
                                <input
                                    type="range"
                                    min={50}
                                    max={100}
                                    value={config.minimumConfidence ?? 70}
                                    onChange={(e) => setConfig((prev) => ({ ...prev, minimumConfidence: Number(e.target.value) }))}
                                    className="w-full accent-amber-500"
                                />
                                <div className="mt-1 flex justify-between text-[10px] text-muted-foreground">
                                    <span>50%</span>
                                    <span>100%</span>
                                </div>
                            </div>
                            <div>
                                <label className="mb-2 block text-xs font-medium text-muted-foreground">
                                    Minimum Risk/Reward: <span className="text-foreground">{config.minimumRiskReward ?? 2.0}</span>
                                </label>
                                <input
                                    type="range"
                                    min={10}
                                    max={50}
                                    value={(config.minimumRiskReward ?? 2.0) * 10}
                                    onChange={(e) => setConfig((prev) => ({ ...prev, minimumRiskReward: Number(e.target.value) / 10 }))}
                                    className="w-full accent-amber-500"
                                />
                                <div className="mt-1 flex justify-between text-[10px] text-muted-foreground">
                                    <span>1.0</span>
                                    <span>5.0</span>
                                </div>
                            </div>
                        </div>
                    </Card>

                    {/* SIGNAL LIMITS */}
                    <Card title="Signal Limits" icon={<AlertCircle className="h-4 w-4 text-orange-400" />} description="Control how many signals are released per tier per day.">
                        <div className="grid gap-6 sm:grid-cols-2">
                            <NumberInput
                                label="Free Signals / Day"
                                value={config.freeSignalsPerDay ?? 3}
                                onChange={(v) => setConfig((prev) => ({ ...prev, freeSignalsPerDay: v }))}
                                min={0}
                                max={50}
                            />
                            <NumberInput
                                label="Pro Signals / Day"
                                value={config.proSignalsPerDay ?? 10}
                                onChange={(v) => setConfig((prev) => ({ ...prev, proSignalsPerDay: v }))}
                                min={0}
                                max={100}
                            />
                        </div>
                    </Card>

                    {/* COOLDOWN & EXPIRATION */}
                    <Card title="Cooldown & Expiration" icon={<Clock className="h-4 w-4 text-cyan-400" />} description="Set signal cooldown and expiration times.">
                        <div className="grid gap-6 sm:grid-cols-2">
                            <NumberInput
                                label="Cooldown (minutes)"
                                value={config.signalCooldownMinutes ?? 15}
                                onChange={(v) => setConfig((prev) => ({ ...prev, signalCooldownMinutes: v }))}
                                min={0}
                                max={120}
                            />
                            <NumberInput
                                label="Expiration (hours)"
                                value={config.signalExpirationHours ?? 4}
                                onChange={(v) => setConfig((prev) => ({ ...prev, signalExpirationHours: v }))}
                                min={1}
                                max={48}
                            />
                        </div>
                    </Card>

                    {/* WEIGHT CONFIGURATION */}
                    <Card
                        title="Confidence Weights"
                        icon={<BarChart3 className="h-4 w-4 text-teal-400" />}
                        description={`Distribute scoring weights across factors. Total: ${totalWeight}${totalWeight !== 100 ? " ⚠️ Must sum to 100" : " ✓"}`}
                    >
                        <div className="space-y-4">
                            {WEIGHT_KEYS.map((key) => (
                                <div key={key}>
                                    <div className="mb-1 flex items-center justify-between">
                                        <label className="text-xs font-medium text-muted-foreground">{WEIGHT_LABELS[key]}</label>
                                        <span className="text-xs text-foreground tabular-nums">{(config.weights || DEFAULT_CONFIG.weights!)[key]}</span>
                                    </div>
                                    <input
                                        type="range"
                                        min={0}
                                        max={100}
                                        value={(config.weights || DEFAULT_CONFIG.weights!)[key]}
                                        onChange={(e) => setWeight(key, Number(e.target.value))}
                                        className="w-full accent-teal-500"
                                    />
                                </div>
                            ))}
                            {totalWeight !== 100 && (
                                <p className="text-xs text-amber-400 flex items-center gap-1">
                                    <AlertCircle className="h-3 w-3" />
                                    Weights must sum to 100. Currently {totalWeight}.
                                </p>
                            )}
                        </div>
                    </Card>

                    {/* RISK DEFAULTS */}
                    <Card title="Risk Defaults" icon={<Shield className="h-4 w-4 text-rose-400" />} description="Default risk parameters applied to signal followers.">
                        <div className="grid gap-6 sm:grid-cols-2">
                            <NumberInput
                                label="Risk Percent (%)"
                                value={config.riskDefaults?.riskPercent ?? 1}
                                onChange={(v) => setRiskDefaults("riskPercent", v)}
                                min={0.1}
                                max={10}
                                step={0.1}
                            />
                            <NumberInput
                                label="Max Positions"
                                value={config.riskDefaults?.maxPositions ?? 5}
                                onChange={(v) => setRiskDefaults("maxPositions", v)}
                                min={1}
                                max={20}
                            />
                        </div>
                    </Card>
                </div>
            </div>
        </div>
    );
}

/* ── Sub-components ────────────────────────────────────── */

function Card({
    title,
    icon,
    description,
    children,
}: {
    title: string;
    icon: React.ReactNode;
    description: string;
    children: React.ReactNode;
}) {
    return (
        <div className="rounded-2xl border border-border/30 bg-gradient-to-br from-background/80 via-background/40 to-background/80 p-6 backdrop-blur-xl">
            <div className="mb-4">
                <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                    {icon}
                    {title}
                </div>
                <p className="mt-1 text-xs text-muted-foreground">{description}</p>
            </div>
            {children}
        </div>
    );
}

function NumberInput({
    label,
    value,
    onChange,
    min = 0,
    max = 100,
    step = 1,
}: {
    label: string;
    value: number;
    onChange: (v: number) => void;
    min?: number;
    max?: number;
    step?: number;
}) {
    return (
        <div>
            <label className="mb-1.5 block text-xs font-medium text-muted-foreground">{label}</label>
            <input
                type="number"
                value={value}
                min={min}
                max={max}
                step={step}
                onChange={(e) => onChange(Number(e.target.value))}
                className="w-full rounded-lg border border-border/30 bg-muted/5 px-3 py-2 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-amber-500/50 focus:ring-1 focus:ring-amber-500/30"
            />
        </div>
    );
}
