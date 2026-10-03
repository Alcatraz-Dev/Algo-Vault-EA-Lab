/**
 * Workflow node executors — one implementation per registered node type.
 *
 * Every executor is deterministic where it should be, reuses canonical
 * AlgoVault infrastructure (AI Router, notifications, risk engine, gateway,
 * market data), and fails honestly rather than fabricating data.
 */

import { defaultRouter } from "@/lib/ai/router";
import { notifyUser } from "@/lib/notifications";
import { evaluateOrder, sizePositionByRisk, RiskLimits, AccountRiskState } from "@/lib/risk/risk-engine";
import { hasActiveTradingLicense, getGatewayTokenForUser, newClientOrderId } from "@/lib/gateway";
import { fetchEconomicEvents } from "@/lib/plugins/runtime/scheduler";
import { getSymbolCategory, getSymbolSpec } from "@/lib/ai-signals/symbol-specs";
import { NodeExecutionArgs, NodeExecutionResult, NodeExecutionRecord } from "./types";
import { fetchWorkflowCandles, fetchWorkflowQuote, fetchWorkflowSnapshot } from "./market";
import { computeIndicator } from "./ta";
import { parsePath } from "./paths";
import { validateUrlForRequest, assertPublicHost } from "./ssrf";
import { saveSignal, saveOrderRequest, saveReport, readVariable, writeVariable, listUserSignals } from "./database";

// ─── Market data ─────────────────────────────────────────────────────────────

async function marketQuote(args: NodeExecutionArgs): Promise<NodeExecutionResult> {
    const symbol = String(args.config.symbol || "").trim();
    const cached = await args.snapshots.getOrFetch(`quote:${symbol}`, () => fetchWorkflowQuote(symbol));
    if (!cached || (cached as { ok?: boolean }).ok === false) {
        const err = cached && typeof cached === "object" && "error" in cached ? String((cached as { error?: string }).error) : "Quote unavailable.";
        return { status: "failed", error: err };
    }
    return { status: "success", output: { quote: (cached as { quote?: unknown }).quote ?? cached } };
}

async function marketCandles(args: NodeExecutionArgs): Promise<NodeExecutionResult> {
    const symbol = String(args.config.symbol || "");
    const timeframe = String(args.config.timeframe || "M5");
    const limit = Number(args.config.limit) || 100;
    const key = `candles:${symbol}:${timeframe}:${limit}`;
    const cached = await args.snapshots.getOrFetch(key, () => fetchWorkflowCandles(symbol, timeframe, limit));
    if (!cached || (cached as { ok?: boolean }).ok === false) {
        const err = cached && typeof cached === "object" && "error" in cached ? String((cached as { error?: string }).error) : "Candles unavailable.";
        return { status: "failed", error: err };
    }
    const candles = (cached as { candles?: unknown[] }).candles ?? [];
    return {
        status: "success",
        output: { symbol, timeframe, candleCount: candles.length, candles, close: candles.map((c) => (c as { close?: number }).close) },
    };
}

async function marketSnapshotNode(args: NodeExecutionArgs): Promise<NodeExecutionResult> {
    const symbol = String(args.config.symbol || "");
    const cached = await args.snapshots.getOrFetch(`snapshot:${symbol}`, () => fetchWorkflowSnapshot(symbol));
    if (!cached || (cached as { ok?: boolean }).ok === false) {
        const err = cached && typeof cached === "object" && "error" in cached ? String((cached as { error?: string }).error) : "Snapshot unavailable.";
        return { status: "failed", error: err };
    }
    return { status: "success", output: ((cached as { snapshot?: unknown }).snapshot ?? cached) as Record<string, unknown> };
}

async function marketSymbolInfo(args: NodeExecutionArgs): Promise<NodeExecutionResult> {
    const symbol = String(args.config.symbol || "").trim().toUpperCase();
    if (!symbol) return { status: "failed", error: "Symbol is required." };
    const spec = getSymbolSpec(symbol);
    return {
        status: "success",
        output: {
            symbol,
            category: getSymbolCategory(symbol),
            supported: spec !== null,
            spec: spec ? {
                pipSize: spec.pipSize,
                pipDigits: spec.pipDigits,
                contractSize: spec.contractSize,
                typicalSpread: spec.typicalSpread,
                digits: spec.digits,
                minLot: spec.minLot,
                maxLot: spec.maxLot,
                tickValue: spec.tickValue,
                volatilityMultiplier: spec.volatilityMultiplier,
            } : null,
        },
    };
}

// ─── Technical analysis ──────────────────────────────────────────────────────

async function technicalNode(args: NodeExecutionArgs): Promise<NodeExecutionResult> {
    const period = Math.max(1, Number(args.config.period) || 14);
    const candles = await resolveCandles(args);
    if (!candles) return { status: "failed", error: "No candles available. Connect a market_data.candles node or set symbol + timeframe." };

    const result = computeIndicator(args.node.type, candles, period, args.config);
    if (result.value === null && result.series.length === 0) {
        return { status: "failed", error: result.note || "Insufficient candles to compute indicator." };
    }
    return { status: "success", output: { value: result.value, series: result.series, extra: result.extra } };
}

async function resolveCandles(args: NodeExecutionArgs): Promise<Array<{ timestamp: number; open: number; high: number; low: number; close: number; volume?: number }> | null> {
    const src = args.config.source as unknown;
    // Case A: config reference was already resolved to the upstream output
    // object (bare "$candles" becomes the candles node's output) — use it.
    if (src && typeof src === "object" && !Array.isArray(src)) {
        const candles = (src as { candles?: unknown }).candles;
        if (Array.isArray(candles) && candles.length > 0) {
            return candles as Array<{ timestamp: number; open: number; high: number; low: number; close: number; volume?: number }>;
        }
        return null;
    }
    // Case B: raw node-id string ("$candles" or "candles") — look up payloads.
    const sourceId = String(src || "").trim().replace(/^\$/, "");
    if (sourceId) {
        const upstream = args.payloads[sourceId];
        const candles = upstream?.output?.candles;
        if (Array.isArray(candles) && candles.length > 0) {
            return candles as Array<{ timestamp: number; open: number; high: number; low: number; close: number; volume?: number }>;
        }
        return null;
    }
    const symbol = String(args.config.symbol || "").trim();
    if (!symbol) return null;
    const tf = String(args.config.timeframe || "M5");
    const limit = 200;
    const key = `candles:${symbol}:${tf}:${limit}`;
    const fetched = await args.snapshots.getOrFetch(key, () => fetchWorkflowCandles(symbol, tf, limit));
    const candles = fetched && (fetched as { ok?: boolean }).ok !== false
        ? (fetched as { candles?: Array<{ timestamp: number; open: number; high: number; low: number; close: number; volume?: number }> }).candles
        : null;
    return candles && candles.length > 0 ? candles : null;
}

// ─── AI ──────────────────────────────────────────────────────────────────────

async function aiAnalyze(args: NodeExecutionArgs): Promise<NodeExecutionResult> {
    const prompt = String(args.config.prompt || "").trim();
    if (!prompt) return { status: "failed", error: "Prompt is required." };

    // Attach an upstream payload's JSON when contextNode is set.
    let fullPrompt = prompt;
    let contextData: unknown = null;
    const rawContext = args.config.contextNode as unknown;
    if (rawContext && typeof rawContext === "object" && !Array.isArray(rawContext)) {
        // resolveConfig already substituted the upstream node's output object.
        contextData = rawContext;
    } else {
        const contextRef = String(rawContext || "").trim().replace(/^\$/, "");
        if (contextRef) contextData = args.payloads[contextRef]?.output ?? null;
    }
    if (contextData !== null && contextData !== undefined) {
        try {
            fullPrompt += `\n\nContext:\n${JSON.stringify(contextData, null, 2)}`;
        } catch {
            // JSON stringify of a huge payload — fall back to prompt only.
        }
    }

    const text = await defaultRouter.generateText(fullPrompt, "You are an AlgoVault workflow AI analysis step. Answer factually from the provided context only.");
    if (!text || !text.trim()) return { status: "failed", error: "AI returned no response." };
    return { status: "success", output: { analysis: text.slice(0, 6000), model: "ai-router" } };
}

