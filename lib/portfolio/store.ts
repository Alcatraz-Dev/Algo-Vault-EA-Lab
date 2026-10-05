/**
 * AlgoVault — Portfolio persistence (Phase 15 §32/§33/§28/§29/§44).
 *
 * ── Server-only ───────────────────────────────────────────────────────────
 * Imports `lib/firebase-admin`. Never import from a client component.
 *
 * RTDB layout (adapting to the existing per-user tree rather than inventing a
 * parallel one — every path is prefixed by the owning uid, which is what makes
 * tenant isolation enforceable in `database.rules.json`):
 *
 *   portfolios/{uid}/{portfolioId}/meta                 Portfolio config + version
 *   portfolios/{uid}/{portfolioId}/riskBudgets/{budgetId}
 *   portfolios/{uid}/{portfolioId}/versions/{version}   Configuration versions
 *   portfolioSnapshots/{uid}/{portfolioId}/{snapshotId} Immutable snapshots
 *   portfolioDecisions/{uid}/{portfolioId}/{decisionId}
 *   portfolioStressTests/{uid}/{portfolioId}/{stressTestId}
 *   portfolioAllocations/{uid}/{portfolioId}/{allocationId}
 *   portfolioJournal/{uid}/{portfolioId}/{entryId}
 *   portfolioMemory/{uid}/{portfolioId}/{memoryId}
 *   portfolioEvents/{uid}/{portfolioId}/{eventId}
 *   portfolioObservability/{uid}/{portfolioId}/{recordId}
 *   portfolioStrategies/{uid}/{portfolioId}/{strategyId} Strategy attribution
 *
 * Reads are bounded: history queries use `orderByChild("timestamp")` plus
 * `limitToLast`, never unbounded `get()` over a growing collection.
 */

import { adminDatabase } from "@/lib/firebase-admin";
import type {
    AutomationMode,
    ImmutablePortfolioSnapshot,
    Portfolio,
    PortfolioAllocation,
    PortfolioDecision,
    PortfolioEventMeta,
    PortfolioEventType,
    PortfolioJournalEntry,
    PortfolioMemoryEntry,
    PortfolioRiskBudget,
    PortfolioSnapshot,
    PortfolioSnapshotTrigger,
    PortfolioStressTest,
} from "./types";

export const PORTFOLIO_PATHS = {
    meta: (uid: string, pid: string) => `portfolios/${uid}/${pid}`,
    riskBudgets: (uid: string, pid: string) => `portfolios/${uid}/${pid}/riskBudgets`,
    versions: (uid: string, pid: string) => `portfolios/${uid}/${pid}/versions`,
    snapshots: (uid: string, pid: string) => `portfolioSnapshots/${uid}/${pid}`,
    decisions: (uid: string, pid: string) => `portfolioDecisions/${uid}/${pid}`,
    stressTests: (uid: string, pid: string) => `portfolioStressTests/${uid}/${pid}`,
    allocations: (uid: string, pid: string) => `portfolioAllocations/${uid}/${pid}`,
    journal: (uid: string, pid: string) => `portfolioJournal/${uid}/${pid}`,
    memory: (uid: string, pid: string) => `portfolioMemory/${uid}/${pid}`,
    events: (uid: string, pid: string) => `portfolioEvents/${uid}/${pid}`,
    observability: (uid: string, pid: string) => `portfolioObservability/${uid}/${pid}`,
    strategies: (uid: string, pid: string) => `portfolioStrategies/${uid}/${pid}`,
} as const;

