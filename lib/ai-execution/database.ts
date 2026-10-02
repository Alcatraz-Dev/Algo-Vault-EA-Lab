/**
 * AI Execution — RTDB persistence.
 *
 * RTDB ONLY (no Firestore). All paths live under a dedicated `aiExecution`
 * namespace so nothing collides with existing domains. Reads/writes go through
 * the admin SDK with the same undefined→null deep-clean boundary the workflow
 * module uses (RTDB rejects nested `undefined`).
 *
 *   aiExecution/{uid}/policy                       ExecutionPolicy (server-clamped)
 *   aiExecution/{uid}/plans/{planId}               TradePlan
 *   aiExecution/{uid}/reviews/{reviewId}           PositionReview
 *   aiExecution/{uid}/audit/{entryId}              AuditEntry (append-only by convention)
 *   aiExecution/killSwitch                         AiExecutionKillSwitch (server-only access)
 *   aiExecutionSubmissions/{uid}/{hash}            duplicate-prevention index
 */

import { adminDatabase } from "@/lib/firebase-admin";
import type {
    AiExecutionKillSwitch,
    ExecutionPolicy,
    PositionReview,
    TradePlan,
} from "./types";
import { clampAutomationPolicy, DEFAULT_AUTOMATION_POLICY } from "./types";

// ─────────────────────────────────────────────────────────────────────────────
// Paths
// ─────────────────────────────────────────────────────────────────────────────

export const AI_EXECUTION_PATHS = {
    root: (uid: string) => `aiExecution/${uid}`,
    policy: (uid: string) => `aiExecution/${uid}/policy`,
    plan: (uid: string, planId: string) => `aiExecution/${uid}/plans/${planId}`,
    plans: (uid: string) => `aiExecution/${uid}/plans`,
    review: (uid: string, reviewId: string) => `aiExecution/${uid}/reviews/${reviewId}`,
    reviews: (uid: string) => `aiExecution/${uid}/reviews`,
    audit: (uid: string) => `aiExecution/${uid}/audit`,
    killSwitch: () => "aiExecution/killSwitch",
    submissions: (uid: string) => `aiExecutionSubmissions/${uid}`,
    submissionKey: (uid: string, key: string) => `aiExecutionSubmissions/${uid}/${key}`,
} as const;

const REF = (path: string) => {
    const ref = adminDatabase.ref(path);
    const proxy = Object.create(ref) as typeof ref;
    proxy.set = (value: unknown) => ref.set(deepClean(value));
    proxy.update = (value: unknown) => ref.update(deepClean(value) as Record<string, unknown>);
    return proxy;
};

function deepClean<T>(value: T): T {
    if (value === undefined) return null as unknown as T;
    if (Array.isArray(value)) return value.map((v) => deepClean(v)) as unknown as T;
    if (value && typeof value === "object") {
        const out: Record<string, unknown> = {};
        for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
            out[key] = deepClean(val);
        }
        return out as T;
    }
    return value;
}

// ─────────────────────────────────────────────────────────────────────────────
// Policy
// ─────────────────────────────────────────────────────────────────────────────

const DEFAULT_POLICY: ExecutionPolicy = {
    userId: "",
    executionMode: "ANALYSIS", // automation is NEVER enabled implicitly
    enabled: false,
    updatedAt: 0,
    updatedBy: "system",
    automation: undefined,
};

export async function getExecutionPolicy(uid: string): Promise<ExecutionPolicy> {
    const snap = await REF(AI_EXECUTION_PATHS.policy(uid)).get();
    const raw = (snap.val() || {}) as Partial<ExecutionPolicy>;
    const mode: ExecutionPolicy["executionMode"] =
        raw.executionMode === "APPROVAL" || raw.executionMode === "AUTOMATION" ? raw.executionMode : "ANALYSIS";
    return {
        userId: uid,
        executionMode: mode,
        // AUTOMATION requires the explicit enabled flag, server-side.
        enabled: mode === "AUTOMATION" ? raw.enabled === true : false,
        updatedAt: Number(raw.updatedAt) || 0,
        updatedBy: String(raw.updatedBy ?? "system"),
        automation: raw.automation ? clampAutomationPolicy(raw.automation) : { ...DEFAULT_AUTOMATION_POLICY },
    };
}

