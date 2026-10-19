import { NextRequest, NextResponse } from "next/server";
import { errMessage } from "@/lib/admin-auth";
import { requireBotStudioAccess } from "@/lib/bot-studio/auth";
import { compileAvScript } from "@/lib/bot-studio/compiler/avscript-to-strategy";
import { newStrategyId } from "@/lib/bot-studio/database";

export async function POST(request: NextRequest) {
    const access = await requireBotStudioAccess(request);
    if (!access) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    try {
        const body = await request.json();
        const source: string = body?.source;

        if (typeof source !== "string") {
            return NextResponse.json(
                { ok: false, error: "Invalid AvScript source code. Expected a string." },
                { status: 400 }
            );
        }

        const result = compileAvScript(source, typeof body?.strategyId === "string" && body.strategyId.trim() ? body.strategyId.trim() : newStrategyId());
        return NextResponse.json(result);
    } catch (error) {
        return NextResponse.json(
            { ok: false, error: errMessage(error, "Failed to compile AvScript strategy") },
            { status: 500 }
        );
    }
}
