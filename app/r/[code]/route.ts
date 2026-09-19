import { NextRequest, NextResponse } from "next/server";
import { adminDatabase } from "@/lib/firebase-admin";

// GET /r/[code] — record a referral click, then send the visitor to signup
export async function GET(
    _request: NextRequest,
    { params }: { params: Promise<{ code: string }> }
) {
    try {
        const { code } = await params;
        const normalized = String(code || "").trim().toUpperCase();

        if (normalized) {
            const ownerUid = (await adminDatabase
                .ref(`referral_codes/${normalized}`)
                .once("value")).val();

            if (ownerUid) {
                const now = Date.now();
                const eventRef = adminDatabase.ref(`referral_clicks/${normalized}`).push();
                if (eventRef.key) {
                    await eventRef.set({ createdAt: now });
                }

                await adminDatabase
                    .ref(`referrals/${ownerUid}/${normalized}/clicks`)
                    .transaction((current) => Number(current || 0) + 1);

                const eventRef2 = adminDatabase.ref(`referrals/${ownerUid}/${normalized}/events`).push();
                if (eventRef2.key) {
                    await eventRef2.set({ type: "click", page: `/r/${normalized}`, createdAt: now });
                }

                await adminDatabase
                    .ref(`referrals/${ownerUid}/${normalized}`)
                    .update({ updatedAt: now });
            }
        }

        return NextResponse.redirect(
            new URL(`/register?ref=${encodeURIComponent(normalized)}`, _request.url),
            302
        );
    } catch (error) {
        console.error("[referral click]", error);
        return NextResponse.redirect(
            new URL("/register", _request.url),
            302
        );
    }
}