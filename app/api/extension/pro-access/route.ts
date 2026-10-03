/**
 * /api/extension/pro-access
 *
 * Server-side Pro entitlement endpoint for the Pro Trading Intelligence
 * Chrome Extension. Source of truth: `users/{uid}/subscription` in
 * Firebase RTDB — never the client.
 *
 * Behaviour:
 *   • Unauthenticated → 401 (never trust client-supplied flags).
 *   • Active Pro/Enterprise plan → 200 { access: "granted" }.
 *   • Otherwise → 403 { access: "denied", upgrade: true }.
 *   • Token/header errors → 500 with a generic message (no internal leak).
 *
 * Admin (`users/{uid}.role === "admin"`) bypasses the subscription check so
 * internal staff can verify the experience without buying Pro.
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

function deniedBody(reason: string, status: "ok" | "expired" | "cancelled" | "missing" | "inactive" = "missing", upgrade = true) {
    return {
        success: false,
        access: "denied" as const,
        reason,
        subscriptionStatus: status,
        upgrade,
    };
}

async function readSubscription(uid: string): Promise<Record<string, unknown> | null> {
    const snap = await adminDatabase.ref(`users/${uid}/subscription`).get();
    if (!snap.exists()) return null;
    const v = snap.val();
    return typeof v === "object" && v !== null ? (v as Record<string, unknown>) : null;
}

function planEligible(plan: unknown): boolean {
    if (typeof plan !== "string") return false;
    const p = plan.toLowerCase();
    return p === "pro" || p === "elite" || p === "enterprise" || p === "vip";
}

function statusActive(status: unknown, activeFlag: unknown): boolean {
    if (activeFlag === true) return true;
    if (typeof status !== "string") return false;
    const s = status.toLowerCase();
    return s === "active" || s === "trialing";
}

export async function GET(request: NextRequest) {
    try {
        const authHeader = request.headers.get("authorization");
        if (!authHeader?.startsWith("Bearer ")) {
            return NextResponse.json(
                deniedBody("missing_token"),
                { status: 401, headers: corsHeaders }
            );
        }
        const token = authHeader.slice("Bearer ".length).trim();
        let decoded;
        try {
            decoded = await adminAuth.verifyIdToken(token);
        } catch {
            return NextResponse.json(
                deniedBody("invalid_token"),
                { status: 401, headers: corsHeaders }
            );
        }
        const uid = decoded.uid;

        // Admins are always granted so they can verify the surface.
        const roleSnap = await adminDatabase.ref(`users/${uid}/role`).get();
        const isAdmin = roleSnap.exists() && roleSnap.val() === "admin";
        if (isAdmin) {
            return NextResponse.json(
                {
                    success: true,
                    access: "granted",
                    userId: uid,
                    subscription: { plan: "admin", status: "active" },
                    reason: "admin_override",
                    timestamp: Date.now(),
                },
                { status: 200, headers: corsHeaders }
            );
        }

        const sub = await readSubscription(uid);
        if (!sub) {
            return NextResponse.json(
                deniedBody("no_subscription", "missing"),
                { status: 403, headers: corsHeaders }
            );
        }

        const plan = sub.plan;
        const status = sub.status;
        const activeFlag = sub.active;

        if (!statusActive(status, activeFlag)) {
            return NextResponse.json(
                deniedBody("inactive_subscription", (status as "expired" | "cancelled" | "inactive" | undefined) ?? "inactive"),
                { status: 403, headers: corsHeaders }
            );
        }

        if (!planEligible(plan)) {
            return NextResponse.json(
                deniedBody("plan_not_eligible", status as "ok" | undefined ?? "missing"),
                { status: 403, headers: corsHeaders }
            );
        }

        const periodEnd = typeof sub.currentPeriodEnd === "number" ? sub.currentPeriodEnd : null;

        return NextResponse.json(
            {
                success: true,
                access: "granted",
                userId: uid,
                subscription: {
                    plan: typeof plan === "string" ? plan : null,
                    status: typeof status === "string" ? status : "active",
                    currentPeriodEnd: periodEnd,
                },
                timestamp: Date.now(),
            },
            { status: 200, headers: corsHeaders }
        );
    } catch (err) {
        console.error("[GET /api/extension/pro-access]", err);
        return NextResponse.json(
            deniedBody("server_error"),
            { status: 500, headers: corsHeaders }
        );
    }
}