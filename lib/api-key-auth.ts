import { adminDatabase } from "@/lib/firebase-admin";

export async function validateApiKey(token: string): Promise<string | null> {
    const keysSnap = await adminDatabase.ref("api_keys").get();
    if (!keysSnap.exists()) return null;

    let userId: string | null = null;
    keysSnap.forEach((child) => {
        const val = child.val();
        if (val.key === token && !val.revoked) {
            userId = String(val.userId || "");
        }
    });

    return userId;
}