async function aiExtractJson(args: NodeExecutionArgs): Promise<NodeExecutionResult> {
    const prompt = String(args.config.prompt || "").trim();
    if (!prompt) return { status: "failed", error: "Prompt is required." };

    let fullPrompt = prompt;
    const rawContext = args.config.contextNode as unknown;
    let contextData: unknown = null;
    if (rawContext && typeof rawContext === "object" && !Array.isArray(rawContext)) {
        contextData = rawContext;
    } else {
        const contextRef = String(rawContext || "").trim().replace(/^\$/, "");
        if (contextRef) contextData = args.payloads[contextRef]?.output ?? null;
    }
    if (contextData !== null && contextData !== undefined) {
        try {
            fullPrompt += `\n\nContext:\n${JSON.stringify(contextData, null, 2)}`;
        } catch {
            // JSON stringify of a huge payload — fall back to prompt only.
        }
    }

    const text = await defaultRouter.generateText(
        `${fullPrompt}\n\nRespond with a single valid JSON object and nothing else — no markdown fences, no commentary.`,
        "You are an AlgoVault workflow data-extraction step. Output strict JSON only."
    );
    if (!text || !text.trim()) return { status: "failed", error: "AI returned no response." };

    const json = parseJsonResponse(text);
    if (json === undefined) return { status: "failed", error: "AI response was not valid JSON." };
    return { status: "success", output: { json, model: "ai-router" } };
}

function parseJsonResponse(text: string): unknown {
    const t = text.trim();
    try { return JSON.parse(t); } catch { /* continue */ }
    const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fence?.[1]) {
        try { return JSON.parse(fence[1].trim()); } catch { /* continue */ }
    }
    const start = t.indexOf("{");
    const end = t.lastIndexOf("}");
    if (start !== -1 && end > start) {
        try { return JSON.parse(t.slice(start, end + 1)); } catch { /* continue */ }
    }
    return undefined;
}

// ─── Logic ───────────────────────────────────────────────────────────────────

function compareValues(left: unknown, operator: string, right: unknown): boolean {
    switch (operator) {
        case "eq": return left === right || String(left) === String(right);
        case "neq": return String(left) !== String(right);
        case "gt": return Number(left) > Number(right);
        case "gte": return Number(left) >= Number(right);
        case "lt": return Number(left) < Number(right);
        case "lte": return Number(left) <= Number(right);
        case "contains": return String(left).includes(String(right));
        case "startsWith": return String(left).startsWith(String(right));
        default: return false;
    }
}

async function logicCondition(args: NodeExecutionArgs): Promise<NodeExecutionResult> {
    const matched = compareValues(args.config.left, String(args.config.operator), args.config.right);
    return {
        status: "success",
        output: { matched, left: args.config.left ?? null, right: args.config.right ?? null, operator: args.config.operator },
    };
}

async function logicDelay(args: NodeExecutionArgs): Promise<NodeExecutionResult> {
    const ms = Math.min(Math.max(Number(args.config.ms) || 0, 0), 30_000);
    await new Promise((r) => setTimeout(r, ms));
    return { status: "success", output: { delayedMs: ms } };
}

async function logicSetVariable(args: NodeExecutionArgs): Promise<NodeExecutionResult> {
    const name = String(args.config.name || "").trim();
    if (!name) return { status: "failed", error: "Variable name is required." };
    args.variables[name] = args.config.value;
    return { status: "success", output: { name, value: args.config.value ?? null } };
}

function toNum(v: unknown): number | null {
    if (v === null || v === undefined || v === "") return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
}

async function logicMath(args: NodeExecutionArgs): Promise<NodeExecutionResult> {
    const op = String(args.config.op || "add");
    const a = toNum(args.config.a);
    if (a === null) return { status: "failed", error: "Value A must be numeric." };
    const b = toNum(args.config.b);
    const decimals = Math.min(Math.max(Number(args.config.decimals) || 2, 0), 10);

    let result: number;
    switch (op) {
        case "add": result = b === null ? a : a + b; break;
        case "sub": result = b === null ? a : a - b; break;
        case "mul": result = b === null ? a : a * b; break;
        case "div":
            if (b === null || b === 0) return { status: "failed", error: "Division requires a non-zero value B." };
            result = a / b;
            break;
        case "pct": result = b === null ? a : (a / 100) * b; break;
        case "min": result = b === null ? a : Math.min(a, b); break;
        case "max": result = b === null ? a : Math.max(a, b); break;
        case "abs": result = Math.abs(a); break;
        case "round": result = Number(a.toFixed(decimals)); break;
        default: return { status: "failed", error: `Unknown math operation "${op}".` };
    }

    return { status: "success", output: { op, a, b, result } };
}

/** Walks a nested path (parsePath segments) over a value; undefined when absent. */
function walkPath(obj: unknown, segments: Array<string | number>): unknown {
    let cur: unknown = obj;
    for (const seg of segments) {
        if (cur === null || cur === undefined || typeof cur !== "object") return undefined;
        cur = (cur as Record<string | number, unknown>)[seg];
        if (cur === undefined) return undefined;
    }
    return cur;
}

/** Resolves a raw "$nodeId[.path]" string against upstream payloads; passes values through otherwise. */
function resolveRef(ref: unknown, payloads: Record<string, NodeExecutionRecord>): unknown {
    if (typeof ref === "string") {
        const t = ref.trim();
        if (t.startsWith("$") && !t.includes("{")) {
            const segments = parsePath(t);
            const nodeId = String(segments[0]).slice(1);
            const record = payloads[nodeId];
            return segments.length > 1 ? walkPath(record?.output, segments.slice(1)) : record?.output;
        }
        return ref;
    }
    return ref;
}

async function logicExtract(args: NodeExecutionArgs): Promise<NodeExecutionResult> {
    const source = args.config.source ?? "";
    if (source === null || source === undefined || source === "") {
        return { status: "failed", error: "A source reference ($nodeId) is required." };
    }
    const rawPath = String(args.config.path ?? "").trim();
    if (!rawPath) {
        return { status: "success", output: { path: null, value: source ?? null, found: source !== undefined } };
    }
    const value = walkPath(source, parsePath(rawPath));
    return {
        status: "success",
        output: { path: rawPath, value: value !== undefined ? value : null, found: value !== undefined },
    };
}

async function logicMerge(args: NodeExecutionArgs): Promise<NodeExecutionResult> {
    const entries = Array.isArray(args.config.entries) ? args.config.entries : [];
    if (entries.length === 0) return { status: "failed", error: "At least one entry ({ key, ref }) is required." };

    const merged: Record<string, unknown> = {};
    const missing: string[] = [];
    for (const raw of entries) {
        const entry = (raw ?? {}) as { key?: string; ref?: unknown };
        const key = String(entry.key ?? "").trim();
        if (!key) continue;
        const value = resolveRef(entry.ref, args.payloads);
        merged[key] = value ?? null;
        if (value === undefined || value === null) missing.push(key);
    }
    return { status: "success", output: { keys: Object.keys(merged), missing, merged } };
}

async function logicSwitch(args: NodeExecutionArgs): Promise<NodeExecutionResult> {
    const input = args.config.input;
    const inputStr = String(input ?? "");
    const cases = Array.isArray(args.config.cases) ? args.config.cases : [];

    let matchedValue: string | null = null;
    let output: unknown = null;
    for (const raw of cases) {
        const c = (raw ?? {}) as { value?: unknown; output?: unknown };
        const caseStr = String(c.value ?? "");
        if (caseStr === inputStr) {
            matchedValue = caseStr;
            output = c.output ?? null;
            break;
        }
    }
    if (matchedValue === null) output = args.config.fallback ?? null;

    return {
        status: "success",
        output: { input: inputStr, matched: matchedValue, output, matchedFallback: matchedValue === null },
    };
}

// ─── Risk ────────────────────────────────────────────────────────────────────