/**
 * Persist a policy update. The caller MUST have already authenticated the
 * request server-side; `isAutomationChange` marks transitions into/out of
 * AUTOMATION so the API layer can require an explicit confirmation token and
 * write an audit entry.
 */
export async function saveExecutionPolicy(
    uid: string,
    update: Partial<Pick<ExecutionPolicy, "executionMode" | "enabled" | "automation">>,
    updatedBy: string,
): Promise<ExecutionPolicy> {
    const current = await getExecutionPolicy(uid);
    const nextMode = update.executionMode ?? current.executionMode;
    const next: ExecutionPolicy = {
        userId: uid,
        executionMode: nextMode,
        enabled: nextMode === "AUTOMATION" ? update.enabled ?? current.enabled : false,
        automation: update.automation ? clampAutomationPolicy(update.automation) : current.automation,
        updatedAt: Date.now(),
        updatedBy,
    };
    await REF(AI_EXECUTION_PATHS.policy(uid)).set(next);
    return next;
}

// ─────────────────────────────────────────────────────────────────────────────
// Kill switch (server-enforced, fail-closed)
// ─────────────────────────────────────────────────────────────────────────────

const KILL_SWITCH_CACHE_TTL_MS = 5_000;
let killSwitchCache: { value: AiExecutionKillSwitch; at: number } | null = null;

/**
 * Read the kill switch. FAIL-CLOSED: any read error returns engaged=true so an
 * infrastructure outage can never re-open the execution path.
 */
export async function getKillSwitch(): Promise<AiExecutionKillSwitch> {
    if (killSwitchCache && Date.now() - killSwitchCache.at < KILL_SWITCH_CACHE_TTL_MS) {
        return killSwitchCache.value;
    }
    try {
        const snap = await REF(AI_EXECUTION_PATHS.killSwitch()).get();
        const val = (snap.val() || {}) as Partial<AiExecutionKillSwitch>;
        const value: AiExecutionKillSwitch = { engaged: val.engaged === true, reason: val.reason, engagedBy: val.engagedBy, engagedAt: val.engagedAt };
        killSwitchCache = { value, at: Date.now() };
        return value;
    } catch {
        return { engaged: true, reason: "Kill-switch state unreadable — failing closed." };
    }
}

export async function setKillSwitch(
    engaged: boolean,
    by: string,
    reason?: string,
): Promise<void> {
    const value: AiExecutionKillSwitch = engaged
        ? { engaged: true, reason: reason ?? "Kill switch engaged.", engagedBy: by, engagedAt: Date.now() }
        : { engaged: false };
    killSwitchCache = null;
    await REF(AI_EXECUTION_PATHS.killSwitch()).set(value);
}

