/**
 * Minimal Streamable HTTP MCP client wrapper for the TradingView MCP server.
 *
 * Speaks JSON-RPC 2.0 over HTTP POST with `Accept: application/json,
 * text/event-stream` per the Streamable HTTP transport spec. Handles:
 *   • initialize handshake (once per process) + session id header
 *   • tools/list (capability discovery)
 *   • tools/call with structured + text content extraction
 *   • timeouts, HTTP status mapping, typed error surfacing
 *
 * SECURITY: access tokens are accepted via argument and used ONLY in the
 * Authorization header of the upstream request. They are never logged,
 * persisted outside the encrypted connection store, or included in errors.
 */
import type { ProviderErrorCode } from "../interfaces/external-intelligence-provider";

export const MCP_PROTOCOL_VERSION = "2025-06-18";

export class McpTransportError extends Error {
    readonly code: ProviderErrorCode;
    readonly status: number | null;
    readonly retryAfterMs: number | null;
    constructor(message: string, code: ProviderErrorCode, status: number | null = null, retryAfterMs: number | null = null) {
        super(message);
        this.name = "McpTransportError";
        this.code = code;
        this.status = status;
        this.retryAfterMs = retryAfterMs;
    }
}

export interface JsonRpcError {
    code: number;
    message: string;
}

export interface McpToolDescriptor {
    name: string;
    description?: string;
    inputSchema?: Record<string, unknown>;
    annotations?: Record<string, unknown>;
}

export interface McpCallToolResult {
    isError: boolean;
    structuredContent?: unknown;
    text: string;
    raw: unknown;
}

interface SessionState {
    initialized: boolean;
    sessionId: string | null;
    protocolVersion: string;
    serverInfo?: Record<string, unknown>;
    tools: McpToolDescriptor[] | null;
    toolsFetchedAt: number;
}

let session: SessionState | null = null;
const TOOLS_TTL_MS = 10 * 60 * 1000;

/** Test hook. */
export function resetMcpClientState(): void {
    session = null;
}

function baseHeaders(accessToken: string, sessionId: string | null): Record<string, string> {
    return {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        Authorization: `Bearer ${accessToken}`,
        ...(sessionId ? { "Mcp-Session-Id": sessionId } : {}),
    };
}

async function postRpc(
    body: Record<string, unknown>,
    accessToken: string,
    timeoutMs: number,
): Promise<{ status: number; sessionId: string | null; json: unknown; text: string }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const res = await fetch(process.env.TRADINGVIEW_MCP_URL || "https://mcp.tradingview.com/mcp", {
            method: "POST",
            headers: baseHeaders(accessToken, session?.sessionId ?? null),
            body: JSON.stringify(body),
            cache: "no-store",
            signal: controller.signal,
        });

        const sessionId = res.headers.get("mcp-session-id");
        if (sessionId && session) {
            session.sessionId = sessionId;
        }

        const text = await res.text();

        if (res.status === 401) {
            throw new McpTransportError("TradingView MCP rejected the access token (401).", "TOKEN_EXPIRED", 401);
        }
        if (res.status === 403) {
            throw new McpTransportError("TradingView MCP denied access (403).", "REAUTH_REQUIRED", 403);
        }
        if (res.status === 429) {
            const retryAfter = res.headers.get("retry-after");
            const retryAfterMs = retryAfter ? Number(retryAfter) * 1000 : 60_000;
            throw new McpTransportError("TradingView MCP rate limit reached (429).", "RATE_LIMITED", 429, Number.isFinite(retryAfterMs) ? retryAfterMs : null);
        }
        if (res.status === 404 && session?.sessionId) {
            // Expired server-side session: re-initialize once on the next call.
            session.initialized = false;
            session.sessionId = null;
            throw new McpTransportError("MCP session expired (404).", "PROVIDER_OUTAGE", 404);
        }
        if (res.status >= 500) {
            throw new McpTransportError(`TradingView MCP outage (HTTP ${res.status}).`, "PROVIDER_OUTAGE", res.status);
        }
        if (!res.ok) {
            throw new McpTransportError(`TradingView MCP request failed (HTTP ${res.status}).`, "INVALID_REQUEST", res.status);
        }

        let json: unknown = null;
        const contentType = res.headers.get("content-type") || "";
        if (contentType.includes("text/event-stream")) {
            json = parseSseRpcResponse(text);
        } else if (text) {
            try {
                json = JSON.parse(text);
            } catch {
                json = null;
            }
        }
        return { status: res.status, sessionId, json, text };
    } catch (err) {
        if (err instanceof McpTransportError) throw err;
        if (err instanceof Error && err.name === "AbortError") {
            throw new McpTransportError("TradingView MCP request timed out.", "TIMEOUT", null);
        }
        throw new McpTransportError(
            err instanceof Error ? err.message : "TradingView MCP request failed.",
            "PROVIDER_OUTAGE",
            null,
        );
    } finally {
        clearTimeout(timer);
    }
}

/** Extract the JSON-RPC response object from an SSE body (data: lines). */
function parseSseRpcResponse(text: string): unknown {
    const dataLines = text
        .split(/\r?\n/)
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trim());
    for (const line of dataLines) {
        try {
            const parsed = JSON.parse(line) as { id?: unknown; result?: unknown; error?: unknown };
            if (parsed && ("result" in parsed || "error" in parsed)) return parsed;
        } catch {
            // not the RPC response line — keep scanning
        }
    }
    return null;
}

