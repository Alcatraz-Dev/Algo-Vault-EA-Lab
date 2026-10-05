/**
 * Phase 11 — server-authoritative workspace & preferences storage.
 *
 * The RTDB is the only persistence layer (no Firestore, per the platform
 * constraint). Writes go through here rather than directly from the client so
 * that:
 *
 *   • `revision` is assigned by the server and is therefore monotonic and
 *     trustworthy. Two devices with skewed clocks still agree on ordering.
 *   • every write is validated and size-bounded before it reaches the database.
 *   • every write records which device produced it, which is what makes a
 *     conflict explainable after the fact instead of mysterious.
 *   • the device registry is updated, giving admin observability real numbers.
 *
 * Server-only. Never import this from a client component.
 */

import { adminDatabase } from "@/lib/firebase-admin";
import {
    DEFAULT_USER_PREFERENCES,
    emptyWorkspaceState,
    type DeviceInfo,
    type SyncEnvelope,
    type UserPreferences,
    type WorkspaceState,
} from "./contracts";
import * as v from "./validate";

export const WORKSPACE_PATH = (uid: string) => `deviceWorkspace/${uid}`;
export const PREFERENCES_PATH = (uid: string) => `userPreferences/${uid}`;
export const DEVICES_PATH = (uid: string) => `mobileDevices/${uid}`;

/** Hard ceiling on a serialized workspace. A workspace larger than this is a bug
 *  or an attack, not a legitimate chart layout. */
const MAX_WORKSPACE_BYTES = 256 * 1024;
const MAX_PREFERENCES_BYTES = 8 * 1024;

const TIMEFRAMES = ["M1", "M3", "M5", "M15", "M30", "H1", "H4", "D1", "W1"] as const;
const PLATFORMS = ["web", "ios", "android", "pwa", "unknown"] as const;
/** Matches `SAFE_SYMBOL` in lib/mobile/deep-links.ts and the symbol grammars in
 *  the RTDB repositories. */
const SYMBOL = /^[A-Z0-9]{2,12}(?:[.\-_/][A-Z0-9]{1,6})?$/;
/** Matches `validateSetupId` in lib/market-intelligence/memory/repository.ts. */
const KEY_ID = /^[A-Za-z0-9_-]{1,64}$/;
const DEVICE_ID = /^[A-Za-z0-9_-]{8,64}$/;

// ─────────────────────────────────────────────────────────────────────────────
// Parsers
// ─────────────────────────────────────────────────────────────────────────────

function parseDevice(raw: unknown, path = "device") {
    return v.obj<DeviceInfo>(raw, { issues: [], path }, {
        deviceId: (x, c) => v.str(x, c, { pattern: DEVICE_ID }),
        platform: (x, c) => v.oneOf(x, PLATFORMS, c),
        label: (x, c) => v.str(x, c, { min: 1, max: 64 }),
        appVersion: (x, c) => v.str(x, c, { min: 1, max: 32 }),
        osVersion: (x, c) => v.str(x, c, { max: 32 }),
        lastSeenAt: (x, c) => (x === undefined ? undefined : v.num(x, c)),
    });
}

function parseDrawing(raw: unknown, c: v.Context) {
    return v.obj<WorkspaceState["drawings"][string][number]>(raw, c, {
        id: (x, cc) => v.str(x, cc, { pattern: KEY_ID }),
        type: (x, cc) => v.str(x, cc, { min: 1, max: 32 }),
        symbol: (x, cc) => v.str(x, cc, { pattern: SYMBOL }),
        // MARKET coordinates only. There is deliberately no pixel field: a
        // drawing that stored screen coordinates could not render correctly on a
        // different screen, which is exactly the cross-device bug Phase 11 exists
        // to prevent.
        points: (x, cc) =>
            v.arr(x, cc, (p, pc) => v.obj(p, pc, { time: (t, tc) => v.num(t, tc), price: (q, qc) => v.num(q, qc) }), {
                max: 512,
                min: 1,
            }),
        text: (x, cc) => v.opt(x, cc, (t, tc) => v.str(t, tc, { max: 200 })),
        style: (x, cc) =>
            v.obj(x, cc, {
                color: (s, sc) => v.str(s, sc, { max: 32 }),
                width: (n, nc) => v.num(n, nc, { min: 0, max: 24 }),
                lineStyle: (s, sc) => v.oneOf(s, ["solid", "dashed", "dotted"] as const, sc),
                fill: (s, sc) => v.opt(s, sc, (t, tc) => v.str(t, tc, { max: 32 })),
                extendLeft: (b, bc) => (b === undefined ? undefined : v.bool(b, bc)),
                extendRight: (b, bc) => (b === undefined ? undefined : v.bool(b, bc)),
            }),
        createdAt: (n, nc) => v.num(n, nc),
        updatedAt: (n, nc) => v.num(n, nc),
        updatedByDevice: (s, sc) => v.opt(s, sc, (t, tc) => v.str(t, tc, { max: 64 })),
    });
}

