/**
 * Workflow Node Registry — the single source of truth for every node type a
 * Workflow Automation graph can contain. Every node declares:
 *
 *   - category (15 top-level categories)
 *   - permission class ("none" | "analysis" | "signal" | "execution") that is
 *     enforced server-side at save + run time
 *   - config schema (drives the editor form and server validation)
 *   - timeouts, rate limits, and whether it requires a prior risk node
 *
 * Validation (`validate.ts`) signs off every workflow against this registry.
 * Unknown node types are rejected — nothing executes outside the registry.
 */

import { NodeCategory, WorkflowNodeDefinition, WorkflowPermissionLevel } from "./types";

export const NODE_CATEGORY_LABELS: Record<NodeCategory, string> = {
    trigger: "Triggers",
    market_data: "Market Data",
    technical: "Technical Analysis",
    ai: "AI",
    logic: "Logic",
    risk: "Risk",
    signal: "Signals",
    execution: "Trading / Execution",
    notification: "Notifications",
    integration: "AlgoVault Integrations",
    storage: "Data / Storage",
    http: "HTTP / API",
    transform: "Data Transform",
    simulation: "Backtesting / Simulation",
    reports: "Reports / Analytics",
    marketing: "Marketing / Creative",
};

export const NODE_CATEGORY_ORDER: NodeCategory[] = [
    "trigger",
    "market_data",
    "technical",
    "ai",
    "logic",
    "risk",
    "signal",
    "execution",
    "notification",
    "integration",
    "storage",
    "http",
    "transform",
    "simulation",
    "reports",
    "marketing",
];

export const CATEGORY_PERMISSION: Record<NodeCategory, WorkflowPermissionLevel | "none"> = {
    trigger: "none",
    market_data: "analysis",
    technical: "analysis",
    ai: "analysis",
    logic: "none",
    risk: "analysis",
    signal: "signal",
    execution: "execution",
    notification: "analysis",
    integration: "analysis",
    storage: "analysis",
    http: "analysis",
    transform: "none",
    simulation: "analysis",
    reports: "analysis",
    marketing: "analysis",
};