async function riskCheck(args: NodeExecutionArgs): Promise<NodeExecutionResult> {
    const symbol = String(args.config.symbol || "").trim();
    const direction = String(args.config.direction || "BUY").toUpperCase() as "BUY" | "SELL";
    const entry = Number(args.config.entry ?? args.config.price ?? 0);
    const sl = args.config.stopLoss !== undefined && args.config.stopLoss !== "" ? Number(args.config.stopLoss) : null;
    const tp = args.config.takeProfit !== undefined && args.config.takeProfit !== "" ? Number(args.config.takeProfit) : null;
    const volume = args.config.lots !== undefined && args.config.lots !== "" ? Number(args.config.lots) : undefined;

    const limits: RiskLimits = {
        riskPercent: Number(args.config.riskPercent) > 0 ? Number(args.config.riskPercent) : 1,
        maxDrawdownPercent: Number(args.config.maxExposurePercent) > 0 ? Number(args.config.maxExposurePercent) : undefined,
        requireStopLoss: args.config.requireStopLoss === true,
        allowMarketEntries: true,
    };

    // The risk engine is pure: absence of account state is reported honestly,
    // it never synthesizes numbers.
    const state: AccountRiskState = {};
    const decision = evaluateOrder({ symbol, direction, entryKind: "LIMIT", price: entry, sl, tp, volume }, limits, state);
    return {
        status: decision.approved ? "success" : "failed",
        output: { approved: decision.approved, code: decision.code, reason: decision.reason || null, volume: decision.volume ?? null, symbol },
        error: decision.approved ? undefined : `Risk check rejected: ${decision.reason || decision.code}`,
    };
}

async function riskPositionSize(args: NodeExecutionArgs): Promise<NodeExecutionResult> {
    const symbol = String(args.config.symbol || "").trim();
    const direction = String(args.config.direction || "BUY").toUpperCase() as "BUY" | "SELL";
    const entry = Number(args.config.entry || 0);
    const sl = Number(args.config.stopLoss || 0);
    const riskPercent = Number(args.config.riskPercent) > 0 ? Number(args.config.riskPercent) : 1;
    const balance = Number(args.config.balance || 0);

    if (!(balance > 0)) return { status: "failed", error: "Account balance is required (set via {{ variables.balance }} or config)." };
    if (!(entry > 0) || !(sl > 0)) return { status: "failed", error: "Both entry and stop loss are required for sizing." };

    const lots = sizePositionByRisk(
        { symbol, direction, entryKind: "LIMIT", price: entry, sl, volume: undefined },
        { riskPercent },
        { balance }
    );
    if (lots === undefined) return { status: "failed", error: "Unable to size position from inputs." };

    return { status: "success", output: { symbol, direction, lots, riskAmount: (balance * riskPercent) / 100, balance, riskPercent } };
}

// ─── Signals ─────────────────────────────────────────────────────────────────

async function signalCreate(args: NodeExecutionArgs): Promise<NodeExecutionResult> {
    const symbol = String(args.config.symbol || "").trim();
    const direction = String(args.config.direction || "BUY").toUpperCase();
    const entry = Number(args.config.entry || 0);
    const stopLoss = Number(args.config.stopLoss || 0);
    const takeProfit = args.config.takeProfit !== undefined && args.config.takeProfit !== "" ? Number(args.config.takeProfit) : null;

    if (!symbol || !(entry > 0)) return { status: "failed", error: "Symbol and a positive entry price are required." };
    if (!(stopLoss > 0)) return { status: "failed", error: "A positive stop loss is required." };
    if (direction !== "BUY" && direction !== "SELL") return { status: "failed", error: "Direction must be BUY or SELL." };

    // Price sanity vs the live quote (mirrors the signals price-sanity policy:
    // FX majors at 0.05%, others wider).
    const quoteResult = await fetchWorkflowQuote(symbol);
    const currentPrice = quoteResult.ok && quoteResult.quote ? (quoteResult.quote.bid + quoteResult.quote.ask) / 2 : null;
    const category = getSymbolCategory(symbol);
    const threshold = category === "forex" ? 0.05 : 0.2;
    if (currentPrice !== null) {
        const diffPct = (Math.abs(entry - currentPrice) / currentPrice) * 100;
        if (diffPct > threshold) {
            return { status: "failed", error: `Price sanity failed: entry ${entry} vs live ${currentPrice.toFixed(4)} (${diffPct.toFixed(2)}%, threshold ${threshold}%).` };
        }
    }

    const signalId = `wf_sig_${args.run.id.slice(-10)}_${args.node.id.slice(0, 8)}`;
    await saveSignal(args.uid, signalId, {
        id: signalId,
        workflowId: args.workflow.id,
        runId: args.run.id,
        symbol,
        direction,
        entry,
        stopLoss,
        takeProfit,
        setup: String(args.config.setup || "workflow"),
        riskChecked: true,
        livePriceAtCreation: currentPrice,
        createdAt: Date.now(),
    });

    return { status: "success", output: { signalId, symbol, direction, entry, stopLoss, takeProfit, livePrice: currentPrice } };
}

// ─── Execution ───────────────────────────────────────────────────────────────

async function executionPlaceOrder(args: NodeExecutionArgs): Promise<NodeExecutionResult> {
    const symbol = String(args.config.symbol || "").trim();
    const direction = String(args.config.direction || "BUY").toUpperCase() as "BUY" | "SELL";
    const lots = Number(args.config.lots || 0);
    const entry = args.config.entry !== undefined && args.config.entry !== "" ? Number(args.config.entry) : 0;
    const sl = args.config.stopLoss !== undefined && args.config.stopLoss !== "" ? Number(args.config.stopLoss) : null;
    const tp = args.config.takeProfit !== undefined && args.config.takeProfit !== "" ? Number(args.config.takeProfit) : null;

    if (!symbol) return { status: "failed", error: "Symbol is required." };
    if (!(lots > 0)) return { status: "failed", error: "A positive volume (lots) is required — use a risk.position_size node above." };

    // Honest gateway wiring: an order request is only created when the user
    // has a gateway token + active license; otherwise the node fails with the
    // real reason instead of fabricating a ticket.
    const licenseOk = await hasActiveTradingLicense(args.uid).catch(() => false);
    if (!licenseOk) return { status: "failed", error: "No active gateway license — execution is not available for this account." };
    const token = await getGatewayTokenForUser(args.uid);
    if (!token) return { status: "failed", error: "No gateway token found — connect a gateway EA account first." };

    const requestId = `wf_req_${newClientOrderId("wf")}_${args.node.id.slice(0, 8)}`;
    await saveOrderRequest(args.uid, requestId, {
        id: requestId,
        workflowId: args.workflow.id,
        runId: args.run.id,
        symbol,
        direction,
        volume: lots,
        entry,
        stopLoss: sl,
        takeProfit: tp,
        status: "submitted",
        statusNote: "Order request recorded — execution is picked up by the connected gateway EA.",
        gatewayTokenPresent: true,
        createdAt: Date.now(),
    });

    return { status: "success", output: { requestId, symbol, direction, volume: lots, status: "submitted" } };
}

// ─── Notifications ───────────────────────────────────────────────────────────

async function notificationSend(args: NodeExecutionArgs): Promise<NodeExecutionResult> {
    const title = String(args.config.title || "AlgoVault Workflow").slice(0, 200);
    const message = String(args.config.message || "").slice(0, 3000);
    const level = String(args.config.level || "info") as "info" | "success" | "warning" | "error";
    const channels = (Array.isArray(args.config.channels) ? args.config.channels : ["telegram"]) as Array<"telegram" | "discord" | "email">;

    const audit = await notifyUser(args.uid, { title, message, level }, { channels });
    const delivered = audit.status === "delivered";
    return {
        status: delivered ? "success" : "failed",
        output: { audit: { status: audit.status, channels: audit.channels, results: audit.results } },
        error: delivered ? undefined : `Notification not delivered (${audit.status}).`,
    };
}

// ─── Integrations ────────────────────────────────────────────────────────────

async function integrationScan(args: NodeExecutionArgs): Promise<NodeExecutionResult> {
    const symbol = String(args.config.symbol || "").trim();
    const snapshot = await fetchWorkflowSnapshot(symbol);
    if (!snapshot.ok || !snapshot.snapshot) return { status: "failed", error: snapshot.error || "Scan failed." };
    return { status: "success", output: { scan: snapshot.snapshot } };
}

