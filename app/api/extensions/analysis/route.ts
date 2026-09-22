import { NextRequest, NextResponse } from "next/server";
import { validateApiKey } from "@/lib/api-key-auth";
import { orchestrate } from "@/lib/agents/orchestrator";

// ─── Extension API: Request Analysis ─────────────────

export async function POST(request: NextRequest): Promise<NextResponse> {
    // Extensions authenticate via API key — presence alone is NOT enough, the
    // key must resolve to a real user (validateApiKey checks it server-side).
    const apiKey = request.headers.get("x-api-key");
    if (!apiKey) {
        return NextResponse.json({ error: "API key required" }, { status: 401 });
    }
    const uid = await validateApiKey(apiKey);
    if (!uid) {
        return NextResponse.json({ error: "Invalid API key" }, { status: 401 });
    }

    try {
        const body = await request.json();
        const { workflowId, context, pluginId } = body;

        if (!workflowId) {
            return NextResponse.json({ error: "workflowId required" }, { status: 400 });
        }

        const result = await orchestrate({
            workflowId,
            context: {
                ...context,
                user: {
                    uid,
                    context: "extension",
                    contextId: pluginId,
                },
            },
            permissions: body.permissions || {},
            testOnly: false,
        });

        return NextResponse.json({
            executionId: result.execution.id,
            status: result.execution.status,
            finalOutput: result.finalOutput,
            traces: {
                steps: result.traces.steps,
                agents: result.traces.agents,
            },
        });
    } catch (err) {
        return NextResponse.json(
            { error: err instanceof Error ? err.message : "Analysis failed" },
            { status: 400 }
        );
    }
}
