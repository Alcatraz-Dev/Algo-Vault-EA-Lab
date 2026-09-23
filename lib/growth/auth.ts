/**
 * Growth Engine — authorization helpers.
 *
 * Pure functions that decide whether a user record may access Growth features.
 * API routes load the user snapshot (via the Admin SDK) and call these — the
 * decision never trusts the frontend. Unit-testable without firebase.
 */

export type GrowthUserRecord = {
    uid: string;
    role?: string;
    developerApproved?: boolean;
} | null;

export function isAdminUser(user: GrowthUserRecord): boolean {
    return Boolean(user && user.role === "admin");
}

/**
 * Developers may only exercise capabilities their existing developer record
 * grants. There is currently no developer entitlement that covers Growth
 * administration, so developer accounts are read-only observers of *their own*
 * content at most — they can never mutate monetization/campaign/automation
 * state. Returns false for everyone except admins.
 */
export function canAdministerGrowth(user: GrowthUserRecord): boolean {
    return isAdminUser(user);
}

export function canViewGrowthAdmin(user: GrowthUserRecord): boolean {
    if (isAdminUser(user)) return true;
    // Approved developers may view anonymized growth/marketing screening
    // surfaces the platform enables for them; mutations stay admin-only.
    return Boolean(user && user.role === "developer" && user.developerApproved === true);
}

/**
 * The server-side gate: returns null (deny) or the authorized uid.
 * Keep this identical in spirit to lib/admin-auth.ts — the API routes below
 * layer this on top of verified Firebase ID tokens.
 */
export function growthAccessDecision(user: GrowthUserRecord, operation: "read" | "write"): "allow" | "deny" {
    if (operation === "write") return canAdministerGrowth(user) ? "allow" : "deny";
    return canViewGrowthAdmin(user) ? "allow" : "deny";
}