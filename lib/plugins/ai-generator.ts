import { defaultRouter } from "@/lib/ai/router";
import {
    AIGeneratedPluginSpec,
    PluginCategory,
    PluginDraft,
    PluginExtensionType,
    PluginKind,
    ConditionSource,
    ConditionOperator,
    PluginPricing,
    PermissionSet,
} from "./types";
import { validateManifest } from "./manifest";
import { validatePermissionSet, sanitizePermissionSet, FORBIDDEN_PERMISSIONS } from "./permissions";
import { saveDraft, saveGenerationJob } from "./database";
import { evaluateConditionTree, ConditionContext } from "./runtime/conditions";
import { isValidConditionSource, isValidConditionOperator, sanitizeConditionSource, sanitizeConditionOperator } from "./runtime/conditions-sources";

/**
 * AI Plugin Studio — safe generation pipeline.
 *
 * Flow:      prompt → AI structured spec → validation → sandbox test → draft
 * Boundary:  generated plugins are declarative ONLY. Every requested capability
 *            is checked against the real runtime API catalog below. Requests
 *            for APIs that do not exist are reported explicitly (never faked).
 */

/**
 * The real declarative surface a generated plugin can use. Anything a prompt
 * asks for that is NOT in this list is unsupported and blocks publishing.
 */
export const SUPPORTED_RUNTIME_APIS: Record<string, { label: string; description: string }> = {
    market_monitor: { label: "Market Monitor", description: "Read live volatility, regime, structure, liquidity, volume, session and multi-timeframe bias for configured symbols." },
    price_signal: { label: "Price Signal", description: "React to intraday price change percent on configured symbols." },
    risk_limits: { label: "Risk Limits", description: "Read exposure, position count, correlated exposure and realized drawdown." },
    news_calendar: { label: "News Calendar", description: "Read incoming economic events and their impact levels." },
    notifications: { label: "Notifications", description: "Deliver severity-ranked alerts (in-app, email, Telegram, Discord, webhook)." },
    scheduler: { label: "Scheduler", description: "Run on a fixed cadence (10s → daily) or market open/close." },
    trade_history: { label: "Trade History", description: "Read recorded bot trade history for analysis plugins." },
    strategy_context: { label: "Strategy Context", description: "Read saved strategy metadata for context-aware plugins." },
};

export const SUPPORTED_INTERVALS = ["10s", "30s", "1m", "5m", "15m", "hourly", "daily", "market_open", "market_close"] as const;

/** The connection types a generated extension may declare (mirrors ExtensionRecord.extensionType). */
export const SUPPORTED_EXTENSION_TYPES: PluginExtensionType[] = ["browser", "tradingview", "webhook", "discord", "telegram", "api"];

export function isSupportedExtensionType(value: string): value is PluginExtensionType {
    return (SUPPORTED_EXTENSION_TYPES as string[]).includes(value);
}

export const SYSTEM_PROMPT = [
    "You are AlgoVault's Plugin Architect. You design declarative trading-intelligence plugins.",
    "Plugins are analytical only. They NEVER place orders, touch accounts credentials, access databases,",
    "execute arbitrary code or contact external servers.",
    "A plugin's runtime logic is a DECLARATIVE CONDITION TREE with a source, an operator and a value.",
    `Condition sources: ${[
        "market.volatility.atr", "market.volatility.atrPercent", "market.volatility.rangeExpansion", "market.volatility.state",
        "market.regime.regime", "market.regime.confidence",
        "market.session.current", "market.quote.changePercent", "market.quote.spread", "market.structure.count",
        "market.liquidity.count", "market.multiTimeframe.bias",
        "risk.drawdownPercent", "risk.exposure", "risk.positionCount", "risk.correlatedExposure",
        "news.impact.incomingEvents", "news.impact.recentImpact",
    ].join(", ")}.`,
    "Operators: gt, gte, lt, lte, eq, neq, crossed_above, crossed_below.",
    "If the user's idea requires behavior outside this declarative surface (order placement, arbitrary computation,",
    "external API calls, credentials), DO NOT invent it. Mark each unsupported requirement in",
    "unsupportedCapabilities with an honest suggestedImplementation.",
].join("\n");

