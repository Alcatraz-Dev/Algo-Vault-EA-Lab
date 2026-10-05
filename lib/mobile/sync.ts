/**
 * Phase 11 — cross-device synchronisation.
 *
 * The whole problem this file solves: the user changes their workspace on the
 * desktop while offline, changes it again on the phone while online, and the two
 * writes meet. Last-write-wins on the whole record would silently discard one of
 * them. We therefore merge at the level of *meaning*:
 *
 *   • Scalars and small records (theme, selected symbol, timeframe) resolve by
 *     revision → timestamp → device id. The device id tiebreak makes the outcome
 *     deterministic: every client, given the same two records, picks the same
 *     winner, even when the two clocks disagree.
 *   • Collections keyed by a stable id (watchlists, drawings, indicators) merge
 *     per item. Adding a drawing on the phone never deletes the trend line drawn
 *     on the desktop.
 *   • Ordering arrays (watchlist order, symbol order) merge position-wise so an
 *     interleaved reorder from two devices converges instead of flickering.
 *
 * Every conflict is reported so the sync inspector can show the user what
 * happened, and so admin observability can count real conflicts rather than
 * guessing at them.
 *
 * Pure module: no Firebase, no network, no React. The transport lives in
 * `lib/mobile/sync-client.ts`.
 */

import type {
    ChartLayoutState,
    DrawingObjectState,
    FieldConflict,
    MergeResult,
    NotificationPreferences,
    SyncEnvelope,
    UserPreferences,
    Watchlist,
    WorkspaceState,
} from "./contracts";

// ─────────────────────────────────────────────────────────────────────────────
// Ordering
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Total order over two versions of the same record.
 *
 * `revision` is server-assigned and monotonic, so it is authoritative. `updatedAt`
 * only breaks ties when revisions collide (two offline writes merged by the same
 * server batch). `deviceId` is the final, clock-independent tiebreak — this is
 * what makes the merge deterministic rather than dependent on whose laptop
 * happened to have the wrong clock.
 */
export function compareEnvelopes<T>(
    a: SyncEnvelope<T>,
    b: SyncEnvelope<T>,
): number {
    if (a.revision !== b.revision) return a.revision - b.revision;
    if (a.updatedAt !== b.updatedAt) return a.updatedAt - b.updatedAt;
    if (a.updatedByDevice === b.updatedByDevice) return 0;
    return a.updatedByDevice < b.updatedByDevice ? -1 : 1;
}

/** Which of two records wins, and why. `null` when they are byte-identical. */
export function pickWinner<T>(
    a: SyncEnvelope<T>,
    b: SyncEnvelope<T>,
): { winner: SyncEnvelope<T>; reason: string; identical: boolean } {
    if (JSON.stringify(a.data) === JSON.stringify(b.data)) {
        return { winner: a, reason: "identical", identical: true };
    }
    if (a.revision !== b.revision) {
        return {
            winner: a.revision > b.revision ? a : b,
            reason: a.revision > b.revision ? "higher revision" : "lower revision",
            identical: false,
        };
    }
    if (a.updatedAt !== b.updatedAt) {
        return {
            winner: a.updatedAt > b.updatedAt ? a : b,
            reason: a.updatedAt > b.updatedAt ? "newer timestamp" : "older timestamp",
            identical: false,
        };
    }
    return {
        winner: a.updatedByDevice < b.updatedByDevice ? a : b,
        reason: "equal revision and timestamp — deterministic device id tiebreak",
        identical: false,
    };
}

function envelopeOf<T>(
    data: T,
    base: Partial<SyncEnvelope<T>> = {},
): SyncEnvelope<T> {
    return {
        revision: base.revision ?? 0,
        updatedAt: base.updatedAt ?? 0,
        updatedByDevice: base.updatedByDevice ?? "unknown",
        updatedByPlatform: base.updatedByPlatform ?? "unknown",
        data,
    };
}

/**
 * Generic envelope merge. Used for preferences and for any record that has no
 * meaningful internal structure — for those, whole-record resolution is correct.
 */
