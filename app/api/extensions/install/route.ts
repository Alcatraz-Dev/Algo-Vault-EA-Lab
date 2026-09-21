import { NextRequest, NextResponse } from "next/server";
import { authUid, unauthorized, serverError, badRequest, notFound } from "@/lib/plugins/api-helpers";
import { getExtensionRecord, setExtensionInstallation, getExtensionInstallation, incrementCatalogCounter, writeAuditLog } from "@/lib/plugins/database";

export async function POST(request: NextRequest) {
    try {
        const uid = await authUid(request);
        if (!uid) return unauthorized();

        const body = await request.json().catch(() => ({}));
        const extensionId = String(body.extensionId || "").trim();
        if (!extensionId) return badRequest("extensionId is required.");

        const extension = await getExtensionRecord(extensionId);
        if (!extension) return notFound("Extension not found.");
        if (extension.status !== "published") return badRequest("This extension is not available.");

        const existing = await getExtensionInstallation(uid, extensionId);
        if (existing) {
            return NextResponse.json({ success: true, alreadyInstalled: true, install: existing });
        }

        const now = Date.now();
        const install = {
            extensionId,
            userId: uid,
            status: "installed" as const,
            installedVersion: extension.version || null,
            installedAt: now,
            updatedAt: now,
        };
        await setExtensionInstallation(uid, install);
        await incrementCatalogCounter(extensionId, "installs", 1);
        await writeAuditLog({ action: "extension.installed", actor: uid, pluginId: extensionId });

        return NextResponse.json({ success: true, install });
    } catch (err) {
        return serverError(err);
    }
}

export const dynamic = "force-dynamic";