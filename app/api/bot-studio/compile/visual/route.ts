import { NextRequest, NextResponse } from "next/server";
import { errMessage } from "@/lib/admin-auth";
import { requireBotStudioAccess } from "@/lib/bot-studio/auth";
import { compileNodeGraph } from "@/lib/bot-studio/compiler/visual-to-strategy";
import { newStrategyId } from "@/lib/bot-studio/database";
import type { NodeGraph } from "@/lib/bot-studio/compiler/types";

export async function POST(request: NextRequest) {
    const access = await requireBotStudioAccess(request);
    if (!access) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    try {
        const body = await request.json();
        const graph: NodeGraph = body?.graph;

        if (!graph || !Array.isArray(graph.nodes) || !Array.isArray(graph.edges)) {
            return NextResponse.json(
                { ok: false, error: "Invalid visual graph. Expected { nodes: [], edges: [] }." },
                { status: 400 }
            );
        }

        const result = compileNodeGraph(graph, typeof body?.strategyId === "string" && body.strategyId.trim() ? body.strategyId.trim() : newStrategyId());
        return NextResponse.json(result);
    } catch (error) {
        return NextResponse.json(
            { ok: false, error: errMessage(error, "Failed to compile visual strategy") },
            { status: 500 }
        );
    }
}
