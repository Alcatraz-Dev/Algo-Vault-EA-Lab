import { NextRequest, NextResponse } from "next/server";
import { adminAuth, adminDatabase } from "@/lib/firebase-admin";

function jsonError(message: string, status = 400) {
    return NextResponse.json(
        { success: false, error: message },
        { status }
    );
}

async function requireUser(request: NextRequest) {
    const authorization = request.headers.get("authorization") ?? "";
    if (!authorization.startsWith("Bearer ")) return null;

    try {
        return await adminAuth.verifyIdToken(authorization.slice(7).trim());
    } catch {
        return null;
    }
}

function generateCode() {
    const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let suffix = "";
    for (let i = 0; i < 6; i++) {
        suffix += alphabet[Math.floor(Math.random() * alphabet.length)];
    }
    return `ALGV-${suffix}`;
}

async function getOrCreateCode(uid: string) {
    const userSnap = await adminDatabase.ref(`users/${uid}`).get();
    const userData = userSnap.val() || {};

    if (userData.referralCode) {
        return { code: String(userData.referralCode), userData };
    }

    // Reuse an existing code if the user already owns one
    const codesSnapshot = await adminDatabase.ref("referral_codes").get();
    const codes = codesSnapshot.val() || {};
    let code = "";
    for (const [candidate, ownerUid] of Object.entries(codes)) {
        if (String(ownerUid) === uid) {
            code = candidate;
            break;
        }
    }

    if (!code) {
        do {
            code = generateCode();
        } while (codes[code]);

        const now = Date.now();
        await adminDatabase.ref(`referral_codes/${code}`).set(uid);
        await adminDatabase.ref(`referrals/${uid}/${code}`).set({
            code,
            clicks: 0,
            signups: 0,
            createdAt: now,
            updatedAt: now,
            events: {},
        });
    }

    await adminDatabase.ref(`users/${uid}`).update({ referralCode: code });
    return { code, userData: { ...userData, referralCode: code } };
}

// GET: current user's referral summary
export async function GET(request: NextRequest) {
    try {
        const token = await requireUser(request);
        if (!token) {
            return jsonError("Authentication required.", 401);
        }

        const uid = token.uid;
        const { code, userData } = await getOrCreateCode(uid);

        const statsSnapshot = await adminDatabase.ref(`referrals/${uid}/${code}`).get();
        const stats = statsSnapshot.val() || {};

        const eventsData = stats.events || {};
        const events = Object.entries(eventsData as Record<string, { type?: string; page?: string; createdAt?: number; orderId?: string; productName?: string; commissionCents?: number; buyerUserId?: string }>)
            .map(([id, val]) => ({ id, ...(val || {}) }))
            .sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0))
            .slice(0, 15);

        // Load earnings summary
        const earningsSnap = await adminDatabase.ref(`referral_earnings/${uid}`).get();
        const earningsData = earningsSnap.val() || {};
        const earningsList = Object.values(earningsData) as Array<{
            commissionCents?: number;
            commissionUsd?: number;
            status?: string;
            productName?: string;
            createdAt?: number;
        }>;

        const totalEarningsCents = earningsList.reduce(
            (sum, e) => sum + Number(e.commissionCents || 0), 0
        );
        const completedEarningsCents = earningsList
            .filter(e => e.status === "completed")
            .reduce((sum, e) => sum + Number(e.commissionCents || 0), 0);
        const recentPurchases = earningsList
            .sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0))
            .slice(0, 10)
            .map((e, i) => ({
                id: `purchase-${i}`,
                type: "purchase" as const,
                productName: e.productName || "Purchase",
                commissionCents: e.commissionCents || 0,
                createdAt: e.createdAt || 0,
            }));

        return NextResponse.json({
            success: true,
            code,
            clicks: Number(stats.clicks || 0),
            signups: Number(stats.signups || 0),
            referredBy: userData.referredBy || "",
            recentEvents: events,
            totalEarningsUsd: Math.round(totalEarningsCents) / 100,
            completedEarningsUsd: Math.round(completedEarningsCents) / 100,
            recentPurchases,
        });
    } catch (error) {
        console.error("[referrals GET]", error);
        return NextResponse.json(
            { success: false, error: "Failed to load referral summary." },
            { status: 500 }
        );
    }
}

// POST: claim a referral code (called after account creation)
export async function POST(request: NextRequest) {
    try {
        const token = await requireUser(request);
        if (!token) {
            return jsonError("Authentication required.", 401);
        }

        const body = await request.json().catch(() => ({}));
        const rawCode = String(body?.code || body?.ref || "").trim().toUpperCase();

        if (!rawCode) {
            return jsonError("Referral code is required.");
        }

        const ownerUid = (await adminDatabase
            .ref(`referral_codes/${rawCode}`)
            .get()).val();

        if (!ownerUid) {
            return jsonError("Invalid referral code.");
        }

        if (String(ownerUid) === token.uid) {
            return jsonError("You cannot use your own referral code.");
        }

        const uid = token.uid;
        const userRef = adminDatabase.ref(`users/${uid}`);
        const userData = (await userRef.get()).val() || {};

        if (userData.referredBy) {
            return NextResponse.json({ success: true, alreadySet: true, code: rawCode });
        }

        const now = Date.now();
        await userRef.update({
            referredBy: rawCode,
            referredAt: now,
        });

        await adminDatabase
            .ref(`referrals/${ownerUid}/${rawCode}/signups`)
            .transaction((current) => Number(current || 0) + 1);

        const eventRef = adminDatabase.ref(`referrals/${ownerUid}/${rawCode}/events`).push();
        if (eventRef.key) {
            await eventRef.set({ type: "signup", page: "register", createdAt: now });
        }

        await adminDatabase
            .ref(`referrals/${ownerUid}/${rawCode}`)
            .update({ updatedAt: now });

        return NextResponse.json({ success: true, alreadySet: false, code: rawCode });
    } catch (error) {
        console.error("[referrals POST]", error);
        return NextResponse.json(
            { success: false, error: "Failed to claim referral code." },
            { status: 500 }
        );
    }
}