const MAX_SPEC_ATTEMPTS = 2;

export type GenerateSpecResult =
    | { ok: true; spec: AIGeneratedPluginSpec }
    | { ok: false; errors: string[] };

export async function generatePluginSpec(prompt: string, target: PluginKind, category: PluginCategory, extensionType?: PluginExtensionType): Promise<GenerateSpecResult> {
    const connectionLine =
        target === "extension" && extensionType && isSupportedExtensionType(extensionType)
            ? `\nThe connection type has been chosen: "${extensionType}". Emit "extensionType": "${extensionType}" — do not pick a different one.`
            : "";
    const userPrompt = [
        `Design a ${target === "extension" ? "workflow extension" : "trading-intelligence plugin"} in the "${category}" category.`,
        `The user's request: "${prompt}"`,
        connectionLine,
        "",
        "Return a STRICT JSON object matching exactly this schema:",
        `{
  "name": "lowercase-identifier, 2-64 chars [a-z0-9_-]",
  "displayName": "human readable title",
  "description": "2-3 sentences, factual",
  "category": "one of: trading-intelligence, risk-management, market-monitoring, behavioral-analytics, correlation-analysis, automation, external-integration, workflow, news-intelligence, ai-assistant",
  "target": "plugin or extension",
  "extensionType": "ONLY when target is extension (none when plugin); one of: browser, tradingview, webhook, discord, telegram, api",
  "pricing": { "type": "free", "price": 0, "currency": "usd" },
  "permissions": { set true only for: market_data, trading_history, strategy_data, portfolio_data, account_data, news_data, ai_analysis, notifications, telegram, discord, webhooks, scheduler },
  "capabilities": ["list of real user-visible features"],
  "supportedMarkets": ["e.g. Any connected bot symbol"],
  "supportedNotifications": ["In-app", "Email", "Telegram", "Discord"],
  "manifest": {
    "name": "same as name",
    "displayName": "same as displayName",
    "version": "1.0.0",
    "type": "plugin or extension",
    "category": "same as category",
    "pricing": { "type": "free", "price": 0, "currency": "usd" },
    "permissions": "same permission object",
    "subscribes": [],
    "emits": [],
    "runtime": {
      "handler": null,
      "interval": "one of 10s, 30s, 1m, 5m, 15m, hourly, daily, market_open, market_close, manual",
      "timeoutMs": 10000,
      "sources": ["declarative data sources used"],
      "condition": {
        "source": "one condition source from the list above",
        "operator": "one operator from the list above",
        "value": "numeric threshold or exact string",
        "and": []
      },
      "requires": ["EXACTLY these supported APIs: market_monitor, price_signal, risk_limits, news_calendar, notifications, scheduler, trade_history, strategy_context"]
    }
  },
  "configSchema": { "symbols": { "type": "array", "item": "string" }, "timeframes": { "type": "array", "item": "string" } },
  "runtime": "same as manifest.runtime",
  "notificationBehavior": { "cooldownMin": 5, "maxAlertsPerDay": 10, "quietHoursStart": "22:00", "quietHoursEnd": "07:00" },
  "documentation": "markdown docs",
  "testCases": ["3-5 concrete scenarios with expected outcomes"],
  "unsupportedCapabilities": []
}`,
        "Rules:",
        "- Never request forbidden capabilities: trading_execution, order_placement, account_credentials, payment_information, database_access, arbitrary_server_execution.",
        "- Only use condition sources and operators from the lists. No other runtime verbs exist.",
        "- ALWAYS include a complete spec: name, displayName, description, price type, permissions, capabilities, supportedMarkets, supportedNotifications, a valid runtime.condition (source + operator + value), and runtime.requires with at least one supported API. These fields are mandatory, never empty.",
        "- If the request is partially unsupported or unclear, still produce the closest valid declarative interpretation with all mandatory fields, and disclose every gap in unsupportedCapabilities with required + suggestedImplementation.",
        "- Value must be a number when the source is numeric and a string when the source is textual.",
        "",
        "Sandbox calibration: test contexts span atr 12-55, atrPercent 0.4-2.1 (a percentage of price like 1.1 — NOT a multiplier, so do not write 250 for a 2.5x spike), rangeExpansion 15-80, quote.changePercent -0.6 to 1.4, sessions asia/london/newyork (newyork appears with both calm and volatile values), risk.drawdownPercent 0-12, exposure 0.1-0.9, positionCount 2-8, correlatedExposure 1-4, news 0-6. Pick thresholds the condition is TRUE on at least one context (conditions that never match are rejected).",
        "The JSON must use EXACTLY the keys in the schema above — do not rename, reorder into wrappers, or change types (pricing is an object, permissions is an object of booleans, target is \"plugin\" or \"extension\").",
    ].join("\n");

    for (let attempt = 0; attempt < MAX_SPEC_ATTEMPTS; attempt += 1) {
        try {
            const generated = await generateSpecFromModel(userPrompt);
            if ("availabilityError" in generated) {
                // Every cloud provider failed (e.g. Gemini rate limit) and the router
                // silently degraded to the offline stub — surface that instead of
                // pretending the prompt produced an unusable spec.
                return { ok: false, errors: [generated.availabilityError] };
            }
            const normalized = normalizeSpec(generated, target, category, extensionType);
            const sanity = minimumSpecErrors(normalized);
            if (sanity.length === 0) {
                return { ok: true, spec: normalized };
            }
            if (attempt === MAX_SPEC_ATTEMPTS - 1) {
                return {
                    ok: false,
                    errors: [
                        "The AI could not turn this request into a usable plugin spec.",
                        ...sanity,
                        'Tip: name the symbol, the market trigger and the alert action — e.g. "Alert me when XAUUSD is within 0.1% of a daily support or resistance level during the London session."',
                    ],
                };
            }
        } catch (err) {
            const message = err instanceof Error ? err.message : "AI provider failed.";
            if (attempt === MAX_SPEC_ATTEMPTS - 1) {
                return { ok: false, errors: [`AI generation failed: ${message}`] };
            }
        }
    }
    return { ok: false, errors: ["AI generation failed after retries."] };
}