/** Clears the short cache after admin writes so reads are fresh. */
export function invalidateKillSwitchCache(): void {
    killSwitchCache = null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Plans
// ─────────────────────────────────────────────────────────────────────────────

export async function savePlan(plan: TradePlan): Promise<void> {
    await REF(AI_EXECUTION_PATHS.plan(plan.userId, plan.id)).set({ ...plan, updatedAt: Date.now() });
}

export async function getPlan(uid: string, planId: string): Promise<TradePlan | null> {
    const snap = await REF(AI_EXECUTION_PATHS.plan(uid, planId)).get();
    return snap.exists() ? (snap.val() as TradePlan) : null;
}

export async function listPlans(uid: string, limit = 100): Promise<TradePlan[]> {
    const snap = await REF(AI_EXECUTION_PATHS.plans(uid)).limitToLast(limit).get();
    const val = (snap.val() || {}) as Record<string, TradePlan>;
    return Object.values(val).sort((a, b) => (b.generatedAt || 0) - (a.generatedAt || 0));
}

export async function updatePlan(uid: string, planId: string, updates: Partial<TradePlan>): Promise<TradePlan | null> {
    const existing = await getPlan(uid, planId);
    if (!existing) return null;
    const next: TradePlan = { ...existing, ...updates, updatedAt: Date.now() };
    await REF(AI_EXECUTION_PATHS.plan(uid, planId)).set(next);
    return next;
}

// ─────────────────────────────────────────────────────────────────────────────
// Duplicate-order prevention
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Deterministic idempotency key: same user + instrument + direction + entry/SL
 * rounded to 5 decimals within a recent window means "the same order".
 */
export function submissionKeyFor(plan: TradePlan): string {
    const r = (v: number) => Math.round(v * 1e5) / 1e5;
    return [plan.instrument, plan.direction, r(plan.entry), r(plan.stopLoss)].join("|");
}

const DUPLICATE_WINDOW_MS = 10 * 60_000;

export async function checkAndRecordSubmission(uid: string, plan: TradePlan): Promise<{ duplicate: boolean; key: string }> {
    const key = submissionKeyFor(plan);
    const safeKey = key.replace(/[^A-Za-z0-9|-]/g, "_").slice(0, 180);
    const ref = REF(AI_EXECUTION_PATHS.submissionKey(uid, safeKey));
    const snap = await ref.get();
    if (snap.exists()) {
        const existing = snap.val() as { at?: number; planId?: string };
        if (existing && Number(existing.at) > Date.now() - DUPLICATE_WINDOW_MS) {
            return { duplicate: true, key };
        }
    }
    await ref.set({ key, planId: plan.id, at: Date.now() });
    return { duplicate: false, key };
}

// ─────────────────────────────────────────────────────────────────────────────
// Position reviews (AI monitoring output)
// ─────────────────────────────────────────────────────────────────────────────

export async function savePositionReview(review: PositionReview): Promise<void> {
    await REF(AI_EXECUTION_PATHS.review(review.userId, review.id)).set(review);
}

export async function listPositionReviews(uid: string, planId?: string, limit = 50): Promise<PositionReview[]> {
    const snap = await REF(AI_EXECUTION_PATHS.reviews(uid)).limitToLast(limit).get();
    const val = (snap.val() || {}) as Record<string, PositionReview>;
    const all = Object.values(val).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    return planId ? all.filter((r) => r.planId === planId) : all;
}

// ─────────────────────────────────────────────────────────────────────────────
// Audit trail
// ─────────────────────────────────────────────────────────────────────────────

export type AuditAction =
    | "PLAN_GENERATED"
    | "PLAN_REJECTED"
    | "PLAN_EXPIRED"
    | "APPROVAL_GRANTED"
    | "APPROVAL_WITHDRAWN"
    | "EXECUTION_SUBMITTED"
    | "EXECUTION_ACCEPTED"
    | "EXECUTION_REJECTED"
    | "EXECUTION_FAILED"
    | "POSITION_OPENED"
    | "POSITION_CLOSED"
    | "POLICY_UPDATED"
    | "AUTOMATION_ENABLED"
    | "AUTOMATION_DISABLED"
    | "KILL_SWITCH_ENGAGED"
    | "KILL_SWITCH_RELEASED"
    | "AI_REVIEW_RECORDED"
    | "MANAGEMENT_ACTION_QUEUED";

export interface AuditEntry {
    id: string;
    userId: string;
    action: AuditAction;
    planId?: string;
    /** Actor: user uid, "system", "ai:<provider>", or "admin:<uid>". */
    actor: string;
    executionMode?: string;
    /** Evidence ids (references only — full evidence lives on the plan). */
    evidenceIds?: string[];
    riskChecks?: Array<{ stage: string; passed: boolean; code: string }>;
    decision?: string;
    reason?: string;
    brokerResponse?: Record<string, unknown>;
    error?: string;
    timestamp: number;
}

export async function writeAudit(entry: Omit<AuditEntry, "id" | "timestamp"> & { id?: string }): Promise<string> {
    const ref = REF(AI_EXECUTION_PATHS.audit(entry.userId)).push();
    const id = entry.id ?? ref.key!;
    const full: AuditEntry = { ...entry, id, timestamp: Date.now() };
    await REF(`${AI_EXECUTION_PATHS.audit(entry.userId)}/${id}`).set(full);
    return id;
}

export async function listAudit(uid: string, limit = 100): Promise<AuditEntry[]> {
    const snap = await REF(AI_EXECUTION_PATHS.audit(uid)).limitToLast(limit).get();
    const val = (snap.val() || {}) as Record<string, AuditEntry>;
    return Object.values(val).sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
}