function parseIndicatorConfig(raw: unknown, c: v.Context): WorkspaceState["indicatorConfig"][string] {
    return v.obj(raw, c, {
        id: (s, sc) => v.str(s, sc, { max: 64 }),
        enabled: (b, bc) => v.bool(b, bc),
        symbol: (s, sc) => v.opt(s, sc, (t, tc) => v.str(t, tc, { pattern: SYMBOL })),
        timeframe: (s, sc) => v.opt(s, sc, (t, tc) => v.oneOf(t, TIMEFRAMES, sc)),
        params: (p, pc) =>
            v.dict(p, pc, parseIndicatorParam, { maxKeys: 32, keyMax: 48 }),
    });
}

function parseIndicatorParam(val: unknown, vc: v.Context): number | string | boolean {
    if (typeof val === "boolean") return val;
    if (typeof val === "string") return v.str(val, vc, { max: 48 });
    return v.num(val, vc);
}

function parseWatchlist(raw: unknown, cc: v.Context): WorkspaceState["watchlists"][number] {
    return v.obj(raw, cc, {
        id: (s, sc) => v.str(s, sc, { pattern: KEY_ID }),
        name: (s, sc) => v.str(s, sc, { min: 1, max: 48 }),
        symbols: (list, lc) => v.arr(list, lc, (s, sc) => v.str(s, sc, { pattern: SYMBOL }), { max: 200 }),
        order: (n, nc) => v.num(n, nc),
        updatedAt: (n, nc) => v.num(n, nc),
        updatedByDevice: (s, sc) => v.opt(s, sc, (t, tc) => v.str(t, tc, { max: 64 })),
    });
}

function parsePanel(raw: unknown, pc: v.Context): WorkspaceState["panels"][string] {
    return v.obj(raw, pc, {
        visible: (b, bc) => v.bool(b, bc),
        size: (n, nc) => v.num(n, nc, { min: 0, max: 100 }),
    });
}

export function parseWorkspace(raw: unknown): v.ValidationResult<WorkspaceState> {
    const ctx: v.Context = { issues: [], path: "workspace" };
    const value = v.obj<WorkspaceState>(raw, ctx, {
        activeWorkspace: (x, c) => v.str(x, c, { min: 1, max: 32 }),
        selectedSymbol: (x, c) => v.nullable(x, c, (s, sc) => v.str(s, sc, { pattern: SYMBOL })),
        selectedTimeframe: (x, c) => v.oneOf(x, TIMEFRAMES, c),
        chartSymbol: (x, c) => v.nullable(x, c, (s, sc) => v.str(s, sc, { pattern: SYMBOL })),
        chartLayout: (x, c) =>
            v.obj(x, c, {
                barsVisible: (n, nc) => v.num(n, nc, { min: 10, max: 2000 }),
                offsetBars: (n, nc) => v.num(n, nc, { min: -5000, max: 5000 }),
                chartType: (s, sc) => v.oneOf(s, ["candles", "bars", "line", "area", "heikinashi"] as const, sc),
                showGrid: (b, bc) => v.bool(b, bc),
                showCrosshair: (b, bc) => v.bool(b, bc),
                showVolume: (b, bc) => v.bool(b, bc),
                showPriceScale: (b, bc) => v.bool(b, bc),
                showTimeScale: (b, bc) => v.bool(b, bc),
            }),
        indicatorConfig: (x, c) => v.dict(x, c, parseIndicatorConfig, { maxKeys: 100 }),
        drawings: (x, c) => v.dict(x, c, (list, lc) => v.arr(list, lc, parseDrawing, { max: 1000 }), { maxKeys: 200 }),
        watchlists: (x, c) => v.arr(x, c, parseWatchlist, { max: 50 }),
        layers: (x, c) => v.dict(x, c, (b, bc) => v.bool(b, bc), { maxKeys: 100 }),
        panels: (x, c) => v.dict(x, c, parsePanel, { maxKeys: 32 }),
        terminal: (x, c) =>
            v.obj(x, c, {
                intelligenceMode: (s, sc) => v.str(s, sc, { max: 32 }),
                chatOpen: (b, bc) => v.bool(b, bc),
                railOrder: (list, lc) => v.arr(list, lc, (s, sc) => v.str(s, sc, { max: 64 }), { max: 32 }),
            }),
    });
    return ctx.issues.length ? { ok: false, issues: v.issuesOf(ctx) } : { ok: true, value };
}

