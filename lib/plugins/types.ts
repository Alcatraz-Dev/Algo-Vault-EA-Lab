/**
 * AlgoVault Plugins & Extensions Ecosystem — shared types.
 *
 * These types are used by both the client UI and the server runtime.
 * They describe the plugin catalog, installation lifecycle, runtime
 * execution model, permissions, licensing and notifications.
 */

export type PluginKind = "plugin" | "extension";

export type PluginCategory =
    | "trading-intelligence"
    | "risk-management"
    | "market-monitoring"
    | "behavioral-analytics"
    | "correlation-analysis"
    | "automation"
    | "external-integration"
    | "workflow"
    | "news-intelligence"
    | "ai-assistant";

export type PluginStatus =
    | "draft"
    | "testing"
    | "pending_review"
    | "published"
    | "disabled";

export type InstallationStatus =
    | "draft"
    | "testing"
    | "installed"
    | "configured"
    | "active"
    | "paused"
    | "disabled"
    | "uninstalled";

// ─── Permissions ────────────────────────────────────────────────────────────

export type PluginPermission =
    | "market_data"
    | "trading_history"
    | "strategy_data"
    | "portfolio_data"
    | "account_data"
    | "news_data"
    | "ai_analysis"
    | "notifications"
    | "telegram"
    | "discord"
    | "webhooks"
    | "scheduler";

export type PermissionSet = Partial<Record<PluginPermission, boolean>>;

// ─── Pricing / licensing ────────────────────────────────────────────────────

export type PluginPricingType = "free" | "one_time" | "subscription";

export type PluginPricing = {
    type: PluginPricingType;
    price: number;
    currency: string;
    /** For subscriptions, in months. */
    intervalMonths?: number;
};

export type PluginLicenseRecord = {
    id: string;
    pluginId: string;
    pluginName: string;
    userId: string;
    orderId: string;
    pricingType: PluginPricingType;
    amount: number;
    currency: string;
    status: "active" | "expired" | "revoked" | "past_due";
    stripeSubscriptionId?: string | null;
    startedAt: number;
    expiresAt: number; // 0 = lifetime
    createdAt: number;
    updatedAt: number;
};

// ─── Manifest / catalog record ──────────────────────────────────────────────

export type PluginManifest = {
    name: string;
    displayName: string;
    version: string;
    type: PluginKind;
    category: PluginCategory;
    pricing: PluginPricing;
    permissions: PermissionSet;
    /** Event types this plugin may subscribe to on the internal event bus. */
    subscribes: string[];
    /** Event types this plugin may emit on the internal event bus. */
    emits: string[];
    runtime: PluginRuntimeDefinition;
};

export type PluginRuntimeDefinition = {
    /** Which built-in analyzer implementation handles this plugin. */
    handler?: string;
    /** Which interval cadence the scheduler should use while active. */
    interval: PluginInterval;
    /** Max execution wall-clock budget in ms. */
    timeoutMs: number;
    /** Data sources the runtime may touch, derived from permissions. */
    sources: string[];
    /** Declarative conditions (evaluated server-side) for AI/generated plugins. */
    condition?: DeclarativeCondition;
    /**
     * Declared capabilities the plugin depends on. If a requested API does
     * not exist, the pipeline must report it — never fake it.
     */
    requires?: string[];
};

export type PluginInterval =
    | "10s"
    | "30s"
    | "1m"
    | "5m"
    | "15m"
    | "hourly"
    | "daily"
    | "market_open"
    | "market_close"
    | "event"
    | "manual";

