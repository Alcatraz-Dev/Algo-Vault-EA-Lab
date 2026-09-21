"use client";

import { auth } from "@/lib/firebase";
import { PERMISSION_CATALOG } from "@/lib/plugins/permissions";
import { PluginCategory, PluginStatus, InstallationStatus, PluginPermission, PluginInterval, PluginKind } from "@/lib/plugins/types";
import type { StatusTone } from "@/components/ui/status-badge";

/**
 * Client-side display helpers shared by every plugin & extension page.
 * Pure formatting + an authenticated fetch wrapper — no data logic lives here.
 */

export async function pluginFetch(input: string, init?: RequestInit): Promise<Response> {
    const user = auth.currentUser;
    if (!user) throw new Error("Authentication required.");
    const token = await user.getIdToken();
    return fetch(input, {
        ...init,
        cache: "no-store",
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
            ...(init?.headers || {}),
        },
    });
}

export async function pluginFetchJSON<T>(input: string, init?: RequestInit): Promise<T> {
    const res = await pluginFetch(input, init);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error((data as { error?: string })?.error || `Request failed (${res.status}).`);
    return data as T;
}

// ─── Label maps ─────────────────────────────────────────────────────────────

export const CATEGORY_LABELS: Record<PluginCategory, string> = {
    "trading-intelligence": "Trading Intelligence",
    "risk-management": "Risk Management",
    "market-monitoring": "Market Monitoring",
    "behavioral-analytics": "Behavioral Analytics",
    "correlation-analysis": "Correlation Analysis",
    automation: "Automation",
    "external-integration": "External Integration",
    workflow: "Workflow",
    "news-intelligence": "News Intelligence",
    "ai-assistant": "AI Assistant",
};

export const CATEGORIES: { id: PluginCategory; label: string }[] = (
    Object.keys(CATEGORY_LABELS) as PluginCategory[]
).map((id) => ({ id, label: CATEGORY_LABELS[id] }));

export const PLUGIN_STATUS_LABELS: Record<PluginStatus, string> = {
    draft: "Draft",
    testing: "Testing",
    pending_review: "Pending review",
    published: "Published",
    disabled: "Disabled",
};

export function pluginStatusTone(status: PluginStatus): StatusTone {
    switch (status) {
        case "published":
            return "live";
        case "testing":
            return "warning";
        case "pending_review":
            return "pending";
        case "disabled":
            return "offline";
        default:
            return "neutral";
    }
}

export const INSTALL_STATUS_LABELS: Record<InstallationStatus, string> = {
    draft: "Draft",
    testing: "Testing",
    installed: "Installed",
    configured: "Configured",
    active: "Active",
    paused: "Paused",
    disabled: "Disabled",
    uninstalled: "Uninstalled",
};

export function installStatusTone(status: InstallationStatus | string): StatusTone {
    switch (status) {
        case "active":
            return "live";
        case "configured":
            return "info";
        case "paused":
            return "warning";
        case "disabled":
            return "offline";
        case "uninstalled":
            return "stale";
        case "installed":
            return "neutral";
        default:
            return "neutral";
    }
}

export const INTERVAL_LABELS: Record<PluginInterval, string> = {
    "10s": "Every 10 seconds",
    "30s": "Every 30 seconds",
    "1m": "Every minute",
    "5m": "Every 5 minutes",
    "15m": "Every 15 minutes",
    hourly: "Every hour",
    daily: "Every day",
    market_open: "At market open",
    market_close: "At market close",
    event: "Event-based",
    manual: "Manually triggered",
};

export const INTERVALS: PluginInterval[] = ["10s", "30s", "1m", "5m", "15m", "hourly", "daily", "event", "manual"];

export function permissionLabel(permission: PluginPermission): string {
    return PERMISSION_CATALOG[permission]?.label || permission;
}

export function permissionDescription(permission: PluginPermission): string {
    return PERMISSION_CATALOG[permission]?.description || "";
}

export function grantedPermissions(permissions: Partial<Record<PluginPermission, boolean>> | undefined): PluginPermission[] {
    return (Object.keys(permissions || {}) as PluginPermission[]).filter((key) => permissions?.[key]);
}

export const KIND_LABELS: Record<PluginKind, string> = {
    plugin: "Plugin",
    extension: "Extension",
};

export const EXTENSION_TYPE_LABELS: Record<string, string> = {
    browser: "Browser Extension",
    tradingview: "TradingView Companion",
    webhook: "Webhook",
    discord: "Discord",
    telegram: "Telegram",
    api: "API",
};

// ─── Formatting ─────────────────────────────────────────────────────────────

export function formatNumber(value: number | undefined | null): string {
    const n = Number(value || 0);
    return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

export function formatPrice(price: number | undefined | null, currency?: string): string {
    const n = Number(price || 0);
    const cur = String(currency || "usd").toUpperCase();
    return `${cur === "USD" ? "$" : `${cur} `}${n.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
}

export function formatDate(timestamp: number | null | undefined): string {
    if (!timestamp) return "—";
    return new Date(timestamp).toLocaleString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
    });
}

export function formatShortDate(timestamp: number | null | undefined): string {
    if (!timestamp) return "—";
    return new Date(timestamp).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export function timeAgo(timestamp: number | null | undefined): string {
    if (!timestamp) return "never";
    const delta = Date.now() - timestamp;
    if (delta < 60_000) return "just now";
    if (delta < 3_600_000) return `${Math.floor(delta / 60_000)}m ago`;
    if (delta < 86_400_000) return `${Math.floor(delta / 3_600_000)}h ago`;
    return `${Math.floor(delta / 86_400_000)}d ago`;
}

export function nextRunLabel(timestamp: number | null | undefined, status?: string): string {
    if (status === "paused" || status === "disabled") return "Paused";
    if (!timestamp) return "—";
    const delta = timestamp - Date.now();
    if (delta <= 0) return "Due now";
    if (delta < 60_000) return `${Math.max(1, Math.round(delta / 1000))}s`;
    if (delta < 3_600_000) return `${Math.round(delta / 60_000)}m`;
    if (delta < 86_400_000) return `${Math.round(delta / 3_600_000)}h`;
    return `${Math.round(delta / 86_400_000)}d`;
}

export function severityLabel(severity: string | undefined): string {
    switch (severity) {
        case "high":
            return "High";
        case "low":
            return "Low";
        default:
            return "Medium";
    }
}

export function severityTone(severity: string | undefined): StatusTone {
    switch (severity) {
        case "high":
            return "error";
        case "low":
            return "info";
        default:
            return "warning";
    }
}