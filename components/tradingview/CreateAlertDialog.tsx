"use client";

import { useState, useEffect } from "react";
import {
    Bell,
    Check,
    Globe,
    Send,
    Mail,
    Volume2,
    Sparkles,
    AlertCircle,
    X,
    ExternalLink,
    ShieldCheck,
    Play,
    Loader2,
    Layers,
    Code,
    SlidersHorizontal,
    ArrowUpRight,
} from "lucide-react";
import { auth } from "@/lib/firebase";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { PineExecutionResult } from "@/lib/pine-runtime";
import { SUPPORTED_SYMBOLS, type SupportedSymbol } from "@/lib/market-data/types";

type DialogScope = "account" | "admin";

type WorkspaceScriptOption = { id: string; name: string; type: "strategy" | "indicator"; source: string };

interface CreateAlertDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    scriptName: string;
    scriptId?: string;
    scope?: DialogScope;
    symbol?: string;
    timeframe?: string;
    source?: string;
    pineResult?: PineExecutionResult | null;
    onCreated?: (alertData: any) => void;
}

const ALERT_SYMBOL_OPTIONS: { value: SupportedSymbol; label: string; group: string }[] = [
    { value: "XAUUSD", label: "XAUUSD · Gold", group: "Metals" },
    { value: "EURUSD", label: "EURUSD · EUR/USD", group: "Forex" },
    { value: "GBPUSD", label: "GBPUSD · GBP/USD", group: "Forex" },
    { value: "USDJPY", label: "USDJPY · USD/JPY", group: "Forex" },
    { value: "USDCHF", label: "USDCHF · USD/CHF", group: "Forex" },
    { value: "AUDUSD", label: "AUDUSD · AUD/USD", group: "Forex" },
    { value: "NZDUSD", label: "NZDUSD · NZD/USD", group: "Forex" },
    { value: "US30", label: "US30 · Dow Jones", group: "Indices" },
    { value: "NAS100", label: "NAS100 · Nasdaq 100", group: "Indices" },
    { value: "SPX500", label: "SPX500 · S&P 500", group: "Indices" },
    { value: "BTCUSD", label: "BTCUSD · Bitcoin", group: "Crypto" },
    { value: "ETHUSD", label: "ETHUSD · Ethereum", group: "Crypto" },
];

const TIMEFRAME_OPTIONS = ["M1", "M5", "M15", "M30", "H1", "H4", "D1"] as const;

/**
 * Converts a symbol (any case / TradingView format like "FX:EURUSD", "XAU:USD",
 * "BTC/USD", "INDU:INDEX") into the canonical core symbol used by the data engine.
 */
function normalizeAssetSymbol(raw: string): SupportedSymbol {
    const compact = raw.toUpperCase().replace(/[^A-Z0-9]/g, "");
    const map: Record<string, string> = {
        FXEURUSD: "EURUSD",
        FXGBPUSD: "GBPUSD",
        FXUSDJPY: "USDJPY",
        FXUSDCHF: "USDCHF",
        FXAUDUSD: "AUDUSD",
        FXNZDUSD: "NZDUSD",
        XAUUSD: "XAUUSD",
        XAGUSD: "XAUUSD",
        BTCUSD: "BTCUSD",
        ETHUSD: "ETHUSD",
        BTCUSDT: "BTCUSD",
        ETHUSDT: "ETHUSD",
        INDU: "US30",
        INDUINDEX: "US30",
        DJI: "US30",
    };
    const mapped = map[compact] || compact;
    return (SUPPORTED_SYMBOLS as readonly string[]).includes(mapped)
        ? (mapped as SupportedSymbol)
        : SUPPORTED_SYMBOLS[0];
}

function normalizeTimeframeRaw(raw: string): string {
    const t = raw.toUpperCase().replace(/[^A-Z0-9]/g, "");
    return (TIMEFRAME_OPTIONS as readonly string[]).includes(t) ? t : "H1";
}

function playAudioPreview(soundName: string) {
    try {
        const AudioCtx =
            window.AudioContext ||
            (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        if (!AudioCtx) return;
        const ctx = new AudioCtx();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);

        const now = ctx.currentTime;
        if (soundName === "Chime") {
            osc.frequency.setValueAtTime(523.25, now);
            osc.frequency.exponentialRampToValueAtTime(1046.5, now + 0.3);
            gain.gain.setValueAtTime(0.3, now);
            gain.gain.exponentialRampToValueAtTime(0.001, now + 0.4);
            osc.start(now);
            osc.stop(now + 0.4);
        } else if (soundName === "Bell") {
            osc.frequency.setValueAtTime(880, now);
            gain.gain.setValueAtTime(0.4, now);
            gain.gain.exponentialRampToValueAtTime(0.001, now + 0.6);
            osc.start(now);
            osc.stop(now + 0.6);
        } else if (soundName === "Alarm") {
            osc.type = "sawtooth";
            osc.frequency.setValueAtTime(600, now);
            osc.frequency.setValueAtTime(800, now + 0.1);
            gain.gain.setValueAtTime(0.3, now);
            gain.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
            osc.start(now);
            osc.stop(now + 0.3);
        } else {
            // Pop
            osc.frequency.setValueAtTime(300, now);
            osc.frequency.exponentialRampToValueAtTime(150, now + 0.08);
            gain.gain.setValueAtTime(0.5, now);
            gain.gain.exponentialRampToValueAtTime(0.001, now + 0.1);
            osc.start(now);
            osc.stop(now + 0.1);
        }
    } catch {
        // ignore audio API errors
    }
}

