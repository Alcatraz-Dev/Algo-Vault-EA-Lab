import { NextResponse } from "next/server";
import { adminAuth } from "@/lib/firebase-admin";
import { getUnifiedRouter, checkFinancialLanguage, sanitizeFinancialLanguage, isUnifiedIntelligenceEnabled, FINANCIAL_TONE_CLAUSE, type AITask } from "@/lib/intelligence";
import { AI_TASKS } from "@/lib/intelligence/versions";
import { isProUser } from "@/lib/ai-signals/access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/ai/analyze
 * Authenticated analysis endpoint over the unified router. The client never
 * selects providers or models — only a task and optional compact context.
 *
 * Body: { task: AITask, context?: object, question?: string }
 * Free users get the fast task tier; deep tasks require Pro.
 */
const PRO_ONLY_TASKS: ReadonlySet<string> = new Set([
    "DEEP_STRATEGY_RESEARCH",
    "LONG_CONTEXT_RESEARCH",
    "HYPOTHESIS_GENERATION",
]);

export async function POST(req: Request) {
    try {
        const authHeader = req.headers.get("authorization") || "";
        const token = authHeader.replace(/^Bearer\s+/i, "");
        if (!token) {
            return NextResponse.json({ success: false, error: "UNAUTHENTICATED" }, { status: 401 });
        }
        let uid: string | null = null;
        try {
            const decoded = await adminAuth.verifyIdToken(token);
            uid = decoded.uid;
        } catch {
            return NextResponse.json({ success: false, error: "UNAUTHENTICATED" }, { status: 401 });
        }
        if (!uid || !isUnifiedIntelligenceEnabled()) {
            return NextResponse.json({ success: false, error: "UNAVAILABLE" }, { status: 404 });
        }

        const body = (await req.json().catch(() => null)) as
            | { task?: string; context?: Record<string, unknown>; question?: string; maxTokens?: number }
            | null;
        if (!body || typeof body !== "object") {
            return NextResponse.json({ success: false, error: "INVALID_REQUEST" }, { status: 400 });
        }

        const task = (body.task && (AI_TASKS as readonly string[]).includes(body.task) ? body.task : "SIGNAL_EXPLANATION") as AITask;
        if (PRO_ONLY_TASKS.has(task) && !(await isProUser(uid))) {
            return NextResponse.json({ success: false, error: "PRO_REQUIRED", task }, { status: 403 });
        }

        // Compact context only: reject oversized payloads (no raw candles).
        const contextJson = body.context ? JSON.stringify(body.context) : "";
        if (contextJson.length > 12_000) {
            return NextResponse.json(
                { success: false, error: "CONTEXT_TOO_LARGE", message: "Send the compressed MarketIntelligenceContext, not raw candles." },
                { status: 413 },
            );
        }

        const router = getUnifiedRouter();
        const res = await router.execute(
            {
                task,
                systemPrompt: `${FINANCIAL_TONE_CLAUSE} Answer factually from the provided context only.`,
                messages: [
                    {
                        role: "user",
                        content: [body.question ?? "Analyze the provided market context.", contextJson ? `Context: ${contextJson}` : ""]
                            .filter(Boolean)
                            .join("\n\n"),
                    },
                ],
                userTier: (await isProUser(uid)) ? "pro" : "free",
                maxTokens: typeof body.maxTokens === "number" && body.maxTokens > 0 && body.maxTokens <= 2000 ? body.maxTokens : undefined,
            },
            { source: "chat", userId: uid },
        );

        if (res.validationStatus !== "ok") {
            return NextResponse.json(
                {
                    success: false,
                    error: "AI_UNAVAILABLE",
                    message: "No AI provider could serve this request. Deterministic features remain available.",
                    details: res.errors ?? [],
                },
                { status: 503 },
            );
        }

        const safety = checkFinancialLanguage(res.content);
        const content = safety.safe ? res.content : sanitizeFinancialLanguage(res.content);

        return NextResponse.json({
            success: true,
            content,
            structuredData: res.structuredData ?? null,
            provider: res.provider,
            model: res.model,
            latencyMs: res.latencyMs,
            fallbackUsed: res.fallbackUsed,
            requestId: res.requestId,
            safety: safety.safe ? "pass" : "sanitized",
        });
    } catch (err) {
        console.error("[api/ai/analyze] error:", err instanceof Error ? err.message : err);
        return NextResponse.json({ success: false, error: "INTERNAL_ERROR" }, { status: 500 });
    }
}