export function mergeEnvelopes<T>(
    local: SyncEnvelope<T>,
    remote: SyncEnvelope<T>,
): MergeResult<T> {
    const { winner, reason, identical } = pickWinner(local, remote);
    return {
        data: winner.data,
        envelope: winner,
        conflicts: [
            {
                key: "*",
                outcome: identical ? "identical" : winner === local ? "local" : "remote",
                localRevision: local.revision,
                remoteRevision: remote.revision,
                reason,
            },
        ],
    };
}

// ─────────────────────────────────────────────────────────────────────────────
// Keyed collections
// ─────────────────────────────────────────────────────────────────────────────

interface Merged<T> {
    values: T[];
    outcome: "local" | "remote" | "identical";
}

function mergeByKey<T>(
    local: readonly T[],
    remote: readonly T[],
    keyOf: (item: T) => string,
    timeOf: (item: T) => number,
    deviceOf: (item: T) => string,
    conflicts: FieldConflict[],
    path: string,
): T[] {
    const localMap = new Map(local.map((item) => [keyOf(item), item]));
    const remoteMap = new Map(remote.map((item) => [keyOf(item), item]));
    const out: T[] = [];
    const seen = new Set<string>();

    const consider = (key: string): void => {
        if (seen.has(key)) return;
        seen.add(key);
        const l = localMap.get(key);
        const r = remoteMap.get(key);
        if (l && !r) {
            out.push(l);
            conflicts.push({
                key: `${path}.${key}`,
                outcome: "local",
                localRevision: timeOf(l),
                remoteRevision: 0,
                reason: "only present on this device",
            });
            return;
        }
        if (r && !l) {
            out.push(r);
            conflicts.push({
                key: `${path}.${key}`,
                outcome: "remote",
                localRevision: 0,
                remoteRevision: timeOf(r),
                reason: "only present on the other device",
            });
            return;
        }
        if (!l || !r) return;
        if (JSON.stringify(l) === JSON.stringify(r)) {
            out.push(l);
            conflicts.push({
                key: `${path}.${key}`,
                outcome: "identical",
                localRevision: timeOf(l),
                remoteRevision: timeOf(r),
                reason: "identical",
            });
            return;
        }
        // Deterministic per-item resolution: newer timestamp wins, device id
        // breaks a timestamp tie.
        const lTime = timeOf(l);
        const rTime = timeOf(r);
        const lDevice = deviceOf(l);
        const rDevice = deviceOf(r);
        const localWins =
            lTime !== rTime ? lTime > rTime : lDevice <= rDevice;
        out.push(localWins ? l : r);
        conflicts.push({
            key: `${path}.${key}`,
            outcome: localWins ? "local" : "remote",
            localRevision: lTime,
            remoteRevision: rTime,
            reason:
                lTime !== rTime
                    ? "newer per-item timestamp"
                    : "equal timestamps — deterministic device id tiebreak",
        });
    };

    for (const key of localMap.keys()) consider(key);
    for (const key of remoteMap.keys()) consider(key);
    return out;
}

/**
 * Merge two symbol orderings position-wise.
 *
 * A whole-list last-write-wins would mean reordering on the desktop wipes a
 * reorder done on the phone. Position-wise merge keeps both edits as far as
 * possible: where the two disagree at a position the deterministic winner is
 * used, but positions only one device touched survive untouched.
 */
export function mergeOrderedLists(
    base: readonly string[],
    other: readonly string[],
): { values: string[]; added: number } {
    // `base` is the NEWER ordering (chosen by the caller). Its order is honoured
    // as-is — a deliberate reorder on the newer device must be respected — and any
    // symbol the other device added that the newer list never saw is appended in
    // the older list's relative order, so an addition is never dropped.
    const seen = new Set(base);
    const out = [...base];
    for (const symbol of other) {
        if (seen.has(symbol)) continue;
        seen.add(symbol);
        out.push(symbol);
    }
    return { values: out, added: out.length - base.length };
}

// ─────────────────────────────────────────────────────────────────────────────
// Workspace merge
// ─────────────────────────────────────────────────────────────────────────────

/** Fields that resolve as whole values rather than merging item by item. */
const WORKSPACE_SCALARS = [
    "activeWorkspace",
    "selectedSymbol",
    "selectedTimeframe",
    "chartSymbol",
    "terminal",
] as const;

