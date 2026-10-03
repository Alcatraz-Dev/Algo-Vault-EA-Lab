/**
 * /api/extension/pro-feature-flag
 *
 * Returns the rollout flags for the premium extension surfaces. These are
 * read by the web account page and by the Chrome extension (via the SW)
 * to decide which premium features are currently enabled.
 *
 * The flag values are server-controlled. If no flag source is configured
 * we default to a conservative "all-on" set so the user experience is
 * consistent with what the website advertises — but every flag is named
 * so the admin can flip them off without code changes.
 *
 * Auth: required (the extension uses the Firebase ID token). The endpoint
 * itself only returns the FLAG state, never privileged content; the actual
 * privileged endpoints still enforce Pro.
 */
import { NextRequest, NextResponse } from "next/server";
import { adminAuth, adminDatabase } from "@/lib/firebase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const corsHeaders: Record<string, string> = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400",
};

export function OPTIONS() {
    return NextResponse.json(null, { status: 204, headers: corsHeaders });
}

const DEFAULT_FLAGS: Record<string, boolean> = {
    tradingViewProExtension: true,
    aiChartCopilot: true,
    setupRadar: true,
    smartAlerts: true,
    aiIndicatorGenerator: true,
    aiStrategyGenerator: true,
    mtfIntelligence: true,
    commandBar: true,
    liveIntelligencePanel: true,
    tradingViewExecutionBridge: true,
};

async function readConfiguredFlags(): Promise<Record<string, boolean>> {
    try {
        const snap = await adminDatabase.ref("extension/proFeatureFlags").get();
        if (!snap.exists()) return { ...DEFAULT_FLAGS };
        const v = snap.val();
        if (!v || typeof v !== "object") return { ...DEFAULT_FLAGS };
        const obj = v as Record<string, unknown>;
        const out: Record<string, boolean> = { ...DEFAULT_FLAGS };
        for (const key of Object.keys(DEFAULT_FLAGS)) {
            if (typeof obj[key] === "boolean") out[key] = Boolean(obj[key]);
        }
        return out;
    } catch {
        return { ...DEFAULT_FLAGS };
    }
}

export async function GET(request: NextRequest) {
    try {
        const authHeader = request.headers.get("authorization");
        if (!authHeader?.startsWith("Bearer ")) {
            return NextResponse.json(
                { success: false, error: "unauthorized", flags: {}, timestamp: Date.now() },
                { status: 401, headers: corsHeaders }
            );
        }
        const token = authHeader.slice("Bearer ".length).trim();
        try {
            await adminAuth.verifyIdToken(token);
        } catch {
            return NextResponse.json(
                { success: false, error: "invalid_token", flags: {}, timestamp: Date.now() },
                { status: 401, headers: corsHeaders }
            );
        }

        const flags = await readConfiguredFlags();
        return NextResponse.json(
            { success: true, flags, timestamp: Date.now() },
            { status: 200, headers: corsHeaders }
        );
    } catch (err) {
        console.error("[GET /api/extension/pro-feature-flag]", err);
        // On failure return no flags so the UI degrades gracefully (no
        // claims of features that the server can't validate).
        return NextResponse.json(
            { success: false, error: "server_error", flags: {}, timestamp: Date.now() },
            { status: 500, headers: corsHeaders }
        );
    }
}