type SpecFromModel = AIGeneratedPluginSpec | { availabilityError: string };

/**
 * Calls the AI gateway directly (not the client helper) so the plugin pipeline
 * can tell a real model response from the offline heuristic stub. The local
 * fallback is never a valid source of a generated spec — if it wins, every
 * cloud provider was unavailable and the caller gets a clear availability error.
 */
async function generateSpecFromModel(userPrompt: string): Promise<SpecFromModel> {
    const res = await defaultRouter.chat({
        messages: [{ role: "user", content: userPrompt }],
        systemPrompt: SYSTEM_PROMPT,
        responseFormat: "json_object",
    });

    if (res.provider === "local-heuristic" || res.provider === "local") {
        const failures = (res.fallbackErrors || [])
            .filter((error) => error.provider && error.code)
            .map((error) => `${error.provider}:${error.code}${error.status ? ` (${error.status})` : ""}`);
        const detail = failures.length > 0 ? ` Provider failures: ${failures.join(", ")}.` : "";
        return {
            availabilityError:
                `The AI providers are temporarily unavailable (rate limit or outage). No spec was generated — please try again in a minute.${detail}`,
        };
    }

    const cleaned = res.content.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    const candidate = start !== -1 && end !== -1 ? cleaned.slice(start, end + 1) : cleaned;
    return JSON.parse(candidate) as AIGeneratedPluginSpec;
}