const NODES: WorkflowNodeDefinition[] = [
    // ─── Triggers ──────────────────────────────────────────────────────────
    {
        type: "trigger.manual",
        category: "trigger",
        name: "Manual Trigger",
        description: "Runs the workflow on demand from the dashboard or API.",
        permission: "none",
        configSchema: [{ key: "label", label: "Label", type: "string" }],
        defaults: { label: "Start" },
    },
    {
        type: "trigger.schedule",
        category: "trigger",
        name: "Schedule Trigger",
        description: "Runs the workflow on a cron schedule (UTC). Survives restarts via the scheduler tick.",
        permission: "none",
        configSchema: [{ key: "cron", label: "Cron expression (5 fields, UTC)", type: "string", required: true, placeholder: "*/5 * * * *" }],
        defaults: { cron: "*/5 * * * *" },
    },
    {
        type: "trigger.webhook",
        category: "trigger",
        name: "Webhook Trigger",
        description: "Runs the workflow from an external HTTP POST. Security: webhook secret required.",
        permission: "none",
        configSchema: [
            { key: "method", label: "Method", type: "select", options: [{ value: "POST", label: "POST" }], default: "POST" },
            { key: "secret", label: "Webhook secret (required)", type: "secret", required: true, help: "Sent as X-AlgoVault-Webhook-Secret. Stored hashed." },
        ],
        defaults: { method: "POST" },
    },
    // ─── Market data ───────────────────────────────────────────────────────
    {
        type: "market_data.quote",
        category: "market_data",
        name: "Market Quote",
        description: "Fetches a live quote (bid/ask/spread). Fetch-once per run — repeated nodes reuse the snapshot.",
        permission: "analysis",
        configSchema: [{ key: "symbol", label: "Symbol", type: "string", required: true, placeholder: "XAUUSD" }],
        defaults: { symbol: "XAUUSD" },
        timeoutMs: 15_000,
        rateLimitPerMinute: 60,
    },
    {
        type: "market_data.candles",
        category: "market_data",
        name: "Market Candles",
        description: "Fetches OHLC candles for a symbol + timeframe. Shared by TA and simulation nodes.",
        permission: "analysis",
        configSchema: [
            { key: "symbol", label: "Symbol", type: "string", required: true, placeholder: "XAUUSD" },
            { key: "timeframe", label: "Timeframe", type: "select", required: true, options: [
                { value: "M1", label: "1 min" }, { value: "M5", label: "5 min" }, { value: "M15", label: "15 min" },
                { value: "M30", label: "30 min" }, { value: "H1", label: "1 hour" }, { value: "H4", label: "4 hours" }, { value: "D1", label: "Daily" },
            ], default: "M5" },
            { key: "limit", label: "Candles", type: "number", default: 100 },
        ],
        defaults: { symbol: "XAUUSD", timeframe: "M5", limit: 100 },
        timeoutMs: 20_000,
        rateLimitPerMinute: 60,
    },
    {
        type: "market_data.snapshot",
        category: "market_data",
        name: "Market Snapshot",
        description: "Fetches quote + daily candles + market state in one snapshot for a symbol.",
        permission: "analysis",
        configSchema: [{ key: "symbol", label: "Symbol", type: "string", required: true, placeholder: "XAUUSD" }],
        defaults: { symbol: "XAUUSD" },
        timeoutMs: 20_000,
        rateLimitPerMinute: 60,
    },
    {
        type: "market_data.symbol_info",
        category: "market_data",
        name: "Symbol Info",
        description: "Returns symbol metadata: asset category, pip size, contract size, min/max lots, tick value.",
        permission: "analysis",
        configSchema: [{ key: "symbol", label: "Symbol", type: "string", required: true, placeholder: "XAUUSD" }],
        defaults: { symbol: "XAUUSD" },
        timeoutMs: 1_000,
    },
    // ─── Technical analysis ────────────────────────────────────────────────
    constTA("technical.sma", "SMA", "Simple moving average over close prices."),
    constTA("technical.ema", "EMA", "Exponential moving average over close prices."),
    constTA("technical.rsi", "RSI", "Relative Strength Index (14)."),
    constTA("technical.macd", "MACD", "MACD line, signal line and histogram."),
    constTA("technical.atr", "ATR", "Average True Range (14)."),
    constTA("technical.bollinger", "Bollinger Bands", "Middle, upper and lower bands (20, 2σ)."),
    constTA("technical.stoch", "Stochastic %K", "Stochastic oscillator — %K with 3-period %D signal line."),
    constTA("technical.obv", "On-Balance Volume", "Cumulative volume flow; requires candles with volume data."),

    // ─── AI ────────────────────────────────────────────────────────────────
    {
        type: "ai.analyze",
        category: "ai",
        name: "AI Analysis",
        description: "Runs an AI analysis through the canonical AlgoVault AI Router. Model is validated; never auto-activates.",
        permission: "analysis",
        configSchema: [
            { key: "prompt", label: "Prompt ({{ template }} supported)", type: "template", required: true, help: "Reference upstream nodes with {{ $nodeId.field }}." },
            { key: "contextNode", label: "Attach upstream output to the prompt", type: "string", placeholder: "$nodeId" },
            { key: "maxTokens", label: "Max tokens", type: "number", default: 800 },
        ],
        defaults: { prompt: "Summarize the current market context for {{ symbol }}.", maxTokens: 800 },
        timeoutMs: 45_000,
        rateLimitPerMinute: 10,
    },
    {
        type: "ai.extract_json",
        category: "ai",
        name: "Extract JSON",
        description: "Asks the AI Router to return a strict JSON object from context. Fails honestly if the response is not valid JSON.",
        permission: "analysis",
        configSchema: [
            { key: "prompt", label: "Prompt ({{ template }} supported)", type: "template", required: true, help: "Describe the JSON you want, e.g. extract { bias, confidence, reasons[] }." },
            { key: "contextNode", label: "Attach upstream output to the prompt", type: "string", placeholder: "$nodeId" },
            { key: "maxTokens", label: "Max tokens", type: "number", default: 800 },
        ],
        defaults: { prompt: "Extract a trading bias JSON: { bias: \"long\"|\"short\"|\"neutral\", confidence: 0-100, reasons: [] }", maxTokens: 800 },
        timeoutMs: 45_000,
        rateLimitPerMinute: 10,
    },
    // ─── Logic ─────────────────────────────────────────────────────────────
    {
        type: "logic.condition",
        category: "logic",
        name: "Condition",
        description: "Evaluates a condition over upstream values. Outputs { matched, value }.",
        permission: "none",
        configSchema: [
            { key: "left", label: "Left value ({{ expr }})", type: "template", required: true },
            { key: "operator", label: "Operator", type: "select", required: true, options: [
                { value: "eq", label: "equals" }, { value: "neq", label: "not equals" },
                { value: "gt", label: ">" }, { value: "gte", label: "≥" },
                { value: "lt", label: "<" }, { value: "lte", label: "≤" },
                { value: "contains", label: "contains" }, { value: "startsWith", label: "starts with" },
            ], default: "gt" },
            { key: "right", label: "Right value", type: "template", required: true },
        ],
        defaults: { operator: "gt" },
        timeoutMs: 2_000,
    },
    {
        type: "logic.delay",
        category: "logic",
        name: "Delay",
        description: "Pauses the workflow for a fixed duration (ms).",
        permission: "none",
        configSchema: [{ key: "ms", label: "Delay (ms)", type: "number", required: true, default: 1000 }],
        defaults: { ms: 1000 },
        timeoutMs: 10_000,
    },
    {
        type: "logic.set_variable",
        category: "logic",
        name: "Set Variable",
        description: "Stores a computed value in the run variables for later {{ variables.x }} references.",
        permission: "none",
        configSchema: [
            { key: "name", label: "Variable name", type: "string", required: true },
            { key: "value", label: "Value ({{ expr }})", type: "template", required: true },
        ],
        timeoutMs: 1_000,
    },
    {
        type: "logic.math",
        category: "logic",
        name: "Math",
        description: "Applies an arithmetic operation to two values (add, sub, mul, div, pct, min, max, abs, round).",
        permission: "none",
        configSchema: [
            { key: "op", label: "Operation", type: "select", required: true, options: [
                { value: "add", label: "Add (+)" }, { value: "sub", label: "Subtract (−)" },
                { value: "mul", label: "Multiply (×)" }, { value: "div", label: "Divide (÷)" },
                { value: "pct", label: "Percent (a/100 × b)" }, { value: "min", label: "Minimum" },
                { value: "max", label: "Maximum" }, { value: "abs", label: "Absolute (a)" },
                { value: "round", label: "Round (a)" },
            ], default: "add" },
            { key: "a", label: "Value A ({{ expr }})", type: "template", required: true },
            { key: "b", label: "Value B ({{ expr }})", type: "template" },
            { key: "decimals", label: "Decimals (round)", type: "number", default: 2 },
        ],
        defaults: { op: "add", decimals: 2 },
        timeoutMs: 1_000,
    },
    {
        type: "logic.extract",
        category: "logic",
        name: "Extract Field",
        description: "Pulls a nested field out of an upstream output — e.g. bid from a quote, value from an RSI node.",
        permission: "none",
        configSchema: [
            { key: "source", label: "Source ($nodeId)", type: "template", required: true, placeholder: "$quote" },
            { key: "path", label: "Field path", type: "string", placeholder: "quote.bid" },
        ],
        timeoutMs: 1_000,
    },
    {
        type: "logic.merge",
        category: "logic",
        name: "Merge",
        description: "Combines several upstream outputs into one object under named keys — ideal for AI context or reports.",
        permission: "none",
        configSchema: [
            { key: "entries", label: "Entries (JSON: [{ key, ref }])", type: "json", required: true, help: "Each ref points at an upstream output, e.g. [{ \"key\": \"quote\", \"ref\": \"$quote\" }, { \"key\": \"rsi\", \"ref\": \"$rsi.value\" }]." },
        ],
        timeoutMs: 1_000,
    },
    {
        type: "logic.switch",
        category: "logic",
        name: "Switch",
        description: "Maps an input value to an output by case matching, with a fallback for unmatched values.",
        permission: "none",
        configSchema: [
            { key: "input", label: "Input ({{ expr }})", type: "template", required: true },
            { key: "cases", label: "Cases (JSON: [{ value, output }])", type: "json", help: "First matching case wins. Outputs may contain {{ }} refs.", default: [] },
            { key: "fallback", label: "Fallback", type: "template", default: "" },
        ],
        defaults: { cases: [], fallback: "" },
        timeoutMs: 1_000,
    },
    // ─── Risk ──────────────────────────────────────────────────────────────
    {
        type: "risk.check",
        category: "risk",
        name: "Risk Check",
        description: "Server-enforced. Validates an order intent against account exposure + risk limits. Blocking for signal/execution nodes.",
        permission: "analysis",
        configSchema: [
            { key: "riskPercent", label: "Risk per trade (%)", type: "number", default: 1 },
            { key: "maxExposurePercent", label: "Max account exposure (%)", type: "number", default: 20 },
            { key: "requireStopLoss", label: "Require stop loss", type: "boolean", default: true },
        ],
        defaults: { riskPercent: 1, maxExposurePercent: 20, requireStopLoss: true },
        timeoutMs: 5_000,
    },
    {
        type: "risk.position_size",
        category: "risk",
        name: "Position Size",
        description: "Server-enforced. Sizes a position from risk %, balance, entry and stop. Outputs recommended lots.",
        permission: "analysis",
        configSchema: [
            { key: "balance", label: "Account balance ({{ expr }})", type: "template", default: "{{ variables.balance }}" },
            { key: "symbol", label: "Symbol", type: "string", required: true, placeholder: "XAUUSD" },
            { key: "direction", label: "Direction", type: "select", options: [
                { value: "BUY", label: "Buy" }, { value: "SELL", label: "Sell" },
            ], required: true, default: "BUY" },
            { key: "entry", label: "Entry price ({{ expr }})", type: "template" },
            { key: "stopLoss", label: "Stop loss ({{ expr }})", type: "template" },
            { key: "riskPercent", label: "Risk %", type: "number", default: 1 },
        ],
        defaults: { riskPercent: 1, direction: "BUY", symbol: "XAUUSD" },
        timeoutMs: 5_000,
    },
    // ─── Signals ───────────────────────────────────────────────────────────
    {
        type: "signal.create",
        category: "signal",
        name: "Create Signal",
        description: "Creates a validated signal artifact (price-sanity checked). Requires a prior risk node.",
        permission: "signal",
        riskGuardRequired: true,
        noExecInTest: true,
        configSchema: [
            { key: "symbol", label: "Symbol", type: "string", required: true },
            { key: "direction", label: "Direction", type: "select", options: [
                { value: "BUY", label: "Buy" }, { value: "SELL", label: "Sell" },
            ], required: true, default: "BUY" },
            { key: "entry", label: "Entry ({{ expr }})", type: "template", required: true },
            { key: "stopLoss", label: "Stop loss ({{ expr }})", type: "template", required: true },
            { key: "takeProfit", label: "Take profit ({{ expr }})", type: "template" },
            { key: "setup", label: "Setup name", type: "string", default: "workflow" },
        ],
        timeoutMs: 15_000,
    },
    // ─── Execution ─────────────────────────────────────────────────────────
    {
        type: "execution.place_order",
        category: "execution",
        name: "Place Order Request",
        description: "Submits an order request through the AlgoVault gateway. Requires execution permission + prior risk node.",
        permission: "execution",
        riskGuardRequired: true,
        noExecInTest: true,
        configSchema: [
            { key: "symbol", label: "Symbol", type: "string", required: true },
            { key: "direction", label: "Direction", type: "select", options: [
                { value: "BUY", label: "Buy" }, { value: "SELL", label: "Sell" },
            ], required: true, default: "BUY" },
            { key: "lots", label: "Volume (lots, {{ expr }})", type: "template", required: true },
            { key: "entry", label: "Entry ({{ expr }})", type: "template" },
            { key: "stopLoss", label: "Stop loss ({{ expr }})", type: "template" },
            { key: "takeProfit", label: "Take profit ({{ expr }})", type: "template" },
            { key: "accountId", label: "Gateway account id", type: "string" },
        ],
        timeoutMs: 15_000,
    },
    // ─── Notifications ─────────────────────────────────────────────────────
    {
        type: "notification.send",
        category: "notification",
        name: "Notification",
        description: "Delivers a message through the user's configured channels (in-app, telegram, discord, email).",
        permission: "analysis",
        configSchema: [
            { key: "title", label: "Title", type: "template", required: true },
            { key: "message", label: "Message", type: "template", required: true },
            { key: "level", label: "Level", type: "select", options: [
                { value: "info", label: "Info" }, { value: "success", label: "Success" },
                { value: "warning", label: "Warning" }, { value: "error", label: "Error" },
            ], default: "info" },
            { key: "channels", label: "Channels", type: "multiselect", options: [
                { value: "telegram", label: "Telegram" }, { value: "discord", label: "Discord" }, { value: "email", label: "Email" },
            ], default: ["telegram"] },
        ],
        defaults: { level: "info", channels: ["telegram"] },
        timeoutMs: 30_000,
        rateLimitPerMinute: 20,
    },
    // ─── Integrations ──────────────────────────────────────────────────────
    {
        type: "integration.scan_symbol",
        category: "integration",
        name: "Scan Symbol",
        description: "Runs a market scan for a symbol: quote, daily change, market state.",
        permission: "analysis",
        configSchema: [{ key: "symbol", label: "Symbol", type: "string", required: true, placeholder: "XAUUSD" }],
        defaults: { symbol: "XAUUSD" },
        timeoutMs: 15_000,
        rateLimitPerMinute: 60,
    },
    {
        type: "integration.calendar",
        category: "integration",
        name: "Economic Calendar",
        description: "Fetches the upcoming economic calendar from the AlgoVault feed.",
        permission: "analysis",
        configSchema: [{ key: "limit", label: "Max events", type: "number", default: 25 }],
        defaults: { limit: 25 },
        timeoutMs: 20_000,
        rateLimitPerMinute: 6,
    },
    // ─── Storage ───────────────────────────────────────────────────────────
    {
        type: "storage.rtdb_read",
        category: "storage",
        name: "RTDB Read (whitelist)",
        description: "Reads user-scoped RTDB data. Only whitelisted paths are allowed — no arbitrary reads.",
        permission: "analysis",
        configSchema: [{
            key: "path", label: "Path (whitelisted)", type: "select", required: true, options: [
                { value: "users/{uid}/subscription", label: "Subscription status" },
                { value: "users/{uid}/notificationSettings", label: "Notification settings" },
                { value: "users/{uid}/followedProSignals", label: "Followed Pro signals" },
                { value: "workflowAutomationSignals/{uid}", label: "Workflow-created signals" },
            ],
        }],
        timeoutMs: 10_000,
        rateLimitPerMinute: 30,
    },
    {
        type: "storage.rtdb_write",
        category: "storage",
        name: "RTDB Write (whitelist)",
        description: "Writes user-scoped data. Only whitelisted paths are allowed — no arbitrary writes.",
        permission: "analysis",
        configSchema: [{
            key: "path", label: "Path (whitelisted)", type: "select", required: true, options: [
                { value: "workflowAutomationVariables/{uid}", label: "Workflow variables" },
            ],
        }, { key: "data", label: "Data (JSON or {{ template }})", type: "json", required: true }],
        timeoutMs: 10_000,
        rateLimitPerMinute: 30,
    },
    // ─── HTTP ──────────────────────────────────────────────────────────────
    {
        type: "http.request",
        category: "http",
        name: "HTTP Request",
        description: "Performs an outbound request. SSRF-protected: private/loopback/link-local hosts are always blocked.",
        permission: "analysis",
        configSchema: [
            { key: "url", label: "URL", type: "string", required: true, placeholder: "https://api.example.com/v1/data" },
            { key: "method", label: "Method", type: "select", options: [
                { value: "GET", label: "GET" }, { value: "POST", label: "POST" },
                { value: "PUT", label: "PUT" }, { value: "PATCH", label: "PATCH" }, { value: "DELETE", label: "DELETE" },
            ], default: "GET" },
            { key: "headers", label: "Headers (JSON)", type: "json", help: "Secret values in {{ variables }} are supported; never hardcode credentials." },
            { key: "body", label: "Body", type: "json" },
            { key: "timeoutMs", label: "Timeout (ms)", type: "number", default: 10000 },
        ],
        defaults: { method: "GET", timeoutMs: 10000 },
        timeoutMs: 30_000,
        rateLimitPerMinute: 30,
    },
    // ─── Transform ─────────────────────────────────────────────────────────
    {
        type: "transform.template",
        category: "transform",
        name: "Template",
        description: "Renders a text/JSON template with {{ $nodeId.field }} and {{ variables.x }} references.",
        permission: "none",
        configSchema: [{ key: "template", label: "Template", type: "template", required: true }],
        timeoutMs: 2_000,
    },
    {
        type: "transform.json",
        category: "transform",
        name: "JSON Shape",
        description: "Builds a new JSON object from upstream values using a template object.",
        permission: "none",
        configSchema: [{ key: "shape", label: "Shape (template object)", type: "json", required: true, help: "Values may contain {{ $nodeId.field }} references." }],
        timeoutMs: 2_000,
    },
    // ─── Simulation ────────────────────────────────────────────────────────
    {
        type: "simulation.backtest",
        category: "simulation",
        name: "Moving Average Backtest",
        description: "Runs a deterministic SMA-cross backtest over real fetched candles. Fast-SMA < Slow-SMA → long, else short.",
        permission: "analysis",
        configSchema: [
            { key: "symbol", label: "Symbol", type: "string", required: true, placeholder: "XAUUSD" },
            { key: "timeframe", label: "Timeframe", type: "select", options: [
                { value: "M5", label: "5 min" }, { value: "M15", label: "15 min" }, { value: "H1", label: "1 hour" }, { value: "H4", label: "4 hours" }, { value: "D1", label: "Daily" },
            ], default: "M5" },
            { key: "limit", label: "Candles", type: "number", default: 500 },
            { key: "fast", label: "Fast SMA", type: "number", default: 5 },
            { key: "slow", label: "Slow SMA", type: "number", default: 20 },
            { key: "initialBalance", label: "Initial balance", type: "number", default: 10000 },
        ],
        defaults: { symbol: "XAUUSD", timeframe: "M5", limit: 500, fast: 5, slow: 20, initialBalance: 10000 },
        timeoutMs: 30_000,
        rateLimitPerMinute: 10,
    },
    // ─── Marketing ───────────────────────────────────────────────────────
    { type: "marketing.creative", category: "marketing", name: "Creative", description: "Generate a marketing creative (concept → pipeline).", permission: "analysis", configSchema: [{ key: "templateId", label: "Template", type: "select", options: [{ value: "HOOK_EDU", label: "Hook + Edu" }, { value: "FEATURE_SPOTLIGHT", label: "Feature Spotlight" }, { value: "HOW_IT_WORKS", label: "How It Works" }, { value: "USE_CASE", label: "Use Case" }, { value: "MYTH_VS_FACT", label: "Myth vs Fact" }, { value: "COMPARISON", label: "Comparison" }, { value: "LIFECYCLE", label: "Lifecycle" }, { value: "MARKET_CONTEXT", label: "Market Context" }, { value: "RISK_FIRST", label: "Risk First" }, { value: "CTA_DRIVE", label: "CTA Drive" }], default: "HOOK_EDU" }], defaults: { templateId: "HOOK_EDU" }, timeoutMs: 180000 },
    { type: "marketing.variants", category: "marketing", name: "Variants", description: "Generate cost-controlled per-stage variants.", permission: "analysis", configSchema: [{ key: "count", label: "Variant count", type: "number", default: 3 }, { key: "kind", label: "Variant kind", type: "select", options: [{ value: "hook", label: "Hook" }, { value: "cta", label: "CTA" }, { value: "copy", label: "Copy" }], default: "hook" }], defaults: { count: 3, kind: "hook" }, timeoutMs: 30000 },
    { type: "marketing.compliance", category: "marketing", name: "Compliance", description: "Authoritative compliance review (blocks distribution on high severity).", permission: "analysis", configSchema: [{ key: "demoContent", label: "Demo content", type: "boolean", default: true }], defaults: { demoContent: true }, timeoutMs: 10000 },
    { type: "marketing.compose", category: "marketing", name: "Compose", description: "Assemble video via FFmpeg (Ken Burns + overlay + concat). Reports NOT_AVAILABLE when FFmpeg missing.", permission: "analysis", configSchema: [{ key: "preset", label: "Preset", type: "string", default: "tiktok" }], defaults: { preset: "tiktok" }, timeoutMs: 120000 },
    { type: "marketing.thumbnail", category: "marketing", name: "Thumbnail", description: "Extract thumbnail from composed video.", permission: "analysis", configSchema: [], defaults: {}, timeoutMs: 30000 },
    { type: "marketing.publish", category: "marketing", name: "Publish", description: "Publish approved content through configured channel adapters (gated by APPROVED state).", permission: "analysis", configSchema: [{ key: "channels", label: "Channels", type: "multiselect", options: [{ value: "BLOG", label: "Blog" }, { value: "EMAIL", label: "Email" }, { value: "DISCORD", label: "Discord" }], default: ["BLOG"] }], defaults: { channels: ["BLOG"] }, timeoutMs: 30000 },
    // ─── Reports ───────────────────────────────────────────────────────────
    {
        type: "reports.build_report",
        category: "reports",
        name: "Build Report",
        description: "Builds a structured report from upstream node outputs. Never fabricates metrics.",
        permission: "analysis",
        configSchema: [
            { key: "title", label: "Title", type: "string", required: true },
            { key: "sections", label: "Sections (JSON array: [{ title, ref }])", type: "json", help: "Each ref points at an upstream output, e.g. $rsi or $backtest." },
        ],
        timeoutMs: 5_000,
    },
];

