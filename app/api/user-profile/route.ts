import { NextRequest, NextResponse } from "next/server";
import { adminAuth, adminDatabase } from "@/lib/firebase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
    try {
        const authHeader = request.headers.get("authorization");
        if (!authHeader?.startsWith("Bearer ")) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const token = authHeader.split("Bearer ")[1];
        const decodedToken = await adminAuth.verifyIdToken(token);
        const uid = decodedToken.uid;

        const snap = await adminDatabase.ref(`users/${uid}`).get();
        const profile = (snap.val() || {}) as Record<string, unknown>;

        return NextResponse.json({
            success: true,
            profile: {
                uid,
                email: profile.email || decodedToken.email || "",
                displayName: profile.displayName || decodedToken.name || "",
                role: profile.role || "customer",
                phone: profile.phone || "",
                country: profile.country || "",
                timeZone: profile.timeZone || "",
                experience: profile.experience || "",
                bio: profile.bio || "",
                mt5Accounts: profile.mt5Accounts || {},
                riskPerTrade: profile.riskPerTrade,
                maxDrawdownAlert: profile.maxDrawdownAlert,
                maxDailyLossAlert: profile.maxDailyLossAlert,
                autoCutoff: profile.autoCutoff,
                emailTradeAlerts: profile.emailTradeAlerts,
                emailWeeklyDigest: profile.emailWeeklyDigest,
                emailSecurityAlerts: profile.emailSecurityAlerts,
                discordUsername: profile.discordUsername || "",
                telegramUsername: profile.telegramUsername || "",
                discordWebhook: profile.discordWebhook || "",
                telegramChatId: profile.telegramChatId || "",
                developerPlan: profile.developerPlan || "",
                developerApproved: profile.developerApproved || false,
                developerStatus: profile.developerStatus || "",
                createdAt: profile.createdAt,
                updatedAt: profile.updatedAt,
            },
        });
    } catch (err: unknown) {
        console.error("[GET /api/user-profile]", err);
        return NextResponse.json(
            { error: err instanceof Error ? err.message : "Internal server error" },
            { status: 500 }
        );
    }
}

export async function PATCH(request: NextRequest) {
    try {
        const authHeader = request.headers.get("authorization");
        if (!authHeader?.startsWith("Bearer ")) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const token = authHeader.split("Bearer ")[1];
        const decodedToken = await adminAuth.verifyIdToken(token);
        const uid = decodedToken.uid;

        const body = (await request.json()) as Record<string, unknown>;
        const allowedFields = [
            "displayName",
            "phone",
            "country",
            "timeZone",
            "experience",
            "bio",
        ] as const;
        const updates: Record<string, unknown> = {};

        for (const field of allowedFields) {
            const value = body[field];
            if (value === undefined) continue;
            if (typeof value !== "string") {
                return NextResponse.json({ error: `${field} must be a string.` }, { status: 400 });
            }
            updates[field] = value.trim();
        }

        if (Object.keys(updates).length === 0) {
            return NextResponse.json({ error: "No profile fields to update." }, { status: 400 });
        }

        await adminDatabase.ref(`users/${uid}`).update({
            ...updates,
            updatedAt: Date.now(),
        });

        return NextResponse.json({ success: true });
    } catch (err: unknown) {
        console.error("[PATCH /api/user-profile]", err);
        return NextResponse.json(
            { error: err instanceof Error ? err.message : "Internal server error" },
            { status: 500 }
        );
    }
}
