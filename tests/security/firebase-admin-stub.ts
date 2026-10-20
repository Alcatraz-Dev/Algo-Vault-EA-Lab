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

// Fake RTDB query — the `orderByChild` / `equalTo` / `limitToLast` chain.
//
// The append-only feeds (bot logs, signals, executions, audit trail) are read
// through these queries. The stub orders the children by the requested key and
// applies the limit, so a route that reads "the newest N" sees the same
// ordering it would see against real RTDB instead of an arbitrary one.
interface FakeQuery {
    orderByChild(child: string): FakeQuery;
    equalTo(value: unknown): FakeQuery;
    limitToLast(limit: number): FakeQuery;
    limitToFirst(limit: number): FakeQuery;
    get(): Promise<FakeSnapshot>;
}

// Fake RTDB reference with the `get`/`set`/`update`/`remove`/`child` shape the
// guards (and lib/gateway's token helpers) use.
interface FakeRef {
    key?: string;
    get(): Promise<FakeSnapshot>;
    set(v: unknown): Promise<void>;
    update(v: unknown): Promise<void>;
    remove(): Promise<void>;
    child(c: string): FakeRef;
    push(): FakeRef & { key: string };
    orderByChild(child: string): FakeQuery;
    limitToLast(limit: number): FakeQuery;
    limitToFirst(limit: number): FakeQuery;
    transaction(
        update: (current: unknown) => unknown
    ): Promise<{ committed: boolean; snapshot: FakeSnapshot }>;
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

// Children of a path, whether the path holds a node (its keys are the
// children) or only deeper records exist (their immediate children are).
function readChildren(path: string): Record<string, unknown> {
    const raw = rtDbStore.get(path);
    if (isPlainObject(raw)) return raw;

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
    return children;
}

// Ordering by a child key: numeric when both sides are numbers, otherwise
// lexicographic — the same comparison RTDB applies.
function compareByChild(a: unknown, b: unknown, childKey: string): number {
    const av = (a as Record<string, unknown>)[childKey];
    const bv = (b as Record<string, unknown>)[childKey];
    const an = Number(av);
    const bn = Number(bv);
    if (Number.isFinite(an) && Number.isFinite(bn)) return an - bn;
    return String(av ?? "").localeCompare(String(bv ?? ""));
}

function makeFakeQuery(path: string): FakeQuery {
    let childKey: string | null = null;
    let equalValue: unknown;
    let hasEqual = false;
    let limit: number | null = null;
    let takeLast = false;

    const query: FakeQuery = {
        orderByChild(child: string): FakeQuery {
            childKey = child;
            return query;
        },
        equalTo(value: unknown): FakeQuery {
            equalValue = value;
            hasEqual = true;
            return query;
        },
        limitToLast(n: number): FakeQuery {
            limit = n;
            takeLast = true;
            return query;
        },
        limitToFirst(n: number): FakeQuery {
            limit = n;
            takeLast = false;
            return query;
        },
        async get(): Promise<FakeSnapshot> {
            let rows = Object.entries(readChildren(path)).filter(([, v]) => isPlainObject(v));
            const key = childKey;
            if (key) {
                rows = rows.sort((a, b) => compareByChild(a[1], b[1], key));
                if (hasEqual) {
                    rows = rows.filter(([, v]) => (v as Record<string, unknown>)[key] === equalValue);
                }
            }
            if (limit !== null) {
                rows = takeLast
                    ? rows.slice(Math.max(0, rows.length - limit))
                    : rows.slice(0, limit);
            }
            const out: Record<string, unknown> = {};
            for (const [k, v] of rows) out[k] = v;
            return { exists: () => Object.keys(out).length > 0, val: () => out };
        },
    };
    return query;
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

// Per-path serialization queue: real RTDB serializes transactions that target
// the same node, so concurrent updaters always observe the previous commit.
const transactionQueues = new Map<string, Promise<unknown>>();

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
        // Mirrors the real SDK contract: the updater receives the current
        // value (null when absent), returning undefined aborts the write, and
        // concurrent transactions on the same node are serialized.
        //
        // The initial yield matters for tests: separate clients interleave
        // between their read and their commit, so a read-then-write claim
        // loses the race here exactly as it does against real RTDB.
        transaction(
            update: (current: unknown) => unknown
        ): Promise<{ committed: boolean; snapshot: FakeSnapshot }> {
            const run = async (): Promise<{ committed: boolean; snapshot: FakeSnapshot }> => {
                await new Promise<void>((resolve) => setTimeout(resolve, 0));
                const current = rtDbStore.has(path) ? rtDbStore.get(path) : null;
                const next = update(current);
                if (next === undefined) {
                    return { committed: false, snapshot: getFakeSnapshot(path) };
                }
                rtDbStore.set(path, next);
                return {
                    committed: true,
                    snapshot: { exists: () => true, val: () => next },
                };
            };
            const queued = (transactionQueues.get(path) ?? Promise.resolve()).then(run, run);
            transactionQueues.set(path, queued.catch(() => undefined));
            return queued;
        },
        child(c: string): FakeRef {
            return makeFakeRef(`${path}/${c}`);
        },
        orderByChild(child: string): FakeQuery {
            return makeFakeQuery(path).orderByChild(child);
        },
        limitToLast(limit: number): FakeQuery {
            return makeFakeQuery(path).limitToLast(limit);
        },
        limitToFirst(limit: number): FakeQuery {
            return makeFakeQuery(path).limitToFirst(limit);
        },
        // Mirrors RTDB push(): a child with a unique, monotonically ordered key.
        push(): FakeRef & { key: string } {
            pushCounter += 1;
            const key = `-push${String(pushCounter).padStart(6, "0")}`;
            return Object.assign(makeFakeRef(`${path}/${key}`), { key });
        },
    };
}

let pushCounter = 0;

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
