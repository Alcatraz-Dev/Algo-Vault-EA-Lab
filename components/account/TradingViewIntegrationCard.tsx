"use client";

/**
 * Account → Settings → Integrations → TradingView (PHASE 15).
 *
 * Minimal connection surface for the TradingView MCP integration:
 *   • connection state (Connected / Not connected / Reauth required / Disabled)
 *   • capability list (only what the beta toolset actually supports)
 *   • Beta + data-freshness notices
 *   • Connect / Reconnect / Disconnect actions via the secure AlgoVault OAuth flow
 *
 * No tokens ever reach this component — only connection state booleans.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { User as FirebaseUser } from "firebase/auth";
import {
    AlertCircle,
    Check,
    CheckCircle2,
    ExternalLink,
    Info,
    Loader2,
    Plug,
    PlugZap,
    RefreshCw,
    Unplug,
} from "lucide-react";

interface TradingViewStatus {
    state: "DISCONNECTED" | "CONNECTING" | "CONNECTED" | "TOKEN_EXPIRED" | "REAUTH_REQUIRED" | "ERROR" | "DISABLED";
    message?: string;
    scopes: string[];
}

interface CapabilityInfo {
    id: string;
    label: string;
    supported: boolean;
    read: boolean;
}

interface FlagsInfo {
    master: boolean;
    news: boolean;
    technicals: boolean;
    screener: boolean;
    economicCalendar: boolean;
    fundamentals: boolean;
    watchlists: boolean;
    alerts: boolean;
}

interface TradingViewIntegrationCardProps {
    user: FirebaseUser | null;
    showToast?: (type: "success" | "error", text: string) => void;
}

const STATE_META: Record<TradingViewStatus["state"], { label: string; tone: string; dot: string }> = {
    DISCONNECTED: { label: "Not connected", tone: "border-border bg-muted/40 text-muted-foreground", dot: "bg-muted-foreground" },
    CONNECTING: { label: "Connecting…", tone: "border-info/30 bg-info/10 text-info", dot: "bg-info animate-pulse" },
    CONNECTED: { label: "Connected", tone: "border-positive/30 bg-positive/10 text-positive", dot: "bg-positive" },
    TOKEN_EXPIRED: { label: "Authorization expired", tone: "border-warning/30 bg-warning/10 text-warning", dot: "bg-warning" },
    REAUTH_REQUIRED: { label: "Reconnect required", tone: "border-warning/30 bg-warning/10 text-warning", dot: "bg-warning" },
    ERROR: { label: "Error", tone: "border-negative/30 bg-negative/10 text-negative", dot: "bg-negative" },
    DISABLED: { label: "Disabled", tone: "border-border bg-muted/40 text-muted-foreground", dot: "bg-muted-foreground" },
};

export function TradingViewIntegrationCard({ user, showToast }: TradingViewIntegrationCardProps) {
    const [status, setStatus] = useState<TradingViewStatus | null>(null);
    const [capabilities, setCapabilities] = useState<CapabilityInfo[]>([]);
    const [flags, setFlags] = useState<FlagsInfo | null>(null);
    const [loading, setLoading] = useState(true);
    const [connecting, setConnecting] = useState(false);
    const [disconnecting, setDisconnecting] = useState(false);

    const load = useCallback(async () => {
        if (!user) return;
        setLoading(true);
        try {
            const token = await user.getIdToken();
            const res = await fetch("/api/integrations/tradingview", {
                headers: { Authorization: `Bearer ${token}` },
            });
            const data = await res.json();
            if (res.ok && data.success) {
                setStatus(data.status as TradingViewStatus);
                setCapabilities((data.capabilities ?? []) as CapabilityInfo[]);
                setFlags(data.flags as FlagsInfo);
            } else {
                setStatus({
                    state: "ERROR",
                    message: data?.error || "Failed to load TradingView status.",
                    scopes: [],
                });
            }
        } catch {
            setStatus({ state: "ERROR", message: "Failed to load TradingView status.", scopes: [] });
        } finally {
            setLoading(false);
        }
    }, [user]);

    useEffect(() => {
        void load();
    }, [load]);

    // Auto-refresh and toast after OAuth redirect-back (tradingview=connected / failed / denied)
    const searchParams = useSearchParams();
    const handledCallbackRef = useRef(false);
    useEffect(() => {
        const param = searchParams.get("tradingview");
        if (!param || handledCallbackRef.current) return;
        handledCallbackRef.current = true;
        if (param === "connected") {
            showToast?.("success", "TradingView connected successfully!");
            void load();
        } else if (param === "denied") {
            showToast?.("error", "TradingView authorization was denied.");
        } else if (param === "failed" || param === "invalid_response") {
            showToast?.("error", "TradingView connection failed. Please try again.");
        }
        // Remove the query param from the URL without a full navigation
        const url = new URL(window.location.href);
        url.searchParams.delete("tradingview");
        window.history.replaceState({}, "", url.toString());
    }, [searchParams, load, showToast]);

    const handleConnect = useCallback(async () => {
        if (!user) return;
        setConnecting(true);
        try {
            const token = await user.getIdToken();
            const res = await fetch("/api/integrations/tradingview/connect", {
                method: "POST",
                headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
            });
            const data = await res.json();
            if (res.ok && data.success && data.authorizationUrl) {
                // Secure OAuth flow: full-page redirect to TradingView's consent
                // screen. The callback returns to /account/settings?tab=integrations.
                window.location.href = data.authorizationUrl as string;
            } else {
                showToast?.("error", data?.error || "Failed to start TradingView connection.");
                setConnecting(false);
            }
        } catch {
            showToast?.("error", "Failed to start TradingView connection.");
            setConnecting(false);
        }
    }, [user, showToast]);

    const handleDisconnect = useCallback(async () => {
        if (!user) return;
        setDisconnecting(true);
        try {
            const token = await user.getIdToken();
            const res = await fetch("/api/integrations/tradingview", {
                method: "POST",
                headers: { Authorization: `Bearer ${token}` },
            });
            if (res.ok) {
                showToast?.("success", "TradingView disconnected. Stored credentials were removed.");
                await load();
            } else {
                showToast?.("error", "Failed to disconnect TradingView.");
            }
        } catch {
            showToast?.("error", "Failed to disconnect TradingView.");
        } finally {
            setDisconnecting(false);
        }
    }, [user, load, showToast]);

    const stateMeta = STATE_META[status?.state ?? "DISCONNECTED"];
    const needsReconnect = status?.state === "TOKEN_EXPIRED" || status?.state === "REAUTH_REQUIRED";
    const connected = status?.state === "CONNECTED";

    if (loading && !status) {
        return (
            <div className="rounded-lg border border-border bg-foreground/[0.035] p-6">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Loading TradingView integration…
                </div>
            </div>
        );
    }

    return (
        <div className="rounded-lg border border-border bg-foreground/[0.035] p-6">
            <div className="mb-4 flex flex-wrap items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-info/15">
                    <PlugZap size={16} className="text-info" />
                </div>
                <div className="min-w-0">
                    <h2 className="text-lg font-semibold text-foreground">TradingView MCP</h2>
                    <p className="text-xs text-muted-foreground">
                        External research &amp; intelligence provider — optional context for your AlgoVault analysis.
                    </p>
                </div>
                <span className={`ml-auto inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium ${stateMeta.tone}`}>
                    <span className={`h-1.5 w-1.5 rounded-full ${stateMeta.dot}`} />
                    {stateMeta.label}
                </span>
            </div>

            {status?.message ? (
                <div className="mb-4 flex items-start gap-2 rounded-lg border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
                    <Info size={13} className="mt-0.5 shrink-0" />
                    <span>{status.message}</span>
                </div>
            ) : null}

            {flags && !flags.master ? (
                <div className="mb-4 flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
                    <AlertCircle size={13} className="mt-0.5 shrink-0" />
                    <span>
                        The TradingView MCP integration is currently disabled by the platform. All AlgoVault features work
                        normally without it.
                    </span>
                </div>
            ) : null}

            {/* Capabilities */}
            <div className="mb-4">
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Capabilities</h3>
                <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                    {capabilities.map((cap) => {
                        const flagEnabled =
                            !flags || flags.master === false
                                ? false
                                : cap.id === "news"
                                    ? flags.news
                                    : cap.id === "technical_snapshot" || cap.id === "screener"
                                        ? flags.technicals
                                        : cap.id === "economic_calendar"
                                            ? flags.economicCalendar
                                            : cap.id === "fundamentals" || cap.id === "filings" || cap.id === "forecasts" || cap.id === "financial_history" || cap.id === "earnings_calendar" || cap.id === "dividends_calendar"
                                                ? flags.fundamentals
                                                : cap.id === "watchlists"
                                                    ? flags.watchlists
                                                    : cap.id === "alerts" || cap.id === "alert_history"
                                                        ? flags.alerts
                                                        : true;
                        const enabled = cap.supported && flagEnabled;
                        return (
                            <div key={cap.id} className="flex items-center gap-2 rounded-lg border border-border bg-muted/20 px-3 py-1.5 text-xs">
                                {enabled ? (
                                    <Check size={13} className="shrink-0 text-positive" />
                                ) : (
                                    <span className="h-[13px] w-[13px] shrink-0 rounded-[3px] border border-border" />
                                )}
                                <span className={enabled ? "text-foreground" : "text-muted-foreground"}>
                                    {cap.label.charAt(0).toUpperCase() + cap.label.slice(1)}
                                </span>
                                <span className="ml-auto text-micro text-muted-foreground">read-only</span>
                            </div>
                        );
                    })}
                </div>
            </div>

            {/* Actions */}
            <div className="flex flex-wrap items-center gap-2">
                {connected ? (
                    <button
                        type="button"
                        onClick={handleDisconnect}
                        disabled={disconnecting}
                        className="inline-flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-2 text-sm font-medium text-destructive transition hover:bg-destructive/20 disabled:opacity-50"
                    >
                        {disconnecting ? <Loader2 size={14} className="animate-spin" /> : <Unplug size={14} />}
                        Disconnect
                    </button>
                ) : null}
                {needsReconnect ? (
                    <button
                        type="button"
                        onClick={handleConnect}
                        disabled={connecting}
                        className="inline-flex items-center gap-2 rounded-lg bg-foreground px-4 py-2 text-sm font-semibold text-background transition hover:opacity-90 disabled:opacity-50"
                    >
                        {connecting ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                        Reconnect TradingView
                    </button>
                ) : null}
                {!connected && !needsReconnect && flags?.master ? (
                    <button
                        type="button"
                        onClick={handleConnect}
                        disabled={connecting}
                        className="inline-flex items-center gap-2 rounded-lg bg-foreground px-4 py-2 text-sm font-semibold text-background transition hover:opacity-90 disabled:opacity-50"
                    >
                        {connecting ? <Loader2 size={14} className="animate-spin" /> : <Plug size={14} />}
                        Connect TradingView
                    </button>
                ) : null}
                <a
                    href="https://www.tradingview.com/mcp/docs"
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-xs text-muted-foreground transition hover:text-foreground"
                >
                    TradingView MCP docs <ExternalLink size={11} />
                </a>
            </div>

            {/* Notices */}
            <div className="mt-4 grid gap-2 text-micro leading-4 text-muted-foreground">
                <div className="flex items-center gap-1.5">
                    <CheckCircle2 size={12} className="shrink-0 text-muted-foreground" />
                    <span>
                        <strong>Beta.</strong> Data may be delayed — TradingView MCP is research context only and is never
                        used for order execution or latency-sensitive decisions.
                    </span>
                </div>
                <div className="flex items-center gap-1.5">
                    <CheckCircle2 size={12} className="shrink-0 text-muted-foreground" />
                    <span>
                        Your TradingView credentials are stored encrypted on AlgoVault&apos;s server and are never exposed to
                        your browser or the AlgoVault Chrome Extension.
                    </span>
                </div>
                <div className="flex items-center gap-1.5">
                    <CheckCircle2 size={12} className="shrink-0 text-muted-foreground" />
                    <span>
                        AlgoVault&apos;s own Smart Money, backtesting and replay engines are unaffected by this connection.
                    </span>
                </div>
            </div>
        </div>
    );
}
