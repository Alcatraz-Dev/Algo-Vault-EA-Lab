/**
 * /api/developer/keys/[lookupPrefix] - Revoke API key
 */
import { NextRequest, NextResponse } from "next/server";
import { adminAuth, adminDatabase } from "@/lib/firebase-admin";
import { revokeApiKey } from "@/lib/intelligence-cloud/api-keys";
import { readBearerToken } from "@/lib/intelligence-cloud/route";

export const dynamic = "force-dynamic";

async function authenticateDeveloper(request: NextRequest) {
    const token = readBearerToken(request);
    if (!token) {
        return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
    }

    try {
        const decoded = await adminAuth.verifyIdToken(token);
        const uid = decoded.uid;
        const userSnap = await adminDatabase.ref(`users/${uid}`).get();
        const userData = userSnap.val();

        if (!userData || !["developer", "admin"].includes(userData.role)) {
            return { error: NextResponse.json({ error: "Developer role required" }, { status: 403 }) };
        }

        return { uid, userData };
    } catch {
        return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
    }
}

export async function DELETE(
    request: NextRequest,
    { params }: { params: Promise<{ lookupPrefix: string }> }
) {
    try {
        const auth = await authenticateDeveloper(request);
        if ("error" in auth) return auth.error;

        const { uid, userData } = auth;
        const tenantId = userData.tenantId || uid;
        const { lookupPrefix } = await params;

        await revokeApiKey(tenantId, lookupPrefix, uid);
        return NextResponse.json({ success: true });
    } catch (error: any) {
        console.error("Revoke API key error:", error);
        return NextResponse.json({ error: error?.message || "Failed to revoke API key" }, { status: 500 });
    }
}
