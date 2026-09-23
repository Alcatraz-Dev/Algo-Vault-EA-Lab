import { NextRequest } from "next/server";
import {
    listMarketplaceItems,
    getMarketplaceItem,
    upsertMarketplaceItem,
    incrementMarketplaceInstalls,
    deleteMarketplaceItem,
    saveWorkflow,
    getWorkflow,
} from "@/lib/workflows/database";
import { resolveEntitlement } from "@/lib/workflows/limits";
import { isProUser } from "@/lib/ai-signals/access";
import { authenticateWorkflow, deny, ok } from "../_helpers";
import { WorkflowAutomation } from "@/lib/workflows/types";

export async function GET(request: NextRequest) {
    const auth = await authenticateWorkflow(request);
    if (!auth.uid) return deny("Authentication required.");
    const isPro = await isProUser(auth.uid);
    if (!isPro && !auth.isAdmin) return deny();
    const items = await listMarketplaceItems();
    return ok(items);
}

export async function POST(request: Request) {
    const auth = await authenticateWorkflow(request as NextRequest);
    if (!auth.uid) return deny("Authentication required.");
    if (!auth.isAdmin) return deny("Admin only.");
    const body = await request.json().catch(() => ({}));
    const item = {
        id: body.id ?? `tpl_${Date.now().toString(36)}`,
        name: String(body.name || "Untitled Template"),
        description: String(body.description || ""),
        type: body.type ?? "admin_template",
        template: body.template ?? { nodes: [], edges: [], settings: {} },
        category: Array.isArray(body.category) ? body.category : [],
        tags: Array.isArray(body.tags) ? body.tags : [],
        installs: body.installs ?? 0,
        authorName: String(body.authorName || "AlgoVault"),
        createdAt: Date.now(),
        updatedAt: Date.now(),
        pro: Boolean(body.pro),
    };
    await upsertMarketplaceItem(item);
    return Response.json(item, { status: 201 });
}