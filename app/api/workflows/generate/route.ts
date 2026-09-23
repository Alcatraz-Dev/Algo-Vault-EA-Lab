import { NextRequest } from "next/server";
import { generateWorkflowDraft, summarizeValidation, needsRiskGuard, nodePermissionClass, NODE_CATEGORY_LABELS } from "@/lib/workflows/ai-builder";
import { isProUser } from "@/lib/ai-signals/access";
import { authenticateWorkflow, deny, ok } from "../_helpers";

export async function POST(request: NextRequest) {
    const auth = await authenticateWorkflow(request);
    if (!auth.uid) return deny("Authentication required.");
    const isPro = await isProUser(auth.uid);
    if (!isPro && !auth.isAdmin) return deny();

    const ent = await (await import("@/lib/workflows/limits")).resolveEntitlement(auth.uid, auth.isAdmin);
    if (!ent.limits.aiBuilderEnabled && !auth.isAdmin) {
        return Response.json({ error: "AI Builder requires Pro", hasPro: false, upgrade: true }, { status: 403 });
    }

    const body = await request.json().catch(() => ({}));
    const prompt = String(body.prompt || "").trim();
    if (!prompt) return Response.json({ error: "prompt required" }, { status: 400 });

    const { draft, validation } = await generateWorkflowDraft(auth.uid, prompt);
    return ok({
        draft,
        validation,
        summary: summarizeValidation(validation),
        nodePermissionClass,
        needsRiskGuard,
        categories: NODE_CATEGORY_LABELS,
    });
}

export async function GET(request: NextRequest) {
    const auth = await authenticateWorkflow(request);
    if (!auth.uid) return deny("Authentication required.");
    const isPro = await isProUser(auth.uid);
    if (!isPro && !auth.isAdmin) return deny();
    const { getDraft } = await import("@/lib/workflows/database");
    const drafts = await (await import("@/lib/workflows/database")).listDrafts(auth.uid).catch(() => []);
    return ok(drafts);
}