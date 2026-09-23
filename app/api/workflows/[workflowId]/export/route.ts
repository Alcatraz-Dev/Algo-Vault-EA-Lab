/**
 * GET /api/workflows/[workflowId]/export
 *
 * Returns a sanitized portable definition of the caller's workflow so it can
 * be saved, shared, or re-imported. Strips:
 *   - userId, status, version, runtime fields (lastRunAt, lastRunStatus,
 *     versionHistory, createdBy, sourceMarketplaceId)
 *   - webhookSecretHash
 *   - secret config values (fields declared `secret`/`sensitive` in the registry)
 */

import { NextRequest } from "next/server";
import { getWorkflow } from "@/lib/workflows/database";
import { isProUser } from "@/lib/ai-signals/access";
import { authenticateWorkflow, deny, ok } from "../../_helpers";
import { toPortable } from "@/lib/workflows/portable";

export async function GET(request: NextRequest, { params }: { params: Promise<{ workflowId: string }> }) {
    const auth = await authenticateWorkflow(request);
    if (!auth.uid) return deny("Authentication required.");
    const { workflowId } = await params;
    const workflow = await getWorkflow(auth.uid, workflowId);
    if (!workflow) return Response.json({ error: "not_found" }, { status: 404 });
    const isPro = await isProUser(auth.uid);
    if (!isPro && !auth.isAdmin) return deny();

    return ok(toPortable(workflow));
}