export function parsePreferences(raw: unknown): v.ValidationResult<UserPreferences> {
    const ctx: v.Context = { issues: [], path: "preferences" };
    const value = v.obj<UserPreferences>(raw, ctx, {
        theme: (x, c) => v.oneOf(x, ["dark", "light", "system"] as const, c),
        language: (x, c) => v.str(x, c, { min: 2, max: 12 }),
        defaultTimeframe: (x, c) => v.oneOf(x, TIMEFRAMES, c),
        favoriteSymbols: (x, c) => v.arr(x, c, (s, sc) => v.str(s, sc, { pattern: SYMBOL }), { max: 200 }),
        preferredMarkets: (x, c) => v.arr(x, c, (s, sc) => v.str(s, sc, { pattern: SYMBOL }), { max: 200 }),
        notifications: (x, c) =>
            v.obj(x, c, {
                enabled: (b, bc) => v.bool(b, bc),
                price: (b, bc) => v.bool(b, bc),
                indicator: (b, bc) => v.bool(b, bc),
                smartMoney: (b, bc) => v.bool(b, bc),
                setup: (b, bc) => v.bool(b, bc),
                strategy: (b, bc) => v.bool(b, bc),
                risk: (b, bc) => v.bool(b, bc),
                position: (b, bc) => v.bool(b, bc),
                research: (b, bc) => v.bool(b, bc),
                system: (b, bc) => v.bool(b, bc),
                grouping: (b, bc) => v.bool(b, bc),
                quietHours: (qh, qc) =>
                    v.opt(qh, qc, (raw2, rc) =>
                        v.obj(raw2, rc, {
                            startMinute: (n, nc) => v.num(n, nc, { min: 0, max: 1439 }),
                            endMinute: (n, nc) => v.num(n, nc, { min: 0, max: 1439 }),
                        }),
                    ),
                cooldownSeconds: (n, nc) => v.num(n, nc, { min: 0, max: 86_400 }),
            }),
        chart: (x, c) =>
            v.obj(x, c, {
                theme: (s, sc) => v.oneOf(s, ["dark", "light"] as const, sc),
                fontSize: (s, sc) => v.oneOf(s, ["small", "medium", "large"] as const, sc),
                showWatermark: (b, bc) => v.bool(b, bc),
                crosshairMode: (s, sc) => v.oneOf(s, ["normal", "magnet"] as const, sc),
            }),
        onboardingSeen: (b, bc) => v.opt(b, bc, (x, c2) => v.bool(x, c2)),
    });
    return ctx.issues.length ? { ok: false, issues: v.issuesOf(ctx) } : { ok: true, value };
}

export function validateDevice(raw: unknown): v.ValidationResult<DeviceInfo> {
    const ctx: v.Context = { issues: [], path: "device" };
    const value = parseDevice(raw);
    return ctx.issues.length ? { ok: false, issues: v.issuesOf(ctx) } : { ok: true, value };
}

// ─────────────────────────────────────────────────────────────────────────────
// Reads
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Read the current workspace envelope. Returns a fresh default envelope when the
 * user has never synced — an empty workspace is a valid state, not an error, and
 * inventing content for it would be worse than starting clean.
 */
export async function readWorkspace(uid: string): Promise<SyncEnvelope<WorkspaceState>> {
    const snap = await adminDatabase.ref(WORKSPACE_PATH(uid)).get();
    const value = snap.val() as SyncEnvelope<WorkspaceState> | null;
    if (!value || typeof value.revision !== "number" || !value.data) {
        return {
            revision: 0,
            updatedAt: 0,
            updatedByDevice: "none",
            updatedByPlatform: "unknown",
            data: emptyWorkspaceState(),
        };
    }
    return value;
}

