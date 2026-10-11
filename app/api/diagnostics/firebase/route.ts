import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
    const rawKey = process.env.FIREBASE_PRIVATE_KEY;
    const diagnostics = {
        nodeVersion: process.version,
        hasProjectId: Boolean(process.env.FIREBASE_PROJECT_ID || process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID),
        projectIdValue: process.env.FIREBASE_PROJECT_ID || process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || null,
        hasClientEmail: Boolean(process.env.FIREBASE_CLIENT_EMAIL),
        clientEmailDomain: process.env.FIREBASE_CLIENT_EMAIL?.split("@")[1] || null,
        hasPrivateKey: Boolean(rawKey),
        privateKeyLength: rawKey?.length ?? 0,
        privateKeyHasBegin: rawKey?.includes("BEGIN PRIVATE KEY") ?? false,
        privateKeyHasEnd: rawKey?.includes("END PRIVATE KEY") ?? false,
        hasDatabaseUrl: Boolean(process.env.FIREBASE_DATABASE_URL || process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL),
        hasStripeKey: Boolean(process.env.STRIPE_SECRET_KEY),
        stripeKeyPrefix: process.env.STRIPE_SECRET_KEY?.slice(0, 7) || null,
        hasAppUrl: Boolean(process.env.NEXT_PUBLIC_APP_URL),
    };

    try {
        const { adminAuth, adminDatabase } = await import("@/lib/firebase-admin");
        // Touch getApps to verify initialization without performing privileged writes
        const isAuthReady = typeof adminAuth !== "undefined";
        const isDbReady = typeof adminDatabase !== "undefined";

        return NextResponse.json({
            ok: true,
            diagnostics,
            isAuthReady,
            isDbReady,
        });
    } catch (err) {
        return NextResponse.json({
            ok: false,
            diagnostics,
            error: err instanceof Error ? err.message : String(err),
            stack: err instanceof Error ? err.stack : undefined,
        }, { status: 500 });
    }
}