export type PluginRecord = {
    /** Stable id — equals the slug. */
    id: string;
    name: string;
    displayName: string;
    slug: string;
    version: string;
    description: string;
    type: PluginKind;
    category: PluginCategory;
    pricing: PluginPricing;
    permissions: PermissionSet;
    manifest: PluginManifest;
    capabilities: string[];
    supportedMarkets: string[];
    supportedNotifications: string[];
    creator: {
        uid: string;
        name: string;
        kind: "admin" | "developer";
    };
    isAIGenerated?: boolean;
    status: PluginStatus;
    installs: number;
    activeUsers: number;
    rating: PluginRating;
    versionHistory: string[];
    lastUpdated: number;
    createdAt: number;
    updatedAt: number;
    /** Freeform documentation (markdown-ish). */
    documentation?: string;
    /** Per-version changelog entries. */
    changelog?: Record<string, string>;
};

export type PluginRating = {
    average: number;
    count: number;
    distribution: Record<1 | 2 | 3 | 4 | 5, number>;
    updatedAt: number;
};

// ─── Declarative conditions (runtime logic for generated plugins) ───────────

export type ConditionOperator =
    | "gt"
    | "gte"
    | "lt"
    | "lte"
    | "eq"
    | "neq"
    | "crossed_above"
    | "crossed_below";

export type ConditionSource =
    | "market.volatility.atr"
    | "market.volatility.atrPercent"
    | "market.volatility.rangeExpansion"
    | "market.volatility.state"
    | "market.regime.regime"
    | "market.regime.confidence"
    | "market.session.current"
    | "market.quote.changePercent"
    | "market.quote.spread"
    | "market.structure.count"
    | "market.liquidity.count"
    | "market.multiTimeframe.bias"
    | "risk.drawdownPercent"
    | "risk.exposure"
    | "risk.positionCount"
    | "risk.correlatedExposure"
    | "news.impact.incomingEvents"
    | "news.impact.recentImpact";

export type DeclarativeCondition = {
    operator: ConditionOperator;
    source: ConditionSource;
    value: number | string;
    /** Optional: require all sub-conditions. */
    and?: DeclarativeCondition[];
};

// ─── Installation / lifecycle ───────────────────────────────────────────────

export type PluginInstallation = {
    pluginId: string;
    userId: string;
    kind: PluginKind;
    status: InstallationStatus;
    installedVersion: string | null;
    licenseStatus: "free" | "active" | "expired" | "none";
    notificationsEnabled: boolean;
    lastActivityAt: number | null;
    lastExecutionAt: number | null;
    nextRunAt: number | null;
    alertsGenerated: number;
    executions: number;
    failures: number;
    installedAt: number;
    updatedAt: number;
};

export type PluginConfig = {
    pluginId: string;
    userId: string;
    symbols: string[];
    timeframes: string[];
    interval: PluginInterval;
    notificationChannels: string[];
    quietHoursStart?: string;
    quietHoursEnd?: string;
    cooldownMin?: number;
    maxAlertsPerDay?: number;
    severity?: "low" | "medium" | "high";
    /** Free-form settings per plugin handler. */
    settings: Record<string, unknown>;
    /** For risk guardian: user-defined limits. */
    riskLimits?: Record<string, number | boolean>;
    paused?: boolean;
    updatedAt: number;
};

// ─── Runtime execution ──────────────────────────────────────────────────────

export type ExecutionStatus = "success" | "failed";

export type PluginExecutionRecord = {
    id: string;
    pluginId: string;
    userId: string;
    trigger: "schedule" | "manual" | "event" | "test" | "activation";
    status: ExecutionStatus;
    startedAt: number;
    finishedAt: number;
    durationMs: number;
    symbols: string[];
    summary?: string;
    findings?: PluginFinding[];
    alerts?: PluginAlert[];
    events?: string[];
    error?: string;
};

export type PluginFinding = {
    title: string;
    detail: string;
    tags?: string[];
};

export type PluginAlert = {
    severity: "low" | "medium" | "high";
    title: string;
    message: string;
    symbol?: string;
    eventType: string;
    metadata?: Record<string, unknown>;
};

export type PluginExecutionResult = {
    status: ExecutionStatus;
    summary?: string;
    findings?: PluginFinding[];
    alerts?: PluginAlert[];
    events?: string[];
    error?: string;
};

