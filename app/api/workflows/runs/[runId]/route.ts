import { NextRequest } from "next/server";
import { authenticateWorkflow, deny, ok } from "../../_helpers";
import {
    getRun,
    getRunNodeTraces,
    updateRun,
} from "@/lib/workflows/database";
import { isProUser } from "@/lib/ai-signals/access";

export async function GET(request: NextRequest, { params }: { params: Promise<{ runId: string }> }) {
    const auth = await authenticateWorkflow(request);
    if (!auth.uid) return deny("Authentication required.");
    const { runId } = await params;
    const run = await getRun(auth.uid, runId);
    if (!run) return Response.json({ error: "not_found" }, { status: 404 });
    const isPro = await isProUser(auth.uid);
    if (!isPro && !auth.isAdmin) return deny();
    const traces = await getRunNodeTraces(runId);
    return ok({ run, nodes: traces });
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ runId: string }> }) {
    const auth = await authenticateWorkflow(request);
    if (!auth.uid) return deny("Authentication required.");
    const { runId } = await params;
    const body = await request.json().catch(() => ({}));
    const cancelled = await (await import("@/lib/workflows/engine")).cancelRun(auth.uid, runId);
    if (!cancelled) return Response.json({ error: "Could not cancel" }, { status: 409 });
    return ok({ cancelled: true });
}