import { NextRequest, NextResponse } from "next/server";
import { authUid, unauthorized, serverError, badRequest, notFound } from "@/lib/plugins/api-helpers";
import { getExtensionRecord, setExtensionInstallation, getExtensionInstallation } from "@/lib/plugins/database";

export async function PUT(request: NextRequest, context: { params: Promise<{ extensionId: string }> }) {
    try {
        const uid = await authUid(request);
        if (!uid) return unauthorized();
        const { extensionId } = await context.params;

        const extension = await getExtensionRecord(extensionId);
        if (!extension) return notFound("Extension not found.");
        const existing = await getExtensionInstallation(uid, extensionId);
        if (!existing) return notFound("Extension is not installed.");

        const body = await request.json().catch(() => ({}));
        const extensionType = (extension as { extensionType?: string }).extensionType || "";

        const next = { ...existing, updatedAt: Date.now(), status: "configured" as const };

        if (["webhook", "api"].includes(extensionType)) {
            const webhookUrl = String(body.webhookUrl || "").trim();
            if (!webhookUrl) return badRequest("A webhook URL is required for this extension.");
            if (!/^https?:\/\//.test(webhookUrl)) return badRequest("webhookUrl must start with http(s)://");
            next.webhookUrl = webhookUrl.slice(0, 512);
        } else if (extensionType === "tradingview") {
            const target = String(body.target || "").trim();
            if (!target) return badRequest("A TradingView target/panel identifier is required.");
            next.target = target.slice(0, 256);
        }

        await setExtensionInstallation(uid, next);
        return NextResponse.json({ success: true, install: next });
    } catch (err) {
        return serverError(err);
    }
}

export async function DELETE(request: NextRequest, context: { params: Promise<{ extensionId: string }> }) {
    try {
        const uid = await authUid(request);
        if (!uid) return unauthorized();
        const { extensionId } = await context.params;

        const existing = await getExtensionInstallation(uid, extensionId);
        if (!existing) {
            return NextResponse.json({ success: true, alreadyUninstalled: true });
        }
        const { removeExtensionInstallation } = await import("@/lib/plugins/database");
        await removeExtensionInstallation(uid, extensionId);
        return NextResponse.json({ success: true });
    } catch (err) {
        return serverError(err);
    }
}

export const dynamic = "force-dynamic";