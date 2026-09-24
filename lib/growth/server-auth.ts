/**
 * Growth Engine — server-side admin gate.
 *
 * Mirrors the platform convention in lib/admin-auth.ts (requireAdmin):
 * an admin is whoever the Realtime DB record `users/{uid}` says is an admin
 * (`role === "admin"`). Custom Firebase ID-token claims are deliberately NOT
 * consulted — the rest of the platform (AdminGuard, app/api/admin/*) already
 * defines admins by the DB record, and growth routes must agree with it or
 * legit DB-role admins hit "You don't have access to this data." everywhere.
 *
 * Accepts either a NextRequest or a raw bearer-token string so both route
 * handlers and the token-string helper functions can share one implementation.
 */

import { NextRequest } from "next/server";
import { adminAuth, adminDatabase } from "@/lib/firebase-admin";

export type GrowthAdminSession = {
    uid: string;
    /** Always true for a returned session — admins are defined by the DB record. */
    admin: boolean;
    role: string;
    token: string;
};

function extractBearer(requestOrToken: NextRequest | string): string {
    const raw =
        typeof requestOrToken === "string"
            ? requestOrToken
            : (requestOrToken.headers.get("authorization") ?? "");
    const token = raw.startsWith("Bearer ") ? raw.slice(7) : raw;
    return token.trim();
}

export async function requireGrowthAdmin(
    requestOrToken: NextRequest | string
): Promise<GrowthAdminSession | null> {
    const token = extractBearer(requestOrToken);
    if (!token) return null;

    try {
        const decoded = await adminAuth.verifyIdToken(token);
        const userSnapshot = await adminDatabase
            .ref(`users/${decoded.uid}`)
            .get();

        if (!userSnapshot.exists()) return null;
        if (userSnapshot.val()?.role !== "admin") return null;

        return { uid: decoded.uid, admin: true, role: "admin", token };
    } catch {
        return null;
    }
}