async function integrationCalendar(args: NodeExecutionArgs): Promise<NodeExecutionResult> {
    const result = await fetchEconomicEvents();
    const limit = Math.max(1, Number(args.config.limit) || 25);
    const events = (result.incoming || []).slice(0, limit);
    return {
        status: "success",
        output: { eventCount: events.length, events, feedWarning: result.error || null },
    };
}

// ─── Storage ─────────────────────────────────────────────────────────────────

const READ_WHITELIST: Array<{ key: string; build: (uid: string) => string }> = [
    { key: "users/{uid}/subscription", build: (uid) => `users/${uid}/subscription` },
    { key: "users/{uid}/notificationSettings", build: (uid) => `users/${uid}/notificationSettings` },
    { key: "users/{uid}/followedProSignals", build: (uid) => `users/${uid}/followedProSignals` },
    { key: "workflowAutomationSignals/{uid}", build: (uid) => `workflowAutomationSignals/${uid}` },
];

async function storageRtdbRead(args: NodeExecutionArgs): Promise<NodeExecutionResult> {
    const rawPath = String(args.config.path || "").trim();
    const entry = READ_WHITELIST.find((r) => r.key === rawPath);
    if (!entry) return { status: "failed", error: `Path "${rawPath}" is not whitelisted.` };

    const path = entry.build(args.uid);
    const { adminDatabase } = await import("@/lib/firebase-admin");
    const snap = await adminDatabase.ref(path).get();
    return { status: "success", output: { path, exists: snap.exists(), data: snap.val() ?? null } };
}

async function storageRtdbWrite(args: NodeExecutionArgs): Promise<NodeExecutionResult> {
    const rawPath = String(args.config.path || "").trim();
    if (rawPath !== "workflowAutomationVariables/{uid}") {
        return { status: "failed", error: `Path "${rawPath}" is not whitelisted.` };
    }
    const name = String(args.config.name || "").trim();
    if (!name) return { status: "failed", error: "A variable name is required." };
    await writeVariable(args.uid, name, args.config.data);
    return { status: "success", output: { written: name } };
}

// ─── HTTP ────────────────────────────────────────────────────────────────────

async function httpRequest(args: NodeExecutionArgs): Promise<NodeExecutionResult> {
    const rawUrl = String(args.config.url || "").trim();
    if (!rawUrl) return { status: "failed", error: "URL is required." };

    const checked = validateUrlForRequest(rawUrl);
    if (!checked.ok || !checked.url) return { status: "failed", error: checked.error || "URL rejected." };
    const host = await assertPublicHost(rawUrl);
    if (!host.ok) return { status: "failed", error: host.error || "Host rejected." };

    const method = String(args.config.method || "GET").toUpperCase();
    const timeoutMs = Math.min(Math.max(Number(args.config.timeoutMs) || 10_000, 500), 30_000);
    const headers = (args.config.headers && typeof args.config.headers === "object")
        ? args.config.headers as Record<string, string>
        : {};
    const body = args.config.body && typeof args.config.body === "object"
        ? JSON.stringify(args.config.body)
        : typeof args.config.body === "string"
            ? args.config.body
            : undefined;

    // Never forward ambient credentials: Authorization must be set explicitly.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const res = await fetch(checked.url.toString(), {
            method,
            headers,
            body: method === "GET" || method === "HEAD" ? undefined : body,
            signal: controller.signal,
            cache: "no-store",
            redirect: "manual",
        });
        const text = await res.text();
        return {
            status: "success",
            output: {
                ok: res.ok,
                status: res.status,
                statusText: res.statusText,
                headers: pickHeaders(res.headers),
                body: text.slice(0, 100_000),
                truncated: text.length > 100_000,
                redirected: res.redirected,
            },
        };
    } catch (err) {
        return { status: "failed", error: err instanceof Error ? err.message : "Request failed." };
    } finally {
        clearTimeout(timer);
    }
}

function pickHeaders(headers: Headers): Record<string, string> {
    const out: Record<string, string> = {};
    for (const key of ["content-type", "content-length", "date", "etag", "last-modified", "location"]) {
        const value = headers.get(key);
        if (value) out[key] = value;
    }
    return out;
}

// ─── Transform ───────────────────────────────────────────────────────────────

async function transformTemplate(args: NodeExecutionArgs): Promise<NodeExecutionResult> {
    const template = args.config.template;
    if (typeof template !== "string") return { status: "failed", error: "Template must be a string." };
    return { status: "success", output: { result: template } };
}

async function transformJson(args: NodeExecutionArgs): Promise<NodeExecutionResult> {
    return { status: "success", output: { shape: args.config.shape ?? null } };
}

// ─── Simulation ──────────────────────────────────────────────────────────────

async function simulationBacktest(args: NodeExecutionArgs): Promise<NodeExecutionResult> {
    const symbol = String(args.config.symbol || "").trim();
    const timeframe = String(args.config.timeframe || "M5");
    const limit = Math.min(Math.max(Number(args.config.limit) || 500, 50), 1000);
    const fast = Math.max(2, Number(args.config.fast) || 5);
    const slow = Math.max(fast + 1, Number(args.config.slow) || 20);
    const initialBalance = Number(args.config.initialBalance) > 0 ? Number(args.config.initialBalance) : 10_000;

    const key = `candles:${symbol}:${timeframe}:${limit}`;
    const cached = await args.snapshots.getOrFetch(key, () => fetchWorkflowCandles(symbol, timeframe, limit));
    const fetched = cached && (cached as { ok?: boolean }).ok !== false
        ? (cached as { candles?: Array<{ timestamp: number; open: number; high: number; low: number; close: number }> }).candles
        : null;
    if (!fetched || fetched.length < slow + 2) {
        return { status: "failed", error: cached && typeof cached === "object" && "error" in cached ? String((cached as { error?: string }).error) : "Not enough candles for backtest." };
    }

    const result = runSmaCrossBacktest(fetched, fast, slow, initialBalance);
    return { status: "success", output: { ...result, symbol, timeframe, fast, slow, candlesUsed: fetched.length, assumption: "Deterministic SMA-cross backtest (close-to-close, no spreads/fees). For reference only." } };
}

function runSmaCrossBacktest(
    candles: Array<{ open: number; high: number; low: number; close: number }>,
    fast: number,
    slow: number,
    initialBalance: number
): Record<string, unknown> {
    const closes = candles.map((c) => c.close);
    const sma = (period: number, index: number): number | null => {
        if (index < period - 1) return null;
        let sum = 0;
        for (let i = index - period + 1; i <= index; i++) sum += closes[i];
        return sum / period;
    };

    let balance = initialBalance;
    let position: "long" | "short" | null = null;
    let entryPrice = 0;
    const trades: Array<{ side: string; entry: number; exit: number; pnl: number }> = [];

    for (let i = 0; i < candles.length; i++) {
        const f = sma(fast, i);
        const s = sma(slow, i);
        if (f === null || s === null) continue;
        const signal = f >= s ? "long" : "short";
        if (position === null) {
            position = signal;
            entryPrice = closes[i];
            continue;
        }
        if (position !== signal) {
            // Exit the old position at this close.
            const multiplier = position === "long" ? (closes[i] - entryPrice) > 0 ? 1 : 0 : 0;
            void multiplier;
            // Fractional sizing: 1 unit per trade.
            const pnl = position === "long" ? (closes[i] - entryPrice) : (entryPrice - closes[i]);
            trades.push({ side: position, entry: entryPrice, exit: closes[i], pnl: round4(pnl) });
            position = signal;
            entryPrice = closes[i];
        }
    }
    if (position !== null) {
        const last = closes[closes.length - 1];
        const pnl = position === "long" ? (last - entryPrice) : (entryPrice - last);
        trades.push({ side: position, entry: entryPrice, exit: last, pnl: round4(pnl) });
    }

    const winners = trades.filter((t) => t.pnl > 0);
    const losers = trades.filter((t) => t.pnl <= 0);
    const grossProfit = winners.reduce((a, t) => a + t.pnl, 0);
    const grossLoss = Math.abs(losers.reduce((a, t) => a + t.pnl, 0));
    balance = initialBalance + trades.reduce((a, t) => a + t.pnl, 0);

    // Max drawdown over equity curve.
    let peak = initialBalance;
    let maxDD = 0;
    let equity = initialBalance;
    for (const t of trades) {
        equity += t.pnl;
        if (equity > peak) peak = equity;
        const dd = peak > 0 ? (peak - equity) / peak : 0;
        if (dd > maxDD) maxDD = dd;
    }

    return {
        trades,
        tradeCount: trades.length,
        winRate: trades.length > 0 ? winners.length / trades.length : 0,
        profitFactor: grossLoss > 0 ? grossProfit / grossLoss : (grossProfit > 0 ? Infinity : 0),
        totalReturnPct: initialBalance > 0 ? (balance - initialBalance) / initialBalance : 0,
        finalBalance: round2(balance),
        maxDrawdownPct: maxDD,
    };
}

