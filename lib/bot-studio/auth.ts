import { adminAuth } from "@/lib/firebase-admin";
import { requireAdmin } from "@/lib/admin-auth";
import { hasActiveProEntitlement } from "./entitlements";

export interface BotStudioAccess {
    uid: string;
    isAdmin: boolean;
}

/** Minimal shape needed to decide strategy ownership. */
export interface StrategyOwnerRef {
    authorId?: string;
}

/** Minimal shape needed to decide deployment ownership. */
export interface DeploymentOwnerRef {
    ownerId?: string;
}

/**
 * Resource ownership check for Bot Studio strategies.
 *
 * Every Bot Studio API route performs its reads and writes through the
 * Firebase Admin SDK, which BYPASSES Realtime Database security rules.
 * Ownership therefore has to be enforced here, in the route handler — an
 * API-level check is the only thing standing between one Pro user and
 * another Pro user's private strategy.
 */
export function canAccessStrategy(
    access: BotStudioAccess,
    strategy: StrategyOwnerRef | null | undefined,
): boolean {
    if (!strategy) return false;
    return access.isAdmin || strategy.authorId === access.uid;
}

/**
 * Resource ownership check for Bot Studio deployments.
 *
 * Same rationale as {@link canAccessStrategy}: Admin SDK writes are not
 * covered by RTDB rules, so the route must compare the deployment owner
 * with the authenticated caller.
 */
export function canAccessDeployment(
    access: BotStudioAccess,
    deployment: DeploymentOwnerRef | null | undefined,
): boolean {
    if (!deployment) return false;
    return access.isAdmin || deployment.ownerId === access.uid;
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