function extractRpcError(json: unknown): JsonRpcError | null {
    if (json && typeof json === "object" && "error" in json) {
        const err = (json as { error: { code?: unknown; message?: unknown } }).error;
        if (err && typeof err === "object") {
            return {
                code: typeof err.code === "number" ? err.code : -32603,
                message: typeof err.message === "string" ? err.message : "MCP error",
            };
        }
    }
    return null;
}

function rpcResult<T>(json: unknown): T | null {
    if (json && typeof json === "object" && "result" in json) {
        return (json as { result: T }).result;
    }
    return null;
}

/** Ensure an initialized session exists. Safe under concurrency. */
export async function ensureInitialized(accessToken: string, timeoutMs: number): Promise<void> {
    if (session?.initialized) return;
    const body = {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
            protocolVersion: MCP_PROTOCOL_VERSION,
            capabilities: {},
            clientInfo: { name: "algovault", version: "1.0.0" },
        },
    };
    const { json } = await postRpc(body, accessToken, timeoutMs);
    const rpcErr = extractRpcError(json);
    if (rpcErr) throw new McpTransportError(`MCP initialize failed: ${rpcErr.message}`, "PROVIDER_OUTAGE", null);
    const result = rpcResult<Record<string, unknown>>(json);
    session = {
        initialized: true,
        sessionId: session?.sessionId ?? null,
        protocolVersion: MCP_PROTOCOL_VERSION,
        serverInfo: (result?.serverInfo as Record<string, unknown>) ?? undefined,
        tools: null,
        toolsFetchedAt: 0,
    };
    // Send the required initialized notification (fire-and-forget).
    try {
        await postRpc({ jsonrpc: "2.0", method: "notifications/initialized" }, accessToken, Math.min(timeoutMs, 5_000));
    } catch {
        // Notifications may race session teardown; not fatal.
    }
}

/** List available tools from the server (cached per process for the TTL). */
export async function listTools(accessToken: string, timeoutMs: number, force = false): Promise<McpToolDescriptor[]> {
    await ensureInitialized(accessToken, timeoutMs);
    if (!force && session?.tools && Date.now() - session.toolsFetchedAt < TOOLS_TTL_MS) {
        return session.tools;
    }
    const { json } = await postRpc({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }, accessToken, timeoutMs);
    const rpcErr = extractRpcError(json);
    if (rpcErr) throw new McpTransportError(`MCP tools/list failed: ${rpcErr.message}`, "PROVIDER_OUTAGE", null);
    const result = rpcResult<{ tools?: McpToolDescriptor[] }>(json);
    const tools = Array.isArray(result?.tools) ? result!.tools : [];
    if (session) {
        session.tools = tools;
        session.toolsFetchedAt = Date.now();
    }
    return tools;
}

export interface CallToolArgs {
    tool: string;
    args?: Record<string, unknown>;
    accessToken: string;
    timeoutMs: number;
}

/** Call a tool and normalize the response. Throws McpTransportError on failure. */
export async function callTool({ tool, args, accessToken, timeoutMs }: CallToolArgs): Promise<McpCallToolResult> {
    await ensureInitialized(accessToken, timeoutMs);
    const { json } = await postRpc(
        {
            jsonrpc: "2.0",
            id: 3,
            method: "tools/call",
            params: { name: tool, ...(args ? { arguments: args } : {}) },
        },
        accessToken,
        timeoutMs,
    );
    const rpcErr = extractRpcError(json);
    if (rpcErr) {
        // Tool-level "unknown tool" surfaces as JSON-RPC error → unsupported.
        if (rpcErr.message.toLowerCase().includes("unknown tool")) {
            throw new McpTransportError(`Tool "${tool}" is not supported by TradingView MCP.`, "UNSUPPORTED_CAPABILITY", null);
        }
        throw new McpTransportError(rpcErr.message, "INVALID_REQUEST", null);
    }
    const result = rpcResult<{ isError?: boolean; structuredContent?: unknown; content?: Array<{ type?: string; text?: string }> }>(json);
    if (!result) throw new McpTransportError("MCP tools/call returned no result.", "PROVIDER_OUTAGE", null);

    const text = Array.isArray(result.content)
        ? result.content
              .filter((c) => (c?.type ?? "text") === "text" && typeof c.text === "string")
              .map((c) => c.text as string)
              .join("\n")
        : "";
    return {
        isError: Boolean(result.isError),
        structuredContent: result.structuredContent,
        text,
        raw: result,
    };
}

/** Current session info for health reporting (no secrets). */
export function getMcpSessionInfo(): { initialized: boolean; protocolVersion: string; toolCount: number | null } {
    return {
        initialized: Boolean(session?.initialized),
        protocolVersion: session?.protocolVersion ?? MCP_PROTOCOL_VERSION,
        toolCount: session?.tools ? session.tools.length : null,
    };
}

/** Test hook — exposed for the SSE parser unit tests only. */
export const parseSseRpcResponseTestHook = parseSseRpcResponse;