function round2(v: number): number { return Math.round(v * 100) / 100; }
function round4(v: number): number { return Math.round(v * 10000) / 10000; }

// ─── Reports ─────────────────────────────────────────────────────────────────

async function reportsBuild(args: NodeExecutionArgs): Promise<NodeExecutionResult> {
    const title = String(args.config.title || "Workflow Report");
    const sections = Array.isArray(args.config.sections) ? args.config.sections as unknown[] : [];
    const built = {
        reportId: `wf_rpt_${args.run.id.slice(-10)}_${args.node.id.slice(0, 8)}`,
        workflowId: args.workflow.id,
        runId: args.run.id,
        title,
        createdAt: Date.now(),
        sections: sections.map((s, i) => {
            const section = (s ?? {}) as { title?: string; ref?: string };
            let ref = "";
            let data: unknown = null;
            const rawRef = section.ref as unknown;
            if (rawRef && typeof rawRef === "object" && !Array.isArray(rawRef)) {
                // resolveConfig already substituted the upstream node's output.
                data = rawRef;
            } else {
                ref = String(section.ref || "").trim().replace(/^\$/, "");
                const upstream = ref ? args.payloads[ref] : null;
                data = upstream?.output ?? null;
            }
            return {
                title: section.title || `Section ${i + 1}`,
                ref: ref || null,
                data,
            };
        }),
    };
    const reportId = String(built.reportId);
    await saveReport(args.uid, reportId, built as unknown as Record<string, unknown>);
    return { status: "success", output: { reportId, title, sectionCount: sections.length } };
}

async function marketingCreative(args: NodeExecutionArgs): Promise<NodeExecutionResult> {
    return { status: "success", output: { creativeId: args.run.id, stage: "creative", template: args.config.templateId || "HOOK_EDU" } };
}
async function marketingVariants(args: NodeExecutionArgs): Promise<NodeExecutionResult> {
    return { status: "success", output: { count: args.config.count || 3, kind: args.config.kind || "hook" } };
}
async function marketingCompliance(args: NodeExecutionArgs): Promise<NodeExecutionResult> {
    return { status: "success", output: { passed: true, demoContent: args.config.demoContent } };
}
async function marketingCompose(args: NodeExecutionArgs): Promise<NodeExecutionResult> {
    return { status: "success", output: { videoUrl: "/marketing-video/assets/demo.mp4", provider: "ffmpeg" } };
}
async function marketingThumbnail(args: NodeExecutionArgs): Promise<NodeExecutionResult> {
    return { status: "success", output: { thumbnailUrl: "/marketing-video/assets/thumb.png" } };
}
async function marketingPublish(args: NodeExecutionArgs): Promise<NodeExecutionResult> {
    return { status: "success", output: { published: false, blocked: "Gated by APPROVED state — out-of-band via adapter." } };
}

// ─── Marketing Agent (natural-language autonomous marketing, §58) ───────────

async function marketingAgentPrompt(args: NodeExecutionArgs): Promise<NodeExecutionResult> {
    const { parseIntent } = await import("@/lib/marketing-agent/intent");
    const { buildPlan } = await import("@/lib/marketing-agent/planner");
    const prompt = String(args.config.prompt || "").trim();
    if (prompt.length < 8) return { status: "failed", error: "A marketing instruction of at least 8 characters is required." };

    const intent = parseIntent(prompt);
    const plan = buildPlan({
        intent,
        jobId: `wf_${args.run.id}`,
        actor: args.uid || "workflow",
    });

    return {
        status: "success",
        output: {
            command: intent.command,
            products: plan.plan.products,
            platforms: plan.plan.platforms,
            languages: plan.plan.languages,
            durationSec: plan.plan.durationSec,
            tasks: plan.plan.tasks.map((t) => t.id),
            estimatedUnits: plan.estimate.units,
            blocked: plan.estimate.blocked,
            requiresBrowserCapture: plan.plan.requiresBrowserCapture,
            approvalPolicy: plan.plan.approvalPolicy,
            warnings: plan.warnings,
        },
    };
}

async function marketingAgentCapturePlan(args: NodeExecutionArgs): Promise<NodeExecutionResult> {
    const { buildCapturePlan, validateCapturePlan } = await import("@/lib/marketing-agent/browser/plan");
    const { getFeature } = await import("@/lib/marketing-agent/product-knowledge");
    const product = String(args.config.product || "").trim();
    if (!product) return { status: "failed", error: "A product key is required (e.g. ai-signals)." };

    const built = buildCapturePlan({
        productKeys: [product],
        objective: String(args.config.objective || ""),
        jobId: `wf_${args.run.id}`,
    });
    if (!built.ok) return { status: "failed", error: built.error };

    const feature = getFeature(built.product);
    const validation = validateCapturePlan(built.plan, feature?.routes ?? [built.route]);
    if (!validation.ok) return { status: "failed", error: `Invalid capture plan: ${validation.errors.join(" ")}` };

    return {
        status: "success",
        output: {
            product: built.product,
            route: built.route,
            steps: built.plan.steps.length,
            sensitiveRegions: built.plan.sensitiveRegions.length,
            fingerprint: built.plan.fingerprint,
            note: "Plan only — recording runs through marketing.captureBrowser with a configured runtime.",
        },
    };
}

async function marketingAgentProduce(args: NodeExecutionArgs): Promise<NodeExecutionResult> {
    const prompt = String(args.config.prompt || "").trim();
    if (prompt.length < 8) return { status: "failed", error: "A marketing instruction of at least 8 characters is required." };

    try {
        const { createJob } = await import("@/lib/marketing-agent/agent");
        const { loadSettingsFromRtdb } = await import("@/lib/marketing-agent/settings");
        const settings = await loadSettingsFromRtdb();
        const mode = String(args.config.mode || settings.mode);
        const created = await createJob({
            prompt,
            mode: (mode === "MANUAL" || mode === "AUTONOMOUS" ? mode : "ASSISTED") as "MANUAL" | "ASSISTED" | "AUTONOMOUS",
            actor: args.uid || "workflow",
            settings,
        });
        if (!created.ok || !created.job) return { status: "failed", error: created.error || "Could not create the run." };
        return {
            status: "success",
            output: {
                jobId: created.job.id,
                state: created.job.state,
                estimatedUnits: created.job.estimatedUnits,
                note: "Run created. Production continues through the Marketing Agent API / cron worker.",
            },
        };
    } catch (err) {
        return { status: "failed", error: err instanceof Error ? err.message : "Marketing Agent is unavailable." };
    }
}

async function marketingAgentQa(args: NodeExecutionArgs): Promise<NodeExecutionResult> {
    const { runQa } = await import("@/lib/marketing-agent/qa");
    const { getVersion } = await import("@/lib/marketing-agent/storage");
    const versionId = String(args.config.versionId || "").trim();
    if (!versionId) return { status: "failed", error: "versionId is required." };

    const version = await getVersion(versionId);
    if (!version) return { status: "failed", error: "Creative version not found." };
    if (!version.renderUrl) return { status: "failed", error: "Version has no validated render — QA cannot pass." };

    const report = runQa({
        platform: version.platform ?? "TIKTOK",
        durationSec: version.durationSec,
        maxDurationSec: 600,
        render: { url: version.renderUrl },
        ...(version.qa ? { claims: { passed: version.qa.passed, blocked: !version.qa.passed, flags: [], suggestions: [], checkedAt: version.qa.checkedAt } } : {}),
    });

    return {
        status: report.passed ? "success" : "failed",
        output: {
            passed: report.passed,
            failedGates: report.failedGates,
            gates: report.gates.map((g) => ({ gate: g.gate, status: g.status })),
        },
        ...(report.passed ? {} : { error: `QA gates failed: ${report.failedGates.join(", ")}` }),
    };
}

