import { NextRequest, NextResponse } from "next/server";
import { ai } from "@/lib/ai";
import { AIConfig } from "@/lib/ai/config";
import { isLoopbackRequest } from "@/lib/ai/local-endpoint";
import {
    chatAccessConfig,
    chatRateLimitHeaders,
    checkChatRateLimit,
    evaluateChatOrigin,
    resolveChatCaller,
} from "@/lib/ai/chat-access";
// Lazy Admin SDK access: keeps `server-only` and firebase-admin out of the
// module graph for tests and for any non-auth code path.
import { isChatAdmin, verifyChatToken } from "@/lib/ai/chat-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/ai/chat — authenticated AI chat.
 *
 * Access control (three independent layers):
 *  1. Origin policy: same-origin, the Chrome extension and an explicit
 *     `AI_CHAT_ALLOWED_ORIGINS` allowlist. Never `*`. Origin is not identity.
 *  2. Authentication: a Firebase ID token verified by the existing Admin SDK
 *     wrapper. The verified uid is the only identity used for rate limiting
 *     and accounting — never a client-supplied id.
 *  3. Per-user rate limit (in-memory, per server instance).
 *
 * Provider diagnostics (`fallbackErrors`) are only returned to admins.
 */

function httpStatusForError(code: string, explicit?: number): number {
    if (typeof explicit === "number" && explicit > 0) return explicit;
    switch (code) {
        case "INVALID_REQUEST":
            return 400;
        case "INVALID_API_KEY":
            return 401;
        case "QUOTA_EXCEEDED":
            return 402;
        case "PAID_MODEL_BLOCKED":
            return 403;
        case "MODEL_UNAVAILABLE":
            return 404;
        case "RATE_LIMITED":
        case "AI_BUDGET_EXCEEDED":
            return 429;
        case "TIMEOUT":
            return 504;
        case "RESOURCE_EXHAUSTED":
        case "PROVIDER_UNAVAILABLE":
        case "NO_FREE_PROVIDER":
            return 503;
        default:
            return 500;
    }
}

function withHeaders(
    base: Record<string, string>,
    extra: Record<string, string>,
): Record<string, string> {
    return { ...base, ...extra };
}

export async function OPTIONS(req: NextRequest) {
    const origin = req.headers.get("origin");
    const decision = evaluateChatOrigin(origin, req.headers.get("host"));

    if (origin && !decision.allowed) {
        return NextResponse.json(
            { success: false, error: "ORIGIN_NOT_ALLOWED" },
            { status: 403 },
        );
    }

    return new NextResponse(null, { status: 204, headers: decision.headers });
}