/**
 * Shared TA module factory — all six TA nodes follow the same contract:
 * consume candles from an upstream `market_data.candles` node (or fetch their
 * own when `symbol` is set) and output numeric value(s).
 */
function constTA(type: string, name: string, description: string): WorkflowNodeDefinition {
    return {
        type,
        category: "technical",
        name,
        description: `${description} Consumes candles from an upstream market_data.candles node or fetches its own.`,
        permission: "analysis",
        configSchema: [
            { key: "source", label: "Candles node (optional $nodeId)", type: "string", placeholder: "$candles" },
            { key: "symbol", label: "Symbol (when fetching own candles)", type: "string", placeholder: "XAUUSD" },
            { key: "timeframe", label: "Timeframe", type: "select", options: [
                { value: "M5", label: "5 min" }, { value: "M15", label: "15 min" }, { value: "H1", label: "1 hour" }, { value: "H4", label: "4 hours" }, { value: "D1", label: "Daily" },
            ], default: "M5" },
            { key: "period", label: "Period", type: "number", default: 14 },
        ],
        defaults: { timeframe: "M5", period: 14 },
        timeoutMs: 20_000,
        rateLimitPerMinute: 60,
    };
}

export const NODE_REGISTRY: Record<string, WorkflowNodeDefinition> = Object.fromEntries(
    NODES.map((n) => [n.type, n])
);