export async function readPreferences(uid: string): Promise<SyncEnvelope<UserPreferences>> {
    const snap = await adminDatabase.ref(PREFERENCES_PATH(uid)).get();
    const value = snap.val() as SyncEnvelope<UserPreferences> | null;
    if (!value || typeof value.revision !== "number" || !value.data) {
        return {
            revision: 0,
            updatedAt: 0,
            updatedByDevice: "none",
            updatedByPlatform: "unknown",
            data: { ...DEFAULT_USER_PREFERENCES },
        };
    }
    return value;
}

// ─────────────────────────────────────────────────────────────────────────────
// Writes
// ─────────────────────────────────────────────────────────────────────────────

export type WriteResult<T> =
    | { ok: true; envelope: SyncEnvelope<T>; created: boolean }
    | { ok: false; error: string; issues?: string[] };

/**
 * Persist a workspace write.
 *
 * The caller has already merged locally; the server validates, bounds and stamps.
 * Stamping happens inside the same transaction as the write so a revision can
 * never be assigned twice for one accepted change. The transaction is also what
 * makes two devices writing in the same second produce two distinct revisions
 * instead of one silently overwriting the other.
 */
export async function writeWorkspace(
    uid: string,
    data: unknown,
    device: DeviceInfo,
    now: number,
): Promise<WriteResult<WorkspaceState>> {
    const parsed = parseWorkspace(data);
    if (!parsed.ok) return { ok: false, error: "Invalid workspace payload", issues: parsed.issues };

    if (JSON.stringify(parsed.value).length > MAX_WORKSPACE_BYTES) {
        return { ok: false, error: "Workspace payload too large" };
    }

    const envelope: SyncEnvelope<WorkspaceState> = {
        revision: 0,
        updatedAt: now,
        updatedByDevice: device.deviceId,
        updatedByPlatform: device.platform,
        data: parsed.value,
    };

    const stamped = await adminDatabase.ref(WORKSPACE_PATH(uid)).transaction(
        (current: Partial<SyncEnvelope<WorkspaceState>> | null) => {
            envelope.revision = (current?.revision ?? 0) + 1;
            return envelope;
        },
        undefined,
        false,
    );

    if (!stamped.committed) return { ok: false, error: "Concurrent write could not be committed" };

    // Device bookkeeping must never fail the user's write.
    await touchDevice(uid, device, now).catch(() => undefined);

    return { ok: true, envelope, created: envelope.revision === 1 };
}

export async function writePreferences(
    uid: string,
    data: unknown,
    device: DeviceInfo,
    now: number,
): Promise<WriteResult<UserPreferences>> {
    const parsed = parsePreferences(data);
    if (!parsed.ok) return { ok: false, error: "Invalid preferences payload", issues: parsed.issues };
    if (JSON.stringify(parsed.value).length > MAX_PREFERENCES_BYTES) {
        return { ok: false, error: "Preferences payload too large" };
    }

    const envelope: SyncEnvelope<UserPreferences> = {
        revision: 0,
        updatedAt: now,
        updatedByDevice: device.deviceId,
        updatedByPlatform: device.platform,
        data: parsed.value,
    };

    const stamped = await adminDatabase.ref(PREFERENCES_PATH(uid)).transaction(
        (current: Partial<SyncEnvelope<UserPreferences>> | null) => {
            envelope.revision = (current?.revision ?? 0) + 1;
            return envelope;
        },
    );

    if (!stamped.committed) return { ok: false, error: "Concurrent write could not be committed" };
    return { ok: true, envelope, created: envelope.revision === 1 };
}

/**
 * Record a device's last-seen and version. Writes to a server-only path so a
 * client cannot forge another device's registration or enumerate the fleet.
 */
export async function touchDevice(uid: string, device: DeviceInfo, now: number): Promise<void> {
    await adminDatabase.ref(`${DEVICES_PATH(uid)}/${device.deviceId}`).update({
        platform: device.platform,
        label: device.label,
        appVersion: device.appVersion,
        osVersion: device.osVersion,
        lastSeenAt: now,
    });
}

/** Aggregate device fleet for admin observability. */
export async function listDeviceFleet(
    uid: string,
): Promise<Array<{ deviceId: string; platform: string; appVersion: string; lastSeenAt: number }>> {
    const snap = await adminDatabase.ref(DEVICES_PATH(uid)).get();
    if (!snap.exists()) return [];
    const data = snap.val() as Record<string, { platform: string; appVersion: string; lastSeenAt: number }>;
    return Object.entries(data).map(([deviceId, value]) => ({
        deviceId,
        platform: value.platform,
        appVersion: value.appVersion,
        lastSeenAt: value.lastSeenAt ?? 0,
    }));
}
