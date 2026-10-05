/**
 * POST /api/terminal/chat — AlgoVault Trading Chat (Phase 5 §22–§29).
 *
 * The terminal builds the context from the same engine payloads every other
 * panel renders; the server re-sanitises it, re-stamps its age and renders the
 * DETERMINISTIC FACTS block itself. The model only ever receives facts that
 * were produced by AlgoVault engines plus the user's question, and the system
 * instructions require it to keep its own words in a separate INTERPRETATION
 * section (Phase 5 §26).
 *
 * Nothing here invents a market value. When a section is unavailable the
 * payload says so in `missing[]` and the facts block prints "unavailable".
 */

import { NextRequest, NextResponse } from "next/server";
import { authenticate } from "@/lib/admin-auth";
import { chatCompletionWithFallback } from "@/lib/ai";
import { isProUser } from "@/lib/ai-signals/access";
import {
    chatSystemInstructions,
    formatContextFacts,
    sanitizeChatContext,
} from "@/lib/terminal/chat-context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_QUESTION = 1_500;
const MAX_HISTORY = 8;
const FREE_TURNS = 6;

interface Turn {
    role: "user" | "assistant";
    content: string;
}

function clip(v: unknown, max: number): string {
    return typeof v === "string" ? v.slice(0, max) : "";
}

export async function POST(request: NextRequest) {
    try {
        const user = await authenticate(request);
        if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

        const body = (await request.json()) as {
            question?: unknown;
            context?: unknown;
            history?: unknown;
        };

        const question = clip(body.question, MAX_QUESTION).trim();
        if (!question) return NextResponse.json({ error: "Question required." }, { status: 400 });

        const context = sanitizeChatContext(body.context, question);
        if (!context) {
            return NextResponse.json(
                {
                    error: "Terminal context unavailable.",
                    detail: "The chat only answers with a valid terminal context attached.",
                },
                { status: 422 }
            );
        }

        const isPro = await isProUser(user.uid);

        const history: Turn[] = Array.isArray(body.history)
            ? body.history
                  .slice(0, isPro ? MAX_HISTORY : FREE_TURNS)
                  .map((t: unknown) => ({
                      role: (t as Turn)?.role === "assistant" ? ("assistant" as const) : ("user" as const),
                      content: clip((t as Turn)?.content, 4_000),
                  }))
                  .filter((t: Turn) => t.content.length > 0)
            : [];

        const facts = formatContextFacts(context);

        const messages = [
            ...history.map((t) => ({ role: t.role, content: t.content })),
            {
                role: "user" as const,
                content: [
                    "DETERMINISTIC FACTS (produced by AlgoVault engines — treat as the only market truth)",
                    "==================================================================================",
                    facts,
                    "==================================================================================",
                    "USER QUESTION",
                    question,
                ].join("\n"),
            },
        ];

        const fallback = [
            "The AI provider is not available right now, so no interpretation was generated.",
            "",
            "The deterministic terminal context for this question is:",
            "",
            "```",
            facts,
            "```",
        ].join("\n");

        const answer = await chatCompletionWithFallback(messages, chatSystemInstructions(), fallback);

        return NextResponse.json(
            {
                success: true,
                answer,
                // Echoed so the client can show exactly what the model saw.
                missing: context.missing,
                symbol: context.market.symbol,
                timeframe: context.market.timeframe,
                isPro,
                generatedAt: Date.now(),
            },
            { status: 200 }
        );
    } catch (err) {
        console.error("[POST /api/terminal/chat]", err);
        return NextResponse.json({ error: err instanceof Error ? err.message : "Chat failed" }, { status: 500 });
    }
}
