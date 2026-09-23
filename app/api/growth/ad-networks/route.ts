/**
 * AlgoVault — Ad network configuration status API (admin).
 *
 * Returns the REAL configured state of each ad network from server env vars.
 * Never exposes secret values — only booleans + reasons.
 *
 * Web:    Google AdSense (NEXT_PUBLIC_ADSENSE_CLIENT_ID + ADSENSE_ENABLED)
 * Mobile: Google AdMob (ADMOB_APP_ID) — a native-mobile-only integration.
 *         AdMob is NEVER rendered in the Next.js web app.
 * Custom: CUSTOM_AD_ENDPOINT — a self-hosted ad endpoint.
 */

import { NextRequest, NextResponse } from "next/server";
import { adminAuth } from "@/lib/firebase-admin";

type NetworkStatus = {
    type: "ADSENSE" | "ADMOB" | "CUSTOM";
    platform: "WEB" | "IOS" | "ANDROID";
    enabled: boolean;
    configured: boolean;
    testMode: boolean;
    note?: string;
    reason?: string;
};

const has = (name: string) => {
    const v = process.env[name];
    return v !== undefined && v !== "";
};

function networkStatuses(): NetworkStatus[] {
    const adsenseConfigured = has("NEXT_PUBLIC_ADSENSE_CLIENT_ID") && process.env.ADSENSE_ENABLED === "true";
    const admobConfigured = has("ADMOB_APP_ID");
    const customConfigured = has("CUSTOM_AD_ENDPOINT");

    return [
        {
            type: "ADSENSE",
            platform: "WEB",
            enabled: process.env.ADSENSE_ENABLED === "true",
            configured: adsenseConfigured,
            testMode: false,
            reason: adsenseConfigured
                ? undefined
                : "AdSense needs NEXT_PUBLIC_ADSENSE_CLIENT_ID set and ADSENSE_ENABLED=true in the environment.",
        },
        {
            type: "ADMOB",
            platform: "IOS",
            enabled: true,
            configured: admobConfigured,
            testMode: false,
            note: "AdMob renders natively inside the iOS/Android apps only. It is never rendered in the web app.",
            reason: admobConfigured ? undefined : "Native app integration only — set ADMOB_APP_ID in the mobile app's environment.",
        },
        {
            type: "ADMOB",
            platform: "ANDROID",
            enabled: true,
            configured: admobConfigured,
            testMode: false,
            note: "AdMob renders natively inside the iOS/Android apps only. It is never rendered in the web app.",
            reason: admobConfigured ? undefined : "Native app integration only — set ADMOB_APP_ID in the mobile app's environment.",
        },
        {
            type: "CUSTOM",
            platform: "WEB",
            enabled: true,
            configured: customConfigured,
            testMode: false,
            reason: customConfigured ? undefined : "Custom ad network needs CUSTOM_AD_ENDPOINT set in the environment.",
        },
    ];
}

export async function GET(request: NextRequest) {
    const header = request.headers.get("authorization") || "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : "";
    if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    try {
        const decoded = await adminAuth.verifyIdToken(token);
        if (!decoded.admin && decoded.role !== "admin") {
            return NextResponse.json({ error: "Admin access required" }, { status: 403 });
        }
    } catch {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    return NextResponse.json(networkStatuses(), { headers: { "Cache-Control": "no-store" } });
}