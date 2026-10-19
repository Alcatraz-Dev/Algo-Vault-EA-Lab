import { adminAuth } from "@/lib/firebase-admin";
import { requireAdmin } from "@/lib/admin-auth";
import { hasActiveProEntitlement } from "./entitlements";

export interface BotStudioAccess {
    uid: string;
    isAdmin: boolean;
}

export async function requireBotStudioAccess(request: Request): Promise<BotStudioAccess | null> {
    // 1. Try admin path first (preserves existing admin privileges).
    const admin = await requireAdmin(request as any);
    if (admin) {
        return { uid: admin.uid, isAdmin: true };
    }

    // 2. Otherwise verify Firebase ID token for a regular user.
    const authHeader = (request.headers.get("authorization") || "").trim();
    const idToken = authHeader.toLowerCase().startsWith("bearer ")
        ? authHeader.slice(7).trim()
        : "";
    if (!idToken) return null;

    let uid: string;
    try {
        const decoded = await adminAuth.verifyIdToken(idToken);
        uid = decoded.uid;
    } catch {
        return null;
    }

    // 3. Pro entitlement check (trusted server-side source).
    const isPro = await hasActiveProEntitlement(uid);
    if (!isPro) return null;

    return { uid, isAdmin: false };
}