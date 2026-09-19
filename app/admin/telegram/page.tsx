"use client";

import { useEffect, useState } from "react";
import AdminGuard from "@/components/auth/AdminGuard";
import AdminShell from "@/components/admin/AdminShell";
import { auth } from "@/lib/firebase";
import {
    Radio,
    Shield,
    Phone,
    KeyRound,
    Lock,
    CheckCircle2,
    XCircle,
    RefreshCw,
    Play,
    Pause,
    Trash2,
    Edit3,
    Plus,
    Activity,
    FileText,
    BarChart3,
    Sparkles,
    AlertCircle,
    Zap,
    Send,
    Terminal,
    Layers,
    Server,
    Check,
    QrCode,
    Search,
    SlidersHorizontal,
    Clock,
    ShieldAlert,
    Gauge,
    FolderPlus,
} from "lucide-react";
import type {
    TelegramAdminConfig,
    TelegramChannelEntity,
    TelegramSource,
    SourceGroup,
    TelegramLogEntry,
    TelegramConnectionTestResult,
    SignalStyle,
    SignalTimeframe,
} from "@/features/telegram-signals/types";

type TabType = "connect" | "channels" | "sources" | "groups" | "parser" | "aigenerator" | "analytics" | "logs";

export default function AdminTelegramPage() {
    return (
        <AdminGuard>
            <AdminShell title="Telegram Signal Sources" subtitle="Admin-only Telegram user account connection, channel discovery, parsing rules, and monitoring management">
                <AdminTelegramDashboard />
            </AdminShell>
        </AdminGuard>
    );
}