export default function CreateAlertDialog({
    open,
    onOpenChange,
    scriptName,
    scriptId,
    scope = "account",
    symbol = "FX:EURUSD",
    timeframe = "1H",
    source = "",
    pineResult,
    onCreated,
}: CreateAlertDialogProps) {
    const [activeTab, setActiveTab] = useState<"settings" | "notifications" | "message">("settings");
    const [selectedSymbol, setSelectedSymbol] = useState<SupportedSymbol>(() => normalizeAssetSymbol(symbol));
    const [selectedTimeframe, setSelectedTimeframe] = useState<string>(() => normalizeTimeframeRaw(timeframe));

    const currentIsStrategy = source.includes("strategy(") || pineResult?.strategy != null;
    const currentScriptAlerts = pineResult?.alerts || [];

    const [selectedScriptKey, setSelectedScriptKey] = useState<string>("__current__");
    const [availableScripts, setAvailableScripts] = useState<WorkspaceScriptOption[]>([]);

    const selectedWorkspace = availableScripts.find((s) => s.id === selectedScriptKey) || null;
    const effectiveScriptName = selectedWorkspace?.name ?? scriptName;
    const effectiveSource = selectedWorkspace?.source ?? source;
    const effectiveIsStrategy = selectedWorkspace ? selectedWorkspace.type === "strategy" : currentIsStrategy;
    const scriptAlerts = selectedWorkspace ? [] : currentScriptAlerts;

    const [conditionType, setConditionType] = useState<string>(
        currentScriptAlerts.length > 0
            ? "pine_condition"
            : currentIsStrategy
            ? "strategy_fills"
            : "any_alert"
    );
    const [selectedConditionSignal, setSelectedConditionSignal] = useState<string>(
        scriptAlerts.length > 0 ? scriptAlerts[0].title : currentIsStrategy ? "Strategy Execution Fills" : "Any alert() call"
    );
    const [targetPrice, setTargetPrice] = useState<string>("1.0850");

    const [frequency, setFrequency] = useState<"once" | "per_bar" | "per_bar_close" | "every_time">("per_bar_close");
    const [expiration, setExpiration] = useState<"open_ended" | "1_day" | "7_days" | "30_days">("open_ended");

    // Notification toggles
    const [notifyInApp, setNotifyInApp] = useState(true);
    const [notifyWebhook, setNotifyWebhook] = useState(false);
    const [webhookUrl, setWebhookUrl] = useState("");
    const [notifyDiscord, setNotifyDiscord] = useState(false);
    const [notifyTelegram, setNotifyTelegram] = useState(false);
    const [notifyEmail, setNotifyEmail] = useState(false);
    const [playSound, setPlaySound] = useState(true);
    const [soundName, setSoundName] = useState("Chime");

    // Message fields
    const [alertName, setAlertName] = useState("");
    const [alertMessage, setAlertMessage] = useState("");

    // AI payload writer
    const [showAiWriter, setShowAiWriter] = useState(false);
    const [aiFormat, setAiFormat] = useState<"message" | "json">("message");
    const [aiInstruction, setAiInstruction] = useState("");
    const [aiLoading, setAiLoading] = useState(false);
    const [aiError, setAiError] = useState<string | null>(null);
    const [aiSource, setAiSource] = useState<"ai" | "template" | null>(null);

    const [isSubmitting, setIsSubmitting] = useState(false);
    const [feedback, setFeedback] = useState<{ type: "success" | "error"; text: string } | null>(null);

    // Synchronize default values on open
    useEffect(() => {
        if (open) {
            void Promise.resolve().then(() => {
                setSelectedSymbol(normalizeAssetSymbol(symbol));
                setSelectedTimeframe(normalizeTimeframeRaw(timeframe));
                setSelectedScriptKey("__current__");
                setFeedback(null);
            });

            const user = auth.currentUser;
            if (user) {
                user.getIdToken().then((token) =>
                    fetch(`/api/tradingview/workspaces?scope=${scope}`, {
                        headers: { Authorization: `Bearer ${token}` },
                    })
                        .then((res) => res.json())
                        .then((result: { success?: boolean; workspaces?: WorkspaceScriptOption[] }) => {
                            if (result.success && Array.isArray(result.workspaces)) {
                                setAvailableScripts(result.workspaces.filter((w) => w.source && w.name).map((w) => ({ id: w.id, name: w.name, type: w.type || "indicator", source: w.source })));
                            }
                        })
                        .catch(() => setAvailableScripts([]))
                ).catch(() => setAvailableScripts([]));
            }
        }
    }, [open, scriptName, symbol, timeframe, scope]);

    // Update alert name & message template when condition signal changes
    const handleSignalChange = (sig: string) => {
        setSelectedConditionSignal(sig);
        setAlertName(`[${selectedSymbol} ${selectedTimeframe}] ${effectiveScriptName || "Script"} - ${sig}`);
        setAlertMessage(
            `Alert: "${effectiveScriptName || "Script"}" condition "${sig}" triggered on {{ticker}} ${selectedTimeframe} @ {{close}}`
        );
    };

    // Update alert name & message template when an available script is picked
    const handleScriptSelect = (key: string) => {
        setSelectedScriptKey(key);
        setConditionType(key === "__current__" ? (currentIsStrategy ? "strategy_fills" : "any_alert") : "strategy_fills");

        const ws = availableScripts.find((s) => s.id === key);
        if (!ws) return;
        const strat = ws.type === "strategy";
        const defaultSignal = strat ? "Strategy Execution Fills" : "Any alert() function call";
        setSelectedConditionSignal(defaultSignal);
        setAlertName(`[${selectedSymbol} ${selectedTimeframe}] ${ws.name}`);
        setAlertMessage(
            strat
                ? `Strategy Alert: {{strategy.order.action}} on {{ticker}} at price={{close}} time={{time}}`
                : `Alert: "${ws.name}" condition "${defaultSignal}" triggered on {{ticker}} ${selectedTimeframe} @ {{close}}`
        );
    };

    const insertVariable = (varName: string) => {
        setAlertMessage((prev) => `${prev} ${varName}`);
    };

    const handleAiWrite = async () => {
        setAiLoading(true);
        setAiError(null);
        setAiSource(null);
        try {
            const res = await fetch("/api/ai-alert-payload", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    symbol: selectedSymbol,
                    timeframe: selectedTimeframe,
                    scriptName: effectiveScriptName,
                    signal: selectedConditionSignal,
                    isStrategy: effectiveIsStrategy,
                    format: aiFormat,
                    instruction: aiInstruction,
                }),
            });
            const data = await res.json();
            if (data.success && data.content) {
                setAlertMessage(String(data.content).trim());
                setAiSource(data.source === "ai" ? "ai" : "template");
            } else {
                setAiError(data.message || "AI could not generate content. Try rephrasing.");
            }
        } catch {
            setAiError("AI request failed. Please try again.");
        } finally {
            setAiLoading(false);
        }
    };

    const handleTestSound = () => {
        playAudioPreview(soundName);
    };

    const handleCreate = async () => {
        const user = auth.currentUser;
        if (!user) {
            setFeedback({ type: "error", text: "You must be signed in to create alerts." });
            return;
        }

        setIsSubmitting(true);
        setFeedback(null);

        try {
            const token = await user.getIdToken();
            const payload = {
                scriptName: effectiveScriptName || "Pine Script",
                scriptId: selectedWorkspace?.id ?? scriptId ?? "",
                symbol: selectedSymbol,
                timeframe: selectedTimeframe,
                signal: selectedConditionSignal,
                message: alertMessage,
                direction: effectiveIsStrategy ? "long" : "neutral",
                executionStatus: "simulated",
                alertConditions: scriptAlerts.length > 0 ? scriptAlerts.map((a) => ({ title: a.title, message: a.message })) : undefined,
                source: effectiveSource,
                frequency,
                expiration,
                notifyInApp,
                notifyWebhook,
                webhookUrl: notifyWebhook ? webhookUrl : undefined,
                notifyDiscord,
                notifyTelegram,
                notifyEmail,
                playSound,
                soundName: playSound ? soundName : undefined,
            };

            // 1. Submit to pine-alerts API
            const res = await fetch("/api/pine-alerts", {
                method: "POST",
                headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
                body: JSON.stringify(payload),
            });

            const data = await res.json();

            // 2. Also submit to general alerts API for unified Alert Center tracking
            await fetch("/api/alerts", {
                method: "POST",
                headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
                body: JSON.stringify({
                    symbol: selectedSymbol,
                    type: effectiveIsStrategy ? "structure_bos" : "price_above",
                    timeframe: selectedTimeframe,
                    message: alertName ? `${alertName}: ${alertMessage}` : alertMessage,
                    notifyDiscord,
                    notifyTelegram,
                    notifyInApp,
                }),
            }).catch(() => {
                // non-critical fallback
            });

            if (data.success) {
                if (playSound) {
                    playAudioPreview(soundName);
                }
                setFeedback({
                    type: "success",
                    text: `Alert "${alertName}" created successfully! (ID: ${data.event?.id?.slice(0, 8)})`,
                });
                if (onCreated) {
                    onCreated(data.event);
                }
                setTimeout(() => {
                    onOpenChange(false);
                }, 1400);
            } else {
                setFeedback({ type: "error", text: data.error || "Failed to create alert." });
            }
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : "Error creating alert";
            setFeedback({ type: "error", text: message });
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="w-full sm:max-w-xl rounded-2xl border border-border bg-card p-0 shadow-2xl overflow-hidden">
                {/* Header */}
                <DialogHeader className="border-b border-border bg-muted/20 px-4 py-4 sm:px-6">
                    <div className="flex items-center justify-between pr-8">
                        <div className="flex items-center gap-3 min-w-0">
                            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-violet-500/10 text-violet-600 dark:text-violet-400 border border-violet-500/20">
                                <Bell size={18} />
                            </div>
                            <div className="min-w-0">
                                <DialogTitle className="text-base font-semibold text-foreground flex items-center gap-2 truncate">
                                    Create Alert
                                    <span className="shrink-0 rounded-md bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-600 dark:text-emerald-400">
                                        TradingView Compatible
                                    </span>
                                </DialogTitle>
                                <p className="text-xs text-muted-foreground mt-0.5 truncate">
                                    {effectiveScriptName || "Pine Script"} · {selectedSymbol} ({selectedTimeframe})
                                </p>
                            </div>
                        </div>
                    </div>

                    {/* Navigation Tabs */}
                    <div className="mt-4 flex gap-1 rounded-lg bg-background/60 p-1 border border-border/40 overflow-x-auto">
                        <button
                            aria-label="Condition and Trigger"
                            onClick={() => setActiveTab("settings")}
                            className={`flex flex-1 min-w-0 items-center justify-center gap-1.5 rounded-md py-1.5 text-xs font-medium transition ${
                                activeTab === "settings"
                                    ? "bg-muted text-foreground shadow-sm font-semibold"
                                    : "text-muted-foreground hover:text-foreground"
                            }`}
                        >
                            <SlidersHorizontal size={13} className="shrink-0" />
                            <span className="hidden sm:inline truncate">Condition &amp; Trigger</span>
                        </button>
                        <button
                            aria-label="Actions and Webhook"
                            onClick={() => setActiveTab("notifications")}
                            className={`flex flex-1 min-w-0 items-center justify-center gap-1.5 rounded-md py-1.5 text-xs font-medium transition ${
                                activeTab === "notifications"
                                    ? "bg-muted text-foreground shadow-sm font-semibold"
                                    : "text-muted-foreground hover:text-foreground"
                            }`}
                        >
                            <Globe size={13} className="shrink-0" />
                            <span className="hidden sm:inline truncate">Actions &amp; Webhook</span>
                        </button>
                        <button
                            aria-label="Message Payload"
                            onClick={() => setActiveTab("message")}
                            className={`flex flex-1 min-w-0 items-center justify-center gap-1.5 rounded-md py-1.5 text-xs font-medium transition ${
                                activeTab === "message"
                                    ? "bg-muted text-foreground shadow-sm font-semibold"
                                    : "text-muted-foreground hover:text-foreground"
                            }`}
                        >
                            <Code size={13} className="shrink-0" />
                            <span className="hidden sm:inline truncate">Message Payload</span>
                        </button>
                    </div>
                </DialogHeader>

                {/* Body Content */}
                <div className="p-4 sm:p-6 max-h-[70vh] sm:max-h-[460px] overflow-y-auto overscroll-contain space-y-5 text-xs">
                    {feedback && (
                        <div
                            className={`flex items-center gap-2 rounded-xl p-3 text-xs border ${
                                feedback.type === "success"
                                    ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                                    : "border-rose-500/30 bg-rose-500/10 text-rose-600 dark:text-rose-400"
                            }`}
                        >
                            {feedback.type === "success" ? (
                                <Check size={14} className="shrink-0" />
                            ) : (
                                <AlertCircle size={14} className="shrink-0" />
                            )}
                            <span>{feedback.text}</span>
                        </div>
                    )}

                    {/* TAB 1: CONDITION & TRIGGER */}
                    {activeTab === "settings" && (
                        <div className="space-y-4">
                            {/* Condition target */}
                            <div>
                                <label className="mb-1.5 block font-medium text-foreground">Condition Script</label>
                                <div className="flex items-center gap-2">
                                    <select
                                        value={selectedScriptKey}
                                        onChange={(e) => handleScriptSelect(e.target.value)}
                                        className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-xs font-medium text-foreground outline-none focus:border-violet-500"
                                    >
                                        <option value="__current__">
                                            Current Script — {scriptName || "Pine Script"}
                                        </option>
                                        {availableScripts.map((w) => (
                                            <option key={w.id} value={w.id}>
                                                {w.name} ({w.type})
                                            </option>
                                        ))}
                                    </select>
                                    <span className="shrink-0 rounded bg-violet-500/10 px-2 py-1 text-[10px] text-violet-600 dark:text-violet-400 font-medium">
                                        {effectiveIsStrategy ? "Strategy" : "Indicator"}
                                    </span>
                                </div>
                            </div>

                            {/* Asset / Symbol & Timeframe */}
                            <div>
                                <label className="mb-1.5 block font-medium text-foreground">Condition Asset / Timeframe</label>
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                    <select
                                        value={selectedSymbol}
                                        onChange={(e) => setSelectedSymbol(e.target.value as SupportedSymbol)}
                                        className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-xs font-medium text-foreground outline-none focus:border-violet-500"
                                    >
                                        {ALERT_SYMBOL_OPTIONS.reduce<{ group: string; options: typeof ALERT_SYMBOL_OPTIONS }[]>(
                                            (acc, opt) => {
                                                let bucket = acc.find((g) => g.group === opt.group);
                                                if (!bucket) {
                                                    bucket = { group: opt.group, options: [] };
                                                    acc.push(bucket);
                                                }
                                                bucket.options.push(opt);
                                                return acc;
                                            },
                                            []
                                        ).map((group) => (
                                            <optgroup key={group.group} label={group.group}>
                                                {group.options.map((opt) => (
                                                    <option key={opt.value} value={opt.value}>
                                                        {opt.label}
                                                    </option>
                                                ))}
                                            </optgroup>
                                        ))}
                                    </select>
                                    <select
                                        value={selectedTimeframe}
                                        onChange={(e) => setSelectedTimeframe(e.target.value)}
                                        className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-xs font-medium text-foreground outline-none focus:border-violet-500"
                                    >
                                        {TIMEFRAME_OPTIONS.map((tf) => (
                                            <option key={tf} value={tf}>
                                                {tf === "M1" ? "1 Minute" : tf === "M5" ? "5 Minutes" : tf === "M15" ? "15 Minutes" : tf === "M30" ? "30 Minutes" : tf === "H1" ? "1 Hour" : tf === "H4" ? "4 Hours" : "Daily"}
                                            </option>
                                        ))}
                                    </select>
                                </div>
                            </div>

                            {/* Condition Signal Selection */}
                            <div>
                                <label className="mb-1.5 block font-medium text-foreground">Trigger Signal</label>
                                <select
                                    value={selectedConditionSignal}
                                    onChange={(e) => handleSignalChange(e.target.value)}
                                    className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-xs font-medium text-foreground outline-none focus:border-violet-500"
                                >
                                    {scriptAlerts.length > 0 ? (
                                        scriptAlerts.map((a) => (
                                            <option key={a.id || a.title} value={a.title}>
                                                Signal: {a.title} ({a.message || "Script Condition"})
                                            </option>
                                        ))
                                    ) : effectiveIsStrategy ? (
                                        <>
                                            <option value="Strategy Execution Fills">Strategy Execution Fills (Long / Short)</option>
                                            <option value="Strategy Entry Long">Strategy Long Entry</option>
                                            <option value="Strategy Entry Short">Strategy Short Entry</option>
                                            <option value="Strategy Take Profit / Stop Loss">Take Profit / Stop Loss Fill</option>
                                        </>
                                    ) : (
                                        <>
                                            <option value="Any alert() function call">Any alert() function call</option>
                                            <option value="Price Crossing Up">Price Crossing Up</option>
                                            <option value="Price Crossing Down">Price Crossing Down</option>
                                            <option value="RSI Overbought/Oversold">RSI Overbought/Oversold</option>
                                            <option value="EMA Crossover">EMA Fast/Slow Crossover</option>
                                        </>
                                    )}
                                </select>
                            </div>

                            {/* Optional Target Price threshold */}
                            {conditionType === "price_cross" && (
                                <div>
                                    <label className="mb-1.5 block font-medium text-foreground">Target Price Threshold</label>
                                    <input
                                        type="number"
                                        step="0.0001"
                                        value={targetPrice}
                                        onChange={(e) => setTargetPrice(e.target.value)}
                                        className="w-full rounded-xl border border-border bg-background px-3 py-2 text-xs font-mono text-foreground outline-none focus:border-violet-500"
                                    />
                                </div>
                            )}

                            {/* Trigger Frequency */}
                            <div>
                                <label className="mb-1.5 block font-medium text-foreground">Trigger Frequency</label>
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                    {[
                                        { id: "once", label: "Only Once", desc: "Triggers once then deactivates" },
                                        { id: "per_bar_close", label: "Once Per Bar Close", desc: "Recommended for strategies" },
                                        { id: "per_bar", label: "Once Per Bar", desc: "Triggers on real-time bar tick" },
                                        { id: "every_time", label: "Every Time", desc: "Fires on every matching tick" },
                                    ].map((item) => (
                                        <button
                                            key={item.id}
                                            type="button"
                                            onClick={() => setFrequency(item.id as any)}
                                            className={`rounded-xl border p-2.5 text-left transition ${
                                                frequency === item.id
                                                    ? "border-violet-500 bg-violet-500/10 text-foreground"
                                                    : "border-border bg-background/50 text-muted-foreground hover:border-border/80"
                                            }`}
                                        >
                                            <div className="font-semibold text-xs flex items-center justify-between gap-2">
                                                <span className="truncate">{item.label}</span>
                                                {frequency === item.id && <Check size={12} className="shrink-0 text-violet-600 dark:text-violet-400" />}
                                            </div>
                                            <div className="text-[10px] text-muted-foreground mt-0.5">{item.desc}</div>
                                        </button>
                                    ))}
                                </div>
                            </div>

                            {/* Expiration */}
                            <div>
                                <label className="mb-1.5 block font-medium text-foreground">Expiration</label>
                                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                                    {[
                                        { id: "open_ended", label: "Open-ended (Never)" },
                                        { id: "1_day", label: "1 Day" },
                                        { id: "7_days", label: "7 Days" },
                                        { id: "30_days", label: "30 Days" },
                                    ].map((exp) => (
                                        <button
                                            key={exp.id}
                                            type="button"
                                            onClick={() => setExpiration(exp.id as any)}
                                            className={`rounded-lg border py-2 text-center text-xs font-medium transition ${
                                                expiration === exp.id
                                                    ? "border-violet-500 bg-violet-500/10 text-violet-600 dark:text-violet-400"
                                                    : "border-border bg-background text-muted-foreground hover:text-foreground"
                                            }`}
                                        >
                                            {exp.label}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        </div>
                    )}

                    {/* TAB 2: ACTIONS & WEBHOOK */}
                    {activeTab === "notifications" && (
                        <div className="space-y-4">
                            <div className="rounded-xl border border-border bg-background p-4 space-y-3">
                                <h4 className="font-semibold text-foreground text-xs flex items-center gap-1.5">
                                    <Globe size={14} className="text-violet-600 dark:text-violet-400" />
                                    Notification Destinations &amp; Automations
                                </h4>

                                {/* In-App Notification */}
                                <div className="flex items-center justify-between py-1 border-b border-border/40">
                                    <div>
                                        <span className="font-medium text-foreground block">In-App Notification Banner</span>
                                        <span className="text-[10px] text-muted-foreground">Show toast pop-up inside Trading Platform</span>
                                    </div>
                                    <input
                                        type="checkbox"
                                        checked={notifyInApp}
                                        onChange={(e) => setNotifyInApp(e.target.checked)}
                                        className="h-4 w-4 rounded border-border text-violet-500 focus:ring-violet-500"
                                    />
                                </div>

                                {/* Webhook URL Integration */}
                                <div className="space-y-2 py-1 border-b border-border/40">
                                    <div className="flex items-center justify-between">
                                        <div>
                                            <span className="font-medium text-foreground block flex items-center gap-1.5">
                                                Webhook URL (Bot Automation)
                                                <span className="shrink-0 rounded bg-sky-500/10 px-1.5 py-0.5 text-[9px] text-sky-600 dark:text-sky-400 font-medium">
                                                    MT4/MT5 / Bot Bridge
                                                </span>
                                            </span>
                                            <span className="text-[10px] text-muted-foreground">Send HTTP POST JSON request on alert trigger</span>
                                        </div>
                                        <input
                                            type="checkbox"
                                            checked={notifyWebhook}
                                            onChange={(e) => setNotifyWebhook(e.target.checked)}
                                            className="h-4 w-4 rounded border-border text-violet-500 focus:ring-violet-500"
                                        />
                                    </div>
                                    {notifyWebhook && (
                                        <input
                                            type="url"
                                            value={webhookUrl}
                                            onChange={(e) => setWebhookUrl(e.target.value)}
                                            placeholder="https://your-trading-bot.com/api/webhook"
                                            className="w-full rounded-lg border border-border bg-card px-3 py-2 font-mono text-xs text-foreground outline-none focus:border-violet-500"
                                        />
                                    )}
                                </div>

                                {/* Discord / Telegram / Email */}
                                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-1">
                                    <label className={`flex items-center justify-between rounded-xl border p-2.5 cursor-pointer transition ${notifyDiscord ? "border-violet-500 bg-violet-500/10" : "border-border bg-card"}`}>
                                        <span className="flex items-center gap-1.5 text-xs font-medium text-foreground">
                                            <Send size={12} className="text-indigo-600 dark:text-indigo-400" /> Discord
                                        </span>
                                        <input type="checkbox" checked={notifyDiscord} onChange={(e) => setNotifyDiscord(e.target.checked)} className="h-3.5 w-3.5" />
                                    </label>

                                    <label className={`flex items-center justify-between rounded-xl border p-2.5 cursor-pointer transition ${notifyTelegram ? "border-violet-500 bg-violet-500/10" : "border-border bg-card"}`}>
                                        <span className="flex items-center gap-1.5 text-xs font-medium text-foreground">
                                            <Send size={12} className="text-sky-600 dark:text-sky-400" /> Telegram
                                        </span>
                                        <input type="checkbox" checked={notifyTelegram} onChange={(e) => setNotifyTelegram(e.target.checked)} className="h-3.5 w-3.5" />
                                    </label>

                                    <label className={`flex items-center justify-between rounded-xl border p-2.5 cursor-pointer transition ${notifyEmail ? "border-violet-500 bg-violet-500/10" : "border-border bg-card"}`}>
                                        <span className="flex items-center gap-1.5 text-xs font-medium text-foreground">
                                            <Mail size={12} className="text-amber-600 dark:text-amber-400" /> Email
                                        </span>
                                        <input type="checkbox" checked={notifyEmail} onChange={(e) => setNotifyEmail(e.target.checked)} className="h-3.5 w-3.5" />
                                    </label>
                                </div>
                                {notifyEmail && (
                                    <p className="text-[10px] text-muted-foreground">
                                        Email alerts are sent to your account email address.
                                    </p>
                                )}
                            </div>

                            {/* Sound Options */}
                            <div className="rounded-xl border border-border bg-background p-4 space-y-3">
                                <div className="flex items-center justify-between">
                                    <span className="font-semibold text-foreground text-xs flex items-center gap-1.5">
                                        <Volume2 size={14} className="text-violet-600 dark:text-violet-400" /> Audio Sound Tone
                                    </span>
                                    <input
                                        type="checkbox"
                                        checked={playSound}
                                        onChange={(e) => setPlaySound(e.target.checked)}
                                        className="h-4 w-4 rounded border-border text-violet-500 focus:ring-violet-500"
                                    />
                                </div>
                                {playSound && (
                                    <div className="flex items-center gap-2">
                                        <select
                                            value={soundName}
                                            onChange={(e) => setSoundName(e.target.value)}
                                            className="flex-1 rounded-xl border border-border bg-card px-3 py-2 text-xs font-medium text-foreground outline-none focus:border-violet-500"
                                        >
                                            <option value="Chime">Chime (High Tone)</option>
                                            <option value="Bell">Bell (Classic Ring)</option>
                                            <option value="Alarm">Alarm (Urgent Warning)</option>
                                            <option value="Pop">Pop (Subtle Click)</option>
                                        </select>
                                        <button
                                            type="button"
                                            onClick={handleTestSound}
                                            className="inline-flex items-center gap-1 rounded-xl border border-border bg-muted/30 px-3 py-2 text-xs font-medium text-foreground transition hover:bg-muted"
                                        >
                                            <Play size={12} /> Test Sound
                                        </button>
                                    </div>
                                )}
                            </div>
                        </div>
                    )}

                    {/* TAB 3: MESSAGE PAYLOAD */}
                    {activeTab === "message" && (
                        <div className="space-y-4">
                            <div>
                                <label className="mb-1.5 block font-medium text-foreground">Alert Title / Name</label>
                                <input
                                    type="text"
                                    value={alertName}
                                    onChange={(e) => setAlertName(e.target.value)}
                                    className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-xs font-medium text-foreground outline-none focus:border-violet-500"
                                />
                            </div>

                            <div>
                                <div className="mb-1.5 flex items-center justify-between gap-2">
                                    <label className="font-medium text-foreground">Message Body / JSON Payload</label>
                                    <div className="flex items-center gap-2">
                                        <span className="hidden sm:inline text-[10px] text-muted-foreground">Supports TradingView variables</span>
                                        <button
                                            type="button"
                                            onClick={() => { setShowAiWriter((v) => !v); setAiError(null); }}
                                            className={`inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-[10px] font-semibold transition ${
                                                showAiWriter
                                                    ? "border-violet-500 bg-violet-500/10 text-violet-600 dark:text-violet-400"
                                                    : "border-border bg-background/50 text-muted-foreground hover:bg-violet-500/10 hover:text-violet-600 dark:hover:text-violet-400"
                                            }`}
                                            aria-label="Write with AI"
                                        >
                                            <Sparkles size={11} /> AI Write
                                        </button>
                                    </div>
                                </div>

                                {showAiWriter && (
                                    <div className="mb-2 space-y-2 rounded-xl border border-violet-500/30 bg-violet-500/5 p-2.5">
                                        <input
                                            type="text"
                                            value={aiInstruction}
                                            onChange={(e) => setAiInstruction(e.target.value)}
                                            placeholder="Describe it (optional): e.g. JSON with side, ticker, price"
                                            className="w-full rounded-lg border border-border bg-card px-2.5 py-1.5 text-[11px] text-foreground outline-none focus:border-violet-500"
                                        />
                                        <div className="flex flex-wrap items-center gap-2">
                                            <div className="inline-flex overflow-hidden rounded-lg border border-border">
                                                {(["message", "json"] as const).map((f) => (
                                                    <button
                                                        key={f}
                                                        type="button"
                                                        onClick={() => setAiFormat(f)}
                                                        className={`px-2.5 py-1 text-[10px] font-semibold uppercase transition ${
                                                            aiFormat === f
                                                                ? "bg-violet-500 text-white"
                                                                : "bg-card text-muted-foreground hover:bg-muted"
                                                        }`}
                                                    >
                                                        {f === "json" ? "JSON" : "Message"}
                                                    </button>
                                                ))}
                                            </div>
                                            <button
                                                type="button"
                                                onClick={handleAiWrite}
                                                disabled={aiLoading}
                                                className="inline-flex items-center gap-1.5 rounded-lg bg-violet-500 px-3 py-1.5 text-[10px] font-semibold text-white transition hover:bg-violet-400 disabled:opacity-60"
                                            >
                                                {aiLoading ? <Loader2 size={11} className="animate-spin" /> : <Sparkles size={11} />}
                                                {aiLoading ? "Generating..." : "Generate"}
                                            </button>
                                            {aiError && (
                                                <span className="inline-flex items-center gap-1 text-[10px] text-rose-600 dark:text-rose-400">
                                                    <AlertCircle size={11} /> {aiError}
                                                </span>
                                            )}
                                        </div>
                                        {aiSource === "template" && !aiError && (
                                            <p className="text-[10px] text-amber-600 dark:text-amber-400">
                                                Generated from a smart template — add an AI provider key (e.g. OPENROUTER_API_KEY) for AI-written payloads.
                                            </p>
                                        )}
                                        {aiSource === "ai" && !aiError && (
                                            <p className="text-[10px] text-emerald-600 dark:text-emerald-400">
                                                Written by AI. Edit freely before creating the alert.
                                            </p>
                                        )}
                                    </div>
                                )}

                                <textarea
                                    value={alertMessage}
                                    onChange={(e) => setAlertMessage(e.target.value)}
                                    rows={4}
                                    className="w-full rounded-xl border border-border bg-background p-3 font-mono text-xs text-foreground outline-none focus:border-violet-500 leading-5"
                                />
                            </div>

                            {/* Variable Helper Chips */}
                            <div>
                                <span className="mb-1.5 block text-[11px] font-medium text-muted-foreground">Quick Variables Insert:</span>
                                <div className="flex flex-wrap gap-1.5">
                                    {[
                                        "{{ticker}}",
                                        "{{close}}",
                                        "{{time}}",
                                        "{{timeframe}}",
                                        "{{strategy.order.action}}",
                                        "{{strategy.position_size}}",
                                    ].map((v) => (
                                        <button
                                            key={v}
                                            type="button"
                                            onClick={() => insertVariable(v)}
                                            className="rounded-lg border border-border bg-background/50 px-2 py-1 font-mono text-[10px] text-violet-600 dark:text-violet-400 hover:bg-violet-500/10 transition"
                                        >
                                            + {v}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        </div>
                    )}
                </div>

                {/* Footer Buttons */}
                <div className="border-t border-border bg-muted/10 px-4 py-4 sm:px-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <a
                        href="/alerts"
                        target="_self"
                        className="text-xs text-muted-foreground hover:text-violet-600 dark:hover:text-violet-400 flex items-center gap-1 transition font-medium"
                    >
                        <ExternalLink size={12} /> View Active Alerts
                    </a>
                    <div className="flex items-center gap-2 w-full sm:w-auto">
                        <button
                            type="button"
                            onClick={() => onOpenChange(false)}
                            className="flex-1 sm:flex-none rounded-xl border border-border bg-background px-4 py-2 text-xs font-medium text-muted-foreground transition hover:bg-muted hover:text-foreground"
                        >
                            Cancel
                        </button>
                        <button
                            type="button"
                            onClick={handleCreate}
                            disabled={isSubmitting}
                            className="flex-1 sm:flex-none inline-flex items-center justify-center gap-1.5 rounded-xl bg-violet-600 px-5 py-2 text-xs font-semibold text-white shadow-lg shadow-violet-500/25 transition hover:bg-violet-500 disabled:opacity-50"
                        >
                            {isSubmitting ? (
                                <>
                                    <Loader2 size={14} className="animate-spin" />
                                    Creating Alert...
                                </>
                            ) : (
                                <>
                                    <Bell size={14} />
                                    Create Alert
                                </>
                            )}
                        </button>
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    );
}