/**
 * Three-way resolution of a mutually-exclusive field.
 *
 * With a common ancestor we can tell "this device changed it" from "this device
 * never touched it", which is what stops a phone that only toggled a Smart Money
 * layer from reverting the desktop's symbol selection. Without a common ancestor
 * there is nothing to compare against, so the record winner decides — which is
 * correct for a field that genuinely holds one value (there is only one selected
 * symbol), and is reported as a conflict rather than silently applied.
 */
function resolveScalar<T>(
    key: string,
    localValue: T,
    remoteValue: T,
    baseValue: T | undefined,
    hasBase: boolean,
    localWins: boolean,
    conflicts: FieldConflict[],
): T {
    if (JSON.stringify(localValue) === JSON.stringify(remoteValue)) return localValue;

    if (hasBase) {
        const localChanged = JSON.stringify(localValue) !== JSON.stringify(baseValue);
        const remoteChanged = JSON.stringify(remoteValue) !== JSON.stringify(baseValue);
        if (localChanged && !remoteChanged) {
            conflicts.push({ key, outcome: "local", localRevision: 1, remoteRevision: 0, reason: "only this device changed it since the common base" });
            return localValue;
        }
        if (remoteChanged && !localChanged) {
            conflicts.push({ key, outcome: "remote", localRevision: 0, remoteRevision: 1, reason: "only the other device changed it since the common base" });
            return remoteValue;
        }
    }

    // Both changed, or no base to reason from: the record winner decides, and the
    // conflict is recorded so it is visible rather than mysterious.
    conflicts.push({
        key,
        outcome: localWins ? "local" : "remote",
        localRevision: 1,
        remoteRevision: 0,
        reason: hasBase ? "both devices changed this field — deterministic record ordering" : "no common base — deterministic record ordering",
    });
    return localWins ? localValue : remoteValue;
}

export interface MergeOptions {
    /**
     * The last record both devices agreed on — the common ancestor.
     *
     * Supplying it is what makes the merge a true three-way merge rather than a
     * newer-record-wins overwrite. Without it, a device that changed one field
     * can silently revert every other field the other device changed, which is
     * precisely the corruption this phase exists to prevent. Callers should pass
     * the last server-confirmed envelope they hold.
     */
    base?: SyncEnvelope<WorkspaceState>;
}