function asObject(value: unknown): Record<string, unknown> {
    return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

let idCounter = 0;

/** Monotonic, sortable id. Time-prefixed so RTDB `orderByChild("timestamp")` works. */
export function newPortfolioId(now: number, prefix: string): string {
    idCounter = (idCounter + 1) % 1_000_000;
    return `${prefix}_${now}_${idCounter.toString(36).padStart(4, "0")}`;
}

/* ── Configuration + versioning ───────────────────────────────────────────── */

/**
 * Persist a portfolio configuration change and bump its version, writing the
 * full configuration into `versions/{version}` so historical analysis can
 * reconstruct exactly what the rules were at any past moment.
 */
export async function savePortfolioConfiguration(input: {
    portfolio: Portfolio;
    riskBudgets: PortfolioRiskBudget[];
    allocation: PortfolioAllocation | null;
    changedBy: string;
    now: number;
}): Promise<Portfolio> {
    const { portfolio, now } = input;
    const version = portfolio.version + 1;
    const updated: Portfolio = { ...portfolio, version, updatedAt: now };

    const payload = {
        name: updated.name,
        kind: updated.kind,
        baseCurrency: updated.baseCurrency,
        automationMode: updated.automationMode,
        accountIds: updated.accountIds,
        version,
        updatedAt: now,
        updatedBy: input.changedBy,
    };

    const versioned = {
        version,
        savedAt: now,
        savedBy: input.changedBy,
        riskBudgets: input.riskBudgets,
        allocation: input.allocation,
        automationMode: updated.automationMode,
    };

    await Promise.all([
        adminDatabase.ref(PORTFOLIO_PATHS.meta(input.portfolio.userId, portfolio.portfolioId)).update(payload),
        adminDatabase.ref(PORTFOLIO_PATHS.versions(input.portfolio.userId, portfolio.portfolioId)).child(String(version)).set(versioned),
    ]);

    return updated;
}

export async function saveRiskBudgets(
    userId: string,
    portfolioId: string,
    budgets: PortfolioRiskBudget[]
): Promise<void> {
    const ref = adminDatabase.ref(PORTFOLIO_PATHS.riskBudgets(userId, portfolioId));
    const updates: Record<string, PortfolioRiskBudget | null> = {};
    for (const b of budgets) updates[b.budgetId] = b;
    await ref.update(updates);
}

/** Read a specific stored configuration version. */
export async function readPortfolioVersion(
    userId: string,
    portfolioId: string,
    version: number
): Promise<Record<string, unknown> | null> {
    try {
        const snap = await adminDatabase.ref(PORTFOLIO_PATHS.versions(userId, portfolioId)).child(String(version)).get();
        return snap.exists() ? asObject(snap.val()) : null;
    } catch {
        return null;
    }
}

/* ── Immutable snapshots ──────────────────────────────────────────────────── */

/**
 * Write an immutable snapshot for a major event. Never updated afterwards.
 *
 * The snapshot embeds the engine versions, the configuration in force and the
 * full portfolio state, which is what makes future B2B certification possible:
 * a reviewer can replay exactly what AlgoVault knew at that instant.
 */
export async function writeImmutableSnapshot(input: {
    userId: string;
    portfolio: Portfolio;
    trigger: PortfolioSnapshotTrigger;
    snapshot: PortfolioSnapshot;
    riskBudgets: PortfolioRiskBudget[];
    allocation: PortfolioAllocation | null;
    now: number;
}): Promise<string> {
    const snapshotId = newPortfolioId(input.now, input.trigger.toLowerCase().replace(/_/g, ""));
    const record: ImmutablePortfolioSnapshot = {
        snapshotId,
        portfolioId: input.portfolio.portfolioId,
        userId: input.userId,
        trigger: input.trigger,
        timestamp: input.now,
        dataTimestamp: input.snapshot.freshness.dataTimestamp,
        engineVersions: input.snapshot.engineVersions,
        portfolioVersion: input.portfolio.version,
        configuration: {
            automationMode: input.portfolio.automationMode,
            riskBudgets: input.riskBudgets,
            allocation: input.allocation,
        },
        state: input.snapshot,
    };
    await adminDatabase
        .ref(PORTFOLIO_PATHS.snapshots(input.userId, input.portfolio.portfolioId))
        .child(snapshotId)
        .set(JSON.parse(JSON.stringify(record)));
    return snapshotId;
}

/** Bounded read of the newest immutable snapshots (timeline view). */
export async function readRecentSnapshots(
    userId: string,
    portfolioId: string,
    limit = 50
): Promise<Array<Record<string, unknown>>> {
    try {
        const snap = await adminDatabase
            .ref(PORTFOLIO_PATHS.snapshots(userId, portfolioId))
            .orderByChild("timestamp")
            .limitToLast(Math.min(Math.max(limit, 1), 200))
            .get();
        const out: Array<Record<string, unknown>> = [];
        snap.forEach((child) => {
            out.push(asObject(child.val()));
        });
        return out;
    } catch {
        return [];
    }
}

/** The newest immutable snapshot, used for equity-history / regime input. */
export async function readLatestSnapshot(
    userId: string,
    portfolioId: string
): Promise<ImmutablePortfolioSnapshot | null> {
    const recent = await readRecentSnapshots(userId, portfolioId, 1);
    const raw = recent[0];
    return raw ? (raw as unknown as ImmutablePortfolioSnapshot) : null;
}

/* ── Decisions ────────────────────────────────────────────────────────────── */

export async function writeDecision(
    userId: string,
    portfolioId: string,
    decision: PortfolioDecision
): Promise<void> {
    await adminDatabase
        .ref(PORTFOLIO_PATHS.decisions(userId, portfolioId))
        .child(decision.decisionId)
        .set(JSON.parse(JSON.stringify(decision)));
}

export async function readRecentDecisions(
    userId: string,
    portfolioId: string,
    limit = 25
): Promise<PortfolioDecision[]> {
    try {
        const snap = await adminDatabase
            .ref(PORTFOLIO_PATHS.decisions(userId, portfolioId))
            .orderByChild("generatedAt")
            .limitToLast(Math.min(Math.max(limit, 1), 100))
            .get();
        const out: PortfolioDecision[] = [];
        snap.forEach((child) => {
            out.push(child.val() as PortfolioDecision);
        });
        return out.reverse();
    } catch {
        return [];
    }
}

/* ── Stress tests ─────────────────────────────────────────────────────────── */

export async function writeStressTest(
    userId: string,
    portfolioId: string,
    stressTest: PortfolioStressTest
): Promise<void> {
    await adminDatabase
        .ref(PORTFOLIO_PATHS.stressTests(userId, portfolioId))
        .child(stressTest.stressTestId.replace(/[:]/g, "_"))
        .set(JSON.parse(JSON.stringify(stressTest)));
}

/* ── Allocations ──────────────────────────────────────────────────────────── */

export async function writeAllocation(
    userId: string,
    portfolioId: string,
    allocation: PortfolioAllocation
): Promise<string> {
    const id = newPortfolioId(allocation.calculatedAt, "alloc");
    await adminDatabase
        .ref(PORTFOLIO_PATHS.allocations(userId, portfolioId))
        .child(id)
        .set(JSON.parse(JSON.stringify({ ...allocation, allocationId: id })));
    return id;
}

/* ── Journal ──────────────────────────────────────────────────────────────── */

/**
 * Record a portfolio decision. Historical entries are NEVER rewritten: the
 * `whatAlgoVaultRecommended` / `whatTheUserDid` / `whatHappenedAfter` triple is
 * append-only so hindsight cannot silently revise what AlgoVault actually said.
 */
export async function writeJournalEntry(
    userId: string,
    portfolioId: string,
    entry: Omit<PortfolioJournalEntry, "entryId">
): Promise<string> {
    const entryId = newPortfolioId(entry.createdAt, entry.type.toLowerCase());
    await adminDatabase
        .ref(PORTFOLIO_PATHS.journal(userId, portfolioId))
        .child(entryId)
        .set(JSON.parse(JSON.stringify({ ...entry, entryId })));
    return entryId;
}

export async function readJournal(
    userId: string,
    portfolioId: string,
    limit = 50
): Promise<PortfolioJournalEntry[]> {
    try {
        const snap = await adminDatabase
            .ref(PORTFOLIO_PATHS.journal(userId, portfolioId))
            .orderByChild("createdAt")
            .limitToLast(Math.min(Math.max(limit, 1), 200))
            .get();
        const out: PortfolioJournalEntry[] = [];
        snap.forEach((child) => {
            out.push(child.val() as PortfolioJournalEntry);
        });
        return out.reverse();
    } catch {
        return [];
    }
}

/**
 * Close the loop on a past entry: record what actually happened and whether the
 * recommendation held up. This appends a new assessment; it does not edit the
 * original recommendation.
 */
export async function assessJournalOutcome(
    userId: string,
    portfolioId: string,
    entryId: string,
    outcome: { whatHappenedAfter: string; outcomeAssessment: PortfolioJournalEntry["outcomeAssessment"] }
): Promise<void> {
    await adminDatabase
        .ref(PORTFOLIO_PATHS.journal(userId, portfolioId))
        .child(entryId)
        .update({
            whatHappenedAfter: outcome.whatHappenedAfter,
            outcomeAssessment: outcome.outcomeAssessment,
            assessedAt: Date.now(),
        });
}

/* ── Portfolio memory ─────────────────────────────────────────────────────── */

/**
 * Store a structured memory fact.
 *
 * Only `Record<string, string | number | boolean>` facts are accepted — free
 * text speculation is rejected at the type level so an AI guess cannot become
 * permanent portfolio truth without validation.
 */
export async function writeMemoryEntry(
    userId: string,
    portfolioId: string,
    entry: Omit<PortfolioMemoryEntry, "memoryId">
): Promise<string> {
    const memoryId = newPortfolioId(entry.observedAt, entry.kind.toLowerCase());
    await adminDatabase
        .ref(PORTFOLIO_PATHS.memory(userId, portfolioId))
        .child(memoryId)
        .set(JSON.parse(JSON.stringify({ ...entry, memoryId })));
    return memoryId;
}

/**
 * Promote an unvalidated memory to validated — only after the recorded outcome
 * was checked against reality.
 */
export async function validateMemoryEntry(
    userId: string,
    portfolioId: string,
    memoryId: string,
    validated: boolean,
    now: number
): Promise<void> {
    await adminDatabase
        .ref(PORTFOLIO_PATHS.memory(userId, portfolioId))
        .child(memoryId)
        .update({
            validation: validated ? "VALIDATED" : "REJECTED",
            lastConfirmedAt: now,
        });
}

export async function readMemory(
    userId: string,
    portfolioId: string,
    limit = 50
): Promise<PortfolioMemoryEntry[]> {
    try {
        const snap = await adminDatabase
            .ref(PORTFOLIO_PATHS.memory(userId, portfolioId))
            .orderByChild("observedAt")
            .limitToLast(Math.min(Math.max(limit, 1), 200))
            .get();
        const out: PortfolioMemoryEntry[] = [];
        snap.forEach((child) => {
            out.push(child.val() as PortfolioMemoryEntry);
        });
        return out.reverse();
    } catch {
        return [];
    }
}

/* ── Events ───────────────────────────────────────────────────────────────── */

/** Append a portfolio event carrying full freshness metadata. */
export async function publishEvent(input: {
    userId: string;
    portfolioId: string;
    type: PortfolioEventType;
    dataTimestamp: number;
    payload: Record<string, unknown>;
    now: number;
}): Promise<PortfolioEventMeta> {
    const eventId = newPortfolioId(input.now, input.type.toLowerCase());
    const event: PortfolioEventMeta = {
        eventId,
        portfolioId: input.portfolioId,
        userId: input.userId,
        type: input.type,
        eventCreatedAt: input.now,
        dataTimestamp: input.dataTimestamp,
        availableAt: input.now,
        payload: input.payload,
    };
    await adminDatabase
        .ref(PORTFOLIO_PATHS.events(input.userId, input.portfolioId))
        .child(eventId)
        .set(JSON.parse(JSON.stringify(event)));
    return event;
}

export async function readEvents(
    userId: string,
    portfolioId: string,
    limit = 50
): Promise<PortfolioEventMeta[]> {
    try {
        const snap = await adminDatabase
            .ref(PORTFOLIO_PATHS.events(userId, portfolioId))
            .orderByChild("eventCreatedAt")
            .limitToLast(Math.min(Math.max(limit, 1), 200))
            .get();
        const out: PortfolioEventMeta[] = [];
        snap.forEach((child) => {
            out.push(child.val() as PortfolioEventMeta);
        });
        return out.reverse();
    } catch {
        return [];
    }
}

/* ── Observability ────────────────────────────────────────────────────────── */

export type PortfolioObservabilityKind =
    | "SNAPSHOT_LATENCY"
    | "CORRELATION_FAILURE"
    | "STALE_DATA"
    | "RISK_CALCULATION_FAILURE"
    | "AGENT_FAILURE"
    | "STRESS_JOB"
    | "ALLOCATION_RECOMMENDATION"
    | "BLOCKED_ACTION"
    | "USER_OVERRIDE"
    | "DECISION_OUTCOME";

export interface PortfolioObservabilityRecord {
    id: string;
    portfolioId: string;
    userId: string;
    kind: PortfolioObservabilityKind;
    createdAt: number;
    dataTimestamp: number;
    durationMs?: number;
    detail: string;
    metadata?: Record<string, string | number | boolean>;
}

export async function recordObservability(
    record: Omit<PortfolioObservabilityRecord, "id">,
    id = newPortfolioId(record.createdAt, record.kind.toLowerCase())
): Promise<void> {
    try {
        await adminDatabase
            .ref(PORTFOLIO_PATHS.observability(record.userId, record.portfolioId))
            .child(id)
            .set(JSON.parse(JSON.stringify({ ...record, id })));
    } catch {
        // Observability must never break the operation it observes.
    }
}

export async function readObservability(
    userId: string,
    portfolioId: string,
    limit = 50
): Promise<PortfolioObservabilityRecord[]> {
    try {
        const snap = await adminDatabase
            .ref(PORTFOLIO_PATHS.observability(userId, portfolioId))
            .orderByChild("createdAt")
            .limitToLast(Math.min(Math.max(limit, 1), 200))
            .get();
        const out: PortfolioObservabilityRecord[] = [];
        snap.forEach((child) => {
            out.push(child.val() as PortfolioObservabilityRecord);
        });
        return out.reverse();
    } catch {
        return [];
    }
}

/* ── Automation mode ──────────────────────────────────────────────────────── */

/**
 * Change the automation mode. Setting `AUTOMATED` is only ever a *configuration*
 * flag: every automated action still has to pass the Risk Engine and the
 * Execution Supervisor. Nothing here moves capital.
 */
export async function setAutomationMode(input: {
    portfolio: Portfolio;
    mode: AutomationMode;
    changedBy: string;
    now: number;
}): Promise<Portfolio> {
    const updated: Portfolio = { ...input.portfolio, automationMode: input.mode, updatedAt: input.now };
    await adminDatabase.ref(PORTFOLIO_PATHS.meta(input.portfolio.userId, input.portfolio.portfolioId)).update({
        automationMode: input.mode,
        automationModeChangedAt: input.now,
        automationModeChangedBy: input.changedBy,
    });
    return updated;
}