export async function POST(req: NextRequest) {
    const access = chatAccessConfig();
    const origin = req.headers.get("origin");
    const decision = evaluateChatOrigin(origin, req.headers.get("host"));
    const cors = decision.headers;

    // Reject a cross-origin browser request before doing any work. A non-browser
    // client sends no Origin and still has to authenticate below.
    if (origin && !decision.allowed) {
        return NextResponse.json(
            { success: false, error: "ORIGIN_NOT_ALLOWED", message: "Origin not allowed." },
            { status: 403, headers: cors },
        );
    }

    // ── Authentication ────────────────────────────────────────────────────
    const caller = await resolveChatCaller(
        req.headers.get("authorization"),
        verifyChatToken,
    );
    if (!caller) {
        return NextResponse.json(
            {
                success: false,
                error: "UNAUTHENTICATED",
                message: "A valid Firebase ID token is required.",
            },
            { status: 401, headers: cors },
        );
    }

    // ── Rate limit (keyed only by the verified uid) ───────────────────────
    const limit = checkChatRateLimit(caller.uid, access);
    const limitHeaders = chatRateLimitHeaders(limit);
    if (!limit.success) {
        const retryAfter = Math.max(1, limit.reset - Math.floor(Date.now() / 1000));
        return NextResponse.json(
            {
                success: false,
                error: "RATE_LIMITED",
                message: "Too many AI requests. Retry later.",
                retryAfterMs: retryAfter * 1000,
            },
            {
                status: 429,
                headers: withHeaders(cors, {
                    ...limitHeaders,
                    "Retry-After": String(retryAfter),
                }),
            },
        );
    }

    try {
        const body = await req.json().catch(() => null);

        if (!body || typeof body !== "object") {
            return NextResponse.json(
                { success: false, error: "INVALID_REQUEST", message: "Request body must be a valid JSON object." },
                { status: 400, headers: withHeaders(cors, limitHeaders) }
            );
        }

        const { messages, systemPrompt, temperature, maxTokens, model, provider, mode, context } = body;

        if (mode !== undefined && mode !== "auto" && mode !== "strict") {
            return NextResponse.json(
                { success: false, error: "INVALID_REQUEST", message: "'mode' must be \"auto\" or \"strict\"." },
                { status: 400, headers: withHeaders(cors, limitHeaders) }
            );
        }

        if (provider !== undefined && typeof provider !== "string") {
            return NextResponse.json(
                { success: false, error: "INVALID_REQUEST", message: "'provider' must be a string." },
                { status: 400, headers: withHeaders(cors, limitHeaders) }
            );
        }

        if (model !== undefined && model !== null && typeof model !== "string") {
            return NextResponse.json(
                { success: false, error: "INVALID_REQUEST", message: "'model' must be a string." },
                { status: 400, headers: withHeaders(cors, limitHeaders) }
            );
        }

        // Local inference is desktop/self-hosted only. A public deployment must
        // never expose its loopback Ollama instance, even when local AI was
        // enabled on it by mistake, and even to an authenticated caller: the
        // request itself has to arrive from this machine.
        if (typeof provider === "string" && provider.trim().toLowerCase() === "ollama") {
            if (!AIConfig.localAIEnabled) {
                return NextResponse.json(
                    {
                        success: false,
                        error: "PROVIDER_UNAVAILABLE",
                        provider: "ollama",
                        message: "Local AI is not enabled on this server.",
                    },
                    { status: 403, headers: withHeaders(cors, limitHeaders) }
                );
            }
            if (!isLoopbackRequest(req.headers)) {
                return NextResponse.json(
                    {
                        success: false,
                        error: "PROVIDER_UNAVAILABLE",
                        provider: "ollama",
                        message: "Local AI is only reachable from this machine.",
                    },
                    { status: 403, headers: withHeaders(cors, limitHeaders) }
                );
            }
        }

        if (!Array.isArray(messages) || messages.length === 0) {
            return NextResponse.json(
                { success: false, error: "INVALID_REQUEST", message: "'messages' array is required and must not be empty." },
                { status: 400, headers: withHeaders(cors, limitHeaders) }
            );
        }

        if (messages.length > 100) {
            return NextResponse.json(
                { success: false, error: "INVALID_REQUEST", message: "Too many messages; the maximum is 100." },
                { status: 400, headers: withHeaders(cors, limitHeaders) }
            );
        }

        let totalChars = 0;
        for (const msg of messages) {
            if (!msg || typeof msg !== "object" || typeof msg.content !== "string" || !msg.role) {
                return NextResponse.json(
                    { success: false, error: "INVALID_REQUEST", message: "Each message must have valid 'role' and 'content' strings." },
                    { status: 400, headers: withHeaders(cors, limitHeaders) }
                );
            }
            totalChars += msg.content.length;
        }
        if (totalChars > 200_000) {
            return NextResponse.json(
                { success: false, error: "INVALID_REQUEST", message: "Message payload is too large." },
                { status: 413, headers: withHeaders(cors, limitHeaders) }
            );
        }

        const response = await ai.chat({
            messages,
            systemPrompt,
            temperature:
                typeof temperature === "number"
                    ? Math.min(2, Math.max(0, temperature))
                    : undefined,
            maxTokens:
                typeof maxTokens === "number" && maxTokens > 0
                    ? Math.min(32_000, Math.round(maxTokens))
                    : 8000,
            model,
            provider,
            mode,
            signal: req.signal,
        }, {
            // Accounting context. `userId` is the verified uid, never a body
            // field, so budgets and usage cannot be attributed to another user.
            source: "chat",
            userId: caller.uid,
        });

        // Provider topology is operational detail: only an admin may see which
        // fallbacks ran. An ordinary user still gets the answer and the winner.
        const fallbackErrors = response.fallbackErrors ?? [];
        const includeDiagnostics = fallbackErrors.length > 0
            ? await isChatAdmin(caller.uid)
            : false;

        return NextResponse.json(
            {
                success: true,
                provider: response.provider,
                model: response.model,
                content: response.content,
                finishReason: response.finishReason ?? "stop",
                truncated: response.truncated ?? false,
                requestedProvider: response.requestedProvider,
                requestedModel: response.requestedModel,
                substituted: response.substituted === true,
                fallbackErrors: includeDiagnostics
                    ? fallbackErrors.map((e) => ({
                          code: e.code,
                          provider: e.provider,
                          model: e.model,
                          retryAfterMs: e.retryAfterMs,
                      }))
                    : [],
                contextReceived: Boolean(context && typeof context === "object"),
            },
            { status: 200, headers: withHeaders(cors, limitHeaders) }
        );
    } catch (err: unknown) {
        console.error("[AI Chat API Error]:", err);
        const provErr = (err && typeof err === "object" && "code" in err)
            ? (err as { code: string; provider?: string; message: string; status?: number })
            : { code: "UNKNOWN_ERROR", message: "" };

        const retryAfterMs =
            "retryAfterMs" in provErr && typeof provErr.retryAfterMs === "number"
                ? provErr.retryAfterMs
                : undefined;
        const headers = withHeaders(cors, limitHeaders);
        if (retryAfterMs !== undefined) {
            headers["Retry-After"] = String(Math.max(1, Math.ceil(retryAfterMs / 1000)));
        }

        // Unknown failures return a generic message: no internal paths, stack
        // details or upstream payloads are forwarded to the client.
        const message = provErr.code === "UNKNOWN_ERROR"
            ? "The AI request failed."
            : provErr.message;

        return NextResponse.json(
            {
                success: false,
                error: provErr.code,
                provider: provErr.provider,
                message,
                ...(retryAfterMs !== undefined ? { retryAfterMs } : {}),
            },
            { status: httpStatusForError(provErr.code, provErr.status), headers }
        );
    }
}
