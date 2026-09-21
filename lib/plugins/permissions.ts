import { PermissionSet, PluginPermission } from "./types";

/**
 * Central permission catalog for the plugin runtime.
 *
 * Every permission a plugin can request must be explicitly declared here
 * with a human-readable label and a short description. The runtime grants
 * access to data / services ONLY when the plugin's manifest lists the
 * corresponding permission — never implicitly.
 */

export const PERMISSION_CATALOG: Record<
    PluginPermission,
    { label: string; description: string; icon: string }
> = {
    market_data: {
        label: "Market Data",
        description: "Read live & historical market prices, volatility and regime data.",
        icon: "📊",
    },
    trading_history: {
        label: "Trading History",
        description: "Read your closed trades and bot execution history.",
        icon: "📜",
    },
    strategy_data: {
        label: "Strategy Data",
        description: "Read your saved strategies and analysis results.",
        icon: "🧠",
    },
    portfolio_data: {
        label: "Portfolio Data",
        description: "Read aggregate portfolio exposure and balances.",
        icon: "💼",
    },
    account_data: {
        label: "Account Data",
        description: "Read account metadata (no credentials).",
        icon: "🏦",
    },
    news_data: {
        label: "News & Events",
        description: "Read economic events and market news calendar.",
        icon: "📰",
    },
    ai_analysis: {
        label: "AI Analysis",
        description: "Use the AlgoVault AI analysis layer to interpret data.",
        icon: "🤖",
    },
    notifications: {
        label: "Notifications",
        description: "Send you in-app, push, email, Telegram and Discord notifications.",
        icon: "🔔",
    },
    telegram: {
        label: "Telegram",
        description: "Deliver alerts through your connected Telegram account.",
        icon: "✈️",
    },
    discord: {
        label: "Discord",
        description: "Deliver alerts through your connected Discord webhook.",
        icon: "🎮",
    },
    webhooks: {
        label: "Webhooks",
        description: "Send events to user-configured webhook endpoints.",
        icon: "🔗",
    },
    scheduler: {
        label: "Scheduler",
        description: "Run in the background on a schedule you configure.",
        icon: "⏰",
    },
};

/**
 * Capability names that are NEVER grantable — the runtime refuses plugins
 * that request them. This is a hard safety boundary. Plugins are analytical
 * and act on the user's behalf for data + notifications only.
 */
export const FORBIDDEN_PERMISSIONS: string[] = [
    "trading_execution",
    "order_placement",
    "account_credentials",
    "payment_information",
    "database_access",
    "arbitrary_server_execution",
];

/**
 * Permissions a plugin may be granted automatically at install time
 * (after user consent is shown on the details page).
 */
export function defaultPermissionSet(permissions: PermissionSet): PermissionSet {
    const out: PermissionSet = {};
    for (const key of Object.keys(permissions) as PluginPermission[]) {
        if (FORBIDDEN_PERMISSIONS.includes(key)) continue;
        out[key] = permissions[key] === true;
    }
    return out;
}

/** All defined permissions. */
export function allPermissions(): PluginPermission[] {
    return Object.keys(PERMISSION_CATALOG) as PluginPermission[];
}

/** Sanitize an untrusted permission set (e.g. from AI output / request body). */
export function sanitizePermissionSet(input: unknown): PermissionSet {
    if (!input || typeof input !== "object") return {};
    const out: PermissionSet = {};
    for (const key of allPermissions()) {
        const raw = (input as Record<string, unknown>)[key];
        if (raw === true) out[key] = true;
        else if (raw === false) out[key] = false;
    }
    return out;
}

/** Validate a permission set. Returns error string or null when valid. */
export function validatePermissionSet(permissions: PermissionSet, requestedExtra?: string[]): string | null {
    const requested = Object.keys(permissions).filter((k) => permissions[k as PluginPermission] === true);
    const forbidden = [...FORBIDDEN_PERMISSIONS, ...(requestedExtra || [])];
    if (requested.some((k) => forbidden.includes(k))) {
        return `Plugin requests forbidden capability: ${requested.filter((k) => forbidden.includes(k)).join(", ")}`;
    }
    for (const key of requested) {
        if (!(key in PERMISSION_CATALOG)) {
            return `Unknown permission: ${key}`;
        }
    }
    return null;
}

/**
 * Human-readable list describing what the plugin requests and, importantly,
 * what it does NOT request. Used on details pages.
 */
export function describePermissions(permissions: PermissionSet): {
    requested: PluginPermission[];
    notRequested: PluginPermission[];
} {
    const requested = allPermissions().filter((p) => permissions[p] === true);
    const notRequested = allPermissions().filter(
        (p) => permissions[p] !== true && p !== "account_data"
    );
    return { requested, notRequested };
}

/** Whether the permission set would allow a given capability. */
export function hasPermission(permissions: PermissionSet, permission: PluginPermission): boolean {
    return permissions[permission] === true;
}