function AdminTelegramDashboard() {
    const [activeTab, setActiveTab] = useState<TabType>("sources");
    const [status, setStatus] = useState<TelegramAdminConfig>({ connected: false, connectionStatus: "disconnected" });
    const [loadingStatus, setLoadingStatus] = useState(true);

    // Auth state
    const [phoneNumber, setPhoneNumber] = useState("");
    const [verifyCode, setVerifyCode] = useState("");
    const [password2FA, setPassword2FA] = useState("");
    const [authStep, setAuthStep] = useState<"phone" | "code" | "qr" | "2fa" | "connected">("phone");
    const [authLoading, setAuthLoading] = useState(false);
    const [authError, setAuthError] = useState<string | null>(null);
    const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);

    // Channels & Sources Data
    const [channels, setChannels] = useState<TelegramChannelEntity[]>([]);
    const [loadingChannels, setLoadingChannels] = useState(false);
    const [selectedChannelIds, setSelectedChannelIds] = useState<string[]>([]);
    const [channelStyles, setChannelStyles] = useState<Record<string, SignalStyle>>({});
    const [channelSearch, setChannelSearch] = useState("");
    const [channelTypeFilter, setChannelTypeFilter] = useState<string>("ALL");
    const [channelTimeframes, setChannelTimeframes] = useState<Record<string, SignalTimeframe>>({});
    const [channelGroupIds, setChannelGroupIds] = useState<Record<string, string>>({});
    const [sources, setSources] = useState<TelegramSource[]>([]);
    const [loadingSources, setLoadingSources] = useState(false);
    const [groups, setGroups] = useState<SourceGroup[]>([]);

    // Edit Source & Edit Group Modal State
    const [editingSource, setEditingSource] = useState<TelegramSource | null>(null);
    const [savingSource, setSavingSource] = useState(false);
    const [editingGroup, setEditingGroup] = useState<SourceGroup | null>(null);
    const [isCreatingGroup, setIsCreatingGroup] = useState(false);
    const [groupForm, setGroupForm] = useState<Partial<SourceGroup>>({
        name: "",
        description: "",
        enabled: true,
        autoExecution: true,
        riskMultiplier: 1.0,
        expirationMinutes: 240,
        notificationEnabled: true,
    });
    const [savingGroup, setSavingGroup] = useState(false);

    // Parser Tester State
    const [testMessage, setTestMessage] = useState("BUY XAUUSD @ 2655 - 2657\nSL: 2649\nTP1: 2662\nTP2: 2670\nTP3: 2680");
    const [useAi, setUseAi] = useState(true);
    const [testResult, setTestResult] = useState<any>(null);
    const [testingParser, setTestingParser] = useState(false);

    // AI Signal Generator State
    const [aiSymbol, setAiSymbol] = useState("XAUUSD");
    const [aiTimeframe, setAiTimeframe] = useState<"M1" | "M5" | "M15" | "M30" | "H1" | "H4" | "D1">("H1");
    const [aiStyle, setAiStyle] = useState<"SCALPING" | "INTRADAY" | "SWING">("INTRADAY");
    const [aiNotes, setAiNotes] = useState("");
    const [aiGenerating, setAiGenerating] = useState(false);
    const [aiGeneratedResult, setAiGeneratedResult] = useState<any>(null);
    const [aiSiteName, setAiSiteName] = useState("AlgoVault");

    // Analytics & Logs State
    const [analytics, setAnalytics] = useState<any[]>([]);
    const [logs, setLogs] = useState<TelegramLogEntry[]>([]);
    const [diagnosticResult, setDiagnosticResult] = useState<TelegramConnectionTestResult | null>(null);
    const [runningDiagnostic, setRunningDiagnostic] = useState(false);

    // Toast
    const [toast, setToast] = useState<{ type: "success" | "error"; message: string } | null>(null);

    const showToast = (type: "success" | "error", message: string) => {
        setToast({ type, message });
        setTimeout(() => setToast(null), 4000);
    };

    const getAuthHeaders = async () => {
        const user = auth.currentUser;
        if (!user) throw new Error("Unauthenticated");
        const token = await user.getIdToken();
        return {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
        };
    };

    // Load Status & Data on Mount
    useEffect(() => {
        fetchStatus();
        fetchSources();
        fetchGroups();
    }, []);

    // Poll QR login status while awaiting a scan
    useEffect(() => {
        if (authStep !== "qr") return;
        let cancelled = false;

        const pollQr = async () => {
            try {
                const headers = await getAuthHeaders();
                const res = await fetch("/api/admin/telegram/qr/status", { headers });
                const data = await res.json();
                if (cancelled || !data.success) return;

                if (data.status === "connected") {
                    setAuthStep("connected");
                    setQrDataUrl(null);
                    fetchStatus();
                    showToast("success", "Telegram account connected via QR!");
                    return;
                }
                if (data.status === "awaiting_2fa") {
                    setAuthStep("2fa");
                    setQrDataUrl(null);
                    return;
                }
                if (data.status === "error") {
                    setAuthError(data.lastError || "QR login failed");
                    setAuthStep("phone");
                    return;
                }
                if (data.qrDataUrl) setQrDataUrl(data.qrDataUrl);
            } catch (err) {
                console.error("QR status poll error", err);
            }
        };

        pollQr();
        const id = setInterval(pollQr, 2500);
        return () => {
            cancelled = true;
            clearInterval(id);
        };
    }, [authStep]);

    const fetchStatus = async () => {
        setLoadingStatus(true);
        try {
            const headers = await getAuthHeaders();
            const res = await fetch("/api/admin/telegram/status", { headers });
            const data = await res.json();
            if (data.success && data.status) {
                setStatus(data.status);
                if (data.status.connected) {
                    setAuthStep("connected");
                } else if (data.status.connectionStatus === "awaiting_code") {
                    setAuthStep("code");
                } else if (data.status.connectionStatus === "awaiting_2fa") {
                    setAuthStep("2fa");
                } else {
                    setAuthStep("phone");
                }
            }
        } catch (err: any) {
            console.error(err);
        } finally {
            setLoadingStatus(false);
        }
    };

    const fetchSources = async () => {
        setLoadingSources(true);
        try {
            const headers = await getAuthHeaders();
            const res = await fetch("/api/admin/telegram/sources", { headers });
            const data = await res.json();
            if (data.success) {
                setSources(data.sources || []);
            }
        } catch (err) {
            console.error(err);
        } finally {
            setLoadingSources(false);
        }
    };

    const fetchGroups = async () => {
        try {
            const headers = await getAuthHeaders();
            const res = await fetch("/api/admin/telegram/groups", { headers });
            const data = await res.json();
            if (data.success) {
                setGroups(data.groups || []);
            }
        } catch (err) {
            console.error(err);
        }
    };

    const fetchChannels = async () => {
        setLoadingChannels(true);
        try {
            const headers = await getAuthHeaders();
            const res = await fetch("/api/admin/telegram/channels", { headers });
            const data = await res.json();
            if (data.success) {
                setChannels(data.channels || []);
                const alreadyMonitored = (data.channels || [])
                    .filter((c: TelegramChannelEntity) => c.isMonitored)
                    .map((c: TelegramChannelEntity) => c.id);
                setSelectedChannelIds(alreadyMonitored);
            } else {
                showToast("error", data.error || "Failed to load Telegram channels");
            }
        } catch (err: any) {
            showToast("error", err.message || "Failed to load channels");
        } finally {
            setLoadingChannels(false);
        }
    };

    const fetchAnalytics = async () => {
        try {
            const headers = await getAuthHeaders();
            const res = await fetch("/api/admin/telegram/analytics", { headers });
            const data = await res.json();
            if (data.success) {
                setAnalytics(data.analytics || []);
            }
        } catch (err) {
            console.error(err);
        }
    };

    const fetchLogs = async () => {
        try {
            const headers = await getAuthHeaders();
            const res = await fetch("/api/admin/telegram/logs", { headers });
            const data = await res.json();
            if (data.success) {
                setLogs(data.logs || []);
            }
        } catch (err) {
            console.error(err);
        }
    };

    // Auth Flow Handlers
    const handleSendCode = async (forceSMS = false) => {
        if (!phoneNumber) return;
        setAuthLoading(true);
        setAuthError(null);
        try {
            const headers = await getAuthHeaders();
            const res = await fetch("/api/admin/telegram/send-code", {
                method: "POST",
                headers,
                body: JSON.stringify({ phoneNumber, forceSMS }),
            });
            const data = await res.json();
            if (data.success) {
                setAuthStep("code");
                setVerifyCode("");
                showToast("success", data.isCodeViaApp ? "Verification code sent to your Telegram app notification" : "Verification code sent via SMS");
            } else {
                setAuthError(data.error || "Failed to send verification code");
            }
        } catch (err: any) {
            setAuthError(err.message || "Failed to send verification code");
        } finally {
            setAuthLoading(false);
        }
    };

    const handleVerifyCode = async () => {
        if (!verifyCode) return;
        setAuthLoading(true);
        setAuthError(null);
        try {
            const headers = await getAuthHeaders();
            const res = await fetch("/api/admin/telegram/verify", {
                method: "POST",
                headers,
                body: JSON.stringify({ code: verifyCode }),
            });
            const data = await res.json();
            if (data.success) {
                if (data.requires2FA) {
                    setAuthStep("2fa");
                    showToast("success", "2FA password required");
                } else {
                    setAuthStep("connected");
                    fetchStatus();
                    showToast("success", "Telegram account connected!");
                }
            } else {
                setAuthError(data.error || "Invalid verification code");
            }
        } catch (err: any) {
            setAuthError(err.message || "Verification failed");
        } finally {
            setAuthLoading(false);
        }
    };

    const handleVerify2FA = async () => {
        if (!password2FA) return;
        setAuthLoading(true);
        setAuthError(null);
        try {
            const headers = await getAuthHeaders();
            const res = await fetch("/api/admin/telegram/2fa", {
                method: "POST",
                headers,
                body: JSON.stringify({ password: password2FA }),
            });
            const data = await res.json();
            if (data.success) {
                setAuthStep("connected");
                fetchStatus();
                showToast("success", "Telegram 2FA verified & account connected!");
            } else {
                setAuthError(data.error || "2FA password incorrect");
            }
        } catch (err: any) {
            setAuthError(err.message || "2FA failed");
        } finally {
            setAuthLoading(false);
        }
    };

    const handleStartQrLogin = async () => {
        setAuthLoading(true);
        setAuthError(null);
        try {
            const headers = await getAuthHeaders();
            const res = await fetch("/api/admin/telegram/qr/start", {
                method: "POST",
                headers,
            });
            const data = await res.json();
            if (data.success) {
                setAuthStep("qr");
                setQrDataUrl(null);
                showToast("success", "QR login started — scan it with your Telegram app");
            } else {
                setAuthError(data.error || "Failed to start QR login");
            }
        } catch (err: any) {
            setAuthError(err.message || "Failed to start QR login");
        } finally {
            setAuthLoading(false);
        }
    };

    const handleDisconnect = async () => {
        if (!confirm("Are you sure you want to disconnect the Telegram user account?")) return;
        setAuthLoading(true);
        try {
            const headers = await getAuthHeaders();
            const res = await fetch("/api/admin/telegram/disconnect", {
                method: "POST",
                headers,
            });
            const data = await res.json();
            if (data.success) {
                setAuthStep("phone");
                setStatus({ connected: false, connectionStatus: "disconnected" });
                setChannels([]);
                showToast("success", "Telegram account disconnected");
            } else {
                showToast("error", data.error || "Failed to disconnect");
            }
        } catch (err: any) {
            showToast("error", err.message || "Disconnect failed");
        } finally {
            setAuthLoading(false);
        }
    };

    // Save Selected Channels
    const handleSaveSelectedChannels = async () => {
        setSavingSource(true);
        try {
            const headers = await getAuthHeaders();
            let count = 0;
            const failures: string[] = [];
            for (const chId of selectedChannelIds) {
                const channelObj = channels.find((c) => c.id === chId);
                if (!channelObj) continue;

                const selectedGroupId = channelGroupIds[chId] || "group_premium";
                const selectedGroup = groups.find((g) => g.id === selectedGroupId);

                const res = await fetch("/api/admin/telegram/sources", {
                    method: "POST",
                    headers,
                    body: JSON.stringify({
                        channelId: channelObj.id,
                        name: channelObj.title,
                        username: channelObj.username,
                        type: channelObj.type,
                        membersCount: channelObj.participantsCount,
                        groupId: selectedGroupId,
                        style: channelStyles[chId] || "INTRADAY",
                        defaultTimeframe: channelTimeframes[chId] || "H1",
                        autoExecution: selectedGroup ? selectedGroup.autoExecution : true,
                        notificationEnabled: selectedGroup ? selectedGroup.notificationEnabled : true,
                        expirationMinutes: selectedGroup ? selectedGroup.expirationMinutes : 240,
                        parsingEnabled: true,
                    }),
                });

                if (!res.ok) {
                    const data = await res.json().catch(() => ({}));
                    failures.push(`${channelObj.title}: ${data.error || res.statusText}`);
                    continue;
                }
                count++;
            }

            if (failures.length === 0) {
                showToast("success", `Configured ${count} monitored Telegram channel sources.`);
            } else {
                showToast(
                    "error",
                    `Configured ${count} source(s). ${failures.length} failed — ${failures.join("; ")}`
                );
            }
            fetchSources();
            setActiveTab("sources");
        } catch (err: any) {
            showToast("error", err.message || "Failed to save channels");
        } finally {
            setSavingSource(false);
        }
    };

    // Source Group Handlers
    const handleSaveGroup = async () => {
        if (!groupForm.name) return;
        setSavingGroup(true);
        try {
            const headers = await getAuthHeaders();
            let res;
            if (editingGroup) {
                res = await fetch("/api/admin/telegram/groups", {
                    method: "PUT",
                    headers,
                    body: JSON.stringify({
                        groupId: editingGroup.id,
                        ...groupForm,
                    }),
                });
            } else {
                res = await fetch("/api/admin/telegram/groups", {
                    method: "POST",
                    headers,
                    body: JSON.stringify(groupForm),
                });
            }
            const data = await res.json();
            if (data.success) {
                showToast("success", editingGroup ? `Updated group ${groupForm.name}` : `Created group ${groupForm.name}`);
                fetchGroups();
                setEditingGroup(null);
                setIsCreatingGroup(false);
            } else {
                showToast("error", data.error || "Failed to save group");
            }
        } catch (err: any) {
            showToast("error", err.message || "Failed to save group");
        } finally {
            setSavingGroup(false);
        }
    };

    const handleDeleteGroup = async (groupId: string) => {
        if (!confirm("Are you sure you want to delete this Source Group? Assigned channels will revert to default settings.")) return;
        try {
            const headers = await getAuthHeaders();
            const res = await fetch(`/api/admin/telegram/groups?groupId=${groupId}`, {
                method: "DELETE",
                headers,
            });
            const data = await res.json();
            if (data.success) {
                showToast("success", "Source group removed");
                fetchGroups();
            } else {
                showToast("error", data.error || "Failed to delete group");
            }
        } catch (err: any) {
            showToast("error", err.message || "Delete error");
        }
    };

    // Update Source Settings
    const handleUpdateSource = async (src: TelegramSource) => {
        try {
            const headers = await getAuthHeaders();
            const res = await fetch("/api/admin/telegram/sources", {
                method: "PUT",
                headers,
                body: JSON.stringify({
                    sourceId: src.id,
                    ...src,
                }),
            });
            const data = await res.json();
            if (data.success) {
                showToast("success", `Updated source ${src.name}`);
                fetchSources();
                setEditingSource(null);
            } else {
                showToast("error", data.error || "Failed to update source");
            }
        } catch (err: any) {
            showToast("error", err.message || "Update error");
        }
    };

    const handleDeleteSource = async (sourceId: string) => {
        if (!confirm("Are you sure you want to remove this monitored source?")) return;
        try {
            const headers = await getAuthHeaders();
            const res = await fetch(`/api/admin/telegram/sources?sourceId=${sourceId}`, {
                method: "DELETE",
                headers,
            });
            const data = await res.json();
            if (data.success) {
                showToast("success", "Source removed");
                fetchSources();
            } else {
                showToast("error", data.error || "Failed to delete source");
            }
        } catch (err: any) {
            showToast("error", err.message || "Delete error");
        }
    };

    // Parser Tester
    const handleTestParser = async () => {
        setTestingParser(true);
        setTestResult(null);
        try {
            const headers = await getAuthHeaders();
            const res = await fetch("/api/admin/telegram/test-parser", {
                method: "POST",
                headers,
                body: JSON.stringify({ rawText: testMessage, useAiFallback: useAi }),
            });
            const data = await res.json();
            if (data.success) {
                setTestResult(data.parsedResult);
                showToast("success", "Parser test completed");
            } else {
                showToast("error", data.error || "Parser test failed");
            }
        } catch (err: any) {
            showToast("error", err.message || "Parser error");
        } finally {
            setTestingParser(false);
        }
    };

    // Ingest & Publish signal to live Pro Signals feed (/signals/pro)
    const handlePublishLiveSignal = async () => {
        setTestingParser(true);
        try {
            const headers = await getAuthHeaders();
            const res = await fetch("/api/pro-signals", {
                method: "POST",
                headers,
                body: JSON.stringify({
                    rawText: testMessage,
                    sourceMetadata: {
                        sourceId: "admin_test_publisher",
                        sourceType: "telegram_channel",
                        channelName: "AlgoVault Admin Signals",
                    },
                    broadcast: true,
                }),
            });
            const data = await res.json();
            if (data.success && data.signal) {
                setTestResult(data.signal);
                showToast("success", `Live signal created & published: ${data.signal.symbol} ${data.signal.direction}! Visible on /signals/pro`);
            } else {
                showToast("error", data.error || "Failed to publish signal to live feed");
            }
        } catch (err: any) {
            showToast("error", err.message || "Publish error");
        } finally {
            setTestingParser(false);
        }
    };

    // AI Signal Generator Handler
    const handleGenerateAiSignal = async (publish: boolean) => {
        if (!aiSymbol) return;
        setAiGenerating(true);
        try {
            const headers = await getAuthHeaders();
            const res = await fetch("/api/admin/telegram/generate-ai-signal", {
                method: "POST",
                headers,
                body: JSON.stringify({
                    symbol: aiSymbol,
                    timeframe: aiTimeframe,
                    style: aiStyle,
                    notes: aiNotes,
                    publish,
                }),
            });
            const data = await res.json();
            if (data.success) {
                setAiGeneratedResult(data);
                if (data.siteName) setAiSiteName(data.siteName);
                if (publish) {
                    showToast("success", `AI Signal generated & published to live Pro Feed tagged: By ${data.siteName}!`);
                } else {
                    showToast("success", `AI Market Analysis complete for ${aiSymbol} ${aiTimeframe}`);
                }
            } else {
                showToast("error", data.error || "AI generation failed");
            }
        } catch (err: any) {
            showToast("error", err.message || "AI Generator error");
        } finally {
            setAiGenerating(false);
        }
    };

    // Connection Diagnostic Test
    const handleRunDiagnostic = async () => {
        setRunningDiagnostic(true);
        setDiagnosticResult(null);
        try {
            const headers = await getAuthHeaders();
            const res = await fetch("/api/admin/telegram/test", {
                method: "POST",
                headers,
            });
            const data = await res.json();
            if (data.success) {
                setDiagnosticResult(data.testResult);
                showToast("success", "Diagnostic connection test completed");
            } else {
                showToast("error", data.error || "Diagnostic test failed");
            }
        } catch (err: any) {
            showToast("error", err.message || "Diagnostic error");
        } finally {
            setRunningDiagnostic(false);
        }
    };

    return (
        <div className="space-y-6">
            {/* Toast */}
            {toast && (
                <div className="fixed top-4 right-4 z-50 animate-in fade-in slide-in-from-top-4">
                    <div className={`flex items-center gap-2 rounded-xl border px-4 py-3 text-sm font-medium shadow-2xl backdrop-blur-xl ${
                        toast.type === "success"
                            ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
                            : "border-red-500/30 bg-red-500/10 text-red-400"
                    }`}>
                        {toast.type === "success" ? <CheckCircle2 className="h-4 w-4" /> : <AlertCircle className="h-4 w-4" />}
                        {toast.message}
                    </div>
                </div>
            )}

            {/* TOP BAR / STATUS HEADER */}
            <div className="flex flex-col gap-4 rounded-2xl border border-border/40 bg-card p-6 md:flex-row md:items-center md:justify-between">
                <div className="flex items-center gap-4">
                    <div className={`flex h-12 w-12 items-center justify-center rounded-2xl border ${
                        status.connected
                            ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
                            : "border-amber-500/30 bg-amber-500/10 text-amber-400"
                    }`}>
                        <Radio size={24} className={status.connected ? "animate-pulse" : ""} />
                    </div>
                    <div>
                        <div className="flex items-center gap-2">
                            <h2 className="text-lg font-bold">Telegram Signal Intelligence</h2>
                            <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                                status.connected
                                    ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                                    : "bg-amber-500/10 text-amber-400 border border-amber-500/20"
                            }`}>
                                <span className={`h-1.5 w-1.5 rounded-full ${status.connected ? "bg-emerald-400" : "bg-amber-400"}`} />
                                {status.connected ? "Account Connected" : "Account Disconnected"}
                            </span>
                        </div>
                        <p className="mt-1 text-xs text-muted-foreground">
                            {status.connected && status.userAccount
                                ? `Connected User: ${status.userAccount.username || status.userAccount.firstName || "Account"} (${status.userAccount.phone || "No phone"})`
                                : "Connect a Telegram USER ACCOUNT to read private signal channels & VIP groups server-side."}
                        </p>
                    </div>
                </div>

                <div className="flex items-center gap-2">
                    {status.connected ? (
                        <>
                            <button
                                onClick={() => { setActiveTab("channels"); fetchChannels(); }}
                                className="inline-flex items-center gap-2 rounded-xl border border-border bg-muted/20 px-4 py-2 text-xs font-semibold text-foreground transition hover:bg-muted"
                            >
                                <Radio size={14} />
                                Discovery Channels
                            </button>
                            <button
                                onClick={handleDisconnect}
                                disabled={authLoading}
                                className="inline-flex items-center gap-2 rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-2 text-xs font-semibold text-red-400 transition hover:bg-red-500/20 disabled:opacity-50"
                            >
                                Disconnect Account
                            </button>
                        </>
                    ) : (
                        <button
                            onClick={() => setActiveTab("connect")}
                            className="inline-flex items-center gap-2 rounded-xl bg-amber-500 px-4 py-2 text-xs font-semibold text-black transition hover:bg-amber-400"
                        >
                            <Phone size={14} />
                            Connect Account
                        </button>
                    )}
                </div>
            </div>

            {/* TAB NAVIGATION */}
            <div className="flex overflow-x-auto border-b border-border/50 pb-2">
                <nav className="flex space-x-2">
                    {[
                        { id: "sources", label: "Monitored Sources", icon: Radio, count: sources.length },
                        { id: "connect", label: "Connect Account", icon: Phone },
                        { id: "channels", label: "Discovery Channels", icon: Send },
                        { id: "groups", label: "Source Groups", icon: Layers, count: groups.length },
                        { id: "parser", label: "Signal Parser Test", icon: Terminal },
                        { id: "aigenerator", label: "AI Signal Generator", icon: Sparkles },
                        { id: "analytics", label: "Statistics", icon: BarChart3 },
                        { id: "logs", label: "Connector Logs", icon: Activity },
                    ].map((tab) => {
                        const Icon = tab.icon;
                        const isActive = activeTab === tab.id;
                        return (
                            <button
                                key={tab.id}
                                onClick={() => {
                                    setActiveTab(tab.id as TabType);
                                    if (tab.id === "channels") fetchChannels();
                                    if (tab.id === "analytics") fetchAnalytics();
                                    if (tab.id === "logs") fetchLogs();
                                }}
                                className={`flex items-center gap-2 whitespace-nowrap rounded-xl px-4 py-2.5 text-xs font-semibold transition ${
                                    isActive
                                        ? "bg-foreground font-bold text-background"
                                        : "text-muted-foreground hover:bg-muted hover:text-foreground"
                                }`}
                            >
                                <Icon size={14} />
                                {tab.label}
                                {tab.count !== undefined && (
                                    <span className={`ml-1 rounded-full px-1.5 py-0.5 text-[10px] ${
                                        isActive ? "bg-background text-foreground" : "bg-muted text-muted-foreground"
                                    }`}>
                                        {tab.count}
                                    </span>
                                )}
                            </button>
                        );
                    })}
                </nav>
            </div>

            {/* TAB 1: MONITORED SOURCES TABLE */}
            {activeTab === "sources" && (
                <div className="space-y-4">
                    <div className="flex items-center justify-between">
                        <div>
                            <h3 className="text-base font-bold">Monitored Telegram Sources</h3>
                            <p className="text-xs text-muted-foreground">Channels and groups currently being monitored by AlgoVault server-side</p>
                        </div>
                        <div className="flex gap-2">
                            <button
                                onClick={fetchSources}
                                className="inline-flex items-center gap-1.5 rounded-xl border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted"
                            >
                                <RefreshCw size={13} className={loadingSources ? "animate-spin" : ""} />
                                Refresh
                            </button>
                            <button
                                onClick={() => { setActiveTab("channels"); fetchChannels(); }}
                                className="inline-flex items-center gap-1.5 rounded-xl bg-amber-500 px-3 py-1.5 text-xs font-semibold text-black hover:bg-amber-400"
                            >
                                <Plus size={14} />
                                Add Source Channel
                            </button>
                        </div>
                    </div>

                    {loadingSources ? (
                        <div className="flex h-40 items-center justify-center rounded-2xl border border-border/30 bg-card">
                            <RefreshCw className="h-6 w-6 animate-spin text-amber-400" />
                        </div>
                    ) : sources.length === 0 ? (
                        <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border/50 bg-card/40 p-12 text-center">
                            <Radio size={36} className="text-muted-foreground/40 mb-3" />
                            <p className="text-sm font-semibold">No Monitored Telegram Sources</p>
                            <p className="mt-1 text-xs text-muted-foreground max-w-sm">
                                Connect your Telegram account and select channels to start streaming real-time trading signals.
                            </p>
                            <button
                                onClick={() => { setActiveTab("channels"); fetchChannels(); }}
                                className="mt-4 inline-flex items-center gap-2 rounded-xl bg-amber-500 px-4 py-2 text-xs font-semibold text-black hover:bg-amber-400"
                            >
                                Select Telegram Channels
                            </button>
                        </div>
                    ) : (
                        <div className="overflow-hidden rounded-2xl border border-border/40 bg-card">
                            <div className="overflow-x-auto">
                                <table className="w-full text-left text-xs">
                                    <thead className="border-b border-border/40 bg-muted/20 uppercase tracking-wider text-muted-foreground">
                                        <tr>
                                            <th className="px-4 py-3 font-semibold">Channel</th>
                                            <th className="px-4 py-3 font-semibold">Status</th>
                                            <th className="px-4 py-3 font-semibold">Group</th>
                                            <th className="px-4 py-3 font-semibold">Style</th>
                                            <th className="px-4 py-3 font-semibold">Signals</th>
                                            <th className="px-4 py-3 font-semibold">Auto Exec</th>
                                            <th className="px-4 py-3 font-semibold">Parsing</th>
                                            <th className="px-4 py-3 text-right font-semibold">Actions</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-border/30">
                                        {sources.map((src) => {
                                            const groupObj = groups.find((g) => g.id === src.groupId);
                                            return (
                                                <tr key={src.id} className="transition hover:bg-muted/10">
                                                    <td className="px-4 py-3">
                                                        <div>
                                                            <p className="font-bold text-foreground">{src.name}</p>
                                                            <p className="text-[10px] text-muted-foreground">
                                                                ID: {src.channelId} {src.username ? `(${src.username})` : ""}
                                                            </p>
                                                        </div>
                                                    </td>
                                                    <td className="px-4 py-3">
                                                        <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                                                            src.enabled
                                                                ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                                                                : "bg-zinc-500/10 text-zinc-400 border border-zinc-500/20"
                                                        }`}>
                                                            <span className={`h-1.5 w-1.5 rounded-full ${src.enabled ? "bg-emerald-400" : "bg-zinc-400"}`} />
                                                            {src.enabled ? "Active" : "Paused"}
                                                        </span>
                                                    </td>
                                                    <td className="px-4 py-3">
                                                        <span className="rounded-lg bg-muted px-2 py-1 text-[11px] font-medium text-foreground">
                                                            {groupObj?.name || src.groupId}
                                                        </span>
                                                    </td>
                                                    <td className="px-4 py-3">
                                                        <span className="rounded-md border border-amber-500/20 bg-amber-500/5 px-2 py-0.5 text-[10px] font-semibold text-amber-400">
                                                            {src.style}
                                                        </span>
                                                    </td>
                                                    <td className="px-4 py-3 font-semibold tabular-nums">
                                                        {src.signalCount || 0}
                                                    </td>
                                                    <td className="px-4 py-3">
                                                        <span className={`font-semibold ${src.autoExecution ? "text-emerald-400" : "text-muted-foreground"}`}>
                                                            {src.autoExecution ? "ON" : "OFF"}
                                                        </span>
                                                    </td>
                                                    <td className="px-4 py-3">
                                                        <span className={`font-semibold ${src.parsingEnabled ? "text-blue-400" : "text-muted-foreground"}`}>
                                                            {src.parsingEnabled ? "ON" : "OFF"}
                                                        </span>
                                                    </td>
                                                    <td className="px-4 py-3 text-right">
                                                        <div className="flex items-center justify-end gap-1">
                                                            <button
                                                                onClick={() => handleUpdateSource({ ...src, enabled: !src.enabled })}
                                                                title={src.enabled ? "Pause Monitoring" : "Resume Monitoring"}
                                                                className="rounded-lg border border-border p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                                                            >
                                                                {src.enabled ? <Pause size={13} /> : <Play size={13} />}
                                                            </button>
                                                            <button
                                                                onClick={() => setEditingSource(src)}
                                                                title="Edit Configuration"
                                                                className="rounded-lg border border-border p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                                                            >
                                                                <Edit3 size={13} />
                                                            </button>
                                                            <button
                                                                onClick={() => handleDeleteSource(src.id)}
                                                                title="Remove Source"
                                                                className="rounded-lg border border-red-500/20 p-1.5 text-red-400 hover:bg-red-500/10"
                                                            >
                                                                <Trash2 size={13} />
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
                </div>
            )}

            {/* TAB 2: CONNECT TELEGRAM USER ACCOUNT */}
            {activeTab === "connect" && (
                <div className="mx-auto max-w-xl space-y-6">
                    <div className="rounded-2xl border border-border/40 bg-card p-6">
                        <div className="mb-6 flex items-center gap-3">
                            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-500/10 text-amber-400">
                                <Shield size={20} />
                            </div>
                            <div>
                                <h3 className="text-base font-bold">Connect Telegram USER ACCOUNT</h3>
                                <p className="text-xs text-muted-foreground">Admin MTProto Client Connection</p>
                            </div>
                        </div>

                        {/* STEP 1: PHONE NUMBER */}
                        {authStep === "phone" && (
                            <div className="space-y-4">
                                <p className="text-xs text-muted-foreground">
                                    Enter the phone number associated with your Telegram account (including international country code, e.g. +46...). A login code will be sent to your Telegram app.
                                </p>

                                <div>
                                    <label className="mb-1 block text-xs font-medium">Phone Number</label>
                                    <div className="relative">
                                        <Phone size={15} className="absolute left-3 top-3 text-muted-foreground" />
                                        <input
                                            type="text"
                                            placeholder="+46700000000"
                                            value={phoneNumber}
                                            onChange={(e) => setPhoneNumber(e.target.value)}
                                            className="w-full rounded-xl border border-border bg-background py-2.5 pl-10 pr-4 text-sm text-foreground outline-none focus:border-amber-500"
                                        />
                                    </div>
                                </div>

                                {authError && <p className="text-xs text-red-400">{authError}</p>}

                                <button
                                    onClick={() => handleSendCode(false)}
                                    disabled={authLoading || !phoneNumber}
                                    className="flex w-full items-center justify-center gap-2 rounded-xl bg-amber-500 py-2.5 text-sm font-semibold text-black transition hover:bg-amber-400 disabled:opacity-50"
                                >
                                    {authLoading ? <RefreshCw className="h-4 w-4 animate-spin" /> : "Send Verification Code"}
                                </button>

                                <div className="flex items-center gap-2 pt-1">
                                    <div className="h-px flex-1 bg-border/50" />
                                    <span className="text-[10px] uppercase tracking-wider text-muted-foreground">or</span>
                                    <div className="h-px flex-1 bg-border/50" />
                                </div>

                                <button
                                    onClick={handleStartQrLogin}
                                    disabled={authLoading}
                                    className="flex w-full items-center justify-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 py-2.5 text-sm font-semibold text-emerald-400 transition hover:bg-emerald-500/20 disabled:opacity-50"
                                >
                                    <QrCode size={15} />
                                    Login by QR code instead (no code / SMS needed)
                                </button>
                                <p className="text-center text-[10px] text-muted-foreground">
                                    Recommended if Telegram refuses to send codes or you never receive them (error <span className="font-mono">SEND_CODE_UNAVAILABLE</span>).
                                </p>
                            </div>
                        )}

                        {/* STEP 1B: QR CODE LOGIN */}
                        {authStep === "qr" && (
                            <div className="space-y-4 text-center">
                                <p className="text-xs text-muted-foreground">
                                    Open Telegram on the device logged into your signal account, go to <span className="font-semibold text-foreground">Settings → Devices → Link a Desktop Device</span>, and scan this QR code.
                                </p>

                                <div className="flex justify-center py-2">
                                    {qrDataUrl ? (
                                        // eslint-disable-next-line @next/next/no-img-element
                                        <img src={qrDataUrl} alt="Telegram QR login" width={300} height={300} className="rounded-2xl border border-border bg-white p-2" />
                                    ) : (
                                        <div className="flex h-[300px] w-[300px] items-center justify-center rounded-2xl border border-border/40">
                                            <RefreshCw className="h-6 w-6 animate-spin text-emerald-400" />
                                        </div>
                                    )}
                                </div>

                                <p className="text-[11px] text-muted-foreground">
                                    The QR code refreshes automatically. This panel keeps checking until it is scanned.
                                </p>

                                {authError && <p className="text-xs text-red-400">{authError}</p>}

                                <button
                                    onClick={() => setAuthStep("phone")}
                                    disabled={authLoading}
                                    className="w-full rounded-xl border border-border py-2.5 text-sm font-semibold text-muted-foreground hover:bg-muted"
                                >
                                    Back
                                </button>
                            </div>
                        )}

                        {/* STEP 2: VERIFICATION CODE */}
                        {authStep === "code" && (
                            <div className="space-y-4">
                                <p className="text-xs text-muted-foreground">
                                    Telegram delivered a login code to your Telegram app service notification (title: &quot;Telegram Login&quot;) or via SMS. Check your SMS too.
                                </p>
                                <p className="rounded-lg border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-400">
                                    IMPORTANT: Use ONLY the code delivered right after pressing &quot;Send Verification Code&quot; above. Codes received from <span className="font-bold">my.telegram.org</span> or another device/session will be rejected (each code is bound to one session).
                                </p>

                                <div>
                                    <label className="mb-1 block text-xs font-medium">Verification Code</label>
                                    <div className="relative">
                                        <KeyRound size={15} className="absolute left-3 top-3 text-muted-foreground" />
                                        <input
                                            type="text"
                                            placeholder="12345"
                                            value={verifyCode}
                                            onChange={(e) => setVerifyCode(e.target.value)}
                                            className="w-full rounded-xl border border-border bg-background py-2.5 pl-10 pr-4 text-sm font-mono tracking-widest text-foreground outline-none focus:border-amber-500"
                                        />
                                    </div>
                                </div>

                                {authError && <p className="text-xs text-red-400">{authError}</p>}

                                <div className="flex gap-2">
                                    <button
                                        onClick={() => setAuthStep("phone")}
                                        className="w-1/3 rounded-xl border border-border py-2.5 text-sm font-semibold text-muted-foreground hover:bg-muted"
                                    >
                                        Back
                                    </button>
                                    <button
                                        onClick={handleVerifyCode}
                                        disabled={authLoading || !verifyCode}
                                        className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-amber-500 py-2.5 text-sm font-semibold text-black transition hover:bg-amber-400 disabled:opacity-50"
                                    >
                                        {authLoading ? <RefreshCw className="h-4 w-4 animate-spin" /> : "Verify Code"}
                                    </button>
                                </div>

                                <div className="flex items-center justify-center gap-2 pt-1 text-xs">
                                    <button
                                        onClick={() => handleSendCode(false)}
                                        disabled={authLoading}
                                        className="text-muted-foreground transition hover:text-foreground disabled:opacity-50"
                                    >
                                        Resend code
                                    </button>
                                    <span className="text-muted-foreground/50">•</span>
                                    <button
                                        onClick={() => handleSendCode(true)}
                                        disabled={authLoading}
                                        className="text-muted-foreground transition hover:text-foreground disabled:opacity-50"
                                    >
                                        Send via SMS instead
                                    </button>
                                    <span className="text-muted-foreground/50">•</span>
                                    <button
                                        onClick={() => setAuthStep("phone")}
                                        disabled={authLoading}
                                        className="text-muted-foreground transition hover:text-foreground disabled:opacity-50"
                                    >
                                        Back to phone
                                    </button>
                                </div>
                                <button
                                    onClick={handleStartQrLogin}
                                    disabled={authLoading}
                                    className="flex w-full items-center justify-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/5 py-2 text-xs font-semibold text-emerald-400 transition hover:bg-emerald-500/10 disabled:opacity-50"
                                >
                                    <QrCode size={14} />
                                    No code received? Use QR login instead
                                </button>
                            </div>
                        )}

                        {/* STEP 3: 2FA PASSWORD */}
                        {authStep === "2fa" && (
                            <div className="space-y-4">
                                <p className="text-xs text-muted-foreground">
                                    Your Telegram account has Two-Step Verification (2FA) enabled. Enter your 2FA password to complete connection.
                                </p>

                                <div>
                                    <label className="mb-1 block text-xs font-medium">Two-Factor Password</label>
                                    <div className="relative">
                                        <Lock size={15} className="absolute left-3 top-3 text-muted-foreground" />
                                        <input
                                            type="password"
                                            placeholder="••••••••"
                                            value={password2FA}
                                            onChange={(e) => setPassword2FA(e.target.value)}
                                            className="w-full rounded-xl border border-border bg-background py-2.5 pl-10 pr-4 text-sm text-foreground outline-none focus:border-amber-500"
                                        />
                                    </div>
                                </div>

                                {authError && <p className="text-xs text-red-400">{authError}</p>}

                                <button
                                    onClick={handleVerify2FA}
                                    disabled={authLoading || !password2FA}
                                    className="flex w-full items-center justify-center gap-2 rounded-xl bg-amber-500 py-2.5 text-sm font-semibold text-black transition hover:bg-amber-400 disabled:opacity-50"
                                >
                                    {authLoading ? <RefreshCw className="h-4 w-4 animate-spin" /> : "Complete Connection"}
                                </button>
                            </div>
                        )}

                        {/* STEP 4: ALREADY CONNECTED */}
                        {authStep === "connected" && status.userAccount && (
                            <div className="space-y-4 text-center">
                                <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                                    <CheckCircle2 size={32} />
                                </div>

                                <div>
                                    <h4 className="text-base font-bold text-foreground">Telegram Account Connected</h4>
                                    <p className="mt-1 text-xs text-muted-foreground">
                                        Account: <span className="font-semibold text-foreground">{status.userAccount.username || status.userAccount.firstName}</span> ({status.userAccount.phone || "No phone"})
                                    </p>
                                </div>

                                <div className="pt-2 flex justify-center gap-3">
                                    <button
                                        onClick={() => { setActiveTab("channels"); fetchChannels(); }}
                                        className="rounded-xl bg-amber-500 px-5 py-2.5 text-xs font-semibold text-black hover:bg-amber-400"
                                    >
                                        Load & Select Channels
                                    </button>
                                    <button
                                        onClick={handleDisconnect}
                                        className="rounded-xl border border-red-500/30 bg-red-500/10 px-5 py-2.5 text-xs font-semibold text-red-400 hover:bg-red-500/20"
                                    >
                                        Disconnect Account
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* TAB 3: DISCOVERY CHANNELS */}
            {activeTab === "channels" && (
                <div className="space-y-4">
                    <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                        <div>
                            <h3 className="text-base font-bold">Telegram Dialogs & Channel Discovery</h3>
                            <p className="text-xs text-muted-foreground">Search and configure trading parameters for Telegram channels available to your connected account</p>
                        </div>

                        <div className="flex flex-wrap items-center gap-2">
                            <button
                                onClick={fetchChannels}
                                className="inline-flex items-center gap-1.5 rounded-xl border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted"
                            >
                                <RefreshCw size={13} className={loadingChannels ? "animate-spin" : ""} />
                                Fetch Channels
                            </button>
                            <button
                                onClick={handleSaveSelectedChannels}
                                disabled={savingSource || selectedChannelIds.length === 0}
                                className="inline-flex items-center gap-1.5 rounded-xl bg-amber-500 px-4 py-1.5 text-xs font-semibold text-black hover:bg-amber-400 disabled:opacity-50"
                            >
                                Save Selected Channels ({selectedChannelIds.length})
                            </button>
                        </div>
                    </div>

                    {/* SEARCH & FILTERS BAR */}
                    <div className="flex flex-col gap-3 rounded-2xl border border-border/40 bg-card p-4 md:flex-row md:items-center md:justify-between">
                        <div className="relative flex-1">
                            <Search size={15} className="absolute left-3 top-2.5 text-muted-foreground" />
                            <input
                                type="text"
                                placeholder="Search by channel name, @username, or ID..."
                                value={channelSearch}
                                onChange={(e) => setChannelSearch(e.target.value)}
                                className="w-full rounded-xl border border-border bg-background py-2 pl-9 pr-4 text-xs text-foreground outline-none focus:border-amber-500"
                            />
                        </div>

                        {/* TYPE FILTER PILLS */}
                        <div className="flex flex-wrap items-center gap-1.5">
                            {["ALL", "CHANNEL", "SUPERGROUP", "GROUP", "PRIVATE"].map((t) => (
                                <button
                                    key={t}
                                    onClick={() => setChannelTypeFilter(t)}
                                    className={`rounded-lg px-2.5 py-1 text-[11px] font-semibold transition ${
                                        channelTypeFilter === t
                                            ? "bg-amber-500 text-black font-bold"
                                            : "border border-border/40 bg-muted/20 text-muted-foreground hover:bg-muted"
                                    }`}
                                >
                                    {t}
                                </button>
                            ))}
                        </div>

                        {/* QUICK BULK SELECTION */}
                        <div className="flex items-center gap-2 pt-2 border-t border-border/30 md:border-t-0 md:pt-0">
                            <button
                                onClick={() => {
                                    const filtered = channels.filter((ch) => {
                                        const matchesQuery = !channelSearch.trim() ||
                                            ch.title.toLowerCase().includes(channelSearch.toLowerCase().trim()) ||
                                            (ch.username && ch.username.toLowerCase().includes(channelSearch.toLowerCase().trim())) ||
                                            ch.id.includes(channelSearch.trim());
                                        const matchesType = channelTypeFilter === "ALL" || ch.type.toUpperCase() === channelTypeFilter;
                                        return matchesQuery && matchesType;
                                    });
                                    const filteredIds = filtered.map((c) => c.id);
                                    const newSet = new Set([...selectedChannelIds, ...filteredIds]);
                                    setSelectedChannelIds(Array.from(newSet));
                                }}
                                className="rounded-lg border border-border/60 bg-muted/30 px-2.5 py-1 text-[11px] font-medium text-foreground hover:bg-muted"
                            >
                                Select All Filtered
                            </button>
                            <button
                                onClick={() => setSelectedChannelIds([])}
                                className="rounded-lg border border-border/60 bg-muted/30 px-2.5 py-1 text-[11px] font-medium text-muted-foreground hover:bg-muted"
                            >
                                Deselect All
                            </button>
                        </div>
                    </div>

                    {loadingChannels ? (
                        <div className="flex h-48 items-center justify-center rounded-2xl border border-border/30 bg-card">
                            <RefreshCw className="h-6 w-6 animate-spin text-amber-400" />
                        </div>
                    ) : channels.length === 0 ? (
                        <div className="rounded-2xl border border-border/40 bg-card p-8 text-center">
                            <p className="text-sm font-semibold">No channels fetched yet</p>
                            <p className="mt-1 text-xs text-muted-foreground">Click &quot;Fetch Channels&quot; above to discover channels available to your connected Telegram account.</p>
                            <button
                                onClick={fetchChannels}
                                className="mt-4 rounded-xl bg-amber-500 px-4 py-2 text-xs font-semibold text-black hover:bg-amber-400"
                            >
                                Fetch Channels Now
                            </button>
                        </div>
                    ) : (
                        (() => {
                            const filteredChannels = channels.filter((ch) => {
                                const matchesQuery = !channelSearch.trim() ||
                                    ch.title.toLowerCase().includes(channelSearch.toLowerCase().trim()) ||
                                    (ch.username && ch.username.toLowerCase().includes(channelSearch.toLowerCase().trim())) ||
                                    ch.id.includes(channelSearch.trim());
                                const matchesType = channelTypeFilter === "ALL" || ch.type.toUpperCase() === channelTypeFilter;
                                return matchesQuery && matchesType;
                            });

                            if (filteredChannels.length === 0) {
                                return (
                                    <div className="rounded-2xl border border-border/40 bg-card p-8 text-center text-xs text-muted-foreground">
                                        No channels match search query &quot;{channelSearch}&quot;
                                    </div>
                                );
                            }

                            return (
                                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                                    {filteredChannels.map((ch) => {
                                        const isChecked = selectedChannelIds.includes(ch.id);
                                        return (
                                            <div
                                                key={ch.id}
                                                onClick={() => {
                                                    if (isChecked) {
                                                        setSelectedChannelIds(selectedChannelIds.filter((id) => id !== ch.id));
                                                    } else {
                                                        setSelectedChannelIds([...selectedChannelIds, ch.id]);
                                                    }
                                                }}
                                                className={`cursor-pointer rounded-2xl border p-4 transition ${
                                                    isChecked
                                                        ? "border-amber-500/50 bg-amber-500/10 shadow-lg shadow-amber-500/5"
                                                        : "border-border/40 bg-card hover:border-border"
                                                }`}
                                            >
                                                <div className="flex items-start justify-between gap-2">
                                                    <div className="flex items-center gap-2">
                                                        <input
                                                            type="checkbox"
                                                            checked={isChecked}
                                                            onChange={() => {}}
                                                            className="h-4 w-4 rounded accent-amber-500"
                                                        />
                                                        <h4 className="font-bold text-foreground text-sm line-clamp-1">{ch.title}</h4>
                                                    </div>
                                                    <span className="rounded-md bg-muted px-2 py-0.5 text-[10px] uppercase font-semibold text-muted-foreground">
                                                        {ch.type}
                                                    </span>
                                                </div>

                                                <p className="mt-2 text-[11px] text-muted-foreground line-clamp-2">
                                                    {ch.lastMessage || "No recent messages"}
                                                </p>

                                                <div className="mt-3 pt-2.5 border-t border-border/30 space-y-2" onClick={(e) => e.stopPropagation()}>
                                                    {/* Trading Style Selector */}
                                                    <div className="flex items-center justify-between">
                                                        <label className="text-[11px] font-semibold text-muted-foreground">Trading Style:</label>
                                                        <select
                                                            value={channelStyles[ch.id] || "INTRADAY"}
                                                            onChange={(e) => {
                                                                e.stopPropagation();
                                                                setChannelStyles((prev) => ({ ...prev, [ch.id]: e.target.value as SignalStyle }));
                                                            }}
                                                            className="rounded-lg border border-border bg-background px-2 py-1 text-xs font-semibold text-amber-400 outline-none focus:border-amber-500"
                                                        >
                                                            <option value="SCALPING">Scalping</option>
                                                            <option value="INTRADAY">Intraday</option>
                                                            <option value="SWING">Swing</option>
                                                            <option value="UNKNOWN">Unknown</option>
                                                        </select>
                                                    </div>

                                                    {/* Default Timeframe (Optional) */}
                                                    <div className="flex items-center justify-between">
                                                        <label className="text-[11px] font-semibold text-muted-foreground">Timeframe (Optional):</label>
                                                        <select
                                                            value={channelTimeframes[ch.id] || "H1"}
                                                            onChange={(e) => {
                                                                e.stopPropagation();
                                                                setChannelTimeframes((prev) => ({ ...prev, [ch.id]: e.target.value as SignalTimeframe }));
                                                            }}
                                                            className="rounded-lg border border-border bg-background px-2 py-1 text-xs font-semibold text-foreground outline-none focus:border-amber-500"
                                                        >
                                                            <option value="UNKNOWN">None (Default)</option>
                                                            <option value="M1">1m (M1)</option>
                                                            <option value="M5">5m (M5)</option>
                                                            <option value="M15">15m (M15)</option>
                                                            <option value="M30">30m (M30)</option>
                                                            <option value="H1">1h (H1)</option>
                                                            <option value="H4">4h (H4)</option>
                                                            <option value="D1">1D (D1)</option>
                                                            <option value="W1">1W (W1)</option>
                                                        </select>
                                                    </div>

                                                    {/* Source Group Tier Assignment */}
                                                    <div className="flex items-center justify-between">
                                                        <label className="text-[11px] font-semibold text-muted-foreground">Source Tier Group:</label>
                                                        <select
                                                            value={channelGroupIds[ch.id] || "group_premium"}
                                                            onChange={(e) => {
                                                                e.stopPropagation();
                                                                setChannelGroupIds((prev) => ({ ...prev, [ch.id]: e.target.value }));
                                                            }}
                                                            className="rounded-lg border border-border bg-background px-2 py-1 text-xs font-medium text-emerald-400 outline-none focus:border-amber-500"
                                                        >
                                                            {groups.map((g) => (
                                                                <option key={g.id} value={g.id}>
                                                                    {g.name} ({g.riskMultiplier}x)
                                                                </option>
                                                            ))}
                                                        </select>
                                                    </div>

                                                    <div className="flex items-center justify-between text-[10px] text-muted-foreground pt-1">
                                                        <span>ID: {ch.id}</span>
                                                        {ch.participantsCount && <span>{ch.participantsCount} members</span>}
                                                    </div>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            );
                        })()
                    )}
                </div>
            )}

            {/* TAB 4: SOURCE GROUPS */}
            {activeTab === "groups" && (
                <div className="space-y-4">
                    <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                        <div>
                            <h3 className="text-base font-bold">Source Groups & Tier Classification</h3>
                            <p className="text-xs text-muted-foreground">Configure risk multipliers, auto-execution permissions, and signal lifecycle defaults for source tiers</p>
                        </div>

                        <button
                            onClick={() => {
                                setEditingGroup(null);
                                setGroupForm({
                                    name: "",
                                    description: "",
                                    enabled: true,
                                    autoExecution: true,
                                    riskMultiplier: 1.0,
                                    expirationMinutes: 240,
                                    notificationEnabled: true,
                                });
                                setIsCreatingGroup(true);
                            }}
                            className="inline-flex items-center gap-2 rounded-xl bg-amber-500 px-4 py-2 text-xs font-semibold text-black hover:bg-amber-400"
                        >
                            <Plus size={14} />
                            Create Source Group
                        </button>
                    </div>

                    <div className="grid gap-4 sm:grid-cols-2">
                        {groups.map((grp) => {
                            const assignedCount = sources.filter((s) => s.groupId === grp.id).length;
                            return (
                                <div key={grp.id} className="flex flex-col justify-between rounded-2xl border border-border/40 bg-card p-5">
                                    <div>
                                        <div className="flex items-start justify-between gap-2">
                                            <div>
                                                <h4 className="font-bold text-sm text-foreground">{grp.name}</h4>
                                                <p className="mt-1 text-xs text-muted-foreground">{grp.description || "Classification tier group"}</p>
                                            </div>
                                            <span className={`rounded-full px-2.5 py-0.5 text-[10px] font-semibold border ${
                                                grp.enabled
                                                    ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                                                    : "bg-zinc-500/10 text-zinc-400 border-zinc-500/20"
                                            }`}>
                                                {grp.enabled ? "Active Tier" : "Disabled"}
                                            </span>
                                        </div>

                                        <div className="mt-4 grid grid-cols-2 gap-3 text-xs border-t border-border/30 pt-3">
                                            <div>
                                                <span className="text-muted-foreground text-[11px]">Risk Multiplier:</span>
                                                <p className="font-bold text-amber-400 text-sm tabular-nums">{grp.riskMultiplier}x</p>
                                            </div>
                                            <div>
                                                <span className="text-muted-foreground text-[11px]">Auto Execution:</span>
                                                <p className={`font-semibold ${grp.autoExecution ? "text-emerald-400" : "text-muted-foreground"}`}>
                                                    {grp.autoExecution ? "ALLOWED" : "DISABLED"}
                                                </p>
                                            </div>
                                            <div>
                                                <span className="text-muted-foreground text-[11px]">Default Expiration:</span>
                                                <p className="font-semibold text-foreground">
                                                    {grp.expirationMinutes >= 60
                                                        ? `${Math.round(grp.expirationMinutes / 60)} hours`
                                                        : `${grp.expirationMinutes} min`}
                                                </p>
                                            </div>
                                            <div>
                                                <span className="text-muted-foreground text-[11px]">Monitored Sources:</span>
                                                <p className="font-semibold text-foreground tabular-nums">{assignedCount} channels</p>
                                            </div>
                                        </div>
                                    </div>

                                    <div className="mt-4 pt-3 border-t border-border/30 flex items-center justify-end gap-2">
                                        <button
                                            onClick={() => {
                                                setEditingGroup(grp);
                                                setGroupForm({ ...grp });
                                                setIsCreatingGroup(true);
                                            }}
                                            className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-foreground hover:bg-muted"
                                        >
                                            <Edit3 size={13} />
                                            Edit Tier
                                        </button>
                                        <button
                                            onClick={() => handleDeleteGroup(grp.id)}
                                            className="inline-flex items-center gap-1 rounded-lg border border-red-500/20 px-3 py-1.5 text-xs font-semibold text-red-400 hover:bg-red-500/10"
                                        >
                                            <Trash2 size={13} />
                                            Delete
                                        </button>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}

            {/* TAB 5: SIGNAL PARSER MANUAL TEST */}
            {activeTab === "parser" && (
                <div className="space-y-4">
                    <div>
                        <h3 className="text-base font-bold">Deterministic & AI Signal Parser Test</h3>
                        <p className="text-xs text-muted-foreground">Test raw Telegram message text against the fast dictionary parser and AI fallback without executing trades.</p>
                    </div>

                    <div className="grid gap-6 md:grid-cols-2">
                        <div className="rounded-2xl border border-border/40 bg-card p-5 space-y-4">
                            <label className="block text-xs font-semibold">Raw Telegram Signal Text</label>
                            <textarea
                                rows={8}
                                value={testMessage}
                                onChange={(e) => setTestMessage(e.target.value)}
                                className="w-full rounded-xl border border-border bg-background p-3 text-xs font-mono text-foreground outline-none focus:border-amber-500"
                                placeholder="Paste raw Telegram channel signal here..."
                            />

                            <div className="flex items-center gap-2">
                                <input
                                    type="checkbox"
                                    id="aiFallback"
                                    checked={useAi}
                                    onChange={(e) => setUseAi(e.target.checked)}
                                    className="h-4 w-4 rounded accent-amber-500"
                                />
                                <label htmlFor="aiFallback" className="text-xs text-muted-foreground">Use AI Fallback if deterministic parser confidence &lt; 70%</label>
                            </div>

                            <div className="flex flex-col gap-2">
                                <button
                                    onClick={handleTestParser}
                                    disabled={testingParser || !testMessage}
                                    className="flex w-full items-center justify-center gap-2 rounded-xl border border-border bg-muted/20 py-2.5 text-xs font-semibold text-foreground transition hover:bg-muted disabled:opacity-50"
                                >
                                    {testingParser ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Terminal size={14} />}
                                    Dry Run Test Parser (Inspection Only)
                                </button>
                                <button
                                    onClick={handlePublishLiveSignal}
                                    disabled={testingParser || !testMessage}
                                    className="flex w-full items-center justify-center gap-2 rounded-xl bg-amber-500 py-2.5 text-xs font-semibold text-black transition hover:bg-amber-400 disabled:opacity-50"
                                >
                                    {testingParser ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Send size={14} />}
                                    Publish Signal to Live Pro Feed (/signals/pro)
                                </button>
                            </div>
                        </div>

                        <div className="rounded-2xl border border-border/40 bg-card p-5">
                            <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Parser Inspection Result</h4>

                            {testResult ? (
                                <div className="space-y-3 font-mono text-xs">
                                    <div className="rounded-xl border border-border/50 bg-muted/20 p-3">
                                        <p><span className="text-muted-foreground">Is Signal:</span> <strong className={testResult.isSignal ? "text-emerald-400" : "text-red-400"}>{String(testResult.isSignal ?? true)}</strong></p>
                                        <p><span className="text-muted-foreground">Confidence:</span> <strong>{testResult.confidence}%</strong></p>
                                        <p><span className="text-muted-foreground">Fast Parsed:</span> <strong>{String(testResult.parserMetadata?.fastParsed ?? testResult.fastParsed ?? (testResult.isSignal && !testResult.aiUsed))}</strong></p>
                                        <p><span className="text-muted-foreground">AI Used:</span> <strong>{String(testResult.parserMetadata?.aiUsed ?? testResult.aiUsed ?? false)}</strong></p>
                                    </div>

                                    {testResult.isSignal && (
                                        <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-3 space-y-1">
                                            <p><span className="text-muted-foreground">Symbol:</span> <strong className="text-amber-400">{testResult.symbol}</strong></p>
                                            <p><span className="text-muted-foreground">Direction:</span> <strong>{testResult.direction}</strong></p>
                                            <p><span className="text-muted-foreground">Entry Range:</span> <strong>{testResult.entryMin} - {testResult.entryMax}</strong></p>
                                            <p><span className="text-muted-foreground">Stop Loss:</span> <strong>{testResult.stopLoss}</strong></p>
                                            <p><span className="text-muted-foreground">Take Profit Targets:</span></p>
                                            <ul className="pl-4 list-disc">
                                                {testResult.takeProfits?.map((tp: any, idx: number) => (
                                                    <li key={idx}>TP{tp.index}: {tp.price || "OPEN RUNNER"}</li>
                                                ))}
                                            </ul>
                                        </div>
                                    )}
                                </div>
                            ) : (
                                <div className="flex h-48 items-center justify-center text-xs text-muted-foreground">
                                    Parsed structure will appear here...
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* TAB 5.5: AI SIGNAL GENERATOR */}
            {activeTab === "aigenerator" && (
                <div className="space-y-4">
                    <div>
                        <h3 className="text-base font-bold">AI Market Analysis & Signal Generator</h3>
                        <p className="text-xs text-muted-foreground">
                            Select an asset symbol and timeframe to run AI market analysis. Generated signals will be branded with your Site Name setting (<span className="font-semibold text-amber-400">By {aiSiteName}</span>) and can be published directly to the live Pro feed.
                        </p>
                    </div>

                    <div className="grid gap-6 md:grid-cols-2">
                        <div className="rounded-2xl border border-border/40 bg-card p-5 space-y-4">
                            {/* Symbol selector */}
                            <div>
                                <label className="block text-xs font-semibold mb-1.5">Target Symbol</label>
                                <div className="flex flex-wrap gap-1.5 mb-2">
                                    {["XAUUSD", "EURUSD", "GBPUSD", "USDJPY", "BTCUSD", "ETHUSD", "US30", "NAS100"].map((sym) => (
                                        <button
                                            key={sym}
                                            type="button"
                                            onClick={() => setAiSymbol(sym)}
                                            className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition ${
                                                aiSymbol === sym ? "bg-amber-500 text-black font-bold" : "border border-border/40 bg-muted/20 text-muted-foreground hover:bg-muted"
                                            }`}
                                        >
                                            {sym}
                                        </button>
                                    ))}
                                </div>
                                <input
                                    type="text"
                                    value={aiSymbol}
                                    onChange={(e) => setAiSymbol(e.target.value.toUpperCase())}
                                    className="w-full rounded-xl border border-border bg-background p-2.5 text-xs font-mono text-foreground outline-none focus:border-amber-500"
                                    placeholder="Symbol e.g. XAUUSD"
                                />
                            </div>

                            {/* Timeframe & Style */}
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="block text-xs font-semibold mb-1.5">Timeframe</label>
                                    <select
                                        value={aiTimeframe}
                                        onChange={(e) => setAiTimeframe(e.target.value as any)}
                                        className="w-full rounded-xl border border-border bg-background p-2.5 text-xs text-foreground outline-none focus:border-amber-500"
                                    >
                                        <option value="M1">M1</option>
                                        <option value="M5">M5</option>
                                        <option value="M15">M15</option>
                                        <option value="M30">M30</option>
                                        <option value="H1">H1</option>
                                        <option value="H4">H4</option>
                                        <option value="D1">D1</option>
                                    </select>
                                </div>

                                <div>
                                    <label className="block text-xs font-semibold mb-1.5">Trading Style</label>
                                    <select
                                        value={aiStyle}
                                        onChange={(e) => setAiStyle(e.target.value as any)}
                                        className="w-full rounded-xl border border-border bg-background p-2.5 text-xs text-foreground outline-none focus:border-amber-500"
                                    >
                                        <option value="SCALPING">SCALPING</option>
                                        <option value="INTRADAY">INTRADAY</option>
                                        <option value="SWING">SWING</option>
                                    </select>
                                </div>
                            </div>

                            {/* Market Context Notes */}
                            <div>
                                <label className="block text-xs font-semibold mb-1.5">Optional Market Context / Notes</label>
                                <textarea
                                    rows={3}
                                    value={aiNotes}
                                    onChange={(e) => setAiNotes(e.target.value)}
                                    className="w-full rounded-xl border border-border bg-background p-3 text-xs text-foreground outline-none focus:border-amber-500"
                                    placeholder="e.g. Bullish orderblock retest, NFP high volatility..."
                                />
                            </div>

                            <div className="flex flex-col gap-2 pt-2">
                                <button
                                    onClick={() => handleGenerateAiSignal(false)}
                                    disabled={aiGenerating || !aiSymbol}
                                    className="flex w-full items-center justify-center gap-2 rounded-xl border border-border bg-muted/20 py-2.5 text-xs font-semibold text-foreground transition hover:bg-muted disabled:opacity-50"
                                >
                                    {aiGenerating ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Sparkles size={14} className="text-amber-400" />}
                                    Run AI Market Analysis (Preview Only)
                                </button>

                                <button
                                    onClick={() => handleGenerateAiSignal(true)}
                                    disabled={aiGenerating || !aiSymbol}
                                    className="flex w-full items-center justify-center gap-2 rounded-xl bg-amber-500 py-2.5 text-xs font-semibold text-black transition hover:bg-amber-400 disabled:opacity-50 shadow-lg shadow-amber-500/10"
                                >
                                    {aiGenerating ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Send size={14} />}
                                    Generate & Publish to Pro Feed (By {aiSiteName})
                                </button>
                            </div>
                        </div>

                        {/* Result Preview Box */}
                        <div className="rounded-2xl border border-border/40 bg-card p-5">
                            <div className="flex items-center justify-between mb-3 border-b border-border/30 pb-2">
                                <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">AI Signal Analysis Result</h4>
                                <span className="rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[10px] font-bold text-amber-400">
                                    By {aiSiteName}
                                </span>
                            </div>

                            {aiGeneratedResult ? (
                                <div className="space-y-4 text-xs">
                                    <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 space-y-2">
                                        <div className="flex items-center justify-between">
                                            <div className="flex items-center gap-2">
                                                <h3 className="text-base font-extrabold text-foreground">{aiGeneratedResult.generatedSignal?.symbol}</h3>
                                                <span className={`rounded-md px-2 py-0.5 text-[10px] font-bold ${
                                                    aiGeneratedResult.generatedSignal?.direction === "BUY" ? "bg-emerald-500/20 text-emerald-400" : "bg-rose-500/20 text-rose-400"
                                                }`}>
                                                    {aiGeneratedResult.generatedSignal?.direction}
                                                </span>
                                            </div>
                                            <span className="text-[10px] text-muted-foreground font-mono">
                                                {aiGeneratedResult.generatedSignal?.style} · {aiGeneratedResult.generatedSignal?.timeframe}
                                            </span>
                                        </div>

                                        <div className="grid grid-cols-2 gap-2 text-xs font-mono pt-1">
                                            <div>
                                                <span className="text-muted-foreground block text-[10px]">Entry Zone:</span>
                                                <strong className="text-foreground">{aiGeneratedResult.generatedSignal?.entryMin} - {aiGeneratedResult.generatedSignal?.entryMax}</strong>
                                            </div>
                                            <div>
                                                <span className="text-muted-foreground block text-[10px]">Stop Loss:</span>
                                                <strong className="text-rose-400">{aiGeneratedResult.generatedSignal?.stopLoss}</strong>
                                            </div>
                                        </div>

                                        <div className="font-mono text-xs pt-1">
                                            <span className="text-muted-foreground block text-[10px] mb-1">Take Profit Targets:</span>
                                            <div className="flex gap-3 text-emerald-400 font-bold">
                                                <span>TP1: {aiGeneratedResult.generatedSignal?.tp1}</span>
                                                <span>TP2: {aiGeneratedResult.generatedSignal?.tp2}</span>
                                                <span>TP3: {aiGeneratedResult.generatedSignal?.tp3}</span>
                                            </div>
                                        </div>

                                        <div className="pt-2 border-t border-border/30 text-[11px] text-muted-foreground italic">
                                            "{aiGeneratedResult.generatedSignal?.reasoning}"
                                        </div>
                                    </div>

                                    {aiGeneratedResult.published && (
                                        <div className="flex items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-emerald-400 font-semibold text-xs">
                                            <CheckCircle2 size={16} />
                                            <span>Signal published to live Pro Feed (/signals/pro) tagged as <strong>By {aiSiteName}</strong>!</span>
                                        </div>
                                    )}

                                    {!aiGeneratedResult.published && (
                                        <button
                                            onClick={() => handleGenerateAiSignal(true)}
                                            disabled={aiGenerating}
                                            className="w-full rounded-xl bg-amber-500 py-2 text-xs font-semibold text-black hover:bg-amber-400"
                                        >
                                            Publish This Signal Now (By {aiSiteName})
                                        </button>
                                    )}
                                </div>
                            ) : (
                                <div className="flex h-48 flex-col items-center justify-center text-xs text-muted-foreground">
                                    <Sparkles size={28} className="text-muted-foreground/40 mb-2" />
                                    <span>Select a symbol and timeframe, then run AI analysis to generate a trading signal.</span>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* TAB 6: CHANNEL STATISTICS */}
            {activeTab === "analytics" && (
                <div className="space-y-4">
                    <div className="flex items-center justify-between">
                        <div>
                            <h3 className="text-base font-bold">Data-Driven Channel Performance Statistics</h3>
                            <p className="text-xs text-muted-foreground">Historical performance metrics calculated from verified recorded signals</p>
                        </div>
                        <button
                            onClick={fetchAnalytics}
                            className="inline-flex items-center gap-1.5 rounded-xl border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted"
                        >
                            <RefreshCw size={13} />
                            Refresh Stats
                        </button>
                    </div>

                    <div className="overflow-hidden rounded-2xl border border-border/40 bg-card">
                        <table className="w-full text-left text-xs">
                            <thead className="border-b border-border/40 bg-muted/20 uppercase tracking-wider text-muted-foreground">
                                <tr>
                                    <th className="px-4 py-3 font-semibold">Channel Source</th>
                                    <th className="px-4 py-3 font-semibold">Signals</th>
                                    <th className="px-4 py-3 font-semibold">Wins</th>
                                    <th className="px-4 py-3 font-semibold">Losses</th>
                                    <th className="px-4 py-3 font-semibold">Win Rate</th>
                                    <th className="px-4 py-3 font-semibold">Last Message</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-border/30">
                                {analytics.map((item) => (
                                    <tr key={item.sourceId}>
                                        <td className="px-4 py-3 font-bold text-foreground">{item.channelName}</td>
                                        <td className="px-4 py-3 tabular-nums">{item.totalSignals}</td>
                                        <td className="px-4 py-3 tabular-nums text-emerald-400">{item.wins}</td>
                                        <td className="px-4 py-3 tabular-nums text-red-400">{item.losses}</td>
                                        <td className="px-4 py-3 font-bold tabular-nums text-amber-400">{item.winRate}%</td>
                                        <td className="px-4 py-3 text-muted-foreground">
                                            {item.lastReceivedAt ? new Date(item.lastReceivedAt).toLocaleString() : "N/A"}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {/* TAB 7: CONNECTOR LOGS & DIAGNOSTICS */}
            {activeTab === "logs" && (
                <div className="space-y-4">
                    <div className="flex items-center justify-between">
                        <div>
                            <h3 className="text-base font-bold">Telegram Connection & Debug Logs</h3>
                            <p className="text-xs text-muted-foreground">Protected connector logs with redacted sensitive values</p>
                        </div>
                        <div className="flex gap-2">
                            <button
                                onClick={handleRunDiagnostic}
                                disabled={runningDiagnostic}
                                className="inline-flex items-center gap-1.5 rounded-xl bg-amber-500 px-4 py-1.5 text-xs font-semibold text-black hover:bg-amber-400 disabled:opacity-50"
                            >
                                {runningDiagnostic ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Server size={14} />}
                                Run Diagnostic Test
                            </button>
                            <button
                                onClick={fetchLogs}
                                className="inline-flex items-center gap-1.5 rounded-xl border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted"
                            >
                                <RefreshCw size={13} />
                                Refresh Logs
                            </button>
                        </div>
                    </div>

                    {/* Diagnostic Summary Panel */}
                    {diagnosticResult && (
                        <div className="rounded-2xl border border-border/40 bg-card p-5 space-y-3">
                            <h4 className="text-sm font-bold flex items-center gap-2">
                                <Server size={16} className="text-amber-400" />
                                Diagnostic Connection Results ({new Date(diagnosticResult.timestamp).toLocaleTimeString()})
                            </h4>

                            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4 text-xs">
                                {Object.entries(diagnosticResult.checks).map(([key, check]) => (
                                    <div key={key} className={`rounded-xl border p-3 ${
                                        check.passed ? "border-emerald-500/30 bg-emerald-500/5 text-emerald-400" : "border-red-500/30 bg-red-500/5 text-red-400"
                                    }`}>
                                        <div className="flex items-center gap-1.5 font-bold mb-1">
                                            {check.passed ? <Check size={14} /> : <XCircle size={14} />}
                                            {key}
                                        </div>
                                        <p className="text-[10px] text-muted-foreground">{check.message}</p>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Logs Stream */}
                    <div className="rounded-2xl border border-border/40 bg-card p-4 font-mono text-xs max-h-96 overflow-y-auto space-y-2">
                        {logs.map((log) => (
                            <div key={log.id} className="flex items-start gap-2 border-b border-border/20 pb-1.5">
                                <span className="text-muted-foreground text-[10px] shrink-0">{new Date(log.timestamp).toLocaleTimeString()}</span>
                                <span className={`uppercase font-bold text-[10px] shrink-0 px-1.5 py-0.5 rounded ${
                                    log.level === "error" ? "bg-red-500/20 text-red-400" : log.level === "success" ? "bg-emerald-500/20 text-emerald-400" : "bg-blue-500/20 text-blue-400"
                                }`}>
                                    {log.level}
                                </span>
                                <div className="flex-1">
                                    <p className="text-foreground">{log.message}</p>
                                    {log.details && <p className="text-[10px] text-muted-foreground mt-0.5">{log.details}</p>}
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* SOURCE GROUP EDIT / CREATE MODAL */}
            {isCreatingGroup && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
                    <div className="w-full max-w-md space-y-4 rounded-2xl border border-border/40 bg-card p-6 shadow-2xl">
                        <div className="flex items-center justify-between border-b border-border/40 pb-3">
                            <h3 className="text-base font-bold text-foreground">
                                {editingGroup ? `Edit Group: ${editingGroup.name}` : "Create New Source Group"}
                            </h3>
                            <button
                                onClick={() => { setIsCreatingGroup(false); setEditingGroup(null); }}
                                className="rounded-lg p-1 text-muted-foreground hover:bg-muted"
                            >
                                <XCircle size={18} />
                            </button>
                        </div>

                        <div className="space-y-3">
                            <div>
                                <label className="block text-xs font-medium mb-1">Group Tier Name</label>
                                <input
                                    type="text"
                                    placeholder="e.g. VIP Scalpers"
                                    value={groupForm.name || ""}
                                    onChange={(e) => setGroupForm({ ...groupForm, name: e.target.value })}
                                    className="w-full rounded-xl border border-border bg-background p-2.5 text-xs text-foreground outline-none focus:border-amber-500"
                                />
                            </div>

                            <div>
                                <label className="block text-xs font-medium mb-1">Description</label>
                                <textarea
                                    rows={2}
                                    placeholder="Brief description of this signal tier..."
                                    value={groupForm.description || ""}
                                    onChange={(e) => setGroupForm({ ...groupForm, description: e.target.value })}
                                    className="w-full rounded-xl border border-border bg-background p-2.5 text-xs text-foreground outline-none focus:border-amber-500"
                                />
                            </div>

                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="block text-xs font-medium mb-1">Risk Multiplier</label>
                                    <input
                                        type="number"
                                        step="0.05"
                                        min="0.1"
                                        max="5.0"
                                        value={groupForm.riskMultiplier ?? 1.0}
                                        onChange={(e) => setGroupForm({ ...groupForm, riskMultiplier: parseFloat(e.target.value) || 1.0 })}
                                        className="w-full rounded-xl border border-border bg-background p-2.5 text-xs tabular-nums text-foreground outline-none focus:border-amber-500"
                                    />
                                </div>

                                <div>
                                    <label className="block text-xs font-medium mb-1">Expiration (Minutes)</label>
                                    <select
                                        value={groupForm.expirationMinutes ?? 240}
                                        onChange={(e) => setGroupForm({ ...groupForm, expirationMinutes: parseInt(e.target.value, 10) })}
                                        className="w-full rounded-xl border border-border bg-background p-2.5 text-xs text-foreground outline-none focus:border-amber-500"
                                    >
                                        <option value={30}>30 min</option>
                                        <option value={60}>1 hour (60 min)</option>
                                        <option value={120}>2 hours (120 min)</option>
                                        <option value={180}>3 hours (180 min)</option>
                                        <option value={240}>4 hours (240 min)</option>
                                        <option value={720}>12 hours (720 min)</option>
                                        <option value={1440}>24 hours (1440 min)</option>
                                    </select>
                                </div>
                            </div>

                            <div className="space-y-2 border-t border-border/30 pt-3">
                                <div className="flex items-center justify-between">
                                    <label className="text-xs font-medium">Auto Execution Allowed</label>
                                    <input
                                        type="checkbox"
                                        checked={Boolean(groupForm.autoExecution)}
                                        onChange={(e) => setGroupForm({ ...groupForm, autoExecution: e.target.checked })}
                                        className="h-4 w-4 rounded accent-amber-500"
                                    />
                                </div>

                                <div className="flex items-center justify-between">
                                    <label className="text-xs font-medium">Notifications Enabled</label>
                                    <input
                                        type="checkbox"
                                        checked={Boolean(groupForm.notificationEnabled)}
                                        onChange={(e) => setGroupForm({ ...groupForm, notificationEnabled: e.target.checked })}
                                        className="h-4 w-4 rounded accent-amber-500"
                                    />
                                </div>

                                <div className="flex items-center justify-between">
                                    <label className="text-xs font-medium">Tier Enabled / Active</label>
                                    <input
                                        type="checkbox"
                                        checked={Boolean(groupForm.enabled)}
                                        onChange={(e) => setGroupForm({ ...groupForm, enabled: e.target.checked })}
                                        className="h-4 w-4 rounded accent-amber-500"
                                    />
                                </div>
                            </div>
                        </div>

                        <div className="flex justify-end gap-2 pt-2 border-t border-border/30">
                            <button
                                onClick={() => { setIsCreatingGroup(false); setEditingGroup(null); }}
                                className="rounded-xl border border-border px-4 py-2 text-xs font-semibold text-muted-foreground hover:bg-muted"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={handleSaveGroup}
                                disabled={savingGroup || !groupForm.name}
                                className="rounded-xl bg-amber-500 px-4 py-2 text-xs font-semibold text-black hover:bg-amber-400 disabled:opacity-50"
                            >
                                {savingGroup ? <RefreshCw className="h-4 w-4 animate-spin" /> : editingGroup ? "Update Group" : "Create Group"}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* EDIT SOURCE MODAL */}
            {editingSource && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm p-4">
                    <div className="w-full max-w-lg rounded-2xl border border-border/50 bg-card p-6 shadow-2xl space-y-4">
                        <div className="flex items-center justify-between border-b border-border/40 pb-3">
                            <h3 className="font-bold text-base">Edit Monitored Source: {editingSource.name}</h3>
                            <button onClick={() => setEditingSource(null)} className="text-muted-foreground hover:text-foreground">✕</button>
                        </div>

                        <div className="space-y-3 text-xs">
                            <div>
                                <label className="block text-muted-foreground mb-1">Source Group</label>
                                <select
                                    value={editingSource.groupId}
                                    onChange={(e) => setEditingSource({ ...editingSource, groupId: e.target.value })}
                                    className="w-full rounded-xl border border-border bg-background p-2.5 text-foreground outline-none"
                                >
                                    {groups.map((g) => (
                                        <option key={g.id} value={g.id}>{g.name}</option>
                                    ))}
                                </select>
                            </div>

                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="block text-muted-foreground mb-1">Signal Style</label>
                                    <select
                                        value={editingSource.style}
                                        onChange={(e) => setEditingSource({ ...editingSource, style: e.target.value as any })}
                                        className="w-full rounded-xl border border-border bg-background p-2.5 text-foreground outline-none"
                                    >
                                        <option value="SCALPING">Scalping</option>
                                        <option value="INTRADAY">Intraday</option>
                                        <option value="SWING">Swing</option>
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-muted-foreground mb-1">Default Timeframe</label>
                                    <select
                                        value={editingSource.defaultTimeframe}
                                        onChange={(e) => setEditingSource({ ...editingSource, defaultTimeframe: e.target.value as any })}
                                        className="w-full rounded-xl border border-border bg-background p-2.5 text-foreground outline-none"
                                    >
                                        <option value="M1">M1</option>
                                        <option value="M5">M5</option>
                                        <option value="M15">M15</option>
                                        <option value="M30">M30</option>
                                        <option value="H1">H1</option>
                                        <option value="H4">H4</option>
                                    </select>
                                </div>
                            </div>

                            <div className="flex items-center justify-between border-t border-border/30 pt-3">
                                <span>Signal Parsing Enabled</span>
                                <input
                                    type="checkbox"
                                    checked={editingSource.parsingEnabled}
                                    onChange={(e) => setEditingSource({ ...editingSource, parsingEnabled: e.target.checked })}
                                    className="h-4 w-4 rounded accent-amber-500"
                                />
                            </div>

                            <div className="flex items-center justify-between">
                                <span>Auto Execution Enabled</span>
                                <input
                                    type="checkbox"
                                    checked={editingSource.autoExecution}
                                    onChange={(e) => setEditingSource({ ...editingSource, autoExecution: e.target.checked })}
                                    className="h-4 w-4 rounded accent-amber-500"
                                />
                            </div>
                        </div>

                        <div className="flex justify-end gap-2 pt-4 border-t border-border/40">
                            <button
                                onClick={() => setEditingSource(null)}
                                className="rounded-xl border border-border px-4 py-2 text-xs font-semibold text-muted-foreground hover:bg-muted"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={() => handleUpdateSource(editingSource)}
                                className="rounded-xl bg-amber-500 px-4 py-2 text-xs font-semibold text-black hover:bg-amber-400"
                            >
                                Save Changes
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
