/**
 * Observability for the TradingView MCP integration (PHASE 18).
 *
 * Structured, secret-free logging + in-memory metrics. Token values, OAuth
 * secrets and credentials are NEVER accepted into these helpers — callers
 * pass tool names, codes and durations only.
 */
import type { ExternalCapability, ProviderErrorCode } from "../interfaces/external-intelligence-provider";

export interface McpCallMeta {
    provider: "tradingview-mcp";
    tool: string;
    capability: ExternalCapability | null;
    userId?: string | null; // uid only — never tokens
    durationMs?: number;
    ok?: boolean;
    code?: ProviderErrorCode | null;
    cache?: "hit" | "miss" | "bypassed" | null;
    httpStatus?: number | null;
}

export interface McpMetricSnapshot {
    windowStart: number;
    totalCalls: number;
    okCalls: number;
    failedCalls: number;
    cacheHits: number;
    cacheMisses: number;
    rateLimitEvents: number;
    authFailures: number;
    timeouts: number;
    unsupportedCalls: number;
    outages: number;
    avgLatencyMs: number | null;
    byTool: Record<string, { calls: number; ok: number; failed: number; avgLatencyMs: number | null }>;
}

interface WindowState {
    windowStart: number;
    total: number;
    ok: number;
    failed: number;
    cacheHits: number;
    cacheMisses: number;
    rateLimited: number;
    authFailures: number;
    timeouts: number;
    unsupported: number;
    outages: number;
    latencySum: number;
    latencyCount: number;
    byTool: Map<string, { calls: number; ok: number; failed: number; latencySum: number; latencyCount: number }>;
}

const METRIC_WINDOW_MS = 60 * 60 * 1000; // rolling hourly snapshot
const LOG_SAMPLE_MS = 30_000; // avoid log floods for repeat failures

let windowState: WindowState = newWindowState();
let lastErrorLogAt = 0;

function newWindowState(): WindowState {
    return {
        windowStart: Date.now(),
        total: 0,
        ok: 0,
        failed: 0,
        cacheHits: 0,
        cacheMisses: 0,
        rateLimited: 0,
        authFailures: 0,
        timeouts: 0,
        unsupported: 0,
        outages: 0,
        latencySum: 0,
        latencyCount: 0,
        byTool: new Map(),
    };
}

function rolloverIfNeeded(now: number): void {
    if (now - windowState.windowStart >= METRIC_WINDOW_MS) {
        windowState = newWindowState();
    }
}

function classifyError(code: ProviderErrorCode | null | undefined): void {
    switch (code) {
        case "RATE_LIMITED":
            windowState.rateLimited += 1;
            break;
        case "TOKEN_EXPIRED":
        case "REAUTH_REQUIRED":
        case "NOT_CONNECTED":
            windowState.authFailures += 1;
            break;
        case "TIMEOUT":
            windowState.timeouts += 1;
            break;
        case "UNSUPPORTED_CAPABILITY":
            windowState.unsupported += 1;
            break;
        case "PROVIDER_OUTAGE":
            windowState.outages += 1;
            break;
        default:
            break;
    }
}

/** Record one provider call. Safe to call from any route. */
export function recordMcpCall(meta: McpCallMeta): void {
    const now = Date.now();
    rolloverIfNeeded(now);
    windowState.total += 1;
    if (meta.ok) windowState.ok += 1;
    else windowState.failed += 1;
    if (meta.cache === "hit") windowState.cacheHits += 1;
    if (meta.cache === "miss") windowState.cacheMisses += 1;
    if (typeof meta.durationMs === "number" && Number.isFinite(meta.durationMs)) {
        windowState.latencySum += meta.durationMs;
        windowState.latencyCount += 1;
    }
    classifyError(meta.ok ? null : meta.code);

    const tool = meta.tool || "unknown";
    const entry = windowState.byTool.get(tool) ?? { calls: 0, ok: 0, failed: 0, latencySum: 0, latencyCount: 0 };
    entry.calls += 1;
    if (meta.ok) entry.ok += 1;
    else entry.failed += 1;
    if (typeof meta.durationMs === "number" && Number.isFinite(meta.durationMs)) {
        entry.latencySum += meta.durationMs;
        entry.latencyCount += 1;
    }
    windowState.byTool.set(tool, entry);

    // Structured log line (no tokens, no secrets — callers must not pass any).
    const shouldLog = meta.ok || now - lastErrorLogAt > LOG_SAMPLE_MS;
    if (shouldLog) {
        if (!meta.ok) lastErrorLogAt = now;
        console.log(
            JSON.stringify({
                channel: "tradingview-mcp",
                type: meta.ok ? "call" : "call_failed",
                tool,
                capability: meta.capability ?? undefined,
                uid: meta.userId ?? undefined,
                durationMs: meta.durationMs,
                code: meta.ok ? undefined : (meta.code ?? "UNKNOWN_ERROR"),
                cache: meta.cache ?? undefined,
                httpStatus: meta.httpStatus ?? undefined,
                at: now,
            }),
        );
    }
}

/** Current metrics snapshot (admin health view). */
export function getMcpMetrics(): McpMetricSnapshot {
    rolloverIfNeeded(Date.now());
    const byTool: McpMetricSnapshot["byTool"] = {};
    for (const [tool, e] of windowState.byTool.entries()) {
        byTool[tool] = {
            calls: e.calls,
            ok: e.ok,
            failed: e.failed,
            avgLatencyMs: e.latencyCount > 0 ? Math.round(e.latencySum / e.latencyCount) : null,
        };
    }
    return {
        windowStart: windowState.windowStart,
        totalCalls: windowState.total,
        okCalls: windowState.ok,
        failedCalls: windowState.failed,
        cacheHits: windowState.cacheHits,
        cacheMisses: windowState.cacheMisses,
        rateLimitEvents: windowState.rateLimited,
        authFailures: windowState.authFailures,
        timeouts: windowState.timeouts,
        unsupportedCalls: windowState.unsupported,
        outages: windowState.outages,
        avgLatencyMs: windowState.latencyCount > 0 ? Math.round(windowState.latencySum / windowState.latencyCount) : null,
        byTool,
    };
}

/** Test hook. */
export function resetMcpMetrics(): void {
    windowState = newWindowState();
    lastErrorLogAt = 0;
}
