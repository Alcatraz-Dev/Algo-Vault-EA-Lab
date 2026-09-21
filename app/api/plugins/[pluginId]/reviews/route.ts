import { NextRequest, NextResponse } from "next/server";
import { authUid, unauthorized, serverError, badRequest, notFound } from "@/lib/plugins/api-helpers";
import { getPluginRecord, addPluginReview, listPluginReviews } from "@/lib/plugins/database";
import { adminDatabase } from "@/lib/firebase-admin";

export async function GET(request: NextRequest, context: { params: Promise<{ pluginId: string }> }) {
    try {
        const { pluginId } = await context.params;
        const reviews = await listPluginReviews(pluginId);
        return NextResponse.json({ success: true, reviews });
    } catch (err) {
        return serverError(err);
    }
}

export async function POST(request: NextRequest, context: { params: Promise<{ pluginId: string }> }) {
    try {
        const uid = await authUid(request);
        if (!uid) return unauthorized();
        const { pluginId } = await context.params;

        const plugin = await getPluginRecord(pluginId);
        if (!plugin) return notFound("Plugin not found.");

        const body = await request.json().catch(() => ({}));
        const rating = Number(body.rating);
        if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
            return badRequest("rating must be an integer between 1 and 5.");
        }
        const comment = String(body.comment || "").trim().slice(0, 2000);

        const userSnap = await adminDatabase.ref(`users/${uid}`).get();
        const userVal = userSnap.val() as { displayName?: string; name?: string } | null;
        const userName = String(userVal?.displayName || userVal?.name || uid.slice(0, 8)).slice(0, 60);

        // One review per user per plugin — updates replace the earlier one.
        const existingSnap = await adminDatabase.ref(`pluginReviews/${pluginId}`).orderByChild("userId").equalTo(uid).limitToFirst(1).get();
        if (existingSnap.hasChildren()) {
            const [key, value] = Object.entries(existingSnap.val())[0];
            const existing = value as { status?: string };
            await adminDatabase.ref(`pluginReviews/${pluginId}/${key}`).update({
                rating,
                comment,
                userName,
                status: existing.status === "published" ? "published" : "pending",
                updatedAt: Date.now(),
            });
            const updated = {
                id: key,
                pluginId,
                userId: uid,
                userName,
                rating,
                comment,
                status: existing.status === "published" ? "published" : "pending",
                createdAt: (value as { createdAt?: number }).createdAt || Date.now(),
                updatedAt: Date.now(),
            };
            const { recalculatePluginRating } = await import("@/lib/plugins/database");
            await recalculatePluginRating(pluginId);
            return NextResponse.json({ success: true, review: updated, updated: true });
        }

        const review = await addPluginReview({
            pluginId,
            userId: uid,
            userName,
            rating,
            comment,
            status: "published",
        });

        return NextResponse.json({ success: true, review });
    } catch (err) {
        return serverError(err);
    }
}

export const dynamic = "force-dynamic";