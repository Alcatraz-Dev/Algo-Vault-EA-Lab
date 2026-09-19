import { NextRequest, NextResponse } from "next/server";
import { authenticate } from "@/lib/admin-auth";
import { getGeneratedEA, updateGeneratedEA } from "@/lib/strategy-lab/ea-storage";
import { compileMQL5 } from "@/lib/strategy-lab/ea/compile";

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

export async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ eaId: string }> }
) {
    try {
        const token = await authenticate(request);
        if (!token) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: corsHeaders });
        }
        const { eaId } = await params;
        const ea = await getGeneratedEA(token.uid, eaId);
        if (!ea) {
            return NextResponse.json({ error: "Not found" }, { status: 404, headers: corsHeaders });
        }
        if (!ea.code) {
            return NextResponse.json({ error: "This EA has no MQL5 source to compile." }, { status: 400, headers: corsHeaders });
        }

        const fileName = ea.eaVersion
            ? `${ea.name.replace(/[^a-zA-Z0-9._-]/g, "_")}_${ea.symbol}_v${ea.eaVersion}.mq5`
            : `${ea.name.replace(/[^a-zA-Z0-9._-]/g, "_")}_${ea.symbol}.mq5`;

        const result = await compileMQL5(ea.code, fileName, { timeoutMs: 150_000 });

        const compiledAt = Date.now();
        await updateGeneratedEA(token.uid, eaId, {
            compiled: result.success,
            compileReport: {
                compiled: result.success,
                errors: result.errors,
                warnings: result.warnings,
                compilerOutput: result.compilerOutput,
                compiledAt,
                method: result.method,
            },
        });

        return NextResponse.json(
            {
                success: result.success,
                error: result.success ? undefined : result.errors.join(" | ") || "Compilation failed.",
                compiled: result.success,
                method: result.method,
                errors: result.errors,
                warnings: result.warnings,
                compilerOutput: result.compilerOutput,
                compiledAt,
                notes: result.notes,
            },
            { status: result.success ? 200 : 422, headers: corsHeaders }
        );
    } catch (err: unknown) {
        console.error("[strategy-lab/ea/:id/compile POST]", err);
        return NextResponse.json({ error: err instanceof Error ? err.message : "Compilation failed" }, { status: 500, headers: corsHeaders });
    }
}