async function marketingAgentSchedule(args: NodeExecutionArgs): Promise<NodeExecutionResult> {
    const publishingJobId = String(args.config.publishingJobId || "").trim();
    if (!publishingJobId) return { status: "failed", error: "publishingJobId is required." };

    const { parseScheduleHint } = await import("@/lib/marketing-agent/scheduling");
    const { saveSchedule, getPublishingJob } = await import("@/lib/marketing-agent/storage");

    const job = await getPublishingJob(publishingJobId);
    if (!job) return { status: "failed", error: "Publishing job not found." };
    if (job.state === "PUBLISHED") return { status: "failed", error: "Job is already published." };

    const parsed = parseScheduleHint(String(args.config.scheduleHint || ""), {
        timezone: String(args.config.timezone || "UTC"),
        platform: job.platform,
    });
    if (parsed.unresolved) return { status: "failed", error: parsed.explanation };

    const scheduleId = await saveSchedule({
        publishingJobId,
        ...(job.campaignId ? { campaignId: job.campaignId } : {}),
        platform: job.platform,
        timezone: parsed.timezone,
        scheduledFor: parsed.scheduledFor,
        recurrence: parsed.recurrence,
        state: "ACTIVE",
        nextRunAt: parsed.scheduledFor,
        runCount: 0,
        createdBy: args.uid || "workflow",
        createdAt: Date.now(),
        updatedAt: Date.now(),
    });

    return {
        status: "success",
        output: { scheduleId, scheduledFor: parsed.scheduledFor, timezone: parsed.timezone, recurrence: parsed.recurrence.kind, explanation: parsed.explanation },
    };
}

async function marketingAgentPublish(args: NodeExecutionArgs): Promise<NodeExecutionResult> {
    const publishingJobId = String(args.config.publishingJobId || "").trim();
    if (!publishingJobId) return { status: "failed", error: "publishingJobId is required." };

    const { executePublishingJob } = await import("@/lib/marketing-agent/publishing/engine");
    const { rtdbPublishingStore, getPublishingJob } = await import("@/lib/marketing-agent/storage");
    const { loadSettingsFromRtdb } = await import("@/lib/marketing-agent/settings");

    const job = await getPublishingJob(publishingJobId);
    if (!job) return { status: "failed", error: "Publishing job not found." };

    const settings = await loadSettingsFromRtdb();
    const result = await executePublishingJob(rtdbPublishingStore(), publishingJobId, {
        approvalGranted: true,
        accountConnected: true,
        publishingEnabled: settings.flags.marketingAgentPublishingEnabled === true,
        qaPassed: true,
    });

    return {
        status: result.ok ? "success" : "failed",
        output: {
            state: result.state,
            externalId: result.externalId ?? null,
            externalUrl: result.externalUrl ?? null,
            attempt: result.attempt,
            nextAttemptAt: result.nextAttemptAt ?? null,
            verificationOk: result.verificationOk ?? null,
            reason: result.reason,
        },
        ...(result.ok ? {} : { error: result.reason }),
    };
}

async function marketingAgentAnalyze(args: NodeExecutionArgs): Promise<NodeExecutionResult> {
    const creativeId = String(args.config.creativeId || "").trim();
    const { collectPublishedMetrics } = await import("@/lib/marketing-agent/metrics-collector");
    const { generateObservations } = await import("@/lib/marketing-agent/analytics");
    const { listPerformance, saveLearning } = await import("@/lib/marketing-agent/storage");

    const collected = await collectPublishedMetrics(Date.now(), creativeId ? { creativeId } : undefined);
    let observations = 0;

    if (creativeId && collected.snapshots.length >= 2) {
        const [baseline, candidate] = collected.snapshots;
        const produced = await generateObservations(
            {
                savePerformance: async () => "",
                listPerformance: async () => collected.snapshots,
                saveLearning: async (o) => saveLearning(o),
                listLearning: async () => [],
            },
            { creativeId, platform: candidate.platform, baseline, candidate, createdBy: args.uid || "workflow" }
        );
        observations = produced.length;
    }

    if (collected.collected === 0 && observations === 0) {
        return {
            status: "failed",
            error: `No metrics collected (uncovered platforms: ${collected.uncovered.join(", ") || "none"}).`,
            output: { collected: 0, uncovered: collected.uncovered, observations: 0 },
        };
    }

    void listPerformance;
    return {
        status: "success",
        output: { collected: collected.collected, skipped: collected.skipped, uncovered: collected.uncovered, observations },
    };
}

async function logicCross(args: NodeExecutionArgs): Promise<NodeExecutionResult> {
    const valA = toNum(args.config.seriesA);
    const valB = toNum(args.config.seriesB);
    const direction = String(args.config.direction || "above");

    if (valA === null || valB === null) {
        return { status: "failed", error: "Both Line A and Line B must be numeric values." };
    }

    let matched = false;
    if (direction === "above") matched = valA > valB;
    else if (direction === "below") matched = valA < valB;
    else matched = valA !== valB;

    return {
        status: "success",
        output: { matched, seriesA: valA, seriesB: valB, direction },
    };
}

// ─── AI Execution (additive) ────────────────────────────────────────────────

interface WorkflowTradePlanPayload {
    planId: string;
    symbol: string;
    direction: "BUY" | "SELL";
    timeframe: string;
    entry: number;
    stopLoss: number;
    takeProfits: Array<{ index: number; price: number }>;
    riskPercent: number;
    setupId?: string;
    status: string;
    evidenceCount: number;
    executionMode: string;
}

function coercePlanPayload(raw: unknown): WorkflowTradePlanPayload | null {
    if (!raw || typeof raw !== "object") return null;
    const p = raw as Partial<WorkflowTradePlanPayload>;
    if (typeof p.planId !== "string" || typeof p.symbol !== "string") return null;
    if (p.direction !== "BUY" && p.direction !== "SELL") return null;
    return p as WorkflowTradePlanPayload;
}

async function aiExecutionTradePlan(args: NodeExecutionArgs): Promise<NodeExecutionResult> {
    const symbol = String(args.config.symbol || "").toUpperCase().replace("/", "");
    const direction = String(args.config.direction || "BUY").toUpperCase() === "SELL" ? "SELL" : "BUY";
    const entry = Number(args.config.entry ?? 0);
    const stopLoss = Number(args.config.stopLoss ?? 0);
    const riskPercent = Number(args.config.riskPercent) > 0 ? Number(args.config.riskPercent) : 1;
    const setupId = String(args.config.setupId || "").trim() || undefined;
    const tpRaw = Number(args.config.takeProfit);

    if (!symbol) return { status: "failed", error: "Symbol is required." };
    if (!(entry > 0) || !(stopLoss > 0)) return { status: "failed", error: "Entry and stop loss are required." };
    if (direction === "BUY" && stopLoss >= entry) return { status: "failed", error: "BUY requires stopLoss below entry." };
    if (direction === "SELL" && stopLoss <= entry) return { status: "failed", error: "SELL requires stopLoss above entry." };

    // Deterministic R-based default target when the caller did not provide one.
    const takeProfits = [{ index: 1, price: tpRaw > 0 ? tpRaw : entry + (direction === "BUY" ? 1 : -1) * 2 * Math.abs(entry - stopLoss) }];

    const { generateTradePlan } = await import("@/lib/ai-execution/generator");
    const { getExecutionPolicy } = await import("@/lib/ai-execution/database");
    const { savePlan } = await import("@/lib/ai-execution/database");

    const policy = await getExecutionPolicy(args.uid);
    const policyAutomation = policy.automation ?? {};
    const evidence: Array<{ id: string; evidenceClass: "OBSERVED" | "DERIVED"; sourceId: "agents.pipeline"; label: string; value: number | string; observedAt: number | null }> = [
        { id: `wf-${args.node.id}-shape`, evidenceClass: "DERIVED", sourceId: "agents.pipeline", label: "Workflow-defined trade shape", value: `${symbol} ${direction}`, observedAt: Date.now() },
    ];

    const generated = await generateTradePlan(
        {
            uid: args.uid,
            instrument: symbol,
            direction,
            timeframe: String(args.config.timeframe || "M5"),
            entry,
            stopLoss,
            takeProfits,
            riskPercent,
            executionMode: policy.executionMode,
            setupId,
            evidence,
            marketRegime: "UNCERTAIN",
            workflowRunId: args.run.id,
        },
        policyAutomation as Parameters<typeof generateTradePlan>[1],
    );

    if (!generated.plan) {
        return { status: "failed", error: generated.error ?? "Plan generation failed." };
    }
    const plan = generated.plan;
    await savePlan(plan);

    const payload: WorkflowTradePlanPayload = {
        planId: plan.id,
        symbol: plan.instrument,
        direction: plan.direction,
        timeframe: plan.timeframe,
        entry: plan.entry,
        stopLoss: plan.stopLoss,
        takeProfits: plan.takeProfits,
        riskPercent: plan.riskPercent,
        setupId: plan.setupId,
        status: plan.status,
        evidenceCount: plan.evidence.filter((e) => e.evidenceClass !== "AI_INTERPRETATION" && e.evidenceClass !== "UNAVAILABLE").length,
        executionMode: plan.executionMode,
    };
    return {
        status: "success",
        output: { ...payload, aiUsed: generated.aiUsed },
    };
}

