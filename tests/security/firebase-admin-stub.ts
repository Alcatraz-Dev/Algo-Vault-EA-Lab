/**
 * Test-only firebase-admin stub — in-memory Auth + RTDB seam.
 *
 * This single file backs all aliased firebase-admin namespaces so that
 * `lib/firebase-admin.ts` executes to completion and the app-layer security
 * guards (`lib/admin-auth`, `lib/gateway`) run against a fully controlled,
 * credential-free database.
 *
 * No real Firebase credentials, no network. The guards under test are the
 * exact functions in `lib/admin-auth` (`requireAdmin`, `isAdminUid`,
 * `requireAdminOrProductOwner`) and `lib/gateway` (`verifyGatewayToken`,
 * `hasActiveTradingLicense`, `getGatewayTokenForUser`).
 */

// In-memory RTDB surface keyed by full path. Exported so test runners can
// mutate the store directly (the guards read from this same map).
export const rtDbStore = new Map<string, unknown>();

// Fake RTDB snapshot shaped like the real Firebase DataSnapshot:
// `exists()` and `val()`.
interface FakeSnapshot {
    exists(): boolean;
    val(): unknown;
}

// Fake RTDB reference with the `get`/`set`/`update`/`remove`/`child` shape the
// guards (and lib/gateway's token helpers) use.
interface FakeRef {
    get(): Promise<FakeSnapshot>;
    set(v: unknown): Promise<void>;
    update(v: unknown): Promise<void>;
    remove(): Promise<void>;
    child(c: string): FakeRef;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
    return !!v && typeof v === "object" && !Array.isArray(v);
}

// `get(path)` models RTDB subtree semantics: an exact-path read returns the
// stored value; a path-prefix read returns an object whose keys are the
// immediate children under that path.
function getFakeSnapshot(path: string): FakeSnapshot {
    const raw = rtDbStore.get(path);
    if (raw !== undefined) return { exists: () => true, val: () => raw };

    const children: Record<string, unknown> = {};
    for (const [key, value] of rtDbStore.entries()) {
        if (!key.startsWith(path + "/")) continue;

        const parts = key.slice(path.length + 1).split("/");
        let node = children;
        for (let i = 0; i < parts.length - 1; i++) {
            const part = parts[i];
            const next = node[part];
            const child: Record<string, unknown> = isPlainObject(next) ? next : {};
            node[part] = child;
            node = child;
        }
        node[parts[parts.length - 1]] = value;
    }
    return { exists: () => Object.keys(children).length > 0, val: () => children };
}

// Stub Auth: deterministic token -> { uid, role }. Server-side only.
async function fakeVerifyIdToken(token: string): Promise<{ uid: string; role?: string } | null> {
    try {
        const raw = token.replace(/^Bearer-/, "");
        const parts = raw.split(".");
        if (parts.length !== 3) return null;
        const payload = JSON.parse(atob(parts[1]));
        const uid = String(payload.sub || "").replace(/^algo-vault-/, "");
        if (!uid) return null;
        return { uid, role: uid === "superAdmin" ? "admin" : "customer" };
    } catch {
        return null;
    }
}

// Stub Database: ref(path) -> { get, set, update, remove, child }.
function makeFakeRef(path: string): FakeRef {
    return {
        get(): Promise<FakeSnapshot> {
            return Promise.resolve(getFakeSnapshot(path));
        },
        set(v: unknown): Promise<void> {
            rtDbStore.set(path, v);
            return Promise.resolve();
        },
        update(v: unknown): Promise<void> {
            const current = rtDbStore.get(path);
            const patch: Record<string, unknown> = isPlainObject(v) ? { ...v } : {};
            const base: Record<string, unknown> = isPlainObject(current) ? { ...current } : {};
            rtDbStore.set(path, { ...base, ...patch });
            return Promise.resolve();
        },
        remove(): Promise<void> {
            rtDbStore.delete(path);
            return Promise.resolve();
        },
        child(c: string): FakeRef {
            return makeFakeRef(`${path}/${c}`);
        },
    };
}

export const adminDatabase: { ref(path: string): FakeRef } = {
    ref: makeFakeRef,
};

// Module-level exports that lib/admin-auth.ts and lib/gateway.ts consume.
export const adminAuth = {
    verifyIdToken: fakeVerifyIdToken,
};

// Firebase Admin "SDK" surface: getApps / initializeApp / cert / getAuth /
// getDatabase, so `lib/firebase-admin.ts` executes to completion without the
// real SDK being present.
interface FakeApp {
    getAuth(): unknown;
    getDatabase(): unknown;
}

const fakeApp: FakeApp = {
    getAuth: () => adminAuth,
    getDatabase: () => adminDatabase,
};

// Real `getApps()` returns an App[] and lib/firebase-admin.ts reads
// `getApps().length` / `getApps()[0]`, so mirror that shape exactly (a
// function-valued stand-in would silently take the initializeApp() branch).
const apps: FakeApp[] = [];

export function getApps(): FakeApp[] {
    return apps;
}

// Both take the real SDK's arguments but ignore them: this is a seam, not a
// config loader, and the aliased caller supplies real (fake) credentials that
// must never be validated or logged here.
export function initializeApp(): FakeApp {
    if (apps.length === 0) apps.push(fakeApp);
    return apps[0];
}

export function cert(): { type: string } {
    return { type: "service_account" };
}

export function getAuth(app?: FakeApp): unknown {
    return app ? app.getAuth() : adminAuth;
}

export function getDatabase(app?: FakeApp): unknown {
    return app ? app.getDatabase() : adminDatabase;
}
