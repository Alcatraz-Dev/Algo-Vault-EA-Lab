import { NextRequest, NextResponse } from "next/server";
import { ai } from "@/lib/ai";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const corsHeaders: Record<string, string> = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export async function OPTIONS() {
    return NextResponse.json(null, { status: 204, headers: corsHeaders });
}

export async function POST(req: NextRequest) {
    try {
        const body = await req.json().catch(() => null);

        if (!body || typeof body !== "object") {
            return NextResponse.json(
                { success: false, error: "INVALID_REQUEST", message: "Request body must be a valid JSON object." },
                { status: 400, headers: corsHeaders }
            );
        }

        const { messages, systemPrompt, temperature, maxTokens, model, context } = body;

        if (!Array.isArray(messages) || messages.length === 0) {
            return NextResponse.json(
                { success: false, error: "INVALID_REQUEST", message: "'messages' array is required and must not be empty." },
                { status: 400, headers: corsHeaders }
            );
        }

        for (const msg of messages) {
            if (!msg || typeof msg !== "object" || typeof msg.content !== "string" || !msg.role) {
                return NextResponse.json(
                    { success: false, error: "INVALID_REQUEST", message: "Each message must have valid 'role' and 'content' strings." },
                    { status: 400, headers: corsHeaders }
                );
            }
        }

        const response = await ai.chat({
            messages,
            systemPrompt,
            temperature,
            maxTokens: typeof maxTokens === "number" && maxTokens > 0 ? maxTokens : 8000,
            model,
        }, {
            // Accounting context only, passed separately from the request so it
            // can never be forwarded to a provider upstream. This endpoint is
            // unauthenticated, so `userId` is deliberately left absent rather
            // than invented: a made-up id would funnel every anonymous caller
            // into one shared per-user budget bucket.
            source: "chat",
        });

        return NextResponse.json(
            {
                success: true,
                provider: response.provider,
                model: response.model,
                content: response.content,
                finishReason: response.finishReason ?? "stop",
                truncated: response.truncated ?? false,
                contextReceived: Boolean(context && typeof context === "object"),
            },
            { status: 200, headers: corsHeaders }
        );
    } catch (err: unknown) {
        console.error("[AI Chat API Error]:", err);
        const provErr = (err && typeof err === "object" && "code" in err)
            ? (err as { code: string; provider?: string; message: string; status?: number })
            : { code: "UNKNOWN_ERROR", message: String(err) };

        return NextResponse.json(
            {
                success: false,
                error: provErr.code,
                provider: provErr.provider,
                message: provErr.message,
            },
            { status: provErr.status || 500, headers: corsHeaders }
        );
    }
}