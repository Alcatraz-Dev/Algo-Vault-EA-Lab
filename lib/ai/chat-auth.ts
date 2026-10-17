/**
 * Firebase-backed chat authorization helpers.
 *
 * The Admin SDK (and its `server-only` guard) is loaded lazily so importing the
 * route in a non-Next test runner does not pull the whole Admin module at
 * module-evaluation time. In production the dynamic import is resolved once and
 * cached by Node.
 *
 * Both helpers fail closed: any verification or datastore failure means "not
 * authenticated" / "not an admin".
 */

export async function verifyChatToken(token: string): Promise<{ uid: string } | null> {
    try {
        const { authenticateToken } = await import("@/lib/admin-auth");
        const decoded = await authenticateToken(token);
        return decoded ? { uid: decoded.uid } : null;
    } catch {
        return null;
    }
}

export async function isChatAdmin(uid: string): Promise<boolean> {
    if (typeof uid !== "string" || uid.trim() === "") return false;
    try {
        const { isAdminUid } = await import("@/lib/admin-auth");
        return await isAdminUid(uid);
    } catch {
        return false;
    }
}
