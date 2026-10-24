/**
 * /api/developer/keys/[lookupPrefix] - Revoke API key
 */
import { NextRequest, NextResponse } from "next/server";
import { adminAuth, adminDatabase } from "@/lib/firebase-admin";
import { revokeApiKey, deleteApiKey } from "@/lib/intelligence-cloud/api-keys";
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

        if (!lookupPrefix || lookupPrefix === "undefined" || lookupPrefix === "null") {
            return NextResponse.json(
                { error: "Invalid API key lookup prefix" },
                { status: 400 }
            );
        }

        const cleanPrefix = lookupPrefix.startsWith("key_")
            ? lookupPrefix.slice(4)
            : lookupPrefix;

        const action = request.nextUrl.searchParams.get("action");
        if (action === "revoke") {
            await revokeApiKey(tenantId, cleanPrefix, uid);
        } else {
            await deleteApiKey(tenantId, cleanPrefix, uid);
        }
        return NextResponse.json({ success: true });
    } catch (error: any) {
        if (error?.status && typeof error.status === "number") {
            return NextResponse.json(
                { error: error?.message || "Error processing API key" },
                { status: error.status }
            );
        }
        console.error("Delete/Revoke API key error:", error);
        return NextResponse.json({ error: error?.message || "Failed to process API key" }, { status: 500 });
    }
}
