import { PluginManifest, PluginInterval, PluginKind } from "./types";
import { validatePermissionSet, sanitizePermissionSet, PERMISSION_CATALOG } from "./permissions";

/**
 * Manifest validation + sanitization.
 *
 * A plugin manifest is the contract between a plugin and the runtime.
 * Every manifest coming from an untrusted source (AI generation, admin
 * input, future third-party uploads) must pass through here before it can
 * be registered in the catalog or executed.
 */

export const VALID_INTERVALS: PluginInterval[] = [
    "10s",
    "30s",
    "1m",
    "5m",
    "15m",
    "hourly",
    "daily",
    "market_open",
    "market_close",
    "event",
    "manual",
];

export const VALID_CATEGORIES = [
    "trading-intelligence",
    "risk-management",
    "market-monitoring",
    "behavioral-analytics",
    "correlation-analysis",
    "automation",
    "external-integration",
    "workflow",
    "news-intelligence",
    "ai-assistant",
] as const;

export const MAX_MANIFEST_VERSION = "99.99.99";

export function isSemver(version: string): boolean {
    return /^\d+\.\d+\.\d+$/.test(String(version || ""));
}

export type ManifestCheck = {
    manifest: PluginManifest | null;
    errors: string[];
    warnings: string[];
};

/**
 * Validates and sanitizes an untrusted manifest. Returns either a safe,
 * normalized manifest or detailed errors. Never returns a partial manifest
 * that skipped a validation step.
 */
export function validateManifest(input: unknown, kind?: PluginKind): ManifestCheck {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (!input || typeof input !== "object") {
        return { manifest: null, errors: ["Manifest is required."], warnings };
    }
    const raw = input as Record<string, unknown>;

    const type = kind || raw.type;
    if (type !== "plugin" && type !== "extension") {
        errors.push(`Manifest type must be "plugin" or "extension".`);
    }

    const name = String(raw.name || "").trim();
    if (!name || !/^[a-z0-9][a-z0-9_-]{1,63}$/.test(name)) {
        errors.push("Manifest name must be 2-64 chars: lowercase letters, digits, dash or underscore.");
    }

    const displayName = String(raw.displayName || "").trim();
    if (!displayName || displayName.length > 80) {
        errors.push("displayName is required and must be 80 characters or fewer.");
    }

    const version = String(raw.version || "").trim();
    if (!isSemver(version)) {
        errors.push("version must be a semantic version like 1.0.0.");
    }

    const category = String(raw.category || "");
    if (!(VALID_CATEGORIES as readonly string[]).includes(category)) {
        errors.push(`Unknown category: ${category}`);
    }

    // Pricing sanity.
    const pricing = raw.pricing as Record<string, unknown> | undefined;
    const pricingType = String(pricing?.type || "free");
    if (!["free", "one_time", "subscription"].includes(pricingType)) {
        errors.push(`Unknown pricing type: ${pricingType}`);
    }
    const price = Number(pricing?.price || 0);
    const currency = String(pricing?.currency || "usd").toLowerCase();
    if (pricingType !== "free" && (!Number.isFinite(price) || price <= 0)) {
        errors.push("Paid plugins must define a positive price.");
    }
    if (!currency || currency.length !== 3) {
        errors.push("Pricing currency must be a 3-letter code.");
    }

    // Permissions.
    const permissionRaw = raw.permissions;
    const permissions = sanitizePermissionSet(permissionRaw);
    const permissionError = validatePermissionSet(permissions);
    if (permissionError) {
        errors.push(permissionError);
    }
    if (Object.values(permissions).filter(Boolean).length === 0) {
        warnings.push("Manifest declares no permissions — the plugin will be mostly inert.");
    }

    // Runtime.
    const runtime = raw.runtime as Record<string, unknown> | undefined;
    const interval = String(runtime?.interval || "manual");
    if (!VALID_INTERVALS.includes(interval as PluginInterval)) {
        errors.push(`Unknown runtime interval: ${interval}`);
    }
    const timeoutMs = Number(runtime?.timeoutMs || 15000);
    if (!Number.isFinite(timeoutMs) || timeoutMs < 1000 || timeoutMs > 120000) {
        errors.push("runtime.timeoutMs must be between 1000 and 120000.");
    }

    // Event subscriptions must be well-formed strings.
    const subscribesRaw = Array.isArray(raw.subscribes) ? raw.subscribes.map(String) : [];
    const emitsRaw = Array.isArray(raw.emits) ? raw.emits.map(String) : [];

    // Security scan: reject anything that looks like arbitrary code.
    const serialized = JSON.stringify(raw).toLowerCase();
    const DANGEROUS_PATTERNS = [
        "eval(",
        "function(",
        "firebase",
        "admin.database",
        "child_process",
        "process.env",
        "require(",
        "import(",
        "fetch(",
        "http://",
        "https://",
        "`",
        "<script",
    ];
    for (const pattern of DANGEROUS_PATTERNS) {
        if (serialized.includes(pattern)) {
            errors.push(`Manifest contains a disallowed token: "${pattern}".`);
            break;
        }
    }

    if (errors.length > 0) {
        return { manifest: null, errors, warnings };
    }

    const manifest: PluginManifest = {
        name,
        displayName,
        version,
        type: kind || (type as PluginKind),
        category: category as PluginManifest["category"],
        pricing: {
            type: pricingType as PluginManifest["pricing"]["type"],
            price: pricingType === "free" ? 0 : price,
            currency,
            intervalMonths: pricingType === "subscription" ? Math.min(12, Math.max(1, Number(pricing?.intervalMonths || 1))) : undefined,
        },
        permissions,
        subscribes: subscribesRaw.filter((s) => typeof s === "string" && s.length > 0 && s.length < 120),
        emits: emitsRaw.filter((s) => typeof s === "string" && s.length > 0 && s.length < 120),
        runtime: {
            handler: typeof runtime?.handler === "string" ? runtime.handler : undefined,
            interval: interval as PluginInterval,
            timeoutMs,
            sources: Array.isArray(runtime?.sources) ? runtime.sources.map(String).slice(0, 20) : [],
            requires: Array.isArray(runtime?.requires) ? runtime.requires.map(String).slice(0, 20) : [],
            condition: runtime?.condition as PluginManifest["runtime"]["condition"],
        },
    };

    return { manifest, errors, warnings };
}

export function hasAllPermissionLabels(permissionSet: Record<string, boolean>): boolean {
    return Object.keys(permissionSet).every((key) => key in PERMISSION_CATALOG);
}