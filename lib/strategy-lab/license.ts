import { adminDatabase } from "@/lib/firebase-admin";
import { AccessStatus } from "./types";

// ─────────────────────────────────────────────────────────────────────────────
// Strategy Lab access control (server-side only).
//
// Access is granted when ANY of these hold:
//   1. An active "ai-strategy-lab" feature license in licenses/{uid}.
//   2. An active pro / enterprise subscription on users/{uid}/subscription.
//   3. An active license for the companion signal products (getAccessLevel
//      treats them as broad trading licenses that include the lab).
//
// The API and UI rely on this single source of truth so the upgrade UI and the
// enforcement gate never disagree.
// ─────────────────────────────────────────────────────────────────────────────

export const AI_STRATEGY_LAB_PRODUCTS = new Set<string>([
    "ai-strategy-lab",
    "ai-strategy-lab-pro",
    "ai-strategy-lab-lifetime",
]);

// Product ids that imply broad trading platform access (signals, trade mgmt).
const COVERED_PRODUCTS = new Set<string>([
    "ai-signals",
    "ai-signals-pro",
    "trade-management",
    "copy-trading",
    "algo-trading",
]);

type LicenseRecord = {
    productId?: string;
    status?: string;
    expiresAt?: number;
};

export async function checkAccess(uid: string): Promise<AccessStatus> {
    try {
        // 1. Feature license.
        const licenseSnap = await adminDatabase.ref(`licenses/${uid}`).get();
        const licenses = licenseSnap.val();
        if (licenses && typeof licenses === "object") {
            for (const licenseId of Object.keys(licenses)) {
                const license = licenses[licenseId] as LicenseRecord;
                const productId = (license.productId ?? "").toLowerCase();
                const isLabProduct = AI_STRATEGY_LAB_PRODUCTS.has(productId);
                const isCovered = COVERED_PRODUCTS.has(productId);
                if (!isLabProduct && !isCovered) continue;

                const status = (license.status ?? "").toLowerCase();
                const active = status === "active" || status === "valid" || status === "purchased";
                const expired = license.expiresAt ? license.expiresAt < Date.now() : false;

                if (active && !expired) {
                    return {
                        accessible: true,
                        level: isLabProduct ? "feature_license" : "trading_license",
                        status: "active",
                        productId,
                        expiresAt: license.expiresAt,
                    };
                }

                if (expired) {
                    return {
                        accessible: false,
                        level: isLabProduct ? "feature_license" : "trading_license",
                        status: "expired",
                        productId,
                        expiresAt: license.expiresAt,
                        reason: "License expired. Renew to continue using the Strategy Lab.",
                    };
                }
            }
        }

        // 2. Pro / enterprise subscription.
        const subSnap = await adminDatabase.ref(`users/${uid}/subscription`).get();
        const sub = subSnap.val();
        if (sub && sub.status === "active" && (sub.plan === "pro" || sub.plan === "enterprise")) {
            return {
                accessible: true,
                level: "pro",
                status: "active",
                expiresAt: sub.expiresAt ? Number(sub.expiresAt) : undefined,
            };
        }

        return {
            accessible: false,
            level: "none",
            status: "none",
            reason: "The AI Strategy Lab requires an active Pro subscription or the AI Strategy Lab license.",
        };
    } catch (err) {
        console.error("[strategy-lab/license] checkAccess failed:", err);
        return {
            accessible: false,
            level: "none",
            status: "none",
            reason: "Unable to verify access. Try again shortly.",
        };
    }
}