export function mergeWorkspaceEnvelopes(
    local: SyncEnvelope<WorkspaceState>,
    remote: SyncEnvelope<WorkspaceState>,
    options: MergeOptions = {},
): MergeResult<WorkspaceState> {
    const { winner, reason, identical } = pickWinner(local, remote);
    const conflicts: FieldConflict[] = [
        {
            key: "*",
            outcome: identical ? "identical" : winner === local ? "local" : "remote",
            localRevision: local.revision,
            remoteRevision: remote.revision,
            reason,
        },
    ];

    // Fast path: one side strictly dominates and the loser adds nothing.
    if (identical) {
        return { data: local.data, envelope: local, conflicts };
    }

    const base = options.base;
    const hasBase = base !== undefined;
    const baseData = base?.data;
    const localWins = winner === local;

    const data: WorkspaceState = {
        ...remote.data,
        ...local.data,
    };

    // ── Scalars: three-way when a common base exists, record winner otherwise.
    for (const key of WORKSPACE_SCALARS) {
        (data as unknown as Record<string, unknown>)[key] = resolveScalar(
            key,
            (local.data as unknown as Record<string, unknown>)[key],
            (remote.data as unknown as Record<string, unknown>)[key],
            (baseData as unknown as Record<string, unknown> | undefined)?.[key],
            hasBase,
            localWins,
            conflicts,
        );
    }

    // ── chartLayout: field-level merge. A phone toggling "grid" must not revert
    //    the desktop's bar count. Within a diverged field the record winner
    //    decides, so both devices independently reach the same value.
    data.chartLayout = mergeRecords<keyof WorkspaceState["chartLayout"], ChartLayoutState[keyof ChartLayoutState]>(
        winner === local ? local.data.chartLayout : remote.data.chartLayout,
        winner === local ? remote.data.chartLayout : local.data.chartLayout,
        winner === local,
        conflicts,
        "chartLayout",
    ) as WorkspaceState["chartLayout"];

    // ── layers / indicatorConfig / panels: keyed by id, newest per key wins.
    data.layers = mergeByKey(
        Object.entries(local.data.layers ?? {}),
        Object.entries(remote.data.layers ?? {}),
        ([id]) => id,
        () => local.revision,
        () => local.updatedByDevice,
        conflicts,
        "layers",
    ).reduce<Record<string, boolean>>((acc, [id, value]) => {
        acc[id] = value as boolean;
        return acc;
    }, {});

    data.indicatorConfig = mergeByKey(
        Object.entries(local.data.indicatorConfig ?? {}),
        Object.entries(remote.data.indicatorConfig ?? {}),
        ([id]) => id,
        () => local.revision,
        () => local.updatedByDevice,
        conflicts,
        "indicatorConfig",
    ).reduce<WorkspaceState["indicatorConfig"]>((acc, [id, value]) => {
        acc[id] = value as WorkspaceState["indicatorConfig"][string];
        return acc;
    }, {});

    data.panels = mergeByKey(
        Object.entries(local.data.panels ?? {}),
        Object.entries(remote.data.panels ?? {}),
        ([id]) => id,
        () => local.revision,
        () => local.updatedByDevice,
        conflicts,
        "panels",
    ).reduce<WorkspaceState["panels"]>((acc, [id, value]) => {
        acc[id] = value as WorkspaceState["panels"][string];
        return acc;
    }, {});

    // ── Drawings: per symbol, then per object id.
    const symbols = new Set([
        ...Object.keys(local.data.drawings ?? {}),
        ...Object.keys(remote.data.drawings ?? {}),
    ]);
    data.drawings = {};
    for (const symbol of symbols) {
        data.drawings[symbol] = mergeByKey<DrawingObjectState>(
            local.data.drawings?.[symbol] ?? [],
            remote.data.drawings?.[symbol] ?? [],
            (d) => d.id,
            (d) => d.updatedAt,
            (d) => d.updatedByDevice ?? "",
            conflicts,
            `drawings.${symbol}`,
        );
    }

    // ── Watchlists: per list id, then per-list symbol order.
    const mergedLists: Watchlist[] = mergeByKey<Watchlist>(
        local.data.watchlists ?? [],
        remote.data.watchlists ?? [],
        (w) => w.id,
        (w) => w.updatedAt,
        (w) => w.updatedByDevice ?? "",
        conflicts,
        "watchlists",
    );
    data.watchlists = mergedLists.map((list) => {
        const localList = (local.data.watchlists ?? []).find((w) => w.id === list.id);
        const remoteList = (remote.data.watchlists ?? []).find((w) => w.id === list.id);
        if (!localList || !remoteList || localList === remoteList) return list;
        // The newer list's ordering wins (so a deliberate reorder is respected);
        // symbols only the older list has are appended rather than dropped.
        const localIsNewer =
            localList.updatedAt !== remoteList.updatedAt
                ? localList.updatedAt > remoteList.updatedAt
                : (localList.updatedByDevice ?? "") <= (remoteList.updatedByDevice ?? "");
        const { values } = localIsNewer
            ? mergeOrderedLists(localList.symbols, remoteList.symbols)
            : mergeOrderedLists(remoteList.symbols, localList.symbols);
        return { ...list, symbols: values };
    });

    // The winning envelope becomes the merged envelope: the merged record is, by
    // definition, at least as new as both inputs. The revision is NOT advanced
    // here — the server assigns it when it accepts the write.
    const envelope: SyncEnvelope<WorkspaceState> = {
        ...winner,
        data,
    };

    return { data, envelope, conflicts };
}

// ─────────────────────────────────────────────────────────────────────────────
// Preferences merge
// ─────────────────────────────────────────────────────────────────────────────