export function getNodeDefinition(type: string): WorkflowNodeDefinition | undefined {
    return NODE_REGISTRY[type];
}

export function getAllNodes(): WorkflowNodeDefinition[] {
    return [...NODES];
}

export function getNodesByCategory(category: NodeCategory): WorkflowNodeDefinition[] {
    return NODES.filter((n) => n.category === category);
}

export function categoryOf(nodeType: string): NodeCategory | null {
    return NODE_REGISTRY[nodeType]?.category ?? null;
}

/** Aggregates the distinct permission classes required by a node set. */
export function requiredPermissionsForNodes(nodes: { type: string; enabled?: boolean }[]): WorkflowPermissionLevel[] {
    const levels = new Set<WorkflowPermissionLevel>();
    for (const node of nodes) {
        if (node.enabled === false) continue;
        const def = NODE_REGISTRY[node.type];
        if (def && def.permission !== "none") levels.add(def.permission);
    }
    return [...levels];
}

/** True when the workflow contains at least one node that needs a risk guard. */
export function needsRiskGuard(nodes: { type: string; enabled?: boolean }[]): boolean {
    return nodes.some((n) => {
        if (n.enabled === false) return false;
        return NODE_REGISTRY[n.type]?.riskGuardRequired === true;
    });
}

export function isTriggerNodeType(type: string): boolean {
    return type.startsWith("trigger.");
}

