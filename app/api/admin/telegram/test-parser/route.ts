import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { parseFastSignal } from "@/features/telegram-signals/parser/fast-parser";
import { parseAiSignal } from "@/features/telegram-signals/parser/ai-parser";

export async function POST(request: NextRequest) {
    try {
        const adminToken = await requireAdmin(request);
        if (!adminToken) {
            return NextResponse.json(
                { error: "Unauthorized. Admin access required." },
                { status: 403 }
            );
        }

        const body = await request.json().catch(() => ({}));
        const { rawText, useAiFallback } = body;

        if (!rawText || typeof rawText !== "string" || !rawText.trim()) {
            return NextResponse.json(
                { error: "rawText parameter is required for testing parser" },
                { status: 400 }
            );
        }

        let parsedResult = parseFastSignal(rawText);

        if (!parsedResult.isSignal && useAiFallback) {
            parsedResult = await parseAiSignal(rawText, parsedResult);
        }

        return NextResponse.json({
            success: true,
            parsedResult,
            message: "Parser test completed. No trade was executed.",
        });
    } catch (err: any) {
        console.error("[POST /api/admin/telegram/test-parser]", err);
        return NextResponse.json(
            { error: err?.message || "Internal server error" },
            { status: 500 }
        );
    }
}
