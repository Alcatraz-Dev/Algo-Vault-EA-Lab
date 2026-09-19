import { NextRequest } from "next/server";
import { adminAuth, adminDatabase } from "@/lib/firebase-admin";

export function errMessage(error: unknown, fallback = "Request failed.") {
    return error instanceof Error ? error.message : fallback;
}

export async function requireAdmin(request: NextRequest) {
    const authorization = request.headers.get("authorization") ?? "";
    if (!authorization.startsWith("Bearer ")) {
        return null;
    }

    try {
        const token = await adminAuth.verifyIdToken(authorization.slice(7));
        const userSnapshot = await adminDatabase
            .ref(`users/${token.uid}`)
            .get();

        if (!userSnapshot.exists()) {
            return null;
        }

        if (userSnapshot.val()?.role !== "admin") {
            return null;
        }

        return token;
    } catch {
        return null;
    }
}

export async function authenticate(request: NextRequest) {
    const authorization = request.headers.get("authorization") ?? "";
    if (!authorization.startsWith("Bearer ")) {
        return null;
    }

    try {
        return await adminAuth.verifyIdToken(authorization.slice(7));
    } catch {
        return null;
    }
}

/**
 * Allows an admin, or the owner of the given product (bots/{productId}/ownerUid),
 * to perform the operation. Returns the verified token or null.
 */
export async function requireAdminOrProductOwner(request: NextRequest, productId?: string) {
    const token = await authenticate(request);
    if (!token) return null;

    const userSnapshot = await adminDatabase.ref(`users/${token.uid}`).get();
    if (userSnapshot.exists() && userSnapshot.val()?.role === "admin") {
        return token;
    }

    if (productId) {
        const botSnapshot = await adminDatabase.ref(`bots/${productId}`).get();
        const bot = botSnapshot.val();
        if (bot && String(bot.ownerUid) === token.uid) {
            return token;
        }
    }

    return null;
}