import { AgentPermission, AgentPermissionSet } from "./types";
import { PluginPermission, PermissionSet } from "@/lib/plugins/types";

/**
 * Central permission catalog for the Agent Orchestrator.
 *
 * Every permission an agent or workflow can declare is listed here with a
 * label and description. At execution time `runtime/permissions.ts` maps
 * these agent permissions onto the CALLER's effective entitlements (plugin
 * manifest permissions, extension permissions, or direct user access) — an
 * agent never reaches data it has not been granted.
 *
 * The map below also links each agent permission to the equivalent plugin
 * permission so that plugins and extensions driving a workflow can be
 * authorized against the same vocabulary.
 */

export const AGENT_PERMISSION_CATALOG: Record<
    AgentPermission,
    { label: string; description: string; icon: string; pluginPermission: PluginPermission }
> = {
    market_data: {
        label: "Market Data",
        description: "Read live & historical prices, volatility and regime data.",
        icon: "📊",
        pluginPermission: "market_data",
    },
    historical_data: {
        label: "Historical Data",
        description: "Read backtest and candle history to discover patterns.",
        icon: "🕰️",
        pluginPermission: "market_data",
    },
    strategy_data: {
        label: "Strategy Data",
        description: "Read saved strategies and historical setup fingerprints.",
        icon: "🧠",
        pluginPermission: "strategy_data",
    },
    trading_history: {
        label: "Trading History",
        description: "Read closed trades and bot execution history.",
        icon: "📜",
        pluginPermission: "trading_history",
    },
    portfolio_data: {
        label: "Portfolio Data",
        description: "Read aggregate portfolio exposure and balances.",
        icon: "💼",
        pluginPermission: "portfolio_data",
    },
    risk_data: {
        label: "Risk Data",
        description: "Read computed risk context: exposure, concentration, drawdown.",
        icon: "🛡️",
        pluginPermission: "portfolio_data",
    },
    news_data: {
        label: "News & Events",
        description: "Read economic events and market news calendar.",
        icon: "📰",
        pluginPermission: "news_data",
    },
    ai_analysis: {
        label: "AI Analysis",
        description: "Use the AlgoVault AI gateway to interpret data.",
        icon: "🤖",
        pluginPermission: "ai_analysis",
    },
    notifications: {
        label: "Notifications",
        description: "Send in-app alerts through the notification stack.",
        icon: "🔔",
        pluginPermission: "notifications",
    },
    telegram: {
        label: "Telegram",
        description: "Deliver results to the user's Telegram.",
        icon: "✈️",
        pluginPermission: "telegram",
    },
    discord: {
        label: "Discord",
        description: "Deliver results to the user's Discord webhook.",
        icon: "🎮",
        pluginPermission: "discord",
    },
    webhook: {
        label: "Webhook",
        description: "POST results to the user's configured webhook.",
        icon: "🪝",
        pluginPermission: "webhooks",
    },
};

/** Agent permissions that are never allowed on generated agents/workflows. */
export const FORBIDDEN_AGENT_PERMISSIONS: AgentPermission[] = [];

/**
 * Permissions whose data is personal and only reachable for the owning user
 * (never in admin sandbox mode).
 */
export const PERSONAL_AGENT_PERMISSIONS: AgentPermission[] = [
    "trading_history",
    "portfolio_data",
    "risk_data",
    "strategy_data",
    "notifications",
    "telegram",
    "discord",
    "webhook",
];

export function agentPermissionLabel(permission: AgentPermission): string {
    return AGENT_PERMISSION_CATALOG[permission]?.label || permission;
}

export function agentPermissionDescription(permission: AgentPermission): string {
    return AGENT_PERMISSION_CATALOG[permission]?.description || "";
}

/** Returns the unique list of agent permissions whose flag is truthy. */
export function grantedAgentPermissions(
    permissions: AgentPermissionSet | undefined
): AgentPermission[] {
    return (Object.keys(permissions || {}) as AgentPermission[]).filter(
        (key) => permissions?.[key] === true
    );
}

/**
 * Sanitizes an untrusted permission set: keeps only known keys and booleans.
 */
export function sanitizeAgentPermissionSet(
    input: unknown
): AgentPermissionSet {
    const out: AgentPermissionSet = {};
    if (!input || typeof input !== "object") return out;
    for (const key of Object.keys(input) as AgentPermission[]) {
        if (key in AGENT_PERMISSION_CATALOG && input[key] === true) {
            out[key] = true;
        }
    }
    return out;
}

/**
 * Maps an agent permission set to the plugin permission set a plugin or
 * extension must declare to be allowed to drive this workflow.
 */
export function agentToPluginPermissions(
    agentPermissions: AgentPermission[]
): PermissionSet {
    const out: PermissionSet = {};
    for (const permission of agentPermissions) {
        const mapped = AGENT_PERMISSION_CATALOG[permission]?.pluginPermission;
        if (mapped) out[mapped] = true;
    }
    return out;
}

/**
 * Checks that a caller's granted plugin-style permissions cover every
 * permission the workflow + its agents require. Returns the violated
 * permissions (empty = allowed).
 */
export function missingPermissions(
    required: AgentPermission[],
    granted: PermissionSet | undefined
): AgentPermission[] {
    const grantedMap = granted || {};
    const missing: AgentPermission[] = [];
    for (const permission of required) {
        const mapped = AGENT_PERMISSION_CATALOG[permission]?.pluginPermission;
        if (mapped && grantedMap[mapped] !== true) {
            missing.push(permission);
        }
    }
    return missing;
}