export function isMarketDataNodeType(type: string): boolean {
    return type.startsWith("market_data.");
}

/** Node types that are never permitted to run in test mode. */
export function isNoExecInTest(type: string): boolean {
    return NODE_REGISTRY[type]?.noExecInTest === true;
}

// ─── Permission-class helpers (shared with validation + engine) ─────────────

/** Permission class declared by a node type: "none" | "analysis" | "signal" | "execution". */
export function nodePermissionClass(type: string): "analysis" | "signal" | "execution" | "none" {
    return NODE_REGISTRY[type]?.permission ?? "none";
}

export function isRiskNodeType(type: string): boolean {
    return NODE_REGISTRY[type]?.category === "risk";
}

export function isSignalNodeType(type: string): boolean {
    return NODE_REGISTRY[type]?.permission === "signal";
}

export function isExecutionNodeType(type: string): boolean {
    return NODE_REGISTRY[type]?.permission === "execution";
}

/** True when a node belongs to the given category. */
export function isCategory(type: string, category: NodeCategory): boolean {
    return NODE_REGISTRY[type]?.category === category;
}

/**
 * Minimal set of registry node types that satisfy a requested permission
 * class — used by the AI builder to constrain generation, and by the engine
 * to double-check that a workflow claiming a permission actually contains a
 * node that needs it.
 */
export function neededNodesForPermission(level: "analysis" | "signal" | "execution"): string[] {
    if (level === "execution") return ["execution.place_order"];
    if (level === "signal") return ["signal.create"];
    return ["market_data.quote", "market_data.candles", "ai.analyze"];
}