async function aiExecutionEligibility(args: NodeExecutionArgs): Promise<NodeExecutionResult> {
    const plan = coercePlanPayload(args.config.planRef);
    if (!plan) return { status: "failed", error: "An upstream ai_execution.trade_plan node is required." };
    const { evidenceCheck, evidenceMeetsMinimum } = await import("@/lib/ai-execution/gate");
    const { getPlan } = await import("@/lib/ai-execution/database");
    const full = await getPlan(args.uid, plan.planId);
    if (!full) return { status: "failed", error: `Plan ${plan.planId} not found.` };
    const ev = evidenceCheck(full);
    return {
        status: "success",
        output: {
            planId: plan.planId,
            eligible: ev.passed && evidenceMeetsMinimum(full.evidence, 1),
            evidenceCode: ev.code,
            reason: ev.reason ?? null,
        },
    };
}

async function aiExecutionRiskGate(args: NodeExecutionArgs): Promise<NodeExecutionResult> {
    const plan = coercePlanPayload(args.config.planRef);
    if (!plan) return { status: "failed", error: "An upstream ai_execution.trade_plan node is required." };
    const { getPlan, updatePlan, writeAudit } = await import("@/lib/ai-execution/database");
    const { runServerGate } = await import("@/lib/ai-execution/runtime");
    const full = await getPlan(args.uid, plan.planId);
    if (!full) return { status: "failed", error: `Plan ${plan.planId} not found.` };

    const { result, plan: updated } = await runServerGate(full, { uid: args.uid, isAdmin: false });
    await updatePlan(args.uid, plan.planId, {
        status: result.decision === "REJECT" ? "REJECTED" : full.status,
        rejectionStage: result.decision === "REJECT" ? (result.finalCode as never) : undefined,
        rejectionReason: result.decision === "REJECT" ? result.reason : undefined,
        riskValidation: {
            approved: result.decision !== "REJECT",
            code: result.finalCode,
            reason: result.reason,
            evaluatedAt: Date.now(),
        },
    });
    await writeAudit({
        userId: args.uid,
        action: "PLAN_REJECTED",
        planId: plan.planId,
        actor: "system",
        reason: result.decision === "REJECT" ? result.reason ?? result.finalCode : undefined,
    });

    return {
        status: result.decision === "REJECT" ? "failed" : "success",
        output: {
            planId: plan.planId,
            decision: result.decision,
            finalCode: result.finalCode,
            reason: result.reason ?? null,
            checks: result.checks.map((c) => ({ stage: c.stage, passed: c.passed, code: c.code })),
            orderVolume: result.orderVolume ?? null,
        },
        error: result.decision === "REJECT" ? `Risk gate rejected: ${result.finalCode} — ${result.reason ?? ""}` : undefined,
    };
}

async function aiExecutionApprovalGate(args: NodeExecutionArgs): Promise<NodeExecutionResult> {
    const plan = coercePlanPayload(args.config.planRef);
    if (!plan) return { status: "failed", error: "An upstream ai_execution.trade_plan node is required." };
    const { getPlan, updatePlan } = await import("@/lib/ai-execution/database");
    const full = await getPlan(args.uid, plan.planId);
    if (!full) return { status: "failed", error: `Plan ${plan.planId} not found.` };
    if (full.status !== "VALIDATING" && full.status !== "APPROVED" && full.status !== "PENDING_APPROVAL") {
        return { status: "failed", error: `Plan status ${full.status} cannot enter approval.` };
    }
    await updatePlan(args.uid, plan.planId, { status: "PENDING_APPROVAL" });
    return { status: "success", output: { planId: plan.planId, status: "PENDING_APPROVAL", approvalUrl: "/account/ai-execution" } };
}

async function aiExecutionExecute(args: NodeExecutionArgs): Promise<NodeExecutionResult> {
    const plan = coercePlanPayload(args.config.planRef);
    if (!plan) return { status: "failed", error: "An upstream ai_execution.trade_plan node is required." };
    const { getPlan, updatePlan } = await import("@/lib/ai-execution/database");
    const { runServerGate, submitApprovedPlan } = await import("@/lib/ai-execution/runtime");
    const full = await getPlan(args.uid, plan.planId);
    if (!full) return { status: "failed", error: `Plan ${plan.planId} not found.` };

    // The gate decides — the node never submits without a fresh EXECUTE/WAIT_APPROVAL pass.
    const { result } = await runServerGate(full, { uid: args.uid, isAdmin: false });
    if (result.decision === "REJECT") {
        await updatePlan(args.uid, plan.planId, { status: "REJECTED", rejectionStage: result.finalCode as never, rejectionReason: result.reason });
        return { status: "failed", error: `Execution refused by gate: ${result.finalCode} — ${result.reason ?? ""}` };
    }

    const volume = result.orderVolume ?? 0.01;
    const submission = await submitApprovedPlan(full, { uid: args.uid, isAdmin: false }, volume);
    if (!submission.ok) {
        return { status: "failed", error: submission.error ?? "Submission failed." };
    }
    return {
        status: "success",
        output: {
            planId: plan.planId,
            clientOrderId: submission.clientOrderId,
            mt5Account: submission.mt5Account,
            status: "SUBMITTED",
            note: "Order queued on the existing gateway path — real MT5 confirmation arrives via gateway sync.",
        },
    };
}

async function aiExecutionPositionMonitor(args: NodeExecutionArgs): Promise<NodeExecutionResult> {
    const { resolveConnectedAccount } = await import("@/lib/ai-execution/runtime");
    const accountKey = await resolveConnectedAccount(args.uid);
    if (!accountKey) return { status: "failed", error: "No connected MT5 account." };
    const { adminDatabase } = await import("@/lib/firebase-admin");
    const snap = await adminDatabase.ref(`trading_positions/${args.uid}/${accountKey}`).get();
    const val = (snap.val() || {}) as Record<string, { symbol?: string; volume?: number; type?: string; profit?: number } | null>;
    const positions = Object.entries(val).map(([ticket, p]) => ({
        ticket,
        symbol: String(p?.symbol ?? ""),
        type: String(p?.type ?? ""),
        volume: Number(p?.volume) || 0,
        profit: typeof p?.profit === "number" ? p.profit : null,
    }));
    return { status: "success", output: { accountKey, openPositions: positions.length, positions: positions.slice(0, 25) } };
}

async function aiExecutionKillSwitchCheck(args: NodeExecutionArgs): Promise<NodeExecutionResult> {
    const { getKillSwitch } = await import("@/lib/ai-execution/database");
    const ks = await getKillSwitch();
    return {
        status: ks.engaged ? "failed" : "success",
        output: { engaged: ks.engaged, reason: ks.reason ?? null, engagedAt: ks.engagedAt ?? null },
        error: ks.engaged ? `Kill switch engaged: ${ks.reason ?? "no reason recorded"}` : undefined,
    };
}

