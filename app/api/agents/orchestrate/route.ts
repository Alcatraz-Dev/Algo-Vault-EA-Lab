import { NextRequest, NextResponse } from "next/server";
import { adminAuth } from "@/lib/firebase-admin";
import { validateApiKey } from "@/lib/api-key-auth";
import { orchestrate } from "@/lib/agents/orchestrator";
import { getAgent } from "@/lib/agents/catalog";
import { AgentContract, WorkflowDefinition, AgentOutput, PermissionSet, OrchestratorInput } from "@/lib/agents/types";
import { loadLatestCrossAssetContext } from "@/lib/cross-asset/service";

export { getAgent };
export type { AgentContract, WorkflowDefinition, AgentOutput, OrchestratorInput, PermissionSet };

export async function POST(request: NextRequest): Promise<NextResponse> {
    const authHeader = request.headers.get("authorization");
    const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
    let uid: string | null = null;

    if (token) {
        try {
            const decoded = await adminAuth.verifyIdToken(token);
            uid = decoded.uid;
        } catch {
            // Fall through to API key
        }
    }

    if (!uid) {
        const apiKey = request.headers.get("x-api-key");
        if (apiKey) {
            uid = await validateApiKey(apiKey);
        }
    }

    if (!uid) {
        return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }

    try {
        const body = await request.json();
        // Phase 16 §33/§34: the cross-asset graph is loaded SERVER-SIDE from the
        // canonical stored snapshot — client-supplied context can never stand in
        // for measured graph data.
        const crossAsset = await loadLatestCrossAssetContext().catch(() => null);
        const input: OrchestratorInput = {
            workflowId: body.workflowId,
            workflowVersion: body.workflowVersion,
            context: {
                ...body.context,
                crossAsset,
                user: {
                    uid,
                    displayName: body.context?.user?.displayName,
                    context: "plugin",
                    contextId: body.pluginId || body.context?.user?.contextId,
                },
            },
            permissions: body.permissions,
            testOnly: body.testOnly || false,
            timeoutMs: body.timeoutMs,
        };

        const result = await orchestrate(input);
        return NextResponse.json({
            executionId: result.execution.id,
            status: result.execution.status,
            durationMs: result.durationMs,
            finalOutput: result.finalOutput,
        });
    } catch (err) {
        return NextResponse.json(
            { error: err instanceof Error ? err.message : "Orchestration failed" },
            { status: 400 }
        );
    }
}