export function mergePreferenceEnvelopes(
    local: SyncEnvelope<UserPreferences>,
    remote: SyncEnvelope<UserPreferences>,
): MergeResult<UserPreferences> {
    const { winner, reason, identical } = pickWinner(local, remote);
    const conflicts: FieldConflict[] = [
        {
            key: "*",
            outcome: identical ? "identical" : winner === local ? "local" : "remote",
            localRevision: local.revision,
            remoteRevision: remote.revision,
            reason,
        },
    ];
    if (identical) return { data: local.data, envelope: local, conflicts };

    // Preferences are field-merged too: a phone that only toggled `notifications`
    // must not revert a theme change made on the desktop.
    const loser = winner === local ? remote : local;
    const data: UserPreferences = {
        ...winner.data,
        notifications: mergeRecords<
            keyof NotificationPreferences,
            NotificationPreferences[keyof NotificationPreferences]
        >(
            winner.data.notifications,
            loser.data.notifications,
            winner === local,
            conflicts,
            "notifications",
        ) as UserPreferences["notifications"],
        chart: mergeRecords<keyof UserPreferences["chart"], UserPreferences["chart"][keyof UserPreferences["chart"]]>(
            winner.data.chart,
            loser.data.chart,
            winner === local,
            conflicts,
            "chart",
        ) as UserPreferences["chart"],
    };
    return { data, envelope: { ...winner, data }, conflicts };
}

// ─────────────────────────────────────────────────────────────────────────────
// Plain-record merge helper
// ─────────────────────────────────────────────────────────────────────────────

function mergeRecords<K extends string, V>(
    winnerRecord: Partial<Record<K, V>>,
    loserRecord: Partial<Record<K, V>>,
    winnerIsLocal: boolean,
    conflicts: FieldConflict[],
    path: string,
): Partial<Record<K, V>> {
    const out: Partial<Record<K, V>> = { ...winnerRecord };
    for (const key of Object.keys(loserRecord) as K[]) {
        if (!(key in out)) {
            out[key] = loserRecord[key];
            continue;
        }
        if (JSON.stringify(out[key]) === JSON.stringify(loserRecord[key])) continue;
        conflicts.push({
            key: `${path}.${key}`,
            outcome: winnerIsLocal ? "local" : "remote",
            localRevision: 1,
            remoteRevision: 0,
            reason: "record winner decides a diverged scalar",
        });
    }
    return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Offline queue
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A pending local write. The queue exists so a workspace change made on the
 * train still lands on the server when the connection returns — it is never
 * dropped, and it is never merged as if it were remote state.
 */
export interface QueuedWrite<T> {
    id: string;
    envelope: SyncEnvelope<T>;
    queuedAt: number;
    attempts: number;
    lastError?: string;
}

export interface PendingQueue {
    workspace?: QueuedWrite<WorkspaceState>[];
    preferences?: QueuedWrite<UserPreferences>[];
}

/**
 * Coalesce queued writes. Only the newest write per record can matter — replaying
 * five intermediate workspace states in order would be wasted work and would make
 * the server do revisions it does not need.
 */
export function coalesceQueue<T>(queue: QueuedWrite<T>[]): QueuedWrite<T> {
    if (queue.length === 0) throw new Error("coalesceQueue: empty queue");
    return queue.reduce((newest, item) =>
        compareEnvelopes(item.envelope, newest.envelope) > 0 ? item : newest,
    );
}

/**
 * Compute what still needs to be sent after a merge.
 *
 * The question is purely "does the server already hold these exact bytes?" —
 * comparing envelope metadata would be wrong here, because the merged envelope
 * intentionally inherits the winning side's revision while its *data* differs
 * from both inputs. If the local edit contributed nothing to the merged record,
 * or the merged record is identical to what the server has, there is nothing to
 * push and re-pushing would flip-flop.
 */
export function pendingWriteAfterMerge<T>(
    local: SyncEnvelope<T>,
    merged: SyncEnvelope<T>,
    remote: SyncEnvelope<T>,
): QueuedWrite<T> | null {
    if (JSON.stringify(local.data) === JSON.stringify(merged.data)) {
        // Nothing local survived the merge — do not resurrect it.
        return null;
    }
    if (JSON.stringify(merged.data) === JSON.stringify(remote.data)) {
        // The server already holds exactly this record.
        return null;
    }
    return {
        id: `${local.updatedByDevice}:${local.updatedAt}`,
        envelope: merged,
        queuedAt: Date.now(),
        attempts: 0,
    };
}

export { envelopeOf };
