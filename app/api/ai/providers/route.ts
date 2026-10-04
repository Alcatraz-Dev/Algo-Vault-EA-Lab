import { NextResponse } from "next/server";
import { adminAuth } from "@/lib/firebase-admin";
import { getProviderRegistry, getUnifiedRouter, isUnifiedIntelligenceEnabled, intelligenceFlagSnapshot, INTELLIGENCE_VERSION } from "@/lib/intelligence";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/ai/providers
 * Provider registry metadata + live health, for authenticated users.
 * Metadata only — never exposes API keys, base URLs with embedded secrets,
 * or any credential material.
 */
export async function GET(req: Request) {
    try {
        const authHeader = req.headers.get("authorization") || "";
        const token = authHeader.replace(/^Bearer\s+/i, "");
        if (!token) {
            return NextResponse.json({ success: false, error: "UNAUTHENTICATED" }, { status: 401 });
        }
        let uid: string | null = null;
        try {
            const decoded = await adminAuth.verifyIdToken(token);
            uid = decoded.uid;
        } catch {
            return NextResponse.json({ success: false, error: "UNAUTHENTICATED" }, { status: 401 });
        }
        if (!uid) return NextResponse.json({ success: false, error: "UNAUTHENTICATED" }, { status: 401 });

        const router = getUnifiedRouter();
        const health = router.healthSnapshots();
        const healthByProvider = new Map(health.map((h) => [h.provider, h]));
        const registry = getProviderRegistry().map((entry) => ({
            id: entry.id,
            name: entry.name,
            type: entry.type,
            capabilities: entry.capabilities,
            costClass: entry.costClass,
            commercialUse: entry.commercialUse,
            privacyPolicyUrl: entry.privacyPolicyUrl,
            regionRestrictions: entry.regionRestrictions,
            freeTier: entry.freeTier,
            rateLimits: entry.rateLimits,
            priority: entry.priority,
            enabled: entry.enabled,
            verified: entry.verified,
            credentialsConfigured: entry.credentialsConfigured === true,
            health: healthByProvider.get(entry.id) ?? null,
        }));

        return NextResponse.json({
            success: true,
            enabled: isUnifiedIntelligenceEnabled(),
            versions: INTELLIGENCE_VERSION,
            flags: intelligenceFlagSnapshot(),
            providers: registry,
        });
    } catch (err) {
        console.error("[api/ai/providers] error:", err instanceof Error ? err.message : err);
        return NextResponse.json({ success: false, error: "INTERNAL_ERROR" }, { status: 500 });
    }
}
