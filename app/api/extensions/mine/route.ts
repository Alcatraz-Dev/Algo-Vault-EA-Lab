import { NextRequest, NextResponse } from "next/server";
import { authUid, unauthorized, serverError } from "@/lib/plugins/api-helpers";
import { listExtensionInstallations, getExtensionRecord } from "@/lib/plugins/database";

export async function GET(request: NextRequest) {
    try {
        const uid = await authUid(request);
        if (!uid) return unauthorized();

        const installations = await listExtensionInstallations(uid);
        const rows = await Promise.all(
            installations.map(async (install) => {
                const extension = await getExtensionRecord(install.extensionId);
                return { install, extension };
            })
        );

        return NextResponse.json({ success: true, extensions: rows });
    } catch (err) {
        return serverError(err);
    }
}

export const dynamic = "force-dynamic";