function pickObject(value: unknown): Record<string, unknown> | undefined {
    return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

/** Model drift often wraps the spec ({"spec": {...}}) — return the most spec-like object. */
function pickSpecRoot(raw: Record<string, unknown>): Record<string, unknown> {
    for (const key of ["spec", "plugin", "extension", "data", "result", "output"]) {
        const candidate = pickObject(raw[key]);
        if (candidate && ["name", "displayName", "description", "manifest", "capabilities"].some((f) => f in candidate)) {
            return candidate;
        }
    }
    return raw;
}

/** Permissions may arrive as an array like ["market_data", ...] — fold to a boolean map. */
function normalizePermissions(value: unknown): Record<string, unknown> {
    if (Array.isArray(value)) {
        const out: Record<string, unknown> = {};
        for (const item of value) out[String(item).trim().toLowerCase()] = true;
        return out;
    }
    return pickObject(value) || {};
}

/** Gemini occasionally folds the condition into {operator: "AND", operands: [...]}. */
function normalizeConditionShape(raw: Record<string, unknown>): Record<string, unknown> {
    if (typeof raw.operator === "string" && raw.operator.toUpperCase() === "AND" && Array.isArray(raw.operands) && raw.operands.length > 0) {
        const first = pickObject(raw.operands[0]) || {};
        return {
            source: first.source,
            operator: first.operator,
            value: first.value,
            and: raw.operands.slice(1).map((o) => pickObject(o) || {}),
        };
    }
    return raw;
}

function normalizeSpec(input: unknown, target: PluginKind, category: PluginCategory, requestedExtensionType?: PluginExtensionType): AIGeneratedPluginSpec {
    const raw = (input || {}) as Record<string, unknown>;
    const src = pickSpecRoot(raw);

    const rawManifest = pickObject(src.manifest) || (raw.manifest && typeof raw.manifest === "object" ? (raw.manifest as Record<string, unknown>) : src);
    const manifestRuntime = pickObject(rawManifest.runtime) || {};
    const rawRuntime = pickObject(src.runtime) || manifestRuntime;
    const rawCondition = normalizeConditionShape(pickObject(rawRuntime.condition) || pickObject(manifestRuntime.condition) || {});

    const srcPricing = pickObject(src.pricing) || (typeof src.pricing === "string" ? { type: src.pricing as string } : undefined);
    const manPricing = pickObject(rawManifest.pricing) || (typeof rawManifest.pricing === "string" ? { type: rawManifest.pricing as string } : undefined);
    const rawPricing = ((srcPricing || manPricing || {}) as Record<string, unknown>);

    const rawPerms = normalizePermissions(
        (src.permissions !== undefined ? src.permissions : rawManifest.permissions !== undefined ? rawManifest.permissions : undefined) ?? {}
    );

    const rawExtType = String(src.extensionType || (rawManifest.extensionType as string) || "").trim().toLowerCase();
    const modelExtensionType: PluginExtensionType | undefined =
        target === "extension" && isSupportedExtensionType(rawExtType) ? rawExtType : undefined;
    // The connection type chosen on the studio form is authoritative; the model's
    // suggestion is only used as a fallback when none was requested.
    const extensionType: PluginExtensionType | undefined =
        target === "extension"
            ? requestedExtensionType && isSupportedExtensionType(requestedExtensionType)
                ? requestedExtensionType
                : modelExtensionType
            : undefined;

    const pricing: PluginPricing = {
        type: String(rawPricing.type || "free").includes("sub") ? "subscription" : String(rawPricing.type || "free").includes("one") || String(rawPricing.type || "free").includes("one_time") ? "one_time" : "free",
        price: Math.max(0, Number(rawPricing.price) || 0),
        currency: String(rawPricing.currency || "usd").toLowerCase(),
        intervalMonths: Number(rawPricing.intervalMonths) > 0 ? Math.round(Number(rawPricing.intervalMonths)) : undefined,
    };

    const permissions = sanitizePermissionSet(rawPerms);

    return {
        name: String(src.name || rawManifest.name || "").trim().toLowerCase().replace(/[^a-z0-9_-]/g, "-").slice(0, 64),
        displayName: String(src.displayName || rawManifest.displayName || "").trim().slice(0, 80),
        description: String(src.description || "").trim().slice(0, 2000),
        category,
        target,
        ...(extensionType ? { extensionType } : {}),
        pricing,
        permissions,
        capabilities: Array.isArray(src.capabilities) ? src.capabilities.map(String).slice(0, 20) : [],
        supportedMarkets: Array.isArray(src.supportedMarkets) ? src.supportedMarkets.map(String).slice(0, 10) : [],
        supportedNotifications: Array.isArray(src.supportedNotifications) ? src.supportedNotifications.map(String).slice(0, 8) : [],
        manifest: {
            name: String(src.name || rawManifest.name || "").trim().toLowerCase().replace(/[^a-z0-9_-]/g, "-").slice(0, 64),
            displayName: String(src.displayName || rawManifest.displayName || "").trim().slice(0, 80),
            version: String(rawManifest.version || "1.0.0").trim(),
            type: target,
            category,
            pricing,
            permissions,
            subscribes: Array.isArray(rawManifest.subscribes) ? rawManifest.subscribes.map(String).slice(0, 20) : [],
            emits: Array.isArray(rawManifest.emits) ? rawManifest.emits.map(String).slice(0, 20) : [],
            runtime: {
                handler: undefined,
                interval: String(rawRuntime.interval || "manual") as AIGeneratedPluginSpec["runtime"]["interval"],
                timeoutMs: Math.min(60000, Math.max(1000, Number(rawRuntime.timeoutMs) || 10000)),
                sources: Array.isArray(rawRuntime.sources) ? rawRuntime.sources.map(String).slice(0, 20) : [],
                requires: Array.isArray(rawRuntime.requires) ? rawRuntime.requires.map(String).slice(0, 20) : [],
                condition: rawCondition && Object.keys(rawCondition).length > 0 ? sanitizeCondition(rawCondition) : undefined,
            },
        },
        runtime: {
            interval: String(rawRuntime.interval || "manual") as AIGeneratedPluginSpec["runtime"]["interval"],
            timeoutMs: Math.min(60000, Math.max(1000, Number(rawRuntime.timeoutMs) || 10000)),
            sources: Array.isArray(rawRuntime.sources) ? rawRuntime.sources.map(String).slice(0, 20) : [],
            requires: Array.isArray(rawRuntime.requires) ? rawRuntime.requires.map(String).slice(0, 20) : [],
            condition: rawCondition && Object.keys(rawCondition).length > 0 ? sanitizeCondition(rawCondition) : undefined,
        },
        configSchema:
            pickObject(src.configSchema) ||
            (src.configSchema && typeof src.configSchema === "object" ? (src.configSchema as Record<string, unknown>) : undefined) ||
            { symbols: { type: "array", item: "string" }, timeframes: { type: "array", item: "string" } },
        notificationBehavior: {
            cooldownMin: Math.max(1, Number((pickObject(src.notificationBehavior) || {}).cooldownMin) || 5),
            maxAlertsPerDay: Math.max(1, Number((pickObject(src.notificationBehavior) || {}).maxAlertsPerDay) || 10),
            quietHoursStart: String((pickObject(src.notificationBehavior) || {}).quietHoursStart || "22:00"),
            quietHoursEnd: String((pickObject(src.notificationBehavior) || {}).quietHoursEnd || "07:00"),
        },
        documentation: String(src.documentation || "").trim(),
        testCases: Array.isArray(src.testCases) ? src.testCases.map(String).slice(0, 10) : [],
        unsupportedCapabilities: Array.isArray(src.unsupportedCapabilities)
            ? src.unsupportedCapabilities
                  .map((u) => {
                      const item = pickObject(u) || {};
                      return {
                          required: String(item.required || ""),
                          suggestedImplementation: String(item.suggestedImplementation || ""),
                      };
                  })
                  .filter((u) => u.required)
                  .slice(0, 10)
            : [],
    };
}

function sanitizeCondition(raw: Record<string, unknown>): AIGeneratedPluginSpec["runtime"]["condition"] {
    const source = raw.source ? String(raw.source) : "";
    const operator = raw.operator ? String(raw.operator) : "";
    // A condition without a resolvable source is not a condition — return
    // undefined so validation reports "runtime.condition is required" instead of
    // silently fabricating a matches-everything default.
    if (!source || !isValidConditionSource(source)) {
        return undefined;
    }
    return {
        source: sanitizeConditionSource(source),
        operator: sanitizeConditionOperator(operator),
        value: typeof raw.value === "number" ? raw.value : String(raw.value ?? 0),
        and: Array.isArray(raw.and)
            ? raw.and
                  .map((c) => sanitizeCondition((c || {}) as Record<string, unknown>))
                  .filter((c): c is NonNullable<AIGeneratedPluginSpec["runtime"]["condition"]> => Boolean(c))
                  .slice(0, 4)
            : undefined,
    };
}

function minimumSpecErrors(spec: AIGeneratedPluginSpec): string[] {
    const errors: string[] = [];
    if (!spec.name || spec.name.length < 2) errors.push("name is required.");
    if (!spec.displayName) errors.push("displayName is required.");
    if (!spec.description) errors.push("description is required.");
    if (!spec.manifest.runtime.condition) errors.push("runtime.condition is required.");
    return errors;
}

export type PipelineValidation = {
    schema: boolean;
    permissions: boolean;
    security: boolean;
    sandbox: boolean;
    tests: boolean;
};

export type ValidateResult = {
    valid: boolean;
    validation: PipelineValidation;
    messages: string[];
};

export function validateGeneratedSpec(spec: AIGeneratedPluginSpec): ValidateResult {
    const messages: string[] = [];
    const validation: PipelineValidation = { schema: false, permissions: false, security: false, sandbox: false, tests: false };

    // 1. Schema — manifest structural validation.
    const manifestCheck = validateManifest(spec.manifest, spec.target);
    validation.schema = manifestCheck.errors.length === 0;
    if (!validation.schema) messages.push(...manifestCheck.errors);
    if (manifestCheck.warnings.length > 0) messages.push(...manifestCheck.warnings);

    // 2. Permissions — forbidden capability scan.
    const permError = validatePermissionSet(spec.permissions, FORBIDDEN_PERMISSIONS);
    validation.permissions = !permError;
    if (permError) messages.push(`Permissions: ${permError}`);

    // 3. Security — disallowed tokens scan on the whole spec.
    const serialized = JSON.stringify(spec).toLowerCase();
    const DANGEROUS_PATTERNS = ["eval(", "function(", "admin.database", "child_process", "process.env", "require(", "import(", "fetch(", "<script", "`.exec"];
    const hits = DANGEROUS_PATTERNS.filter((p) => serialized.includes(p));
    validation.security = hits.length === 0;
    if (hits.length > 0) messages.push(`Security: blocked token "${hits[0]}"`);

    // 4. Sandbox — every requested API must exist in the declarative surface.
    const requires = spec.manifest.runtime.requires || [];
    const unsupported = requires.filter((r) => !(r in SUPPORTED_RUNTIME_APIS));
    validation.sandbox = unsupported.length === 0 && requires.length > 0;
    if (unsupported.length > 0) {
        messages.push(`Sandbox: unsupported runtime API(s) requested: ${unsupported.join(", ")}. Supported: ${Object.keys(SUPPORTED_RUNTIME_APIS).join(", ")}.`);
        spec.unsupportedCapabilities = [
            ...(spec.unsupportedCapabilities || []),
            ...unsupported.map((r) => ({ required: r, suggestedImplementation: `No runtime API named "${r}" exists in the sandbox.` })),
        ];
    }
    if (requires.length === 0) {
        messages.push("Sandbox: plugin requests no runtime APIs — it will be inert. Declare at least one supported API in runtime.requires.");
    }

    // 5. Tests — run the declarative condition against synthetic contexts.
    const testResult = runSandboxTests(spec);
    validation.tests = testResult.ok;
    if (!testResult.ok) messages.push(`Sandbox test failure: ${testResult.errors.join("; ")}`);
    if (testResult.runs > 0) messages.push(`Sandbox test: evaluated condition across ${testResult.runs} synthetic contexts.`);

    // 6. Unsupported capability honesty.
    if (spec.unsupportedCapabilities && spec.unsupportedCapabilities.length > 0) {
        messages.push(
            `Unsupported capabilities reported: ${spec.unsupportedCapabilities.map((u) => u.required).join(", ")} — the prompt asked for behavior outside the declarative sandbox.`
        );
    }

    return { valid: validation.schema && validation.permissions && validation.security && validation.sandbox && validation.tests, validation, messages };
}

/**
 * Synthetic contexts used by the sandbox test. Each carries numeric risk/news
 * values plus minimal market snapshots (only the fields the condition
 * evaluator can resolve). Real market analytics populate the missing fields
 * at runtime — here we only need enough for a condition to actually match.
 */
function testMarketContext(snapshot: Record<string, unknown>): ConditionContext["market"] {
    return snapshot as unknown as ConditionContext["market"];
}

const TEST_CONTEXTS: { label: string; market?: ConditionContext["market"]; risk?: ConditionContext["risk"]; news?: ConditionContext["news"] }[] = [
    {
        label: "calm",
        market: testMarketContext({
            EURUSD: {
                symbol: "EURUSD",
                volatility: { atr: 12, atrPercent: 0.4, rangeExpansion: 15, state: "contracting" },
                regime: { regime: "ranging", confidence: 0.58 },
                session: { current: "asia" },
                quote: { changePercent: 0.05, spread: 1.2 },
                structure: [],
                liquidity: [],
                multiTimeframe: [],
            },
        }),
        risk: { drawdownPercent: 0, exposure: 0.1, positionCount: 2, correlatedExposure: 1 },
        news: { incomingEvents: 0, recentImpact: 0 },
    },
    {
        label: "volatile",
        market: testMarketContext({
            EURUSD: {
                symbol: "EURUSD",
                volatility: { atr: 55, atrPercent: 2.1, rangeExpansion: 72, state: "expanding" },
                regime: { regime: "trending", confidence: 0.88 },
                session: { current: "london" },
                quote: { changePercent: 1.4, spread: 0.3 },
                structure: [{}, {}, {}],
                liquidity: [{}],
                multiTimeframe: [{ bias: "bullish" }],
            },
        }),
        risk: { drawdownPercent: 12, exposure: 0.9, positionCount: 8, correlatedExposure: 4 },
        news: { incomingEvents: 6, recentImpact: 2 },
    },
    {
        label: "elevated-risk",
        market: testMarketContext({
            EURUSD: {
                symbol: "EURUSD",
                volatility: { atr: 34, atrPercent: 1.1, rangeExpansion: 45, state: "expanding" },
                regime: { regime: "ranging", confidence: 0.7 },
                session: { current: "newyork" },
                quote: { changePercent: -0.6, spread: 0.8 },
                structure: [{}],
                liquidity: [{}],
                multiTimeframe: [{ bias: "bearish" }],
            },
        }),
        risk: { drawdownPercent: 0, exposure: 0.55, positionCount: 3, correlatedExposure: 2 },
        news: { incomingEvents: 1, recentImpact: 0 },
    },
    {
        // A realistic EURUSD NY-session volatility spike (US data releases) — so
        // conditions like "volatile during New York session" are expressible.
        label: "newyork-boost",
        market: testMarketContext({
            EURUSD: {
                symbol: "EURUSD",
                volatility: { atr: 48, atrPercent: 1.8, rangeExpansion: 80, state: "expanding" },
                regime: { regime: "trending", confidence: 0.85 },
                session: { current: "newyork" },
                quote: { changePercent: 0.9, spread: 0.4 },
                structure: [{}, {}, {}],
                liquidity: [{}],
                multiTimeframe: [{ bias: "bearish" }],
            },
        }),
        risk: { drawdownPercent: 4, exposure: 0.5, positionCount: 5, correlatedExposure: 3 },
        news: { incomingEvents: 3, recentImpact: 2 },
    },
];

type SandboxTestResult = { ok: boolean; runs: number; errors: string[] };

function runSandboxTests(spec: AIGeneratedPluginSpec): SandboxTestResult {
    const condition = spec.manifest.runtime.condition;
    if (!condition) {
        return { ok: false, runs: 0, errors: ["No condition provided to evaluate."] };
    }
    const errors: string[] = [];
    let runs = 0;
    let matchedAny = false;
    for (const ctx of TEST_CONTEXTS) {
        try {
            const { matched, reasons } = evaluateConditionTree(condition, { market: ctx.market, risk: ctx.risk, news: ctx.news });
            runs += 1;
            if (matched) matchedAny = true;
            if (matched && reasons.length === 0) {
                errors.push(`${ctx.label}: condition matched with no reason — likely a broken operator.`);
            }
        } catch (err) {
            errors.push(`${ctx.label}: threw ${err instanceof Error ? err.message : String(err)}`);
        }
    }
    if (!matchedAny) {
        errors.push("condition never matches across synthetic market contexts — the generated plugin would never fire. Adjust the condition to a resolvable source/operator.");
    }
    return { ok: errors.length === 0, runs, errors };
}

export async function generatePluginDraft(input: {
    prompt: string;
    target: PluginKind;
    category: PluginCategory;
    createdBy: string;
    extensionType?: PluginExtensionType;
}): Promise<{ ok: boolean; draft?: PluginDraft; jobId: string; messages: string[]; error?: string }> {
    const now = Date.now();
    const jobId = `job_${now.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    const jobBase = { id: jobId, prompt: input.prompt, target: input.target, category: input.category, createdBy: input.createdBy, createdAt: now, finishedAt: null as number | null };

    await saveGenerationJob({ ...jobBase, status: "generating", error: "" });

    let specResult: GenerateSpecResult;
    try {
        specResult = await generatePluginSpec(input.prompt, input.target, input.category, input.extensionType);
    } catch (err) {
        const message = err instanceof Error ? err.message : "Generation failed.";
        await saveGenerationJob({ ...jobBase, status: "failed", error: message, finishedAt: Date.now() });
        return { ok: false, jobId, messages: [message], error: message };
    }

    if (!specResult.ok) {
        await saveGenerationJob({ ...jobBase, status: "failed", error: specResult.errors.join("; "), finishedAt: Date.now() });
        return { ok: false, jobId, messages: specResult.errors, error: specResult.errors.join("; ") };
    }

    const spec = specResult.spec;
    const result = validateGeneratedSpec(spec);
    const draftId = `draft_${spec.name || "plugin"}_${now.toString(36)}`;

    const draft: PluginDraft = {
        id: draftId,
        name: spec.name,
        displayName: spec.displayName,
        description: spec.description,
        target: spec.target,
        ...(spec.extensionType ? { extensionType: spec.extensionType } : {}),
        category: spec.category,
        pricing: spec.pricing,
        permissions: spec.permissions,
        spec,
        validation: result.validation,
        validationMessages: result.messages,
        status: result.valid ? "passed" : "rejected",
        createdBy: input.createdBy,
        createdAt: now,
        updatedAt: now,
    };
    await saveDraft(draft as unknown as { id: string; [key: string]: unknown });
    await saveGenerationJob({ ...jobBase, status: "done", draftId, error: "", finishedAt: Date.now() });

    return { ok: true, draft, jobId, messages: result.messages };
}

export function isSupportedConditionSource(source: string): boolean {
    return isValidConditionSource(source);
}

export function isSupportedConditionOperator(operator: string): boolean {
    return isValidConditionOperator(operator);
}

// Re-export helpers used by the admin UI to describe what a generated plugin may touch.
export type { ConditionSource, ConditionOperator, PermissionSet };