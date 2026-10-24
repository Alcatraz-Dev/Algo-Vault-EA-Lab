/**
 * /api/developer/keys - API key management for developers
 * 
 * Lists and creates API keys using the Intelligence Cloud infrastructure
 */
import { NextRequest, NextResponse } from "next/server";
import { adminAuth, adminDatabase } from "@/lib/firebase-admin";
import { createApiKey, listApiKeys } from "@/lib/intelligence-cloud/api-keys";
import { sanitiseScopes, DEFAULT_KEY_SCOPES } from "@/lib/intelligence-cloud/auth";
import { recordAudit } from "@/lib/intelligence-cloud/audit";
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

export async function GET(request: NextRequest) {
    try {
        const auth = await authenticateDeveloper(request);
        if ("error" in auth) return auth.error;

        const { uid, userData } = auth;
        const tenantId = userData.tenantId || uid;
        const includeRevoked = request.nextUrl.searchParams.get("includeRevoked") === "true";

        const keys = await listApiKeys(tenantId, { includeRevoked });
        return NextResponse.json({ keys });
    } catch (error: any) {
        console.error("List API keys error:", error);
        return NextResponse.json({ error: error?.message || "Failed to list API keys" }, { status: 500 });
    }
}

export async function POST(request: NextRequest) {
    try {
        const auth = await authenticateDeveloper(request);
        if ("error" in auth) return auth.error;

        const { uid, userData } = auth;
        const tenantId = userData.tenantId || uid;

        const body = await request.json().catch(() => ({}));
        const scopes = sanitiseScopes(body.scopes);
        const name = typeof body.name === "string" && body.name.trim() ? body.name.trim().slice(0, 100) : undefined;
        const ownerUserId = body.ownerUserId === true ? uid : undefined;

        const result = await createApiKey({
            tenantId,
            createdBy: uid,
            ownerUserId,
            name,
            scopes: scopes.length > 0 ? scopes : DEFAULT_KEY_SCOPES,
        });

        // Audit is already logged in createApiKey, but add request context
        try {
            await recordAudit({
                tenantId,
                action: "API_KEY_CREATED",
                actorId: uid,
                detail: {
                    keyId: result.record.keyId,
                    name: result.record.name,
                    scopes: result.record.scopes,
                    source: "developer_portal",
                },
            });
        } catch {}

        return NextResponse.json({
            secret: result.secret,
            key: result.record,
            warning: "Store this key securely. It will not be shown again.",
        });
    } catch (error: any) {
        console.error("Create API key error:", error);
        return NextResponse.json({ error: error?.message || "Failed to create API key" }, { status: 500 });
    }
}