// ─── Notifications ──────────────────────────────────────────────────────────

export type PluginNotificationRecord = {
    id: string;
    pluginId: string;
    pluginName: string;
    userId: string;
    severity: "low" | "medium" | "high";
    eventType: string;
    title: string;
    message: string;
    symbol: string;
    link: string;
    timestamp: number;
    deliveredChannels: string[];
    metadata?: Record<string, unknown>;
};

// ─── Event bus ──────────────────────────────────────────────────────────────

export type PluginBusEvent = {
    id: string;
    userId: string;
    type: string;
    sourcePlugin: string;
    payload: Record<string, unknown>;
    timestamp: number;
};

// ─── Runtime state (scheduling) ─────────────────────────────────────────────

export type PluginRuntimeState = {
    userId: string;
    pluginId: string;
    status: "scheduled" | "running" | "paused";
    nextRunAt: number | null;
    lastRunAt: number | null;
    lastExecutionId: string | null;
    failures: number;
    alertedToday: number;
    lastAlertAt: number | null;
    updatedAt: number;
};

// ─── Extensions ─────────────────────────────────────────────────────────────

export type PluginExtensionType = "browser" | "tradingview" | "webhook" | "discord" | "telegram" | "api";

export type ExtensionRecord = PluginRecord & {
    extensionType: PluginExtensionType;
    endpoints?: string[];
};

export type ExtensionInstallation = {
    extensionId: string;
    userId: string;
    status: InstallationStatus;
    installedVersion: string | null;
    apiKeyId?: string;
    webhookUrl?: string;
    target?: string;
    installedAt: number;
    updatedAt: number;
};

// ─── AI generation ──────────────────────────────────────────────────────────

export type AIGeneratedPluginSpec = {
    name: string;
    displayName: string;
    description: string;
    category: PluginCategory;
    target: PluginKind;
    /** Set when target === "extension" — determines how the extension connects (webhook, browser, tradingview, chat, api). */
    extensionType?: PluginExtensionType;
    pricing: PluginPricing;
    permissions: PermissionSet;
    capabilities: string[];
    supportedMarkets: string[];
    supportedNotifications: string[];
    manifest: PluginManifest;
    configSchema: Record<string, unknown>;
    runtime: PluginRuntimeDefinition;
    notificationBehavior: {
        cooldownMin: number;
        maxAlertsPerDay: number;
        quietHoursStart?: string;
        quietHoursEnd?: string;
    };
    documentation: string;
    testCases: string[];
    /** Capabilities the generator wanted but that are not supported. */
    unsupportedCapabilities?: {
        required: string;
        suggestedImplementation: string;
    }[];
};

export type PluginDraft = {
    id: string;
    name: string;
    displayName: string;
    description: string;
    target: PluginKind;
    /** Set when target === "extension" — the connection type the generated extension uses. */
    extensionType?: PluginExtensionType;
    category: PluginCategory;
    pricing: PluginPricing;
    permissions: PermissionSet;
    spec: AIGeneratedPluginSpec;
    validation: {
        schema: boolean;
        permissions: boolean;
        security: boolean;
        sandbox: boolean;
        tests: boolean;
    };
    validationMessages: string[];
    status: "generated" | "passed" | "rejected" | "published";
    createdBy: string;
    createdAt: number;
    updatedAt: number;
};

export type GenerationJob = {
    id: string;
    prompt: string;
    target: PluginKind;
    category: PluginCategory;
    status: "queued" | "generating" | "done" | "failed";
    error?: string;
    draftId?: string;
    createdBy: string;
    createdAt: number;
    finishedAt: number | null;
};

// ─── Audit log ──────────────────────────────────────────────────────────────

export type PluginAuditLog = {
    id: string;
    actor: string;
    action: string;
    pluginId?: string;
    detail: Record<string, unknown>;
    createdAt: number;
};