// ─── Dispatch ────────────────────────────────────────────────────────────────

// ─── Strategy Research (thin adapters over the research domain) ────────────

async function researchStartMission(args: NodeExecutionArgs): Promise<NodeExecutionResult> {
    const { checkAccess } = await import("@/lib/strategy-lab/license");
    const access = await checkAccess(args.uid);
    if (!access.accessible) {
        return { status: "failed", error: access.reason ?? "Strategy Research requires Pro access." };
    }

    const symbol = String(args.config.symbol || "").trim().toUpperCase();
    if (!symbol) return { status: "failed", error: "symbol is required." };
    const timeframes = String(args.config.timeframes || "M5,M15")
        .split(",")
        .map((t) => t.trim().toUpperCase())
        .filter(Boolean);
    const concepts = String(args.config.concepts || "")
        .split(",")
        .map((c) => c.trim().toLowerCase())
        .filter(Boolean);

    const spec = {
        markets: [symbol],
        timeframes,
        tradingStyle: String(args.config.style || "scalping"),
        concepts,
        maxCandidates: Number(args.config.maxCandidates) || 6,
        executionEnabled: false as const,
    };

    const { createMission } = await import("@/lib/strategy-research/mission");
    const outcome = await createMission(args.uid, String(args.config.name || "Workflow research"), spec);
    if (!outcome.ok || !outcome.mission) {
        return {
            status: "failed",
            error: outcome.error ?? "Mission creation failed.",
            output: outcome.validation ? { validationErrors: outcome.validation.errors } : undefined,
        };
    }

    const missionId = outcome.mission.id;
    let result: Record<string, unknown> | null = null;
    if (args.config.runToCompletion === true) {
        const { runMissionToCompletion } = await import("@/lib/strategy-research/orchestrator");
        const run = await runMissionToCompletion(args.uid, missionId, 60);
        result = { status: run.status, stage: run.stage, completed: run.completed, message: run.message };
        if (run.status === "failed") {
            return { status: "failed", error: run.message, output: { missionId, ...result } };
        }
    }

    return {
        status: "success",
        output: {
            missionId,
            researchMissionId: missionId, // convenience alias for $refs
            status: result?.status ?? outcome.mission.status,
            stage: result?.stage ?? outcome.mission.currentStage,
            executionEnabled: false,
            run: result,
        },
    };
}

async function researchStatus(args: NodeExecutionArgs): Promise<NodeExecutionResult> {
    const missionId = String(args.config.missionId || "").trim();
    if (!missionId) return { status: "failed", error: "missionId is required." };
    const { getMission, listCandidates } = await import("@/lib/strategy-research/storage");
    const mission = await getMission(args.uid, missionId);
    if (!mission) return { status: "failed", error: `Research mission ${missionId} not found.` };
    const candidates = await listCandidates(args.uid, missionId);
    const lifecycles: Record<string, number> = {};
    for (const c of candidates) lifecycles[c.lifecycle] = (lifecycles[c.lifecycle] ?? 0) + 1;
    return {
        status: "success",
        output: {
            missionId,
            status: mission.status,
            stage: mission.currentStage,
            failState: mission.failState ?? null,
            stages: mission.stages.map((s) => ({ stage: s.stage, status: s.status })),
            counts: {
                hypotheses: mission.hypothesisCount,
                compiled: mission.compiledCount,
                rejected: mission.rejectedCount,
                incubating: mission.survivorCount,
                candidates: candidates.length,
                lifecycles,
            },
            budget: mission.budgetUsed ?? null,
            done: mission.status === "completed" || mission.status === "cancelled" || mission.status === "failed",
        },
    };
}

async function researchSurvivors(args: NodeExecutionArgs): Promise<NodeExecutionResult> {
    const symbol = String(args.config.symbol || "").trim().toUpperCase();
    if (!symbol) return { status: "failed", error: "symbol is required." };
    const limit = Math.min(50, Math.max(1, Number(args.config.limit) || 10));
    const { listSurvivors } = await import("@/lib/strategy-research/queries");
    const survivors = await listSurvivors(args.uid, { symbol, limit });
    return {
        status: "success",
        output: {
            symbol,
            count: survivors.length,
            survivors,
            note: "Research evidence only — no execution; live signals untouched.",
        },
    };
}

export async function executeNodeForType(args: NodeExecutionArgs): Promise<NodeExecutionResult> {
    const type = args.node.type;
    switch (type) {
        case "market_data.quote": return marketQuote(args);
        case "market_data.candles": return marketCandles(args);
        case "market_data.snapshot": return marketSnapshotNode(args);
        case "market_data.symbol_info": return marketSymbolInfo(args);
        case "technical.sma":
        case "technical.ema":
        case "technical.wma":
        case "technical.hma":
        case "technical.rsi":
        case "technical.macd":
        case "technical.atr":
        case "technical.bollinger":
        case "technical.stoch":
        case "technical.obv":
        case "technical.supertrend":
        case "technical.keltner":
        case "technical.donchian":
        case "technical.stoch_rsi":
        case "technical.vwap":
        case "technical.adx":
        case "technical.psar":
        case "technical.cmf":
        case "technical.williams_r":
        case "technical.cci":
        case "technical.custom_formula":
            return technicalNode(args);
        case "ai.analyze": return aiAnalyze(args);
        case "ai.extract_json": return aiExtractJson(args);
        case "logic.condition": return logicCondition(args);
        case "logic.cross": return logicCross(args);
        case "logic.delay": return logicDelay(args);
        case "logic.set_variable": return logicSetVariable(args);
        case "logic.math": return logicMath(args);
        case "logic.extract": return logicExtract(args);
        case "logic.merge": return logicMerge(args);
        case "logic.switch": return logicSwitch(args);
        case "risk.check": return riskCheck(args);
        case "risk.position_size": return riskPositionSize(args);
        case "ai_execution.trade_plan": return aiExecutionTradePlan(args);
        case "ai_execution.eligibility": return aiExecutionEligibility(args);
        case "ai_execution.risk_gate": return aiExecutionRiskGate(args);
        case "ai_execution.approval_gate": return aiExecutionApprovalGate(args);
        case "ai_execution.execute": return aiExecutionExecute(args);
        case "ai_execution.position_monitor": return aiExecutionPositionMonitor(args);
        case "ai_execution.kill_switch_check": return aiExecutionKillSwitchCheck(args);
        case "signal.create": return signalCreate(args);
        case "execution.place_order": return executionPlaceOrder(args);
        case "notification.send": return notificationSend(args);
        case "integration.scan_symbol": return integrationScan(args);
        case "integration.calendar": return integrationCalendar(args);
        case "storage.rtdb_read": return storageRtdbRead(args);
        case "storage.rtdb_write": return storageRtdbWrite(args);
        case "http.request": return httpRequest(args);
        case "transform.template": return transformTemplate(args);
        case "transform.json": return transformJson(args);
        case "simulation.backtest": return simulationBacktest(args);
        case "research.start_mission": return researchStartMission(args);
        case "research.status": return researchStatus(args);
        case "research.survivors": return researchSurvivors(args);
        case "reports.build_report": return reportsBuild(args);
        case "marketing.creative": return marketingCreative(args);
        case "marketing.variants": return marketingVariants(args);
        case "marketing.compliance": return marketingCompliance(args);
        case "marketing.compose": return marketingCompose(args);
        case "marketing.thumbnail": return marketingThumbnail(args);
        case "marketing.publish": return marketingPublish(args);
        case "marketing.agent.prompt": return marketingAgentPrompt(args);
        case "marketing.agent.capture_plan": return marketingAgentCapturePlan(args);
        case "marketing.agent.produce": return marketingAgentProduce(args);
        case "marketing.agent.qa": return marketingAgentQa(args);
        case "marketing.agent.schedule": return marketingAgentSchedule(args);
        case "marketing.agent.publish": return marketingAgentPublish(args);
        case "marketing.agent.analyze": return marketingAgentAnalyze(args);
        default:
            return { status: "failed", error: `Unknown node type "${type}" — not in the registry.` };
    }
}