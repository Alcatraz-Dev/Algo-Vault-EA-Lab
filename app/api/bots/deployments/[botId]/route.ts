import { NextRequest, NextResponse } from "next/server";
import { authenticate } from "@/lib/admin-auth";
import { adminDatabase } from "@/lib/firebase-admin";
import type { BotDeployment } from "@/lib/bot-studio/types";

export const runtime = "nodejs";

async function requireOwner(uid: string, botId: string): Promise<BotDeployment | null> {
    const snap = await adminDatabase.ref(`bot_deployments/${botId}`).get();
    const val = snap.val();
    if (!val || typeof val !== "object") return null;
    const d = val as BotDeployment;
    if (d.ownerId !== uid) return null;
    return d;
}

export async function DELETE(
    request: NextRequest,
    { params }: { params: Promise<{ botId: string }> }
) {
    try {
        const token = await authenticate(request);
        if (!token) {
            return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
        }

        const { botId } = await params;
        const deployment = await requireOwner(token.uid, botId);
        if (!deployment) {
            return NextResponse.json({ success: false, error: "Deployment not found." }, { status: 404 });
        }

        await adminDatabase.ref(`bot_deployments/${botId}`).remove();
        await adminDatabase.ref(`bot_deployments_index/${deployment.ownerId}/${botId}`).remove();

        return NextResponse.json({ success: true, botId });
    } catch (error) {
        console.error("[bots/deployments/[botId] DELETE]", error);
        return NextResponse.json({ success: false, error: "Unable to delete deployment." }, { status: 500 });
    }
}

export async function PATCH(
    request: NextRequest,
    { params }: { params: Promise<{ botId: string }> }
) {
    try {
        const token = await authenticate(request);
        if (!token) {
            return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
        }

        const { botId } = await params;
        const deployment = await requireOwner(token.uid, botId);
        if (!deployment) {
            return NextResponse.json({ success: false, error: "Deployment not found." }, { status: 404 });
        }

        const body = await request.json();
        const { mt5Account, description } = body;

        const patch: Partial<BotDeployment> = { updatedAt: Date.now() };
        if (typeof mt5Account === "string") patch.mt5Account = mt5Account.trim();

        await adminDatabase.ref(`bot_deployments/${botId}`).update(patch);

        // Update strategy description if provided
        if (typeof description === "string") {
            await adminDatabase.ref(`bot_strategies/${deployment.strategyId}/description`).set(description.trim());
        }

        const updated = await adminDatabase.ref(`bot_deployments/${botId}`).get();
        return NextResponse.json({ success: true, deployment: updated.val() });
    } catch (error) {
        console.error("[bots/deployments/[botId] PATCH]", error);
        return NextResponse.json({ success: false, error: "Unable to update deployment." }, { status: 500 });
    }
}
