import { readFileSync } from "node:fs";
import { NextRequest } from "next/server";
import { OPTIONS, POST } from "@/app/api/ai/chat/route";
import {
    chatRateLimitKey,
    checkChatRateLimit,
    isChatOriginAllowed,
    normalizeOrigin,
    resolveChatCaller,
} from "../chat-access";

function chatRequest(
    headers: Record<string, string>,
    body: Record<string, unknown> = { messages: [{ role: "user", content: "hi" }] },
): NextRequest {
    return new NextRequest("http://localhost:3000/api/ai/chat", {
        method: "POST",
        headers: {
            "content-type": "application/json",
            host: "localhost:3000",
            ...headers,
        },
        body: JSON.stringify(body),
    });
}

function optionsRequest(headers: Record<string, string>): NextRequest {
    return new NextRequest("http://localhost:3000/api/ai/chat", {
        method: "OPTIONS",
        headers: { host: "localhost:3000", ...headers },
    });
}

async function json(res: Response): Promise<Record<string, unknown>> {
    return (await res.json().catch(() => ({}))) as Record<string, unknown>;
}

export async function runChatEndpointTests(): Promise<boolean> {
    console.log("--- Chat Endpoint Access Control Tests ---");
    let passed = true;
    const check = (cond: boolean, label: string) => {
        if (cond) console.log(`  PASS: ${label}`);
        else {
            console.error(`  FAIL: ${label}`);
            passed = false;
        }
    };

    const saved = {
        origins: process.env.AI_CHAT_ALLOWED_ORIGINS,
        rate: process.env.AI_CHAT_RATE_LIMIT_PER_MINUTE,
    };
    const restore = () => {
        if (saved.origins === undefined) delete process.env.AI_CHAT_ALLOWED_ORIGINS;
        else process.env.AI_CHAT_ALLOWED_ORIGINS = saved.origins;
        if (saved.rate === undefined) delete process.env.AI_CHAT_RATE_LIMIT_PER_MINUTE;
        else process.env.AI_CHAT_RATE_LIMIT_PER_MINUTE = saved.rate;
    };

    try {
        delete process.env.AI_CHAT_ALLOWED_ORIGINS;

        // 1. Unauthenticated requests are refused before any AI work.
        {
            const res = await POST(chatRequest({}));
            const body = await json(res);
            check(res.status === 401, "an unauthenticated chat request is rejected with 401");
            check(body.error === "UNAUTHENTICATED", "the error is an explicit authentication failure");
            check(!("fallbackErrors" in body), "no provider diagnostics are returned to anonymous callers");
            check(!("provider" in body), "no provider identity is returned to anonymous callers");
        }

        // 2. A disallowed browser origin is rejected before authentication.
        {
            const res = await POST(chatRequest({ origin: "https://evil.example" }));
            const body = await json(res);
            check(res.status === 403, "a disallowed Origin is rejected with 403");
            check(body.error === "ORIGIN_NOT_ALLOWED", "the origin rejection is explicit");
            check(!res.headers.get("access-control-allow-origin"), "no wildcard or echo is sent to a disallowed origin");
        }

        // 3. CORS does not authenticate: same-origin still needs a token.
        {
            const res = await POST(chatRequest({ origin: "http://localhost:3000" }));
            const body = await json(res);
            check(res.status === 401, "a same-origin request without a token is still rejected");
            check(
                res.headers.get("access-control-allow-origin") === "http://localhost:3000",
                "the same-origin response carries the exact allowed origin",
            );
            check(body.error === "UNAUTHENTICATED", "CORS does not stand in for authentication");
        }

        // 4. An explicitly allowlisted origin is accepted for CORS, not auth.
        {
            process.env.AI_CHAT_ALLOWED_ORIGINS = "https://app.example";
            const res = await POST(chatRequest({ origin: "https://app.example" }));
            check(res.status === 401, "an allowlisted origin still requires a token");
            check(
                res.headers.get("access-control-allow-origin") === "https://app.example",
                "the allowlisted origin is echoed exactly",
            );
            check(
                res.headers.get("vary")?.toLowerCase().includes("origin") === true,
                "the response varies on Origin",
            );
        }

        // 5. Preflight behaviour.
        {
            const allowed = await OPTIONS(optionsRequest({ origin: "http://localhost:3000" }));
            check(allowed.status === 204, "a same-origin preflight is accepted");
            check(
                allowed.headers.get("access-control-allow-origin") === "http://localhost:3000",
                "the preflight echoes the allowed origin",
            );
            check(
                allowed.headers.get("access-control-allow-headers")?.toLowerCase().includes("authorization") === true,
                "the preflight allows the Authorization header",
            );

            const denied = await OPTIONS(optionsRequest({ origin: "https://evil.example" }));
            check(denied.status === 403, "a disallowed preflight is refused");
            check(!denied.headers.get("access-control-allow-origin"), "the refused preflight sends no CORS grant");
        }

        // 6. The Chrome extension remains a first-party browser client.
        {
            const extensionOrigin = "chrome-extension://abcdefghijklmnop";
            const preflight = await OPTIONS(optionsRequest({ origin: extensionOrigin }));
            check(preflight.status === 204, "the extension preflight is accepted");
            check(
                preflight.headers.get("access-control-allow-origin") === extensionOrigin,
                "the extension origin is echoed exactly",
            );
            const res = await POST(chatRequest({ origin: extensionOrigin }));
            check(res.status === 401, "the extension is still required to authenticate");
        }

        // 7. A malformed or wildcard origin fails closed.
        {
            check(!isChatOriginAllowed("not-a-url", "localhost:3000", []), "a malformed Origin is rejected");
            check(!isChatOriginAllowed("*", "localhost:3000", []), "a wildcard Origin is rejected");
            check(isChatOriginAllowed(null, "localhost:3000", []), "a non-browser request has no Origin to reject");
        }

        // 8. An invalid credential is rejected without leaking details.
        {
            const res = await POST(chatRequest({ authorization: "Bearer not-a-real-token" }));
            const body = await json(res);
            check(res.status === 401, "an invalid bearer token is rejected");
            check(body.error === "UNAUTHENTICATED", "the invalid token error is explicit");
            check(!("fallbackErrors" in body) && !("stack" in body), "no diagnostics or stack are returned");
        }

        // 9. Caller resolution uses only the verified credential.
        {
            check(await resolveChatCaller(null, async () => ({ uid: "u1" })) === null, "a missing Authorization header is rejected");
            check(await resolveChatCaller("Basic abc", async () => ({ uid: "u1" })) === null, "a non-bearer scheme is rejected");
            check(await resolveChatCaller("Bearer ", async () => ({ uid: "u1" })) === null, "an empty bearer token is rejected");
            check(await resolveChatCaller("Bearer x", async () => null) === null, "a failed verification is rejected");
            check(
                await resolveChatCaller("Bearer x", async () => { throw new Error("boom"); }) === null,
                "a throwing verifier fails closed",
            );

            let seen = "";
            const caller = await resolveChatCaller("Bearer good-token", async (token) => {
                seen = token;
                return { uid: "verified-uid" };
            });
            check(caller?.uid === "verified-uid", "a verified token yields the uid");
            check(seen === "good-token", "the verifier receives only the token");
        }

        // 10. Rate limits are per verified user and cannot be steered by body ids.
        {
            const suffix = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
            const uidA = `audit-a-${suffix}`;
            const uidB = `audit-b-${suffix}`;
            const config = { allowedOrigins: [], rateLimitMax: 2, rateLimitWindowMs: 60_000 };
            check(chatRateLimitKey(uidA) === `ai-chat:${uidA}`, "the limiter key is derived from the uid");

            const first = checkChatRateLimit(uidA, config);
            const second = checkChatRateLimit(uidA, config);
            const third = checkChatRateLimit(uidA, config);
            check(first.success && second.success, "requests inside the window are allowed");
            check(!third.success, "the request past the window limit is refused");
            check(third.remaining === 0, "the refused request reports no remaining budget");

            const other = checkChatRateLimit(uidB, config);
            check(other.success, "another authenticated user has an independent window");
            check(other.remaining === 1, "the other user's budget was not consumed");

            // A caller-supplied id cannot select another user's bucket: the
            // route passes only the verified uid to the limiter.
            check(chatRateLimitKey(uidA) !== chatRateLimitKey("body-supplied-id"), "a body id is not a rate-limit identity");
        }

        // 11. The route is wired to the guards (source-level contract).
        {
            const source = readFileSync("app/api/ai/chat/route.ts", "utf8");
            const auth = readFileSync("lib/ai/chat-auth.ts", "utf8");
            check(
                source.includes("verifyChatToken") && auth.includes("authenticateToken"),
                "the route verifies Firebase ID tokens through the existing Admin wrapper",
            );
            check(source.includes("checkChatRateLimit"), "the route enforces the per-user rate limit");
            check(source.includes("evaluateChatOrigin"), "the route enforces the origin policy");
            check(source.includes("userId: caller.uid"), "accounting uses the verified uid");
            check(
                !source.includes('"Access-Control-Allow-Origin": "*"'),
                "the route no longer emits a wildcard CORS header",
            );
        }

        // 12. Normalisation keeps extension origins usable.
        {
            check(
                normalizeOrigin("chrome-extension://abc") === "chrome-extension://abc",
                "chrome-extension origins are canonicalised, not opaque",
            );
            check(normalizeOrigin("http://localhost:3000/") === "http://localhost:3000", "trailing slashes are normalised");
        }
    } finally {
        restore();
    }

    return passed;
}
