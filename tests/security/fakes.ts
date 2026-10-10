/** In-memory fakes for Firebase Auth + Realtime Database.
 *
 * These implement the shapes used by the security-focused helpers in
 * `lib/admin-auth.ts` so the authorization decision itself is exercised
 * against a controlled in-memory database WITHOUT a Firebase account.
 * They are a test seam only: the production `adminAuth` / `adminDatabase`
 * (real Firebase Admin SDK) are byte-for-byte unchanged, exactly as the
 * trading provider has a `Mt5DemoProvider` seam with the same contract.
 *
 * NOTE: These mocks stand in for the real Admin SDK. They verify the
 * application-layer authorization logic. Firebase security rules are still
 * audited statically from `database.rules.json`, and a production claim
 * requires the Firebase Emulator (see
 * docs/project-control/FIREBASE_RULES_AUDIT.md).
 */

export interface MockAdminAuth {
    /** Sync stand-in returning a stable fake token string. */
    createCustomToken(uid: string, claims?: Record<string, unknown>): string;
}

/** Minimal in-memory RTDB surface. */
export interface MockAdminDatabase {
    ref(path: string): MockRef;
    /** Sync convenience: `db.set(path, value)` without the `ref().set()` dance. */
    set(path: string, value: unknown): void;
}

/** Minimal RTDB reference with the `get`/`set`/`update` shape used by the
 *  admin routes. */
export interface MockRef {
    get(): Promise<{ exists(): boolean; val(): unknown }>;
    set(value: unknown): Promise<unknown>;
    update(value: unknown): Promise<unknown>;
    child(path: string): MockRef;
}

// Singleton instance so the security test can call mockAdminAuth.createCustomToken()
// directly (the test does mockAdminAuth.createCustomToken(...), treating
// mockAdminAuth as an object). This mirrors how the real adminAuth stub is
// passed into the routes.
export const mockAdminAuth: MockAdminAuth & { userRecords: Map<string, unknown> } = (() => {
    const userRecords = new Map<string, unknown>();

    function createCustomToken(
        uid: string,
        claims?: Record<string, unknown>
    ): string {
        const base = {
            sub: "algo-vault",
            role: claims?.role ?? "customer",
            ...claims,
        };
        const payload = JSON.stringify(base);
        return "Bearer-fake-token-" + uid + "-" + btoa(payload);
    }

    return {
        createCustomToken,
        userRecords,
    };
})();

export function mockAdminDatabase(): MockAdminDatabase {
    const store = new Map<string, unknown>();

    const makeRef = (path: string): MockRef => ({
        get(): Promise<{ exists(): boolean; val(): unknown }> {
            const val = store.get(path);
            return Promise.resolve({
                exists: () => val !== undefined,
                val: () => val,
            });
        },
        set(value: unknown): Promise<unknown> {
            store.set(path, value);
            return Promise.resolve();
        },
        update(value: unknown): Promise<unknown> {
            const current = store.get(path);
            const patch =
                value && typeof value === "object" && !Array.isArray(value)
                    ? (value as Record<string, unknown>)
                    : {};
            const base =
                current && typeof current === "object" && !Array.isArray(current)
                    ? (current as Record<string, unknown>)
                    : {};
            store.set(path, { ...base, ...patch });
            return Promise.resolve();
        },
        child(childPath: string): MockRef {
            return makeRef(`${path}/${childPath}`);
        },
    });

    return {
        ref: makeRef,
        set(path: string, value: unknown): void {
            store.set(path, value);
        },
    };
}

// Named re-exports so the security test's imports resolve.
import { verifyGatewayToken, hasActiveTradingLicense, getGatewayTokenForUser } from "@/lib/gateway";
export { verifyGatewayToken, hasActiveTradingLicense, getGatewayTokenForUser };
